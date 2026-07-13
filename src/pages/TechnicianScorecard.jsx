/**
 * TechnicianScorecard (route /technician-scorecard) — workshop technician
 * competency + performance platform (ported + deepened from tyre_saas's
 * "Technician Skills Matrix"). Four tabs:
 *
 *   • Leaderboard    — performance ranking derived from `work_orders`
 *                      (completion, turnaround, cost, composite score). Runs on
 *                      existing data, no provisioning required.
 *   • Technicians    — per-technician competency card (skills by proficiency,
 *                      certifications by expiry status, a composite lifecycle
 *                      band) with +Skill / +Cert actions.
 *   • Skills matrix  — org-wide skill × proficiency-level coverage roll-up.
 *   • Expiring certs — certification compliance: expired + soon-to-expire.
 *
 * All grouping / KPI / competency logic lives in the pure, unit-tested
 * `src/lib/technicianScorecard.js`. Skills + certs are stored in the V207
 * `technician_skills` / `technician_certs` tables; where those are not yet
 * provisioned (or simply empty) the competency tabs show honest empty states —
 * nothing is fabricated.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  Award, Users, ClipboardList, CheckCircle2, Clock, Search, X, Filter,
  FileSpreadsheet, FileText, AlertTriangle, Wrench, ChevronUp, ChevronDown,
  Trophy, GraduationCap, ShieldCheck, LayoutGrid, CalendarClock, Plus,
  ChevronRight, BadgeCheck, Star, AlertCircle, Loader2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact, formatDate } from '../lib/formatters'
import {
  listWorkOrdersForScorecard, listSkills, listCerts,
  upsertSkill, deleteSkill, createCert, deleteCert,
} from '../lib/api/technicianScorecard'
import { listProfiles } from '../lib/api/users'
import {
  summarizeTechnicians, completionRating,
  SKILL_CATALOGUE, CERT_CATALOGUE, LEVEL_LABELS, LIFECYCLE_BAND_LABELS,
  certExpiryStatus, lifecycleScore, skillsMatrix, computeExpiry,
  skillById, certById,
} from '../lib/technicianScorecard'
import { toUserMessage } from '../lib/safeError'
import { safeHref } from '../lib/safeUrl'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

// Roles that plausibly work in a tyre bay. Matched case-insensitively against
// profiles.role so the Technicians tab lists field/workshop staff by default.
const TECH_ROLE_RE = /tyre\s*man|technician|mechanic|fitter|foreman|inspector|workshop|helper|service|bay/i

const RATING_STYLES = {
  Excellent: 'bg-green-900/40 text-green-300 border border-green-700/50',
  Good: 'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  Average: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  'Needs Improvement': 'bg-red-900/40 text-red-300 border border-red-700/50',
}

const LEVEL_STYLES = {
  1: 'bg-slate-700/40 text-slate-300 border border-slate-600/50',
  2: 'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  3: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
}

const CERT_STATUS_STYLES = {
  valid: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
  warning: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  expired: 'bg-red-900/40 text-red-300 border border-red-700/50',
  unknown: 'bg-slate-700/40 text-slate-300 border border-slate-600/50',
}

const BAND_STYLES = {
  expert: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  proficient: 'bg-blue-500/20 text-blue-300 border border-blue-500/40',
  developing: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
  needs_training: 'bg-red-500/20 text-red-300 border border-red-500/40',
  unrated: 'bg-slate-700/40 text-slate-400 border border-slate-600/50',
}

const CATEGORY_LABELS = { core: 'Core', hardware: 'Hardware', specialist: 'Specialist', management: 'Management', other: 'Other' }

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
const normName = (s) => (s || '').toString().trim().toLowerCase()
const profileName = (p) => (p?.full_name || p?.username || p?.email || 'Unnamed user')

const TABS = [
  { key: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { key: 'technicians', label: 'Technicians', icon: Users },
  { key: 'matrix', label: 'Skills matrix', icon: LayoutGrid },
  { key: 'certs', label: 'Expiring certs', icon: ShieldCheck },
]

export default function TechnicianScorecard() {
  const { activeCountry, activeCurrency } = useSettings()
  const [orders, setOrders] = useState(null)
  const [profiles, setProfiles] = useState(null)
  const [skills, setSkills] = useState([])
  const [certs, setCerts] = useState([])
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [tab, setTab] = useState('leaderboard')

  // Leaderboard filters
  const [search, setSearch] = useState('')
  const [minJobs, setMinJobs] = useState(1)
  const [sortKey, setSortKey] = useState('rank')
  const [sortDir, setSortDir] = useState('asc')

  // Technicians tab
  const [techSearch, setTechSearch] = useState('')
  const [allRoles, setAllRoles] = useState(false)
  const [expanded, setExpanded] = useState(null)

  // Modals
  const [skillModal, setSkillModal] = useState(null) // { user_id }
  const [certModal, setCertModal] = useState(null) // { user_id }

  const nowMs = useMemo(() => Date.now(), [orders, certs])

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    const [ord, prof, sk, ct] = await Promise.allSettled([
      listWorkOrdersForScorecard({ country: activeCountry }),
      listProfiles(),
      listSkills({ country: activeCountry }),
      listCerts({ country: activeCountry }),
    ])
    setOrders(ord.status === 'fulfilled' && Array.isArray(ord.value) ? ord.value : [])
    setProfiles(prof.status === 'fulfilled' && Array.isArray(prof.value) ? prof.value : [])
    setSkills(sk.status === 'fulfilled' && Array.isArray(sk.value) ? sk.value : [])
    setCerts(ct.status === 'fulfilled' && Array.isArray(ct.value) ? ct.value : [])
    if (ord.status === 'rejected') setError(toUserMessage(ord.reason, 'Could not load work orders.'))
    setUpdatedAt(new Date())
    setRefreshing(false)
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Leaderboard derivations ────────────────────────────────────────────────
  const { rows: ranked, totals } = useMemo(() => summarizeTechnicians(orders || []), [orders])

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

  // ── Competency derivations ─────────────────────────────────────────────────
  const skillsByUser = useMemo(() => {
    const m = new Map()
    for (const s of skills) {
      if (!s?.user_id) continue
      if (!m.has(s.user_id)) m.set(s.user_id, [])
      m.get(s.user_id).push(s)
    }
    return m
  }, [skills])

  const certsByUser = useMemo(() => {
    const m = new Map()
    for (const c of certs) {
      if (!c?.user_id) continue
      if (!m.has(c.user_id)) m.set(c.user_id, [])
      m.get(c.user_id).push(c)
    }
    return m
  }, [certs])

  // leaderboard row by normalised technician name (for lifecycle scoring)
  const rankedByName = useMemo(() => {
    const m = new Map()
    for (const r of ranked) m.set(normName(r.technician), r)
    return m
  }, [ranked])

  const techProfiles = useMemo(() => {
    const list = Array.isArray(profiles) ? profiles : []
    const base = allRoles ? list : list.filter((p) => TECH_ROLE_RE.test(p?.role || ''))
    const q = techSearch.trim().toLowerCase()
    return base
      .filter((p) => !q || profileName(p).toLowerCase().includes(q) || (p.role || '').toLowerCase().includes(q))
      .sort((a, b) => profileName(a).localeCompare(profileName(b)))
  }, [profiles, allRoles, techSearch])

  const techCards = useMemo(() => techProfiles.map((p) => {
    const uSkills = skillsByUser.get(p.id) || []
    const uCerts = certsByUser.get(p.id) || []
    const perf = rankedByName.get(normName(profileName(p)))
    const life = lifecycleScore({
      completed: perf?.completed || 0,
      passRate: perf?.completionRate || 0,
      certCount: uCerts.length,
    })
    const expiring = uCerts.filter((c) => {
      const st = certExpiryStatus(c.expiry_date, nowMs).status
      return st === 'warning' || st === 'expired'
    }).length
    return { profile: p, skills: uSkills, certs: uCerts, life, perf, expiring }
  }), [techProfiles, skillsByUser, certsByUser, rankedByName, nowMs])

  const matrix = useMemo(() => skillsMatrix(skills), [skills])
  const techWithSkills = skillsByUser.size

  const certRows = useMemo(() => {
    const nameById = new Map((profiles || []).map((p) => [p.id, profileName(p)]))
    return certs
      .map((c) => {
        const meta = certExpiryStatus(c.expiry_date, nowMs)
        return {
          ...c,
          technician: nameById.get(c.user_id) || 'Unknown',
          days: meta.days,
          status: meta.status,
          displayName: c.cert_name || certById(c.cert_id)?.name || c.cert_id,
        }
      })
      .sort((a, b) => {
        const av = a.days == null ? Infinity : a.days
        const bv = b.days == null ? Infinity : b.days
        return av - bv
      })
  }, [certs, profiles, nowMs])

  const expiringSoon = useMemo(
    () => certRows.filter((c) => c.status === 'warning' || c.status === 'expired'),
    [certRows],
  )

  // ── Mutations ──────────────────────────────────────────────────────────────
  const reloadCompetency = useCallback(async () => {
    const [sk, ct] = await Promise.allSettled([
      listSkills({ country: activeCountry }),
      listCerts({ country: activeCountry }),
    ])
    setSkills(sk.status === 'fulfilled' && Array.isArray(sk.value) ? sk.value : [])
    setCerts(ct.status === 'fulfilled' && Array.isArray(ct.value) ? ct.value : [])
  }, [activeCountry])

  const removeSkill = async (id) => { try { await deleteSkill(id); await reloadCompetency() } catch { /* surfaced by RLS; no-op */ } }
  const removeCert = async (id) => { try { await deleteCert(id); await reloadCompetency() } catch { /* surfaced by RLS; no-op */ } }

  const SortHead = ({ label, k, align = 'left' }) => (
    <th className={`px-4 py-3 font-semibold whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${sortKey === k ? 'text-[var(--text-primary)]' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {sortKey === k && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </button>
    </th>
  )

  const loadingCompetency = profiles === null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Technician Scorecard"
        subtitle="Workshop technician competency & performance — skills matrix, certifications, and a work-order performance leaderboard."
        icon={Award}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={tab === 'leaderboard' ? (
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'technician_scorecard')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!sorted.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Technician Scorecard', 'technician_scorecard', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!sorted.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        ) : null}
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load work orders.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--input-border)] overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          const badge = t.key === 'certs' && expiringSoon.length ? expiringSoon.length : null
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${active ? 'border-[var(--brand-bright)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={14} /> {t.label}
              {badge != null && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 tabular-nums">{badge}</span>}
            </button>
          )
        })}
      </div>

      {/* ══════════════════ LEADERBOARD ══════════════════ */}
      {tab === 'leaderboard' && (
        <>
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
        </>
      )}

      {/* ══════════════════ TECHNICIANS ══════════════════ */}
      {tab === 'technicians' && (
        <>
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input className="input pl-9 w-full" placeholder="Search technician or role…" value={techSearch} onChange={(e) => setTechSearch(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" className="accent-amber-500" checked={allRoles} onChange={(e) => setAllRoles(e.target.checked)} />
                Show all roles
              </label>
              <span className="text-xs text-[var(--text-muted)] ml-auto">{techCards.length} {allRoles ? 'users' : 'technicians'}</span>
            </div>
          </div>

          {loadingCompetency ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="card h-16 animate-pulse" />)}</div>
          ) : techCards.length === 0 ? (
            <div className="card text-center py-12 space-y-2">
              <Users size={30} className="mx-auto text-[var(--text-muted)]" />
              <p className="text-[var(--text-primary)] font-semibold">No technicians found.</p>
              <p className="text-sm text-[var(--text-muted)]">{allRoles ? 'No users in this scope.' : 'No users with a workshop/technician role. Toggle “Show all roles” to include everyone.'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {techCards.map(({ profile: p, skills: uSkills, certs: uCerts, life, perf, expiring }) => {
                const open = expanded === p.id
                return (
                  <div key={p.id} className="card !p-0 overflow-hidden">
                    <button onClick={() => setExpanded(open ? null : p.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--input-bg)]/40">
                      <ChevronRight size={16} className={`text-[var(--text-muted)] transition-transform ${open ? 'rotate-90' : ''}`} />
                      <div className="w-9 h-9 rounded-full bg-[var(--input-bg)] flex items-center justify-center text-sm font-bold text-[var(--text-secondary)] shrink-0">
                        {profileName(p)[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[var(--text-primary)] font-medium truncate">{profileName(p)}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">{p.role || 'No role'}{p.site ? ` · ${p.site}` : ''}</p>
                      </div>
                      <div className="hidden sm:flex items-center gap-3 text-xs text-[var(--text-muted)]">
                        <span className="inline-flex items-center gap-1"><GraduationCap size={13} /> {uSkills.length}</span>
                        <span className="inline-flex items-center gap-1"><BadgeCheck size={13} /> {uCerts.length}</span>
                        {expiring > 0 && <span className="inline-flex items-center gap-1 text-amber-400"><CalendarClock size={13} /> {expiring}</span>}
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${BAND_STYLES[life.band]}`}>{life.score == null ? LIFECYCLE_BAND_LABELS.unrated : `${LIFECYCLE_BAND_LABELS[life.band]} · ${life.score}`}</span>
                    </button>

                    {open && (
                      <div className="border-t border-[var(--input-border)] px-4 py-4 space-y-4 bg-[var(--input-bg)]/20">
                        {perf && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                            {[
                              { label: 'Jobs', value: perf.jobs },
                              { label: 'Completion', value: `${perf.completionRate}%` },
                              { label: 'Avg TAT', value: fmtTat(perf.avgTurnaround) },
                              { label: 'Lifecycle', value: life.score == null ? '—' : life.score },
                            ].map((m) => (
                              <div key={m.label} className="rounded-lg bg-[var(--input-bg)]/60 p-2">
                                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{m.label}</p>
                                <p className="text-base font-bold text-[var(--text-primary)]">{m.value}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Skills */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] inline-flex items-center gap-1.5"><GraduationCap size={13} /> Skills</h4>
                            <button onClick={() => setSkillModal({ user_id: p.id })} className="btn-secondary text-xs inline-flex items-center gap-1"><Plus size={12} /> Skill</button>
                          </div>
                          {uSkills.length === 0 ? (
                            <p className="text-xs text-[var(--text-muted)] italic">No skills recorded.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {uSkills.map((s) => (
                                <span key={s.id} className={`group inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${LEVEL_STYLES[s.level] || LEVEL_STYLES[1]}`}>
                                  {skillById(s.skill_id)?.name || s.skill_id}
                                  <span className="opacity-70">· {LEVEL_LABELS[s.level] || s.level}</span>
                                  <button onClick={() => removeSkill(s.id)} className="opacity-0 group-hover:opacity-100 hover:text-red-300" title="Remove skill"><X size={11} /></button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Certs */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] inline-flex items-center gap-1.5"><ShieldCheck size={13} /> Certifications</h4>
                            <button onClick={() => setCertModal({ user_id: p.id })} className="btn-secondary text-xs inline-flex items-center gap-1"><Plus size={12} /> Cert</button>
                          </div>
                          {uCerts.length === 0 ? (
                            <p className="text-xs text-[var(--text-muted)] italic">No certifications recorded.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {uCerts.map((c) => {
                                const meta = certExpiryStatus(c.expiry_date, nowMs)
                                return (
                                  <span key={c.id} className={`group inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${CERT_STATUS_STYLES[meta.status]}`}>
                                    {c.cert_name || certById(c.cert_id)?.name || c.cert_id}
                                    <span className="opacity-70">
                                      · {meta.status === 'unknown' ? 'no expiry' : meta.status === 'expired' ? `expired ${Math.abs(meta.days)}d` : `${meta.days}d left`}
                                    </span>
                                    <button onClick={() => removeCert(c.id)} className="opacity-0 group-hover:opacity-100 hover:text-red-300" title="Remove certification"><X size={11} /></button>
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ══════════════════ SKILLS MATRIX ══════════════════ */}
      {tab === 'matrix' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Skills tracked', value: matrix.length, icon: LayoutGrid, tone: 'text-[var(--text-primary)]' },
              { label: 'Technicians assessed', value: techWithSkills, icon: Users, tone: 'text-blue-400' },
              { label: 'Skill records', value: skills.length, icon: GraduationCap, tone: 'text-emerald-400' },
              { label: 'Expert-level holdings', value: matrix.reduce((a, r) => a + r.l3, 0), icon: Star, tone: 'text-amber-400' },
            ].map((k) => {
              const Icon = k.icon
              return (
                <div key={k.label} className="card">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                    <Icon size={16} className={k.tone} />
                  </div>
                  <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{loadingCompetency ? '—' : k.value}</p>
                </div>
              )
            })}
          </div>

          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--input-border)] text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-4 py-3 font-semibold text-left">Skill</th>
                    <th className="px-4 py-3 font-semibold text-left">Category</th>
                    <th className="px-4 py-3 font-semibold text-right">Basic</th>
                    <th className="px-4 py-3 font-semibold text-right">Proficient</th>
                    <th className="px-4 py-3 font-semibold text-right">Expert</th>
                    <th className="px-4 py-3 font-semibold text-right">Holders</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingCompetency ? (
                    [0, 1, 2, 3].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                  ) : matrix.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-[var(--text-muted)]"><LayoutGrid size={22} className="mx-auto mb-2 opacity-60" />No skills recorded yet. Add skills from the Technicians tab.</td></tr>
                  ) : (
                    matrix.map((r) => (
                      <tr key={r.skill_id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                        <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">{r.name}</td>
                        <td className="px-4 py-2.5 text-[var(--text-muted)]">{CATEGORY_LABELS[r.category] || r.category}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">{r.l1}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-blue-300">{r.l2}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-emerald-300">{r.l3}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[var(--text-primary)]">{r.total}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════ EXPIRING CERTS ══════════════════ */}
      {tab === 'certs' && (
        <>
          {!loadingCompetency && expiringSoon.length > 0 && (
            <div className="card border border-amber-700/50 bg-amber-900/10 flex items-start gap-3">
              <AlertCircle size={18} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-amber-200 font-medium">{expiringSoon.length} certification{expiringSoon.length === 1 ? '' : 's'} expired or expiring within 60 days.</p>
                <p className="text-[var(--text-muted)] text-sm mt-0.5">Schedule renewals to keep the workshop compliant.</p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end">
            <button
              onClick={() => {
                const cols = ['technician', 'displayName', 'issuer', 'issue_date', 'expiry_date', 'status', 'cert_number']
                const headers = ['Technician', 'Certification', 'Issuer', 'Issued', 'Expires', 'Status', 'Number']
                const rows = certRows.map((c) => ({
                  technician: c.technician, displayName: c.displayName, issuer: c.issuer || '',
                  issue_date: c.issue_date || '', expiry_date: c.expiry_date || '', status: c.status, cert_number: c.cert_number || '',
                }))
                exportToExcel(rows, cols, headers, 'technician_certifications')
              }}
              className="btn-secondary text-sm inline-flex items-center gap-1.5"
              disabled={certRows.length === 0}
            >
              <FileSpreadsheet size={14} /> Export certs
            </button>
          </div>

          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--input-border)] text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-4 py-3 font-semibold text-left">Technician</th>
                    <th className="px-4 py-3 font-semibold text-left">Certification</th>
                    <th className="px-4 py-3 font-semibold text-left">Issuer</th>
                    <th className="px-4 py-3 font-semibold text-left">Issued</th>
                    <th className="px-4 py-3 font-semibold text-left">Expires</th>
                    <th className="px-4 py-3 font-semibold text-right">Days</th>
                    <th className="px-4 py-3 font-semibold text-left">Status</th>
                    <th className="px-4 py-3 font-semibold text-left">Doc</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingCompetency ? (
                    [0, 1, 2, 3].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                  ) : certRows.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]"><ShieldCheck size={22} className="mx-auto mb-2 opacity-60" />No certifications recorded yet. Add certifications from the Technicians tab.</td></tr>
                  ) : (
                    certRows.map((c) => {
                      const rowTone = c.status === 'expired' || (c.days != null && c.days < 30)
                        ? 'text-red-300' : c.status === 'warning' ? 'text-amber-300' : 'text-[var(--text-secondary)]'
                      const href = safeHref(c.document_url)
                      return (
                        <tr key={c.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                          <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">{c.technician}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{c.displayName}</td>
                          <td className="px-4 py-2.5 text-[var(--text-muted)]">{c.issuer || '—'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{c.issue_date ? formatDate(c.issue_date) : '—'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{c.expiry_date ? formatDate(c.expiry_date) : '—'}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${rowTone}`}>{c.days == null ? '—' : c.days < 0 ? `${c.days}` : c.days}</td>
                          <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded ${CERT_STATUS_STYLES[c.status]}`}>{c.status}</span></td>
                          <td className="px-4 py-2.5">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--brand-bright)] hover:underline text-xs">view</a> : <span className="text-[var(--text-muted)]">—</span>}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════ MODALS ══════════════════ */}
      {skillModal && (
        <SkillModal
          userId={skillModal.user_id}
          userName={profileName((profiles || []).find((p) => p.id === skillModal.user_id))}
          country={activeCountry}
          onClose={() => setSkillModal(null)}
          onSaved={async () => { setSkillModal(null); await reloadCompetency() }}
        />
      )}
      {certModal && (
        <CertModal
          userId={certModal.user_id}
          userName={profileName((profiles || []).find((p) => p.id === certModal.user_id))}
          country={activeCountry}
          onClose={() => setCertModal(null)}
          onSaved={async () => { setCertModal(null); await reloadCompetency() }}
        />
      )}
    </div>
  )
}

// ── Skill modal ──────────────────────────────────────────────────────────────
function SkillModal({ userId, userName, country, onClose, onSaved }) {
  const [skillId, setSkillId] = useState('')
  const [level, setLevel] = useState(1)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!skillId) { setErr('Select a skill.'); return }
    setSaving(true); setErr('')
    try {
      await upsertSkill({ user_id: userId, skill_id: skillId, level, notes, country })
      await onSaved()
    } catch (ex) {
      setErr(toUserMessage(ex, 'Could not save this skill.')); setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-[var(--text-primary)]">Add / update skill</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-4 inline-flex items-center gap-1.5"><Users size={12} className="opacity-60" /> {userName}</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Skill</label>
            <select className="input w-full" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
              <option value="">— Select a skill —</option>
              {SKILL_CATALOGUE.map((s) => <option key={s.skill_id} value={s.skill_id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Proficiency level</label>
            <select className="input w-full" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n} — {LEVEL_LABELS[n]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <textarea className="input w-full" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Assessment notes…" />
          </div>
          {err && <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {err}</div>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving || !skillId}>
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save skill'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Cert modal ───────────────────────────────────────────────────────────────
function CertModal({ userId, userName, country, onClose, onSaved }) {
  const [certId, setCertId] = useState('')
  const [certName, setCertName] = useState('')
  const [issuer, setIssuer] = useState('')
  const [issueDate, setIssueDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [certNumber, setCertNumber] = useState('')
  const [documentUrl, setDocumentUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // When a catalogue cert is picked, prefill name + issuer and (re)derive expiry.
  const onPickCert = (id) => {
    setCertId(id)
    const meta = certById(id)
    if (meta) {
      setCertName(meta.name)
      setIssuer(meta.issuer)
      if (issueDate) setExpiryDate(computeExpiry(issueDate, meta.validity_years) || '')
    }
  }

  // When the issue date changes, recompute expiry from the selected cert's window.
  const onPickIssue = (v) => {
    setIssueDate(v)
    const meta = certById(certId)
    if (meta && v) setExpiryDate(computeExpiry(v, meta.validity_years) || '')
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!certId) { setErr('Select a certification.'); return }
    setSaving(true); setErr('')
    try {
      await createCert({
        user_id: userId, cert_id: certId, cert_name: certName, issuer,
        issue_date: issueDate, expiry_date: expiryDate, cert_number: certNumber,
        document_url: documentUrl, country,
      })
      await onSaved()
    } catch (ex) {
      setErr(toUserMessage(ex, 'Could not save this certification.')); setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-[var(--text-primary)]">Add certification</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-4 inline-flex items-center gap-1.5"><Users size={12} className="opacity-60" /> {userName}</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Certification</label>
            <select className="input w-full" value={certId} onChange={(e) => onPickCert(e.target.value)}>
              <option value="">— Select a certification —</option>
              {CERT_CATALOGUE.map((c) => <option key={c.cert_id} value={c.cert_id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Issuer</label>
            <input className="input w-full" value={issuer} maxLength={200} onChange={(e) => setIssuer(e.target.value)} placeholder="Issuing body" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Issue date</label>
              <input className="input w-full" type="date" value={issueDate} onChange={(e) => onPickIssue(e.target.value)} />
            </div>
            <div>
              <label className="label">Expiry date {certById(certId) ? <span className="text-[10px] text-[var(--text-muted)]">(auto)</span> : null}</label>
              <input className="input w-full" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Certificate number (optional)</label>
              <input className="input w-full" value={certNumber} maxLength={120} onChange={(e) => setCertNumber(e.target.value)} />
            </div>
            <div>
              <label className="label">Document URL (optional)</label>
              <input className="input w-full" value={documentUrl} maxLength={1000} onChange={(e) => setDocumentUrl(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          {err && <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {err}</div>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving || !certId}>
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save certification'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
