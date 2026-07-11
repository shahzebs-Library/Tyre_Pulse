/**
 * vehicle/pickup — light utility pickup truck in clean side profile: crew cab +
 * open load bed, brand accent stripe along the sill, emphasized wheels and soft
 * ground shadow. Gentle wheel spin unless reduced-motion.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

function Wheel({ cx, cy, r = 16, d, spin }) {
  return (
    <g filter={`url(#${d.shadow})`}>
      <circle cx={cx} cy={cy} r={r} fill={C.ink} opacity="0.92" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
      <motion.g {...spin} style={{ originX: `${cx}px`, originY: `${cy}px` }}>
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2
          return (
            <line key={i}
              x1={cx + Math.cos(a) * (r - 8)} y1={cy + Math.sin(a) * (r - 8)}
              x2={cx + Math.cos(a) * (r - 3)} y2={cy + Math.sin(a) * (r - 3)}
              stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
          )
        })}
      </motion.g>
      <circle cx={cx} cy={cy} r={r * 0.4} fill={C.surface} />
      <circle cx={cx} cy={cy} r={r * 0.4} fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
    </g>
  )
}

export default function PickupIllustration({ size = 200, title = 'Pickup truck', desc = 'Utility pickup with crew cab and load bed', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="130" cy="118" rx="110" ry="9" fill="var(--text-primary)" opacity="0.08" />

      {/* lower body / sill spanning cab + bed */}
      <path d="M36 98 L36 84 Q36 78 44 78 L224 78 L224 98 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      {/* crew cab */}
      <path d="M58 78 L64 50 Q66 44 74 44 L120 44 Q128 44 132 52 L142 78 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      {/* cab windows */}
      <path d="M72 52 L96 52 L96 70 L78 70 Z" fill={C.accent} opacity="0.28" stroke={C.line} strokeWidth="1" />
      <path d="M102 52 L120 52 L128 70 L102 70 Z" fill={C.accent} opacity="0.28" stroke={C.line} strokeWidth="1" />
      {/* open load bed wall */}
      <rect x="142" y="60" width="82" height="18" rx="2" fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      {/* brand accent stripe */}
      <rect x="36" y="88" width="188" height="8" rx="2" fill={`url(#${d.brand})`} />

      <line x1="36" y1="98" x2="224" y2="98" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.85" />
      <circle cx="221" cy="86" r="3" fill={C.brandBright} />

      <Wheel cx="66" cy="102" d={d} spin={spin} />
      <Wheel cx="192" cy="102" d={d} spin={spin} />
    </IllustrationBase>
  )
}
