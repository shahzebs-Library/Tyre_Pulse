import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Image as ImageIcon } from 'lucide-react'
import { getInspectionForPage } from '../../lib/api/inspections'
import {
  tyreReadingRows, inspectionMeta, inspectionSummary, readingText, isComplete,
} from '../../lib/inspectionView'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { safeImageSrc } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'

const RISK_TONE = {
  good: '#15803d',
  warning: '#b45309',
  critical: '#b91c1c',
  none: 'var(--text-dim)',
}

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
 * @param {object}  props
 * @param {object}  [props.inspection]     already-loaded row
 * @param {string}  [props.inspectionId]   id to load when no row is supplied
 * @param {boolean} [props.showSummary]    headline tiles (default true)
 * @param {Function}[props.onLoaded]       called with the loaded row
 */
export default function InspectionAnswers({
  inspection, inspectionId, showSummary = true, onLoaded,
}) {
  const [fetched, setFetched] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [photos, setPhotos] = useState([])

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
  const { rows, stats } = useMemo(() => tyreReadingRows(row), [row])
  const meta = useMemo(() => inspectionMeta(row), [row])
  const summary = useMemo(() => inspectionSummary(row), [row])

  // Photos are stored as tp-storage refs and have to be signed before they can
  // be shown. Best-effort per photo: one that will not resolve is reported as
  // unavailable rather than blocking the whole record.
  useEffect(() => {
    if (!row) { setPhotos([]); return undefined }
    let cancelled = false
    const refs = []
    for (const r of rows) if (r.photo) refs.push({ label: r.label || r.position, ref: r.photo })
    if (row.photo_data) refs.push({ label: 'Inspection photo', ref: row.photo_data })
    if (!refs.length) { setPhotos([]); return undefined }
    Promise.all(refs.map(async (p) => {
      try { const url = await resolveStorageUrl(p.ref); return url ? { label: p.label, url } : { label: p.label, url: null } }
      catch { return { label: p.label, url: null } }
    })).then((out) => { if (!cancelled) setPhotos(out) })
    return () => { cancelled = true }
  }, [row, rows])

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

  const showPressureFlag = rows.some((r) => r.pressureFlag)

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

      <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
        Tyre readings
      </h3>
      {!rows.length ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          No tyre readings were recorded on this inspection.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                <th className="py-1.5 pr-2 font-medium">Position</th>
                <th className="py-1.5 pr-2 font-medium">Condition</th>
                <th className="py-1.5 pr-2 font-medium text-right">Pressure</th>
                <th className="py-1.5 pr-2 font-medium text-right">Tread</th>
                {showPressureFlag && <th className="py-1.5 pr-2 font-medium">Vs median</th>}
                <th className="py-1.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.position} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td className="py-2 pr-2 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                    {r.label || r.position}
                  </td>
                  <td className="py-2 pr-2">
                    <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                          background: RISK_TONE[r.risk] || RISK_TONE.none,
                        }}
                      />
                      {r.condition}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums" style={{ color: r.pressure == null ? 'var(--text-dim)' : 'var(--text-primary)' }}>
                    {readingText(r.pressure, ' PSI')}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums" style={{ color: r.tread == null ? 'var(--text-dim)' : 'var(--text-primary)' }}>
                    {readingText(r.tread, ' mm')}
                  </td>
                  {showPressureFlag && (
                    <td className="py-2 pr-2 text-xs">
                      {!r.pressureFlag ? (
                        <span style={{ color: 'var(--text-dim)' }}>N/A</span>
                      ) : r.pressureFlag.check ? (
                        <span style={{ color: '#b45309', fontWeight: 600 }}>
                          Check {r.pressureFlag.dev > 0 ? '+' : '-'}{r.pressureFlag.pct}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)' }}>OK</span>
                      )}
                    </td>
                  )}
                  <td className="py-2 text-xs" style={{ color: r.notes ? 'var(--text-secondary)' : 'var(--text-dim)' }}>
                    {r.notes || 'None'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {showPressureFlag && (
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-dim)' }}>
              Pressure is compared to this vehicle&apos;s own median of {stats.recordedPressures} recorded
              readings. There is no stored target pressure, so nothing else would be a measurement.
            </p>
          )}
        </div>
      )}

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

      {photos.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
            Photos
          </h3>
          <div className="flex flex-wrap gap-3">
            {photos.map((p, i) => {
              const src = p.url ? safeImageSrc(p.url) : null
              return src ? (
                <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="block">
                  <img
                    src={src}
                    alt={`${p.label} photo`}
                    className="w-24 h-24 object-cover rounded"
                    style={{ border: '1px solid var(--border-subtle)' }}
                  />
                  <div className="text-[11px] mt-1 text-center" style={{ color: 'var(--text-secondary)' }}>{p.label}</div>
                </a>
              ) : (
                <span key={i} className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--text-dim)' }}>
                  <ImageIcon className="w-3 h-3" /> {p.label}: photo unavailable
                </span>
              )
            })}
          </div>
        </div>
      )}

      {(row.inspector_signature || row.approver_signature) && (
        <div className="mt-6 pt-4 grid grid-cols-2 gap-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {row.inspector_signature && (
            <div>
              <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                Signed by {row.inspector || 'the inspector'}
              </div>
              <img
                src={safeImageSrc(row.inspector_signature) || undefined}
                alt="Inspector signature"
                className="max-h-24 rounded"
                style={{ background: '#fff', padding: 6 }}
              />
            </div>
          )}
          {row.approver_signature && (
            <div>
              <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                Approved{row.approved_at ? ` on ${String(row.approved_at).slice(0, 10)}` : ''}
              </div>
              <img
                src={safeImageSrc(row.approver_signature) || undefined}
                alt="Approver signature"
                className="max-h-24 rounded"
                style={{ background: '#fff', padding: 6 }}
              />
            </div>
          )}
        </div>
      )}
    </>
  )
}
