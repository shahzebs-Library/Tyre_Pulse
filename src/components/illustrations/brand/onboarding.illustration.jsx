/**
 * brand/onboarding — welcoming "getting started" hero. A road stretching into
 * the distance with a branded vehicle and numbered waypoint milestones, plus a
 * destination flag. Theme-aware, with a gentle vehicle roll and a pulsing
 * destination marker.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function OnboardingIllustration({ size = 200, title = 'Getting started', desc = 'Welcome to Tyre Pulse', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const roll = on
    ? { animate: { x: [0, 5, 0] }, transition: { duration: 4.5, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const spinL = on
    ? { animate: { rotate: 360 }, transition: { duration: 3, repeat: Infinity, ease: 'linear' } }
    : {}
  const flag = on
    ? { animate: { scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }, transition: { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  // waypoints along the road
  const waypoints = [
    { x: 78, y: 128, n: 1, done: true },
    { x: 120, y: 116, n: 2, done: true },
    { x: 162, y: 104, n: 3, done: false },
  ]

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="120" cy="160" rx="100" ry="11" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="150" cy="80" r="80" fill={`url(#${d.glow})`} />

      {/* road (perspective: wide near-left → narrow far-right) */}
      <path d="M18 152 L96 152 L188 92 L172 92 Z" fill={C.line} opacity="0.5" />
      <path d="M18 152 L96 152 L188 92 L172 92 Z" fill="none" stroke={C.line} strokeWidth={G.strokeThin} opacity="0.6" />
      {/* centre dashes */}
      <line x1="40" y1="150" x2="180" y2="94" stroke={C.brandBright} strokeWidth={G.strokeThin}
            strokeLinecap="round" strokeDasharray="8 9" opacity="0.7" />

      {/* connecting progress path over waypoints */}
      <path d="M78 128 L120 116 L162 104"
            fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin}
            strokeLinecap="round" strokeDasharray="2 8" opacity="0.7" />

      {/* waypoints */}
      {waypoints.map((w) => (
        <g key={w.n} filter={`url(#${d.shadow})`}>
          <circle cx={w.x} cy={w.y} r="12"
                  fill={w.done ? `url(#${d.brand})` : C.surface}
                  stroke={w.done ? C.brandBright : C.line} strokeWidth={G.strokeThin} />
          {w.done ? (
            <path d={`M${w.x - 5} ${w.y} l3.5 4 l6 -7`} fill="none" stroke={C.surface}
                  strokeWidth={G.strokeThin} strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <text x={w.x} y={w.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={C.sub}>{w.n}</text>
          )}
        </g>
      ))}

      {/* destination flag (far end) */}
      <line x1="180" y1="90" x2="180" y2="66" stroke={C.sub} strokeWidth={G.strokeThin} strokeLinecap="round" />
      <motion.path d="M180 66 l16 5 l-16 6 Z" fill={`url(#${d.brand})`} {...flag}
                   style={{ transformOrigin: '180px 71px' }} />

      {/* vehicle (branded, foreground) */}
      <motion.g filter={`url(#${d.shadow})`} {...roll}>
        <g transform="translate(28 116)">
          {/* body */}
          <rect x="0" y="0" width="58" height="20" rx={G.radiusSm} fill={`url(#${d.brand})`} />
          {/* cab */}
          <path d="M40 0 h12 a4 4 0 0 1 4 4 v-0 l6 12 h-22 Z" fill={C.brand} opacity="0.92" />
          {/* window */}
          <rect x="42" y="3" width="9" height="8" rx="1.5" fill={C.surface} opacity="0.85" />
          {/* wheels */}
          {[14, 44].map((wx, i) => (
            <motion.g key={i} style={{ transformOrigin: `${wx}px 22px` }} {...spinL}>
              <circle cx={wx} cy="22" r="7" fill={C.ink} opacity="0.92" />
              <circle cx={wx} cy="22" r="7" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} />
              <circle cx={wx} cy="22" r="2.6" fill={C.surface} />
            </motion.g>
          ))}
        </g>
      </motion.g>
    </IllustrationBase>
  )
}
