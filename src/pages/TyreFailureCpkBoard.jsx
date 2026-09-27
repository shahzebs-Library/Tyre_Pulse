/**
 * TyreFailureCpkBoard - a customisable "Tyre Failure and CPK" board over the
 * tyre_records lifecycle data: active vs removed, removal reasons, CPK by brand
 * and site, tyre life, the per-asset CPK ranking and the removed-tyre register.
 *
 * Section toggles are persisted. Chart figures come from the pure board engine
 * `src/lib/tyreFailureBoard.js` (which reuses kpiEngine); the filters, currency
 * guard, asset ranking and removed register come from
 * `src/lib/tyreFailureCpkBoardAnalytics.js`. CPK and cost are money: on the
 * All-countries scope they read N/A instead of adding SAR, AED and EGP.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  AlertTriangle, Gauge, PieChart, TrendingUp, Download, RefreshCw, Eye, EyeOff,
  Table, FileSpreadsheet, Search, X, RotateCcw, Truck, Wrench, Coins, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import DateField from '../components/ui/DateField'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { listAllRecords } from '../lib/api/tyreRecords'
import { loadGridTyreByAsset } from '../lib/api/costSummary'
import useLatestRequest from '../lib/useLatestRequest'
import { buildTyreFailureBoard } from '../lib/tyreFailureBoard'
import {
  filterBoardRecords, moneyComparable, assetRanking, removedRegister, filterOptions,
  assetExportRows, removedExportRows, ASSET_EXPORT_COLS, ASSET_EXPORT_HEADERS,
  REMOVED_EXPORT_COLS, REMOVED_EXPORT_HEADERS,
} from '../lib/tyreFailureCpkBoardAnalytics'
import { stylize } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')
const FIELD = 'input w-full min-h-[44px]'
const LS_KEY = 'tyreFailureBoard.sections.v1'
const SECTIONS = [
  ['kpis', 'KPIs', Gauge],
  ['failure', 'Failures', AlertTriangle],
  ['cpk', 'CPK', TrendingUp],
  ['life', 'Tyre life', PieChart],
  ['assets', 'Asset ranking', Table],
  ['removed', 'Removed register', Wrench],
]
const SECTION_DEFAULTS = { kpis: true, failure: true, cpk: true, life: true, assets: true, removed: true }

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString('en-US'))
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : `${Number(v)}%`)

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

function ChartCard({ title, children, refCb, label }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
      <div style={{ height: 240 }} ref={refCb} role="img" aria-label={label || title}>{children}</div>
    </div>
  )
}
const Empty = ({ children }) => <div className="h-full flex items-center justify-center text-center text-sm text-[var(--text-muted)] px-4">{children}</div>
const hasChartData = (cd) => !!(cd && Array.isArray(cd.labels) && cd.labels.length)

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

  const [sections, setSections] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
      return { ...SECTION_DEFAULTS, ...(raw || {}) }
    } catch { return { ...SECTION_DEFAULTS } }
  })
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(sections)) } catch { /* ignore */ } }, [sections])
  const toggle = (key) => setSections((s) => ({ ...s, [key]: !s[key] }))

  const chartRefs = useRef({})
  const setRef = (key) => (el) => { chartRefs.current[key] = el }

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

  useEffect(() => { load() }, [load])

  const loaded = Array.isArray(records)
  const money = moneyComparable(activeCountry)
  const options = useMemo(() => filterOptions(records || []), [records])
  const scoped = useMemo(() => filterBoardRecords(records || [], {
    from: fromDate, to: toDate, site: siteFilter, brand: brandFilter, status: statusFilter, search,
  }), [records, fromDate, toDate, siteFilter, brandFilter, statusFilter, search])
  const board = useMemo(() => buildTyreFailureBoard(scoped), [scoped])
  const ranking = useMemo(() => assetRanking(scoped, grid), [scoped, grid])
  const removed = useMemo(() => removedRegister(scoped), [scoped])
  const k = board.kpis
  const hasAny = !!(k && k.totalCount)

  const fmtMoney = useCallback((v, d = 0) => (!money || v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrency(Number(v), activeCurrency, d)), [money, activeCurrency])

  const clearFilters = () => { setFromDate(''); setToDate(''); setSiteFilter(''); setBrandFilter(''); setStatusFilter(''); setSearch('') }
  const hasFilters = !!(fromDate || toDate || siteFilter || brandFilter || statusFilter || search)

  // ── PDF: KPI tiles + captured charts ─────────────────────────────────────
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
      ['Fleet avg CPK', fmtMoney(k.fleetAvgCpk, 3)], ['Avg life km', num(k.avgLifeKm)], ['Failure rate', pct(k.failureRatePct)],
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

  const assetColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (a) => a.asset_no || 'N/A', size: 140,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'cpk', header: 'Avg CPK', accessorFn: (a) => (money ? a.avgCpk : null), size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtMoney(row.original.avgCpk, 3)}</span> },
    { id: 'cost', header: 'Total cost', accessorFn: (a) => (money ? a.totalCost : null), size: 140, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtMoney(row.original.totalCost)}</span> },
    { id: 'source', header: 'Cost source', accessorFn: (a) => a.costSource, size: 130 },
    { id: 'count', header: 'Tyres', accessorFn: (a) => a.count, size: 80, meta: { align: 'right' } },
  ], [money, fmtMoney])

  const removedColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial_no || 'N/A', size: 140,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{row.original.serial_no || 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 100 },
    { id: 'brand', header: 'Brand', accessorFn: (r) => r.brand || 'N/A', size: 110 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 110 },
    { id: 'position', header: 'Position', accessorFn: (r) => r.position || 'N/A', size: 90 },
    { id: 'reason', header: 'Removal reason', accessorFn: (r) => r.reason || 'Not recorded', size: 170 },
    { id: 'removed', header: 'Removed on', accessorFn: (r) => r.removed_on || '', size: 110, cell: ({ row }) => row.original.removed_on ? String(row.original.removed_on).slice(0, 10) : 'N/A' },
    { id: 'life', header: 'Life (km)', accessorFn: (r) => r.lifeKm, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{num(row.original.lifeKm)}</span> },
    { id: 'cpk', header: 'CPK', accessorFn: (r) => (money ? r.cpk : null), size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtMoney(row.original.cpk, 3)}</span> },
  ], [money, fmtMoney])

  const tiles = [
    { label: 'Total tyres', value: num(k.totalCount), icon: Gauge, sub: `${num(k.withPriceCount)} with a price` },
    { label: 'Active', value: num(k.activeCount), icon: TrendingUp, tone: 'accent' },
    { label: 'Removed', value: num(k.removedCount), icon: Wrench, tone: 'crit' },
    { label: 'Fleet avg CPK', value: fmtMoney(k.fleetAvgCpk, 3), icon: Coins, tone: 'info', sub: money ? 'Priced tyres with km' : 'Pick a country' },
    { label: 'Avg life km', value: num(k.avgLifeKm), icon: Truck, tone: 'warn' },
    { label: 'Removal rate', value: pct(k.failureRatePct), icon: AlertTriangle, tone: 'crit', sub: 'Removed over all tyres' },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tyre Failure & CPK"
        subtitle="Removals, failure reasons and cost per km across the tyre fleet"
        icon={AlertTriangle}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => exportExcel('assets')} disabled={exporting || !ranking.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"><FileSpreadsheet size={14} /> Asset CPK</button>
            <button type="button" onClick={() => exportExcel('removed')} disabled={exporting || !removed.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"><FileSpreadsheet size={14} /> Removed tyres</button>
            <button type="button" onClick={exportPdf} disabled={exporting || !hasAny} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"><Download size={14} /> {exporting ? 'Preparing...' : 'Export PDF'}</button>
          </div>
        }
      />

      {/* Section toggles */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show or hide sections">
        {SECTIONS.map(([key, label, Icon]) => (
          <button type="button" key={key} onClick={() => toggle(key)} aria-pressed={!!sections[key]}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 min-h-[44px] rounded-lg border transition-colors ${sections[key] ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}>
            <Icon size={13} aria-hidden="true" /> {label} {sections[key] ? <Eye size={12} aria-hidden="true" /> : <EyeOff size={12} aria-hidden="true" />}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 items-end">
          <div className="sm:col-span-2">
            <label htmlFor="cpk-search" className="label">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="cpk-search" className={`${FIELD} pl-9`} placeholder="Serial, asset, brand, site, reason" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="cpk-site" className="label">Site</label>
            <select id="cpk-site" className={FIELD} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">All sites</option>
              {options.sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cpk-brand" className="label">Brand</label>
            <select id="cpk-brand" className={FIELD} value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
              <option value="">All brands</option>
              {options.brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cpk-status" className="label">Status</label>
            <select id="cpk-status" className={FIELD} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="removed">Removed</option>
            </select>
          </div>
          <div>
            <span className="label">Issued from</span>
            <DateField className="text-sm w-full min-h-[44px]" value={fromDate} onChange={setFromDate} placeholder="From date" ariaLabel="Issued from date" />
          </div>
          <div>
            <span className="label">Issued to</span>
            <DateField className="text-sm w-full min-h-[44px]" value={toDate} onChange={setToDate} placeholder="To date" ariaLabel="Issued to date" min={fromDate || undefined} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear filters</button>}
          <button type="button" onClick={load} disabled={refreshing} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh</button>
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{num(scoped.length)} of {num((records || []).length)} tyre records</span>
        </div>
      </div>

      {!money && loaded && (
        <div className="card border border-amber-800/40 flex items-start gap-3" role="status">
          <Info size={16} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)]">This view covers every country, and tyre prices are held in each country's own currency (SAR, AED, EGP). CPK and cost read N/A rather than add different currencies together. Pick a country to see money figures.</p>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-300 font-medium">Could not load the board.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={refreshing}><RotateCcw size={14} /> Retry</button>
        </div>
      )}
      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      {!loaded ? (
        error ? null : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" aria-busy="true" aria-label="Loading the board">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="card h-24 animate-pulse" />)}
          </div>
        )
      ) : !hasAny ? (
        <div className="card text-center text-[var(--text-muted)] py-10">
          {(records || []).length === 0 ? 'No tyre records yet for the selected scope. Records will appear here as they are captured.' : 'No tyre records match these filters.'}
        </div>
      ) : (
        <>
          {sections.kpis && (
            <section className="space-y-2" aria-label="Key figures">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {tiles.map((t, i) => <StatTile key={t.label} index={i} label={t.label} value={t.value} icon={t.icon} tone={t.tone} sub={t.sub} />)}
              </div>
              <p className="text-xs text-[var(--text-muted)]">These figures cover the {num(scoped.length)} tyre records matching the current filters.</p>
            </section>
          )}

          {sections.failure && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><AlertTriangle size={15} aria-hidden="true" /> Failures and removals</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Status split" refCb={setRef('status')} label="Active versus removed tyres">
                  <Doughnut data={stylize(board.statusSplit, 'doughnut')} options={DOUGHNUT_OPTS} />
                </ChartCard>
                <ChartCard title="Removal reasons" refCb={setRef('reasons')}>
                  {hasChartData(board.failureReasons) ? <Doughnut data={stylize(board.failureReasons, 'doughnut')} options={DOUGHNUT_OPTS} /> : <Empty>No removals recorded.</Empty>}
                </ChartCard>
                <div className="lg:col-span-2">
                  <ChartCard title="Removed tyres by position" refCb={setRef('position')}>
                    {hasChartData(board.byPosition) ? <Bar data={stylize(board.byPosition, 'bar')} options={chartBase(false)} /> : <Empty>No removals recorded.</Empty>}
                  </ChartCard>
                </div>
              </div>
            </section>
          )}

          {sections.cpk && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><TrendingUp size={15} aria-hidden="true" /> Cost per km</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="CPK by brand (best first)" refCb={setRef('cpkBrand')}>
                  {!money ? <Empty>CPK is money. Pick a country to compare brands in one currency.</Empty>
                    : hasChartData(board.cpkByBrand) ? <Bar data={stylize(board.cpkByBrand, 'bar')} options={HBAR_OPTS} /> : <Empty>Not enough priced records to compute CPK.</Empty>}
                </ChartCard>
                <ChartCard title="CPK by site (worst first)" refCb={setRef('cpkSite')}>
                  {!money ? <Empty>CPK is money. Pick a country to compare sites in one currency.</Empty>
                    : hasChartData(board.cpkBySite) ? <Bar data={stylize(board.cpkBySite, 'bar')} options={HBAR_OPTS} /> : <Empty>Not enough priced records to compute CPK.</Empty>}
                </ChartCard>
              </div>
            </section>
          )}

          {sections.life && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><PieChart size={15} aria-hidden="true" /> Tyre life</h2>
              <ChartCard title="Average life (km) by brand" refCb={setRef('lifeBrand')}>
                {hasChartData(board.lifeByBrand) ? <Bar data={stylize(board.lifeByBrand, 'bar')} options={HBAR_OPTS} /> : <Empty>No fitment and removal km recorded to compute tyre life.</Empty>}
              </ChartCard>
            </section>
          )}

          {sections.assets && (
            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Table size={15} aria-hidden="true" /> Asset CPK ranking</h2>
              <p className="text-xs text-[var(--text-muted)]">Every asset with a measurable CPK, worst first. Avg CPK comes from tyre records; total cost comes from the expense grid where it carries the asset.</p>
              <EnterpriseTable
                columns={assetColumns}
                data={ranking}
                getRowId={(a) => String(a.asset_no)}
                emptyMessage="Not enough priced records with km to rank assets by CPK."
                enableColumnFilters={false}
                enableExport={false}
                searchPlaceholder="Search assets"
                viewKey="tyre-failure-cpk-assets"
              />
            </section>
          )}

          {sections.removed && (
            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Wrench size={15} aria-hidden="true" /> Removed tyre register</h2>
              <p className="text-xs text-[var(--text-muted)]">Life and CPK read N/A for a tyre without both fitment and removal km. A brand typed into the reason field is shown as Not recorded.</p>
              <EnterpriseTable
                columns={removedColumns}
                data={removed}
                getRowId={(r, i) => String(r.id ?? i)}
                emptyMessage="No removed tyres in this scope."
                enableColumnFilters={false}
                enableExport={false}
                searchPlaceholder="Search removed tyres"
                viewKey="tyre-failure-cpk-removed"
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}
