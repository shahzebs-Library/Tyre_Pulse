import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, CornerUpLeft, FileWarning, History, Loader2, Send, X, XCircle } from 'lucide-react'
import {
  getActionReviewAccess, getActionReview, listActionReviewEvents,
  submitCompletion, reviewAction, requestException, decideException, recordProgress,
} from '../../lib/api/closureReview'
import { reviewLabel, completionProblem, hasNoAction, MAX_PHOTOS } from '../../lib/closureWorkflow'
import { closureText } from '../../lib/closureText'
import { useLanguage } from '../../contexts/LanguageContext'
import { safeImageSrc } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'
import { formatDate } from '../../lib/formatters'

const TONE = {
  good: 'text-green-400 border-green-500/40 bg-green-500/10',
  warn: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  bad: 'text-red-400 border-red-500/40 bg-red-500/10',
  muted: 'text-[var(--text-secondary)] border-[var(--border)] bg-[var(--surface-2)]',
}
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const link = `inline-flex items-center min-h-[40px] text-xs underline text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`
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

function Photos({ list, onRemove, t }) {
  const safe = (Array.isArray(list) ? list : []).map(safeImageSrc).filter(Boolean)
  if (!safe.length) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {safe.map((src, i) => (
        <li key={i} className="relative">
          <img src={src} alt={t('closure.review.photoAlt', { n: i + 1 })} className="h-20 w-20 object-cover rounded-lg border border-[var(--border)]" />
          {onRemove && (
            <button type="button" onClick={() => onRemove(i)} aria-label={t('closure.review.removePhoto', { n: i + 1 })}
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
 * the closure or returns it with a comment. An exception is a REQUEST: asking
 * never closes the action, and a different authorised person approves or
 * refuses it. Every button calls a database function that re-checks role,
 * company, country and site; this panel only decides what to OFFER.
 *
 * Renders nothing until the review drafts are applied to the database, so the
 * page behaves exactly as before on a system that does not have them yet.
 */
export default function ClosureReviewPanel({ action, onChanged }) {
  const { t, language } = useLanguage()
  const [state, setState] = useState({ loading: true, provisioned: true, access: null, review: null, events: [] })
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState([])
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [showException, setShowException] = useState(false)
  const [excPhotos, setExcPhotos] = useState([])
  const [busy, setBusy] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const fileRef = useRef(null)
  const excFileRef = useRef(null)
  const id = action?.id
  const say = useCallback((err, fallbackKey) => closureText(t, toUserMessage(err, t(fallbackKey))), [t])

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [access, review, events] = await Promise.all([
        getActionReviewAccess(id), getActionReview(id), listActionReviewEvents(id),
      ])
      setState({ loading: false, provisioned: access.provisioned && review.provisioned, access, review: review.review, events })
    } catch (err) {
      setState((s) => ({ ...s, loading: false }))
      setFeedback({ ok: false, text: say(err, 'closure.review.loadFailed') })
    }
  }, [id, say])
  useEffect(() => { load() }, [load])

  if (!id || !state.provisioned) return null
  if (state.loading) {
    return <p className="text-xs text-[var(--text-muted)] flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> {t('closure.review.loading')}</p>
  }

  const access = state.access || {}
  const merged = { ...action, ...(state.review || {}) }
  const label = reviewLabel(merged)
  const problem = completionProblem({ note, photos }, { minPhotos: access.minPhotos })
  const storedPhotos = Array.isArray(merged.completion_photos) ? merged.completion_photos.length : 0
  const idle = hasNoAction(access)
  const timeOf = (iso) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(language === 'ar' ? 'ar' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  const who = (e) => {
    const vars = { date: formatDate(e.created_at), time: timeOf(e.created_at), name: e.actor_name, role: e.actor_role }
    if (e.actor_name && e.actor_role) return t('closure.review.historyByNameRole', vars)
    if (e.actor_name) return t('closure.review.historyByName', vars)
    if (e.actor_role) return t('closure.review.historyByRole', vars)
    return t('closure.review.historyOn', vars)
  }

  async function run(key, fn, done) {
    setBusy(key); setFeedback(null)
    try {
      await fn()
      setFeedback({ ok: true, text: done })
      setNote(''); setPhotos([]); setComment(''); setReason(''); setDecisionNote(''); setShowException(false); setExcPhotos([])
      await load()
      onChanged?.()
    } catch (err) {
      setFeedback({ ok: false, text: say(err, 'closure.review.saveFailed') })
    } finally { setBusy(null) }
  }

  async function addPhotos(e, current = photos, setList = setPhotos) {
    const files = [...(e.target.files || [])].slice(0, MAX_PHOTOS - current.length)
    e.target.value = ''
    try {
      const shrunk = await Promise.all(files.map((f) => shrinkPhoto(f)))
      setList((p) => [...p, ...shrunk].slice(0, MAX_PHOTOS))
    } catch (err) { setFeedback({ ok: false, text: say(err, 'closure.review.photoFailed') }) }
  }

  // Someone with nothing to do here, on an action that has never been in review, sees no box at all.
  if (idle && !label && !merged.completion_note && state.events.length === 0 && !feedback) return null

  const spin = (key, Icon) => (busy === key
    ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
    : Icon ? <Icon size={14} aria-hidden="true" /> : null)

  return (
    <section className="rounded-xl border border-[var(--border)] p-4 space-y-3 mb-4" data-testid="closure-review-panel" aria-label={t('closure.review.title')}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{t('closure.review.title')}</h3>
        {label && <span className={`text-xs px-2 py-1 rounded-md border ${TONE[label.tone]}`}>{closureText(t, label.text)}</span>}
      </div>

      {feedback && <p role={feedback.ok ? 'status' : 'alert'} className={`text-sm ${feedback.ok ? 'text-green-400' : 'text-red-400'}`}>{feedback.text}</p>}

      {merged.completion_note && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)]">{t('closure.review.completionSubmitted', { date: merged.submitted_at ? formatDate(merged.submitted_at) : '' })}</p>
          <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{merged.completion_note}</p>
          <Photos list={merged.completion_photos} t={t} />
        </div>
      )}
      {merged.review_status === 'returned' && merged.review_comment && (
        <p className="text-sm text-red-300"><span className="font-medium">{t('closure.review.returnedLabel')}</span> {merged.review_comment}</p>
      )}
      {merged.review_status === 'exception_requested' && merged.exception_reason && (
        <p className="text-sm text-amber-300">
          <span className="font-medium">{t('closure.review.exceptionRequestedOn', { date: merged.exception_requested_at ? formatDate(merged.exception_requested_at) : '' })}</span> {merged.exception_reason}
          {Array.isArray(merged.exception_evidence) && merged.exception_evidence.length > 0 && (
            <span className="block mt-2" data-testid="exception-evidence">
              <span className="block text-xs text-[var(--text-muted)] mb-1">{t('closure.review.exceptionEvidence')}</span>
              <Photos list={merged.exception_evidence} t={t} />
            </span>
          )}
        </p>
      )}
      {merged.review_status === 'exception' && merged.review_comment && (
        <p className="text-sm text-[var(--text-secondary)]"><span className="font-medium">{t('closure.review.exceptionReason')}</span> {merged.review_comment}</p>
      )}

      {access.canSubmit && (
        <div className="space-y-2">
          <label className="block text-xs text-[var(--text-secondary)]" htmlFor="ca-completion-note">{t('closure.review.whatWasDone')}</label>
          <textarea id="ca-completion-note" rows={3} className={area} value={note} onChange={(e) => setNote(e.target.value)} />
          <Photos list={photos} t={t} onRemove={(i) => setPhotos((p) => p.filter((_, x) => x !== i))} />
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
            <button type="button" className={`${btn} border-[var(--border)] text-[var(--text-secondary)]`} disabled={photos.length >= MAX_PHOTOS} onClick={() => fileRef.current?.click()}>
              <Camera size={14} aria-hidden="true" /> {t('closure.review.addPhoto')}
            </button>
            <button type="button" className={`${btn} border-[var(--border)] text-[var(--text-secondary)]`} disabled={!!busy || note.trim().length < 3}
              onClick={() => run('progress', () => recordProgress(id, note, photos), t('closure.review.done.progress'))}>
              {spin('progress')} {t('closure.review.saveProgress')}
            </button>
            <button type="button" className={`${btn} border-[var(--accent)] text-[var(--accent)]`} disabled={!!busy || !!problem} title={problem ? closureText(t, problem) : undefined}
              onClick={() => run('submit', () => submitCompletion(id, { note, photos }, { minPhotos: access.minPhotos }), t('closure.review.done.submitted'))}>
              {spin('submit', Send)} {t('closure.review.submit')}
            </button>
          </div>
          {problem && note.length > 0 && <p className="text-xs text-amber-400">{closureText(t, problem)}</p>}
          {merged.review_status === 'returned' && storedPhotos > 0 && (
            <p className="text-xs text-[var(--text-muted)]">{t('closure.review.keptPhotosHint')}</p>
          )}
          <p className="text-xs text-[var(--text-muted)]">{t('closure.review.submitHint')}</p>
        </div>
      )}

      {access.selfReviewBlocked && (
        <p className="text-sm text-amber-400">{t('closure.review.selfBlocked')}</p>
      )}

      {access.canReview && (
        <div className="space-y-2">
          <label className="block text-xs text-[var(--text-secondary)]" htmlFor="ca-review-comment">{t('closure.review.reviewComment')}</label>
          <textarea id="ca-review-comment" rows={2} className={area} value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex gap-2 flex-wrap">
            <button type="button" className={`${btn} border-red-700/50 text-red-300`} disabled={!!busy || comment.trim().length < 5}
              onClick={() => run('return', () => reviewAction(id, 'return', comment), t('closure.review.done.returned'))}>
              {spin('return', CornerUpLeft)} {t('closure.review.returnBtn')}
            </button>
            <button type="button" className={`${btn} border-green-600/60 text-green-300`} disabled={!!busy}
              onClick={() => run('approve', () => reviewAction(id, 'approve', comment), t('closure.review.done.approved'))}>
              {spin('approve', CheckCircle2)} {t('closure.review.approveBtn')}
            </button>
          </div>
        </div>
      )}

      {access.closeBlockedExceptionRequester && (
        <p className="text-sm text-amber-400" data-testid="exception-requester-close-blocked">{t('closure.review.closeBlockedExceptionRequester')}</p>
      )}

      {access.exceptionRequestedByMe && !access.exceptionSelfBlocked && (
        <p className="text-sm text-amber-400" data-testid="exception-requested-by-me">{t('closure.review.exceptionRequestedByMe')}</p>
      )}

      {access.exceptionSelfBlocked && (
        <p className="text-sm text-amber-400" data-testid="exception-self-blocked">{t('closure.review.exceptionSelfBlocked')}</p>
      )}

      {access.canDecideException && (
        <div className="space-y-2" data-testid="exception-decision">
          <label className="block text-xs text-[var(--text-secondary)]" htmlFor="ca-exception-decision">{t('closure.review.decideLabel')}</label>
          <textarea id="ca-exception-decision" rows={2} className={area} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
          <div className="flex gap-2 flex-wrap">
            <button type="button" className={`${btn} border-red-700/50 text-red-300`} disabled={!!busy || decisionNote.trim().length < 5}
              onClick={() => run('exc-refuse', () => decideException(id, 'refuse', decisionNote), t('closure.review.done.exceptionRefused'))}>
              {spin('exc-refuse', XCircle)} {t('closure.review.refuseException')}
            </button>
            <button type="button" className={`${btn} border-amber-600/60 text-amber-300`} disabled={!!busy}
              onClick={() => run('exc-approve', () => decideException(id, 'approve', decisionNote), t('closure.review.done.exceptionApproved'))}>
              {spin('exc-approve', FileWarning)} {t('closure.review.approveException')}
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">{t('closure.review.decideHint')}</p>
        </div>
      )}

      {access.canRequestException && (
        showException ? (
          <div className="space-y-2">
            <label className="block text-xs text-[var(--text-secondary)]" htmlFor="ca-exception-reason">{t('closure.review.requestReasonLabel')}</label>
            <textarea id="ca-exception-reason" rows={2} className={area} value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="text-xs text-[var(--text-secondary)]">{t('closure.review.exceptionEvidenceLabel')}</p>
            <Photos list={excPhotos} t={t} onRemove={(i) => setExcPhotos((p) => p.filter((_, x) => x !== i))} />
            <div className="flex gap-2 flex-wrap">
              <input ref={excFileRef} type="file" accept="image/*" multiple className="hidden" data-testid="exception-evidence-input"
                onChange={(e) => addPhotos(e, excPhotos, setExcPhotos)} />
              <button type="button" className={`${btn} border-[var(--border)] text-[var(--text-secondary)]`} disabled={excPhotos.length >= MAX_PHOTOS} onClick={() => excFileRef.current?.click()}>
                <Camera size={14} aria-hidden="true" /> {t('closure.review.addPhoto')}
              </button>
              <button type="button" className={`${btn} border-[var(--border)] text-[var(--text-secondary)]`} onClick={() => { setShowException(false); setExcPhotos([]) }}>{t('closure.review.cancel')}</button>
              <button type="button" className={`${btn} border-amber-600/60 text-amber-300`} disabled={!!busy || reason.trim().length < 10}
                onClick={() => run('exception', () => requestException(id, reason, excPhotos), t('closure.review.done.exceptionRequested'))}>
                {spin('exception', FileWarning)} {t('closure.review.requestBtn')}
              </button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">{t('closure.review.requestHint')}</p>
          </div>
        ) : (
          <button type="button" className={link} onClick={() => setShowException(true)}>
            {t('closure.review.requestLink')}
          </button>
        )
      )}

      {idle && merged.status !== 'Closed' && (
        <p className="text-sm text-[var(--text-secondary)]" data-testid="closure-waiting-on">
          {access.waitingOn === 'reviewer' ? t('closure.review.waitingReviewer')
            : access.waitingOn === 'exception_decider' ? t('closure.review.waitingException')
              : t('closure.review.waitingWorker')}
        </p>
      )}

      {state.events.length > 0 && (
        <details>
          <summary className={`text-xs text-[var(--text-secondary)] cursor-pointer inline-flex items-center gap-1.5 min-h-[40px] ${FOCUS}`}>
            <History size={12} aria-hidden="true" /> {t('closure.review.history', { count: state.events.length })}
          </summary>
          <ol className="mt-2 space-y-1.5">
            {state.events.map((e) => (
              <li key={e.id} className="text-xs text-[var(--text-secondary)]">
                <span className="text-[var(--text-primary)]">{eventText(t, e.event_type)}</span>
                {' '}{who(e)}
                {e.note ? <span className="block text-[var(--text-muted)] whitespace-pre-wrap">{e.note}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}

/** History line label. Literal keys so the dictionary check sees every one of them. */
function eventText(t, type) {
  switch (type) {
    case 'progress': return t('closure.review.event.progress')
    case 'submitted': return t('closure.review.event.submitted')
    case 'returned': return t('closure.review.event.returned')
    case 'approved': return t('closure.review.event.approved')
    case 'exception_requested': return t('closure.review.event.exception_requested')
    case 'exception_refused': return t('closure.review.event.exception_refused')
    case 'exception': return t('closure.review.event.exception')
    case 'direct_closed': return t('closure.review.event.direct_closed')
    case 'reopened': return t('closure.review.event.reopened')
    default: return String(type || '')
  }
}
