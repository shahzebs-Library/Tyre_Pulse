import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FileWarning, Loader2, PenLine } from 'lucide-react'
import SignatureField from './SignatureField'
import { blockingAnswers } from '../../lib/checklist/checklistMarks'
import { isTwoStage } from '../../lib/checklist/checklistApproval'
import { templateFromSubmission, submissionAnswers } from '../../lib/checklistView'
import {
  faultRows, faultSummary, complianceLabel, acknowledgeCheck, isAcknowledged, FAULT_STATE_TEXT,
} from '../../lib/closureWorkflow'
import {
  listSheetActions, getClosureReviewConfig, getAcknowledgement, acknowledgeChecklist,
} from '../../lib/api/closureReview'
import { useAuth } from '../../contexts/AuthContext'
import { toUserMessage } from '../../lib/safeError'
import { formatDate } from '../../lib/formatters'

const STATE_TONE = {
  unlinked: 'text-red-400', open: 'text-amber-400', in_review: 'text-amber-400',
  resolved: 'text-green-400', exception: 'text-[var(--text-secondary)]',
}
const LABEL_TONE = { good: 'text-green-400', warn: 'text-amber-400', muted: 'text-[var(--text-secondary)]' }

/**
 * The faults recorded on one checklist, what has happened to each, and the
 * ACKNOWLEDGE step.
 *
 * A sheet with an item marked as a fault cannot be approved: that rule stands.
 * Acknowledging is a different, explicit outcome. The signer confirms they have
 * seen the fault; the answer stays exactly as recorded; the sheet is locked and
 * shown as not compliant until every fault is closed on review or covered by a
 * documented exception on its corrective action.
 *
 * Renders nothing for a sheet with no fault. Before the database drafts are
 * applied it shows the fault list only (no acknowledge control).
 */
export default function ChecklistFaultPanel({ submission, onChanged }) {
  const { profile } = useAuth()
  const [state, setState] = useState({ loading: true, provisioned: false, actions: [], config: null, ack: null })
  const [note, setNote] = useState('')
  const [signature, setSignature] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)

  const template = useMemo(() => (submission ? templateFromSubmission(submission) : null), [submission])
  const blocking = useMemo(
    () => (submission && template ? blockingAnswers(template, submissionAnswers(submission)) : []),
    [submission, template],
  )
  const id = submission?.id
  const hasFaults = blocking.length > 0

  const load = useCallback(async () => {
    if (!id || !hasFaults) return
    try {
      const [sheet, cfg, ack] = await Promise.all([listSheetActions(id), getClosureReviewConfig(), getAcknowledgement(id)])
      setState({ loading: false, provisioned: sheet.provisioned && cfg.provisioned, actions: sheet.actions, config: cfg.config, ack })
    } catch (err) {
      setState((s) => ({ ...s, loading: false }))
      setFeedback({ ok: false, text: toUserMessage(err, 'Could not load the faults on this checklist.') })
    }
  }, [id, hasFaults])
  useEffect(() => { load() }, [load])

  if (!submission || !hasFaults) return null

  const rows = faultRows(blocking, state.actions)
  const summary = faultSummary(rows)
  const acknowledged = isAcknowledged(submission)
  const label = complianceLabel(submission, summary)
  const waiting = ['pending', 'pending_area_manager'].includes(String(submission.approval_status || ''))
  const check = acknowledgeCheck({
    submission: { ...submission, ...(state.ack || {}) },
    twoStage: isTwoStage(template),
    faultCount: blocking.length,
    role: profile?.role,
    isSuperAdmin: !!profile?.is_super_admin,
    userId: profile?.id,
    config: state.config,
  })

  async function acknowledge() {
    setBusy(true); setFeedback(null)
    try {
      await acknowledgeChecklist(id, { note, signature })
      setFeedback({ ok: true, text: 'Acknowledged. The fault stays on record and the checklist is not compliant until it is resolved.' })
      onChanged?.('acknowledged')
    } catch (err) {
      setFeedback({ ok: false, text: toUserMessage(err, 'The checklist could not be acknowledged.') })
    } finally { setBusy(false) }
  }

  return (
    <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--input-border)' }} data-testid="checklist-fault-panel" aria-label="Recorded faults">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 text-[var(--text-secondary)]">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" /> Recorded faults ({rows.length})
        </h3>
        {label && <span className={`text-xs font-medium ${LABEL_TONE[label.tone]}`}>{label.text}</span>}
      </div>

      {acknowledged && state.ack?.acknowledged_at && (
        <p className="text-xs text-[var(--text-muted)]">
          Acknowledged by {state.ack.acknowledged_name || 'a signer'} on {formatDate(state.ack.acknowledged_at)}
          {state.ack.acknowledgement_note ? `. Note: ${state.ack.acknowledgement_note}` : ''}
        </p>
      )}

      {state.loading ? (
        <p className="text-xs text-[var(--text-muted)] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0 text-[var(--text-primary)]">{r.label} <span className="text-red-300">({r.mark})</span></span>
              <span className={`shrink-0 text-xs inline-flex items-center gap-1 ${STATE_TONE[r.state]}`}>
                {r.state === 'resolved' ? <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  : r.state === 'exception' ? <FileWarning className="w-3.5 h-3.5" aria-hidden="true" /> : null}
                {FAULT_STATE_TEXT[r.state]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {rows.some((r) => r.action) && (
        <p className="text-xs text-[var(--text-muted)]">
          Each fault is closed through its corrective action, by a reviewed fix or a documented exception.{' '}
          <Link to="/actions" className="underline text-[var(--accent)]">Open corrective actions</Link>
        </p>
      )}

      {feedback && <p role={feedback.ok ? 'status' : 'alert'} className={`text-sm ${feedback.ok ? 'text-green-400' : 'text-red-400'}`}>{feedback.text}</p>}

      {state.provisioned && waiting && !feedback?.ok && (
        check.ok ? (
          <div className="space-y-2 pt-2 border-t border-[var(--border)]">
            <p className="text-xs text-[var(--text-secondary)]">
              This checklist cannot be approved while a fault is recorded. You can acknowledge it instead: the fault stays as
              written, the sheet is locked, and it counts as compliant only when every fault is resolved or has a documented exception.
              {check.bothSteps ? ' Your signature is recorded on both signing steps.' : ''}
            </p>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note (optional)"
              className="w-full rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
            <SignatureField label="Acknowledgement signature" onChange={setSignature} />
            <button type="button" onClick={acknowledge} disabled={busy || !signature}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border border-amber-600/60 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <PenLine className="w-4 h-4" aria-hidden="true" />}
              Acknowledge with fault
            </button>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border)]">{check.reason}</p>
        )
      )}
    </section>
  )
}
