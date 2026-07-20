/**
 * WorkshopLive.jsx - Workshop Live Control & Technician Productivity dashboard
 * (route /workshop-live). A real-time foreman command centre over the workshop:
 * a KPI strip, a live technician board, a job-card kanban, a delay / root-cause
 * panel and an alerts rail.
 *
 * ALL maths live in the pure engine `src/lib/workshopLive.js` (buildBoard /
 * computeKpis / deriveAlerts / delayBreakdown) - this page only loads raw rows
 * via the service `src/lib/api/workshopLive.js`, feeds them to the engine and
 * renders. Foreman actions (assign / reassign / status / priority / VOR /
 * confirm) go straight back through the service; the audit trail is server-side.
 *
 * Live updates: a Supabase postgres_changes subscription on tech_activity_events
 * + work_orders triggers a debounced reload; a 60s poll is the fallback and a
 * manual Refresh is always available. No fabricated data: every tile derives from
 * the real board / jobs, with honest zero and empty states.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, RefreshCw, Users, Wrench, Clock, AlertTriangle, Package, ShieldAlert,
  Coffee, UserX, X, Gauge, Timer, TrendingUp, CheckCircle2, Car, UserCheck,
  Bell, User, Zap, ExternalLink, ListChecks, Plus, ChevronDown, ChevronUp,
  Phone, Send, GraduationCap, PauseCircle, Sparkles, Settings2, Layers,
  ClipboardList,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import * as workshop from '../lib/api/workshopLive'
import { loadWorkshopConfig } from '../lib/api/workshopConfig'
import {
  buildBoard, computeKpis, deriveAlerts, delayBreakdown,
  STATUS, STATUS_META, statusColor, TONE_COLOR,
} from '../lib/workshopLive'
import { taskRollup, jobTaskSummary, TASK_STATUS, TASK_STATUS_LABEL } from '../lib/workshopTasks'
import { recommendTechnicians } from '../lib/workshopAssign'
import EChart from '../components/charts/EChart'
import PageHeader from '../components/ui/PageHeader'
import WorkshopTvShareButton from '../components/workshop/WorkshopTvShareButton'
import { colorAt, withAlpha } from '../lib/reportColors'
import { safeImageSrc, safeHref } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'
import {
  normalizeWoStatus, woKanbanColumn, WO_STATUSES,
  KANBAN_COLUMNS as WO_KANBAN_COLUMNS,
} from '../lib/workOrderStatus'

// ── Small pure helpers ─────────────────────────────────────────────────────────

const toTs = (v) => {
  if (v == null) return NaN
  if (typeof v === 'number') return v
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? NaN : t
}
const normStatus = (s) => String(s || '').toLowerCase().replace(/\s+/g, '_')

/** minutes -> "1h 5m" / "45m" / "0m". */
function fmtMins(m) {
  const n = Math.max(0, Math.round(Number(m) || 0))
  if (!n) return '0m'
  const h = Math.floor(n / 60)
  const mm = n % 60
  return h ? (mm ? `${h}h ${mm}m` : `${h}h`) : `${mm}m`
}

/** epoch ms -> relative "just now / 5m ago / 2h ago". */
function relTime(tsMs) {
  if (!tsMs) return 'N/A'
  const s = Math.max(0, Math.round((Date.now() - tsMs) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const pct = (v) => (v == null ? 'N/A' : `${v}%`)

// ── Work-order status vocabulary (canonical Title Case) ────────────────────────
// work_orders.status is free text (no DB CHECK). The kanban + the Move control
// READ and WRITE the ONE canonical Title Case vocabulary from workOrderStatus.js,
// so this dashboard and the legacy Work Orders page speak the same language.

// Kanban columns rendered on the board (canonical Title Case = key + label).
const KANBAN_COLUMNS = WO_KANBAN_COLUMNS.map((s) => ({ key: s, label: s }))

// Statuses offered in the per-card "Move" control (Overdue is derived, not set).
const STATUS_MOVES = WO_STATUSES.filter((s) => s !== 'Overdue')

const PRIORITY_OPTS = ['Critical', 'High', 'Medium', 'Low']

const PRIORITY_TONE = {
  critical: TONE_COLOR.red, high: TONE_COLOR.amber, medium: TONE_COLOR.blue, low: TONE_COLOR.grey,
}

const ALERT_TONE = { critical: TONE_COLOR.red, warning: TONE_COLOR.amber, info: TONE_COLOR.blue }

// Task status -> colour (mirrors the engine TASK_STATUS vocabulary).
const TASK_TONE = {
  pending: TONE_COLOR.grey, in_progress: TONE_COLOR.blue, blocked: TONE_COLOR.amber,
  done: TONE_COLOR.green, qc: TONE_COLOR.purple,
}

/** Column a job belongs to (overdue derived from target_completion). */
function jobColumnKey(job, now) {
  const canonical = normalizeWoStatus(job.status)
  const tgt = toTs(job.target_completion)
  const overdue = canonical !== 'Completed' && canonical !== 'Cancelled' && Number.isFinite(tgt) && tgt < now
  return woKanbanColumn(canonical, { overdue })
}

// ── KPI strip config (values come straight from the engine `kpis`) ─────────────

function buildKpiDefs(kpis) {
  return [
    { key: 'onDuty',            label: 'On Duty',        value: kpis.onDuty,            icon: Users,        scope: 'tech', pred: (x) => x.status !== STATUS.OFF_DUTY && x.status !== STATUS.ABSENT },
    { key: 'working',          label: 'Working',        value: kpis.working,          icon: Wrench,       scope: 'tech', pred: (x) => x.status === STATUS.WORKING },
    { key: 'available',        label: 'Available',      value: kpis.available,        icon: UserCheck,    scope: 'tech', pred: (x) => x.status === STATUS.AVAILABLE },
    { key: 'unassigned',       label: 'Unassigned',     value: kpis.unassigned,       icon: User,         scope: 'tech', pred: (x) => x.status === STATUS.AVAILABLE && !x.currentJobId },
    { key: 'waitingParts',     label: 'Waiting Parts',  value: kpis.waitingParts,     icon: Package,      scope: 'tech', pred: (x) => x.status === STATUS.WAITING_PARTS },
    { key: 'waitingApproval',  label: 'Waiting Approval', value: kpis.waitingApproval, icon: ShieldAlert, scope: 'tech', pred: (x) => x.status === STATUS.WAITING_APPROVAL },
    { key: 'onBreak',          label: 'On Break',       value: kpis.onBreak,          icon: Coffee,       scope: 'tech', pred: (x) => x.status === STATUS.ON_BREAK },
    { key: 'absent',           label: 'Absent',         value: kpis.absent,           icon: UserX,        scope: 'tech', pred: (x) => x.status === STATUS.ABSENT },
    { key: 'openJobs',         label: 'Open Job Cards', value: kpis.openJobs,         icon: Wrench,       scope: 'job',  jobCol: null },
    { key: 'overdueJobs',      label: 'Overdue',        value: kpis.overdueJobs,      icon: AlertTriangle, scope: 'job', jobCol: 'Overdue' },
    { key: 'vehiclesOffRoad',  label: 'Vehicles Off Road', value: kpis.vehiclesOffRoad, icon: Car,        scope: 'job',  jobPred: (j) => j.vor === true },
    { key: 'jobsCompletedToday', label: 'Completed Today', value: kpis.jobsCompletedToday, icon: CheckCircle2, scope: 'job', jobCol: 'Completed' },
    { key: 'utilization',      label: 'Utilization',    value: pct(kpis.utilization), icon: Gauge,        scope: null },
    { key: 'productiveHours',  label: 'Productive Hours', value: kpis.productiveHours, icon: TrendingUp,  scope: null },
    { key: 'lostHours',        label: 'Lost Hours',     value: kpis.lostHours,        icon: Timer,        scope: null },
    { key: 'overtimeHours',    label: 'Overtime Hours', value: kpis.overtimeHours,    icon: Zap,          scope: null },
  ]
}

// ── Status pill ────────────────────────────────────────────────────────────────

function StatusPill({ status }) {
  const meta = STATUS_META[status] || { label: status || 'Unknown' }
  const c = statusColor(status)
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: withAlpha(c, 0.16), color: c, border: `1px solid ${withAlpha(c, 0.4)}` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
      {meta.label}
    </span>
  )
}

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ def, active, onClick }) {
  const Icon = def.icon
  const clickable = def.scope != null
  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      aria-pressed={clickable ? active : undefined}
      className="text-left rounded-xl p-3 transition-all border"
      style={{
        background: active ? withAlpha(TONE_COLOR.green, 0.14) : 'var(--surface-2)',
        borderColor: active ? withAlpha(TONE_COLOR.green, 0.5) : 'var(--border-dim)',
        cursor: clickable ? 'pointer' : 'default',
      }}
      title={clickable ? 'Click to filter, click again to clear' : def.label}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted truncate">{def.label}</span>
        <Icon className="w-4 h-4 shrink-0" style={{ color: active ? TONE_COLOR.green : 'var(--text-muted)' }} />
      </div>
      <div className="mt-1 text-xl font-bold text-white tabular-nums">{def.value}</div>
    </button>
  )
}

// ── Technician card ─────────────────────────────────────────────────────────

function TechCard({ tech, events, jobs, techById, busy, onAssign, onReassign, onConfirm, onOpenDrawer, highlight }) {
  const [assignTo, setAssignTo] = useState('')
  const band = statusColor(tech.status)
  const openForAssign = jobs // pre-filtered open jobs

  // For an awaiting-inspection tech, surface their latest unconfirmed complete_task.
  const pendingConfirm = useMemo(() => {
    if (tech.status !== STATUS.AWAITING_INSPECTION) return null
    const evs = Array.isArray(events) ? events : []
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i]
      if (e.event_type === 'complete_task' && !e.foreman_confirmed) return e
    }
    return null
  }, [events, tech.status])

  const job = tech.job
  const util = tech.utilization == null ? null : Math.round(tech.utilization * 100)

  return (
    <div
      id={`ref-${tech.userId}`}
      className="card p-4 flex flex-col gap-3"
      style={{
        borderLeft: `3px solid ${band}`,
        outline: highlight ? `2px solid ${withAlpha(TONE_COLOR.green, 0.7)}` : 'none',
      }}
    >
      <div className="flex items-start gap-3">
        {tech.avatar ? (
          <img
            src={safeImageSrc(tech.avatar)}
            alt={`${tech.name} avatar`}
            className="w-10 h-10 rounded-full object-cover shrink-0 border border-white/10"
          />
        ) : (
          <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white" style={{ background: withAlpha(band, 0.25) }}>
            {String(tech.name || '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white truncate">{tech.name}</span>
            <StatusPill status={tech.status} />
          </div>
          <div className="text-[11px] text-muted mt-0.5 truncate">
            {[tech.employeeId, tech.trade, tech.shift].filter(Boolean).join(' | ') || 'No shift assigned'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenDrawer(tech)}
          className="shrink-0 rounded-lg p-1.5 border text-muted hover:text-white"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)' }}
          title="Foreman actions"
          aria-label={`Foreman actions for ${tech.name}`}
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>

      {/* Current job */}
      <div className="text-xs rounded-lg px-2.5 py-2" style={{ background: 'var(--surface-1)' }}>
        {job ? (
          <span className="text-white">
            <Wrench className="w-3 h-3 inline mr-1 opacity-70" />
            {job.no || 'Job'}{job.asset_no ? ` | ${job.asset_no}` : ''}
          </span>
        ) : (
          <span className="text-muted">No active job</span>
        )}
      </div>

      {/* Time segments */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <TimeCell label="Productive" value={fmtMins(tech.productiveMin)} color={TONE_COLOR.green} />
        <TimeCell label="Blocked" value={fmtMins(tech.blockedMin)} color={TONE_COLOR.amber} />
        <TimeCell label="Unassigned" value={fmtMins(tech.unassignedMin)} color={TONE_COLOR.grey} />
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>Utilization <span className="text-white font-semibold">{util == null ? 'N/A' : `${util}%`}</span></span>
        <span>Last activity {relTime(tech.lastActivityAt)}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={assignTo}
          onChange={(e) => setAssignTo(e.target.value)}
          disabled={busy}
          className="flex-1 min-w-0 text-xs rounded-lg px-2 py-1.5 border"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          aria-label={`Assign a job to ${tech.name}`}
        >
          <option value="">{job ? 'Reassign to job...' : 'Assign a job...'}</option>
          {openForAssign.map((j) => (
            <option key={j.id} value={j.id}>{j.work_order_no || j.id}{j.asset_no ? ` | ${j.asset_no}` : ''}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !assignTo}
          onClick={() => {
            const target = openForAssign.find((j) => String(j.id) === String(assignTo))
            if (!target) return
            const fromOwner = target.assigned_owner_id
            if (fromOwner && String(fromOwner) !== String(tech.userId)) {
              onReassign(target.id, fromOwner, tech.userId)
            } else {
              onAssign(target.id, tech.userId)
            }
            setAssignTo('')
          }}
          className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
        >
          Assign
        </button>
      </div>

      {pendingConfirm && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(pendingConfirm.id)}
          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
        >
          <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" /> Confirm completed task
        </button>
      )}
    </div>
  )
}

function TimeCell({ label, value, color }) {
  return (
    <div className="rounded-lg py-1.5" style={{ background: withAlpha(color, 0.1) }}>
      <div className="text-xs font-semibold text-white tabular-nums">{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  )
}

// ── Job card (kanban) ─────────────────────────────────────────────────────────

function JobCard({
  job, now, technicians, techById, busy, onAssign, onReassign, onStatus, onPriority, onVor, onComplete, highlight,
  tasks, taskSummary, expanded, onToggleTasks, onManageTasks, onSmartAssign, onSetTaskStatus,
}) {
  const canonicalStatus = normalizeWoStatus(job.status)
  const tgt = toTs(job.target_completion)
  const overdue = canonicalStatus !== 'Completed' && canonicalStatus !== 'Cancelled' && Number.isFinite(tgt) && tgt < now
  const prio = normStatus(job.priority)
  const prioColor = PRIORITY_TONE[prio] || TONE_COLOR.grey
  const ownerName = job.assigned_owner_id ? (techById[job.assigned_owner_id]?.name || job.technician_name || null) : job.technician_name || null
  const isQc = canonicalStatus === 'Quality Inspection'
  const hasTasks = (taskSummary?.total || 0) > 0

  return (
    <div
      id={`ref-${job.id}`}
      className="rounded-xl p-3 border flex flex-col gap-2"
      style={{
        background: 'var(--surface-1)',
        borderColor: overdue ? withAlpha(TONE_COLOR.red, 0.5) : 'var(--border-dim)',
        outline: highlight ? `2px solid ${withAlpha(TONE_COLOR.green, 0.7)}` : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-white text-sm truncate">{job.work_order_no || `WO ${job.id}`}</div>
          <div className="text-[11px] text-muted truncate">{job.asset_no || 'No asset'}{job.plate_number ? ` | ${job.plate_number}` : ''}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasTasks && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              style={{ background: withAlpha(TONE_COLOR.blue, 0.16), color: TONE_COLOR.blue }}
              title={`${taskSummary.done} of ${taskSummary.total} tasks done`}
            >
              <ListChecks className="w-3 h-3" />{taskSummary.done}/{taskSummary.total}
            </span>
          )}
          {job.priority && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: withAlpha(prioColor, 0.16), color: prioColor }}>
              {job.priority}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted flex-wrap">
        {job.vor && (
          <span className="inline-flex items-center gap-1 font-semibold" style={{ color: TONE_COLOR.red }}>
            <Car className="w-3 h-3" /> VOR
          </span>
        )}
        {Number.isFinite(tgt) && (
          <span className={overdue ? 'font-semibold' : ''} style={overdue ? { color: TONE_COLOR.red } : undefined}>
            <Clock className="w-3 h-3 inline mr-0.5" />
            {overdue ? 'Overdue' : 'Target'} {new Date(tgt).toLocaleDateString()}
          </span>
        )}
        {ownerName && <span className="truncate"><User className="w-3 h-3 inline mr-0.5" />{ownerName}</span>}
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-1.5">
        <select
          aria-label="Assign technician"
          disabled={busy}
          value={job.assigned_owner_id || ''}
          onChange={(e) => {
            const to = e.target.value
            if (!to) return
            const from = job.assigned_owner_id
            if (from && String(from) !== String(to)) onReassign(job.id, from, to)
            else onAssign(job.id, to)
          }}
          className="text-[11px] rounded-lg px-1.5 py-1 border truncate"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
        >
          <option value="">Assign to...</option>
          {technicians.map((t) => <option key={t.userId} value={t.userId}>{t.name}</option>)}
        </select>

        <select
          aria-label="Move status"
          disabled={busy}
          value={STATUS_MOVES.includes(canonicalStatus) ? canonicalStatus : ''}
          onChange={(e) => e.target.value && onStatus(job.id, e.target.value)}
          className="text-[11px] rounded-lg px-1.5 py-1 border truncate"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
        >
          <option value="">Move to...</option>
          {STATUS_MOVES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          aria-label="Set priority"
          disabled={busy}
          value={PRIORITY_OPTS.find((p) => normStatus(p) === prio) || ''}
          onChange={(e) => e.target.value && onPriority(job.id, e.target.value)}
          className="text-[11px] rounded-lg px-1.5 py-1 border truncate"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
        >
          <option value="">Priority...</option>
          {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <button
          type="button"
          disabled={busy}
          onClick={() => onVor(job.id, !job.vor)}
          className="text-[11px] rounded-lg px-1.5 py-1 border font-medium disabled:opacity-40"
          style={{
            background: job.vor ? withAlpha(TONE_COLOR.red, 0.16) : 'var(--surface-2)',
            borderColor: job.vor ? withAlpha(TONE_COLOR.red, 0.4) : 'var(--border-dim)',
            color: job.vor ? TONE_COLOR.red : 'var(--panel-ink)',
          }}
        >
          {job.vor ? 'Clear VOR' : 'Set VOR'}
        </button>
      </div>

      {hasTasks && (
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div className="h-full rounded-full" style={{ width: `${taskSummary.pct}%`, background: TONE_COLOR.green }} />
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSmartAssign(job)}
          className="text-[11px] rounded-lg px-2 py-1 border font-medium inline-flex items-center gap-1 disabled:opacity-40"
          style={{ background: withAlpha(TONE_COLOR.green, 0.12), borderColor: withAlpha(TONE_COLOR.green, 0.4), color: TONE_COLOR.green }}
          title="Suggest the best technician by skill, availability and workload"
        >
          <Sparkles className="w-3 h-3" /> Smart assign
        </button>
        <button
          type="button"
          onClick={() => onToggleTasks(job.id)}
          className="text-[11px] rounded-lg px-2 py-1 border font-medium inline-flex items-center gap-1"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          aria-expanded={expanded}
        >
          <ListChecks className="w-3 h-3" /> Tasks{hasTasks ? ` (${taskSummary.total})` : ''}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onManageTasks(job)}
          className="text-[11px] rounded-lg px-2 py-1 border font-medium inline-flex items-center gap-1 disabled:opacity-40"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          title="Split this job into tasks"
        >
          <Plus className="w-3 h-3" /> Split
        </button>
      </div>

      {expanded && (
        <div className="rounded-lg p-2 flex flex-col gap-1.5" style={{ background: 'var(--surface-2)' }}>
          {(!tasks || tasks.length === 0) ? (
            <div className="text-[11px] text-muted text-center py-2">
              No tasks yet. Use Split to break this job into tasks.
            </div>
          ) : tasks.map((tk) => {
            const tone = TASK_TONE[tk.status] || TONE_COLOR.grey
            const assigneeName = tk.assignee ? (techById[tk.assignee]?.name || 'Assigned') : null
            return (
              <div key={tk.id} className="rounded-lg px-2 py-1.5 border" style={{ background: 'var(--surface-1)', borderColor: 'var(--border-dim)' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-white truncate flex-1">
                    {tk.title}
                    {tk.skill ? <span className="text-muted"> · {tk.skill}</span> : null}
                  </span>
                  <select
                    aria-label={`Set status for ${tk.title}`}
                    disabled={busy}
                    value={tk.status}
                    onChange={(e) => onSetTaskStatus(tk.id, e.target.value, job.id)}
                    className="text-[10px] rounded px-1 py-0.5 border shrink-0"
                    style={{ background: 'var(--surface-2)', borderColor: withAlpha(tone, 0.4), color: tone }}
                  >
                    {TASK_STATUS.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted mt-0.5">
                  <span className="tabular-nums">{fmtMins(tk.minutesSpent)} spent</span>
                  {tk.est_minutes != null && <span className="tabular-nums">/ {fmtMins(tk.est_minutes)} est</span>}
                  {tk.overBudget && <span style={{ color: TONE_COLOR.red }}>over budget</span>}
                  {assigneeName && <span className="truncate"><User className="w-2.5 h-2.5 inline mr-0.5" />{assigneeName}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {isQc ? (
          <button type="button" disabled={busy} onClick={() => onComplete(job.id)} className="btn-primary text-[11px] px-2.5 py-1 disabled:opacity-40">
            <CheckCircle2 className="w-3 h-3 inline mr-1" /> Confirm complete
          </button>
        ) : <span />}
        <Link to="/work-orders" className="text-[11px] text-muted hover:text-white inline-flex items-center gap-1">
          Open <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    </div>
  )
}

// ── Delay / root-cause panel ────────────────────────────────────────────────

function DelayPanel({ delays }) {
  const option = useMemo(() => {
    const rows = [...delays].reverse() // ECharts hbar renders bottom-up
    return {
      grid: { left: 8, right: 48, top: 10, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p) => {
          const d = rows[p[0].dataIndex]
          return `${labelReason(d.reason)}<br/>Hours lost: <b>${d.hoursLost}</b><br/>Jobs affected: <b>${d.affectedJobs}</b>`
        },
      },
      xAxis: { type: 'value', name: 'Hours lost', nameTextStyle: { color: '#9ca3af' }, axisLabel: { color: '#9ca3af' }, splitLine: { lineStyle: { color: 'var(--panel-2)' } } },
      yAxis: { type: 'category', data: rows.map((d) => labelReason(d.reason)), axisLabel: { color: '#cbd5e1' } },
      series: [{
        type: 'bar',
        data: rows.map((d, i) => ({ value: d.hoursLost, itemStyle: { color: colorAt(i), borderRadius: [0, 4, 4, 0] } })),
        barMaxWidth: 22,
        label: { show: true, position: 'right', color: '#e5e7eb', formatter: (p) => `${p.value}h` },
      }],
    }
  }, [delays])

  if (!delays.length) {
    return (
      <div className="card p-6 text-center">
        <Timer className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <div className="text-sm text-white font-medium">No blocked time recorded today</div>
        <div className="text-xs text-muted mt-1">Delay causes appear here as technicians log waiting time.</div>
      </div>
    )
  }
  const priTone = { high: TONE_COLOR.red, medium: TONE_COLOR.amber, low: TONE_COLOR.grey }
  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-white mb-1">Delay and Root Cause</h3>
      <p className="text-[11px] text-muted mb-3">Hours lost to blocked time, by cause (today).</p>
      <div style={{ height: Math.max(160, delays.length * 42) }}>
        <EChart option={option} ariaLabel="Delay hours by cause" />
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted">
            <tr className="text-left">
              <th className="py-1 pr-2">Cause</th>
              <th className="py-1 pr-2">Hours</th>
              <th className="py-1 pr-2">Cost impact</th>
              <th className="py-1 pr-2">Responsible</th>
              <th className="py-1 pr-2">Action</th>
              <th className="py-1">Priority</th>
            </tr>
          </thead>
          <tbody className="text-white">
            {delays.map((d) => (
              <tr key={d.reason} className="border-t border-[var(--border)]">
                <td className="py-1 pr-2">{labelReason(d.reason)}</td>
                <td className="py-1 pr-2 tabular-nums">{d.hoursLost}</td>
                <td className="py-1 pr-2 tabular-nums">{d.costImpact != null ? Number(d.costImpact).toLocaleString() : 'N/A'}</td>
                <td className="py-1 pr-2">{d.responsibleDept || 'N/A'}</td>
                <td className="py-1 pr-2 text-muted">{d.suggestedAction || 'N/A'}</td>
                <td className="py-1">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                    style={{ background: `${priTone[d.priority] || TONE_COLOR.grey}22`, color: priTone[d.priority] || TONE_COLOR.grey }}>
                    {d.priority || 'low'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function labelReason(r) {
  const map = {
    parts: 'Waiting for Parts', tools: 'Waiting for Tools', approval: 'Waiting for Approval',
    vehicle: 'Waiting for Vehicle', vendor: 'Vendor Delay', support: 'Waiting for Support',
  }
  return map[r] || String(r || 'Other').replace(/_/g, ' ')
}

// ── Alerts rail ────────────────────────────────────────────────────────────

function AlertsRail({ alerts, onFocus }) {
  if (!alerts.length) {
    return (
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><Bell className="w-4 h-4" /> Alerts</h3>
        <div className="text-xs text-muted flex items-center gap-2 py-4 justify-center">
          <CheckCircle2 className="w-4 h-4" style={{ color: TONE_COLOR.green }} /> All clear
        </div>
      </div>
    )
  }
  const order = { critical: 0, warning: 1, info: 2 }
  const sorted = [...alerts].sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3))
  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
        <Bell className="w-4 h-4" /> Alerts <span className="text-muted font-normal">({alerts.length})</span>
      </h3>
      <div className="flex flex-col gap-2 max-h-[520px] overflow-y-auto pr-1">
        {sorted.map((a, i) => {
          const c = ALERT_TONE[a.level] || TONE_COLOR.grey
          return (
            <button
              key={`${a.type}-${a.ref}-${i}`}
              type="button"
              onClick={() => onFocus(a.ref)}
              className="text-left rounded-lg px-2.5 py-2 border transition-colors hover:brightness-110"
              style={{ background: withAlpha(c, 0.1), borderColor: withAlpha(c, 0.3) }}
            >
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c }} />
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c }}>{a.level}</span>
              </div>
              <div className="text-xs text-white mt-0.5">{a.message}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Modal shell ────────────────────────────────────────────────────────────
// Fixed overlay (NOT inside a .card, which clips overflow) so pickers are never
// hidden. Mobile-friendly: full-width sheet on small screens, centred on large.

function ModalShell({ title, icon: Icon, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="w-full sm:max-w-lg max-h-[90vh] rounded-t-2xl sm:rounded-2xl border flex flex-col"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border-dim)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 p-4 border-b" style={{ borderColor: 'var(--border-dim)' }}>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4" />} {title}
          </h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-white" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="p-3 border-t" style={{ borderColor: 'var(--border-dim)' }}>{footer}</div>}
      </div>
    </div>
  )
}

// ── Smart assign modal (job -> ranked technicians) ──────────────────────────

function SmartAssignModal({ job, board, technicians, skillsByUser, assignments, busy, onClose, onAssign, onReassign }) {
  const recs = useMemo(
    () => recommendTechnicians(job, { technicians, skillsByUser, board, assignments }),
    [job, technicians, skillsByUser, board, assignments],
  )
  const top = recs.slice(0, 3)
  const owner = job.assigned_owner_id || null

  const pick = (userId) => {
    if (owner && String(owner) !== String(userId)) onReassign(job.id, owner, userId)
    else onAssign(job.id, userId)
    onClose()
  }

  const Row = ({ r, suggested }) => {
    const c = r.score >= 70 ? TONE_COLOR.green : r.score >= 45 ? TONE_COLOR.amber : TONE_COLOR.grey
    return (
      <div className="rounded-xl p-3 border flex items-start gap-3" style={{ background: 'var(--surface-2)', borderColor: suggested ? withAlpha(TONE_COLOR.green, 0.4) : 'var(--border-dim)' }}>
        <div className="flex flex-col items-center shrink-0">
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: withAlpha(c, 0.18), color: c }}>
            {r.score}
          </div>
          <span className="text-[9px] text-muted mt-0.5">/ 100</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white truncate">{r.name}</span>
            {suggested && <Sparkles className="w-3 h-3" style={{ color: TONE_COLOR.green }} />}
            {r.available && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: withAlpha(TONE_COLOR.green, 0.16), color: TONE_COLOR.green }}>Available</span>}
          </div>
          <div className="text-[11px] text-muted mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            {r.reasons.slice(0, 4).map((rn, i) => <span key={i}>· {rn}</span>)}
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => pick(r.userId)} className="btn-primary text-[11px] px-3 py-1.5 shrink-0 disabled:opacity-40">
          Assign
        </button>
      </div>
    )
  }

  return (
    <ModalShell title={`Smart assign · ${job.work_order_no || 'Job'}`} icon={Sparkles} onClose={onClose}>
      <p className="text-[11px] text-muted mb-3">
        Ranked by skill match, availability, workload and site. {job.work_type ? `Job type: ${job.work_type}.` : 'No job type set - skill match is neutral.'}
      </p>
      {recs.length === 0 ? (
        <div className="text-sm text-muted text-center py-6">No eligible technicians (all off duty or absent).</div>
      ) : (
        <div className="flex flex-col gap-3">
          {top.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Suggested</div>
              <div className="flex flex-col gap-2">{top.map((r) => <Row key={r.userId} r={r} suggested />)}</div>
            </div>
          )}
          {recs.length > top.length && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">All technicians</div>
              <div className="flex flex-col gap-2">{recs.slice(3).map((r) => <Row key={r.userId} r={r} />)}</div>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  )
}

// ── Task management modal (split a job into tasks) ──────────────────────────

function TaskModal({ job, tasks, technicians, busy, onClose, onCreate, onUpdate, onSetStatus }) {
  const [title, setTitle] = useState('')
  const [skill, setSkill] = useState('')
  const [est, setEst] = useState('')

  const add = () => {
    if (!title.trim()) return
    onCreate(job.id, { title: title.trim(), skill: skill.trim() || null, est_minutes: est === '' ? null : Number(est) })
    setTitle(''); setSkill(''); setEst('')
  }

  return (
    <ModalShell title={`Tasks · ${job.work_order_no || 'Job'}`} icon={ClipboardList} onClose={onClose}>
      <div className="flex flex-col gap-2 mb-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title (e.g. Remove and inspect steer tyres)"
          className="text-sm rounded-lg px-3 py-2 border w-full"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
        />
        <div className="flex gap-2">
          <input
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            placeholder="Skill (optional)"
            className="text-sm rounded-lg px-3 py-2 border flex-1 min-w-0"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          />
          <input
            value={est}
            onChange={(e) => setEst(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Est. min"
            inputMode="numeric"
            className="text-sm rounded-lg px-3 py-2 border w-24"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          />
          <button type="button" disabled={busy || !title.trim()} onClick={add} className="btn-primary text-sm px-3 py-2 shrink-0 disabled:opacity-40">
            <Plus className="w-4 h-4 inline" /> Add
          </button>
        </div>
      </div>

      {(!tasks || tasks.length === 0) ? (
        <div className="text-sm text-muted text-center py-4">No tasks yet. Add the first one above.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((tk) => {
            const tone = TASK_TONE[tk.status] || TONE_COLOR.grey
            return (
              <div key={tk.id} className="rounded-lg p-2.5 border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-white truncate flex-1">{tk.title}</span>
                  <span className="text-[10px] tabular-nums text-muted shrink-0">{fmtMins(tk.minutesSpent)}{tk.est_minutes != null ? ` / ${fmtMins(tk.est_minutes)}` : ''}</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <select
                    aria-label="Task status"
                    disabled={busy}
                    value={tk.status}
                    onChange={(e) => onSetStatus(tk.id, e.target.value)}
                    className="text-[11px] rounded-lg px-2 py-1 border"
                    style={{ background: 'var(--surface-1)', borderColor: withAlpha(tone, 0.4), color: tone }}
                  >
                    {TASK_STATUS.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
                  </select>
                  <select
                    aria-label="Task assignee"
                    disabled={busy}
                    value={tk.assignee || ''}
                    onChange={(e) => onUpdate(tk.id, { assignee_user_id: e.target.value || null })}
                    className="text-[11px] rounded-lg px-2 py-1 border flex-1 min-w-0 truncate"
                    style={{ background: 'var(--surface-1)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
                  >
                    <option value="">Unassigned</option>
                    {technicians.map((t) => <option key={t.userId} value={t.userId}>{t.name}</option>)}
                  </select>
                  {tk.overBudget && <span className="text-[10px] shrink-0" style={{ color: TONE_COLOR.red }}>over</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </ModalShell>
  )
}

// ── Foreman action drawer (per technician) ──────────────────────────────────

function TechDrawer({ tech, meta, assignments, skillsByUser, busy, onClose, onEvent, onNotify, onOpenJob }) {
  const [note, setNote] = useState('')
  const activeJobs = useMemo(
    () => (assignments || []).filter((a) => a.active !== false && String(a.user_id) === String(tech.userId)),
    [assignments, tech.userId],
  )
  const skills = skillsByUser?.[tech.userId] || []
  const phone = meta?.phone || null

  const Action = ({ icon: Icon, label, tone, onClick, disabled, title }) => (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      title={title}
      className="w-full text-left rounded-lg px-3 py-2.5 border flex items-center gap-2.5 text-sm font-medium disabled:opacity-40"
      style={{ background: 'var(--surface-2)', borderColor: withAlpha(tone || TONE_COLOR.grey, 0.35), color: 'var(--panel-ink)' }}
    >
      <Icon className="w-4 h-4 shrink-0" style={{ color: tone || 'var(--text-muted)' }} /> {label}
    </button>
  )

  return (
    <ModalShell title={`Foreman actions · ${tech.name}`} icon={Settings2} onClose={onClose}>
      <div className="flex items-center gap-2 mb-3">
        <StatusPill status={tech.status} />
        {tech.job && <span className="text-[11px] text-muted truncate">on {tech.job.no || 'a job'}</span>}
      </div>

      <div className="flex flex-col gap-2">
        <Action
          icon={PauseCircle} label="Mark temporarily unavailable" tone={TONE_COLOR.amber}
          title="Logs a support pause on the technician (counts as blocked time, shown in the delay panel)"
          onClick={() => onEvent(tech.userId, { event_type: 'pause_job', reason_code: 'support', note: 'Marked unavailable by foreman', job_id: tech.currentJobId || null })}
        />
        <Action
          icon={Package} label="Escalate parts" tone={TONE_COLOR.blue}
          title="Records a parts request and foreman-confirms it"
          onClick={() => onEvent(tech.userId, { event_type: 'request_parts', reason_code: 'parts', note: 'Parts escalated by foreman', job_id: tech.currentJobId || null, confirm: true })}
        />
        <Action
          icon={ShieldAlert} label="Escalate approval" tone={TONE_COLOR.blue}
          title="Records a waiting-for-approval event and foreman-confirms it"
          onClick={() => onEvent(tech.userId, { event_type: 'waiting_approval', reason_code: 'approval', note: 'Approval escalated by foreman', job_id: tech.currentJobId || null, confirm: true })}
        />
        <Action
          icon={GraduationCap} label="Send to training" tone={TONE_COLOR.purple}
          title="Moves the technician to training (excluded from utilization)"
          onClick={() => onEvent(tech.userId, { event_type: 'training', note: 'Assigned to training by foreman' })}
        />
        {phone ? (
          <a
            href={safeHref(`tel:${String(phone).replace(/[^+0-9]/g, '')}`) || undefined}
            className="w-full text-left rounded-lg px-3 py-2.5 border flex items-center gap-2.5 text-sm font-medium"
            style={{ background: 'var(--surface-2)', borderColor: withAlpha(TONE_COLOR.green, 0.35), color: 'var(--panel-ink)' }}
          >
            <Phone className="w-4 h-4 shrink-0" style={{ color: TONE_COLOR.green }} /> Call {phone}
          </a>
        ) : (
          <div className="w-full rounded-lg px-3 py-2.5 border flex items-center gap-2.5 text-sm text-muted" style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)' }}>
            <Phone className="w-4 h-4 shrink-0" /> No phone number on file
          </div>
        )}
        {tech.currentJobId && (
          <Action icon={ExternalLink} label="Open current job" tone={TONE_COLOR.grey} onClick={() => onOpenJob(tech.currentJobId)} />
        )}
      </div>

      {/* Send note to technician (records an activity annotation, not a push) */}
      <div className="mt-4">
        <label className="text-[11px] font-semibold text-white flex items-center gap-1.5 mb-1"><Send className="w-3.5 h-3.5" /> Send note to technician</label>
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Message (logged to their activity feed)"
            className="text-sm rounded-lg px-3 py-2 border flex-1 min-w-0"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          />
          <button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => { onNotify(tech.userId, note.trim()); setNote('') }}
            className="btn-primary text-sm px-3 py-2 shrink-0 disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="text-[10px] text-muted mt-1">Recorded as a note on the technician's activity log (audit trail). Push delivery is not wired.</p>
      </div>

      {/* Workload by skill + shift */}
      <div className="mt-4 rounded-lg p-3 border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)' }}>
        <div className="text-[11px] font-semibold text-white flex items-center gap-1.5 mb-2"><Layers className="w-3.5 h-3.5" /> Workload by skill and shift</div>
        <div className="grid grid-cols-3 gap-2 text-center mb-2">
          <div><div className="text-base font-bold text-white tabular-nums">{activeJobs.length}</div><div className="text-[10px] text-muted">Active jobs</div></div>
          <div><div className="text-base font-bold text-white tabular-nums">{skills.length}</div><div className="text-[10px] text-muted">Skills</div></div>
          <div><div className="text-base font-bold text-white tabular-nums">{tech.utilization == null ? 'N/A' : `${Math.round(tech.utilization * 100)}%`}</div><div className="text-[10px] text-muted">Utilization</div></div>
        </div>
        <div className="text-[11px] text-muted">Shift: <span className="text-white">{tech.shift || 'None assigned'}</span></div>
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {skills.map((s) => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: withAlpha(TONE_COLOR.blue, 0.14), color: TONE_COLOR.blue }}>{s}</span>)}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 rounded-xl" style={{ background: 'var(--surface-2)' }} />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-52 rounded-xl" style={{ background: 'var(--surface-2)' }} />)}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function WorkshopLive() {
  const { profile } = useAuth()
  const [raw, setRaw] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)      // { type:'ok'|'err', msg }
  const [filter, setFilter] = useState(null)     // { scope, key }
  const [siteFilter, setSiteFilter] = useState('All')
  const [nowTs, setNowTs] = useState(() => Date.now())
  const [highlightRef, setHighlightRef] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [skillsByUser, setSkillsByUser] = useState({})
  const [tasksByJob, setTasksByJob] = useState({})     // { [jobId]: rawTask[] }
  const [expandedJobs, setExpandedJobs] = useState({})  // { [jobId]: bool }
  const [smartAssignJob, setSmartAssignJob] = useState(null)
  const [taskModalJob, setTaskModalJob] = useState(null)
  const [drawerTech, setDrawerTech] = useState(null)

  const reloadTimer = useRef(null)
  const flashTimer = useRef(null)
  const mounted = useRef(true)

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    try {
      const [data, skills, config] = await Promise.all([
        workshop.loadLiveBoard({}),
        workshop.listTechnicianSkills({}).catch(() => ({})),
        loadWorkshopConfig().catch(() => null),
      ])
      if (!mounted.current) return
      setRaw(data)
      setSkillsByUser(skills || {})
      if (config) setCfg(config)
      setError(null)
      setNowTs(Date.now())
      setUpdatedAt(new Date())
    } catch (e) {
      if (!mounted.current) return
      setError(toUserMessage(e))
    } finally {
      if (!mounted.current) return
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => load({ silent: true }), 1500)
  }, [load])

  useEffect(() => {
    mounted.current = true
    load()
    return () => {
      mounted.current = false
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [load])

  // Realtime: reload (debounced) on workshop activity + work order changes.
  useEffect(() => {
    const channel = supabase
      .channel('workshop-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tech_activity_events' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wo_assignments' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wo_tasks' }, scheduleReload)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [scheduleReload])

  // 60s poll fallback + a lightweight clock tick (keeps relative times / overdue fresh).
  useEffect(() => {
    const poll = setInterval(() => load({ silent: true }), 60000)
    const tick = setInterval(() => setNowTs(Date.now()), 30000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  // ── Engine derivation (all maths here, not recomputed by hand) ─────────────
  const todayStart = useMemo(() => { const d = new Date(nowTs); d.setHours(0, 0, 0, 0); return d.getTime() }, [nowTs])

  const board = useMemo(() => {
    if (!raw) return []
    return buildBoard(raw.technicians, raw.eventsByUser, {
      now: nowTs,
      shiftByUser: raw.shiftByUser,
      presentByUser: raw.presentByUser,
      jobsById: raw.jobsById,
    })
  }, [raw, nowTs])

  const kpis = useMemo(() => computeKpis(board, raw?.jobs || [], { now: nowTs, todayStart }), [board, raw, nowTs, todayStart])
  const alerts = useMemo(
    () => deriveAlerts(board, raw?.jobs || [], { now: nowTs, assignments: raw?.assignments || [], presentByUser: raw?.presentByUser || {}, thresholds: cfg?.thresholds }),
    [board, raw, nowTs, cfg],
  )
  const delays = useMemo(() => delayBreakdown(board, { jobs: raw?.jobs || [], labourRate: cfg?.labourRate }), [board, raw, cfg])

  const kpiDefs = useMemo(() => buildKpiDefs(kpis), [kpis])

  // Flat event list (grouped by user in the load) so task time can be scoped by job.
  const allEvents = useMemo(() => Object.values(raw?.eventsByUser || {}).flat(), [raw])
  const eventsForJob = useCallback((jobId) => allEvents.filter((e) => String(e.job_id) === String(jobId)), [allEvents])

  // Per-job task rollup + summary (from the cached raw tasks + this job's events).
  const taskRollupByJob = useMemo(() => {
    const out = {}
    for (const [jobId, tks] of Object.entries(tasksByJob)) {
      out[jobId] = taskRollup(tks, eventsForJob(jobId), { now: nowTs })
    }
    return out
  }, [tasksByJob, eventsForJob, nowTs])

  const taskSummaryByJob = useMemo(() => {
    const out = {}
    for (const [jobId, tks] of Object.entries(tasksByJob)) out[jobId] = jobTaskSummary(tks)
    return out
  }, [tasksByJob])

  // Technician metadata (phone) from the raw roster, for the foreman drawer.
  const techMetaById = useMemo(() => Object.fromEntries((raw?.technicians || []).map((t) => [t.id, t])), [raw])

  // Site options (client-side filter over the loaded board + jobs).
  const siteOptions = useMemo(() => {
    const s = new Set()
    board.forEach((b) => b.site && s.add(b.site))
    ;(raw?.jobs || []).forEach((j) => j.site && s.add(j.site))
    return ['All', ...[...s].sort()]
  }, [board, raw])

  const techById = useMemo(() => Object.fromEntries(board.map((b) => [b.userId, b])), [board])

  // Apply site + KPI filter to the two surfaces.
  const bySite = (site) => siteFilter === 'All' || site === siteFilter

  const filteredBoard = useMemo(() => {
    let list = board.filter((b) => bySite(b.site))
    if (filter?.scope === 'tech') {
      const def = kpiDefs.find((d) => d.key === filter.key)
      if (def?.pred) list = list.filter(def.pred)
    }
    return list
  }, [board, filter, kpiDefs, siteFilter])

  const filteredJobs = useMemo(() => {
    let list = (raw?.jobs || []).filter((j) => bySite(j.site))
    if (filter?.scope === 'job') {
      const def = kpiDefs.find((d) => d.key === filter.key)
      if (def?.jobPred) list = list.filter(def.jobPred)
      else if (def?.jobCol) list = list.filter((j) => jobColumnKey(j, nowTs) === def.jobCol)
      // openJobs (jobCol null) keeps every open job already returned by the service.
    }
    return list
  }, [raw, filter, kpiDefs, siteFilter, nowTs])

  const columns = useMemo(() => {
    const buckets = Object.fromEntries(KANBAN_COLUMNS.map((c) => [c.key, []]))
    for (const j of filteredJobs) {
      const key = jobColumnKey(j, nowTs)
      ;(buckets[key] || buckets['Awaiting Assignment']).push(j)
    }
    return buckets
  }, [filteredJobs, nowTs])

  const openJobsForAssign = useMemo(
    () => (raw?.jobs || []).filter((j) => bySite(j.site)),
    [raw, siteFilter],
  )

  // ── Actions ────────────────────────────────────────────────────────────────
  const mutate = useCallback(async (promise, okMsg) => {
    setBusy(true)
    try {
      await promise
      setFlash({ type: 'ok', msg: okMsg })
      scheduleReload()
    } catch (e) {
      setFlash({ type: 'err', msg: toUserMessage(e) })
    } finally {
      setBusy(false)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => mounted.current && setFlash(null), 4000)
    }
  }, [scheduleReload])

  const onAssign = (jobId, userId) => mutate(workshop.assignJob({ job_id: jobId, user_id: userId }), 'Technician assigned.')
  const onReassign = (jobId, from, to) => mutate(workshop.reassignJob({ job_id: jobId, from_user_id: from, to_user_id: to }), 'Job reassigned.')
  const onStatus = (jobId, status) => mutate(workshop.setJobStatus(jobId, status), 'Status updated.')
  const onPriority = (jobId, priority) => mutate(workshop.setJobPriority(jobId, priority), 'Priority updated.')
  const onVor = (jobId, on) => mutate(workshop.setVor(jobId, on), on ? 'Marked Vehicle Off Road.' : 'Cleared Vehicle Off Road.')
  const onComplete = (jobId) => mutate(workshop.setJobStatus(jobId, 'Completed'), 'Job marked complete.')
  const onConfirm = (eventId) => mutate(workshop.confirmEvent(eventId), 'Task confirmed.')

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const refreshTasks = useCallback(async (jobId) => {
    try {
      const rows = await workshop.listTasks(jobId)
      if (mounted.current) setTasksByJob((cur) => ({ ...cur, [jobId]: rows }))
    } catch {
      // Non-fatal: leave the cached task list; the mutate() flash reports errors.
    }
  }, [])

  const toggleTasks = useCallback((jobId) => {
    setExpandedJobs((cur) => {
      const next = { ...cur, [jobId]: !cur[jobId] }
      if (next[jobId] && !tasksByJob[jobId]) refreshTasks(jobId)
      return next
    })
  }, [tasksByJob, refreshTasks])

  const openTaskModal = useCallback((job) => {
    setTaskModalJob(job)
    if (!tasksByJob[job.id]) refreshTasks(job.id)
  }, [tasksByJob, refreshTasks])

  const onCreateTask = (jobId, values) =>
    mutate(workshop.createTask(jobId, values).then(() => refreshTasks(jobId)), 'Task added.')
  const onUpdateTask = (jobId, taskId, patch) =>
    mutate(workshop.updateTask(taskId, patch).then(() => refreshTasks(jobId)), 'Task updated.')
  const onSetTaskStatus = (jobId, taskId, status) =>
    mutate(workshop.setTaskStatus(taskId, status).then(() => refreshTasks(jobId)), 'Task status updated.')

  // ── Foreman drawer events ────────────────────────────────────────────────────
  const onForemanEvent = (userId, { event_type, reason_code, note, job_id, confirm }) => {
    const label = {
      pause_job: 'Technician marked unavailable.', request_parts: 'Parts escalated.',
      waiting_approval: 'Approval escalated.', training: 'Technician sent to training.',
    }[event_type] || 'Action recorded.'
    const run = workshop.recordEvent({ user_id: userId, event_type, reason_code, note, job_id })
      .then((row) => (confirm && row?.id ? workshop.confirmEvent(row.id) : row))
    mutate(run, label)
    setDrawerTech(null)
  }

  const onForemanNotify = (userId, message) =>
    mutate(
      workshop.recordEvent({ user_id: userId, event_type: 'report_problem', note: `Foreman note: ${message}` }),
      'Note sent to technician.',
    )

  const openJobById = (jobId) => { setDrawerTech(null); focusRef(jobId) }

  const focusRef = (ref) => {
    setHighlightRef(ref)
    const el = document.getElementById(`ref-${ref}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => mounted.current && setHighlightRef(null), 2500)
  }

  const toggleFilter = (def) => {
    if (!def.scope) return
    setFilter((cur) => (cur && cur.key === def.key ? null : { scope: def.scope, key: def.key }))
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading && !raw) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <PageHeader title="Workshop Live Control" subtitle="Real-time technician productivity and job flow" icon={Activity} />
        <Skeleton />
      </div>
    )
  }

  if (error && !raw) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <PageHeader title="Workshop Live Control" subtitle="Real-time technician productivity and job flow" icon={Activity} />
        <div className="card p-8 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3" style={{ color: TONE_COLOR.amber }} />
          <div className="text-white font-medium">Could not load the workshop board</div>
          <div className="text-sm text-muted mt-1">{error}</div>
          <button onClick={() => load()} className="btn-primary text-sm px-4 py-2 mt-4">
            <RefreshCw className="w-4 h-4 inline mr-1.5" /> Retry
          </button>
        </div>
      </div>
    )
  }

  const emptyBoard = board.length === 0
  const emptyJobs = (raw?.jobs || []).length === 0

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Workshop Live Control"
        subtitle="Real-time technician productivity and job flow"
        icon={Activity}
        onRefresh={() => load({ silent: true })}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            {siteOptions.length > 1 && (
              <select
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
                className="btn-secondary text-xs px-3 py-1.5"
                style={{ color: 'var(--panel-ink)' }}
                aria-label="Filter by site"
              >
                {siteOptions.map((s) => <option key={s} value={s}>{s === 'All' ? 'All sites' : s}</option>)}
              </select>
            )}
            <WorkshopTvShareButton />
          </div>
        }
      />

      {/* Flash banner */}
      {flash && (
        <div
          className="rounded-lg px-3 py-2 text-sm flex items-center gap-2"
          style={{
            background: withAlpha(flash.type === 'ok' ? TONE_COLOR.green : TONE_COLOR.red, 0.14),
            color: flash.type === 'ok' ? TONE_COLOR.green : TONE_COLOR.red,
            border: `1px solid ${withAlpha(flash.type === 'ok' ? TONE_COLOR.green : TONE_COLOR.red, 0.4)}`,
          }}
        >
          {flash.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {flash.msg}
        </div>
      )}

      {/* 1. KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {kpiDefs.map((def) => (
          <KpiCard key={def.key} def={def} active={filter?.key === def.key} onClick={() => toggleFilter(def)} />
        ))}
      </div>

      {filter && (
        <button
          type="button"
          onClick={() => setFilter(null)}
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-white"
        >
          <X className="w-3.5 h-3.5" /> Clear filter ({kpiDefs.find((d) => d.key === filter.key)?.label})
        </button>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6 min-w-0">
          {/* 2. Technician live board */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-white flex items-center gap-2"><Users className="w-4 h-4" /> Technician Board</h2>
              <span className="text-xs text-muted">{filteredBoard.length} of {board.length}</span>
            </div>
            {emptyBoard ? (
              <div className="card p-8 text-center">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <div className="text-white font-medium">No technicians yet</div>
                <div className="text-sm text-muted mt-1">Assign a workshop role or a skills profile to staff to see them here.</div>
              </div>
            ) : filteredBoard.length === 0 ? (
              <div className="card p-6 text-center text-sm text-muted">No technicians match this filter.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredBoard.map((tech) => (
                  <TechCard
                    key={tech.userId}
                    tech={tech}
                    events={raw.eventsByUser?.[tech.userId]}
                    jobs={openJobsForAssign}
                    techById={techById}
                    busy={busy}
                    onAssign={onAssign}
                    onReassign={onReassign}
                    onConfirm={onConfirm}
                    onOpenDrawer={setDrawerTech}
                    highlight={highlightRef === tech.userId}
                  />
                ))}
              </div>
            )}
          </section>

          {/* 3. Job kanban */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-white flex items-center gap-2"><Wrench className="w-4 h-4" /> Job Cards</h2>
              <span className="text-xs text-muted">{filteredJobs.length} jobs</span>
            </div>
            {emptyJobs ? (
              <div className="card p-8 text-center">
                <Wrench className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <div className="text-white font-medium">No open job cards</div>
                <div className="text-sm text-muted mt-1">Open work orders appear here as they are raised.</div>
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {KANBAN_COLUMNS.map((col) => {
                  const items = columns[col.key] || []
                  const isOverdue = col.key === 'Overdue'
                  return (
                    <div key={col.key} className="shrink-0 w-64 rounded-xl p-2" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-dim)' }}>
                      <div className="flex items-center justify-between px-1.5 py-1 mb-2">
                        <span className="text-xs font-semibold" style={{ color: isOverdue && items.length ? TONE_COLOR.red : 'var(--panel-ink)' }}>{col.label}</span>
                        <span className="text-[11px] text-muted tabular-nums">{items.length}</span>
                      </div>
                      <div className="flex flex-col gap-2 max-h-[560px] overflow-y-auto pr-0.5">
                        {items.length === 0 ? (
                          <div className="text-[11px] text-muted text-center py-4 opacity-60">Empty</div>
                        ) : items.map((job) => (
                          <JobCard
                            key={job.id}
                            job={job}
                            now={nowTs}
                            technicians={board}
                            techById={techById}
                            busy={busy}
                            onAssign={onAssign}
                            onReassign={onReassign}
                            onStatus={onStatus}
                            onPriority={onPriority}
                            onVor={onVor}
                            onComplete={onComplete}
                            tasks={taskRollupByJob[job.id]}
                            taskSummary={taskSummaryByJob[job.id]}
                            expanded={!!expandedJobs[job.id]}
                            onToggleTasks={toggleTasks}
                            onManageTasks={openTaskModal}
                            onSmartAssign={setSmartAssignJob}
                            onSetTaskStatus={(taskId, status, jobId) => onSetTaskStatus(jobId, taskId, status)}
                            highlight={highlightRef === job.id}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 4. Delay / root cause */}
          <DelayPanel delays={delays} />
        </div>

        {/* 5. Alerts rail */}
        <aside className="xl:sticky xl:top-4 self-start">
          <AlertsRail alerts={alerts} onFocus={focusRef} />
        </aside>
      </div>

      {smartAssignJob && (
        <SmartAssignModal
          job={smartAssignJob}
          board={board}
          technicians={board}
          skillsByUser={skillsByUser}
          assignments={raw?.assignments || []}
          busy={busy}
          onClose={() => setSmartAssignJob(null)}
          onAssign={onAssign}
          onReassign={onReassign}
        />
      )}

      {taskModalJob && (
        <TaskModal
          job={taskModalJob}
          tasks={taskRollupByJob[taskModalJob.id]}
          technicians={board}
          busy={busy}
          onClose={() => setTaskModalJob(null)}
          onCreate={onCreateTask}
          onUpdate={(taskId, patch) => onUpdateTask(taskModalJob.id, taskId, patch)}
          onSetStatus={(taskId, status) => onSetTaskStatus(taskModalJob.id, taskId, status)}
        />
      )}

      {drawerTech && (
        <TechDrawer
          tech={drawerTech}
          meta={techMetaById[drawerTech.userId]}
          assignments={raw?.assignments || []}
          skillsByUser={skillsByUser}
          busy={busy}
          onClose={() => setDrawerTech(null)}
          onEvent={onForemanEvent}
          onNotify={onForemanNotify}
          onOpenJob={openJobById}
        />
      )}
    </div>
  )
}
