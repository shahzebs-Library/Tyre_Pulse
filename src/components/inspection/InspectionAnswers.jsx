import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { getInspectionForPage } from '../../lib/api/inspections'
import { inspectionMeta, inspectionSummary, isComplete } from '../../lib/inspectionView'
import { toUserMessage } from '../../lib/safeError'
import InspectionDiagram from './InspectionDiagram'
import InspectionPhotos from './InspectionPhotos'

/**
 * What an inspector actually recorded, rendered wherever someone needs to read it.
 *
 * There is one of these because there is one answer to "what does this
 * inspection say". Every reading it shows comes from the pure inspectionView
 * helpers, which the PDF report also uses - so the copy someone downloads and
 * the record they read on screen cannot disagree.
 *
 * Pass a loaded `inspection`, or an `inspectionId` to fetch one. Fetching one
 * row is deliberate: the register no longer carries the signature columns, so
 * they arrive here, when somebody actually asks to see the record.
 *
 * It renders the WHOLE record - the wheel map, the readings, the photographs,
 * the meters and the signatures. Splitting those across components a caller has
 * to remember to mount is how the evidence goes missing on one surface and not
 * another, which is the defect this component exists to end.
 *
 * The readings are shown ON the wheel map: each wheel carries its own PSI and a
 * summary line names the position, condition and readings underneath. The
 * separate per-position table that used to repeat all of that was removed at the
 * owner's request, so nothing is lost - it is the same answer, read off the
 * picture instead of matched back to it by position code. The PDF report prints
 * the same way.
 *
 * @param {object}  props
 * @param {object}  [props.inspection]     already-loaded row
 * @param {string}  [props.inspectionId]   id to load when no row is supplied
 * @param {boolean} [props.showSummary]    headline tiles (default true)
 * @param {boolean} [props.showMedia]      wheel map, photos, signatures (default true)
 * @param {Function}[props.onLoaded]       called with the loaded row
 */
export default function InspectionAnswers({
  inspection, inspectionId, showSummary = true, showMedia = true, onLoaded,
}) {
  const [fetched, setFetched] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const needsFetch = !inspection && !!inspectionId

  useEffect(() => {
    if (!needsFetch) { setFetched(null); setError(''); return undefined }
    let cancelled = false
    setLoading(true); setError(''); setFetched(null)
    getInspectionForPage(inspectionId)
      .then((row) => {
        if (cancelled) return
        if (!row) { setError('That inspection could not be found.'); return }
        setFetched(row)
        onLoaded?.(row)
      })
      .catch((err) => { if (!cancelled) setError(toUserMessage(err, 'Could not open the inspection.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // onLoaded is deliberately not a dependency: a caller passing an inline
    // arrow would otherwise refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFetch, inspectionId])

  const row = inspection || fetched
  const meta = useMemo(() => inspectionMeta(row), [row])
  const summary = useMemo(() => inspectionSummary(row), [row])

  if (loading) {
    return (
      <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        Opening the inspection...
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

  if (!row) return null

  return (
    <>
      {showSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            ['Completeness', isComplete(row) ? 'Complete' : 'Incomplete'],
            ['Positions recorded', summary.recorded == null ? null : `${summary.recorded} of ${summary.positions}`],
            ['Damage found', summary.damaged],
            ['Average pressure', summary.avgPressure == null ? 'Not recorded' : `${summary.avgPressure.toFixed(1)} PSI`],
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

      {meta.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-5">
          {meta.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
              <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }} title={String(value)}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The readings, on the vehicle they were taken from. Someone opening an
          inspection wants to see WHICH wheel, and reading that off a table of
          position codes is work the picture does for them. It is the same
          diagram the PDF captures, and its summary lines carry the condition,
          pressure and tread for every position that was recorded. */}
      {showMedia && <InspectionDiagram inspection={row} className="mb-5" />}

      {row.findings && (
        <div className="mt-5 rounded-lg p-3" style={{ background: 'var(--panel-2)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Findings</div>
          <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{row.findings}</div>
        </div>
      )}

      {row.notes && row.notes !== row.findings && (
        <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--panel-2)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Notes</div>
          <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{row.notes}</div>
        </div>
      )}

      {/* Photographs, meters and signatures. The old copy here was a grid of
          unlabelled thumbnails, and it rendered a mobile signature through
          safeImageSrc, which correctly rejects a raw SVG string - so every
          signature drawn on a phone showed as a broken image. Both now come
          from InspectionPhotos, which handles the real stored shapes. */}
      {showMedia && <InspectionPhotos inspection={row} />}

    </>
  )
}
