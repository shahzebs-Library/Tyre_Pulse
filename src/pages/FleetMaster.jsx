import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import ViewSwitch from '../components/ui/ViewSwitch'
import { useFilterState } from '../hooks/useFilterState'
import { useScrollRestore } from '../hooks/useScrollRestore'
import { toUserMessage } from '../lib/safeError'
import { assets } from '../lib/api'
import { missingRequiredFields, summarizeLinkedRecords, groupBulkDelete } from '../lib/api/fleetMasterData'
import { useAuth } from '../contexts/AuthContext'
import { useWriteAccess } from '../hooks/useWriteAccess'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToExcel } from '../lib/exportUtils'
import { canAddResource } from '../lib/api/billing'
import {
  Search, Plus, Edit2, Trash2, Save, X, AlertTriangle, Truck, ClipboardCheck,
  CheckCircle2, Wrench, AlertCircle, FileText, CircleSlash, MapPin, Activity, Layers,
  Bookmark, Columns, Download, ChevronDown, MoreHorizontal, Upload, BarChart3,
  CalendarClock, ShieldCheck, Gauge, ChevronRight, Eye, Copy, Circle,
  Bus, Car, Construction, Container, Factory, ListChecks, Siren, ArrowUpDown, Info, Camera, ScanLine,
} from 'lucide-react'
import { vehicleKind } from '../lib/vehiclePhoto'
import { VerifyOnSiteModal, VerificationBadge, PendingVerificationsPanel, PossibleTransfersPanel } from '../components/fleetVerification'
import { canVerify } from '../lib/fleetVerification'
import { countVerification } from '../lib/api/fleetVerification'
import useAnchoredPopover from '../components/ui/useAnchoredPopover'
import DialogModal from '../components/ui/Modal'
import CustomFieldsPanel from '../components/CustomFieldsPanel'
import { PageHero, Kpi, Card, ViewAll, Donut, Pager, VehicleThumb, KitTable, fmtInt, fmtPct } from '../components/commandCenter/kit'
import {
  PRIORITY_MATRIX, CRITICALITY_CRITERIA, PRIORITY_FILTER_OPTIONS, priorityFor, prioritySetFor,
} from '../lib/assetPriority'
import './fleetMaster.css'

const DEFAULT_PAGE_SIZE = 25
// Mirrors the pager's own page-size selector. The page size is restored from
// the URL, so it is validated against this list rather than trusted.
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

const STATUS_OPTIONS = ['Active', 'Inactive', 'Retired', 'Transferred']

/**
 * Quick filters the KPI tiles and insights apply. Each is answered by the
 * server (assets.listFleetRecords `flag`), so a filtered register is the WHOLE
 * matching set, never the page that happened to be loaded.
 */
const FLAG_LABELS = {
  maintenance: 'Under maintenance',
  missing_specs: 'Missing specs',
  no_policy: 'No policy set',
  inactive: 'Inactive',
}

/**
 * Country a NEW vehicle inherits from the working context. On the All-countries
 * view there is no country to inherit, so the field opens BLANK and the user has
 * to choose one - a silent 'KSA' default would file the asset under a country
 * nobody picked, taking its currency and RLS visibility with it.
 */
const defaultCountryFor = (active) => (active && active !== 'All' ? active : '')

// Plain literals, not t() keys: the locale files are outside this change, and a
// missing key would render the key itself on screen.
const COUNTRY_REQUIRED_HINT = 'Select a country. You are viewing all countries.'
const COUNTRY_PLACEHOLDER = 'Select a country'

const EMPTY_FORM = (country = '') => ({
  asset_no: '',
  fleet_number: '',
  make: '',
  model: '',
  vehicle_type: '',
  year: '',
  status: 'Active',
  department: '',
  operator_name: '',
  site: '',
  country,
  expected_km_per_tyre: '',
  min_days_between_changes: 30,
  max_tyres_per_day: 2,
  tyre_size: '',
  tyre_brand_preferred: '',
  monthly_tyre_budget: '',
  notes: '',
})

const EXPORT_COLS = [
  { key: 'asset_no',                header: 'Asset No',          width: 24 },
  { key: 'fleet_number',            header: 'Fleet No',          width: 20 },
  { key: 'make',                    header: 'Make',              width: 22 },
  { key: 'model',                   header: 'Model',             width: 22 },
  { key: 'vehicle_type',            header: 'Type',              width: 22 },
  { key: 'year',                    header: 'Year',              width: 12 },
  { key: 'site',                    header: 'Site',              width: 24 },
  { key: 'operator_name',           header: 'Operator',          width: 26 },
  { key: 'status',                  header: 'Status',            width: 18 },
  { key: 'priority_label',          header: 'Priority',          width: 14 },
  { key: 'criticality',             header: 'Criticality',       width: 14 },
  { key: 'ops_status',              header: 'Operating State',   width: 18 },
  { key: 'expected_km_per_tyre',    header: 'Expected KM/Tyre',  width: 22 },
  { key: 'min_days_between_changes',header: 'Min Days',          width: 16 },
  { key: 'tyre_size',               header: 'Tyre Size',         width: 20 },
  { key: 'monthly_tyre_budget',     header: 'Monthly Budget',    width: 20 },
  { key: 'notes',                   header: 'Notes',             width: 36 },
]

/** Hideable register columns. Asset No, the checkbox and actions always show. */
const TABLE_COLUMNS = [
  { key: 'fleet', label: 'Fleet No' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'type', label: 'Type' },
  { key: 'year', label: 'Year' },
  { key: 'site', label: 'Site' },
  { key: 'operator', label: 'Operator' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'policy', label: 'Policy' },
  { key: 'service', label: 'Last Service' },
]
const COLUMNS_KEY = 'fleetMaster.columns.v1'
const VIEWS_KEY = 'fleetMaster.savedViews.v1'

// Browser storage is a per-viewer convenience only. It can be missing or throw
// (private window, blocked site data), so every read and write is guarded and
// the page works the same without it.
function readStore(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}
function writeStore(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
}

const KIND_ICON = {
  bus: Bus, pickup: Car, wheelLoader: Construction, skidLoader: Construction, trailer: Container,
  generator: Factory, chiller: Factory, batchingPlant: Factory, placingBoom: Factory, stationaryPump: Factory,
  towablePump: Container, tyreless: Factory,
}

const isActiveRow = (r) => r?.status === 'Active'
const isBreakdown = (r) => String(r?.ops_status || '').toLowerCase() === 'breakdown'

/** Operating state pill: the register status plus today's breakdown flag. */
function statusPill(r) {
  if (isActiveRow(r) && isBreakdown(r)) return { tone: 'warn', key: 'maintenance', label: 'Maintenance', Icon: Wrench }
  if (isActiveRow(r)) return { tone: 'good', key: 'active', label: 'Active', Icon: CheckCircle2 }
  return { tone: 'muted', key: STATUS_OPTIONS.includes(r?.status) ? r.status : (r?.status ? null : 'notSet'), label: r?.status || 'Not set', Icon: Circle }
}

/** Policy readiness: specs first, then the tyre-change policy. */
function policyPill(r) {
  if (!r?.make || !r?.model) return { tone: 'bad', key: 'missingSpecs', label: 'Missing Specs', Icon: AlertCircle }
  if (!r?.expected_km_per_tyre && !r?.min_days_between_changes) return { tone: 'warn', key: 'noPolicy', label: 'No Policy', Icon: null }
  return { tone: 'good', key: 'compliant', label: 'Compliant', Icon: null }
}

/** Maintenance priority badge tone, on the existing cc-pill tones. */
const PRIORITY_TONE = { 1: 'bad', 2: 'orange', 3: 'warn', 4: 'info', 5: 'info', 6: 'muted' }

/** Export rows carry the derived priority beside the register columns. */
const withPriority = (rows) => (rows || []).map((r) => {
  const pr = priorityFor(r)
  return { ...r, priority_label: `P${pr.priority}`, criticality: pr.criticality }
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * Dropdown anchored to its trigger and portalled to the body, so the table's
 * horizontal scroll box cannot clip it. The panel carries the `cc` class so it
 * reads the same light and dark tokens as the page.
 */
function Menu({ label, trigger, triggerClass = 'cc-btn-ghost', disabled, width = 220, align = 'right', role = 'menu', children, title }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const { triggerRef, panelRef, coords } = useAnchoredPopover(open, {
    width, height: 300, align, nav: role === 'menu' ? 'menu' : 'trap', onRequestClose: close,
  })
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus?.() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, panelRef, triggerRef])
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-haspopup={role === 'menu' ? 'menu' : 'dialog'}
        aria-expanded={open}
        aria-label={label}
        title={title}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      >
        {trigger}
      </button>
      {open && coords && createPortal(
        <div
          ref={panelRef}
          role={role}
          aria-label={label}
          className="cc fm-pop"
          style={{ top: coords.top, left: coords.left, width, maxHeight: coords.maxHeight }}
          onClick={(e) => e.stopPropagation()}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>,
        document.body,
      )}
    </>
  )
}

function MenuItem({ icon: Icon, children, onClick, danger, disabled, title }) {
  return (
    <button type="button" role="menuitem" className={`fm-pop-item ${danger ? 'danger' : ''}`} onClick={onClick} disabled={disabled} title={title}>
      {Icon && <Icon size={14} aria-hidden="true" />}<span>{children}</span>
    </button>
  )
}

function SelectField({ icon: Icon, label, value, onChange, children }) {
  return (
    <label className="fm-sel">
      <span className="fm-sr">{label}</span>
      <Icon size={15} aria-hidden="true" />
      <select className="cc-select" value={value} onChange={onChange}>{children}</select>
    </label>
  )
}

/** Insight row. `num` is drawn in the row's tone; null means "not measured". */
function Insight({ icon: Icon, tone, num, text, fallback, sub, onClick, to }) {
  const body = (
    <>
      <span className={`fm-ins-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span>
      <span className="fm-ins-main">
        <b>{num == null ? fallback : <><span className={`fm-ins-num ${tone}`}>{num}</span> {text}</>}</b>
        <small>{sub}</small>
      </span>
      <ChevronRight size={15} className="cc-chev" aria-hidden="true" />
    </>
  )
  if (to) return <Link to={to} className="cc-insight">{body}</Link>
  return <button type="button" className="cc-insight" onClick={onClick}>{body}</button>
}

// Asset analysis (formerly its own page at /asset-management): health matrix,
// fleet composition, utilisation trend, operational status and PDF export.
// Same access rule as this page (the fleet_master module). Loaded when opened.
const AssetAnalysis = lazy(() => import('./AssetManagement'))
const FLEET_VIEWS = [
  { key: 'register', label: 'Asset register' },
  { key: 'analysis', label: 'Asset analysis' },
]

export default function FleetMaster() {
  const { t } = useLanguage()
  const [params, setParams] = useSearchParams()
  const view = params.get('tab') === 'analysis' ? 'analysis' : 'register'
  // Both views keep their filters in the address bar under the same names
  // (search, site, status, page), so switching view starts the other one clean.
  const changeView = (next) => setParams(next === 'analysis' ? { tab: 'analysis' } : {})
  return (
    <div className="space-y-4">
      <ViewSwitch views={FLEET_VIEWS.map((v) => ({ ...v, label: t(`fleetmaster.reg.views.${v.key}`) }))} value={view} onChange={changeView} label={t('fleetmaster.reg.views.aria')} />
      {view === 'analysis' ? (
        <Suspense fallback={<p role="status" className="py-10 text-center text-sm text-[var(--text-secondary)]">{t('fleetmaster.reg.loading')}</p>}>
          <AssetAnalysis />
        </Suspense>
      ) : (
        <FleetRegister />
      )}
    </div>
  )
}

function FleetRegister() {
  const navigate = useNavigate()
  const { profile, isSuperAdmin } = useAuth()
  const { activeCountry, activeCurrency } = useSettings()
  const { t } = useLanguage()
  // On-site verification (migration 20261127180000). Counts come from the
  // server so the tile covers the whole register, not the page on screen.
  const mayVerify = canVerify({ role: profile?.role, isSuperAdmin })
  const [verifyRow, setVerifyRow] = useState(null)
  const [verifyCounts, setVerifyCounts] = useState({ loading: true, counts: null, notSetUp: false })
  const [verifyTick, setVerifyTick] = useState(0)
  useEffect(() => {
    let alive = true
    setVerifyCounts((v) => ({ ...v, loading: true }))
    countVerification(activeCountry)
      .then((r) => { if (alive) setVerifyCounts({ loading: false, counts: r.notSetUp ? null : r, notSetUp: r.notSetUp }) })
      .catch(() => { if (alive) setVerifyCounts({ loading: false, counts: null, notSetUp: false }) })
    return () => { alive = false }
  }, [activeCountry, verifyTick])
  // t() hands back the key itself when a string is missing; show the English
  // fallback instead so a missing locale entry never reaches the screen.
  const tx = useCallback((key, fallback, vars) => {
    const r = t(key, vars)
    if (!r || r === key) {
      if (!vars) return fallback
      return fallback.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
    }
    return r
  }, [t])
  // "3 inspections, 12 tyre records", one translated phrase per table.
  const historyText = useCallback((counts = []) => counts.map(({ table, count }) => {
    const form = count === 1 ? 'one' : 'many'
    const noun = { inspections: ['inspection', 'inspections'], tyre_records: ['tyre record', 'tyre records'],
      work_orders: ['work order', 'work orders'], accidents: ['accident', 'accidents'] }[table] || [table, table]
    return tx(`fleetmaster.history.${table}_${form}`, `{count} ${form === 'one' ? noun[0] : noun[1]}`, { count: count.toLocaleString() })
  }).join(', '), [tx])

  // ── data ─────────────────────────────────────────────────────────────────────
  const [records, setRecords]   = useState([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')
  const [sites, setSites]       = useState([])
  const [types, setTypes]       = useState([])
  const [summaryCapped, setSummaryCapped] = useState(false)

  // ── filters ──────────────────────────────────────────────────────────────────
  // Search, site, status, type, quick filter, page and page size live in the URL
  // (useFilterState) so they SURVIVE opening a vehicle and pressing Back: the row
  // opens `/vehicle/:asset_no` as a route, so without this the register would
  // remount and reset to page 1 of an unfiltered list.
  const [filters, setFilter, , , setFilters] = useFilterState({
    search: '', site: '', status: '', type: '', flag: '', priority: '', page: '1', size: String(DEFAULT_PAGE_SIZE),
  })
  const search = filters.search
  const [filterCountry, setFilterCountry] = useState(activeCountry)
  const countryChanged = filterCountry !== activeCountry
  const siteFilter = countryChanged ? '' : filters.site
  const typeFilter = countryChanged ? '' : filters.type
  const statusFilter = filters.status
  const flagFilter = FLAG_LABELS[filters.flag] ? filters.flag : ''
  // Only a value the Priority select offers is honoured; anything else in the
  // URL is ignored rather than turned into a query.
  const priorityFilter = prioritySetFor(filters.priority) ? filters.priority : ''
  const prioritySet = useMemo(() => prioritySetFor(priorityFilter), [priorityFilter])
  // The URL carries a human-readable 1-based page; the query is 0-based.
  const requestedPage = Number(filters.page)
  const page = !countryChanged && Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? requestedPage - 1
    : 0
  useEffect(() => {
    if (!countryChanged) return
    setFilters({ site: '', type: '', page: '1' })
    setFilterCountry(activeCountry)
  }, [activeCountry, countryChanged, setFilters])
  // Clamped to the sizes the pager itself offers. The value comes from the URL,
  // and an arbitrary one would widen the server range this read is bounded by -
  // a hand-typed `?size=100000` must not become a bigger query.
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(filters.size))
    ? Number(filters.size)
    : DEFAULT_PAGE_SIZE
  const setPage = useCallback(p => setFilter('page', String((Number(p) || 0) + 1)), [setFilter])
  // Puts the list back where it was scrolled to when the user returns from
  // /vehicle/:asset_no. Only once the rows exist, or there is nothing to scroll.
  const listRef = useScrollRestore('fleet-master', !loading && records.length > 0)
  // Debounced copy that actually drives the query, so we don't fire a Supabase
  // request on every keystroke. Seeded from the URL so a restored `?search=`
  // queries immediately instead of after 300ms.
  const [debouncedSearch, setDebouncedSearch] = useState(() => filters.search)
  // Monotonic request id: only the newest loadRecords() response is applied, so a
  // slow earlier query can't overwrite a faster later one (out-of-order race).
  const reqIdRef = useRef(0)

  // ── modal state ──────────────────────────────────────────────────────────────
  const [editRecord, setEditRecord]           = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget]       = useState(null)
  const [saving, setSaving]                   = useState(false)
  const [formError, setFormError]             = useState('')
  const [atLimit, setAtLimit]                 = useState(false)
  const [deleteError, setDeleteError]         = useState('')
  const [form, setForm]                       = useState(() => EMPTY_FORM())
  // True only while the country is genuinely unchosen (the All-countries case),
  // which is when the field needs the hint rather than a quiet default.
  const countryUnset = !String(form.country || '').trim()
  // Required fields still blank, named, so a disabled Save says why.
  const missingRequired = missingRequiredFields(form, {
    asset_no: t('fleetmaster.form.assetNo'),
    country: t('fleetmaster.form.country'),
  })
  const missingLine = missingRequired.length
    ? tx('fleetmaster.form.fillIn', 'Fill in: {fields}', { fields: missingRequired.join(', ') })
    : ''
  // Linked history for the vehicle in the delete dialog:
  // { state: 'loading' | 'ready' | 'error', summary }
  const [deleteHistory, setDeleteHistory] = useState({ state: 'idle', summary: null })
  const deleteHistoryReq = useRef(0)

  // ── permissions ──────────────────────────────────────────────────────────────
  const role = String(profile?.role || '').toLowerCase()
  const isAdmin = role === 'admin' || isSuperAdmin === true
  // The fleet register is written through the fleet_master capability only
  // (Admin, plus any role or person an Admin has given it to in Access Control);
  // deleting is Admin only. The answer comes from the server function the row
  // policies themselves call, so a control shown here is one the save will accept.
  const access = useWriteAccess('vehicle_fleet')
  const canDelete = access.delete
  const canEdit = access.edit
  const canAdd = access.create

  // ── selection (persists across pages) ────────────────────────────────────────
  // id -> row, so a bulk export or action still knows a row selected on page 1
  // after the user has paged on.
  const [selected, setSelected]               = useState({})
  const selectedIds = useMemo(() => Object.keys(selected), [selected])
  const selectedRows = useMemo(() => Object.values(selected), [selected])
  const [bulkDeleteOpen, setBulkDeleteOpen]   = useState(false)
  // History check for the bulk delete: { state: 'loading' | 'ready', groups }
  const [bulkHistory, setBulkHistory]         = useState({ state: 'idle', groups: null })
  const bulkHistoryReq = useRef(0)
  const [bulkError, setBulkError]             = useState('')
  const [bulkBusy, setBulkBusy]               = useState(false)
  const [bulkDialog, setBulkDialog]           = useState(null) // 'status' | 'policy' | null
  const [bulkStatus, setBulkStatus]           = useState('Active')
  const [bulkPolicy, setBulkPolicy]           = useState({ expected_km_per_tyre: '', min_days_between_changes: '', max_tyres_per_day: '' })
  const [notice, setNotice]                   = useState('')

  // ── columns + saved views (per viewer) ───────────────────────────────────────
  const [hiddenCols, setHiddenCols] = useState(() => {
    const v = readStore(COLUMNS_KEY, [])
    return Array.isArray(v) ? v.filter(k => TABLE_COLUMNS.some(c => c.key === k)) : []
  })
  const show = (key) => !hiddenCols.includes(key)
  const toggleCol = (key) => setHiddenCols((prev) => {
    const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    writeStore(COLUMNS_KEY, next)
    return next
  })
  const [views, setViews] = useState(() => {
    const v = readStore(VIEWS_KEY, [])
    return Array.isArray(v) ? v.filter(x => x && typeof x.name === 'string' && x.filters) : []
  })
  const [viewName, setViewName] = useState('')

  // ── load ─────────────────────────────────────────────────────────────────────
  const sitesRequestRef = useRef(0)
  const loadSites = useCallback(async () => {
    const requestId = ++sitesRequestRef.current
    setSites([])
    try {
      const siteList = await assets.listSites({ country: activeCountry })
      if (requestId === sitesRequestRef.current) setSites(siteList)
    } catch (e) {
      console.error(e)
    }
  }, [activeCountry])

  const invalidateSiteRequests = useCallback(() => { sitesRequestRef.current++ }, [])
  useEffect(() => {
    loadSites()
    return invalidateSiteRequests
  }, [loadSites, invalidateSiteRequests])

  useEffect(() => {
    let cancelled = false
    setTypes([])
    Promise.resolve()
      .then(() => assets.listFleetTypes({ country: activeCountry }))
      .then((list) => { if (!cancelled && Array.isArray(list)) setTypes(list) })
      .catch(() => { /* the Type filter simply offers no options */ })
    return () => { cancelled = true }
  }, [activeCountry])

  // Debounce the search box: reset to page 0 and reload 300ms after typing stops.
  // The page reset only fires when the term actually changed, so arriving on a
  // restored URL (`?search=TM&page=3`) keeps its page instead of snapping to 1.
  useEffect(() => {
    if (search === debouncedSearch) return
    const tm = setTimeout(() => { setDebouncedSearch(search); setPage(0) }, 300)
    return () => clearTimeout(tm)
  }, [search, debouncedSearch, setPage])
  const loadRecords = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    if (search !== debouncedSearch) return
    try {
      const { data, count } = await assets.listFleetRecords({
        page,
        pageSize,
        search: debouncedSearch,
        site: siteFilter,
        status: statusFilter,
        type: typeFilter,
        flag: flagFilter,
        priority: prioritySet || undefined,
        country: activeCountry
      })
      if (myReq !== reqIdRef.current) return   // a newer request superseded this one
      setRecords(data)
      setTotal(count)
      setLoadError('')
    } catch (e) {
      if (myReq === reqIdRef.current) {
        setRecords([]); setTotal(0)
        setLoadError(toUserMessage(e, t('fleetmaster.reg.err.load')))
      }
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  // t is left out on purpose: a language switch must not refetch the register.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, search, debouncedSearch, siteFilter, statusFilter, typeFilter, flagFilter, prioritySet, activeCountry])

  const invalidateRecordRequests = useCallback(() => { reqIdRef.current++ }, [])
  useEffect(() => {
    loadRecords()
    return invalidateRecordRequests
  }, [loadRecords, invalidateRecordRequests])

  // ── last service for the rows on screen only ─────────────────────────────────
  const [lastService, setLastService] = useState({ state: 'idle', map: {} })
  useEffect(() => {
    let cancelled = false
    if (loading || !records.length) { setLastService({ state: 'idle', map: {} }); return undefined }
    setLastService({ state: 'loading', map: {} })
    Promise.resolve()
      .then(() => assets.getLastServiceByAsset(records))
      .then((map) => { if (!cancelled) setLastService({ state: 'ready', map: map || {} }) })
      .catch(() => { if (!cancelled) setLastService({ state: 'error', map: {} }) })
    return () => { cancelled = true }
  }, [records, loading])

  // ── summary cards ─────────────────────────────────────────────────────────────
  const [summary, setSummary] = useState(null)
  const [summaryFailed, setSummaryFailed] = useState(false)
  const summaryPending = countryChanged || search !== debouncedSearch || !summary

  useEffect(() => {
    let cancelled = false
    setSummary(null)
    setSummaryFailed(false)
    setSummaryCapped(false)
    if (search !== debouncedSearch) return () => { cancelled = true }
    async function loadSummary() {
      try {
        const sumData = await assets.getFleetSummary({
          country: activeCountry,
          search: debouncedSearch,
          site: siteFilter,
          type: typeFilter,
        })
        if (cancelled) return
        setSummaryCapped(sumData.truncated)
        setSummary({
          total:        sumData.total,
          active:       sumData.active,
          maintenance:  sumData.maintenance ?? null,
          inactive:     sumData.inactive ?? null,
          missingSpecs: sumData.missingSpecs,
          noPolicy:     sumData.noPolicy,
          sites:        sumData.sites ?? null,
          countries:    sumData.countries ?? null,
          growth:       sumData.growth ?? {},
        })
      } catch (e) {
        console.error(e)
        if (!cancelled) setSummaryFailed(true)
      }
    }
    loadSummary()
    return () => { cancelled = true }
  }, [activeCountry, search, debouncedSearch, siteFilter, typeFilter, records])

  // ── critical and high (P1 to P3) count: one head-only query, never paged ─────
  const [critHigh, setCritHigh] = useState({ state: 'loading', count: null })
  useEffect(() => {
    let cancelled = false
    setCritHigh({ state: 'loading', count: null })
    if (search !== debouncedSearch) return () => { cancelled = true }
    Promise.resolve()
      .then(() => assets.countFleetByPriority({
        priority: [1, 2, 3], search: debouncedSearch, site: siteFilter, type: typeFilter, country: activeCountry,
      }))
      .then((n) => {
        if (cancelled) return
        setCritHigh(Number.isFinite(n) ? { state: 'ready', count: n } : { state: 'error', count: null })
      })
      .catch(() => { if (!cancelled) setCritHigh({ state: 'error', count: null }) })
    return () => { cancelled = true }
  }, [activeCountry, search, debouncedSearch, siteFilter, typeFilter, records])

  // ── insights that live outside the register ─────────────────────────────────
  const [pmDue, setPmDue] = useState({ state: 'loading', data: null })
  const [util, setUtil] = useState({ state: 'loading', data: null })
  useEffect(() => {
    let cancelled = false
    setPmDue({ state: 'loading', data: null })
    setUtil({ state: 'loading', data: null })
    Promise.resolve().then(() => assets.countPmDueSoon({ country: activeCountry }))
      .then((d) => { if (!cancelled) setPmDue({ state: 'ready', data: d }) })
      .catch(() => { if (!cancelled) setPmDue({ state: 'error', data: null }) })
    Promise.resolve().then(() => assets.getUtilisationSummary({ country: activeCountry }))
      .then((d) => { if (!cancelled) setUtil({ state: 'ready', data: d }) })
      .catch(() => { if (!cancelled) setUtil({ state: 'error', data: null }) })
    return () => { cancelled = true }
  }, [activeCountry])

  // ── add / edit ────────────────────────────────────────────────────────────────
  async function openAdd() {
    setForm(EMPTY_FORM(defaultCountryFor(activeCountry)))
    setEditRecord({})
    setFormError('')
    // Proactively surface a reached plan cap so the Save button is disabled with a
    // visible reason, instead of appearing active and silently failing on submit.
    setAtLimit(false)
    try { if (!(await canAddResource('vehicles'))) setAtLimit(true) } catch { /* fail open */ }
  }

  function openEdit(r) {
    setForm({
      asset_no:                   r.asset_no ?? '',
      fleet_number:               r.fleet_number ?? '',
      make:                       r.make ?? '',
      model:                      r.model ?? '',
      vehicle_type:               r.vehicle_type ?? '',
      year:                       r.year ?? '',
      status:                     r.status ?? 'Active',
      department:                 r.department ?? '',
      operator_name:              r.operator_name ?? '',
      site:                       r.site ?? '',
      country:                    r.country ?? 'KSA',
      expected_km_per_tyre:       r.expected_km_per_tyre ?? '',
      min_days_between_changes:   r.min_days_between_changes ?? 30,
      max_tyres_per_day:          r.max_tyres_per_day ?? 2,
      tyre_size:                  r.tyre_size ?? '',
      tyre_brand_preferred:       r.tyre_brand_preferred ?? '',
      monthly_tyre_budget:        r.monthly_tyre_budget ?? '',
      notes:                      r.notes ?? '',
    })
    setEditRecord(r)
    setFormError('')
    setAtLimit(false)  // edits never add to the count
  }

  async function saveRecord(e) {
    e.preventDefault()
    if (!form.asset_no.trim()) { setFormError(t('fleetmaster.form.required')); return }
    // Never stamp a country the user did not choose: on the All-countries view the
    // field opens blank, so it has to be picked before the vehicle can be saved.
    if (!String(form.country || '').trim()) { setFormError(COUNTRY_REQUIRED_HINT); return }
    setSaving(true)
    setFormError('')

    // Plan entitlement: only gate NEW vehicles (edits never add to the count).
    // Server-authoritative via org_can_add(); fails open on any RPC error so a
    // transient failure never blocks a legitimate edit/create.
    if (!editRecord?.id) {
      const allowed = await canAddResource('vehicles')
      if (!allowed) {
        setFormError(t('fleetmaster.form.planLimit'))
        setSaving(false)
        return
      }
    }

    const payload = {
      ...form,
      year:                       form.year !== '' ? +form.year : null,
      expected_km_per_tyre:       form.expected_km_per_tyre !== '' ? +form.expected_km_per_tyre : null,
      min_days_between_changes:   form.min_days_between_changes !== '' ? +form.min_days_between_changes : 30,
      max_tyres_per_day:          form.max_tyres_per_day !== '' ? +form.max_tyres_per_day : 2,
      monthly_tyre_budget:        form.monthly_tyre_budget !== '' ? +form.monthly_tyre_budget : null,
      updated_at:                 new Date().toISOString(),
      created_by:                 profile?.id,
    }
    try {
      await assets.saveFleetRecord(payload, editRecord?.id)
      setEditRecord(null)
      loadRecords()
      loadSites()
      setSaving(false)
    } catch (error) {
      setFormError(toUserMessage(error, t('fleetmaster.reg.err.save')))
      setSaving(false)
    }
  }

  // ── delete ────────────────────────────────────────────────────────────────────
  async function confirmDelete(r) {
    setDeleteTarget(r)
    setDeleteError('')
    setShowDeleteConfirm(true)
    const req = ++deleteHistoryReq.current
    setDeleteHistory({ state: 'loading', summary: null })
    try {
      const counts = await assets.countLinkedRecords({ assetNo: r.asset_no, country: r.country })
      if (req !== deleteHistoryReq.current) return
      setDeleteHistory({ state: 'ready', summary: summarizeLinkedRecords(counts) })
    } catch {
      if (req !== deleteHistoryReq.current) return
      setDeleteHistory({ state: 'ready', summary: summarizeLinkedRecords({}) })
    }
  }

  function closeDelete() {
    deleteHistoryReq.current++
    setShowDeleteConfirm(false)
    setDeleteTarget(null)
    setDeleteError('')
    setDeleteHistory({ state: 'idle', summary: null })
  }

  // Keeps the vehicle and its history; it just leaves the active fleet.
  async function markInactive() {
    if (!deleteTarget) return
    setSaving(true)
    setDeleteError('')
    try {
      await assets.saveFleetRecord({ status: 'Inactive', updated_at: new Date().toISOString() }, deleteTarget.id)
      closeDelete()
      setNotice(tx('fleetmaster.delete.markedInactive', '{assetNo} marked Inactive. Its history is kept.', { assetNo: deleteTarget.asset_no }))
      loadRecords()
    } catch (e) {
      setDeleteError(toUserMessage(e, tx('fleetmaster.delete.errMarkInactive', 'Could not mark the vehicle Inactive.')))
    } finally {
      setSaving(false)
    }
  }

  async function deleteRecord() {
    if (!deleteTarget) return
    // Permanent delete only for a vehicle checked and found to have no history.
    if (deleteHistory.state !== 'ready' || deleteHistory.summary?.state !== 'none') return
    setSaving(true)
    setDeleteError('')
    try {
      await assets.deleteFleetRecord(deleteTarget.id)
      const id = deleteTarget.id
      closeDelete()
      setSelected((prev) => { const n = { ...prev }; delete n[id]; return n })
      loadRecords()
      loadSites()
    } catch (e) {
      setDeleteError(toUserMessage(e, t('fleetmaster.delete.errFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function openBulkDelete() {
    setBulkError('')
    setBulkDeleteOpen(true)
    const rows = selectedRows
    const req = ++bulkHistoryReq.current
    setBulkHistory({ state: 'loading', groups: null })
    let counts = {}
    try { counts = await assets.countLinkedRecordsBulk(rows) } catch { counts = {} }
    if (req !== bulkHistoryReq.current) return
    setBulkHistory({ state: 'ready', groups: groupBulkDelete(rows, counts) })
  }

  function closeBulkDelete() {
    bulkHistoryReq.current++
    setBulkDeleteOpen(false)
    setBulkError('')
    setBulkHistory({ state: 'idle', groups: null })
  }

  // Permanently deletes ONLY the selected vehicles checked and found to have no history.
  async function confirmBulkDelete() {
    const clean = bulkHistory.state === 'ready' ? bulkHistory.groups.clean : []
    if (clean.length === 0) return
    setBulkBusy(true)
    setBulkError('')
    try {
      const ids = clean.map(r => r.id)
      await assets.deleteFleetRecords(ids)
      closeBulkDelete()
      setSelected((prev) => { const n = { ...prev }; for (const id of ids) delete n[id]; return n })
      setNotice(tx('fleetmaster.bulkDelete.deletedClean', '{count} vehicle(s) with no history deleted.', { count: fmtInt(ids.length) }))
      loadRecords()
      loadSites()
    } catch (e) {
      setBulkError(toUserMessage(e, t('fleetmaster.bulkDelete.errFailed')))
    } finally {
      setBulkBusy(false)
    }
  }

  // Marks the selected vehicles that have (or may have) history Inactive.
  async function bulkMarkInactive() {
    if (bulkHistory.state !== 'ready') return
    const keep = [...bulkHistory.groups.history, ...bulkHistory.groups.unknown]
    if (keep.length === 0) return
    setBulkBusy(true)
    setBulkError('')
    try {
      const ids = keep.map(r => r.id)
      const updated = await assets.bulkUpdateFleetRecords(ids, { status: 'Inactive' })
      closeBulkDelete()
      setSelected((prev) => { const n = { ...prev }; for (const id of ids) delete n[id]; return n })
      setNotice(tx('fleetmaster.bulkDelete.markedInactive', '{count} vehicle(s) marked Inactive. Their history is kept.', { count: fmtInt(updated) }))
      loadRecords()
    } catch (e) {
      setBulkError(toUserMessage(e, tx('fleetmaster.bulkDelete.errMarkInactive', 'Could not mark the vehicles Inactive.')))
    } finally {
      setBulkBusy(false)
    }
  }

  // ── bulk edits ────────────────────────────────────────────────────────────────
  function openBulk(kind) {
    setBulkError('')
    if (kind === 'policy') setBulkPolicy({ expected_km_per_tyre: '', min_days_between_changes: '', max_tyres_per_day: '' })
    setBulkDialog(kind)
  }

  async function applyBulk() {
    const patch = {}
    if (bulkDialog === 'status') {
      patch.status = bulkStatus
    } else {
      for (const [k, v] of Object.entries(bulkPolicy)) {
        if (String(v).trim() === '') continue
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0) { setBulkError(t('fleetmaster.reg.err.numbers')); return }
        patch[k] = n
      }
      if (!Object.keys(patch).length) { setBulkError(t('fleetmaster.reg.err.onePolicy')); return }
    }
    setBulkBusy(true)
    setBulkError('')
    try {
      const updated = await assets.bulkUpdateFleetRecords(selectedIds, patch)
      const asked = selectedIds.length
      setBulkDialog(null)
      setNotice(updated === asked
        ? `Updated ${fmtInt(updated)} ${updated === 1 ? 'vehicle' : 'vehicles'}.`
        : `Updated ${fmtInt(updated)} of ${fmtInt(asked)} selected vehicles. The rest could not be changed with your access.`)
      setSelected({})
      loadRecords()
    } catch (e) {
      setBulkError(toUserMessage(e, t('fleetmaster.reg.err.bulkUpdate')))
    } finally {
      setBulkBusy(false)
    }
  }

  function exportRows(rows, suffix = '') {
    exportToExcel(
      withPriority(rows),
      EXPORT_COLS.map(c => c.key),
      EXPORT_COLS.map(c => t(`fleetmaster.reg.exportCols.${c.key}`)),
      `TyrePulse_FleetMaster${suffix}_${new Date().toISOString().slice(0, 10)}`,
      'Fleet Master'
    )
  }

  function copyAssetNumbers() {
    const text = selectedRows.map(r => r.asset_no).filter(Boolean).join('\n')
    try {
      Promise.resolve(navigator.clipboard?.writeText(text))
        .then(() => setNotice(t('fleetmaster.reg.copied', { count: fmtInt(selectedRows.length) })))
        .catch(() => setNotice(t('fleetmaster.reg.copyFailed')))
    } catch {
      setNotice(t('fleetmaster.reg.copyFailed'))
    }
  }

  // ── export ────────────────────────────────────────────────────────────────────
  async function fetchAll() {
    try {
      return await assets.fetchAllFleetRecords({
        search,
        site: siteFilter,
        status: statusFilter,
        type: typeFilter,
        flag: flagFilter,
        priority: prioritySet || undefined,
        country: activeCountry
      })
    } catch (e) {
      console.error(e)
      return []
    }
  }

  function handleExport() {
    fetchAll().then(rows => {
      exportToExcel(
        withPriority(rows),
        EXPORT_COLS.map(c => c.key),
        EXPORT_COLS.map(c => t(`fleetmaster.reg.exportCols.${c.key}`)),
        `TyrePulse_FleetMaster_${new Date().toISOString().slice(0, 10)}`,
        'Fleet Master'
      )
    })
  }

  function F(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  // ── filter helpers ────────────────────────────────────────────────────────────
  const applyFlag = (flag) => setFilters({ flag, status: '', page: '1' })
  const applyStatus = (status) => setFilters({ status, flag: '', page: '1' })
  const applyPriority = (priority) => setFilters({ priority, page: '1' })
  const clearAll = () => setFilters({ search: '', site: '', status: '', type: '', flag: '', priority: '', page: '1' })
  const anyFilter = Boolean(search || siteFilter || statusFilter || typeFilter || flagFilter || priorityFilter)

  function saveView(close) {
    const name = viewName.trim()
    if (!name) return
    const entry = { name, filters: { search, site: siteFilter, status: statusFilter, type: typeFilter, flag: flagFilter, priority: priorityFilter } }
    const next = [...views.filter(v => v.name !== name), entry].slice(-20)
    setViews(next)
    writeStore(VIEWS_KEY, next)
    setViewName('')
    close()
  }
  function applyView(v, close) {
    const f = v.filters || {}
    setFilters({
      search: f.search || '', site: f.site || '', status: f.status || '',
      type: f.type || '', flag: FLAG_LABELS[f.flag] ? f.flag : '',
      priority: prioritySetFor(f.priority) ? String(f.priority) : '', page: '1',
    })
    close()
  }
  function deleteView(name) {
    const next = views.filter(v => v.name !== name)
    setViews(next)
    writeStore(VIEWS_KEY, next)
  }

  // ── selection helpers ─────────────────────────────────────────────────────────
  const pageAllSelected = records.length > 0 && records.every(r => selected[r.id])
  const pageSomeSelected = records.some(r => selected[r.id])
  const togglePage = () => setSelected((prev) => {
    const n = { ...prev }
    if (pageAllSelected) records.forEach(r => { delete n[r.id] })
    else records.forEach(r => { n[r.id] = r })
    return n
  })
  const toggleRow = (r) => setSelected((prev) => {
    const n = { ...prev }
    if (n[r.id]) delete n[r.id]; else n[r.id] = r
    return n
  })
  const headCheckRef = useRef(null)
  useEffect(() => {
    if (headCheckRef.current) headCheckRef.current.indeterminate = pageSomeSelected && !pageAllSelected
  }, [pageSomeSelected, pageAllSelected])

  const openVehicle = (r) => navigate(`/vehicle/${encodeURIComponent(r.asset_no)}`)
  const none = selectedIds.length === 0

  // ── priority sort (client side, within the loaded page only) ─────────────────
  const [prioritySort, setPrioritySort] = useState('') // '' | 'asc' | 'desc'
  const cyclePrioritySort = () => setPrioritySort((s) => (s === '' ? 'asc' : s === 'asc' ? 'desc' : ''))
  const shownRecords = useMemo(() => {
    if (!prioritySort) return records
    const dir = prioritySort === 'asc' ? 1 : -1
    return records
      .map((r, i) => ({ r, i, p: priorityFor(r).priority }))
      .sort((a, b) => (a.p - b.p) * dir || a.i - b.i)
      .map((x) => x.r)
  }, [records, prioritySort])

  // ── derived ───────────────────────────────────────────────────────────────────
  const pct = (n) => (summary && summary.total ? (n / summary.total) * 100 : null)
  const donut = useMemo(() => {
    if (!summary || summary.maintenance == null || summary.inactive == null) return null
    return [
      { key: 'active', label: t('fleetmaster.reg.donut.active'), count: Math.max(0, summary.active - summary.maintenance), color: 'var(--cc-green)' },
      { key: 'maintenance', label: t('fleetmaster.reg.donut.maintenance'), count: summary.maintenance, color: 'var(--cc-amber)' },
      { key: 'inactive', label: t('fleetmaster.reg.donut.inactive'), count: summary.inactive, color: 'var(--cc-ink-3)' },
    ]
  }, [summary, t])
  const NA = <span className="cc-na">{t('fleetmaster.reg.na')}</span>
  const fleetColumns = [
    {
      key: 'select',
      header: <input ref={headCheckRef} type="checkbox" aria-label={t('fleetmaster.table.selectAllOnPage')} checked={pageAllSelected} onChange={togglePage} disabled={!records.length} />,
      cell: (r) => (
        <span onClick={e => e.stopPropagation()}>
          <input type="checkbox" aria-label={t('fleetmaster.reg.selectRow', { asset: r.asset_no })} checked={Boolean(selected[r.id])} onChange={() => toggleRow(r)} />
        </span>
      ),
    },
    { key: 'asset_no', header: t('fleetmaster.columns.assetNo'), cell: (r) => <span className="cc-strong">{r.asset_no ?? NA}</span> },
    show('fleet') && { key: 'fleet_number', header: t('fleetmaster.columns.fleetNo'), cell: (r) => r.fleet_number || NA },
    show('vehicle') && {
      key: 'vehicle', header: t('fleetmaster.reg.cols.vehicle'),
      cell: (r) => (
        <span className="cc-vehicle">
          <VehicleThumb row={r} size="sm" />
          <span>
            {r.make || r.model
              ? <><span className="cc-strong fm-trunc-name">{[r.make, r.model].filter(Boolean).join(' ')}</span>
                  <span className="cc-sub fm-trunc-name">{r.make || t('fleetmaster.reg.makeNotSet')} / {r.model || t('fleetmaster.reg.modelNotSet')}</span></>
              : <span className="cc-na">{t('fleetmaster.reg.makeModelNotRecorded')}</span>}
          </span>
        </span>
      ),
    },
    show('type') && {
      key: 'vehicle_type', header: t('fleetmaster.columns.type'),
      cell: (r) => {
        const TypeIcon = KIND_ICON[vehicleKind(r)] || Truck
        return r.vehicle_type
          ? <span className="fm-type" title={r.vehicle_type}><TypeIcon size={15} aria-hidden="true" /><span>{r.vehicle_type}</span></span>
          : NA
      },
    },
    show('year') && { key: 'year', header: t('fleetmaster.columns.year'), cell: (r) => (r.year ?? r.model_year) || NA },
    show('site') && {
      key: 'site', header: t('fleetmaster.columns.site'),
      cell: (r) => (r.site ? <span className="cc-site" title={r.site}><MapPin size={14} aria-hidden="true" /><span>{r.site}</span></span> : NA),
    },
    show('operator') && { key: 'operator_name', header: t('fleetmaster.columns.operator'), cell: (r) => <span className="fm-trunc">{r.operator_name || NA}</span> },
    show('status') && {
      key: 'status', header: t('fleetmaster.columns.status'),
      cell: (r) => { const st = statusPill(r); return <span className={`cc-pill ${st.tone}`} title={r.ops_status_note || undefined}><st.Icon size={12} aria-hidden="true" />{st.key ? t(`fleetmaster.reg.pill.${st.key}`) : st.label}</span> },
    },
    {
      key: 'verification', header: t('fleetVerification.column.title'),
      cell: (r) => <VerificationBadge status={r.verification_status} lastVerifiedAt={r.last_verified_at} />,
    },
    show('priority') && {
      key: 'priority',
      header: (
        <button type="button" className="cc-link-btn fm-sort-btn" onClick={(e) => { e.stopPropagation(); cyclePrioritySort() }}
          aria-label={prioritySort ? t(prioritySort === 'asc' ? 'fleetmaster.reg.sortP1' : 'fleetmaster.reg.sortP6') : t('fleetmaster.reg.sortPriority')}
          title={t('fleetmaster.reg.sortHint')}>
          {t('fleetmaster.reg.cols.priority')} <ArrowUpDown size={12} aria-hidden="true" />
        </button>
      ),
      cell: (r) => {
        const pr = priorityFor(r)
        const why = pr.basis === 'default'
          ? t('fleetmaster.reg.basis.default')
          : pr.basis === 'code' ? t('fleetmaster.reg.basis.code')
            : pr.basis === 'override' ? t('fleetmaster.reg.basis.override') : pr.basis === 'stored' ? t('fleetmaster.reg.basis.stored') : t('fleetmaster.reg.basis.type')
        return (
          <span title={`${pr.category}. ${pr.response} ${why}.`}>
            <span className={`cc-pill ${PRIORITY_TONE[pr.priority]}`}>{pr.label}</span>
            {pr.basis === 'default' && <span className="cc-sub">{t('fleetmaster.reg.defaultTag')}</span>}
          </span>
        )
      },
    },
    show('policy') && {
      key: 'policy', header: t('fleetmaster.columns.policy'),
      cell: (r) => { const pol = policyPill(r); return <span className={`cc-pill ${pol.tone}`}>{pol.Icon && <pol.Icon size={12} aria-hidden="true" />}{t(`fleetmaster.reg.pill.${pol.key}`)}</span> },
    },
    show('service') && {
      key: 'service', header: t('fleetmaster.reg.cols.service'),
      cell: (r) => {
        const svc = fmtDate(lastService.map[`${r.country || ''}|${r.asset_no}`])
        const km = r.current_km != null && Number.isFinite(Number(r.current_km)) ? `${fmtInt(Math.round(Number(r.current_km)))} km` : null
        return (
          <>
            {lastService.state === 'loading'
              ? <span className="cc-na">...</span>
              : svc
                ? <span>{svc}</span>
                : <span className="cc-na" title={lastService.state === 'error' ? t('fleetmaster.reg.serviceError') : t('fleetmaster.reg.noJobCard')}>{t('fleetmaster.reg.na')}</span>}
            {km && <span className="cc-sub">{km}</span>}
          </>
        )
      },
    },
    {
      key: 'actions', header: t('fleetmaster.reg.cols.actions'),
      cell: (r) => (
        <span className="fm-act-col" onClick={e => e.stopPropagation()}>
          <Menu label={t('fleetmaster.reg.actionsFor', { asset: r.asset_no })} triggerClass="cc-icon-btn" width={200} trigger={<MoreHorizontal size={16} aria-hidden="true" />}>
            {(close) => (
              <>
                <MenuItem icon={Eye} onClick={() => { close(); openVehicle(r) }}>{t('fleetmaster.reg.view')}</MenuItem>
                <MenuItem icon={ClipboardCheck} onClick={() => { close(); navigate(`/inspections?asset=${encodeURIComponent(r.asset_no)}`) }}>{t('fleetmaster.table.startChecklist')}</MenuItem>
                {mayVerify && <MenuItem icon={Camera} onClick={() => { close(); setVerifyRow(r) }}>{t('fleetVerification.action.verify')}</MenuItem>}
                {canEdit && <MenuItem icon={Edit2} onClick={() => { close(); openEdit(r) }}>{t('fleetmaster.table.edit')}</MenuItem>}
                {canDelete && <MenuItem icon={Trash2} danger onClick={() => { close(); confirmDelete(r) }}>{t('fleetmaster.table.delete')}</MenuItem>}
              </>
            )}
          </Menu>
        </span>
      ),
    },
  ].filter(Boolean)

  const heroStat = !summaryPending && summary
    ? {
        value: fmtInt(summary.total),
        lines: [
          t('fleetmaster.reg.hero.across'),
          summary.sites != null ? t(summary.sites === 1 ? 'fleetmaster.reg.hero.siteOne' : 'fleetmaster.reg.hero.sites', { count: fmtInt(summary.sites) }) : t('fleetmaster.reg.hero.sitesNa'),
          summary.countries != null ? t(summary.countries === 1 ? 'fleetmaster.reg.hero.countryOne' : 'fleetmaster.reg.hero.countries', { count: fmtInt(summary.countries) }) : t('fleetmaster.reg.hero.countriesNa'),
        ],
      }
    : undefined

  // While the summary is still loading the tile shows a neutral placeholder;
  // N/A is kept for a failed read or a value the summary genuinely lacks.
  const kpiVal = (v) => (summaryFailed ? t('fleetmaster.reg.na') : summaryPending ? '...' : v == null ? t('fleetmaster.reg.na') : fmtInt(v))

  return (
    <div className="cc fm-page">
      <PageHero
        title={t('fleetmaster.title')}
        lead={t('fleetmaster.reg.lead')}
        imgLight="/dashboard/hero-light.webp"
        imgDark="/dashboard/hero-dark.webp"
        stat={heroStat}
      />

      {/* KPI tiles */}
      <div className="cc-kpis">
        <Kpi icon={Truck} tone="t-green" display={kpiVal(summary?.total)} label={t('fleetmaster.summary.totalVehicles')}
          trend={summaryPending || summary?.growth?.total == null ? null : Math.round(summary.growth.total)} onClick={clearAll}
          title={t('fleetmaster.reg.kpi.totalHint')} />
        <Kpi icon={CheckCircle2} tone="t-green" display={kpiVal(summary?.active)} label={t('fleetmaster.reg.kpi.active')}
          trend={summaryPending || summary?.growth?.active == null ? null : Math.round(summary.growth.active)} onClick={() => applyStatus('Active')}
          title={t('fleetmaster.reg.kpi.activeHint')} />
        <Kpi icon={Wrench} tone="t-amber" display={kpiVal(summary?.maintenance)} label={t('fleetmaster.reg.kpi.maintenance')}
          onClick={() => applyFlag('maintenance')}
          title={t('fleetmaster.reg.kpi.maintenanceHint')} />
        <Kpi icon={AlertCircle} tone="t-red" danger display={kpiVal(summary?.missingSpecs)} label={t('fleetmaster.summary.missingSpecs')}
          onClick={() => applyFlag('missing_specs')}
          title={t('fleetmaster.reg.kpi.missingHint')} />
        <Kpi icon={FileText} tone="t-blue" display={kpiVal(summary?.noPolicy)} label={t('fleetmaster.summary.noPolicySet')}
          onClick={() => applyFlag('no_policy')}
          title={t('fleetmaster.reg.kpi.noPolicyHint')} />
        <Kpi icon={CircleSlash} tone="t-purple" display={kpiVal(summary?.inactive)} label={t('fleetmaster.reg.kpi.inactive')}
          onClick={() => applyFlag('inactive')}
          title={t('fleetmaster.reg.kpi.inactiveHint')} />
        <Kpi icon={Siren} tone="t-red"
          display={critHigh.state === 'loading' ? '...' : critHigh.state === 'ready' ? fmtInt(critHigh.count) : t('fleetmaster.reg.na')}
          label={t('fleetmaster.reg.kpi.critHigh')}
          onClick={() => applyPriority('1-3')}
          title={t('fleetmaster.reg.kpi.critHighHint')} />
        <Kpi icon={ScanLine} tone="t-green"
          display={verifyCounts.loading ? '...' : verifyCounts.counts ? `\u2066${fmtInt(verifyCounts.counts.verified)} / ${fmtInt(verifyCounts.counts.total)}\u2069` : t('fleetmaster.reg.na')}
          label={t('fleetVerification.progress.title')}
          title={verifyCounts.notSetUp ? t('fleetVerification.notSetUp') : verifyCounts.counts ? t('fleetVerification.progress.pending', { n: verifyCounts.counts.pending }) : undefined} />
      </div>

      {!summaryPending && (debouncedSearch || siteFilter || typeFilter) && (
        <p className="fm-note">
          {t(summary.total === 1 ? 'fleetmaster.reg.scopeOne' : 'fleetmaster.reg.scopeMany', { count: summary.total.toLocaleString() })}
        </p>
      )}
      {summaryCapped && (
        <p className="fm-note warn">
          {t('fleetmaster.reg.capped')}
        </p>
      )}

      {/* Filter bar */}
      <section className="cc-card fm-filterbar" aria-label={t('fleetmaster.reg.filtersAria')}>
        <div className="cc-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label={t('fleetmaster.reg.searchAria')}
            placeholder={t('fleetmaster.filters.searchPlaceholder')}
            value={search}
            onChange={e => setFilters({ search: e.target.value, page: '1' })}
          />
        </div>
        <SelectField icon={MapPin} label={t('fleetmaster.columns.site')} value={siteFilter} onChange={e => setFilters({ site: e.target.value, page: '1' })}>
          <option value="">{t('fleetmaster.filters.allSites')}</option>
          {sites.map(s => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        <SelectField icon={Activity} label={t('fleetmaster.columns.status')} value={statusFilter} onChange={e => setFilters({ status: e.target.value, page: '1' })}>
          <option value="">{t('fleetmaster.filters.allStatuses')}</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{t(`fleetmaster.reg.pill.${s}`)}</option>)}
        </SelectField>
        <SelectField icon={Layers} label={t('fleetmaster.reg.vehicleType')} value={typeFilter} onChange={e => setFilters({ type: e.target.value, page: '1' })}>
          <option value="">{t('fleetmaster.reg.allTypes')}</option>
          {typeFilter && !types.includes(typeFilter) && <option value={typeFilter}>{typeFilter}</option>}
          {types.map(s => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        <SelectField icon={Siren} label={t('fleetmaster.reg.maintPriority')} value={priorityFilter} onChange={e => applyPriority(e.target.value)}>
          <option value="">{t('fleetmaster.reg.allPriorities')}</option>
          {PRIORITY_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </SelectField>
        <Menu label={t('fleetmaster.reg.savedViews')} role="dialog" width={280} trigger={<><Bookmark size={15} aria-hidden="true" /> {t('fleetmaster.reg.savedViews')} <ChevronDown size={14} aria-hidden="true" /></>}>
          {(close) => (
            <div className="fm-views">
              {views.length === 0 && <p className="fm-pop-empty">{t('fleetmaster.reg.noViews')}</p>}
              {views.map(v => (
                <div key={v.name} className="fm-view-row">
                  <button type="button" className="fm-pop-item" onClick={() => applyView(v, close)}><Bookmark size={14} aria-hidden="true" /><span>{v.name}</span></button>
                  <button type="button" className="cc-icon-btn" aria-label={t('fleetmaster.reg.deleteView', { name: v.name })} onClick={() => deleteView(v.name)}><Trash2 size={13} /></button>
                </div>
              ))}
              <form className="fm-view-save" onSubmit={(e) => { e.preventDefault(); saveView(close) }}>
                <label className="fm-sr" htmlFor="fm-view-name">{t('fleetmaster.reg.viewName')}</label>
                <input id="fm-view-name" className="fm-input" placeholder={t('fleetmaster.reg.viewNamePlaceholder')} value={viewName} maxLength={40} onChange={e => setViewName(e.target.value)} />
                <button type="submit" className="cc-btn-primary" disabled={!viewName.trim()}>{t('fleetmaster.reg.save')}</button>
              </form>
            </div>
          )}
        </Menu>
        {(flagFilter || anyFilter) && (
          <div className="fm-chips">
            {priorityFilter && (
              <button type="button" className="fm-chip" onClick={() => applyPriority('')} aria-label={t('fleetmaster.reg.removePriority')}>
                {PRIORITY_FILTER_OPTIONS.find(o => o.value === priorityFilter)?.label} <X size={12} aria-hidden="true" />
              </button>
            )}
            {flagFilter && (
              <button type="button" className="fm-chip" onClick={() => setFilters({ flag: '', page: '1' })} aria-label={t('fleetmaster.reg.removeFilter', { name: t(`fleetmaster.reg.flags.${flagFilter}`) })}>
                {t(`fleetmaster.reg.flags.${flagFilter}`)} <X size={12} aria-hidden="true" />
              </button>
            )}
            {anyFilter && <button type="button" className="cc-link cc-link-btn" onClick={clearAll}>{t('fleetmaster.reg.clearAll')}</button>}
          </div>
        )}
      </section>

      {notice && (
        <div className="fm-banner" role="status">
          <span>{notice}</span>
          <button type="button" className="cc-icon-btn" aria-label={t('fleetmaster.reg.dismiss')} onClick={() => setNotice('')}><X size={14} /></button>
        </div>
      )}
      {loadError && (
        <div className="fm-banner bad" role="alert">
          <span><AlertTriangle size={15} aria-hidden="true" /> {loadError}</span>
          <button type="button" className="cc-btn" onClick={() => loadRecords()}>{t('fleetmaster.reg.tryAgain')}</button>
        </div>
      )}

      <div className="fm-main">
        {/* Registry */}
        <section className="cc-card fm-registry" aria-label={t('fleetmaster.reg.registryAria')}>
          <div className="cc-card-head fm-reg-head">
            <div>
              <h2 className="cc-card-title">{t('fleetmaster.reg.registryTitle', { count: fmtInt(total) })}</h2>
              <p className="cc-card-sub">{t('fleetmaster.reg.registrySub')}</p>
            </div>
            <div className="fm-reg-actions">
              <Menu label={t('fleetmaster.reg.columnsAria')} trigger={<><Columns size={15} aria-hidden="true" /> {t('fleetmaster.reg.columns')}</>}>
                {TABLE_COLUMNS.map(c => (
                  <button key={c.key} type="button" role="menuitemcheckbox" aria-checked={show(c.key)} className="fm-pop-item" onClick={() => toggleCol(c.key)}>
                    <span className={`fm-check ${show(c.key) ? 'on' : ''}`} aria-hidden="true" /><span>{t(`fleetmaster.reg.cols.${c.key}`)}</span>
                  </button>
                ))}
              </Menu>
              <button type="button" className="cc-btn-ghost" onClick={handleExport}><Download size={15} aria-hidden="true" /> {t('fleetmaster.reg.export')}</button>
              <button type="button" className="cc-btn-primary" onClick={openAdd} disabled={!canAdd} title={canAdd ? undefined : access.reason('create')}><Plus size={15} aria-hidden="true" /> {t('fleetmaster.actions.addVehicle')}</button>
            </div>
          </div>

          {/* Bulk bar */}
          <div className="cc-bulk" role="toolbar" aria-label={t('fleetmaster.reg.bulkActions')}>
            <span className="cc-bulk-count">{t('fleetmaster.reg.selected', { count: fmtInt(selectedIds.length) })}</span>
            <Menu label={t('fleetmaster.reg.bulkActions')} disabled={none} trigger={<><ListChecks size={15} aria-hidden="true" /> {t('fleetmaster.reg.bulkActions')} <ChevronDown size={14} aria-hidden="true" /></>}>
              {(close) => (
                <>
                  <MenuItem icon={Download} onClick={() => { exportRows(selectedRows, '_Selected'); close() }}>{t('fleetmaster.reg.exportSelected')}</MenuItem>
                  {isAdmin && <MenuItem icon={Trash2} danger onClick={() => { openBulkDelete(); close() }}>{t('fleetmaster.reg.deleteSelected')}</MenuItem>}
                  <MenuItem icon={X} onClick={() => { setSelected({}); close() }}>{t('fleetmaster.reg.clearSelection')}</MenuItem>
                </>
              )}
            </Menu>
            <button type="button" className="cc-btn-ghost" disabled={none || !canEdit} onClick={() => openBulk('policy')}
              title={canEdit ? t('fleetmaster.reg.assignPolicyHint') : access.reason('edit')}>
              <ShieldCheck size={15} aria-hidden="true" /> {t('fleetmaster.reg.assignPolicy')}
            </button>
            <button type="button" className="cc-btn-ghost" disabled={none || !isAdmin}
              onClick={() => navigate('/pm-programs', { state: { assetNos: selectedRows.map(r => r.asset_no) } })}
              title={isAdmin ? t('fleetmaster.reg.scheduleHint') : t('fleetmaster.reg.scheduleAdminOnly')}>
              <CalendarClock size={15} aria-hidden="true" /> {t('fleetmaster.reg.scheduleService')}
            </button>
            <button type="button" className="cc-btn-ghost" disabled={none || !canEdit} onClick={() => openBulk('status')}
              title={canEdit ? t('fleetmaster.reg.changeStatusHint') : access.reason('edit')}>
              <Activity size={15} aria-hidden="true" /> {t('fleetmaster.reg.changeStatus')}
            </button>
            <Menu label={t('fleetmaster.reg.moreActions')} disabled={none} triggerClass="cc-icon-btn" trigger={<MoreHorizontal size={16} aria-hidden="true" />}>
              {(close) => (
                <>
                  <MenuItem icon={Copy} onClick={() => { copyAssetNumbers(); close() }}>{t('fleetmaster.reg.copyAssets')}</MenuItem>
                  <MenuItem icon={Eye} disabled={selectedRows.length !== 1} title={selectedRows.length === 1 ? undefined : t('fleetmaster.reg.selectOne')}
                    onClick={() => { openVehicle(selectedRows[0]); close() }}>{t('fleetmaster.reg.openVehicle')}</MenuItem>
                  <MenuItem icon={ClipboardCheck} disabled={selectedRows.length !== 1} title={selectedRows.length === 1 ? undefined : t('fleetmaster.reg.selectOne')}
                    onClick={() => { navigate(`/inspections?asset=${encodeURIComponent(selectedRows[0].asset_no)}`); close() }}>{t('fleetmaster.table.startChecklist')}</MenuItem>
                </>
              )}
            </Menu>
          </div>

          <div ref={listRef}>
            <KitTable
              className="fm-table"
              manualPagination
              showPagination={false}
              enableSorting={false}
              pageIndex={page}
              pageSize={pageSize}
              pageCount={Math.max(1, Math.ceil(total / pageSize))}
              totalRows={total}
              onPageChange={setPage}
              loading={loading}
              skeletonRows={Math.min(pageSize, 8)}
              getRowId={(r) => String(r.id)}
              onRowClick={openVehicle}
              rows={shownRecords}
              empty={(
                <span>
                  {loadError ? t('fleetmaster.reg.loadFailed') : t('fleetmaster.table.noVehicles')}
                  {anyFilter && !loadError && <><br /><button type="button" className="cc-btn" onClick={(e) => { e.stopPropagation(); clearAll() }}>{t('fleetmaster.reg.clearFilters')}</button></>}
                </span>
              )}
              columns={fleetColumns}
            />
          </div>

          <Pager
            page={page}
            pageSize={pageSize}
            total={total}
            onPage={setPage}
            onPageSize={size => setFilters({ size: String(size), page: '1' })}
            sizes={PAGE_SIZE_OPTIONS}
            noun={t('fleetmaster.reg.noun')}
          />
        </section>

        {/* Right rail */}
        <aside className="fm-rail" aria-label={t('fleetmaster.reg.railAria')}>
          <Card title={t('fleetmaster.reg.overview')} action={<ViewAll to="/fleet-utilization" />}>
            {summaryPending
              ? <div className="cc-skel" style={{ height: 150 }} />
              : donut
                ? (
                  <>
                    <Donut
                      segments={donut}
                      total={summary.total}
                      centerLabel={t('fleetmaster.reg.vehicles')}
                      onSelect={(s) => {
                        if (s.key === 'active') applyStatus('Active')
                        else applyFlag(s.key)
                      }}
                    />
                    <button type="button" className="fm-extra" onClick={() => applyFlag('missing_specs')}>
                      <i aria-hidden="true" />
                      <span>{t('fleetmaster.reg.flags.missing_specs')}</span>
                      <b>{fmtInt(summary.missingSpecs)}</b>
                      <span className="cc-lt-pct">{fmtPct(pct(summary.missingSpecs))}</span>
                    </button>
                    <p className="fm-foot">{t('fleetmaster.reg.donutFoot')}</p>
                  </>
                )
                : <div className="cc-empty">{t('fleetmaster.reg.overviewFailed')}</div>}
          </Card>

          <Card title={t('fleetmaster.reg.insights.title')}>
            <div className="fm-insights">
              <Insight icon={AlertTriangle} tone="t-red" onClick={() => applyFlag('missing_specs')}
                num={summaryPending ? null : fmtInt(summary.missingSpecs)}
                text={t(summary?.missingSpecs === 1 ? 'fleetmaster.reg.insights.missingOne' : 'fleetmaster.reg.insights.missingMany')}
                fallback={t('fleetmaster.reg.insights.missingNa')}
                sub={t('fleetmaster.reg.insights.missingSub')} />
              <Insight icon={Wrench} tone="t-amber" onClick={() => applyFlag('maintenance')}
                num={summaryPending || summary.maintenance == null ? null : fmtInt(summary.maintenance)}
                text={t('fleetmaster.reg.insights.maint')}
                fallback={t('fleetmaster.reg.insights.maintNa')}
                sub={t('fleetmaster.reg.insights.maintSub')} />
              <Insight icon={FileText} tone="t-blue" onClick={() => applyFlag('no_policy')}
                num={summaryPending ? null : fmtInt(summary.noPolicy)}
                text={t(summary?.noPolicy === 1 ? 'fleetmaster.reg.insights.noPolicyOne' : 'fleetmaster.reg.insights.noPolicyMany')}
                fallback={t('fleetmaster.reg.insights.noPolicyNa')}
                sub={!summaryPending && summary.noPolicy === 0 ? t('fleetmaster.reg.insights.allPolicy') : t('fleetmaster.reg.insights.noPolicySub')} />
              <Insight icon={CalendarClock} tone="t-green" to={isAdmin ? '/pm-programs' : '/maintenance-calendar'}
                num={pmDue.state === 'ready' && pmDue.data?.dueSoon != null ? fmtInt(pmDue.data.dueSoon) : null}
                text={t(pmDue.data?.dueSoon === 1 ? 'fleetmaster.reg.insights.serviceOne' : 'fleetmaster.reg.insights.serviceMany')}
                fallback={t('fleetmaster.reg.insights.serviceNa')}
                sub={pmDue.state === 'ready' && pmDue.data?.overdue != null
                  ? t('fleetmaster.reg.insights.overdue', { count: fmtInt(pmDue.data.overdue) })
                  : pmDue.state === 'loading' ? t('fleetmaster.reg.insights.checkingPlans') : t('fleetmaster.reg.insights.plansError')} />
              <Insight icon={Gauge} tone="t-purple" to="/fleet-utilization"
                num={util.state === 'ready' && util.data?.avg != null ? fmtPct(util.data.avg) : null}
                text={tx('fleetmaster.insights.utilFleetWide', 'average utilisation, fleet-wide')}
                fallback={t('fleetmaster.reg.insights.utilNa')}
                sub={util.state === 'ready' && util.data?.avg != null
                  ? tx('fleetmaster.insights.utilFleetWideSub', 'All {count} vehicles with telematics. Search, site and type filters do not apply', { count: fmtInt(util.data.assets) })
                  : util.state === 'loading' ? t('fleetmaster.reg.insights.checkingTelematics') : t('fleetmaster.reg.insights.noTelematics')} />
            </div>
          </Card>

          <Card title={t('fleetmaster.reg.matrix.title')}>
            <details className="fm-prio-help">
              <summary><Info size={14} aria-hidden="true" /> {t('fleetmaster.reg.matrix.how')}</summary>
              <p className="fm-foot">{t('fleetmaster.reg.matrix.howText')}</p>
              <ol className="fm-prio-list">
                {PRIORITY_MATRIX.map(m => (
                  <li key={m.priority}>
                    <button type="button" className="cc-link-btn" onClick={() => applyPriority(String(m.priority))} aria-label={t('fleetmaster.reg.matrix.show', { priority: m.priority })}>
                      <span className={`cc-pill ${PRIORITY_TONE[m.priority]}`}>P{m.priority} {m.criticality}</span>
                    </button>
                    <b>{m.category}</b>
                    <small>{m.impact} {m.response} {t('fleetmaster.reg.matrix.pmFrequency', { value: m.pmFrequency })}</small>
                  </li>
                ))}
              </ol>
              <p className="fm-prio-crit-title">{t('fleetmaster.reg.matrix.criticality')}</p>
              <ul className="fm-prio-list">
                {CRITICALITY_CRITERIA.map(c => (
                  <li key={c.criticality}><b>{c.criticality}</b><small>{c.meaning} {c.action}</small></li>
                ))}
              </ul>
            </details>
          </Card>

          <Card title={t('fleetmaster.reg.quick.title')}>
            <div className="cc-quick">
              <button type="button" onClick={openAdd} disabled={!canAdd} title={canAdd ? undefined : access.reason('create')}><Plus size={20} aria-hidden="true" />{t('fleetmaster.actions.addVehicle')}</button>
              <Link to="/data-intake"><Upload size={20} aria-hidden="true" />{t('fleetmaster.reg.quick.import')}</Link>
              <button type="button" onClick={handleExport}><FileText size={20} aria-hidden="true" />{t('fleetmaster.reg.quick.export')}</button>
              <Link to="/reports"><BarChart3 size={20} aria-hidden="true" />{t('fleetmaster.reg.quick.reports')}</Link>
            </div>
          </Card>
        </aside>
      </div>

      {/* ── On-site verification: review queue + possible transfers ───── */}
      <div className="space-y-4 mt-4">
        <PendingVerificationsPanel country={activeCountry} onChanged={() => { loadRecords(); setVerifyTick((n) => n + 1) }} />
        {mayVerify && <PossibleTransfersPanel country="KSA" />}
      </div>
      <VerifyOnSiteModal
        open={verifyRow !== null}
        vehicle={verifyRow}
        onClose={() => setVerifyRow(null)}
        onDone={() => { loadRecords(); setVerifyTick((n) => n + 1) }}
      />

      {/* ── Add / Edit Modal ──────────────────────────────────────────────── */}
      {editRecord !== null && (
        <Modal title={editRecord.id ? t('fleetmaster.form.editTitle') : t('fleetmaster.form.addTitle')} onClose={() => setEditRecord(null)} busy={saving} wide>
          {formError && (
            <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{formError}</div>
          )}
          <form onSubmit={saveRecord} className="space-y-5">

            {/* Section 1: Vehicle Identity */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">{t('fleetmaster.form.sectionIdentity')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="fm-f-assetNo">{t('fleetmaster.form.assetNo')} <span className="text-red-400">*</span></label>
                  <input id="fm-f-assetNo" className="input" value={form.asset_no} onChange={F('asset_no')} required placeholder={t('fleetmaster.form.placeholders.assetNo')} />
                </div>
                <div>
                  <label className="label" htmlFor="fm-f-fleetNumber">{t('fleetmaster.form.fleetNumber')}</label>
                  <input id="fm-f-fleetNumber" className="input" value={form.fleet_number} onChange={F('fleet_number')} placeholder={t('fleetmaster.form.placeholders.fleetNumber')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="label" htmlFor="fm-f-make">{t('fleetmaster.form.make')}</label>
                  <input id="fm-f-make" className="input" value={form.make} onChange={F('make')} placeholder={t('fleetmaster.form.placeholders.make')} />
                </div>
                <div>
                  <label className="label" htmlFor="fm-f-model">{t('fleetmaster.form.model')}</label>
                  <input id="fm-f-model" className="input" value={form.model} onChange={F('model')} placeholder={t('fleetmaster.form.placeholders.model')} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="label" htmlFor="fm-f-vehicleType">{t('fleetmaster.form.vehicleType')}</label>
                  <input id="fm-f-vehicleType" className="input" value={form.vehicle_type} onChange={F('vehicle_type')} placeholder={t('fleetmaster.form.placeholders.vehicleType')} />
                </div>
                <div>
                  <label className="label" htmlFor="fm-f-year">{t('fleetmaster.form.year')}</label>
                  <input id="fm-f-year" type="number" className="input" value={form.year} onChange={F('year')} placeholder={t('fleetmaster.form.placeholders.year')} min={1990} max={2100} />
                </div>
                <div>
                  <label className="label" htmlFor="fm-f-status">{t('fleetmaster.form.status')}</label>
                  <select id="fm-f-status" className="input" value={form.status} onChange={F('status')}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{t(`fleetmaster.reg.pill.${s}`)}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Section 2: Assignment */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">{t('fleetmaster.form.sectionAssignment')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="fm-f-department">{t('fleetmaster.form.department')}</label>
                  <input id="fm-f-department" className="input" value={form.department} onChange={F('department')} placeholder={t('fleetmaster.form.placeholders.department')} />
                </div>
                <div>
                  <label className="label" htmlFor="fm-f-operatorName">{t('fleetmaster.form.operatorName')}</label>
                  <input id="fm-f-operatorName" className="input" value={form.operator_name} onChange={F('operator_name')} placeholder={t('fleetmaster.form.placeholders.operatorName')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="label" htmlFor="fm-f-site">{t('fleetmaster.form.site')}</label>
                  <input id="fm-f-site" className="input" list="fleet-site-list" value={form.site} onChange={F('site')} placeholder={t('fleetmaster.form.placeholders.site')} />
                  <datalist id="fleet-site-list">{sites.map(s => <option key={s} value={s} />)}</datalist>
                </div>
                <div>
                  <label className="label" htmlFor="fm-f-country">{t('fleetmaster.form.country')} <span className="text-red-400">*</span></label>
                  <select id="fm-f-country" className="input" value={form.country} onChange={F('country')}>
                    <option value="">{COUNTRY_PLACEHOLDER}</option>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {countryUnset && (
                    <p className="mt-1 text-xs text-amber-300">{COUNTRY_REQUIRED_HINT}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Section 3: Tyre Policy */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">{t('fleetmaster.form.sectionPolicy')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label" htmlFor="fm-f-expectedKmPerTyre">{t('fleetmaster.form.expectedKmPerTyre')}</label>
                  <input id="fm-f-expectedKmPerTyre" type="number" className="input" value={form.expected_km_per_tyre} onChange={F('expected_km_per_tyre')} placeholder={t('fleetmaster.form.placeholders.expectedKm')} min={0} />
                </div>
                <div>
                  <label className="label" htmlFor="fm-f-minDaysBetweenChanges">{t('fleetmaster.form.minDaysBetweenChanges')}</label>
                  <input id="fm-f-minDaysBetweenChanges" type="number" className="input" value={form.min_days_between_changes} onChange={F('min_days_between_changes')} placeholder={t('fleetmaster.form.placeholders.minDays')} min={0} />
                </div>
                <div>
                  <label className="label" htmlFor="fm-f-maxTyresPerDay">{t('fleetmaster.form.maxTyresPerDay')}</label>
                  <input id="fm-f-maxTyresPerDay" type="number" className="input" value={form.max_tyres_per_day} onChange={F('max_tyres_per_day')} placeholder={t('fleetmaster.form.placeholders.maxTyres')} min={1} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="label" htmlFor="fm-f-tyreSize">{t('fleetmaster.form.tyreSize')}</label>
                  <input id="fm-f-tyreSize" className="input" value={form.tyre_size} onChange={F('tyre_size')} placeholder={t('fleetmaster.form.placeholders.tyreSize')} />
                </div>
                <div>
                  <label className="label" htmlFor="fm-f-preferredBrand">{t('fleetmaster.form.preferredBrand')}</label>
                  <input id="fm-f-preferredBrand" className="input" value={form.tyre_brand_preferred} onChange={F('tyre_brand_preferred')} placeholder={t('fleetmaster.form.placeholders.brand')} />
                </div>
                <div>
                  <label className="label" htmlFor="fm-f-monthlyBudget">{t('fleetmaster.form.monthlyBudget', { currency: activeCurrency })}</label>
                  <input id="fm-f-monthlyBudget" type="number" className="input" value={form.monthly_tyre_budget} onChange={F('monthly_tyre_budget')} placeholder={t('fleetmaster.form.placeholders.budget')} min={0} />
                </div>
              </div>
              <div className="mt-3">
                <label className="label" htmlFor="fm-f-notes">{t('fleetmaster.form.notes')}</label>
                <textarea id="fm-f-notes" className="input" rows={2} value={form.notes} onChange={F('notes')} placeholder={t('fleetmaster.form.placeholders.notes')} />
              </div>
            </div>

            {editRecord.id && (
              <CustomFieldsPanel data={editRecord.custom_data} title={t('fleetmaster.form.customFieldsTitle')} />
            )}

            {atLimit && !editRecord.id && (
              <div className="bg-amber-900/30 border border-amber-700 text-amber-300 rounded-lg px-4 py-2 text-sm">
                {t('fleetmaster.form.planLimit')}
              </div>
            )}
            {missingLine && (
              <p className="text-xs text-amber-300" role="status" aria-live="polite" id="fm-f-missing">{missingLine}</p>
            )}
            <div className="flex gap-3 pt-2">
              <button type="submit" aria-describedby={missingLine ? 'fm-f-missing' : undefined} disabled={saving || missingRequired.length > 0 || (atLimit && !editRecord.id)} className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                <Save size={15} /> {saving ? t('fleetmaster.form.saving') : t('fleetmaster.form.save')}
              </button>
              <button type="button" onClick={() => setEditRecord(null)} className="btn-secondary">{t('fleetmaster.form.cancel')}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Bulk status / policy ─────────────────────────────────────────── */}
      {bulkDialog && (
        <Modal title={bulkDialog === 'status' ? t('fleetmaster.reg.bulk.statusTitle') : t('fleetmaster.reg.bulk.policyTitle')} onClose={() => { setBulkDialog(null); setBulkError('') }} busy={bulkBusy}>
          <form onSubmit={(e) => { e.preventDefault(); applyBulk() }} className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t(selectedIds.length === 1 ? 'fleetmaster.reg.bulk.appliesOne' : 'fleetmaster.reg.bulk.appliesMany', { count: fmtInt(selectedIds.length) })}
            </p>
            {bulkDialog === 'status' ? (
              <div>
                <label className="label" htmlFor="fm-bulk-status">{t('fleetmaster.reg.bulk.newStatus')}</label>
                <select id="fm-bulk-status" className="input" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{t(`fleetmaster.reg.pill.${s}`)}</option>)}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  ['expected_km_per_tyre', t('fleetmaster.form.expectedKmPerTyre')],
                  ['min_days_between_changes', t('fleetmaster.form.minDaysBetweenChanges')],
                  ['max_tyres_per_day', t('fleetmaster.form.maxTyresPerDay')],
                ].map(([k, label]) => (
                  <div key={k}>
                    <label className="label" htmlFor={`fm-bulk-${k}`}>{label}</label>
                    <input id={`fm-bulk-${k}`} type="number" min={0} className="input" value={bulkPolicy[k]}
                      onChange={e => setBulkPolicy(p => ({ ...p, [k]: e.target.value }))} placeholder={t('fleetmaster.reg.bulk.leaveBlank')} />
                  </div>
                ))}
              </div>
            )}
            {bulkError && <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5">{bulkError}</p>}
            <div className="flex gap-3">
              <button type="submit" disabled={bulkBusy} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                <Save size={15} /> {bulkBusy ? t('fleetmaster.reg.bulk.saving') : t('fleetmaster.reg.bulk.apply')}
              </button>
              <button type="button" onClick={() => { setBulkDialog(null); setBulkError('') }} disabled={bulkBusy} className="btn-secondary">{t('fleetmaster.reg.cancel')}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Delete Confirmation ───────────────────────────────────────────── */}
      {showDeleteConfirm && deleteTarget && (() => {
        const hist = deleteHistory.summary
        const checking = deleteHistory.state !== 'ready'
        const hasHistory = hist?.state === 'history'
        const unknown = hist?.state === 'unknown'
        const canHardDelete = !checking && hist?.state === 'none'
        const alreadyInactive = String(deleteTarget.status || '') === 'Inactive'
        return (
          <Modal title={t('fleetmaster.delete.title')} onClose={closeDelete} busy={saving}>
            <div className="flex gap-3 mb-4">
              <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[var(--text-primary)] font-medium">{t('fleetmaster.delete.question', { assetNo: deleteTarget.asset_no })}</p>
                {checking && <p className="text-gray-400 text-sm mt-1" role="status">{tx('fleetmaster.delete.checking', "Checking this vehicle's history...")}</p>}
                {hasHistory && (
                  <p className="text-amber-300 text-sm mt-1" role="status">
                    {tx('fleetmaster.delete.hasHistory', '{assetNo} has history: {history}. Deleting it would leave those records pointing to a vehicle that no longer exists. Mark it Inactive instead: it leaves the active fleet and its history is kept.', { assetNo: deleteTarget.asset_no, history: historyText(hist.counts) })}
                  </p>
                )}
                {unknown && (
                  <p className="text-amber-300 text-sm mt-1" role="status">
                    {tx('fleetmaster.delete.unknownHistory', "The vehicle's history could not be checked, so it cannot be deleted permanently right now. Mark it Inactive instead, or try again later.")}
                  </p>
                )}
                {canHardDelete && <p className="text-gray-400 text-sm mt-1">{tx('fleetmaster.delete.noHistory', 'No inspections, tyre records, work orders or accidents are linked to this vehicle.')} {t('fleetmaster.delete.warning')}</p>}
              </div>
            </div>
            {deleteError && (
              <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{deleteError}</p>
            )}
            <div className="flex flex-wrap gap-3">
              {(hasHistory || unknown) && (
                <button onClick={markInactive} disabled={saving || !canEdit || alreadyInactive}
                  title={!canEdit ? access.reason('edit') : alreadyInactive ? tx('fleetmaster.delete.alreadyInactiveTitle', 'This vehicle is already Inactive') : undefined}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <CircleSlash size={15} /> {saving ? tx('fleetmaster.delete.saving', 'Saving...') : alreadyInactive ? tx('fleetmaster.delete.alreadyInactive', 'Already Inactive') : tx('fleetmaster.delete.markInactive', 'Mark Inactive (recommended)')}
                </button>
              )}
              {canHardDelete && (
                <button onClick={deleteRecord} disabled={saving} className="btn-danger flex items-center gap-2 disabled:opacity-50">
                  <Trash2 size={15} /> {saving ? t('fleetmaster.delete.deleting') : t('fleetmaster.delete.confirm')}
                </button>
              )}
              <button onClick={closeDelete} disabled={saving} className="btn-secondary disabled:opacity-50">{t('fleetmaster.delete.cancel')}</button>
            </div>
          </Modal>
        )
      })()}

      {/* ── Bulk Delete Confirmation (Admin only) ─────────────────────────── */}
      {bulkDeleteOpen && (() => {
        const checking = bulkHistory.state !== 'ready'
        const g = bulkHistory.groups || { clean: [], history: [], unknown: [] }
        const keepCount = g.history.length + g.unknown.length
        return (
          <Modal title={t('fleetmaster.bulkDelete.title')} onClose={() => { if (!bulkBusy) closeBulkDelete() }} busy={bulkBusy}>
            <div className="flex gap-3 mb-4">
              <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[var(--text-primary)] font-medium">{t('fleetmaster.bulkDelete.question', { count: selectedIds.length })}</p>
                {checking ? (
                  <p className="text-gray-400 text-sm" role="status">{tx('fleetmaster.bulkDelete.checking', 'Checking the history of {count} selected vehicle(s)...', { count: fmtInt(selectedIds.length) })}</p>
                ) : (
                  <div role="status" className="text-sm space-y-1">
                    {g.clean.length > 0 && <p className="text-gray-400">{tx('fleetmaster.bulkDelete.groupClean', '{count} have no linked records and can be deleted permanently.', { count: fmtInt(g.clean.length) })} {t('fleetmaster.bulkDelete.warning')}</p>}
                    {g.history.length > 0 && <p className="text-amber-300">{tx('fleetmaster.bulkDelete.groupHistory', '{count} have inspections, tyre records, work orders or accidents. They cannot be deleted; mark them Inactive to keep their history.', { count: fmtInt(g.history.length) })}</p>}
                    {g.unknown.length > 0 && <p className="text-amber-300">{tx('fleetmaster.bulkDelete.groupUnknown', '{count} could not be checked, so they cannot be deleted permanently right now. Mark them Inactive or try again later.', { count: fmtInt(g.unknown.length) })}</p>}
                  </div>
                )}
              </div>
            </div>
            {bulkError && (
              <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{bulkError}</p>
            )}
            <div className="flex flex-wrap gap-3">
              {!checking && keepCount > 0 && (
                <button onClick={bulkMarkInactive} disabled={bulkBusy || !canEdit}
                  title={!canEdit ? access.reason('edit') : undefined}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <CircleSlash size={15} /> {bulkBusy ? tx('fleetmaster.bulkDelete.saving', 'Saving...') : tx('fleetmaster.bulkDelete.markInactive', 'Mark {count} Inactive', { count: fmtInt(keepCount) })}
                </button>
              )}
              {!checking && g.clean.length > 0 && (
                <button onClick={confirmBulkDelete} disabled={bulkBusy} className="btn-danger flex items-center gap-2 disabled:opacity-50">
                  <Trash2 size={15} /> {bulkBusy ? t('fleetmaster.bulkDelete.deleting') : tx('fleetmaster.bulkDelete.deleteClean', 'Delete {count} with no history', { count: fmtInt(g.clean.length) })}
                </button>
              )}
              <button onClick={closeBulkDelete} disabled={bulkBusy} className="btn-secondary">{t('fleetmaster.bulkDelete.cancel')}</button>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}

// ── Shared modal shell ─────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide = false, busy = false }) {
  // Adapter over the shared dialog shell; while a save or delete runs the
  // dialog cannot be dismissed.
  return (
    <DialogModal open title={title} onClose={busy ? undefined : onClose} size={wide ? 'lg' : 'md'}>
      {children}
    </DialogModal>
  )
}
