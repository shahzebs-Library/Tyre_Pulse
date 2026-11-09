import { useState } from 'react'
import { availableActions, TRANSITIONS, BLOCK_REASONS, blockReasonLabel, transitionLabel } from '../../lib/workforceTransitions'
import { useLanguage } from '../../contexts/LanguageContext'

/**
 * Status actions for one workforce assignment. Buttons come from the shared transition table;
 * the database function remains the authority. Actions that need a note (block, return, cancel)
 * open an inline note field first, so a reason is never skipped. Verify also opens the field, with the
 * note optional: a task whose type requires technical review is refused by the server without one.
 */
const OPTIONAL_NOTE = new Set(['verify'])
export default function AssignmentActions({ item, currentUserId, isManager, disabled = false, onAct }) {
  const { t } = useLanguage()
  const [pending, setPending] = useState(null)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const actions = availableActions(item.status, { isAssignee: item.assigned_to === currentUserId, isManager })
  if (!actions.length) return <span className="text-xs text-[var(--text-muted)]">{t('workforce.actions.noAction')}</span>

  if (pending) {
    const label = transitionLabel(pending, t)
    const optional = OPTIONAL_NOTE.has(pending)
    const blocked = (!optional && !note.trim()) || (pending === 'block' && !reason)
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={e => {
          e.preventDefault()
          if (blocked) return
          onAct(item, pending, note.trim() || null, pending === 'block' ? reason : null)
          setPending(null)
          setNote('')
          setReason('')
        }}
      >
        {pending === 'block' && (
          <select aria-label={t('workforce.actions.causeLabel')} className="input" required value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">{t('workforce.actions.cause')}</option>
            {BLOCK_REASONS.map(r => <option key={r} value={r}>{blockReasonLabel(r, t)}</option>)}
          </select>
        )}
        <label className="sr-only" htmlFor={`note-${item.id}`}>{t('workforce.actions.noteLabel', { action: label })}</label>
        <input
          id={`note-${item.id}`}
          className="input"
          autoFocus
          required={!optional}
          maxLength={2000}
          placeholder={optional ? t('workforce.actions.reviewPlaceholder', { action: label }) : t('workforce.actions.reasonPlaceholder', { action: label })}
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        <button className="btn-primary" type="submit" disabled={disabled || blocked}>{label}</button>
        <button className="btn-secondary" type="button" onClick={() => { setPending(null); setNote(''); setReason('') }}>{t('workforce.actions.back')}</button>
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
          onClick={() => (TRANSITIONS[key].noteRequired || OPTIONAL_NOTE.has(key) ? setPending(key) : onAct(item, key, null))}
        >
          {transitionLabel(key, t)}
        </button>
      ))}
    </div>
  )
}
