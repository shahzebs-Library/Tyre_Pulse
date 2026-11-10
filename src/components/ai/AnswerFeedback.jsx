/**
 * AnswerFeedback - thumbs up/down under one AI Command Center answer, with an
 * optional "what was wrong / correct answer" form on thumbs down.
 *
 * Writes to ai_feedback through src/lib/api/aiFeedback.js. Feedback is stored
 * for expert review and offline evaluation only; it does not retrain or
 * change the assistant.
 */
import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Check, Loader2 } from 'lucide-react'
import { submitAnswerFeedback, FEEDBACK_CATEGORIES } from '../../lib/api/aiFeedback'
import { toUserMessage } from '../../lib/safeError'

const BTN = 'flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded'

export default function AnswerFeedback({ message, submit = submitAnswerFeedback }) {
  const [verdict, setVerdict] = useState(null)     // saved verdict
  const [open, setOpen] = useState(false)           // thumbs-down form
  const [category, setCategory] = useState('')
  const [expected, setExpected] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!message?.dbMessageId) return null

  async function save(v, extra = {}) {
    setSaving(true); setError('')
    try {
      await submit({
        assistantMessageId: message.dbMessageId,
        conversationId: message.conversationId,
        verdict: v,
        agents: message.agents,
        agent: message.agentType,
        grounded: message.grounded,
        coverage: message.rawCoverage,
        promptVersion: message.promptVersion,
        ...extra,
      })
      setVerdict(v); setOpen(false)
    } catch (err) {
      setError(toUserMessage(err, 'Your feedback could not be saved. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2" role="group" aria-label="Rate this answer">
        <button
          type="button" className={BTN} disabled={saving}
          aria-pressed={verdict === 'up'} aria-label="Helpful answer"
          onClick={() => save('up')}
        >
          {verdict === 'up' ? <Check className="w-3 h-3 text-emerald-400" /> : <ThumbsUp className="w-3 h-3" />}
          Helpful
        </button>
        <button
          type="button" className={BTN} disabled={saving}
          aria-pressed={verdict === 'down'} aria-expanded={open} aria-label="Not helpful answer"
          onClick={() => setOpen((o) => !o)}
        >
          {verdict === 'down' ? <Check className="w-3 h-3 text-amber-400" /> : <ThumbsDown className="w-3 h-3" />}
          Not helpful
        </button>
        {saving && <Loader2 className="w-3 h-3 animate-spin text-[var(--text-muted)]" aria-label="Saving" />}
        {verdict && !saving && <span className="text-xs text-[var(--text-dim)]" aria-live="polite">Thanks, recorded for review.</span>}
      </div>

      {open && (
        <form
          className="mt-1 space-y-2 rounded-lg border border-[var(--input-border)] bg-[var(--surface-1)] p-3 max-w-xl"
          onSubmit={(e) => { e.preventDefault(); save('down', { category, expectedAnswer: expected, note }) }}
        >
          <label className="block text-xs text-[var(--text-secondary)]">
            What was wrong?
            <select className="input w-full mt-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Choose (optional)</option>
              {FEEDBACK_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="block text-xs text-[var(--text-secondary)]">
            Correct answer (optional)
            <textarea className="input w-full mt-1 text-sm min-h-[60px] resize-y" maxLength={8000} value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="What the answer should have said" />
          </label>
          <label className="block text-xs text-[var(--text-secondary)]">
            Note (optional)
            <textarea className="input w-full mt-1 text-sm min-h-[44px] resize-y" maxLength={8000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="text-[11px] text-[var(--text-dim)]">Feedback is reviewed by an expert before it is used to test future versions. It does not change the assistant directly.</p>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn-primary text-xs px-3 py-1.5" disabled={saving}>Send feedback</button>
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" disabled={saving} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
