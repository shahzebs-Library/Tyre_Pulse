/**
 * TechnicianScorecard (route /technician-scorecard) — workshop technician
 * performance leaderboard built from `work_orders`. Groups jobs by technician
 * and ranks them on a composite of completion rate, turnaround speed and volume.
 *
 * Runs entirely on the existing `work_orders` table (same select as
 * WorkshopManagement) — no new data required. All grouping/KPI/ranking logic
 * lives in the pure, unit-tested `src/lib/technicianScorecard.js`; this page
 * only fetches, filters, sorts for display and formats.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  Award, Users, ClipboardList, CheckCircle2, Clock, Search, X, Filter,
  FileSpreadsheet, FileText, AlertTriangle, Wrench, ChevronUp, ChevronDown,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import { listWorkOrdersForScorecard } from '../lib/api/technicianScorecard'
import { summarizeTechnicians, completionRating } from '../lib/technicianScorecard'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const RATING_STYLES = {
  Excellent: 'bg-green-900/40 text-green-300 border border-green-700/50',
  Good: 'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  Average: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  'Needs Improvement': 'bg-red-900/40 text-red-300 border border-red-700/50',
}

const SORTS = {
  rank: { label: 'Rank', get: (r) => r.rank, dir: 'asc' },
  technician: { label: 'Technician', get: (r) => r.technician.toLowerCase(), dir: 'asc' },
  jobs: { label: 'Jobs', get: (r) => r.jobs, dir: 'desc' },
  completed: { label: 'Completed', get: (r) => r.completed, dir: 'desc' },
  open: { label: 'Open', get: (r) => r.open, dir: 'desc' },
  completionRate: { label: 'Completion %', get: (r) => r.completionRate, dir: 'desc' },
  avgTurnaround: { label: 'Avg TAT', get: (r) => (r.avgTurnaround == null ? Infinity : r.avgTurnaround), dir: 'asc' },
  totalCost: { label: 'Total Cost', get: (r) => r.totalCost, dir: 'desc' },
  avgCostPerJob: { label: 'Avg/Job', get: (r) => r.avgCostPerJob, dir: 'desc' },
  score: { label: 'Score', get: (r) => r.score, dir: 'desc' },
}

const scoreTone = (s) => (s >= 80 ? 'text-green-400' : s >= 60 ? 'text-yellow-400' : s >= 40 ? 'text-orange-400' : 'text-red-400')
const scoreBg = (s) => (s >= 80 ? 'bg-green-500/20 border-green-500/30' : s >= 60 ? 'bg-yellow-500/20 border-yellow-500/30' : s >= 40 ? 'bg-orange-500/20 border-orange-500/30' : 'bg-red-500/20 border-red-500/30')
const fmtTat = (d) => (d == null ? '—' : `${d.toFixed(1)}d`)

export default function TechnicianScorecard() {
  const { activeCountry, activeCurrency } = useSettings()
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [search, setSearch] = useState('')
  const [minJobs, setMinJobs] = useState(1)
  const [sortKey, setSortKey] = useState('rank')
  const [sortDir, setSortDir] = useState('asc')

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listWorkOrdersForScorecard({ country: activeCountry })
      setOrders(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Could not load work orders.')
      setOrders([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const { rows: ranked, totals } = useMemo(
    () => summarizeTechnicians(orders || []),
    [orders],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return ranked.filter((r) => {
      if (r.jobs < minJobs) return false
      if (q && !r.technician.toLowerCase().includes(q)) return false
      return true
    })
  }, [ranked, search, minJobs])

  const sorted = useMemo(() => {
    const cfg = SORTS[sortKey] || SORTS.rank
    const mul = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = cfg.get(a); const bv = cfg.get(b)
      if (av < bv) return -1 * mul
      if (av > bv) return 1 * mul
      return a.rank - b.rank
    })
  }, [filtered, sortKey, sortDir])

  const toggleSort = (key) => {
    if (key === sortKey) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key); setSortDir(SORTS[key]?.dir || 'desc')
  }

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const topRanked = useMemo(() => filtered.slice(0, 12), [filtered])
  const barData = {
    labels: topRanked.map((r) => r.technician),
    datasets: [{
      label: 'Composite score',
      data: topRanked.map((r) => r.score),
      backgroundColor: topRanked.map((r) => (r.score >= 80 ? '#22c55e' : r.score >= 60 ? '#eab308' : r.score >= 40 ? '#f97316' : '#ef4444')),
      borderRadius: 4,
    }],
  }
  const barOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { min: 0, max: 100, ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
      y: { ticks: { color: chartText }, grid: { display: false } },
    },
  }

  const EXPORT_COLS = ['rank', 'technician', 'jobs', 'completed', 'open', 'completionRate', 'avgTurnaround', 'totalCost', 'avgCostPerJob', 'score', 'rating']
  const EXPORT_HEADERS = ['Rank', 'Technician', 'Jobs', 'Completed', 'Open', 'Completion %', 'Avg TAT (days)', 'Total Cost', 'Avg Cost/Job', 'Score', 'Rating']
  const exportRows = sorted.map((r) => ({
    rank: r.rank, technician: r.technician, jobs: r.jobs, completed: r.completed, open: r.open,
    completionRate: `${r.completionRate}%`, avgTurnaround: r.avgTurnaround == null ? '' : r.avgTurnaround,
    totalCost: r.totalCost, avgCostPerJob: r.avgCostPerJob, score: r.score, rating: completionRating(r.completionRate),
  }))

  const kpis = [
    { label: 'Technicians', value: totals.technicians, icon: Users, tone: 'text-[var(--text-primary)]' },
    { label: 'Total jobs', value: totals.totalJobs, icon: ClipboardList, tone: 'text-blue-400' },
    { label: 'Avg completion rate', value: `${totals.avgCompletionRate}%`, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Avg turnaround', value: fmtTat(totals.avgTurnaround), icon: Clock, tone: 'text-amber-400' },
  ]

  const clearFilters = () => { setSearch(''); setMinJobs(1) }
  const hasFilters = search || minJobs > 1

  const SortHead = ({ label, k, align = 'left' }) => (
    <th className={`px-4 py-3 font-semibold whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${sortKey === k ? 'text-[var(--text-primary)]' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {sortKey === k && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </button>
    </th>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Technician Scorecard"
        subtitle="Workshop technician performance leaderboard — completion, turnaround, cost and a composite ranking from work orders."
        icon={Award}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'technician_scorecard')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!sorted.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Technician Scorecard', 'technician_scorecard', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!sorted.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load work orders.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{orders === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Ranking chart */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Composite ranking (top {topRanked.length || 0})</h3>
        <div style={{ height: Math.max(240, topRanked.length * 30) }}>
          {orders === null ? (
            <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
          ) : topRanked.length ? (
            <Bar data={barData} options={barOpts} />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
              <div className="text-center"><Wrench size={22} className="mx-auto mb-2 opacity-60" />No technician data yet.</div>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search technician…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            Min jobs
            <select className="input" value={minJobs} onChange={(e) => setMinJobs(Number(e.target.value))} aria-label="Minimum jobs">
              {[1, 3, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}+</option>)}
            </select>
          </label>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {ranked.length}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <SortHead label="#" k="rank" />
                <SortHead label="Technician" k="technician" />
                <SortHead label="Jobs" k="jobs" align="right" />
                <SortHead label="Completed" k="completed" align="right" />
                <SortHead label="Open" k="open" align="right" />
                <SortHead label="Completion" k="completionRate" align="right" />
                <SortHead label="Avg TAT" k="avgTurnaround" align="right" />
                <SortHead label="Total Cost" k="totalCost" align="right" />
                <SortHead label="Avg/Job" k="avgCostPerJob" align="right" />
                <SortHead label="Score" k="score" align="right" />
                <th className="px-4 py-3 font-semibold whitespace-nowrap text-left">Rating</th>
              </tr>
            </thead>
            <tbody>
              {orders === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={11} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : sorted.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />No technicians match these filters.</td></tr>
              ) : (
                sorted.map((r) => {
                  const rating = completionRating(r.completionRate)
                  return (
                    <tr key={r.technician} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 text-[var(--text-muted)] tabular-nums">{r.rank}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[var(--input-bg)] flex items-center justify-center text-xs font-bold text-[var(--text-secondary)] shrink-0">
                            {(r.technician || '?')[0].toUpperCase()}
                          </div>
                          <span className="text-[var(--text-primary)] font-medium">{r.technician}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-secondary)] tabular-nums">{r.jobs}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-secondary)] tabular-nums">{r.completed}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums"><span className={r.open > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'}>{r.open}</span></td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-16 bg-[var(--input-bg)] rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${r.completionRate >= 85 ? 'bg-green-500' : r.completionRate >= 70 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${Math.min(r.completionRate, 100)}%` }} />
                          </div>
                          <span className="text-[var(--text-secondary)] text-xs tabular-nums w-12 text-right">{r.completionRate}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-secondary)] tabular-nums">{fmtTat(r.avgTurnaround)}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-secondary)] tabular-nums">{formatCurrencyCompact(r.totalCost, activeCurrency)}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-muted)] tabular-nums">{formatCurrencyCompact(r.avgCostPerJob, activeCurrency)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${scoreBg(r.score)} ${scoreTone(r.score)}`}>{r.score}</span>
                      </td>
                      <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded ${RATING_STYLES[rating]}`}>{rating}</span></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
