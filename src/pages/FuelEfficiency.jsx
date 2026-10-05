/**
 * Fuel Efficiency (route /fuel-efficiency) rebuilt on the Command Center kit to
 * the owner's "Fuel Efficiency" mockup.
 *
 * What is real and what is not:
 *  - No fuel volume is recorded (fuel_transactions is empty), so measured km/L,
 *    fuel cost per km, litres used and emissions read "Not recorded" with the
 *    reason. Nothing is invented.
 *  - Tyre pressure and tread readings on tyre_records ARE real. The modelled
 *    tyre-condition fuel penalty (src/lib/fuelEfficiencyAnalytics.js) is built
 *    on them and labelled as a model.
 *  - The Savings Calculator is a user-input scenario: fuel price, consumption,
 *    distance and fleet size are typed by the user, and its output says so.
 * Page shaping lives in src/lib/fuelEfficiencyView.js. The fuel-exception
 * approval flow, PDF and Excel exports are kept.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line, Scatter } from 'react-chartjs-2'
import {
  Fuel, Coins, PiggyBank, Gauge, Leaf, FileSpreadsheet, FileText, RefreshCw, Calculator,
  Info, Lock, ShieldCheck, Search, X, Play, ChevronRight, AlertTriangle, Truck,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toUserMessage } from '../lib/safeError'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme, reportFileName } from '../lib/exportUtils'
import Modal from '../components/ui/Modal'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { Card, CardState, Kpi, Tabs, KitTable, VehicleThumb, ViewAll, fmtInt } from '../components/commandCenter/kit'
import { loadAutoTable } from '../lib/pdfEngine'
import {
  FUEL_CONSTANTS, deriveMonthlyKm, fuelSites, filterFuelRecords, enrichTyres,
  vehicleMetrics as buildVehicleMetrics, siteMetrics as buildSiteMetrics, fuelKpis,
  complianceSavings, monthlyPenaltyTrend, fuelRecommendations,
} from '../lib/fuelEfficiencyAnalytics'
import {
  FUEL_DATA_REASON, vehicleStatus, STATUS_OPTIONS, savingsOpportunities, topPerformers, sitePenalty,
  fleetPenaltyPct, treadBands, wornReplacementSavings, scenarioOutputs, filterVehicles,
} from '../lib/fuelEfficiencyView'
import './FuelEfficiency.css'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend, Filler)

const ROW_CAP = 50000
const PREFS_KEY = 'tp_fuel_efficiency_inputs_v1'
const NOT_RECORDED = <span className="cc-na" title={FUEL_DATA_REASON}>Not recorded</span>

const TOOLTIP = { backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1, titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)' }
const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: 'var(--text-muted)', boxWidth: 10, font: { size: 11 } } }, tooltip: TOOLTIP },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}

function fmt(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return 'N/A'
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtCur(n, currency) {
  if (n == null || !Number.isFinite(n)) return 'N/A'
  if (Math.abs(n) >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${currency} ${(n / 1_000).toFixed(1)}K`
  return `${currency} ${Math.round(n).toLocaleString('en-US')}`
}
const pct = (v) => (v == null ? 'N/A' : `${v}%`)

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {} } catch { return {} }
}
function writePrefs(v) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(v)) } catch { /* private mode: keep in memory only */ }
}
const toInput = (v) => (v == null || v === '' ? '' : String(v))
const toNumOrNull = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export default function FuelEfficiency() {
  const { activeCurrency, activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const countryKey = activeCountry || 'All'

  // ── Scenario inputs (remembered per country on this device) ──────────────
  const [scenario, setScenario] = useState('pressure')
  const [priceInput, setPriceInput] = useState('')
  const [consumptionInput, setConsumptionInput] = useState(String(FUEL_CONSTANTS.DEFAULT_CONSUMPTION_L_100KM))
  const [fleetSizeInput, setFleetSizeInput] = useState('')
  const [monthlyKmInput, setMonthlyKmInput] = useState('')
  const [complianceTarget, setComplianceTarget] = useState(95)
  const [scenarioRun, setScenarioRun] = useState(false)

  useEffect(() => {
    const p = readPrefs()[countryKey] || {}
    setPriceInput(toInput(p.price))
    setConsumptionInput(toInput(p.consumption ?? FUEL_CONSTANTS.DEFAULT_CONSUMPTION_L_100KM))
    setMonthlyKmInput(toInput(p.monthlyKm))
    setFleetSizeInput('')
  }, [countryKey])

  useEffect(() => {
    const all = readPrefs()
    all[countryKey] = { price: toNumOrNull(priceInput), consumption: toNumOrNull(consumptionInput), monthlyKm: toNumOrNull(monthlyKmInput) }
    writePrefs(all)
  }, [countryKey, priceInput, consumptionInput, monthlyKmInput])

  // ── Filters ─────────────────────────────────────────────────────────────
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [perfTab, setPerfTab] = useState('vehicle')
  const [detailTab, setDetailTab] = useState('vehicles')

  // ── Data ────────────────────────────────────────────────────────────────
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exportError, setExportError] = useState('')
  const [capped, setCapped] = useState(false)
  const [now] = useState(() => Date.now())

  // Fuel-exception approval: a vehicle's modelled fuel-waste anomaly is the
  // approval subject (keyed by asset_no); the formal exception report is
  // disabled while that approval is active or locked.
  const [reviewException, setReviewException] = useState(null)
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [reviewException?.asset_no])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: recs, error: rErr, truncated } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,asset_no,serial_number:serial_no,position,tread_depth,pressure_reading,risk_level,km_at_fitment,km_at_removal,site,country,brand,issue_date,vehicle_type')
          .order('id')
        if (activeCountry && activeCountry !== 'All') q = q.or(`country.eq.${activeCountry},country.is.null`)
        return q.range(from, to)
      }, { max: ROW_CAP })
      if (rErr) throw rErr
      setRecords(recs ?? [])
      setCapped(Boolean(truncated))
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load tyre readings.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { fetchData() }, [fetchData])
  const loadState = { loading, data: loading ? null : records, error, retry: fetchData }

  // ── Derived ─────────────────────────────────────────────────────────────
  const siteOptions = useMemo(() => fuelSites(records), [records])
  const scoped = useMemo(() => filterFuelRecords(records, { site: siteFilter }), [records, siteFilter])
  const derivedKm = useMemo(() => deriveMonthlyKm(records), [records])

  const price = toNumOrNull(priceInput)
  const consumption = toNumOrNull(consumptionInput)
  const monthlyKm = toNumOrNull(monthlyKmInput) ?? derivedKm.km
  const inputs = useMemo(() => ({ consumptionL100: consumption, monthlyKm, pricePerL: price }), [consumption, monthlyKm, price])

  const enriched = useMemo(() => enrichTyres(scoped), [scoped])
  const vehicles = useMemo(() => buildVehicleMetrics(enriched, inputs), [enriched, inputs])
  const sites = useMemo(() => buildSiteMetrics(enriched, vehicles), [enriched, vehicles])
  const kpis = useMemo(() => fuelKpis(enriched, vehicles, inputs), [enriched, vehicles, inputs])
  const vehicleType = useMemo(() => {
    const m = new Map()
    for (const r of scoped) if (r.asset_no && r.vehicle_type && !m.has(r.asset_no)) m.set(r.asset_no, r.vehicle_type)
    return m
  }, [scoped])
  const fleetSize = toNumOrNull(fleetSizeInput) ?? vehicles.length
  const savings95 = useMemo(() => complianceSavings(kpis.compliancePct, 95, { fleetSize, ...inputs }), [kpis.compliancePct, fleetSize, inputs])
  const pressureSaving = useMemo(() => complianceSavings(kpis.compliancePct, complianceTarget, { fleetSize, ...inputs }), [kpis.compliancePct, complianceTarget, fleetSize, inputs])
  const wornSaving = useMemo(() => wornReplacementSavings(enriched, inputs), [enriched, inputs])
  const scenarioSaving = scenario === 'pressure' ? pressureSaving : wornSaving
  const outputs = scenarioOutputs(scenarioSaving)
  const trend = useMemo(() => monthlyPenaltyTrend(enriched, now), [enriched, now])
  const bands = useMemo(() => treadBands(enriched), [enriched])
  const perfVehicles = useMemo(() => topPerformers(vehicles), [vehicles])
  const perfSites = useMemo(() => sitePenalty(vehicles), [vehicles])
  const opportunities = useMemo(() => savingsOpportunities(vehicles), [vehicles])
  const fleetPenalty = fleetPenaltyPct(vehicles)
  const tableRows = useMemo(() => filterVehicles(vehicles, { search, status: statusFilter }), [vehicles, search, statusFilter])
  const recommendations = useMemo(
    () => fuelRecommendations({ kpis, sites, fmtMoney: (v) => fmtCur(v, activeCurrency) }),
    [kpis, sites, activeCurrency],
  )
  const scopeLine = `${scoped.length.toLocaleString('en-US')} tyre records${siteFilter ? `, site ${siteFilter}` : ''}`
  const sitePenaltyMax = perfSites.reduce((m, s) => Math.max(m, s.penaltyPct), 0)

  // ── Exports ─────────────────────────────────────────────────────────────
  const exportPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const fileName = `${reportFileName('TyrePulse Fuel Efficiency Report')}.pdf`
    pdfHeader(doc, 'Fuel Efficiency Impact Report', `${scopeLine} | ${vehicles.length} vehicles`, company, brand)
    if (sites.length === 0) {
      pdfEmptyState(doc, 'No site fuel-impact data for the current selection')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(fileName)
      return
    }
    doc.setTextColor(30, 30, 30)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Key figures (modelled estimates)', 14, 30)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const kpiLines = [
      'Measured km/L and fuel cost per km: not recorded (no fuel transactions).',
      `Monthly fuel loss cost: ${fmtCur(kpis.extraCostMonth, activeCurrency)}${price == null ? ' (enter a fuel price to compute)' : ''}`,
      `Monthly excess fuel: ${fmt(kpis.extraLitresMonth)} L`,
      `Pressure compliance: ${pct(kpis.compliancePct)} (${kpis.pressureReadings} tyres with a reading)`,
      `Potential annual saving at 95% compliance: ${fmtCur(savings95.annualCost, activeCurrency)}`,
      `Assumptions: ${consumption ?? 'N/A'} L/100km, ${monthlyKm ?? 'N/A'} km per vehicle per month, ${price == null ? 'no fuel price' : `${activeCurrency} ${price}/L`}`,
    ]
    kpiLines.forEach((l, i) => doc.text(l, 14, 38 + i * 7))
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 85,
      head: [['Site', 'Vehicles', 'Compliance %', 'Avg Tread (mm)', 'Extra Fuel/Month (L)', 'Extra Cost/Month', 'Annual Impact']],
      body: sites.map((s) => [s.site, s.vehicles, pct(s.compliancePct), s.avgTread ?? 'N/A', fmt(s.extraLitresMonth), fmtCur(s.extraCostMonth, activeCurrency), fmtCur(s.annualExtraCost, activeCurrency)]),
    })
    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
    doc.save(fileName)
  }, [kpis, sites, vehicles.length, activeCurrency, branding, company, scopeLine, price, consumption, monthlyKm, savings95])

  const exportExcel = useCallback(async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const na = (v) => (v == null ? 'N/A' : v)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      Report: 'Fuel Efficiency Impact (modelled estimates)',
      Scope: scopeLine,
      'Measured km/L': 'Not recorded (no fuel transactions)',
      'Fuel price per litre': price == null ? 'Not entered' : `${activeCurrency} ${price}`,
      'Consumption (L/100km)': na(consumption),
      'Monthly km per vehicle': na(monthlyKm),
      'Pressure compliance %': na(kpis.compliancePct),
      'Monthly excess fuel (L)': na(kpis.extraLitresMonth),
      [`Monthly fuel loss cost (${activeCurrency})`]: na(kpis.extraCostMonth),
    }]), 'Summary')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vehicles.map((v) => ({
      'Asset No': v.asset_no,
      Site: v.site || 'Not recorded',
      Tyres: v.tyreCount,
      'Measured Tyres': v.measuredTyres,
      'Compliance %': na(v.compliancePct),
      'Avg Under-inflation %': na(v.avgDevPct),
      'Avg Tread (mm)': na(v.avgTread),
      'Fuel Penalty %': na(v.penaltyPct),
      'Monthly Extra Fuel (L)': na(v.extraLitresMonth),
      [`Monthly Extra Cost (${activeCurrency})`]: na(v.extraCostMonth),
      [`Annual Extra Cost (${activeCurrency})`]: na(v.annualExtraCost),
      Status: vehicleStatus(v).label,
    }))), 'Vehicles')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sites.map((s) => ({
      Site: s.site,
      Vehicles: s.vehicles,
      'Measured Tyres': s.measuredTyres,
      'Compliance %': na(s.compliancePct),
      'Avg Tread (mm)': na(s.avgTread),
      'Extra Fuel/Month (L)': na(s.extraLitresMonth),
      [`Monthly Extra Cost (${activeCurrency})`]: na(s.extraCostMonth),
      [`Annual Impact (${activeCurrency})`]: na(s.annualExtraCost),
    }))), 'Sites')
    XLSX.writeFile(wb, `${reportFileName('TyrePulse Fuel Efficiency')}.xlsx`)
  }, [vehicles, sites, kpis, activeCurrency, scopeLine, price, consumption, monthlyKm])

  const runExport = async (fn) => {
    setExportError('')
    try { await fn() } catch (e) { setExportError(toUserMessage(e, 'Could not export. Please retry.')) }
  }

  // ── Table columns ───────────────────────────────────────────────────────
  const vehicleColumns = useMemo(() => [
    { key: 'asset_no', header: 'Asset', cell: (v) => <b>{v.asset_no}</b> },
    { key: 'type', header: 'Asset type', sortValue: (v) => vehicleType.get(v.asset_no) || '', cell: (v) => vehicleType.get(v.asset_no) || <span className="cc-na">Not recorded</span> },
    { key: 'site', header: 'Site', sortValue: (v) => v.site || '', cell: (v) => v.site || <span className="cc-na">Not recorded</span> },
    { key: 'distance', header: 'Distance (km)', sortable: false, cell: () => NOT_RECORDED },
    { key: 'fuel', header: 'Fuel used (L)', sortable: false, cell: () => NOT_RECORDED },
    { key: 'kml', header: 'Efficiency (km/L)', sortable: false, cell: () => NOT_RECORDED },
    { key: 'measuredTyres', header: 'Measured tyres', numeric: true, cell: (v) => `${v.measuredTyres} of ${v.tyreCount}` },
    { key: 'compliancePct', header: 'Pressure compliance', numeric: true, cell: (v) => pct(v.compliancePct) },
    { key: 'avgDevPct', header: 'Under-inflation', numeric: true, cell: (v) => (v.avgDevPct == null ? 'N/A' : <span className={v.avgDevPct >= 10 ? 'fe-bad' : undefined}>-{v.avgDevPct}%</span>) },
    { key: 'avgTread', header: 'Avg tread (mm)', numeric: true, cell: (v) => (v.avgTread ?? 'N/A') },
    { key: 'penaltyPct', header: 'Modelled fuel penalty', numeric: true, cell: (v) => pct(v.penaltyPct) },
    { key: 'extraCostMonth', header: `Extra ${activeCurrency} / month`, numeric: true, cell: (v) => fmtCur(v.extraCostMonth, activeCurrency) },
    { key: 'status', header: 'Status', sortValue: (v) => vehicleStatus(v).label, cell: (v) => { const s = vehicleStatus(v); return <span className={`cc-pill ${s.tone}`}>{s.label}</span> } },
    { key: 'review', header: '', sortable: false, align: 'right', cell: (v) => (
      <button type="button" className="cc-btn-ghost fe-review" onClick={(e) => { e.stopPropagation(); setReviewException(v) }} aria-label={`Review fuel exception for ${v.asset_no}`}>
        <ShieldCheck size={13} aria-hidden="true" /> Review
      </button>
    ) },
  ], [activeCurrency, vehicleType])

  const siteColumns = useMemo(() => [
    { key: 'site', header: 'Site', cell: (s) => <b>{s.site}</b> },
    { key: 'vehicles', header: 'Vehicles', numeric: true },
    { key: 'measuredTyres', header: 'Measured tyres', numeric: true, cell: (s) => `${s.measuredTyres} of ${s.tyres}` },
    { key: 'compliancePct', header: 'Pressure compliance', numeric: true, cell: (s) => pct(s.compliancePct) },
    { key: 'avgTread', header: 'Avg tread (mm)', numeric: true, cell: (s) => (s.avgTread ?? 'N/A') },
    { key: 'extraLitresMonth', header: 'Extra fuel / month (L)', numeric: true, cell: (s) => fmt(s.extraLitresMonth) },
    { key: 'annualExtraCost', header: `Annual impact (${activeCurrency})`, numeric: true, cell: (s) => fmtCur(s.annualExtraCost, activeCurrency) },
  ], [activeCurrency])

  // ── Charts ──────────────────────────────────────────────────────────────
  const trendHas = trend.some((m) => m.avgPenaltyPct != null)
  const trendData = {
    labels: trend.map((m) => m.key),
    datasets: [{ label: 'Modelled fuel penalty %', data: trend.map((m) => m.avgPenaltyPct), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.15)', fill: true, tension: 0.35, spanGaps: false, pointRadius: 3 }],
  }
  const scatterData = {
    datasets: [
      { label: 'Under 5 mm (worn)', data: bands.worn, backgroundColor: 'rgba(239,68,68,0.75)', pointRadius: 4 },
      { label: '5 to 8 mm (monitor)', data: bands.monitor, backgroundColor: 'rgba(245,158,11,0.75)', pointRadius: 4 },
      { label: 'Over 8 mm (good)', data: bands.good, backgroundColor: 'rgba(34,197,94,0.75)', pointRadius: 4 },
      ...(bands.line ? [{ label: 'Trend', data: bands.line, type: 'line', showLine: true, borderColor: '#94a3b8', borderDash: [5, 5], pointRadius: 0, backgroundColor: 'transparent' }] : []),
    ],
  }
  const scatterOpts = {
    ...CHART_OPTS,
    plugins: { ...CHART_OPTS.plugins, tooltip: { ...TOOLTIP, callbacks: { label: (ctx) => `Tread ${ctx.parsed.x} mm, penalty ${ctx.parsed.y}%` } } },
    scales: {
      x: { ...CHART_OPTS.scales.x, title: { display: true, text: 'Tread depth (mm)', color: 'var(--text-muted)' } },
      y: { ...CHART_OPTS.scales.y, title: { display: true, text: 'Modelled fuel penalty %', color: 'var(--text-muted)' } },
    },
  }

  const noReadings = !loading && !error && kpis.measuredTyres === 0
  const scenarioReady = scenario === 'pressure' ? kpis.compliancePct != null : wornSaving.wornTyres > 0

  return (
    <div className="cc fe-page">
      {/* Header */}
      <div className="fe-head">
        <div className="fe-head-copy">
          <div className="fe-crumb">Monitoring and Logistics <ChevronRight size={12} aria-hidden="true" /> <span>Fuel Efficiency</span></div>
          <h1>Fuel Efficiency</h1>
          <p>Fuel economy, tyre-condition impact modelling, savings scenarios and emissions across your fleet.</p>
        </div>
        <div className="fe-head-actions">
          <label className="fe-date"><span>Site</span>
            <select className="cc-select" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button type="button" className="cc-icon-btn" onClick={fetchData} disabled={loading} aria-label="Refresh" title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          <button type="button" className="cc-btn-ghost" onClick={() => runExport(exportPDF)} disabled={loading || !records.length}><FileText size={14} aria-hidden="true" /> Export PDF</button>
          <button type="button" className="cc-btn-ghost" onClick={() => runExport(exportExcel)} disabled={loading || !records.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
          <a className="cc-btn-primary" href="#fe-calculator"><Play size={14} aria-hidden="true" /> Run Scenario</a>
        </div>
      </div>

      <div className="cc-card fe-banner" role="note">
        <Info size={18} aria-hidden="true" />
        <div>
          <b>Fuel volume is not recorded yet.</b>
          <p>{FUEL_DATA_REASON} The tyre figures below are modelled from real pressure and tread readings (about 2% more fuel per 10% under-inflation, up to 3% for worn tread).</p>
        </div>
      </div>

      {capped && !loading && <div className="cc-card fe-banner"><Info size={18} aria-hidden="true" /><div><p>Showing a capped view of {ROW_CAP.toLocaleString('en-US')} tyre records. Narrow the country for the full set.</p></div></div>}
      {exportError && <div className="cc-card fe-banner bad" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><p>{exportError}</p></div></div>}
      {error && (
        <div className="cc-card fe-banner bad" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div><b>Could not load tyre readings.</b><p>{error}</p></div>
          <button type="button" className="cc-btn-ghost" onClick={fetchData}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {/* KPI strip */}
      <div className="cc-kpis fe-kpis">
        <Kpi icon={Fuel} tone="t-green" display="N/A" title={FUEL_DATA_REASON}
          label={<>Average fuel efficiency<small className="fe-kpi-sub">km/L not recorded (no fuel volume)</small></>} />
        <Kpi icon={Coins} tone="t-amber" display="N/A" title={FUEL_DATA_REASON}
          label={<>Fuel cost per km<small className="fe-kpi-sub">Not recorded (no fuel volume)</small></>} />
        <Kpi icon={PiggyBank} tone="t-green" loading={loading} display={fmtCur(savings95.annualCost, activeCurrency)}
          title="Modelled saving from raising pressure compliance to 95%, using your scenario inputs"
          label={<>Savings opportunity<small className="fe-kpi-sub">{kpis.compliancePct == null ? 'Needs pressure readings' : price == null ? 'Enter a fuel price in the calculator' : 'Modelled, annual, at 95% compliance'}</small></>} />
        <Kpi icon={Gauge} tone="t-red" loading={loading} display={pct(fleetPenalty)}
          label={<>Tyre-related fuel loss<small className="fe-kpi-sub">{kpis.measuredTyres ? `Modelled from ${fmtInt(kpis.measuredTyres)} measured tyres` : 'No pressure or tread readings'}</small></>} />
        <Kpi icon={Leaf} tone="t-blue" display="N/A" title={FUEL_DATA_REASON}
          label={<>Emissions impact<small className="fe-kpi-sub">Not recorded (no fuel volume)</small></>} />
      </div>
      {!loading && !error && <p className="fe-scope">These figures cover {scopeLine}: {fmtInt(kpis.measuredTyres)} carry a pressure or tread reading, {fmtInt(kpis.pressureReadings)} a pressure reading.</p>}

      {/* Row 1 */}
      <div className="fe-row3">
        <Card title="Fuel efficiency trend" sub="Measured km/L needs fuel volume, which is not recorded. Line: modelled tyre fuel penalty by fitment month.">
          <CardState state={loadState} empty={!trendHas ? 'No measured tyre was fitted in the last 12 months, and no fuel volume is recorded.' : null}>
            <div className="fe-chart" role="img" aria-label="Modelled fuel penalty by fitment month"><Line data={trendData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} /></div>
          </CardState>
        </Card>

        <Card title="Fuel efficiency by site" sub="Modelled tyre fuel penalty per site, lower is better (measured km/L not recorded)">
          <CardState state={loadState} empty={!perfSites.length ? 'No site has a vehicle with a pressure or tread reading yet.' : null}>
            <div className="fe-bars">
              {perfSites.slice(0, 8).map((s) => (
                <div key={s.site} className="fe-bar-row">
                  <span title={s.site}>{s.site}</span>
                  <span className="cc-bar-track"><i style={{ width: `${sitePenaltyMax ? (s.penaltyPct / sitePenaltyMax) * 100 : 0}%`, background: s.penaltyPct >= 3 ? 'var(--cc-red)' : s.penaltyPct >= 1.5 ? 'var(--cc-amber)' : 'var(--cc-green)' }} /></span>
                  <b>{pct(s.penaltyPct)}</b>
                </div>
              ))}
            </div>
          </CardState>
        </Card>

        <Card title="Fuel vs tyre condition impact" sub="Tread depth against modelled fuel penalty">
          <CardState state={loadState} empty={bands.points < 2 ? 'Needs at least two tyres with a tread depth reading.' : null}>
            <div className="fe-chart" role="img" aria-label="Tread depth versus modelled fuel penalty"><Scatter data={scatterData} options={scatterOpts} /></div>
            {bands.r2 != null && <p className="fe-note">R squared {bands.r2} over {fmtInt(bands.points)} tyres. The penalty is modelled from tread, so this shows the model, not measured fuel.</p>}
          </CardState>
        </Card>
      </div>

      {/* Row 2 */}
      <div className="fe-row3">
        <Card title="Savings calculator" sub="Scenario: your inputs, not a measurement" className="fe-calc">
          <div id="fe-calculator" className="fe-calc-grid">
            <div className="fe-calc-form">
              <label className="fe-field"><span>Improvement scenario</span>
                <select className="cc-select" value={scenario} onChange={(e) => { setScenario(e.target.value); setScenarioRun(false) }}>
                  <option value="pressure">Raise tyre pressure compliance</option>
                  <option value="tread">Replace worn tyres (3 mm or less)</option>
                </select>
              </label>
              {scenario === 'pressure' && (
                <label className="fe-field"><span>Target compliance (%)</span>
                  <input className="cc-select fe-input" type="number" min={0} max={100} value={complianceTarget} onChange={(e) => setComplianceTarget(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
                </label>
              )}
              <label className="fe-field"><span>Fuel price per litre ({activeCurrency})</span>
                <input className="cc-select fe-input" type="number" min={0} step={0.01} inputMode="decimal" placeholder="Enter a price" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} />
              </label>
              <label className="fe-field"><span>Consumption (L/100 km)</span>
                <input className="cc-select fe-input" type="number" min={0} step={1} value={consumptionInput} onChange={(e) => setConsumptionInput(e.target.value)} />
              </label>
              <label className="fe-field"><span>Monthly km per vehicle</span>
                <input className="cc-select fe-input" type="number" min={0} step={100} placeholder={derivedKm.km == null ? 'Enter a distance' : String(derivedKm.km)} value={monthlyKmInput} onChange={(e) => setMonthlyKmInput(e.target.value)} />
                <small>{derivedKm.km == null ? 'No removed tyre carries both km readings, so no distance is derived.' : `Derived ${fmtInt(derivedKm.km)} km from ${fmtInt(derivedKm.samples)} removed tyres if left blank.`}</small>
              </label>
              {scenario === 'pressure' && (
                <label className="fe-field"><span>Fleet size</span>
                  <input className="cc-select fe-input" type="number" min={0} step={1} placeholder={String(vehicles.length)} value={fleetSizeInput} onChange={(e) => setFleetSizeInput(e.target.value)} />
                </label>
              )}
            </div>
            <div className="fe-impact" aria-live="polite">
              <h3><Calculator size={15} aria-hidden="true" /> Estimated annual impact</h3>
              {!scenarioRun ? (
                <p className="fe-note">Set the inputs and press Run scenario.</p>
              ) : !scenarioReady ? (
                <p className="fe-note">{scenario === 'pressure' ? 'This scenario needs at least one tyre with a pressure reading.' : 'No tyre in scope is at or below 3 mm tread.'}</p>
              ) : (
                <dl>
                  <div><dt>Potential fuel cost saving</dt><dd>{fmtCur(outputs.annualCost, activeCurrency)}</dd>{price == null && <small>Enter a fuel price</small>}</div>
                  <div><dt>Fuel reduction</dt><dd>{outputs.annualLitres == null ? 'N/A' : `${fmt(outputs.annualLitres)} L`}</dd>{monthlyKm == null && <small>Enter a monthly distance</small>}</div>
                  <div><dt>Emission reduction</dt><dd>{outputs.co2Tonnes == null ? 'N/A' : `${outputs.co2Tonnes} t CO2`}</dd></div>
                  {scenario === 'tread' && <div><dt>Worn tyres replaced</dt><dd>{fmtInt(wornSaving.wornTyres)} on {fmtInt(wornSaving.vehicles)} vehicles</dd></div>}
                </dl>
              )}
            </div>
          </div>
          <button type="button" className="cc-btn-primary fe-run" onClick={() => setScenarioRun(true)} disabled={loading}><Play size={14} aria-hidden="true" /> Run scenario</button>
        </Card>

        <Card title="Best tyre condition" sub="Lowest modelled fuel penalty (measured km/L not recorded)" action={<Tabs variant="line" label="Performers" value={perfTab} onChange={setPerfTab} tabs={[{ key: 'vehicle', label: 'By vehicle' }, { key: 'site', label: 'By site' }]} />}>
          <CardState state={loadState} empty={(perfTab === 'vehicle' ? perfVehicles : perfSites).length === 0 ? 'No vehicle has a pressure or tread reading yet.' : null}>
            <ol className="fe-rank">
              {perfTab === 'vehicle'
                ? perfVehicles.map((v, i) => (
                  <li key={v.asset_no}>
                    <span className="fe-rank-n">{i + 1}</span>
                    <VehicleThumb row={{ asset_no: v.asset_no, vehicle_type: vehicleType.get(v.asset_no) }} size="sm" />
                    <span className="fe-rank-main"><b>{v.asset_no}</b><small>{vehicleType.get(v.asset_no) || v.site || 'Not recorded'}</small></span>
                    <b className="fe-rank-val">{pct(v.penaltyPct)}</b>
                  </li>
                ))
                : perfSites.slice(0, 5).map((s, i) => (
                  <li key={s.site}>
                    <span className="fe-rank-n">{i + 1}</span>
                    <span className="fe-rank-main"><b>{s.site}</b><small>{fmtInt(s.measuredVehicles)} measured vehicles</small></span>
                    <b className="fe-rank-val">{pct(s.penaltyPct)}</b>
                  </li>
                ))}
            </ol>
          </CardState>
        </Card>

        <Card title="Top savings opportunities" sub="Highest modelled fuel penalty from tyre condition" action={<ViewAll label="View all" onClick={() => { setDetailTab('vehicles'); setStatusFilter(''); document.getElementById('fe-details')?.scrollIntoView({ behavior: 'smooth' }) }} />}>
          <CardState state={loadState} empty={!opportunities.length ? 'No vehicle shows a modelled fuel penalty yet.' : null}>
            <ol className="fe-rank">
              {opportunities.map((v, i) => (
                <li key={v.asset_no}>
                  <span className="fe-rank-n">{i + 1}</span>
                  <span className="fe-rank-main"><b>{v.asset_no}</b><small>{v.site || 'Site not recorded'} | penalty {pct(v.penaltyPct)}</small></span>
                  <b className="fe-rank-val">{fmtCur(v.annualExtraCost, activeCurrency)}</b>
                  <button type="button" className={`cc-pill ${v.priority.tone} fe-pill-btn`} onClick={() => setReviewException(v)} aria-label={`Review ${v.asset_no}`}>{v.priority.label}</button>
                </li>
              ))}
            </ol>
          </CardState>
        </Card>
      </div>

      {noReadings && (
        <div className="cc-card fe-banner" role="status">
          <Truck size={18} aria-hidden="true" />
          <div><b>No tyre in this selection carries a pressure or tread reading.</b><p>Record pressures and tread depths at inspection to populate the modelled figures on this page.</p></div>
        </div>
      )}

      {/* Details */}
      <section className="cc-card" id="fe-details" aria-label="Fleet fuel efficiency details">
        <div className="cc-card-head">
          <div>
            <h2 className="cc-card-title">Fleet fuel efficiency details</h2>
            <p className="cc-card-sub">Per vehicle tyre readings and the modelled fuel penalty. Distance, fuel used and km/L are not recorded.</p>
          </div>
          <Tabs variant="line" label="Detail views" value={detailTab} onChange={setDetailTab} tabs={[
            { key: 'vehicles', label: 'Vehicles', count: loading ? null : vehicles.length },
            { key: 'sites', label: 'Sites', count: loading ? null : sites.length },
            { key: 'actions', label: 'Recommendations', count: loading ? null : recommendations.length },
          ]} />
        </div>
        {detailTab === 'vehicles' && (
          <>
            <div className="cc-filters fe-filters">
              <label className="cc-search">
                <Search size={15} aria-hidden="true" />
                <input aria-label="Search vehicles" placeholder="Search asset or site" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <select className="cc-select" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              {(search || statusFilter) && <button type="button" className="cc-btn-ghost" onClick={() => { setSearch(''); setStatusFilter('') }}><X size={14} aria-hidden="true" /> Clear</button>}
            </div>
            <KitTable columns={vehicleColumns} rows={tableRows} getRowId={(v) => v.asset_no} loading={loading} error={error} onRetry={fetchData}
              onRowClick={(v) => setReviewException(v)} empty={vehicles.length ? 'No vehicle matches these filters.' : 'No vehicle carries a tyre record in this selection.'} />
          </>
        )}
        {detailTab === 'sites' && (
          <KitTable columns={siteColumns} rows={sites} getRowId={(s) => s.site} loading={loading} error={error} onRetry={fetchData} empty="No site in this selection." />
        )}
        {detailTab === 'actions' && (
          <CardState state={loadState} empty={recommendations.length === 0 ? 'No action stands out in this selection.' : null}>
            <ul className="fe-recs">
              {recommendations.map((r) => (
                <li key={r.key}>
                  <AlertTriangle size={16} aria-hidden="true" className={r.impact === 'Critical' ? 'fe-bad' : 'fe-warn'} />
                  <p>{r.text}</p>
                  <span className={`cc-pill ${r.impact === 'Critical' ? 'bad' : 'warn'}`}>{r.impact}</span>
                </li>
              ))}
            </ul>
          </CardState>
        )}
      </section>

      {/* Fuel exception review and approval */}
      {reviewException && (
        <Modal
          open
          onClose={() => setReviewException(null)}
          title={`Fuel exception: ${reviewException.asset_no}`}
          subtitle={`${reviewException.site || 'Site not recorded'} | ${fmtCur(reviewException.extraCostMonth, activeCurrency)} per month`}
          size="lg"
        >
          <div className="cc fe-modal">
            <div className="fe-stats">
              <div><span>Compliance</span><b>{pct(reviewException.compliancePct)}</b></div>
              <div><span>Avg tread</span><b>{reviewException.avgTread != null ? `${reviewException.avgTread} mm` : 'N/A'}</b></div>
              <div><span>Monthly waste</span><b>{fmtCur(reviewException.extraCostMonth, activeCurrency)}</b></div>
              <div><span>Annual impact</span><b>{fmtCur(reviewException.annualExtraCost, activeCurrency)}</b></div>
            </div>
            <EntityApprovalPanel
              entityType="fuel_exception"
              entityId={reviewException.asset_no}
              entityLabel={reviewException.asset_no}
              context={{
                variance: reviewException.avgDevPct,
                cost: Math.round(reviewException.extraCostMonth || 0),
                deviation_pct: reviewException.avgDevPct,
                compliance_pct: reviewException.compliancePct,
                avg_tread_mm: reviewException.avgTread,
                annual_cost: Math.round(reviewException.annualExtraCost || 0),
                site: reviewException.site,
              }}
              onStateChange={(s) => setWfLocked(!!(s?.isActive || s?.isLocked))}
              title="Fuel Exception Approval"
            />
            <div className="fe-modal-foot">
              {wfLocked ? <span className="fe-locked"><Lock size={13} aria-hidden="true" /> Locked, in approval</span> : <span />}
              <button type="button" className="cc-btn-ghost" onClick={() => { if (!wfLocked) runExport(exportPDF) }} disabled={wfLocked}
                title={wfLocked ? 'Locked, in approval' : 'Issue formal fuel exception report'}>
                {wfLocked ? <Lock size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />} Issue exception report
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
