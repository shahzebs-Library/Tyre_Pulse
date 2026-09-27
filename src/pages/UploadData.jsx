import { useState, useRef, useMemo, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { uploads } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { batchClassify } from '../lib/tyreClassifier'
import { canonicalCode } from '../lib/tyrePositions'
import { logAuditEvent } from '../lib/auditLogger'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, FileSpreadsheet, CheckCircle, X, Wand2, BookOpen,
  AlertTriangle, Package, ChevronRight, Layers, Table2, Eye,
  Rocket, Info, Zap, Search, Database, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
// No CardHeader here: every card on this page has a compound header (icon +
// heading + a scope note) or an action that must be free to wrap, and
// CardHeader truncates its title and cannot wrap its actions.
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import { toUserMessage } from '../lib/safeError'
import { duplicateComparable, isExactSuppliedRow } from '../lib/import/exactDuplicate'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import StatTile from '../components/ui/StatTile'
import {
  resultNumber, rowsHandled, fileSummary, qualityVerdict, QUALITY_LABEL, summarizeQuality,
  filterQuality, rawPreviewRows, columnLetter, dupReviewRows, DUP_KIND_LABEL, skipLogRows,
} from '../lib/uploadDataAnalytics'

// ── Step bar ──────────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'idle',       icon: Upload,       label: 'Upload File' },
  { key: 'sheets',     icon: Layers,       label: 'Select Sheets' },
  { key: 'mapping',    icon: Table2,       label: 'Map Columns' },
  { key: 'preview',    icon: Eye,          label: 'Preview & Check' },
  { key: 'uploading',  icon: Rocket,       label: 'Uploading' },
  { key: 'done',       icon: CheckCircle,  label: 'Complete' },
]

function StepBar({ current }) {
  const { t } = useLanguage()
  const activeIdx = STEPS.findIndex(s => s.key === current)
  return (
    <div className="flex items-center gap-0 mb-8 overflow-x-auto pb-1" role="list" aria-label="Upload progress">
      {STEPS.map((s, i) => {
        const Icon = s.icon
        const done   = i < activeIdx
        const active = i === activeIdx
        return (
          <div key={s.key} role="listitem" className="flex items-center" aria-current={active ? 'step' : undefined}>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              active  ? 'bg-green-500/15 text-green-500 border border-green-500/50' :
              done    ? 'text-green-500 opacity-70' : 'text-[var(--text-dim)]'
            }`}>
              <Icon size={13} aria-hidden="true" />
              <span className="hidden sm:inline">{t(`uploaddata.steps.${s.key}`)}</span>
              <span className="sr-only sm:hidden">{t(`uploaddata.steps.${s.key}`)}{done ? ' (done)' : active ? ' (current)' : ''}</span>
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight size={12} className={`mx-1 flex-shrink-0 ${i < activeIdx ? 'text-green-600' : 'text-[var(--text-dim)]'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Fuzzy matching engine ─────────────────────────────────────────────────────

/**
 * Levenshtein distance - used as fuzzy fallback when substring match fails.
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
    }
  }
  return dp[m][n]
}

/**
 * Normalise a header for comparison: lowercase, strip special chars, collapse spaces.
 * "Serial No." → "serial no" | "رقم التسلسل" kept as-is for Arabic comparison
 */
function normalise(s) {
  return String(s)
    .toLowerCase()
    .replace(/[.\-_/\\()\[\]{}'"*@#%&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Compute a match score 0-100 between a file header and a set of synonym strings.
 * Returns { score, matchedGuess }
 */
export function scoreHeader(header, guesses) {
  const h = normalise(header)
  let best = 0, matchedGuess = null

  for (const raw of guesses) {
    const g = normalise(raw)
    // Guesses that normalise to nothing (e.g. "#") would substring-match every
    // header and let a low-value field steal a critical column - skip them.
    if (!g || !h) continue
    // 1. Exact match
    if (h === g) return { score: 100, matchedGuess: raw }
    // 2. Substring - header contains guess, or guess contains header
    if (h.includes(g) || g.includes(h)) {
      if (70 > best) { best = 70; matchedGuess = raw }
      continue
    }
    // 3. Word overlap
    const hw = new Set(h.split(' '))
    const gw = g.split(' ')
    const overlap = gw.filter(w => w.length > 1 && hw.has(w)).length
    if (overlap > 0) {
      const s = Math.round(55 * overlap / Math.max(hw.size, gw.length))
      if (s > best) { best = s; matchedGuess = raw }
    }
    // 4. Levenshtein - short strings only (avoid false positives on long strings)
    if (h.length <= 20 && g.length <= 20) {
      const dist = levenshtein(h, g)
      const maxLen = Math.max(h.length, g.length)
      const s = Math.round((1 - dist / maxLen) * 50)
      if (s >= 35 && s > best) { best = s; matchedGuess = raw }
    }
  }
  return { score: best, matchedGuess }
}

/**
 * Returns confidence band from score.
 */
function confidenceBand(score) {
  if (score >= 90) return 'exact'
  if (score >= 65) return 'high'
  if (score >= 40) return 'medium'
  if (score >= 20) return 'low'
  return 'none'
}

// ── Canonical field definitions ───────────────────────────────────────────────

/**
 * Each field has:
 *  - label: human-readable
 *  - required: true = shown with * in UI
 *  - guesses: extensive synonym list including Arabic transliterations
 */
export const TYRE_FIELDS = [
  {
    key: 'sr',
    label: 'Row / SR No.',
    required: false,
    guesses: ['sr', 'no', 'sno', 's.no', 's no', '#', 'row', 'seq', 'serial row', 'number', 'رقم', 'رقم التسلسل', 'ت', 'م'],
  },
  {
    key: 'issue_date',
    label: 'Issue / Fitment Date',
    required: true,
    guesses: ['date', 'issue date', 'issue_date', 'issuance date', 'issued', 'issued date', 'issue dt', 'تاريخ', 'تاريخ الإصدار', 'tarikh', 'تاريخ التركيب', 'transaction date', 'tyre fix date', 'fix date', 'fixed date', 'fitment date', 'fitted date', 'job card date', 'jc date', 'vehicle in date', 'date fitted'],
  },
  {
    key: 'description',
    label: 'Description / Tyre Size',
    required: true,
    guesses: ['description', 'desc', 'tyre description', 'type', 'item', 'item name', 'product', 'product name', 'item desc', 'tyre type', 'item/tyre', 'item tyre', 'tyre size', 'size', 'tyre size/desc', 'tyre item', 'الوصف', 'وصف', 'نوع الإطار', 'الإطار'],
  },
  {
    key: 'brand',
    label: 'Brand / Make',
    required: false,
    guesses: ['brand', 'tyre brand', 'tyre_brand', 'manufacturer', 'make', 'brand name', 'tyre make', 'ماركة', 'الماركة', 'العلامة التجارية', 'صانع'],
  },
  {
    key: 'serial_no',
    label: 'Serial / Tyre Number',
    required: true,
    guesses: ['serial', 'serial no', 'serial_no', 'serial number', 's/n', 'sn', 'serial num', 'tyre serial', 'tyre no', 'tyre no.', 'tyre number', 'tyre num', 'barcode', 'part no', 'الرقم التسلسلي', 'رقم التسلسل', 'رقم المنتج', 'رقم القطعة'],
  },
  {
    key: 'qty',
    label: 'Quantity',
    required: false,
    guesses: ['qty', 'quantity', 'count', 'qnty', 'q', 'pcs', 'pieces', 'كمية', 'الكمية', 'عدد'],
  },
  {
    key: 'cost_per_tyre',
    label: 'Unit Cost / Tyre',
    required: false,
    guesses: ['unit cost', 'unit price', 'cost per tyre', 'price per tyre', 'unit rate', 'rate', 'سعر الوحدة', 'سعر الإطار'],
  },
  {
    // ERP exports usually carry the line TOTAL (qty already included). Mapping
    // that column here derives the true per-tyre price (total ÷ qty) at build
    // time, so spend is never double-counted downstream.
    key: 'total_amount',
    label: 'Total Amount (qty included)',
    required: false,
    guesses: ['total amount', 'total cost', 'total value', 'total price', 'amount', 'total', 'value', 'line total', 'net amount', 'cost', 'price', 'tyre cost', 'المبلغ الإجمالي', 'الإجمالي', 'القيمة', 'التكلفة', 'السعر'],
  },
  {
    key: 'job_card',
    label: 'Job Card / Work Order',
    required: false,
    guesses: ['job card', 'job_card', 'jc', 'jc no', 'jc no.', 'job card no', 'job card no.', 'work order', 'wo', 'job no', 'job number', 'wo no', 'work order no', 'order no', 'بطاقة العمل', 'رقم العمل', 'أمر العمل'],
  },
  {
    key: 'mis_number',
    label: 'MIS Number',
    required: false,
    guesses: ['mis', 'mis no', 'mis number', 'mis_number', 'mis num', 'maintenance id', 'maint no', 'رقم mis', 'رقم الصيانة'],
  },
  {
    key: 'asset_no',
    label: 'Asset / Vehicle No.',
    required: true,
    guesses: [
      'asset', 'asset no', 'asset_no', 'asset number', 'equipment', 'vehicle',
      'vehicle no', 'vehicle no.', 'vehicle number', 'veh no', 'veh no.', 'veh.no',
      'plate', 'plate no', 'reg', 'reg no', 'registration', 'fleet no', 'fleet number',
      'unit', 'unit no', 'chassis', 'ub no',
      'رقم المركبة', 'رقم الأصل', 'لوحة السيارة', 'رقم السيارة', 'الأصل',
    ],
  },
  {
    key: 'site',
    label: 'Site / Location',
    required: false,
    guesses: ['site', 'location', 'area', 'camp', 'branch', 'depot', 'yard', 'warehouse', 'project', 'asset location', 'workshop location', 'tracking category', 'موقع', 'المنطقة', 'المعسكر', 'موقع العمل', 'الفرع'],
  },
  {
    key: 'country',
    label: 'Country',
    required: false,
    guesses: ['country', 'nation', 'region country', 'state', 'country code', 'cc', 'البلد', 'الدولة', 'المنطقة'],
  },
  {
    key: 'remarks',
    label: 'Remarks / Complaint',
    required: false,
    guesses: ['remarks', 'notes', 'comment', 'comments', 'note', 'observation', 'qc remarks', 'complaints', 'complaint', 'job done description', 'job done', 'ملاحظات', 'ملاحظة', 'تعليق', 'بيانات إضافية'],
  },
  // ── Fleet / asset context ────────────────────────────────────────────────
  {
    key: 'vehicle_type',
    label: 'Vehicle Type / Category',
    required: false,
    guesses: ['vehicle type', 'veh type', 'veh type/category', 'veh type / category', 'type/category', 'category', 'asset type', 'asset desc', 'asset description', 'equipment type', 'fleet type', 'capacity', 'نوع المركبة', 'فئة'],
  },
  {
    key: 'position',
    label: 'Tyre Position',
    required: false,
    guesses: ['position', 'tyre position', 'tyre pos', 'wheel position', 'pos', 'axle position', 'axle', 'wheel', 'الموضع', 'موضع الإطار'],
  },
  // ── Lifecycle: fitment ───────────────────────────────────────────────────
  {
    key: 'km_at_fitment',
    label: 'Fitted KM',
    required: false,
    guesses: ['fixed km', 'fitted km', 'fitment km', 'km at fitment', 'km fitted', 'install km', 'km/hr', 'km', 'kms', 'odometer', 'كم التركيب'],
  },
  {
    key: 'hrs_at_fitment',
    label: 'Fitted Hours',
    required: false,
    guesses: ['fixed hrs', 'fixed hours', 'fitted hrs', 'fitment hrs', 'hrs at fitment', 'install hrs', 'hours', 'hrs', 'ساعات التركيب'],
  },
  // ── Lifecycle: removal ───────────────────────────────────────────────────
  {
    key: 'removal_date',
    label: 'Removed Date',
    required: false,
    guesses: ['tyre removed date', 'removed date', 'removal date', 'date removed', 'scrap date', 'replace date', 'vehicle out date', 'تاريخ الإزالة'],
  },
  {
    key: 'km_at_removal',
    label: 'Removed KM',
    required: false,
    guesses: ['removed km', 'removal km', 'km at removal', 'km removed', 'scrap km', 'كم الإزالة'],
  },
  {
    key: 'hrs_at_removal',
    label: 'Removed Hours',
    required: false,
    guesses: ['removed hrs', 'removed hours', 'removal hrs', 'hrs at removal', 'scrap hrs', 'ساعات الإزالة'],
  },
  {
    key: 'removal_reason',
    label: 'Removal Reason',
    required: false,
    guesses: ['reason', 'removal reason', 'reason of repair', 'reason for removal', 'scrap reason', 'failure reason', 'cause', 'سبب الإزالة', 'سبب'],
  },
  // ── Lifecycle: totals ────────────────────────────────────────────────────
  {
    key: 'total_km',
    label: 'Total KM Run',
    required: false,
    guesses: ['total km', 'total kms', 'km run', 'tyre life km', 'distance run', 'إجمالي الكيلومترات'],
  },
  {
    key: 'total_hrs',
    label: 'Total Hours Run',
    required: false,
    guesses: ['total hrs', 'total hours', 'hrs run', 'tyre life hrs', 'إجمالي الساعات'],
  },
]


// Fields parsed as dates / numbers during row building.
const PREVIEW_ROWS = 50

const DATE_FIELDS    = new Set(['issue_date', 'removal_date'])
const NUMERIC_FIELDS = new Set(['km_at_fitment', 'hrs_at_fitment', 'km_at_removal', 'hrs_at_removal', 'total_km', 'total_hrs'])

/** Parse a numeric cell that may carry units e.g. "240 M/H", "3,940.00", "132282.0". */
function parseNumeric(val) {
  if (val == null || val === '') return null
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  const m = String(val).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}


const STOCK_FIELDS = [
  { key: 'item_code',   label: 'Item Code',    required: true,  guesses: ['item code', 'item_code', 'code', 'part no', 'part number', 'sku', 'item no', 'رمز الصنف', 'كود الصنف'] },
  { key: 'description', label: 'Description',  required: true,  guesses: ['description', 'desc', 'item name', 'product name', 'item description', 'الوصف', 'اسم الصنف'] },
  { key: 'brand',       label: 'Brand',        required: false, guesses: ['brand', 'manufacturer', 'make', 'ماركة', 'الماركة'] },
  { key: 'category',    label: 'Category',     required: false, guesses: ['category', 'type', 'class', 'group', 'فئة', 'تصنيف'] },
  { key: 'qty',         label: 'Quantity',     required: true,  guesses: ['qty', 'quantity', 'count', 'stock', 'on hand', 'balance', 'كمية', 'المخزون'] },
  { key: 'unit_cost',   label: 'Unit Cost',    required: false, guesses: ['unit cost', 'unit_cost', 'price', 'cost', 'rate', 'unit price', 'سعر الوحدة', 'التكلفة'] },
  { key: 'site',        label: 'Site',         required: false, guesses: ['site', 'warehouse', 'branch', 'store', 'موقع', 'مستودع'] },
  { key: 'location',    label: 'Bin Location', required: false, guesses: ['location', 'bin', 'shelf', 'bin location', 'rack', 'bin no', 'موقع التخزين'] },
  { key: 'min_level',   label: 'Min Stock',    required: false, guesses: ['min level', 'min_level', 'minimum', 'reorder level', 'min stock', 'الحد الأدنى'] },
  { key: 'reorder_qty', label: 'Reorder Qty',  required: false, guesses: ['reorder qty', 'reorder_qty', 'order qty', 'order quantity', 'كمية إعادة الطلب'] },
  { key: 'supplier',    label: 'Supplier',     required: false, guesses: ['supplier', 'vendor', 'vendor name', 'مورد', 'اسم المورد'] },
  { key: 'notes',       label: 'Notes',        required: false, guesses: ['notes', 'remarks', 'comment', 'comments', 'ملاحظات'] },
]

// ── Smart mapping engine ──────────────────────────────────────────────────────

/**
 * Returns: { [canonicalKey]: { header: string | null, score: number, band: string } }
 * Uses a greedy best-match assignment - each source column can only be used once.
 * synonyms: [{ custom_name, maps_to }] - user-defined permanent mappings (score 100).
 */
export function smartMapping(headers, fields, synonyms = []) {
  // Build synonym lookup: normalised custom_name → maps_to
  const synLookup = {}
  synonyms.forEach(s => { synLookup[normalise(s.custom_name)] = s.maps_to })

  const scores = {}
  fields.forEach(f => {
    // Check synonyms first - they score 100 (exact)
    const synHeader = headers.find(h => synLookup[normalise(h)] === f.key)
    if (synHeader) {
      scores[f.key] = [{ h: synHeader, score: 100, matchedGuess: synHeader }, ...headers.filter(h => h !== synHeader).map(h => ({ h, ...scoreHeader(h, f.guesses) })).sort((a, b) => b.score - a.score)]
    } else {
      scores[f.key] = headers.map(h => ({ h, ...scoreHeader(h, f.guesses) })).sort((a, b) => b.score - a.score)
    }
  })

  // Global greedy assignment by descending score, so a strong match is never
  // stolen by a weaker one that merely appears earlier in the field list
  // (e.g. optional "sr" grabbing "Serial No" at 70 before the required
  // serial_no field could claim its exact 100 match). Ties break in favour of
  // required fields, then field-definition order.
  const fieldOrder = Object.fromEntries(fields.map((f, i) => [f.key, i]))
  const required   = Object.fromEntries(fields.map(f => [f.key, !!f.required]))
  const candidates = []
  fields.forEach(f => scores[f.key].forEach(m => { if (m.score >= 35) candidates.push({ key: f.key, h: m.h, score: m.score }) }))
  candidates.sort((a, b) =>
    b.score - a.score
    || (required[b.key] ? 1 : 0) - (required[a.key] ? 1 : 0)
    || fieldOrder[a.key] - fieldOrder[b.key]
  )

  const assigned = new Set()
  const result   = {}
  candidates.forEach(c => {
    if (result[c.key] || assigned.has(c.h)) return
    result[c.key] = { header: c.h, score: c.score, band: confidenceBand(c.score) }
    assigned.add(c.h)
  })
  fields.forEach(f => { if (!result[f.key]) result[f.key] = { header: null, score: 0, band: 'none' } })

  return result
}

// ── Utility functions ─────────────────────────────────────────────────────────

function fingerprintHeaders(headers) {
  return [...headers].sort().join('|').toLowerCase()
}

// Reject "dates" parsed from junk like job-card codes ("JC-770" → year 0770).
const plausibleYear = (iso) => {
  const y = Number(String(iso).slice(0, 4))
  return y >= 1980 && y <= 2100
}

export function parseDate(val) {
  if (!val) return null
  if (val instanceof Date) {
    const iso = val.toISOString().split('T')[0]
    return plausibleYear(iso) ? iso : null
  }
  const s = String(val).trim()
  if (!s) return null
  const d = new Date(s)
  if (!isNaN(d)) {
    const iso = d.toISOString().split('T')[0]
    if (plausibleYear(iso)) return iso
  }
  const parts = s.split(/[\/\-]/)
  if (parts.length === 3) {
    const [a, b, c] = parts
    if (c.length === 4) {
      const iso = `${c}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`
      return plausibleYear(iso) ? iso : null
    }
  }
  return null
}

function guessFileType(headers) {
  const h = headers.map(x => normalise(String(x)))
  const fleetSignals = ['make', 'model', 'vehicle type', 'fleet number', 'operator', 'chassis']
  const tyreSignals  = ['serial no', 'serial', 'description', 'remarks', 'job card', 'mis number', 'mis no', 'tyre no', 'tyre position', 'fixed km', 'item/tyre']
  const fleetScore   = fleetSignals.filter(s => h.some(x => x.includes(s))).length
  const tyreScore    = tyreSignals.filter(s => h.some(x => x.includes(s))).length
  if (fleetScore >= 2 && fleetScore > tyreScore) return 'fleet'
  if (tyreScore >= 2) return 'tyres'
  return 'unknown'
}

// ── Intelligent header-row detection ──────────────────────────────────────────

const _NUMERIC_RE = /^-?[\d,]+(\.\d+)?$/
const _DATEISH_RE = /^\d{1,4}[\/\-.]\d{1,2}([\/\-.]\d{1,4})?/

/** A cell counts as a "label" if it's non-empty text that isn't a number/date. */
function _isLabelCell(v) {
  if (v === null || v === undefined) return false
  const s = String(v).trim()
  if (!s) return false
  if (_NUMERIC_RE.test(s.replace(/\s/g, ''))) return false
  if (_DATEISH_RE.test(s)) return false
  return true
}

/**
 * Many ERP/Excel exports prepend title/metadata rows before the real header
 * (e.g. "MONTHLY TYRES CONSUMPTION REPORT", date ranges, blank rows). Scan the
 * first rows and score each as a candidate header: a header row is densely
 * filled with short, unique text labels and is followed by populated data rows.
 * Returns the zero-based index of the most likely header row.
 */
function detectHeaderRow(aoa) {
  const scan  = Math.min(aoa.length, 25)
  const width = Math.max(1, ...aoa.slice(0, scan).map(r => (r ? r.length : 0)))
  let best = { idx: 0, score: -Infinity }

  for (let r = 0; r < scan; r++) {
    const row      = aoa[r] || []
    const cells    = row.map(c => (c == null ? '' : String(c).trim()))
    const nonEmpty = cells.filter(c => c !== '').length
    if (nonEmpty < 2) continue

    const labels   = cells.filter(_isLabelCell).length
    const uniq     = new Set(cells.filter(Boolean)).size
    const avgLen   = cells.filter(Boolean).reduce((a, c) => a + c.length, 0) / nonEmpty

    // Count populated rows shortly after this candidate.
    let below = 0
    for (let k = r + 1; k < Math.min(aoa.length, r + 8); k++) {
      const fc = (aoa[k] || []).filter(c => c != null && String(c).trim() !== '').length
      if (fc >= Math.max(2, nonEmpty * 0.5)) below++
    }
    if (below === 0) continue

    const labelRatio = labels / nonEmpty          // headers are mostly text
    const density    = nonEmpty / width           // headers span most columns
    const uniqRatio  = uniq / nonEmpty            // headers rarely repeat
    const lenPenalty = avgLen > 40 ? -1.5 : 0     // long sentences ≠ headers

    const score = labelRatio * 3 + density * 2 + uniqRatio * 1.5
                + Math.min(below, 5) * 0.2 + lenPenalty - r * 0.05
    if (score > best.score) best = { idx: r, score }
  }
  return best.idx
}

/** Clean a header array: blanks → "Column N", de-duplicate collisions. */
function cleanHeaders(arr) {
  const seen = {}
  return arr.map((h, i) => {
    let name = h == null ? '' : String(h).trim()
    if (!name) name = `Column ${i + 1}`
    if (seen[name] != null) { seen[name]++; name = `${name} (${seen[name]})` }
    else seen[name] = 0
    return name
  })
}

/**
 * Build { headers, rows, headerRow, aoa } from an array-of-arrays with robust
 * fallbacks so a sheet that clearly contains data never resolves to "empty".
 * Pass `forcedHeaderRow` to override detection (used by the header-row picker).
 */
function extractAoa(aoa, forcedHeaderRow = null) {
  if (!aoa || aoa.length === 0) return { headers: [], rows: [], headerRow: 0, aoa: [] }
  const firstPopulated = aoa.findIndex(r => (r || []).some(c => c != null && String(c).trim() !== ''))

  const build = (idx) => {
    const headers = cleanHeaders(aoa[idx] || [])
    const rows = aoa.slice(idx + 1)
      .map(r => headers.map((_, i) => r[i] ?? ''))
      .filter(r => r.some(c => c !== '' && c != null))
    return { headers, rows }
  }

  let hIdx = forcedHeaderRow != null ? forcedHeaderRow : detectHeaderRow(aoa)
  let { headers, rows } = build(hIdx)

  // Fallback 1 - detection found no data rows: use the first populated row.
  if (forcedHeaderRow == null && rows.length === 0 && firstPopulated >= 0 && firstPopulated !== hIdx) {
    hIdx = firstPopulated
    ;({ headers, rows } = build(hIdx))
  }
  // Fallback 2 - still nothing: take the densest row in the first 30 as header.
  if (forcedHeaderRow == null && rows.length === 0 && firstPopulated >= 0) {
    let densest = firstPopulated, max = -1
    for (let i = 0; i < Math.min(aoa.length, 30); i++) {
      const n = (aoa[i] || []).filter(c => c != null && String(c).trim() !== '').length
      if (n > max) { max = n; densest = i }
    }
    hIdx = densest
    ;({ headers, rows } = build(hIdx))
  }
  return { headers, rows, headerRow: hIdx, aoa }
}

function aoaFromWorksheet(XLSX, ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
}

/** Convert a worksheet → { headers, rows, headerRow, aoa } via smart detection. */
function extractTable(XLSX, ws, forcedHeaderRow = null) {
  return extractAoa(aoaFromWorksheet(XLSX, ws), forcedHeaderRow)
}

/** Sniff the delimiter of a CSV/TSV/TXT file (comma, semicolon, tab, pipe). */
function sniffDelimiter(text) {
  const line = text.split(/\r?\n/).find(l => l.trim() !== '') || ''
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 }
  for (const ch of line) if (ch in counts) counts[ch]++
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return n > 0 ? best : ','
}

/** Parse delimited text → array-of-arrays, honouring quoted fields. Robust to
 *  semicolon/tab/pipe files that the default CSV reader would collapse to 1 col. */
function parseDelimitedText(text) {
  const delim = sniffDelimiter(text)
  const aoa = []
  for (const line of text.split(/\r?\n/)) {
    if (line === '') { aoa.push([]); continue }
    const out = []; let cur = '', q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false }
        else cur += ch
      } else if (ch === '"') q = true
      else if (ch === delim) { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    aoa.push(out)
  }
  return aoa
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UploadData() {
  const { profile }      = useAuth()
  const { activeCountry }= useSettings()
  const { t }            = useLanguage()
  const navigate         = useNavigate()
  const fileRef          = useRef(null)
  const wbRef            = useRef(null)

  const [step, setStep]           = useState('idle')
  const [fileName, setFileName]   = useState('')
  const [headers, setHeaders]     = useState([])
  const [rows, setRows]           = useState([])
  const [mapping, setMapping]     = useState({})       // { canonicalKey: headerString | null }
  const [preview, setPreview]     = useState([])
  const [result, setResult]       = useState(null)
  const [error, setError]         = useState('')
  const [savedMappingId, setSavedMappingId] = useState(null)
  const [mappingSource, setMappingSource]   = useState('auto')
  const [uploadType, setUploadType] = useState('tyres')
  const [sheetOptions, setSheetOptions] = useState([])
  const [mappingScores, setMappingScores]   = useState({})  // { canonicalKey: { score, band } }
  const [rawAoa, setRawAoa]                 = useState([])   // active sheet rows → raw preview + header override
  const [headerRowIdx, setHeaderRowIdx]     = useState(0)
  const [useAI, setUseAI]                   = useState(false) // optional AI cleaning (default OFF)
  const [quality, setQuality]               = useState([])   // per-field data-quality report
  const [cleanPreview, setCleanPreview]     = useState(null) // cleaning summary shown before approve

  // Duplicate detection
  const [dupes, setDupes]         = useState([])
  const [dupCheck, setDupCheck]   = useState(null)
  const [skipIds, setSkipIds]     = useState(new Set())
  const [dupReview, setDupReview] = useState(false)
  const [progress, setProgress]   = useState({ done: 0, total: 0 })
  const [dragging, setDragging]   = useState(false)
  const [searchMapping, setSearchMapping] = useState('')
  const [synonyms, setSynonyms]   = useState([])  // permanent field synonyms from DB

  const activeFields  = uploadType === 'stock' ? STOCK_FIELDS  : TYRE_FIELDS
  const fieldsNs      = uploadType === 'stock' ? 'stock' : 'tyre'

  // Load permanent synonyms once - injected into smart mapping for 100% confidence
  useEffect(() => {
    uploads.listFieldSynonyms()
      .then(({ data }) => { if (data) setSynonyms(data) })
      .catch(() => { /* synonyms are an accuracy boost; auto-mapping still runs without them */ })
  }, [])

  // Unmapped source columns - shown in a warning strip so user sees what's being dropped
  const unmappedSource = useMemo(() => {
    const used = new Set(Object.values(mapping).filter(Boolean))
    return headers.filter(h => !used.has(h))
  }, [headers, mapping])

  // Mapping completeness
  const requiredFields  = activeFields.filter(f => f.required)
  const mappedRequired  = requiredFields.filter(f => mapping[f.key])
  const mappingComplete = mappedRequired.length === requiredFields.length

  // ── Derived views (pure engine: src/lib/uploadDataAnalytics.js) ────────────
  const [qualitySearch, setQualitySearch] = useState('')
  const [qualityIssuesOnly, setQualityIssuesOnly] = useState(false)
  const [dupFilter, setDupFilter] = useState('all')
  const summary = useMemo(
    () => fileSummary({ headers, rows, mapping, fields: activeFields, skipCount: skipIds.size }),
    [headers, rows, mapping, activeFields, skipIds],
  )
  const qualitySummary = useMemo(() => summarizeQuality(quality), [quality])
  const qualityRows = useMemo(
    () => filterQuality(quality, { search: qualitySearch, onlyIssues: qualityIssuesOnly }),
    [quality, qualitySearch, qualityIssuesOnly],
  )
  const raw = useMemo(() => rawPreviewRows(rawAoa, headerRowIdx), [rawAoa, headerRowIdx])
  const dupRows = useMemo(() => {
    const all = dupReviewRows(dupCheck, skipIds)
    return dupFilter === 'all' ? all : all.filter(r => r.action === dupFilter)
  }, [dupCheck, skipIds, dupFilter])
  const skipRows = useMemo(
    () => skipLogRows(result?.skipLog).map(r => ({ ...r, reason: r.reason === 'Not recorded' ? r.reason : toUserMessage({ message: r.reason }, 'Row could not be saved') })),
    [result],
  )
  const mappedPreviewFields = useMemo(() => activeFields.filter(f => mapping[f.key]), [activeFields, mapping])

  const rawColumns = useMemo(() => {
    const cols = [{
      id: '_row', header: 'Row', accessorFn: r => r._row, size: 110,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-[var(--text-muted)]">
          {row.original._row}
          {row.original._role === 'header' && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-green-500/15 text-green-500 text-[10px] font-semibold">Header</span>}
          {row.original._role === 'above' && <span className="ml-1.5 text-[10px]">(skipped)</span>}
        </span>
      ),
    }]
    for (let i = 0; i < raw.width; i++) {
      cols.push({
        id: `c${i}`, header: columnLetter(i), accessorFn: r => r[`c${i}`], size: 140,
        cell: ({ row }) => {
          const v = row.original[`c${i}`]
          const role = row.original._role
          return v === ''
            ? <span className="text-[var(--text-dim)]">empty</span>
            : <span className={`whitespace-nowrap ${role === 'header' ? 'text-green-500 font-semibold' : role === 'above' ? 'text-[var(--text-dim)]' : 'text-[var(--text-secondary)]'}`}>{v}</span>
        },
      })
    }
    return cols
  }, [raw.width])

  const qualityColumns = useMemo(() => [
    { id: 'field', header: 'Field', accessorFn: q => q.label, size: 200,
      cell: ({ row }) => <span className="text-[var(--text-primary)]">{row.original.label}{row.original.required && <span className="text-red-500 ml-0.5" title="Required">* <span className="sr-only">required</span></span>}</span> },
    { id: 'fill', header: 'Filled', accessorFn: q => q.fillPct, size: 90, meta: { align: 'right', exportValue: q => `${q.fillPct}%` },
      cell: ({ row }) => { const q = row.original; return <span className={q.fillPct >= 90 ? 'text-green-500' : q.fillPct >= 50 ? 'text-yellow-500' : q.required ? 'text-red-500' : 'text-[var(--text-muted)]'}>{q.fillPct}%</span> } },
    { id: 'invalid', header: 'Invalid', accessorFn: q => q.invalid, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className={row.original.invalid ? 'text-orange-500 font-semibold' : 'text-[var(--text-dim)]'}>{row.original.invalid}</span> },
    { id: 'dupes', header: 'In-file dupes', accessorFn: q => q.dupes, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className={row.original.dupes ? 'text-yellow-500 font-semibold' : 'text-[var(--text-dim)]'}>{row.original.dupes}</span> },
    { id: 'verdict', header: 'Verdict', accessorFn: q => QUALITY_LABEL[qualityVerdict(q)], size: 100,
      cell: ({ row }) => {
        const v = qualityVerdict(row.original)
        const cls = v === 'good' ? 'bg-green-500/15 text-green-500 border-green-500/30' : v === 'partial' ? 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' : 'bg-red-500/15 text-red-500 border-red-500/30'
        const Icon = v === 'good' ? CheckCircle : AlertTriangle
        return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${cls}`}><Icon size={11} aria-hidden="true" /> {QUALITY_LABEL[v]}</span>
      } },
  ], [])

  const previewColumns = useMemo(() => mappedPreviewFields.map(f => ({
    id: f.key, header: f.label, accessorFn: r => (r[f.key] == null || r[f.key] === '' ? '' : String(r[f.key])), size: 150,
    cell: ({ row }) => {
      const v = row.original[f.key]
      return v == null || v === '' ? <span className="text-[var(--text-dim)]">N/A</span> : <span className="whitespace-nowrap text-[var(--text-secondary)]">{String(v)}</span>
    },
  })), [mappedPreviewFields])

  const dupColumns = useMemo(() => [
    { id: 'fileRow', header: 'File row', accessorFn: r => r.fileRow, size: 90, meta: { align: 'right' } },
    { id: 'serial', header: 'Serial', accessorFn: r => r.serial, size: 150, cell: ({ row }) => <span className="font-mono text-[var(--text-primary)]">{row.original.serial || 'N/A'}</span> },
    { id: 'kind', header: 'Match', accessorFn: r => DUP_KIND_LABEL[r.kind], size: 170 },
    { id: 'file', header: 'In file', accessorFn: r => `${r.fileAsset} ${r.fileDate}`.trim(), size: 170, cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{row.original.fileAsset || 'N/A'} | {row.original.fileDate || 'N/A'}</span> },
    { id: 'db', header: 'In system', accessorFn: r => `${r.dbAsset} ${r.dbDate}`.trim(), size: 170, cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{row.original.dbAsset || 'N/A'} | {row.original.dbDate || 'N/A'}</span> },
    { id: 'action', header: 'Outcome', accessorFn: r => (r.action === 'drop' ? 'Exact copy: drop' : 'Changed row: import'), size: 170,
      cell: ({ row }) => row.original.action === 'drop'
        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold bg-sky-500/15 text-sky-500 border-sky-500/30"><X size={11} aria-hidden="true" /> Exact copy: drop</span>
        : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold bg-green-500/15 text-green-500 border-green-500/30"><CheckCircle size={11} aria-hidden="true" /> Changed row: import</span> },
  ], [])

  const skipColumns = useMemo(() => [
    { id: 'row', header: 'Row', accessorFn: r => r.row ?? 0, size: 80, meta: { align: 'right', exportValue: r => r.row ?? 'N/A' }, cell: ({ row }) => row.original.row ?? 'N/A' },
    { id: 'serial', header: 'Serial', accessorFn: r => r.serial, size: 160, cell: ({ row }) => <span className="font-mono">{row.original.serial || 'N/A'}</span> },
    { id: 'reason', header: 'Reason', accessorFn: r => r.reason, size: 380 },
  ], [])

  // ── File parsing ────────────────────────────────────────────────────────────

  async function applyHeaders(hdrs, dataRows, type = uploadType) {
    setHeaders(hdrs)
    setRows(dataRows)

    // Recall saved mapping fingerprint
    const fp     = fingerprintHeaders(hdrs)
    const { data: saved } = await uploads.getColumnMapping(fp)

    let finalMapping
    if (saved?.mapping) {
      // Saved mapping stores { key: headerString } - rebuild scores from that
      finalMapping = saved.mapping
      setSavedMappingId(saved.id)
      setMappingSource('memory')
      const scores = {}
      activeFields.forEach(f => {
        const h = finalMapping[f.key]
        if (h) { const { score } = scoreHeader(h, f.guesses); scores[f.key] = { score, band: confidenceBand(score) } }
        else scores[f.key] = { score: 0, band: 'none' }
      })
      setMappingScores(scores)
    } else {
      // Smart auto-mapping - inject user-defined permanent synonyms
      const sm = smartMapping(hdrs, activeFields, synonyms)
      finalMapping = {}
      const scores = {}
      Object.entries(sm).forEach(([k, v]) => { finalMapping[k] = v.header ?? undefined; scores[k] = { score: v.score, band: v.band } })
      setSavedMappingId(null)
      setMappingSource('auto')
      setMappingScores(scores)
    }

    setMapping(finalMapping)
    setStep('mapping')
  }

  // Resolve a single extracted table → mapping step (with raw preview + header
  // override). Only hard-fails when the sheet genuinely has no populated cells.
  async function loadFromExtract(tbl) {
    const hasAnyCell = (tbl.aoa || []).some(r => (r || []).some(c => c != null && String(c).trim() !== ''))
    if (!hasAnyCell) { setError(t('uploaddata.idle.noCells')); return }
    setRawAoa(tbl.aoa || [])
    setHeaderRowIdx(tbl.headerRow ?? 0)
    if (uploadType === 'auto') {
      const detected = guessFileType(tbl.headers)
      if (detected === 'fleet') { setUploadType('fleet'); return }
      setUploadType('tyres')
    }
    await applyHeaders(tbl.headers, tbl.rows)
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 50 * 1024 * 1024) {
      setError(t('uploaddata.idle.fileTooLarge'))
      return
    }
    setFileName(file.name)
    setError('')
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    const isText = ['csv', 'tsv', 'txt'].includes(ext)

    const reader = new FileReader()
    // Without this, a file that fails to read (open in Excel, too large, blocked)
    // would silently do nothing - the upload box would just sit there.
    reader.onerror = () =>
      setError(t('uploaddata.idle.readError', { fileName: file.name }))

    reader.onload = async (ev) => {
      const buf = ev.target.result

      // Delimited text (CSV/TSV/TXT, or anything that decodes to text rows).
      const tryText = async () => {
        const text = typeof buf === 'string' ? buf : new TextDecoder('utf-8').decode(buf)
        if (!text.trim()) throw new Error('no text content')
        wbRef.current = null
        await loadFromExtract(extractAoa(parseDelimitedText(text)))
      }

      // Binary workbook (xlsx/xls/xlsm/xlsb/ods). XLSX also reads CSV bytes, so
      // this doubles as a fallback for mislabelled or oddly-encoded text files.
      const tryBinary = async () => {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(buf, { type: typeof buf === 'string' ? 'binary' : 'array', cellDates: true })
        if (!wb.SheetNames?.length) throw new Error('workbook has no sheets')
        wbRef.current = wb

        const opts = wb.SheetNames.map(name => {
          const t = extractTable(XLSX, wb.Sheets[name])
          const likelyPivot = t.rows.length < 3 && t.headers.length > 15
          return { name, rows: t.rows.length, selected: t.rows.length > 0 && !likelyPivot, likelyPivot }
        })
        const withData = opts.filter(o => o.rows > 0)
        // Skip the sheet picker when only one sheet actually holds data - many
        // ERP exports carry one data tab plus title/metadata/pivot tabs.
        if (withData.length <= 1) {
          const target = withData[0]?.name ?? wb.SheetNames[0]
          await loadFromExtract(extractTable(XLSX, wb.Sheets[target]))
          return
        }
        setSheetOptions(opts)
        setStep('sheets')
      }

      try {
        // Prefer the path matching the extension, fall back to the other so a
        // .csv that is really an .xlsx (or vice-versa) still imports.
        if (isText) { try { await tryText() } catch { await tryBinary() } }
        else        { try { await tryBinary() } catch { await tryText() } }
      } catch (err) {
        setError(t('uploaddata.idle.parseError', { fileName: file.name, message: toUserMessage(err, 'unknown error') }))
      }
    }

    // Always read as ArrayBuffer - works for both binary workbooks and text
    // (TextDecoder derives the text), and lets either path act as a fallback.
    reader.readAsArrayBuffer(file)
  }

  // Re-pick the header row from the raw preview and re-map.
  async function changeHeaderRow(idx) {
    setHeaderRowIdx(idx)
    const t = extractAoa(rawAoa, idx)
    await applyHeaders(t.headers, t.rows)
  }

  // ── Row building ────────────────────────────────────────────────────────────

  function buildRows(hdrs, dataRows, map) {
    const mappedHeaders = new Set(Object.values(map).filter(Boolean))
    const unmapped = hdrs.filter(h => !mappedHeaders.has(h))

    return dataRows.map(row => {
      const obj = {}
      activeFields.forEach(f => {
        const srcCol = map[f.key]
        if (!srcCol) return
        const idx = hdrs.indexOf(srcCol)
        if (idx === -1) return
        let val = row[idx]
        if (DATE_FIELDS.has(f.key))         val = parseDate(val)
        else if (NUMERIC_FIELDS.has(f.key)) val = parseNumeric(val)
        else if (f.key === 'qty')           val = val ? +val || 1 : 1
        else if (f.key === 'position')      val = canonicalCode(val)
        else val = val !== '' && val !== null && val !== undefined ? String(val).trim() : null
        obj[f.key] = val
      })
      if (unmapped.length > 0) {
        const extras = {}
        unmapped.forEach(h => {
          const idx = hdrs.indexOf(h)
          const val = row[idx]
          if (val !== '' && val !== null && val !== undefined) extras[h] = String(val).trim()
        })
        if (Object.keys(extras).length > 0) obj.extra_fields = extras
      }
      return obj
    })
  }

  // ── Preview + duplicate check ───────────────────────────────────────────────

  async function buildPreview() {
    setError('')
    try {
    const built = buildRows(headers, rows, mapping)
    setPreview(built.slice(0, PREVIEW_ROWS))
    setSkipIds(new Set())
    setDupCheck(null)

    // ── Data-quality report (across the whole file) ──────────────────────────
    const total = built.length || 1
    const q = activeFields.filter(f => mapping[f.key]).map(f => {
      const filled = built.filter(r => r[f.key] != null && r[f.key] !== '').length
      let invalid = 0
      if (DATE_FIELDS.has(f.key) || NUMERIC_FIELDS.has(f.key)) {
        const idx = headers.indexOf(mapping[f.key])
        if (idx >= 0) rows.forEach(r => {
          const raw = r[idx]
          const has = raw != null && String(raw).trim() !== ''
          const parsed = DATE_FIELDS.has(f.key) ? parseDate(raw) : parseNumeric(raw)
          if (has && parsed == null) invalid++
        })
      }
      let dupes = 0
      if (f.key === 'serial_no') {
        const counts = {}
        built.forEach(r => { if (r.serial_no) counts[r.serial_no] = (counts[r.serial_no] || 0) + 1 })
        dupes = Object.values(counts).filter(n => n > 1).reduce((a, n) => a + (n - 1), 0)
      }
      return { key: f.key, label: t(`uploaddata.fields.${fieldsNs}.${f.key}`), required: !!f.required, fillPct: Math.round((filled / total) * 100), invalid, dupes }
    })
    setQuality(q)

    // ── Cleaning preview (rule-based, sampled) ───────────────────────────────
    if (uploadType === 'tyres') {
      const sample = batchClassify(built.slice(0, 2000).map((r, i) => ({ id: i, description: r.description, remarks: r.remarks })))
      const auto = sample.filter(c => c.confidence !== 'Low').length
      const examples = sample.slice(0, 4).map((c, i) => ({
        text: [built[i]?.description, built[i]?.remarks].filter(Boolean).join(' · ').slice(0, 60) || '-',
        category: c.category, risk: c.risk_level, conf: c.confidence,
      }))
      setCleanPreview({ total: sample.length, auto, review: sample.length - auto, examples })
    } else {
      setCleanPreview(null)
    }

    const serials = [...new Set(built.map(r => r.serial_no).filter(Boolean))]
    if (serials.length > 0 && uploadType === 'tyres') {
      const BATCH = 500
      const existing = []
      for (let i = 0; i < serials.length; i += BATCH) {
        const { data } = await uploads.listExistingSerials(serials.slice(i, i + BATCH))
        existing.push(...(data ?? []))
      }
      const existingSet = new Set(existing.map(r => r.serial_no))
      setDupes([...existingSet])

      if (existing.length > 0) {
        const bySerial = new Map()
        existing.forEach((e) => {
          const key = String(e.serial_no || '').trim().toLowerCase()
          if (!bySerial.has(key)) bySerial.set(key, [])
          bySerial.get(key).push(e)
        })
        const exactDups = [], changed = [], conflicts = []
        built.forEach((row, idx) => {
          if (!row.serial_no) return
          const matches = bySerial.get(String(row.serial_no).trim().toLowerCase()) || []
          if (!matches.length) return
          const exact = matches.find((match) => isExactSuppliedRow(row, match))
          if (exact) { exactDups.push({ idx, row, existing: exact }); return }
          const sameFitment = matches.find((match) => (
            duplicateComparable(match.asset_no) === duplicateComparable(row.asset_no)
            && duplicateComparable(match.issue_date) === duplicateComparable(row.issue_date)
          ))
          if (sameFitment) changed.push({ idx, row, existing: sameFitment })
          else conflicts.push({ idx, row, existing: matches[0] })
        })
        const reupload = serials.length > 5 && exactDups.length / serials.length > 0.7
        setSkipIds(new Set(exactDups.map((d) => d.idx)))
        if (exactDups.length > 0 || changed.length > 0 || conflicts.length > 0 || reupload) {
          setDupCheck({ exact: exactDups, changed, conflicts, reupload })
        }
      }
    } else {
      setDupes([])
    }

    setStep('preview')
    } catch (err) {
      console.error('[UploadData] buildPreview failed:', err)
      setError(t('uploaddata.preview.buildError', { message: toUserMessage(err, 'unknown error') }))
    }
  }

  // ── Optional AI cleaning of low-confidence rows (off by default) ────────────
  // Routes the rule-based "need review" rows through the secure chat-ai edge
  // function (server-side Anthropic key). Bounded + chunked; on any failure the
  // rule-based result is kept. Never writes unknown columns to tyre_records.
  async function aiRefineLowConfidence(records) {
    const targets = []
    records.forEach((r, i) => { if (!r.cleaned) targets.push(i) })
    const slice = targets.slice(0, 200)        // cost cap
    const CHUNK = 25
    for (let i = 0; i < slice.length; i += CHUNK) {
      const idxs = slice.slice(i, i + CHUNK)
      const items = idxs.map((idx, j) => ({
        i: j,
        text: [records[idx].description, records[idx].remarks].filter(Boolean).join(' | ').slice(0, 180),
      })).filter(it => it.text)
      if (items.length === 0) continue
      try {
        const { data, error } = await uploads.invokeChatAI({
          system: 'You are a tyre maintenance data classifier. Reply with ONLY a JSON array, no prose.',
          user: `For each record return {"i":<index>,"category":<short tyre issue category>,"risk_level":<one of Low|Medium|High|Critical>}. Records:\n${JSON.stringify(items)}`,
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
        })
        if (error || !data?.content) continue
        const m = String(data.content).match(/\[[\s\S]*\]/)
        if (!m) continue
        JSON.parse(m[0]).forEach(a => {
          const idx = idxs[a.i]
          if (idx == null) return
          records[idx] = {
            ...records[idx],
            category:   a.category   || records[idx].category,
            risk_level: a.risk_level || records[idx].risk_level,
            cleaned:    true,
          }
        })
      } catch { /* keep rule-based result for this chunk */ }
    }
    return records
  }

  // ── Save column mapping ─────────────────────────────────────────────────────

  async function saveColumnMapping(fp) {
    const plain = {}
    Object.entries(mapping).forEach(([k, v]) => { if (v) plain[k] = v })
    if (savedMappingId) {
      await uploads.updateColumnMapping(savedMappingId, { mapping: plain, last_used_at: new Date().toISOString() })
    } else {
      await uploads.upsertColumnMapping({ fingerprint: fp, mapping: plain, file_name: fileName, confirmed_by: profile?.id, use_count: 1, last_used_at: new Date().toISOString() })
    }
  }

  // ── Upload ──────────────────────────────────────────────────────────────────

  // Non-admin uploads are staged for admin approval instead of going live.
  const isAdminUploader = profile?.role === 'Admin'
  async function submitForApproval({ batchId, country, uploadType, targetTable, rows: shapedRows }) {
    return uploads.insertPendingUpload({
      batch_id:      batchId,
      uploaded_by:   profile?.id,
      uploader_name: profile?.full_name || profile?.username || null,
      country,
      upload_type:   uploadType,
      target_table:  targetTable,
      file_name:     fileName,
      row_count:     shapedRows.length,
      rows:          shapedRows,
      status:        'pending',
    })
  }

  async function upload() {
    // Country is authoritative from the top-bar selection. Every uploaded row is
    // stamped with this one country, so a file can never mix countries or land in
    // the wrong one. A specific country must be selected (not "All").
    if (activeCountry === 'All') {
      setError(t('uploaddata.preview.countrySelectError'))
      return
    }
    const uploadCountry = activeCountry

    setStep('uploading')
    setProgress({ done: 0, total: rows.length })
    const batchId = crypto.randomUUID()

    if (uploadType === 'stock') {
      const finalRows = buildRows(headers, rows, mapping)
      const stockRows = finalRows.map(row => ({
        item_code:   row.item_code   || null,
        description: row.description || null,
        brand:       row.brand       || null,
        category:    row.category    || null,
        qty:         parseFloat(row.qty)         || 0,
        unit_cost:   parseFloat(row.unit_cost)   || 0,
        site:        row.site     || uploadCountry || null,
        country:     uploadCountry,
        location:    row.location || null,
        min_level:   parseFloat(row.min_level)   || 0,
        reorder_qty: parseFloat(row.reorder_qty) || 0,
        supplier:    row.supplier || null,
        notes:       row.notes    || null,
      }))
      if (!isAdminUploader) {
        const { error: pErr } = await submitForApproval({ batchId, country: uploadCountry, uploadType: 'stock', targetTable: 'stock_records', rows: stockRows })
        if (pErr) { setError(t('uploaddata.errors.approvalError', { message: toUserMessage(pErr, 'unknown error') })); setStep('preview'); return }
        setResult({ pending: true, sourceRows: rows.length, submitted: stockRows.length, added: 0, autoClassifiedCount: 0, needsReviewCount: 0, dupesSkipped: 0, skipped: 0, skipLog: [] })
        setStep('done')
        return
      }
      const CHUNK = 500
      let added = 0, stockSkipped = 0
      const stockSkipLog = []
      for (let i = 0; i < stockRows.length; i += CHUNK) {
        const chunk = stockRows.slice(i, i + CHUNK)
        const { error: err } = await uploads.insertStockRecords(chunk)
        if (!err) { added += chunk.length }
        else {
          // Retry row-by-row so one bad row never silently drops the whole chunk.
          for (let j = 0; j < chunk.length; j++) {
            const { error: rowErr } = await uploads.insertStockRecords(chunk[j])
            if (rowErr) { stockSkipped += 1; stockSkipLog.push({ row: i + j + 1, description: chunk[j].description ?? null, error: rowErr.message }) }
            else added += 1
          }
        }
        setProgress({ done: Math.min(i + CHUNK, stockRows.length), total: stockRows.length })
      }
      await logAuditEvent({ action: 'upload_stock', table_name: 'stock_records', record_count: added, details: { file: fileName, batch_id: batchId } })
      setResult({ sourceRows: rows.length, attempted: stockRows.length, added, autoClassifiedCount: 0, needsReviewCount: 0, dupesSkipped: 0, skipped: stockSkipped, skipLog: stockSkipLog })
      setStep('done')
      return
    }

    await saveColumnMapping(fingerprintHeaders(headers))

    // Trim strings and enforce field length caps to match DB constraints
    function sanitiseRow(r) {
      const cap = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : v)
      return {
        ...r,
        serial_no:  cap(r.serial_no,  100),
        asset_no:   cap(r.asset_no,   50),
        position:   cap(r.position,   50),
        brand:      cap(r.brand,      100),
        size:       cap(r.size,       50),
        site:       cap(r.site,       200),
        remarks:    cap(r.remarks,    5000),
        country:    cap(r.country,    10),
        // Clamp numeric ranges to match DB constraints
        tread_depth:      (r.tread_depth      != null && r.tread_depth      >= 0 && r.tread_depth      <= 50)  ? r.tread_depth      : null,
        pressure_reading: (r.pressure_reading != null && r.pressure_reading >= 0 && r.pressure_reading <= 300) ? r.pressure_reading : null,
        cost_per_tyre:    (r.cost_per_tyre    != null && r.cost_per_tyre    >= 0 && r.cost_per_tyre    <= 1e6) ? r.cost_per_tyre    : null,
        // Cap extra_fields to 50 keys
        extra_fields: r.extra_fields
          ? Object.fromEntries(Object.entries(r.extra_fields).slice(0, 50))
          : null,
      }
    }

    let records = buildRows(headers, rows, mapping).map(r => {
      // ERP cost derivation: when the file's cost column is the line TOTAL
      // (qty already included), derive the true per-tyre price so downstream
      // spend maths (unit × qty) never double-counts. total_amount is not a DB
      // column — always dropped after derivation.
      const row = { ...r }
      if (row.cost_per_tyre != null && row.cost_per_tyre !== '') {
        const u = parseFloat(row.cost_per_tyre)
        row.cost_per_tyre = Number.isFinite(u) ? u : null
      }
      const total = parseFloat(row.total_amount)
      if (Number.isFinite(total)) {
        if (row.cost_per_tyre == null || row.cost_per_tyre === '') {
          const q = Number(row.qty) > 0 ? Number(row.qty) : 1
          row.cost_per_tyre = Math.round((total / q) * 100) / 100
        }
        delete row.total_amount
      } else {
        delete row.total_amount
      }
      return sanitiseRow({
        ...row,
        // Force the selected country onto every row - ignore any country column in
        // the file so an upload can never mix or mislabel countries.
        country:         uploadCountry,
        region:          profile?.region ?? uploadCountry,
        uploaded_by:     profile?.id,
        upload_batch_id: batchId,
      })
    })
    const sourceRows = rows.length

    if (skipIds.size > 0) records = records.filter((_, idx) => !skipIds.has(idx))
    const classified  = batchClassify(records.map((r, i) => ({ id: i, description: r.description, remarks: r.remarks })))
    const classMap    = Object.fromEntries(classified.map(c => [c.id, c]))
    const classifyLog = []
    records = records.map((r, i) => {
      const c = classMap[i]
      const auto = c && c.confidence !== 'Low'
      if (auto) classifyLog.push({ original_text: [r.description, r.remarks].filter(Boolean).join(' | '), cleaned_text: c.remarks_cleaned, category: c.category, confidence: c.confidence, cleaned_by_model: 'rule-based-v1' })
      return { ...r, category: c?.category ?? null, risk_level: c?.risk_level ?? null, remarks_cleaned: c?.remarks_cleaned ?? null, cleaned: auto }
    })

    // Optional AI pass to refine low-confidence rows (opt-in).
    if (useAI) records = await aiRefineLowConfidence(records)

    const autoClassifiedCount = records.filter(r => r.cleaned).length
    const needsReviewCount    = records.length - autoClassifiedCount

    // Non-admins: stage the fully-prepared rows for admin approval, don't go live.
    if (!isAdminUploader) {
      const { error: pErr } = await submitForApproval({ batchId, country: uploadCountry, uploadType: 'tyres', targetTable: 'tyre_records', rows: records })
      if (pErr) { setError(t('uploaddata.errors.approvalError', { message: toUserMessage(pErr, 'unknown error') })); setStep('preview'); return }
      setResult({ pending: true, sourceRows, submitted: records.length, added: 0, skipped: 0, skipLog: [], autoClassifiedCount, needsReviewCount, dupesSkipped: skipIds.size, extraColCount: unmappedSource.length })
      setStep('done')
      return
    }

    const BATCH = 500
    let added = 0, skipped = 0
    const skipLog = []
    const insertedIds = []

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH)
      const { data, error: err } = await uploads.insertTyreRecords(batch)
      if (!err) {
        added += (data ?? []).length; insertedIds.push(...(data ?? []).map(r => r.id))
      } else {
        // A bulk insert fails entirely if ONE row violates a constraint (bad
        // date, out-of-range number, etc.). Retry the batch row-by-row so the
        // good rows still land and only the genuinely-invalid rows are skipped
        // and logged with their exact reason - no more "whole batch failed".
        for (let j = 0; j < batch.length; j++) {
          const { data: one, error: rowErr } = await uploads.insertTyreRecords(batch[j])
          if (rowErr) { skipped += 1; skipLog.push({ row: i + j + 1, serial_no: batch[j].serial_no ?? null, error: rowErr.message }) }
          else { added += 1; insertedIds.push(...(one ?? []).map(r => r.id)) }
        }
      }
      setProgress({ done: Math.min(i + BATCH, records.length), total: records.length })
    }

    if (classifyLog.length > 0) await uploads.insertCleaningLog(classifyLog.map((entry, i) => ({ ...entry, tyre_record_id: insertedIds[i] ?? null })))

    await uploads.insertUploadHistory({ file_names: [fileName], records_added: added, records_skipped: skipped + skipIds.size, skip_log: skipLog, mapping_used: mapping, region: profile?.region ?? uploadCountry, country: uploadCountry, uploaded_by: profile?.id, batch_id: batchId })
    await logAuditEvent({ action: 'UPLOAD', tableName: 'tyre_records', recordCount: added, details: { filename: fileName, rowCount: added, skippedCount: skipped + skipIds.size, country: activeCountry, batch_id: batchId } })

    // Bump use_count on any synonyms that were exercised in this upload
    const usedHeaders = new Set(Object.values(mapping).filter(Boolean).map(h => normalise(h)))
    const hitSynonyms = synonyms.filter(s => usedHeaders.has(normalise(s.custom_name)))
    if (hitSynonyms.length > 0) {
      await Promise.all(hitSynonyms.map(s =>
        uploads.updateFieldSynonym(s.custom_name, { use_count: s.use_count + 1, last_used_at: new Date().toISOString() })
      ))
    }

    // Count unmapped columns saved as extra_fields
    const extraColCount = unmappedSource.length
    setResult({ sourceRows, attempted: records.length, added, skipped, skipLog, autoClassifiedCount, needsReviewCount, dupesSkipped: skipIds.size, extraColCount })
    setStep('done')
  }

  function reset() {
    setStep('idle'); setFileName(''); setHeaders([]); setRows([])
    setMapping({}); setMappingScores({}); setPreview([]); setResult(null); setError('')
    setSavedMappingId(null); setMappingSource('auto'); setDupes([])
    setDupCheck(null); setSkipIds(new Set()); setDupReview(false)
    setUploadType('tyres'); setSheetOptions([]); setSearchMapping('')
    setRawAoa([]); setHeaderRowIdx(0); setUseAI(false); setQuality([]); setCleanPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    handleFile({ target: { files: [file] } })
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('uploaddata.title')}
        subtitle={t('uploaddata.subtitle')}
        icon={Upload}
        actions={
          <button
            onClick={() => navigate('/data-intake?module=tyre')}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Database size={15} /> {t('uploaddata.importDataIntake')}
          </button>
        }
      />
      <p className="text-xs text-[var(--panel-ink-4)] -mt-2 mb-1">
        {t('uploaddata.banner.prefix')}{' '}
        <button
          type="button"
          onClick={() => navigate('/data-intake?module=tyre')}
          className="text-green-500 hover:text-green-500 underline underline-offset-2"
        >
          {t('uploaddata.banner.link')}
        </button>{' '}
        {t('uploaddata.banner.suffix')}
      </p>
      <StepBar current={step} />

      {(step === 'mapping' || step === 'preview') && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" aria-label="File summary">
          <StatTile label="Rows in file" value={summary.rows.toLocaleString()} icon={Table2} />
          <StatTile label="Columns detected" value={summary.columns.toLocaleString()} sub={summary.unmapped ? `${summary.unmapped} kept as custom data` : 'All mapped'} icon={Layers} />
          <StatTile label="Required mapped" value={`${summary.requiredMapped} / ${summary.requiredTotal}`} tone={summary.complete ? 'accent' : 'warn'} icon={summary.complete ? CheckCircle : AlertTriangle} />
          <StatTile label="Fields mapped" value={`${summary.mappedFields} / ${summary.totalFields}`} icon={Table2} />
          <StatTile label="Quality issues" value={step === 'preview' && quality.length ? qualitySummary.issues : 'N/A'} sub={step === 'preview' && quality.length ? `${qualitySummary.invalid} invalid, ${qualitySummary.dupes} in-file dupes` : 'Shown after preview'} tone={qualitySummary.issues ? 'warn' : 'neutral'} icon={Database} />
          <StatTile label="Rows to upload" value={step === 'preview' ? summary.toUpload.toLocaleString() : 'N/A'} sub={step === 'preview' && skipIds.size ? `${skipIds.size} exact copies dropped` : undefined} tone="accent" icon={Rocket} />
        </div>
      )}

      <AnimatePresence mode="wait">

        {/* ── Idle ── */}
        {step === 'idle' && (
          <motion.div key="idle" initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-10 }} transition={{ duration:0.25 }}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {[
                { val: 'tyres', label: t('uploaddata.idle.types.tyres.label'), desc: t('uploaddata.idle.types.tyres.desc'), icon: FileSpreadsheet, color: 'green' },
                { val: 'fleet', label: t('uploaddata.idle.types.fleet.label'), desc: t('uploaddata.idle.types.fleet.desc'), icon: Package,         color: 'blue' },
                { val: 'stock', label: t('uploaddata.idle.types.stock.label'), desc: t('uploaddata.idle.types.stock.desc'), icon: Layers,          color: 'purple' },
                { val: 'auto',  label: t('uploaddata.idle.types.auto.label'),  desc: t('uploaddata.idle.types.auto.desc'),  icon: Wand2,           color: 'yellow' },
              ].map(opt => {
                const Icon = opt.icon
                const active = uploadType === opt.val
                const colorMap = {
                  green:  { border: 'rgba(22,163,74,0.5)',  bg: 'rgba(22,163,74,0.1)',  text: 'text-green-500',  icon: 'text-green-500' },
                  blue:   { border: 'rgba(59,130,246,0.5)', bg: 'rgba(59,130,246,0.1)', text: 'text-blue-500',   icon: 'text-blue-500' },
                  purple: { border: 'rgba(168,85,247,0.5)', bg: 'rgba(168,85,247,0.1)', text: 'text-purple-500', icon: 'text-purple-500' },
                  yellow: { border: 'rgba(234,179,8,0.5)',  bg: 'rgba(234,179,8,0.08)', text: 'text-yellow-500', icon: 'text-yellow-500' },
                }
                const c = colorMap[opt.color]
                return (
                  // The active tint stays in `style`, never in className: Card
                  // sets background/border/box-shadow INLINE, so a `bg-*` or
                  // `border-*` class here would be dead. `style` spreads last
                  // inside Card, so these four types keep their own colour.
                  <Card
                    as={motion.button}
                    key={opt.val}
                    interactive
                    onClick={() => setUploadType(opt.val)}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    className="text-left transition-all duration-150"
                    style={active ? { borderColor: c.border, background: c.bg, boxShadow: `0 0 20px ${c.border}` } : {}}
                  >
                    <Icon size={22} className={`mb-2 ${active ? c.icon : 'text-[var(--text-dim)]'}`} />
                    <p className={`text-sm font-semibold ${active ? c.text : 'text-[var(--panel-ink-2)]'}`}>{opt.label}</p>
                    <p className="text-xs text-[var(--panel-ink-4)] mt-0.5 leading-snug">{opt.desc}</p>
                  </Card>
                )
              })}
            </div>

            {uploadType === 'fleet' ? (
              // `border-yellow-500/40 bg-yellow-500/10` would be DEAD here -
              // Card sets border and background inline. `tone="warn"` is the
              // sanctioned route to the amber edge this banner needs.
              <Card as={motion.div} tone="warn" initial={{ opacity:0, scale:0.98 }} animate={{ opacity:1, scale:1 }} className="mb-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-yellow-500">{t('uploaddata.idle.fleetBanner.title')}</p>
                    <p className="text-sm text-[var(--panel-ink-3)] mt-1">{t('uploaddata.idle.fleetBanner.desc')}</p>
                    <a href="/fleet-master" className="inline-block mt-2 text-sm text-green-500 underline hover:text-green-500">{t('uploaddata.idle.fleetBanner.link')}</a>
                  </div>
                </div>
              </Card>
            ) : (
              <>
                {/* Accepted columns reference. `border-green-900/40 bg-green-500/10`
                    would be dead on a Card; `tone="good"` carries the green edge. */}
                <Card tone="good" className="mb-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Info size={15} className="text-green-500" />
                    <span className="text-sm font-semibold text-green-500">Your columns don't need to match exactly</span>
                  </div>
                  <p className="text-xs text-[var(--panel-ink-3)] mb-3">
                    The smart mapping engine recognises hundreds of column name variations, abbreviations, and Arabic headers.
                    Use any naming convention. The engine will match automatically. You can adjust any mapping before uploading.
                  </p>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                    {(uploadType === 'stock' ? STOCK_FIELDS : TYRE_FIELDS).filter(f => f.required).map(f => (
                      <div key={f.key} className="flex items-start gap-1.5">
                        <CheckCircle size={12} className="text-green-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
                        <div>
                          <span className="text-xs font-semibold text-[var(--panel-ink-2)]">{f.label}</span>
                          <p className="text-xs text-[var(--text-dim)] leading-tight">{f.guesses.slice(0,3).join(', ')}...</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <motion.div
                  className="relative overflow-hidden rounded-2xl cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  style={{ border: `2px dashed ${dragging ? 'rgba(22,163,74,0.7)' : 'var(--border-bright)'}`, background: dragging ? 'rgba(22,163,74,0.07)' : 'var(--surface-1)', boxShadow: dragging ? '0 0 40px rgba(22,163,74,0.2)' : 'none' }}
                  role="button"
                  tabIndex={0}
                  aria-label="Choose an Excel or CSV file to upload"
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  whileHover={{ borderColor: 'rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.04)' }}
                >
                  <div className="py-12 sm:py-20 px-4 flex flex-col items-center justify-center gap-4">
                    <motion.div animate={dragging ? { scale: 1.15, rotate: [-5, 5, -5, 0] } : { scale: 1, rotate: 0 }} transition={{ duration: 0.3 }}
                      className="w-20 h-20 rounded-2xl flex items-center justify-center"
                      style={{ background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.3)', boxShadow: '0 0 30px rgba(22,163,74,0.15)' }}>
                      <Upload size={36} className="text-green-500" />
                    </motion.div>
                    <div className="text-center">
                      <p className="text-xl font-semibold text-[var(--text-primary)] mb-1">{dragging ? 'Drop to upload' : 'Drop your Excel or CSV file here'}</p>
                      <p className="text-[var(--panel-ink-4)] text-sm">or click to browse · Excel, OpenDocument, CSV/TSV supported</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[var(--text-dim)] flex-wrap justify-center">
                      {['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv', '.tsv', '.txt'].map(x => (
                        <span key={x} className="px-2 py-1 bg-[var(--surface-2)] rounded">{x}</span>
                      ))}
                    </div>
                  </div>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt" className="hidden" tabIndex={-1} aria-hidden="true" onChange={handleFile} />
                  {error && <p role="alert" className="text-red-500 text-sm text-center pb-4 px-4">{error}</p>}
                </motion.div>
              </>
            )}
          </motion.div>
        )}

        {/* ── Sheets picker ── */}
        {step === 'sheets' && (
          <Card className="space-y-4">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Select Sheets to Import</h2>
            <p className="text-sm text-[var(--panel-ink-3)]">This workbook has {sheetOptions.length} sheets. Choose which to include. Pivot and summary sheets are suggested to skip.</p>
            <div className="space-y-2">
              {sheetOptions.map((s, i) => (
                <label key={s.name} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${s.selected ? 'border-green-500/40 bg-green-500/10' : 'border-[var(--border-bright)] bg-[var(--surface-2)]'}`}>
                  <input type="checkbox" checked={s.selected}
                    onChange={() => setSheetOptions(prev => prev.map((x, j) => j === i ? {...x, selected: !x.selected} : x))}
                    className="accent-green-500" />
                  <span className="text-[var(--text-primary)] text-sm font-medium flex-1">{s.name}</span>
                  {s.likelyPivot && <span className="text-xs text-yellow-500">looks like a pivot</span>}
                  <span className="text-xs text-[var(--panel-ink-4)]">{s.rows} rows</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button disabled={!sheetOptions.some(s => s.selected)}
                onClick={async () => {
                  const XLSX = await import('xlsx')
                  const wb = wbRef.current
                  // Smart header detection per sheet, then unify into one header set.
                  const tables = sheetOptions.filter(s => s.selected).map(s => extractTable(XLSX, wb.Sheets[s.name]))
                  const hdrs = []
                  tables.forEach(t => t.headers.forEach(h => { if (!hdrs.includes(h)) hdrs.push(h) }))
                  const dataRows = []
                  tables.forEach(t => {
                    const idxOf = hdrs.map(h => t.headers.indexOf(h))
                    t.rows.forEach(r => dataRows.push(idxOf.map(i => (i === -1 ? '' : r[i] ?? ''))))
                  })
                  if (uploadType === 'auto') setUploadType(guessFileType(hdrs) !== 'unknown' ? guessFileType(hdrs) : 'tyres')
                  await applyHeaders(hdrs, dataRows)
                }}
                className="btn-primary disabled:opacity-40">
                Import {sheetOptions.filter(s => s.selected).reduce((a, s) => a + s.rows, 0)} rows <ChevronRight size={14} className="inline" aria-hidden="true" />
              </button>
              <button onClick={reset} className="btn-secondary">Cancel</button>
            </div>
          </Card>
        )}

        {/* ── Mapping ── */}
        {step === 'mapping' && (
          <div className="space-y-4">
            {/* Header row */}
            <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--panel-ink-3)]">
              <FileSpreadsheet size={16} className="text-blue-500" />
              <span className="font-medium text-[var(--panel-ink-2)]">{fileName}</span>
              <span>· {rows.length.toLocaleString()} rows · {headers.length} columns detected</span>
              {mappingSource === 'memory' && (
                <span className="badge bg-green-500/15 text-green-500 border border-green-500/40 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full">
                  <BookOpen size={11} /> Recalled from memory
                </span>
              )}
              {mappingSource === 'auto' && (
                <span className="badge bg-blue-500/15 text-blue-500 border border-blue-500/40 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full">
                  <Zap size={11} /> Smart auto-mapped
                </span>
              )}
            </div>

            {/* Raw file preview + header-row override - see exactly what was read */}
            {rawAoa.length > 0 && (
              // Header stays hand-rolled: CardHeader's actions slot is
              // flex-shrink-0 and cannot wrap, and the header-row <select>
              // sizes to its widest option, so on a phone it would widen the
              // card instead of dropping onto a second line as it does here.
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">File Preview</h2>
                    <p className="text-xs text-[var(--panel-ink-4)] mt-0.5">If the wrong row was detected as the header, pick the correct one. The table re-maps instantly.</p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[var(--panel-ink-3)]">
                    Header row:
                    <select
                      className="input text-xs py-1 min-h-[40px] max-w-[70vw]"
                      value={headerRowIdx}
                      onChange={e => changeHeaderRow(Number(e.target.value))}
                    >
                      {rawAoa.slice(0, 15).map((r, i) => {
                        const label = (r || []).filter(c => c != null && String(c).trim() !== '').slice(0, 4).join(' | ').slice(0, 50)
                        return <option key={i} value={i}>Row {i + 1}{label ? `: ${label}` : ' (empty)'}</option>
                      })}
                    </select>
                  </label>
                </div>
                <EnterpriseTable
                  columns={rawColumns}
                  data={raw.rows}
                  getRowId={r => String(r._row)}
                  enableGlobalFilter={false}
                  enableColumnFilters={false}
                  enableSorting={false}
                  enableExport={false}
                  enableColumnVisibility={false}
                  stickyFirstColumn
                  initialPageSize={25}
                  pageSizeOptions={[25]}
                  emptyMessage="This sheet has no rows to preview."
                />
                <p className="text-xs text-[var(--panel-ink-4)] mt-2">First {raw.rows.length} sheet rows and up to 12 columns, as read. The highlighted row is used as the header; rows above it are skipped.</p>
                {rows.length === 0 && (
                  <p className="text-xs text-yellow-500 mt-2">No data rows detected below the current header row. Try selecting a different header row above.</p>
                )}
              </Card>
            )}

            {/* Completeness indicator */}
            <div className={`rounded-xl px-4 py-3 flex items-center gap-3 border ${
              mappingComplete
                ? 'bg-green-500/10 border-green-500/40'
                : 'bg-yellow-500/10 border-yellow-500/40'
            }`}>
              {mappingComplete
                ? <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
                : <AlertTriangle size={16} className="text-yellow-500 flex-shrink-0" />
              }
              <p className={`text-sm ${mappingComplete ? 'text-green-500' : 'text-yellow-500'}`}>
                {mappingComplete
                  ? `All ${requiredFields.length} required fields are mapped. You can proceed to preview.`
                  : `${mappedRequired.length}/${requiredFields.length} required fields mapped. Map the remaining fields before uploading.`
                }
              </p>
            </div>

            {/* Unmapped source columns warning */}
            {unmappedSource.length > 0 && (
              <div className="bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-[var(--panel-ink-3)] mb-1.5">
                  {unmappedSource.length} column{unmappedSource.length !== 1 ? 's' : ''} from your file are not mapped to any field - they will be saved in <code className="text-[var(--panel-ink-2)]">extra_fields</code> and not lost:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {unmappedSource.map(h => (
                    <span key={h} className="text-xs bg-[var(--surface-3)] text-[var(--panel-ink-2)] px-2 py-0.5 rounded-full">{h}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Header stays hand-rolled for the same reason as the File
                Preview card: the filter box must be free to wrap. */}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">Column Mapping</h2>
                  <p className="text-xs text-[var(--panel-ink-4)] mt-0.5">Match your file's columns to the system fields. Confidence shown by colour.</p>
                </div>
                {/* Search */}
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--panel-ink-4)]" />
                  <input
                    className="input text-xs pl-7 py-1.5 w-36 min-h-[40px]"
                    type="search"
                    aria-label="Filter mapping fields"
                    placeholder="Filter fields..."
                    value={searchMapping}
                    onChange={e => setSearchMapping(e.target.value)}
                  />
                </div>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-[var(--panel-ink-4)]">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Exact / High match</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Medium match</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> No match: please select</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--text-dim)] inline-block" /> Optional / Skipped</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeFields
                  .filter(f => !searchMapping || f.label.toLowerCase().includes(searchMapping.toLowerCase()) || f.key.includes(searchMapping.toLowerCase()))
                  .map(field => {
                  const sc = mappingScores[field.key] ?? { score: 0, band: 'none' }
                  const hasMapping = !!mapping[field.key]
                  const borderColor = hasMapping
                    ? sc.band === 'exact' || sc.band === 'high'   ? 'border-green-500/40'
                    : sc.band === 'medium'                         ? 'border-yellow-500/40'
                    :                                               'border-orange-500/40'
                    : field.required                               ? 'border-red-500/40'
                    :                                               'border-[var(--border-bright)]'
                  const dotColor = hasMapping
                    ? sc.band === 'exact' || sc.band === 'high'   ? 'bg-green-500'
                    : sc.band === 'medium'                         ? 'bg-yellow-500'
                    :                                               'bg-orange-500'
                    : field.required                               ? 'bg-red-600'
                    :                                               'bg-[var(--text-dim)]'

                  return (
                    <div key={field.key} className={`rounded-lg border p-3 transition-all ${borderColor}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                        <label htmlFor={`map-${field.key}`} className="text-xs font-semibold text-[var(--panel-ink-2)]">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        {sc.band !== 'none' && hasMapping && (
                          <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${
                            sc.band === 'exact' || sc.band === 'high' ? 'bg-green-500/15 text-green-500' :
                            sc.band === 'medium' ? 'bg-yellow-500/15 text-yellow-500' : 'bg-orange-500/15 text-orange-500'
                          }`}>
                            {sc.score}% match
                          </span>
                        )}
                      </div>
                      <select
                        id={`map-${field.key}`}
                        className="input text-xs w-full min-h-[40px]"
                        value={mapping[field.key] ?? ''}
                        onChange={e => {
                          const val = e.target.value || undefined
                          setMapping(m => ({ ...m, [field.key]: val }))
                          if (val) {
                            const { score } = scoreHeader(val, field.guesses)
                            setMappingScores(s => ({ ...s, [field.key]: { score, band: confidenceBand(score) } }))
                          } else {
                            setMappingScores(s => ({ ...s, [field.key]: { score: 0, band: 'none' } }))
                          }
                        }}
                      >
                        <option value="">(skip this field)</option>
                        {headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  )
                })}
              </div>

              <div className="flex gap-3 mt-5">
                <button
                  onClick={buildPreview}
                  disabled={!mappingComplete}
                  className="btn-primary disabled:opacity-40 flex items-center gap-2"
                >
                  <Eye size={15} /> Preview & Check Duplicates
                </button>
                <button onClick={reset} className="btn-secondary">Cancel</button>
              </div>
            </Card>
          </div>
        )}

        {/* ── Preview ── */}
        {step === 'preview' && (
          <div className="space-y-4">
            {/* Smart dup check */}
            {dupCheck && (
              // `border-yellow-600/40` would be dead on a Card. This is the
              // re-import warning, so the amber edge is not decoration -
              // `tone="warn"` keeps it.
              <Card tone="warn">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={18} className="text-yellow-500" />
                  <span className="font-semibold text-yellow-500">Exact Copy Check</span>
                </div>
                {dupCheck.reupload && <p className="text-yellow-500 text-sm mb-2">This file closely matches a previous upload. It will still proceed through exact-row verification.</p>}
                <div className="flex gap-4 text-sm mb-3">
                  {dupCheck.exact.length > 0 && <span className="text-sky-500">{dupCheck.exact.length} exact duplicate{dupCheck.exact.length !== 1 ? 's' : ''} to drop</span>}
                  {(dupCheck.changed?.length || 0) > 0 && <span className="text-green-500">{dupCheck.changed.length} changed same-fitment row{dupCheck.changed.length !== 1 ? 's' : ''} to import</span>}
                  {dupCheck.conflicts.length > 0 && <span className="text-orange-500">{dupCheck.conflicts.length} serial history row{dupCheck.conflicts.length !== 1 ? 's' : ''} to import</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-bright)] text-[var(--panel-ink-2)] hover:text-[var(--text-primary)]" onClick={() => setDupReview(true)}>Review matches</button>
                </div>
                {skipIds.size > 0 && <p className="text-xs text-green-500 mt-2">{skipIds.size} verified exact row{skipIds.size !== 1 ? 's' : ''} will be dropped automatically. All changed rows continue.</p>}
              </Card>
            )}

            {/* Per-row review modal. Read-only - it reports which rows will be
                dropped as exact copies and which will import, and writes
                nothing - so a single unguarded close is correct here. */}
            <Modal
              open={dupReview && !!dupCheck}
              onClose={() => setDupReview(false)}
              title="Review Row Matches"
              size="lg"
              footer={<button onClick={() => setDupReview(false)} className="btn-primary w-full">Done</button>}
            >
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filter matches by outcome">
                  {[['all', 'All'], ['drop', 'Dropped as exact copies'], ['import', 'Importing']].map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={dupFilter === k}
                      onClick={() => setDupFilter(k)}
                      className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs border ${dupFilter === k ? 'bg-green-600 border-green-600 text-white' : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <EnterpriseTable
                  columns={dupColumns}
                  data={dupRows}
                  getRowId={r => String(r.idx)}
                  enableColumnFilters={false}
                  searchPlaceholder="Search serial or asset..."
                  initialPageSize={25}
                  exportFileName={`Upload row matches ${fileName || ''}`.trim()}
                  reportMeta={{ title: 'Upload row matches' }}
                  emptyMessage="No matches for this filter."
                />
              </div>
            </Modal>

            {dupes.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-yellow-500 font-medium">{dupes.length} serial number{dupes.length !== 1 ? 's' : ''} also appear in history</p>
                    <p className="text-sm text-yellow-200 mt-1">Serial reuse alone does not block import. Changed lifecycle rows continue; only exact full-row copies are dropped.</p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-blue-500/10 border border-blue-500/40 rounded-xl px-4 py-3 flex gap-3">
              <Wand2 size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-500">Records will be auto-classified on upload. High/Medium confidence results are marked cleaned instantly. Low confidence records are flagged for review in Data Cleaning.</p>
            </div>

            {/* Data-quality report */}
            {quality.length > 0 && (
              // Compound title (icon + heading + the "N rows analysed" scope
              // note) - CardHeader truncates its title, which would cut the
              // row count off, so this header stays hand-rolled.
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <Database size={15} className="text-green-500" />
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">Data Quality</h2>
                  <span className="text-xs text-[var(--panel-ink-4)]">· {rows.length.toLocaleString()} rows analysed</span>
                </div>
                <div className="flex flex-wrap items-end gap-3 mb-3">
                  <div className="relative flex-1 min-w-[180px]">
                    <label htmlFor="quality-search" className="sr-only">Search quality fields</label>
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--panel-ink-4)]" aria-hidden="true" />
                    <input
                      id="quality-search"
                      type="search"
                      className="input text-xs pl-7 min-h-[40px] w-full"
                      placeholder="Search fields..."
                      value={qualitySearch}
                      onChange={e => setQualitySearch(e.target.value)}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[var(--panel-ink-3)] min-h-[40px] cursor-pointer">
                    <input type="checkbox" className="accent-green-500 w-4 h-4" checked={qualityIssuesOnly} onChange={e => setQualityIssuesOnly(e.target.checked)} />
                    Only fields that need a check ({qualitySummary.issues})
                  </label>
                  <span className="text-xs text-[var(--panel-ink-4)] pb-2.5">Average fill: {qualitySummary.avgFill == null ? 'N/A' : `${qualitySummary.avgFill}%`}</span>
                </div>
                <EnterpriseTable
                  columns={qualityColumns}
                  data={qualityRows}
                  getRowId={q => q.key}
                  enableGlobalFilter={false}
                  enableColumnFilters={false}
                  initialPageSize={25}
                  exportFileName={`Upload data quality ${fileName || ''}`.trim()}
                  reportMeta={{ title: 'Upload data quality' }}
                  emptyMessage={qualitySearch || qualityIssuesOnly ? 'No fields match. Clear the search or the issues filter.' : 'No fields to report.'}
                />
                {qualitySummary.lowRequired > 0 && (
                  <p role="alert" className="text-xs text-red-500 mt-2 flex items-center gap-1.5">
                    <AlertTriangle size={12} aria-hidden="true" /> {qualitySummary.lowRequired} required field{qualitySummary.lowRequired === 1 ? ' is' : 's are'} under 50% filled. Check the column mapping or header row before uploading.
                  </p>
                )}
              </Card>
            )}

            {/* Cleaning preview + optional AI model */}
            {cleanPreview && (
              // Header stays hand-rolled to keep the purple Wand2, which pairs
              // with the purple AI opt-in below it. ICON_TONE has no purple,
              // and quietly recolouring it to the brand accent would break
              // that pairing.
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <Wand2 size={15} className="text-purple-500" />
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">Cleaning Preview</h2>
                </div>
                <div className="flex flex-wrap gap-4 text-sm mb-3">
                  <span className="text-green-500">{cleanPreview.auto.toLocaleString()} auto-classified</span>
                  <span className="text-yellow-500">{cleanPreview.review.toLocaleString()} need review</span>
                  <span className="text-[var(--panel-ink-4)]">of {cleanPreview.total.toLocaleString()} sampled</span>
                </div>
                {cleanPreview.examples.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {cleanPreview.examples.map((ex, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-[var(--panel-ink-3)] truncate max-w-xs">{ex.text}</span>
                        <ChevronRight size={11} className="text-[var(--text-dim)] flex-shrink-0" />
                        <span className="text-[var(--panel-ink-2)]">{ex.category || '-'}</span>
                        {ex.risk && <span className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--panel-ink-3)]">{ex.risk}</span>}
                        <span className={`px-1.5 py-0.5 rounded ${ex.conf === 'Low' ? 'bg-yellow-500/15 text-yellow-500' : 'bg-green-500/15 text-green-500'}`}>{ex.conf}</span>
                      </div>
                    ))}
                  </div>
                )}
                <label className="flex items-start gap-2 cursor-pointer border-t border-[var(--border-bright)] pt-3">
                  <input type="checkbox" className="accent-purple-500 mt-0.5" checked={useAI} onChange={e => setUseAI(e.target.checked)} />
                  <span className="text-sm text-[var(--panel-ink-2)]">
                    Clean low-confidence rows with AI
                    <span className="text-xs text-[var(--panel-ink-4)] block">Routes the {cleanPreview.review.toLocaleString()} "need review" rows through the secure AI cleaning function for better category/risk. Uses AI tokens, off by default.</span>
                  </span>
                </label>
              </Card>
            )}

            <Card>
              <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">Preview</h2>
              <p className="text-xs text-[var(--panel-ink-4)] mb-3">First {preview.length.toLocaleString()} of {rows.length.toLocaleString()} rows as they will be saved. Every row is uploaded, not only the preview.</p>
              <EnterpriseTable
                columns={previewColumns}
                data={preview}
                getRowId={(r, i) => String(i)}
                enableColumnFilters={false}
                searchPlaceholder="Search the preview..."
                initialPageSize={25}
                exportFileName={`Upload preview ${fileName || ''}`.trim()}
                reportMeta={{ title: 'Upload preview' }}
                emptyMessage="No rows could be built from this mapping."
              />
              {activeCountry === 'All' ? (
                <div className="mt-4 mb-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                  <p className="text-amber-500 text-sm font-semibold">Select a country before uploading</p>
                  <p className="text-amber-200/80 text-xs mt-1">
                    Pick a specific country in the top bar (KSA / UAE / Egypt). Every row will be stamped with it so your data never mixes.
                  </p>
                </div>
              ) : (
                <div className="mt-4 mb-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2">
                  <p className="text-emerald-500 text-sm">
                    Uploading to <span className="font-bold">{activeCountry}</span>. Every row will be stamped with this country.
                  </p>
                </div>
              )}
              {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={upload}
                  disabled={activeCountry === 'All'}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload size={16} /> Upload {(rows.length - skipIds.size).toLocaleString()} Records
                </button>
                <button onClick={() => setStep('mapping')} className="btn-secondary">Back</button>
                <button onClick={reset} className="btn-secondary">Cancel</button>
              </div>
            </Card>
          </div>
        )}

        {/* ── Uploading ── */}
        {step === 'uploading' && (
          // `py-20` as a class would be DEAD. The block padding moves into
          // Card's own style, which spreads last and beats the inline
          // `padding`. --space-12 (3rem) is the top of the spacing scale, so
          // this progress panel is a little less tall than the old 5rem.
          <Card
            as={motion.div}
            key="uploading"
            initial={{ opacity:0 }}
            animate={{ opacity:1 }}
            className="text-center"
            style={{ paddingBlock: 'var(--space-12)' }}
          >
            <div className="relative w-16 h-16 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full border-2 border-[var(--border-bright)]" />
              <div className="absolute inset-0 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center"><Rocket size={20} className="text-green-500" /></div>
            </div>
            <p className="text-[var(--text-primary)] text-lg font-semibold mb-1">Uploading & classifying</p>
            <p className="text-[var(--panel-ink-4)] text-sm mb-6">Auto-classifying records with the Smart Engine</p>
            {progress.total > 0 && (
              <div className="max-w-sm mx-auto">
                <div className="flex justify-between text-xs text-[var(--panel-ink-4)] mb-2">
                  <span>{progress.done.toLocaleString()} rows processed</span>
                  <span>{Math.round((progress.done / progress.total) * 100)}%</span>
                </div>
                <div className="h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ background: 'linear-gradient(90deg, #16a34a, #4ade80)' }}
                    animate={{ width: `${(progress.done / progress.total) * 100}%` }} transition={{ duration: 0.3 }} />
                </div>
                <p className="text-[var(--text-dim)] text-xs mt-2">{progress.total.toLocaleString()} total records</p>
              </div>
            )}
          </Card>
        )}

        {/* ── Done ── */}
        {step === 'done' && result && (
          <Card as={motion.div} key="done" initial={{ opacity:0, scale:0.97 }} animate={{ opacity:1, scale:1 }}>
            <div className="flex items-center gap-3 mb-6">
              <motion.div initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:'spring', stiffness:300, delay:0.1 }}>
                {result.pending
                  ? <Clock size={32} className="text-amber-500" style={{ filter: 'drop-shadow(0 0 12px rgba(251,191,36,0.6))' }} />
                  : <CheckCircle size={32} className="text-green-500" style={{ filter: 'drop-shadow(0 0 12px rgba(74,222,128,0.6))' }} />}
              </motion.div>
              <div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">{result.pending ? 'Submitted for Approval' : 'Upload Complete'}</h2>
                <p className="text-[var(--panel-ink-4)] text-sm">
                  {result.pending
                    ? `${(result.submitted ?? 0).toLocaleString()} ${result.pending ? 'records' : ''} sent to an administrator. They will appear once approved.`
                    : `${rowsHandled(result).toLocaleString()} of ${(result.sourceRows ?? rowsHandled(result)).toLocaleString()} source rows accounted for`}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <StatTile label={result.pending ? 'Rows Submitted' : 'Rows Handled'} value={rowsHandled(result).toLocaleString()} tone={result.pending ? 'warn' : 'accent'} icon={result.pending ? Clock : CheckCircle} />
              <StatTile label={result.pending ? 'Rows in File' : 'Records Added'} value={resultNumber(result.pending ? result.sourceRows : result.added).toLocaleString()} tone="info" icon={Database} />
              <StatTile label="Need Review" value={resultNumber(result.needsReviewCount).toLocaleString()} tone={result.needsReviewCount ? 'warn' : 'neutral'} icon={Wand2} />
              <StatTile label="Skipped" value={(resultNumber(result.skipped) + resultNumber(result.dupesSkipped)).toLocaleString()} sub={result.dupesSkipped ? `${resultNumber(result.dupesSkipped)} exact copies dropped` : undefined} icon={X} />
            </div>

            {/* Extra fields confirmation */}
            {result.extraColCount > 0 && (
              <div className="bg-purple-500/10 border border-purple-500/40 rounded-xl p-4 mb-4 flex items-start gap-3">
                <Info size={18} className="text-purple-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[var(--text-primary)] font-medium">
                    {result.extraColCount} extra column{result.extraColCount !== 1 ? 's' : ''} saved as custom data, nothing was lost
                  </p>
                  <p className="text-sm text-[var(--panel-ink-3)] mt-0.5">
                    All columns that don't match a standard field are preserved in Custom Data. You can browse, search, export, or teach the system to recognise them permanently.
                  </p>
                  <Link to="/custom-data" className="inline-flex items-center gap-1.5 mt-2 text-sm text-purple-500 hover:text-purple-200 underline">
                    View Custom Data <ChevronRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            )}
            {result.needsReviewCount > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <Wand2 size={18} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[var(--text-primary)] font-medium">{result.needsReviewCount.toLocaleString()} records need manual classification</p>
                    <p className="text-sm text-[var(--panel-ink-3)] mt-0.5">Open Data Cleaning to approve or adjust them.</p>
                    <button onClick={() => navigate('/cleaning')} className="btn-primary mt-3 text-sm flex items-center gap-2"><Wand2 size={14} /> Go to Data Cleaning</button>
                  </div>
                </div>
              </div>
            )}
            {result.skipLog?.length > 0 && (
              <details className="text-sm text-[var(--panel-ink-3)] mb-4">
                <summary className="cursor-pointer text-yellow-500 min-h-[40px] flex items-center">View error log ({result.skipLog.length} row(s) skipped, see reason per row)</summary>
                <div className="mt-2">
                  <EnterpriseTable
                    columns={skipColumns}
                    data={skipRows}
                    getRowId={r => String(r.id)}
                    enableColumnFilters={false}
                    searchPlaceholder="Search skipped rows..."
                    initialPageSize={25}
                    exportFileName={`Upload skipped rows ${fileName || ''}`.trim()}
                    reportMeta={{ title: 'Upload skipped rows' }}
                    emptyMessage="No skipped rows."
                  />
                </div>
              </details>
            )}
            {/* `self-start`: Card is flex-col, so a lone button as a direct
                child would stretch to the full card width. */}
            <button onClick={reset} className="btn-secondary self-start">Upload Another File</button>
          </Card>
        )}

      </AnimatePresence>
    </div>
  )
}
