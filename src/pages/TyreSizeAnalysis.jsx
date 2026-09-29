/**
 * TyreSizeAnalysis (route /tyre-size) - Size Optimizer, on the Command Center kit.
 *
 * Finds a better tyre size per asset from what the fleet actually runs: sizes
 * used by the same vehicle type in the same country are compared on measured
 * CPK and tyre life (src/lib/sizeOptimizerView.js). The earlier analyses (size
 * mix, CPK by size, size x brand matrix, position compliance, 12-month trend,
 * consolidation) live on the History tab, unchanged in behaviour.
 *
 * Per-tyre CPK uses tyre_records (the per-km measure). The fleet tyre SPEND in
 * the hero reads the classified expense grid (loadGovernedCostSplit) and is
 * never a sum of cost_per_tyre. Money is never added across currencies.
 * Fuel, terrain and downtime have no source and read N/A.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Truck, Lightbulb, Wallet, Fuel, Gauge, RefreshCw, FileText, FileSpreadsheet, Plus,
  Search, AlertTriangle, SlidersHorizontal, X, Eye, Wand2, ExternalLink,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { normalizePosition } from '../lib/tyrePositions'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { loadGovernedCostSplit } from '../lib/api/governedCost'
import { listOptimizerFleet, listOptimizerCatalogue } from '../lib/api/sizeOptimizer'
import { Card, Kpi, KitTable, PageHero, Tabs, VehicleThumb, fmtInt, useCard } from '../components/commandCenter/kit'
import SizeAnalysesTab from '../components/sizeOptimizer/SizeAnalysesTab'
import OptimizePanel from '../components/sizeOptimizer/OptimizePanel'
import ComparisonCards from '../components/sizeOptimizer/ComparisonCards'
import { exportSizePdf, exportSizeExcel } from '../components/sizeOptimizer/sizeExports'
import { fmtKm, fmtMoney, fmtSigned } from '../components/sizeOptimizer/sizeFormat'
import { makeSizeLabeller, filterSizeRecords, filterOptionsFor, datePresetRange } from '../lib/tyreSizeAnalytics'
import {
  assetRecommendations, optimizerKpis, filterRows, rowOptions, byVehicleType, typeSizeStats,
  fleetIndex, recordType, deriveApplication, catalogueFor, loadIndexOf, annualTyreKm, STATUSES,
} from '../lib/sizeOptimizerView'
import './TyreSizeAnalysis.css'

const ROW_CAP = 50000

const DATE_PRESETS = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '6mo', days: 180 },
  { label: '1yr', days: 365 },
  { label: 'All', days: null },
]

const TABS = [
  { key: 'analysis', label: 'Analysis & Recommendations' },
  { key: 'vehicle', label: 'Vehicle Wise Analysis' },
  { key: 'comparison', label: 'Comparison View' },
  { key: 'cost', label: 'Cost Analysis' },
  { key: 'history', label: 'History' },
]

const STATUS_TONE = { Recommended: 'good', 'Under Review': 'warn', 'Current is best': 'info', 'Not enough data': 'muted' }

export default function TyreSizeAnalysis() {
  const { activeCountry, activeCurrency, appSettings } = useSettings()
  const { branding } = useTenant()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [fleetCost, setFleetCost] = useState({ loading: true, tyre: null, blended: false, failed: false })

  // Filters on tyre records
  const [filterCountry, setFilterCountry] = useState('All')
  const [filterSite, setFilterSite] = useState('All')
  const [filterBrand, setFilterBrand] = useState('All')
  const [filterPosition, setFilterPosition] = useState('All')
  const [filterType, setFilterType] = useState('All')
  const [filterApp, setFilterApp] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activeDatePreset, setActiveDatePreset] = useState('All')
  const [moreOpen, setMoreOpen] = useState(false)
  const [search, setSearch] = useState('')

  const [tab, setTab] = useState('analysis')
  const [selection, setSelection] = useState(null)
  const [preselect, setPreselect] = useState(null)
  const [panelReset, setPanelReset] = useState(0)
  const panelRef = useRef(null)

  const latestLoad = useLatestRequest()

  // Tyre records: paged, bounded, country + date scoped server-side.
  useEffect(() => {
    const stale = latestLoad.begin()
    setLoading(true)
    setError(null)
    fetchAllPages((from, to) => {
      let q = supabase
        .from('tyre_records')
        .select('id,asset_no,serial_number:serial_no,size,brand,position,cost_per_tyre,km_at_fitment,km_at_removal,risk_level,site,country,tread_depth,issue_date,vehicle_type')
        .order('id')
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      if (dateFrom) q = q.or(`issue_date.is.null,issue_date.gte.${dateFrom}`)
      if (dateTo) q = q.or(`issue_date.is.null,issue_date.lte.${dateTo}`)
      return q.range(from, to)
    }, { max: ROW_CAP }).then(({ data, error: err, truncated: trunc }) => {
      if (stale()) return
      if (err) { setError(toUserMessage(err, 'Could not load tyre data.')); setLoading(false); return }
      setRecords(data || [])
      setTruncated(!!trunc)
      setLoading(false)
    })
  }, [activeCountry, dateFrom, dateTo, refreshKey, latestLoad])

  // Fleet tyre spend from the expense grid (never a cost_per_tyre sum).
  useEffect(() => {
    let alive = true
    setFleetCost((c) => ({ ...c, loading: true, failed: false }))
    const win = dateFrom && dateTo ? { from: dateFrom, to: dateTo } : {}
    loadGovernedCostSplit({ country: activeCountry, ...win })
      .then((r) => { if (alive) setFleetCost({ loading: false, tyre: r?.tyre ?? null, blended: Boolean(r?.blended), failed: false }) })
      .catch(() => { if (alive) setFleetCost({ loading: false, tyre: null, blended: false, failed: true }) })
    return () => { alive = false }
  }, [activeCountry, dateFrom, dateTo, refreshKey])

  const fleetState = useCard(() => listOptimizerFleet({ country: activeCountry }), [activeCountry, refreshKey])
  const catState = useCard(() => listOptimizerCatalogue({ country: activeCountry }), [activeCountry, refreshKey])
  const fleet = useMemo(() => fleetState.data || [], [fleetState.data])
  const catalogue = useMemo(() => catState.data || [], [catState.data])
  const fIdx = useMemo(() => fleetIndex(fleet), [fleet])

  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])

  const label = useMemo(() => makeSizeLabeller(records), [records])
  const filterOptions = useMemo(() => filterOptionsFor(records), [records])

  // Record filters (brand, position, site, country, dates) scope everything.
  const scoped = useMemo(() => filterSizeRecords(records, {
    country: filterCountry, site: filterSite, brand: filterBrand, position: filterPosition, from: dateFrom, to: dateTo,
  }, normalizePosition), [records, filterCountry, filterSite, filterBrand, filterPosition, dateFrom, dateTo])

  const allRows = useMemo(() => assetRecommendations(scoped, label, fleet), [scoped, label, fleet])
  const options = useMemo(() => rowOptions(allRows), [allRows])
  const rows = useMemo(() => filterRows(allRows, { vehicleType: filterType, application: filterApp, status: filterStatus, search }),
    [allRows, filterType, filterApp, filterStatus, search])
  const okpi = useMemo(() => optimizerKpis(filterRows(allRows, { vehicleType: filterType, application: filterApp })), [allRows, filterType, filterApp])

  // The History tab follows vehicle type and application too.
  const historyRecords = useMemo(() => scoped.filter((r) => {
    if (filterType === 'All' && filterApp === 'All') return true
    const tp = recordType(r, fIdx)
    if (filterType !== 'All' && tp !== filterType) return false
    if (filterApp !== 'All' && deriveApplication(tp) !== filterApp) return false
    return true
  }), [scoped, filterType, filterApp, fIdx])
  const sizeCount = useMemo(() => new Set(historyRecords.map((r) => label(r.size))).size, [historyRecords, label])

  const typeStats = useMemo(() => {
    const s = [...typeSizeStats(historyRecords, label, fIdx).values()]
    const bestByType = new Map()
    for (const x of s) {
      if (x.avgCpk == null) continue
      const k = `${x.type}|${x.country}`
      if (!bestByType.has(k) || x.avgCpk < bestByType.get(k)) bestByType.set(k, x.avgCpk)
    }
    return s.map((x) => ({ ...x, id: `${x.type}|${x.country}|${x.size}`, best: x.avgCpk != null && bestByType.get(`${x.type}|${x.country}`) === x.avgCpk }))
      .sort((a, b) => a.type.localeCompare(b.type) || (a.avgCpk ?? 9e9) - (b.avgCpk ?? 9e9))
  }, [historyRecords, label, fIdx])
  const vehicleRows = useMemo(() => byVehicleType(rows), [rows])

  const hasActiveFilter = filterCountry !== 'All' || filterSite !== 'All' || filterBrand !== 'All' || filterPosition !== 'All'
    || filterType !== 'All' || filterApp !== 'All' || filterStatus !== 'All' || dateFrom !== '' || dateTo !== '' || search !== ''

  function applyDatePreset(presetLabel, days) {
    setActiveDatePreset(presetLabel)
    const r = datePresetRange(days, new Date())
    setDateFrom(r.from); setDateTo(r.to)
  }
  function clearFilters() {
    setFilterCountry('All'); setFilterSite('All'); setFilterBrand('All'); setFilterPosition('All')
    setFilterType('All'); setFilterApp('All'); setFilterStatus('All'); setSearch('')
    setDateFrom(''); setDateTo(''); setActiveDatePreset('All')
  }

  function selectRow(r) {
    setSelection({
      assetNo: r.asset_no, currency: r.currency,
      current: r.currentSize ? { size: r.currentSize, avgCpk: r.currentCpk, avgLife: r.currentLife } : null,
      rec: r.recommendedSize ? { size: r.recommendedSize, avgCpk: r.recommendedCpk, avgLife: r.recommendedLife } : null,
      annualKm: annualTyreKm(scoped, r.asset_no, r.country),
    })
  }
  function onRun(asset, res) {
    if (!res.ok) return
    setSelection({ assetNo: asset.asset_no, currency: res.currency, current: res.current, rec: res.best, annualKm: annualTyreKm(scoped, asset.asset_no, asset.country) })
  }
  function openOptimizer(r) {
    setPreselect(r ? { ...r } : null)
    if (!r) setPanelReset((k) => k + 1)
    panelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  // Exports
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const fileBase = reportFileName('Tyre Size Analysis')
  async function doExport(kind) {
    setExporting(true); setExportError('')
    try {
      const args = { filtered: historyRecords, label, currency: activeCurrency, company, branding, fileBase, recommendations: rows }
      if (kind === 'pdf') await exportSizePdf(args)
      else await exportSizeExcel(args)
    } catch (e) {
      setExportError(toUserMessage(e, kind === 'pdf' ? 'Could not export the PDF. Try again.' : 'Could not export the workbook. Try again.'))
    } finally {
      setExporting(false)
    }
  }

  const fleetSpendValue = fleetCost.loading ? 'Loading' : (fleetCost.blended || fleetCost.failed) ? 'N/A' : fmtMoney(fleetCost.tyre, activeCurrency)
  const fleetSpendSub = fleetCost.blended ? 'Pick one country: currencies differ'
    : fleetCost.failed ? 'Expense grid unavailable'
      : dateFrom && dateTo ? 'Expense grid, selected dates' : 'Expense grid, last 12 months'

  const savingsDisplay = okpi.savingSingle ? fmtMoney(okpi.savingSingle.amount, okpi.savingSingle.currency) : 'N/A'
  const savingsTitle = okpi.savings.length > 1
    ? `Several currencies, never added together: ${okpi.savings.map((s) => fmtMoney(s.amount, s.currency)).join(', ')}. See Cost Analysis.`
    : okpi.savingSingle ? 'Current CPK minus recommended CPK, times the tyre-km recorded on each asset' : 'No recommendation has measured tyre-km to price a saving'

  const recLoadIndex = (r) => loadIndexOf(catalogueFor(catalogue, r.recommendedSize || r.currentSize)[0])

  const columns = [
    { key: 'asset_no', header: 'Vehicle / Asset', sortValue: (r) => r.asset_no, cell: (r) => (
      <span className="cc-vehicle"><VehicleThumb row={r} size="sm" /><span><b>{r.asset_no}</b><span className="cc-sub">{r.vehicle_type || 'Type not recorded'}</span></span></span>
    ) },
    { key: 'currentSize', header: 'Current size', cell: (r) => r.currentSize || <span className="cc-na">N/A</span> },
    { key: 'recommendedSize', header: 'Recommended size', cell: (r) => (r.recommendedSize ? (
      <span><b>{r.recommendedSize}</b><span className="cc-sub">{fmtSigned(r.lifeDeltaPct)} life, {fmtSigned(r.cpkGainPct)} CPK</span></span>
    ) : <span className="cc-na">None</span>) },
    { key: 'application', header: 'Application', cell: (r) => (r.application ? <span title="Derived from the vehicle type">{r.application}</span> : <span className="cc-na">N/A</span>) },
    { key: 'load', header: 'Load index', sortValue: recLoadIndex, cell: (r) => recLoadIndex(r) ?? <span className="cc-na" title="Size not in the tyre catalogue">N/A</span> },
    { key: 'terrain', header: 'Terrain', sortable: false, cell: () => <span className="cc-na" title="No terrain data is recorded">N/A</span> },
    { key: 'life', header: 'Expected life', numeric: true, sortValue: (r) => r.recommendedLife ?? r.currentLife ?? -1, cell: (r) => {
      const v = r.recommendedLife ?? r.currentLife
      return v == null ? <span className="cc-na">N/A</span> : <span>{fmtKm(v)}{r.lifeDeltaPct != null && <span className="cc-sub">{fmtSigned(r.lifeDeltaPct)}</span>}</span>
    } },
    { key: 'saving', header: 'Est. savings', numeric: true, sortValue: (r) => r.saving ?? -1, cell: (r) => (r.saving != null && r.currency ? fmtMoney(r.saving, r.currency) : <span className="cc-na">N/A</span>) },
    { key: 'status', header: 'Status', cell: (r) => <span className={`cc-pill ${STATUS_TONE[r.status]}`}>{r.status}</span> },
    { key: 'actions', header: 'Actions', sortable: false, cell: (r) => (
      <span className="tsz-actions" onClick={(e) => e.stopPropagation()} role="presentation">
        <button type="button" className="cc-icon-btn" aria-label={`Compare sizes for ${r.asset_no}`} title="Compare" onClick={() => selectRow(r)}><Eye size={14} /></button>
        <button type="button" className="cc-icon-btn" aria-label={`Optimize ${r.asset_no}`} title="Open in optimizer" onClick={() => openOptimizer(r)}><Wand2 size={14} /></button>
        <Link className="cc-icon-btn" to={`/assets/${encodeURIComponent(r.asset_no)}`} aria-label={`Open asset ${r.asset_no}`} title="Open asset"><ExternalLink size={14} /></Link>
      </span>
    ) },
  ]

  const vehicleCols = [
    { key: 'vehicle_type', header: 'Vehicle type' },
    { key: 'country', header: 'Country', cell: (r) => r.country || <span className="cc-na">N/A</span> },
    { key: 'assets', header: 'Assets', numeric: true, cell: (r) => fmtInt(r.assets) },
    { key: 'recommended', header: 'Recommendations', numeric: true, cell: (r) => fmtInt(r.recommended) },
    { key: 'sizes', header: 'Sizes in use', sortValue: (r) => r.sizes.length, cell: (r) => r.sizes.join(', ') || <span className="cc-na">N/A</span> },
    { key: 'saving', header: 'Est. savings', numeric: true, sortValue: (r) => r.saving ?? -1, cell: (r) => (r.saving != null && r.currency ? fmtMoney(r.saving, r.currency) : <span className="cc-na">N/A</span>) },
  ]
  const cmpCols = [
    { key: 'type', header: 'Vehicle type' },
    { key: 'country', header: 'Country', cell: (r) => r.country || <span className="cc-na">N/A</span> },
    { key: 'size', header: 'Size', cell: (r) => <span><b>{r.size}</b>{r.best && <span className="cc-pill good tsz-inline">Lowest CPK</span>}</span> },
    { key: 'count', header: 'Tyres', numeric: true, cell: (r) => fmtInt(r.count) },
    { key: 'assets', header: 'Assets', numeric: true, cell: (r) => fmtInt(r.assets) },
    { key: 'avgCpk', header: 'Avg CPK', numeric: true, sortValue: (r) => r.avgCpk ?? 9e9, cell: (r) => (r.avgCpk == null ? <span className="cc-na" title={`${r.cpkSample} measured tyres, needs more`}>N/A</span> : `${r.avgCpk.toFixed(4)}/km`) },
    { key: 'avgLife', header: 'Avg life', numeric: true, sortValue: (r) => r.avgLife ?? -1, cell: (r) => fmtKm(r.avgLife) },
  ]
  const costRows = rows.filter((r) => r.saving != null)
  const costCols = [
    { key: 'asset_no', header: 'Asset' },
    { key: 'vehicle_type', header: 'Vehicle type', cell: (r) => r.vehicle_type || <span className="cc-na">N/A</span> },
    { key: 'change', header: 'Size change', sortable: false, cell: (r) => `${r.currentSize} to ${r.recommendedSize}` },
    { key: 'tyreKm', header: 'Recorded tyre km', numeric: true, cell: (r) => fmtKm(r.tyreKm) },
    { key: 'currentCpk', header: 'Current CPK', numeric: true, cell: (r) => r.currentCpk.toFixed(4) },
    { key: 'recommendedCpk', header: 'Recommended CPK', numeric: true, cell: (r) => r.recommendedCpk.toFixed(4) },
    { key: 'saving', header: 'Est. saving', numeric: true, cell: (r) => fmtMoney(r.saving, r.currency) },
  ]

  return (
    <div className="cc tsz-page">
      <div className="tsz-hero">
        <PageHero
          hello="Tyre Management › Specifications › Size Optimizer"
          title="Size Optimizer"
          lead="Find the best tyre size for your vehicles based on load, application, terrain, and cost performance."
          imgLight="/dashboard/hero-tyres-light.webp"
          imgDark="/dashboard/hero-tyres-dark.webp"
          stat={{ value: fleetSpendValue, lines: ['Fleet tyre spend', fleetSpendSub] }}
        />
        <div className="tsz-hero-actions">
          <button type="button" className="cc-btn-ghost" onClick={reload} aria-label="Refresh tyre size data"><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
          <button type="button" className="cc-btn-ghost" onClick={() => doExport('pdf')} disabled={exporting || loading || !!error}><FileText size={14} aria-hidden="true" /> PDF</button>
          <button type="button" className="cc-btn-ghost" onClick={() => doExport('xlsx')} disabled={exporting || loading || !!error}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
          <button type="button" className="cc-btn-primary" onClick={() => openOptimizer(null)}><Plus size={14} aria-hidden="true" /> New Optimization</button>
        </div>
      </div>

      {truncated && <div className="cc-card tsz-banner" role="status"><AlertTriangle size={16} aria-hidden="true" /><div>Showing the first {ROW_CAP.toLocaleString()} tyre records in this date window. Narrow the date range or country to see the full detail.</div></div>}
      {exportError && <div className="cc-card tsz-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" /><div>{exportError}</div></div>}
      {fleetState.error && <div className="cc-card tsz-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" /><div>The fleet register could not be read, so vehicle types come only from tyre records. {fleetState.error}</div><button type="button" className="cc-btn" onClick={fleetState.retry}>Try again</button></div>}
      {error && <div className="cc-card tsz-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" /><div>Could not load tyre data. {error}</div><button type="button" className="cc-btn" onClick={reload}>Retry</button></div>}

      <div className="cc-kpis tsz-kpis">
        <Kpi icon={Truck} tone="t-green" value={okpi.vehiclesAnalysed} display={error ? 'N/A' : undefined} label="Vehicles Analysed" loading={loading} title="Assets with tyre history in scope" />
        <Kpi icon={Lightbulb} tone="t-blue" value={okpi.recommendations} display={error ? 'N/A' : undefined} label="Size Recommendations" loading={loading} onClick={() => { setTab('analysis'); setFilterStatus('Recommended') }} title={`${okpi.underReview} more under review: the current size has too few measured tyres`} />
        <Kpi icon={Wallet} tone="t-amber" display={savingsDisplay} label={`Cost Optimization${okpi.savingSingle ? ` (${okpi.savingSingle.currency})` : ''}`} loading={loading} onClick={() => setTab('cost')} title={savingsTitle} />
        <Kpi icon={Fuel} tone="t-purple" display="N/A" label="Fuel Efficiency Gain" title="No fuel source is linked to tyre sizes" />
        <Kpi icon={Gauge} tone="t-green" display={fmtSigned(okpi.lifeImprovementPct)} label="Tyre Life Improvement" loading={loading} title={okpi.lifeSample ? `Average over ${okpi.lifeSample} recommendations with measured life on both sizes` : 'No recommendation has measured life on both sizes'} />
      </div>

      <Card className="tsz-filters">
        <div className="cc-filters">
          <label className="cc-field"><span>Site</span>
            <select className="cc-select" value={filterSite} onChange={(e) => setFilterSite(e.target.value)}>{filterOptions.sites.map((o) => <option key={o} value={o}>{o === 'All' ? 'All sites' : o}</option>)}</select>
          </label>
          <label className="cc-field"><span>Vehicle type</span>
            <select className="cc-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>{options.vehicleTypes.map((o) => <option key={o} value={o}>{o === 'All' ? 'All vehicle types' : o}</option>)}</select>
          </label>
          <label className="cc-field"><span>Application (derived)</span>
            <select className="cc-select" value={filterApp} onChange={(e) => setFilterApp(e.target.value)}>{options.applications.map((o) => <option key={o} value={o}>{o === 'All' ? 'All applications' : o}</option>)}</select>
          </label>
          <label className="cc-field"><span>Brand</span>
            <select className="cc-select" value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}>{filterOptions.brands.map((o) => <option key={o} value={o}>{o === 'All' ? 'All brands' : o}</option>)}</select>
          </label>
          <label className="cc-field"><span>Status</span>
            <select className="cc-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>{['All', ...STATUSES].map((o) => <option key={o} value={o}>{o === 'All' ? 'All statuses' : o}</option>)}</select>
          </label>
          <div className="cc-field"><span>Date range</span>
            <div className="tsz-presets" role="group" aria-label="Date range presets">
              {DATE_PRESETS.map((p) => <button key={p.label} type="button" className="tsz-chip" aria-pressed={activeDatePreset === p.label} onClick={() => applyDatePreset(p.label, p.days)}>{p.label}</button>)}
            </div>
          </div>
          <button type="button" className="cc-btn-ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}><SlidersHorizontal size={14} aria-hidden="true" /> More Filters</button>
          {hasActiveFilter && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> Clear</button>}
        </div>
        {moreOpen && (
          <div className="cc-filters tsz-more">
            <label className="cc-field"><span>From</span><input type="date" className="tsz-input" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setActiveDatePreset('') }} /></label>
            <label className="cc-field"><span>To</span><input type="date" className="tsz-input" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setActiveDatePreset('') }} /></label>
            <label className="cc-field"><span>Country</span>
              <select className="cc-select" value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)}>{filterOptions.countries.map((o) => <option key={o} value={o}>{o === 'All' ? 'All countries' : o}</option>)}</select>
            </label>
            <label className="cc-field"><span>Position</span>
              <select className="cc-select" value={filterPosition} onChange={(e) => setFilterPosition(e.target.value)}>{filterOptions.positions.map((o) => <option key={o} value={o}>{o === 'All' ? 'All positions' : o}</option>)}</select>
            </label>
            <p className="tsz-hint">Terrain is not recorded on vehicles or tyres, so it cannot be filtered. Application is derived from the vehicle type.</p>
          </div>
        )}
        <p className="tsz-count" aria-live="polite">{historyRecords.length.toLocaleString()} tyres, {sizeCount} sizes, {fmtInt(rows.length)} vehicles</p>
      </Card>

      <div className="tsz-layout">
        <div className="tsz-main">
          <Card className="tsz-tabbar"><Tabs tabs={TABS} value={tab} onChange={setTab} label="Size optimizer views" /></Card>

          {tab === 'analysis' && (
            <Card title="Analysis & Recommendations" sub={`Sizes compared inside the same vehicle type and country. A size needs enough measured tyres before its CPK counts, and must beat the current size by 5% to be recommended.`}
              action={(
                <div className="tsz-tools">
                  <div className="cc-search"><Search size={15} aria-hidden="true" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset, type or size" aria-label="Search recommendations" /></div>
                  <button type="button" className="cc-btn-ghost" onClick={() => doExport('xlsx')} disabled={exporting || loading || !!error}><FileSpreadsheet size={14} aria-hidden="true" /> Export</button>
                </div>
              )}>
              <div className="tsz-scroll">
                <KitTable columns={columns} rows={rows} loading={loading} error={error} onRetry={reload} enableColumnVisibility
                  getRowId={(r) => r.id} onRowClick={selectRow} empty={allRows.length ? 'No vehicles match these filters' : 'No tyre history in scope yet'} />
              </div>
            </Card>
          )}
          {tab === 'vehicle' && (
            <Card title="Vehicle Wise Analysis" sub="Per vehicle type and country. Savings stay in each country's currency.">
              <div className="tsz-scroll"><KitTable columns={vehicleCols} rows={vehicleRows} loading={loading} getRowId={(r) => r.id} empty="No vehicles in scope" /></div>
            </Card>
          )}
          {tab === 'comparison' && (
            <Card title="Comparison View" sub="Every size each vehicle type runs, with measured CPK and life. CPK is only compared within one country.">
              <div className="tsz-scroll"><KitTable columns={cmpCols} rows={typeStats} loading={loading} getRowId={(r) => r.id} empty="No vehicle type is recorded for the tyres in scope" /></div>
            </Card>
          )}
          {tab === 'cost' && (
            <Card title="Cost Analysis" sub="Saving = (current CPK minus recommended CPK) x tyre-km recorded on the asset at its current size.">
              <div className="tsz-money">
                {okpi.savings.length === 0
                  ? <span className="cc-na">No priced saving yet: no recommendation has measured tyre-km.</span>
                  : okpi.savings.map((s) => <div key={s.currency} className="tsz-money-tile"><b>{fmtMoney(s.amount, s.currency)}</b><span>Estimated saving in {s.currency}</span></div>)}
              </div>
              <div className="tsz-scroll"><KitTable columns={costCols} rows={costRows} loading={loading} getRowId={(r) => r.id} onRowClick={selectRow} empty="No priced savings in scope" /></div>
            </Card>
          )}
          {tab === 'history' && (
            error ? <Card><div className="cc-empty" role="alert"><div>Could not load tyre data.<br /><button type="button" className="cc-btn" onClick={reload}>Retry</button></div></div></Card>
              : loading ? <Card><div className="cc-skel" style={{ height: 240 }} /></Card>
                : <SizeAnalysesTab filtered={historyRecords} label={label} currency={activeCurrency} recordsCount={records.length} hasActiveFilter={hasActiveFilter} onClearFilters={clearFilters} />
          )}
        </div>
        <div className="tsz-side" ref={panelRef}>
          <OptimizePanel rows={allRows} records={scoped} label={label} fleet={fleet} catalogue={catalogue} preselect={preselect} resetKey={panelReset} onResult={onRun} />
        </div>
      </div>

      <ComparisonCards selection={selection} catalogue={catalogue} catalogueError={Boolean(catState.error)} />
    </div>
  )
}
