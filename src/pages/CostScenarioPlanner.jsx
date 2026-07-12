/**
 * CostScenarioPlanner (route /cost-scenario-planner) — an executive what-if tool
 * that compares several tyre-strategy scenarios (e.g. Premium new, Budget new,
 * Retread-heavy mix) side by side over a planning horizon: annual cost, CPK and
 * savings vs a baseline. Pure client-side model (`src/lib/costScenario.js`);
 * money is shown in the active currency. No new data required — the user supplies
 * the shared fleet scope on the left and edits scenarios on the right.
 */
import { useState, useMemo } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  SlidersHorizontal, Plus, Trash2, RotateCcw, TrendingDown, Trophy, Gauge, Layers,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  computeScenarios, DEFAULT_SCENARIOS, SHARED_DEFAULTS, blankScenario,
} from '../lib/costScenario'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend)

// Palette for scenario series (aligned with the app's chart accents).
const SERIES = ['#6366f1', '#22c55e', '#f59e0b', '#0ea5e9', '#a855f7', '#ef4444', '#14b8a6', '#ec4899']

const SHARED_FIELDS = [
  ['Fleet size (vehicles)', 'fleet_size', '1'],
  ['Tyres per vehicle', 'tyres_per_vehicle', '1'],
  ['Annual km per vehicle', 'annual_km_per_vehicle', '1000'],
  ['Planning horizon (years)', 'horizon_years', '1'],
]

const SCENARIO_FIELDS = [
  ['Tyre cost (each)', 'tyre_cost', '10'],
  ['Tyre life (km)', 'tyre_life_km', '1000'],
  ['Retread mix (%)', 'retread_pct', '5'],
  ['Retread cost factor', 'retread_cost_factor', '0.05'],
  ['Maintenance / tyre / yr', 'maintenance_per_tyre_year', '5'],
]

export default function CostScenarioPlanner() {
  const { activeCurrency } = useSettings()
  const [shared, setShared] = useState(() => ({ ...SHARED_DEFAULTS }))
  const [scenarios, setScenarios] = useState(() => DEFAULT_SCENARIOS.map((s) => ({ ...s })))

  const setSharedField = (k, v) => setShared((p) => ({ ...p, [k]: v }))
  const setScenarioField = (i, k, v) =>
    setScenarios((p) => p.map((s, idx) => (idx === i ? { ...s, [k]: v } : s)))
  const addScenario = () =>
    setScenarios((p) => (p.length >= SERIES.length ? p : [...p, blankScenario(`Scenario ${p.length + 1}`)]))
  const removeScenario = (i) => setScenarios((p) => (p.length <= 1 ? p : p.filter((_, idx) => idx !== i)))
  const reset = () => {
    setShared({ ...SHARED_DEFAULTS })
    setScenarios(DEFAULT_SCENARIOS.map((s) => ({ ...s })))
  }

  const r = useMemo(() => computeScenarios(shared, scenarios), [shared, scenarios])
  const money = (v) => formatCurrencyCompact(v, activeCurrency)

  const chartText =
    getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'

  const annualBar = {
    labels: r.rows.map((x) => x.name),
    datasets: [
      {
        label: 'Annual tyre cost',
        data: r.rows.map((x) => x.annualTyreCost),
        backgroundColor: '#6366f1',
        borderRadius: 4,
      },
      {
        label: 'Annual maintenance',
        data: r.rows.map((x) => x.annualMaintenance),
        backgroundColor: '#f59e0b',
        borderRadius: 4,
      },
    ],
  }
  const annualOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
    scales: {
      x: { stacked: true, ticks: { color: chartText }, grid: { display: false } },
      y: { stacked: true, ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
    },
  }

  const horizonLabels = r.rows[0]?.cumulative.map((c) => c.year) ?? []
  const cumulativeLine = {
    labels: horizonLabels,
    datasets: r.rows.map((x, i) => ({
      label: x.name,
      data: x.cumulative.map((c) => c.value),
      borderColor: SERIES[i % SERIES.length],
      backgroundColor: SERIES[i % SERIES.length],
      tension: 0.25,
      pointRadius: 2,
      borderWidth: 2,
    })),
  }
  const lineOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: chartText }, grid: { display: false } },
      y: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
    },
  }

  const bestRow = r.rows.find((x) => x.name === r.bestName)
  const baselineRow = r.rows.find((x) => x.isBaseline)

  const headline = [
    {
      label: 'Best strategy',
      value: r.bestName ?? '—',
      icon: Trophy,
      tone: 'text-green-400',
    },
    {
      label: `Savings vs ${r.baselineName ?? 'baseline'} (${r.horizonYears}y)`,
      value: money(r.savingsVsBaseline),
      icon: TrendingDown,
      tone: r.savingsVsBaseline >= 0 ? 'text-green-400' : 'text-red-400',
      sub: `${r.savingsVsBaselinePct >= 0 ? '−' : '+'}${Math.abs(r.savingsVsBaselinePct)}% annual`,
    },
    {
      label: 'Best CPK',
      value: bestRow ? bestRow.cpk.toFixed(4) : '—',
      icon: Gauge,
      tone: 'text-sky-400',
    },
    {
      label: 'Scenarios compared',
      value: String(r.rows.length),
      icon: Layers,
      tone: 'text-[var(--brand-bright)]',
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cost Scenario Planner"
        subtitle="Compare tyre strategies side by side — annual cost, CPK and savings vs a baseline over your planning horizon."
        icon={SlidersHorizontal}
        actions={
          <button
            onClick={reset}
            className="btn-secondary text-sm inline-flex items-center gap-1.5"
          >
            <RotateCcw size={14} /> Reset
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Shared fleet inputs */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
              Shared fleet scope
            </h3>
            <div className="space-y-3">
              {SHARED_FIELDS.map(([label, key, step]) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input
                    type="number"
                    step={step}
                    className="input w-full font-mono"
                    value={shared[key]}
                    onChange={(e) => setSharedField(key, e.target.value)}
                    min="0"
                  />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-3">
              Applied identically to every scenario so cost differences reflect strategy, not fleet size.
            </p>
          </div>
        </div>

        {/* Scenario editors + results */}
        <div className="lg:col-span-2 space-y-4">
          {/* Headline KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {headline.map((h) => {
              const Icon = h.icon
              return (
                <div key={h.label} className="card">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--text-muted)] truncate">{h.label}</p>
                    <Icon size={15} className={h.tone} />
                  </div>
                  <p className={`text-2xl font-bold mt-1 truncate ${h.tone}`}>{h.value}</p>
                  {h.sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{h.sub}</p>}
                </div>
              )
            })}
          </div>

          {/* Editable scenario cards */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Scenarios</h3>
              <button
                onClick={addScenario}
                disabled={scenarios.length >= SERIES.length}
                className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={13} /> Add scenario
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {scenarios.map((s, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-[var(--border-dim)] p-3 space-y-2"
                  style={{ borderLeft: `3px solid ${SERIES[i % SERIES.length]}` }}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      className="input flex-1 text-sm font-semibold"
                      value={s.name}
                      onChange={(e) => setScenarioField(i, 'name', e.target.value)}
                      placeholder="Scenario name"
                    />
                    <button
                      onClick={() => removeScenario(i)}
                      disabled={scenarios.length <= 1}
                      className="text-[var(--text-muted)] hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Remove scenario"
                      aria-label={`Remove ${s.name || 'scenario'}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {SCENARIO_FIELDS.map(([label, key, step]) => (
                    <div key={key}>
                      <label className="label text-[11px]">{label}</label>
                      <input
                        type="number"
                        step={step}
                        className="input w-full font-mono text-sm"
                        value={s[key]}
                        onChange={(e) => setScenarioField(i, key, e.target.value)}
                        min="0"
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Annual cost by scenario</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Tyre spend + maintenance, per year</p>
              <div className="h-64">
                {r.rows.length ? (
                  <Bar data={annualBar} options={annualOpts} />
                ) : (
                  <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">
                    Add a scenario to compare.
                  </div>
                )}
              </div>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Cumulative spend</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Over the {r.horizonYears}-year horizon</p>
              <div className="h-64">
                {horizonLabels.length ? (
                  <Line data={cumulativeLine} options={lineOpts} />
                ) : (
                  <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">
                    Set a horizon of at least 1 year.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Comparison table */}
          <div className="card overflow-x-auto">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Comparison</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--text-muted)] uppercase border-b border-[var(--border-dim)]">
                  <th className="text-left py-2 pr-3 font-medium">Scenario</th>
                  <th className="text-right py-2 px-3 font-medium">Tyres / yr</th>
                  <th className="text-right py-2 px-3 font-medium">Eff. cost / tyre</th>
                  <th className="text-right py-2 px-3 font-medium">Annual cost</th>
                  <th className="text-right py-2 px-3 font-medium">CPK</th>
                  <th className="text-right py-2 pl-3 font-medium">Savings vs baseline ({r.horizonYears}y)</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr
                    key={row.name + i}
                    className={`border-b border-[var(--border-dim)] ${row.isBest ? 'bg-green-500/5' : ''}`}
                  >
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: SERIES[i % SERIES.length] }}
                        />
                        <span className="font-medium text-[var(--text-secondary)]">{row.name}</span>
                        {row.isBest && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">
                            Best
                          </span>
                        )}
                        {row.isBaseline && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-500/15 text-[var(--text-muted)]">
                            Baseline
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-[var(--text-secondary)]">{row.tyresPerYear}</td>
                    <td className="py-2 px-3 text-right font-mono text-[var(--text-secondary)]">{money(row.effectiveCostPerTyre)}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-[var(--text-primary)]">{money(row.annualCost)}</td>
                    <td className="py-2 px-3 text-right font-mono text-[var(--text-secondary)]">{row.cpk.toFixed(4)}</td>
                    <td
                      className={`py-2 pl-3 text-right font-mono ${
                        row.savingsVsBaselineHorizon > 0
                          ? 'text-green-400'
                          : row.savingsVsBaselineHorizon < 0
                          ? 'text-red-400'
                          : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {row.isBaseline ? '—' : money(row.savingsVsBaselineHorizon)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {baselineRow && (
              <p className="text-[11px] text-[var(--text-muted)] mt-4">
                Baseline is the first scenario ({r.baselineName}). Savings are the difference in total spend over the {r.horizonYears}-year
                horizon. Retread mix reduces the effective replacement cost via the retread cost factor. Estimates are illustrative;
                actuals vary by fleet, region and procurement terms.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
