/**
 * FleetRiskScore (route /fleet-risk-score) — per-vehicle tyre risk ranking.
 * Every asset gets a 0–100 composite risk score computed from real signals in
 * `tyre_records` (aged tyres, low tread, recent failures, high CPK, missing
 * inspections), so the fleet team sees which vehicles are most at risk and why.
 * Runs entirely on existing data — no new tables required. Scoring maths live in
 * the pure, unit-tested `src/lib/fleetRisk.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ShieldAlert, AlertTriangle, TrendingDown, Gauge, Search, X, Filter,
  FileSpreadsheet, FileText, ChevronRight, Clock, Droplet, Wrench,
  DollarSign, ClipboardX,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import { getFleetRiskData } from '../lib/api/fleetRisk'
import { scoreVehicles, summarizeRisk, RISK_BAND_META } from '../lib/fleetRisk'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const BAND_STYLES = {
  high: 'bg-red-900/40 text-red-300 border border-red-700/50',
  medium: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  low: 'bg-green-900/40 text-green-300 border border-green-700/50',
}
const scoreColor = (s) => (s > 66 ? '#ef4444' : s >= 34 ? '#f59e0b' : '#22c55e')

// Signal → chip metadata. Only chips with a positive count render on a row.
const SIGNAL_CHIPS = [
  { key: 'agedCount', label: 'aged', icon: Clock, tone: 'text-red-300' },
  { key: 'lowTreadCount', label: 'low tread', icon: Droplet, tone: 'text-amber-300' },
  { key: 'recentFailures', label: 'failures', icon: Wrench, tone: 'text-orange-300' },
  { key: 'noInspectionCount', label: 'no inspection', icon: ClipboardX, tone: 'text-slate-300' },
]

export default function FleetRiskScore() {
  const { activeCountry, activeCurrency } = useSettings()
  const navigate = useNavigate()
  const [data, setData] = useState(null) // { tyres, vehicles }
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

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
      setData({ tyres: [], vehicles: [] })
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Score against the injected reference clock (fleetRisk is pure).
  const rows = useMemo(
    () => (data ? scoreVehicles(data, { now: Date.now() }) : []),
    [data],
  )
  const { counts, avgScore, topRisk } = useMemo(() => summarizeRisk(rows), [rows])

  const siteOptions = useMemo(
    () => [...new Set(rows.map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (bandFilter !== 'all' && r.band !== bandFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (q) {
        const hay = `${r.asset_no} ${r.make || ''} ${r.model || ''} ${r.vehicle_type || ''} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, bandFilter, siteFilter, search])

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donutData = {
    labels: ['High', 'Medium', 'Low'],
    datasets: [{
      data: [counts.high, counts.medium, counts.low],
      backgroundColor: ['#ef4444', '#f59e0b', '#22c55e'],
      borderWidth: 0,
    }],
  }
  const barData = {
    labels: topRisk.map((r) => r.asset_no),
    datasets: [{
      label: 'Risk score',
      data: topRisk.map((r) => r.score),
      backgroundColor: topRisk.map((r) => scoreColor(r.score)),
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

  const goToAsset = (assetNo) => navigate(`/assets/${encodeURIComponent(assetNo)}`)

  const EXPORT_COLS = ['asset_no', 'risk_level', 'score', 'vehicle_type', 'site', 'aged', 'low_tread', 'failures', 'no_inspection', 'cpk', 'in_service']
  const EXPORT_HEADERS = ['Asset', 'Risk', 'Score', 'Type', 'Site', 'Aged', 'Low tread', 'Failures', 'No inspection', 'CPK', 'In service']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no,
    risk_level: RISK_BAND_META[r.band]?.label || r.band,
    score: r.score,
    vehicle_type: r.vehicle_type || '',
    site: r.site || '',
    aged: r.signals.agedCount,
    low_tread: r.signals.lowTreadCount,
    failures: r.signals.recentFailures,
    no_inspection: r.signals.noInspectionCount,
    cpk: r.signals.cpk ?? '',
    in_service: r.inServiceCount,
  }))

  const kpis = [
    { label: 'Vehicles scored', value: counts.total, icon: Gauge, tone: 'text-[var(--text-primary)]' },
    { label: 'High risk', value: counts.high, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Medium risk', value: counts.medium, icon: TrendingDown, tone: 'text-amber-400' },
    { label: 'Avg score', value: avgScore == null ? '—' : avgScore, icon: ShieldAlert, tone: 'text-[var(--brand-bright)]' },
  ]

  const clearFilters = () => { setBandFilter('all'); setSiteFilter(''); setSearch('') }
  const hasFilters = bandFilter !== 'all' || siteFilter || search
  const money = (v) => (v == null ? '—' : formatCurrencyCompact(v, activeCurrency))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Risk Score"
        subtitle="Per-vehicle 0–100 tyre risk ranking — aged tyres, low tread, recent failures, high CPK and missing inspections, weighted into one score."
        icon={ShieldAlert}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'fleet_risk_score')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Fleet Risk Score', 'fleet_risk_score', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{data === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Top 10 highest-risk vehicles</h3>
          <div className="h-64">{topRisk.length ? <Bar data={barData} options={chartOpts} /> : <EmptyChart loading={data === null} empty="No vehicles to score yet." />}</div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Risk band distribution</h3>
          <div className="h-64">{counts.total ? <Doughnut data={donutData} options={{ ...chartOpts, scales: undefined }} /> : <EmptyChart loading={data === null} />}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, make, model, type…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Risk band">
            <option value="all">All risk bands</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {counts.total}</span>
        </div>
      </div>

      {/* Ranked table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['#', 'Asset', 'Vehicle', 'Site', 'Risk', 'Score', 'Signals', 'CPK', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />{counts.total === 0 ? 'No vehicle tyre data to score yet.' : 'No vehicles match these filters.'}</td></tr>
              ) : (
                filtered.slice(0, 500).map((r, idx) => {
                  const chips = SIGNAL_CHIPS.filter((c) => (r.signals[c.key] || 0) > 0)
                  return (
                    <tr key={r.asset_no} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 cursor-pointer" onClick={() => goToAsset(r.asset_no)}>
                      <td className="px-4 py-2.5 text-[var(--text-muted)] tabular-nums">{idx + 1}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.asset_no}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{[r.make, r.model].filter(Boolean).join(' ') || r.vehicle_type || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${BAND_STYLES[r.band]}`}>{RISK_BAND_META[r.band]?.label}</span></td>
                      <td className="px-4 py-2.5 w-40">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
                            <div className="h-2 rounded-full" style={{ width: `${r.score}%`, background: scoreColor(r.score) }} />
                          </div>
                          <span className="tabular-nums font-semibold text-[var(--text-primary)] w-7 text-right">{r.score}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {chips.length ? chips.map((c) => {
                            const Icon = c.icon
                            return (
                              <span key={c.key} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--input-bg)] ${c.tone}`}>
                                <Icon size={10} /> {r.signals[c.key]} {c.label}
                              </span>
                            )
                          }) : <span className="text-xs text-[var(--text-muted)]">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                        {r.signals.cpk == null ? '—' : <span className="inline-flex items-center gap-1"><DollarSign size={11} className="text-[var(--text-muted)]" />{money(r.signals.cpk)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right"><ChevronRight size={16} className="text-[var(--text-muted)]" /></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>
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
