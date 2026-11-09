import { useState } from 'react'
import { availableActions, TRANSITIONS, BLOCK_REASONS, BLOCK_REASON_LABELS } from '../../lib/workforceTransitions'

/**
 * Status actions for one workforce assignment. Buttons come from the shared transition table;
 * the database function remains the authority. Actions that need a note (block, return, cancel)
 * open an inline note field first, so a reason is never skipped.
 */
export default function AssignmentActions({ item, currentUserId, isManager, disabled = false, onAct }) {
  const [pending, setPending] = useState(null)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const actions = availableActions(item.status, { isAssignee: item.assigned_to === currentUserId, isManager })
  if (!actions.length) return <span className="text-xs text-[var(--text-muted)]">No action available</span>

  if (pending) {
    const label = TRANSITIONS[pending].label
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={e => {
          e.preventDefault()
          if (!note.trim() || (pending === 'block' && !reason)) return
          onAct(item, pending, note.trim(), pending === 'block' ? reason : null)
          setPending(null)
          setNote('')
          setReason('')
        }}
      >
        {pending === 'block' && (
          <select aria-label="Blocker cause" className="input" required value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">Cause</option>
            {BLOCK_REASONS.map(r => <option key={r} value={r}>{BLOCK_REASON_LABELS[r]}</option>)}
          </select>
        )}
        <label className="sr-only" htmlFor={`note-${item.id}`}>{label} reason</label>
        <input
          id={`note-${item.id}`}
          className="input"
          autoFocus
          required
          maxLength={2000}
          placeholder={`${label}: reason`}
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        <button className="btn-primary" type="submit" disabled={disabled || !note.trim() || (pending === 'block' && !reason)}>{label}</button>
        <button className="btn-secondary" type="button" onClick={() => { setPending(null); setNote(''); setReason('') }}>Back</button>
      </form>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(key => (
        <button
          key={key}
          type="button"
          className="btn-secondary"
          disabled={disabled}
          onClick={() => (TRANSITIONS[key].noteRequired ? setPending(key) : onAct(item, key, null))}
        >
          {TRANSITIONS[key].label}
        </button>
      ))}
    </div>
  )
}
