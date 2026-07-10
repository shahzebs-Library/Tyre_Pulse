/**
 * vehicle/box-van — light-commercial box / panel van in clean side profile: one
 * continuous cab-and-cargo body, sliding side door, brand accent stripe,
 * emphasized wheels and soft ground shadow. Gentle wheel spin.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

function Wheel({ cx, cy, r = 15, d, spin }) {
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

export default function BoxVanIllustration({ size = 200, title = 'Box van', desc = 'Light-commercial panel van in side profile', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="130" cy="118" rx="106" ry="9" fill="var(--text-primary)" opacity="0.08" />

      {/* one-piece van body: sloped nose into tall box */}
      <path d="M40 100 L40 66 Q40 60 48 58 L74 50 Q80 48 84 54 L92 66 L92 44 Q92 40 96 40 L214 40 Q220 40 220 46 L220 100 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      {/* windshield + door window */}
      <path d="M50 66 L74 56 L84 66 Z" fill={C.accent} opacity="0.28" stroke={C.line} strokeWidth="1" />
      <rect x="96" y="46" width="26" height="18" rx="2" fill={C.accent} opacity="0.22" stroke={C.line} strokeWidth="1" />
      {/* sliding side door seam */}
      <line x1="150" y1="42" x2="150" y2="98" stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      <rect x="158" y="60" width="6" height="4" rx="1" fill={C.ink} opacity="0.6" />
      {/* brand accent stripe */}
      <rect x="92" y="80" width="128" height="9" rx="2" fill={`url(#${d.brand})`} />

      <line x1="40" y1="100" x2="220" y2="100" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.85" />
      <circle cx="44" cy="90" r="3" fill={C.brandBright} />

      <Wheel cx="66" cy="104" d={d} spin={spin} />
      <Wheel cx="190" cy="104" d={d} spin={spin} />
    </IllustrationBase>
  )
}
