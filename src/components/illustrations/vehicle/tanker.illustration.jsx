/**
 * vehicle/tanker — cylindrical bulk-liquid tanker in clean side profile: cab +
 * rounded pressure vessel with end-cap ring and brand accent band, emphasized
 * wheels, soft ground shadow, gentle wheel spin.
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

export default function TankerIllustration({ size = 200, title = 'Tanker', desc = 'Bulk-liquid tanker in side profile', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="130" cy="120" rx="116" ry="10" fill="var(--text-primary)" opacity="0.08" />

      {/* cylindrical vessel */}
      <rect x="98" y="46" width="130" height="52" rx="26" fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      {/* end-cap ring */}
      <ellipse cx="216" cy="72" rx="10" ry="26" fill="none" stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      {/* baffle rings */}
      {[132, 164, 196].map((x) => (
        <line key={x} x1={x} y1="48" x2={x} y2="96" stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      ))}
      {/* brand accent band around barrel */}
      <rect x="98" y="66" width="130" height="9" fill={`url(#${d.brand})`} opacity="0.92" />
      {/* top hatch */}
      <rect x="140" y="40" width="16" height="7" rx="2" fill={C.ink} opacity="0.7" />

      {/* cab */}
      <path d="M30 98 L30 54 Q30 48 36 48 L64 48 Q70 48 74 54 L86 74 L86 98 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      <path d="M42 54 L64 54 L72 72 L42 72 Z" fill={C.accent} opacity="0.28" stroke={C.line} strokeWidth="1" />

      <line x1="30" y1="98" x2="228" y2="98" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.85" />
      <circle cx="35" cy="88" r="3.2" fill={C.brandBright} />

      <Wheel cx="58" cy="102" d={d} spin={spin} />
      <Wheel cx="176" cy="102" d={d} spin={spin} />
      <Wheel cx="206" cy="102" r={15} d={d} spin={spin} />
    </IllustrationBase>
  )
}
