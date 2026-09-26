/**
 * RoiCalculator (route /roi-calculator) — ported from tyre_saas. An executive
 * what-if tool that projects the financial return of a proactive tyre-management
 * programme for the fleet. Pure client-side model (`src/lib/tyreRoi.js`); money
 * is shown in the active currency. Fleet size, daily km and current CPKM can be
 * seeded from measured CPK (get_fleet_cpk) for one country; the rest stay
 * labelled assumptions. Scenarios are saved on this device (roiScenarios.js).
 */
import { useState, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import { Calculator, TrendingUp, DollarSign, Gauge, Clock, RotateCcw, Database, Save, Trash2, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import { computeTyreRoi, ROI_DEFAULTS } from '../lib/tyreRoi'
import { getFleetCpk } from '../lib/api/fleetCpk'
import { seedFromFleetCpk, loadScenarios, persistScenarios, upsertScenario, removeScenario, compareScenarios, mixedCurrency } from '../lib/roiScenarios'
import { toUserMessage } from '../lib/safeError'

const SEED_WINDOWS = [[90, 'Last 90 days'], [180, 'Last 180 days'], [365, 'Last 12 months']]
const CMP_COLS = ['name', 'country', 'currency', 'fleet_size', 'current_cpkm', 'savings', 'programme_cost', 'net_benefit', 'roi_pct', 'payback_months']
const CMP_HEADERS = ['Scenario', 'Country', 'Currency', 'Fleet size', 'Current CPKM', 'Annual savings', 'Programme cost', 'Net annual benefit', 'ROI %', 'Payback (months)']
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

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
  const { activeCurrency, activeCountry } = useSettings()
  const [inputs, setInputs] = useState(() => ({ ...ROI_DEFAULTS }))
  const [seeded, setSeeded] = useState({})
  const [seedDays, setSeedDays] = useState(180)
  const [seedState, setSeedState] = useState({ loading: false, error: '', note: '' })
  const [scenarios, setScenarios] = useState(() => loadScenarios())
  const [scenarioName, setScenarioName] = useState('')
  const [scenarioMsg, setScenarioMsg] = useState('')
  const set = (k, v) => { setInputs((p) => ({ ...p, [k]: v })); setSeeded((p) => { if (!p[k]) return p; const n = { ...p }; delete n[k]; return n }) }
  const reset = () => { setInputs({ ...ROI_DEFAULTS }); setSeeded({}); setSeedState({ loading: false, error: '', note: '' }) }
  const singleCountry = activeCountry && activeCountry !== 'All'

  const seedFromData = useCallback(async () => {
    const to = new Date(); const from = new Date(); from.setDate(from.getDate() - seedDays + 1)
    const scope = { country: activeCountry, from: isoDay(from), to: isoDay(to) }
    setSeedState({ loading: true, error: '', note: '' })
    try {
      const cpk = await getFleetCpk({ ...scope, strict: true })
      const seed = seedFromFleetCpk(cpk, scope)
      if (!seed.ok) { setSeedState({ loading: false, error: '', note: seed.reason }); return }
      setInputs((p) => ({ ...p, ...seed.inputs }))
      setSeeded(seed.seeded)
      setSeedState({ loading: false, error: '', note: `Seeded ${Object.keys(seed.inputs).length} input(s) from ${activeCountry} data${seed.coveragePct != null ? `, km coverage ${Math.round(seed.coveragePct)}%` : ''}. Other inputs remain assumptions.` })
    } catch (err) {
      setSeedState({ loading: false, error: toUserMessage(err, 'Measured CPK could not be loaded.'), note: '' })
    }
  }, [activeCountry, seedDays])

  const saveScenario = () => {
    try {
      const next = upsertScenario(scenarios, { name: scenarioName, inputs, country: singleCountry ? activeCountry : null, currency: activeCurrency })
      setScenarios(next); setScenarioName('')
      setScenarioMsg(persistScenarios(next) ? 'Scenario saved on this device.' : 'Saved for this session only. This browser blocked local storage.')
    } catch (err) { setScenarioMsg(toUserMessage(err, 'The scenario could not be saved.')) }
  }
  const deleteScenario = (id) => { const next = removeScenario(scenarios, id); setScenarios(next); persistScenarios(next) }
  const loadScenario = (sc) => { setInputs({ ...ROI_DEFAULTS, ...sc.inputs }); setSeeded({}); setScenarioMsg(`Loaded "${sc.name}".`) }
  const comparison = useMemo(() => compareScenarios(scenarios), [scenarios])
  const exportComparison = async (kind) => {
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await import('../lib/exportUtils')
      const name = reportFileName('ROI Scenarios')
      if (kind === 'excel') await exportToExcel(comparison, CMP_COLS, CMP_HEADERS, name)
      else await exportToPdf(comparison, CMP_COLS.map((k, i) => ({ key: k, header: CMP_HEADERS[i] })), 'ROI Scenarios', name, 'landscape')
    } catch (err) { setScenarioMsg(toUserMessage(err, 'The export could not be created.')) }
  }

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
    { label: 'Payback', value: r.paybackMonths == null ? 'N/A' : `${r.paybackMonths} mo`, icon: Clock, tone: 'text-amber-400' },
    { label: 'Improved CPKM', value: `${r.improvedCpkm} (-${r.cpkmImprovementPct}%)`, icon: Gauge, tone: 'text-sky-400' },
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
          <div className="card space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5"><Database size={13} /> Start from your data</h3>
            <p className="text-xs text-[var(--text-muted)]">Fill fleet size, daily km and current CPKM from measured tyre CPK for {singleCountry ? activeCountry : 'one country'}.</p>
            <div className="flex gap-2">
              <select className="input flex-1" aria-label="Seed period" value={seedDays} onChange={(e) => setSeedDays(Number(e.target.value))}>{SEED_WINDOWS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select>
              <button className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={!singleCountry || seedState.loading} onClick={seedFromData}><RefreshCw size={13} className={seedState.loading ? 'animate-spin' : ''} /> {seedState.loading ? 'Loading' : 'Seed'}</button>
            </div>
            {!singleCountry && <p className="text-xs text-amber-500">Pick one country in the header. Different currencies cannot be combined into one model.</p>}
            {seedState.note && <p className="text-xs text-[var(--text-secondary)]">{seedState.note}</p>}
            {seedState.error && <p className="text-xs text-red-500">{seedState.error} <button className="underline" onClick={seedFromData}>Retry</button></p>}
          </div>
          <div className="card">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Fleet configuration</h3>
            <div className="space-y-3">
              {FLEET_FIELDS.map(([label, key]) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input type="number" className="input w-full font-mono" value={inputs[key]} onChange={(e) => set(key, e.target.value)} min="0" />
                  <p className={`text-[10px] mt-0.5 ${seeded[key] ? 'text-green-500' : 'text-[var(--text-muted)]'}`}>{seeded[key] || 'Assumption'}</p>
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
                  <p className={`text-[10px] mt-0.5 ${seeded[key] ? 'text-green-500' : 'text-[var(--text-muted)]'}`}>{seeded[key] || 'Assumption'}</p>
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
              <p className="text-xs text-[var(--text-muted)] mb-3">Total {money(r.totalAnnualSavings)} | programme cost {money(r.programmeAnnualCost)}</p>
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

          <div className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Saved scenarios</h3>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs inline-flex items-center gap-1" disabled={!comparison.length} onClick={() => exportComparison('excel')}><FileSpreadsheet size={13} /> Excel</button>
                <button className="btn-secondary text-xs inline-flex items-center gap-1" disabled={!comparison.length} onClick={() => exportComparison('pdf')}><FileText size={13} /> PDF</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <input className="input flex-1 min-w-[180px]" aria-label="Scenario name" placeholder="Scenario name" maxLength={80} value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} />
              <button className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={!scenarioName.trim()} onClick={saveScenario}><Save size={13} /> Save current inputs</button>
            </div>
            {scenarioMsg && <p className="text-xs text-[var(--text-secondary)]">{scenarioMsg}</p>}
            {!comparison.length ? <p className="text-xs text-[var(--text-muted)]">No saved scenarios yet. Scenarios are kept on this device.</p> : <>
              {mixedCurrency(comparison) && <p className="text-xs text-amber-500">These scenarios use different currencies. Compare each against its own currency only.</p>}
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-[var(--text-muted)]">{['Scenario', 'Country', 'Fleet', 'Net benefit', 'ROI', 'Payback', ''].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
                <tbody>{comparison.map((c) => { const sc = scenarios.find(x => x.id === c.id); return <tr key={c.id} className="border-t border-[var(--hairline)]">
                  <td className="p-2 font-medium">{c.name}</td><td className="p-2">{c.country}</td><td className="p-2">{c.fleet_size}</td>
                  <td className={`p-2 ${c.net_benefit >= 0 ? 'text-green-500' : 'text-red-500'}`}>{c.currency} {Number(c.net_benefit).toLocaleString()}</td>
                  <td className="p-2">{c.roi_pct}%</td><td className="p-2">{c.payback_months === 'N/A' ? 'N/A' : `${c.payback_months} mo`}</td>
                  <td className="p-2"><div className="flex gap-2 justify-end"><button className="btn-secondary text-xs" onClick={() => loadScenario(sc)}>Load</button><button className="btn-secondary text-xs" aria-label={`Delete ${c.name}`} onClick={() => deleteScenario(c.id)}><Trash2 size={12} /></button></div></td>
                </tr> })}</tbody>
              </table></div>
            </>}
          </div>
        </div>
      </div>
    </div>
  )
}
