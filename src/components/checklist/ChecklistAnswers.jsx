import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Image as ImageIcon } from 'lucide-react'
import { getSubmission } from '../../lib/api/checklists'
import { submissionRows, submissionSummary, prettyStatus } from '../../lib/checklistView'
import { safeImageSrc } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'

/**
 * What an inspector actually recorded, rendered wherever someone needs to read it.
 *
 * There is one of these because there is one answer to "what does this checklist
 * say". The full page, the quick viewer and the approval drawer all render this,
 * so a reviewer approving a checklist and a manager reading it later cannot be
 * shown different things.
 *
 * Pass a loaded `submission`, or a `submissionId` to fetch one. Fetching goes
 * through getSubmission because that is what signs the photo URLs and attaches
 * the template field labels - the raw row on its own is a map of field ids.
 *
 * @param {object}  props
 * @param {object}  [props.submission]     already-loaded row
 * @param {string}  [props.submissionId]   id to load when no row is supplied
 * @param {boolean} [props.showSummary]    headline tiles (default true)
 * @param {Function}[props.onLoaded]       called with the loaded row
 */
export default function ChecklistAnswers({
  submission, submissionId, showSummary = true, onLoaded,
}) {
  const [fetched, setFetched] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const needsFetch = !submission && !!submissionId

  useEffect(() => {
    if (!needsFetch) { setFetched(null); setError(''); return undefined }
    let cancelled = false
    setLoading(true); setError(''); setFetched(null)
    getSubmission(submissionId)
      .then((row) => {
        if (cancelled) return
        if (!row) { setError('That checklist could not be found.'); return }
        setFetched(row)
        onLoaded?.(row)
      })
      .catch((err) => { if (!cancelled) setError(toUserMessage(err, 'Could not open the checklist.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // onLoaded is deliberately not a dependency: a caller passing an inline
    // arrow would otherwise refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFetch, submissionId])

  const sub = submission || fetched
  const rows = useMemo(() => (sub ? submissionRows(sub) : []), [sub])
  const summary = useMemo(() => submissionSummary(sub), [sub])

  if (loading) {
    return (
      <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        Opening the checklist...
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="text-sm rounded-lg px-3 py-2 flex items-center gap-2"
        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
      >
        <AlertTriangle className="w-4 h-4" /> {error}
      </div>
    )
  }

  if (!sub) return null

  return (
    <>
      {showSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            ['Status', prettyStatus(sub.approval_status || sub.status)],
            ['Points recorded', summary.points],
            ['With a photo', summary.withPhotos],
            ['Score', summary.score == null ? 'Not scored' : `${summary.score}%`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg p-3" style={{ background: 'var(--panel-2)' }}>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
              <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {value == null ? '-' : value}
              </div>
            </div>
          ))}
        </div>
      )}

      {!rows.length ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          This checklist was submitted without any answers recorded.
        </div>
      ) : (
        <div className="space-y-0">
          {rows.map((r) => (
            <div
              key={r.id}
              className="py-2.5 flex items-start justify-between gap-4"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <div className="text-sm min-w-0" style={{ color: 'var(--text-secondary)' }}>
                {r.label}
              </div>
              <div className="text-sm text-right min-w-0" style={{ color: 'var(--text-primary)' }}>
                {/* A recorded answer of "no" is a finding, so it is never collapsed
                    into a blank. Only a genuinely absent answer reads as not
                    recorded. */}
                {r.text ?? <span style={{ color: 'var(--text-dim)' }}>Not recorded</span>}
                {r.photos.length > 0 && (
                  <div className="flex flex-wrap gap-2 justify-end mt-2">
                    {r.photos.map((p, i) => {
                      const src = safeImageSrc(p)
                      return src ? (
                        <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                          <img
                            src={src}
                            alt={`${r.label} photo ${i + 1}`}
                            className="w-16 h-16 object-cover rounded"
                            style={{ border: '1px solid var(--border-subtle)' }}
                          />
                        </a>
                      ) : (
                        <span
                          key={i}
                          className="text-xs inline-flex items-center gap-1"
                          style={{ color: 'var(--text-dim)' }}
                        >
                          <ImageIcon className="w-3 h-3" /> photo unavailable
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {sub.review_note && (
        <div className="mt-5 rounded-lg p-3" style={{ background: 'var(--panel-2)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
            Reviewer note{sub.approver_name ? ` from ${sub.approver_name}` : ''}
          </div>
          <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>
            {sub.review_note}
          </div>
        </div>
      )}

      {sub.signature_data && (
        <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
            Signed by {sub.printed_name || 'the inspector'}
          </div>
          <img
            src={safeImageSrc(sub.signature_data) || undefined}
            alt="Signature"
            className="max-h-24 rounded"
            style={{ background: '#fff', padding: 6 }}
          />
        </div>
      )}
    </>
  )
}
