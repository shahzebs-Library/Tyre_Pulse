import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'

const AccidentReportBuilder = lazy(() => import('../components/accidents/AccidentReportBuilder'))
import { AlertOctagon, Plus, Search, X, Save, FileText, Download, BarChart2, Eye, Hourglass, ChevronDown, Trash2, AlertTriangle, TrendingUp, Users, DollarSign, ShieldAlert, Lightbulb, ChevronRight, Clock, ShieldCheck, ArrowLeft, Mail } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'
import { supabase } from '../lib/supabase'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'
import * as accidentsApi from '../lib/api/accidents'
import { getAssetByNo } from '../lib/api/assets'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { formatCurrency as _fmtCurrencyBase, formatDate, formatMonthYear } from '../lib/formatters'
import { resolveStorageUrl } from '../lib/storageRefs'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, LineElement, PointElement, Filler,
  Title, Tooltip as ChartTooltip, Legend,
} from 'chart.js'
import {
  STATUSES, SEVERITIES, ACCIDENT_TYPE_OPTS, DAMAGE_CLASS_OPTS, FAULT_STATUS_OPTS,
  NAJM_STATUS_OPTS, NAJM_FAULT_OPTS, TAQDEER_STATUS_OPTS, LIABILITY_RATIO_OPTS,
  REPAIR_TYPE_OPTS, CLAIM_STATUS_OPTS, CLAIM_STATUS_LABELS,
  RECOVERY_SOURCE_OPTS, RECOVERY_SOURCE_LABELS, RECOVERY_STATUS_OPTS, RECOVERY_STATUS_LABELS,
  CASE_STAGE_OPTS, DAMAGE_CONDITION_OPTS, WORKFLOW_STAGE_OPTS, STAGE_TO_CLAIM_STATUS,
  canonSeverity, canonStatus, canonAccidentType, toDbSeverity, toDbStatus, toDbAccidentType,
  canonFaultStatus, canonNajmStatus, canonNajmFault, canonTaqdeerStatus, canonRepairType, canonDamageClass,
  accidentSeverityPill, accidentStatusPill,
  LIABLE_PARTY_OPTS, PAYER_OPTS, RECOVERY_DECISION_OPTS,
  canonLiableParty, canonPayer, canonDamageCondition,
  najmHasReport, taqdeerHasReport, recoveryIsYes, repairIsInternal, computeRecovered,
} from '../lib/accidentVocab'
import { makeValueLabelsPlugin, doughnutLegendCounts, summarizeChartData, REPORT_LIBRARY, normalizeConfig } from '../lib/accidentReport'
import { listTemplates as listReportTemplates, createTemplate as createReportTemplate } from '../lib/api/accidentReportTemplates'
import { builderReportType } from '../lib/api/scheduledReports'
import { toUserMessage } from '../lib/safeError'
import { hasClaim, isClosed as isClaimClosed, claimNet } from '../lib/claimsAnalytics'
import { captureChartOnPaper } from '../lib/chartCapture'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  ArcElement, LineElement, PointElement, Filler,
  Title, ChartTooltip, Legend,
)

// Option vocabularies + canon/toDb helpers now come from the single shared
// source `src/lib/accidentVocab.js` (imported above) — do NOT re-declare here.

// Section divider for the sectioned incident form.
function FormSection({ title, children }) {
  return (
    <div className="pt-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--input-border)] pb-1.5 mb-3">{title}</p>
      {children}
    </div>
  )
}

// Options for a controlled <select>, prepending the record's stored value when
// it is not one of the canonical options — so converting a free-text field to a
// dropdown never drops an existing (legacy / bespoke) value from a saved record.
const withValueOption = (opts, value) =>
  value && !opts.some(o => String(o) === String(value)) ? [value, ...opts] : opts

// Severity / status list pills now come from the shared accidentVocab helpers
// (accidentSeverityPill / accidentStatusPill) so the register table and the
// /accidents/:id detail page render identical colours — do NOT re-declare
// per-file badge maps here.

const isClosed = (r) => r.closure_status === 'closed' || canonStatus(r.status) === 'Closed'

// ── Case-progress / delay intelligence ──────────────────────────────────────
// New case-tracking columns rendered by the list. They may or may not be part
// of the accidents API's PAGE_COLS yet (a parallel change adds them); the page
// resiliently back-fills any that are missing (see loadRecords) and NEVER
// fabricates a value — absent fields simply render nothing.
const CASE_TRACK_COLS = [
  'damage_class', 'fault_status', 'najm_status', 'najm_fault', 'taqdeer_status',
  'gcc_liability_ratio', 'repair_type', 'next_step', 'workshop_name',
  'workshop_quotation', 'discount_pct', 'final_amount', 'release_date',
]

const DAY_MS = 86400000
const DELAY_THRESHOLD_DAYS = 5

// A case counts as still OPEN unless it is closed (closure_status/status) or its
// free-text current_status reads Released/Closed.
const isReleasedOrClosed = (r) => {
  if (isClosed(r)) return true
  const cur = String(r.current_status || '').toLowerCase()
  return /released|closed/.test(cur)
}

// Whole days since the last status movement; falls back to the incident date
// when no status_update_date is recorded. Returns 0 when neither date parses.
const daysSinceUpdate = (r) => {
  const base = r.status_update_date || r.incident_date
  if (!base) return 0
  const t = new Date(base).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / DAY_MS))
}

// Delayed = still open AND stalled beyond the SLA threshold with no movement.
const isDelayed = (r) => !isReleasedOrClosed(r) && daysSinceUpdate(r) > DELAY_THRESHOLD_DAYS

// Open claim = the incident carries an insurance claim (money / claim status /
// insurer / claim-flavoured status) that has NOT reached a terminal state
// (closed / settled / paid / recovered / rejected / released). Reuses the single
// claims engine helpers so this matches the Claims Summary dashboard exactly.
const isOpenClaim = (r) => hasClaim(r) && !isClaimClosed(r)

// ── Case age ("Days open") ──────────────────────────────────────────────────
// Whole days (>= 0) from the incident date to closure (release_date, when the
// case is closed and a release date exists) or to now for open cases. Returns
// null when incident_date is missing/unparseable — callers render "—" then;
// the value is NEVER fabricated.
const CASE_AGE_GREEN_DAYS = 15
const CASE_AGE_AMBER_DAYS = 30
const caseAgeDays = (r, now = Date.now()) => {
  if (!r?.incident_date) return null
  const start = new Date(r.incident_date).getTime()
  if (Number.isNaN(start)) return null
  // Closed cases are measured incident date -> release date. A CLOSED case with
  // no release date has no honest duration: do NOT let it grow forever to "now"
  // (that produced ever-increasing "days" on settled cases) -> return null so
  // the cell renders 'N/A'. Open cases run incident date -> now.
  if (isReleasedOrClosed(r)) {
    if (!r.release_date) return null
    const rel = new Date(r.release_date).getTime()
    if (Number.isNaN(rel)) return null
    return Math.max(0, Math.floor((rel - start) / DAY_MS))
  }
  return Math.max(0, Math.floor((now - start) / DAY_MS))
}
// Traffic-light tone for OPEN cases: green <= 15d, amber 16-30d, red > 30d.
const caseAgeBadge = (days) =>
  days <= CASE_AGE_GREEN_DAYS
    ? 'bg-green-900/50 text-green-300 border border-green-700/50'
    : days <= CASE_AGE_AMBER_DAYS
      ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50'
      : 'bg-red-900/50 text-red-300 border border-red-700/50'

// Muted chip used by the Days Open cell for closed-case total-duration.
const DIM_CHIP = 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]'

// THE one create/edit form model. This is the ONLY create/update surface for
// an accident record app-wide — the detail page's former per-tab edit forms
// (Tracker / Repair & Insurance / Claim & Recovery) were consolidated in here,
// so every incident + claim + case field is captured the same way in both modes.
const EMPTY_FORM = {
  incident_date: '',
  asset_no: '',
  plate_number: '',
  vehicle_type: '',
  site: '',
  country: '',
  location: '',
  driver_name: '',
  description: '',
  accident_type: '',
  severity: 'Minor',
  status: 'Reported',
  damage_class: '',
  // Claim & insurance
  insurer: '',
  policy_no: '',
  insurance_claim_no: '',
  claim_status: '',
  claim_amount: '',
  claim_approved_amount: '',
  deductible: '',
  recovered_amount: '',
  // Cost recovery (former Claim & Recovery tab)
  recovery_status: '',
  recovery_source: '',
  recovery_date: '',
  recovery_reference: '',
  amount_transfer: '',
  // Parties & liability (former Claim tab)
  responsible_party: '',
  liable_party: '',
  payer: '',
  // GCC case / liability
  fault_status: '',
  gcc_liability_ratio: '',
  najm_status: '',
  najm_fault: '',
  taqdeer_status: '',
  taqdeer_no: '',
  // Case tracking & workflow (former Tracker / Repair & Insurance tabs)
  case_stage: '',
  damage_condition: '',
  current_status: '',
  next_step: '',
  responsible_owner: '',
  // "Action / Progress" (single merged field) — persisted to BOTH the
  // required_action and action_to_be_taken columns on save.
  required_action: '',
  status_update_date: '',
  status_update_note: '',
  // Repair
  repair_type: '',
  workshop_name: '',
  workshop_location: '',
  workshop_quotation: '',
  discount_pct: '',
  final_amount: '',
  estimated_damage_cost: '',
  repair_cost: '',
  expected_release_date: '',
  release_date: '',
  inspector: '',
  photos: [],
}

// On-screen value labels: light ink readable on the dark UI theme (the report
// builder's paper renderer uses the default dark-ink variant of the same plugin).
const LIGHT_VALUE_LABELS = makeValueLabelsPlugin('#e2e8f0')

const CHART_OPTS_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  // Headroom so the value labels drawn above bars/points never clip.
  layout: { padding: { top: 14 } },
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: 'var(--panel-2)', titleColor:'var(--panel-ink)', bodyColor: '#9ca3af', borderColor: 'var(--hairline)', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#374151' }, beginAtZero: true },
  },
}

const CHART_OPTS_H = {
  ...CHART_OPTS_BASE,
  indexAxis: 'y',
  // Right-side headroom for the value printed at the end of each horizontal bar.
  layout: { padding: { top: 6, right: 30 } },
  plugins: {
    ...CHART_OPTS_BASE.plugins,
    legend: { display: false },
  },
}

const CHART_OPTS_STACKED = {
  ...CHART_OPTS_BASE,
  plugins: {
    ...CHART_OPTS_BASE.plugins,
    legend: { display: true, labels: { color: '#9ca3af', font: { size: 11 } } },
  },
  scales: {
    x: { ...CHART_OPTS_BASE.scales.x, stacked: true },
    y: { ...CHART_OPTS_BASE.scales.y, stacked: true },
  },
}

const CHART_OPTS_DOUGHNUT = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: {
    // Slice counts appended to each legend entry (e.g. "Major (4)") so the
    // doughnuts carry real numbers on screen and in the analytics PDF capture.
    legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 12, padding: 12, font: { size: 11 }, generateLabels: doughnutLegendCounts } },
    tooltip: CHART_OPTS_BASE.plugins.tooltip,
  },
}

const CHART_OPTS_LINE = {
  ...CHART_OPTS_BASE,
  plugins: { ...CHART_OPTS_BASE.plugins, legend: { display: false } },
  elements: { line: { tension: 0.35 }, point: { radius: 3, hoverRadius: 5 } },
}

// Shared categorical palette for doughnut segments.
const PIE_COLORS = ['#ea580c', '#3b82f6', '#16a34a', '#9333ea', '#dc2626', '#ca8a04', '#0891b2', '#64748b']

function monthKey(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function last12MonthKeys() {
  const keys = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

function monthLabel(key) {
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return formatMonthYear(d)
}

export default function Accidents() {
  const reportMeta = useReportMeta('Accident & Claims Tracker')
  const { profile } = useAuth()
  const { activeCountry, activeCurrency, appSettings } = useSettings()
  const fmtCurrency = (val) => _fmtCurrencyBase(val, activeCurrency, 0)
  const navigate = useNavigate()
  const location = useLocation()
  // URL is the single source of truth for the shareable "open claims" filter,
  // so a saved/shared link (`/accidents?claims=open`) opens the register already
  // filtered. Deriving straight from the param (no mirrored state) keeps the
  // toggle, the URL and a pasted link perfectly in sync.
  const [searchParams, setSearchParams] = useSearchParams()
  const filterOpenClaims = searchParams.get('claims') === 'open'
  const setOpenClaims = useCallback((on) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      if (on) p.set('claims', 'open'); else p.delete('claims')
      return p
    }, { replace: true })
  }, [setSearchParams])

  const [tab, setTab]                  = useState('incidents')
  const [records, setRecords]          = useState([])
  const [loading, setLoading]          = useState(true)
  const [error, setError]              = useState('')
  const [showForm, setShowForm]      = useState(false)
  const [editId, setEditId]            = useState(null)
  const [saving, setSaving]            = useState(false)
  const [formError, setFormError]      = useState('')
  const [form, setForm]                = useState(EMPTY_FORM)

  const [search, setSearch]                    = useState('')
  const [filterSite, setFilterSite]            = useState('')
  const [filterSeverity, setFilterSeverity]    = useState('')
  const [filterStatus, setFilterStatus]        = useState('')
  const [filterFrom, setFilterFrom]            = useState('')
  const [filterTo, setFilterTo]                = useState('')
  const [statusFunnel, setStatusFunnel]        = useState('')
  const [onlyPendingClosure, setOnlyPendingClosure] = useState(false)
  const [filterDelayed, setFilterDelayed]      = useState(false)
  const [filterStage, setFilterStage]          = useState('')
  const [filterRepairType, setFilterRepairType] = useState('')
  const [filterFault, setFilterFault]          = useState('')
  const [filterAge, setFilterAge]              = useState('') // '' | '0-15' | '16-30' | '30+' — open cases only

  // Row → dedicated detail page (`/accidents/:id`). The former inline modal +
  // companion approval panel now live on that route; the approval engine there
  // owns the record's lock/edit gating end-to-end.
  const openDetail = useCallback((id) => navigate(`/accidents/${id}`), [navigate])

  // Multi-select bulk delete (Admin only)
  const isAdmin = (profile?.role || '').toLowerCase() === 'admin'
  const [selectedIds, setSelectedIds]          = useState(() => new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen]    = useState(false)
  const [bulkError, setBulkError]              = useState('')
  const [bulkBusy, setBulkBusy]                = useState(false)

  // Asset search combobox
  const [fleetAssets, setFleetAssets]          = useState([])
  const [assetQuery, setAssetQuery]            = useState('')
  const [showAssetDrop, setShowAssetDrop]      = useState(false)
  const assetDropRef                           = useRef(null)
  // Matched vehicle-master row for the currently entered asset (read-only
  // context shown under the Asset field). Auto-populate reads from here.
  const [assetInfo, setAssetInfo]              = useState(null)

  const loadRecords = useCallback(async () => {
    setLoading(true)
    // Paginate past the 1000-row cap so the list AND its exports are complete.
    const { data, error: err } = await accidentsApi.listAllAccidentsForPage({ country: activeCountry })
    if (err) { setError(err.message); setLoading(false); return }
    setError('')
    let rows = data ?? []
    // Resilient back-fill: if the accidents API select does not yet expose the
    // new case-tracking columns (parallel PAGE_COLS change), read only those
    // columns directly by id and merge. Skipped entirely once PAGE_COLS carries
    // them (zero extra query). Error-tolerant: if the columns do not exist yet
    // the merge is a no-op and the list degrades to honest empty chips.
    if (rows.length && !('gcc_liability_ratio' in rows[0])) {
      try {
        const byId = new Map()
        const ids = rows.map(r => r.id)
        for (let i = 0; i < ids.length; i += 500) {
          const { data: ext } = await supabase
            .from('accidents')
            .select(`id,${CASE_TRACK_COLS.join(',')}`)
            .in('id', ids.slice(i, i + 500))
          ext?.forEach(e => byId.set(e.id, e))
        }
        if (byId.size) rows = rows.map(r => ({ ...r, ...(byId.get(r.id) || {}) }))
      } catch { /* new columns not present yet — honest empty states */ }
    }
    // Canonicalise the DB's lowercase status/severity to display labels once, so
    // every label-based consumer (status/severity counts, funnel filters, charts,
    // badges) agrees. Save/edit paths convert back via toDb*/canon* helpers.
    setRecords(rows.map(r => ({ ...r, status: canonStatus(r.status), severity: canonSeverity(r.severity), accident_type: canonAccidentType(r.accident_type) })))
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { loadRecords() }, [loadRecords])

  // Deep-link into the ONE unified editor: the detail page's "Edit Incident"
  // action navigates here with { state: { editId } }. Once records are loaded,
  // open that record in the inline form and clear the state so refresh/back
  // does not re-open it.
  useEffect(() => {
    const editId = location.state?.editId
    if (!editId || loading) return
    const row = records.find(r => String(r.id) === String(editId))
    navigate('/accidents', { replace: true, state: null })
    if (row) openEdit(row)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, loading, records])

  // Load fleet assets for search combobox
  useEffect(() => {
    accidentsApi.listAccidentFleet()
      .then((data) => setFleetAssets(data ?? []))
      .catch(() => setFleetAssets([]))
  }, [])

  // Close asset dropdown on outside click
  useEffect(() => {
    function handle(e) {
      if (assetDropRef.current && !assetDropRef.current.contains(e.target)) setShowAssetDrop(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const assetSuggestions = useMemo(() => {
    if (!assetQuery.trim()) return []
    const q = assetQuery.toLowerCase()
    return fleetAssets.filter(a =>
      a.asset_no?.toLowerCase().includes(q) ||
      a.vehicle_type?.toLowerCase().includes(q) ||
      a.site?.toLowerCase().includes(q)
    ).slice(0, 10)
  }, [assetQuery, fleetAssets])

  // Auto-populate related fields from the vehicle master (vehicle_fleet). Only
  // real accidents columns are written (plate_number, vehicle_type, site,
  // country) and ONLY when the user has not already filled them — a typed value
  // is never overwritten. Plate comes from the master's registration_no. The
  // full master row is kept in `assetInfo` for read-only context (make/model).
  const applyAssetMaster = useCallback((asset) => {
    if (!asset) { setAssetInfo(null); return }
    setAssetInfo(asset)
    setForm(f => ({
      ...f,
      plate_number: f.plate_number || asset.registration_no || f.plate_number,
      vehicle_type: f.vehicle_type || asset.vehicle_type    || f.vehicle_type,
      site:         f.site         || asset.site            || f.site,
      country:      f.country      || asset.country         || f.country,
    }))
  }, [])

  function selectAsset(asset) {
    setForm(f => ({ ...f, asset_no: asset.asset_no }))
    setAssetQuery(asset.asset_no)
    setShowAssetDrop(false)
    applyAssetMaster(asset)
  }

  // Debounced lookup: whenever the asset number changes (typed or picked),
  // resolve it against the fleet master and auto-fill site/country. Matches the
  // already-loaded fleet list first (instant), then falls back to a direct
  // org-scoped vehicle_fleet query. Fails silently when there is no match.
  useEffect(() => {
    const no = (form.asset_no || '').trim()
    if (!no) { setAssetInfo(null); return }
    const t = setTimeout(async () => {
      let asset = fleetAssets.find(a => (a.asset_no || '').toLowerCase() === no.toLowerCase())
      if (!asset) {
        try { asset = await getAssetByNo(no) } catch { asset = null }
      }
      if (asset && (asset.asset_no || '').toLowerCase() === no.toLowerCase()) applyAssetMaster(asset)
      else setAssetInfo(null)
    }, 350)
    return () => clearTimeout(t)
  }, [form.asset_no, fleetAssets, applyAssetMaster])

  const sites = useMemo(() => [...new Set(records.map(r => r.site).filter(Boolean))].sort(), [records])

  // Distinct case stage / current-status values actually present in the data,
  // for the stage filter (honest — only real values, no placeholder options).
  const stageOptions = useMemo(
    () => [...new Set(records.flatMap(r => [r.current_status, r.case_stage]).filter(Boolean))].sort(),
    [records],
  )

  const stats = useMemo(() => {
    const total  = records.length
    const open   = records.filter(r => !isClosed(r)).length
    const delayed = records.filter(isDelayed).length
    const insur  = records.filter(r => canonStatus(r.status) === 'Insurance Claim' || (r.claim_status && r.claim_status !== 'none')).length
    const openClaims = records.filter(isOpenClaim).length
    const cost   = records.reduce((s, r) => s + (Number(r.repair_cost) || 0) + (Number(r.parts_cost) || 0), 0)
    const closed = records.filter(r => isClosed(r))
    // Avg days to CLOSE: incident date -> release date, over closed cases that
    // actually recorded a release date (an honest case-cycle time). The old calc
    // used updated_at - created_at (system row lifetime), which measured DB churn
    // not case duration. avgDaysDenom exposes how many cases fed the average so
    // the label can stay honest when release dates are missing.
    let avgDays = 0
    let avgDaysDenom = 0
    if (closed.length > 0) {
      let totalDays = 0
      closed.forEach(r => {
        if (r.incident_date && r.release_date) {
          const d = (new Date(r.release_date) - new Date(r.incident_date)) / 86400000
          if (Number.isFinite(d) && d >= 0) { totalDays += d; avgDaysDenom++ }
        }
      })
      avgDays = avgDaysDenom > 0 ? Math.round(totalDays / avgDaysDenom) : 0
    }

    // Severity mix
    const sevMix = { Minor: 0, Major: 0, 'Total Loss': 0 }
    records.forEach(r => { const s = canonSeverity(r.severity); if (sevMix[s] !== undefined) sevMix[s]++ })

    // At-fault %: a record is "at fault" when the liable/responsible party points
    // to the driver/company rather than a third party. Only records with an
    // explicit liability signal count toward the denominator so the ratio is honest.
    const faultText = (r) => `${r.liable_party || ''} ${r.responsible_party || ''}`.toLowerCase()
    const withLiability = records.filter(r => faultText(r).trim())
    const thirdParty = /third\s*party|3rd\s*party|other\s*driver|not\s*at\s*fault|no\s*fault/
    const atFaultCount = withLiability.filter(r => !thirdParty.test(faultText(r))).length
    const atFaultPct = withLiability.length ? Math.round((atFaultCount / withLiability.length) * 100) : 0

    // Average claim cost across records that actually carry a cost (repair+parts).
    const withCost = records.filter(r => (Number(r.repair_cost) || 0) + (Number(r.parts_cost) || 0) > 0)
    const avgClaim = withCost.length ? Math.round(cost / withCost.length) : 0

    // Accidents per 100 vehicles (fleet-normalised frequency).
    const fleetSize = fleetAssets.length
    const per100 = fleetSize > 0 ? Number(((total / fleetSize) * 100).toFixed(1)) : 0

    return { total, open, delayed, insur, openClaims, cost, avgDays, avgDaysDenom, sevMix, atFaultPct, atFaultCount, atFaultDenom: withLiability.length, avgClaim, per100, fleetSize }
  }, [records, fleetAssets])

  // Monthly incidents chart (incidents tab)
  const chartData = useMemo(() => {
    const keys = last12MonthKeys()
    const counts = {}
    keys.forEach(k => { counts[k] = 0 })
    records.forEach(r => {
      const k = monthKey(r.incident_date)
      if (k && counts[k] !== undefined) counts[k]++
    })
    return {
      labels: keys.map(k => monthLabel(k)),
      datasets: [{
        label: 'Incidents',
        data: keys.map(k => counts[k]),
        backgroundColor: 'rgba(22,163,74,0.7)',
        borderColor: '#16a34a',
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [records])

  const statusCounts = useMemo(() => {
    const c = {}
    STATUSES.forEach(s => { c[s] = 0 })
    records.forEach(r => { if (c[r.status] !== undefined) c[r.status]++ })
    return c
  }, [records])

  // ---- Analytics data ----

  // Top 5 assets by incident count
  const topAssetsChart = useMemo(() => {
    const counts = {}
    records.forEach(r => {
      if (r.asset_no) counts[r.asset_no] = (counts[r.asset_no] ?? 0) + 1
    })
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    return {
      labels: sorted.map(([k]) => k),
      datasets: [{
        label: 'Incidents',
        data: sorted.map(([, v]) => v),
        backgroundColor: 'rgba(234,88,12,0.7)',
        borderColor: '#ea580c',
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [records])

  // Monthly severity stacked bar
  const severityMonthlyChart = useMemo(() => {
    const keys = last12MonthKeys()
    const bySev = {}
    SEVERITIES.forEach(s => {
      bySev[s] = {}
      keys.forEach(k => { bySev[s][k] = 0 })
    })
    records.forEach(r => {
      const k = monthKey(r.incident_date)
      if (k && bySev[r.severity] && bySev[r.severity][k] !== undefined) bySev[r.severity][k]++
    })
    const colors = { Minor: 'rgba(107,114,128,0.7)', Major: 'rgba(234,88,12,0.7)', 'Total Loss': 'rgba(220,38,38,0.7)' }
    const borders = { Minor: '#6b7280', Major: '#ea580c', 'Total Loss': '#dc2626' }
    return {
      labels: keys.map(k => monthLabel(k)),
      datasets: SEVERITIES.map(s => ({
        label: s,
        data: keys.map(k => bySev[s][k]),
        backgroundColor: colors[s],
        borderColor: borders[s],
        borderWidth: 1,
        borderRadius: 2,
      })),
    }
  }, [records])

  // Incidents by site
  const bySiteChart = useMemo(() => {
    const counts = {}
    records.forEach(r => {
      if (r.site) counts[r.site] = (counts[r.site] ?? 0) + 1
    })
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    return {
      labels: sorted.map(([k]) => k),
      datasets: [{
        label: 'Incidents',
        data: sorted.map(([, v]) => v),
        backgroundColor: 'rgba(59,130,246,0.7)',
        borderColor: '#3b82f6',
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [records])

  // Status funnel data for analytics
  const funnelStatuses = [
    'Reported',
    'Under Investigation',
    'Repair In Progress',
    'Awaiting Parts',
    'Awaiting Approval',
    'Insurance Claim',
    'Closed',
  ]
  const funnelData = useMemo(() => {
    const total = records.length || 1
    return funnelStatuses.map(s => ({
      status: s,
      count: statusCounts[s] ?? 0,
      pct: Math.round(((statusCounts[s] ?? 0) / total) * 100),
    }))
  }, [records, statusCounts])

  // ---- Claims & cost-recovery analytics (V19 module) ----
  const claimAnalytics = useMemo(() => {
    let totalClaim = 0, totalApproved = 0, totalParts = 0, totalRepair = 0, totalDeductible = 0, totalRecovered = 0
    const byStatus = { none: 0, filed: 0, approved: 0, rejected: 0, settled: 0 }
    const byRecovery = { pending: 0, partial: 0, recovered: 0, written_off: 0 }
    const byPayer = {}
    let pendingClosure = 0, closedApproved = 0
    records.forEach(r => {
      totalClaim      += Number(r.claim_amount) || 0
      totalApproved   += Number(r.claim_approved_amount) || 0
      totalParts      += Number(r.parts_cost) || 0
      totalRepair     += Number(r.repair_cost) || 0
      totalDeductible += Number(r.deductible) || 0
      totalRecovered  += Number(r.recovered_amount) || 0
      const cs = r.claim_status || 'none'
      if (byStatus[cs] !== undefined) byStatus[cs]++
      const rs = r.recovery_status || 'pending'
      if (byRecovery[rs] !== undefined) byRecovery[rs]++
      const cost = (Number(r.repair_cost) || 0) + (Number(r.parts_cost) || 0)
      if (cost > 0) { const p = r.payer || 'Unassigned'; byPayer[p] = (byPayer[p] || 0) + cost }
      if (r.closure_status === 'pending_closure') pendingClosure++
      if (r.closure_status === 'closed') closedApproved++
    })
    const grossCost   = totalRepair + totalParts
    const recovery    = grossCost > 0 ? Math.round((totalRecovered / grossCost) * 100) : 0
    const netExposure = Math.max(0, grossCost - totalRecovered)
    return {
      totalClaim, totalApproved, totalParts, totalRepair, totalDeductible, totalRecovered,
      grossCost, recovery, netExposure, byStatus, byRecovery, byPayer, pendingClosure, closedApproved,
    }
  }, [records])

  const claimStatusChart = useMemo(() => {
    const order = ['filed', 'approved', 'settled', 'rejected', 'none']
    const labels = { none: 'No Claim', filed: 'Filed', approved: 'Approved', rejected: 'Rejected', settled: 'Settled' }
    const colors = { none: '#6b7280', filed: '#3b82f6', approved: '#16a34a', rejected: '#dc2626', settled: '#9333ea' }
    return {
      labels: order.map(k => labels[k]),
      datasets: [{
        label: 'Claims',
        data: order.map(k => claimAnalytics.byStatus[k] ?? 0),
        backgroundColor: order.map(k => colors[k] + 'b3'),
        borderColor: order.map(k => colors[k]),
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [claimAnalytics])

  const payerCostChart = useMemo(() => {
    const sorted = Object.entries(claimAnalytics.byPayer).sort((a, b) => b[1] - a[1]).slice(0, 6)
    return {
      labels: sorted.map(([k]) => k),
      datasets: [{
        label: 'Cost',
        data: sorted.map(([, v]) => v),
        backgroundColor: 'rgba(168,85,247,0.7)',
        borderColor: '#a855f7',
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [claimAnalytics])

  const pendingClosures = useMemo(
    () => records.filter(r => r.closure_status === 'pending_closure').length,
    [records],
  )

  // ── Richer visual charts (doughnuts + trend line) ───────────────────────────
  const severityDoughnut = useMemo(() => {
    const counts = {}
    records.forEach(r => { const k = canonSeverity(r.severity) || 'Unspecified'; counts[k] = (counts[k] ?? 0) + 1 })
    const entries = Object.entries(counts)
    const color = { Minor: '#64748b', Major: '#ea580c', 'Total Loss': '#dc2626', Unspecified: '#334155' }
    return {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map(([k], i) => color[k] || PIE_COLORS[i % PIE_COLORS.length]), borderWidth: 0 }],
    }
  }, [records])

  const statusDoughnut = useMemo(() => {
    const counts = {}
    records.forEach(r => { const k = canonStatus(r.status) || 'Reported'; counts[k] = (counts[k] ?? 0) + 1 })
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    return {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]), borderWidth: 0 }],
    }
  }, [records])

  // Open vs closed monthly trend (last 12 months) — an area line.
  const monthlyTrendLine = useMemo(() => {
    const keys = last12MonthKeys()
    const totals = Object.fromEntries(keys.map(k => [k, 0]))
    records.forEach(r => { const k = monthKey(r.incident_date); if (k && totals[k] !== undefined) totals[k]++ })
    return {
      labels: keys.map(k => monthLabel(k)),
      datasets: [{
        label: 'Incidents',
        data: keys.map(k => totals[k]),
        borderColor: '#ea580c',
        backgroundColor: 'rgba(234,88,12,0.18)',
        fill: true,
      }],
    }
  }, [records])

  // Fault / liability split from the GCC case fields (honest — Unknown when unset).
  const faultDoughnut = useMemo(() => {
    const c = { Faulty: 0, 'Non-faulty': 0, 'Under review': 0, Unknown: 0 }
    records.forEach(r => {
      const f = String(r.fault_status || '').toLowerCase()
      if (/non[-\s]?fault/.test(f)) c['Non-faulty']++
      else if (/review/.test(f)) c['Under review']++
      else if (/fault/.test(f)) c.Faulty++
      else c.Unknown++
    })
    const entries = Object.entries(c).filter(([, v]) => v > 0)
    const color = { Faulty: '#dc2626', 'Non-faulty': '#16a34a', 'Under review': '#ca8a04', Unknown: '#334155' }
    return {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map(([k]) => color[k]), borderWidth: 0 }],
    }
  }, [records])

  // ── Engineering / Ops Intelligence (V-accident intelligence layer) ──────────
  // Derives repeat-offender assets & drivers, cost hotspots by site, root-cause
  // groupings, and prioritised recommendations — all from the live record set.
  const opsIntel = useMemo(() => {
    const grossOf = (r) => (Number(r.repair_cost) || 0) + (Number(r.parts_cost) || 0)
    const totalGross = records.reduce((s, r) => s + grossOf(r), 0)

    // Repeat-offender assets (>= 2 incidents), ranked by count then cost.
    const assetMap = {}
    records.forEach(r => {
      if (!r.asset_no) return
      const a = assetMap[r.asset_no] || (assetMap[r.asset_no] = { asset_no: r.asset_no, site: r.site, count: 0, cost: 0, lastDate: null })
      a.count++; a.cost += grossOf(r)
      if (!a.lastDate || (r.incident_date && r.incident_date > a.lastDate)) a.lastDate = r.incident_date
    })
    const repeatAssets = Object.values(assetMap).filter(a => a.count >= 2)
      .sort((a, b) => b.count - a.count || b.cost - a.cost).slice(0, 8)

    // Repeat-offender drivers (>= 2 incidents).
    const driverMap = {}
    records.forEach(r => {
      const d = (r.driver_name || '').trim()
      if (!d) return
      const o = driverMap[d] || (driverMap[d] = { driver: d, count: 0, cost: 0 })
      o.count++; o.cost += grossOf(r)
    })
    const repeatDrivers = Object.values(driverMap).filter(d => d.count >= 2)
      .sort((a, b) => b.count - a.count || b.cost - a.cost).slice(0, 8)

    // Cost hotspots by site (cost, incident count, avg cost).
    const siteMap = {}
    records.forEach(r => {
      const s = r.site || 'Unassigned'
      const o = siteMap[s] || (siteMap[s] = { site: s, count: 0, cost: 0 })
      o.count++; o.cost += grossOf(r)
    })
    const siteHotspots = Object.values(siteMap)
      .map(s => ({ ...s, avg: s.count ? Math.round(s.cost / s.count) : 0, pct: totalGross ? Math.round((s.cost / totalGross) * 100) : 0 }))
      .sort((a, b) => b.cost - a.cost).slice(0, 6)

    // Root-cause groupings: prefer accident_type, fall back to damage_condition.
    const causeMap = {}
    records.forEach(r => {
      const c = (r.accident_type || r.damage_condition || 'Uncategorised').trim() || 'Uncategorised'
      const o = causeMap[c] || (causeMap[c] = { cause: c, count: 0, cost: 0 })
      o.count++; o.cost += grossOf(r)
    })
    const rootCauses = Object.values(causeMap)
      .map(c => ({ ...c, pct: records.length ? Math.round((c.count / records.length) * 100) : 0 }))
      .sort((a, b) => b.count - a.count).slice(0, 8)
    const uncategorised = records.filter(r => !(r.accident_type || r.damage_condition)).length

    // Recovery leakage: closed/at-fault records with unrecovered cost.
    const recoverable = records.filter(r =>
      (r.claim_status && r.claim_status !== 'none') && (Number(r.recovered_amount) || 0) === 0 && grossOf(r) > 0)
    const leakage = recoverable.reduce((s, r) => s + grossOf(r), 0)

    // Data-quality flags.
    const missingCost = records.filter(r => !((Number(r.repair_cost) || 0) + (Number(r.parts_cost) || 0) + (Number(r.estimated_damage_cost) || 0))).length
    const missingDriver = records.filter(r => !(r.driver_name || '').trim()).length
    const staleOpen = records.filter(r => !isClosed(r) && r.incident_date && (Date.now() - new Date(r.incident_date)) > 60 * 86400000).length

    // Prioritised recommendations, each tied to a concrete number.
    const recs = []
    if (repeatAssets.length) {
      const top = repeatAssets[0]
      recs.push({ level: 'high', icon: 'asset', text: `Asset ${top.asset_no} has ${top.count} incidents (${fmtCurrency(top.cost)} total). Schedule a driver-behaviour review, alignment/brake inspection, and route audit for this unit.` })
    }
    if (repeatDrivers.length) {
      const td = repeatDrivers[0]
      recs.push({ level: 'high', icon: 'driver', text: `Driver "${td.driver}" is linked to ${td.count} incidents (${fmtCurrency(td.cost)}). Enrol in defensive-driving retraining and add to the watch list.` })
    }
    if (leakage > 0) {
      recs.push({ level: 'high', icon: 'money', text: `${recoverable.length} filed claim${recoverable.length !== 1 ? 's' : ''} worth ${fmtCurrency(leakage)} have zero recovery logged. Chase insurer/third-party recovery to cut net exposure.` })
    }
    if (siteHotspots.length && siteHotspots[0].pct >= 30) {
      recs.push({ level: 'medium', icon: 'site', text: `${siteHotspots[0].site} concentrates ${siteHotspots[0].pct}% of accident cost (${fmtCurrency(siteHotspots[0].cost)}). Audit yard layout, speed limits and manoeuvring space at this site.` })
    }
    if (stats.atFaultDenom >= 5 && stats.atFaultPct >= 50) {
      recs.push({ level: 'medium', icon: 'fault', text: `${stats.atFaultPct}% of liability-tagged incidents are at-fault. High controllable-loss ratio — prioritise driver training and supervision.` })
    }
    if (uncategorised >= Math.max(3, records.length * 0.2)) {
      recs.push({ level: 'low', icon: 'data', text: `${uncategorised} incidents have no accident type / damage condition. Enforce cause capture at intake so root-cause analytics stay reliable.` })
    }
    if (staleOpen > 0) {
      recs.push({ level: 'medium', icon: 'time', text: `${staleOpen} incident${staleOpen !== 1 ? 's are' : ' is'} open >60 days. Review for stalled claims/repairs and drive to closure.` })
    }
    if (pendingClosures > 0) {
      recs.push({ level: 'low', icon: 'time', text: `${pendingClosures} closure${pendingClosures !== 1 ? 's' : ''} awaiting admin approval. Clear the approval queue to finalise records.` })
    }

    return {
      repeatAssets, repeatDrivers, siteHotspots, rootCauses, uncategorised,
      leakage, recoverableCount: recoverable.length,
      dataQuality: { missingCost, missingDriver, staleOpen },
      recs,
    }
  }, [records, fmtCurrency, stats, pendingClosures])

  // ── Analytics tab: live-canvas capture + compact PDF download ──────────────
  // Refs hold the chart.js instances (react-chartjs-2 v5 forwards the instance)
  // so the download captures EXACTLY what is on screen via toBase64Image().
  const chartRefs = useRef({})
  const setChartRef = (key) => (el) => { chartRefs.current[key] = el }
  const [dlAnalytics, setDlAnalytics] = useState({ busy: false, msg: '', ok: true })
  const dlTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(dlTimerRef.current), [])
  const flashDl = (msg, ok) => {
    setDlAnalytics({ busy: false, msg, ok })
    clearTimeout(dlTimerRef.current)
    dlTimerRef.current = setTimeout(() => setDlAnalytics(s => ({ ...s, msg: '' })), 5000)
  }

  async function downloadAnalyticsPdf() {
    setDlAnalytics({ busy: true, msg: '', ok: true })
    try {
      // Charts in on-screen order; refs are null for charts hidden by their
      // honest "No data" empty state, so those drop out automatically.
      const chartList = [
        { key: 'severity',    title: 'Severity Distribution',                data: severityDoughnut },
        { key: 'status',      title: 'Status Distribution',                  data: statusDoughnut },
        { key: 'fault',       title: 'Fault Status (GCC)',                   data: faultDoughnut },
        { key: 'trend',       title: 'Incident Trend (last 12 months)',      data: monthlyTrendLine },
        { key: 'topAssets',   title: 'Top 5 Assets by Incidents',            data: topAssetsChart },
        { key: 'bySite',      title: 'Incidents by Site',                    data: bySiteChart },
        { key: 'sevMonthly',  title: 'Monthly Severity Breakdown',           data: severityMonthlyChart },
        { key: 'claimStatus', title: 'Claim Status Breakdown',               data: claimStatusChart },
        { key: 'payerCost',   title: 'Cost by Responsible Payer',            data: payerCostChart },
      ]
        .map(c => ({ ...c, chart: chartRefs.current[c.key] }))
        .filter(c => c.chart && c.chart.canvas)
        .slice(0, 12) // HARD CAP: 6 per page x max 2 pages

      const { default: jsPDF } = await import('jspdf')
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const W = doc.internal.pageSize.getWidth()
      const H = doc.internal.pageSize.getHeight()
      const M = 10
      const company = appSettings?.company_name || 'TyrePulse'
      const stamp = new Date().toISOString().slice(0, 10)
      const scope = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
      const INK = [15, 23, 42]
      const MUTED = [100, 116, 139]

      // ── Page 1 header ──
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...INK)
      doc.text('Accident Analytics Summary', M, 14)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED)
      doc.text(`${company} | Generated ${stamp} | ${records.length} incidents | Scope: ${scope}`, M, 20)

      // ── KPI number strip (live page aggregates) ──
      const pendingRelease = records.filter(r => !isClosed(r) && !r.expected_release_date).length
      const kpis = [
        ['Total incidents', String(stats.total)],
        ['Open', String(stats.open)],
        ['Closed', String(stats.total - stats.open)],
        [`Delayed > ${DELAY_THRESHOLD_DAYS}d`, String(stats.delayed)],
        ['Pending release', String(pendingRelease)],
        ['Repair cost', String(fmtCurrency(stats.cost))],
        ['Claimed', String(fmtCurrency(claimAnalytics.totalClaim))],
        ['Recovered', String(fmtCurrency(claimAnalytics.totalRecovered))],
      ]
      const stripY = 24
      const kw = (W - 2 * M) / kpis.length
      kpis.forEach(([label, value], i) => {
        const x = M + i * kw
        doc.setDrawColor(226, 232, 240); doc.setFillColor(248, 250, 252)
        doc.roundedRect(x + 0.8, stripY, kw - 1.6, 14, 1.5, 1.5, 'FD')
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK)
        doc.text(value, x + kw / 2, stripY + 6.4, { align: 'center' })
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.setTextColor(...MUTED)
        doc.text(label.toUpperCase(), x + kw / 2, stripY + 11.2, { align: 'center' })
      })

      // ── Chart grid: 3 x 2 per page, at most 2 pages, never a 3rd ──
      const drawChartCell = (c, x, y, cw, ch) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
        doc.text(c.title, x, y + 3.2, { maxWidth: cw })
        // White card behind the capture: charts are re-rendered on a paper theme
        // (dark ink on white) so they print cleanly — no black background.
        const imgY = y + 5.2
        const imgH = ch - 11
        doc.setDrawColor(226, 232, 240); doc.setFillColor(255, 255, 255)
        doc.roundedRect(x, imgY, cw, imgH, 1.5, 1.5, 'FD')
        const img = captureChartOnPaper(c.chart) || c.chart.toBase64Image('image/png', 1)
        const iw0 = c.chart.width || c.chart.canvas.width
        const ih0 = c.chart.height || c.chart.canvas.height
        const scale = Math.min((cw - 4) / iw0, (imgH - 4) / ih0)
        const iw = iw0 * scale
        const ih = ih0 * scale
        doc.addImage(img, 'PNG', x + (cw - iw) / 2, imgY + (imgH - ih) / 2, iw, ih)
        const digest = summarizeChartData(c.data)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(...MUTED)
        doc.text(digest || 'No data in scope', x, y + ch - 1.6, { maxWidth: cw })
      }
      const drawGrid = (charts, y0) => {
        const gap = 5
        const cw = (W - 2 * M - 2 * gap) / 3
        const ch = (H - y0 - M - gap) / 2
        charts.forEach((c, i) => {
          const col = i % 3
          const row = Math.floor(i / 3)
          drawChartCell(c, M + col * (cw + gap), y0 + row * (ch + gap), cw, ch)
        })
      }
      drawGrid(chartList.slice(0, 6), 43)
      if (chartList.length > 6) {
        doc.addPage()
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK)
        doc.text('Accident Analytics Summary (continued)', M, 12)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
        doc.text(`${company} | ${stamp} | page 2 of 2`, W - M, 12, { align: 'right' })
        drawGrid(chartList.slice(6, 12), 16)
      }

      doc.save(`${reportFileName(company, 'Accident Analytics', reportDateLabel())}.pdf`)
      flashDl(`Analytics PDF downloaded (${chartList.length} charts, ${chartList.length > 6 ? 2 : 1} page${chartList.length > 6 ? 's' : ''}).`, true)
    } catch (e) {
      flashDl(`Download failed: ${e?.message || 'unexpected error'}`, false)
    }
  }

  // Turn the on-screen Analytics into a recurring auto-emailed report. Reuses the
  // existing Accident Report Builder + Scheduled Reports pipeline (no duplication):
  // ensure a saved layout that mirrors this dashboard exists (create once, reuse
  // thereafter), then hand off to Scheduled Reports with it pre-selected so the
  // user only picks cadence + recipients. The cron edge fn renders + e-mails the
  // exact layout on schedule.
  const ANALYTICS_LAYOUT_NAME = 'Accidents Analytics'
  const [schedBusy, setSchedBusy] = useState(false)
  async function scheduleAnalytics() {
    setSchedBusy(true)
    try {
      const templates = await listReportTemplates()
      let tpl = templates.find(t => (t.name || '').trim().toLowerCase() === ANALYTICS_LAYOUT_NAME.toLowerCase())
      if (!tpl) {
        const pack = REPORT_LIBRARY.find(p => p.key === 'analytics')
        const config = normalizeConfig({ blocks: pack.build(), orientation: pack.orientation })
        tpl = await createReportTemplate({
          name: ANALYTICS_LAYOUT_NAME,
          description: 'Auto-email version of the Accidents Analytics dashboard.',
          config,
        })
      }
      navigate('/scheduled-reports', {
        state: { presetReportType: builderReportType(tpl.id), presetName: `${ANALYTICS_LAYOUT_NAME} (weekly)` },
      })
    } catch (e) {
      flashDl(`Could not set up auto-email: ${toUserMessage(e)}`, false)
      setSchedBusy(false)
    }
  }

  // ---- Incidents tab filtered data ----
  const filtered = useMemo(() => {
    let arr = records
    if (onlyPendingClosure) arr = arr.filter(r => r.closure_status === 'pending_closure')
    if (filterOpenClaims) arr = arr.filter(isOpenClaim)
    if (filterDelayed)  arr = arr.filter(isDelayed)
    if (statusFunnel)   arr = arr.filter(r => r.status === statusFunnel)
    if (filterStatus)   arr = arr.filter(r => r.status === filterStatus)
    if (filterStage)    arr = arr.filter(r => r.current_status === filterStage || r.case_stage === filterStage)
    if (filterRepairType) arr = arr.filter(r => r.repair_type === filterRepairType)
    if (filterFault)    arr = arr.filter(r => r.fault_status === filterFault)
    if (filterAge) {
      arr = arr.filter(r => {
        if (isReleasedOrClosed(r)) return false
        const d = caseAgeDays(r)
        if (d === null) return false
        if (filterAge === '0-15')  return d <= CASE_AGE_GREEN_DAYS
        if (filterAge === '16-30') return d > CASE_AGE_GREEN_DAYS && d <= CASE_AGE_AMBER_DAYS
        return d > CASE_AGE_AMBER_DAYS // '30+'
      })
    }
    if (filterSeverity) arr = arr.filter(r => r.severity === filterSeverity)
    if (filterSite)     arr = arr.filter(r => r.site === filterSite)
    if (filterFrom)     arr = arr.filter(r => r.incident_date >= filterFrom)
    if (filterTo)       arr = arr.filter(r => r.incident_date <= filterTo)
    if (search.trim()) {
      const q = search.toLowerCase()
      arr = arr.filter(r =>
        (r.asset_no ?? '').toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      )
    }
    return arr
  }, [records, search, filterSite, filterSeverity, filterStatus, filterFrom, filterTo, statusFunnel, onlyPendingClosure, filterDelayed, filterStage, filterRepairType, filterFault, filterAge, filterOpenClaims])

  // Recovered auto-calc: Claim - Approved - Deductible (spec), unless the user
  // has explicitly typed a value in the Recovered field (then their input wins).
  const recoveredTouched = useRef(false)
  useEffect(() => {
    if (recoveredTouched.current) return
    const auto = computeRecovered(form.claim_amount, form.claim_approved_amount, form.deductible)
    setForm((f) => (String(f.recovered_amount) === String(auto) ? f : { ...f, recovered_amount: auto }))
  }, [form.claim_amount, form.claim_approved_amount, form.deductible])

  // Suggested final amount = workshop quotation minus discount% (former Repair
  // & Insurance tab helper). Null when there is no quotation — never fabricated.
  const suggestedFinal = useMemo(() => {
    const q = Number(form.workshop_quotation)
    if (form.workshop_quotation === '' || Number.isNaN(q)) return null
    const d = Number(form.discount_pct) || 0
    return Math.max(0, Math.round((q * (1 - d / 100)) * 100) / 100)
  }, [form.workshop_quotation, form.discount_pct])

  function openAdd() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setFormError('')
    setAssetQuery('')
    recoveredTouched.current = false   // a fresh record auto-calculates Recovered
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function openEdit(row) {
    setAssetQuery(row.asset_no ?? '')
    const d = (v) => (v ? String(v).split('T')[0] : '')
    setForm({
      incident_date:         d(row.incident_date),
      asset_no:              row.asset_no ?? '',
      plate_number:          row.plate_number ?? '',
      vehicle_type:          row.vehicle_type ?? '',
      site:                  row.site ?? '',
      country:               row.country ?? '',
      location:              row.location ?? '',
      driver_name:           row.driver_name ?? '',
      description:           row.description ?? '',
      accident_type:         canonAccidentType(row.accident_type),
      severity:              canonSeverity(row.severity) || 'Minor',
      status:                canonStatus(row.status) || 'Reported',
      damage_class:          canonDamageClass(row.damage_class),
      insurer:               row.insurer ?? '',
      policy_no:             row.policy_no ?? '',
      insurance_claim_no:    row.insurance_claim_no ?? '',
      claim_status:          row.claim_status ?? '',
      claim_amount:          row.claim_amount ?? '',
      claim_approved_amount: row.claim_approved_amount ?? '',
      deductible:            row.deductible ?? '',
      recovered_amount:      row.recovered_amount ?? '',
      recovery_status:       row.recovery_status ?? '',
      recovery_source:       row.recovery_source ?? '',
      recovery_date:         d(row.recovery_date),
      recovery_reference:    row.recovery_reference ?? '',
      amount_transfer:       row.amount_transfer ?? '',
      responsible_party:     row.responsible_party ?? '',
      liable_party:          canonLiableParty(row.liable_party),
      payer:                 canonPayer(row.payer),
      fault_status:          canonFaultStatus(row.fault_status),
      gcc_liability_ratio:   row.gcc_liability_ratio ?? '',
      najm_status:           canonNajmStatus(row.najm_status),
      najm_fault:            canonNajmFault(row.najm_fault),
      taqdeer_status:        canonTaqdeerStatus(row.taqdeer_status),
      taqdeer_no:            row.taqdeer_no ?? '',
      case_stage:            row.case_stage ?? '',
      damage_condition:      canonDamageCondition(row.damage_condition),
      current_status:        row.current_status ?? '',
      next_step:             row.next_step ?? '',
      responsible_owner:     row.responsible_owner ?? '',
      // action_to_be_taken + required_action were merged into ONE "Action /
      // Progress" field — seed it from whichever column carries data so a legacy
      // value is never lost, then handleSave writes both columns in lockstep.
      required_action:       row.required_action ?? row.action_to_be_taken ?? '',
      status_update_date:    d(row.status_update_date),
      status_update_note:    row.status_update_note ?? '',
      repair_type:           canonRepairType(row.repair_type),
      workshop_name:         row.workshop_name ?? '',
      workshop_location:     row.workshop_location ?? '',
      workshop_quotation:    row.workshop_quotation ?? '',
      discount_pct:          row.discount_pct ?? '',
      final_amount:          row.final_amount ?? '',
      estimated_damage_cost: row.estimated_damage_cost ?? '',
      repair_cost:           row.repair_cost ?? '',
      expected_release_date: d(row.expected_release_date),
      release_date:          d(row.release_date),
      inspector:             row.inspector ?? '',
      photos:                row.photos ?? [],
    })
    setEditId(row.id)
    setFormError('')
    recoveredTouched.current = true    // respect the stored Recovered on edit
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handlePhotoFiles(e) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => {
        setForm(f => ({ ...f, photos: [...f.photos, ev.target.result] }))
      }
      reader.readAsDataURL(file)
    })
  }

  function removePhoto(idx) {
    setForm(f => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const num = (v) => (v !== '' && v != null ? Number(v) : null)
    // Keep the insurance claim lifecycle in lockstep with the workflow stage
    // (former Repair & Insurance tab behaviour): a mapped stage fills the claim
    // status when the user has not picked one explicitly.
    const mappedClaimStatus = STAGE_TO_CLAIM_STATUS[String(form.current_status || '').toLowerCase()] || null
    const payload = {
      incident_date:         form.incident_date || null,
      asset_no:              form.asset_no,
      plate_number:          form.plate_number || null,
      vehicle_type:          form.vehicle_type || null,
      site:                  form.site || 'Unassigned',   // site is NOT NULL (DB default 'Unassigned') — never send null
      country:               form.country || null,
      location:              form.location || null,
      driver_name:           form.driver_name || null,
      description:           form.description || null,
      // label → chk_accident_type token (V222). Column is NOT NULL, so a blank
      // selection persists as the vocabulary's 'other' bucket — never null.
      accident_type:         toDbAccidentType(form.accident_type) || 'other',
      severity:              toDbSeverity(form.severity),
      status:                toDbStatus(form.status),
      damage_class:          canonDamageClass(form.damage_class) || null,
      // Claim & insurance
      insurer:               form.insurer || null,
      policy_no:             form.policy_no || null,
      insurance_claim_no:    form.insurance_claim_no || null,
      claim_status:          form.claim_status || mappedClaimStatus,
      claim_amount:          num(form.claim_amount),
      claim_approved_amount: num(form.claim_approved_amount),
      deductible:            num(form.deductible),
      // Recovered = Claim - Approved - Deductible (spec formula, kept in sync by
      // the auto-calc effect; still editable, so an explicit override is saved).
      recovered_amount:      num(form.recovered_amount),
      // Cost recovery gate: detail persists only when Recovery = Yes, else cleared
      // so a No / N/A case never carries stale source/date/reference/transfer.
      recovery_status:       form.recovery_status || 'N/A',
      recovery_source:       recoveryIsYes(form.recovery_status) ? (form.recovery_source || 'none') : 'none',
      recovery_date:         recoveryIsYes(form.recovery_status) ? (form.recovery_date || null) : null,
      recovery_reference:    recoveryIsYes(form.recovery_status) ? (form.recovery_reference || null) : null,
      amount_transfer:       recoveryIsYes(form.recovery_status) ? num(form.amount_transfer) : null,
      // Parties & liability (controlled dropdowns; stray-case folds to the label)
      responsible_party:     form.responsible_party || null,
      liable_party:          canonLiableParty(form.liable_party) || null,
      payer:                 canonPayer(form.payer) || null,
      // GCC case / liability — canonicalised so a stray-case value still matches
      // the list badges + filters (which key off the exact option label). Najm
      // Fault + Taqdeer No are captured only when their report exists.
      fault_status:          canonFaultStatus(form.fault_status) || null,
      gcc_liability_ratio:   num(form.gcc_liability_ratio),
      najm_status:           canonNajmStatus(form.najm_status) || null,
      najm_fault:            najmHasReport(form.najm_status) ? (canonNajmFault(form.najm_fault) || null) : null,
      taqdeer_status:        canonTaqdeerStatus(form.taqdeer_status) || null,
      taqdeer_no:            taqdeerHasReport(form.taqdeer_status) ? (form.taqdeer_no || null) : null,
      // Case tracking & workflow
      case_stage:            form.case_stage || null,
      damage_condition:      canonDamageCondition(form.damage_condition) || null,
      current_status:        form.current_status || null,
      next_step:             form.next_step || null,
      // The merged "Action / Progress" field feeds BOTH legacy columns so every
      // downstream reader (detail page, AI copilot, exports) stays consistent and
      // no previously-saved value is orphaned.
      action_to_be_taken:    form.required_action || null,
      responsible_owner:     form.responsible_owner || null,
      required_action:       form.required_action || null,
      status_update_date:    form.status_update_date || null,
      status_update_note:    form.status_update_note || null,
      // Repair
      repair_type:           canonRepairType(form.repair_type) || null,
      workshop_name:         form.workshop_name || null,
      workshop_location:     form.workshop_location || null,
      workshop_quotation:    num(form.workshop_quotation),
      discount_pct:          num(form.discount_pct),
      final_amount:          num(form.final_amount),
      estimated_damage_cost: num(form.estimated_damage_cost),
      repair_cost:           num(form.repair_cost),
      expected_release_date: form.expected_release_date || null,
      release_date:          form.release_date || null,
      inspector:             form.inspector || null,
      photos:                form.photos.length ? form.photos : [],  // photos is NOT NULL (DB default '[]') — never send null
    }
    if (!editId) payload.reported_by = profile?.id  // accidents has `reported_by`, not `created_by`
    const { error: err } = editId
      ? await accidentsApi.updateAccidentForPage(editId, payload)
      : await accidentsApi.createAccidentForPage(payload)
    if (err) { setFormError(err.message); setSaving(false); return }
    setShowForm(false)
    loadRecords()
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this incident record?')) return
    await accidentsApi.deleteAccident(id)
    loadRecords()
  }

  // ── Multi-select helpers (Admin only) ─────────────────────────────────────
  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const pageIds = filtered.map(r => r.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id))
  function toggleSelectPage() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allPageSelected) pageIds.forEach(id => next.delete(id))
      else pageIds.forEach(id => next.add(id))
      return next
    })
  }

  async function confirmBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkBusy(true)
    setBulkError('')
    try {
      const ids = [...selectedIds]
      let deleted = 0
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const { data, error: err } = await supabase
          .from('accidents').delete().in('id', chunk).select('id')
        if (err) throw err
        deleted += data?.length ?? 0
      }
      if (deleted === 0) {
        throw new Error('No rows were deleted. You may not have permission (Admin only) or they were already removed.')
      }
      setBulkDeleteOpen(false)
      setSelectedIds(new Set())
      loadRecords()
    } catch (e) {
      setBulkError(e.message || 'Bulk delete failed. Please try again.')
    } finally {
      setBulkBusy(false)
    }
  }

  function raiseAction(row) {
    navigate('/actions', {
      state: {
        prefill: {
          asset_no: row.asset_no,
          site: row.site,
          description: row.description,
        },
      },
    })
  }

  // Full export - every incident + claim + recovery + cost field ("everything").
  const EXPORT_FIELDS = [
    ['incident_date', 'Date', r => r.incident_date],
    ['asset_no', 'Asset', r => r.asset_no],
    ['plate_number', 'Plate No', r => r.plate_number],
    ['vehicle_type', 'Vehicle Type', r => r.vehicle_type],
    ['site', 'Site', r => r.site],
    ['country', 'Country', r => r.country],
    ['severity', 'Severity', r => canonSeverity(r.severity)],
    ['case_state', 'State', r => isClosed(r) ? 'Closed' : 'Open'],
    ['status', 'Status', r => canonStatus(r.status)],
    ['closure_status', 'Closure', r => r.closure_status],
    ['responsible_party', 'Responsible', r => r.responsible_party],
    ['liable_party', 'Liable', r => r.liable_party],
    ['payer', 'Who Pays', r => r.payer],
    ['driver_name', 'Driver', r => r.driver_name],
    ['insurer', 'Insurer', r => r.insurer],
    ['policy_no', 'Policy/Claim No', r => r.policy_no],
    ['claim_status', 'Claim Status', r => r.claim_status],
    ['claim_amount', 'Claim Amount', r => r.claim_amount],
    ['claim_approved_amount', 'Approved', r => r.claim_approved_amount],
    ['deductible', 'Deductible', r => r.deductible],
    ['recovery_status', 'Recovery Status', r => r.recovery_status],
    ['recovered_amount', 'Recovered', r => r.recovered_amount],
    ['recovery_source', 'Recovery Source', r => r.recovery_source],
    ['recovery_date', 'Recovery Date', r => r.recovery_date],
    ['recovery_reference', 'Recovery Ref', r => r.recovery_reference],
    ['repair_cost', 'Repair Cost', r => r.repair_cost],
    ['estimated_damage_cost', 'Est. Damage', r => r.estimated_damage_cost],
    ['parts_cost', 'Parts Cost', r => r.parts_cost],
    // Net = gross (repair or estimate, + parts) minus recovered, from the SINGLE
    // claims engine so "net" means the same thing here as on the Claims dashboard.
    ['net_cost', 'Net Cost', r => claimNet(r)],
    ['location', 'Location', r => r.location],
    ['case_stage', 'Case Stage', r => r.case_stage],
    ['damage_condition', 'Damage Condition', r => r.damage_condition],
    ['current_status', 'Current Status', r => r.current_status],
    ['action_to_be_taken', 'Action To Be Taken', r => r.action_to_be_taken],
    ['responsible_owner', 'Responsible Owner', r => r.responsible_owner],
    ['required_action', 'Required Action', r => r.required_action],
    ['status_update_date', 'Status Update', r => r.status_update_date],
    ['expected_release_date', 'Expected Release', r => r.expected_release_date],
    ['delayed', 'Delayed', r => isDelayed(r) ? 'Yes' : 'No'],
    ['delayed_days', 'Days Since Update', r => isReleasedOrClosed(r) ? '' : daysSinceUpdate(r)],
    ['days_open', 'Days Open', r => { const d = caseAgeDays(r); return d === null ? '' : d }],
    ['damage_class', 'Damage Class', r => r.damage_class],
    ['fault_status', 'Fault Status', r => r.fault_status],
    ['najm_status', 'Najm', r => r.najm_status],
    ['najm_fault', 'Najm Fault', r => r.najm_fault],
    ['taqdeer_status', 'Taqdeer', r => r.taqdeer_status],
    ['gcc_liability_ratio', 'GCC Liability %', r => (r.gcc_liability_ratio ?? '') === '' ? '' : `${Number(r.gcc_liability_ratio)}%`],
    ['repair_type', 'Repair Type', r => r.repair_type],
    ['next_step', 'Next Step', r => r.next_step],
    ['workshop_name', 'Workshop', r => r.workshop_name],
    ['workshop_quotation', 'Quotation', r => r.workshop_quotation],
    ['discount_pct', 'Discount %', r => r.discount_pct],
    ['final_amount', 'Final Amount', r => r.final_amount],
    ['release_date', 'Release Date', r => r.release_date],
    ['inspector', 'Inspector', r => r.inspector],
    ['reporter_name', 'Reported By', r => r.reporter_name],
  ]
  const exportCols    = EXPORT_FIELDS.map(f => f[0])
  const exportHeaders = EXPORT_FIELDS.map(f => f[1])
  // Excel keeps every column; the PDF uses a focused, readable subset (a 52-column
  // landscape PDF is unusable) that still covers both OPEN and CLOSED cases with the
  // key report details: state, status, liability, fault, repair, insurer + costs.
  const PDF_KEYS = [
    'incident_date', 'asset_no', 'site', 'severity', 'case_state', 'status',
    'driver_name', 'fault_status', 'gcc_liability_ratio', 'repair_type',
    'insurer', 'claim_amount', 'claim_approved_amount', 'net_cost',
    'expected_release_date', 'release_date', 'days_open', 'delayed',
  ]
  const exportPdfCols = PDF_KEYS
    .map(key => { const f = EXPORT_FIELDS.find(x => x[0] === key); return f ? { key, header: f[1] } : null })
    .filter(Boolean)
  const exportRows = useMemo(
    () => filtered.map(r => {
      const o = {}
      EXPORT_FIELDS.forEach(([k, , get]) => { o[k] = get(r) ?? '' })
      return o
    }),
    [filtered],
  )

  // ── Claims Summary (daily report) ──────────────────────────────────────────
  // A focused insurance-claims view: only incidents carrying a claim, with the
  // details that matter for a claims desk. exportToPdf auto-builds a KPI summary
  // (open/closed split, claim value, approved, recovered, net exposure) from the
  // status + amount columns, then the detail table.
  const CLAIMS_KEYS = [
    'incident_date', 'asset_no', 'site', 'driver_name', 'case_state', 'status',
    'claim_status', 'insurer', 'policy_no', 'gcc_liability_ratio', 'fault_status',
    'claim_amount', 'claim_approved_amount', 'deductible', 'recovered_amount',
    'net_cost', 'expected_release_date', 'days_open', 'delayed',
  ]
  const claimsCols = CLAIMS_KEYS
    .map(key => { const f = EXPORT_FIELDS.find(x => x[0] === key); return f ? { key, header: f[1] } : null })
    .filter(Boolean)
  // hasClaim is imported from the single claims engine (claimsAnalytics) — the
  // former local copy that shadowed it was removed so both stay identical.
  const claimsRows = useMemo(
    () => filtered.filter(hasClaim).map(r => {
      const o = {}
      EXPORT_FIELDS.forEach(([k, , get]) => { o[k] = get(r) ?? '' })
      return o
    }),
    [filtered],
  )

  const exportClaimsSummary = (kind) => {
    const stamp = new Date().toISOString().slice(0, 10)
    const fname = `TyrePulse_ClaimsSummary_${stamp}`
    const company = appSettings?.company_name || ''
    if (kind === 'excel') {
      exportToExcel(claimsRows, CLAIMS_KEYS, claimsCols.map(c => c.header), fname, 'Claims', {
        title: 'Insurance Claims Summary', currency: activeCurrency, company,
        meta: { Scope: activeCountry !== 'All' ? activeCountry : 'All countries', Claims: claimsRows.length },
      })
    } else {
      exportToPdf(claimsRows, claimsCols, 'Insurance Claims Summary', fname, 'landscape', company, { currency: activeCurrency })
    }
  }

  // Main table columns for EnterpriseTable
  const mainColumns = useMemo(() => {
    const cols = []
    if (isAdmin) {
      cols.push({
        id: 'select',
        header: () => (
          <input type="checkbox" checked={allPageSelected} onChange={toggleSelectPage}
            title="Select all shown"
            className="w-4 h-4 rounded border-[var(--input-border)] bg-[var(--input-bg)] accent-blue-600 cursor-pointer" />
        ),
        cell: ({ row }) => (
          <input type="checkbox" checked={selectedIds.has(row.original.id)} onChange={() => toggleSelect(row.original.id)}
            className="w-4 h-4 rounded border-[var(--input-border)] bg-[var(--input-bg)] accent-blue-600 cursor-pointer" />
        ),
        size: 40,
        enableSorting: false,
        meta: { export: false },
      })
    }
    cols.push(
      { id: 'incident_date', header: 'Date', accessorFn: r => r.incident_date || '', size: 120, sortingFn: 'alphanumeric',
        // Delayed cases keep a red left accent + red text so a stalled case is
        // spottable from the row edge; the "Delayed Nd" badge lives ONLY in the
        // Status cell now (it used to be duplicated here).
        cell: ({ row }) => {
          const r = row.original
          const delayed = isDelayed(r)
          return (
            <div className={delayed ? 'border-l-2 border-red-500 pl-2 -ml-1' : ''}>
              <span className={delayed ? 'text-red-300 font-medium' : ''}>
                {r.incident_date ? formatDate(r.incident_date, activeCountry) : 'N/A'}
              </span>
            </div>
          )
        },
      },
      { id: 'asset_no', header: 'Asset', accessorFn: r => r.asset_no || 'N/A', size: 120,
        cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span>,
      },
      { id: 'site', header: 'Site', accessorFn: r => r.site || 'N/A', size: 120 },
      { id: 'severity', header: 'Severity', accessorFn: r => canonSeverity(r.severity), size: 100,
        cell: ({ getValue }) => {
          const { label, className } = accidentSeverityPill(getValue())
          return label
            ? <span className={`badge text-xs ${className}`}>{label}</span>
            : <span className="text-[var(--text-muted)] text-xs">N/A</span>
        },
      },
      { id: 'status', header: 'Status / Stage', accessorFn: r => canonStatus(r.status), size: 170,
        cell: ({ row }) => {
          const r = row.original
          const stage = r.current_status || r.case_stage
          const { label: statusLabel, className: statusClass } = accidentStatusPill(r.status)
          return (
            <div className="flex flex-col gap-1 items-start">
              {statusLabel && <span className={`badge text-xs ${statusClass}`}>{statusLabel}</span>}
              {stage && (
                <span className="text-[11px] text-[var(--text-dim)] truncate max-w-[150px]" title={r.next_step ? `Next: ${r.next_step}` : stage}>
                  {stage}
                </span>
              )}
              {r.closure_status === 'pending_closure' && (
                <span className="badge text-xs bg-yellow-900/50 text-yellow-300 border border-yellow-700/50 flex items-center gap-1">
                  <Hourglass size={10} /> Pending Closure
                </span>
              )}
              {isDelayed(r) && (
                <span className="badge text-[10px] bg-red-900/50 text-red-300 border border-red-700/50 flex items-center gap-1">
                  <Clock size={9} /> Delayed {daysSinceUpdate(r)}d
                </span>
              )}
            </div>
          )
        },
      },
      // How long the case has been running: incident_date → now for OPEN cases
      // (traffic-light coded), incident_date → release_date for CLOSED ones
      // (muted "total duration" tone). Sorts numerically; missing dates render
      // "—" and sort last (accessor -1).
      { id: 'days_open', header: 'Days Open', accessorFn: r => caseAgeDays(r) ?? -1, size: 110,
        cell: ({ row }) => {
          const r = row.original
          const days = caseAgeDays(r)
          if (days === null) return <span className="text-[var(--text-muted)] text-xs">N/A</span>
          if (isReleasedOrClosed(r)) {
            return (
              <span
                className={`badge text-[10px] whitespace-nowrap ${DIM_CHIP}`}
                title="Total case duration: incident date to release date"
              >
                {days}d closed
              </span>
            )
          }
          return (
            <span
              className={`badge text-[10px] whitespace-nowrap flex items-center gap-1 w-fit ${caseAgeBadge(days)}`}
              title={`Open for ${days} day${days === 1 ? '' : 's'} since the incident date`}
            >
              <Clock size={9} /> {days}d open
            </span>
          )
        },
      },
      // Case flags (damage class, fault, GCC liability, Najm/Taqdeer), settlement
      // and inspector are intentionally NOT crammed into the row — they live on
      // the /accidents/:id detail page (Open). Keeping the register lean.
      { id: 'repair_cost', header: 'Cost', accessorFn: r => r.repair_cost, size: 100, meta: { align: 'right' },
        cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtCurrency(getValue())}</span>,
      },
      {
        id: 'actions', header: 'Actions', accessorFn: r => r.id, size: 190, enableSorting: false, meta: { export: false },
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <button onClick={() => openDetail(r.id)} className="text-[var(--text-muted)] hover:text-green-400 text-xs transition-colors flex items-center gap-1"><Eye size={12} /> Open</button>
              <button
                onClick={() => openEdit(r)}
                className="text-[var(--text-muted)] hover:text-blue-400 text-xs transition-colors"
              >
                Edit
              </button>
              {r.status !== 'Closed' && (
                <button
                  onClick={() => raiseAction(r)}
                  className="text-[var(--text-muted)] hover:text-orange-400 text-xs transition-colors whitespace-nowrap"
                >
                  Raise CA
                </button>
              )}
              <button
                onClick={() => handleDelete(r.id)}
                className="text-[var(--text-muted)] hover:text-red-400 text-xs transition-colors"
              >
                Delete
              </button>
            </div>
          )
        },
      },
    )
    return cols
  }, [isAdmin, allPageSelected, selectedIds, activeCountry, fmtCurrency, openDetail])

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PageHeader
          title="Accidents & Incidents"
          subtitle={`${records.length} total incidents`}
          icon={AlertOctagon}
        />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => exportToExcel(exportRows, exportCols, exportHeaders, `TyrePulse_Accidents_${new Date().toISOString().slice(0,10)}`, 'Accidents', {
              title: 'Accident & Claims Tracker',
              currency: activeCurrency,
              company: appSettings?.company_name,
              dateRange: (filterFrom || filterTo) ? `${filterFrom || '...'} to ${filterTo || '...'}` : 'All dates',
              meta: { Scope: activeCountry !== 'All' ? activeCountry : 'All countries' },
            })}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Download size={14} /> Excel
          </button>
          <button
            onClick={() => exportToPdf(exportRows, exportPdfCols, 'Accident & Claims Tracker', `TyrePulse_Accidents_${new Date().toISOString().slice(0,10)}`, 'landscape', appSettings?.company_name || '', { currency: activeCurrency })}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <FileText size={14} /> PDF
          </button>
          <button
            onClick={() => { setTab('incidents'); setOpenClaims(true) }}
            title="Filter the register to insurance claims that are still open (shareable link: ?claims=open)"
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
              filterOpenClaims
                ? 'bg-blue-900/40 text-blue-200 border-blue-600'
                : 'btn-secondary'
            }`}
          >
            <ShieldAlert size={14} /> Open claims{stats.openClaims ? ` (${stats.openClaims})` : ''}
          </button>
          <button
            onClick={() => exportClaimsSummary('pdf')}
            title={`Insurance claims summary: ${claimsRows.length} claim${claimsRows.length === 1 ? '' : 's'}`}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <ShieldCheck size={14} /> Claims Summary
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> New Incident
          </button>
        </div>
      </div>

      {/* Load errors surface inline in the Incidents table area (with a retry). */}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--input-border)]">
        <button
          onClick={() => setTab('incidents')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'incidents'
              ? 'border-green-500 text-green-400'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          Incidents
        </button>
        <button
          onClick={() => setTab('analytics')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
            tab === 'analytics'
              ? 'border-green-500 text-green-400'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <BarChart2 size={14} /> Analytics
        </button>
        <button
          onClick={() => setTab('builder')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
            tab === 'builder'
              ? 'border-green-500 text-green-400'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <FileText size={14} /> Report Builder
        </button>
      </div>

      {/* ===== INCIDENTS TAB (hidden while the inline editor is open) ===== */}
      {!showForm && tab === 'incidents' && (
        <>
          {/* Closures awaiting approval */}
          {pendingClosures > 0 && (
            <button
              onClick={() => setOnlyPendingClosure(v => !v)}
              className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                onlyPendingClosure
                  ? 'bg-yellow-900/40 border-yellow-600'
                  : 'bg-yellow-900/20 border-yellow-700/50 hover:bg-yellow-900/30'
              }`}
            >
              <Hourglass size={18} className="text-yellow-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-yellow-200">
                  {pendingClosures} closure{pendingClosures > 1 ? 's' : ''} awaiting approval
                </p>
                <p className="text-xs text-yellow-500/80">Tap to {onlyPendingClosure ? 'show all incidents' : 'review and approve closures'}</p>
              </div>
              {onlyPendingClosure && <X size={14} className="text-yellow-400" />}
            </button>
          )}

          {/* Delayed / stalled-case highlight — open cases with no movement > SLA */}
          {stats.delayed > 0 && (
            <button
              onClick={() => setFilterDelayed(v => !v)}
              className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                filterDelayed
                  ? 'bg-red-900/40 border-red-600'
                  : 'bg-red-900/20 border-red-700/50 hover:bg-red-900/30'
              }`}
            >
              <Clock size={18} className="text-red-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-200">
                  {stats.delayed} case{stats.delayed > 1 ? 's' : ''} delayed &gt; {DELAY_THRESHOLD_DAYS} days
                </p>
                <p className="text-xs text-red-500/80">
                  Open with no status movement in over {DELAY_THRESHOLD_DAYS} days — tap to {filterDelayed ? 'show all incidents' : 'review stalled cases'}
                </p>
              </div>
              {filterDelayed && <X size={14} className="text-red-400" />}
            </button>
          )}

          {/* KPI header cards — real aggregates */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
            {[
              { v: stats.total, label: 'Total Incidents', cls: 'text-[var(--text-primary)]', sub: stats.fleetSize ? `${stats.per100} / 100 vehicles` : null },
              { v: stats.open, label: 'Open', cls: 'text-orange-400', sub: `${stats.total ? Math.round((stats.open / stats.total) * 100) : 0}% of all` },
              { v: stats.delayed, label: `Delayed >${DELAY_THRESHOLD_DAYS}d`, cls: 'text-red-400', sub: stats.open ? `${Math.round((stats.delayed / stats.open) * 100)}% of open` : 'none open', onClick: () => setFilterDelayed(v => !v), active: filterDelayed },
              { v: fmtCurrency(stats.cost), label: 'Total Cost (repair+parts)', cls: 'text-green-400', sub: 'gross exposure' },
              { v: fmtCurrency(stats.avgClaim), label: 'Avg Cost / Incident', cls: 'text-emerald-400', sub: 'costed incidents' },
              { v: `${stats.atFaultPct}%`, label: 'At-Fault Rate', cls: 'text-red-400', sub: stats.atFaultDenom ? `${stats.atFaultCount}/${stats.atFaultDenom} tagged` : 'no liability data' },
              { v: stats.insur, label: 'Insurance Claims', cls: 'text-blue-400', sub: opsIntel.leakage > 0 ? `${fmtCurrency(opsIntel.leakage)} unrecovered` : 'all recovered' },
            ].map((k, i) => (
              <motion.div key={k.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
                {k.onClick ? (
                  <button
                    onClick={k.onClick}
                    className={`card text-center w-full transition-colors ${k.active ? 'ring-1 ring-red-500 bg-red-950/20' : 'hover:bg-[var(--input-bg)]'}`}
                    title="Toggle delayed-only filter"
                  >
                    <p className={`text-2xl font-bold ${k.cls}`}>{k.v}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{k.label}</p>
                    {k.sub && <p className="text-[10px] text-[var(--text-muted)]/70 mt-0.5">{k.sub}</p>}
                  </button>
                ) : (
                  <div className="card text-center">
                    <p className={`text-2xl font-bold ${k.cls}`}>{k.v}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{k.label}</p>
                    {k.sub && <p className="text-[10px] text-[var(--text-muted)]/70 mt-0.5">{k.sub}</p>}
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          {/* Severity mix strip */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-[var(--text-dim)]">Severity Mix</p>
              <span className="text-xs text-[var(--text-muted)]">{stats.total} incidents</span>
            </div>
            <div className="flex h-3 w-full rounded-full overflow-hidden bg-[var(--input-border)]">
              {[
                { k: 'Minor', c: '#6b7280' },
                { k: 'Major', c: '#ea580c' },
                { k: 'Total Loss', c: '#dc2626' },
              ].map(s => {
                const pct = stats.total ? (stats.sevMix[s.k] / stats.total) * 100 : 0
                return pct > 0 ? <div key={s.k} title={`${s.k}: ${stats.sevMix[s.k]}`} style={{ width: `${pct}%`, background: s.c }} /> : null
              })}
            </div>
            <div className="flex flex-wrap gap-4 mt-2">
              {[
                { k: 'Minor', c: 'bg-gray-500' },
                { k: 'Major', c: 'bg-orange-500' },
                { k: 'Total Loss', c: 'bg-red-500' },
              ].map(s => (
                <span key={s.k} className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <span className={`w-2.5 h-2.5 rounded-sm ${s.c}`} /> {s.k}
                  <span className="text-[var(--text-dim)] font-medium">{stats.sevMix[s.k]}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Bar chart */}
          <div className="card">
            <p className="text-sm font-semibold text-[var(--text-dim)] mb-3">Incidents per Month (last 12 months)</p>
            <div style={{ height: 160 }}>
              <Bar data={chartData} options={CHART_OPTS_BASE} plugins={[LIGHT_VALUE_LABELS]} />
            </div>
          </div>

          {/* Status funnel */}
          <div className="flex flex-wrap gap-2">
            {STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setStatusFunnel(statusFunnel === s ? '' : s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  statusFunnel === s
                    ? accidentStatusPill(s).className + ' ring-1 ring-white/20'
                    : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-primary)]'
                }`}
              >
                {s} <span className="ml-1 opacity-70">{statusCounts[s]}</span>
              </button>
            ))}
            {statusFunnel && (
              <button onClick={() => setStatusFunnel('')} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2">
                <X size={12} className="inline" /> Clear
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                className="input pl-8 text-sm w-48"
                placeholder="Search asset or description"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select className="input text-sm w-36" value={filterSite} onChange={e => setFilterSite(e.target.value)}>
              <option value="">All Sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="input text-sm w-36" value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
              <option value="">All Severities</option>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="input text-sm w-44" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {stageOptions.length > 0 && (
              <select className="input text-sm w-44" value={filterStage} onChange={e => setFilterStage(e.target.value)} title="Case stage / current status">
                <option value="">All Stages</option>
                {stageOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <select className="input text-sm w-36" value={filterRepairType} onChange={e => setFilterRepairType(e.target.value)} title="Repair route">
              <option value="">All Repairs</option>
              {REPAIR_TYPE_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="input text-sm w-40" value={filterFault} onChange={e => setFilterFault(e.target.value)} title="Fault status">
              <option value="">All Fault</option>
              {FAULT_STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="input text-sm w-40" value={filterAge} onChange={e => setFilterAge(e.target.value)} title="How long open cases have been running (days since incident)">
              <option value="">Any Days Open</option>
              <option value="0-15">Open &le; {CASE_AGE_GREEN_DAYS}d</option>
              <option value="16-30">Open {CASE_AGE_GREEN_DAYS + 1}&ndash;{CASE_AGE_AMBER_DAYS}d</option>
              <option value="30+">Open &gt; {CASE_AGE_AMBER_DAYS}d</option>
            </select>
            <input type="date" className="input text-sm w-36" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} title="From date" />
            <input type="date" className="input text-sm w-36" value={filterTo} onChange={e => setFilterTo(e.target.value)} title="To date" />
            <button
              onClick={() => setFilterDelayed(v => !v)}
              className={`px-3 py-1 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                filterDelayed
                  ? 'bg-red-900/40 text-red-300 border-red-600'
                  : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-primary)]'
              }`}
              title={`Show only cases delayed over ${DELAY_THRESHOLD_DAYS} days`}
            >
              <Clock size={13} /> Delayed only
            </button>
            <button
              onClick={() => setOpenClaims(!filterOpenClaims)}
              aria-pressed={filterOpenClaims}
              className={`px-3 py-1 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                filterOpenClaims
                  ? 'bg-blue-900/40 text-blue-300 border-blue-600'
                  : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-primary)]'
              }`}
              title="Show only incidents whose insurance claim is still open (not closed / settled / rejected). Linkable as ?claims=open"
            >
              <ShieldAlert size={13} /> Open claims only{stats.openClaims ? ` (${stats.openClaims})` : ''}
            </button>
            {(search || filterSite || filterSeverity || filterStatus || filterStage || filterRepairType || filterFault || filterAge || filterFrom || filterTo || filterDelayed || filterOpenClaims) && (
              <button
                onClick={() => { setSearch(''); setFilterSite(''); setFilterSeverity(''); setFilterStatus(''); setFilterStage(''); setFilterRepairType(''); setFilterFault(''); setFilterAge(''); setFilterFrom(''); setFilterTo(''); setFilterDelayed(false); setOpenClaims(false) }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 flex items-center gap-1"
              >
                <X size={12} /> Clear filters
              </button>
            )}
            <span className="text-xs text-[var(--text-muted)] ml-auto self-center whitespace-nowrap">
              {filtered.length}{filtered.length !== records.length ? ` of ${records.length}` : ''} shown
            </span>
          </div>

          {/* Bulk selection bar (Admin only) */}
          {isAdmin && selectedIds.size > 0 && (
            <div className="flex items-center justify-between gap-3 bg-blue-950/30 border border-blue-800/50 rounded-xl px-4 py-2.5">
              <span className="text-sm text-blue-200">{selectedIds.size} selected</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedIds(new Set())} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1">Clear</button>
                <button onClick={() => { setBulkError(''); setBulkDeleteOpen(true) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">
                  <Trash2 size={14} /> Delete {selectedIds.size}
                </button>
              </div>
            </div>
          )}

          {/* Table - EnterpriseTable */}
          {loading ? (
            <div className="card p-4 space-y-2.5" aria-busy="true" aria-label="Loading incidents">
              <div className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-11 bg-[var(--input-bg)]/60 rounded animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
              ))}
            </div>
          ) : error ? (
            <div className="card text-center py-12 space-y-3">
              <AlertTriangle size={30} className="mx-auto text-red-400" />
              <p className="text-[var(--text-primary)] font-semibold">Could not load incidents</p>
              <p className="text-sm text-[var(--text-muted)]">{error}</p>
              <button onClick={() => { setError(''); loadRecords() }} className="btn-secondary text-sm mx-auto">Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              illustration="module/accident"
              icon={AlertOctagon}
              title="No incidents found"
              description="Adjust your filters or log a new incident to start tracking accidents and claims."
            />
          ) : (
            <div className="card p-0 overflow-hidden">
              <EnterpriseTable
                reportMeta={reportMeta}
                columns={mainColumns}
                data={filtered}
                getRowId={(row) => String(row.id)}
                onRowClick={(row) => openDetail(row.id)}
                enableGlobalFilter={false}
                enableSorting={true}
                enableExport={false}
                enableColumnVisibility={false}
                initialPageSize={25}
                pageSizeOptions={[10, 25, 50, 100]}
                emptyMessage="No incidents found"
              />
            </div>
          )}
        </>
      )}

      {/* ===== ANALYTICS TAB (hidden while the inline editor is open) ===== */}
      {!showForm && tab === 'analytics' && (
        <div className="space-y-4">
          {/* Download the on-screen analytics as a compact 1-2 page PDF with numbers */}
          <div className="flex items-center justify-end gap-3 flex-wrap">
            {dlAnalytics.msg && (
              <span className={`text-xs ${dlAnalytics.ok ? 'text-green-400' : 'text-red-400'}`}>{dlAnalytics.msg}</span>
            )}
            <button
              onClick={scheduleAnalytics}
              disabled={schedBusy}
              title="Auto-email this analytics dashboard on a schedule (daily, weekly or monthly) to chosen recipients"
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50"
            >
              {schedBusy
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Opening scheduler...</>
                : <><Mail size={14} /> Auto-email</>}
            </button>
            <button
              onClick={downloadAnalyticsPdf}
              disabled={dlAnalytics.busy || records.length === 0}
              title={records.length === 0 ? 'No incident data to export' : 'Download these charts and KPIs as a compact PDF (max 2 pages)'}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50"
            >
              {dlAnalytics.busy
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Preparing PDF...</>
                : <><Download size={14} /> Download Analytics PDF</>}
            </button>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="card text-center">
              <p className="text-2xl font-bold text-[var(--text-primary)]">{stats.total}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Total Incidents</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-orange-400">{stats.open}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Open</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-blue-400">{stats.avgDaysDenom > 0 ? stats.avgDays : 'N/A'}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {stats.avgDaysDenom > 0
                  ? `Avg Days to Close (${stats.avgDaysDenom} closed)`
                  : 'Avg Days to Close (no release dates)'}
              </p>
            </div>
            <div className="card text-center">
              <p className="text-xl font-bold text-green-400">{fmtCurrency(stats.cost)}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Total Repair Cost</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-red-400">{stats.insur}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Insurance Claims</p>
            </div>
          </div>

          {/* Distribution doughnuts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card">
              <p className="text-sm font-semibold text-[var(--text-dim)] mb-3">Severity Distribution</p>
              {stats.total === 0
                ? <p className="text-[var(--text-muted)] text-sm text-center py-8">No data</p>
                : <div style={{ height: 220 }}><Doughnut ref={setChartRef('severity')} data={severityDoughnut} options={CHART_OPTS_DOUGHNUT} /></div>}
            </div>
            <div className="card">
              <p className="text-sm font-semibold text-[var(--text-dim)] mb-3">Status Distribution</p>
              {stats.total === 0
                ? <p className="text-[var(--text-muted)] text-sm text-center py-8">No data</p>
                : <div style={{ height: 220 }}><Doughnut ref={setChartRef('status')} data={statusDoughnut} options={CHART_OPTS_DOUGHNUT} /></div>}
            </div>
            <div className="card">
              <p className="text-sm font-semibold text-[var(--text-dim)] mb-3">Fault Status (GCC)</p>
              {stats.total === 0
                ? <p className="text-[var(--text-muted)] text-sm text-center py-8">No data</p>
                : <div style={{ height: 220 }}><Doughnut ref={setChartRef('fault')} data={faultDoughnut} options={CHART_OPTS_DOUGHNUT} /></div>}
            </div>
          </div>

          {/* Incident trend line */}
          <div className="card">
            <p className="text-sm font-semibold text-[var(--text-dim)] mb-3">Incident Trend (last 12 months)</p>
            <div style={{ height: 220 }}><Line ref={setChartRef('trend')} data={monthlyTrendLine} options={CHART_OPTS_LINE} plugins={[LIGHT_VALUE_LABELS]} /></div>
          </div>

          {/* Top 5 assets + by site */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <p className="text-sm font-semibold text-[var(--text-dim)] mb-3">Top 5 Assets by Incidents</p>
              {topAssetsChart.labels.length === 0 ? (
                <p className="text-[var(--text-muted)] text-sm text-center py-6">No data</p>
              ) : (
                <div style={{ height: 200 }}>
                  <Bar ref={setChartRef('topAssets')} data={topAssetsChart} options={CHART_OPTS_H} plugins={[LIGHT_VALUE_LABELS]} />
                </div>
              )}
            </div>
            <div className="card">
              <p className="text-sm font-semibold text-[var(--text-dim)] mb-3">Incidents by Site</p>
              {bySiteChart.labels.length === 0 ? (
                <p className="text-[var(--text-muted)] text-sm text-center py-6">No data</p>
              ) : (
                <div style={{ height: 200 }}>
                  <Bar ref={setChartRef('bySite')} data={bySiteChart} options={CHART_OPTS_H} plugins={[LIGHT_VALUE_LABELS]} />
                </div>
              )}
            </div>
          </div>

          {/* Monthly severity breakdown */}
          <div className="card">
            <p className="text-sm font-semibold text-[var(--text-dim)] mb-3">Monthly Severity Breakdown (last 12 months)</p>
            <div style={{ height: 220 }}>
              <Bar ref={setChartRef('sevMonthly')} data={severityMonthlyChart} options={CHART_OPTS_STACKED} plugins={[LIGHT_VALUE_LABELS]} />
            </div>
          </div>

          {/* Claims & cost recovery */}
          <div className="card">
            <p className="text-sm font-semibold text-[var(--text-dim)] mb-3">Claims & Cost Recovery</p>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
              <div className="text-center">
                <p className="text-lg font-bold text-[var(--text-primary)]">{fmtCurrency(claimAnalytics.grossCost)}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Gross Cost (repair + parts)</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-blue-400">{fmtCurrency(claimAnalytics.totalClaim)}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Total Claimed</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-green-400">{fmtCurrency(claimAnalytics.totalRecovered)}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Recovered</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-orange-400">{fmtCurrency(claimAnalytics.netExposure)}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Net After Recovery</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-purple-400">{fmtCurrency(claimAnalytics.totalParts)}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Parts Cost</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-yellow-400">{claimAnalytics.pendingClosure}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Pending Closures</p>
              </div>
            </div>

            {/* Recovery rate bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[var(--text-muted)]">Insurance recovery rate</span>
                <span className="text-sm font-semibold text-[var(--text-secondary)]">{claimAnalytics.recovery}%</span>
              </div>
              <div className="w-full bg-[var(--input-border)] rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, claimAnalytics.recovery)}%`,
                    background: claimAnalytics.recovery >= 75 ? '#16a34a' : claimAnalytics.recovery >= 40 ? '#ca8a04' : '#dc2626',
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Claim Status Breakdown</p>
                <div style={{ height: 180 }}><Bar ref={setChartRef('claimStatus')} data={claimStatusChart} options={CHART_OPTS_BASE} plugins={[LIGHT_VALUE_LABELS]} /></div>
              </div>
              <div>
                <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Cost by Responsible Payer</p>
                {payerCostChart.labels.length === 0
                  ? <p className="text-[var(--text-muted)] text-sm text-center py-12">No payer cost data</p>
                  : <div style={{ height: 180 }}><Bar ref={setChartRef('payerCost')} data={payerCostChart} options={CHART_OPTS_H} plugins={[LIGHT_VALUE_LABELS]} /></div>}
              </div>
            </div>
          </div>

          {/* ===== Engineering / Ops Intelligence ===== */}
          <div className="card border-l-2 border-l-orange-500/60">
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert size={16} className="text-orange-400" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">Engineering & Ops Intelligence</p>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">Repeat offenders, cost hotspots, root causes and recommended actions — derived live from {stats.total} incident{stats.total !== 1 ? 's' : ''}.</p>

            {/* Recommendations */}
            {opsIntel.recs.length > 0 && (
              <div className="mb-5 space-y-2">
                <p className="text-xs font-semibold text-[var(--text-dim)] flex items-center gap-1.5"><Lightbulb size={13} className="text-yellow-400" /> Recommended Actions</p>
                {opsIntel.recs.map((rec, i) => (
                  <div key={i} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm border ${
                    rec.level === 'high' ? 'bg-red-950/30 border-red-800/50 text-red-200'
                    : rec.level === 'medium' ? 'bg-orange-950/25 border-orange-800/40 text-orange-200'
                    : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-dim)]'}`}>
                    <span className={`mt-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${
                      rec.level === 'high' ? 'bg-red-800/60 text-red-100'
                      : rec.level === 'medium' ? 'bg-orange-800/60 text-orange-100'
                      : 'bg-gray-700 text-gray-300'}`}>{rec.level}</span>
                    <span className="leading-snug">{rec.text}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Repeat-offender assets */}
              <div>
                <p className="text-xs font-semibold text-[var(--text-dim)] flex items-center gap-1.5 mb-2"><TrendingUp size={13} className="text-red-400" /> Repeat-Offender Assets (2+ incidents)</p>
                {opsIntel.repeatAssets.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] py-3">No asset has more than one incident — good fleet dispersion.</p>
                ) : (
                  <div className="space-y-1.5">
                    {opsIntel.repeatAssets.map(a => (
                      <button key={a.asset_no} onClick={() => { setTab('incidents'); setSearch(a.asset_no) }}
                        className="w-full flex items-center justify-between gap-2 rounded-lg bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] px-3 py-2 text-left transition-colors group">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--text-primary)] font-mono truncate">{a.asset_no}</p>
                          <p className="text-[11px] text-[var(--text-muted)] truncate">{a.site || '-'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-red-400">{a.count}<span className="text-[10px] font-normal text-[var(--text-muted)]"> incidents</span></p>
                          <p className="text-[11px] text-[var(--text-dim)]">{fmtCurrency(a.cost)}</p>
                        </div>
                        <ChevronRight size={13} className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Repeat-offender drivers */}
              <div>
                <p className="text-xs font-semibold text-[var(--text-dim)] flex items-center gap-1.5 mb-2"><Users size={13} className="text-purple-400" /> Repeat-Offender Drivers (2+ incidents)</p>
                {opsIntel.repeatDrivers.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] py-3">No driver linked to multiple incidents (or driver data not captured).</p>
                ) : (
                  <div className="space-y-1.5">
                    {opsIntel.repeatDrivers.map(d => (
                      <div key={d.driver} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{d.driver}</p>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-purple-400">{d.count}<span className="text-[10px] font-normal text-[var(--text-muted)]"> incidents</span></p>
                          <p className="text-[11px] text-[var(--text-dim)]">{fmtCurrency(d.cost)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cost hotspots by site */}
              <div>
                <p className="text-xs font-semibold text-[var(--text-dim)] flex items-center gap-1.5 mb-2"><DollarSign size={13} className="text-green-400" /> Cost Hotspots by Site</p>
                {opsIntel.siteHotspots.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] py-3">No cost recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {opsIntel.siteHotspots.map(s => (
                      <div key={s.site}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-[var(--text-dim)] truncate">{s.site} <span className="text-[var(--text-muted)]">· {s.count} · avg {fmtCurrency(s.avg)}</span></span>
                          <span className="text-[var(--text-secondary)] font-medium shrink-0">{fmtCurrency(s.cost)} ({s.pct}%)</span>
                        </div>
                        <div className="w-full bg-[var(--input-border)] rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-green-500/80" style={{ width: `${s.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Root-cause groupings */}
              <div>
                <p className="text-xs font-semibold text-[var(--text-dim)] flex items-center gap-1.5 mb-2"><AlertOctagon size={13} className="text-blue-400" /> Root-Cause Groupings</p>
                {opsIntel.rootCauses.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] py-3">No incidents to group.</p>
                ) : (
                  <div className="space-y-2">
                    {opsIntel.rootCauses.map(c => (
                      <div key={c.cause}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-[var(--text-dim)] truncate capitalize">{c.cause}</span>
                          <span className="text-[var(--text-secondary)] font-medium shrink-0">{c.count} ({c.pct}%) · {fmtCurrency(c.cost)}</span>
                        </div>
                        <div className="w-full bg-[var(--input-border)] rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-blue-500/80" style={{ width: `${c.pct}%` }} />
                        </div>
                      </div>
                    ))}
                    {opsIntel.uncategorised > 0 && (
                      <p className="text-[11px] text-yellow-500/80 pt-1">{opsIntel.uncategorised} incident{opsIntel.uncategorised !== 1 ? 's' : ''} lack a cause — capture accident type at intake.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Data-quality strip */}
            <div className="mt-5 pt-4 border-t border-[var(--input-border)] grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><p className="text-lg font-bold text-yellow-400">{opsIntel.dataQuality.missingCost}</p><p className="text-[11px] text-[var(--text-muted)]">Missing cost data</p></div>
              <div><p className="text-lg font-bold text-yellow-400">{opsIntel.dataQuality.missingDriver}</p><p className="text-[11px] text-[var(--text-muted)]">Missing driver</p></div>
              <div><p className="text-lg font-bold text-orange-400">{opsIntel.dataQuality.staleOpen}</p><p className="text-[11px] text-[var(--text-muted)]">Open &gt; 60 days</p></div>
              <div><p className="text-lg font-bold text-red-400">{fmtCurrency(opsIntel.leakage)}</p><p className="text-[11px] text-[var(--text-muted)]">Unrecovered ({opsIntel.recoverableCount})</p></div>
            </div>
          </div>

          {/* Status funnel */}
          <div className="card">
            <p className="text-sm font-semibold text-[var(--text-dim)] mb-4">Status Funnel</p>
            <div className="space-y-3">
              {funnelData.map(({ status, count, pct }) => (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`badge text-xs ${accidentStatusPill(status).className}`}>{status}</span>
                    <span className="text-sm text-[var(--text-dim)]">{count} <span className="text-[var(--text-muted)] text-xs">({pct}%)</span></span>
                  </div>
                  <div className="w-full bg-[var(--input-border)] rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: status === 'Closed' ? '#16a34a'
                          : status === 'Insurance Claim' ? '#dc2626'
                          : status === 'Reported' ? '#ca8a04'
                          : status === 'Under Investigation' ? '#2563eb'
                          : '#9333ea',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== REPORT BUILDER TAB (hidden while the inline editor is open) ===== */}
      {!showForm && tab === 'builder' && (
        <Suspense fallback={<div className="card text-center py-16 text-[var(--text-muted)] text-sm">Loading report builder…</div>}>
          <AccidentReportBuilder
            records={records}
            company={appSettings?.company_name || 'TyrePulse'}
            currency={activeCurrency}
          />
        </Suspense>
      )}

      {/* ── Inline incident editor ─────────────────────────────────────────────
          Renders as a full-width card in the page flow (below the tabs); the
          tab content hides while it is open (gated on !showForm above). This
          replaced the old fixed-overlay modal — presentation change only. */}
      {showForm && (
        <div className="card">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  title="Back to incidents"
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-lg font-semibold text-[var(--text-primary)] truncate">
                  {editId ? `Edit Incident${form.asset_no ? ` — ${form.asset_no}` : ''}` : 'New Incident'}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button type="submit" form="accident-inline-form" disabled={saving} className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50">
                  <Save size={15} /> {saving ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} title="Cancel" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                  <X size={18} />
                </button>
              </div>
            </div>

            {formError && (
              <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{formError}</div>
            )}

            <form id="accident-inline-form" onSubmit={handleSave} className="space-y-3">
              <FormSection title="Incident">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="label">Incident Date *</label>
                  <input
                    type="date" className="input" required
                    value={form.incident_date}
                    onChange={e => setForm(f => ({ ...f, incident_date: e.target.value }))}
                  />
                </div>
                <div className="relative" ref={assetDropRef}>
                  <label className="label">Asset No *</label>
                  <div className="relative">
                    <input
                      className="input pr-8" required
                      placeholder="Type to search..."
                      value={assetQuery}
                      onChange={e => {
                        setAssetQuery(e.target.value)
                        setForm(f => ({ ...f, asset_no: e.target.value }))
                        setShowAssetDrop(true)
                      }}
                      onFocus={() => setShowAssetDrop(true)}
                      autoComplete="off"
                    />
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  </div>
                  {showAssetDrop && assetSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto">
                      {assetSuggestions.map(a => (
                        <button
                          key={a.asset_no}
                          type="button"
                          onMouseDown={() => selectAsset(a)}
                          className="w-full text-left px-3 py-2 hover:bg-[var(--input-bg-hover)] transition-colors flex items-center justify-between gap-3"
                        >
                          <span className="text-[var(--text-primary)] font-mono text-sm">{a.asset_no}</span>
                          <span className="text-[var(--text-muted)] text-xs truncate">{[a.vehicle_type, a.site].filter(Boolean).join(' · ')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {assetInfo && (assetInfo.vehicle_type || assetInfo.make || assetInfo.model || assetInfo.fleet_number) && (
                    <p className="text-[11px] text-[var(--text-muted)] mt-1 truncate">
                      Master: {[
                        assetInfo.vehicle_type,
                        [assetInfo.make, assetInfo.model].filter(Boolean).join(' '),
                        assetInfo.fleet_number ? `Fleet ${assetInfo.fleet_number}` : '',
                      ].filter(Boolean).join(' | ') || 'N/A'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">Plate Number</label>
                  <input
                    className="input" placeholder="Auto-filled from asset"
                    value={form.plate_number}
                    onChange={e => setForm(f => ({ ...f, plate_number: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Vehicle Type</label>
                  <input
                    className="input" placeholder="Auto-filled from asset"
                    value={form.vehicle_type}
                    onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="label">Site</label>
                  <input
                    className="input" list="acc-sites"
                    value={form.site}
                    onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
                  />
                  <datalist id="acc-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
                </div>
                <div>
                  <label className="label">Location</label>
                  <input
                    className="input" placeholder="e.g. GCC Plant, gate 3"
                    value={form.location}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Country</label>
                  <input
                    className="input"
                    value={form.country}
                    onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="label">Driver</label>
                  <input
                    className="input" placeholder="Driver name"
                    value={form.driver_name}
                    onChange={e => setForm(f => ({ ...f, driver_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Accident Type</label>
                  <select className="input" value={form.accident_type} onChange={e => setForm(f => ({ ...f, accident_type: e.target.value }))}>
                    <option value="">N/A</option>
                    {ACCIDENT_TYPE_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  className="input" rows={3} placeholder="What happened: sequence, damage, injuries"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              </FormSection>

              {/* Classification */}
              <FormSection title="Classification">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Severity</label>
                    <select className="input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                      {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Status</label>
                    <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Damage Class</label>
                    <select className="input" value={form.damage_class} onChange={e => setForm(f => ({ ...f, damage_class: e.target.value }))}>
                      <option value="">N/A</option>
                      {DAMAGE_CLASS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </FormSection>

              {/* GCC case & liability */}
              <FormSection title="Liability & Case (GCC)">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Fault Status</label>
                    <select className="input" value={form.fault_status} onChange={e => setForm(f => ({ ...f, fault_status: e.target.value }))}>
                      <option value="">N/A</option>
                      {FAULT_STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">GCC Liability</label>
                    <select className="input" value={form.gcc_liability_ratio} onChange={e => setForm(f => ({ ...f, gcc_liability_ratio: e.target.value }))}>
                      <option value="">N/A</option>
                      {LIABILITY_RATIO_OPTS.map(n => <option key={n} value={n}>{n}%</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Najm</label>
                    <select className="input" value={form.najm_status} onChange={e => setForm(f => ({ ...f, najm_status: e.target.value }))}>
                      <option value="">N/A</option>
                      {NAJM_STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {najmHasReport(form.najm_status) && (
                    <div>
                      <label className="label">Najm Fault</label>
                      <select className="input" value={form.najm_fault} onChange={e => setForm(f => ({ ...f, najm_fault: e.target.value }))}>
                        <option value="">N/A</option>
                        {NAJM_FAULT_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="label">Taqdeer</label>
                    <select className="input" value={form.taqdeer_status} onChange={e => setForm(f => ({ ...f, taqdeer_status: e.target.value }))}>
                      <option value="">N/A</option>
                      {TAQDEER_STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {taqdeerHasReport(form.taqdeer_status) && (
                    <div>
                      <label className="label">Taqdeer No</label>
                      <input className="input" placeholder="Estimation reference" value={form.taqdeer_no} onChange={e => setForm(f => ({ ...f, taqdeer_no: e.target.value }))} />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                  <div>
                    <label className="label">Liable Party</label>
                    <select className="input" value={form.liable_party} onChange={e => setForm(f => ({ ...f, liable_party: e.target.value }))}>
                      <option value="">N/A</option>
                      {withValueOption(LIABLE_PARTY_OPTS, form.liable_party).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Responsible Party</label>
                    <input className="input" placeholder="Who is at fault" value={form.responsible_party} onChange={e => setForm(f => ({ ...f, responsible_party: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Who Pays</label>
                    <select className="input" value={form.payer} onChange={e => setForm(f => ({ ...f, payer: e.target.value }))}>
                      <option value="">N/A</option>
                      {withValueOption(PAYER_OPTS, form.payer).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </FormSection>

              {/* Case tracking & workflow (consolidated from the detail page's Tracker tab) */}
              <FormSection title="Case Tracking & Workflow">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Case Stage</label>
                    <select className="input" value={form.case_stage} onChange={e => setForm(f => ({ ...f, case_stage: e.target.value }))}>
                      <option value="">N/A</option>
                      {withValueOption(CASE_STAGE_OPTS, form.case_stage).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Damage Condition</label>
                    <select className="input" value={form.damage_condition} onChange={e => setForm(f => ({ ...f, damage_condition: e.target.value }))}>
                      <option value="">N/A</option>
                      {withValueOption(DAMAGE_CONDITION_OPTS, form.damage_condition).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Current Workflow Stage</label>
                    <select className="input" value={form.current_status} onChange={e => setForm(f => ({ ...f, current_status: e.target.value }))}>
                      <option value="">N/A</option>
                      {withValueOption(WORKFLOW_STAGE_OPTS, form.current_status).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Next Step</label>
                    <select className="input" value={form.next_step} onChange={e => setForm(f => ({ ...f, next_step: e.target.value }))}>
                      <option value="">N/A</option>
                      {withValueOption(WORKFLOW_STAGE_OPTS, form.next_step).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Responsible Owner</label>
                    <input className="input" placeholder="Accountable person" value={form.responsible_owner} onChange={e => setForm(f => ({ ...f, responsible_owner: e.target.value }))} />
                  </div>
                </div>
                {STAGE_TO_CLAIM_STATUS[String(form.current_status || '').toLowerCase()] && !form.claim_status && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-2">
                    Saving this stage sets the claim status to "{CLAIM_STATUS_LABELS[STAGE_TO_CLAIM_STATUS[String(form.current_status).toLowerCase()]]}" (pick a Claim Status below to override).
                  </p>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                  <div className="md:col-span-2">
                    <label className="label">Action / Progress</label>
                    <input className="input" placeholder="Latest action or progress note" value={form.required_action} onChange={e => setForm(f => ({ ...f, required_action: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Status Update Date</label>
                    <input type="date" className="input" value={form.status_update_date} onChange={e => setForm(f => ({ ...f, status_update_date: e.target.value }))} />
                  </div>
                  <div className="md:col-span-3">
                    <label className="label">Status Update Note</label>
                    <input className="input" placeholder="Optional note for this update" value={form.status_update_note} onChange={e => setForm(f => ({ ...f, status_update_note: e.target.value }))} />
                  </div>
                </div>
              </FormSection>

              {/* Insurance & claim */}
              <FormSection title="Insurance & Claim">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Insurer</label>
                    <input className="input" placeholder="e.g. Tawuniya" value={form.insurer} onChange={e => setForm(f => ({ ...f, insurer: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Policy No</label>
                    <input className="input" value={form.policy_no} onChange={e => setForm(f => ({ ...f, policy_no: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Claim No</label>
                    <input className="input" value={form.insurance_claim_no} onChange={e => setForm(f => ({ ...f, insurance_claim_no: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Claim Status</label>
                    <select className="input" value={form.claim_status} onChange={e => setForm(f => ({ ...f, claim_status: e.target.value }))}>
                      <option value="">N/A</option>
                      {CLAIM_STATUS_OPTS.map(s => <option key={s} value={s}>{CLAIM_STATUS_LABELS[s]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Claim Amount</label>
                    <input type="number" min="0" step="0.01" className="input" value={form.claim_amount} onChange={e => setForm(f => ({ ...f, claim_amount: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Approved</label>
                    <input type="number" min="0" step="0.01" className="input" value={form.claim_approved_amount} onChange={e => setForm(f => ({ ...f, claim_approved_amount: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Deductible</label>
                    <input type="number" min="0" step="0.01" className="input" value={form.deductible} onChange={e => setForm(f => ({ ...f, deductible: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Recovered</label>
                    <input type="number" min="0" step="0.01" className="input" value={form.recovered_amount}
                      onChange={e => { recoveredTouched.current = true; setForm(f => ({ ...f, recovered_amount: e.target.value })) }} />
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">Auto: Claim minus Approved minus Deductible (editable)</p>
                  </div>
                </div>
              </FormSection>

              {/* Cost recovery (consolidated from the detail page's Claim & Recovery tab) */}
              <FormSection title="Cost Recovery">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Recovery Status</label>
                    <select className="input" value={form.recovery_status} onChange={e => setForm(f => ({ ...f, recovery_status: e.target.value }))}>
                      <option value="">N/A</option>
                      {withValueOption(RECOVERY_DECISION_OPTS, form.recovery_status).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {recoveryIsYes(form.recovery_status) && (
                    <>
                      <div>
                        <label className="label">Recovery Source</label>
                        <select className="input" value={form.recovery_source} onChange={e => setForm(f => ({ ...f, recovery_source: e.target.value }))}>
                          <option value="">N/A</option>
                          {RECOVERY_SOURCE_OPTS.map(s => <option key={s} value={s}>{RECOVERY_SOURCE_LABELS[s]}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Recovery Date</label>
                        <input type="date" className="input" value={form.recovery_date} onChange={e => setForm(f => ({ ...f, recovery_date: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Recovery Reference</label>
                        <input className="input" placeholder="Payment / case ref" value={form.recovery_reference} onChange={e => setForm(f => ({ ...f, recovery_reference: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Amount Transfer</label>
                        <input type="number" min="0" step="0.01" className="input" value={form.amount_transfer} onChange={e => setForm(f => ({ ...f, amount_transfer: e.target.value }))} />
                      </div>
                    </>
                  )}
                </div>
              </FormSection>

              {/* Repair & release */}
              <FormSection title="Repair & Release">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Repair Type</label>
                    <select className="input" value={form.repair_type} onChange={e => setForm(f => ({ ...f, repair_type: e.target.value }))}>
                      <option value="">N/A</option>
                      {withValueOption(REPAIR_TYPE_OPTS, form.repair_type).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Workshop</label>
                    <input className="input" placeholder={repairIsInternal(form.repair_type) ? 'GCC Workshop' : 'External workshop name'} value={form.workshop_name} onChange={e => setForm(f => ({ ...f, workshop_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Workshop Location</label>
                    {repairIsInternal(form.repair_type) ? (
                      <select className="input" value={form.workshop_location} onChange={e => setForm(f => ({ ...f, workshop_location: e.target.value }))}>
                        <option value="">Select site</option>
                        {withValueOption(sites, form.workshop_location).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input className="input" placeholder="Workshop location / name" value={form.workshop_location} onChange={e => setForm(f => ({ ...f, workshop_location: e.target.value }))} />
                    )}
                  </div>
                  <div>
                    <label className="label">Workshop Quotation</label>
                    <input type="number" min="0" step="0.01" className="input" value={form.workshop_quotation} onChange={e => setForm(f => ({ ...f, workshop_quotation: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Discount %</label>
                    <input type="number" min="0" max="100" step="0.01" className="input" placeholder="0" value={form.discount_pct} onChange={e => setForm(f => ({ ...f, discount_pct: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Final Amount</label>
                    <input type="number" min="0" step="0.01" className="input" value={form.final_amount} onChange={e => setForm(f => ({ ...f, final_amount: e.target.value }))} />
                    {suggestedFinal != null && String(form.final_amount) !== String(suggestedFinal) && (
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, final_amount: suggestedFinal }))}
                        className="text-[11px] text-green-400 hover:text-green-300 mt-1"
                      >
                        Use suggested {fmtCurrency(suggestedFinal)} (quotation minus discount)
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="label">Estimated Damage Cost</label>
                    <input type="number" min="0" step="0.01" className="input" value={form.estimated_damage_cost} onChange={e => setForm(f => ({ ...f, estimated_damage_cost: e.target.value }))} />
                  </div>
                  {repairIsInternal(form.repair_type) && (
                    <div>
                      <label className="label">Repair Cost</label>
                      <input type="number" min="0" step="0.01" className="input" value={form.repair_cost} onChange={e => setForm(f => ({ ...f, repair_cost: e.target.value }))} />
                    </div>
                  )}
                  <div>
                    <label className="label">Expected Release</label>
                    <input type="date" className="input" value={form.expected_release_date} onChange={e => setForm(f => ({ ...f, expected_release_date: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Release Date</label>
                    <input type="date" className="input" value={form.release_date} onChange={e => setForm(f => ({ ...f, release_date: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Inspector</label>
                    <input className="input" value={form.inspector} onChange={e => setForm(f => ({ ...f, inspector: e.target.value }))} />
                  </div>
                </div>
              </FormSection>

              <div>
                <label className="label">Photos</label>
                <input
                  type="file" accept="image/*" multiple className="input text-sm py-1.5"
                  onChange={handlePhotoFiles}
                />
                {form.photos.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {form.photos.map((src, i) => (
                      <div key={i} className="relative">
                        <PhotoPreview src={src} alt={`Photo ${i + 1}`} className="h-16 w-16 object-cover rounded border border-[var(--input-border)]" />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute -top-1.5 -right-1.5 bg-red-700 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] hover:bg-red-500"
                        >
                          <X size={8} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Save size={16} /> {saving ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
        </div>
      )}

      {/* ── Bulk Delete Confirmation (Admin only) ───────────────────────────── */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => { if (!bulkBusy) { setBulkDeleteOpen(false); setBulkError('') } }}>
          <div className="bg-[var(--surface-1)] border border-red-800/50 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex gap-3 mb-4">
              <AlertTriangle size={20} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-[var(--text-primary)] font-semibold">Delete {selectedIds.size} incident{selectedIds.size !== 1 ? 's' : ''}?</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">This permanently removes the selected incident records and their claim data. This cannot be undone.</p>
              </div>
            </div>
            {bulkError && (
              <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{bulkError}</p>
            )}
            <div className="flex gap-3">
              <button onClick={confirmBulkDelete} disabled={bulkBusy}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
                <Trash2 size={14} /> {bulkBusy ? 'Deleting...' : `Delete ${selectedIds.size}`}
              </button>
              <button onClick={() => { setBulkDeleteOpen(false); setBulkError('') }} disabled={bulkBusy} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function PhotoPreview({ src, alt, className }) {
  const [resolved, setResolved] = useState(src)

  useEffect(() => {
    let mounted = true
    resolveStorageUrl(src).then(url => {
      if (mounted) setResolved(url || '')
    })
    return () => { mounted = false }
  }, [src])

  if (!resolved) {
    return <div className={`${className} bg-[var(--input-bg)] flex items-center justify-center text-[10px] text-[var(--text-muted)]`}>Photo</div>
  }

  return <img src={resolved} alt={alt} className={className} />
}
