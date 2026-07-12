/**
 * TcoCalculator (route /tco-calculator) — an executive what-if tool that models
 * the Total Cost of Ownership of a fleet across an ownership period: capital
 * depreciation, fuel, maintenance, tyres, insurance and downtime, net of the
 * recovered residual value, with cost-per-km and a per-year cost projection.
 * Pure client-side model (`src/lib/tco.js`); money is shown in the active
 * currency. No data required — the user supplies the inputs.
 */
import { useState, useMemo } from 'react'
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import { Calculator, Wallet, Gauge, Truck, Coins, RotateCcw } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import { computeTco, TCO_DEFAULTS } from '../lib/tco'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend)

// One colour per breakdown component, in the same order computeTco emits them.
const COLORS = ['#6366f1', '#f59e0b', '#22c55e', '#0ea5e9', '#a855f7', '#ef4444']

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

export default function TcoCalculator() {
  const { activeCurrency } = useSettings()
  const [inputs, setInputs] = useState(() => ({ ...TCO_DEFAULTS }))
  const set = (k, v) => setInputs((p) => ({ ...p, [k]: v }))
  const reset = () => setInputs({ ...TCO_DEFAULTS })

  const r = useMemo(() => computeTco(inputs), [inputs])
  const money = (v) => formatCurrencyCompact(v, activeCurrency)

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
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
    <div className="space-y-6">
      <PageHeader
        title="TCO Calculator"
        subtitle="Model the lifetime total cost of ownership of your fleet and its cost per kilometre."
        icon={Calculator}
        actions={<button onClick={reset} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RotateCcw size={14} /> Reset</button>}
      />

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
