/**
 * vehicle/bus — city / transit bus in clean side profile: long low body with a
 * row of passenger windows, twin doors, brand accent stripe, emphasized wheels
 * and soft ground shadow. Gentle wheel spin unless reduced-motion.
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

export default function BusIllustration({ size = 200, title = 'Bus', desc = 'City transit bus in side profile', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="130" cy="118" rx="118" ry="9" fill="var(--text-primary)" opacity="0.08" />

      {/* long low body */}
      <rect x="20" y="42" width="220" height="58" rx={G.radius} fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      {/* driver windshield */}
      <path d="M26 52 L44 52 L44 68 L26 68 Z" fill={C.accent} opacity="0.3" stroke={C.line} strokeWidth="1" />
      {/* passenger window band */}
      {Array.from({ length: 7 }).map((_, i) => (
        <rect key={i} x={58 + i * 25} y="52" width="18" height="16" rx="2"
              fill={C.accent} opacity="0.24" stroke={C.line} strokeWidth="1" />
      ))}
      {/* twin doors */}
      <rect x="50" y="74" width="8" height="26" rx="1" fill={C.lineSoft} stroke={C.line} strokeWidth="1" />
      <rect x="150" y="74" width="8" height="26" rx="1" fill={C.lineSoft} stroke={C.line} strokeWidth="1" />
      {/* brand accent stripe */}
      <rect x="20" y="82" width="220" height="9" rx="2" fill={`url(#${d.brand})`} />

      <line x1="20" y1="100" x2="240" y2="100" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.85" />
      <circle cx="234" cy="90" r="3" fill={C.brandBright} />

      <Wheel cx="62" cy="104" d={d} spin={spin} />
      <Wheel cx="198" cy="104" d={d} spin={spin} />
    </IllustrationBase>
  )
}
