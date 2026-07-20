/**
 * TcoCalculator (route /tco-calculator) — Total Cost of Ownership, two tabs:
 *
 *  • Fleet actuals — REAL data. Derives per-asset actual tyre TCO and
 *    cost-per-km from recorded procurement + odometer stints (tyre_records
 *    joined to vehicle_fleet.vehicle_type), the canonical fleet CPK from the
 *    Engineering-KPI engine (kpiEngine.computeCpkFleet — never re-derived here),
 *    a peer percentile + performance band per asset (drill to /assets/:assetNo),
 *    a tyre-spend breakdown, a monthly CPK trend, GCC benchmark comparison and
 *    annual savings potential. Honest '—' wherever km/cost is missing.
 *
 *  • What-if calculator — the executive projection model (pure `src/lib/tco.js`
 *    computeTco): capital depreciation, fuel, maintenance, tyres, insurance and
 *    downtime over an ownership period. Depreciation/fuel/labour live ONLY here
 *    (no per-asset source columns exist for them on the actuals side).
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
  PiggyBank, Download, FileText, Loader2, AlertTriangle, ArrowRight, TrendingUp,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EmailPdfButton from '../components/EmailPdfButton'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact, formatCurrency } from '../lib/formatters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { fetchAllPages } from '../lib/fetchAll'
import * as tyreApi from '../lib/api/tyreRecords'
import { computeCpkFleet } from '../lib/kpiEngine'
import { computeTco, TCO_DEFAULTS, computeFleetActuals } from '../lib/tco'

ChartJS.register(
  ArcElement, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Tooltip, Legend, Filler,
)

// One colour per breakdown component, in the same order computeTco emits them.
const COLORS = ['#6366f1', '#f59e0b', '#22c55e', '#0ea5e9', '#a855f7', '#ef4444']

const BAND_STYLE = {
  excellent: 'text-green-400 bg-green-500/10 border-green-500/30',
  good: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  average: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  poor: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  critical: 'text-red-400 bg-red-500/10 border-red-500/30',
}

function chartMutedColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — FLEET ACTUALS (real data)
// ─────────────────────────────────────────────────────────────────────────────
function FleetActuals() {
  const { activeCountry, activeCurrency } = useSettings()
  const navigate = useNavigate()

  const [records, setRecords] = useState([])
  const [fleet, setFleet] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const country = activeCountry !== 'All' ? activeCountry : null
      const [recRes, fleetRes] = await Promise.all([
        fetchAllPages((from, to) => tyreApi.listTcoActualRecords({ country, from, to })),
        tyreApi.listTcoFleet(),
      ])
      if (recRes.error) throw recRes.error
      if (fleetRes.error) throw fleetRes.error
      setRecords(recRes.data || [])
      setFleet(fleetRes.data || [])
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load fleet TCO data.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const actuals = useMemo(() => computeFleetActuals(records, { fleet }), [records, fleet])
  // Canonical fleet CPK from the Engineering-KPI engine (single source of truth).
  const canonicalCpk = useMemo(() => computeCpkFleet(records), [records])

  const money = (v) => formatCurrencyCompact(v, activeCurrency)
  const cpkStr = (v) => (v == null ? '—' : `${formatCurrency(v, activeCurrency, 3)}/km`)
  const muted = chartMutedColor()

  const { assets, rollup, monthly, breakdown, savings, benchmarks, meta } = actuals

  const doughnut = {
    labels: breakdown.map((b) => b.label),
    datasets: [{ data: breakdown.map((b) => b.amount), backgroundColor: COLORS, borderWidth: 0 }],
  }
  const monthLabels = monthly.map((m) => m.month)
  const trend = {
    labels: monthLabels,
    datasets: [{
      label: 'Cost / km',
      data: monthly.map((m) => m.cpk),
      borderColor: '#0ea5e9',
      backgroundColor: 'rgba(14,165,233,0.15)',
      spanGaps: false,
      tension: 0.3,
      pointRadius: 3,
      fill: true,
    }],
  }
  const lineOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: muted }, grid: { display: false } },
      y: { ticks: { color: muted }, grid: { color: 'rgba(148,163,184,0.12)' }, beginAtZero: true },
    },
  }

  const handleExcel = () => {
    exportToExcel(
      assets,
      ['asset_no', 'vehicle_type', 'tyre_procurement', 'km', 'cost_per_km', 'percentile', 'band', 'tyre_count'],
      ['Asset', 'Vehicle Type', 'Tyre Spend', 'Km', 'Cost/km', 'Percentile', 'Band', 'Records'],
      'TyrePulse_FleetActuals_TCO',
      'Per-Asset TCO',
    )
  }
  const handlePdf = () => {
    exportToPdf(
      assets,
      [
        { key: 'asset_no', header: 'Asset' },
        { key: 'vehicle_type', header: 'Vehicle Type' },
        { key: 'tyre_procurement', header: 'Tyre Spend' },
        { key: 'km', header: 'Km' },
        { key: 'cost_per_km', header: 'Cost/km' },
        { key: 'percentile', header: 'Percentile' },
        { key: 'band', header: 'Band' },
      ],
      'Fleet Actuals — Per-Asset TCO',
      'TyrePulse_FleetActuals_TCO',
      'landscape',
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-9 w-9 animate-spin text-[var(--brand-bright)]" />
        <p className="text-sm text-[var(--text-muted)]">Deriving actual TCO from tyre records…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="card border border-red-500/30 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-300">Could not load fleet TCO data</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
          <button onClick={load} className="btn-secondary text-xs mt-3 inline-flex items-center gap-1.5">
            <RotateCcw size={13} /> Retry
          </button>
        </div>
      </div>
    )
  }
  if (!records.length) {
    return (
      <div className="card flex flex-col items-center justify-center py-20 text-center gap-2">
        <Truck className="h-10 w-10 text-[var(--text-muted)]" />
        <p className="text-sm font-semibold text-[var(--text-secondary)]">No tyre records for this scope</p>
        <p className="text-xs text-[var(--text-muted)] max-w-sm">
          Fleet actuals derive from recorded tyre procurement and odometer readings. Add tyre records
          (or widen the country filter) to see per-asset cost of ownership.
        </p>
      </div>
    )
  }

  const headline = [
    { label: 'Total tyre TCO', value: money(rollup.total_tco), icon: Wallet, tone: 'text-[var(--brand-bright)]' },
    {
      label: 'Fleet CPK (canonical)',
      value: canonicalCpk.validCount ? cpkStr(canonicalCpk.fleetAvgCpk) : '—',
      icon: Gauge,
      tone: 'text-sky-400',
      sub: canonicalCpk.validCount
        ? `${canonicalCpk.validCount}/${canonicalCpk.totalCount} records with km`
        : 'no km data',
    },
    { label: 'Blended cost / km', value: cpkStr(rollup.fleet_cost_per_km), icon: Activity, tone: 'text-amber-400', sub: `${meta.assetCount} assets` },
    { label: 'Savings potential / yr', value: money(savings.total), icon: PiggyBank, tone: 'text-green-400', sub: `${money(savings.perVehicle)} / vehicle` },
  ]

  return (
    <div className="space-y-4">
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {headline.map((h) => {
          const Icon = h.icon
          return (
            <div key={h.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{h.label}</p>
                <Icon size={15} className={h.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${h.tone}`}>{h.value}</p>
              {h.sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{h.sub}</p>}
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Tyre spend by position</h3>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Actual procurement across {meta.recordCount.toLocaleString()} records
          </p>
          <div className="h-56">
            {breakdown.length
              ? <Doughnut data={doughnut} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: muted, boxWidth: 12 } } } }} />
              : <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">No costed records.</div>}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Monthly cost per km</h3>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            From removal-month stints; gaps where km is unknown
          </p>
          <div className="h-56">
            {monthly.some((m) => m.cpk != null)
              ? <Line data={trend} options={lineOpts} />
              : <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">No attributable km by month yet.</div>}
          </div>
        </div>
      </div>

      {/* Per-asset table */}
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
            <BarChart3 size={15} className="text-[var(--brand-bright)]" /> Per-asset actual TCO
          </h3>
          <div className="flex gap-2">
            <button onClick={handleExcel} className="btn-secondary text-xs inline-flex items-center gap-1.5"><Download size={13} /> Excel</button>
            <button onClick={handlePdf} className="btn-secondary text-xs inline-flex items-center gap-1.5"><FileText size={13} /> PDF</button>
            <EmailPdfButton
              className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
              getPdf={async () => ({
                base64: await exportToPdf(
                  assets,
                  [
                    { key: 'asset_no', header: 'Asset' },
                    { key: 'vehicle_type', header: 'Vehicle Type' },
                    { key: 'tyre_procurement', header: 'Tyre Spend' },
                    { key: 'km', header: 'Km' },
                    { key: 'cost_per_km', header: 'Cost/km' },
                    { key: 'percentile', header: 'Percentile' },
                    { key: 'band', header: 'Band' },
                  ],
                  'Fleet Actuals — Per-Asset TCO',
                  'TyrePulse_FleetActuals_TCO',
                  'landscape',
                  '',
                  { returnBase64: true },
                ),
                filename: 'TyrePulse_FleetActuals_TCO.pdf',
                subject: 'TCO Calculator',
                bodyHtml: '<p>Attached is the TCO Calculator report.</p>',
              })}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                {['Asset', 'Vehicle type', 'Tyre spend', 'Km', 'Cost/km', 'Percentile', 'Band', ''].map((h) => (
                  <th key={h} className="py-2 pr-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.slice(0, 50).map((a) => (
                <tr
                  key={a.asset_no}
                  className="border-b border-[var(--border)]/50 hover:bg-[var(--surface-hover)] cursor-pointer"
                  onClick={() => navigate(`/assets/${encodeURIComponent(a.asset_no)}`)}
                >
                  <td className="py-2 pr-3 font-medium text-[var(--text-secondary)]">{a.asset_no}</td>
                  <td className="py-2 pr-3 text-[var(--text-muted)]">{a.vehicle_type || '—'}</td>
                  <td className="py-2 pr-3 font-mono text-[var(--text-secondary)]">{money(a.tyre_procurement)}</td>
                  <td className="py-2 pr-3 font-mono text-[var(--text-muted)]">{a.km > 0 ? a.km.toLocaleString() : '—'}</td>
                  <td className="py-2 pr-3 font-mono text-[var(--text-secondary)]">{cpkStr(a.cost_per_km)}</td>
                  <td className="py-2 pr-3 font-mono text-[var(--text-muted)]">{a.percentile == null ? '—' : `P${a.percentile}`}</td>
                  <td className="py-2 pr-3">
                    {a.band
                      ? <span className={`text-[11px] px-1.5 py-0.5 rounded border capitalize ${BAND_STYLE[a.band] || ''}`}>{a.band}</span>
                      : <span className="text-[var(--text-muted)]">—</span>}
                  </td>
                  <td className="py-2 pr-1 text-[var(--text-muted)]"><ArrowRight size={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {assets.length > 50 && (
          <p className="text-[11px] text-[var(--text-muted)] mt-2">Showing top 50 of {assets.length} assets by spend. Export for the full list.</p>
        )}
      </div>

      {/* Savings potential */}
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
            <PiggyBank size={15} className="text-green-400" /> Annual savings potential
          </h3>
          <span className="text-lg font-bold text-green-400">{money(savings.total)}</span>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Based on {savings.vehicleCount} active vehicle(s), {savings.tyreCount.toLocaleString()} tyres,
          avg tyre cost {money(savings.avgTyreCost)}. GCC best-practice assumptions.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {savings.initiatives.map((s) => {
            const max = Math.max(1, ...savings.initiatives.map((i) => i.annual))
            return (
              <div key={s.initiative} className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">{s.initiative}</p>
                  <span className="text-sm font-bold text-green-400 shrink-0">{money(s.annual)}</span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 mb-2">{s.how}</p>
                <div className="h-1.5 bg-[var(--surface-hover)] rounded-full overflow-hidden">
                  <div className="h-full bg-green-500/70 rounded-full" style={{ width: `${(s.annual / max) * 100}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* GCC benchmarks */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 mb-1">
          <TrendingUp size={15} className="text-sky-400" /> GCC industry benchmarks
        </h3>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Your fleet's actual cost/km vs GCC Fleet Management Association reference values, by vehicle type.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                {['Vehicle type', 'Benchmark cost/km', 'Your actual', 'Assets', 'Variance'].map((h) => (
                  <th key={h} className="py-2 pr-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((b) => (
                <tr key={b.type} className="border-b border-[var(--border)]/50">
                  <td className="py-2 pr-3 text-[var(--text-secondary)]">{b.type}</td>
                  <td className="py-2 pr-3 font-mono text-[var(--text-muted)]">{cpkStr(b.benchmarkCpk)}</td>
                  <td className="py-2 pr-3 font-mono text-[var(--text-secondary)]">{cpkStr(b.actualCpk)}</td>
                  <td className="py-2 pr-3 font-mono text-[var(--text-muted)]">{b.assetCount || '—'}</td>
                  <td className="py-2 pr-3 font-mono">
                    {b.variancePct == null
                      ? <span className="text-[var(--text-muted)]">—</span>
                      : <span className={b.variancePct <= 0 ? 'text-green-400' : 'text-red-400'}>{b.variancePct > 0 ? '+' : ''}{b.variancePct}%</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-muted)]">
        Actuals cover recorded TYRE cost only. Labour, fuel and depreciation have no per-asset source in this
        dataset and are shown in the What-if calculator instead — they are not estimated here.
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — WHAT-IF CALCULATOR (existing model, preserved)
// ─────────────────────────────────────────────────────────────────────────────
const SCOPE_FIELDS = [
  ['Vehicles in fleet', 'vehicle_count', '1'],
  ['Ownership period (years)', 'ownership_years', '1'],
  ['Annual km per vehicle', 'annual_km', '1000'],
]
const CAPITAL_FIELDS = [
  ['Purchase price / vehicle', 'purchase_price', '1000'],
  ['Residual value (% of price)', 'residual_value_pct', '1'],
]
const OPERATING_FIELDS = [
  ['Fuel price / litre', 'fuel_price', '0.1'],
  ['Fuel use (L / 100 km)', 'fuel_consumption', '0.5'],
  ['Maintenance / vehicle / year', 'maintenance_per_year', '500'],
  ['Insurance / vehicle / year', 'insurance_per_year', '500'],
]
const TYRE_FIELDS = [
  ['Tyres per vehicle', 'tyres_per_vehicle', '1'],
  ['Tyre cost (each)', 'tyre_cost', '50'],
  ['Tyre life (km)', 'tyre_life_km', '1000'],
]
const DOWNTIME_FIELDS = [
  ['Downtime days / vehicle / year', 'downtime_days_per_year', '1'],
  ['Downtime cost / day', 'downtime_cost_per_day', '100'],
]

function InputGroup({ title, fields, inputs, set }) {
  return (
    <div className="card">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">{title}</h3>
      <div className="space-y-3">
        {fields.map(([label, key, step]) => (
          <div key={key}>
            <label className="label">{label}</label>
            <input
              type="number"
              step={step}
              min="0"
              className="input w-full font-mono"
              value={inputs[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function WhatIfCalculator() {
  const { activeCurrency } = useSettings()
  const [inputs, setInputs] = useState(() => ({ ...TCO_DEFAULTS }))
  const set = (k, v) => setInputs((p) => ({ ...p, [k]: v }))
  const reset = () => setInputs({ ...TCO_DEFAULTS })

  const r = useMemo(() => computeTco(inputs), [inputs])
  const money = (v) => formatCurrencyCompact(v, activeCurrency)

  const chartText = chartMutedColor()
  const donut = {
    labels: r.breakdown.map((b) => b.name),
    datasets: [{ data: r.breakdown.map((b) => b.value), backgroundColor: COLORS, borderWidth: 0 }],
  }
  const proj = {
    labels: r.projection.map((p) => p.year),
    datasets: [
      { label: 'Operating', data: r.projection.map((p) => p.operating), backgroundColor: '#0ea5e9', borderRadius: 4, stack: 'yr' },
      { label: 'Depreciation', data: r.projection.map((p) => p.depreciation), backgroundColor: '#6366f1', borderRadius: 4, stack: 'yr' },
    ],
  }
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
    scales: {
      x: { stacked: true, ticks: { color: chartText }, grid: { display: false } },
      y: { stacked: true, ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
    },
  }

  const headline = [
    { label: 'Total cost of ownership', value: money(r.totalTco), icon: Wallet, tone: 'text-[var(--brand-bright)]' },
    { label: 'Cost per km', value: `${money(r.costPerKm)}`, icon: Gauge, tone: 'text-sky-400' },
    { label: 'TCO per vehicle', value: money(r.tcoPerVehicle), icon: Truck, tone: 'text-amber-400' },
    { label: 'Residual recovered', value: money(r.residualValue), icon: Coins, tone: 'text-green-400' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={reset} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RotateCcw size={14} /> Reset</button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Inputs */}
        <div className="space-y-4">
          <InputGroup title="Fleet scope" fields={SCOPE_FIELDS} inputs={inputs} set={set} />
          <InputGroup title="Capital" fields={CAPITAL_FIELDS} inputs={inputs} set={set} />
          <InputGroup title="Operating costs" fields={OPERATING_FIELDS} inputs={inputs} set={set} />
          <InputGroup title="Tyres" fields={TYRE_FIELDS} inputs={inputs} set={set} />
          <InputGroup title="Downtime" fields={DOWNTIME_FIELDS} inputs={inputs} set={set} />
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {headline.map((h) => {
              const Icon = h.icon
              return (
                <div key={h.label} className="card">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--text-muted)]">{h.label}</p>
                    <Icon size={15} className={h.tone} />
                  </div>
                  <p className={`text-2xl font-bold mt-1 ${h.tone}`}>{h.value}</p>
                </div>
              )
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Cost breakdown</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Lifetime {money(r.totalTco)} across {r.vehicles.toLocaleString()} vehicle(s) · {r.ownershipYears} yr
              </p>
              <div className="h-56">
                {r.breakdown.length
                  ? <Doughnut data={donut} options={{ ...chartOpts, scales: undefined }} />
                  : <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">Enter inputs to see costs.</div>}
              </div>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Cost per year</h3>
              <div className="h-56">
                {r.projection.length
                  ? <Bar data={proj} options={chartOpts} />
                  : <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">Set an ownership period.</div>}
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Detail</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-6 text-sm">
              {[
                ['Depreciation', money(r.depreciation)],
                ['Fuel', money(r.fuel)],
                ['Maintenance', money(r.maintenance)],
                ['Tyres', money(r.tyres)],
                ['Insurance', money(r.insurance)],
                ['Downtime', money(r.downtime)],
                ['Gross capital', money(r.grossCapital)],
                ['Residual value', money(r.residualValue)],
                ['Net capital cost', money(r.netCapital)],
                ['Lifetime distance', `${r.fleetLifetimeKm.toLocaleString()} km`],
                ['TCO per year', money(r.tcoPerYear)],
                ['Cost per vehicle-km', money(r.costPerVehicleKm)],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <span className="text-xs text-[var(--text-muted)]">{k}</span>
                  <span className="font-semibold text-[var(--text-secondary)]">{v}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-4">
              A what-if estimate for planning; actual TCO varies by vehicle type, duty cycle, region and financing.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE SHELL
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'actuals', label: 'Fleet actuals', icon: BarChart3 },
  { id: 'whatif', label: 'What-if calculator', icon: Calculator },
]

export default function TcoCalculator() {
  const [tab, setTab] = useState('actuals')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Total Cost of Ownership"
        subtitle="Actual per-asset tyre cost of ownership from fleet data, plus a what-if ownership model."
        icon={Wallet}
      />

      <div className="flex gap-1 p-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] w-fit">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`text-sm px-3 py-1.5 rounded-md font-medium inline-flex items-center gap-1.5 transition-colors ${
                active ? 'bg-[var(--brand)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'actuals' ? <FleetActuals /> : <WhatIfCalculator />}
    </div>
  )
}
