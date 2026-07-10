/**
 * module/accident — incident / claim management motif: a fleet vehicle beside a
 * warning triangle and a claim document/clipboard. Theme-aware via tokens with a
 * subtle idle float on the alert and a gentle pulse on the warning glow.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function AccidentIllustration({ size = 200, title = 'No incidents logged', desc = 'Report an accident or claim to get started', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const float = on
    ? { animate: { y: [0, -3, 0] }, transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const pulse = on
    ? { animate: { opacity: [0.25, 0.5, 0.25] }, transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ground + ambient glow */}
      <ellipse cx="120" cy="152" rx="92" ry="12" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="120" cy="92" r="72" fill={`url(#${d.glow})`} />

      {/* claim document / clipboard behind */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="128" y="40" width="72" height="88" rx={G.radius}
              fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        <rect x="150" y="34" width="28" height="12" rx={G.radiusSm} fill={C.brand} />
        <line x1="140" y1="60" x2="188" y2="60" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" />
        <line x1="140" y1="72" x2="180" y2="72" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
        <line x1="140" y1="84" x2="188" y2="84" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
        <line x1="140" y1="96" x2="172" y2="96" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
        {/* signature accent */}
        <path d="M140 112 q8 -8 16 0 t16 0" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} strokeLinecap="round" />
      </g>

      {/* fleet vehicle (van) */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="34" y="86" width="86" height="40" rx={G.radius} fill={C.ink} opacity="0.9" />
        <path d="M120 86 h20 l16 20 v20 h-36 z" fill={C.ink} opacity="0.9" />
        <rect x="126" y="94" width="20" height="16" rx={G.radiusSm} fill={`url(#${d.surface})`} opacity="0.9" />
        <rect x="46" y="96" width="24" height="16" rx={G.radiusSm} fill={C.brandBright} opacity="0.85" />
        {/* wheels */}
        <circle cx="60" cy="128" r="12" fill={C.ink} />
        <circle cx="60" cy="128" r="12" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} />
        <circle cx="60" cy="128" r="4.5" fill={C.surface} />
        <circle cx="130" cy="128" r="12" fill={C.ink} />
        <circle cx="130" cy="128" r="12" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} />
        <circle cx="130" cy="128" r="4.5" fill={C.surface} />
      </g>

      {/* warning / alert triangle */}
      <motion.g {...float}>
        <motion.circle cx="96" cy="52" r="30" fill={C.warning} opacity="0.28" {...pulse} />
        <path d="M96 30 L118 70 L74 70 Z" fill={C.warning} stroke={C.surface} strokeWidth={G.strokeThin} strokeLinejoin="round" />
        <line x1="96" y1="44" x2="96" y2="58" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" />
        <circle cx="96" cy="64" r="2.4" fill={C.ink} />
      </motion.g>
    </IllustrationBase>
  )
}
