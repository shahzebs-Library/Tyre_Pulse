import { useEffect, useState } from 'react'
import { X, Download, Loader2, Pencil } from 'lucide-react'
import InspectionAnswers from './InspectionAnswers'

/**
 * Read a completed inspection without leaving the page.
 *
 * Before this, seeing what an inspector actually recorded meant downloading the
 * PDF - one file per inspection, every time - because the only other row action
 * was Edit, which opens a form for changing the record rather than a view of it.
 * A form is not a reading surface: it shows what you may type, not what was
 * observed, and it never showed the meters, the photos or the signatures at all.
 *
 * The readings come from the shared InspectionAnswers component over the pure
 * inspectionView helpers, which the PDF also uses, so the copy someone
 * downloads and the record they read here cannot disagree. The PDF stays, as
 * the thing it is actually for: a copy to send.
 *
 * @param {object}   props
 * @param {string}   props.inspectionId  id to load; the drawer is closed when null
 * @param {Function} props.onClose
 * @param {Function} [props.onEdit]      called with the loaded row to open the editor
 * @param {Function} [props.onDownload]  called with the loaded row to export the PDF
 * @param {boolean}  [props.downloading] true while the caller is building the PDF
 */
export default function InspectionViewerDrawer({
  inspectionId, onClose, onEdit, onDownload, downloading = false,
}) {
  const [row, setRow] = useState(null)

  useEffect(() => { setRow(null) }, [inspectionId])

  // Escape closes, like every other overlay in the app.
  useEffect(() => {
    if (!inspectionId) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspectionId, onClose])

  if (!inspectionId) return null

  const subtitle = [
    row?.asset_no,
    row?.site,
    row?.inspection_date || row?.scheduled_date,
  ].filter(Boolean).join(' | ')

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
        aria-label="Inspection"
      >
        <div
          className="sticky top-0 z-10 px-5 py-4 flex items-start justify-between gap-3"
          style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {row?.title || 'Inspection'}
            </h2>
            <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
              {subtitle || 'Opening...'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {row && onEdit && (
              <button
                onClick={() => onEdit(row)}
                className="btn-secondary text-xs inline-flex items-center gap-1"
                title="Open the editor for this inspection"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            {row && onDownload && (
              <button
                onClick={() => onDownload(row)}
                disabled={downloading}
                className="btn-secondary text-xs inline-flex items-center gap-1"
                title="Download a copy to send"
              >
                {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                PDF
              </button>
            )}
            <button onClick={onClose} className="btn-secondary text-xs p-1.5" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5">
          <InspectionAnswers inspectionId={inspectionId} onLoaded={setRow} />
        </div>
      </div>
    </div>
  )
}
