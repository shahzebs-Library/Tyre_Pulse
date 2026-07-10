/**
 * state/notifications-empty — a calm bell over an empty tray, for a "no
 * notifications" state. The bell gives a soft idle sway and a faint pulse ring
 * when animate; still and silent otherwise.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function NotificationsEmptyIllustration({ size = 200, title = 'All caught up', desc = 'No new notifications', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const sway = on ? { animate: { rotate: [-4, 4, -4] }, transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } } : {}
  const pulse = on ? { animate: { scale: [0.8, 1.15, 0.8], opacity: [0.35, 0, 0.35] }, transition: { duration: 3, repeat: Infinity, ease: 'easeOut' } } : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="120" cy="82" r="66" fill={`url(#${d.glow})`} />
      <ellipse cx="120" cy="152" rx="66" ry="11" fill="var(--text-primary)" opacity="0.06" />

      {/* faint pulse ring behind the bell */}
      <motion.circle cx="120" cy="76" r="46" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin}
                     style={{ originX: '120px', originY: '76px', transformBox: 'fill-box' }} {...pulse} />

      {/* bell */}
      <motion.g style={{ originX: '120px', originY: '40px', transformBox: 'fill-box' }} {...sway}>
        <g filter={`url(#${d.shadow})`}>
          <path d="M120 38 a26 26 0 0 1 26 26 c0 22 8 30 8 30 L86 94 s8 -8 8 -30 a26 26 0 0 1 26 -26 Z"
                fill={`url(#${d.surface})`} stroke={`url(#${d.brand})`} strokeWidth={G.stroke} strokeLinejoin="round" />
          <circle cx="120" cy="34" r="5" fill={`url(#${d.brand})`} />
          {/* clapper */}
          <path d="M112 100 a8 8 0 0 0 16 0 Z" fill={C.brand} opacity="0.85" />
          {/* face detail */}
          <line x1="106" y1="70" x2="134" y2="70" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.6" />
        </g>
      </motion.g>

      {/* empty tray */}
      <g filter={`url(#${d.shadow})`}>
        <path d="M70 118 L82 138 L158 138 L170 118" fill="none" stroke={C.line} strokeWidth={G.stroke} strokeLinejoin="round" strokeLinecap="round" />
        <rect x="70" y="118" width="100" height="26" rx={G.radiusSm} fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        <line x1="70" y1="128" x2="86" y2="128" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
        <line x1="154" y1="128" x2="170" y2="128" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
      </g>
    </IllustrationBase>
  )
}
