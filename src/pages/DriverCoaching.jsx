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
  Trophy, Users, Gauge, GraduationCap, TrendingUp, Search, X,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, AlertTriangle, Medal, Award,
  ShieldCheck, Fuel, Zap, RotateCcw, CheckCircle2,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDriverCoaching, createDriverCoaching, updateDriverCoaching, deleteDriverCoaching,
} from '../lib/api/driverCoaching'
import {
  honestLeaderboard, needsCoaching as buildNeedsCoaching, enrichCoaching, filterCoaching,
  coachingKpis, bandDistribution, periodOptions as buildPeriodOptions, coachingExport,
  scoreOf, STATUS_OPTIONS, STATUS_LABEL, COACHING_THRESHOLD,
} from '../lib/driverCoachingAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_FORM = {
  driver_name: '', period: '', safety_score: '', fuel_score: '', harsh_events: '',
  idling_min: '', distance_km: '', coaching_status: 'none', coach: '',
  coaching_notes: '', improvement_pct: '', notes: '',
}

const STATUS_STYLE = {
  none: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
  recommended: 'bg-amber-900/25 text-amber-300 border-amber-800/50',
  scheduled: 'bg-sky-900/25 text-sky-300 border-sky-800/50',
  completed: 'bg-green-900/25 text-green-300 border-green-800/50',
}

const fmtNum = (v, suffix = '') =>
  v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()}${suffix}`

const fmtScore = (v) => (v == null ? 'N/A' : Number(v).toFixed(1))

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


export default function DriverCoaching() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('')
  const [bandFilter, setBandFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loadError, setLoadError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setLoadError(''); setNotProvisioned(false)
    try {
      const data = await listDriverCoaching({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      // A failed read is not "no drivers": keep rows null so figures read N/A.
      else { setLoadError(toUserMessage(err, 'Could not load driver coaching records.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const board = useMemo(() => honestLeaderboard(rows || []), [rows])
  const kpi = useMemo(() => coachingKpis(rows || []), [rows])
  const bands = useMemo(() => bandDistribution(board), [board])
  const needCoaching = useMemo(() => buildNeedsCoaching(rows || []), [rows])
  const enriched = useMemo(() => enrichCoaching(rows || [], board), [rows, board])
  const periodOptions = useMemo(() => buildPeriodOptions(rows || []), [rows])
  const filtered = useMemo(
    () => filterCoaching(enriched, { status: statusFilter, period: periodFilter, band: bandFilter, search }),
    [enriched, statusFilter, periodFilter, bandFilter, search],
  )

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const ready = rows !== null
  const na = (v, f = (x) => x) => (!ready || v == null ? 'N/A' : f(v))
  const kpis = [
    { label: 'Drivers scored', value: na(kpi.driversScored), icon: Users, tone: 'text-[var(--text-primary)]', sub: ready && kpi.unscored ? `${kpi.unscored} scorecard${kpi.unscored === 1 ? '' : 's'} without a score` : null },
    { label: 'Fleet avg score', value: na(kpi.avgScore, (x) => x.toFixed(1)), icon: Gauge, tone: scoreTone(kpi.avgScore), sub: ready && kpi.topScore != null ? `Range ${kpi.bottomScore.toFixed(1)} to ${kpi.topScore.toFixed(1)}` : null },
    { label: 'Needs coaching', value: na(kpi.needsCoaching), icon: GraduationCap, tone: 'text-amber-400', sub: `Below ${COACHING_THRESHOLD} or coaching open`, onClick: () => setBandFilter('poor'), active: bandFilter === 'poor' },
    { label: 'Coaching completed', value: na(kpi.byStatus.completed), icon: ShieldCheck, tone: 'text-green-400', sub: ready ? `Completion ${kpi.completionPct == null ? 'N/A' : `${kpi.completionPct}%`} of the coaching pipeline` : null, onClick: () => setStatusFilter('completed'), active: statusFilter === 'completed' },
    { label: 'Avg improvement', value: na(kpi.avgImprovementPct, (x) => `${x}%`), icon: TrendingUp, tone: 'text-sky-400', sub: 'After coaching, where recorded' },
    { label: 'Harsh events / 1,000 km', value: na(kpi.harshPer1000Km), icon: Zap, tone: 'text-amber-400', sub: ready ? `From ${kpi.exposureRecords} scorecard${kpi.exposureRecords === 1 ? '' : 's'} with distance` : null },
  ]

  // ── Export (full filtered set) ───────────────────────────────────────────
  const doExport = async (format) => {
    const shaped = coachingExport(filtered)
    const file = reportFileName('Driver Coaching', activeCountry !== 'All' ? activeCountry : '')
    try {
      if (format === 'pdf') await exportToPdf(shaped.rows, shaped.keys.map((k, i) => ({ key: k, header: shaped.headers[i] })), 'Driver Leaderboard and Coaching', file, 'landscape')
      else await exportToExcel(shaped.rows, shaped.keys, shaped.headers, file)
    } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

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
      setFormError(toUserMessage(err, 'Could not save the scorecard.'))
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
      setError(toUserMessage(err, 'Could not delete the scorecard.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter(''); setPeriodFilter(''); setBandFilter(''); setSearch('') }
  const hasFilters = !!(statusFilter || periodFilter || bandFilter || search)

  const topBoard = board.slice(0, 12)

  const columns = [
    {
      id: 'rank', header: 'Rank', accessorFn: (r) => r._rank ?? Number.POSITIVE_INFINITY, size: 80,
      cell: ({ row }) => {
        const rank = row.original._rank
        const medal = MEDAL[rank]
        const MedalIcon = medal?.icon
        return (
          <span className="inline-flex items-center gap-1">
            {MedalIcon ? <MedalIcon size={14} className={medal.tone} aria-hidden="true" /> : null}
            <span className="font-semibold text-[var(--text-secondary)]">{rank ? `#${rank}` : 'N/A'}</span>
          </span>
        )
      },
    },
    { id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || '', size: 180, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.driver_name || 'N/A'}</span> },
    {
      id: 'overall', header: 'Overall', accessorFn: (r) => (r._score == null ? -1 : r._score), size: 130,
      cell: ({ row }) => {
        const os = row.original._score
        if (os == null) return <span className="text-[var(--text-muted)]">Not scored</span>
        return (
          <div className="flex items-center gap-2">
            <span className={`font-bold tabular-nums ${scoreTone(os)}`}>{os.toFixed(1)}</span>
            <div className="w-14 h-1.5 rounded-full bg-[var(--input-border)]/60 overflow-hidden" role="presentation">
              <div className={`h-full rounded-full ${scoreBar(os)}`} style={{ width: `${Math.max(2, Math.min(100, os))}%` }} />
            </div>
          </div>
        )
      },
    },
    { id: 'safety', header: 'Safety', accessorFn: (r) => Number(r.safety_score) || -1, size: 90, cell: ({ row }) => <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]"><ShieldCheck size={12} className="text-sky-400" aria-hidden="true" /> {fmtScore(row.original.safety_score)}</span> },
    { id: 'fuel', header: 'Fuel', accessorFn: (r) => Number(r.fuel_score) || -1, size: 90, cell: ({ row }) => <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]"><Fuel size={12} className="text-green-400" aria-hidden="true" /> {fmtScore(row.original.fuel_score)}</span> },
    { id: 'harsh', header: 'Harsh', accessorFn: (r) => Number(r.harsh_events) || 0, size: 80, meta: { align: 'right' }, cell: ({ row }) => fmtNum(row.original.harsh_events) },
    { id: 'distance', header: 'Distance', accessorFn: (r) => Number(r.distance_km) || 0, size: 110, meta: { align: 'right' }, cell: ({ row }) => fmtNum(row.original.distance_km, ' km') },
    {
      id: 'coaching', header: 'Coaching', accessorFn: (r) => STATUS_LABEL[r._status], size: 130,
      cell: ({ row }) => <span className={`text-[11px] px-2 py-0.5 rounded border ${STATUS_STYLE[row.original._status]}`}>{STATUS_LABEL[row.original._status]}</span>,
    },
    { id: 'coach', header: 'Coach', accessorFn: (r) => r.coach || 'N/A', size: 130 },
    { id: 'period', header: 'Period', accessorFn: (r) => r.period || '', size: 100, cell: ({ row }) => row.original.period || 'N/A' },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => openEdit(row.original)} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit scorecard for ${row.original.driver_name || 'driver'}`}><Pencil size={15} /></button>
          <button onClick={() => setConfirmDelete(row.original)} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete scorecard for ${row.original.driver_name || 'driver'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Leaderboard & Coaching"
        subtitle="Score drivers on safety and fuel behaviour, rank the fleet, and target the drivers who most need coaching: the leading indicator behind tyre wear, fuel burn, and accident risk."
        icon={Trophy}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} /> Add scorecard
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Driver coaching is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V187_DRIVER_COACHING.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {loadError && (
        <div role="alert" className="card border border-red-800/50 flex flex-wrap items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-red-300 font-medium">Driver coaching could not be loaded.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{loadError} The figures below are not available until the scorecards load.</p>
          </div>
          <button onClick={load} disabled={refreshing} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RotateCcw size={14} /> Retry</button>
        </div>
      )}

      {error && (
        <div role="alert" className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1"><p className="text-red-300 font-medium">That action did not complete.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button onClick={() => setError('')} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)]" aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>
              {k.sub && <p className="text-[11px] text-[var(--text-muted)] mt-1">{k.sub}</p>}
            </>
          )
          return k.onClick ? (
            <button key={k.label} type="button" onClick={k.onClick} aria-pressed={!!k.active}
              className={`card text-left min-h-[44px] transition-colors hover:border-[var(--accent)] ${k.active ? 'ring-2 ring-[var(--accent)]' : ''}`}>{body}</button>
          ) : <div key={k.label} className="card">{body}</div>
        })}
      </div>

      {/* Score distribution */}
      {ready && board.length > 0 && (
        <div className="card">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">Score distribution (latest scorecard per driver)</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { key: 'good', label: 'Strong (80 and above)', cls: 'bg-green-500', Icon: CheckCircle2, tone: 'text-green-400' },
              { key: 'watch', label: `Watch (${COACHING_THRESHOLD} to 79)`, cls: 'bg-amber-500', Icon: AlertTriangle, tone: 'text-amber-400' },
              { key: 'poor', label: `Needs coaching (below ${COACHING_THRESHOLD})`, cls: 'bg-red-500', Icon: GraduationCap, tone: 'text-red-400' },
            ].map((b) => {
              const pct = Math.round((bands[b.key] / board.length) * 100)
              return (
                <button key={b.key} type="button" onClick={() => setBandFilter(b.key)} aria-pressed={bandFilter === b.key}
                  className={`text-left rounded-lg border border-[var(--input-border)] p-3 min-h-[44px] hover:border-[var(--accent)] ${bandFilter === b.key ? 'ring-2 ring-[var(--accent)]' : ''}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]"><b.Icon size={12} className={b.tone} aria-hidden="true" /> {b.label}</span>
                    <span className="text-[var(--text-muted)] tabular-nums">{bands[b.key]} ({pct}%)</span>
                  </div>
                  <div className="h-2 mt-2 rounded bg-[var(--input-bg)] overflow-hidden" role="presentation">
                    <div className={`h-full rounded ${b.cls}`} style={{ width: `${pct}%` }} />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Leaderboard + coaching attention panel */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Leaderboard */}
        <div className="card xl:col-span-2 overflow-hidden">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Trophy size={15} className="text-amber-400" aria-hidden="true" /> Driver leaderboard
          </h3>
          {rows === null ? (
            loadError ? <p className="text-sm text-[var(--text-muted)]">Not available</p> : <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : topBoard.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No scored drivers yet. Add a scorecard to build the leaderboard.</p>
          ) : (
            <div className="space-y-1.5">
              {topBoard.map((b) => {
                const medal = MEDAL[b.rank]
                const MedalIcon = medal?.icon
                return (
                  <div key={b.driver_name} className="flex items-center gap-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/30 px-3 py-2">
                    <div className="w-8 shrink-0 flex items-center justify-center">
                      {MedalIcon ? <MedalIcon size={18} className={medal.tone} aria-label={`Rank ${b.rank}`} /> : <span className="text-sm font-bold text-[var(--text-muted)]">#{b.rank}</span>}
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
                        <Zap size={10} className="text-amber-400" aria-hidden="true" /> {b.harsh_events ?? 'N/A'} harsh, {b.distance_km == null ? 'N/A' : `${Math.round(b.distance_km).toLocaleString()} km`}
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
            <GraduationCap size={15} className="text-amber-400" aria-hidden="true" /> Needs coaching
          </h3>
          {rows === null ? (
            loadError ? <p className="text-sm text-[var(--text-muted)]">Not available</p> : <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : needCoaching.length === 0 ? (
            <div className="text-sm text-[var(--text-muted)] flex items-center gap-2 py-6 justify-center">
              <ShieldCheck size={18} className="text-green-400" aria-hidden="true" /> No drivers currently flagged.
            </div>
          ) : (
            <div className="space-y-2">
              {needCoaching.slice(0, 8).map((r) => (
                <div key={r.id} className="rounded-lg border border-amber-800/40 bg-amber-900/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.driver_name}</p>
                    <span className={`text-sm font-bold ${scoreTone(r._score)}`}>{r._score == null ? 'Not scored' : r._score.toFixed(1)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATUS_STYLE[r._status]}`}>
                      {STATUS_LABEL[r._status]}
                    </span>
                    <button onClick={() => openEdit(r)} className="text-xs text-sky-400 hover:text-sky-300 inline-flex items-center gap-1 min-h-[44px] px-2" aria-label={`Coach ${r.driver_name}`}>
                      <GraduationCap size={12} aria-hidden="true" /> Coach
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
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full min-h-[44px]" aria-label="Search scorecards" placeholder="Search driver, coach, period, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Coaching status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className="input min-h-[44px]" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Score band">
            <option value="">All scores</option>
            <option value="good">Strong (80 and above)</option>
            <option value="watch">Watch ({COACHING_THRESHOLD} to 79)</option>
            <option value="poor">Below {COACHING_THRESHOLD}</option>
            <option value="unscored">Not scored</option>
          </select>
          <select className="input min-h-[44px]" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} aria-label="Period">
            <option value="">All periods</option>
            {periodOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{ready ? `${filtered.length} of ${enriched.length}` : 'N/A'}</span>
        </div>
      </div>

      {/* Records */}
      {!loadError && (
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={!ready}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={hasFilters ? 'No scorecards match these filters.' : notProvisioned ? 'Driver coaching is not enabled on this database yet.' : 'No scorecards yet. Add your first driver scorecard.'}
        />
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <Modal open onClose={closeModal} title={editing ? 'Edit scorecard' : 'Add driver scorecard'} size="lg">
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dc-f1" className="label">Driver name</label>
                  <input id="dc-f1" className="input w-full" placeholder="e.g. A. Rahman" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="dc-f2" className="label">Period (optional)</label>
                  <input id="dc-f2" className="input w-full" placeholder="e.g. 2026-Q2 / Jun 2026" value={form.period} maxLength={60} onChange={(e) => set('period', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dc-f3" className="label">Safety score (0 to 100)</label>
                  <input id="dc-f3" className="input w-full" type="number" step="0.1" min="0" max="100" placeholder="82" value={form.safety_score} onChange={(e) => set('safety_score', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="dc-f4" className="label">Fuel score (0 to 100)</label>
                  <input id="dc-f4" className="input w-full" type="number" step="0.1" min="0" max="100" placeholder="76" value={form.fuel_score} onChange={(e) => set('fuel_score', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="dc-f5" className="label">Harsh events</label>
                  <input id="dc-f5" className="input w-full" type="number" step="1" min="0" placeholder="3" value={form.harsh_events} onChange={(e) => set('harsh_events', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="dc-f6" className="label">Idling (min)</label>
                  <input id="dc-f6" className="input w-full" type="number" step="1" min="0" placeholder="45" value={form.idling_min} onChange={(e) => set('idling_min', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="dc-f7" className="label">Distance (km)</label>
                  <input id="dc-f7" className="input w-full" type="number" step="1" min="0" placeholder="4200" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="dc-f8" className="label">Coaching status</label>
                  <select id="dc-f8" className="input w-full" value={form.coaching_status} onChange={(e) => set('coaching_status', e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="dc-f9" className="label">Coach (optional)</label>
                  <input id="dc-f9" className="input w-full" placeholder="e.g. Fleet Trainer" value={form.coach} maxLength={200} onChange={(e) => set('coach', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="dc-f10" className="label">Improvement %</label>
                  <input id="dc-f10" className="input w-full" type="number" step="0.1" placeholder="12.5" value={form.improvement_pct} onChange={(e) => set('improvement_pct', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="dc-f11" className="label">Coaching notes (optional)</label>
                <textarea id="dc-f11" className="input w-full min-h-[70px] resize-y" placeholder="Session outcomes, focus areas, follow-up date" value={form.coaching_notes} maxLength={8000} onChange={(e) => set('coaching_notes', e.target.value)} />
              </div>
              <div>
                <label htmlFor="dc-f12" className="label">Notes (optional)</label>
                <textarea id="dc-f12" className="input w-full min-h-[60px] resize-y" placeholder="Any additional context" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving' : editing ? 'Save changes' : 'Add scorecard'}
                </button>
              </div>
            </form>
        </Modal>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <Modal
          open
          onClose={deleting ? undefined : () => setConfirmDelete(null)}
          closeOnBackdrop={!deleting}
          title="Delete this scorecard?"
          size="sm"
        >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <p className="text-sm text-[var(--text-muted)]">
                  {confirmDelete.driver_name || 'Driver'}, score {scoreOf(confirmDelete) == null ? 'not recorded' : scoreOf(confirmDelete).toFixed(1)}{confirmDelete.period ? `, ${confirmDelete.period}` : ''}. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting' : 'Delete'}
              </button>
            </div>
        </Modal>
      )}
    </div>
  )
}
