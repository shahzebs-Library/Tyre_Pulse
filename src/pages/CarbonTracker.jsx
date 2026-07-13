/**
 * CarbonTracker (route /carbon-tracker) — fleet carbon intelligence.
 *
 * Two complementary views, switchable by tab:
 *
 *  • Lifecycle ESG (default) — restored from the tyre_saas ESG model. Scores the
 *    EMBEDDED / lifecycle carbon of the tyre estate (manufacturing, sea-freight
 *    to the UAE, end-of-life), the CO2 AVOIDED by retreading, and the extra CO2
 *    burned running under-inflated tyres, rolling up into a 0–100 ESG score with
 *    a certification-ready flag. Class is derived by joining each tyre's asset to
 *    vehicle_fleet.vehicle_type. Offsets + reduction initiatives are persisted,
 *    org-isolated records (V210). All maths lives in the pure, unit-tested
 *    src/lib/carbon.js (computeLifecycleCarbon).
 *
 *  • Fuel emissions — the existing combustion view: CO2 from distance travelled
 *    per tyre record × the IPCC diesel factor, aggregated by month/site/vehicle.
 *
 * No fabricated data: where a signal is missing the page says so (the retread
 * derivation is labelled when it comes only from free-text reasons), and empty
 * tables show honest states.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Leaf, Gauge, Fuel, Building2, Search, X, Filter, TreePine,
  FileSpreadsheet, FileText, AlertTriangle, Info, Truck, Award, Recycle,
  ShieldCheck, TrendingDown, Plus, Loader2, Trash2, Target, BarChart3,
  Factory, Activity, CircleDollarSign,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  listFuelUsage, getLifecycleCarbonData,
  listOffsets, createOffset, deleteOffset,
  listInitiatives, createInitiative, deleteInitiative,
} from '../lib/api/carbon'
import {
  computeCarbon, treesToOffset, DIESEL_KG_PER_L,
  computeLifecycleCarbon, CO2_FACTORS, KG_CO2_PER_TREE_YEAR,
} from '../lib/carbon'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const WRITE_ROLES = ['Admin', 'Manager', 'Director']

const SITE_PALETTE = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#14b8a6', '#ec4899', '#f97316', '#6366f1', '#84cc16',
]

const PERIODS = [
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '12 months' },
  { value: 0, label: 'All time' },
]

// tonnes, 1 decimal
const asTonnes = (kg) => (kg == null ? 0 : Math.round((kg / 1000) * 10) / 10)
const fmt = (n) => (n == null || !Number.isFinite(n) ? '0' : Math.round(n).toLocaleString())
const cls = (s) => (s || '').replace(/_/g, ' ')

function chartTextColor() {
  return (typeof document !== 'undefined'
    && getComputedStyle(document.documentElement).getPropertyValue('--text-muted')) || '#9ca3af'
}

// ── Page shell: tab switch between the two carbon views ──────────────────────
export default function CarbonTracker() {
  const [tab, setTab] = useState('lifecycle')
  const TABS = [
    { key: 'lifecycle', label: 'Lifecycle ESG', icon: Leaf },
    { key: 'fuel', label: 'Fuel emissions', icon: Fuel },
  ]
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 p-1 bg-[var(--input-bg)] rounded-xl w-fit border border-[var(--input-border)]">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                active ? 'bg-[var(--surface-raised)] text-brand-bright shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>
      {tab === 'lifecycle' ? <LifecycleEsgView /> : <FuelEmissionsView />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LIFECYCLE ESG VIEW (restored tyre_saas model)
 * ═══════════════════════════════════════════════════════════════════════════ */
function LifecycleEsgView() {
  const { activeCountry } = useSettings()
  const { profile } = useAuth()
  const canWrite = WRITE_ROLES.includes(profile?.role)

  const [data, setData] = useState(null) // { tyres, vehicles } | null = loading
  const [offsets, setOffsets] = useState([])
  const [initiatives, setInitiatives] = useState([])
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [period, setPeriod] = useState(12)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const [d, o, i] = await Promise.allSettled([
        getLifecycleCarbonData({ country: activeCountry }),
        listOffsets({ country: activeCountry }),
        listInitiatives({ country: activeCountry }),
      ])
      if (d.status === 'fulfilled') setData(d.value)
      else { setData({ tyres: [], vehicles: [] }); setError(toUserMessage(d.reason, 'Could not load lifecycle carbon data.')) }
      setOffsets(o.status === 'fulfilled' ? o.value : [])
      setInitiatives(i.status === 'fulfilled' ? i.value : [])
      setUpdatedAt(new Date())
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const carbon = useMemo(
    () => computeLifecycleCarbon({
      tyres: data?.tyres || [],
      vehicles: data?.vehicles || [],
      periodDays: (period || 36) * 30, // 0 (all time) → ~3y window
    }),
    [data, period],
  )

  const s = carbon.summary
  const eq = carbon.equivalents
  const fs = carbon.fleetStats
  const loading = data === null
  const hasData = !loading && (fs.totalVehicles > 0 || carbon.tyreBreakdown.length > 0
    || fs.retreadsPeriod > 0 || fs.scrappedPeriod > 0 || fs.newTyresPeriod > 0)

  // ── KPI tiles ──────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Net lifecycle CO₂', value: `${asTonnes(s.totalCo2NetKg)} t`, sub: `${fmt(s.totalCo2GrossKg)} kg gross`, icon: Factory, tone: 'text-red-400' },
    { label: 'CO₂ saved retreading', value: `${asTonnes(s.co2SavedRetreadingKg)} t`, sub: `${fmt(fs.retreadsPeriod)} retreads · ${fmt(eq.treesSavedRetreading)} trees`, icon: Recycle, tone: 'text-green-400' },
    { label: 'Under-inflation CO₂', value: `${asTonnes(s.co2FromUnderinflationKg)} t`, sub: `${fmt(fs.lowPressureCurrently)} low-pressure tyres`, icon: Gauge, tone: 'text-amber-400' },
    { label: 'Scrapped CO₂', value: `${asTonnes(s.co2FromScrappedKg)} t`, sub: `${fmt(fs.scrappedPeriod)} scrapped tyres`, icon: TrendingDown, tone: 'text-blue-400' },
  ]

  // ── Charts ──────────────────────────────────────────────────────────────────
  const chartText = chartTextColor()
  const barOpts = (unit) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c) => `${fmt(c.raw)} ${unit}` } },
    },
    scales: {
      x: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
      y: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
    },
  })

  const classBar = {
    labels: carbon.tyreBreakdown.map((r) => cls(r.applicationClass)),
    datasets: [{ data: carbon.tyreBreakdown.map((r) => r.totalCo2Kg), backgroundColor: '#22c55e', borderRadius: 4 }],
  }
  const trendBar = {
    labels: carbon.monthlyTrend.map((m) => m.label),
    datasets: [{ data: carbon.monthlyTrend.map((m) => m.estimatedCo2Kg), backgroundColor: '#3b82f6', borderRadius: 4 }],
  }

  // ── Export (by-class embedded CO2) ──────────────────────────────────────────
  const EXPORT_COLS = ['applicationClass', 'count', 'co2PerTyreKg', 'totalCo2Kg']
  const EXPORT_HEADERS = ['Vehicle class', 'New tyres', 'CO₂ / tyre (kg)', 'Total CO₂ (kg)']

  const esgTone = s.esgScore >= 70 ? 'text-green-400' : s.esgScore >= 50 ? 'text-amber-400' : 'text-red-400'
  const bandTone = (urgency) => (
    urgency === 'high' ? 'text-red-400' : urgency === 'medium' ? 'text-amber-400'
      : urgency === 'low' ? 'text-yellow-400' : 'text-green-400')

  return (
    <>
      <PageHeader
        title="Carbon Tracker — Lifecycle ESG"
        subtitle="Embedded tyre-lifecycle CO₂, retread savings & ESG score — GCC sustainability reporting."
        icon={Leaf}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <select className="input" value={period} onChange={(e) => setPeriod(Number(e.target.value))} aria-label="Period">
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button onClick={() => exportToExcel(carbon.tyreBreakdown, EXPORT_COLS, EXPORT_HEADERS, 'carbon_lifecycle')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!carbon.tyreBreakdown.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(carbon.tyreBreakdown, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Carbon Lifecycle ESG', 'carbon_lifecycle', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!carbon.tyreBreakdown.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load carbon data.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* Methodology disclosure */}
      <div className="card border border-amber-700/40 bg-amber-900/10 flex items-start gap-3">
        <Info size={16} className="text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          <span className="font-semibold text-amber-300">Lifecycle model.</span>{' '}
          Embedded CO₂ per new tyre = manufacturing (by vehicle class) + {CO2_FACTORS.transport_to_uae} kg transport-to-UAE + {CO2_FACTORS.end_of_life} kg end-of-life.
          Retreading saves {CO2_FACTORS.retread_saving} kg/tyre; under-inflation adds {CO2_FACTORS.underinflation_per_10k_km} kg per 10,000 km. Vehicle class is
          derived by joining each tyre's asset to <span className="font-mono text-xs">vehicle_fleet.vehicle_type</span>. Trees ≈ 1 per {KG_CO2_PER_TREE_YEAR} kg CO₂/yr.
        </p>
      </div>

      {carbon.retreadFromTextOnly && (
        <div className="card border border-yellow-700/40 bg-yellow-900/10 flex items-start gap-3">
          <AlertTriangle size={16} className="text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-sm text-[var(--text-secondary)]">
            <span className="font-semibold text-yellow-300">Retread signal derived from text.</span>{' '}
            No explicit <span className="font-mono text-xs">retread</span> category was found; retread counts are inferred from free-text removal reasons and should be treated as indicative.
          </p>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 truncate ${k.tone}`}>{loading ? '—' : k.value}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{loading ? '' : k.sub}</p>
            </div>
          )
        })}
      </div>

      {/* ESG scorecard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-muted)]">ESG score</p>
            <Award size={16} className={esgTone} />
          </div>
          <div className="mt-1">
            <p className={`text-4xl font-bold ${esgTone}`}>{loading ? '—' : s.esgScore}<span className="text-lg text-[var(--text-muted)]">/100</span></p>
            <div className="mt-2 h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
              <div className={`h-full rounded-full ${s.esgScore >= 70 ? 'bg-green-500' : s.esgScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.max(0, Math.min(100, s.esgScore))}%` }} />
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium">
              {s.certificationReady
                ? <><ShieldCheck size={15} className="text-green-400" /><span className="text-green-400">Certification-ready</span></>
                : <><AlertTriangle size={15} className="text-amber-400" /><span className="text-amber-400">Below certification threshold (70)</span></>}
            </div>
          </div>
        </div>

        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-2">ESG components</p>
          <ComponentRow label="Retread rate" value={`${s.retreadRatePct}%`} band={carbon.retreadBand.label} tone={bandTone(carbon.retreadBand.urgency)} icon={Recycle} />
          <ComponentRow label="Pressure compliance" value={`${s.pressureCompliancePct}%`} icon={Gauge} />
          <ComponentRow label="Fleet intensity" value={carbon.intensity.fleetIntensityKgPerKm != null ? `${carbon.intensity.fleetIntensityKgPerKm} kg/km` : '—'} band={carbon.intensity.band.band !== 'unknown' ? carbon.intensity.band.label : 'No fleet-km data'} tone={bandTone(carbon.intensity.band.urgency)} icon={Activity} last />
        </div>

        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-2">Reduction vs prior period</p>
          <div className="flex items-center gap-2">
            <TrendingDown size={22} className={carbon.reductionVsPriorPct != null && carbon.reductionVsPriorPct > 0 ? 'text-green-400' : 'text-[var(--text-muted)]'} />
            <p className="text-3xl font-bold text-[var(--text-primary)]">{carbon.reductionVsPriorPct != null ? `${carbon.reductionVsPriorPct}%` : '—'}</p>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">Last 6 months vs prior 6 months (new-tyre embedded CO₂).</p>
          <div className="mt-3 pt-3 border-t border-[var(--input-border)] grid grid-cols-3 gap-2 text-center">
            <Equiv icon={TreePine} tone="text-red-400" value={fmt(eq.treesEmitted)} label="trees emitted" />
            <Equiv icon={TreePine} tone="text-green-400" value={fmt(eq.treesSavedRetreading)} label="trees saved" />
            <Equiv icon={Truck} tone="text-blue-400" value={fmt(eq.drivingEquivalentKm)} label="km driving-equiv" />
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Embedded CO₂ by vehicle class (kg)</h3>
          <div className="h-64">
            {loading ? <ChartSkeleton />
              : carbon.tyreBreakdown.length ? <Bar data={classBar} options={barOpts('kg CO₂')} />
                : <EmptyChart empty="No new tyres in this period." />}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Monthly embedded CO₂ (last 12 months, kg)</h3>
          <div className="h-64">
            {loading ? <ChartSkeleton />
              : carbon.monthlyTrend.some((m) => m.estimatedCo2Kg > 0) ? <Bar data={trendBar} options={barOpts('kg CO₂')} />
                : <EmptyChart empty="No dated tyre issues to trend." />}
          </div>
        </div>
      </div>

      {/* By-class emissions table (lifetime odometer × per-km factor) */}
      <div className="card overflow-hidden !p-0">
        <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
          <BarChart3 size={15} className="text-brand-bright" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Operational emissions by class</h3>
          <span className="text-xs text-[var(--text-muted)] ml-auto">lifetime odometer × per-km factor</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Vehicle class', 'Vehicles', 'Total km', 'Factor (kg/km)', 'CO₂ (kg)', 'CO₂ (t)'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2].map((i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                ))
              ) : carbon.byClassEmissions.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-[var(--text-muted)]"><Truck size={22} className="mx-auto mb-2 opacity-60" />No active vehicles with odometer data.</td></tr>
              ) : (
                carbon.byClassEmissions.map((r) => (
                  <tr key={r.applicationClass} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] capitalize">{cls(r.applicationClass)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{fmt(r.vehicles)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{fmt(r.km)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-muted)] tabular-nums">{r.emissionsFactor}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{fmt(r.co2Kg)}</td>
                    <td className="px-4 py-2.5 font-semibold text-red-400 tabular-nums">{r.co2Tonnes}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && !hasData && (
        <div className="card text-center py-12">
          <Leaf size={28} className="mx-auto mb-2 text-[var(--text-muted)] opacity-60" />
          <p className="text-[var(--text-secondary)] font-medium">No lifecycle carbon signal for this scope.</p>
          <p className="text-sm text-[var(--text-muted)] mt-1">Add tyre records and fleet vehicles, or widen the period, to populate the ESG model.</p>
        </div>
      )}

      {/* Offsets ledger */}
      <OffsetsPanel
        offsets={offsets}
        canWrite={canWrite}
        activeCountry={activeCountry}
        onChange={async () => setOffsets(await listOffsets({ country: activeCountry }).catch(() => []))}
      />

      {/* Reduction initiatives */}
      <InitiativesPanel
        initiatives={initiatives}
        canWrite={canWrite}
        activeCountry={activeCountry}
        onChange={async () => setInitiatives(await listInitiatives({ country: activeCountry }).catch(() => []))}
      />
    </>
  )
}

function ComponentRow({ label, value, band, tone, icon: Icon, last }) {
  return (
    <div className={`flex items-center gap-2 py-2 ${last ? '' : 'border-b border-[var(--input-border)]/50'}`}>
      <Icon size={14} className="text-[var(--text-muted)] shrink-0" />
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <span className="ml-auto text-sm font-semibold text-[var(--text-primary)] tabular-nums">{value}</span>
      {band && <span className={`text-[10px] px-1.5 py-0.5 rounded ${tone} bg-[var(--input-bg)] whitespace-nowrap`}>{band}</span>}
    </div>
  )
}

function Equiv({ icon: Icon, tone, value, label }) {
  return (
    <div>
      <Icon size={15} className={`mx-auto ${tone}`} />
      <p className="text-sm font-bold text-[var(--text-primary)] tabular-nums mt-0.5">{value}</p>
      <p className="text-[10px] text-[var(--text-muted)] leading-tight">{label}</p>
    </div>
  )
}

// ── Offsets panel ─────────────────────────────────────────────────────────────
function OffsetsPanel({ offsets, canWrite, activeCountry, onChange }) {
  const [form, setForm] = useState({ provider: '', project: '', tonnes: '', aed_cost: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const totalTonnes = offsets.reduce((sum, o) => sum + (Number(o.tonnes) || 0), 0)
  const totalAed = offsets.reduce((sum, o) => sum + (Number(o.aed_cost) || 0), 0)

  const submit = async (e) => {
    e.preventDefault(); setMsg('')
    if (!form.tonnes || Number(form.tonnes) <= 0) { setMsg('Tonnes must be greater than zero.'); return }
    setBusy(true)
    try {
      await createOffset({ ...form, country: activeCountry !== 'All' ? activeCountry : undefined })
      setForm({ provider: '', project: '', tonnes: '', aed_cost: '' })
      await onChange()
    } catch (err) {
      setMsg(toUserMessage(err, 'Could not add offset (carbon ESG tables may need migration V210).'))
    } finally { setBusy(false) }
  }

  const remove = async (id) => {
    setBusy(true); setMsg('')
    try { await deleteOffset(id); await onChange() }
    catch (err) { setMsg(toUserMessage(err, 'Could not remove offset.')) }
    finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <TreePine size={16} className="text-green-400" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Carbon offsets ledger</h3>
        {offsets.length > 0 && (
          <span className="text-xs text-[var(--text-muted)] ml-auto">
            {totalTonnes.toFixed(2)} t · <CircleDollarSign size={11} className="inline -mt-0.5" /> AED {fmt(totalAed)}
          </span>
        )}
      </div>

      {canWrite && (
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
          <input className="input" placeholder="Provider (e.g. Verra)" value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} />
          <input className="input" placeholder="Project" value={form.project} onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))} />
          <input className="input" type="number" min="0.1" step="0.1" placeholder="Tonnes" value={form.tonnes} onChange={(e) => setForm((f) => ({ ...f, tonnes: e.target.value }))} required />
          <input className="input" type="number" min="0" step="1" placeholder="AED cost (optional)" value={form.aed_cost} onChange={(e) => setForm((f) => ({ ...f, aed_cost: e.target.value }))} />
          <button type="submit" className="btn-primary text-sm inline-flex items-center justify-center gap-1.5" disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add offset
          </button>
        </form>
      )}

      {msg && <p className="text-sm text-red-400 mb-3">{msg}</p>}

      {offsets.length === 0 ? (
        <div className="py-8 text-center text-[var(--text-muted)]">
          <TreePine size={22} className="mx-auto mb-2 opacity-60" />
          <p className="text-sm">No offset purchases recorded yet.</p>
          {!canWrite && <p className="text-xs mt-1">Offsets are added by Admin, Manager or Director roles.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {offsets.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-md border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-semibold text-[var(--text-primary)] truncate">{o.provider || 'Offset'}</div>
                <div className="text-xs text-[var(--text-muted)] truncate">{[o.project, (o.purchased_at || '').slice(0, 10)].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="text-right shrink-0 flex items-center gap-3">
                <div>
                  <div className="font-mono font-bold text-green-400 tabular-nums">{Number(o.tonnes).toFixed(2)} t</div>
                  <div className="text-xs text-[var(--text-muted)]">AED {fmt(o.aed_cost)}</div>
                </div>
                {canWrite && (
                  <button onClick={() => remove(o.id)} className="text-[var(--text-muted)] hover:text-red-400 transition-colors" aria-label="Remove offset" disabled={busy}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Initiatives panel ─────────────────────────────────────────────────────────
function InitiativesPanel({ initiatives, canWrite, activeCountry, onChange }) {
  const [form, setForm] = useState({ name: '', description: '', claimed_savings_kg: '', owner: '', status: 'active' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const totalKg = initiatives.reduce((sum, i) => sum + (Number(i.claimed_savings_kg) || 0), 0)

  const submit = async (e) => {
    e.preventDefault(); setMsg('')
    if (!form.name.trim()) { setMsg('An initiative name is required.'); return }
    setBusy(true)
    try {
      await createInitiative({ ...form, country: activeCountry !== 'All' ? activeCountry : undefined })
      setForm({ name: '', description: '', claimed_savings_kg: '', owner: '', status: 'active' })
      await onChange()
    } catch (err) {
      setMsg(toUserMessage(err, 'Could not add initiative (carbon ESG tables may need migration V210).'))
    } finally { setBusy(false) }
  }

  const remove = async (id) => {
    setBusy(true); setMsg('')
    try { await deleteInitiative(id); await onChange() }
    catch (err) { setMsg(toUserMessage(err, 'Could not remove initiative.')) }
    finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Target size={16} className="text-brand-bright" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Reduction initiatives</h3>
        {initiatives.length > 0 && <span className="text-xs text-[var(--text-muted)] ml-auto">{asTonnes(totalKg)} t claimed savings</span>}
      </div>

      {canWrite && (
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-4">
          <input className="input md:col-span-2" placeholder="Initiative name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          <input className="input" placeholder="Owner" value={form.owner} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))} />
          <input className="input" type="number" min="0" step="1" placeholder="Saving (kg)" value={form.claimed_savings_kg} onChange={(e) => setForm((f) => ({ ...f, claimed_savings_kg: e.target.value }))} />
          <select className="input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            {['active', 'pilot', 'planned', 'completed', 'on_hold'].map((st) => <option key={st} value={st}>{cls(st)}</option>)}
          </select>
          <button type="submit" className="btn-primary text-sm inline-flex items-center justify-center gap-1.5" disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
          </button>
        </form>
      )}

      {msg && <p className="text-sm text-red-400 mb-3">{msg}</p>}

      {initiatives.length === 0 ? (
        <div className="py-8 text-center text-[var(--text-muted)]">
          <Target size={22} className="mx-auto mb-2 opacity-60" />
          <p className="text-sm">No reduction initiatives recorded yet.</p>
          {!canWrite && <p className="text-xs mt-1">Initiatives are added by Admin, Manager or Director roles.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {initiatives.map((i) => (
            <div key={i.id} className="rounded-md border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[var(--text-primary)] truncate">{i.name}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-brand-subtle text-brand-bright uppercase tracking-wide font-bold shrink-0">{cls(i.status)}</span>
              </div>
              {i.description && <p className="mt-1 text-xs text-[var(--text-muted)] line-clamp-2">{i.description}</p>}
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">{i.owner ? `Owner: ${i.owner}` : '—'}</span>
                <div className="flex items-center gap-2">
                  {i.claimed_savings_kg != null && <span className="font-bold text-green-400 tabular-nums">{asTonnes(i.claimed_savings_kg)} t</span>}
                  {canWrite && (
                    <button onClick={() => remove(i.id)} className="text-[var(--text-muted)] hover:text-red-400 transition-colors" aria-label="Remove initiative" disabled={busy}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
 * FUEL EMISSIONS VIEW (existing port — preserved verbatim)
 * ═══════════════════════════════════════════════════════════════════════════ */
function FuelEmissionsView() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null) // null = never loaded (skeleton)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [period, setPeriod] = useState(12)
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listFuelUsage({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Could not load fuel usage data.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Period-scoped rows (by date). period=0 → all time.
  const scopedRows = useMemo(() => {
    const all = rows || []
    if (!period) return all
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - period)
    cutoff.setHours(0, 0, 0, 0)
    return all.filter((r) => {
      if (!r.date) return false
      const d = new Date(r.date)
      return !Number.isNaN(d.getTime()) && d >= cutoff
    })
  }, [rows, period])

  const carbon = useMemo(() => computeCarbon(scopedRows), [scopedRows])

  const siteOptions = useMemo(
    () => carbon.bySite.map((s) => s.site).sort((a, b) => a.localeCompare(b)),
    [carbon.bySite],
  )

  // Filtered vehicle table (site + free-text search).
  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase()
    return carbon.byVehicle.filter((v) => {
      if (siteFilter && v.site !== siteFilter) return false
      if (q && !`${v.vehicle} ${v.site}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [carbon.byVehicle, siteFilter, search])

  const hasData = (rows?.length ?? 0) > 0 && carbon.totalCo2 > 0
  const topSite = carbon.bySite[0] || null
  const co2PerVehicle = carbon.vehicleCount ? carbon.totalCo2 / carbon.vehicleCount : 0

  // ── KPI tiles ──────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total CO₂', value: `${asTonnes(carbon.totalCo2)} t`, sub: `${fmt(carbon.totalCo2)} kg`, icon: Leaf, tone: 'text-red-400' },
    { label: 'CO₂ / vehicle', value: `${asTonnes(co2PerVehicle)} t`, sub: `${carbon.vehicleCount} vehicles`, icon: Gauge, tone: 'text-amber-400' },
    { label: 'Total diesel', value: `${fmt(carbon.totalLitres)} L`, sub: `${fmt(carbon.totalDistanceKm)} km driven`, icon: Fuel, tone: 'text-blue-400' },
    { label: 'Top-emitting site', value: topSite ? topSite.site : '—', sub: topSite ? `${asTonnes(topSite.co2)} t CO₂` : 'No sites', icon: Building2, tone: 'text-green-400' },
  ]

  // ── Charts ───────────────────────────────────────────────────────────────
  const chartText = chartTextColor()

  const monthBar = {
    labels: carbon.byMonth.map((m) => m.label),
    datasets: [{
      label: 'CO₂ (kg)',
      data: carbon.byMonth.map((m) => m.co2),
      backgroundColor: '#22c55e',
      borderRadius: 4,
    }],
  }
  const topSites = carbon.bySite.slice(0, 10)
  const siteDoughnut = {
    labels: topSites.map((s) => s.site),
    datasets: [{
      data: topSites.map((s) => s.co2),
      backgroundColor: topSites.map((_, i) => SITE_PALETTE[i % SITE_PALETTE.length]),
      borderWidth: 0,
    }],
  }
  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: chartText, boxWidth: 12 } },
      tooltip: { callbacks: { label: (c) => `${fmt(c.raw)} kg CO₂` } },
    },
    scales: {
      x: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
      y: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
    },
  }
  const doughnutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '62%',
    plugins: {
      legend: { position: 'bottom', labels: { color: chartText, boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: (c) => `${c.label}: ${asTonnes(c.raw)} t` } },
    },
  }

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['vehicle', 'site', 'distanceKm', 'litres', 'co2Kg', 'co2Tonnes']
  const EXPORT_HEADERS = ['Vehicle', 'Site', 'Distance (km)', 'Diesel (L)', 'CO₂ (kg)', 'CO₂ (t)']
  const exportRows = filteredVehicles.map((v) => ({
    vehicle: v.vehicle,
    site: v.site,
    distanceKm: '',
    litres: v.litres,
    co2Kg: v.co2,
    co2Tonnes: asTonnes(v.co2),
  }))

  const clearFilters = () => { setSiteFilter(''); setSearch('') }
  const hasFilters = siteFilter || search

  return (
    <>
      <PageHeader
        title="Carbon Tracker — Fuel emissions"
        subtitle="Fleet CO₂ emissions from real fuel usage — IPCC diesel factor, aggregated by month, site and vehicle."
        icon={Fuel}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <select className="input" value={period} onChange={(e) => setPeriod(Number(e.target.value))} aria-label="Period">
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'carbon_tracker')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filteredVehicles.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Carbon Tracker', 'carbon_tracker', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filteredVehicles.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load fuel usage.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* Methodology disclosure */}
      <div className="card border border-amber-700/40 bg-amber-900/10 flex items-start gap-3">
        <Info size={16} className="text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          <span className="font-semibold text-amber-300">Estimate.</span>{' '}
          CO₂ is derived from distance travelled per tyre record and the IPCC diesel factor of{' '}
          <span className="font-semibold">{DIESEL_KG_PER_L} kg/L</span>. Distance is real fleet data; the
          litres-per-km conversion uses a fleet-average consumption assumption.
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 truncate ${k.tone}`}>{rows === null ? '—' : k.value}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{rows === null ? '' : k.sub}</p>
            </div>
          )
        })}
      </div>

      {/* Offset banner */}
      {hasData && (
        <div className="card flex items-center gap-3">
          <TreePine size={18} className="text-green-400 shrink-0" />
          <p className="text-sm text-[var(--text-secondary)]">
            Offsetting this period's emissions would take an estimated{' '}
            <span className="font-semibold text-green-400">{treesToOffset(carbon.totalCo2).toLocaleString()}</span>{' '}
            trees absorbing CO₂ for a year.
          </p>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Monthly CO₂ emissions (kg)</h3>
          <div className="h-64">
            {rows === null ? <ChartSkeleton />
              : carbon.byMonth.length ? <Bar data={monthBar} options={barOpts} />
                : <EmptyChart empty="No dated fuel usage in this period." />}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">CO₂ by site (top 10)</h3>
          <div className="h-64">
            {rows === null ? <ChartSkeleton />
              : topSites.length ? <Doughnut data={siteDoughnut} options={doughnutOpts} />
                : <EmptyChart empty="No site emissions to show." />}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search vehicle or site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filteredVehicles.length} of {carbon.byVehicle.length} vehicles</span>
        </div>
      </div>

      {/* Vehicle emissions table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['#', 'Vehicle', 'Site', 'Diesel (L)', 'CO₂ (kg)', 'CO₂ (t)', 'Share'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                ))
              ) : filteredVehicles.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />{hasData ? 'No vehicles match these filters.' : 'No fuel usage data for the selected period.'}</td></tr>
              ) : (
                filteredVehicles.slice(0, 500).map((v, i) => {
                  const share = carbon.totalCo2 ? (v.co2 / carbon.totalCo2) * 100 : 0
                  return (
                    <tr key={v.vehicle} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 text-[var(--text-muted)] font-mono text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5"><Truck size={13} className="text-[var(--text-muted)]" />{v.vehicle}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{v.site}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{fmt(v.litres)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{fmt(v.co2)}</td>
                      <td className="px-4 py-2.5 font-semibold text-red-400 tabular-nums">{asTonnes(v.co2)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)] tabular-nums">{share.toFixed(1)}%</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filteredVehicles.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>
    </>
  )
}

function EmptyChart({ empty = 'No data.' }) {
  return <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{empty}</div>
}
function ChartSkeleton() {
  return <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
}
