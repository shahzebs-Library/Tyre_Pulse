/**
 * module/workshop — a workshop service bay: a vehicle raised on a two-post lift
 * with a wrench and a hanging tool. Theme-aware via tokens with a slow lift
 * float and a gentle wrench sway.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function WorkshopIllustration({ size = 200, title = 'No workshop activity', desc = 'Bays are idle — schedule a service to begin', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const lift = on
    ? { animate: { y: [0, -3, 0] }, transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const sway = on
    ? { animate: { rotate: [-6, 6, -6] }, transition: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* floor + ambient glow */}
      <ellipse cx="120" cy="158" rx="98" ry="12" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="120" cy="88" r="76" fill={`url(#${d.glow})`} />

      {/* bay back wall / pegboard */}
      <rect x="30" y="24" width="180" height="118" rx={G.radius}
            fill={`url(#${d.surface})`} stroke={C.lineSoft} strokeWidth={G.strokeThin} opacity="0.7" />
      {Array.from({ length: 4 }).map((_, r) =>
        Array.from({ length: 9 }).map((_, cIdx) => (
          <circle key={`${r}-${cIdx}`} cx={46 + cIdx * 20} cy={40 + r * 18} r="1.6" fill={C.line} opacity="0.5" />
        ))
      )}

      {/* two-post lift columns */}
      <rect x="40" y="60" width="12" height="80" rx={G.radiusSm} fill={C.sub} opacity="0.85" />
      <rect x="188" y="60" width="12" height="80" rx={G.radiusSm} fill={C.sub} opacity="0.85" />
      <rect x="46" y="112" width="148" height="8" rx="4" fill={`url(#${d.brand})`} />

      {/* raised vehicle */}
      <motion.g {...lift} filter={`url(#${d.shadow})`}>
        <rect x="70" y="74" width="100" height="34" rx={G.radius} fill={C.ink} opacity="0.9" />
        <path d="M84 74 q6 -18 24 -18 h30 q14 0 20 18 z" fill={C.ink} opacity="0.9" />
        <rect x="96" y="62" width="40" height="14" rx={G.radiusSm} fill={`url(#${d.surface})`} opacity="0.9" />
        {/* wheels (raised, off ground) */}
        <circle cx="94" cy="108" r="12" fill={C.ink} />
        <circle cx="94" cy="108" r="12" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} />
        <circle cx="94" cy="108" r="4.5" fill={C.surface} />
        <circle cx="146" cy="108" r="12" fill={C.ink} />
        <circle cx="146" cy="108" r="12" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} />
        <circle cx="146" cy="108" r="4.5" fill={C.surface} />
      </motion.g>

      {/* hanging wrench tool */}
      <motion.g style={{ transformOrigin: '176px 40px' }} {...sway}>
        <line x1="176" y1="30" x2="176" y2="44" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" />
        <path d="M170 44 a10 10 0 1 0 12 0 l-1 26 a5 5 0 0 1 -10 0 z"
              fill={`url(#${d.brand})`} stroke={C.surface} strokeWidth="1.5" />
        <circle cx="176" cy="52" r="4" fill={C.surface} />
      </motion.g>
    </IllustrationBase>
  )
}
