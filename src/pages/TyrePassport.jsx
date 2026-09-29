/**
 * TyrePassport (routes /tyre-passport and /tyre-passport/:serial). A per-tyre
 * whole-life "passport": look up a serial and see that physical tyre's complete
 * lifecycle assembled from tyre_records plus service events, warranty claims,
 * status marks, retread claims and the inspections recorded against it.
 *
 * All passport maths lives in src/lib/tyrePassport.js; the card and table
 * shapers live in src/lib/tyrePassportView.js. Every figure degrades honestly:
 * a signal with no source reads "N/A" (with a tooltip saying why), an estimate
 * is labelled "(Est.)", and money is never shown in a blended currency.
 * Exports a passport PDF and an Excel journey workbook.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ScanLine, Search, Truck, Gauge, Calendar, AlertTriangle, ArrowLeft, CircleDot, Loader2, Package,
  HeartPulse, Ruler, Coins, BarChart3, ShieldCheck, ClipboardCheck, CheckCircle2, FileDown,
  Sheet, RefreshCw, Milestone, ChevronRight, ChevronDown, MapPin, FileText, History, ExternalLink,
} from 'lucide-react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip as ChartTooltip, Legend, Filler,
} from 'chart.js'
import QRCode from 'qrcode'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { Tabs, VehicleThumb, ViewAll, KitTable } from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { formatCurrency, formatDate } from '../lib/formatters'
import { getPassportBundle, searchSerials } from '../lib/api/tyrePassport'
import { listTyreInspections } from '../lib/api/tyrePassportInspections'
import { getAssetByNo } from '../lib/api/assets'
import { listCatalogueForBrand } from '../lib/api/serialTracker'
import { matchCatalogue } from '../lib/tyreImage'
import TyreTreadImage from '../components/tyre/TyreTreadImage'
import { buildPassport, journeyWithDays, journeySummary } from '../lib/tyrePassport'
import {
  passportCurrency, ageMonths, healthLabel, healthCoverage, treadInfo, kmInfo, cpkSeries,
  inspectionRowsForTyre, latestPressure, movementRows, lifecycleSteps, warrantySummary,
  timelineEvents, statusTone, statusText,
} from '../lib/tyrePassportView'
import { colorAt, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import './tyrePassport.css'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, ChartTooltip, Legend, Filler)

const NA = 'N/A'
const kmTxt = (v) => (v == null ? NA : `${Number(v).toLocaleString('en-US')} km`)
const dateTxt = (v) => (v ? formatDate(v) : NA)
const assetHref = (a) => `/asset-management/${encodeURIComponent(a)}`
const assetLink = (a) => (a
  ? <Link to={assetHref(a)} className="tp-link tp-mono" onClick={(e) => e.stopPropagation()}>{a}</Link>
  : <span className="cc-na">{NA}</span>)
/** Load index (single/dual) and speed symbol from a catalogue entry. */
const specLoad = (c) => {
  if (!c) return NA
  const load = [c.load_index_single, c.load_index_dual].filter((v) => v != null && v !== '').join('/')
  return [load, c.speed_rating].filter(Boolean).join(' ') || 'Not recorded'
}

const EVENT_TONE = (t) => {
  const v = String(t || '').toLowerCase()
  if (v === 'repair' || v === 'replacement') return 'bad'
  if (v === 'rotation') return 'info'
  if (v === 'retread') return 'orange'
  if (v === 'inflation' || v === 'fitment') return 'good'
  return 'muted'
}
const ACTION_TONE = { Fitted: 'good', Moved: 'info', Rotated: 'info', Refitted: 'info', Removed: 'muted' }
const CONDITION_TONE = (c) => {
  const v = String(c || '').toLowerCase()
  if (!v) return 'muted'
  if (/good|ok/.test(v)) return 'good'
  if (/wear|worn|monitor/.test(v)) return 'warn'
  return 'bad'
}
const SEV_TONE = { high: 'bad', medium: 'warn', low: 'info' }
const RING = { low: 'var(--cc-green)', medium: 'var(--cc-amber)', high: 'var(--cc-orange)', critical: 'var(--cc-red)', unknown: 'var(--cc-ink-3)' }

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'timeline', label: 'Lifecycle Timeline' },
  { key: 'inspections', label: 'Inspection History' },
  { key: 'service', label: 'Service & Repair History' },
  { key: 'movement', label: 'Fitment & Movement History' },
  { key: 'warranty', label: 'Warranty' },
  { key: 'documents', label: 'Documents' },
  { key: 'quality', label: 'Data quality' },
]

function SerialQr({ serial }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let live = true
    if (!serial) { setSrc(null); return undefined }
    QRCode.toDataURL(serial, { width: 160, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((u) => { if (live) setSrc(u) })
      .catch(() => { if (live) setSrc(null) })
    return () => { live = false }
  }, [serial])
  if (!src) return null
  return <img className="tp-qr" src={src} alt={`QR code for serial ${serial}`} title="Scan to read the serial" />
}

function HealthRing({ score, risk, size = 64 }) {
  const r = 26
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score ?? 0))
  const dash = (pct / 100) * c
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className="tp-ring" aria-hidden="true">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--cc-track)" strokeWidth="7" />
      {score != null && <circle cx="32" cy="32" r={r} fill="none" stroke={RING[risk] || RING.unknown} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${dash} ${c - dash}`} transform="rotate(-90 32 32)" />}
      <HeartPulse x="22" y="22" width="20" height="20" color={RING[risk] || RING.unknown} />
    </svg>
  )
}

function Spark({ values }) {
  if (!values || values.length < 2) return null
  const w = 90; const h = 30
  const min = Math.min(...values); const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="tp-spark" role="img" aria-label="Cost per km by fitment stint">
      <polyline points={pts} fill="none" stroke="var(--cc-green)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function Bar({ pct, tone = 'var(--cc-green)' }) {
  if (pct == null) return null
  const v = Math.max(0, Math.min(100, pct))
  return <span className="tp-bar" aria-hidden="true"><span style={{ width: `${v}%`, background: tone }} /></span>
}

function Metric({ icon: Icon, tone, label, value, unit, foot, children, title, onClick }) {
  const body = (
    <>
      <span className={`tp-metric-icon ${tone}`}><Icon size={22} aria-hidden="true" /></span>
      <div className="tp-metric-body">
        <div className="tp-metric-label">{label}</div>
        <div className="tp-metric-val">{value}{value !== NA && unit && <small> {unit}</small>}</div>
        {children}
        {foot && <div className="tp-metric-foot">{foot}</div>}
      </div>
      {onClick && <ChevronRight size={16} className="tp-metric-chev" aria-hidden="true" />}
    </>
  )
  if (onClick) return <button type="button" className="cc-card tp-metric" title={title} onClick={onClick}>{body}</button>
  return <div className="cc-card tp-metric" title={title}>{body}</div>
}

function SearchBox({ country, onPick, autoFocus }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (q.trim().length < 2) { setResults([]); return undefined }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try { setResults(await searchSerials(q, { country })); setOpen(true) }
      catch { setResults([]); setOpen(false) }
      finally { setLoading(false) }
    }, 250)
    return () => timer.current && clearTimeout(timer.current)
  }, [q, country])

  return (
    <div className="tp-searchbox">
      <div className="cc-search">
        <Search size={16} aria-hidden="true" className="tp-search-icon" />
        <input
          aria-label="Search a tyre serial number"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="tyre-passport-serial-results"
          aria-autocomplete="list"
          autoFocus={autoFocus}
          className="tp-search-input"
          placeholder="Search a tyre serial number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q.trim()) onPick(q.trim())
            if (e.key === 'Escape') setOpen(false)
          }}
        />
        {loading && <Loader2 size={14} className="tp-search-spin" aria-label="Searching" />}
      </div>
      {open && q.trim().length >= 2 && !loading && results.length === 0 && (
        <p role="status" className="tp-muted tp-small">No serial starts with that text. Press Enter to open it anyway.</p>
      )}
      {open && results.length > 0 && (
        <div id="tyre-passport-serial-results" role="listbox" aria-label="Matching serials" className="tp-results">
          {results.map((r) => (
            <button key={r.serial} type="button" role="option" aria-selected="false" onClick={() => { setOpen(false); onPick(r.serial) }}>
              <CircleDot size={14} aria-hidden="true" />
              <span className="tp-mono">{r.serial}</span>
              <span className="tp-muted">{[r.brand, r.size, r.asset_no].filter(Boolean).join(' / ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Empty({ icon: Icon, title, sub }) {
  return (
    <div className="cc-empty tp-empty">
      <div>
        <Icon size={24} aria-hidden="true" />
        <p>{title}</p>
        {sub && <p className="tp-small">{sub}</p>}
      </div>
    </div>
  )
}

function MoreMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="tp-menu-wrap" ref={ref}>
      <button type="button" className="cc-btn-ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        More actions <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="tp-menu">
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick() }}>
              <it.icon size={14} aria-hidden="true" /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TyrePassport() {
  const { serial } = useParams()
  const navigate = useNavigate()
  const { activeCountry, activeCurrency } = useSettings()
  const { profile, isSuperAdmin } = useAuth() || {}
  const [bundle, setBundle] = useState(null)
  const loadId = useRef(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('overview')
  const [insp, setInsp] = useState({ rows: [], truncated: false, error: null, loading: false })
  const [asset, setAsset] = useState(null)
  const [catalogue, setCatalogue] = useState({ rows: [], error: null, loading: false })

  const load = useCallback(async (sn) => {
    const request = ++loadId.current
    setBundle(null)
    if (!sn) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const result = await getPassportBundle(sn, { country: activeCountry })
      if (request === loadId.current) setBundle(result)
    } catch (err) {
      if (request === loadId.current) { setError(toUserMessage(err, 'Could not load this tyre.')); setBundle(null) }
    } finally { if (request === loadId.current) setLoading(false) }
  }, [activeCountry])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the current request on cleanup.
  useEffect(() => { load(serial); return () => { loadId.current++ } }, [serial, load])
  useEffect(() => { setTab('overview') }, [serial])

  const passport = useMemo(() => {
    if (!bundle) return null
    return buildPassport(bundle.records || [], {
      serviceEvents: bundle.serviceEvents,
      warrantyClaims: bundle.warrantyClaims,
      statusMarks: bundle.statusMarks,
      retreadClaims: bundle.retreadClaims,
    })
  }, [bundle])

  // Inspections and the current vehicle load after the passport, each on its
  // own, so a failed side read never blanks the passport itself.
  const assetsKey = passport ? passport.assets.join('|') : ''
  useEffect(() => {
    if (!passport) { setInsp({ rows: [], truncated: false, error: null, loading: false }); return undefined }
    let live = true
    setInsp((s) => ({ ...s, loading: true, error: null }))
    listTyreInspections(passport.serial, passport.assets, { country: activeCountry })
      .then((r) => { if (live) setInsp({ rows: r.rows, truncated: r.truncated, error: null, loading: false }) })
      .catch((e) => { if (live) setInsp({ rows: [], truncated: false, error: toUserMessage(e, 'Inspections could not be loaded.'), loading: false }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passport?.serial, assetsKey, activeCountry])

  const currentAssetNo = passport?.currentAssetNo || null
  useEffect(() => {
    if (!currentAssetNo) { setAsset(null); return undefined }
    let live = true
    getAssetByNo(currentAssetNo, activeCountry === 'All' ? undefined : activeCountry)
      .then((row) => { if (live) setAsset(row || null) })
      .catch(() => { if (live) setAsset(null) })
    return () => { live = false }
  }, [currentAssetNo, activeCountry])

  // The tyre catalogue entry for this brand and size feeds the tread picture
  // and the pattern / load / speed block. A failed read is shown as "could not
  // check", never as "not in the catalogue".
  const passportBrand = passport?.brand || ''
  const catalogueKey = `${passportBrand}|${activeCountry}`
  const [catalogueNonce, setCatalogueNonce] = useState(0)
  useEffect(() => {
    if (!passportBrand) { setCatalogue({ rows: [], error: null, loading: false }); return undefined }
    let live = true
    setCatalogue({ rows: [], error: null, loading: true })
    listCatalogueForBrand(passportBrand, { country: activeCountry })
      .then((rows) => { if (live) setCatalogue({ rows, error: null, loading: false }) })
      .catch((e) => { if (live) setCatalogue({ rows: [], error: toUserMessage(e, 'The tyre catalogue could not be checked.'), loading: false }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogueKey covers brand + country.
  }, [catalogueKey, catalogueNonce])
  const catEntry = useMemo(
    () => matchCatalogue(catalogue.rows, { brand: passport?.brand, size: passport?.size }),
    [catalogue.rows, passport],
  )

  const journeyRows = useMemo(() => journeyWithDays(passport?.journey || []), [passport])
  const journeyStats = useMemo(() => journeySummary(passport?.journey || []), [passport])
  const inspectionRows = useMemo(
    () => inspectionRowsForTyre({ inspections: insp.rows, journey: passport?.journey || [], serial: passport?.serial }),
    [insp.rows, passport],
  )
  const movement = useMemo(() => movementRows(passport?.events || []), [passport])
  const steps = useMemo(() => lifecycleSteps(passport), [passport])
  const timeline = useMemo(() => timelineEvents(passport, inspectionRows), [passport, inspectionRows])
  const cur = useMemo(() => passportCurrency(bundle?.records || [], activeCurrency), [bundle, activeCurrency])

  const moneyFull = useCallback(
    (v) => (v == null || cur.mixed ? NA : formatCurrency(v, cur.currency || '')),
    [cur],
  )

  const wearChart = useMemo(() => {
    const series = passport?.treadSeries?.length ? passport.treadSeries : []
    if (!series.length) return null
    const line = colorAt(0)
    return {
      data: {
        labels: series.map((p) => formatDate(p.date)),
        datasets: [{
          label: 'Tread depth (mm)',
          data: series.map((p) => p.tread),
          borderColor: line,
          backgroundColor: withAlpha(line, 0.14),
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          pointBackgroundColor: series.map((p) => (p.source === 'service' ? colorAt(2) : line)),
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)' }, title: { display: true, text: 'mm', color: 'var(--text-muted)' } },
          x: { grid: { display: false }, ticks: { color: 'var(--text-muted)', maxRotation: 0, autoSkip: true } },
        },
      },
    }
  }, [passport])

  const exportPdf = useCallback(async () => {
    if (!passport) return
    const { exportToPdf, reportFileName } = await loadExportUtils()
    const rows = passport.journey.map((s) => ({
      asset_no: s.asset_no || NA,
      position: s.position || NA,
      fitted: dateTxt(s.fitted),
      removed: s.removed ? dateTxt(s.removed) : 'Current',
      km_run: s.km_run == null ? NA : Number(s.km_run).toLocaleString(),
      cost: s.cost == null ? NA : moneyFull(s.cost),
      cpk: s.cpk == null || cur.mixed ? NA : String(s.cpk),
      reason: s.reason || NA,
    }))
    const headers = ['Asset', 'Position', 'Fitted', 'Removed', 'Km run', 'Cost', 'CPK', 'Reason']
    const keys = ['asset_no', 'position', 'fitted', 'removed', 'km_run', 'cost', 'cpk', 'reason']
    await exportToPdf(
      rows,
      keys.map((k, i) => ({ key: k, header: headers[i] })),
      `Tyre Passport ${passport.serial}`,
      reportFileName('Tyre Passport', passport.serial),
      'landscape',
    )
  }, [passport, moneyFull, cur.mixed])

  const exportExcel = useCallback(async () => {
    if (!passport) return
    const { exportToExcel, reportFileName } = await loadExportUtils()
    const rows = passport.journey.map((s) => ({
      asset_no: s.asset_no || '',
      position: s.position || '',
      fitted: s.fitted || '',
      removed: s.removed || 'Current',
      km_run: s.km_run ?? '',
      cost: cur.mixed ? '' : (s.cost ?? ''),
      cpk: cur.mixed ? '' : (s.cpk ?? ''),
      reason: s.reason || '',
    }))
    const keys = ['asset_no', 'position', 'fitted', 'removed', 'km_run', 'cost', 'cpk', 'reason']
    const headers = ['Asset', 'Position', 'Fitted', 'Removed', 'Km run', 'Cost', 'CPK', 'Reason']
    await exportToExcel(rows, keys, headers, reportFileName('Tyre Passport', passport.serial), 'Journey', {
      title: `Tyre Passport ${passport.serial}`, currency: cur.currency || '',
    })
  }, [passport, cur])

  const pill = (tone, text) => <span className={`cc-pill ${tone}`}>{text}</span>

  const journeyColumns = useMemo(() => [
    { accessorKey: 'asset_no', header: 'Asset', cell: ({ getValue }) => assetLink(getValue()) },
    { accessorKey: 'position', header: 'Position', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'site', header: 'Site', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'fitted', header: 'Fitted', cell: ({ getValue }) => dateTxt(getValue()) },
    { accessorKey: 'removed', header: 'Removed',
      meta: { exportValue: (r) => (r.removed || 'Current') },
      cell: ({ getValue }) => (getValue() ? dateTxt(getValue()) : pill('good', 'Current')) },
    { accessorKey: 'days', header: 'Days on', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() == null ? NA : getValue().toLocaleString()) },
    { accessorKey: 'km_run', header: 'Km run', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() == null ? NA : Number(getValue()).toLocaleString()) },
    { accessorKey: 'cost', header: 'Cost', meta: { align: 'right' },
      cell: ({ getValue }) => moneyFull(getValue()) },
    { accessorKey: 'cpk', header: 'CPK', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() == null || cur.mixed ? NA : getValue()) },
    { accessorKey: 'reason', header: 'Removal reason', cell: ({ getValue }) => getValue() || NA },
  ], [moneyFull, cur.mixed])

  const serviceColumns = useMemo(() => [
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => dateTxt(getValue()) },
    { accessorKey: 'type', header: 'Type', cell: ({ getValue }) => pill(EVENT_TONE(getValue()), statusText(getValue())) },
    { accessorKey: 'asset_no', header: 'Asset', cell: ({ getValue }) => assetLink(getValue()) },
    { accessorKey: 'site', header: 'Site', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'position', header: 'Position', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'tread', header: 'Tread', meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? NA : `${getValue()} mm`) },
    { accessorKey: 'pressure', header: 'Pressure', meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? NA : `${getValue()} psi`) },
    { accessorKey: 'cost', header: 'Cost', meta: { align: 'right' }, cell: ({ getValue }) => moneyFull(getValue()) },
    { accessorKey: 'technician', header: 'Performed by', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'notes', header: 'Description',
      cell: ({ getValue }) => <span className="tp-trunc" title={getValue() || ''}>{getValue() || NA}</span> },
  ], [moneyFull])

  const inspectionColumns = useMemo(() => [
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => dateTxt(getValue()) },
    { accessorKey: 'asset_no', header: 'Asset', cell: ({ getValue }) => assetLink(getValue()) },
    { accessorKey: 'site', header: 'Location', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'position', header: 'Position', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'tread', header: 'Tread (mm)', meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? NA : getValue()) },
    { accessorKey: 'pressure', header: 'Pressure (psi)', meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? NA : getValue()) },
    { accessorKey: 'condition', header: 'Condition', cell: ({ getValue }) => (getValue() ? pill(CONDITION_TONE(getValue()), getValue()) : NA) },
    { accessorKey: 'inspector', header: 'Inspector', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'findings', header: 'Findings', cell: ({ getValue }) => <span className="tp-trunc" title={getValue() || ''}>{getValue() || NA}</span> },
    { accessorKey: 'basis', header: 'Matched by', meta: { exportValue: (r) => (r.basis === 'serial' ? 'Serial' : 'Position') },
      cell: ({ getValue }) => (getValue() === 'serial' ? 'Serial' : 'Position') },
  ], [])

  const warrantyColumns = useMemo(() => [
    { accessorKey: 'claim_no', header: 'Claim no', cell: ({ getValue }) => <span className="tp-mono">{getValue() || NA}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => pill(statusTone(getValue()), statusText(getValue())) },
    { accessorKey: 'failure_type', header: 'Failure type', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'supplier', header: 'Supplier', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'km_run', header: 'Km run', meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? NA : Number(getValue()).toLocaleString()) },
    { accessorKey: 'credit_amount', header: 'Credit', meta: { align: 'right' }, cell: ({ getValue }) => moneyFull(getValue()) },
    { accessorKey: 'credit_date', header: 'Credit date', cell: ({ getValue }) => dateTxt(getValue()) },
  ], [moneyFull])

  const retreadColumns = useMemo(() => [
    { accessorKey: 'claim_no', header: 'Claim no', cell: ({ getValue }) => <span className="tp-mono">{getValue() || NA}</span> },
    { accessorKey: 'vendor', header: 'Vendor', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => pill(statusTone(getValue()), statusText(getValue())) },
    { accessorKey: 'reason', header: 'Reason', cell: ({ getValue }) => <span className="tp-trunc" title={getValue() || ''}>{getValue() || NA}</span> },
    { accessorKey: 'cost', header: 'Cost', meta: { align: 'right' }, cell: ({ getValue }) => moneyFull(getValue()) },
    { accessorKey: 'amount_recovered', header: 'Recovered', meta: { align: 'right' }, cell: ({ getValue }) => moneyFull(getValue()) },
    { accessorKey: 'claim_date', header: 'Date', cell: ({ getValue }) => dateTxt(getValue()) },
  ], [moneyFull])

  const isAdmin = isSuperAdmin || String(profile?.role || '') === 'Admin'
  const menuItems = [
    { label: 'Export PDF', icon: FileDown, onClick: exportPdf, disabled: !passport },
    { label: 'Export Excel', icon: Sheet, onClick: exportExcel, disabled: !passport },
    { label: 'Refresh', icon: RefreshCw, onClick: () => load(serial), disabled: loading },
    ...(currentAssetNo ? [{ label: `Open asset ${currentAssetNo}`, icon: Truck, onClick: () => navigate(assetHref(currentAssetNo)) }] : []),
    { label: 'Open tyre records', icon: ExternalLink, onClick: () => navigate('/tyres') },
    ...(isAdmin ? [{ label: 'Open serial tracker', icon: ScanLine, onClick: () => navigate('/serial-tracker') }] : []),
    { label: 'Look up another serial', icon: Search, onClick: () => navigate('/tyre-passport') },
  ]

  const tread = treadInfo(passport)
  const km = kmInfo(passport)
  const pressure = latestPressure(passport, inspectionRows)
  const cov = healthCoverage(passport?.health)
  const warranty = warrantySummary(passport)
  const spark = cpkSeries(passport?.journey || [])
  const months = ageMonths(passport?.ageDays)
  const lastFit = passport ? [...passport.events].reverse().find((e) => e.fitment_date || e.date) : null
  const statusNote = !passport ? ''
    : passport.scrapped ? (passport.scrapReason ? `Removed: ${passport.scrapReason}` : 'No longer fitted')
      : passport.currentAssetNo ? `On ${passport.currentAssetNo} since ${dateTxt(lastFit?.fitment_date || lastFit?.date)}` : 'Not currently fitted'
  const lastPositionEvent = passport ? [...passport.events].reverse().find((e) => e.position || e.asset_no) : null

  const detailRows = passport ? [
    ['Tyre serial', <span key="s" className="tp-mono">{passport.serial || NA}</span>],
    ['Brand', passport.brand || NA],
    ['Size', passport.size || NA],
    ['Supplier', passport.supplier || NA],
    ['Pattern', catEntry?.pattern || (catalogue.error ? 'Catalogue could not be checked' : 'Not in the tyre catalogue')],
    ['Load index / speed', specLoad(catEntry)],
    ['Ply rating', catEntry?.ply_rating || NA],
    ['New tread depth (catalogue)', catEntry?.tread_depth_new_mm == null ? NA : `${catEntry.tread_depth_new_mm} mm`],
    ['First fitted', dateTxt(passport.firstFittedDate)],
    ['Age since first fitted', passport.ageDays == null ? NA : `${passport.ageDays.toLocaleString()} days`],
    ['Records', passport.recordCount],
    ['Vehicles served', passport.distinctVehicles || 0],
    ['Positions served', passport.stats.positionsServed],
    ['Rotations', passport.rotationCount],
    ['Retreads', passport.retreadCount],
    ['Repairs', passport.stats.repairCount],
    ['Purchase cost', moneyFull(passport.costBreakdown.purchase || null)],
    ['Service and repair cost', moneyFull(passport.costBreakdown.service)],
    ['Recovered', moneyFull(passport.costBreakdown.recovered)],
    ['Net lifetime cost', moneyFull(passport.costBreakdown.netLifetime)],
    ['Current location', passport.currentAssetNo ? [passport.currentAssetNo, passport.currentPosition].filter(Boolean).join(' / ') : 'Not currently fitted'],
    ['Status', <span key="st" className="tp-status-inline"><i className={`tp-dot ${statusTone(passport.status)}`} aria-hidden="true" />{statusText(passport.status)}</span>],
  ] : []

  const heading = (
    <header className="tp-head">
      <div className="tp-head-img tp-head-dark" style={{ backgroundImage: 'url(/dashboard/hero-dark.webp)' }} aria-hidden="true" />
      <div className="tp-head-img tp-head-light" style={{ backgroundImage: 'url(/dashboard/hero-light.webp)' }} aria-hidden="true" />
      <div className="tp-head-copy">
        <h1>Tyre Passport</h1>
        {!serial && <p className="tp-lead">Look up any tyre serial for its full whole-life record: health, wear, cost per km, movements, service, warranty and data quality.</p>}
      </div>
      {serial && (
        <div className="tp-head-actions">
          <button type="button" className="cc-btn-ghost" onClick={() => navigate('/tyre-passport')}><ArrowLeft size={14} aria-hidden="true" /> Back to Tyre Passport</button>
          <MoreMenu items={menuItems} />
          <button type="button" className="cc-btn-primary" onClick={exportPdf} disabled={!passport}><FileDown size={14} aria-hidden="true" /> Export PDF</button>
        </div>
      )}
    </header>
  )

  return (
    <div className="cc tp">
      {heading}

      {!serial && (
        <section className="cc-card tp-lookup" aria-label="Find a tyre">
          <h2 className="cc-card-title">Find a tyre</h2>
          <p className="cc-card-sub">Enter or scan a serial number to open its passport.</p>
          <SearchBox country={activeCountry} autoFocus onPick={(sn) => navigate(`/tyre-passport/${encodeURIComponent(sn)}`)} />
        </section>
      )}

      {!!bundle?.unavailableSources?.length && (
        <p role="alert" className="tp-alert">Some history could not be loaded: {bundle.unavailableSources.join(', ')}. This passport is incomplete; refresh to try again.</p>
      )}

      {serial && (loading ? (
        <div className="cc-card" role="status" aria-label="Loading the tyre passport">
          <div className="cc-skel" style={{ height: 150 }} />
        </div>
      ) : error ? (
        <div className="cc-card tp-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <p className="tp-strong">Could not load this tyre.</p>
            <p className="tp-muted tp-small">{error} Nothing is shown until it loads, so a failed read is never mistaken for a tyre with no history.</p>
            <button type="button" onClick={() => load(serial)} className="cc-btn tp-mt"><RefreshCw size={13} aria-hidden="true" /> Retry</button>
          </div>
        </div>
      ) : !passport ? (
        <div className="cc-card">
          <Empty icon={Package} title={`No records for ${serial}.`} sub="Check the serial or try a different one." />
        </div>
      ) : (
        <>
          {/* Identity */}
          <section className="cc-card tp-id" aria-label="Tyre identity">
            <div className="tp-id-art">
              <TyreTreadImage variant="hero" width={186} size={passport.size}
                position={passport.currentPosition || lastPositionEvent?.position} catalogue={catEntry} />
              <SerialQr serial={passport.serial} />
            </div>
            <div className="tp-id-main">
              <span className="tp-eyebrow">Tyre serial / ID</span>
              <div className="tp-serial tp-mono">{passport.serial || NA}</div>
              <div className="tp-specs">
                <div className="tp-brand">{passport.brand || <span className="cc-na">No brand on record</span>}</div>
                <div className="tp-spec"><span>Size</span><b>{passport.size || NA}</b></div>
                <div className="tp-spec"><span>Supplier</span><b>{passport.supplier || NA}</b></div>
                <div className="tp-spec"><span>First fitted</span><b>{dateTxt(passport.firstFittedDate)}</b></div>
                <div className="tp-spec" title={catEntry ? 'From the tyre catalogue entry for this brand and size.' : 'Pattern, load and speed index are read from the tyre catalogue. The DOT date is not captured on tyre records.'}>
                  <span>Pattern</span>
                  {catalogue.loading ? <b className="cc-na">Checking</b>
                    : catalogue.error ? <b className="cc-na">Could not check <button type="button" className="tp-link" onClick={() => setCatalogueNonce((n) => n + 1)}>Retry</button></b>
                      : catEntry?.pattern ? <b>{catEntry.pattern}</b>
                        : <b className="cc-na">{catEntry ? 'Not recorded' : 'Not in the catalogue'}</b>}
                </div>
                <div className="tp-spec"><span>Load / speed</span><b className={catEntry && (catEntry.load_index_single || catEntry.speed_rating) ? '' : 'cc-na'}>{specLoad(catEntry)}</b></div>
              </div>
            </div>
            <div className="tp-id-side">
              <div className={`tp-status ${statusTone(passport.status)}`}>
                <span className="tp-eyebrow">Current status</span>
                <div className="tp-status-val"><i className={`tp-dot ${statusTone(passport.status)}`} aria-hidden="true" />{statusText(passport.status)}</div>
                <div className="tp-small tp-muted">{statusNote}{passport.statusMarks.length ? `, marked ${passport.statusMarks.map((m) => String(m).replace(/_/g, ' ')).join(', ')}` : ''}</div>
              </div>
              <div className="tp-veh">
                <div className="tp-veh-cell">
                  {passport.currentAssetNo ? (
                    <Link to={assetHref(passport.currentAssetNo)} className="tp-veh-link">
                      <VehicleThumb row={asset || { asset_no: passport.currentAssetNo }} size="md" />
                      <span>
                        <span className="tp-small tp-muted">Vehicle / asset</span>
                        <b>{passport.currentAssetNo}</b>
                        <span className="tp-small tp-muted">{asset ? [asset.make, asset.model].filter(Boolean).join(' ') || asset.vehicle_type || 'Make and model not recorded' : 'Make and model not loaded'}</span>
                      </span>
                    </Link>
                  ) : (
                    <span className="tp-veh-link">
                      <span className="cc-thumb cc-thumb-md"><Truck size={18} aria-hidden="true" /></span>
                      <span><span className="tp-small tp-muted">Vehicle / asset</span><b>Not currently fitted</b>
                        {lastPositionEvent?.asset_no && <span className="tp-small tp-muted">Last on {lastPositionEvent.asset_no}</span>}</span>
                    </span>
                  )}
                </div>
                <div className="tp-veh-cell">
                  <span className="tp-pos-icon"><MapPin size={20} aria-hidden="true" /></span>
                  <span>
                    <span className="tp-small tp-muted">Fitted position</span>
                    <b>{passport.currentPosition || NA}</b>
                    {!passport.currentPosition && lastPositionEvent?.position && <span className="tp-small tp-muted">Last at {lastPositionEvent.position}</span>}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Metric cards */}
          <div className="tp-metrics">
            <Metric icon={Ruler} tone="green" label="Tread depth" value={tread.current == null ? NA : tread.current} unit="mm"
              title={tread.current == null ? 'No tread reading recorded for this tyre.' : 'Latest tread reading. The share is of usable tread above the 3 mm scrap limit.'}
              foot={tread.pct == null ? (tread.current == null ? 'No reading recorded' : null) : `${Math.round(tread.pct)}% of usable tread left${tread.assumed ? ` (new tread assumed ${tread.initial} mm)` : ` (new ${tread.initial} mm)`}`}
              onClick={() => setTab('inspections')}>
              <Bar pct={tread.pct} tone={tread.pct == null ? undefined : tread.pct >= 50 ? 'var(--cc-green)' : tread.pct >= 25 ? 'var(--cc-amber)' : 'var(--cc-red)'} />
            </Metric>
            <Metric icon={Gauge} tone="amber" label="Tyre pressure" value={pressure.value == null ? NA : pressure.value} unit="psi"
              title="Latest recorded pressure. No per-tyre target pressure is stored, so none is compared."
              foot={pressure.value == null ? 'No reading recorded' : `No target on record. ${pressure.source}, ${dateTxt(pressure.date)}`}
              onClick={() => setTab('inspections')} />
            <Metric icon={Calendar} tone="amber" label="Tyre age" value={months == null ? NA : months} unit={months === 1 ? 'month' : 'months'}
              title="Measured from the first fitment date. The manufacture (DOT) date is not recorded."
              foot={passport.firstFittedDate ? `Since first fitted ${dateTxt(passport.firstFittedDate)}` : 'No fitment date recorded'}
              onClick={() => setTab('timeline')} />
            <Metric icon={Milestone} tone="green" label="Kilometers run" value={km.km == null ? NA : km.km.toLocaleString('en-US')} unit="km"
              title={km.estLife ? 'Expected life is estimated from the observed wear rate.' : 'An expected life needs two tread readings over distance.'}
              foot={km.estLife ? `Est. life ${km.estLife.toLocaleString('en-US')} km, ${km.pct}% used` : (km.km == null ? 'No distance recorded' : 'Expected life not computable')}
              onClick={() => setTab('movement')}>
              <Bar pct={km.pct} />
            </Metric>
            <Metric icon={Coins} tone="blue" label="Cost per km" value={cur.mixed || passport.costBreakdown.cpk == null ? NA : `${cur.currency || ''} ${passport.costBreakdown.cpk}`.trim()}
              title={cur.mixed ? 'Records span more than one country, so costs are in different currencies and are not combined.' : 'Lifetime cost (purchase plus service) divided by kilometers run.'}
              foot={cur.mixed ? 'Costs in more than one currency' : `Total cost ${moneyFull(passport.costBreakdown.lifetime || null)}`}
              onClick={() => setTab('service')}>
              <Spark values={cur.mixed ? [] : spark} />
            </Metric>
            <div className="cc-card tp-metric tp-health" title={`${cov.measured} of ${cov.total} health signals are measured; the rest use a neutral baseline.`}>
              <HealthRing score={passport.health.overall} risk={passport.health.risk} />
              <div className="tp-metric-body">
                <div className="tp-metric-label">Health score</div>
                <div className="tp-metric-val">{passport.health.overall ?? NA}<small> / 100</small></div>
                <div className="tp-metric-foot" style={{ color: RING[passport.health.risk] }}>{healthLabel(passport.health.risk)}</div>
                <div className="tp-metric-foot">{cov.measured} of {cov.total} signals measured</div>
              </div>
            </div>
          </div>

          <Tabs variant="line" label="Passport sections" value={tab} onChange={setTab}
            tabs={TABS.map((t) => ({
              ...t,
              count: t.key === 'service' ? passport.serviceEvents.length || null
                : t.key === 'warranty' ? passport.warranty.length || null
                : t.key === 'quality' ? passport.dataQuality.length || null
                : t.key === 'inspections' ? inspectionRows.length || null : null,
              countTone: t.key === 'quality' ? 'warn' : undefined,
            }))} />

          {tab === 'overview' && (
            <div className="tp-grid">
              <section className="cc-card tp-a-details" aria-label="Tyre details">
                <div className="cc-card-head"><h2 className="cc-card-title">Tyre details</h2></div>
                <dl className="tp-dl">
                  {detailRows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
                </dl>
              </section>

              <div className="tp-col">
              <section className="cc-card tp-a-life" aria-label="Lifecycle timeline">
                <div className="cc-card-head"><h2 className="cc-card-title">Lifecycle timeline</h2><ViewAll label="View full timeline" onClick={() => setTab('timeline')} /></div>
                <ol className="tp-steps">
                  {steps.map((s) => (
                    <li key={s.key} className={`tp-step ${s.state}`}>
                      <span className="tp-step-dot" aria-hidden="true">{s.state === 'done' || s.state === 'current' ? <CheckCircle2 size={16} /> : null}</span>
                      <b>{s.label}</b>
                      {s.date && <span>{dateTxt(s.date)}</span>}
                      {s.sub && <span>{s.sub}</span>}
                    </li>
                  ))}
                </ol>
              </section>

              <section className="cc-card tp-a-insp" aria-label="Latest inspection summary">
                <div className="cc-card-head"><h2 className="cc-card-title">Latest inspection summary</h2><ViewAll label="View all inspections" onClick={() => setTab('inspections')} /></div>
                {insp.error ? <div className="cc-empty" role="alert">{insp.error}</div> : insp.loading ? <div className="cc-skel" style={{ height: 90 }} /> : (
                  <KitTable compact empty="No inspection has recorded a reading for this tyre."
                    getRowId={(r) => String(r.id)}
                    rows={inspectionRows.slice(0, 5)}
                    columns={[
                      { key: 'date', header: 'Date', cell: (r) => dateTxt(r.date) },
                      { key: 'site', header: 'Location', cell: (r) => r.site || NA },
                      { key: 'tread', header: 'Tread (mm)', cell: (r) => r.tread ?? NA },
                      { key: 'pressure', header: 'Pressure (psi)', cell: (r) => r.pressure ?? NA },
                      { key: 'condition', header: 'Condition', cell: (r) => (r.condition ? pill(CONDITION_TONE(r.condition), r.condition) : NA) },
                      { key: 'inspector', header: 'Inspector', cell: (r) => r.inspector || NA },
                      { key: 'findings', header: 'Findings', cell: (r) => <span className="tp-trunc">{r.findings || NA}</span> },
                    ]} />
                )}
              </section>

              <section className="cc-card tp-a-svc" aria-label="Service and repair history">
                <div className="cc-card-head"><h2 className="cc-card-title">Service and repair history</h2><ViewAll label="View all service history" onClick={() => setTab('service')} /></div>
                <KitTable compact empty="No service or repair events recorded for this tyre."
                  getRowId={(e) => String(e.id)}
                  rows={passport.serviceEvents.slice(0, 4)}
                  columns={[
                    { key: 'date', header: 'Date', cell: (e) => dateTxt(e.date) },
                    { key: 'type', header: 'Type', cell: (e) => pill(EVENT_TONE(e.type), statusText(e.type)) },
                    { key: 'site', header: 'Workshop', cell: (e) => e.site || NA },
                    { key: 'notes', header: 'Description', cell: (e) => <span className="tp-trunc">{e.notes || NA}</span> },
                    { key: 'cost', header: 'Cost', cell: (e) => moneyFull(e.cost) },
                    { key: 'technician', header: 'Performed by', cell: (e) => e.technician || NA },
                  ]} />
              </section>

              </div>
              <div className="tp-col">
              <section className="cc-card tp-a-move" aria-label="Fitment and movement history">
                <div className="cc-card-head"><h2 className="cc-card-title">Fitment and movement history</h2><ViewAll onClick={() => setTab('movement')} /></div>
                <KitTable compact empty="No fitment history on record."
                  getRowId={(m) => String(m.id)}
                  rows={movement.slice(0, 5)}
                  onRowClick={(m) => { if (m?.asset_no) navigate(assetHref(m.asset_no)) }}
                  columns={[
                    { key: 'date', header: 'Date', cell: (m) => dateTxt(m.date) },
                    { key: 'asset_no', header: 'Asset', cell: (m) => assetLink(m.asset_no) },
                    { key: 'position', header: 'Position', cell: (m) => m.position || NA },
                    { key: 'odometer', header: 'Odometer', cell: (m) => kmTxt(m.odometer) },
                    { key: 'action', header: 'Action', cell: (m) => pill(m.current ? 'good' : ACTION_TONE[m.action] || 'muted', m.current ? 'In service' : m.action) },
                  ]} />
              </section>

              <section className="cc-card tp-a-war" aria-label="Warranty status">
                <div className="cc-card-head"><h2 className="cc-card-title">Warranty status</h2><ViewAll onClick={() => setTab('warranty')} /></div>
                {warranty.latest ? (
                  <div className="tp-war">
                    <span className="tp-war-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
                    <div>
                      <b>{statusText(warranty.latest.status)}</b>
                      <div className="tp-small tp-muted">Claim {warranty.latest.claim_no || NA}{warranty.count > 1 ? `, ${warranty.count} claims in total` : ''}</div>
                      <dl className="tp-dl tp-dl-tight">
                        <div><dt>Failure type</dt><dd>{warranty.latest.failure_type || NA}</dd></div>
                        <div><dt>Supplier</dt><dd>{warranty.latest.supplier || NA}</dd></div>
                        <div><dt>Credit</dt><dd>{moneyFull(warranty.latest.credit_amount)}</dd></div>
                      </dl>
                    </div>
                  </div>
                ) : (
                  <div className="tp-war">
                    <span className="tp-war-icon muted"><ShieldCheck size={22} aria-hidden="true" /></span>
                    <div><b>No warranty claim on record</b><div className="tp-small tp-muted">Warranty terms and expiry are not stored per tyre, so coverage cannot be shown.</div></div>
                  </div>
                )}
              </section>

              <section className="cc-card tp-a-docs" aria-label="Attached documents">
                <div className="cc-card-head"><h2 className="cc-card-title">Attached documents</h2><ViewAll onClick={() => setTab('documents')} /></div>
                <div className="cc-empty tp-small"><div><FileText size={20} aria-hidden="true" /><br />No documents are attached to this tyre.</div></div>
              </section>
              </div>
            </div>
          )}

          {tab === 'timeline' && (
            <section className="cc-card" aria-label="Lifecycle timeline">
              <div className="cc-card-head"><div><h2 className="cc-card-title">Lifecycle timeline</h2><p className="cc-card-sub">Every fitment, movement, removal, service event, warranty claim and inspection recorded for this tyre, newest first.</p></div></div>
              <ol className="tp-steps tp-steps-wide">
                {steps.map((s) => (
                  <li key={s.key} className={`tp-step ${s.state}`}>
                    <span className="tp-step-dot" aria-hidden="true">{s.state !== 'future' ? <CheckCircle2 size={16} /> : null}</span>
                    <b>{s.label}</b>{s.date && <span>{dateTxt(s.date)}</span>}{s.sub && <span>{s.sub}</span>}
                  </li>
                ))}
              </ol>
              {timeline.length === 0 ? <Empty icon={History} title="Nothing recorded yet." /> : (
                <ul className="tp-feed">
                  {timeline.map((e) => (
                    <li key={e.id} className={`tp-feed-${e.kind}`}>
                      <i aria-hidden="true" />
                      <div><b>{statusText(e.title)}</b>{e.detail && <span className="tp-muted"> {e.detail}</span>}</div>
                      <time className="tp-muted tp-small">{dateTxt(e.date)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {tab === 'inspections' && (
            <div className="tp-stack">
              <section className="cc-card" aria-label="Inspection history">
                <div className="cc-card-head"><div><h2 className="cc-card-title">Inspection history</h2>
                  <p className="cc-card-sub">Inspections that name this serial, or that recorded this tyre's asset and position while it was fitted.{insp.truncated ? ' The inspection read reached its row limit, so older inspections may be missing.' : ''}</p></div></div>
                {insp.error ? <div className="cc-empty" role="alert">{insp.error}</div> : (
                  <EnterpriseTable columns={inspectionColumns} data={inspectionRows} getRowId={(r, i) => String(r.id ?? i)}
                    enableColumnFilters={false} searchPlaceholder="Search asset, inspector or findings"
                    exportFileName={`Tyre Passport ${passport.serial} inspections`}
                    emptyMessage={insp.loading ? 'Loading inspections...' : 'No inspection has recorded a reading for this tyre.'} />
                )}
              </section>
              <section className="cc-card" aria-label="Tread depth over time">
                <div className="cc-card-head"><div><h2 className="cc-card-title">Tread depth over time</h2><p className="cc-card-sub">Tread readings from fitment records and service events.</p></div></div>
                <div className="tp-wear-stats">
                  <div><span>Tread remaining</span><b>{passport.wear.treadRemainingPct == null ? NA : `${passport.wear.treadRemainingPct}%`}</b></div>
                  <div><span>Wear rate</span><b>{passport.wear.wearRatePer1000Km == null ? NA : `${passport.wear.wearRatePer1000Km} mm per 1,000 km`}</b></div>
                  <div><span>Projected life left</span><b>{passport.predictions.projectedRemainingKm == null ? NA : kmTxt(passport.predictions.projectedRemainingKm)}</b></div>
                  <div><span>Readings</span><b>{passport.wear.readingCount}</b></div>
                </div>
                {wearChart ? <div className="tp-chart"><Line data={wearChart.data} options={wearChart.options} /></div>
                  : <Empty icon={BarChart3} title="No tread readings recorded for this tyre yet." />}
              </section>
            </div>
          )}

          {tab === 'service' && (
            <section className="cc-card" aria-label="Service and repair history">
              <div className="cc-card-head"><div><h2 className="cc-card-title">Service and repair history</h2><p className="cc-card-sub">{passport.serviceEvents.length} event(s) recorded against this serial.</p></div></div>
              <EnterpriseTable columns={serviceColumns} data={passport.serviceEvents} getRowId={(r, i) => String(r.id ?? i)}
                enableColumnFilters={false} searchPlaceholder="Search type, asset or technician"
                exportFileName={`Tyre Passport ${passport.serial} service`}
                emptyMessage="No service or repair events recorded for this tyre." />
              <div className="tp-cost">
                {[
                  ['Purchase', moneyFull(passport.costBreakdown.purchase || null)],
                  ['Service and repairs', moneyFull(passport.costBreakdown.service)],
                  ['Recovered (warranty and retread)', moneyFull(passport.costBreakdown.recovered)],
                  ['Net lifetime cost', moneyFull(passport.costBreakdown.netLifetime)],
                  ['Net cost per km', passport.costBreakdown.netCpk == null || cur.mixed ? NA : `${cur.currency || ''} ${passport.costBreakdown.netCpk}`.trim()],
                ].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
              </div>
            </section>
          )}

          {tab === 'movement' && (
            <section className="cc-card" aria-label="Fitment and movement history">
              <div className="cc-card-head"><div><h2 className="cc-card-title">Fitment and movement history</h2>
                <p className="cc-card-sub">{journeyStats.stints} stint(s) across {passport.distinctVehicles} vehicle(s). Average {journeyStats.avgKmPerStint == null ? NA : `${journeyStats.avgKmPerStint.toLocaleString()} km`} per measured stint ({journeyStats.measuredStints} of {journeyStats.stints} have distance).</p></div></div>
              <EnterpriseTable columns={journeyColumns} data={journeyRows} getRowId={(r, i) => String(r.id ?? i)}
                enableColumnFilters={false} searchPlaceholder="Search asset, site or reason"
                exportFileName={`Tyre Passport ${passport.serial} journey`} emptyMessage="No stint history on record."
                onRowClick={(r) => { if (r?.asset_no) navigate(assetHref(r.asset_no)) }} />
            </section>
          )}

          {tab === 'warranty' && (
            <div className="tp-stack">
              <section className="cc-card" aria-label="Warranty claims">
                <div className="cc-card-head"><h2 className="cc-card-title">Warranty claims</h2></div>
                <EnterpriseTable columns={warrantyColumns} data={passport.warranty} getRowId={(r, i) => String(r.id ?? i)}
                  enableColumnFilters={false} enableGlobalFilter={passport.warranty.length > 10}
                  exportFileName={`Tyre Passport ${passport.serial} warranty`} emptyMessage="No warranty claims recorded for this tyre." />
              </section>
              {passport.retreadClaims.length > 0 && (
                <section className="cc-card" aria-label="Retread claims">
                  <div className="cc-card-head"><h2 className="cc-card-title">Retread claims</h2></div>
                  <EnterpriseTable columns={retreadColumns} data={passport.retreadClaims} getRowId={(r, i) => String(r.id ?? i)}
                    enableColumnFilters={false} enableGlobalFilter={passport.retreadClaims.length > 10}
                    exportFileName={`Tyre Passport ${passport.serial} retread`} emptyMessage="No retread claims." />
                </section>
              )}
            </div>
          )}

          {tab === 'documents' && (
            <section className="cc-card" aria-label="Documents">
              <div className="cc-card-head"><h2 className="cc-card-title">Documents</h2></div>
              <Empty icon={FileText} title="No documents are attached to this tyre." sub="No photos are stored on this tyre's records, and invoices and reports are not linked to tyre serials, so there is nothing to list here." />
            </section>
          )}

          {tab === 'quality' && (
            <section className="cc-card" aria-label="Data quality audit">
              <div className="cc-card-head"><h2 className="cc-card-title">Data quality audit</h2></div>
              {passport.dataQuality.length === 0 ? (
                <p className="tp-ok"><CheckCircle2 size={16} aria-hidden="true" /> All checks passed. No data quality issues detected for this tyre.</p>
              ) : (
                <ul className="tp-issues">
                  {passport.dataQuality.map((w, i) => (
                    <li key={i}>{pill(SEV_TONE[w.severity] || 'info', `${statusText(w.severity)} severity`)}<span>{w.message}</span></li>
                  ))}
                </ul>
              )}
              <p className="tp-small tp-muted tp-mt">Checks: impossible cross-vehicle date overlap, tread readings that increase over time, and stints missing fitment or removal odometer.</p>
            </section>
          )}

          <p className="tp-small tp-muted tp-foot"><ClipboardCheck size={12} aria-hidden="true" /> Figures come from tyre records, service events, warranty claims and inspections. Anything not recorded shows N/A.{cur.mixed ? ' Costs are shown as N/A because the records span more than one country and currency.' : ''}</p>
        </>
      ))}
    </div>
  )
}
