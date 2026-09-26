/**
 * CostScenarioPlanner (route /cost-scenario-planner): an executive what-if tool
 * that compares several tyre-strategy scenarios (e.g. Premium new, Budget new,
 * Retread-heavy mix) side by side over a planning horizon: annual cost, CPK and
 * savings vs a baseline. Pure client-side model (`src/lib/costScenario.js`);
 * money is shown in the active currency. No new data required: the user supplies
 * the shared fleet scope on the left and edits scenarios on the right.
 *
 * Ranking, input validation, sensitivity and break-even analysis come from the
 * pure engine src/lib/costScenarioAnalytics.js, which calls the SAME
 * computeScenarios model, so every view on this page agrees.
 */
import { useState, useMemo, useEffect } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  SlidersHorizontal, Plus, Trash2, RotateCcw, TrendingDown, Trophy, Gauge, Layers,
  AlertTriangle, FileSpreadsheet, FileText, Info, Target,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import {
  validateInputs, rankScenarios, withPerVehicle, sensitivity, breakEvenRetreadPct, scenarioExportRows,
} from '../lib/costScenarioAnalytics'
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
  const money = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrencyCompact(v, activeCurrency))
  const warnings = useMemo(() => validateInputs(shared, scenarios), [shared, scenarios])
  const ranked = useMemo(() => withPerVehicle(rankScenarios(r), shared), [r, shared])
  const [cheaperOnly, setCheaperOnly] = useState(false)
  const tableRows = useMemo(
    () => (cheaperOnly ? ranked.filter((x) => x.isBaseline || x.savingsVsBaselineHorizon > 0) : ranked),
    [ranked, cheaperOnly],
  )
  const [sensIndex, setSensIndex] = useState(0)
  const [sensPct, setSensPct] = useState(20)
  useEffect(() => { if (sensIndex >= scenarios.length) setSensIndex(0) }, [scenarios.length, sensIndex])
  const sens = useMemo(
    () => sensitivity(shared, scenarios[sensIndex] || scenarios[0] || {}, { pct: sensPct }),
    [shared, scenarios, sensIndex, sensPct],
  )
  const maxSwing = Math.max(1, ...sens.drivers.map((d) => Math.max(Math.abs(d.low ?? 0), Math.abs(d.high ?? 0))))
  const breakEvens = useMemo(
    () => scenarios.slice(1).map((sc) => ({
      name: String(sc?.name || '').trim() || 'Scenario',
      pct: breakEvenRetreadPct(shared, scenarios[0] || {}, sc),
    })),
    [shared, scenarios],
  )
  const blockingWarnings = warnings.filter((w) => w.level === 'error')

  function exportComparison(kind) {
    if (!ranked.length) return
    const rows = scenarioExportRows(ranked, r.horizonYears)
    const keys = ['rank', 'name', 'role', 'tyres_per_year', 'effective_cost_per_tyre', 'annual_tyre_cost', 'annual_maintenance', 'annual_cost', 'horizon_cost', 'cpk', 'delta_to_best', 'savings_vs_baseline']
    const headers = ['Rank', 'Scenario', 'Role', 'Tyres per year', `Eff. cost per tyre (${activeCurrency || 'currency'})`, 'Annual tyre cost', 'Annual maintenance', 'Annual cost', `Cost over ${r.horizonYears} years`, 'CPK', 'Above best (annual)', 'Savings vs baseline (horizon)']
    const fname = reportFileName('TyrePulse', 'Cost scenario comparison')
    if (kind === 'excel') exportToExcel(rows, keys, headers, fname, 'Scenarios')
    else exportToPdf(rows, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Cost Scenario Comparison', fname, 'landscape')
  }

  const columns = useMemo(() => [
    { id: 'rank', header: 'Rank', accessorFn: (x) => x.rank, meta: { align: 'right' }, size: 60 },
    {
      id: 'name', header: 'Scenario', accessorFn: (x) => x.name,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SERIES[row.original.index % SERIES.length] }} />
          <span className="font-medium text-[var(--text-secondary)]">{row.original.name}</span>
          {row.original.isBest && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">Best</span>}
          {row.original.isBaseline && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-500/15 text-[var(--text-muted)]">Baseline</span>}
        </span>
      ),
    },
    { id: 'tyres', header: 'Tyres / yr', accessorFn: (x) => x.tyresPerYear, meta: { align: 'right' } },
    { id: 'eff', header: 'Eff. cost / tyre', accessorFn: (x) => x.effectiveCostPerTyre, meta: { align: 'right' }, cell: ({ getValue }) => money(getValue()) },
    { id: 'annual', header: 'Annual cost', accessorFn: (x) => x.annualCost, meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-semibold">{money(getValue())}</span> },
    { id: 'mix', header: 'Tyre share', accessorFn: (x) => x.tyreSharePct ?? -1, meta: { align: 'right' }, cell: ({ getValue }) => (getValue() < 0 ? 'N/A' : `${getValue()}%`) },
    { id: 'perVeh', header: 'Per vehicle / yr', accessorFn: (x) => x.costPerVehicleYear ?? -1, meta: { align: 'right' }, cell: ({ getValue }) => (getValue() < 0 ? 'N/A' : money(getValue())) },
    { id: 'cpk', header: 'CPK', accessorFn: (x) => x.cpk, meta: { align: 'right' }, cell: ({ getValue }) => Number(getValue()).toFixed(4) },
    { id: 'delta', header: 'Above best', accessorFn: (x) => x.deltaToBest, meta: { align: 'right' }, cell: ({ row }) => (row.original.deltaToBest === 0 ? 'Best' : `${money(row.original.deltaToBest)} (${row.original.deltaToBestPct ?? 'N/A'}%)`) },
    {
      id: 'savings', header: `Savings vs baseline (${r.horizonYears}y)`, accessorFn: (x) => (x.isBaseline ? 0 : x.savingsVsBaselineHorizon), meta: { align: 'right' },
      cell: ({ row }) => {
        const v = row.original.savingsVsBaselineHorizon
        if (row.original.isBaseline) return <span className="text-[var(--text-muted)]">N/A</span>
        return <span className={v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}>{money(v)}</span>
      },
    },
  ], [r.horizonYears, activeCurrency]) // eslint-disable-line react-hooks/exhaustive-deps

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
      value: r.bestName ?? 'N/A',
      icon: Trophy,
      tone: 'text-green-400',
    },
    {
      label: `Savings vs ${r.baselineName ?? 'baseline'} (${r.horizonYears}y)`,
      value: money(r.savingsVsBaseline),
      icon: TrendingDown,
      tone: r.savingsVsBaseline >= 0 ? 'text-green-400' : 'text-red-400',
      sub: `${r.savingsVsBaselinePct >= 0 ? '-' : '+'}${Math.abs(r.savingsVsBaselinePct)}% annual`,
    },
    {
      label: 'Best CPK',
      value: bestRow ? bestRow.cpk.toFixed(4) : 'N/A',
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
        subtitle="Compare tyre strategies side by side: annual cost, CPK and savings vs a baseline over your planning horizon."
        icon={SlidersHorizontal}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportComparison('excel')} disabled={!ranked.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-40">
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportComparison('pdf')} disabled={!ranked.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-40">
              <FileText size={14} /> PDF
            </button>
            <button
              onClick={reset}
              className="btn-secondary text-sm inline-flex items-center gap-1.5"
            >
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        }
      />

      <p className="text-xs text-[var(--text-muted)] flex items-start gap-2">
        <Info size={14} className="mt-0.5 shrink-0" />
        A planning model, not a report of your fleet. Figures are in the unit you type and are labelled {activeCurrency || 'with no currency'}; nothing is converted or drawn from recorded tyre spend. For measured cost per km use CPK Intelligence.
      </p>

      {warnings.length > 0 && (
        <div className={`card border ${blockingWarnings.length ? 'border-red-500/40' : 'border-amber-500/40'}`}>
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
            <AlertTriangle size={15} className={blockingWarnings.length ? 'text-red-400' : 'text-amber-400'} />
            Input checks ({warnings.length})
          </h3>
          <ul className="space-y-1 text-xs">
            {warnings.map((w, i) => (
              <li key={i} className={w.level === 'error' ? 'text-red-400' : 'text-amber-400'}>
                <span className="font-semibold">{w.name}:</span> {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

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
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Comparison (cheapest first)</h3>
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <input type="checkbox" checked={cheaperOnly} onChange={(e) => setCheaperOnly(e.target.checked)} />
                Only scenarios cheaper than the baseline
              </label>
            </div>
            <EnterpriseTable
              columns={columns}
              data={tableRows}
              getRowId={(x) => `${x.index}`}
              enableExport={false}
              searchPlaceholder="Search scenarios"
              emptyMessage={cheaperOnly ? 'No scenario is cheaper than the baseline.' : 'Add a scenario to compare.'}
              initialPageSize={25}
            />
            {baselineRow && (
              <p className="text-[11px] text-[var(--text-muted)] mt-4">
                Baseline is the first scenario ({r.baselineName}). Savings are the difference in total spend over the {r.horizonYears}-year
                horizon. Retread mix reduces the effective replacement cost via the retread cost factor. Estimates are illustrative;
                actuals vary by fleet, region and procurement terms.
              </p>
            )}
          </div>

          {/* Sensitivity + break-even */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5"><Gauge size={15} /> Sensitivity</h3>
                <div className="flex items-center gap-2">
                  <select aria-label="Scenario for sensitivity" className="input text-xs py-1" value={sensIndex} onChange={(e) => setSensIndex(Number(e.target.value))}>
                    {scenarios.map((sc, i) => <option key={i} value={i}>{sc.name || `Scenario ${i + 1}`}</option>)}
                  </select>
                  <select aria-label="Sensitivity range" className="input text-xs py-1" value={sensPct} onChange={(e) => setSensPct(Number(e.target.value))}>
                    {[10, 20, 30].map((p) => <option key={p} value={p}>plus or minus {p}%</option>)}
                  </select>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Change in annual cost when one input moves by {sensPct}% and everything else stays put. Base {money(sens.base)}.
              </p>
              <div className="space-y-2">
                {sens.drivers.map((d) => (
                  <div key={d.key}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">{d.label}</span>
                      <span className="font-mono text-[var(--text-muted)]">
                        {d.swing == null ? d.note || 'N/A' : `${money(d.low)} / ${money(d.high)}`}
                      </span>
                    </div>
                    {d.swing != null && (
                      <div className="mt-1 flex h-1.5">
                        <div className="w-1/2 flex justify-end">
                          <div className="h-1.5 rounded-l bg-green-500/70" style={{ width: `${Math.round((Math.abs(Math.min(d.low, d.high)) / maxSwing) * 100)}%` }} />
                        </div>
                        <div className="w-1/2">
                          <div className="h-1.5 rounded-r bg-red-500/70" style={{ width: `${Math.round((Math.abs(Math.max(d.low, d.high)) / maxSwing) * 100)}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-1.5"><Target size={15} /> Retread break-even</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                The retread share at which each scenario matches the baseline ({r.baselineName ?? 'N/A'}) on annual cost, keeping its own retread cost factor.
              </p>
              {breakEvens.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">Add a second scenario to compare against the baseline.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {breakEvens.map((b, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="text-[var(--text-secondary)] truncate">{b.name}</span>
                      <span className="font-mono text-xs">
                        {b.pct == null ? <span className="text-red-400">Cannot reach the baseline</span>
                          : b.pct === 0 ? <span className="text-green-400">Already cheaper with no retreads</span>
                          : <span className="text-amber-400">{b.pct}% retread</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
