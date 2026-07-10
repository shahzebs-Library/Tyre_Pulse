/**
 * vehicle/low-loader — heavy-haulage low-loader / drop-deck trailer in clean side
 * profile: raised gooseneck stepping down to a dropped well deck over a multi-axle
 * bogie, brand accent stripe, soft ground shadow. Gentle wheel spin.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

function Wheel({ cx, cy, r = 13, d, spin }) {
  return (
    <g filter={`url(#${d.shadow})`}>
      <circle cx={cx} cy={cy} r={r} fill={C.ink} opacity="0.92" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
      <motion.g {...spin} style={{ originX: `${cx}px`, originY: `${cy}px` }}>
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2
          return (
            <line key={i}
              x1={cx + Math.cos(a) * (r - 7)} y1={cy + Math.sin(a) * (r - 7)}
              x2={cx + Math.cos(a) * (r - 2.5)} y2={cy + Math.sin(a) * (r - 2.5)}
              stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
          )
        })}
      </motion.g>
      <circle cx={cx} cy={cy} r={r * 0.4} fill={C.surface} />
      <circle cx={cx} cy={cy} r={r * 0.4} fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
    </g>
  )
}

export default function LowLoaderIllustration({ size = 200, title = 'Low loader', desc = 'Heavy-haulage low-loader trailer in side profile', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="132" cy="120" rx="120" ry="9" fill="var(--text-primary)" opacity="0.08" />

      {/* stepped deck: high gooseneck → dropped well → rear ramp rise */}
      <path d="M22 66 L58 66 L58 84 L74 84 L74 98 L200 98 L200 84 L240 84 L240 106 L22 106 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      {/* dropped well deck plank lines */}
      {Array.from({ length: 8 }).map((_, i) => (
        <line key={i} x1={86 + i * 14} y1="90" x2={86 + i * 14} y2="96" stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      ))}
      {/* kingpin */}
      <circle cx="32" cy="106" r="3" fill={C.brandBright} />
      {/* brand accent stripe on the well */}
      <rect x="74" y="90" width="126" height="6" rx="1" fill={`url(#${d.brand})`} />
      {/* landing legs */}
      <line x1="80" y1="98" x2="80" y2="112" stroke={C.ink} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.7" />

      {/* rear tri-axle bogie */}
      <Wheel cx="204" cy="110" d={d} spin={spin} />
      <Wheel cx="224" cy="110" d={d} spin={spin} />
      <Wheel cx="244" cy="110" d={d} spin={spin} />
    </IllustrationBase>
  )
}
