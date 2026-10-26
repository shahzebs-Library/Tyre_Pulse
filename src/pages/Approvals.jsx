import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckSquare, Clock, AlertTriangle,
  ClipboardList, CheckCircle2, XCircle, Undo2, RefreshCw,
  ChevronRight, ServerCrash, Car, ClipboardCheck, Database, Loader2,
  ExternalLink, GitBranch, AlertOctagon, Square, Ban, PenLine,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import * as workflows from '../lib/api/workflows'
import * as queue from '../lib/api/approvalsQueue'
import ApprovalReview from '../components/workflow/ApprovalReview'
import { isGovernedApproval, mergePendingApprovals } from '../lib/approvalInbox'
import { matchesCountry } from '../lib/countryFilter'
import { toUserMessage } from '../lib/safeError'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { formatDistanceToNow } from 'date-fns'
import PageHeader from '../components/ui/PageHeader'
import FilterBar from '../components/ui/FilterBar'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import ApprovalStatusBadge from '../components/workflow/ApprovalStatusBadge'
import ApprovalAction from '../components/workflow/ApprovalAction'
import ApprovalTrail from '../components/workflow/ApprovalTrail'
import ChecklistAnswers from '../components/checklist/ChecklistAnswers'
import SignatureField from '../components/checklist/SignatureField'
import BlockingMarksNotice from '../components/checklist/BlockingMarksNotice'
import ChecklistApprovalLadder from '../components/checklist/ChecklistApprovalLadder'
import { stepRequirements } from '../lib/workflow/stepRequirements'
import {
  canDecide, stageFor, stageLabel, statusSummary, isTwoStage, STAGE_SUPERVISOR,
} from '../lib/checklist/checklistApproval'
import { canClose } from '../lib/checklist/checklistMarks'
import { canSignInspection } from '../lib/inspectionApproval'
import { getMySignature } from '../lib/api/userSignature'
import { isUsableSignature } from '../lib/savedSignature'
import { templateFromSubmission, submissionAnswers } from '../lib/checklistView'

// ─── Source taxonomy ────────────────────────────────────────────────────────────
// The unified queue merges the V95 workflow engine with the other real
// approval-bearing surfaces in the schema. Every item carries a `source`.

const SOURCE = {
  workflow:         'workflow',
  accident_closure: 'accident_closure',
  checklist:        'checklist',
  inspection:       'inspection',
  signoff_gap:      'signoff_gap',
}

const BULKABLE = [SOURCE.accident_closure, SOURCE.checklist, SOURCE.inspection]

const SOURCE_META = {
  workflow:         { label: 'Workflow',          short: 'Workflow',  icon: GitBranch,      tone: 'blue' },
  accident_closure: { label: 'Accident Closure',  short: 'Closure',   icon: Car,            tone: 'red'  },
  checklist:        { label: 'Checklist Sign-off', short: 'Checklist', icon: ClipboardCheck, tone: 'teal' },
  inspection:       { label: 'Inspection Sign-off', short: 'Inspection', icon: ClipboardList, tone: 'amber' },
  signoff_gap:      { label: 'Missed sign-off', short: 'Missed', icon: AlertOctagon, tone: 'orange' },
}

// ─── Bucket + metric definitions ───────────────────────────────────────────────

const BUCKETS = [
  { key: 'pending',            label: 'Pending',           icon: Clock,         tone: 'amber'  },
  { key: 'overdue',            label: 'Overdue',           icon: AlertTriangle, tone: 'red'    },
  { key: 'returned',           label: 'Returned',          icon: Undo2,         tone: 'orange' },
  { key: 'rejected',           label: 'Rejected',          icon: XCircle,       tone: 'red'    },
  { key: 'recently_approved',  label: 'Recently Approved', icon: CheckCircle2,  tone: 'green'  },
  // Not a queue of things to decide - a queue of things that were never asked.
  // A submission from a template that requires sign-off should have entered the
  // pending list; one recorded 'not_required' silently skipped it, and an empty
  // Pending tab reads as "nobody needed to sign anything".
  { key: 'signoff_gaps',       label: 'Missed sign-off',   icon: AlertOctagon,  tone: 'orange' },
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
    || (i?.entity_type ? `${i.entity_type}${i.entity_id ? ` #${i.entity_id}` : ''}` : 'N/A')
}

// ── Normalisers for the non-workflow sources into a shared row shape ──────────────

function toClosureItem(a) {
  const label = [a.asset_no, a.accident_type].filter(Boolean).join(' · ') || 'Accident'
  return {
    source: SOURCE.accident_closure,
    id: a.id,
    title: `Closure request: ${label}`,
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

/**
 * A submission that was supposed to need sign-off and never asked for it.
 * Shown as a fact to correct, not as a pending decision - the sign-off moment has
 * passed, so what is on offer is recording one now.
 */
function toSignoffGapItem(c) {
  return {
    source: SOURCE.signoff_gap,
    id: c.id,
    documentNo: c.document_no || null,
    stage: null,
    twoStage: isTwoStage(templateRulesOf(c)),
    title: c.title || c.template_name || 'Checklist submission',
    subtitle: `${c.template_name || 'Template requires sign-off'} - submitted without approval`
      + (c.asset_no ? ` - ${c.asset_no}` : ''),
    site: c.site || null,
    country: c.country || null,
    created_at: c.submitted_at || null,
    raw: c,
  }
}

/**
 * The approval RULES for a queue row, in the shape the shared helpers read.
 *
 * `require_area_manager` is the template's, carried onto the row by the service.
 * Absent it resolves false - the single-stage default, which is what every
 * template built before V594 genuinely is - so a row we could not read the
 * template for is never wrongly described as needing a second signature.
 */
function templateRulesOf(raw) {
  return { require_area_manager: !!raw?.require_area_manager }
}

function toChecklistItem(c) {
  const title = c.title || c.template_name || 'Checklist submission'
  const stage = stageFor(templateRulesOf(c), c)
  return {
    source: SOURCE.checklist,
    id: c.id,
    title,
    subtitle: [
      // The document number is the reference the sheet is known by, so it leads
      // the line. A template that mints none contributes nothing here.
      c.document_no || null,
      c.template_name && c.template_name !== title ? c.template_name : null,
      c.asset_no && `Asset ${c.asset_no}`,
      c.score_pct != null ? `Score ${c.score_pct}%` : null,
    ].filter(Boolean).join(' · ') || 'Awaiting sign-off',
    note: null,
    site: c.site || null,
    country: c.country || null,
    created_at: c.submitted_at || null,
    status: c.approval_status || 'pending',
    // Which rung this row is waiting on, and how that reads to a person.
    stage,
    stageSummary: statusSummary(templateRulesOf(c), c),
    twoStage: isTwoStage(templateRulesOf(c)),
    documentNo: c.document_no || null,
    raw: c,
    scorePassed: c.score_passed,
  }
}

/** Mobile field inspections awaiting sign-off (approval_status pending_approval). */
function toInspectionItem(i) {
  const title = i.title || [i.inspection_type, i.asset_no].filter(Boolean).join(' · ') || 'Inspection'
  return {
    source: SOURCE.inspection,
    id: i.id,
    title,
    subtitle: [
      i.asset_no && `Asset ${i.asset_no}`,
      i.inspector && `By ${i.inspector}`,
      i.severity,
    ].filter(Boolean).join(' · ') || 'Awaiting sign-off',
    note: null,
    site: i.site || null,
    country: i.country || null,
    created_at: i.created_at || null,
    status: 'pending',
    raw: i,
  }
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

// ─── Detail drawer (workflow engine) ─────────────────────────────────────────────

function DetailDrawer({ instance, actionable, onClose, onActed }) {
  if (isGovernedApproval(instance) && ['inspection', 'checklist', 'work_order', 'tyre_change'].includes(instance.entity_type)
    && (['pending', 'in_review'].includes(instance.status) || ['work_order', 'tyre_change'].includes(instance.entity_type))) {
    return <ApprovalReview entityType={instance.entity_type} entityId={String(instance.entity_id)}
      title={instance.entity_label || instance.definition_name} onClose={onClose} onActed={onActed} />
  }
  return <LegacyDetailDrawer instance={instance} actionable={actionable} onClose={onClose} onActed={onActed} />
}

function LegacyDetailDrawer({ instance, actionable, onClose, onActed }) {
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
      setTrailErr(toUserMessage(err, 'Failed to load approval history'))
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
      setFeedback({ kind: 'error', text: toUserMessage(err, `Failed to ${action} the workflow.`) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DrawerShell
      busy={busy}
      title={entityLabelOf(instance)}
      badge={<ApprovalStatusBadge status={instance.status} />}
      subtitle={
        <>
          {instance.definition_name || 'Workflow'}
          {step && <span> · Step {idx + 1}/{total}: {step.name}</span>}
          <span> · Waiting for {instance.current_approver_role || step?.approver_role || 'approver'}</span>
          <span> · {[instance.site || 'Site not recorded', instance.country].filter(Boolean).join(' · ')}</span>
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
  const legacy = <LegacySimpleApprovalDrawer item={item} canAct={canAct} onClose={onClose} onActed={onActed} />
  if (!['checklist', 'inspection'].includes(item.source)) return legacy
  return <ApprovalReview key={`${item.source}:${item.id}`} entityType={item.source} entityId={item.id}
    title={item.title} onClose={onClose} onActed={onActed} legacy={legacy} />
}

function LegacySimpleApprovalDrawer({ item, canAct, onClose, onActed }) {
  const meta = SOURCE_META[item.source] || SOURCE_META.workflow
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const { profile } = useAuth()
  // The full submission, once the answers panel below has loaded it. Everything
  // about a checklist decision - which rung, whether it can be closed at all -
  // is read from the record itself rather than guessed from the queue row.
  const [loadedSub, setLoadedSub] = useState(null)
  const [signature, setSignature] = useState(null)
  // A checklist decision leaves the drawer OPEN and swaps the buttons for what
  // happened. On a two-stage sheet "approved" does not mean closed, and a drawer
  // that simply vanishes lets a supervisor believe it did.
  const [decided, setDecided] = useState(false)

  const isChecklistish = item.source === SOURCE.checklist || item.source === SOURCE.signoff_gap

  // A checklist return requires a note (the service enforces it), and a
  // retrospective sign-off is the same writer, so the same rule applies.
  const rejectNeedsReason = isChecklistish

  // The template's approval rules: from the loaded record when it is here, from
  // the queue row until then. Both resolve to the single-stage default when the
  // template is unreadable, so nobody is offered a rung that does not exist.
  const template = useMemo(
    () => (loadedSub ? templateFromSubmission(loadedSub) : null) || templateRulesOf(item.raw),
    [loadedSub, item.raw],
  )
  const subject = loadedSub || item.raw

  // A missed sign-off never entered the queue, so it has no stage of its own: it
  // is enrolled at the FIRST rung and decided there.
  const stage = (isChecklistish && (stageFor(template, subject) || STAGE_SUPERVISOR)) || null

  // Would approving CLOSE the sheet, or only pass it up? Only a close is barred
  // by an outstanding fault, and only a close needs an area manager.
  const wouldClose = isChecklistish && !(stage === STAGE_SUPERVISOR && isTwoStage(template))

  const closeCheck = useMemo(
    () => (loadedSub ? canClose(template, submissionAnswers(loadedSub)) : { ok: true, blocking: [] }),
    [loadedSub, template],
  )

  // Show the button only to somebody the server would actually let act. The RPC
  // refuses either way; this is so a refusal is not the first anyone hears of it.
  const mayDecideChecklist = isChecklistish && canDecide(
    template,
    { ...subject, approval_status: stageFor(template, subject) ? subject?.approval_status : 'pending' },
    profile?.role,
    { isSuperAdmin: !!profile?.is_super_admin },
  )
  // An inspection has its own signer list in the RPC, which is NOT the
  // Admin/Manager/Director set `canAct` carries: a Manager or Director is
  // refused, and a PMV manager, either area manager or a Tyre Data Collector is
  // accepted. Asking the shared predicate keeps this button in step with the
  // database instead of hiding it from the people who can actually sign.
  const mayDecideInspection = item.source === SOURCE.inspection
    && canSignInspection(profile?.role, { isSuperAdmin: !!profile?.is_super_admin })
  const mayAct = isChecklistish
    ? mayDecideChecklist
    : (item.source === SOURCE.inspection ? mayDecideInspection : canAct)

  // An inspection sign-off is a signature too. The register has always refused
  // to approve one without a mark; the queue silently stored an approval with
  // none, so the same inspection was signed or unsigned depending on which
  // screen it was decided from. Both ask for it now.
  const needsSignature = isChecklistish || item.source === SOURCE.inspection

  // Everything that stops the approve button, said in one place.
  const approveBlockedReason = (isChecklistish && wouldClose && !closeCheck.ok)
    ? 'This sheet still has items marked as a fault, so it cannot be closed yet.'
    : (needsSignature && !signature)
      ? 'Draw or load a signature to sign this off.'
      : null

  async function act(approved) {
    if (!approved && rejectNeedsReason && !reason.trim()) {
      setFeedback({ kind: 'error', text: 'A note is required when returning this for correction.' })
      return
    }
    // The database refuses both of these too; refusing here means nobody signs
    // first and finds out afterwards.
    if (approved && approveBlockedReason) {
      setFeedback({ kind: 'error', text: approveBlockedReason })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      if (item.source === SOURCE.accident_closure) {
        if (approved) await queue.approveAccidentClosure(item.id)
        else await queue.rejectAccidentClosure(item.id, reason)
      } else if (item.source === SOURCE.inspection) {
        // Guarded server RPC: approver identity + timestamp derived server-side,
        // optimistic "already decided" protection, approve locks the record.
        await queue.decideInspection(item.id, {
          approved, reviewNote: reason, signature: approved ? signature : null,
        })
      } else if (isChecklistish) {
        // A gap goes through the SAME writer: recording the decision now enrols
        // it into the queue and answers it. There is no second path, so a
        // retrospective sign-off is indistinguishable from a timely one in the
        // record except by its submitted date, which is the honest outcome.
        //
        // The server decides WHICH rung this is and returns the status it
        // actually reached, so the message below reports what happened rather
        // than assuming the sheet is closed.
        const res = await queue.decideChecklist(item.id, {
          approved,
          reviewNote: reason,
          signature: approved ? signature : null,
          currentStatus: subject?.approval_status || null,
        })
        const reached = String(res?.status || (approved ? 'approved' : 'rejected'))
        setFeedback({
          kind: 'success',
          text: reached === 'pending_area_manager'
            ? 'Signed off. It now goes to the area manager for final approval.'
            : reached === 'approved'
              ? 'Approved and closed.'
              : 'Sent back for correction.',
        })
        setDecided(true)
        onActed?.({ keepOpen: true })
        return
      }
      setFeedback({ kind: 'success', text: approved ? 'Approved successfully.' : 'Returned / rejected successfully.' })
      onActed?.()
    } catch (err) {
      setFeedback({ kind: 'error', text: toUserMessage(err, 'Action failed.') })
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
    : item.source === SOURCE.inspection
    ? [
        ['Asset', item.raw.asset_no],
        ['Type', item.raw.inspection_type],
        ['Inspector', item.raw.inspector],
        ['Severity', item.raw.severity],
        ['Inspection date', item.raw.inspection_date],
        ['Tyre serial', item.raw.tyre_serial],
        ['Site', item.site],
        ['Country', item.country],
        ['Submitted', relTime(item.created_at)],
      ]
    : [
        // The document number is the sheet's reference. Absent when the template
        // mints none, in which case the row is simply not shown.
        ['Document no', item.documentNo],
        ['Template', item.raw.template_name],
        ['Asset', item.raw.asset_no],
        ['Waiting on', isChecklistish && stage ? stageLabel(stage) : null],
        ['Supervisor', item.raw.supervisor_name],
        ['Score', item.raw.score_pct != null ? `${item.raw.score_pct}%` : null],
        ['Result', item.scorePassed == null ? null : (item.scorePassed ? 'Passed' : 'Failed')],
        ['Site', item.site],
        ['Country', item.country],
        ['Submitted', relTime(item.created_at)],
      ]

  return (
    <DrawerShell
      busy={busy}
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

      {/* What is actually being approved. A reviewer used to see the template
          name and a score and nothing else - to read the answers they had to
          leave the queue or download the PDF, so in practice the sign-off was
          made on a number. The answers now sit above the decision buttons. */}
      {isChecklistish && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            What was recorded
          </h3>
          {/* onLoaded hands the full record up, which is what makes the decision
              below honest: the outstanding faults and the rung are read from the
              submission, not guessed from the queue row. */}
          <ChecklistAnswers
            submissionId={item.id}
            showSummary={false}
            onLoaded={setLoadedSub}
            /* The ladder and the outstanding-fault notice are rendered once, in
               the Sign-off section beside the buttons they govern. */
            showApproval={false}
          />
        </section>
      )}

      {/* How far this sheet has got, and what is still stopping it closing. */}
      {isChecklistish && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
            <ClipboardCheck className="w-3.5 h-3.5" /> Sign-off
          </h3>
          <ChecklistApprovalLadder template={template} submission={subject} compact />
          {loadedSub && wouldClose && (
            <BlockingMarksNotice template={template} answers={submissionAnswers(loadedSub)} />
          )}
        </section>
      )}

      {decided ? (
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Close
          </button>
        </div>
      ) : mayAct ? (
        <section>
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" /> Decision
          </h3>
          {isChecklistish && stage && (
            <p className="text-xs text-[var(--text-muted)] mb-2">
              {wouldClose
                ? 'Approving CLOSES this sheet. Nothing further is asked for.'
                : 'Approving passes this sheet to the area manager for final approval. It is not closed yet.'}
            </p>
          )}
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

          {/* A sign-off IS a signature, on a checklist AND on an inspection. It
              is captured here rather than surfaced as a refusal after the fact,
              and it arrives already holding the approver's saved mark so it is
              one glance rather than a redraw. Returning something for correction
              needs only the note. */}
          {needsSignature && (
            <div className="mt-3">
              <SignatureField
                label={
                  item.source === SOURCE.inspection
                    ? 'Approver signature'
                    : wouldClose ? 'Final approval signature' : 'Supervisor signature'
                }
                onChange={setSignature}
              />
            </div>
          )}

          {approveBlockedReason && (
            <p className="text-xs text-amber-400 mt-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {approveBlockedReason}
            </p>
          )}

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
              disabled={busy || !!approveBlockedReason}
              title={approveBlockedReason || undefined}
              className="flex-[2] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-[var(--text-primary)] bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 shadow-lg shadow-green-900/30 disabled:opacity-50 transition-all"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {isChecklistish && !wouldClose ? 'Sign off' : 'Approve'}
            </button>
          </div>
        </section>
      ) : (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--input-border)] text-sm text-[var(--text-secondary)]">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
          {isChecklistish && stage
            ? `This sheet is waiting for ${stageLabel(stage).toLowerCase()}, which your role cannot give.`
            : item.source === SOURCE.inspection
              ? 'Your role cannot sign off inspections. Only Admin, PMV Manager, Workshop Area Managers and Tyre Data Collectors can.'
              : 'You need an Admin, Manager or Director role to action this item.'}
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

function DrawerShell({ title, badge, subtitle, onClose, busy = false, children }) {
  // The shared dialog shell. While a decision is being recorded it cannot be
  // dismissed, so a half-written approval is never abandoned mid-flight.
  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      size="lg"
      title={(
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate">{title}</span>
          {badge}
        </span>
      )}
      subtitle={subtitle}
    >
      <div className="space-y-6">{children}</div>
    </Modal>
  )
}

// ─── Data-intake deep-link card ──────────────────────────────────────────────────

function DataIntakeCard({ count, onGo }) {
  if (count === 0) return null
  return (
    <button
      type="button"
      onClick={onGo}
      className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-lg border border-purple-800/50 bg-purple-950/20 hover:border-purple-600 text-xs text-purple-200"
    >
      <Database className="w-3.5 h-3.5" />
      {count == null ? 'Data-intake approval count unavailable' : `${count} data-intake ${count === 1 ? 'batch' : 'batches'} awaiting approval`}
      <ExternalLink className="w-3 h-3" />
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
          connectivity issue or that the workflow engine migrations (V116 to V118)
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
  const { profile, modulePerms, grantOverrides, capabilities } = useAuth()
  const { activeCountry } = useSettings()
  const navigate = useNavigate()
  const accessKey = JSON.stringify([profile?.id, profile?.org_id, profile?.role, profile?.country,
    profile?.countries, profile?.site, profile?.sites, profile?.approved, profile?.locked,
    profile?.is_super_admin, modulePerms, grantOverrides, capabilities])
  const generation = useRef(0)
  const bulkLock = useRef(false)

  const canActNonWorkflow = MANAGER_ROLES.has(profile?.role)

  const [loading, setLoading]   = useState(true)
  const [fatalError, setFatalError] = useState(null)
  const [workflowError, setWorkflowError] = useState(null)
  const [sourceErrors, setSourceErrors] = useState([])
  const [incompleteSources, setIncompleteSources] = useState([])
  const [metricsRaw, setMetricsRaw] = useState(null)
  const [buckets, setBuckets]   = useState(EMPTY_BUCKETS)
  const [closures, setClosures] = useState([])
  const [checklistItems, setChecklistItems] = useState([])
  const [inspectionItems, setInspectionItems] = useState([])
  const [intakeCount, setIntakeCount] = useState(null)
  const [actionableIds, setActionableIds] = useState(() => new Set())
  const [updatedAt, setUpdatedAt] = useState(null)
  const [assignmentUnknown, setAssignmentUnknown] = useState(false)

  const [activeBucket, setActiveBucket] = useState('pending')
  const [assignedToMeOnly, setAssignedToMeOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [selected, setSelected] = useState(null)               // workflow instance
  const [selectedGeneric, setSelectedGeneric] = useState(null) // closure / checklist item
  const [signoffGaps, setSignoffGaps] = useState([])
  // Bulk selection. Keyed `source:id` because ids are only unique within a source.
  const [picked, setPicked] = useState(() => new Set())
  const [bulk, setBulk] = useState({ busy: false, result: null })
  const [returnDialog, setReturnDialog] = useState({ open: false, reason: '' })

  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    setFatalError(null)
    setWorkflowError(null)
    const country = activeCountry

    const [dashR, mineR, delegatedR, closuresR, checklistR, intakeR, gapsR, inspectionsR] = await Promise.allSettled([
      workflows.getApprovalDashboard(),
      workflows.myPendingApprovals(),
      workflows.myDelegatedApprovals(),
      queue.listAccidentClosures({ country }),
      queue.listChecklistApprovals({ country }),
      queue.countDataIntakePending({ country }),
      queue.listChecklistSignoffGaps({ country }),
      queue.listInspectionApprovals({ country }),
    ])
    if (current !== generation.current) return

    // Keep source failures explicit. A failed query is unknown, never an empty
    // queue; reachable sources remain usable while the warning names the gaps.
    const dashboardValid = dashR.status === 'fulfilled' && dashR.value?.buckets
      && Object.values(dashR.value.buckets).every(Array.isArray)
    const failedSources = []
    if (!dashboardValid) failedSources.push('Workflows')
    if (closuresR.status !== 'fulfilled') failedSources.push('Accident closures')
    if (checklistR.status !== 'fulfilled') failedSources.push('Checklist sign-offs')
    if (inspectionsR.status !== 'fulfilled') failedSources.push('Inspection sign-offs')
    if (gapsR.status !== 'fulfilled') failedSources.push('Missed sign-offs')
    if (intakeR.status !== 'fulfilled') failedSources.push('Data intake')
    setSourceErrors(failedSources)
    const cappedSources = []
    if (dashboardValid && Number(dashR.value?.metrics?.pending_count) > (dashR.value?.buckets?.pending || []).length) {
      // A server or proxy may still cap an RPC response. Keep the metric visible,
      // but never imply the returned queue is complete in that case.
      cappedSources.push('Workflows')
    }
    if (dashboardValid && (!country || country === 'All')) {
      const lifecycleBuckets = [
        ['overdue', 'overdue_count', 'Overdue workflows'],
        ['returned', 'returned_count', 'Returned workflows'],
        ['rejected', 'rejected_count', 'Rejected workflows'],
        ['recently_approved', 'approved_count', 'Recently approved workflows'],
      ]
      for (const [bucket, metric, label] of lifecycleBuckets) {
        const total = Number(dashR.value?.metrics?.[metric])
        const loaded = (dashR.value?.buckets?.[bucket] || []).length
        if (Number.isFinite(total) && total > loaded) cappedSources.push(`${label} (${loaded} of ${total})`)
      }
    }
    if (closuresR.status === 'fulfilled' && closuresR.value?.truncated) cappedSources.push('Accident closures')
    if (checklistR.status === 'fulfilled' && checklistR.value?.truncated) cappedSources.push('Checklist sign-offs')
    if (inspectionsR.status === 'fulfilled' && inspectionsR.value?.truncated) cappedSources.push('Inspection sign-offs')
    if (gapsR.status === 'fulfilled' && gapsR.value?.truncated) cappedSources.push('Missed sign-offs')
    setIncompleteSources(cappedSources)
    if (dashboardValid) {
      setBuckets(Object.fromEntries(Object.entries({ ...EMPTY_BUCKETS, ...(dashR.value?.buckets || {}) })
        .map(([key, rows]) => [key, rows.filter(row => matchesCountry(row, country))])))
      // Server metrics span the caller's full scope; a selected country uses
      // the same filtered buckets as the visible queue.
      setMetricsRaw(!country || country === 'All' ? dashR.value?.metrics ?? null : null)
    } else {
      setBuckets(EMPTY_BUCKETS)
      setMetricsRaw(null)
      setWorkflowError(toUserMessage(dashR.reason, 'Workflow engine unavailable'))
    }
    // If either "assigned to me" lookup failed, a zero would be a guess, not a fact.
    setAssignmentUnknown(mineR.status !== 'fulfilled' || delegatedR.status !== 'fulfilled')
    setActionableIds(new Set(
      [
        ...(mineR.status === 'fulfilled' ? mineR.value || [] : []),
        ...(delegatedR.status === 'fulfilled' ? delegatedR.value || [] : []),
      ].map(r => r.id),
    ))
    setClosures(closuresR.status === 'fulfilled' ? (closuresR.value || []).map(toClosureItem) : [])
    setChecklistItems(checklistR.status === 'fulfilled' ? (checklistR.value || []).map(toChecklistItem) : [])
    setIntakeCount(intakeR.status === 'fulfilled' ? (intakeR.value || 0) : null)
    setSignoffGaps(gapsR.status === 'fulfilled' ? (gapsR.value || []).map(toSignoffGapItem) : [])
    setInspectionItems(inspectionsR.status === 'fulfilled' ? (inspectionsR.value || []).map(toInspectionItem) : [])

    // Fatal only when EVERY primary source failed.
    const anyOk = [dashR, closuresR, checklistR, inspectionsR].some(r => r.status === 'fulfilled')
    if (!anyOk) setFatalError(toUserMessage(dashR.reason, 'Failed to load approvals'))

    setUpdatedAt(new Date())
    setLoading(false)
  }, [activeCountry])

  useEffect(() => {
    setBuckets(EMPTY_BUCKETS); setMetricsRaw(null); setClosures([]); setChecklistItems([])
    setInspectionItems([]); setSignoffGaps([]); setIntakeCount(null); setSourceErrors([]); setActionableIds(new Set())
    setIncompleteSources([])
    setSelected(null); setSelectedGeneric(null); setPicked(new Set()); setBulk({ busy: false, result: null })
    setSiteFilter('all'); setUpdatedAt(null)
    load()
    return () => { generation.current += 1 }
  }, [load, accessKey])

  // Merged pending queue: workflow pending + closures + checklists + inspections.
  const mergedPending = useMemo(() => {
    return mergePendingApprovals(buckets.pending || [], [...closures, ...checklistItems, ...inspectionItems])
  }, [buckets.pending, closures, checklistItems, inspectionItems])

  const pendingQueueUnavailable = sourceErrors.some(name =>
    ['Workflows', 'Accident closures', 'Checklist sign-offs', 'Inspection sign-offs'].includes(name),
  ) || incompleteSources.some(name =>
    ['Workflows', 'Accident closures', 'Checklist sign-offs', 'Inspection sign-offs'].includes(name),
  )

  const counts = useMemo(() => ({
    workflow_pending:  sourceErrors.includes('Workflows') ? null : mergedPending.filter(i => i.source === SOURCE.workflow).length,
    closures_pending:  sourceErrors.includes('Accident closures') ? null : closures.length,
    checklist_pending: sourceErrors.includes('Checklist sign-offs') ? null : mergedPending.filter(i => i.source === SOURCE.checklist).length,
    inspection_pending: sourceErrors.includes('Inspection sign-offs') ? null : mergedPending.filter(i => i.source === SOURCE.inspection).length,
    total_pending:     pendingQueueUnavailable ? null : mergedPending.length,
    overdue:           sourceErrors.includes('Workflows') ? null : (buckets.overdue || []).length,
    returned:          sourceErrors.includes('Workflows') ? null : (buckets.returned || []).length,
    rejected:          sourceErrors.includes('Workflows') ? null : (buckets.rejected || []).length,
    recently_approved: sourceErrors.includes('Workflows') ? null : (buckets.recently_approved || []).length,
    signoff_gaps:      sourceErrors.includes('Missed sign-offs') ? null : signoffGaps.length,
  }), [buckets, closures, mergedPending, signoffGaps, sourceErrors, pendingQueueUnavailable])

  const metrics = useMemo(() => {
    const m = metricsRaw && typeof metricsRaw === 'object' ? metricsRaw : {}
    return {
      ...counts,
      overdue:           m.overdue_count ?? m.overdue ?? counts.overdue,
      returned:          m.returned_count ?? counts.returned,
      rejected:          m.rejected_count ?? counts.rejected,
      // The RPC bucket is intentionally the latest 25, so its row count is the
      // displayed tab count rather than the lifetime approved_count metric.
      recently_approved: m.recently_approved ?? m.approved_recent ?? counts.recently_approved,
    }
  }, [metricsRaw, counts])

  // Governed workflow projections also carry the submitted site's scope.
  const siteOptions = useMemo(() => {
    const set = new Set()
    ;[...closures, ...checklistItems, ...inspectionItems, ...signoffGaps, ...Object.values(buckets).flat()].forEach(i => i.site && set.add(i.site))
    return Array.from(set).sort()
  }, [closures, checklistItems, inspectionItems, signoffGaps, buckets])

  const q = search.trim().toLowerCase()

  const matchGeneric = useCallback((i) => {
    if (sourceFilter !== 'all' && i.source !== sourceFilter) return false
    if (siteFilter !== 'all' && i.site !== siteFilter) return false
    if (!q) return true
    return [i.title, i.subtitle, i.site, i.country, i.documentNo, i.id,
      i.raw?.asset_no, i.raw?.tyre_serial, i.raw?.document_no, i.raw?.title]
      .some(value => String(value || '').toLowerCase().includes(q))
  }, [sourceFilter, siteFilter, q])

  const matchWorkflow = useCallback((i) => {
    if (sourceFilter !== 'all' && sourceFilter !== SOURCE.workflow) return false
    if (siteFilter !== 'all' && i.site !== siteFilter) return false
    if (!q) return true
    return [entityLabelOf(i), i.definition_name, i.entity_type, i.entity_id, i.site, i.country,
      i.current_step_name, i.current_approver_role]
      .some(value => String(value || '').toLowerCase().includes(q))
  }, [sourceFilter, siteFilter, q])

  const canActOnItem = useCallback((item) => {
    if (item.source === SOURCE.workflow || item.governed) {
      return actionableIds.has(item.workflowId || item.id)
    }
    if (item.source === SOURCE.accident_closure) return canActNonWorkflow
    if (item.source === SOURCE.checklist) {
      return canDecide(templateRulesOf(item.raw), item.raw, profile?.role,
        { isSuperAdmin: !!profile?.is_super_admin })
    }
    if (item.source === SOURCE.inspection) {
      return canSignInspection(profile?.role, { isSuperAdmin: !!profile?.is_super_admin })
    }
    return false
  }, [actionableIds, canActNonWorkflow, profile?.role, profile?.is_super_admin])

  const myPendingCount = useMemo(
    () => mergedPending.filter(canActOnItem).length,
    [mergedPending, canActOnItem],
  )

  // The active bucket content. Only "pending" is merged; the workflow lifecycle
  // buckets (overdue/returned/rejected/recently_approved) stay workflow-native.
  const activeList = useMemo(() => {
    if (activeBucket === 'pending') {
      return mergedPending.filter(i =>
        (!assignedToMeOnly || canActOnItem(i)) &&
        (i.source === SOURCE.workflow ? matchWorkflow(i) : matchGeneric(i)),
      )
    }
    if (activeBucket === 'signoff_gaps') return signoffGaps.filter(matchGeneric)
    return (buckets[activeBucket] || [])
      .map(i => ({ ...i, source: SOURCE.workflow }))
      .filter(matchWorkflow)
  }, [activeBucket, mergedPending, buckets, matchWorkflow, matchGeneric, signoffGaps, assignedToMeOnly, canActOnItem])

  const columns = useMemo(() => [
    {
      id: 'approval',
      header: 'Approval',
      accessorFn: row => row.source === SOURCE.workflow ? entityLabelOf(row) : row.title,
      size: 340,
      cell: ({ row }) => {
        const item = row.original
        const title = item.source === SOURCE.workflow ? entityLabelOf(item) : item.title
        const subtitle = item.source === SOURCE.workflow
          ? [item.definition_name || 'Workflow', item.entity_type, item.entity_id && `Ref ${item.entity_id}`].filter(Boolean).join(' · ')
          : item.subtitle
        return <div className="min-w-0 py-0.5">
          <div className="flex items-center gap-2"><SourceBadge source={item.source} /><span className="font-medium text-[var(--text-primary)] truncate">{title}</span></div>
          <p className="text-xs text-[var(--text-muted)] truncate mt-1">{subtitle || 'Approval request'}</p>
        </div>
      },
    },
    {
      id: 'waiting_on',
      header: 'Waiting on',
      accessorFn: row => row.source === SOURCE.workflow
        ? `Waiting for ${row.current_approver_role || currentStepOf(row).step?.approver_role || 'Approver'}`
        : row.stageSummary?.text || (row.source === SOURCE.signoff_gap ? 'Sign-off missing' : 'Approver'),
      cell: ({ getValue }) => <span className="text-sm text-[var(--text-secondary)]">{getValue()}</span>,
    },
    {
      id: 'site',
      header: 'Site',
      accessorFn: row => [row.site, row.country].filter(Boolean).join(' · ') || '—',
      cell: ({ getValue }) => <span className="text-sm text-[var(--text-secondary)]">{getValue()}</span>,
    },
    {
      id: 'submitted',
      header: 'Submitted',
      accessorFn: row => row.source === SOURCE.workflow
        ? row.step_started_at || row.started_at
        : row.created_at,
      cell: ({ getValue }) => {
        const old = ['pending', 'overdue'].includes(activeBucket) && ageMs(getValue()) > 3 * 86400000
        return <span className={`whitespace-nowrap text-sm ${old ? 'font-semibold text-red-400' : 'text-[var(--text-muted)]'}`} title={old ? 'Waiting more than 3 days' : undefined}>{relTime(getValue()) || '—'}</span>
      },
      sortingFn: 'datetime',
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: row => row.source === SOURCE.workflow
        ? row.status
        : row.source === SOURCE.signoff_gap ? 'Missed sign-off' : row.stageSummary?.text || 'Pending',
      cell: ({ row }) => row.original.source === SOURCE.workflow
        ? <ApprovalStatusBadge status={row.original.status} />
        : row.original.source === SOURCE.signoff_gap
          ? <span className="inline-flex rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-300">Never asked</span>
          : <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-300">{row.original.stageSummary?.text || 'Pending'}</span>,
    },
    {
      id: 'review',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); openRow(row.original) }}
          className="inline-flex items-center gap-1 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-1.5 text-xs font-semibold text-orange-200 hover:bg-orange-500/20"
        >Review <ChevronRight className="w-3.5 h-3.5" /></button>
      ),
    },
  ], [activeBucket])

  const rowSelection = useMemo(() => Object.fromEntries([...picked].map(key => [key, true])), [picked])

  const activeBucketUnavailable = activeBucket === 'pending'
    ? pendingQueueUnavailable
    : activeBucket === 'signoff_gaps'
      ? sourceErrors.includes('Missed sign-offs')
      : sourceErrors.includes('Workflows')

  const isActionable = useCallback(
    (instance) => actionableIds.has(instance?.id)
      && ['pending', 'in_review', 'returned'].includes(String(instance?.status || '').toLowerCase()),
    [actionableIds],
  )

  const hasFilters = q || sourceFilter !== 'all' || siteFilter !== 'all'
    || (assignedToMeOnly && activeBucket === 'pending')

  // Only accident closures and checklist sign-offs can be decided in bulk. A
  // workflow instance cannot: its next step may demand a signature, a cost or a
  // specific approver, and pressing Approve on a list of them would skip exactly
  // the requirements the engine exists to enforce. A missed sign-off is a fact to
  // correct rather than a decision to make, so it is not bulk-decidable either.
  const bulkableList = useMemo(
    () => activeList.filter(i => BULKABLE.includes(i.source) && !i.governed
      && (!workflowError || i.source === SOURCE.accident_closure)
      && canActOnItem(i)),
    [activeList, workflowError, canActOnItem],
  )
  const keyOf = (i) => `${i.source}:${i.id}`
  const pickedItems = useMemo(
    () => bulkableList.filter(i => picked.has(keyOf(i))),
    [bulkableList, picked],
  )
  const allPicked = bulkableList.length > 0 && pickedItems.length === bulkableList.length

  // A CHECKLIST CANNOT BE APPROVED IN BULK, and this is a rule rather than a
  // limitation. A sign-off is a signature given by a named person against one
  // sheet, and the server refuses an approval that carries no signature. Worse,
  // whether a sheet may be closed at all depends on its own answers - a single
  // item still marked as a fault blocks it - and the queue row does not carry
  // them, so a bulk approve could not warn about the one thing that matters. It
  // would simply fail on every row it should have failed on, and silently close
  // the rest. Returning several for correction is different: it needs one shared
  // reason and no signature, so it stays.
  const pickedChecklists = useMemo(
    () => pickedItems.filter(i => i.source === SOURCE.checklist),
    [pickedItems],
  )

  // An inspection carries a signature too, so a batch approve must supply one -
  // the approver's saved mark, the same person signing each sheet. Without a
  // saved (or drawn) signature the server stores an unsigned approval, which is
  // the exact defect this guards.
  const pickedInspections = useMemo(
    () => pickedItems.filter(i => i.source === SOURCE.inspection),
    [pickedItems],
  )

  const togglePick = useCallback((item) => {
    setBulk(b => ({ ...b, result: null }))
    setPicked(prev => {
      const next = new Set(prev)
      const k = `${item.source}:${item.id}`
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }, [])

  // Clear the selection whenever the visible list changes underneath it, so a
  // bulk action can never hit a row the user can no longer see.
  useEffect(() => { setPicked(new Set()); setBulk({ busy: false, result: null }) },
    [activeBucket, q, sourceFilter, siteFilter])

  async function runBulk(action, reasonText = null) {
    if (!pickedItems.length || bulkLock.current) return
    const current = generation.current
    let reason = null
    if (action === 'reject') {
      // A checklist return REQUIRES a note (the service enforces it), so it is
      // asked once for the whole batch (see the return dialog) rather than
      // failing every row with the same message.
      reason = (reasonText || '').trim()
      if (!reason) { setBulk({ busy: false, result: { failed: [], ok: [], note: 'A reason is required to return items.' } }); return }
    }
    // Approving inspections in a batch needs a signature - the approver's saved
    // mark, applied to each. Load it up front and refuse rather than store an
    // approval nobody signed. Returning for correction needs no signature.
    bulkLock.current = true
    setBulk({ busy: true, result: null })
    let signature = null
    if (action === 'approve' && pickedInspections.length > 0) {
      try { signature = await getMySignature() } catch { signature = null }
      if (current !== generation.current) { bulkLock.current = false; return }
      if (!isUsableSignature(signature)) {
        setBulk({ busy: false, result: {
          ok: [], failed: [],
          note: 'These inspections need a signature. Save one in Settings > My signature, or open each to sign it.',
        } })
        bulkLock.current = false
        return
      }
    }

    setBulk({ busy: true, result: null })
    try {
      // The approver's identity is taken server-side from the session, never
      // from the client; only the signature (their own saved mark) is carried.
      const res = await queue.bulkDecide(pickedItems, action, { reason, signature })
      if (current !== generation.current) return
      setBulk({ busy: false, result: { ...res, action } })
      setPicked(new Set())
      await load()
    } catch (err) {
      if (current === generation.current) setBulk({ busy: false, result: { ok: [], failed: [], note: toUserMessage(err, 'the bulk action failed') } })
    } finally {
      bulkLock.current = false
    }
  }

  function openRow(row) {
    if (row.source === SOURCE.workflow) setSelected(row)
    else setSelectedGeneric(row)
  }

  return (
    <div className="text-[var(--text-primary)] space-y-6">
      <PageHeader
        title="Approval Dashboard"
        subtitle="Every pending approval across your organisation: workflows, accident closures, checklist and inspection sign-offs"
        icon={CheckSquare}
        badge={loading || metrics.total_pending == null ? undefined : `${metrics.total_pending} pending`}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      {fatalError ? (
        <EngineUnavailable message={fatalError} onRetry={load} retrying={loading} />
      ) : (
        <>
          {!loading && (sourceErrors.length > 0 || incompleteSources.length > 0) && (
            <div role="status" className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">
                {sourceErrors.length > 0 && <>Could not check: {sourceErrors.join(', ')}; pending totals and empty states are incomplete. </>}
                {incompleteSources.length > 0 && <>Some approval queues are incomplete. This view has only loaded part of: {incompleteSources.join(', ')}.</>}
              </span>
              <button onClick={load} className="shrink-0 px-2 py-0.5 text-xs font-semibold text-amber-100 bg-amber-500/15 hover:bg-amber-500/25 rounded-lg border border-amber-500/30">Retry</button>
            </div>
          )}

          {/* Workflow engine degraded notice (other sources still shown) */}
          {!loading && workflowError && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1">
                Workflow engine is unavailable. Available documents remain visible; open each checklist or inspection individually to verify its approval route.
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

          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Search asset, document, site or approval…"
            searchLabel="Search approvals"
            selects={[
              ...(siteOptions.length ? [{
                key: 'approval-site',
                value: siteFilter,
                onChange: setSiteFilter,
                ariaLabel: 'Filter by site',
                options: [{ value: 'all', label: 'All sites' }, ...siteOptions.map(site => ({ value: site, label: site }))],
              }] : []),
            ]}
            onClearAll={hasFilters ? () => {
              setSearch(''); setSourceFilter('all'); setSiteFilter('all'); setAssignedToMeOnly(false)
            } : undefined}
          >
            <span className="px-1 text-xs text-[var(--text-muted)]">{activeList.length} approvals</span>
            {activeBucket === 'pending' && (
              <div className="flex items-center gap-1 rounded-xl border border-[var(--border-dim)] p-1">
                <button
                  type="button"
                  aria-pressed={!assignedToMeOnly}
                  onClick={() => setAssignedToMeOnly(false)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${!assignedToMeOnly ? 'bg-orange-500/15 text-orange-200' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >All pending · {metrics.total_pending == null ? '—' : metrics.total_pending}</button>
                <button
                  type="button"
                  aria-pressed={assignedToMeOnly}
                  onClick={() => setAssignedToMeOnly(true)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${assignedToMeOnly ? 'bg-orange-500/15 text-orange-200' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >Assigned to me · {pendingQueueUnavailable ? '—' : myPendingCount}</button>
              </div>
            )}
          </FilterBar>

          {/* Bucket tabs */}
          <div className="flex flex-wrap gap-2 border-b border-[var(--border-dim)] pb-3">
            {BUCKETS.map(b => {
              const count = b.key === 'pending' ? counts.total_pending : metrics[b.key]
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
                    {loading ? '·' : count == null ? '—' : count}
                  </span>
                </button>
              )
            })}
          </div>

          {activeBucket === 'pending' && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by approval type">
              <span className="text-xs text-[var(--text-muted)]">Type</span>
              {[['all', 'All types', mergedPending.length], ...Object.entries(SOURCE_META)
                .filter(([value]) => value !== 'signoff_gap')
                .map(([value, meta]) => [value, meta.short, mergedPending.filter(i => i.source === value).length])].map(([value, label, n]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={sourceFilter === value}
                  onClick={() => setSourceFilter(value)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${sourceFilter === value ? 'bg-orange-500/15 text-orange-200 border-orange-500/40' : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--input-border)] hover:text-[var(--text-primary)]'}`}
                >{label} <span className="opacity-70">{loading ? '·' : n}</span></button>
              ))}
            </div>
          )}

          {activeBucket === 'signoff_gaps' && (
            <div className="px-3 py-2 rounded-xl border border-orange-500/30 bg-orange-500/[0.06] text-xs text-orange-200">
              These checklists came from a template that requires sign-off, but were recorded as not needing one, so they never appeared in the Pending queue. Open one to record the sign-off now. An empty Pending tab does not mean nothing needed signing.
            </div>
          )}

          {/* Batch actions remain above the register and operate only on eligible rows. */}
          {bulkableList.length > 0 && (
            <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border-dim)] bg-[var(--surface-2)] shadow-lg">
              <button
                type="button"
                onClick={() => setPicked(allPicked ? new Set() : new Set(bulkableList.map(keyOf)))}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {allPicked ? <CheckSquare className="w-4 h-4 text-orange-400" /> : <Square className="w-4 h-4" />}
                {allPicked ? 'Clear selection' : `Select all ${bulkableList.length}`}
              </button>
              <span className="text-xs text-[var(--text-muted)]">{pickedItems.length} selected</span>
              {activeList.length > bulkableList.length && (
                <span className="text-[11px] text-[var(--text-muted)]">{activeList.length - bulkableList.length} item(s) must be opened individually.</span>
              )}
              {pickedChecklists.length > 0 && (
                <span className="text-[11px] text-amber-400">Checklist approvals require an individual signature. They can still be returned together.</span>
              )}
              {pickedInspections.length > 0 && (
                <span className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1"><PenLine className="w-3 h-3" />Your saved signature will be applied to each selected inspection.</span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => runBulk('approve')}
                  disabled={!pickedItems.length || bulk.busy || pickedChecklists.length > 0}
                  title={pickedChecklists.length > 0 ? 'Checklist approvals require an individual signature.' : undefined}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500/15 text-green-300 border border-green-500/30 hover:bg-green-500/25 disabled:opacity-40"
                >
                  {bulk.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}Approve selected
                </button>
                <button
                  type="button"
                  onClick={() => setReturnDialog({ open: true, reason: '' })}
                  disabled={!pickedItems.length || bulk.busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40"
                ><Ban className="w-3.5 h-3.5" />Return selected</button>
              </div>
            </div>
          )}

          {bulk.result && (
            <div className="px-3 py-2 rounded-xl border border-[var(--border-dim)] bg-[var(--surface-1)] text-xs space-y-1" role="status">
              {bulk.result.note && <p className="text-amber-300">{bulk.result.note}</p>}
              {bulk.result.ok?.length > 0 && <p className="text-green-300">{bulk.result.ok.length} item(s) {bulk.result.action === 'approve' ? 'approved' : 'returned'}.</p>}
              {bulk.result.failed?.length > 0 && <div className="text-red-300"><p>{bulk.result.failed.length} could not be actioned:</p><ul className="mt-0.5 space-y-0.5">{bulk.result.failed.slice(0, 6).map(f => <li key={`${f.item.source}:${f.item.id}`} className="text-[var(--text-muted)]"><span className="text-[var(--text-secondary)]">{f.item.title}</span> - {f.error}</li>)}</ul></div>}
            </div>
          )}

          <EnterpriseTable
            columns={columns}
            data={activeList}
            getRowId={row => `${row.source}:${row.id}`}
            loading={loading}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableRowSelection={row => bulkableList.some(item => keyOf(item) === row.id)}
            rowSelection={rowSelection}
            onRowSelectionChange={updater => {
              const next = typeof updater === 'function' ? updater(rowSelection) : updater
              setPicked(new Set(Object.keys(next).filter(key => next[key])))
            }}
            onRowClick={openRow}
            viewKey="approval-dashboard"
            initialPageSize={25}
            resetPageKey={`${activeBucket}:${sourceFilter}:${siteFilter}:${assignedToMeOnly}:${q}`}
            emptyMessage={activeBucketUnavailable && !hasFilters
              ? 'Could not verify this queue. Retry to confirm whether approvals are waiting.'
              : hasFilters
                ? 'No approvals match your filters.'
                : activeBucket === 'signoff_gaps' && !activeBucketUnavailable
                  ? 'Nothing slipped past. Every required sign-off entered the approval queue.'
                  : `Nothing in ${BUCKETS.find(bucket => bucket.key === activeBucket)?.label || 'this queue'}.`}
          />
        </>
      )}

      <Modal
        open={returnDialog.open}
        onClose={() => setReturnDialog({ open: false, reason: '' })}
        title={`Return ${pickedItems.length} item${pickedItems.length === 1 ? '' : 's'} for correction`}
        subtitle="The person who submitted each one sees this note."
        size="sm"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={() => setReturnDialog({ open: false, reason: '' })}>Cancel</button>
            <button
              type="button"
              className="btn-primary text-sm disabled:opacity-40"
              disabled={!returnDialog.reason.trim() || bulk.busy}
              onClick={() => { const r = returnDialog.reason; setReturnDialog({ open: false, reason: '' }); runBulk('reject', r) }}
            >Return items</button>
          </div>
        )}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-secondary)]">What needs to be corrected?</span>
          <textarea
            autoFocus
            rows={4}
            className="input w-full"
            value={returnDialog.reason}
            onChange={e => setReturnDialog(d => ({ ...d, reason: e.target.value }))}
            placeholder="For example: tyre pressure missing on the rear axle"
          />
        </label>
      </Modal>

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
            onActed={(opts) => { if (!opts?.keepOpen) setSelectedGeneric(null); load() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
