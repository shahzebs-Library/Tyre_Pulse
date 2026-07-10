/**
 * module/fleet — fleet overview art. A row of truck silhouettes in perspective
 * (near → far) rolling on a shared baseline, theme-aware with a lead accent.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

function Truck({ x, y, s, lead, d }) {
  // s = scale (perspective). Draw a cab-over tractor + box body silhouette.
  const w = 96 * s, h = 34 * s, wheelR = 7 * s
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* body */}
      <rect x="0" y={-h} width={w * 0.62} height={h} rx={G.radiusSm}
            fill={lead ? `url(#${d.brand})` : C.line} opacity={lead ? 1 : 0.55} />
      {/* cab */}
      <path
        d={`M${w * 0.62} ${-h * 0.72} h${w * 0.22} a${6 * s} ${6 * s} 0 0 1 ${5 * s} ${5 * s} v${h * 0.72 - 5 * s} h${-w * 0.24} Z`}
        fill={lead ? C.brand : C.line} opacity={lead ? 0.92 : 0.5} />
      {/* windshield */}
      <rect x={w * 0.66} y={-h * 0.62} width={w * 0.13} height={h * 0.34} rx="2"
            fill={C.surface} opacity="0.85" />
      {/* wheels */}
      {[w * 0.14, w * 0.34, w * 0.72].map((wx, i) => (
        <g key={i}>
          <circle cx={wx} cy="0" r={wheelR} fill={C.ink} opacity="0.9" />
          <circle cx={wx} cy="0" r={wheelR} fill="none"
                  stroke={lead ? C.brandBright : C.muted} strokeWidth={2 * s} />
          <circle cx={wx} cy="0" r={wheelR * 0.4} fill={C.surface} />
        </g>
      ))}
    </g>
  )
}

export default function FleetIllustration({ size = 200, title = 'Fleet', desc = 'Vehicle fleet overview', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const roll = animate && !reduce
    ? { animate: { x: [0, 4, 0] }, transition: { duration: 4.5, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="120" cy="86" r="80" fill={`url(#${d.glow})`} />
      {/* road */}
      <ellipse cx="120" cy="150" rx="104" ry="12" fill="var(--text-primary)" opacity="0.06" />
      <line x1="26" y1="150" x2="214" y2="150" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" strokeDasharray="10 10" opacity="0.7" />

      {/* far trucks (background depth) */}
      <g opacity="0.7">
        <Truck x={128} y={116} s={0.62} lead={false} d={d} />
        <Truck x={92} y={126} s={0.78} lead={false} d={d} />
      </g>

      {/* lead truck (foreground, branded) */}
      <motion.g filter={`url(#${d.shadow})`} {...roll}>
        <Truck x={30} y={148} s={1} lead d={d} />
      </motion.g>
    </IllustrationBase>
  )
}
