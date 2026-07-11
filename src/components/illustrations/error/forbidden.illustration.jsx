/**
 * error/forbidden — a padlock over a lowered barrier gate in front of a tyre,
 * for an access-denied (403) state. The lock gives a small "denied" shake and
 * the barrier stripes hold when animate.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function ForbiddenIllustration({ size = 200, title = 'Access denied', desc = 'You do not have permission to view this', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const shake = on
    ? { animate: { x: [0, -3, 3, -2, 2, 0] }, transition: { duration: 0.9, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="120" cy="86" r="72" fill={`url(#${d.glow})`} />
      <ellipse cx="120" cy="152" rx="72" ry="11" fill="var(--text-primary)" opacity="0.06" />

      {/* tyre behind the gate */}
      <g filter={`url(#${d.shadow})`} opacity="0.85">
        <circle cx="120" cy="104" r="34" fill={C.ink} opacity="0.85" />
        <circle cx="120" cy="104" r="34" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
        <circle cx="120" cy="104" r="14" fill={C.surface} />
        <circle cx="120" cy="104" r="14" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2
          const x1 = 120 + Math.cos(a) * 24, y1 = 104 + Math.sin(a) * 24
          const x2 = 120 + Math.cos(a) * 30, y2 = 104 + Math.sin(a) * 30
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        })}
      </g>

      {/* barrier gate — post + striped boom */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="40" y="66" width="12" height="82" rx={G.radiusSm} fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        <rect x="48" y="70" width="150" height="16" rx={G.radiusSm} fill={C.surface} stroke={C.sub} strokeWidth={G.strokeThin} />
        {/* danger stripes */}
        {Array.from({ length: 6 }).map((_, i) => (
          <rect key={i} x={54 + i * 24} y="70" width="12" height="16" fill={C.danger} opacity="0.85" />
        ))}
      </g>

      {/* padlock, foreground */}
      <motion.g {...shake}>
        <g filter={`url(#${d.shadow})`}>
          {/* shackle */}
          <path d="M148 96 v-8 a20 20 0 0 1 40 0 v8" fill="none" stroke={C.sub} strokeWidth={G.stroke + 1} strokeLinecap="round" />
          {/* body */}
          <rect x="144" y="96" width="48" height="42" rx={G.radiusSm} fill={`url(#${d.brand})`} stroke={C.surface} strokeWidth={G.strokeThin} />
          {/* keyhole */}
          <circle cx="168" cy="112" r="5" fill={C.surface} />
          <rect x="166" y="114" width="4" height="12" rx="2" fill={C.surface} />
        </g>
      </motion.g>
    </IllustrationBase>
  )
}
