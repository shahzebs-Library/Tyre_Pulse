/**
 * DriverCoaching (route /driver-coaching) — Driver Leaderboard & Coaching.
 * Scores every driver on a weighted blend of safety and fuel-economy behaviour,
 * ranks the fleet best-first, and drives the coaching workflow (recommended →
 * scheduled → completed). Driver behaviour is a leading indicator of tyre wear,
 * fuel burn, and accident risk, so every scorecard is org-isolated and
 * country-scoped.
 *
 * Runs on the new `driver_coaching` table (V187). Real data, KPI tiles, a
 * ranked leaderboard with medal/score bars, a coaching-needed attention panel,
 * filters, search, create/edit modal, delete confirm, Excel/PDF export, and
 * loading/empty/error/not-provisioned states throughout. Scoring, ranking, and
 * the fleet summary live in the pure `src/lib/driverCoaching.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Trophy, Users, Gauge, GraduationCap, Star, TrendingDown, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, AlertTriangle, Medal, Award,
  ShieldCheck, Fuel, Zap,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDriverCoaching, createDriverCoaching, updateDriverCoaching, deleteDriverCoaching,
} from '../lib/api/driverCoaching'
import {
  overallScore, leaderboard, coachingNeeded, summariseCoaching,
} from '../lib/driverCoaching'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  driver_name: '', period: '', safety_score: '', fuel_score: '', harsh_events: '',
  idling_min: '', distance_km: '', coaching_status: 'none', coach: '',
  coaching_notes: '', improvement_pct: '', notes: '',
}

const STATUS_OPTIONS = ['none', 'recommended', 'scheduled', 'completed']

const STATUS_STYLE = {
  none: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
  recommended: 'bg-amber-900/25 text-amber-300 border-amber-800/50',
  scheduled: 'bg-sky-900/25 text-sky-300 border-sky-800/50',
  completed: 'bg-green-900/25 text-green-300 border-green-800/50',
}
const STATUS_LABEL = {
  none: 'No coaching', recommended: 'Recommended', scheduled: 'Scheduled', completed: 'Completed',
}

const fmtNum = (v, suffix = '') =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString()}${suffix}`

const fmtScore = (v) => (v == null ? '—' : Number(v).toFixed(1))

function scoreTone(score) {
  if (score == null) return 'text-[var(--text-muted)]'
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-amber-400'
  return 'text-red-400'
}
function scoreBar(score) {
  if (score == null) return 'bg-[var(--input-border)]'
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-amber-500'
  return 'bg-red-500'
}

const MEDAL = {
  1: { icon: Trophy, tone: 'text-amber-400' },
  2: { icon: Medal, tone: 'text-slate-300' },
  3: { icon: Award, tone: 'text-orange-400' },
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function DriverCoaching() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listDriverCoaching({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load driver coaching records.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseCoaching(rows || []), [rows])
  const board = useMemo(() => leaderboard(rows || []), [rows])
  const needCoaching = useMemo(() => coachingNeeded(rows || []), [rows])

  // Rank lookup by driver name for the main records table.
  const rankByDriver = useMemo(() => {
    const m = new Map()
    board.forEach((b) => m.set(b.driver_name, b.rank))
    return m
  }, [board])

  const periodOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.period).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter && String(r.coaching_status || 'none') !== statusFilter) return false
      if (periodFilter && r.period !== periodFilter) return false
      if (q) {
        const hay = `${r.driver_name || ''} ${r.period || ''} ${r.coach || ''} ${r.coaching_notes || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, periodFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Drivers scored', value: summary.totalDrivers, icon: Users, tone: 'text-[var(--text-primary)]' },
    { label: 'Fleet avg score', value: summary.totalDrivers ? summary.avgScore.toFixed(1) : '—', icon: Gauge, tone: scoreTone(summary.totalDrivers ? summary.avgScore : null) },
    { label: 'Needs coaching', value: summary.needsCoachingCount, icon: GraduationCap, tone: 'text-amber-400' },
    { label: 'Coached', value: summary.coachedCount, icon: ShieldCheck, tone: 'text-green-400' },
    { label: 'Top score', value: summary.topScore == null ? '—' : summary.topScore.toFixed(1), icon: Star, tone: 'text-amber-400' },
    { label: 'Lowest score', value: summary.bottomScore == null ? '—' : summary.bottomScore.toFixed(1), icon: TrendingDown, tone: scoreTone(summary.bottomScore) },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['rank', 'driver_name', 'overall_score', 'safety_score', 'fuel_score', 'harsh_events', 'idling_min', 'distance_km', 'coaching_status', 'coach', 'improvement_pct', 'period']
  const EXPORT_HEADERS = ['Rank', 'Driver', 'Overall', 'Safety', 'Fuel', 'Harsh events', 'Idling (min)', 'Distance (km)', 'Coaching', 'Coach', 'Improvement %', 'Period']
  const exportRows = filtered.map((r) => ({
    rank: rankByDriver.get(String(r.driver_name || '').trim()) ?? '',
    driver_name: r.driver_name || '',
    overall_score: overallScore(r),
    safety_score: r.safety_score ?? '',
    fuel_score: r.fuel_score ?? '',
    harsh_events: r.harsh_events ?? '',
    idling_min: r.idling_min ?? '',
    distance_km: r.distance_km ?? '',
    coaching_status: STATUS_LABEL[r.coaching_status || 'none'] || 'No coaching',
    coach: r.coach || '',
    improvement_pct: r.improvement_pct ?? '',
    period: r.period || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      driver_name: r.driver_name || '', period: r.period || '',
      safety_score: r.safety_score ?? '', fuel_score: r.fuel_score ?? '',
      harsh_events: r.harsh_events ?? '', idling_min: r.idling_min ?? '',
      distance_km: r.distance_km ?? '', coaching_status: r.coaching_status || 'none',
      coach: r.coach || '', coaching_notes: r.coaching_notes || '',
      improvement_pct: r.improvement_pct ?? '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.driver_name.trim()) { setFormError('A driver name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateDriverCoaching(editing.id, payload)
      else await createDriverCoaching(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the scorecard.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteDriverCoaching(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the scorecard.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter(''); setPeriodFilter(''); setSearch('') }
  const hasFilters = statusFilter || periodFilter || search

  const topBoard = board.slice(0, 12)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Leaderboard & Coaching"
        subtitle="Score drivers on safety and fuel behaviour, rank the fleet, and target the drivers who most need coaching — the leading indicator behind tyre wear, fuel burn, and accident risk."
        icon={Trophy}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'driver_coaching')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Driver Leaderboard & Coaching', 'driver_coaching', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Add scorecard
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Driver coaching isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V187_DRIVER_COACHING.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load driver coaching.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Leaderboard + coaching attention panel */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Leaderboard */}
        <div className="card xl:col-span-2 overflow-hidden">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Trophy size={15} className="text-amber-400" /> Driver leaderboard
          </h3>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : topBoard.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No scored drivers yet — add a scorecard to build the leaderboard.</p>
          ) : (
            <div className="space-y-1.5">
              {topBoard.map((b) => {
                const medal = MEDAL[b.rank]
                const MedalIcon = medal?.icon
                return (
                  <div key={b.driver_name} className="flex items-center gap-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/30 px-3 py-2">
                    <div className="w-8 shrink-0 flex items-center justify-center">
                      {MedalIcon ? <MedalIcon size={18} className={medal.tone} /> : <span className="text-sm font-bold text-[var(--text-muted)]">#{b.rank}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{b.driver_name}</p>
                      <div className="mt-1 h-1.5 rounded-full bg-[var(--input-border)]/60 overflow-hidden">
                        <div className={`h-full rounded-full ${scoreBar(b.overallScore)}`} style={{ width: `${Math.max(2, Math.min(100, b.overallScore))}%` }} />
                      </div>
                    </div>
                    <div className="text-right shrink-0 w-24">
                      <p className={`text-base font-bold ${scoreTone(b.overallScore)}`}>{b.overallScore.toFixed(1)}</p>
                      <p className="text-[11px] text-[var(--text-muted)] flex items-center justify-end gap-1">
                        <Zap size={10} className="text-amber-400" /> {b.harsh_events} · {Math.round(b.distance_km).toLocaleString()} km
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Coaching-needed attention panel */}
        <div className="card overflow-hidden">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <GraduationCap size={15} className="text-amber-400" /> Needs coaching
          </h3>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : needCoaching.length === 0 ? (
            <div className="text-sm text-[var(--text-muted)] flex items-center gap-2 py-6 justify-center">
              <ShieldCheck size={18} className="text-green-400" /> No drivers currently flagged.
            </div>
          ) : (
            <div className="space-y-2">
              {needCoaching.slice(0, 8).map((r) => (
                <div key={r.id} className="rounded-lg border border-amber-800/40 bg-amber-900/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.driver_name}</p>
                    <span className={`text-sm font-bold ${scoreTone(r.overallScore)}`}>{r.overallScore.toFixed(1)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATUS_STYLE[r.coaching_status || 'none']}`}>
                      {STATUS_LABEL[r.coaching_status || 'none']}
                    </span>
                    <button onClick={() => openEdit(r)} className="text-[11px] text-sky-400 hover:text-sky-300 inline-flex items-center gap-1">
                      <GraduationCap size={11} /> Coach
                    </button>
                  </div>
                </div>
              ))}
              {needCoaching.length > 8 && (
                <p className="text-[11px] text-[var(--text-muted)] pt-1">+{needCoaching.length - 8} more flagged</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search driver, coach, period, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Coaching status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className="input" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} aria-label="Period">
            <option value="">All periods</option>
            {periodOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {(rows || []).length}</span>
        </div>
      </div>

      {/* Records table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Rank', 'Driver', 'Overall', 'Safety', 'Fuel', 'Harsh', 'Distance', 'Coaching', 'Period', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={10} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {(rows || []).length === 0 && !notProvisioned ? 'No scorecards yet — add your first driver scorecard.' : 'No scorecards match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const os = overallScore(r)
                  const rank = rankByDriver.get(String(r.driver_name || '').trim())
                  const medal = MEDAL[rank]
                  const MedalIcon = medal?.icon
                  const status = r.coaching_status || 'none'
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1">
                          {MedalIcon ? <MedalIcon size={14} className={medal.tone} /> : null}
                          <span className="font-semibold text-[var(--text-secondary)]">{rank ? `#${rank}` : '—'}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.driver_name || '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${scoreTone(os)}`}>{os.toFixed(1)}</span>
                          <div className="w-14 h-1.5 rounded-full bg-[var(--input-border)]/60 overflow-hidden">
                            <div className={`h-full rounded-full ${scoreBar(os)}`} style={{ width: `${Math.max(2, Math.min(100, os))}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        <span className="inline-flex items-center gap-1"><ShieldCheck size={12} className="text-sky-400" /> {fmtScore(r.safety_score)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        <span className="inline-flex items-center gap-1"><Fuel size={12} className="text-green-400" /> {fmtScore(r.fuel_score)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtNum(r.harsh_events)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtNum(r.distance_km, ' km')}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[11px] px-2 py-0.5 rounded border ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.period || '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit scorecard' : 'Add driver scorecard'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Driver name</label>
                  <input className="input w-full" placeholder="e.g. A. Rahman" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Period (optional)</label>
                  <input className="input w-full" placeholder="e.g. 2026-Q2 / Jun 2026" value={form.period} maxLength={60} onChange={(e) => set('period', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Safety score (0–100)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" max="100" placeholder="82" value={form.safety_score} onChange={(e) => set('safety_score', e.target.value)} />
                </div>
                <div>
                  <label className="label">Fuel score (0–100)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" max="100" placeholder="76" value={form.fuel_score} onChange={(e) => set('fuel_score', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Harsh events</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="3" value={form.harsh_events} onChange={(e) => set('harsh_events', e.target.value)} />
                </div>
                <div>
                  <label className="label">Idling (min)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="45" value={form.idling_min} onChange={(e) => set('idling_min', e.target.value)} />
                </div>
                <div>
                  <label className="label">Distance (km)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="4200" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Coaching status</label>
                  <select className="input w-full" value={form.coaching_status} onChange={(e) => set('coaching_status', e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Coach (optional)</label>
                  <input className="input w-full" placeholder="e.g. Fleet Trainer" value={form.coach} maxLength={200} onChange={(e) => set('coach', e.target.value)} />
                </div>
                <div>
                  <label className="label">Improvement %</label>
                  <input className="input w-full" type="number" step="0.1" placeholder="12.5" value={form.improvement_pct} onChange={(e) => set('improvement_pct', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Coaching notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="Session outcomes, focus areas, follow-up date…" value={form.coaching_notes} maxLength={8000} onChange={(e) => set('coaching_notes', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[60px] resize-y" placeholder="Any additional context" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add scorecard'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this scorecard?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.driver_name || 'Driver'} · score {overallScore(confirmDelete).toFixed(1)}{confirmDelete.period ? ` · ${confirmDelete.period}` : ''}. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
