import { useCallback, useEffect, useRef, useState } from 'react'
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
 * downloads and the record they read here cannot disagree. The evidence - the
 * pictures, the meters and the signatures - comes with it. The
 * PDF stays, as the thing it is actually for: a copy to send.
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
  const panelRef = useRef(null)
  const restoreRef = useRef(null)

  useEffect(() => { setRow(null) }, [inspectionId])

  // Escape closes, like every other overlay in the app. Tab is kept inside the
  // panel: this covers the page, so a keyboard user who tabs past the last
  // button would otherwise be driving a screen they cannot see. The photo
  // lightbox listens in the capture phase, so when a photo is open it takes
  // Escape first and the drawer stays put.
  useEffect(() => {
    if (!inspectionId) return undefined
    restoreRef.current = document.activeElement

    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const nodes = Array.from(
        panelRef.current.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      )
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      const inside = panelRef.current.contains(active)
      if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)

    // The panel scrolls its own body; without this the page behind scrolls too,
    // which on a phone reads as the drawer sliding off its own content.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      const back = restoreRef.current
      if (back && typeof back.focus === 'function') back.focus()
    }
  }, [inspectionId, onClose])

  const stop = useCallback((e) => e.stopPropagation(), [])

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
        ref={panelRef}
        tabIndex={-1}
        className="tp-drawer-panel h-full w-full max-w-2xl flex flex-col shadow-2xl outline-none"
        style={{ background: 'var(--surface)' }}
        onClick={stop}
        role="dialog"
        aria-modal="true"
        aria-label="Inspection"
      >
        <div
          className="shrink-0 px-4 sm:px-5 py-3 sm:py-4 flex items-start justify-between gap-2 sm:gap-3"
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
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {row && onEdit && (
              <button
                onClick={() => onEdit(row)}
                className="btn-secondary text-xs inline-flex items-center gap-1"
                title="Open the editor for this inspection"
              >
                <Pencil className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Edit</span>
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
                <span className="hidden sm:inline">PDF</span>
              </button>
            )}
            <button onClick={onClose} className="btn-secondary text-xs p-1.5" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
          {/* One component renders the whole record - map, readings, photos,
              meters, signatures. Mounting the media separately here would mean
              any other surface that forgets to do the same silently loses the
              evidence, which is the defect this drawer was built to fix. */}
          <InspectionAnswers inspectionId={inspectionId} onLoaded={setRow} />
        </div>
      </div>
    </div>
  )
}
