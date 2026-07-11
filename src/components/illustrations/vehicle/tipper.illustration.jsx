/**
 * vehicle/tipper — dump / tipper truck in clean side profile with a raised
 * angled skip body and hydraulic ram, brand accent stripe, emphasized wheels
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

export default function TipperIllustration({ size = 200, title = 'Tipper truck', desc = 'Dump / tipper truck with raised skip body', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="130" cy="120" rx="112" ry="10" fill="var(--text-primary)" opacity="0.08" />

      {/* raised angled skip body */}
      <path d="M104 96 L228 96 L228 58 L120 42 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      {/* body ribs following the tilt */}
      {[[150, 47, 150, 90], [176, 51, 176, 90], [202, 55, 202, 90]].map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      ))}
      {/* brand accent stripe along the sill */}
      <rect x="104" y="86" width="124" height="9" rx="2" fill={`url(#${d.brand})`} />
      {/* hydraulic ram */}
      <line x1="112" y1="94" x2="126" y2="66" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.75" />

      {/* cab */}
      <path d="M32 96 L32 54 Q32 48 38 48 L66 48 Q72 48 76 54 L88 74 L104 74 L104 96 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      <path d="M44 54 L66 54 L74 72 L44 72 Z" fill={C.accent} opacity="0.28" stroke={C.line} strokeWidth="1" />

      <line x1="32" y1="96" x2="228" y2="96" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.85" />
      <circle cx="37" cy="86" r="3.2" fill={C.brandBright} />

      <Wheel cx="60" cy="100" d={d} spin={spin} />
      <Wheel cx="176" cy="100" d={d} spin={spin} />
      <Wheel cx="206" cy="100" r={15} d={d} spin={spin} />
    </IllustrationBase>
  )
}
