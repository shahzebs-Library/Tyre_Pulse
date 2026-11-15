/**
 * CpkIntelligence (route /cpk-intelligence) - the standalone CPK module.
 *
 * A dedicated home for Cost Per Km / Cost Per Hour, kept OUT of the Engineering
 * KPI page. It loads ONE country and ONE bounded period at a time (default the
 * current month) rather than the whole history, and splits the fleet into two
 * independent, advanced tables:
 *   - MOVABLE assets, measured per kilometre (trucks, mixers, road units)
 *   - NON-MOVABLE assets, measured per engine-hour (generators, pumps, plant)
 *
 * The four heavy "advanced" views (per-vehicle table, what-if scenario, brand
 * value, why-it-changed) are lazy tabs - only the open one fetches, so nothing
 * loads everything at once.
 *
 * METRIC NAMES (ENG-1) come from src/lib/cpkMetrics.js. The headline is the
 * Tyre CPK (lifetime) from get_tyre_lifetime_cpk. The get_fleet_cpk km figure
 * is the "tyre spend ratio" (period spend over lifetime tyre km) and is named
 * so; a total cost over tyre km is never shown. Cost per vehicle km lives on
 * Expenses and CPK.
 *
 * All money is per country in its own currency (never blended); every CPK is
 * null -> "N/A" when its km/hours denominator is 0 (honest, never a fabricated 0).
 * Data: get_fleet_cpk / get_cpk_drivers / get_brand_size_cpk. Maths live in the
 * pure engines (cpkModule, fleetCpkView, costIntelligence, cpkScenario, cpkDrivers).
 */
import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react'
import {
  Gauge, Truck, Factory, FlaskConical, TrendingUp, Table2,
  FileSpreadsheet, FileText, RefreshCcw, Info, Milestone, Layers, AlertTriangle,
  ChevronRight, CalendarDays, Coins, ShieldCheck, Clock,
} from 'lucide-react'
import {
  Card, CardState, Kpi, Tabs, ViewAll, KitTable, MeterCell, fmtInt, fmtPct,
} from '../components/commandCenter/kit'
import DateField from '../components/ui/DateField'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { getFleetCpk } from '../lib/api/fleetCpk'
import { getTyrePriceBasis, priceBasisNote } from '../lib/api/tyrePriceBackfill'
import { getCpkDrivers } from '../lib/api/cpkDrivers'
import { getBrandSizeCpk } from '../lib/api/brandSizeCpk'
import { listSites, siteOptionsForCountry } from '../lib/api/sites'
import {
  CPK_PERIODS, DEFAULT_PERIOD, periodBounds, periodLabel,
  MOBILITY_META, splitByMobility,
} from '../lib/cpkModule'
import { sortByTypeWorstFirst } from '../lib/fleetCpkView'
import {
  previousWindow, overviewKpis, assetTypeRows, rateBars, overviewDrivers, lineageFacts,
  fmtCompact, fmtRate, fmtSignedPct,
} from '../lib/cpkOverviewView'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import CpkDataTable from '../components/cpk/CpkDataTable'
import { toUserMessage } from '../lib/safeError'
import { currencyForCountryCode } from '../lib/expenseReportAnalytics'
import {
  CPK_METRIC, metricDef, metricShort, TOTAL_PER_TYRE_KM_WITHHELD, TYRE_SPEND_RATIO_BASIS,
} from '../lib/cpkMetrics'
import './CpkIntelligence.css'

const CpkScenarioStudioPanel = lazy(() => import('../components/cpk/CpkScenarioStudioPanel'))
const CpkDriversPanel = lazy(() => import('../components/cpk/CpkDriversPanel'))
const KmSourcePanel = lazy(() => import('../components/cpk/KmSourcePanel'))
const CpkUnitAuditPanel = lazy(() => import('../components/cpk/CpkUnitAuditPanel'))
const CpkKmIntelligencePanel = lazy(() => import('../components/cpk/CpkKmIntelligencePanel'))
const CpkReportPanel = lazy(() => import('../components/cpk/CpkReportPanel'))
const LifetimeCpkPanel = lazy(() => import('../components/cpk/LifetimeCpkPanel'))

const MOBILITIES = ['movable', 'non_movable']

const TABS = [
  { key: 'fleet', label: 'Overview', icon: Gauge },
  { key: 'vehicles', label: 'Per vehicle', icon: Table2 },
  { key: 'lifetime', label: 'Tyre lifetime', icon: Layers },
  { key: 'km_source', label: 'KM source', icon: Milestone },
  { key: 'units', label: 'Units & why different', icon: Layers },
  { key: 'km_intel', label: 'KM intelligence', icon: Gauge },
  { key: 'report', label: 'Custom report', icon: FileText },
  { key: 'scenario', label: 'Scenario studio', icon: FlaskConical },
  { key: 'brand', label: 'Brand value', icon: TrendingUp },
  { key: 'drivers', label: 'Why it changed', icon: Info },
]

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0 }

/** Column name of a get_fleet_cpk rate, from the one glossary (cpkMetrics). */
function rateName(mobility, kind) {
  if (mobility === 'non_movable') {
    return metricDef(kind === 'total' ? CPK_METRIC.OPERATING_COST_PER_ENGINE_HOUR : CPK_METRIC.TYRE_COST_PER_ENGINE_HOUR).short
  }
  return metricDef(CPK_METRIC.TYRE_SPEND_RATIO).short
}

export default function CpkIntelligence() {
  const loadId = useRef(0)
  const { activeCountry } = useSettings()

  const initialCountry = activeCountry && activeCountry !== 'All' ? activeCountry : COUNTRIES[0]
  const [country, setCountry] = useState(initialCountry)
  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD)
  const [tab, setTab] = useState('fleet')
  // Registered site (vehicle_fleet.site). '' = all sites. Options come from the
  // site register for the chosen country; a failed read says so and offers Retry.
  const [site, setSite] = useState('')
  const [siteOptions, setSiteOptions] = useState([])
  const [siteError, setSiteError] = useState(false)
  const [siteNonce, setSiteNonce] = useState(0)
  useEffect(() => {
    let cancelled = false
    setSiteOptions([])
    setSiteError(false)
    listSites({ country, activeOnly: true })
      .then((rows) => { if (!cancelled) setSiteOptions(siteOptionsForCountry(rows, country)) })
      .catch(() => { if (!cancelled) { setSiteOptions([]); setSiteError(true) } })
    return () => { cancelled = true }
  }, [country, siteNonce])
  useEffect(() => { setSite('') }, [country])
  const siteArg = site || undefined
  const scopeLabel = site ? `${country}, ${site}` : country

  // Calendar custom range (used only when periodKey === 'custom'). An incomplete
  // range falls back to the current-month bounds inside periodBounds.
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const bounds = useMemo(
    () => periodBounds(periodKey, new Date(), { from: customFrom, to: customTo }),
    [periodKey, customFrom, customTo],
  )

  // Core fleet CPK - loaded for every tab (small: one country + one bounded window).
  const [fleetCpk, setFleetCpk] = useState({ perVehicle: [], byType: [], fleet: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    const request = ++loadId.current
    let cancelled = false
    setFleetCpk({ perVehicle: [], byType: [], fleet: [] })
    setLoading(true)
    setError('')
    getFleetCpk({ country, from: bounds.from, to: bounds.to, site: siteArg, strict: true })
      .then((res) => { if (!cancelled && request === loadId.current) setFleetCpk(res || { perVehicle: [], byType: [], fleet: [] }) })
      .catch((loadError) => {
        if (!cancelled && request === loadId.current) {
          setFleetCpk({ perVehicle: [], byType: [], fleet: [] })
          setError(toUserMessage(loadError, 'Could not load CPK data.'))
        }
      })
      .finally(() => { if (!cancelled && request === loadId.current) setLoading(false) })
    return () => { cancelled = true }
  }, [country, bounds.from, bounds.to, siteArg])

  useEffect(() => load(), [load])

  // Overview tab only: the same-length window before this one, so the KPI
  // tiles can show a real current-vs-previous trend, and the drivers payload
  // behind "Why CPK changed". Both load only while the overview is open.
  const prevWindow = useMemo(() => previousWindow(bounds.from, bounds.to), [bounds.from, bounds.to])
  const [prevFleetRow, setPrevFleetRow] = useState(null)
  const [ovDrivers, setOvDrivers] = useState({ loading: true, data: null, error: null })
  const [typeMobility, setTypeMobility] = useState('all')
  const ovSeq = useRef(0)

  const loadOverviewDrivers = useCallback(() => {
    const id = ++ovSeq.current
    setOvDrivers({ loading: true, data: null, error: null })
    getCpkDrivers({ country, from: bounds.from, to: bounds.to, site: siteArg, strict: true })
      .then((d) => { if (id === ovSeq.current) setOvDrivers({ loading: false, data: d, error: null }) })
      .catch((e) => { if (id === ovSeq.current) setOvDrivers({ loading: false, data: null, error: toUserMessage(e, 'Could not load what moved CPK.') }) })
  }, [country, bounds.from, bounds.to, siteArg])

  useEffect(() => {
    if (tab !== 'fleet') return undefined
    let cancelled = false
    setPrevFleetRow(null)
    if (prevWindow) {
      // A failed comparison read only removes the trend arrows; it never blocks the page.
      getFleetCpk({ country, from: prevWindow.from, to: prevWindow.to, site: siteArg })
        .then((res) => { if (!cancelled) setPrevFleetRow(res?.fleet?.[0] || null) })
        .catch(() => { if (!cancelled) setPrevFleetRow(null) })
    }
    loadOverviewDrivers()
    return () => { cancelled = true }
  }, [tab, country, prevWindow, loadOverviewDrivers, siteArg])

  const refreshAll = useCallback(() => {
    load()
    if (tab === 'fleet') loadOverviewDrivers()
  }, [load, loadOverviewDrivers, tab])

  // What the cost side rests on. Cost per km is only as sound as its price
  // input, and 2,989 of the fleet's 6,832 priced tyres carry a price the
  // backfill engine worked out from a comparable tyre rather than one anyone
  // paid. Loaded beside the CPK figures so the qualification travels with them.
  const [priceBasis, setPriceBasis] = useState(null)
  useEffect(() => {
    let cancelled = false
    setPriceBasis(null)
    getTyrePriceBasis({ country })
      .then((b) => { if (!cancelled) setPriceBasis(b) })
      .catch(() => { if (!cancelled) setPriceBasis(null) })
    return () => { cancelled = true }
  }, [country])

  // HEADLINE: Tyre CPK (lifetime) of the tyres retired in the window. One price
  // per physical tyre over its own validated km (get_tyre_lifetime_cpk). A failed
  // read leaves the tile at N/A; it never blocks the page.
  const [lifetime, setLifetime] = useState({ loading: true, block: null })
  useEffect(() => {
    let cancelled = false
    setLifetime({ loading: true, block: null })
    getTyreLifetimeCpk({ country, from: bounds.from, to: bounds.to, site: siteArg })
      .then((res) => {
        if (cancelled) return
        const row = res?.ok ? (res.countries || []).find((c) => c.country === country) || null : null
        setLifetime({ loading: false, block: row?.final || null })
      })
      .catch(() => { if (!cancelled) setLifetime({ loading: false, block: null }) })
    return () => { cancelled = true }
  }, [country, bounds.from, bounds.to, siteArg])

  // Advanced tabs fetch only when opened.
  const [drivers, setDrivers] = useState({ ok: false, windows: null, segments: [] })
  const [brandRows, setBrandRows] = useState([])
  const [advLoading, setAdvLoading] = useState(false)
  const [advancedError, setAdvancedError] = useState('')

  useEffect(() => {
    if (tab !== 'drivers' && tab !== 'brand') return
    let cancelled = false
    setDrivers({ ok: false, windows: null, segments: [] }); setBrandRows([])
    setAdvLoading(true)
    setAdvancedError('')
    Promise.allSettled([
      tab === 'drivers'
        ? getCpkDrivers({ country, from: bounds.from, to: bounds.to, site: siteArg, strict: true })
        : Promise.resolve(null),
      getBrandSizeCpk({ country, from: bounds.from, to: bounds.to, site: siteArg, strict: true }),
    ]).then(([d, b]) => {
      if (cancelled) return
      if (d.status === 'fulfilled' && d.value) setDrivers(d.value)
      else if (d.status === 'rejected') setDrivers({ ok: false, windows: null, segments: [] })
      setBrandRows(b.status === 'fulfilled' && Array.isArray(b.value) ? b.value : [])
      const failed = [d.status === 'rejected' && 'change drivers', b.status === 'rejected' && 'brand value'].filter(Boolean)
      if (failed.length) setAdvancedError(`Could not load ${failed.join(' and ')} for this period.`)
    }).finally(() => { if (!cancelled) setAdvLoading(false) })
    return () => { cancelled = true }
  }, [tab, country, bounds.from, bounds.to, siteArg])

  // No row in the period must still label money in the country's currency, never the country code.
  const currency = fleetCpk.fleet?.[0]?.currency || currencyForCountryCode(country, country)

  // Split every source by mobility so movable / non-movable are independent.
  const byTypeSplit = useMemo(() => splitByMobility(fleetCpk.byType), [fleetCpk.byType])
  const perVehicleSplit = useMemo(() => splitByMobility(fleetCpk.perVehicle), [fleetCpk.perVehicle])
  const fleetRow = fleetCpk.fleet?.[0] || null

  function exportVehicles(mobility) {
    const rows = sortByTypeWorstFirst(perVehicleSplit[mobility]).map((r) => ({
      asset_no: r.asset_no ?? '',
      vehicle_type: r.vehicle_type ?? '',
      distance: Math.round(num(r.distance_or_hours)),
      tyre_cost: Math.round(num(r.tyre_cost)),
      total_cost: Math.round(num(r.total_cost)),
      cpk_tyre: r.cpk_tyre == null ? 'N/A' : Number(r.cpk_tyre).toFixed(4),
      cpk_total: r.cpk_total == null ? 'N/A' : Number(r.cpk_total).toFixed(4),
    }))
    if (!rows.length) return
    const unitLbl = MOBILITY_META[mobility].sublabel
    // The km side has no total rate (ENG-1): its sheet carries the tyre spend
    // ratio only, under its real name.
    const hasTotal = mobility === 'non_movable'
    exportToExcel(
      rows,
      ['asset_no', 'vehicle_type', 'distance', 'tyre_cost', 'total_cost', 'cpk_tyre', ...(hasTotal ? ['cpk_total'] : [])],
      ['Asset', 'Type', mobility === 'movable' ? 'Tyre km (lifetime, tyres taken off)' : 'Engine hours', `Tyre Cost (${currency})`, `Total Cost (${currency})`, rateName(mobility, 'tyre'), ...(hasTotal ? [rateName(mobility, 'total')] : [])],
      `TyrePulse_CPK_${country}_${mobility}`,
      `${MOBILITY_META[mobility].label} (${unitLbl})`,
    )
  }

  function exportByTypePdf(mobility) {
    const rows = sortByTypeWorstFirst(byTypeSplit[mobility]).map((r) => ({
      vehicle_type: r.vehicle_type ?? '',
      distance: Math.round(num(r.distance_or_hours)),
      tyre_cost: Math.round(num(r.tyre_cost)),
      total_cost: Math.round(num(r.total_cost)),
      cpk_tyre: r.cpk_tyre == null ? 'N/A' : Number(r.cpk_tyre).toFixed(4),
      cpk_total: r.cpk_total == null ? 'N/A' : Number(r.cpk_total).toFixed(4),
    }))
    if (!rows.length) return
    exportToPdf(
      rows,
      [
        { key: 'vehicle_type', header: 'Asset Type' },
        { key: 'distance', header: mobility === 'movable' ? 'Tyre km' : 'Engine hours' },
        { key: 'tyre_cost', header: `Tyre Cost (${currency})` },
        { key: 'total_cost', header: `Total Cost (${currency})` },
        { key: 'cpk_tyre', header: rateName(mobility, 'tyre') },
        ...(mobility === 'non_movable' ? [{ key: 'cpk_total', header: rateName(mobility, 'total') }] : []),
      ],
      `${scopeLabel} ${MOBILITY_META[mobility].label} by type (${MOBILITY_META[mobility].sublabel})`,
      `TyrePulse_CPK_${country}_${mobility}`,
      'landscape',
    )
  }

  const vehicleColumns = (mobility) => ([
    { key: 'asset_no', header: 'Asset', align: 'left', kind: 'text' },
    { key: 'vehicle_type', header: 'Type', align: 'left', kind: 'text' },
    { key: 'distance_or_hours', header: mobility === 'movable' ? 'Tyre km' : 'Engine hours', align: 'right', kind: 'int' },
    { key: 'tyre_cost', header: `Tyre (${currency})`, align: 'right', kind: 'money' },
    { key: 'maintenance_cost', header: `Maint (${currency})`, align: 'right', kind: 'money' },
    { key: 'total_cost', header: `Total (${currency})`, align: 'right', kind: 'money' },
    { key: 'cpk_tyre', header: rateName(mobility, 'tyre'), align: 'right', kind: 'cpk' },
    // No total rate on the km side: maintenance cannot be divided by tyre km.
    ...(mobility === 'non_movable' ? [{ key: 'cpk_total', header: rateName(mobility, 'total'), align: 'right', kind: 'cpk' }] : []),
  ])

  const kpis = useMemo(() => overviewKpis(fleetRow, prevFleetRow), [fleetRow, prevFleetRow])
  const typeRows = useMemo(() => assetTypeRows(fleetCpk.byType, fleetCpk.perVehicle), [fleetCpk.byType, fleetCpk.perVehicle])
  const movableBars = useMemo(() => rateBars(typeRows, 'movable'), [typeRows])
  const hourBars = useMemo(() => rateBars(typeRows, 'non_movable'), [typeRows])
  const why = useMemo(() => overviewDrivers(ovDrivers.data), [ovDrivers.data])
  const shownTypeRows = useMemo(
    () => (typeMobility === 'all' ? typeRows : typeRows.filter((r) => r.mobility === typeMobility)),
    [typeRows, typeMobility],
  )
  const fleetState = { loading, data: loading ? null : fleetCpk, error: error || null, retry: load }
  const trendTitle = prevWindow
    ? `Compared with ${prevWindow.from} to ${prevWindow.to}`
    : 'No comparison window'
  const kpiLoading = loading
  const noFleet = !loading && !error && !kpis.movable && !kpis.nonMovable

  function exportTypesExcel() {
    if (!shownTypeRows.length) return
    exportToExcel(
      shownTypeRows.map((r) => ({
        vehicle_type: r.vehicle_type,
        basis: r.mobility === 'movable' ? 'Per tyre km' : 'Per engine hour',
        units: r.units ?? 'N/A',
        distance: Math.round(r.distance),
        tyre_cost: Math.round(r.tyre_cost),
        maintenance_cost: r.maintenance_cost == null ? 'N/A' : Math.round(r.maintenance_cost),
        total_cost: Math.round(r.total_cost),
        cpk_tyre: r.cpk_tyre == null ? 'N/A' : Number(r.cpk_tyre).toFixed(4),
        cpk_total: r.cpk_total == null ? 'N/A' : Number(r.cpk_total).toFixed(4),
        coverage: r.coverage == null ? 'N/A' : `${Math.round(r.coverage)}%`,
      })),
      ['vehicle_type', 'basis', 'units', 'distance', 'tyre_cost', 'maintenance_cost', 'total_cost', 'cpk_tyre', 'cpk_total', 'coverage'],
      ['Asset type', 'Basis', 'Units', 'Tyre km or engine hours', `Tyre cost (${currency})`, `Maintenance cost (${currency})`, `Total cost (${currency})`, 'Tyre spend ratio (per tyre km) or tyre cost per engine hour', 'Operating cost per engine hour (hour assets only)', 'Coverage'],
      `TyrePulse_CPK_${country}_asset_types`,
      `Cost by asset type, ${scopeLabel}, ${bounds.from} to ${bounds.to}`,
    )
  }

  const typeColumnsKit = [
    {
      key: 'vehicle_type', header: 'Asset type',
      cell: (r) => (
        <span className="cpk-type">
          <i className={r.mobility === 'movable' ? 'cpk-dot-km' : 'cpk-dot-hr'} aria-hidden="true" />
          <span>{r.vehicle_type}</span>
        </span>
      ),
    },
    {
      key: 'units', header: 'Units', numeric: true,
      cell: (r) => (r.units == null ? <span className="cc-na">N/A</span> : (
        <span title={`${r.measured} of ${r.units} assets have a ${r.mobility === 'movable' ? 'distance' : 'engine-hour'} reading`}>{fmtInt(r.units)}</span>
      )),
    },
    { key: 'distance', header: 'Tyre km or hours', numeric: true, cell: (r) => (r.distance > 0 ? `${fmtInt(Math.round(r.distance))} ${r.mobility === 'movable' ? 'km' : 'hr'}` : <span className="cc-na" title="No meter reading in this period">N/A</span>) },
    { key: 'tyre_cost', header: 'Tyre cost', numeric: true, cell: (r) => `${currency} ${fmtCompact(r.tyre_cost)}` },
    { key: 'maintenance_cost', header: 'Maint. cost', numeric: true, sortValue: (r) => r.maintenance_cost ?? -1, cell: (r) => (r.maintenance_cost == null ? <span className="cc-na">N/A</span> : `${currency} ${fmtCompact(r.maintenance_cost)}`) },
    { key: 'total_cost', header: 'Total cost', numeric: true, cell: (r) => `${currency} ${fmtCompact(r.total_cost)}` },
    { key: 'cpk_tyre', header: 'Tyre spend ratio / tyre cost per hour', numeric: true, sortValue: (r) => r.cpk_tyre ?? -1, cell: (r) => (r.cpk_tyre == null ? <span className="cc-na" title="No measured km or hours">N/A</span> : <b className="cpk-rate">{fmtRate(r.cpk_tyre)}{r.mobility === 'movable' ? '' : '/hr'}</b>) },
    { key: 'cpk_total', header: 'Operating cost per hour', numeric: true, sortValue: (r) => r.cpk_total ?? -1, cell: (r) => (r.cpk_total == null ? <span className="cc-na" title={r.mobility === 'movable' ? TOTAL_PER_TYRE_KM_WITHHELD : 'No measured engine hours'}>N/A</span> : `${fmtRate(r.cpk_total)}/hr`) },
    { key: 'coverage', header: 'Coverage', numeric: true, sortValue: (r) => r.coverage ?? -1, cell: (r) => <MeterCell value={r.coverage} suffix="%" /> },
  ]

  const ccTabs = TABS.map((t) => ({ key: t.key, label: t.label }))

  return (
    <div className="cc cpk-page">
      <header className="cpk-head">
        <div className="cpk-head-copy">
          <nav className="cpk-crumb" aria-label="Breadcrumb">Tyre Management <ChevronRight size={13} aria-hidden="true" /> <span>Performance</span></nav>
          <h1>CPK Intelligence</h1>
          <p>Tyre CPK over each tyre&apos;s own lifetime km, the period tyre spend ratio, and cost per engine hour for plant, by country and period.</p>
        </div>
        <div className="cpk-head-actions">
          <span className="cpk-range" title={periodLabel(bounds)}><CalendarDays size={15} aria-hidden="true" /> {bounds.from} to {bounds.to}</span>
          <button type="button" className="cc-btn-primary" onClick={refreshAll} disabled={loading}>
            <RefreshCcw size={15} aria-hidden="true" className={loading ? 'cpk-spin' : undefined} /> Refresh
          </button>
        </div>
      </header>

      <div className="cc-card cpk-bar">
        <div className="cpk-seg" role="radiogroup" aria-label="Country">
          {COUNTRIES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={country === c} onClick={() => setCountry(c)}>{c}</button>
          ))}
        </div>
        <label className="cpk-period">
          <span>Site</span>
          <select className="cc-select" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Site">
            <option value="">All Sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {siteError && (
            <span role="alert" className="cpk-site-error">
              Could not load sites.{' '}
              <button type="button" className="cc-link cc-link-btn" onClick={() => setSiteNonce((n) => n + 1)}>Retry</button>
            </span>
          )}
        </label>
        <label className="cpk-period">
          <span>Period</span>
          <select className="cc-select" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} aria-label="Period">
            {CPK_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        {periodKey === 'custom' && (
          <div className="cpk-custom">
            <DateField className="text-sm w-40" value={customFrom} onChange={setCustomFrom} placeholder="From date" ariaLabel="From date" max={customTo || undefined} />
            <DateField className="text-sm w-40" value={customTo} onChange={setCustomTo} placeholder="To date" ariaLabel="To date" min={customFrom || undefined} />
          </div>
        )}
        <span className="cpk-currency">Currency <b>{currency}</b></span>
      </div>

      {priceBasisNote(priceBasis) && (
        <p className="cpk-note"><Info size={14} aria-hidden="true" /> {priceBasisNote(priceBasis)}</p>
      )}

      {error && (
        <div role="alert" className="cc-card cpk-alert bad">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" className="cc-btn" onClick={load}>Retry</button>
        </div>
      )}

      {advancedError && (tab === 'drivers' || tab === 'brand') && (
        <div role="alert" className="cc-card cpk-alert warn">
          <AlertTriangle size={16} aria-hidden="true" /><span>{advancedError}</span>
        </div>
      )}

      <Tabs tabs={ccTabs} value={tab} onChange={setTab} label="CPK views" />

      {tab === 'fleet' && (
        <div className="cpk-overview">
          <div className="cc-kpis cpk-kpis">
            <Kpi icon={Gauge} tone="t-red" loading={lifetime.loading}
              display={lifetime.block?.cpkPurchase == null ? 'N/A' : Number(lifetime.block.cpkPurchase).toFixed(4)}
              label={metricShort(CPK_METRIC.TYRE_CPK_LIFETIME, currency)}
              title={`${metricDef(CPK_METRIC.TYRE_CPK_LIFETIME).definition} ${lifetime.block ? `${fmtInt(lifetime.block.measurable)} of ${fmtInt(lifetime.block.tyres)} tyres retired in this period have both a price and validated km.` : 'No tyre retired in this period has both a price and validated km.'}`} />
            <Kpi icon={Coins} tone="t-amber" loading={kpiLoading}
              display={fmtRate(kpis.cpkTyre.value)} label={metricShort(CPK_METRIC.TYRE_SPEND_RATIO, currency)}
              trend={kpis.cpkTyre.trend} goodWhenUp={false} title={`${TYRE_SPEND_RATIO_BASIS} ${trendTitle}`} />
            <Kpi icon={Milestone} tone="t-blue" loading={kpiLoading}
              display={fmtCompact(kpis.distance.value)} label="Lifetime tyre km of tyres taken off"
              trend={kpis.distance.trend} title={trendTitle} />
            <Kpi icon={ShieldCheck} tone="t-green" loading={kpiLoading}
              display={fmtPct(kpis.coverage.value)} label="Meter coverage of movable cost"
              trend={kpis.coverage.trend} title={`${trendTitle}. Change is in percentage points.`} />
            <Kpi icon={Clock} tone="t-purple" loading={kpiLoading}
              display={fmtRate(kpis.cph.value)} label={metricShort(CPK_METRIC.OPERATING_COST_PER_ENGINE_HOUR, currency)}
              trend={kpis.cph.trend} goodWhenUp={false} title={trendTitle} />
          </div>
          <p className="cpk-note"><Info size={14} aria-hidden="true" /> {TYRE_SPEND_RATIO_BASIS} Tyre CPK (lifetime) divides each retired tyre&apos;s own price by its own km. Cost per vehicle km, with maintenance, is on Expenses and CPK.</p>
          {noFleet && (
            <div className="cc-card cpk-alert">
              <Info size={16} aria-hidden="true" />
              <span>No cost or meter data for {scopeLabel} between {bounds.from} and {bounds.to}. Try a longer period.</span>
            </div>
          )}

          <div className="cpk-cards">
            <Card title="Movable assets: tyre spend ratio" sub={`Period tyre spend over lifetime tyre km, by asset type, ${currency}`}
              action={<ViewAll label="Per vehicle" onClick={() => setTab('vehicles')} />}>
              <CardState state={fleetState} empty={!movableBars.bars.length ? 'No movable asset type has tyre km in this period.' : null}>
                <div className="cpk-cols" role="list">
                  {movableBars.bars.map((b) => (
                    <div key={b.key} className="cpk-col" role="listitem" title={`${b.label}: ${currency} ${fmtRate(b.value)} per tyre km, ${fmtInt(Math.round(b.row.distance))} tyre km`}>
                      <span className="cpk-col-val">{fmtRate(b.value)}</span>
                      <span className="cpk-col-track"><span style={{ height: `${Math.max(4, b.share * 100)}%` }} /></span>
                      <span className="cpk-col-label">{b.label}</span>
                    </div>
                  ))}
                </div>
              </CardState>
              {(movableBars.hidden > 0 || movableBars.unmeasured.length > 0) && (
                <p className="cpk-foot">
                  {movableBars.hidden > 0 && `${movableBars.hidden} more type${movableBars.hidden === 1 ? '' : 's'} in the table. `}
                  {movableBars.unmeasured.length > 0 && `No distance for ${movableBars.unmeasured.slice(0, 3).join(', ')}${movableBars.unmeasured.length > 3 ? ` and ${movableBars.unmeasured.length - 3} more` : ''}.`}
                </p>
              )}
            </Card>

            <Card title="Non-movable: operating cost per engine hour" sub={`Tyres, spares and oil per engine hour, ${currency}`}
              action={<ViewAll label="Units" onClick={() => setTab('units')} />}>
              <CardState state={fleetState} empty={!hourBars.bars.length ? 'No non-movable asset type has measured engine hours in this period.' : null}>
                <div className="cpk-rows" role="list">
                  {hourBars.bars.map((b) => (
                    <div key={b.key} className="cpk-hrow" role="listitem" title={`${b.label}: ${currency} ${fmtRate(b.value)} per hour, ${fmtInt(Math.round(b.row.distance))} hours`}>
                      <span className="cpk-hrow-label">{b.label}</span>
                      <span className="cpk-hrow-track"><span style={{ width: `${Math.max(3, b.share * 100)}%` }} /></span>
                      <b>{fmtRate(b.value)}</b>
                    </div>
                  ))}
                </div>
              </CardState>
              {hourBars.unmeasured.length > 0 && (
                <p className="cpk-foot">No engine hours for {hourBars.unmeasured.slice(0, 3).join(', ')}{hourBars.unmeasured.length > 3 ? ` and ${hourBars.unmeasured.length - 3} more` : ''}.</p>
              )}
            </Card>

            <Card title="Why the tyre spend ratio changed" sub={why.ok && why.windows?.previous ? `Against ${why.windows.previous.from} to ${why.windows.previous.to}` : 'Against the previous period of the same length'}
              action={<ViewAll label="Breakdown" onClick={() => setTab('drivers')} />}>
              <CardState state={{ ...ovDrivers, retry: loadOverviewDrivers }} empty={!why.ok || !why.steps.length ? 'No two comparable periods of tyre cost and distance yet, so there is no change to explain.' : null}>
                <ul className="cpk-why">
                  {why.steps.slice(0, 6).map((s) => {
                    const tone = s.amount > 0 ? 'bad' : s.amount < 0 ? 'good' : 'flat'
                    return (
                      <li key={s.key} title={`${s.label}: ${s.amount > 0 ? '+' : ''}${fmtRate(s.amount)} ${currency} per ${why.segment?.unit === 'engine_hours' ? 'hour' : 'km'}`}>
                        <span className={s.isResidual ? 'cpk-why-res' : undefined}>{s.label}</span>
                        <span className={`cpk-chip ${tone}`}>{fmtSignedPct(s.pct)}</span>
                      </li>
                    )
                  })}
                </ul>
                {why.ok && (
                  <p className={`cpk-foot ${why.comparable ? '' : 'warn'}`}>
                    {why.comparable
                      ? `The tyre spend ratio moved ${fmtSignedPct(why.totalPct)} overall. Red raised it, green lowered it.`
                      : 'Coverage limited: the previous period measured too few assets, so treat these as indicative.'}
                  </p>
                )}
              </CardState>
            </Card>
          </div>

          <Card title="Cost by asset type" sub={`${scopeLabel}, ${bounds.from} to ${bounds.to}. Coverage is the share of cost on assets with a meter reading.`}
            className="cpk-table-card"
            action={(
              <div className="cpk-table-actions">
                <div className="cpk-seg sm" role="radiogroup" aria-label="Asset basis">
                  {[['all', 'All'], ['movable', 'Per km'], ['non_movable', 'Per hour']].map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={typeMobility === k} onClick={() => setTypeMobility(k)}>{l}</button>
                  ))}
                </div>
                <button type="button" className="cc-btn-ghost" onClick={exportTypesExcel} disabled={!shownTypeRows.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                <button type="button" className="cc-btn-ghost" onClick={() => exportByTypePdf('movable')} disabled={!byTypeSplit.movable.length}><FileText size={14} aria-hidden="true" /> PDF km</button>
                <button type="button" className="cc-btn-ghost" onClick={() => exportByTypePdf('non_movable')} disabled={!byTypeSplit.non_movable.length}><FileText size={14} aria-hidden="true" /> PDF hours</button>
              </div>
            )}>
            <KitTable
              columns={typeColumnsKit}
              rows={shownTypeRows}
              loading={loading}
              error={error || undefined}
              onRetry={load}
              empty={`No asset type carries cost or meter data for ${scopeLabel} in this period.`}
              getRowId={(r) => r.key}
            />
          </Card>

          <Card title="Data quality and source lineage" className="cpk-lineage"
            action={(
              <div className="cpk-table-actions">
                <button type="button" className="cc-btn-primary" onClick={() => setTab('scenario')}><FlaskConical size={15} aria-hidden="true" /> Scenario Studio</button>
                <button type="button" className="cc-btn-ghost" onClick={() => setTab('report')}><FileText size={15} aria-hidden="true" /> Build custom report</button>
              </div>
            )}>
            <ul className="cpk-lineage-list">
              <li><b>Tyre km</b> is the sum of each tyre&apos;s whole measured life (single km rule), counted in the period the tyre was taken off. It is tyre km, not vehicle km.</li>
              <li><b>Hours</b> are engine-hour spans from the meter log per asset.</li>
              <li><b>Cost</b> is tyre and maintenance spend per country in its own currency, never combined across countries. Maintenance is never divided by tyre km.</li>
              {!loading && !error && lineageFacts(kpis).map((f) => <li key={f}>{f}</li>)}
            </ul>
            <p className="cpk-foot">A rate with no measured km or hours shows N/A rather than zero. Trace any figure on the KM source and Units tabs.</p>
          </Card>
        </div>
      )}

      {tab === 'vehicles' && (
        <div className="space-y-6">
          {MOBILITIES.map((mobility) => {
            const meta = MOBILITY_META[mobility]
            const rows = perVehicleSplit[mobility]
            const Icon = mobility === 'movable' ? Truck : Factory
            return (
              <section key={mobility} className="cc-card">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-base font-semibold">
                    <Icon size={18} /> {meta.label} vehicles <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>({meta.sublabel})</span>
                  </h3>
                  <button type="button" onClick={() => exportVehicles(mobility)} className="inline-flex items-center gap-1.5 text-xs rounded-md border border-[var(--border-subtle)] px-2.5 py-1">
                    <FileSpreadsheet size={12} /> Excel
                  </button>
                </div>
                <CpkDataTable
                  columns={vehicleColumns(mobility)}
                  rows={rows}
                  loading={loading}
                  searchKeys={['asset_no', 'vehicle_type']}
                  initialSort={{ key: mobility === 'non_movable' ? 'cpk_total' : 'cpk_tyre', dir: 'desc' }}
                  pageSize={25}
                  emptyText={`No ${meta.label.toLowerCase()} vehicles with cost or meter data for ${scopeLabel} in this period.`}
                />
              </section>
            )
          })}
        </div>
      )}

      {tab === 'km_source' && (
        <Suspense fallback={<Loading />}>
          <KmSourcePanel country={country} from={bounds.from} to={bounds.to} site={siteArg} currency={currency} />
        </Suspense>
      )}

      {tab === 'units' && (
        <Suspense fallback={<Loading />}>
          <CpkUnitAuditPanel country={country} from={bounds.from} to={bounds.to} site={siteArg} currency={currency} />
        </Suspense>
      )}

      {tab === 'lifetime' && (
        <Suspense fallback={<Loading />}>
          <LifetimeCpkPanel country={country} from={bounds.from} to={bounds.to} site={siteArg} />
        </Suspense>
      )}

      {tab === 'km_intel' && (
        <Suspense fallback={<Loading />}>
          <CpkKmIntelligencePanel country={country} from={bounds.from} to={bounds.to} site={siteArg} currency={currency} />
        </Suspense>
      )}

      {tab === 'report' && (
        <Suspense fallback={<Loading />}>
          <CpkReportPanel
            country={country}
            from={bounds.from}
            to={bounds.to}
            currency={currency}
            perVehicle={fleetCpk.perVehicle}
            byType={fleetCpk.byType}
            fleet={fleetCpk.fleet}
          />
        </Suspense>
      )}

      {tab === 'scenario' && (
        <Suspense fallback={<Loading />}>
          <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Model any scenario: type a manual km (or hours) total, scale tyre / maintenance / tyre-price costs,
            include or exclude assets, and watch the cost per km / hour move live. Save named scenarios to compare.
          </p>
          <CpkScenarioStudioPanel
            perVehicle={fleetCpk.perVehicle}
            byType={fleetCpk.byType}
            fleet={fleetCpk.fleet}
            currency={currency}
            country={country}
          />
        </Suspense>
      )}

      {tab === 'brand' && (
        <Suspense fallback={<Loading />}>
          <CpkDriversPanel
            drivers={{ ok: false, windows: null, segments: [] }}
            fleetCpk={fleetCpk}
            brandSizeRows={brandRows}
            currency={currency}
            loading={advLoading || loading}
          />
        </Suspense>
      )}

      {tab === 'drivers' && (
        <Suspense fallback={<Loading />}>
          <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            The current period against the one before it, taken apart into what moved the cost per km / hour
            (tyre price, asset mix, new equipment, utilization).
          </p>
          <CpkDriversPanel
            drivers={drivers}
            fleetCpk={fleetCpk}
            brandSizeRows={brandRows}
            currency={currency}
            loading={advLoading || loading}
          />
        </Suspense>
      )}
    </div>
  )
}

function Loading() {
  return <div className="cc-card cpk-loading" role="status">Loading this view...</div>
}
