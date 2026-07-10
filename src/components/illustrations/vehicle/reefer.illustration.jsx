/**
 * vehicle/reefer — refrigerated (temperature-controlled) box truck in clean side
 * profile: insulated cargo body with a front-mounted refrigeration unit, brand
 * accent stripe, cold-vent detailing, emphasized wheels and soft ground shadow.
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

export default function ReeferIllustration({ size = 200, title = 'Reefer', desc = 'Refrigerated temperature-controlled truck in side profile', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="130" cy="120" rx="112" ry="10" fill="var(--text-primary)" opacity="0.08" />

      {/* insulated cargo body */}
      <rect x="98" y="38" width="128" height="62" rx={G.radiusSm} fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      {/* insulation double-wall hint */}
      <rect x="102" y="42" width="120" height="54" rx="4" fill="none" stroke={C.lineSoft} strokeWidth="1" />
      {/* front refrigeration unit */}
      <rect x="92" y="44" width="14" height="26" rx="2" fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      {[50, 56, 62].map((y) => (
        <line key={y} x1="94" y1={y} x2="104" y2={y} stroke={C.accent} strokeWidth="1.5" opacity="0.6" />
      ))}
      {/* snowflake mark */}
      <g stroke={C.brandBright} strokeWidth="1.6" strokeLinecap="round" opacity="0.85">
        <line x1="170" y1="56" x2="170" y2="76" />
        <line x1="161" y1="61" x2="179" y2="71" />
        <line x1="179" y1="61" x2="161" y2="71" />
      </g>
      {/* brand accent stripe */}
      <rect x="98" y="82" width="128" height="9" rx="2" fill={`url(#${d.brand})`} />

      {/* cab */}
      <path d="M32 100 L32 56 Q32 50 38 50 L66 50 Q72 50 76 56 L88 76 L92 76 L92 100 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      <path d="M44 56 L66 56 L74 74 L44 74 Z" fill={C.accent} opacity="0.28" stroke={C.line} strokeWidth="1" />

      <line x1="32" y1="100" x2="226" y2="100" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.85" />
      <circle cx="37" cy="90" r="3.2" fill={C.brandBright} />

      <Wheel cx="60" cy="104" d={d} spin={spin} />
      <Wheel cx="176" cy="104" d={d} spin={spin} />
      <Wheel cx="206" cy="104" r={15} d={d} spin={spin} />
    </IllustrationBase>
  )
}
