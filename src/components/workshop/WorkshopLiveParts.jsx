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
import { useLanguage } from '../../contexts/LanguageContext'

// Display keys for the vocabularies shown here (stored values never change).
const STATUS_I18N = {
  working: 'working', available: 'available', waiting_parts: 'waitingParts', waiting_approval: 'waitingApproval',
  waiting_tools: 'waitingTools', waiting_vehicle: 'waitingVehicle', on_break: 'onBreak', training: 'training',
  awaiting_inspection: 'awaitingInspection', off_duty: 'offDuty', absent: 'absent', overtime: 'overtime',
}
const WO_STATUS_I18N = {
  'New': 'new', 'Awaiting Assignment': 'awaitingAssignment', 'Assigned': 'assigned',
  'In Progress': 'inProgress', 'Waiting for Parts': 'waitingParts', 'Waiting for Approval': 'waitingApproval',
  'Quality Inspection': 'qualityInspection', 'Completed': 'completed', 'Overdue': 'overdue',
  'Cancelled': 'cancelled', 'On Hold': 'onHold',
}
const PRIORITY_I18N = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low', critical: 'critical', high: 'high', medium: 'medium', low: 'low' }
const TASK_STATUS_I18N = { pending: 'pending', in_progress: 'inProgress', blocked: 'blocked', done: 'done', qc: 'qc' }
const REASON_I18N = { parts: 'parts', tools: 'tools', approval: 'approval', vehicle: 'vehicle', vendor: 'vendor', support: 'support' }

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
  const { t } = useLanguage()
  const meta = STATUS_META[status] || { label: status || t('workshop.live.tech.unknown') }
  const label = STATUS_I18N[status] ? t(`workshop.live.status.${STATUS_I18N[status]}`) : meta.label
  const c = statusColor(status)
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: withAlpha(c, 0.16), color: c, border: `1px solid ${withAlpha(c, 0.4)}` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
      {label}
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
  // False when the database will refuse this user's change to the work order
  // itself (status, priority, Vehicle Off Road, QC). Assigning technicians and
  // managing tasks are separate tables with their own rule and stay enabled.
  canEditJob = true, editJobReason = '',
  // Per-action rights for this job from the work order resolver: which of
  // assign / progress / edit / qc this person has on THIS work order, and the
  // sentence to show when one is refused. When omitted the older single
  // canEditJob switch applies to everything and assigning stays enabled.
  jobRights = null,
}) {
  const { t } = useLanguage()
  const wp = (k, v) => t(`workshop.parts.${k}`, v)
  const woStatusLabel = (s) => (WO_STATUS_I18N[s] ? t(`workorders.statusLabel.${WO_STATUS_I18N[s]}`) : s)
  const prioLabel = (s) => (PRIORITY_I18N[s] ? t(`workorders.priorityLabel.${PRIORITY_I18N[s]}`) : s)
  const taskLabel = (s) => (TASK_STATUS_I18N[s] ? wp(`taskStatus.${TASK_STATUS_I18N[s]}`) : TASK_STATUS_LABEL[s])
  const right = (action) => (jobRights ? jobRights[action] !== false : (action === 'assign' ? true : canEditJob))
  const whyNot = (action) => (right(action) ? undefined : (jobRights?.reason?.(action) || editJobReason || undefined))
  const jobLocked = busy || !right('progress')
  const lockTitle = whyNot('progress')
  const editLocked = busy || !right('edit')
  const assignLocked = busy || !right('assign')
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
          <div className="text-[11px] text-muted truncate">{job.asset_no || wp('job.noAsset')}{job.plate_number ? ` | ${job.plate_number}` : ''}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasTasks && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              style={{ background: withAlpha(TONE_COLOR.blue, 0.16), color: TONE_COLOR.blue }}
              title={wp('job.tasksDone', { done: taskSummary.done, total: taskSummary.total })}
            >
              <ListChecks className="w-3 h-3" />{taskSummary.done}/{taskSummary.total}
            </span>
          )}
          {job.priority && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: withAlpha(prioColor, 0.16), color: prioColor }}>
              {prioLabel(job.priority)}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted flex-wrap">
        {job.vor && (
          <span className="inline-flex items-center gap-1 font-semibold" style={{ color: TONE_COLOR.red }}>
            <Car className="w-3 h-3" /> {wp('job.vor')}
          </span>
        )}
        {Number.isFinite(tgt) && (
          <span className={overdue ? 'font-semibold' : ''} style={overdue ? { color: TONE_COLOR.red } : undefined}>
            <Clock className="w-3 h-3 inline mr-0.5" />
            {overdue ? wp('job.overdue') : wp('job.target')} {new Date(tgt).toLocaleDateString()}
          </span>
        )}
        {ownerName && <span className="truncate"><User className="w-3 h-3 inline mr-0.5" />{ownerName}</span>}
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-1.5">
        <select
          aria-label={wp('job.assignAria')}
          disabled={assignLocked}
          title={whyNot('assign')}
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
          <option value="">{wp('job.assignTo')}</option>
          {technicians.map((tc) => <option key={tc.userId} value={tc.userId}>{tc.name}</option>)}
        </select>

        <select
          aria-label={wp('job.moveAria')}
          disabled={jobLocked}
          title={lockTitle}
          value={STATUS_MOVES.includes(canonicalStatus) ? canonicalStatus : ''}
          onChange={(e) => e.target.value && onStatus(job.id, e.target.value)}
          className="text-[11px] rounded-lg px-1.5 py-1 border truncate"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
        >
          <option value="">{wp('job.moveTo')}</option>
          {STATUS_MOVES.map((s) => <option key={s} value={s}>{woStatusLabel(s)}</option>)}
        </select>

        <select
          aria-label={wp('job.priorityAria')}
          disabled={editLocked}
          title={whyNot('edit')}
          value={PRIORITY_OPTS.find((p) => normStatus(p) === prio) || ''}
          onChange={(e) => e.target.value && onPriority(job.id, e.target.value)}
          className="text-[11px] rounded-lg px-1.5 py-1 border truncate"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
        >
          <option value="">{wp('job.priorityPlaceholder')}</option>
          {PRIORITY_OPTS.map((po) => <option key={po} value={po}>{prioLabel(po)}</option>)}
        </select>

        <button
          type="button"
          disabled={jobLocked}
          title={lockTitle}
          onClick={() => onVor(job.id, !job.vor)}
          className="text-[11px] rounded-lg px-1.5 py-1 border font-medium disabled:opacity-40"
          style={{
            background: job.vor ? withAlpha(TONE_COLOR.red, 0.16) : 'var(--surface-2)',
            borderColor: job.vor ? withAlpha(TONE_COLOR.red, 0.4) : 'var(--border-dim)',
            color: job.vor ? TONE_COLOR.red : 'var(--panel-ink)',
          }}
        >
          {job.vor ? wp('job.clearVor') : wp('job.setVor')}
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
          disabled={assignLocked}
          onClick={() => onSmartAssign(job)}
          className="text-[11px] rounded-lg px-2 py-1 border font-medium inline-flex items-center gap-1 disabled:opacity-40"
          style={{ background: withAlpha(TONE_COLOR.green, 0.12), borderColor: withAlpha(TONE_COLOR.green, 0.4), color: TONE_COLOR.green }}
          title={wp('job.smartAssignTitle')}
        >
          <Sparkles className="w-3 h-3" /> {wp('job.smartAssign')}
        </button>
        <button
          type="button"
          onClick={() => onToggleTasks(job.id)}
          className="text-[11px] rounded-lg px-2 py-1 border font-medium inline-flex items-center gap-1"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          aria-expanded={expanded}
        >
          <ListChecks className="w-3 h-3" /> {wp('job.tasks')}{hasTasks ? ` (${taskSummary.total})` : ''}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <button
          type="button"
          disabled={assignLocked}
          onClick={() => onManageTasks(job)}
          className="text-[11px] rounded-lg px-2 py-1 border font-medium inline-flex items-center gap-1 disabled:opacity-40"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          title={wp('job.splitTitle')}
        >
          <Plus className="w-3 h-3" /> {wp('job.split')}
        </button>
      </div>

      {expanded && (
        <div className="rounded-lg p-2 flex flex-col gap-1.5" style={{ background: 'var(--surface-2)' }}>
          {(!tasks || tasks.length === 0) ? (
            <div className="text-[11px] text-muted text-center py-2">
              {wp('job.noTasks')}
            </div>
          ) : tasks.map((tk) => {
            const tone = TASK_TONE[tk.status] || TONE_COLOR.grey
            const assigneeName = tk.assignee ? (techById[tk.assignee]?.name || wp('job.assigned')) : null
            return (
              <div key={tk.id} className="rounded-lg px-2 py-1.5 border" style={{ background: 'var(--surface-1)', borderColor: 'var(--border-dim)' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-white truncate flex-1">
                    {tk.title}
                    {tk.skill ? <span className="text-muted"> · {tk.skill}</span> : null}
                  </span>
                  <select
                    aria-label={wp('job.taskStatusAria', { title: tk.title })}
                    disabled={busy}
                    value={tk.status}
                    onChange={(e) => onSetTaskStatus(tk.id, e.target.value, job.id)}
                    className="text-[10px] rounded px-1 py-0.5 border shrink-0"
                    style={{ background: 'var(--surface-2)', borderColor: withAlpha(tone, 0.4), color: tone }}
                  >
                    {TASK_STATUS.map((s) => <option key={s} value={s}>{taskLabel(s)}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted mt-0.5">
                  <span className="tabular-nums">{wp('job.spent', { time: fmtMins(tk.minutesSpent) })}</span>
                  {tk.est_minutes != null && <span className="tabular-nums">{wp('job.est', { time: fmtMins(tk.est_minutes) })}</span>}
                  {tk.overBudget && <span style={{ color: TONE_COLOR.red }}>{wp('job.overBudget')}</span>}
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
              disabled={jobLocked || !right('qc')}
              onClick={() => onQcPass(job)}
              className="text-[11px] rounded-lg px-2.5 py-1 border font-semibold inline-flex items-center gap-1 disabled:opacity-40"
              style={{ background: withAlpha(TONE_COLOR.green, 0.16), borderColor: withAlpha(TONE_COLOR.green, 0.4), color: TONE_COLOR.green }}
              title={whyNot('qc') || lockTitle || wp('job.qcPassTitle')}
            >
              <CheckCircle2 className="w-3 h-3" /> {wp('job.qcPass')}
            </button>
            <button
              type="button"
              disabled={jobLocked || !right('qc')}
              onClick={() => onQcFail(job)}
              className="text-[11px] rounded-lg px-2.5 py-1 border font-semibold inline-flex items-center gap-1 disabled:opacity-40"
              style={{ background: withAlpha(TONE_COLOR.red, 0.16), borderColor: withAlpha(TONE_COLOR.red, 0.4), color: TONE_COLOR.red }}
              title={whyNot('qc') || lockTitle || wp('job.qcFailTitle')}
            >
              <XCircle className="w-3 h-3" /> {wp('job.qcFail')}
            </button>
          </div>
        ) : <span />}
        <Link to="/work-orders" className="text-[11px] text-muted hover:text-white inline-flex items-center gap-1">
          {wp('job.open')} <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    </div>
  )
}

// ── Delay / root-cause panel ────────────────────────────────────────────────

const PRI_TONE = { high: TONE_COLOR.red, medium: TONE_COLOR.amber, low: TONE_COLOR.grey }

export function DelayPanel({ delays, bare = false, period = null }) {
  const { t } = useLanguage()
  const wp = (k, v) => t(`workshop.parts.${k}`, v)
  const reason = (r) => (REASON_I18N[r] ? wp(`reason.${REASON_I18N[r]}`) : labelReason(r))
  // `period` names the measured window ("1 to 5 Oct 2026"); null means today.
  const when = period ? wp('delay.inPeriod', { period }) : wp('delay.today')
  const totals = useMemo(() => delayTotals(delays), [delays])
  const option = useMemo(() => {
    const rows = [...delays].reverse() // ECharts hbar renders bottom-up
    return {
      grid: { left: 8, right: 48, top: 10, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p) => {
          const d = rows[p[0].dataIndex]
          return `${reason(d.reason)}<br/>${wp('delay.hoursLost')}: <b>${d.hoursLost}</b><br/>${wp('delay.jobsAffected')}: <b>${d.affectedJobs}</b>`
        },
      },
      xAxis: { type: 'value', name: wp('delay.hoursLost'), nameTextStyle: { color: '#9ca3af' }, axisLabel: { color: '#9ca3af' }, splitLine: { lineStyle: { color: 'var(--panel-2)' } } },
      yAxis: { type: 'category', data: rows.map((d) => reason(d.reason)), axisLabel: { color: '#64748b' } },
      series: [{
        type: 'bar',
        data: rows.map((d, i) => ({ value: d.hoursLost, itemStyle: { color: colorAt(i), borderRadius: [0, 4, 4, 0] } })),
        barMaxWidth: 22,
        label: { show: true, position: 'right', color: '#64748b', formatter: (p) => `${p.value}h` },
      }],
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- labels follow the language (t)
  }, [delays, t])

  const delayColumns = useMemo(() => [
    { id: 'cause', header: wp('delay.cols.cause'), accessorFn: (d) => reason(d.reason), size: 170 },
    { id: 'hours', header: wp('delay.hoursLost'), accessorFn: (d) => Number(d.hoursLost) || 0, size: 100, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.hoursLost}</span> },
    { id: 'jobs', header: wp('delay.jobsAffected'), accessorFn: (d) => Number(d.affectedJobs) || 0, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.affectedJobs ?? 'N/A'}</span> },
    { id: 'cost', header: wp('delay.cols.cost'), accessorFn: (d) => (d.costImpact == null ? null : Number(d.costImpact)), size: 120, meta: { align: 'right', exportValue: (d) => (d.costImpact == null ? 'N/A' : Number(d.costImpact)) },
      cell: ({ row }) => <span className="tabular-nums">{row.original.costImpact != null ? Number(row.original.costImpact).toLocaleString() : 'N/A'}</span> },
    { id: 'dept', header: wp('delay.cols.dept'), accessorFn: (d) => d.responsibleDept || 'N/A', size: 140, meta: { filterVariant: 'select' } },
    { id: 'action', header: wp('delay.cols.action'), accessorFn: (d) => d.suggestedAction || 'N/A', size: 240,
      cell: ({ row }) => <span className="text-muted">{row.original.suggestedAction || 'N/A'}</span> },
    { id: 'priority', header: wp('delay.cols.priority'), accessorFn: (d) => d.priority || 'low', size: 100, meta: { filterVariant: 'select' },
      cell: ({ row }) => {
        const p = row.original.priority || 'low'
        const c = PRI_TONE[p] || TONE_COLOR.grey
        return <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold capitalize" style={{ background: `${c}22`, color: c }}>{PRIORITY_I18N[p] ? t(`workorders.priorityLabel.${PRIORITY_I18N[p]}`) : p}</span>
      } },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- labels follow the language (t)
  ], [t])

  if (!delays.length) {
    return (
      <div className={bare ? 'p-6 text-center' : 'card p-6 text-center'}>
        <Timer className="w-8 h-8 mx-auto mb-2 opacity-40" aria-hidden="true" />
        <div className="text-sm text-white font-medium">{wp('delay.none', { when })}</div>
        <div className="text-xs text-muted mt-1">{wp('delay.noneHint')}</div>
      </div>
    )
  }
  return (
    <div className={bare ? '' : 'card p-4'}>
      {!bare && <h3 className="text-sm font-semibold text-white mb-1">{wp('delay.title')}</h3>}
      <p className="text-[11px] text-muted mb-3">
        {wp(totals.causes === 1 ? 'delay.summaryOne' : 'delay.summary', { period: period || wp('delay.todayWord'), hours: totals.hours, causes: totals.causes, cost: totals.cost == null ? 'N/A' : totals.cost.toLocaleString() })}
      </p>
      <div style={{ height: Math.max(160, delays.length * 42) }}>
        <EChart option={option} ariaLabel={wp('delay.chartAria')} />
      </div>
      <div className="mt-3">
        <EnterpriseTable
          columns={delayColumns}
          data={delays}
          getRowId={(d) => String(d.reason)}
          initialPageSize={25}
          searchPlaceholder={wp('delay.search')}
          emptyMessage={wp('delay.none', { when })}
          exportFileName={reportFileName('Workshop Delay Causes', period || 'Today')}
          reportMeta={{ title: wp('delay.reportTitle') }}
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
  const { t } = useLanguage()
  const wp = (k, v) => t(`workshop.parts.${k}`, v)

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
            {r.available && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: withAlpha(TONE_COLOR.green, 0.16), color: TONE_COLOR.green }}>{wp('smart.available')}</span>}
          </div>
          <div className="text-[11px] text-muted mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            {r.reasons.slice(0, 4).map((rn, i) => <span key={i}>· {rn}</span>)}
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => pick(r.userId)} className="btn-primary text-[11px] px-3 py-1.5 shrink-0 disabled:opacity-40">
          {wp('smart.assign')}
        </button>
      </div>
    )
  }

  return (
    <ModalShell title={wp('smart.title', { no: job.work_order_no || wp('job.job') })} icon={Sparkles} onClose={onClose} busy={busy}>
      <p className="text-[11px] text-muted mb-3">
        {wp('smart.ranked')} {job.work_type ? wp('smart.jobType', { type: job.work_type }) : wp('smart.noJobType')}
      </p>
      {recs.length === 0 ? (
        <div className="text-sm text-muted text-center py-6">{wp('smart.none')}</div>
      ) : (
        <div className="flex flex-col gap-3">
          {top.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">{wp('smart.suggested')}</div>
              <div className="flex flex-col gap-2">{top.map((r) => <Row key={r.userId} r={r} suggested />)}</div>
            </div>
          )}
          {recs.length > top.length && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">{wp('smart.all')}</div>
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
  const { t } = useLanguage()
  const wp = (k, v) => t(`workshop.parts.${k}`, v)
  const taskLabel = (s) => (TASK_STATUS_I18N[s] ? wp(`taskStatus.${TASK_STATUS_I18N[s]}`) : TASK_STATUS_LABEL[s])

  const add = () => {
    if (!title.trim()) return
    onCreate(job.id, { title: title.trim(), skill: skill.trim() || null, est_minutes: est === '' ? null : Number(est) })
    setTitle(''); setSkill(''); setEst('')
  }

  return (
    <ModalShell title={wp('tasks.title', { no: job.work_order_no || wp('job.job') })} icon={ClipboardList} onClose={onClose} busy={busy}>
      <div className="flex flex-col gap-2 mb-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={wp('tasks.titlePlaceholder')}
          aria-label={wp('tasks.titleAria')}
          className="text-sm rounded-lg px-3 py-2 border w-full"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
        />
        <div className="flex gap-2">
          <input
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            placeholder={wp('tasks.skill')}
            aria-label={wp('tasks.skill')}
            className="text-sm rounded-lg px-3 py-2 border flex-1 min-w-0"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          />
          <input
            value={est}
            onChange={(e) => setEst(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder={wp('tasks.estPlaceholder')}
            aria-label={wp('tasks.estAria')}
            inputMode="numeric"
            className="text-sm rounded-lg px-3 py-2 border w-24"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          />
          <button type="button" disabled={busy || !title.trim()} onClick={add} className="btn-primary text-sm px-3 py-2 shrink-0 disabled:opacity-40">
            <Plus className="w-4 h-4 inline" /> {wp('tasks.add')}
          </button>
        </div>
      </div>

      {(!tasks || tasks.length === 0) ? (
        <div className="text-sm text-muted text-center py-4">{wp('tasks.empty')}</div>
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
                    aria-label={wp('tasks.statusAria')}
                    disabled={busy}
                    value={tk.status}
                    onChange={(e) => onSetStatus(tk.id, e.target.value)}
                    className="text-[11px] rounded-lg px-2 py-1 border"
                    style={{ background: 'var(--surface-1)', borderColor: withAlpha(tone, 0.4), color: tone }}
                  >
                    {TASK_STATUS.map((s) => <option key={s} value={s}>{taskLabel(s)}</option>)}
                  </select>
                  <select
                    aria-label={wp('tasks.assigneeAria')}
                    disabled={busy}
                    value={tk.assignee || ''}
                    onChange={(e) => onUpdate(tk.id, { assignee_user_id: e.target.value || null })}
                    className="text-[11px] rounded-lg px-2 py-1 border flex-1 min-w-0 truncate"
                    style={{ background: 'var(--surface-1)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
                  >
                    <option value="">{wp('tasks.unassigned')}</option>
                    {technicians.map((tc) => <option key={tc.userId} value={tc.userId}>{tc.name}</option>)}
                  </select>
                  {tk.overBudget && <span className="text-[10px] shrink-0" style={{ color: TONE_COLOR.red }}>{wp('tasks.over')}</span>}
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
  const { t } = useLanguage()
  const wp = (k, v) => t(`workshop.parts.${k}`, v)
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
    <ModalShell title={wp('drawer.title', { name: tech.name })} icon={Settings2} onClose={onClose} busy={busy}>
      <div className="flex items-center gap-2 mb-3">
        <StatusPill status={tech.status} />
        {tech.job && <span className="text-[11px] text-muted truncate">{wp('drawer.onJob', { job: tech.job.no || wp('drawer.aJob') })}</span>}
      </div>

      {/* Time split today (from the engine rollup) */}
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <TimeCell label={t('workshop.live.tech.productive')} value={fmtMins(tech.productiveMin)} color={TONE_COLOR.green} />
        <TimeCell label={t('workshop.live.tech.blocked')} value={fmtMins(tech.blockedMin)} color={TONE_COLOR.amber} />
        <TimeCell label={wp('tasks.unassigned')} value={fmtMins(tech.unassignedMin)} color={TONE_COLOR.grey} />
      </div>
      <div className="text-[11px] text-muted mb-3">
        {[tech.employeeId, tech.trade, tech.site].filter(Boolean).join(' | ') || wp('drawer.noTrade')}
        {' '}| {wp('drawer.lastActivity', { when: relTime(tech.lastActivityAt, now) })}
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
            aria-label={wp('drawer.assignAria', { name: tech.name })}
          >
            <option value="">{tech.job ? wp('drawer.reassignTo') : wp('drawer.assignJob')}</option>
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
            {wp('smart.assign')}
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
          <CheckCircle2 className="w-4 h-4 inline mr-1" /> {wp('drawer.confirmTask')}
        </button>
      )}

      <div className="flex flex-col gap-2">
        <Action
          icon={PauseCircle} label={wp('drawer.unavailable')} tone={TONE_COLOR.amber}
          title={wp('drawer.unavailableTitle')}
          onClick={() => onEvent(tech.userId, { event_type: 'pause_job', reason_code: 'support', note: 'Marked unavailable by foreman', job_id: tech.currentJobId || null })}
        />
        <Action
          icon={Package} label={wp('drawer.escalateParts')} tone={TONE_COLOR.blue}
          title={wp('drawer.escalatePartsTitle')}
          onClick={() => onEvent(tech.userId, { event_type: 'request_parts', reason_code: 'parts', note: 'Parts escalated by foreman', job_id: tech.currentJobId || null, confirm: true })}
        />
        <Action
          icon={ShieldAlert} label={wp('drawer.escalateApproval')} tone={TONE_COLOR.blue}
          title={wp('drawer.escalateApprovalTitle')}
          onClick={() => onEvent(tech.userId, { event_type: 'waiting_approval', reason_code: 'approval', note: 'Approval escalated by foreman', job_id: tech.currentJobId || null, confirm: true })}
        />
        <Action
          icon={GraduationCap} label={wp('drawer.training')} tone={TONE_COLOR.purple}
          title={wp('drawer.trainingTitle')}
          onClick={() => onEvent(tech.userId, { event_type: 'training', note: 'Assigned to training by foreman' })}
        />
        {phone ? (
          <a
            href={safeHref(`tel:${String(phone).replace(/[^+0-9]/g, '')}`) || undefined}
            className="w-full text-left rounded-lg px-3 py-2.5 border flex items-center gap-2.5 text-sm font-medium"
            style={{ background: 'var(--surface-2)', borderColor: withAlpha(TONE_COLOR.green, 0.35), color: 'var(--panel-ink)' }}
          >
            <Phone className="w-4 h-4 shrink-0" style={{ color: TONE_COLOR.green }} /> {wp('drawer.call', { phone })}
          </a>
        ) : (
          <div className="w-full rounded-lg px-3 py-2.5 border flex items-center gap-2.5 text-sm text-muted" style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)' }}>
            <Phone className="w-4 h-4 shrink-0" /> {wp('drawer.noPhone')}
          </div>
        )}
        {tech.currentJobId && (
          <Action icon={ExternalLink} label={wp('drawer.openJob')} tone={TONE_COLOR.grey} onClick={() => onOpenJob(tech.currentJobId)} />
        )}
      </div>

      {/* Send note to technician (records an activity annotation, not a push) */}
      <div className="mt-4">
        <label className="text-[11px] font-semibold text-white flex items-center gap-1.5 mb-1"><Send className="w-3.5 h-3.5" /> {wp('drawer.noteLabel')}</label>
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={wp('drawer.notePlaceholder')}
            aria-label={wp('drawer.noteAria')}
            className="text-sm rounded-lg px-3 py-2 border flex-1 min-w-0"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }}
          />
          <button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => { onNotify(tech.userId, note.trim()); setNote('') }}
            className="btn-primary text-sm px-3 py-2 shrink-0 disabled:opacity-40"
          >
            {wp('drawer.send')}
          </button>
        </div>
        <p className="text-[10px] text-muted mt-1">{wp('drawer.noteHint')}</p>
      </div>

      {/* Workload by skill + shift */}
      <div className="mt-4 rounded-lg p-3 border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)' }}>
        <div className="text-[11px] font-semibold text-white flex items-center gap-1.5 mb-2"><Layers className="w-3.5 h-3.5" /> {wp('drawer.workload')}</div>
        <div className="grid grid-cols-3 gap-2 text-center mb-2">
          <div><div className="text-base font-bold text-white tabular-nums">{activeJobs.length}</div><div className="text-[10px] text-muted">{wp('drawer.activeJobs')}</div></div>
          <div><div className="text-base font-bold text-white tabular-nums">{skills.length}</div><div className="text-[10px] text-muted">{wp('drawer.skills')}</div></div>
          <div><div className="text-base font-bold text-white tabular-nums">{tech.utilization == null ? 'N/A' : `${Math.round(tech.utilization * 100)}%`}</div><div className="text-[10px] text-muted">{wp('drawer.utilization')}</div></div>
        </div>
        <div className="text-[11px] text-muted">{wp('drawer.shift')} <span className="text-white">{tech.shift || wp('drawer.noShift')}</span></div>
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {skills.map((s) => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: withAlpha(TONE_COLOR.blue, 0.14), color: TONE_COLOR.blue }}>{s}</span>)}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

