import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, CornerUpLeft, FileWarning, History, Loader2, Send, X } from 'lucide-react'
import {
  getActionReviewAccess, getActionReview, listActionReviewEvents,
  submitCompletion, reviewAction, recordException, recordProgress,
} from '../../lib/api/closureReview'
import { reviewLabel, completionProblem, MAX_PHOTOS } from '../../lib/closureWorkflow'
import { safeImageSrc } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'
import { formatDate } from '../../lib/formatters'

const TONE = {
  good: 'text-green-400 border-green-500/40 bg-green-500/10',
  warn: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  bad: 'text-red-400 border-red-500/40 bg-red-500/10',
  muted: 'text-[var(--text-secondary)] border-[var(--border)] bg-[var(--surface-2)]',
}
const EVENT_TEXT = {
  progress: 'Progress recorded', submitted: 'Completion submitted for review', returned: 'Returned for correction',
  approved: 'Closure approved', exception: 'Closed by documented exception',
  direct_closed: 'Closed directly by a reviewer', reopened: 'Reopened',
}
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const btn = `inline-flex items-center justify-center gap-2 px-3 min-h-[40px] rounded-lg text-sm font-medium border disabled:opacity-50 ${FOCUS}`
const area = 'w-full rounded-lg px-3 py-2 text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)]'

/** Shrink a photograph in the browser so evidence stays small enough to store with the action. */
function shrinkPhoto(file, maxSide = 1280, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photograph.')) }
    img.src = url
  })
}

function Photos({ list, onRemove }) {
  const safe = (Array.isArray(list) ? list : []).map(safeImageSrc).filter(Boolean)
  if (!safe.length) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {safe.map((src, i) => (
        <li key={i} className="relative">
          <img src={src} alt={`Completion evidence ${i + 1}`} className="h-20 w-20 object-cover rounded-lg border border-[var(--border)]" />
          {onRemove && (
            <button type="button" onClick={() => onRemove(i)} aria-label={`Remove photograph ${i + 1}`}
              className={`absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[var(--surface-1)] border border-[var(--border)] inline-flex items-center justify-center ${FOCUS}`}>
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * The closure review loop for ONE corrective action, shown where the action is
 * opened: the assigned worker submits completion evidence, a reviewer approves
 * the closure or returns it with a comment, an authorised role may record a
 * documented exception. Every button calls a database function that re-checks
 * role, company, country and site; this panel only decides what to OFFER.
 *
 * Renders nothing until the review drafts are applied to the database, so the
 * page behaves exactly as before on a system that does not have them yet.
 */
export default function ClosureReviewPanel({ action, onChanged }) {
  const [state, setState] = useState({ loading: true, provisioned: true, access: null, review: null, events: [] })
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState([])
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')
  const [showException, setShowException] = useState(false)
  const [busy, setBusy] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const fileRef = useRef(null)
  const id = action?.id

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [access, review, events] = await Promise.all([
        getActionReviewAccess(id), getActionReview(id), listActionReviewEvents(id),
      ])
      setState({ loading: false, provisioned: access.provisioned && review.provisioned, access, review: review.review, events })
    } catch (err) {
      setState((s) => ({ ...s, loading: false }))
      setFeedback({ ok: false, text: toUserMessage(err, 'Could not load the review details.') })
    }
  }, [id])
  useEffect(() => { load() }, [load])

  if (!id || !state.provisioned) return null
  if (state.loading) {
    return <p className="text-xs text-[var(--text-muted)] flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading review details</p>
  }

  const access = state.access || {}
  const merged = { ...action, ...(state.review || {}) }
  const label = reviewLabel(merged)
  const problem = completionProblem({ note, photos }, { minPhotos: access.minPhotos })

  async function run(key, fn, done) {
    setBusy(key); setFeedback(null)
    try {
      await fn()
      setFeedback({ ok: true, text: done })
      setNote(''); setPhotos([]); setComment(''); setReason(''); setShowException(false)
      await load()
      onChanged?.()
    } catch (err) {
      setFeedback({ ok: false, text: toUserMessage(err, 'That could not be saved.') })
    } finally { setBusy(null) }
  }

  async function addPhotos(e) {
    const files = [...(e.target.files || [])].slice(0, MAX_PHOTOS - photos.length)
    e.target.value = ''
    try {
      const shrunk = await Promise.all(files.map((f) => shrinkPhoto(f)))
      setPhotos((p) => [...p, ...shrunk].slice(0, MAX_PHOTOS))
    } catch (err) { setFeedback({ ok: false, text: toUserMessage(err, 'That photograph could not be read.') }) }
  }

  return (
    <section className="rounded-xl border border-[var(--border)] p-4 space-y-3 mb-4" data-testid="closure-review-panel" aria-label="Closure review">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Closure review</h3>
        {label && <span className={`text-xs px-2 py-1 rounded-md border ${TONE[label.tone]}`}>{label.text}</span>}
      </div>

      {feedback && <p role={feedback.ok ? 'status' : 'alert'} className={`text-sm ${feedback.ok ? 'text-green-400' : 'text-red-400'}`}>{feedback.text}</p>}

      {merged.completion_note && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)]">Completion submitted {merged.submitted_at ? formatDate(merged.submitted_at) : ''}</p>
          <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{merged.completion_note}</p>
          <Photos list={merged.completion_photos} />
        </div>
      )}
      {merged.review_status === 'returned' && merged.review_comment && (
        <p className="text-sm text-red-300"><span className="font-medium">Reviewer asked for a correction:</span> {merged.review_comment}</p>
      )}
      {merged.review_status === 'exception' && merged.review_comment && (
        <p className="text-sm text-[var(--text-secondary)]"><span className="font-medium">Exception reason:</span> {merged.review_comment}</p>
      )}

      {access.canSubmit && (
        <div className="space-y-2">
          <label className="block text-xs text-[var(--text-secondary)]" htmlFor="ca-completion-note">What was done</label>
          <textarea id="ca-completion-note" rows={3} className={area} value={note} onChange={(e) => setNote(e.target.value)} />
          <Photos list={photos} onRemove={(i) => setPhotos((p) => p.filter((_, x) => x !== i))} />
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
            <button type="button" className={`${btn} border-[var(--border)] text-[var(--text-secondary)]`} disabled={photos.length >= MAX_PHOTOS} onClick={() => fileRef.current?.click()}>
              <Camera size={14} aria-hidden="true" /> Add photograph
            </button>
            <button type="button" className={`${btn} border-[var(--border)] text-[var(--text-secondary)]`} disabled={!!busy || note.trim().length < 3}
              onClick={() => run('progress', () => recordProgress(id, note, photos), 'Update saved.')}>
              {busy === 'progress' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null} Save as progress
            </button>
            <button type="button" className={`${btn} border-[var(--accent)] text-[var(--accent)]`} disabled={!!busy || !!problem} title={problem || undefined}
              onClick={() => run('submit', () => submitCompletion(id, { note, photos }, { minPhotos: access.minPhotos }), 'Submitted. A reviewer will approve the closure or return it.')}>
              {busy === 'submit' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Submit for review
            </button>
          </div>
          {problem && note.length > 0 && <p className="text-xs text-amber-400">{problem}</p>}
          <p className="text-xs text-[var(--text-muted)]">Submitting does not close the action. A reviewer closes it.</p>
        </div>
      )}

      {access.selfReviewBlocked && (
        <p className="text-sm text-amber-400">You submitted this action, so another reviewer has to decide it.</p>
      )}

      {access.canReview && (
        <div className="space-y-2">
          <label className="block text-xs text-[var(--text-secondary)]" htmlFor="ca-review-comment">Review comment (required when returning)</label>
          <textarea id="ca-review-comment" rows={2} className={area} value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex gap-2 flex-wrap">
            <button type="button" className={`${btn} border-red-700/50 text-red-300`} disabled={!!busy || comment.trim().length < 5}
              onClick={() => run('return', () => reviewAction(id, 'return', comment), 'Returned to the worker for correction.')}>
              {busy === 'return' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CornerUpLeft size={14} aria-hidden="true" />} Return for correction
            </button>
            <button type="button" className={`${btn} border-green-600/60 text-green-300`} disabled={!!busy}
              onClick={() => run('approve', () => reviewAction(id, 'approve', comment), 'Closure approved. The action is closed.')}>
              {busy === 'approve' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />} Approve closure
            </button>
          </div>
        </div>
      )}

      {access.canException && (
        showException ? (
          <div className="space-y-2">
            <label className="block text-xs text-[var(--text-secondary)]" htmlFor="ca-exception-reason">Reason for closing without a verified fix</label>
            <textarea id="ca-exception-reason" rows={2} className={area} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" className={`${btn} border-[var(--border)] text-[var(--text-secondary)]`} onClick={() => setShowException(false)}>Cancel</button>
              <button type="button" className={`${btn} border-amber-600/60 text-amber-300`} disabled={!!busy || reason.trim().length < 10}
                onClick={() => run('exception', () => recordException(id, reason), 'Exception recorded. The action is closed as an exception.')}>
                {busy === 'exception' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <FileWarning size={14} aria-hidden="true" />} Record exception
              </button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">Your name, the time and this reason are kept permanently with the action.</p>
          </div>
        ) : (
          <button type="button" className={`text-xs underline text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`} onClick={() => setShowException(true)}>
            Close with a documented exception instead
          </button>
        )
      )}

      {state.events.length > 0 && (
        <details>
          <summary className={`text-xs text-[var(--text-secondary)] cursor-pointer inline-flex items-center gap-1.5 ${FOCUS}`}>
            <History size={12} aria-hidden="true" /> Review history ({state.events.length})
          </summary>
          <ol className="mt-2 space-y-1.5">
            {state.events.map((e) => (
              <li key={e.id} className="text-xs text-[var(--text-secondary)]">
                <span className="text-[var(--text-primary)]">{EVENT_TEXT[e.event_type] || e.event_type}</span>
                {' '}on {formatDate(e.created_at)}{e.actor_role ? ` by a ${e.actor_role}` : ''}
                {e.note ? <span className="block text-[var(--text-muted)] whitespace-pre-wrap">{e.note}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}
