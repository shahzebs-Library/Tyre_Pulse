import { useState, useRef, useMemo, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { batchClassify } from '../lib/tyreClassifier'
import { logAuditEvent } from '../lib/auditLogger'
import * as XLSX from 'xlsx'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, FileSpreadsheet, CheckCircle, X, Wand2, BookOpen,
  AlertTriangle, Package, ChevronRight, Layers, Table2, Eye,
  Rocket, Info, Zap, Search, Database,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'

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
  const activeIdx = STEPS.findIndex(s => s.key === current)
  return (
    <div className="flex items-center gap-0 mb-8 overflow-x-auto pb-1">
      {STEPS.map((s, i) => {
        const Icon = s.icon
        const done   = i < activeIdx
        const active = i === activeIdx
        return (
          <div key={s.key} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              active  ? 'bg-green-900/40 text-green-300 border border-green-500/50' :
              done    ? 'text-green-500 opacity-70' : 'text-gray-600'
            }`}>
              <Icon size={13} />
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight size={12} className={`mx-1 flex-shrink-0 ${i < activeIdx ? 'text-green-600' : 'text-gray-700'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Fuzzy matching engine ─────────────────────────────────────────────────────

/**
 * Levenshtein distance — used as fuzzy fallback when substring match fails.
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
 * Compute a match score 0–100 between a file header and a set of synonym strings.
 * Returns { score, matchedGuess }
 */
function scoreHeader(header, guesses) {
  const h = normalise(header)
  let best = 0, matchedGuess = null

  for (const raw of guesses) {
    const g = normalise(raw)
    // 1. Exact match
    if (h === g) return { score: 100, matchedGuess: raw }
    // 2. Substring — header contains guess, or guess contains header
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
    // 4. Levenshtein — short strings only (avoid false positives on long strings)
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
const TYRE_FIELDS = [
  {
    key: 'sr',
    label: 'Row / SR No.',
    required: false,
    guesses: ['sr', 'no', 'sno', 's.no', 's no', '#', 'row', 'seq', 'serial row', 'number', 'رقم', 'رقم التسلسل', 'ت', 'م'],
  },
  {
    key: 'issue_date',
    label: 'Issue Date',
    required: true,
    guesses: ['date', 'issue date', 'issue_date', 'issuance date', 'issued', 'issued date', 'issue dt', 'تاريخ', 'تاريخ الإصدار', 'tarikh', 'تاريخ التركيب', 'transaction date'],
  },
  {
    key: 'description',
    label: 'Description',
    required: true,
    guesses: ['description', 'desc', 'tyre description', 'type', 'item', 'item name', 'product', 'product name', 'item desc', 'tyre type', 'الوصف', 'وصف', 'نوع الإطار', 'الإطار'],
  },
  {
    key: 'brand',
    label: 'Brand',
    required: false,
    guesses: ['brand', 'tyre brand', 'tyre_brand', 'manufacturer', 'make', 'brand name', 'ماركة', 'الماركة', 'العلامة التجارية', 'صانع'],
  },
  {
    key: 'serial_no',
    label: 'Serial Number',
    required: true,
    guesses: ['serial', 'serial no', 'serial_no', 'serial number', 's/n', 'sn', 'serial num', 'tyre serial', 'barcode', 'part no', 'الرقم التسلسلي', 'رقم التسلسل', 'رقم المنتج', 'رقم القطعة'],
  },
  {
    key: 'qty',
    label: 'Quantity',
    required: false,
    guesses: ['qty', 'quantity', 'count', 'qnty', 'q', 'pcs', 'pieces', 'كمية', 'الكمية', 'عدد'],
  },
  {
    key: 'job_card',
    label: 'Job Card / Work Order',
    required: false,
    guesses: ['job card', 'job_card', 'jc', 'work order', 'wo', 'job no', 'job number', 'wo no', 'work order no', 'order no', 'بطاقة العمل', 'رقم العمل', 'أمر العمل'],
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
      'vehicle no', 'vehicle number', 'plate', 'plate no', 'reg', 'reg no',
      'registration', 'fleet no', 'fleet number', 'unit', 'unit no', 'chassis',
      'رقم المركبة', 'رقم الأصل', 'لوحة السيارة', 'رقم السيارة', 'الأصل',
    ],
  },
  {
    key: 'site',
    label: 'Site / Location',
    required: false,
    guesses: ['site', 'location', 'area', 'camp', 'branch', 'depot', 'yard', 'warehouse', 'project', 'موقع', 'المنطقة', 'المعسكر', 'موقع العمل', 'الفرع'],
  },
  {
    key: 'country',
    label: 'Country',
    required: false,
    guesses: ['country', 'nation', 'region country', 'state', 'country code', 'cc', 'البلد', 'الدولة', 'المنطقة'],
  },
  {
    key: 'remarks',
    label: 'Remarks / Notes',
    required: false,
    guesses: ['remarks', 'notes', 'comment', 'comments', 'note', 'observation', 'ملاحظات', 'ملاحظة', 'تعليق', 'بيانات إضافية'],
  },
]

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
 * Uses a greedy best-match assignment — each source column can only be used once.
 * synonyms: [{ custom_name, maps_to }] — user-defined permanent mappings (score 100).
 */
function smartMapping(headers, fields, synonyms = []) {
  // Build synonym lookup: normalised custom_name → maps_to
  const synLookup = {}
  synonyms.forEach(s => { synLookup[normalise(s.custom_name)] = s.maps_to })

  const scores = {}
  fields.forEach(f => {
    // Check synonyms first — they score 100 (exact)
    const synHeader = headers.find(h => synLookup[normalise(h)] === f.key)
    if (synHeader) {
      scores[f.key] = [{ h: synHeader, score: 100, matchedGuess: synHeader }, ...headers.filter(h => h !== synHeader).map(h => ({ h, ...scoreHeader(h, f.guesses) })).sort((a, b) => b.score - a.score)]
    } else {
      scores[f.key] = headers.map(h => ({ h, ...scoreHeader(h, f.guesses) })).sort((a, b) => b.score - a.score)
    }
  })

  const assigned = new Set()
  const result   = {}

  // First pass: assign only high-confidence matches (≥65 or synonym)
  fields.forEach(f => {
    const best = scores[f.key].find(m => m.score >= 65 && !assigned.has(m.h))
    if (best) { result[f.key] = { header: best.h, score: best.score, band: confidenceBand(best.score) }; assigned.add(best.h) }
  })

  // Second pass: fill remaining with medium confidence
  fields.forEach(f => {
    if (result[f.key]) return
    const best = scores[f.key].find(m => m.score >= 35 && !assigned.has(m.h))
    if (best) { result[f.key] = { header: best.h, score: best.score, band: confidenceBand(best.score) }; assigned.add(best.h) }
    else       result[f.key] = { header: null, score: 0, band: 'none' }
  })

  return result
}

// ── Utility functions ─────────────────────────────────────────────────────────

function fingerprintHeaders(headers) {
  return [...headers].sort().join('|').toLowerCase()
}

function parseDate(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().split('T')[0]
  const s = String(val).trim()
  if (!s) return null
  const d = new Date(s)
  if (!isNaN(d)) return d.toISOString().split('T')[0]
  const parts = s.split(/[\/\-]/)
  if (parts.length === 3) {
    const [a, b, c] = parts
    if (c.length === 4) return `${c}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`
  }
  return null
}

function guessFileType(headers) {
  const h = headers.map(x => normalise(String(x)))
  const fleetSignals = ['make', 'model', 'vehicle type', 'fleet number', 'operator', 'chassis']
  const tyreSignals  = ['serial no', 'serial', 'description', 'remarks', 'job card', 'mis number', 'mis no']
  const fleetScore   = fleetSignals.filter(s => h.some(x => x.includes(s))).length
  const tyreScore    = tyreSignals.filter(s => h.some(x => x.includes(s))).length
  if (fleetScore >= 2 && fleetScore > tyreScore) return 'fleet'
  if (tyreScore >= 2) return 'tyres'
  return 'unknown'
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UploadData() {
  const { profile }      = useAuth()
  const { activeCountry }= useSettings()
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

  // Duplicate detection
  const [dupes, setDupes]         = useState([])
  const [skipDupes, setSkipDupes] = useState(true)
  const [dupCheck, setDupCheck]   = useState(null)
  const [skipIds, setSkipIds]     = useState(new Set())
  const [dupReview, setDupReview] = useState(false)
  const [progress, setProgress]   = useState({ done: 0, total: 0 })
  const [dragging, setDragging]   = useState(false)
  const [searchMapping, setSearchMapping] = useState('')
  const [synonyms, setSynonyms]   = useState([])  // permanent field synonyms from DB

  const activeFields  = uploadType === 'stock' ? STOCK_FIELDS  : TYRE_FIELDS

  // Load permanent synonyms once — injected into smart mapping for 100% confidence
  useEffect(() => {
    supabase.from('field_synonyms').select('custom_name, maps_to').eq('table_target', 'tyre_records')
      .then(({ data }) => { if (data) setSynonyms(data) })
  }, [])

  // Unmapped source columns — shown in a warning strip so user sees what's being dropped
  const unmappedSource = useMemo(() => {
    const used = new Set(Object.values(mapping).filter(Boolean))
    return headers.filter(h => !used.has(h))
  }, [headers, mapping])

  // Mapping completeness
  const requiredFields  = activeFields.filter(f => f.required)
  const mappedRequired  = requiredFields.filter(f => mapping[f.key])
  const mappingComplete = mappedRequired.length === requiredFields.length

  // ── File parsing ────────────────────────────────────────────────────────────

  async function applyHeaders(hdrs, dataRows, type = uploadType) {
    setHeaders(hdrs)
    setRows(dataRows)

    // Recall saved mapping fingerprint
    const fp     = fingerprintHeaders(hdrs)
    const { data: saved } = await supabase.from('column_mappings').select('id, mapping').eq('fingerprint', fp).maybeSingle()

    let finalMapping
    if (saved?.mapping) {
      // Saved mapping stores { key: headerString } — rebuild scores from that
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
      // Smart auto-mapping — inject user-defined permanent synonyms
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

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError('')
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true })
        wbRef.current = wb

        if (wb.SheetNames.length > 1) {
          const opts = wb.SheetNames.map(name => {
            const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[name])
            const allKeys = Object.keys(wb.Sheets[name]).filter(k => !k.startsWith('!'))
            const colCount = new Set(allKeys.map(k => k.replace(/\d+/, ''))).size
            const likelyPivot = sheetRows.length < 15 && colCount > 15
            return { name, rows: sheetRows.length, selected: !likelyPivot, likelyPivot }
          })
          setSheetOptions(opts)
          setStep('sheets')
          return
        }

        const ws   = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (data.length < 2) { setError('File is empty or has no data rows'); return }
        const hdrs     = data[0].map(String)
        const dataRows = data.slice(1).filter(r => r.some(c => c !== ''))

        if (uploadType === 'auto') {
          const detected = guessFileType(hdrs)
          if (detected === 'fleet') { setUploadType('fleet'); return }
          setUploadType('tyres')
        }

        await applyHeaders(hdrs, dataRows)
      } catch (err) {
        setError('Failed to parse file: ' + err.message)
      }
    }
    reader.readAsBinaryString(file)
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
        if (f.key === 'issue_date') val = parseDate(val)
        else if (f.key === 'qty')   val = val ? +val || 1 : 1
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
    const built = buildRows(headers, rows, mapping)
    setPreview(built.slice(0, 5))
    setSkipIds(new Set())
    setDupCheck(null)

    const serials = [...new Set(built.map(r => r.serial_no).filter(Boolean))]
    if (serials.length > 0 && uploadType === 'tyres') {
      const BATCH = 500
      const existing = []
      for (let i = 0; i < serials.length; i += BATCH) {
        const { data } = await supabase.from('tyre_records').select('serial_no, asset_no, issue_date, id').in('serial_no', serials.slice(i, i + BATCH))
        existing.push(...(data ?? []))
      }
      const existingSet = new Set(existing.map(r => r.serial_no))
      setDupes([...existingSet])

      if (existing.length > 0) {
        const bySerial = {}
        existing.forEach(e => { bySerial[e.serial_no] = e })
        const exactDups = [], conflicts = []
        built.forEach((row, idx) => {
          if (!row.serial_no) return
          const match = bySerial[row.serial_no]
          if (!match) return
          if (match.asset_no === row.asset_no && match.issue_date === row.issue_date) exactDups.push({ idx, row, existing: match })
          else if (match.asset_no && row.asset_no && match.asset_no !== row.asset_no) conflicts.push({ idx, row, existing: match })
        })
        const reupload = serials.length > 5 && exactDups.length / serials.length > 0.7
        if (exactDups.length > 0 || conflicts.length > 0 || reupload) setDupCheck({ exact: exactDups, conflicts, reupload })
      }
    } else {
      setDupes([])
    }

    setStep('preview')
  }

  // ── Save column mapping ─────────────────────────────────────────────────────

  async function saveColumnMapping(fp) {
    const plain = {}
    Object.entries(mapping).forEach(([k, v]) => { if (v) plain[k] = v })
    if (savedMappingId) {
      await supabase.from('column_mappings').update({ mapping: plain, last_used_at: new Date().toISOString() }).eq('id', savedMappingId)
    } else {
      await supabase.from('column_mappings').upsert({ fingerprint: fp, mapping: plain, file_name: fileName, confirmed_by: profile?.id, use_count: 1, last_used_at: new Date().toISOString() }, { onConflict: 'fingerprint' })
    }
  }

  // ── Upload ──────────────────────────────────────────────────────────────────

  async function upload() {
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
        site:        row.site     || activeCountry || null,
        location:    row.location || null,
        min_level:   parseFloat(row.min_level)   || 0,
        reorder_qty: parseFloat(row.reorder_qty) || 0,
        supplier:    row.supplier || null,
        notes:       row.notes    || null,
      }))
      const CHUNK = 500
      let added = 0
      for (let i = 0; i < stockRows.length; i += CHUNK) {
        const chunk = stockRows.slice(i, i + CHUNK)
        const { error: err } = await supabase.from('stock_records').insert(chunk)
        if (!err) added += chunk.length
        setProgress({ done: Math.min(i + CHUNK, stockRows.length), total: stockRows.length })
      }
      await logAuditEvent({ action: 'upload_stock', table_name: 'stock_records', record_count: added, details: { file: fileName, batch_id: batchId } })
      setResult({ added, autoClassifiedCount: 0, needsReviewCount: 0, dupesSkipped: 0, skipLog: [] })
      setStep('done')
      return
    }

    await saveColumnMapping(fingerprintHeaders(headers))

    const defaultCountry = activeCountry !== 'All' ? activeCountry : 'KSA'
    let records = buildRows(headers, rows, mapping).map(r => ({
      ...r,
      country:         r.country || defaultCountry,
      region:          profile?.region ?? defaultCountry,
      uploaded_by:     profile?.id,
      upload_batch_id: batchId,
    }))

    if (skipIds.size > 0) records = records.filter((_, idx) => !skipIds.has(idx))
    if (skipDupes && dupes.length > 0) {
      const dupeSet = new Set(dupes)
      records = records.filter(r => !r.serial_no || !dupeSet.has(r.serial_no))
    }

    const classified  = batchClassify(records.map((r, i) => ({ id: i, description: r.description, remarks: r.remarks })))
    const classMap    = Object.fromEntries(classified.map(c => [c.id, c]))
    const classifyLog = []
    records = records.map((r, i) => {
      const c = classMap[i]
      const auto = c && c.confidence !== 'Low'
      if (auto) classifyLog.push({ original_text: [r.description, r.remarks].filter(Boolean).join(' | '), cleaned_text: c.remarks_cleaned, category: c.category, confidence: c.confidence, cleaned_by_model: 'rule-based-v1' })
      return { ...r, category: c?.category ?? null, risk_level: c?.risk_level ?? null, remarks_cleaned: c?.remarks_cleaned ?? null, cleaned: auto }
    })

    const autoClassifiedCount = classifyLog.length
    const needsReviewCount    = records.length - autoClassifiedCount
    const BATCH = 500
    let added = 0, skipped = 0
    const skipLog = []
    const insertedIds = []

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH)
      const { data, error: err } = await supabase.from('tyre_records').insert(batch).select('id')
      if (err) { skipped += batch.length; skipLog.push({ batch: Math.floor(i / BATCH) + 1, error: err.message }) }
      else { added += (data ?? []).length; insertedIds.push(...(data ?? []).map(r => r.id)) }
      setProgress({ done: Math.min(i + BATCH, records.length), total: records.length })
    }

    if (classifyLog.length > 0) await supabase.from('cleaning_log').insert(classifyLog.map((entry, i) => ({ ...entry, tyre_record_id: insertedIds[i] ?? null })))

    await supabase.from('upload_history').insert({ file_names: [fileName], records_added: added, records_skipped: skipped + (skipDupes ? dupes.length : 0), skip_log: skipLog, mapping_used: mapping, region: profile?.region ?? defaultCountry, uploaded_by: profile?.id, batch_id: batchId })
    await logAuditEvent({ action: 'UPLOAD', tableName: 'tyre_records', recordCount: added, details: { filename: fileName, rowCount: added, skippedCount: skipped + (skipDupes ? dupes.length : 0), country: activeCountry, batch_id: batchId } })

    // Bump use_count on any synonyms that were exercised in this upload
    const usedHeaders = new Set(Object.values(mapping).filter(Boolean).map(h => normalise(h)))
    const hitSynonyms = synonyms.filter(s => usedHeaders.has(normalise(s.custom_name)))
    if (hitSynonyms.length > 0) {
      await Promise.all(hitSynonyms.map(s =>
        supabase.from('field_synonyms').update({ use_count: s.use_count + 1, last_used_at: new Date().toISOString() })
          .eq('custom_name', s.custom_name).eq('table_target', 'tyre_records')
      ))
    }

    // Count unmapped columns saved as extra_fields
    const extraColCount = unmappedSource.length
    setResult({ added, skipped, skipLog, autoClassifiedCount, needsReviewCount, dupesSkipped: skipDupes ? dupes.length : 0, extraColCount })
    setStep('done')
  }

  function reset() {
    setStep('idle'); setFileName(''); setHeaders([]); setRows([])
    setMapping({}); setMappingScores({}); setPreview([]); setResult(null); setError('')
    setSavedMappingId(null); setMappingSource('auto'); setDupes([]); setSkipDupes(true)
    setDupCheck(null); setSkipIds(new Set()); setDupReview(false)
    setUploadType('tyres'); setSheetOptions([]); setSearchMapping('')
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
      <PageHeader title="Upload Data" subtitle="Import tyre and fleet data from Excel or CSV files" icon={Upload} />
      <StepBar current={step} />

      <AnimatePresence mode="wait">

        {/* ── Idle ── */}
        {step === 'idle' && (
          <motion.div key="idle" initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-10 }} transition={{ duration:0.25 }}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {[
                { val: 'tyres', label: 'Tyre Records',   desc: 'Issue records, replacements, costs',  icon: FileSpreadsheet, color: 'green' },
                { val: 'fleet', label: 'Fleet / Vehicle', desc: 'Vehicle registry, asset specs',       icon: Package,         color: 'blue' },
                { val: 'stock', label: 'Stock Records',   desc: 'Inventory items and stock levels',   icon: Layers,          color: 'purple' },
                { val: 'auto',  label: 'Auto-detect',     desc: 'Figure it out from column names',    icon: Wand2,           color: 'yellow' },
              ].map(opt => {
                const Icon = opt.icon
                const active = uploadType === opt.val
                const colorMap = {
                  green:  { border: 'rgba(22,163,74,0.5)',  bg: 'rgba(22,163,74,0.1)',  text: 'text-green-300',  icon: 'text-green-400' },
                  blue:   { border: 'rgba(59,130,246,0.5)', bg: 'rgba(59,130,246,0.1)', text: 'text-blue-300',   icon: 'text-blue-400' },
                  purple: { border: 'rgba(168,85,247,0.5)', bg: 'rgba(168,85,247,0.1)', text: 'text-purple-300', icon: 'text-purple-400' },
                  yellow: { border: 'rgba(234,179,8,0.5)',  bg: 'rgba(234,179,8,0.08)', text: 'text-yellow-300', icon: 'text-yellow-400' },
                }
                const c = colorMap[opt.color]
                return (
                  <motion.button
                    key={opt.val}
                    onClick={() => setUploadType(opt.val)}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    className="card text-left transition-all duration-150 cursor-pointer"
                    style={active ? { borderColor: c.border, background: c.bg, boxShadow: `0 0 20px ${c.border}` } : {}}
                  >
                    <Icon size={22} className={`mb-2 ${active ? c.icon : 'text-gray-600'}`} />
                    <p className={`text-sm font-semibold ${active ? c.text : 'text-gray-300'}`}>{opt.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">{opt.desc}</p>
                  </motion.button>
                )
              })}
            </div>

            {uploadType === 'fleet' ? (
              <motion.div initial={{ opacity:0, scale:0.98 }} animate={{ opacity:1, scale:1 }} className="card border-yellow-700/40 bg-yellow-900/10 mb-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-yellow-300">Fleet data has a dedicated upload</p>
                    <p className="text-sm text-gray-400 mt-1">Use Fleet Master for vehicle imports — it has correct column mapping and validation.</p>
                    <a href="/fleet-master" className="inline-block mt-2 text-sm text-green-400 underline hover:text-green-300">Go to Fleet Master →</a>
                  </div>
                </div>
              </motion.div>
            ) : (
              <>
                {/* Accepted columns reference */}
                <div className="card mb-4 border-green-900/40 bg-green-900/5">
                  <div className="flex items-center gap-2 mb-3">
                    <Info size={15} className="text-green-400" />
                    <span className="text-sm font-semibold text-green-300">Your columns don't need to match exactly</span>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">
                    The smart mapping engine recognises hundreds of column name variations, abbreviations, and Arabic headers.
                    Use any naming convention — the engine will match automatically. You can adjust any mapping before uploading.
                  </p>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                    {(uploadType === 'stock' ? STOCK_FIELDS : TYRE_FIELDS).filter(f => f.required).map(f => (
                      <div key={f.key} className="flex items-start gap-1.5">
                        <span className="text-green-500 text-xs mt-0.5 flex-shrink-0">✓</span>
                        <div>
                          <span className="text-xs font-semibold text-gray-300">{f.label}</span>
                          <p className="text-xs text-gray-600 leading-tight">{f.guesses.slice(0,3).join(', ')}…</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <motion.div
                  className="relative overflow-hidden rounded-2xl cursor-pointer transition-all duration-200"
                  style={{ border: `2px dashed ${dragging ? 'rgba(22,163,74,0.7)' : 'rgba(255,255,255,0.1)'}`, background: dragging ? 'rgba(22,163,74,0.07)' : 'rgba(255,255,255,0.02)', boxShadow: dragging ? '0 0 40px rgba(22,163,74,0.2)' : 'none' }}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  whileHover={{ borderColor: 'rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.04)' }}
                >
                  <div className="py-20 flex flex-col items-center justify-center gap-4">
                    <motion.div animate={dragging ? { scale: 1.15, rotate: [-5, 5, -5, 0] } : { scale: 1, rotate: 0 }} transition={{ duration: 0.3 }}
                      className="w-20 h-20 rounded-2xl flex items-center justify-center"
                      style={{ background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.3)', boxShadow: '0 0 30px rgba(22,163,74,0.15)' }}>
                      <Upload size={36} className="text-green-400" />
                    </motion.div>
                    <div className="text-center">
                      <p className="text-xl font-semibold text-white mb-1">{dragging ? 'Drop to upload' : 'Drop your Excel or CSV file here'}</p>
                      <p className="text-gray-500 text-sm">or click to browse · .xlsx, .xls, .csv supported</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                      <span className="px-2 py-1 bg-gray-800/60 rounded">.xlsx</span>
                      <span className="px-2 py-1 bg-gray-800/60 rounded">.xls</span>
                      <span className="px-2 py-1 bg-gray-800/60 rounded">.csv</span>
                    </div>
                  </div>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
                  {error && <p className="text-red-400 text-sm text-center pb-4">{error}</p>}
                </motion.div>
              </>
            )}
          </motion.div>
        )}

        {/* ── Sheets picker ── */}
        {step === 'sheets' && (
          <div className="card space-y-4">
            <h2 className="text-base font-semibold text-white">Select Sheets to Import</h2>
            <p className="text-sm text-gray-400">This workbook has {sheetOptions.length} sheets. Choose which to include — pivot and summary sheets are suggested to skip.</p>
            <div className="space-y-2">
              {sheetOptions.map((s, i) => (
                <label key={s.name} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${s.selected ? 'border-green-700/50 bg-green-900/10' : 'border-gray-700 bg-gray-800/30'}`}>
                  <input type="checkbox" checked={s.selected}
                    onChange={() => setSheetOptions(prev => prev.map((x, j) => j === i ? {...x, selected: !x.selected} : x))}
                    className="accent-green-500" />
                  <span className="text-white text-sm font-medium flex-1">{s.name}</span>
                  {s.likelyPivot && <span className="text-xs text-yellow-400">looks like a pivot</span>}
                  <span className="text-xs text-gray-500">{s.rows} rows</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button disabled={!sheetOptions.some(s => s.selected)}
                onClick={async () => {
                  const wb = wbRef.current
                  const merged = []
                  sheetOptions.filter(s => s.selected).forEach(s => { merged.push(...XLSX.utils.sheet_to_json(wb.Sheets[s.name])) })
                  const hdrs = merged.length > 0 ? Object.keys(merged[0]) : []
                  const dataRows = merged.map(r => hdrs.map(h => r[h] ?? ''))
                  if (uploadType === 'auto') setUploadType(guessFileType(hdrs) !== 'unknown' ? guessFileType(hdrs) : 'tyres')
                  await applyHeaders(hdrs, dataRows)
                }}
                className="btn-primary disabled:opacity-40">
                Import {sheetOptions.filter(s => s.selected).reduce((a, s) => a + s.rows, 0)} rows →
              </button>
              <button onClick={reset} className="btn-secondary">Cancel</button>
            </div>
          </div>
        )}

        {/* ── Mapping ── */}
        {step === 'mapping' && (
          <div className="space-y-4">
            {/* Header row */}
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-400">
              <FileSpreadsheet size={16} className="text-blue-400" />
              <span className="font-medium text-gray-300">{fileName}</span>
              <span>· {rows.length.toLocaleString()} rows · {headers.length} columns detected</span>
              {mappingSource === 'memory' && (
                <span className="badge bg-green-900/50 text-green-300 border border-green-700/50 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full">
                  <BookOpen size={11} /> Recalled from memory
                </span>
              )}
              {mappingSource === 'auto' && (
                <span className="badge bg-blue-900/50 text-blue-300 border border-blue-700/50 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full">
                  <Zap size={11} /> Smart auto-mapped
                </span>
              )}
            </div>

            {/* Completeness indicator */}
            <div className={`rounded-xl px-4 py-3 flex items-center gap-3 border ${
              mappingComplete
                ? 'bg-green-900/20 border-green-700/40'
                : 'bg-yellow-900/20 border-yellow-700/40'
            }`}>
              {mappingComplete
                ? <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
                : <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0" />
              }
              <p className={`text-sm ${mappingComplete ? 'text-green-300' : 'text-yellow-300'}`}>
                {mappingComplete
                  ? `All ${requiredFields.length} required fields are mapped. You can proceed to preview.`
                  : `${mappedRequired.length}/${requiredFields.length} required fields mapped. Map the remaining fields before uploading.`
                }
              </p>
            </div>

            {/* Unmapped source columns warning */}
            {unmappedSource.length > 0 && (
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-gray-400 mb-1.5">
                  {unmappedSource.length} column{unmappedSource.length !== 1 ? 's' : ''} from your file are not mapped to any field — they will be saved in <code className="text-gray-300">extra_fields</code> and not lost:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {unmappedSource.map(h => (
                    <span key={h} className="text-xs bg-gray-700/60 text-gray-300 px-2 py-0.5 rounded-full">{h}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-white">Column Mapping</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Match your file's columns to the system fields. Confidence shown by colour.</p>
                </div>
                {/* Search */}
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    className="input text-xs pl-7 py-1.5 w-36"
                    placeholder="Filter fields…"
                    value={searchMapping}
                    onChange={e => setSearchMapping(e.target.value)}
                  />
                </div>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Exact / High match</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Medium match</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> No match — please select</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-600 inline-block" /> Optional / Skipped</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeFields
                  .filter(f => !searchMapping || f.label.toLowerCase().includes(searchMapping.toLowerCase()) || f.key.includes(searchMapping.toLowerCase()))
                  .map(field => {
                  const sc = mappingScores[field.key] ?? { score: 0, band: 'none' }
                  const hasMapping = !!mapping[field.key]
                  const borderColor = hasMapping
                    ? sc.band === 'exact' || sc.band === 'high'   ? 'border-green-700/60'
                    : sc.band === 'medium'                         ? 'border-yellow-700/60'
                    :                                               'border-orange-700/60'
                    : field.required                               ? 'border-red-800/60'
                    :                                               'border-gray-700/40'
                  const dotColor = hasMapping
                    ? sc.band === 'exact' || sc.band === 'high'   ? 'bg-green-500'
                    : sc.band === 'medium'                         ? 'bg-yellow-500'
                    :                                               'bg-orange-500'
                    : field.required                               ? 'bg-red-600'
                    :                                               'bg-gray-600'

                  return (
                    <div key={field.key} className={`rounded-lg border p-3 transition-all ${borderColor}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                        <label className="text-xs font-semibold text-gray-300">
                          {field.label}
                          {field.required && <span className="text-red-400 ml-0.5">*</span>}
                        </label>
                        {sc.band !== 'none' && hasMapping && (
                          <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${
                            sc.band === 'exact' || sc.band === 'high' ? 'bg-green-900/60 text-green-300' :
                            sc.band === 'medium' ? 'bg-yellow-900/60 text-yellow-300' : 'bg-orange-900/60 text-orange-300'
                          }`}>
                            {sc.score}% match
                          </span>
                        )}
                      </div>
                      <select
                        className="input text-xs w-full"
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
            </div>
          </div>
        )}

        {/* ── Preview ── */}
        {step === 'preview' && (
          <div className="space-y-4">
            {/* Smart dup check */}
            {dupCheck && (
              <div className="card border-yellow-600/40">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={18} className="text-yellow-400" />
                  <span className="font-semibold text-yellow-300">Duplicate Check Results</span>
                </div>
                {dupCheck.reupload && <p className="text-yellow-300 text-sm mb-2">This looks like data you have already uploaded — {dupCheck.exact.length} matching records found.</p>}
                <div className="flex gap-4 text-sm mb-3">
                  {dupCheck.exact.length > 0 && <span className="text-red-300">{dupCheck.exact.length} exact duplicate{dupCheck.exact.length !== 1 ? 's' : ''}</span>}
                  {dupCheck.conflicts.length > 0 && <span className="text-orange-300">{dupCheck.conflicts.length} serial conflict{dupCheck.conflicts.length !== 1 ? 's' : ''}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {dupCheck.exact.length > 0 && <button className="btn-primary text-sm py-1.5 px-3" onClick={() => setSkipIds(new Set(dupCheck.exact.map(d => d.idx)))}>Skip duplicates ({dupCheck.exact.length})</button>}
                  {(dupCheck.exact.length > 0 || dupCheck.conflicts.length > 0) && <button className="px-3 py-1.5 text-sm rounded-lg border border-gray-600 text-gray-300 hover:text-white" onClick={() => setDupReview(true)}>Review individually</button>}
                  <button className="px-3 py-1.5 text-sm rounded-lg border border-gray-600 text-gray-400 hover:text-white" onClick={() => { setSkipIds(new Set()); setDupCheck(null) }}>Upload all anyway</button>
                </div>
                {skipIds.size > 0 && <p className="text-xs text-green-400 mt-2">{skipIds.size} row{skipIds.size !== 1 ? 's' : ''} will be skipped</p>}
              </div>
            )}

            {/* Per-row review modal */}
            {dupReview && dupCheck && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6">
                  <h3 className="text-lg font-bold text-white mb-4">Review Duplicates</h3>
                  <div className="space-y-3 mb-4">
                    {[...dupCheck.exact, ...dupCheck.conflicts].map(({ idx, row, existing }) => (
                      <div key={idx} className={`rounded-lg p-3 border ${skipIds.has(idx) ? 'border-red-800/50 bg-red-900/10 opacity-60' : 'border-gray-700 bg-gray-800/50'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-xs space-y-0.5">
                            <p className="text-white font-mono font-semibold">Row {idx + 1}: {row.serial_no}</p>
                            <p className="text-gray-400">File: {row.asset_no} · {row.issue_date} | DB: {existing.asset_no} · {existing.issue_date}</p>
                          </div>
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button onClick={() => setSkipIds(s => { const n = new Set(s); n.add(idx); return n })} className="text-xs px-2 py-1 rounded bg-red-900/30 text-red-400 border border-red-800/50">Skip</button>
                            <button onClick={() => setSkipIds(s => { const n = new Set(s); n.delete(idx); return n })} className="text-xs px-2 py-1 rounded bg-green-900/30 text-green-400 border border-green-800/50">Keep</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setDupReview(false)} className="btn-primary w-full">Done</button>
                </div>
              </div>
            )}

            {dupes.length > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-yellow-300 font-medium">{dupes.length} potential duplicate serial number{dupes.length !== 1 ? 's' : ''} detected</p>
                    <label className="flex items-center gap-2 mt-3 cursor-pointer">
                      <input type="checkbox" className="accent-yellow-500" checked={skipDupes} onChange={e => setSkipDupes(e.target.checked)} />
                      <span className="text-sm text-yellow-300">Skip duplicate records ({dupes.length} rows)</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-blue-900/20 border border-blue-800/50 rounded-xl px-4 py-3 flex gap-3">
              <Wand2 size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-300">Records will be auto-classified on upload. High/Medium confidence results are marked cleaned instantly. Low confidence records are flagged for review in Data Cleaning.</p>
            </div>

            <div className="card">
              <h2 className="text-base font-semibold text-white mb-4">Preview (first 5 rows)</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>{activeFields.filter(f => mapping[f.key]).map(f => <th key={f.key} className="table-header">{f.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i}>{activeFields.filter(f => mapping[f.key]).map(f => <td key={f.key} className="table-cell">{String(row[f.key] ?? '—')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={upload} className="btn-primary flex items-center gap-2">
                  <Upload size={16} /> Upload {(skipDupes ? rows.length - dupes.length : rows.length).toLocaleString()} Records
                </button>
                <button onClick={() => setStep('mapping')} className="btn-secondary">Back</button>
                <button onClick={reset} className="btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Uploading ── */}
        {step === 'uploading' && (
          <motion.div key="uploading" initial={{ opacity:0 }} animate={{ opacity:1 }} className="card text-center py-20">
            <div className="relative w-16 h-16 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full border-2 border-gray-700" />
              <div className="absolute inset-0 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center"><Rocket size={20} className="text-green-400" /></div>
            </div>
            <p className="text-white text-lg font-semibold mb-1">Uploading & classifying</p>
            <p className="text-gray-500 text-sm mb-6">Auto-classifying records with the Smart Engine</p>
            {progress.total > 0 && (
              <div className="max-w-sm mx-auto">
                <div className="flex justify-between text-xs text-gray-500 mb-2">
                  <span>{progress.done.toLocaleString()} rows processed</span>
                  <span>{Math.round((progress.done / progress.total) * 100)}%</span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ background: 'linear-gradient(90deg, #16a34a, #4ade80)' }}
                    animate={{ width: `${(progress.done / progress.total) * 100}%` }} transition={{ duration: 0.3 }} />
                </div>
                <p className="text-gray-600 text-xs mt-2">{progress.total.toLocaleString()} total records</p>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Done ── */}
        {step === 'done' && result && (
          <motion.div key="done" initial={{ opacity:0, scale:0.97 }} animate={{ opacity:1, scale:1 }} className="card">
            <div className="flex items-center gap-3 mb-6">
              <motion.div initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:'spring', stiffness:300, delay:0.1 }}>
                <CheckCircle size={32} className="text-green-400" style={{ filter: 'drop-shadow(0 0 12px rgba(74,222,128,0.6))' }} />
              </motion.div>
              <div>
                <h2 className="text-xl font-bold text-white">Upload Complete</h2>
                <p className="text-gray-500 text-sm">Records imported and classified successfully</p>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Tile label="Records Added"   value={result.added}               color="green" />
              <Tile label="Auto-Classified" value={result.autoClassifiedCount} color="blue" />
              <Tile label="Need Review"     value={result.needsReviewCount}    color="yellow" />
              <Tile label="Dupes Skipped"   value={result.dupesSkipped}        color="gray" />
            </div>

            {/* Extra fields confirmation */}
            {result.extraColCount > 0 && (
              <div className="bg-purple-900/20 border border-purple-800/40 rounded-xl p-4 mb-4 flex items-start gap-3">
                <Info size={18} className="text-purple-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-medium">
                    {result.extraColCount} extra column{result.extraColCount !== 1 ? 's' : ''} saved as custom data — nothing was lost
                  </p>
                  <p className="text-sm text-gray-400 mt-0.5">
                    All columns that don't match a standard field are preserved in Custom Data. You can browse, search, export, or teach the system to recognise them permanently.
                  </p>
                  <Link to="/custom-data" className="inline-flex items-center gap-1.5 mt-2 text-sm text-purple-300 hover:text-purple-200 underline">
                    View Custom Data →
                  </Link>
                </div>
              </div>
            )}
            {result.needsReviewCount > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-800 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <Wand2 size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-white font-medium">{result.needsReviewCount.toLocaleString()} records need manual classification</p>
                    <p className="text-sm text-gray-400 mt-0.5">Open Data Cleaning to approve or adjust them.</p>
                    <button onClick={() => navigate('/cleaning')} className="btn-primary mt-3 text-sm flex items-center gap-2"><Wand2 size={14} /> Go to Data Cleaning</button>
                  </div>
                </div>
              </div>
            )}
            {result.skipLog?.length > 0 && (
              <details className="text-sm text-gray-400 mb-4">
                <summary className="cursor-pointer text-yellow-400">View error log ({result.skipLog.length} batches failed)</summary>
                <pre className="mt-2 bg-gray-800 rounded p-3 text-xs overflow-auto">{JSON.stringify(result.skipLog, null, 2)}</pre>
              </details>
            )}
            <button onClick={reset} className="btn-secondary">Upload Another File</button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}

function Tile({ label, value, color }) {
  const colors = {
    green:  'text-green-400 border-green-800 bg-green-900/20',
    blue:   'text-blue-400 border-blue-800 bg-blue-900/20',
    yellow: 'text-yellow-400 border-yellow-800 bg-yellow-900/20',
    gray:   'text-gray-400 border-gray-700 bg-gray-800/50',
  }
  return (
    <div className={`border rounded-lg p-3 ${colors[color]}`}>
      <p className={`text-2xl font-bold ${colors[color].split(' ')[0]}`}>{String(value ?? 0)}</p>
      <p className="text-xs mt-0.5 opacity-80">{label}</p>
    </div>
  )
}
