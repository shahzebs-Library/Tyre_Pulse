/**
 * FleetUtilization (route /fleet-utilization) - Fleet Utilization & Telematics.
 *
 * Built on the shared page kit (src/components/commandCenter/kit.jsx) to the
 * owner's light mockup: hero, five KPIs, tabs (overview, site comparison, asset
 * utilization, idle analysis, reports), a filter bar, the utilization trend,
 * site-wise utilization and the asset utilization details register.
 *
 * Data is the telematics snapshot in `asset_utilization` (V406), one row per
 * asset per capture date. It is NOT a daily series, so hours are totals over
 * the loaded captures and the trend only draws columns for real capture dates.
 * Real data only; an unmeasured figure reads N/A. Maths live in the pure engines
 * src/lib/fleetUtilization.js, src/lib/fleetUtilizationAnalytics.js and
 * src/lib/fleetUtilizationView.js; src/lib/api/assetUtilization.js is the only
 * telematics Supabase seam.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Truck, Gauge, Timer, Hourglass, Milestone, Search, X, FileSpreadsheet, FileText,
  RefreshCw, AlertTriangle, ChevronUp, ChevronDown, ChevronsUpDown, Link2,
} from 'lucide-react'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import {
  Card, CardState, Kpi, PageHero, Tabs, Donut, MeterCell, KitTable, VehicleThumb, fmtInt,
} from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import { listAssetUtilization } from '../lib/api/assetUtilization'
import { listAssetOptions } from '../lib/api/assetHistory'
import { filterUtilization, bandDistribution, byCountry, bandOf, idlePct, secondsToHours, num } from '../lib/fleetUtilization'
import {
  attachRegister, siteComparison, telematicsCoverage, filterByRegister, idleRanking, NO_SITE, NO_TYPE,
  UTILIZATION_SORT_ACCESSORS, UTILIZATION_EXPORT_COLS, UTILIZATION_EXPORT_HEADERS, utilizationExportRows,
  COVERAGE_GAP_COLS, COVERAGE_GAP_HEADERS, coverageGapExportRows, readingCoverage,
} from '../lib/fleetUtilizationAnalytics'
import {
  ACTIVITY, ACTIVITY_KEYS, PERIODS, activityOf, filterByPeriod, filterByActivity, utilizationKpis,
  activityByCapture, activitySplit, siteBars, totalHours, optionsOf,
} from '../lib/fleetUtilizationView'
import { nextSort, sortRows } from '../lib/consoleTable'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import './FleetUtilization.css'

const fmtHrs = (v) => (num(v) == null ? 'N/A' : `${Number(v).toLocaleString('en-US')} h`)
const fmtKm = (v) => (num(v) == null ? 'N/A' : `${Math.round(Number(v)).toLocaleString('en-US')} km`)
const fmtP = (v) => (num(v) == null ? 'N/A' : `${Math.round(Number(v) * 10) / 10}%`)
const fmtDate = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
const NA = <span className="cc-na">N/A</span>

const TABS = [
  { key: 'overview', label: 'Utilization Overview' },
  { key: 'sites', label: 'Site Comparison' },
  { key: 'assets', label: 'Asset Utilization' },
  { key: 'idle', label: 'Idle Analysis' },
  { key: 'reports', label: 'Reports' },
]

const BAND_COLOR = { High: 'var(--cc-green)', Medium: 'var(--cc-amber)', Low: 'var(--cc-red)', Unknown: 'var(--cc-ink-3)' }

const SORT_ACCESSORS = {
  ...UTILIZATION_SORT_ACCESSORS,
  make: (r) => ([r.make, r.model].filter(Boolean).join(' ') || null),
  total: (r) => totalHours(r),
  site: (r) => r.site || null,
  status: (r) => ACTIVITY_KEYS.indexOf(activityOf(r)),
}

function SortHead({ label, k, sort, onSort, first = 'desc' }) {
  const active = sort.key === k
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <button type="button" className="fu-sort" onClick={() => onSort(k, first)}
      aria-label={`Sort by ${label}${active ? `, currently ${sort.dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}>
      {label} <Icon size={12} aria-hidden="true" />
    </button>
  )
}

/** Stacked columns of asset counts per real capture date. */
function ActivityColumns({ points }) {
  const shown = points.slice(-30)
  const max = Math.max(1, ...shown.map((p) => p.total))
  const W = 560; const H = 170; const pad = 26
  const bw = Math.max(6, Math.min(34, (W - pad) / shown.length - 6))
  const step = (W - pad) / shown.length
  const label = shown.map((p) => `${p.date}: ${ACTIVITY_KEYS.map((k) => `${ACTIVITY[k].label} ${p[k]}`).join(', ')}`).join('; ')
  return (
    <div className="cc-chart fu-cols">
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={`Assets by activity per capture date. ${label}`} preserveAspectRatio="none">
        <line x1={pad} y1={H} x2={W} y2={H} stroke="var(--cc-inner-border)" />
        <text x={pad - 4} y={10} textAnchor="end" className="cc-axis">{max}</text>
        <text x={pad - 4} y={H} textAnchor="end" className="cc-axis">0</text>
        {shown.map((p, i) => {
          let y = H
          const x = pad + i * step + (step - bw) / 2
          return (
            <g key={p.date}>
              {ACTIVITY_KEYS.map((k) => {
                const h = (p[k] / max) * (H - 12)
                y -= h
                return h > 0 ? <rect key={k} x={x} y={y} width={bw} height={h} fill={ACTIVITY[k].color} rx="2"><title>{`${p.date} ${ACTIVITY[k].label}: ${p[k]}`}</title></rect> : null
              })}
              {(shown.length <= 12 || i % Math.ceil(shown.length / 10) === 0) && (
                <text x={x + bw / 2} y={H + 15} textAnchor="middle" className="cc-axis">{p.date.slice(5)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function ActivityLegend({ split }) {
  return (
    <div className="fu-legend">
      {split.map((s) => <span key={s.key}><i style={{ background: s.color }} aria-hidden="true" />{s.label} <b>{fmtInt(s.count)}</b></span>)}
    </div>
  )
}

function SplitBar({ split }) {
  const total = split.reduce((a, s) => a + s.count, 0)
  if (!total) return null
  return (
    <div className="fu-split" role="img" aria-label={split.map((s) => `${s.label} ${s.count}`).join(', ')}>
      {split.filter((s) => s.count > 0).map((s) => <span key={s.key} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.count}`} />)}
    </div>
  )
}

export default function FleetUtilization() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fleet, setFleet] = useState([])
  const [fleetError, setFleetError] = useState('')
  const [tab, setTab] = useState('overview')
  const [period, setPeriod] = useState('all')
  const [site, setSite] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [band, setBand] = useState('All')
  const [linkedOnly, setLinkedOnly] = useState(false)
  const [idleHeavy, setIdleHeavy] = useState(false)
  const [sort, setSort] = useState({ key: 'utilization', dir: 'desc' })

  const load = useCallback(async () => {
    setLoading(true); setError(''); setFleetError('')
    const [util, reg] = await Promise.allSettled([
      listAssetUtilization({ country: activeCountry }),
      listAssetOptions({ country: activeCountry }),
    ])
    if (util.status === 'fulfilled') setRows(util.value)
    else { setRows([]); setError(toUserMessage(util.reason, 'Telematics utilization could not be loaded.')) }
    if (reg.status === 'fulfilled' && reg.value?.ok) setFleet(reg.value.rows || [])
    else { setFleet([]); setFleetError('The fleet register could not be read, so total fleet, site, asset type and the coverage gap are unavailable.') }
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const failed = !!error
  const enriched = useMemo(() => attachRegister(rows, fleet), [rows, fleet])
  // Period, site, type and status shape the whole page; search, band and the
  // two toggles only narrow the details register.
  const scoped = useMemo(
    () => filterByActivity(filterByRegister(filterByPeriod(enriched, period, new Date()), { site, vehicleType }), status),
    [enriched, period, site, vehicleType, status],
  )
  const filtered = useMemo(
    () => filterUtilization(scoped, { search, band, linkedOnly, minIdle: idleHeavy ? 50 : null }),
    [scoped, search, band, linkedOnly, idleHeavy],
  )
  const siteOptions = useMemo(() => optionsOf(enriched, 'site', NO_SITE), [enriched])
  const typeOptions = useMemo(() => optionsOf(enriched, 'vehicle_type', NO_TYPE), [enriched])

  const scopedFleet = useMemo(() => {
    if (fleetError) return null
    return fleet.filter((f) => (!site || (f.site || NO_SITE) === site) && (!vehicleType || (f.vehicle_type || NO_TYPE) === vehicleType))
  }, [fleet, fleetError, site, vehicleType])
  const kpis = useMemo(() => utilizationKpis(scoped, scopedFleet), [scoped, scopedFleet])
  const coverage = useMemo(() => (fleet.length ? telematicsCoverage(rows, fleet) : null), [rows, fleet])
  const trend = useMemo(() => activityByCapture(scoped), [scoped])
  const split = useMemo(() => activitySplit(scoped), [scoped])
  const sites = useMemo(() => siteComparison(scoped), [scoped])
  const bars = useMemo(() => siteBars(sites, 10), [sites])
  const bands = useMemo(() => bandDistribution(scoped), [scoped])
  const countries = useMemo(() => byCountry(scoped), [scoped])
  const idleTop = useMemo(() => idleRanking(scoped, { limit: 15 }), [scoped])
  const readPct = useMemo(() => readingCoverage(scoped), [scoped])

  const sorted = useMemo(() => sortRows(filtered, sort, { [sort.key]: SORT_ACCESSORS[sort.key] }), [filtered, sort])
  const pager = usePagedRows(sorted)
  const onSort = useCallback((key, first) => setSort((s) => nextSort(s, key, first)), [])

  const exportRows = useMemo(() => utilizationExportRows(sorted), [sorted])
  const fileBase = reportFileName('Fleet Utilization', activeCountry)
  const doExcel = () => exportToExcel(exportRows, UTILIZATION_EXPORT_COLS, UTILIZATION_EXPORT_HEADERS, fileBase)
  const doPdf = () => exportToPdf(exportRows, UTILIZATION_EXPORT_COLS.map((k, i) => ({ key: k, header: UTILIZATION_EXPORT_HEADERS[i] })), 'Fleet Utilization', fileBase, 'landscape')
  function exportGap(kind) {
    const out = coverageGapExportRows(coverage)
    if (!out.length) return
    const name = reportFileName('Telematics Coverage Gap', activeCountry)
    if (kind === 'excel') exportToExcel(out, COVERAGE_GAP_COLS, COVERAGE_GAP_HEADERS, name)
    else exportToPdf(out, COVERAGE_GAP_COLS.map((k, i) => ({ key: k, header: COVERAGE_GAP_HEADERS[i] })), 'Telematics coverage gap', name, 'portrait')
  }
  const SITE_COLS = ['site', 'assets', 'avgUtilization', 'avgIdlePct', 'distanceKm', 'workingHours', 'idleHours', 'highIdle']
  const SITE_HEADERS = ['Site', 'Assets', 'Avg utilization %', 'Avg idle %', 'Distance km', 'Working h', 'Idle h', 'High idle assets']
  const siteExportRows = () => sites.map((s) => ({ ...s, avgUtilization: s.avgUtilization == null ? null : Math.round(s.avgUtilization * 10) / 10, avgIdlePct: s.avgIdlePct == null ? null : Math.round(s.avgIdlePct * 10) / 10 }))
  const exportSites = () => exportToExcel(siteExportRows(), SITE_COLS, SITE_HEADERS, reportFileName('Fleet Utilization by Site', activeCountry))

  const pageFilters = period !== 'all' || site || vehicleType || status
  const tableFilters = search || band !== 'All' || linkedOnly || idleHeavy
  const clearAll = () => { setPeriod('all'); setSite(''); setVehicleType(''); setStatus(''); setSearch(''); setBand('All'); setLinkedOnly(false); setIdleHeavy(false) }

  const cardState = { loading, data: loading ? null : rows, error: error || null, retry: load }
  const na = (v) => (loading || failed ? null : v)
  const scopeNote = kpis.tracked ? `${fmtInt(kpis.tracked)} telematics record${kpis.tracked === 1 ? '' : 's'} in view` : null

  const detailColumns = [
    { key: 'asset_no', header: <SortHead label="Fleet no." k="asset_no" first="asc" sort={sort} onSort={onSort} />,
      cell: (r) => (
        <span className="cc-vehicle">
          <VehicleThumb row={r} size="sm" />
          <span>
            <span className="cc-strong">{r.asset_no}</span>
            <span className="cc-sub">{[r.country, r.vehicle_type].filter(Boolean).join(', ') || 'Type not recorded'}{!r.linked_to_fleet && <span className="fu-warn">, unregistered</span>}</span>
          </span>
        </span>
      ) },
    { key: 'make', header: <SortHead label="Make / model" k="make" first="asc" sort={sort} onSort={onSort} />, cell: (r) => [r.make, r.model].filter(Boolean).join(' ') || NA },
    { key: 'working', header: <SortHead label="Working hours" k="working" sort={sort} onSort={onSort} />, align: 'right', cell: (r) => fmtHrs(secondsToHours(r.working_seconds)) },
    { key: 'idle_hours', header: <SortHead label="Idle hours" k="idle_hours" sort={sort} onSort={onSort} />, align: 'right',
      cell: (r) => { const ip = idlePct(r); return <span className={ip != null && ip >= 50 ? 'fu-warn' : ''} title={ip == null ? undefined : `Idle ${fmtP(ip)}`}>{fmtHrs(secondsToHours(r.idle_seconds))}</span> } },
    { key: 'total', header: <SortHead label="Total hours" k="total" sort={sort} onSort={onSort} />, align: 'right', cell: (r) => fmtHrs(totalHours(r)) },
    { key: 'utilization', header: <SortHead label="Utilization" k="utilization" sort={sort} onSort={onSort} />,
      cell: (r) => <span title={`Band: ${bandOf(r)}`}><MeterCell value={num(r.utilization_pct)} suffix="%" /></span> },
    { key: 'distance', header: <SortHead label="Distance (km)" k="distance" sort={sort} onSort={onSort} />, align: 'right', cell: (r) => fmtKm(r.distance_km) },
    { key: 'site', header: <SortHead label="Site" k="site" first="asc" sort={sort} onSort={onSort} />, cell: (r) => r.site || NA },
    { key: 'status', header: <SortHead label="Status" k="status" first="asc" sort={sort} onSort={onSort} />,
      cell: (r) => { const a = ACTIVITY[activityOf(r)]; return <span className={`cc-pill ${a.tone}`}>{a.label}</span> } },
    { key: 'current_km', header: <SortHead label="Current km" k="current_km" sort={sort} onSort={onSort} />, align: 'right', cell: (r) => fmtKm(r.current_km) },
    { key: 'captured', header: <SortHead label="Captured" k="captured" sort={sort} onSort={onSort} />, cell: (r) => fmtDate(r.captured_at) },
  ]

  const detailsCard = (
    <Card
      title="Asset utilization details"
      sub="Utilization register. Sort any column; exports cover every filtered asset in this order."
      action={
        <div className="fu-actions">
          <button type="button" className="cc-btn-ghost" onClick={doExcel} disabled={!exportRows.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
          <button type="button" className="cc-btn-ghost" onClick={doPdf} disabled={!exportRows.length}><FileText size={14} aria-hidden="true" /> PDF</button>
        </div>
      }
    >
      <div className="cc-filters fu-table-filters">
        <div className="cc-search">
          <Search size={15} aria-hidden="true" />
          <label htmlFor="util-search" className="sr-only">Search assets</label>
          <input id="util-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fleet no., make, model..." />
        </div>
        <select className="cc-select" aria-label="Utilization band" value={band} onChange={(e) => setBand(e.target.value)}>
          <option value="All">All bands</option>
          <option value="High">High (75% and above)</option>
          <option value="Medium">Medium (40 to 75%)</option>
          <option value="Low">Low (below 40%)</option>
          <option value="Unknown">Unknown</option>
        </select>
        <label className="fu-check"><input type="checkbox" checked={linkedOnly} onChange={(e) => setLinkedOnly(e.target.checked)} /> <Link2 size={13} aria-hidden="true" /> Linked to fleet only</label>
        <label className="fu-check"><input type="checkbox" checked={idleHeavy} onChange={(e) => setIdleHeavy(e.target.checked)} /> Idle at or above 50%</label>
        <span className="fu-count" aria-live="polite">{failed ? 'N/A' : `${fmtInt(filtered.length)} of ${fmtInt(scoped.length)} records`}</span>
      </div>
      <KitTable
        columns={detailColumns}
        rows={pager.pageRows}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={error || null}
        onRetry={load}
        manualPagination
        showPagination={false}
        enableSorting={false}
        empty={rows.length === 0 ? 'No telematics utilization has been loaded for this scope yet.' : 'No assets match the current filters.'}
      />
      {!loading && !error && <TablePagination {...pager} />}
    </Card>
  )

  const trendCard = (
    <Card
      title="Utilization trend"
      sub={trend.trendable
        ? `Assets by activity for each telematics capture date (${trend.points[0].date} to ${trend.points[trend.points.length - 1].date}).`
        : 'Assets by activity in the loaded telematics snapshot.'}
    >
      <CardState state={cardState} empty={!scoped.length ? 'No telematics records in this view.' : null}>
        {trend.trendable ? <ActivityColumns points={trend.points} /> : (
          <div className="fu-snapshot">
            <p className="fu-note">
              {trend.points.length === 1
                ? `Only one telematics capture is loaded (${fmtDate(trend.points[0].date)}). The data is a snapshot, not a daily series, so a day by day trend appears once more captures are loaded.`
                : 'These records carry no capture date, so they cannot be placed on any day.'}
            </p>
            <SplitBar split={split} />
          </div>
        )}
        <ActivityLegend split={split} />
        {trend.undated > 0 && trend.trendable && <p className="fu-note">{fmtInt(trend.undated)} record(s) have no capture date and are not shown by day.</p>}
      </CardState>
    </Card>
  )

  const siteCard = (
    <Card title="Site-wise utilization" sub="Average utilization per site, highest first (top 10)." action={bars.length ? <button type="button" className="cc-link cc-link-btn" onClick={() => setTab('sites')}>Compare sites</button> : null}>
      <CardState
        state={cardState}
        empty={fleetError ? 'Site needs the fleet register, which could not be read.' : !bars.length ? 'No site in this view has a measured utilization.' : null}
      >
        <div className="fu-hbars">
          {bars.map((b) => (
            <div key={b.site} className="fu-hbar" title={`${b.site}: ${b.pct}% over ${b.assets} asset(s)`}>
              <span className="fu-hbar-label">{b.site}</span>
              <span className="cc-bar-track"><i style={{ width: `${Math.max(0, Math.min(100, b.pct))}%`, background: b.pct >= 70 ? 'var(--cc-green)' : b.pct >= 40 ? 'var(--cc-amber)' : 'var(--cc-red)' }} /></span>
              <b>{b.pct}%</b>
            </div>
          ))}
        </div>
      </CardState>
    </Card>
  )

  return (
    <div className="cc fu-page">
      <PageHero
        title="Fleet Utilization"
        lead="Measure actual working hours, idle time and distance to optimize performance."
        imgLight="/dashboard/hero-renewal-light.webp"
        imgDark="/dashboard/hero-renewal-dark.webp"
        stat={!loading && coverage?.coveragePct != null ? { value: fmtP(coverage.coveragePct), lines: ['Telematics', `${fmtInt(coverage.covered)} of ${fmtInt(coverage.activeAssets)} active`] } : null}
      />

      {error && (
        <div className="cc-card fu-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><p>{error} Figures read N/A until it loads.</p></div>
          <button type="button" className="cc-btn-ghost" onClick={load}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {fleetError && (
        <div className="cc-card fu-banner warn" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><p>{fleetError}</p></div>
          <button type="button" className="cc-btn-ghost" onClick={load}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      <div className="cc-kpis fu-kpis" aria-busy={loading}>
        <Kpi icon={Truck} tone="t-green" loading={loading} value={na(kpis.totalFleet)} label="Total fleet"
          title={kpis.totalFleet == null ? 'The fleet register could not be read.' : `${fmtInt(kpis.totalFleet)} register assets in scope; ${scopeNote || 'no telematics records'}.`} />
        <Kpi icon={Gauge} tone="t-blue" loading={loading} display={failed ? 'N/A' : fmtP(kpis.avgUtilization)} label="Avg utilization"
          title={readPct == null ? 'No utilization readings in view.' : `${fmtP(readPct)} of records report a utilization.`} />
        <Kpi icon={Timer} tone="t-green" loading={loading} display={failed ? 'N/A' : fmtHrs(kpis.workingHours)} label="Working hours"
          title="Total working time over the loaded captures. A per day figure is not measurable: the capture period length is not recorded." />
        <Kpi icon={Hourglass} tone="t-amber" loading={loading} display={failed ? 'N/A' : fmtHrs(kpis.idleHours)} label="Idle hours"
          title="Total idle time over the loaded captures. A per day figure is not measurable: the capture period length is not recorded." />
        <Kpi icon={Milestone} tone="t-purple" loading={loading} display={failed ? 'N/A' : fmtKm(kpis.distanceKm)} label="Distance (km)"
          title="Total distance reported by telematics over the loaded captures." />
      </div>

      <div className="fu-toolbar">
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="Fleet utilization views" variant="line" />
        <div className="cc-filters fu-filters">
          <select className="cc-select" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <select className="cc-select" aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)} disabled={!fleet.length} title={fleet.length ? undefined : 'Needs the fleet register'}>
            <option value="">All sites</option>
            {siteOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select className="cc-select" aria-label="Asset type" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} disabled={!fleet.length} title={fleet.length ? undefined : 'Needs the fleet register'}>
            <option value="">All asset types</option>
            {typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select className="cc-select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All status</option>
            {ACTIVITY_KEYS.map((k) => <option key={k} value={k}>{ACTIVITY[k].label}</option>)}
          </select>
          {(pageFilters || tableFilters) && <button type="button" className="cc-btn-ghost" onClick={clearAll}><X size={13} aria-hidden="true" /> Clear</button>}
          <button type="button" className="cc-icon-btn" onClick={load} disabled={loading} aria-label="Refresh utilization"><RefreshCw size={14} className={loading ? 'fu-spin' : ''} aria-hidden="true" /></button>
        </div>
      </div>

      {tab === 'overview' && (
        <>
          <div className="fu-row">{trendCard}{siteCard}</div>
          {detailsCard}
        </>
      )}

      {tab === 'sites' && (
        <div className="fu-row">
          <Card title="Site comparison" sub="Utilization, idle and distance per site in view."
            action={<button type="button" className="cc-btn-ghost" onClick={exportSites} disabled={!sites.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>}>
            <CardState state={cardState} empty={fleetError ? 'Site needs the fleet register, which could not be read.' : !sites.length ? 'No sites in this view.' : null}>
              <KitTable compact getRowId={(x) => String(x.site)} rows={sites} columns={[
                { key: 'site', header: 'Site', cell: (x) => <span className="cc-strong">{x.site}</span> },
                { key: 'assets', header: 'Assets', align: 'right', cell: (x) => fmtInt(x.assets) },
                { key: 'util', header: 'Avg utilization', cell: (x) => <MeterCell value={x.avgUtilization} suffix="%" /> },
                { key: 'idle', header: 'Avg idle', align: 'right', cell: (x) => fmtP(x.avgIdlePct) },
                { key: 'distance', header: 'Distance', align: 'right', cell: (x) => fmtKm(x.distanceKm) },
                { key: 'working', header: 'Working', align: 'right', cell: (x) => fmtHrs(x.workingHours) },
                { key: 'idle_h', header: 'Idle', align: 'right', cell: (x) => fmtHrs(x.idleHours) },
                { key: 'high', header: 'High idle', align: 'right', cell: (x) => fmtInt(x.highIdle) },
              ]} />
            </CardState>
          </Card>
          <Card title="Telematics coverage gap" sub="Active register assets with no telematics record in this country scope."
            action={
              <div className="fu-actions">
                <button type="button" className="cc-btn-ghost" onClick={() => exportGap('excel')} disabled={!coverage?.uncovered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                <button type="button" className="cc-btn-ghost" onClick={() => exportGap('pdf')} disabled={!coverage?.uncovered.length}><FileText size={14} aria-hidden="true" /> PDF</button>
              </div>
            }>
            <CardState state={cardState} empty={!coverage ? (fleetError ? 'The coverage gap needs the fleet register, which could not be read.' : 'No register assets in this scope.') : null}>
              {coverage && (
                <>
                  <div className="fu-stats">
                    <div><span>Active assets</span><b>{fmtInt(coverage.activeAssets)}</b></div>
                    <div><span>With telematics</span><b>{fmtInt(coverage.covered)}</b></div>
                    <div><span>Coverage</span><b>{fmtP(coverage.coveragePct)}</b></div>
                  </div>
                  {coverage.unregistered > 0 && <p className="fu-note">{fmtInt(coverage.unregistered)} telematics record(s) name an asset the register does not hold.</p>}
                  <KitTable compact getRowId={(x) => String(x.site)} rows={coverage.bySite} empty="No active register assets in this scope." columns={[
                    { key: 'site', header: 'Site', cell: (x) => <span className="cc-strong">{x.site}</span> },
                    { key: 'active', header: 'Active', align: 'right', cell: (x) => fmtInt(x.active) },
                    { key: 'covered', header: 'Tracked', align: 'right', cell: (x) => fmtInt(x.covered) },
                    { key: 'gap', header: 'Gap', align: 'right', cell: (x) => <span className={x.gap ? 'fu-warn' : ''}>{fmtInt(x.gap)}</span> },
                    { key: 'pct', header: 'Coverage', cell: (x) => <MeterCell value={x.coveragePct} suffix="%" /> },
                  ]} />
                </>
              )}
            </CardState>
          </Card>
        </div>
      )}

      {tab === 'assets' && (
        <>
          <div className="fu-row">
            <Card title="Utilization bands" sub="High 75% and above, medium 40 to 75%, low below 40%.">
              <CardState state={cardState} empty={!scoped.length ? 'No telematics records in this view.' : null}>
                <Donut segments={bands.map((b) => ({ label: b.band, count: b.count, color: BAND_COLOR[b.band] }))} centerLabel="records"
                  onSelect={(s) => { setBand(s.label) }} />
              </CardState>
            </Card>
            <Card title="By country" sub="Records and average utilization per country.">
              <CardState state={cardState} empty={!countries.length ? 'No telematics records in this view.' : null}>
                <KitTable compact getRowId={(x) => String(x.country)} rows={countries} columns={[
                  { key: 'country', header: 'Country', cell: (x) => <span className="cc-strong">{x.country}</span> },
                  { key: 'assets', header: 'Records', align: 'right', cell: (x) => fmtInt(x.assets) },
                  { key: 'util', header: 'Avg utilization', cell: (x) => <MeterCell value={x.avgUtilization} suffix="%" /> },
                  { key: 'distance', header: 'Distance', align: 'right', cell: (x) => fmtKm(x.distance) },
                ]} />
              </CardState>
            </Card>
          </div>
          {detailsCard}
        </>
      )}

      {tab === 'idle' && (
        <div className="fu-row">
          <Card title="Activity split" sub="What each record reported in its capture period.">
            <CardState state={cardState} empty={!scoped.length ? 'No telematics records in this view.' : null}>
              <Donut segments={split.map((s) => ({ label: s.label, count: s.count, color: s.color }))} centerLabel="records"
                onSelect={(s) => { const k = ACTIVITY_KEYS.find((x) => ACTIVITY[x].label === s.label); if (k) setStatus(k) }} />
            </CardState>
          </Card>
          <Card title="Most idle time" sub="Records with the most idle hours in view (top 15).">
            <CardState state={cardState} empty={!idleTop.length ? 'No idle time is recorded in this view.' : null}>
              <KitTable compact getRowId={(r) => String(r.id)} rows={idleTop} columns={[
                { key: 'asset_no', header: 'Fleet no.', cell: (r) => <span className="cc-strong">{r.asset_no}</span> },
                { key: 'site', header: 'Site', cell: (r) => r.site || NA },
                { key: 'idle_h', header: 'Idle hours', align: 'right', cell: (r) => <span className="fu-warn">{fmtHrs(r.idleHours)}</span> },
                { key: 'idle', header: 'Idle share', align: 'right', cell: (r) => fmtP(r.idle) },
                { key: 'util', header: 'Utilization', cell: (r) => <MeterCell value={num(r.utilization_pct)} suffix="%" /> },
              ]} />
            </CardState>
          </Card>
        </div>
      )}

      {tab === 'reports' && (
        <Card title="Reports" sub="Every download follows the filters above.">
          <CardState state={cardState}>
            <div className="fu-reports">
              <div className="fu-report">
                <div><b>Utilization register</b><p>{fmtInt(exportRows.length)} record(s): utilization, distance, idle, working and idle hours, current km and capture date.</p></div>
                <div className="fu-actions">
                  <button type="button" className="cc-btn-ghost" onClick={doExcel} disabled={!exportRows.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                  <button type="button" className="cc-btn-ghost" onClick={doPdf} disabled={!exportRows.length}><FileText size={14} aria-hidden="true" /> PDF</button>
                </div>
              </div>
              <div className="fu-report">
                <div><b>Site comparison</b><p>{fmtInt(sites.length)} site(s) with utilization, idle, distance and hours.</p></div>
                <div className="fu-actions"><button type="button" className="cc-btn-ghost" onClick={exportSites} disabled={!sites.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button></div>
              </div>
              <div className="fu-report">
                <div><b>Telematics coverage gap</b><p>{coverage ? `${fmtInt(coverage.uncovered.length)} active register asset(s) with no telematics record.` : 'Needs the fleet register.'}</p></div>
                <div className="fu-actions">
                  <button type="button" className="cc-btn-ghost" onClick={() => exportGap('excel')} disabled={!coverage?.uncovered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                  <button type="button" className="cc-btn-ghost" onClick={() => exportGap('pdf')} disabled={!coverage?.uncovered.length}><FileText size={14} aria-hidden="true" /> PDF</button>
                </div>
              </div>
              <p className="fu-note">
                {trend.points.length
                  ? `${fmtInt(trend.points.length)} capture date(s) loaded, from ${fmtDate(trend.points[0].date)} to ${fmtDate(trend.points[trend.points.length - 1].date)}.`
                  : 'No dated telematics captures in this view.'}
              </p>
            </div>
          </CardState>
        </Card>
      )}
    </div>
  )
}
