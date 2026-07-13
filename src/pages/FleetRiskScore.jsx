/**
 * FleetRiskScore (route /fleet-risk-score) — per-TYRE safety scoring.
 *
 * PRIMARY view: every live tyre gets a 0–100 composite SAFETY score (higher =
 * safer) from five weighted factors — tread 30, pressure 25, age 20, km 15,
 * inspection 10 — banded critical / high / medium / low, worst-first. Each tyre
 * shows its component sub-scores and the concrete factors dragging it down.
 *
 * SECONDARY tab: a per-vehicle rollup of the SAME scores — each asset banded by
 * its worst tyre — so fleet and workshop teams can triage by vehicle too.
 *
 * All scoring maths live in the pure, unit-tested `src/lib/fleetRisk.js`. Runs
 * entirely on existing `tyre_records` data — no new tables required.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ShieldAlert, ShieldCheck, AlertTriangle, Gauge, Search, X, Filter,
  FileSpreadsheet, FileText, Droplet, Clock, Milestone, ClipboardX, Info,
  Truck, ListChecks, Wind,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  scoreTyres, summarizeTyreRisk, rollupVehicles, RISK_LEVEL_META, RISK_WEIGHTS,
} from '../lib/fleetRisk'
import { getFleetRiskData } from '../lib/api/fleetRisk'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// Safety-band presentation. Lower score = riskier, so critical/high are the alarm bands.
const BAND_STYLES = {
  critical: 'bg-red-900/40 text-red-300 border border-red-700/50',
  high: 'bg-orange-900/40 text-orange-300 border border-orange-700/50',
  medium: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  low: 'bg-green-900/40 text-green-300 border border-green-700/50',
  unknown: 'bg-slate-800/60 text-slate-300 border border-slate-600/50',
}
const scoreColor = (s) => (s >= 75 ? '#22c55e' : s >= 50 ? '#f59e0b' : s >= 25 ? '#f97316' : '#ef4444')

// Component sub-score → gauge metadata (order matches score weighting).
const COMPONENTS = [
  { key: 'tread', label: 'Tread', icon: Droplet },
  { key: 'pressure', label: 'Pressure', icon: Wind },
  { key: 'age', label: 'Age', icon: Clock },
  { key: 'km', label: 'KM', icon: Milestone },
  { key: 'inspection', label: 'Insp', icon: ClipboardX },
]
const FACTOR_LABELS = {
  tread_depth: 'Tread', pressure: 'Pressure', tyre_age: 'Age',
  km_driven: 'Mileage', inspection: 'Inspection',
}

function ScoreBar({ score }) {
  const s = Math.max(0, Math.min(100, Number(score) || 0))
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
        <div className="h-2 rounded-full" style={{ width: `${s}%`, background: scoreColor(s) }} />
      </div>
      <span className="tabular-nums font-semibold text-[var(--text-primary)] w-8 text-right">{score}</span>
    </div>
  )
}

export default function FleetRiskScore() {
  const { activeCountry } = useSettings()
  const [data, setData] = useState(null) // { tyres }
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [view, setView] = useState('tyres') // 'tyres' | 'vehicles'
  const [bandFilter, setBandFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      setData(await getFleetRiskData({ country: activeCountry }))
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Could not load fleet risk data.')
      setData({ tyres: [] })
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Score against the injected reference clock (fleetRisk is pure).
  const tyreRows = useMemo(
    () => (data ? scoreTyres({ tyres: data.tyres || [] }, { now: Date.now() }) : []),
    [data],
  )
  const vehicleRows = useMemo(() => rollupVehicles(tyreRows), [tyreRows])
  const summary = useMemo(() => summarizeTyreRisk(tyreRows), [tyreRows])

  const siteOptions = useMemo(
    () => [...new Set(tyreRows.map((r) => r.site).filter(Boolean))].sort(),
    [tyreRows],
  )

  const filteredTyres = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tyreRows.filter((r) => {
      if (bandFilter !== 'all' && r.risk_level !== bandFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (q) {
        const hay = `${r.serial || ''} ${r.asset_no || ''} ${r.brand || ''} ${r.size || ''} ${r.position || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tyreRows, bandFilter, siteFilter, search])

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase()
    return vehicleRows.filter((r) => {
      if (bandFilter !== 'all' && r.vehicle_risk_level !== bandFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (q && !`${r.asset_no || ''} ${r.site || ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [vehicleRows, bandFilter, siteFilter, search])

  // ── Charts ──
  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const byLevel = summary.by_risk_level
  const donutData = {
    labels: ['Critical', 'High', 'Medium', 'Low'],
    datasets: [{
      data: [byLevel.critical, byLevel.high, byLevel.medium, byLevel.low],
      backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#22c55e'],
      borderWidth: 0,
    }],
  }
  const worst10 = tyreRows.slice(0, 10)
  const barData = {
    labels: worst10.map((r) => r.serial || r.asset_no || '—'),
    datasets: [{
      label: 'Safety score',
      data: worst10.map((r) => r.risk_score),
      backgroundColor: worst10.map((r) => scoreColor(r.risk_score)),
      borderRadius: 4,
    }],
  }
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
      y: { beginAtZero: true, max: 100, ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
    },
  }

  // ── Exports (per active view) ──
  const TYRE_COLS = ['serial', 'asset_no', 'position', 'brand', 'size', 'risk_level', 'score', 'tread', 'pressure', 'age', 'km', 'inspection', 'tread_mm', 'age_years']
  const TYRE_HEADERS = ['Serial', 'Asset', 'Position', 'Brand', 'Size', 'Risk', 'Score', 'Tread', 'Pressure', 'Age', 'KM', 'Insp', 'Tread mm', 'Age yrs']
  const tyreExportRows = filteredTyres.map((r) => ({
    serial: r.serial || '', asset_no: r.asset_no || '', position: r.position || '',
    brand: r.brand || '', size: r.size || '',
    risk_level: RISK_LEVEL_META[r.risk_level]?.label || r.risk_level,
    score: r.risk_score,
    tread: r.component_scores.tread, pressure: r.component_scores.pressure,
    age: r.component_scores.age, km: r.component_scores.km, inspection: r.component_scores.inspection,
    tread_mm: r.tread_depth ?? '', age_years: r.age_years ?? '',
  }))
  const VEH_COLS = ['asset_no', 'site', 'tyre_count', 'worst_score', 'average_score', 'risk_level', 'worst_serial']
  const VEH_HEADERS = ['Asset', 'Site', 'Tyres', 'Worst score', 'Avg score', 'Risk', 'Worst tyre']
  const vehExportRows = filteredVehicles.map((r) => ({
    asset_no: r.asset_no, site: r.site || '', tyre_count: r.tyre_count,
    worst_score: r.worst_score, average_score: r.average_score,
    risk_level: RISK_LEVEL_META[r.vehicle_risk_level]?.label || r.vehicle_risk_level,
    worst_serial: r.worst_tyre?.serial || '',
  }))
  const exportRows = view === 'tyres' ? tyreExportRows : vehExportRows
  const exportCols = view === 'tyres' ? TYRE_COLS : VEH_COLS
  const exportHeaders = view === 'tyres' ? TYRE_HEADERS : VEH_HEADERS
  const exportName = view === 'tyres' ? 'fleet_risk_tyres' : 'fleet_risk_vehicles'

  const kpis = [
    { label: 'Tyres scored', value: summary.total_scored, icon: Gauge, tone: 'text-[var(--text-primary)]' },
    { label: 'Fleet avg', value: summary.total_scored ? summary.fleet_average_score : '—', icon: ShieldCheck, tone: 'text-[var(--brand-bright)]' },
    { label: 'Critical', value: byLevel.critical, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'High', value: byLevel.high, icon: ShieldAlert, tone: 'text-orange-400' },
    { label: 'Medium', value: byLevel.medium, icon: Info, tone: 'text-amber-400' },
    { label: 'Low / safe', value: byLevel.low, icon: ShieldCheck, tone: 'text-green-400' },
  ]

  const clearFilters = () => { setBandFilter('all'); setSiteFilter(''); setSearch('') }
  const hasFilters = bandFilter !== 'all' || siteFilter || search
  const activeCount = view === 'tyres' ? filteredTyres.length : filteredVehicles.length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Risk Score"
        subtitle="Per-tyre 0–100 safety score (higher = safer) from tread, pressure, in-service age, mileage and inspection — banded and ranked worst-first."
        icon={ShieldAlert}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, exportCols, exportHeaders, exportName)} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!exportRows.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, exportCols.map((k, i) => ({ key: k, header: exportHeaders[i] })), 'Fleet Risk Score', exportName, 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!exportRows.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load fleet risk data.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{data === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Weighting + honest caveats */}
      <div className="card border border-[var(--input-border)] flex items-start gap-3">
        <Info size={16} className="text-[var(--brand-bright)] mt-0.5 shrink-0" />
        <div className="text-xs text-[var(--text-muted)] space-y-1">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--text-secondary)]">
            <span><strong>Tread</strong> {RISK_WEIGHTS.tread}%</span>
            <span><strong>Pressure</strong> {RISK_WEIGHTS.pressure}%</span>
            <span><strong>Age</strong> {RISK_WEIGHTS.age}%</span>
            <span><strong>KM</strong> {RISK_WEIGHTS.km}%</span>
            <span><strong>Inspection</strong> {RISK_WEIGHTS.inspection}%</span>
          </div>
          <p>Age uses <strong>in-service</strong> age (since fitment) — the DOT manufacture date is not captured, so tyres stored before fitment read younger than true age. Inspection has no per-tyre inspection-date source, so it applies the engine's neutral default to every tyre. Scores are safety scores: lower is riskier.</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">10 riskiest tyres (lowest safety score)</h3>
          <div className="h-64">{worst10.length ? <Bar data={barData} options={chartOpts} /> : <EmptyChart loading={data === null} empty="No tyres to score yet." />}</div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Risk band distribution</h3>
          <div className="h-64">{summary.total_scored ? <Doughnut data={donutData} options={{ ...chartOpts, scales: undefined }} /> : <EmptyChart loading={data === null} />}</div>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-2">
        <button onClick={() => setView('tyres')} className={`text-sm px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 border transition-colors ${view === 'tyres' ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-transparent text-[var(--text-secondary)] border-[var(--input-border)] hover:border-[var(--brand)]'}`}>
          <ListChecks size={14} /> Per tyre <span className="opacity-70">({tyreRows.length})</span>
        </button>
        <button onClick={() => setView('vehicles')} className={`text-sm px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 border transition-colors ${view === 'vehicles' ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-transparent text-[var(--text-secondary)] border-[var(--input-border)] hover:border-[var(--brand)]'}`}>
          <Truck size={14} /> Per vehicle <span className="opacity-70">({vehicleRows.length})</span>
        </button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder={view === 'tyres' ? 'Search serial, asset, brand, position…' : 'Search asset, site…'} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Risk band">
            <option value="all">All risk bands</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{activeCount} of {view === 'tyres' ? tyreRows.length : vehicleRows.length}</span>
        </div>
      </div>

      {/* Tables */}
      {view === 'tyres'
        ? <TyreTable loading={data === null} rows={filteredTyres} total={tyreRows.length} />
        : <VehicleTable loading={data === null} rows={filteredVehicles} total={vehicleRows.length} />}
    </div>
  )
}

function TyreTable({ loading, rows, total }) {
  return (
    <div className="card overflow-hidden !p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
              {['#', 'Serial', 'Asset', 'Position', 'Tyre', 'Risk', 'Safety score', 'Component scores', 'Top risk factors'].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />{total === 0 ? 'No live tyre data to score yet.' : 'No tyres match these filters.'}</td></tr>
            ) : (
              rows.slice(0, 500).map((r, idx) => (
                <tr key={r.id ?? `${r.serial}-${idx}`} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                  <td className="px-4 py-2.5 text-[var(--text-muted)] tabular-nums">{idx + 1}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.serial || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.position || '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{[r.brand, r.size].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded ${BAND_STYLES[r.risk_level]}`}>{RISK_LEVEL_META[r.risk_level]?.label || r.risk_level}</span></td>
                  <td className="px-4 py-2.5 w-40"><ScoreBar score={r.risk_score} /></td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {COMPONENTS.map((c) => {
                        const v = r.component_scores[c.key]
                        const Icon = c.icon
                        return (
                          <div key={c.key} className="flex flex-col items-center gap-1 w-9" title={`${c.label}: ${v}`}>
                            <Icon size={11} className="text-[var(--text-muted)]" />
                            <div className="w-full h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                              <div className="h-1.5 rounded-full" style={{ width: `${v}%`, background: scoreColor(v) }} />
                            </div>
                            <span className="text-[9px] tabular-nums text-[var(--text-muted)]">{Math.round(v)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1 max-w-[240px]">
                      {r.top_risk_factors.length ? r.top_risk_factors.map((f) => (
                        <span key={f.factor} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)]" title={f.detail}>
                          <AlertTriangle size={9} className="text-amber-400" /> {FACTOR_LABELS[f.factor] || f.factor} <span className="tabular-nums opacity-70">{f.score}</span>
                        </span>
                      )) : <span className="text-xs text-green-400 inline-flex items-center gap-1"><ShieldCheck size={12} /> healthy</span>}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
    </div>
  )
}

function VehicleTable({ loading, rows, total }) {
  return (
    <div className="card overflow-hidden !p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
              {['#', 'Asset', 'Site', 'Tyres', 'Risk', 'Worst tyre score', 'Avg', 'Worst tyre'].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />{total === 0 ? 'No vehicles with live tyres to score yet.' : 'No vehicles match these filters.'}</td></tr>
            ) : (
              rows.slice(0, 500).map((r, idx) => (
                <tr key={r.asset_no} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                  <td className="px-4 py-2.5 text-[var(--text-muted)] tabular-nums">{idx + 1}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.asset_no}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{r.tyre_count}</td>
                  <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded ${BAND_STYLES[r.vehicle_risk_level]}`}>{RISK_LEVEL_META[r.vehicle_risk_level]?.label || r.vehicle_risk_level}</span></td>
                  <td className="px-4 py-2.5 w-44"><ScoreBar score={r.worst_score} /></td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{r.average_score}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                    {r.worst_tyre?.serial
                      ? <span className="font-mono text-xs">{r.worst_tyre.serial}{r.worst_tyre.position ? ` · ${r.worst_tyre.position}` : ''}</span>
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
    </div>
  )
}

function EmptyChart({ loading, empty = 'No data.' }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
      {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : empty}
    </div>
  )
}
