/**
 * WorkshopLiveParts.jsx - the working pieces of the Workshop Live Control page
 * (route /workshop-live), split out of the page so the page file holds only the
 * layout. Every behaviour here is unchanged from the previous single-file page:
 * the job-card kanban card (assign, move, priority, VOR, tasks, QC), the delay
 * and root-cause panel, the smart-assign and task modals, and the foreman
 * drawer (which now also carries the technician's assign control, time split
 * and pending task confirmation that used to sit on the board card).
 *
 * All maths stay in the engines (`workshopLive`, `workshopTasks`,
 * `workshopAssign`, `workshopLiveAnalytics`); these components only render.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock, Package, ShieldAlert, Car, User, ExternalLink, ListChecks, Plus,
  ChevronDown, ChevronUp, Phone, Send, GraduationCap, PauseCircle, Sparkles,
  Settings2, Layers, ClipboardList, XCircle, CheckCircle2, Timer,
} from 'lucide-react'
import { STATUS, STATUS_META, statusColor, TONE_COLOR } from '../../lib/workshopLive'
import { TASK_STATUS, TASK_STATUS_LABEL } from '../../lib/workshopTasks'
import { recommendTechnicians } from '../../lib/workshopAssign'
import EChart from '../charts/EChart'
import Modal from '../ui/Modal'
import EnterpriseTable from '../ui/EnterpriseTable'
import { colorAt, withAlpha } from '../../lib/reportColors'
import { safeHref } from '../../lib/safeUrl'
import { normalizeWoStatus, WO_STATUSES, KANBAN_COLUMNS as WO_KANBAN_COLUMNS } from '../../lib/workOrderStatus'
import { toTs, fmtMins, relTime, delayTotals } from '../../lib/workshopLiveAnalytics'
import { reportFileName } from '../../lib/exportUtils'

// ── Small pure helpers ─────────────────────────────────────────────────────────

const normStatus = (s) => String(s || '').toLowerCase().replace(/\s+/g, '_')

// ── Work-order status vocabulary (canonical Title Case) ────────────────────────
// work_orders.status is free text (no DB CHECK). The kanban + the Move control
// READ and WRITE the ONE canonical Title Case vocabulary from workOrderStatus.js,
// so this dashboard and the legacy Work Orders page speak the same language.

// Kanban columns rendered on the board (canonical Title Case = key + label).
export const KANBAN_COLUMNS = WO_KANBAN_COLUMNS.map((s) => ({ key: s, label: s }))

// Statuses offered in the per-card "Move" control (Overdue is derived, not set).
const STATUS_MOVES = WO_STATUSES.filter((s) => s !== 'Overdue')

const PRIORITY_OPTS = ['Critical', 'High', 'Medium', 'Low']

const PRIORITY_TONE = {
  critical: TONE_COLOR.red, high: TONE_COLOR.amber, medium: TONE_COLOR.blue, low: TONE_COLOR.grey,
}


// Task status -> colour (mirrors the engine TASK_STATUS vocabulary).
const TASK_TONE = {
  pending: TONE_COLOR.grey, in_progress: TONE_COLOR.blue, blocked: TONE_COLOR.amber,
  done: TONE_COLOR.green, qc: TONE_COLOR.purple,
}

// ── Status pill ────────────────────────────────────────────────────────────────

export function StatusPill({ status }) {
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

function TimeCell({ label, value, color }) {
  return (
    <div className="rounded-lg py-1.5" style={{ background: withAlpha(color, 0.1) }}>
      <div className="text-xs font-semibold text-white tabular-nums">{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  )
}

// ── Job card (kanban) ─────────────────────────────────────────────────────────

export function JobCard({
  job, now, technicians, techById, busy, onAssign, onReassign, onStatus, onPriority, onVor, onQcPass, onQcFail, highlight,
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
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => onQcPass(job)}
              className="text-[11px] rounded-lg px-2.5 py-1 border font-semibold inline-flex items-center gap-1 disabled:opacity-40"
              style={{ background: withAlpha(TONE_COLOR.green, 0.16), borderColor: withAlpha(TONE_COLOR.green, 0.4), color: TONE_COLOR.green }}
              title="QC pass: complete the job"
            >
              <CheckCircle2 className="w-3 h-3" /> QC Pass
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onQcFail(job)}
              className="text-[11px] rounded-lg px-2.5 py-1 border font-semibold inline-flex items-center gap-1 disabled:opacity-40"
              style={{ background: withAlpha(TONE_COLOR.red, 0.16), borderColor: withAlpha(TONE_COLOR.red, 0.4), color: TONE_COLOR.red }}
              title="QC fail: send back for rework"
            >
              <XCircle className="w-3 h-3" /> QC Fail
            </button>
          </div>
        ) : <span />}
        <Link to="/work-orders" className="text-[11px] text-muted hover:text-white inline-flex items-center gap-1">
          Open <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    </div>
  )
}

// ── Delay / root-cause panel ────────────────────────────────────────────────

const PRI_TONE = { high: TONE_COLOR.red, medium: TONE_COLOR.amber, low: TONE_COLOR.grey }

export function DelayPanel({ delays, bare = false, period = null }) {
  // `period` names the measured window ("1 to 5 Oct 2026"); null means today.
  const when = period ? `in ${period}` : 'today'
  const totals = useMemo(() => delayTotals(delays), [delays])
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
      yAxis: { type: 'category', data: rows.map((d) => labelReason(d.reason)), axisLabel: { color: '#64748b' } },
      series: [{
        type: 'bar',
        data: rows.map((d, i) => ({ value: d.hoursLost, itemStyle: { color: colorAt(i), borderRadius: [0, 4, 4, 0] } })),
        barMaxWidth: 22,
        label: { show: true, position: 'right', color: '#64748b', formatter: (p) => `${p.value}h` },
      }],
    }
  }, [delays])

  const delayColumns = useMemo(() => [
    { id: 'cause', header: 'Cause', accessorFn: (d) => labelReason(d.reason), size: 170 },
    { id: 'hours', header: 'Hours lost', accessorFn: (d) => Number(d.hoursLost) || 0, size: 100, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.hoursLost}</span> },
    { id: 'jobs', header: 'Jobs affected', accessorFn: (d) => Number(d.affectedJobs) || 0, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.affectedJobs ?? 'N/A'}</span> },
    { id: 'cost', header: 'Cost impact', accessorFn: (d) => (d.costImpact == null ? null : Number(d.costImpact)), size: 120, meta: { align: 'right', exportValue: (d) => (d.costImpact == null ? 'N/A' : Number(d.costImpact)) },
      cell: ({ row }) => <span className="tabular-nums">{row.original.costImpact != null ? Number(row.original.costImpact).toLocaleString() : 'N/A'}</span> },
    { id: 'dept', header: 'Responsible', accessorFn: (d) => d.responsibleDept || 'N/A', size: 140, meta: { filterVariant: 'select' } },
    { id: 'action', header: 'Suggested action', accessorFn: (d) => d.suggestedAction || 'N/A', size: 240,
      cell: ({ row }) => <span className="text-muted">{row.original.suggestedAction || 'N/A'}</span> },
    { id: 'priority', header: 'Priority', accessorFn: (d) => d.priority || 'low', size: 100, meta: { filterVariant: 'select' },
      cell: ({ row }) => {
        const p = row.original.priority || 'low'
        const c = PRI_TONE[p] || TONE_COLOR.grey
        return <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold capitalize" style={{ background: `${c}22`, color: c }}>{p}</span>
      } },
  ], [])

  if (!delays.length) {
    return (
      <div className={bare ? 'p-6 text-center' : 'card p-6 text-center'}>
        <Timer className="w-8 h-8 mx-auto mb-2 opacity-40" aria-hidden="true" />
        <div className="text-sm text-white font-medium">No blocked time recorded {when}</div>
        <div className="text-xs text-muted mt-1">Delay causes appear here as technicians log waiting time.</div>
      </div>
    )
  }
  return (
    <div className={bare ? '' : 'card p-4'}>
      {!bare && <h3 className="text-sm font-semibold text-white mb-1">Delay and Root Cause</h3>}
      <p className="text-[11px] text-muted mb-3">
        Hours lost to blocked time, by cause ({period || 'today'}): {totals.hours}h across {totals.causes} cause{totals.causes === 1 ? '' : 's'},
        {' '}cost impact {totals.cost == null ? 'N/A' : totals.cost.toLocaleString()}.
      </p>
      <div style={{ height: Math.max(160, delays.length * 42) }}>
        <EChart option={option} ariaLabel="Delay hours by cause" />
      </div>
      <div className="mt-3">
        <EnterpriseTable
          columns={delayColumns}
          data={delays}
          getRowId={(d) => String(d.reason)}
          initialPageSize={25}
          searchPlaceholder="Search causes..."
          emptyMessage={`No blocked time recorded ${when}`}
          exportFileName={reportFileName('Workshop Delay Causes', period || 'Today')}
          reportMeta={{ title: 'Workshop Delay and Root Cause' }}
        />
      </div>
    </div>
  )
}

export function labelReason(r) {
  const map = {
    parts: 'Waiting for Parts', tools: 'Waiting for Tools', approval: 'Waiting for Approval',
    vehicle: 'Waiting for Vehicle', vendor: 'Vendor Delay', support: 'Waiting for Support',
  }
  return map[r] || String(r || 'Other').replace(/_/g, ' ')
}

// ── Modal shell ────────────────────────────────────────────────────────────
// Thin adapter over the shared dialog shell (portalled, so pickers are never
// clipped by a .card). While an action is in flight it cannot be dismissed.

function ModalShell({ title, icon: Icon, onClose, children, footer, busy = false }) {
  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      size="md"
      footer={footer}
      title={(
        <span className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4" aria-hidden="true" />} {title}
        </span>
      )}
    >
      {children}
    </Modal>
  )
}

// ── Smart assign modal (job -> ranked technicians) ──────────────────────────

export function SmartAssignModal({ job, board, technicians, skillsByUser, assignments, busy, onClose, onAssign, onReassign }) {
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
    <ModalShell title={`Smart assign · ${job.work_order_no || 'Job'}`} icon={Sparkles} onClose={onClose} busy={busy}>
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

export function TaskModal({ job, tasks, technicians, busy, onClose, onCreate, onUpdate, onSetStatus }) {
  const [title, setTitle] = useState('')
  const [skill, setSkill] = useState('')
  const [est, setEst] = useState('')

  const add = () => {
    if (!title.trim()) return
    onCreate(job.id, { title: title.trim(), skill: skill.trim() || null, est_minutes: est === '' ? null : Number(est) })
    setTitle(''); setSkill(''); setEst('')
  }

  return (
    <ModalShell title={`Tasks · ${job.work_order_no || 'Job'}`} icon={ClipboardList} onClose={onClose} busy={busy}>
      <div className="flex flex-col gap-2 mb-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title (e.g. Remove and inspect steer tyres)"
          aria-label="Task title"
          className="text-sm rounded-lg px-3 py-2 border w-full"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
        />
        <div className="flex gap-2">
          <input
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            placeholder="Skill (optional)"
            aria-label="Skill (optional)"
            className="text-sm rounded-lg px-3 py-2 border flex-1 min-w-0"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          />
          <input
            value={est}
            onChange={(e) => setEst(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Est. min"
            aria-label="Estimated minutes"
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

export function TechDrawer({
  tech, meta, assignments, skillsByUser, busy, onClose, onEvent, onNotify, onOpenJob,
  now, events, jobs = [], onAssign, onReassign, onConfirm,
}) {
  const [note, setNote] = useState('')
  const [assignTo, setAssignTo] = useState('')
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
    <ModalShell title={`Foreman actions · ${tech.name}`} icon={Settings2} onClose={onClose} busy={busy}>
      <div className="flex items-center gap-2 mb-3">
        <StatusPill status={tech.status} />
        {tech.job && <span className="text-[11px] text-muted truncate">on {tech.job.no || 'a job'}</span>}
      </div>

      {/* Time split today (from the engine rollup) */}
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <TimeCell label="Productive" value={fmtMins(tech.productiveMin)} color={TONE_COLOR.green} />
        <TimeCell label="Blocked" value={fmtMins(tech.blockedMin)} color={TONE_COLOR.amber} />
        <TimeCell label="Unassigned" value={fmtMins(tech.unassignedMin)} color={TONE_COLOR.grey} />
      </div>
      <div className="text-[11px] text-muted mb-3">
        {[tech.employeeId, tech.trade, tech.site].filter(Boolean).join(' | ') || 'No trade or site on file'}
        {' '}| Last activity {relTime(tech.lastActivityAt, now)}
      </div>

      {/* Assign / reassign a job card */}
      {onAssign && (
        <div className="flex items-center gap-2 mb-3">
          <select
            value={assignTo}
            onChange={(e) => setAssignTo(e.target.value)}
            disabled={busy}
            className="flex-1 min-w-0 text-sm rounded-lg px-2 py-2 border"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
            aria-label={`Assign a job to ${tech.name}`}
          >
            <option value="">{tech.job ? 'Reassign to job...' : 'Assign a job...'}</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.work_order_no || j.id}{j.asset_no ? ` | ${j.asset_no}` : ''}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !assignTo}
            onClick={() => {
              const target = jobs.find((j) => String(j.id) === String(assignTo))
              if (!target) return
              const fromOwner = target.assigned_owner_id
              if (fromOwner && String(fromOwner) !== String(tech.userId)) onReassign(target.id, fromOwner, tech.userId)
              else onAssign(target.id, tech.userId)
              setAssignTo('')
            }}
            className="btn-secondary text-sm px-3 py-2 disabled:opacity-40"
          >
            Assign
          </button>
        </div>
      )}

      {pendingConfirm && onConfirm && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(pendingConfirm.id)}
          className="btn-primary w-full text-sm px-3 py-2 mb-3 disabled:opacity-40"
        >
          <CheckCircle2 className="w-4 h-4 inline mr-1" /> Confirm completed task
        </button>
      )}

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
            aria-label="Message to technician"
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

