import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckSquare, X, Search, Clock, Inbox, Filter, AlertTriangle,
  ClipboardList, CheckCircle2, XCircle, Undo2, RefreshCw,
  ChevronRight, ServerCrash, Car, ClipboardCheck, Database, Loader2,
  ExternalLink, GitBranch,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import * as workflows from '../lib/api/workflows'
import * as queue from '../lib/api/approvalsQueue'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { formatDistanceToNow } from 'date-fns'
import PageHeader from '../components/ui/PageHeader'
import ApprovalStatusBadge from '../components/workflow/ApprovalStatusBadge'
import ApprovalAction from '../components/workflow/ApprovalAction'
import ApprovalTrail from '../components/workflow/ApprovalTrail'
import { stepRequirements } from '../lib/workflow/stepRequirements'

// ─── Source taxonomy ────────────────────────────────────────────────────────────
// The unified queue merges the V95 workflow engine with the other real
// approval-bearing surfaces in the schema. Every item carries a `source`.

const SOURCE = {
  workflow:         'workflow',
  accident_closure: 'accident_closure',
  checklist:        'checklist',
}

const SOURCE_META = {
  workflow:         { label: 'Workflow',          short: 'Workflow',  icon: GitBranch,      tone: 'blue' },
  accident_closure: { label: 'Accident Closure',  short: 'Closure',   icon: Car,            tone: 'red'  },
  checklist:        { label: 'Checklist Sign-off', short: 'Checklist', icon: ClipboardCheck, tone: 'teal' },
}

// ─── Bucket + metric definitions ───────────────────────────────────────────────

const BUCKETS = [
  { key: 'pending',            label: 'Pending',           icon: Clock,         tone: 'amber'  },
  { key: 'overdue',            label: 'Overdue',           icon: AlertTriangle, tone: 'red'    },
  { key: 'returned',           label: 'Returned',          icon: Undo2,         tone: 'orange' },
  { key: 'rejected',           label: 'Rejected',          icon: XCircle,       tone: 'red'    },
  { key: 'recently_approved',  label: 'Recently Approved', icon: CheckCircle2,  tone: 'green'  },
]

const EMPTY_BUCKETS = {
  pending: [], overdue: [], returned: [], rejected: [], recently_approved: [],
}

const TONE_TEXT = {
  amber:  'text-amber-400',
  red:    'text-red-400',
  orange: 'text-orange-400',
  green:  'text-green-400',
  blue:   'text-blue-400',
  teal:   'text-teal-400',
  gray:   'text-[var(--text-secondary)]',
}

const TONE_BADGE = {
  blue:  'bg-blue-500/15 text-blue-300 border-blue-500/30',
  red:   'bg-red-500/15 text-red-300 border-red-500/30',
  teal:  'bg-teal-500/15 text-teal-300 border-teal-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
}

const TONE_TAB_ACTIVE = {
  amber:  'bg-amber-500/15 text-amber-300 border-amber-500/40',
  red:    'bg-red-500/15 text-red-300 border-red-500/40',
  orange: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  green:  'bg-green-500/15 text-green-300 border-green-500/40',
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function relTime(ts) {
  if (!ts) return null
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }) }
  catch { return null }
}

/** Milliseconds since a timestamp, or null. */
function ageMs(ts) {
  if (!ts) return null
  const t = new Date(ts).getTime()
  return Number.isNaN(t) ? null : Math.max(0, Date.now() - t)
}

function currentStepOf(instance) {
  const steps = Array.isArray(instance?.steps) ? instance.steps : []
  const idx = Math.min(Math.max(instance?.current_step ?? 0, 0), Math.max(steps.length - 1, 0))
  return { step: steps[idx] || null, idx, total: steps.length }
}

function entityLabelOf(i) {
  return i?.entity_label
    || (i?.entity_type ? `${i.entity_type}${i.entity_id ? ` #${i.entity_id}` : ''}` : '—')
}

/** SLA state for a pending-style instance from its current step's sla_hours. */
function slaState(instance) {
  const { step } = currentStepOf(instance)
  const slaHours = Number(step?.sla_hours)
  const started = instance?.step_started_at || instance?.started_at
  const elapsed = ageMs(started)
  if (!slaHours || elapsed == null) return { overdue: false, dueLabel: null }
  const dueMs = slaHours * 3600 * 1000
  return {
    overdue: elapsed > dueMs,
    dueLabel: elapsed > dueMs
      ? `Overdue by ${formatDistanceToNow(new Date(Date.now() - (elapsed - dueMs)))}`
      : `SLA in ${formatDistanceToNow(new Date(Date.now() + (dueMs - elapsed)))}`,
  }
}

// ── Normalisers for the non-workflow sources into a shared row shape ──────────────

function toClosureItem(a) {
  const label = [a.asset_no, a.accident_type].filter(Boolean).join(' · ') || 'Accident'
  return {
    source: SOURCE.accident_closure,
    id: a.id,
    title: `Closure request — ${label}`,
    subtitle: [
      a.driver_name && `Driver ${a.driver_name}`,
      a.incident_date && `Incident ${a.incident_date}`,
      a.severity,
    ].filter(Boolean).join(' · ') || 'Awaiting closure approval',
    note: a.close_request_note || null,
    site: a.site || null,
    country: a.country || null,
    created_at: a.close_requested_at || null,
    status: 'pending',
    raw: a,
  }
}

function toChecklistItem(c) {
  const title = c.title || c.template_name || 'Checklist submission'
  return {
    source: SOURCE.checklist,
    id: c.id,
    title,
    subtitle: [
      c.template_name && c.template_name !== title ? c.template_name : null,
      c.asset_no && `Asset ${c.asset_no}`,
      c.score_pct != null ? `Score ${c.score_pct}%` : null,
    ].filter(Boolean).join(' · ') || 'Awaiting sign-off',
    note: null,
    site: c.site || null,
    country: c.country || null,
    created_at: c.submitted_at || null,
    status: 'pending',
    raw: c,
    scorePassed: c.score_passed,
  }
}

// ─── Metric strip ───────────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, tone, loading }) {
  return (
    <div className="card border border-[var(--border-dim)] bg-[var(--surface-1)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">{label}</span>
        <Icon className={`w-4 h-4 ${TONE_TEXT[tone] || 'text-[var(--text-secondary)]'}`} />
      </div>
      {loading ? (
        <div className="mt-2 h-8 w-16 rounded bg-[var(--surface-2)] animate-pulse" />
      ) : (
        <p className={`mt-1 text-2xl font-bold ${TONE_TEXT[tone] || 'text-[var(--text-primary)]'}`}>{value ?? 0}</p>
      )}
    </div>
  )
}

function MetricStrip({ metrics, loading }) {
  const cards = [
    { key: 'total_pending',     label: 'Pending',           tone: 'amber', icon: Clock },
    { key: 'workflow_pending',  label: 'Workflows',         tone: 'blue',  icon: GitBranch },
    { key: 'closures_pending',  label: 'Closures',          tone: 'red',   icon: Car },
    { key: 'checklist_pending', label: 'Checklists',        tone: 'teal',  icon: ClipboardCheck },
    { key: 'overdue',           label: 'Overdue',           tone: 'red',   icon: AlertTriangle },
    { key: 'recently_approved', label: 'Recently Approved', tone: 'green', icon: CheckCircle2 },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map(c => (
        <MetricCard
          key={c.key}
          icon={c.icon}
          label={c.label}
          tone={c.tone}
          loading={loading}
          value={metrics?.[c.key]}
        />
      ))}
    </div>
  )
}

// ─── Source badge ────────────────────────────────────────────────────────────────

function SourceBadge({ source }) {
  const meta = SOURCE_META[source] || SOURCE_META.workflow
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap ${TONE_BADGE[meta.tone] || TONE_BADGE.blue}`}>
      <Icon className="w-3 h-3" /> {meta.short}
    </span>
  )
}

// ─── Rows ─────────────────────────────────────────────────────────────────────────

function InstanceRow({ instance, bucketKey, onOpen }) {
  const { step, idx, total } = currentStepOf(instance)
  const sla = bucketKey === 'pending' || bucketKey === 'overdue' ? slaState(instance) : null
  const overdue = bucketKey === 'overdue' || sla?.overdue
  const timeRef = bucketKey === 'recently_approved'
    ? instance.completed_at
    : instance.step_started_at || instance.started_at

  return (
    <button
      onClick={() => onOpen(instance)}
      className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:border-[var(--border-bright)] ${
        overdue ? 'border-red-800/60 bg-red-950/20' : 'border-[var(--border-dim)] bg-[var(--surface-1)]'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <SourceBadge source={SOURCE.workflow} />
          <p className="text-[var(--text-primary)] text-sm font-medium truncate">{entityLabelOf(instance)}</p>
        </div>
        <p className="text-[var(--text-muted)] text-xs truncate mt-0.5">
          {instance.definition_name || 'Workflow'}
          {instance.entity_type && <span className="text-[var(--text-muted)]"> · {instance.entity_type}</span>}
          {step && (
            <span className="text-[var(--text-secondary)]"> · Step {idx + 1}/{total}: {step.name}</span>
          )}
        </p>
      </div>

      <div className="hidden md:flex flex-col items-end gap-1 shrink-0">
        <span className={`text-xs whitespace-nowrap ${overdue ? 'text-red-400 font-semibold' : 'text-[var(--text-muted)]'}`}>
          {overdue && <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />}
          {sla?.dueLabel || relTime(timeRef) || '—'}
        </span>
      </div>

      <ApprovalStatusBadge status={instance.status} />
      <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
    </button>
  )
}

/** Row for a non-workflow approval item (accident closure / checklist). */
function GenericRow({ item, onOpen }) {
  const meta = SOURCE_META[item.source] || SOURCE_META.workflow
  return (
    <button
      onClick={() => onOpen(item)}
      className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-dim)] bg-[var(--surface-1)] transition-all hover:border-[var(--border-bright)]"
    >
      <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${TONE_BADGE[meta.tone] || TONE_BADGE.blue}`}>
        <meta.icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <SourceBadge source={item.source} />
          <p className="text-[var(--text-primary)] text-sm font-medium truncate">{item.title}</p>
        </div>
        <p className="text-[var(--text-muted)] text-xs truncate mt-0.5">
          {item.subtitle}
          {item.site && <span className="text-[var(--text-muted)]"> · {item.site}</span>}
          {item.country && <span className="text-[var(--text-muted)]"> · {item.country}</span>}
        </p>
      </div>
      <div className="hidden md:flex flex-col items-end gap-1 shrink-0">
        <span className="text-xs whitespace-nowrap text-[var(--text-muted)]">{relTime(item.created_at) || '—'}</span>
      </div>
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold bg-amber-500/15 text-amber-300 border-amber-500/30">
        <Clock className="w-3 h-3" /> Pending
      </span>
      <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
    </button>
  )
}

// ─── Detail drawer (workflow engine) ─────────────────────────────────────────────

function DetailDrawer({ instance, actionable, onClose, onActed }) {
  const [events, setEvents] = useState(null)
  const [trailErr, setTrailErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null) // { kind: 'success'|'error', text }

  const { step, idx, total } = currentStepOf(instance)
  const requirements = useMemo(() => stepRequirements(step), [step])

  const loadTrail = useCallback(async () => {
    setEvents(null)
    setTrailErr(null)
    try {
      const rows = await workflows.listStepEvents(instance.id)
      setEvents(rows || [])
    } catch (err) {
      setTrailErr(err?.message || 'Failed to load approval history')
    }
  }, [instance.id])

  useEffect(() => { loadTrail() }, [loadTrail])

  async function handleAct(action, payload) {
    setBusy(true)
    setFeedback(null)
    try {
      if (action === 'return') await workflows.returnWorkflow(instance.id, payload)
      else await workflows.actOnWorkflow(instance.id, action, payload)
      setFeedback({
        kind: 'success',
        text: `Workflow ${action === 'return' ? 'returned for correction' : `${action}d`} successfully.`,
      })
      await loadTrail()
      onActed?.()
    } catch (err) {
      setFeedback({ kind: 'error', text: err?.message || `Failed to ${action} the workflow.` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DrawerShell
      title={entityLabelOf(instance)}
      badge={<ApprovalStatusBadge status={instance.status} />}
      subtitle={
        <>
          {instance.definition_name || 'Workflow'}
          {step && <span> · Step {idx + 1}/{total}: {step.name}</span>}
        </>
      }
      onClose={onClose}
    >
      {feedback && <FeedbackBanner feedback={feedback} />}

      {actionable && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" /> Decision
          </h3>
          <ApprovalAction requirements={requirements} onAct={handleAct} busy={busy} />
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" /> Approval History
        </h3>
        {trailErr ? (
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
            <XCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-red-400 text-sm flex-1">{trailErr}</p>
            <button
              onClick={loadTrail}
              className="shrink-0 px-2.5 py-1 text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg border border-red-500/30"
            >
              Retry
            </button>
          </div>
        ) : (
          <ApprovalTrail events={events || []} loading={events == null} />
        )}
      </section>
    </DrawerShell>
  )
}

// ─── Simple approval drawer (accident closure / checklist) ───────────────────────

function SimpleApprovalDrawer({ item, canAct, onClose, onActed }) {
  const meta = SOURCE_META[item.source] || SOURCE_META.workflow
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const { profile } = useAuth()

  const rejectNeedsReason = item.source === SOURCE.checklist // checklist return requires a note

  async function act(approved) {
    if (!approved && rejectNeedsReason && !reason.trim()) {
      setFeedback({ kind: 'error', text: 'A note is required when returning this for correction.' })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      if (item.source === SOURCE.accident_closure) {
        if (approved) await queue.approveAccidentClosure(item.id)
        else await queue.rejectAccidentClosure(item.id, reason)
      } else if (item.source === SOURCE.checklist) {
        await queue.decideChecklist(item.id, {
          approved,
          approverName: profile?.full_name || profile?.username || null,
          approverId: profile?.id || null,
          reviewNote: reason,
        })
      }
      setFeedback({ kind: 'success', text: approved ? 'Approved successfully.' : 'Returned / rejected successfully.' })
      onActed?.()
    } catch (err) {
      setFeedback({ kind: 'error', text: err?.message || 'Action failed.' })
    } finally {
      setBusy(false)
    }
  }

  const details = item.source === SOURCE.accident_closure
    ? [
        ['Asset', item.raw.asset_no],
        ['Driver', item.raw.driver_name],
        ['Type', item.raw.accident_type],
        ['Severity', item.raw.severity],
        ['Incident date', item.raw.incident_date],
        ['Est. damage', item.raw.estimated_damage_cost != null ? Number(item.raw.estimated_damage_cost).toLocaleString() : null],
        ['Site', item.site],
        ['Country', item.country],
        ['Requested', relTime(item.created_at)],
      ]
    : [
        ['Template', item.raw.template_name],
        ['Asset', item.raw.asset_no],
        ['Score', item.raw.score_pct != null ? `${item.raw.score_pct}%` : null],
        ['Result', item.scorePassed == null ? null : (item.scorePassed ? 'Passed' : 'Failed')],
        ['Site', item.site],
        ['Country', item.country],
        ['Submitted', relTime(item.created_at)],
      ]

  return (
    <DrawerShell
      title={item.title}
      badge={<SourceBadge source={item.source} />}
      subtitle={meta.label}
      onClose={onClose}
    >
      {feedback && <FeedbackBanner feedback={feedback} />}

      <section>
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Details</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {details.filter(([, v]) => v != null && v !== '').map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{k}</dt>
              <dd className="text-sm text-gray-200 truncate">{String(v)}</dd>
            </div>
          ))}
        </dl>
        {item.note && (
          <div className="mt-3 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--input-border)]">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Requester note</p>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{item.note}</p>
          </div>
        )}
      </section>

      {canAct ? (
        <section>
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" /> Decision
          </h3>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder={
              item.source === SOURCE.checklist
                ? 'Reason (required to return for correction)…'
                : 'Reason for rejection (optional, sent to requester)…'
            }
            className="w-full bg-[var(--surface-2)] border border-[var(--input-border)] rounded-xl px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all resize-none"
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => act(false)}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border border-red-700/50 text-red-300 hover:bg-red-900/20 disabled:opacity-50 transition-all"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              {item.source === SOURCE.checklist ? 'Return' : 'Reject'}
            </button>
            <button
              onClick={() => act(true)}
              disabled={busy}
              className="flex-[2] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-[var(--text-primary)] bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 shadow-lg shadow-green-900/30 disabled:opacity-50 transition-all"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Approve
            </button>
          </div>
        </section>
      ) : (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--input-border)] text-sm text-[var(--text-secondary)]">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
          You need an Admin, Manager or Director role to action this item.
        </div>
      )}
    </DrawerShell>
  )
}

// ─── Shared drawer chrome ────────────────────────────────────────────────────────

function FeedbackBanner({ feedback }) {
  return (
    <div className={`flex items-center gap-2.5 p-3 rounded-xl border text-sm ${
      feedback.kind === 'success'
        ? 'bg-green-500/10 border-green-500/30 text-green-300'
        : 'bg-red-500/10 border-red-500/30 text-red-300'
    }`}>
      {feedback.kind === 'success'
        ? <CheckCircle2 className="w-4 h-4 shrink-0" />
        : <XCircle className="w-4 h-4 shrink-0" />}
      <span>{feedback.text}</span>
    </div>
  )
}

function DrawerShell({ title, badge, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-xl h-full overflow-y-auto border-l shadow-2xl"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border-dim)' }}
        role="dialog"
        aria-label="Approval detail"
      >
        <div
          className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 border-b bg-[var(--surface-1)] backdrop-blur"
          style={{ borderColor: 'var(--border-dim)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-[var(--text-primary)] font-semibold text-sm truncate">{title}</h2>
              {badge}
            </div>
            <p className="text-[var(--text-muted)] text-xs truncate">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-6">{children}</div>
      </motion.aside>
    </div>
  )
}

// ─── Data-intake deep-link card ──────────────────────────────────────────────────

function DataIntakeCard({ count, onGo }) {
  if (!count) return null
  return (
    <button
      onClick={onGo}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-purple-800/50 bg-purple-950/20 hover:border-purple-600 transition-all text-left"
    >
      <div className="shrink-0 w-9 h-9 rounded-lg bg-purple-500/15 text-purple-300 flex items-center justify-center">
        <Database className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[var(--text-primary)] text-sm font-medium">
          {count} data-intake {count === 1 ? 'batch' : 'batches'} awaiting approval
        </p>
        <p className="text-[var(--text-muted)] text-xs mt-0.5">Reviewed on the Data Intake Approvals screen (staged rows + commit)</p>
      </div>
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-300 shrink-0">
        Open <ExternalLink className="w-3.5 h-3.5" />
      </span>
    </button>
  )
}

// ─── Error state (everything failed) ─────────────────────────────────────────────

function EngineUnavailable({ message, onRetry, retrying }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
        <ServerCrash className="w-7 h-7 text-amber-400" />
      </div>
      <div>
        <p className="text-[var(--text-primary)] text-sm font-semibold">Approval services unavailable</p>
        <p className="text-[var(--text-muted)] text-xs mt-1 max-w-md">
          None of the approval sources could be reached. This usually means a
          connectivity issue or that the workflow engine migrations (V116–V118)
          have not been applied to this environment yet.
        </p>
        {message && (
          <p className="text-[var(--text-muted)] text-[11px] mt-2 font-mono break-all max-w-md">{message}</p>
        )}
      </div>
      <button
        onClick={onRetry}
        disabled={retrying}
        className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} /> Retry
      </button>
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────────

const MANAGER_ROLES = new Set(['Admin', 'Manager', 'Director'])

export default function Approvals() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const navigate = useNavigate()

  const canActNonWorkflow = MANAGER_ROLES.has(profile?.role)

  const [loading, setLoading]   = useState(true)
  const [fatalError, setFatalError] = useState(null)
  const [workflowError, setWorkflowError] = useState(null)
  const [metricsRaw, setMetricsRaw] = useState(null)
  const [buckets, setBuckets]   = useState(EMPTY_BUCKETS)
  const [closures, setClosures] = useState([])
  const [checklistItems, setChecklistItems] = useState([])
  const [intakeCount, setIntakeCount] = useState(0)
  const [actionableIds, setActionableIds] = useState(() => new Set())
  const [updatedAt, setUpdatedAt] = useState(null)

  const [activeBucket, setActiveBucket] = useState('pending')
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [selected, setSelected] = useState(null)               // workflow instance
  const [selectedGeneric, setSelectedGeneric] = useState(null) // closure / checklist item

  const load = useCallback(async () => {
    setLoading(true)
    setFatalError(null)
    setWorkflowError(null)
    const country = activeCountry

    const [dashR, mineR, closuresR, checklistR, intakeR] = await Promise.allSettled([
      workflows.getApprovalDashboard(),
      workflows.myPendingApprovals(),
      queue.listAccidentClosures({ country }),
      queue.listChecklistApprovals({ country }),
      queue.countDataIntakePending({ country }),
    ])

    // Workflow engine (non-fatal — the other sources still render).
    if (dashR.status === 'fulfilled') {
      setBuckets({ ...EMPTY_BUCKETS, ...(dashR.value?.buckets || {}) })
      setMetricsRaw(dashR.value?.metrics ?? null)
    } else {
      setBuckets(EMPTY_BUCKETS)
      setMetricsRaw(null)
      setWorkflowError(dashR.reason?.message || 'Workflow engine unavailable')
    }
    setActionableIds(new Set(
      mineR.status === 'fulfilled' ? (mineR.value || []).map(r => r.id) : [],
    ))
    setClosures(closuresR.status === 'fulfilled' ? (closuresR.value || []).map(toClosureItem) : [])
    setChecklistItems(checklistR.status === 'fulfilled' ? (checklistR.value || []).map(toChecklistItem) : [])
    setIntakeCount(intakeR.status === 'fulfilled' ? (intakeR.value || 0) : 0)

    // Fatal only when EVERY primary source failed.
    const anyOk = [dashR, closuresR, checklistR].some(r => r.status === 'fulfilled')
    if (!anyOk) setFatalError(dashR.reason?.message || 'Failed to load approvals')

    setUpdatedAt(new Date())
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Merged pending queue: workflow pending + closures + checklists.
  const mergedPending = useMemo(() => {
    const wf = (buckets.pending || []).map(i => ({ ...i, source: SOURCE.workflow }))
    return [...wf, ...closures, ...checklistItems]
  }, [buckets.pending, closures, checklistItems])

  const counts = useMemo(() => ({
    workflow_pending:  (buckets.pending || []).length,
    closures_pending:  closures.length,
    checklist_pending: checklistItems.length,
    total_pending:     mergedPending.length,
    overdue:           (buckets.overdue || []).length,
    returned:          (buckets.returned || []).length,
    rejected:          (buckets.rejected || []).length,
    recently_approved: (buckets.recently_approved || []).length,
  }), [buckets, closures, checklistItems, mergedPending])

  const metrics = useMemo(() => {
    const m = metricsRaw && typeof metricsRaw === 'object' ? metricsRaw : {}
    return {
      ...counts,
      overdue:           m.overdue ?? counts.overdue,
      recently_approved: m.recently_approved ?? m.approved_recent ?? counts.recently_approved,
    }
  }, [metricsRaw, counts])

  // Site options across the non-workflow items (workflow instances carry no site).
  const siteOptions = useMemo(() => {
    const set = new Set()
    ;[...closures, ...checklistItems].forEach(i => i.site && set.add(i.site))
    return Array.from(set).sort()
  }, [closures, checklistItems])

  const q = search.trim().toLowerCase()

  const matchGeneric = useCallback((i) => {
    if (sourceFilter !== 'all' && i.source !== sourceFilter) return false
    if (siteFilter !== 'all' && i.site !== siteFilter) return false
    if (!q) return true
    return (i.title || '').toLowerCase().includes(q)
      || (i.subtitle || '').toLowerCase().includes(q)
      || (i.site || '').toLowerCase().includes(q)
  }, [sourceFilter, siteFilter, q])

  const matchWorkflow = useCallback((i) => {
    if (sourceFilter !== 'all' && sourceFilter !== SOURCE.workflow) return false
    if (siteFilter !== 'all') return false // workflow instances have no site dimension
    if (!q) return true
    return (entityLabelOf(i).toLowerCase().includes(q))
      || (i.definition_name || '').toLowerCase().includes(q)
      || (i.entity_type || '').toLowerCase().includes(q)
  }, [sourceFilter, siteFilter, q])

  // The active bucket content. Only "pending" is merged; the workflow lifecycle
  // buckets (overdue/returned/rejected/recently_approved) stay workflow-native.
  const activeList = useMemo(() => {
    if (activeBucket === 'pending') {
      return mergedPending.filter(i =>
        i.source === SOURCE.workflow ? matchWorkflow(i) : matchGeneric(i),
      )
    }
    return (buckets[activeBucket] || [])
      .map(i => ({ ...i, source: SOURCE.workflow }))
      .filter(matchWorkflow)
  }, [activeBucket, mergedPending, buckets, matchWorkflow, matchGeneric])

  const isActionable = useCallback(
    (instance) => actionableIds.has(instance?.id)
      && ['pending', 'in_review', 'returned'].includes(String(instance?.status || '').toLowerCase()),
    [actionableIds],
  )

  const hasFilters = q || sourceFilter !== 'all' || siteFilter !== 'all'

  function openRow(row) {
    if (row.source === SOURCE.workflow) setSelected(row)
    else setSelectedGeneric(row)
  }

  return (
    <div className="text-[var(--text-primary)] space-y-6">
      <PageHeader
        title="Approval Dashboard"
        subtitle="Every pending approval across your organisation — workflows, accident closures and checklist sign-offs"
        icon={CheckSquare}
        badge={loading ? undefined : (metrics.total_pending ? `${metrics.total_pending} pending` : undefined)}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      {fatalError ? (
        <EngineUnavailable message={fatalError} onRetry={load} retrying={loading} />
      ) : (
        <>
          <MetricStrip metrics={metrics} loading={loading} />

          {/* Workflow engine degraded notice (other sources still shown) */}
          {!loading && workflowError && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1">
                Workflow engine is unavailable — showing accident closures and checklist approvals only.
              </span>
              <button
                onClick={load}
                className="shrink-0 px-2.5 py-1 text-xs font-semibold text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 rounded-lg border border-amber-500/30"
              >
                Retry
              </button>
            </div>
          )}

          {/* Data-intake deep link (never duplicates the intake commit flow) */}
          {!loading && <DataIntakeCard count={intakeCount} onGo={() => navigate('/upload-approvals')} />}

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search entity, workflow or checklist…"
                className="w-full bg-[var(--surface-2)] border border-[var(--input-border)] rounded-xl pl-9 pr-9 py-2.5 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
              <select
                value={sourceFilter}
                onChange={e => setSourceFilter(e.target.value)}
                aria-label="Filter by approval type"
                className="appearance-none bg-[var(--surface-2)] border border-[var(--input-border)] rounded-xl pl-9 pr-8 py-2.5 text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
              >
                <option value="all">All approval types</option>
                <option value={SOURCE.workflow}>Workflow</option>
                <option value={SOURCE.accident_closure}>Accident closure</option>
                <option value={SOURCE.checklist}>Checklist sign-off</option>
              </select>
            </div>
            {siteOptions.length > 0 && (
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
                <select
                  value={siteFilter}
                  onChange={e => setSiteFilter(e.target.value)}
                  aria-label="Filter by site"
                  className="appearance-none bg-[var(--surface-2)] border border-[var(--input-border)] rounded-xl pl-9 pr-8 py-2.5 text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                >
                  <option value="all">All sites</option>
                  {siteOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Bucket tabs */}
          <div className="flex flex-wrap gap-2 border-b border-[var(--border-dim)] pb-3">
            {BUCKETS.map(b => {
              const count = b.key === 'pending' ? counts.total_pending : (buckets[b.key] || []).length
              const active = activeBucket === b.key
              const Icon = b.icon
              return (
                <button
                  key={b.key}
                  onClick={() => setActiveBucket(b.key)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    active
                      ? (TONE_TAB_ACTIVE[b.tone] || 'bg-orange-500/15 text-orange-300 border-orange-500/40')
                      : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--input-border)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {b.label}
                  <span className={`ml-0.5 px-1.5 rounded-full text-[10px] ${active ? 'bg-black/30' : 'bg-[var(--surface-3)]'}`}>
                    {loading ? '·' : count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Bucket list */}
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-[var(--surface-2)] border border-[var(--border-dim)] animate-pulse" />
              ))}
            </div>
          ) : activeList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-[var(--surface-2)] border border-[var(--input-border)] flex items-center justify-center">
                {activeBucket === 'recently_approved'
                  ? <CheckCircle2 className="w-7 h-7 text-green-500" />
                  : <Inbox className="w-7 h-7 text-[var(--text-muted)]" />}
              </div>
              <div>
                <p className="text-gray-300 text-sm font-medium">
                  {hasFilters
                    ? 'No approvals match your filters'
                    : `Nothing in ${BUCKETS.find(b => b.key === activeBucket)?.label}`}
                </p>
                <p className="text-[var(--text-muted)] text-xs mt-1">
                  {hasFilters
                    ? 'Try a different search term, type or site.'
                    : activeBucket === 'overdue'
                      ? 'No workflow approvals have breached their SLA. Nicely on top of it.'
                      : activeBucket === 'pending'
                        ? 'New approvals appear here as they are raised.'
                        : 'Workflow items will appear here as they move through the engine.'}
                </p>
                {hasFilters && (
                  <button
                    onClick={() => { setSearch(''); setSourceFilter('all'); setSiteFilter('all') }}
                    className="mt-3 text-orange-400 text-xs hover:text-orange-300 inline-flex items-center gap-1"
                  >
                    <Filter className="w-3 h-3" /> Clear filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {activeList.map(row => (
                row.source === SOURCE.workflow ? (
                  <InstanceRow key={`wf-${row.id}`} instance={row} bucketKey={activeBucket} onOpen={openRow} />
                ) : (
                  <GenericRow key={`${row.source}-${row.id}`} item={row} onOpen={openRow} />
                )
              ))}
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {selected && (
          <DetailDrawer
            key={`wf-${selected.id}`}
            instance={selected}
            actionable={isActionable(selected)}
            onClose={() => setSelected(null)}
            onActed={load}
          />
        )}
        {selectedGeneric && (
          <SimpleApprovalDrawer
            key={`${selectedGeneric.source}-${selectedGeneric.id}`}
            item={selectedGeneric}
            canAct={canActNonWorkflow}
            onClose={() => setSelectedGeneric(null)}
            onActed={() => { setSelectedGeneric(null); load() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
