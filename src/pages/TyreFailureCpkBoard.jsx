/**
 * TyreFailureCpkBoard (route /tyre-failure-cpk) rebuilt on the shared page
 * kit to the owner's mockup: KPI strip, view tabs, failure reasons / CPK by
 * brand / tyre life distribution cards, a filter bar, the removed register
 * and a drill-down card for the selected removed tyre.
 *
 * Data: tyre_records (listAllRecords, country-scoped) for every tyre figure,
 * the expense grid (loadGridTyreByAsset) for per-asset tyre cost, and
 * kpi_targets for the optional fleet CPK and tyre life targets. Board maths
 * comes from src/lib/tyreFailureBoard.js (kpiEngine), page shaping from
 * src/lib/tyreFailureCpkBoardAnalytics.js and src/lib/tyreFailureView.js.
 *
 * Honest rules: CPK and cost are money, so on the All-countries scope they
 * read N/A. Trends appear only when a closed date window is set, against the
 * equal window before it. Life and CPK need fitment and removal km.
 *
 * Kept from the previous page: every chart (status split, removal reasons,
 * removals by position, CPK by brand and by site, life by brand), the asset
 * CPK ranking, the removed register, site / brand / status / date / search
 * filters, refresh, Excel exports and the PDF report.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  AlertTriangle, Download, RefreshCw, FileSpreadsheet, Search, X, Truck, Wrench, Coins, Info,
  ChevronRight, Layers, CheckCircle2, BookOpen, ShieldCheck, Target,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import DateField from '../components/ui/DateField'
import { Card, CardState, Kpi, Tabs, Donut, KitTable } from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { listAllRecords } from '../lib/api/tyreRecords'
import { loadGridTyreByAsset } from '../lib/api/costSummary'
import { listTyreTargets, saveTyreTarget } from '../lib/api/tyreKpiTargets'
import useLatestRequest from '../lib/useLatestRequest'
import { buildTyreFailureBoard } from '../lib/tyreFailureBoard'
import {
  filterBoardRecords, moneyComparable, assetRanking, filterOptions,
  assetExportRows, removedExportRows, ASSET_EXPORT_COLS, ASSET_EXPORT_HEADERS,
  REMOVED_EXPORT_COLS, REMOVED_EXPORT_HEADERS,
} from '../lib/tyreFailureCpkBoardAnalytics'
import {
  lifeDistribution, reasonSegments, cpkBars, removedRows, riskTone, periodTrends,
  pickTarget, TARGET_METRICS, drillSummary,
} from '../lib/tyreFailureView'
import { stylize } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import './TyreFailureCpkBoard.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')

// Categorical order for removal reasons, validated for colour-vision safety
// on both themes; "Other" is always the neutral grey.
const REASON_COLORS = ['#3b82f6', '#d97706', '#a855f7', '#0d9488', '#e11d48', '#8a94a3']

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString('en-US'))
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : `${Number(v)}%`)
const NA = ({ why }) => <span className="cc-na" title={why}>N/A</span>

const chartBase = (legend = false) => ({
  responsive: true,
  maintainAspectRatio: false,
  layout: { padding: { top: 8 } },
  plugins: {
    legend: { display: legend, labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: 'var(--panel-2)', titleColor: 'var(--panel-ink)', bodyColor: 'var(--text-secondary)', borderColor: 'var(--hairline)', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
})
const HBAR_OPTS = { ...chartBase(false), indexAxis: 'y' }
const DOUGHNUT_OPTS = {
  responsive: true, maintainAspectRatio: false, cutout: '58%',
  plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
}

function ChartCard({ title, sub, children, refCb, label }) {
  return (
    <Card title={title} sub={sub}>
      <div className="tf-chart" ref={refCb} role="img" aria-label={label || title}>{children}</div>
    </Card>
  )
}
const Empty = ({ children }) => <div className="tf-chart-empty">{children}</div>
const hasChartData = (cd) => !!(cd && Array.isArray(cd.labels) && cd.labels.length)

const kpiLabel = (label, sub) => <>{label}{sub && <small className="tf-kpi-sub">{sub}</small>}</>

export default function TyreFailureCpkBoard() {
  const { activeCountry, appSettings, activeCurrency } = useSettings()
  const [records, setRecords] = useState(null)
  const [grid, setGrid] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('overview')
  const [selectedId, setSelectedId] = useState(null)
  const [targets, setTargets] = useState({ rows: [], failed: false })
  const [targetOpen, setTargetOpen] = useState(false)
  const [targetDraft, setTargetDraft] = useState({ cpk: '', life: '' })
  const [targetSaving, setTargetSaving] = useState(false)
  const [targetError, setTargetError] = useState('')

  const chartRefs = useRef({})
  const setRef = (key) => (el) => { chartRefs.current[key] = el }
  const drillRef = useRef(null)
  const year = new Date().getFullYear()

  // Two loads are in flight whenever the date range moves twice quickly; the
  // slower first answer must never paint the previous window's figures.
  const latestLoad = useLatestRequest()

  const load = useCallback(async () => {
    const stale = latestLoad.begin()
    setRefreshing(true); setError('')
    try {
      const [{ data, error: readError }, gridRes] = await Promise.all([
        listAllRecords({ country: activeCountry }),
        loadGridTyreByAsset({ country: activeCountry, from: fromDate || undefined, to: toDate || undefined }),
      ])
      if (readError) throw readError
      if (stale()) return
      setRecords(data || [])
      setGrid(gridRes && gridRes.map ? gridRes.map : null)
      setUpdatedAt(new Date())
    } catch (e) {
      if (!stale()) setError(toUserMessage(e, 'Could not load the tyre failure and CPK board.'))
    } finally {
      if (!stale()) setRefreshing(false)
    }
  }, [activeCountry, fromDate, toDate, latestLoad])

  const loadTargets = useCallback(async () => {
    try {
      setTargets({ rows: await listTyreTargets({ year }) || [], failed: false })
    } catch {
      setTargets({ rows: [], failed: true })
    }
  }, [year])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadTargets() }, [loadTargets])

  const loaded = Array.isArray(records)
  const money = moneyComparable(activeCountry)
  const options = useMemo(() => filterOptions(records || []), [records])
  const filters = useMemo(() => ({
    from: fromDate, to: toDate, site: siteFilter, brand: brandFilter, status: statusFilter, search,
  }), [fromDate, toDate, siteFilter, brandFilter, statusFilter, search])
  const scoped = useMemo(() => filterBoardRecords(records || [], filters), [records, filters])
  const board = useMemo(() => buildTyreFailureBoard(scoped), [scoped])
  const ranking = useMemo(() => assetRanking(scoped, grid), [scoped, grid])
  const removed = useMemo(() => removedRows(scoped), [scoped])
  const trends = useMemo(() => periodTrends(records || [], filters), [records, filters])
  const life = useMemo(() => lifeDistribution(scoped), [scoped])
  const reasons = useMemo(() => reasonSegments(board.failureReasons, REASON_COLORS), [board])
  const brandCpk = useMemo(() => cpkBars(board.cpkByBrand), [board])
  const k = board.kpis
  const hasAny = !!(k && k.totalCount)
  const selected = removed.find((r) => String(r.id) === String(selectedId)) || null

  const cpkTarget = money ? pickTarget(targets.rows, TARGET_METRICS.cpk, activeCountry) : null
  const lifeTarget = pickTarget(targets.rows, TARGET_METRICS.life, money ? activeCountry : null)

  const fmtMoney = useCallback((v, d = 0) => (!money || v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrency(Number(v), activeCurrency, d)), [money, activeCurrency])
  const moneyWhy = money ? 'Needs a price plus fitment and removal km' : 'Pick a country: SAR, AED and EGP are never added together'

  const clearFilters = () => { setFromDate(''); setToDate(''); setSiteFilter(''); setBrandFilter(''); setStatusFilter(''); setSearch('') }
  const hasFilters = !!(fromDate || toDate || siteFilter || brandFilter || statusFilter || search)

  const selectRemoved = (r) => {
    setSelectedId((cur) => (String(cur) === String(r.id) ? null : r.id))
    requestAnimationFrame(() => drillRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  // ── PDF: KPI tiles + whichever charts are on screen ──────────────────────
  const buildDoc = useCallback(async () => {
    const { captureChartOnPaper } = await import('../lib/chartCapture')
    const { reportDateLabel } = await loadExportUtils()
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    const M = 12
    const company = appSettings?.company_name || 'TyrePulse'
    const scope = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
    doc.setFontSize(16); doc.setTextColor(15, 23, 42)
    doc.text(`${company} - Tyre Failure & CPK`, M, 16)
    doc.setFontSize(9); doc.setTextColor(100, 116, 139)
    doc.text(`${scope}  |  ${reportDateLabel(new Date())}${money ? '' : '  |  Money figures N/A: mixed currencies'}`, M, 22)
    const tiles = [
      ['Total tyres', num(k.totalCount)], ['Active', num(k.activeCount)], ['Removed', num(k.removedCount)],
      ['Fleet avg CPK', fmtMoney(k.fleetAvgCpk, 3)], ['Avg life km', num(k.avgLifeKm)], ['Removal rate', pct(k.failureRatePct)],
    ]
    let y = 30
    tiles.forEach((t, i) => {
      const x = M + i * ((W - 2 * M) / 6)
      doc.setTextColor(15, 23, 42); doc.setFontSize(11); doc.text(String(t[1]), x, y + 6)
      doc.setTextColor(100, 116, 139); doc.setFontSize(7.5); doc.text(String(t[0]), x, y + 11)
    })
    y += 20
    let placed = 0
    for (const key of ['status', 'reasons', 'cpkBrand', 'cpkSite', 'lifeBrand', 'position']) {
      const canvas = chartRefs.current[key]?.querySelector?.('canvas')
      if (!canvas) continue
      const img = captureChartOnPaper(canvas) || canvas.toDataURL('image/png', 1)
      if (!img) continue
      const cw = (W - 2 * M - 8) / 2
      const ch = 55
      if (y + Math.floor(placed / 2) * (ch + 6) + ch > doc.internal.pageSize.getHeight() - 10) { doc.addPage('a4', 'landscape'); y = 14; placed = 0 }
      doc.addImage(img, 'PNG', M + (placed % 2) * (cw + 8), y + Math.floor(placed / 2) * (ch + 6), cw, ch)
      placed += 1
    }
    return { doc, company }
  }, [appSettings, activeCountry, k, fmtMoney, money])

  async function exportPdf() {
    setExporting(true); setActionError('')
    try {
      const { reportFileName, reportDateLabel } = await loadExportUtils()
      const built = await buildDoc()
      built.doc.save(`${reportFileName(built.company, 'Tyre Failure CPK', reportDateLabel())}.pdf`)
    } catch (e) {
      setActionError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally { setExporting(false) }
  }

  async function exportExcel(kind) {
    setExporting(true); setActionError('')
    try {
      const { exportToExcel, reportFileName, reportDateLabel } = await loadExportUtils()
      const company = appSettings?.company_name || 'TyrePulse'
      if (kind === 'removed') {
        await exportToExcel(removedExportRows(removed, { money }), REMOVED_EXPORT_COLS, REMOVED_EXPORT_HEADERS, reportFileName(company, 'Removed Tyres', reportDateLabel()))
      } else {
        await exportToExcel(assetExportRows(ranking, { money }), ASSET_EXPORT_COLS, ASSET_EXPORT_HEADERS, reportFileName(company, 'Tyre CPK by Asset', reportDateLabel()))
      }
    } catch (e) {
      setActionError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally { setExporting(false) }
  }

  function openTargets() {
    setTargetError('')
    setTargetDraft({ cpk: cpkTarget ?? '', life: lifeTarget ?? '' })
    setTargetOpen(true)
  }
  async function saveTargets(e) {
    e.preventDefault()
    setTargetSaving(true); setTargetError('')
    try {
      const country = money ? activeCountry : null
      if (targetDraft.cpk !== '' && money) await saveTyreTarget({ metric: TARGET_METRICS.cpk, value: targetDraft.cpk, year, country, unit: `${activeCurrency}/km` })
      if (targetDraft.life !== '') await saveTyreTarget({ metric: TARGET_METRICS.life, value: targetDraft.life, year, country, unit: 'km' })
      await loadTargets()
      setTargetOpen(false)
    } catch (err) {
      setTargetError(toUserMessage(err, 'Targets could not be saved.'))
    } finally { setTargetSaving(false) }
  }

  const assetColumns = useMemo(() => [
    { key: 'asset_no', header: 'Asset', cell: (a) => <b>{a.asset_no || 'N/A'}</b> },
    { key: 'avgCpk', header: 'Avg CPK', numeric: true, sortValue: (a) => (money ? a.avgCpk : null),
      cell: (a) => (money && a.avgCpk != null ? fmtMoney(a.avgCpk, 3) : <NA why={moneyWhy} />) },
    { key: 'totalCost', header: 'Total cost', numeric: true, sortValue: (a) => (money ? a.totalCost : null),
      cell: (a) => (money && a.totalCost != null ? fmtMoney(a.totalCost) : <NA why={moneyWhy} />) },
    { key: 'costSource', header: 'Cost source' },
    { key: 'count', header: 'Tyres', numeric: true },
  ], [money, fmtMoney, moneyWhy])

  const removedColumns = useMemo(() => [
    { key: 'serial_no', header: 'Tyre', sortValue: (r) => r.serial_no || '',
      cell: (r) => <span className={`tf-serial ${String(selectedId) === String(r.id) ? 'is-sel' : ''}`}>{r.serial_no || 'N/A'}</span> },
    { key: 'brand', header: 'Brand', cell: (r) => r.brand || <NA why="No brand recorded" /> },
    { key: 'asset_no', header: 'Asset', cell: (r) => r.asset_no || <NA why="No asset recorded" /> },
    { key: 'position', header: 'Position', cell: (r) => r.position || <NA why="No position recorded" /> },
    { key: 'reason', header: 'Removal reason', sortValue: (r) => r.reason || '',
      cell: (r) => r.reason || <span className="cc-na" title="A brand typed into the reason field is not a reason">Not recorded</span> },
    { key: 'lifeKm', header: 'Life km', numeric: true, cell: (r) => (r.lifeKm == null ? <NA why="Needs fitment and removal km" /> : num(r.lifeKm)) },
    { key: 'purchaseCost', header: 'Purchase cost', numeric: true, sortValue: (r) => (money ? r.purchaseCost : null),
      cell: (r) => (money && r.purchaseCost != null ? fmtMoney(r.purchaseCost) : <NA why={money ? 'No price recorded' : moneyWhy} />) },
    { key: 'cpk', header: 'CPK', numeric: true, sortValue: (r) => (money ? r.cpk : null),
      cell: (r) => (money && r.cpk != null ? <span className="tf-num">{r.cpk.toFixed(3)}</span> : <NA why={moneyWhy} />) },
    { key: 'removed_on', header: 'Removed', sortValue: (r) => r.removed_on || '',
      cell: (r) => (r.removed_on ? String(r.removed_on).slice(0, 10) : <NA why="No removal date" />) },
    { key: 'risk', header: 'Risk', sortValue: (r) => r.risk || '',
      cell: (r) => (r.risk ? <span className={`cc-pill ${riskTone(r.risk) || 'muted'}`}>{r.risk}</span> : <NA why="No risk rating recorded" />) },
  ], [money, fmtMoney, moneyWhy, selectedId])

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'failures', label: 'Failures' },
    { key: 'cpk', label: 'CPK' },
    { key: 'life', label: 'Tyre life' },
    { key: 'assets', label: 'Asset ranking', count: loaded ? ranking.length : null },
    { key: 'removed', label: 'Removed register', count: loaded ? removed.length : null },
  ]

  const loadingState = { loading: !loaded && !error, data: loaded ? true : null, error: null }
  const maxCpk = Math.max(0, ...brandCpk.map((b) => b.value))
  const maxBand = Math.max(1, ...life.bands.map((b) => b.count))
  const trendTitle = trends ? `Against ${trends.window.from} to ${trends.window.to}` : undefined

  const cpkDisplay = !loaded ? '...' : (money && k.fleetAvgCpk != null ? `${k.fleetAvgCpk.toFixed(3)} ${activeCurrency}/km` : 'N/A')

  return (
    <div className="cc tf-page">
      <header className="tf-head">
        <div className="tf-head-copy">
          <nav className="tf-crumb" aria-label="Breadcrumb">
            <Link to="/tyre-records">Tyre management</Link>
            <ChevronRight size={13} aria-hidden="true" />
            <span aria-current="page">Failure and CPK</span>
          </nav>
          <h1>Tyre Failure &amp; CPK</h1>
          <p>Analyse removals, failure reasons, tyre life and cost per kilometre across the fleet.</p>
        </div>
        <div className="tf-head-actions">
          <div className="tf-dates" role="group" aria-label="Issued date range">
            <DateField className="text-sm" value={fromDate} onChange={setFromDate} placeholder="Issued from" ariaLabel="Issued from date" />
            <span aria-hidden="true">to</span>
            <DateField className="text-sm" value={toDate} onChange={setToDate} placeholder="Issued to" ariaLabel="Issued to date" min={fromDate || undefined} />
          </div>
          <select className="cc-select tf-head-select" aria-label="Site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
            <option value="">All sites</option>
            {options.sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" className="cc-icon-btn tf-icon" onClick={load} disabled={refreshing} aria-label="Refresh" title={updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Refresh'}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
          <button type="button" className="cc-btn-primary" onClick={exportPdf} disabled={exporting || !hasAny}>
            <Download size={15} aria-hidden="true" /> {exporting ? 'Preparing...' : 'Export PDF'}
          </button>
        </div>
      </header>

      {!money && loaded && (
        <div className="tf-banner" role="status">
          <Info size={16} aria-hidden="true" />
          <p>This view covers every country, and tyre prices are held in each country's own currency (SAR, AED, EGP). CPK and cost read N/A rather than add different currencies together. Pick a country to see money figures.</p>
        </div>
      )}
      {error && (
        <Card><CardState state={{ loading: false, error, retry: load }} /></Card>
      )}
      {actionError && (
        <div className="tf-banner is-bad" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <p>{actionError}</p>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis tf-kpis">
        <Kpi icon={Layers} tone="t-blue" loading={!loaded} value={k.totalCount}
          label={kpiLabel('Total tyres', `${num(k.withPriceCount)} with a price`)} />
        <Kpi icon={CheckCircle2} tone="t-green" loading={!loaded} value={k.activeCount}
          label={kpiLabel('Active', 'In service')} trend={trends?.active} title={trendTitle} />
        <Kpi icon={Wrench} tone="t-red" loading={!loaded} value={k.removedCount} goodWhenUp={false}
          label={kpiLabel('Removed', `Removal rate ${pct(k.failureRatePct)}`)} trend={trends?.removed} title={trendTitle} />
        <Kpi icon={Coins} tone="t-amber" display={cpkDisplay} goodWhenUp={false} trend={money ? trends?.cpk : null}
          label={kpiLabel('Fleet avg CPK', !money ? 'Pick a country' : cpkTarget ? `Target ${cpkTarget} ${activeCurrency}/km` : 'No target set')}
          title={trendTitle || 'Priced tyres with fitment and removal km'} />
        <Kpi icon={Truck} tone="t-purple" display={!loaded ? '...' : (k.avgLifeKm == null ? 'N/A' : `${num(k.avgLifeKm)} km`)}
          trend={trends?.life} title={trendTitle || 'Tyres with fitment and removal km'}
          label={kpiLabel('Avg life', lifeTarget ? `Target ${num(lifeTarget)} km` : 'No target set')} />
      </div>
      {fromDate && !toDate && <p className="tf-hint">Set an end date as well to compare against the previous period.</p>}

      <div className="tf-tabs-row">
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="Board views" variant="line" />
        <button type="button" className="cc-btn-ghost tf-targets" onClick={openTargets} disabled={targets.failed}
          title={targets.failed ? 'KPI targets could not be read' : `Fleet targets for ${year}`}>
          <Target size={14} aria-hidden="true" /> Targets
        </button>
      </div>

      <Card className="tf-filterbar">
        <div className="cc-filters">
          <div className="cc-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" placeholder="Search serial, asset, brand, site, reason" aria-label="Search tyres" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="cc-field"><span>Brand</span>
            <select className="cc-select" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
              <option value="">All brands</option>
              {options.brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="cc-field"><span>Status</span>
            <select className="cc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="removed">Removed</option>
            </select>
          </label>
          {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> Clear</button>}
        </div>
        <p className="tf-scope" aria-live="polite">{num(scoped.length)} of {num((records || []).length)} tyre records match{hasFilters ? ' the current filters' : ''}.</p>
      </Card>

      {loaded && !hasAny && !error ? (
        <Card>
          <div className="cc-empty">
            {(records || []).length === 0 ? 'No tyre records yet for this scope. Records appear here as they are captured.' : 'No tyre records match these filters.'}
            {hasFilters && <><br /><button type="button" className="cc-btn" onClick={clearFilters}>Clear filters</button></>}
          </div>
        </Card>
      ) : (
        <>
          {tab === 'overview' && (
            <>
              <div className="tf-row">
                <Card title="Failure reasons" sub="Removed tyres by recorded reason">
                  <CardState state={loadingState} empty={loaded && !reasons.length ? 'No removals recorded in this scope.' : null}>
                    <Donut segments={reasons} total={k.removedCount} centerLabel="Removed"
                      onSelect={(s) => { if (s.label !== 'Other' && s.label !== 'Unknown') { setSearch(s.label); setTab('removed') } }} />
                  </CardState>
                </Card>
                <Card title="CPK by brand" sub={money ? `Best first, ${activeCurrency} per km` : 'CPK needs one country'}>
                  <CardState state={loadingState} empty={loaded && (!money ? 'CPK is money. Pick a country to compare brands in one currency.' : !brandCpk.length ? 'Not enough priced tyres with km to compute CPK.' : null)}>
                    <div className="tf-vbars" role="img" aria-label={brandCpk.map((b) => `${b.brand} ${b.value}`).join(', ')}>
                      {brandCpk.map((b) => (
                        <button key={b.brand} type="button" className="tf-vbar" onClick={() => setBrandFilter(b.brand)} title={`${b.brand}: ${b.value.toFixed(3)} ${activeCurrency}/km. Filter by this brand`}>
                          <span className="tf-vbar-n">{b.value.toFixed(3)}</span>
                          <i style={{ height: `${maxCpk ? Math.max(4, (b.value / maxCpk) * 100) : 4}%` }} />
                          <small>{b.brand}</small>
                        </button>
                      ))}
                    </div>
                  </CardState>
                </Card>
                <Card title="Tyre life distribution" sub={`${num(life.measured)} of ${num(life.total)} tyres have fitment and removal km`}>
                  <CardState state={loadingState} empty={loaded && !life.measured ? 'No tyre has both fitment and removal km yet.' : null}>
                    <ul className="tf-bands">
                      {life.bands.map((b) => (
                        <li key={b.key}>
                          <span className="tf-band-label">{b.label}</span>
                          <span className="tf-band-track"><i style={{ width: `${b.count ? Math.max(3, (b.count / maxBand) * 100) : 0}%` }} /></span>
                          <b>{num(b.count)}</b>
                        </li>
                      ))}
                    </ul>
                  </CardState>
                </Card>
              </div>

              <Card title="Removed tyres" sub="Newest removals first. Select a tyre for its drill-down."
                action={<button type="button" className="cc-link cc-link-btn" onClick={() => setTab('removed')}>Full register <ChevronRight size={13} aria-hidden="true" /></button>}>
                <KitTable rows={removed} columns={removedColumns} loading={!loaded} getRowId={(r) => String(r.id)} onRowClick={selectRemoved}
                  initialPageSize={10} empty="No removed tyres in this scope." />
              </Card>

              <section ref={drillRef} className="cc-card tf-drill" aria-label="Failure drill-down">
                <div className="tf-drill-copy">
                  <h2>Failure drill-down</h2>
                  {selected ? (
                    <>
                      <p>{drillSummary(selected, { money, currency: activeCurrency })}</p>
                      <dl className="tf-facts">
                        <div><dt>Brand</dt><dd>{selected.brand || 'N/A'}</dd></div>
                        <div><dt>Size</dt><dd>{selected.size || 'N/A'}</dd></div>
                        <div><dt>Site</dt><dd>{selected.site || 'N/A'}</dd></div>
                        <div><dt>Removed</dt><dd>{selected.removed_on ? String(selected.removed_on).slice(0, 10) : 'N/A'}</dd></div>
                        <div><dt>Purchase cost</dt><dd>{money && selected.purchaseCost != null ? fmtMoney(selected.purchaseCost) : 'N/A'}</dd></div>
                        <div><dt>Risk</dt><dd>{selected.risk || 'Not rated'}</dd></div>
                      </dl>
                    </>
                  ) : (
                    <p>Select a removed tyre above to see what took it off the vehicle, how far it ran and what it cost per km.</p>
                  )}
                  <p className="tf-drill-note">Link the root cause to pressure history, axle position, workshop repairs, driver behaviour, heat exposure and any supplier claim before acting on it.</p>
                </div>
                <div className="tf-drill-actions">
                  {selected && <button type="button" className="cc-btn-ghost" onClick={() => setSelectedId(null)}><X size={14} aria-hidden="true" /> Clear</button>}
                  {selected?.serial_no
                    ? <Link className="cc-btn-ghost" to={`/tyre-passport/${encodeURIComponent(selected.serial_no)}`}><BookOpen size={15} aria-hidden="true" /> Open tyre passport</Link>
                    : <button type="button" className="cc-btn-ghost" disabled title="Select a removed tyre with a serial"><BookOpen size={15} aria-hidden="true" /> Open tyre passport</button>}
                  <Link className="cc-btn-primary" to="/warranty"><ShieldCheck size={15} aria-hidden="true" /> Open warranty claims</Link>
                </div>
              </section>
            </>
          )}

          {tab === 'failures' && (
            <div className="tf-row tf-row-2">
              <ChartCard title="Status split" refCb={setRef('status')} label="Active versus removed tyres">
                <Doughnut data={stylize(board.statusSplit, 'doughnut')} options={DOUGHNUT_OPTS} />
              </ChartCard>
              <ChartCard title="Removal reasons" refCb={setRef('reasons')}>
                {hasChartData(board.failureReasons) ? <Doughnut data={stylize(board.failureReasons, 'doughnut')} options={DOUGHNUT_OPTS} /> : <Empty>No removals recorded.</Empty>}
              </ChartCard>
              <div className="tf-span">
                <ChartCard title="Removed tyres by position" refCb={setRef('position')}>
                  {hasChartData(board.byPosition) ? <Bar data={stylize(board.byPosition, 'bar')} options={chartBase(false)} /> : <Empty>No removals recorded.</Empty>}
                </ChartCard>
              </div>
            </div>
          )}

          {tab === 'cpk' && (
            <div className="tf-row tf-row-2">
              <ChartCard title="CPK by brand" sub="Best first" refCb={setRef('cpkBrand')}>
                {!money ? <Empty>CPK is money. Pick a country to compare brands in one currency.</Empty>
                  : hasChartData(board.cpkByBrand) ? <Bar data={stylize(board.cpkByBrand, 'bar')} options={HBAR_OPTS} /> : <Empty>Not enough priced records to compute CPK.</Empty>}
              </ChartCard>
              <ChartCard title="CPK by site" sub="Worst first" refCb={setRef('cpkSite')}>
                {!money ? <Empty>CPK is money. Pick a country to compare sites in one currency.</Empty>
                  : hasChartData(board.cpkBySite) ? <Bar data={stylize(board.cpkBySite, 'bar')} options={HBAR_OPTS} /> : <Empty>Not enough priced records to compute CPK.</Empty>}
              </ChartCard>
            </div>
          )}

          {tab === 'life' && (
            <ChartCard title="Average life by brand" sub="Kilometres between fitment and removal" refCb={setRef('lifeBrand')}>
              {hasChartData(board.lifeByBrand) ? <Bar data={stylize(board.lifeByBrand, 'bar')} options={HBAR_OPTS} /> : <Empty>No fitment and removal km recorded to compute tyre life.</Empty>}
            </ChartCard>
          )}

          {tab === 'assets' && (
            <Card title="Asset CPK ranking" sub="Every asset with a measurable CPK, worst first. Avg CPK comes from tyre records; total cost from the expense grid where it carries the asset."
              action={<button type="button" className="cc-btn-ghost" onClick={() => exportExcel('assets')} disabled={exporting || !ranking.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>}>
              <KitTable rows={ranking} columns={assetColumns} loading={!loaded} getRowId={(a) => String(a.asset_no)}
                empty="Not enough priced records with km to rank assets by CPK." />
            </Card>
          )}

          {tab === 'removed' && (
            <Card title="Removed tyre register" sub="Life and CPK read N/A without both fitment and removal km. A brand typed into the reason field shows as Not recorded."
              action={<button type="button" className="cc-btn-ghost" onClick={() => exportExcel('removed')} disabled={exporting || !removed.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>}>
              <KitTable rows={removed} columns={removedColumns} loading={!loaded} getRowId={(r) => String(r.id)}
                onRowClick={(r) => { setTab('overview'); selectRemoved(r) }} empty="No removed tyres in this scope." />
            </Card>
          )}
        </>
      )}

      <Modal open={targetOpen} onClose={() => { if (!targetSaving) setTargetOpen(false) }} title={`Fleet targets for ${year}`}
        subtitle={money ? `${activeCountry}, used on the CPK and tyre life tiles` : 'Pick a country to set a CPK target; tyre life can be set for every country'} size="sm">
        <form onSubmit={saveTargets} className="tf-target-form">
          <label><span>Fleet CPK target ({money ? `${activeCurrency}/km` : 'needs one country'})</span>
            <input className="input w-full" type="number" min="0" step="0.001" inputMode="decimal" disabled={!money}
              value={targetDraft.cpk} onChange={(e) => setTargetDraft((d) => ({ ...d, cpk: e.target.value }))} placeholder="e.g. 0.120" />
          </label>
          <label><span>Average tyre life target (km)</span>
            <input className="input w-full" type="number" min="0" step="100" inputMode="numeric"
              value={targetDraft.life} onChange={(e) => setTargetDraft((d) => ({ ...d, life: e.target.value }))} placeholder="e.g. 80000" />
          </label>
          {targetError && <p className="tf-form-error" role="alert">{targetError}</p>}
          <div className="tf-form-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => setTargetOpen(false)} disabled={targetSaving}>Cancel</button>
            <button type="submit" className="cc-btn-primary" disabled={targetSaving}>{targetSaving ? 'Saving...' : 'Save targets'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
