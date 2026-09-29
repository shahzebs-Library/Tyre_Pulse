/**
 * Top-down sketch of a combination's axles, drawn from the axle configuration
 * text and the recorded tyre counts. Nothing is invented: an axle whose tyre
 * count is unknown is drawn hollow and dashed.
 */
import { axleRows, parseAxleConfig, TYRE_GROUP_COLORS as GROUP_COLOR } from '../../lib/combinationManagerView'

function Axle({ x, group, tyres }) {
  const dual = tyres != null && tyres >= 4
  const known = tyres != null
  const color = GROUP_COLOR[group]
  const tyre = (tx, ty) => (
    <rect key={`${tx}-${ty}`} x={tx} y={ty} width="9" height="16" rx="2.5"
      fill={known ? color : 'none'} stroke={color} strokeWidth="1.4" strokeDasharray={known ? undefined : '3 2'} />
  )
  return (
    <g>
      <line x1={x + 4.5} y1="16" x2={x + 4.5} y2="64" style={{ stroke: 'var(--cc-ink-3)' }} strokeWidth="2" />
      {tyre(x, 4)}
      {dual && tyre(x + 11, 4)}
      {tyre(x, 60)}
      {dual && tyre(x + 11, 60)}
    </g>
  )
}

export default function TyreConfigVisual({ axleConfig, tyreConfig }) {
  const parsed = parseAxleConfig(axleConfig)
  if (!parsed) {
    return <div className="cm-visual-empty">Enter an axle configuration such as 6x4 + 3A to see the layout.</div>
  }
  const rows = axleRows({ axle_config: axleConfig, tyre_config: tyreConfig })
  const primeCount = parsed.prime ? parsed.prime.axles : 0
  const step = 26
  const gap = primeCount && parsed.trailerAxles ? 26 : 0
  const width = 16 + rows.length * step + gap
  let x = 8
  return (
    <svg viewBox={`0 0 ${width} 80`} className="cm-visual" role="img"
      aria-label={`Axle layout ${axleConfig}: ${rows.length} axles`}>
      {primeCount > 0 && (
        <rect x="2" y="24" width={primeCount * step + 6} height="32" rx="6" style={{ fill: 'var(--cc-track)', stroke: 'var(--cc-inner-border)' }} />
      )}
      {parsed.trailerAxles > 0 && (
        <rect x={primeCount * step + gap - 2 + (primeCount ? 8 : 0)} y="26" width={parsed.trailerAxles * step + 6} height="28" rx="5"
          style={{ fill: 'var(--cc-track)', stroke: 'var(--cc-inner-border)' }} />
      )}
      {rows.map((r, i) => {
        if (i === primeCount && primeCount) x += gap
        const el = <Axle key={r.axle} x={x} group={r.group} tyres={r.tyres} />
        x += step
        return el
      })}
    </svg>
  )
}

