import { useState } from 'react'
import { toUserMessage } from '../../lib/safeError'
import { reviewSerialReading } from '../../lib/api/aiTyreSerial'
import { SERIAL_OUTCOME_LABEL, SERIAL_DECISIONS, serialReviewState, serialSummary, decisionNeedsSerial } from '../../lib/aiTyreSerial'

/**
 * DRAFT serial-number result for ONE AI job, shown inside the existing AI photo review card.
 * Renders nothing when there is no reading (feature off / migration not applied), so today's
 * review screen is unchanged. A decision is recorded only; it never edits the tyre register.
 */
export default function SerialReviewBlock({ reading, events, mayReview, onDecided }) {
  const [decision, setDecision] = useState('')
  const [serial, setSerial] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  if (!reading) return null
  const state = serialReviewState(reading, events)
  const tone = reading.outcome === 'match' ? 'border-emerald-500' : state.pending ? 'border-amber-500' : 'border-[var(--border-dim)]'
  const save = async () => {
    setSaving(true); setError('')
    try { await reviewSerialReading(reading.id, decision, decisionNeedsSerial(decision) ? serial.trim() : null, note.trim()); setDecision(''); setSerial(''); setNote(''); await onDecided?.() }
    catch (e) { setError(toUserMessage(e, 'Could not save the serial decision')) }
    finally { setSaving(false) }
  }
  const canSave = decision && note.trim().length >= 3 && (!decisionNeedsSerial(decision) || serial.trim())
  return (
    <div className={'mt-3 border-l-2 pl-3 text-sm ' + tone} data-testid="serial-review">
      <p className="font-semibold">Serial number (pilot)</p>
      <p>{serialSummary(reading)}</p>
      <p className="text-xs text-[var(--text-secondary)]">{SERIAL_OUTCOME_LABEL[reading.outcome] || reading.outcome}
        {reading.registered_serials?.length ? ` | Registered: ${reading.registered_serials.join(', ')}` : ''}
        {reading.canonical_position ? ` | Wheel ${reading.canonical_position}` : ''}</p>
      {state.latest && <p className="text-xs text-[var(--text-muted)] mt-1">Decided: {(SERIAL_DECISIONS.find(([k]) => k === state.latest.decision) || [, state.latest.decision])[1]}. {state.latest.note}</p>}
      {state.pending && !mayReview && <p className="text-xs text-amber-500 mt-1">Waiting for a supervisor to check this serial.</p>}
      {state.pending && mayReview && <div className="mt-2 space-y-2">
        <label className="block text-xs text-[var(--text-secondary)]">Serial decision
          <select className="input w-full mt-1" value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value="">Choose</option>
            {SERIAL_DECISIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select></label>
        {decisionNeedsSerial(decision) && <label className="block text-xs text-[var(--text-secondary)]">Serial you can see in the photo
          <input className="input w-full mt-1" maxLength={40} value={serial} onChange={(e) => setSerial(e.target.value)} /></label>}
        <label className="block text-xs text-[var(--text-secondary)]">Reason
          <textarea className="input block w-full mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn-secondary" disabled={!canSave || saving} onClick={save}>Record serial decision</button>
        <p className="text-xs text-[var(--text-muted)]">Recording a decision does not change the tyre register. Correct the tyre record separately if needed.</p>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>}
    </div>
  )
}
