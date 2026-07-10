/**
 * vehicle/trailer-flatbed — uncoupled flatbed semi-trailer in clean side profile:
 * long open deck on a gooseneck with landing legs and a rear tandem, brand accent
 * stripe along the deck edge, soft ground shadow. Gentle wheel spin.
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

export default function TrailerFlatbedIllustration({ size = 200, title = 'Flatbed trailer', desc = 'Uncoupled flatbed semi-trailer in side profile', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="132" cy="118" rx="118" ry="9" fill="var(--text-primary)" opacity="0.08" />

      {/* gooseneck rising toward the kingpin (front) */}
      <path d="M24 74 L52 74 L52 88 L236 88 L236 98 L52 98 L24 98 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      {/* open deck top edge */}
      <line x1="52" y1="88" x2="236" y2="88" stroke={C.ink} strokeWidth={G.strokeThin} opacity="0.6" />
      {/* deck plank lines */}
      {Array.from({ length: 9 }).map((_, i) => (
        <line key={i} x1={70 + i * 18} y1="90" x2={70 + i * 18} y2="96" stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      ))}
      {/* kingpin */}
      <circle cx="34" cy="98" r="3" fill={C.brandBright} />
      {/* landing legs */}
      <line x1="88" y1="98" x2="88" y2="110" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.7" />
      <line x1="96" y1="98" x2="96" y2="110" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.7" />
      {/* brand accent stripe along the deck edge */}
      <rect x="52" y="90" width="184" height="6" rx="1" fill={`url(#${d.brand})`} />

      {/* rear tandem */}
      <Wheel cx="198" cy="102" d={d} spin={spin} />
      <Wheel cx="226" cy="102" d={d} spin={spin} />
    </IllustrationBase>
  )
}
