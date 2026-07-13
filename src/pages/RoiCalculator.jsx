/**
 * RoiCalculator (route /roi-calculator) — ported from tyre_saas. An executive
 * what-if tool that projects the financial return of a proactive tyre-management
 * programme for the fleet. Pure client-side model (`src/lib/tyreRoi.js`); money
 * is shown in the active currency. No new data required.
 */
import { useState, useMemo } from 'react'
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import { Calculator, TrendingUp, DollarSign, Gauge, Clock, RotateCcw } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import { computeTyreRoi, ROI_DEFAULTS } from '../lib/tyreRoi'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#0ea5e9', '#a855f7', '#ef4444']

const FLEET_FIELDS = [
  ['Fleet size (vehicles)', 'fleet_size'],
  ['Avg tyres per vehicle', 'avg_tyres_per_vehicle'],
  ['Avg daily km per vehicle', 'daily_km_per_vehicle'],
  ['Avg tyre cost', 'avg_tyre_cost'],
  ['Avg tyre life (km)', 'avg_tyre_life_km'],
]
const PERF_FIELDS = [
  ['Current CPKM', 'current_cpkm'],
  ['Downtime incidents / year', 'downtime_incidents_per_year'],
  ['Cost per incident', 'downtime_cost_per_incident'],
  ['Retread adoption (%)', 'retread_adoption_pct'],
]

export default function RoiCalculator() {
  const { activeCurrency } = useSettings()
  const [inputs, setInputs] = useState(() => ({ ...ROI_DEFAULTS }))
  const set = (k, v) => setInputs((p) => ({ ...p, [k]: v }))
  const reset = () => setInputs({ ...ROI_DEFAULTS })

  const r = useMemo(() => computeTyreRoi(inputs), [inputs])
  const money = (v) => formatCurrencyCompact(v, activeCurrency)

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donut = {
    labels: r.breakdown.map((b) => b.name),
    datasets: [{ data: r.breakdown.map((b) => b.value), backgroundColor: COLORS, borderWidth: 0 }],
  }
  const proj = {
    labels: r.projection.map((p) => p.year),
    datasets: [
      { label: 'Cumulative savings', data: r.projection.map((p) => p.savings), backgroundColor: '#22c55e', borderRadius: 4 },
      { label: 'Cumulative cost', data: r.projection.map((p) => p.cost), backgroundColor: '#ef4444', borderRadius: 4 },
      { label: 'Cumulative net benefit', data: r.projection.map((p) => p.net), backgroundColor: '#38bdf8', borderRadius: 4 },
    ],
  }
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
    scales: { x: { ticks: { color: chartText }, grid: { display: false } }, y: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } } },
  }

  const headline = [
    { label: 'Net annual benefit', value: money(r.netAnnualBenefit), icon: DollarSign, tone: r.netAnnualBenefit >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: 'ROI', value: `${r.roi}%`, icon: TrendingUp, tone: 'text-[var(--brand-bright)]' },
    { label: 'Payback', value: r.paybackMonths == null ? '—' : `${r.paybackMonths} mo`, icon: Clock, tone: 'text-amber-400' },
    { label: 'Improved CPKM', value: `${r.improvedCpkm} (−${r.cpkmImprovementPct}%)`, icon: Gauge, tone: 'text-sky-400' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Programme ROI Calculator"
        subtitle="Model the financial return of proactive tyre management across your fleet."
        icon={Calculator}
        actions={<button onClick={reset} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RotateCcw size={14} /> Reset</button>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Inputs */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Fleet configuration</h3>
            <div className="space-y-3">
              {FLEET_FIELDS.map(([label, key]) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input type="number" className="input w-full font-mono" value={inputs[key]} onChange={(e) => set(key, e.target.value)} min="0" />
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Current performance</h3>
            <div className="space-y-3">
              {PERF_FIELDS.map(([label, key]) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input type="number" step={key === 'current_cpkm' ? '0.001' : '1'} className="input w-full font-mono" value={inputs[key]} onChange={(e) => set(key, e.target.value)} min="0" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {headline.map((h) => {
              const Icon = h.icon
              return (
                <div key={h.label} className="card">
                  <div className="flex items-center justify-between"><p className="text-xs text-[var(--text-muted)]">{h.label}</p><Icon size={15} className={h.tone} /></div>
                  <p className={`text-2xl font-bold mt-1 ${h.tone}`}>{h.value}</p>
                </div>
              )
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Annual savings breakdown</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Total {money(r.totalAnnualSavings)} · programme cost {money(r.programmeAnnualCost)}</p>
              <div className="h-56">{r.breakdown.length ? <Doughnut data={donut} options={{ ...chartOpts, scales: undefined }} /> : <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">Enter inputs to see savings.</div>}</div>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">3-year projection</h3>
              <div className="h-56"><Bar data={proj} options={chartOpts} /></div>
            </div>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Detail</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-6 text-sm">
              {[
                ['Total tyres in scope', r.totalTyres.toLocaleString()],
                ['Current annual tyre cost', money(r.currentAnnualTyreCost)],
                ['Current downtime cost', money(r.currentDowntimeCost)],
                ['Total annual savings', money(r.totalAnnualSavings)],
                ['Programme annual cost', money(r.programmeAnnualCost)],
                ['Net annual benefit', money(r.netAnnualBenefit)],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <span className="text-xs text-[var(--text-muted)]">{k}</span>
                  <span className="font-semibold text-[var(--text-secondary)]">{v}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-4">Estimates use industry-standard coefficients for illustration; actuals vary by fleet, region and programme scope.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
