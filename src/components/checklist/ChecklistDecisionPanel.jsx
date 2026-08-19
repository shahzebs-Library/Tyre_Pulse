import { useMemo, useState } from 'react'
import { CheckCircle2, XCircle, Loader2, AlertTriangle, ClipboardCheck } from 'lucide-react'
import SignatureField from './SignatureField'
import BlockingMarksNotice from './BlockingMarksNotice'
import { decideChecklist } from '../../lib/api/approvalsQueue'
import { canClose } from '../../lib/checklist/checklistMarks'
import { templateFromSubmission, submissionAnswers } from '../../lib/checklistView'
import {
  canDecide, stageFor, isTwoStage, STAGE_SUPERVISOR,
} from '../../lib/checklist/checklistApproval'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'

/**
 * Sign a checklist off WHERE IT IS BEING READ.
 *
 * THE GAP THIS CLOSES. A checklist could be decided in exactly one place - the
 * Approvals dashboard. Everywhere the sheet was actually looked at (the quick
 * viewer drawer, the full submission page) showed the sign-off ladder as a
 * read-only picture and offered no way to act on it, so an approver who had just
 * finished reading the answers had to leave, find the same sheet in a queue and
 * open it again. This is the same decision, taken in front of the evidence.
 *
 * IT IS THE SAME WRITER, NOT A SECOND ONE. Everything goes through
 * `decideChecklist` -> `decide_checklist_approval`, which resolves which rung
 * this is, derives the approver and the timestamp from the session, and refuses
 * a rung skip or a close while a blocking mark stands. There is deliberately no
 * direct table update here: PROJECT_MEMORY records four separate defects that
 * were closed by routing every stack onto that RPC.
 *
 * The gate below is not the boundary - the database is. It exists so that
 * somebody is not offered a button whose only outcome is a refusal.
 *
 * @param {object}   props
 * @param {object}   props.submission  the loaded row (not a queue projection)
 * @param {Function} [props.onDecided] called after a successful decision
 */
export default function ChecklistDecisionPanel({ submission, onDecided }) {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const [note, setNote] = useState('')
  const [signature, setSignature] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [decided, setDecided] = useState(false)

  const template = useMemo(
    () => (submission ? templateFromSubmission(submission) : null),
    [submission],
  )

  const stage = submission ? stageFor(template, submission) : null

  // Would approving CLOSE the sheet, or only pass it up? Only a close is barred
  // by an outstanding fault, and only a close is the final word.
  const wouldClose = !(stage === STAGE_SUPERVISOR && isTwoStage(template))

  const closeCheck = useMemo(
    () => (submission ? canClose(template, submissionAnswers(submission)) : { ok: true, blocking: [] }),
    [submission, template],
  )

  const mayAct = !!stage && canDecide(template, submission, profile?.role, {
    isSuperAdmin: !!profile?.is_super_admin,
  })

  // A sheet nobody is waiting on has nothing to decide. The ladder above it
  // already says who signed and when, so this simply does not render.
  if (!submission || !stage) return null

  const approveBlockedReason = (wouldClose && !closeCheck.ok)
    ? 'This sheet still has items marked as a fault, so it cannot be closed yet.'
    : !signature
      ? t('signature.decide.needSignature')
      : null

  async function act(approved) {
    if (!approved && !note.trim()) {
      setFeedback({ kind: 'error', text: t('signature.decide.needNote') })
      return
    }
    if (approved && approveBlockedReason) {
      setFeedback({ kind: 'error', text: approveBlockedReason })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      const res = await decideChecklist(submission.id, {
        approved,
        reviewNote: note,
        signature: approved ? signature : null,
        currentStatus: submission.approval_status || null,
      })
      const reached = String(res?.status || (approved ? 'approved' : 'rejected'))
      setFeedback({
        kind: 'success',
        text: reached === 'pending_area_manager'
          ? t('signature.decide.signedOff')
          : reached === 'approved'
            ? t('signature.decide.approved')
            : t('signature.decide.returned'),
      })
      setDecided(true)
      onDecided?.(reached)
    } catch (err) {
      setFeedback({ kind: 'error', text: toUserMessage(err, t('signature.decide.failed')) })
    } finally {
      setBusy(false)
    }
  }

  if (!mayAct) {
    return (
      <div
        className="flex items-center gap-2.5 p-3 rounded-xl border text-sm"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--input-border)', color: 'var(--text-secondary)' }}
      >
        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
        {t('signature.decide.notYours')}
      </div>
    )
  }

  return (
    <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--input-border)' }} data-testid="checklist-decision-panel">
      <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
        <ClipboardCheck className="w-3.5 h-3.5" /> {t('signature.decide.heading')}
      </h3>

      {feedback && (
        <p className={`text-sm ${feedback.kind === 'success' ? 'text-green-400' : 'text-red-400'}`}>
          {feedback.text}
        </p>
      )}

      {decided ? null : (
        <>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {wouldClose ? t('signature.decide.closes') : t('signature.decide.passesOn')}
          </p>

          {wouldClose && !closeCheck.ok && (
            <BlockingMarksNotice template={template} answers={submissionAnswers(submission)} />
          )}

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={t('signature.decide.note')}
            className="w-full rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
          />

          <SignatureField
            label={wouldClose ? 'Final approval signature' : 'Supervisor signature'}
            onChange={setSignature}
          />

          {approveBlockedReason && (
            <p className="text-xs text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {approveBlockedReason}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => act(false)}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border border-red-700/50 text-red-300 hover:bg-red-900/20 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              {t('signature.decide.return')}
            </button>
            <button
              type="button"
              onClick={() => act(true)}
              disabled={busy || !!approveBlockedReason}
              title={approveBlockedReason || undefined}
              className="flex-[2] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-[var(--text-primary)] bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {wouldClose ? t('signature.decide.approve') : t('signature.decide.signOff')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
