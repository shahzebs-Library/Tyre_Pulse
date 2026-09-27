/**
 * TcoCalculator (route /tco-calculator) - Total Cost of Ownership.
 *
 * Tabs:
 *  - Overview: REAL fleet actuals. Headline KPIs (canonical fleet CPK from
 *    kpiEngine.computeCpkFleet, never re-derived), tyre spend by position,
 *    monthly cost per km and the annual savings potential.
 *  - Assets: per-asset actual tyre TCO + cost per km with peer percentile and
 *    band; search, filters, sortable table, drill to /asset-management/:assetNo.
 *  - Benchmarks: fleet actual cost/km vs GCC reference values by vehicle type.
 *  - What-if calculator: the ownership projection model (tco.computeTco).
 *
 * Maths: src/lib/tco.js. Page filtering, KPI and export shapes and the honesty
 * layer (no fabricated denominators): src/lib/tcoCalculatorAnalytics.js.
 */
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Tooltip, Legend, Filler,
} from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import {
  Calculator, Wallet, Gauge, Truck, Coins, RotateCcw, BarChart3, Activity,
  PiggyBank, FileSpreadsheet, FileText, AlertTriangle, ArrowRight, TrendingUp, Search, X, Ruler, List,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact, formatCurrency } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { fetchAllPages } from '../lib/fetchAll'
import * as tyreApi from '../lib/api/tyreRecords'
import { computeCpkFleet } from '../lib/kpiEngine'
import { computeTco, TCO_DEFAULTS, computeFleetActuals } from '../lib/tco'
import {
  honestWhatIf, savingsView, hasMeasuredTyreCost, filterAssets, vehicleTypeOptions, assetKpis,
  recordKmCoverage, assetExportRows, ASSET_EXPORT_COLUMNS, benchmarkExportRows, BENCHMARK_EXPORT_COLUMNS,
  CPK_BAND_ORDER, BAND_LABEL, bandLegend,
} from '../lib/tcoCalculatorAnalytics'
import { categorical, colorAt, withAlpha } from '../lib/reportColors'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, Filler)

const loadExportUtils = () => import('../lib/exportUtils')

// Semantic CPK band colours (meaning-carrying).
const BAND_STYLE = {
  excellent: 'text-green-400 bg-green-500/10 border-green-500/30',
  good: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  average: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  poor: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  critical: 'text-red-400 bg-red-500/10 border-red-500/30',
}

const TICK = { color: 'var(--text-muted)', font: { size: 10 } }
const GRID = { color: 'var(--panel-2)' }
const LEGEND = { labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 } } }

function BandChip({ band }) {
  if (!band) return <span className="text-[var(--text-muted)]">N/A</span>
  return <span className={`text-[11px] px-1.5 py-0.5 rounded border ${BAND_STYLE[band] || ''}`}>{BAND_LABEL[band] || band}</span>
}

function WarnNote({ children }) {
  return (
    <Card tone="warn" className="items-start gap-[var(--space-2)]" style={{ flexDirection: 'row' }}>
      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-xs text-[var(--text-secondary)]">{children}</p>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT-IF CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────
const INPUT_GROUPS = [
  ['Fleet scope', [['Vehicles in fleet', 'vehicle_count', '1'], ['Ownership period (years)', 'ownership_years', '1'], ['Annual km per vehicle', 'annual_km', '1000']]],
  ['Capital', [['Purchase price / vehicle', 'purchase_price', '1000'], ['Residual value (% of price)', 'residual_value_pct', '1']]],
  ['Operating costs', [['Fuel price / litre', 'fuel_price', '0.1'], ['Fuel use (L / 100 km)', 'fuel_consumption', '0.5'], ['Maintenance / vehicle / year', 'maintenance_per_year', '500'], ['Insurance / vehicle / year', 'insurance_per_year', '500']]],
  ['Tyres', [['Tyres per vehicle', 'tyres_per_vehicle', '1'], ['Tyre cost (each)', 'tyre_cost', '50'], ['Tyre life (km)', 'tyre_life_km', '1000']]],
  ['Downtime', [['Downtime days / vehicle / year', 'downtime_days_per_year', '1'], ['Downtime cost / day', 'downtime_cost_per_day', '100']]],
]

function WhatIfCalculator({ currency, company }) {
  const [inputs, setInputs] = useState(() => ({ ...TCO_DEFAULTS }))
  const [err, setErr] = useState('')
  const set = (k, v) => setInputs((p) => ({ ...p, [k]: v }))
  const reset = () => setInputs({ ...TCO_DEFAULTS })

  const r = useMemo(() => honestWhatIf(computeTco(inputs)), [inputs])
  const money = (v) => (v == null ? 'N/A' : formatCurrencyCompact(v, currency))

  const donut = {
    labels: r.breakdown.map((b) => b.name),
    datasets: [{ data: r.breakdown.map((b) => b.value), backgroundColor: categorical(r.breakdown.length), borderWidth: 0 }],
  }
  const proj = {
    labels: r.projection.map((p) => p.year),
    datasets: [
      { label: 'Operating', data: r.projection.map((p) => p.operating), backgroundColor: colorAt(0), borderRadius: 4, stack: 'yr' },
      { label: 'Depreciation', data: r.projection.map((p) => p.depreciation), backgroundColor: colorAt(1), borderRadius: 4, stack: 'yr' },
    ],
  }
  const barOpts = {
    responsive: true, maintainAspectRatio: false, plugins: { legend: LEGEND },
    scales: { x: { stacked: true, ticks: TICK, grid: { display: false } }, y: { stacked: true, ticks: TICK, grid: GRID } },
  }

  const detail = [
    ['Depreciation', money(r.depreciation)], ['Fuel', money(r.fuel)], ['Maintenance', money(r.maintenance)],
    ['Tyres', money(r.tyres)], ['Insurance', money(r.insurance)], ['Downtime', money(r.downtime)],
    ['Gross capital', money(r.grossCapital)], ['Residual value', money(r.residualValue)], ['Net capital cost', money(r.netCapital)],
    ['Lifetime distance', r.fleetLifetimeKm == null ? 'N/A' : `${r.fleetLifetimeKm.toLocaleString()} km`],
    ['TCO per year', money(r.tcoPerYear)],
    ['Cost per vehicle-km', r.costPerVehicleKm == null ? 'N/A' : formatCurrency(r.costPerVehicleKm, currency, 3)],
  ]

  const exportProjection = async (format) => {
    setErr('')
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await loadExportUtils()
      const rows = [
        ...r.breakdown.map((b) => ({ item: b.name, value: b.value })),
        ...detail.map(([item, value]) => ({ item, value })),
      ]
      const cols = [{ key: 'item', header: 'Item' }, { key: 'value', header: 'Value' }]
      const file = reportFileName('TCO What-if')
      if (format === 'pdf') await exportToPdf(rows, cols, 'TCO What-if Projection', file, 'portrait', company)
      else await exportToExcel(rows, ['item', 'value'], ['Item', 'Value'], file, 'What-if')
    } catch (e) {
      setErr(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => exportProjection('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]"><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
        <button type="button" onClick={() => exportProjection('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]"><FileText size={14} aria-hidden="true" /> PDF</button>
        <button type="button" onClick={reset} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]"><RotateCcw size={14} aria-hidden="true" /> Reset</button>
      </div>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          {INPUT_GROUPS.map(([title, fields]) => (
            <Card key={title}>
              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">{title}</legend>
                <div className="space-y-3">
                  {fields.map(([label, key, step]) => (
                    <div key={key}>
                      <label htmlFor={`tco-${key}`} className="label">{label}</label>
                      <input id={`tco-${key}`} type="number" step={step} min="0" inputMode="decimal" className="input w-full font-mono min-h-[40px]" value={inputs[key]} onChange={(e) => set(key, e.target.value)} />
                    </div>
                  ))}
                </div>
              </fieldset>
            </Card>
          ))}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatTile label="Total cost of ownership" value={money(r.totalTco)} icon={Wallet} tone="accent" />
            <StatTile label="Cost per km" value={r.costPerKm == null ? 'N/A' : formatCurrency(r.costPerKm, currency, 3)} icon={Gauge} tone="info" sub={r.costPerKm == null ? 'No distance in the scenario' : undefined} />
            <StatTile label="TCO per vehicle" value={money(r.tcoPerVehicle)} icon={Truck} />
            <StatTile label="Residual recovered" value={money(r.residualValue)} icon={Coins} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Cost breakdown" description={`Lifetime ${money(r.totalTco)} across ${r.vehicles.toLocaleString()} vehicle(s), ${r.ownershipYears} yr`} />
              <div className="h-56" role="img" aria-label={`Cost breakdown: ${r.breakdown.map((b) => `${b.name} ${b.value}`).join(', ') || 'none'}`}>
                {r.breakdown.length
                  ? <Doughnut data={donut} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: LEGEND } }} />
                  : <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">Enter inputs to see costs.</div>}
              </div>
            </Card>
            <Card>
              <CardHeader title="Cost per year" />
              <div className="h-56">
                {r.projection.length
                  ? <Bar data={proj} options={barOpts} />
                  : <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">Set an ownership period.</div>}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Detail" />
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-6 text-sm">
              {detail.map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-xs text-[var(--text-muted)]">{k}</dt>
                  <dd className="font-semibold tabular-nums text-[var(--text-secondary)]">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[11px] text-[var(--text-muted)] mt-4">
              A what-if estimate for planning; actual TCO varies by vehicle type, duty cycle, region and financing.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE SHELL (loads fleet actuals once for the three actuals tabs)
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'assets', label: 'Assets', icon: List },
  { id: 'benchmarks', label: 'Benchmarks', icon: TrendingUp },
  { id: 'whatif', label: 'What-if calculator', icon: Calculator },
]

export default function TcoCalculator() {
  const { activeCountry, activeCurrency, appSettings } = useSettings()
  const company = appSettings?.company_name || ''
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')

  const [records, setRecords] = useState([])
  const [fleet, setFleet] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [search, setSearch] = useState('')
  const [band, setBand] = useState('all')
  const [vehicleType, setVehicleType] = useState('')
  const [kmFilter, setKmFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const country = activeCountry !== 'All' ? activeCountry : null
      const [recRes, fleetRes] = await Promise.all([
        fetchAllPages((from, to) => tyreApi.listTcoActualRecords({ country, from, to }), { max: 50000 }),
        tyreApi.listTcoFleet(),
      ])
      if (recRes.error) throw recRes.error
      if (fleetRes.error) throw fleetRes.error
      setRecords(recRes.data || [])
      setFleet(fleetRes.data || [])
      setTruncated(!!recRes.truncated)
      setUpdatedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load fleet TCO data.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const actuals = useMemo(() => computeFleetActuals(records, { fleet }), [records, fleet])
  const canonicalCpk = useMemo(() => computeCpkFleet(records), [records])
  const measuredCost = useMemo(() => hasMeasuredTyreCost(records), [records])
  const kmCoverage = useMemo(() => recordKmCoverage(records), [records])
  const { assets, rollup, monthly, breakdown, benchmarks, meta } = actuals
  const savings = useMemo(() => savingsView(actuals.savings, { measuredCost }), [actuals.savings, measuredCost])
  const aKpis = useMemo(() => assetKpis(assets), [assets])
  const typeOptions = useMemo(() => vehicleTypeOptions(assets), [assets])
  const filteredAssets = useMemo(() => filterAssets(assets, { search, band, vehicleType, km: kmFilter }), [assets, search, band, vehicleType, kmFilter])

  const money = (v) => (v == null ? 'N/A' : formatCurrencyCompact(v, activeCurrency))
  const cpkStr = (v) => (v == null ? 'N/A' : `${formatCurrency(v, activeCurrency, 3)}/km`)

  const runExport = async (format, which) => {
    setActionError('')
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await loadExportUtils()
      const bench = which === 'benchmarks'
      const cols = bench ? BENCHMARK_EXPORT_COLUMNS : ASSET_EXPORT_COLUMNS
      const rows = bench ? benchmarkExportRows(benchmarks) : assetExportRows(filteredAssets)
      const title = bench ? 'TCO GCC Benchmarks' : 'Fleet Actuals Per-Asset TCO'
      const file = reportFileName(title)
      if (format === 'pdf') await exportToPdf(rows, cols, title, file, 'landscape', company, { meta: { Currency: activeCurrency || 'N/A' } })
      else await exportToExcel(rows, cols.map((c) => c.key), cols.map((c) => c.header), file, bench ? 'Benchmarks' : 'Per-Asset TCO')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const assetColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorFn: (a) => a.asset_no, size: 120,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no}</span> },
    { id: 'vehicle_type', header: 'Vehicle type', accessorFn: (a) => a.vehicle_type || undefined, sortUndefined: 'last', size: 140,
      cell: ({ row }) => row.original.vehicle_type || 'N/A' },
    { id: 'tyre_procurement', header: 'Tyre spend', accessorFn: (a) => a.tyre_procurement, meta: { align: 'right' }, size: 120,
      cell: ({ row }) => <span className="font-mono">{formatCurrencyCompact(row.original.tyre_procurement, activeCurrency)}</span> },
    { id: 'km', header: 'Km', accessorFn: (a) => (a.km > 0 ? a.km : undefined), sortUndefined: 'last', meta: { align: 'right' }, size: 110,
      cell: ({ row }) => <span className="font-mono">{row.original.km > 0 ? row.original.km.toLocaleString() : 'N/A'}</span> },
    { id: 'cost_per_km', header: 'Cost/km', accessorFn: (a) => a.cost_per_km ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 130,
      cell: ({ row }) => <span className="font-mono">{cpkStr(row.original.cost_per_km)}</span> },
    { id: 'percentile', header: 'Percentile', accessorFn: (a) => a.percentile ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 100,
      cell: ({ row }) => (row.original.percentile == null ? 'N/A' : `P${row.original.percentile}`) },
    { id: 'band', header: 'Band', accessorFn: (a) => (a.band ? CPK_BAND_ORDER.indexOf(a.band) : undefined), sortUndefined: 'last', size: 110,
      meta: { exportValue: (a) => BAND_LABEL[a.band] || 'N/A' },
      cell: ({ row }) => <BandChip band={row.original.band} /> },
    { id: 'tyre_count', header: 'Records', accessorFn: (a) => a.tyre_count, meta: { align: 'right' }, size: 90 },
    { id: 'go', header: '', enableSorting: false, enableHiding: false, size: 40, meta: { export: false },
      cell: () => <ArrowRight size={14} className="text-[var(--text-muted)]" aria-hidden="true" /> },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [activeCurrency])

  const benchColumns = useMemo(() => [
    { id: 'type', header: 'Vehicle type', accessorFn: (b) => b.type, size: 180 },
    { id: 'benchmarkCpk', header: 'Benchmark cost/km', accessorFn: (b) => b.benchmarkCpk, meta: { align: 'right' }, size: 150,
      cell: ({ row }) => <span className="font-mono">{cpkStr(row.original.benchmarkCpk)}</span> },
    { id: 'actualCpk', header: 'Your actual', accessorFn: (b) => b.actualCpk ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 150,
      cell: ({ row }) => <span className="font-mono">{cpkStr(row.original.actualCpk)}</span> },
    { id: 'assetCount', header: 'Assets', accessorFn: (b) => b.assetCount, meta: { align: 'right' }, size: 90 },
    { id: 'variancePct', header: 'Variance', accessorFn: (b) => b.variancePct ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 110,
      cell: ({ row }) => {
        const v = row.original.variancePct
        if (v == null) return <span className="text-[var(--text-muted)]">N/A</span>
        return <span className={v <= 0 ? 'text-green-400' : 'text-red-400'}>{v > 0 ? '+' : ''}{v}% {v <= 0 ? 'under' : 'over'}</span>
      } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [activeCurrency])

  const actualsTab = tab !== 'whatif'
  const noRecords = !loading && !error && records.length === 0
  const hasFilters = search || band !== 'all' || vehicleType || kmFilter !== 'all'

  const doughnut = {
    labels: breakdown.map((b) => b.label),
    datasets: [{ data: breakdown.map((b) => b.amount), backgroundColor: categorical(breakdown.length), borderWidth: 0 }],
  }
  const trendColor = colorAt(0)
  const trend = {
    labels: monthly.map((m) => m.month),
    datasets: [{ label: 'Cost / km', data: monthly.map((m) => m.cpk), borderColor: trendColor, backgroundColor: withAlpha(trendColor, 0.15), spanGaps: false, tension: 0.3, pointRadius: 3, fill: true }],
  }
  const lineOpts = {
    responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
    scales: { x: { ticks: TICK, grid: { display: false } }, y: { ticks: TICK, grid: GRID, beginAtZero: true } },
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Total Cost of Ownership"
        subtitle="Actual per-asset tyre cost of ownership from fleet data, plus a what-if ownership model."
        icon={Wallet}
        onRefresh={actualsTab ? load : undefined}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      <div role="tablist" aria-label="TCO views" className="flex flex-wrap items-center gap-1 border-b border-[var(--input-border)]">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button key={t.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-t ${active ? 'border-brand-bright text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Icon size={15} aria-hidden="true" /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'whatif' ? <WhatIfCalculator currency={activeCurrency} company={company} /> : (
        <div className="space-y-4">
          {error && (
            <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }} role="alert">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-300">Could not load fleet TCO data</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
              </div>
              <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]"><RotateCcw size={13} aria-hidden="true" /> Retry</button>
            </Card>
          )}
          {actionError && <p role="alert" className="text-sm text-red-400">{actionError}</p>}
          {activeCountry === 'All' && !error && (
            <WarnNote>Mixed currencies: tyre cost of ownership across countries is shown under one currency label. Pick a country for a single-currency total.</WarnNote>
          )}
          {truncated && (
            <WarnNote>Capped view: only the most recent 50,000 tyre records were loaded. Figures may be incomplete. Narrow the country to see full detail.</WarnNote>
          )}
          {!loading && !error && records.length > 0 && !measuredCost && (
            <WarnNote>No tyre record in scope carries a price, so spend figures are unmeasured and the savings model uses an assumed average tyre cost.</WarnNote>
          )}

          {loading ? (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3" aria-busy="true" aria-label="Loading fleet TCO data">
              {[0, 1, 2, 3].map((i) => <Card key={i}><div className="h-20 bg-[var(--input-bg)] rounded animate-pulse" /></Card>)}
            </div>
          ) : error ? null : noRecords ? (
            <Card className="flex-col items-center justify-center text-center gap-2" style={{ paddingBlock: '5rem' }}>
              <Truck className="h-10 w-10 text-[var(--text-muted)]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--text-secondary)]">No tyre records for this scope</p>
              <p className="text-xs text-[var(--text-muted)] max-w-sm">
                Fleet actuals derive from recorded tyre procurement and odometer readings. Add tyre records
                (or widen the country filter) to see per-asset cost of ownership.
              </p>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <StatTile label="Total tyre TCO" value={measuredCost ? money(rollup.total_tco) : 'N/A'} icon={Wallet} tone="accent" sub={`${meta.recordCount.toLocaleString()} records`} />
                <StatTile label="Fleet CPK (canonical)" value={canonicalCpk.validCount ? cpkStr(canonicalCpk.fleetAvgCpk) : 'N/A'} icon={Gauge} tone="info"
                  sub={canonicalCpk.validCount ? `${canonicalCpk.validCount}/${canonicalCpk.totalCount} records with km` : 'No km data'} />
                <StatTile label="Blended cost / km" value={cpkStr(rollup.fleet_cost_per_km)} icon={Activity} sub={`${meta.assetCount} assets`} />
                <StatTile label="Km coverage" value={kmCoverage == null ? 'N/A' : `${kmCoverage}%`} icon={Ruler} tone={kmCoverage != null && kmCoverage < 50 ? 'warn' : 'neutral'} sub="Records with a measurable km run" />
                <StatTile label="Assets poor or critical" value={aKpis.atRisk} icon={AlertTriangle} tone={aKpis.atRisk > 0 ? 'crit' : 'neutral'} sub={`of ${Object.values(aKpis.bands).reduce((s, v) => s + v, 0)} banded assets`} />
                <StatTile label="Savings potential / yr" value={money(savings.total)} icon={PiggyBank} tone="accent" sub={savings.perVehicle == null ? 'No active vehicles' : `${money(savings.perVehicle)} / vehicle`} />
              </div>

              {tab === 'overview' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader title="Tyre spend by position" description={`Actual procurement across ${meta.recordCount.toLocaleString()} records`} />
                      <div className="h-56" role="img" aria-label={`Tyre spend by position: ${breakdown.map((b) => b.label).join(', ') || 'none'}`}>
                        {breakdown.length
                          ? <Doughnut data={doughnut} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: LEGEND } }} />
                          : <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">No costed records.</div>}
                      </div>
                    </Card>
                    <Card>
                      <CardHeader title="Monthly cost per km" description="From removal-month stints; gaps where km is unknown" />
                      <div className="h-56">
                        {monthly.some((m) => m.cpk != null)
                          ? <Line data={trend} options={lineOpts} />
                          : <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">No attributable km by month yet.</div>}
                      </div>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader title="Annual savings potential" icon={PiggyBank}
                      description={`Based on ${savings.vehicleCount} active vehicle(s), ${savings.tyreCount.toLocaleString()} tyres, avg tyre cost ${money(savings.avgTyreCost)}${savings.measuredCost ? ' from recorded prices' : ' (assumed, no recorded price)'}. GCC best-practice assumptions.`}
                      actions={<span className="text-lg font-bold text-green-400 tabular-nums">{money(savings.total)}</span>} />
                    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {savings.initiatives.map((s) => (
                        <li key={s.initiative} className="rounded-lg border border-[var(--border)] p-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-[var(--text-secondary)]">{s.initiative}</p>
                            <span className="text-sm font-bold text-green-400 shrink-0 tabular-nums">{money(s.annual)}</span>
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] mt-1 mb-2">{s.how}</p>
                          <div className="h-1.5 bg-[var(--surface-hover)] rounded-full overflow-hidden" aria-hidden="true">
                            <div className="h-full bg-green-500/70 rounded-full" style={{ width: `${s.sharePct ?? 0}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </>
              )}

              {tab === 'assets' && (
                <Card>
                  <CardHeader title="Per-asset actual TCO" icon={BarChart3}
                    description="Click a row to open the asset. Band compares each asset's cost/km with the fleet average."
                    actions={
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => runExport('excel', 'assets')} disabled={!filteredAssets.length} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[36px]"><FileSpreadsheet size={13} aria-hidden="true" /> Excel</button>
                        <button type="button" onClick={() => runExport('pdf', 'assets')} disabled={!filteredAssets.length} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[36px]"><FileText size={13} aria-hidden="true" /> PDF</button>
                        <EmailPdfButton
                          className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[36px] disabled:opacity-50"
                          disabled={!filteredAssets.length}
                          getPdf={async () => {
                            const { exportToPdf } = await loadExportUtils()
                            return {
                              base64: await exportToPdf(assetExportRows(filteredAssets), ASSET_EXPORT_COLUMNS, 'Fleet Actuals: Per-Asset TCO', 'TyrePulse_FleetActuals_TCO', 'landscape', company, { returnBase64: true }),
                              filename: 'TyrePulse_FleetActuals_TCO.pdf',
                              subject: 'TCO Calculator',
                              bodyHtml: '<p>Attached is the TCO Calculator report.</p>',
                            }
                          }}
                        />
                      </div>
                    } />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,1fr)_auto_auto_auto_auto] items-center gap-2 mb-3">
                    <div className="relative">
                      <label htmlFor="tco-search" className="sr-only">Search assets</label>
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                      <input id="tco-search" className="input pl-9 w-full min-h-[40px]" placeholder="Search asset or vehicle type" value={search} onChange={(e) => setSearch(e.target.value)} />
                    </div>
                    <select className="input min-h-[40px]" value={band} onChange={(e) => setBand(e.target.value)} aria-label="Filter by band">
                      <option value="all">All bands</option>
                      {CPK_BAND_ORDER.map((b) => <option key={b} value={b}>{BAND_LABEL[b]} ({aKpis.bands[b]})</option>)}
                      <option value="none">No band (no km)</option>
                    </select>
                    <select className="input min-h-[40px]" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} aria-label="Filter by vehicle type">
                      <option value="">All vehicle types</option>
                      {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select className="input min-h-[40px]" value={kmFilter} onChange={(e) => setKmFilter(e.target.value)} aria-label="Filter by km coverage">
                      <option value="all">Any km coverage</option>
                      <option value="with">With km ({aKpis.withKm})</option>
                      <option value="without">No km ({aKpis.withoutKm})</option>
                    </select>
                    <div className="flex items-center gap-2 justify-between sm:justify-end">
                      {hasFilters && <button type="button" onClick={() => { setSearch(''); setBand('all'); setVehicleType(''); setKmFilter('all') }} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]"><X size={14} aria-hidden="true" /> Clear</button>}
                      <span className="text-xs text-[var(--text-muted)] whitespace-nowrap" aria-live="polite">{filteredAssets.length} of {assets.length}</span>
                    </div>
                  </div>
                  <EnterpriseTable
                    columns={assetColumns}
                    data={filteredAssets}
                    getRowId={(a) => String(a.asset_no)}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableExport={false}
                    viewKey="tco-assets"
                    initialPageSize={25}
                    onRowClick={(a) => navigate(`/asset-management/${encodeURIComponent(a.asset_no)}`)}
                    emptyMessage="No assets match these filters."
                  />
                  <p className="text-[11px] text-[var(--text-muted)] mt-2">
                    Bands: {bandLegend().map((b) => (b.ceiling == null ? `${b.label} above` : `${b.label} up to ${b.ceiling}x`)).join(', ')} the fleet average cost/km.
                  </p>
                </Card>
              )}

              {tab === 'benchmarks' && (
                <Card>
                  <CardHeader title="GCC industry benchmarks" icon={TrendingUp}
                    description="Your fleet's actual cost/km vs GCC Fleet Management Association reference values, by vehicle type."
                    actions={
                      <div className="flex gap-2">
                        <button type="button" onClick={() => runExport('excel', 'benchmarks')} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[36px]"><FileSpreadsheet size={13} aria-hidden="true" /> Excel</button>
                        <button type="button" onClick={() => runExport('pdf', 'benchmarks')} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[36px]"><FileText size={13} aria-hidden="true" /> PDF</button>
                      </div>
                    } />
                  <EnterpriseTable
                    columns={benchColumns}
                    data={benchmarks}
                    getRowId={(b) => b.type}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableExport={false}
                    initialPageSize={25}
                    emptyMessage="No benchmarks available."
                  />
                  <p className="text-[11px] text-[var(--text-muted)] mt-2">
                    A benchmark shows N/A for your actual when no asset of that vehicle type has a measurable km run.
                  </p>
                </Card>
              )}

              <p className="text-[11px] text-[var(--text-muted)]">
                Actuals cover recorded TYRE cost only. Labour, fuel and depreciation have no per-asset source in this
                dataset and are shown in the What-if calculator instead; they are not estimated here.
                Tyre cost of ownership here is summed per asset from tyre_records (cost_per_tyre); for a governed
                fleet-wide tyre spend total, use the expense grid on the cost pages.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
