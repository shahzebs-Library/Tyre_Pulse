import { useMemo } from 'react'
import VehicleTyreDiagram, { isTyrelessEquipment } from '../VehicleTyreDiagram'
import { inspectionDiagramModel } from '../../lib/inspectionView'

const RISK_TONE = {
  good: '#15803d',
  warning: '#b45309',
  critical: '#b91c1c',
  none: 'var(--text-dim)',
}

/**
 * The wheel map of one inspection, on screen.
 *
 * The report has always drawn this; the viewer only listed the answers, so the
 * person signing off read a table where the inspector saw a vehicle. This is
 * the same picture from the same data: VehicleTyreDiagram is THE diagram (the
 * PDF captures that very component), and inspectionDiagramModel is the one
 * place a stored tyre_conditions entry becomes a coloured wheel. Neither is
 * reimplemented here, so the screen and the downloaded report cannot disagree.
 *
 * Honest by construction: a position nobody recorded is left in the diagram's
 * "No Data" grey and named underneath, never coloured as though it passed.
 *
 * @param {object}  props
 * @param {object}  props.inspection     the loaded inspection row
 * @param {number}  [props.width]        diagram width in px (default 300)
 * @param {boolean} [props.showReadings] per-position caption (default true)
 * @param {string}  [props.className]    wrapper classes
 */
export default function InspectionDiagram({
  inspection, width = 300, showReadings = true, className = '',
}) {
  const model = useMemo(
    () => inspectionDiagramModel(inspection, { isTyreless: isTyrelessEquipment }),
    [inspection],
  )

  // Nothing loaded is not a finding, so it says nothing at all.
  if (!inspection) return null

  if (!model.renderable) {
    return (
      <div className={className}>
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          {model.reason}
        </p>
      </div>
    )
  }

  const recorded = model.readings.length
  const total = model.slots.length

  return (
    <div className={className}>
      <VehicleTyreDiagram
        vehicleType={model.vehicleType}
        tyreData={model.tyreData}
        subLabels={model.subLabels}
        width={width}
      />

      <p className="text-xs mt-3 text-center" style={{ color: 'var(--text-secondary)' }}>
        {recorded} of {total} positions recorded.
        {model.unrecorded.length > 0 && ' Grey wheels were not recorded on this inspection.'}
      </p>

      {model.unmatched.length > 0 && (
        <p className="text-[11px] mt-1 text-center" style={{ color: 'var(--text-dim)' }}>
          Recorded against a position this vehicle does not have:{' '}
          {model.unmatched.map((u) => u.position).join(', ')}
        </p>
      )}

      {showReadings && recorded > 0 && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
          {model.readings.map((r) => (
            <div key={r.slot} className="flex items-center gap-1.5 min-w-0 text-xs">
              <span
                aria-hidden="true"
                style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: RISK_TONE[r.risk] || RISK_TONE.none,
                }}
              />
              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{r.code}</span>
              <span className="truncate" style={{ color: 'var(--text-secondary)' }}>
                {[
                  r.condition,
                  r.pressure == null ? null : `${r.pressure} PSI`,
                  r.tread == null ? null : `${r.tread} mm`,
                ].filter(Boolean).join(' | ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
