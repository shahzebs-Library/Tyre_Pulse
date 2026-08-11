import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, ExternalLink, Download, Loader2 } from 'lucide-react'
import ChecklistAnswers from './ChecklistAnswers'
import { exportChecklistSubmissionPdf } from '../../lib/exportUtils'
import { useTenant } from '../../contexts/TenantContext'
import { toUserMessage } from '../../lib/safeError'

/**
 * Read a completed checklist without leaving the page.
 *
 * Before this, seeing what an inspector actually recorded meant either a full
 * page navigation or downloading a PDF - one file per checklist, every time.
 * Both are fine for keeping a copy and neither is any good for looking. This
 * opens the answers in place, the way the rest of the app opens a record.
 *
 * The answers come from the shared ChecklistAnswers component, so this and the
 * full page can never disagree about what was recorded. The PDF and the full
 * page remain, as the two things they are actually for: a copy to send, and a
 * link to share.
 *
 * @param {object}   props
 * @param {string}   props.submissionId  id to load; the drawer is closed when null
 * @param {Function} props.onClose
 * @param {Function} [props.onOpenFull]  called with the id to navigate to the page
 */
export default function ChecklistViewerDrawer({ submissionId, onClose, onOpenFull }) {
  const [sub, setSub] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || 'TyrePulse'

  useEffect(() => { setSub(null); setError('') }, [submissionId])

  // Escape closes, like every other overlay in the app.
  useEffect(() => {
    if (!submissionId) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submissionId, onClose])

  const templateFields = useMemo(() => (
    Array.isArray(sub?.template_fields) ? sub.template_fields
      : Array.isArray(sub?.fields) ? sub.fields : undefined
  ), [sub])

  const downloadPdf = useCallback(async () => {
    if (!sub || exporting) return
    setExporting(true)
    try {
      await exportChecklistSubmissionPdf(sub, { company, branding, fields: templateFields })
    } catch (err) {
      setError(toUserMessage(err, 'Could not generate the PDF.'))
    } finally {
      setExporting(false)
    }
  }, [sub, exporting, company, branding, templateFields])

  if (!submissionId) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="h-full w-full max-w-2xl overflow-y-auto shadow-2xl"
        style={{ background: 'var(--surface)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Checklist"
      >
        <div
          className="sticky top-0 z-10 px-5 py-4 flex items-start justify-between gap-3"
          style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {sub?.title || sub?.template_name || 'Checklist'}
            </h2>
            <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
              {[sub?.asset_no, sub?.site, sub?.submitted_at ? new Date(sub.submitted_at).toLocaleString() : null]
                .filter(Boolean).join(' · ') || 'Opening...'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {sub && onOpenFull && (
              <button
                onClick={() => onOpenFull(sub.id)}
                className="btn-secondary text-xs inline-flex items-center gap-1"
                title="Open the full page (shareable link)"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Full page
              </button>
            )}
            {sub && (
              <button
                onClick={downloadPdf}
                disabled={exporting}
                className="btn-secondary text-xs inline-flex items-center gap-1"
                title="Download a copy to send"
              >
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                PDF
              </button>
            )}
            <button onClick={onClose} className="btn-secondary text-xs p-1.5" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5">
          {error && (
            <div
              className="text-sm rounded-lg px-3 py-2 mb-3"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
            >
              {error}
            </div>
          )}
          <ChecklistAnswers submissionId={submissionId} onLoaded={setSub} />
        </div>
      </div>
    </div>
  )
}
