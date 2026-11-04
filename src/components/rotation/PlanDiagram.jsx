/**
 * Plan diagram: the chosen positions highlighted on the vehicle's own tyre map
 * (the same diagram every other screen draws, 4- vs 5-axle pumps included).
 * Falls back to a plain four-corner sketch for an old plan recorded in the
 * generic FL/FR/RL/RR vocabulary or when the vehicle type is unknown.
 */
import VehicleTyreDiagram from '../VehicleTyreDiagram'
import { positionLabel } from '../../lib/rotationScheduleView'

const CORNERS = ['FL', 'FR', 'RL', 'RR']
const SLOTS = [
  { key: 'FL', x: 8, y: 14 }, { key: 'FR', x: 72, y: 14 },
  { key: 'RL', x: 8, y: 92 }, { key: 'RR', x: 72, y: 92 },
]

function CornerSketch({ positions, tone, label }) {
  const on = new Set(positions)
  return (
    <svg viewBox="0 0 100 150" role="img" aria-label={`${label}: ${positions.length ? positions.join(', ') : 'none recorded'}`}>
      <rect x="30" y="8" width="40" height="126" rx="12" fill="var(--cc-track)" stroke="var(--cc-inner-border)" />
      <rect x="36" y="18" width="28" height="22" rx="4" fill="var(--cc-inner-border)" />
      {SLOTS.map((s) => (
        <g key={s.key}>
          <rect x={s.x} y={s.y} width="20" height="34" rx="5" fill={on.has(s.key) ? tone : 'var(--cc-card-flat)'} stroke={on.has(s.key) ? tone : 'var(--cc-ink-3)'} />
          <text x={s.x + 10} y={s.y + 21} textAnchor="middle" fontSize="8" fontWeight="700" fill={on.has(s.key) ? '#fff' : 'var(--cc-ink-2)'}>{s.key}</text>
        </g>
      ))}
      <text x="50" y="146" textAnchor="middle" fontSize="7" fill={on.has('Spare') ? tone : 'var(--cc-ink-3)'}>{on.has('Spare') ? 'Spare included' : ''}</text>
    </svg>
  )
}

export default function PlanDiagram({ positions = [], tone = 'var(--cc-green)', label, vehicleType, assetNo, country }) {
  const legacy = positions.length > 0 && positions.every((p) => CORNERS.includes(p) || p === 'Spare')
  const useMap = !legacy && (vehicleType || assetNo)
  return (
    <figure className="rs-diagram">
      <figcaption>{label}</figcaption>
      {useMap ? (
        <>
          <VehicleTyreDiagram
            vehicleType={vehicleType}
            assetNo={assetNo}
            country={country}
            positions={positions.filter((p) => p !== 'Spare').map((p) => ({ position: p, risk_level: 'Low' }))}
            width={150}
          />
          <small className="rs-diagram-list">{positions.length ? positions.map(positionLabel).join(', ') : 'None recorded'}</small>
        </>
      ) : <CornerSketch positions={positions} tone={tone} label={label} />}
    </figure>
  )
}
