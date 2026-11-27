import { useEffect, useState, useCallback } from 'react'
import { Lock, PenLine, History, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import SignatureCapture from '../checklist/SignatureCapture'
import SignatureView from '../checklist/SignatureView'
import HandoverLocation from './HandoverLocation'
import { toUserMessage } from '../../lib/safeError'
import { signHandover, listHandoverEvents, getMyLinkedDriverId, getMyUserId } from '../../lib/api/handoverReports'
import {
  signatureLadder, nextPartyToSign, isFrozen, hasAuthorizationColumns, rowLocation,
  PARTY_LABEL, captureLocation, locationArgs, eventLabel, eventFields, signingSummary,
  isSentBack, rowSigningMode, onBehalfPrompt, SIGN_ON_BEHALF, SIGN_BLOCKED, SIGN_OTHER_ACCOUNT,
} from '../../lib/handoverAuthorization'

function fmtWhen(v) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

/**
 * The authorization part of a saved handover: both driver signatures with the
 * name and the SERVER time each was recorded, where it happened, whether the
 * record is locked, a way to collect a signature that is still missing, and the
 * audit trail. Every write goes through sign_handover(); the database stamps the
 * time and refuses any later change.
 *
 * @param {{ handover: object, onSigned?: Function }} props
 */
export default function HandoverAuthorizationPanel({ handover, onSigned }) {
  const [events, setEvents] = useState(null)
  const [eventsError, setEventsError] = useState('')
  const [sig, setSig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [padKey, setPadKey] = useState(0)
  const [myDriverId, setMyDriverId] = useState(null)
  const [behalfOk, setBehalfOk] = useState(false)
  const [myUserId, setMyUserId] = useState(null)
  useEffect(() => {
    let live = true
    getMyLinkedDriverId().then((v) => { if (live) setMyDriverId(v) })
    getMyUserId().then((v) => { if (live) setMyUserId(v) })
    return () => { live = false }
  }, [])

  const id = handover?.id
  const loadEvents = useCallback(async () => {
    if (!id) return
    setEventsError('')
    try { setEvents(await listHandoverEvents(id)) } catch (err) { setEvents([]); setEventsError(toUserMessage(err, 'Could not load the history.')) }
  }, [id])
  useEffect(() => { loadEvents() }, [loadEvents])

  if (!handover) return null
  if (!hasAuthorizationColumns(handover)) {
    return (
      <section className="vh-auth" data-testid="handover-auth-panel">
        <p className="vh-note">{signingSummary(handover).text}. Two driver signatures and the location are available once the handover update is installed.</p>
      </section>
    )
  }

  const ladder = signatureLadder(handover)
  const due = nextPartyToSign(handover)
  const frozen = isFrozen(handover)
  const dueRung = ladder.find((r) => r.party === due)
  const dueName = dueRung?.driverName || ''
  const canCollect = due && ['draft', 'pending_supervisor', null, undefined].includes(handover.approval_status)
  const mode = due ? rowSigningMode(handover, due, myDriverId, myUserId) : null
  const sentBack = isSentBack(handover)

  async function collect() {
    if (!sig) { setFeedback({ kind: 'error', text: 'Draw the signature first.' }); return }
    if (mode === SIGN_ON_BEHALF && !behalfOk) { setFeedback({ kind: 'error', text: 'Confirm that you are signing on behalf of this person.' }); return }
    setBusy(true); setFeedback(null)
    try {
      const reading = await captureLocation()
      await signHandover(handover.id, due, { signature: sig, name: dueName || null, location: locationArgs(reading), onBehalf: mode === SIGN_ON_BEHALF })
      setSig(null); setPadKey((k) => k + 1); setBehalfOk(false)
      setFeedback({ kind: 'success', text: due === 'receiving' ? 'Signed. The handover is locked and sent for sign-off.' : 'Signed. The receiving driver signs next.' })
      await loadEvents()
      onSigned?.()
    } catch (err) {
      setFeedback({ kind: 'error', text: toUserMessage(err, 'Could not record the signature.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="vh-auth" data-testid="handover-auth-panel">
      <div className="vh-signoff-head">
        <span className="vh-signoff-title"><PenLine size={14} aria-hidden="true" /> Driver signatures</span>
        {frozen
          ? <span className="cc-pill good" data-testid="handover-locked"><Lock size={11} aria-hidden="true" /> Locked</span>
          : <span className="cc-pill warn">Editable until signed</span>}
      </div>
      {frozen && <p className="vh-hint">This handover has been signed. Damage, readings, photos and signatures can no longer be changed.</p>}
      {sentBack && !frozen && (
        <p className="vh-signoff-note bad" data-testid="handover-sent-back">
          <AlertTriangle size={14} aria-hidden="true" /> Sent back for correction{handover.review_note ? `: ${handover.review_note}` : ''}. The earlier signatures were cleared. Correct the handover, then collect both signatures again.
        </p>
      )}

      <div className="vh-auth-sigs">
        {ladder.map((r) => (
          <div key={r.party} className="vh-auth-sig">
            <span className="vh-view-label">{PARTY_LABEL[r.party]}</span>
            {r.signed ? (
              <>
                <SignatureView value={r.signature} label={null} name={null} height={70} />
                <small>{r.name || r.driverName || 'Unnamed'}, signed {fmtWhen(r.at)} (server time){r.onBehalf ? '. Signed on their behalf by a supervisor' : ''}</small>
              </>
            ) : (
              <small className="cc-na">{r.driverName ? `${r.driverName}, not signed yet` : 'Not signed yet'}</small>
            )}
          </div>
        ))}
      </div>

      <div className="vh-view-section">
        <span className="vh-view-label">Location</span>
        <HandoverLocation location={rowLocation(handover)} status={handover.location_status} label={handover.asset_no || 'Handover'} />
      </div>

      {canCollect && mode === SIGN_BLOCKED && (
        <p className="vh-note" data-testid="handover-sign-blocked">You are the other driver on this handover, so this signature must be given by {dueName || 'the driver'} or collected by a supervisor.</p>
      )}
      {canCollect && mode === SIGN_OTHER_ACCOUNT && (
        <p className="vh-note" data-testid="handover-sign-other-account">You gave the handing signature, and one account cannot give both. {dueName || 'The receiving driver'} signs with their own account, or a different supervisor signs on their behalf.</p>
      )}
      {canCollect && mode !== SIGN_BLOCKED && mode !== SIGN_OTHER_ACCOUNT && (
        <div className="vh-signoff-act">
          <p className="vh-signoff-hint">{PARTY_LABEL[due]}: {dueName || 'the driver'} signs here. The time and your account are recorded by the server.</p>
          <SignatureCapture key={padKey} label={`${PARTY_LABEL[due]} signature`} onChange={setSig} height={140} />
          {mode === SIGN_ON_BEHALF && (
            <label className="vh-check" data-testid="handover-on-behalf">
              <input type="checkbox" checked={behalfOk} onChange={(e) => setBehalfOk(e.target.checked)} /> {onBehalfPrompt(dueName)}. This is recorded on the handover. Only a supervisor may do this.
            </label>
          )}
          <div className="vh-signoff-btns">
            <button type="button" className="cc-btn-primary" onClick={collect} disabled={busy || !sig || (mode === SIGN_ON_BEHALF && !behalfOk)}>
              {busy ? <Loader2 size={14} className="vh-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />} Record signature
            </button>
          </div>
        </div>
      )}
      {feedback && (
        <p className={`vh-signoff-msg ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
          {feedback.kind === 'error' ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />} {feedback.text}
        </p>
      )}

      <div className="vh-view-section">
        <span className="vh-view-label"><History size={13} aria-hidden="true" /> History</span>
        {events == null ? <p className="vh-note">Loading history...</p> : eventsError ? (
          <p className="vh-error" role="alert">{eventsError}</p>
        ) : events.length === 0 ? <p className="vh-note">No history recorded.</p> : (
          <ol className="vh-auth-trail">
            {events.map((ev) => (
              <li key={ev.id}>
                <b>{eventLabel(ev.action)}</b> <small>{fmtWhen(ev.at)}{ev.actor_name ? `, ${ev.actor_name}` : ''}</small>
                {eventFields(ev).length > 0 && <small className="vh-hint"> Changed: {eventFields(ev).join(', ').replace(/_/g, ' ')}</small>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
