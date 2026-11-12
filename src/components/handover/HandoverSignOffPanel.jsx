import { useState } from 'react'
import {
  ClipboardCheck, CheckCircle2, XCircle, Loader2, AlertTriangle, Check, Clock,
} from 'lucide-react'
import SignatureField from '../checklist/SignatureField'
import SignatureView from '../checklist/SignatureView'
import { useAuth } from '../../contexts/AuthContext'
import { toUserMessage } from '../../lib/safeError'
import { decideHandover } from '../../lib/api/handoverReports'
import {
  approvalProgress, statusSummary, stageFor, canActOnStage, canReject,
  closesInOneSign, isFullyClosed, isRejected, STAGE_INCHARGE,
} from '../../lib/handoverApproval'

/**
 * Sign a vehicle handover off WHERE IT IS BEING READ.
 *
 * A handover carries the driver's own field signature; this panel adds the
 * two-stage management sign-off on top of it: a Fleet Supervisor signs the first
 * rung, then a Fleet Incharge closes it (or an Admin / Fleet Incharge closes
 * both in one signature). It renders the ladder so a reader sees who signed and
 * when, and offers the decision only to the person whose rung is outstanding.
 *
 * IT IS THE SAME WRITER, NOT A SECOND ONE. Every decision goes through
 * `decideHandover` -> `decide_handover_approval`, which resolves the rung,
 * derives the signer and timestamp from the session and enforces the role gates.
 * The gate below is not the boundary (the database is); it exists so nobody is
 * offered a button whose only outcome is a refusal.
 *
 * @param {object}   props
 * @param {object}   props.handover    the loaded handover_reports row
 * @param {Function} [props.onDecided] called with the reached status after a decision
 */

function fmtWhen(v) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

const TONE_CLASS = { good: 'good', bad: 'bad', warn: 'warn', muted: 'muted' }

export default function HandoverSignOffPanel({ handover, onDecided }) {
  const { profile } = useAuth()
  const [note, setNote] = useState('')
  const [signature, setSignature] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [decided, setDecided] = useState(false)

  if (!handover) return null

  const opts = { role: profile?.role, isSuperAdmin: !!profile?.is_super_admin }
  const progress = approvalProgress(handover)
  const summary = statusSummary(handover)
  const stage = stageFor(handover)
  const closed = isFullyClosed(handover)
  const rejected = isRejected(handover)
  const mayAct = !decided && canActOnStage(handover, opts)
  const mayReject = !decided && canReject(handover, opts)
  const oneSign = closesInOneSign(handover, opts)
  const wouldClose = stage === STAGE_INCHARGE || oneSign

  const approveBlockedReason = !signature
    ? 'Draw or confirm your signature before you approve.'
    : null

  async function act(approved) {
    if (!approved && !note.trim()) {
      setFeedback({ kind: 'error', text: 'Give a reason before you send this back.' })
      return
    }
    if (approved && approveBlockedReason) {
      setFeedback({ kind: 'error', text: approveBlockedReason })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      const res = await decideHandover(handover.id, {
        approved,
        signature: approved ? signature : null,
        note,
      })
      const reached = String(res?.status || (approved ? 'approved' : 'rejected'))
      setFeedback({
        kind: 'success',
        text: !approved
          ? 'Sent back to the depot.'
          : reached === 'approved'
            ? 'Handover approved and closed.'
            : 'Signed off. Waiting for the fleet incharge.',
      })
      setDecided(true)
      onDecided?.(reached)
    } catch (err) {
      setFeedback({ kind: 'error', text: toUserMessage(err, 'Could not record the decision.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="vh-signoff" data-testid="handover-signoff-panel">
      <div className="vh-signoff-head">
        <span className="vh-signoff-title"><ClipboardCheck size={14} aria-hidden="true" /> Two-stage sign-off</span>
        <span className={`cc-pill ${TONE_CLASS[summary.tone] || 'muted'}`}>{summary.text}</span>
      </div>

      <ol className="vh-ladder" aria-label="Sign-off progress">
        {progress.map((rung, i) => (
          <li key={rung.key} className={`vh-rung ${rung.done ? 'done' : rung.current ? 'current' : 'todo'}`}>
            <span className="vh-rung-dot">{rung.done ? <Check size={13} aria-hidden="true" /> : rung.current ? <Clock size={12} aria-hidden="true" /> : i + 1}</span>
            <div className="vh-rung-main">
              <b>{rung.label}</b>
              <small>
                {rung.done && rung.name ? `Signed by ${rung.name}` : rung.done ? 'Signed' : rung.current ? 'Waiting now' : 'Not yet'}
                {rung.at ? ` on ${fmtWhen(rung.at)}` : ''}
              </small>
              {rung.signature && (
                <div className="vh-rung-sig"><SignatureView value={rung.signature} height={54} label={null} name={null} /></div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {feedback && (
        <p className={`vh-signoff-msg ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
          {feedback.kind === 'error' ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />} {feedback.text}
        </p>
      )}

      {!decided && closed && (
        <p className="vh-signoff-note"><CheckCircle2 size={14} aria-hidden="true" /> This handover is fully signed off.</p>
      )}
      {!decided && rejected && (
        <p className="vh-signoff-note bad">
          <XCircle size={14} aria-hidden="true" /> This handover was sent back.{handover.review_note ? ` Reason: ${handover.review_note}` : ''}
        </p>
      )}

      {mayAct && (
        <div className="vh-signoff-act">
          <p className="vh-signoff-hint">
            {wouldClose ? 'Approving closes this handover.' : 'Signing off passes it to the fleet incharge.'}
          </p>
          <SignatureField label={wouldClose ? 'Approval signature' : 'Supervisor signature'} onChange={setSignature} />
          {oneSign && (
            <p className="vh-signoff-hint">Your signature completes both the supervisor and the fleet incharge steps.</p>
          )}
          <label className="vh-field">
            <span>Note {wouldClose ? '(optional)' : '(required to send back)'}</span>
            <textarea
              className="vh-input vh-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              placeholder="Add a note for the record or a reason for sending it back"
            />
          </label>
          {approveBlockedReason && (
            <p className="vh-signoff-hint warn"><AlertTriangle size={13} aria-hidden="true" /> {approveBlockedReason}</p>
          )}
          <div className="vh-signoff-btns">
            {mayReject && (
              <button type="button" className="cc-btn-ghost vh-reject" onClick={() => act(false)} disabled={busy}>
                {busy ? <Loader2 size={14} className="vh-spin" aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />} Send back
              </button>
            )}
            <button type="button" className="cc-btn-primary" onClick={() => act(true)} disabled={busy || !!approveBlockedReason}>
              {busy ? <Loader2 size={14} className="vh-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />} {wouldClose ? 'Approve and close' : 'Sign off'}
            </button>
          </div>
        </div>
      )}

      {!decided && stage && !mayAct && (
        <p className="vh-signoff-note">
          <AlertTriangle size={14} aria-hidden="true" /> {summary.text}. You cannot sign this step.
        </p>
      )}
    </section>
  )
}
