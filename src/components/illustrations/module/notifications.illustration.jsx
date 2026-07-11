/**
 * module/notifications — populated / hero notifications art. A branded bell with
 * alert cards fanning out behind it and a live count badge. Theme-aware with a
 * gentle bell swing and a pulsing badge (distinct from state/notifications-empty).
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

function AlertCard({ x, y, r, accent, d }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`} filter={`url(#${d.shadow})`}>
      <rect x="0" y="0" width="72" height="26" rx={G.radiusSm}
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      <circle cx="13" cy="13" r="5" fill={accent ? `url(#${d.brand})` : C.line} />
      <rect x="24" y="8" width="38" height="4" rx="2" fill={C.line} />
      <rect x="24" y="16" width="26" height="4" rx="2" fill={C.lineSoft} />
    </g>
  )
}

export default function NotificationsIllustration({ size = 200, title = 'Notifications', desc = 'Fleet alerts and updates', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const swing = on
    ? { animate: { rotate: [-6, 6, -6] }, transition: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const ping = on
    ? { animate: { scale: [1, 1.15, 1], opacity: [0.9, 1, 0.9] }, transition: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="120" cy="160" rx="84" ry="10" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="120" cy="82" r="80" fill={`url(#${d.glow})`} />

      {/* fanned alert cards */}
      <g opacity="0.95">
        <AlertCard x={40} y={54} r={-10} accent={false} d={d} />
        <AlertCard x={128} y={58} r={9} accent d={d} />
        <AlertCard x={58} y={106} r={-5} accent d={d} />
      </g>

      {/* bell */}
      <motion.g style={{ transformOrigin: '120px 58px' }} {...swing}>
        <g filter={`url(#${d.shadow})`}>
          <path
            d="M120 46 c-16 0 -26 12 -26 30 c0 16 -6 22 -12 28 h76 c-6 -6 -12 -12 -12 -28 c0 -18 -10 -30 -26 -30 Z"
            fill={`url(#${d.brand})`} stroke={C.brandBright} strokeWidth={G.strokeThin} />
          {/* handle */}
          <circle cx="120" cy="44" r="5" fill={C.brand} stroke={C.brandBright} strokeWidth={G.strokeThin} />
          {/* clapper */}
          <path d="M112 108 a8 8 0 0 0 16 0 Z" fill={C.brand} stroke={C.brandBright} strokeWidth={G.strokeThin} />
          {/* highlight */}
          <path d="M110 60 c-4 6 -6 14 -5 22" fill="none" stroke={C.surface} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.5" />
        </g>
      </motion.g>

      {/* live count badge */}
      <motion.g style={{ transformOrigin: '150px 52px' }} {...ping}>
        <circle cx="150" cy="52" r="13" fill={C.danger} filter={`url(#${d.shadow})`} />
        <circle cx="150" cy="52" r="13" fill="none" stroke={C.surface} strokeWidth={G.strokeThin} opacity="0.7" />
        <text x="150" y="57" textAnchor="middle" fontSize="14" fontWeight="700" fill={C.surface}>3</text>
      </motion.g>
    </IllustrationBase>
  )
}
