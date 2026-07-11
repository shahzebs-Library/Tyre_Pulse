/**
 * vehicle/coach — long-distance touring coach in clean side profile: tall raised
 * body with panoramic tinted glazing, luggage bay, brand accent sweep,
 * emphasized wheels and soft ground shadow. Gentle wheel spin.
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

export default function CoachIllustration({ size = 200, title = 'Coach', desc = 'Long-distance touring coach in side profile', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="130" cy="120" rx="120" ry="9" fill="var(--text-primary)" opacity="0.08" />

      {/* tall raised body */}
      <path d="M18 100 L18 46 Q18 34 30 34 L228 34 Q242 34 242 48 L242 100 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      {/* raked driver glass */}
      <path d="M24 46 L40 42 L40 62 L24 62 Z" fill={C.accent} opacity="0.32" stroke={C.line} strokeWidth="1" />
      {/* panoramic tinted window band */}
      <rect x="50" y="44" width="184" height="20" rx="4" fill={C.accent} opacity="0.26" stroke={C.line} strokeWidth="1" />
      {Array.from({ length: 8 }).map((_, i) => (
        <line key={i} x1={70 + i * 22} y1="44" x2={70 + i * 22} y2="64" stroke={C.line} strokeWidth="1" opacity="0.6" />
      ))}
      {/* luggage bay */}
      <rect x="30" y="84" width="196" height="10" rx="2" fill={C.ink} opacity="0.1" stroke={C.lineSoft} strokeWidth="1" />
      {/* brand accent sweep */}
      <path d="M18 78 L242 70 L242 78 L18 82 Z" fill={`url(#${d.brand})`} />

      <line x1="18" y1="100" x2="242" y2="100" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.85" />
      <circle cx="236" cy="90" r="3" fill={C.brandBright} />

      <Wheel cx="60" cy="104" d={d} spin={spin} />
      <Wheel cx="200" cy="104" d={d} spin={spin} />
    </IllustrationBase>
  )
}
