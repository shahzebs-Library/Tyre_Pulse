/**
 * vehicle/rigid-truck — clean side profile of a rigid (single-chassis) truck:
 * cab + fixed cargo body on two emphasized wheels, brand accent stripe, soft
 * ground shadow. Wheels gently rotate unless reduced-motion / animate=false.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

/** Emphasized fleet wheel with tread ticks + brand rim. */
function Wheel({ cx, cy, r = 17, d, spin }) {
  return (
    <g filter={`url(#${d.shadow})`}>
      <circle cx={cx} cy={cy} r={r} fill={C.ink} opacity="0.92" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
      <motion.g {...spin} style={{ originX: `${cx}px`, originY: `${cy}px` }}>
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2
          return (
            <line key={i}
              x1={cx + Math.cos(a) * (r - 9)} y1={cy + Math.sin(a) * (r - 9)}
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

export default function RigidTruckIllustration({ size = 200, title = 'Rigid truck', desc = 'Side profile of a rigid fleet truck', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      {/* ground shadow */}
      <ellipse cx="130" cy="120" rx="112" ry="10" fill="var(--text-primary)" opacity="0.08" />

      {/* cargo body */}
      <rect x="96" y="40" width="128" height="60" rx={G.radiusSm} fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      {/* body ribs */}
      {[120, 148, 176, 204].map((x) => (
        <line key={x} x1={x} y1="46" x2={x} y2="94" stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      ))}
      {/* brand accent stripe */}
      <rect x="96" y="82" width="128" height="9" rx="2" fill={`url(#${d.brand})`} />

      {/* cab */}
      <path d="M36 100 L36 58 Q36 52 42 52 L74 52 Q80 52 84 58 L96 78 L96 100 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      {/* windshield */}
      <path d="M50 58 L74 58 L84 74 L50 74 Z" fill={C.accent} opacity="0.28" stroke={C.line} strokeWidth="1" />
      {/* chassis line */}
      <line x1="36" y1="100" x2="224" y2="100" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.85" />
      {/* headlight */}
      <circle cx="41" cy="90" r="3.4" fill={C.brandBright} />

      <Wheel cx="66" cy="104" d={d} spin={spin} />
      <Wheel cx="182" cy="104" d={d} spin={spin} />
    </IllustrationBase>
  )
}
