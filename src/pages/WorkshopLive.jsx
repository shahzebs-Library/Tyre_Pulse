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
  Bell, User, Zap, ExternalLink,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import * as workshop from '../lib/api/workshopLive'
import {
  buildBoard, computeKpis, deriveAlerts, delayBreakdown,
  STATUS, STATUS_META, statusColor, TONE_COLOR,
} from '../lib/workshopLive'
import EChart from '../components/charts/EChart'
import PageHeader from '../components/ui/PageHeader'
import WorkshopTvShareButton from '../components/workshop/WorkshopTvShareButton'
import { colorAt, withAlpha } from '../lib/reportColors'
import { safeImageSrc } from '../lib/safeUrl'
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

function TechCard({ tech, events, jobs, techById, busy, onAssign, onReassign, onConfirm, highlight }) {
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

function JobCard({ job, now, technicians, techById, busy, onAssign, onReassign, onStatus, onPriority, onVor, onComplete, highlight }) {
  const canonicalStatus = normalizeWoStatus(job.status)
  const tgt = toTs(job.target_completion)
  const overdue = canonicalStatus !== 'Completed' && canonicalStatus !== 'Cancelled' && Number.isFinite(tgt) && tgt < now
  const prio = normStatus(job.priority)
  const prioColor = PRIORITY_TONE[prio] || TONE_COLOR.grey
  const ownerName = job.assigned_owner_id ? (techById[job.assigned_owner_id]?.name || job.technician_name || null) : job.technician_name || null
  const isQc = canonicalStatus === 'Quality Inspection'

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
        {job.priority && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0" style={{ background: withAlpha(prioColor, 0.16), color: prioColor }}>
            {job.priority}
          </span>
        )}
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

  const reloadTimer = useRef(null)
  const flashTimer = useRef(null)
  const mounted = useRef(true)

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    try {
      const data = await workshop.loadLiveBoard({})
      if (!mounted.current) return
      setRaw(data)
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
    () => deriveAlerts(board, raw?.jobs || [], { now: nowTs, assignments: raw?.assignments || [], presentByUser: raw?.presentByUser || {} }),
    [board, raw, nowTs],
  )
  const delays = useMemo(() => delayBreakdown(board, { jobs: raw?.jobs || [] }), [board, raw])

  const kpiDefs = useMemo(() => buildKpiDefs(kpis), [kpis])

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
    </div>
  )
}
