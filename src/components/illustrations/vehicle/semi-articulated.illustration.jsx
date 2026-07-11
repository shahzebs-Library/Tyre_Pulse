/**
 * vehicle/semi-articulated — tractor unit coupled to a semi-trailer (the classic
 * articulated combination) in clean side profile: three emphasized wheel groups,
 * brand accent stripe, soft ground shadow, gentle wheel spin.
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

export default function SemiArticulatedIllustration({ size = 200, title = 'Semi-articulated truck', desc = 'Tractor unit and semi-trailer combination', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="130" cy="122" rx="118" ry="10" fill="var(--text-primary)" opacity="0.08" />

      {/* semi-trailer box */}
      <rect x="110" y="34" width="134" height="66" rx={G.radiusSm} fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      {[138, 166, 194, 222].map((x) => (
        <line key={x} x1={x} y1="40" x2={x} y2="94" stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      ))}
      <rect x="110" y="80" width="134" height="9" rx="2" fill={`url(#${d.brand})`} />

      {/* tractor cab (tall, short) */}
      <path d="M24 100 L24 46 Q24 40 30 40 L60 40 Q66 40 68 46 L74 76 L92 76 L92 100 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      <path d="M32 46 L58 46 L64 68 L32 68 Z" fill={C.accent} opacity="0.28" stroke={C.line} strokeWidth="1" />

      {/* fifth-wheel coupling gap + kingpin */}
      <rect x="92" y="90" width="18" height="10" fill={C.ink} opacity="0.7" />
      <circle cx="101" cy="95" r="3" fill={C.brandBright} />

      <line x1="24" y1="100" x2="244" y2="100" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.85" />
      <circle cx="29" cy="90" r="3.2" fill={C.brandBright} />

      {/* steer, drive tandem, trailer tandem */}
      <Wheel cx="52" cy="104" d={d} spin={spin} />
      <Wheel cx="88" cy="104" r={15} d={d} spin={spin} />
      <Wheel cx="192" cy="104" d={d} spin={spin} />
      <Wheel cx="222" cy="104" r={15} d={d} spin={spin} />
    </IllustrationBase>
  )
}
