/**
 * module/vehicles — single vehicle side profile with emphasized wheels. A
 * detailed tractor-trailer silhouette for the vehicles module, theme-aware.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

function Wheel({ cx, cy, r, d, spin }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={C.ink} opacity="0.92" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
      <motion.g {...spin} style={{ originX: `${cx}px`, originY: `${cy}px` }}>
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i / 6) * Math.PI * 2
          return (
            <line key={i}
                  x1={cx + Math.cos(a) * (r * 0.32)} y1={cy + Math.sin(a) * (r * 0.32)}
                  x2={cx + Math.cos(a) * (r * 0.78)} y2={cy + Math.sin(a) * (r * 0.78)}
                  stroke={C.muted} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.7" />
          )
        })}
      </motion.g>
      <circle cx={cx} cy={cy} r={r * 0.34} fill={C.surface} stroke={C.line} strokeWidth={G.strokeThin} />
    </g>
  )
}

export default function VehiclesIllustration({ size = 200, title = 'Vehicle', desc = 'Vehicle profile', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const float = on ? { animate: { y: [0, -2.5, 0] }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' } } : {}
  const spin = on ? { animate: { rotate: 360 }, transition: { duration: 9, repeat: Infinity, ease: 'linear' } } : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="120" cy="82" r="80" fill={`url(#${d.glow})`} />
      <ellipse cx="120" cy="150" rx="96" ry="11" fill="var(--text-primary)" opacity="0.06" />

      <motion.g {...float}>
        <g filter={`url(#${d.shadow})`}>
          {/* trailer / box body */}
          <rect x="34" y="58" width="108" height="58" rx={G.radius}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
          {/* body panel lines */}
          <line x1="70" y1="62" x2="70" y2="112" stroke={C.lineSoft} strokeWidth={G.strokeThin} />
          <line x1="106" y1="62" x2="106" y2="112" stroke={C.lineSoft} strokeWidth={G.strokeThin} />
          {/* brand stripe */}
          <rect x="40" y="88" width="96" height="8" rx="4" fill={`url(#${d.brand})`} opacity="0.9" />

          {/* cab */}
          <path d="M142 116 V78 a10 10 0 0 1 10 -10 h24 l16 26 v22 a4 4 0 0 1 -4 4 Z"
                fill={C.brand} opacity="0.92" />
          {/* windshield */}
          <path d="M176 70 l14 22 h-18 V70 Z" fill={C.surface} opacity="0.9" />
          {/* headlight */}
          <circle cx="188" cy="104" r="3.5" fill={C.brandBright} />
        </g>

        {/* emphasized wheels */}
        <Wheel cx={66} cy={122} r={17} d={d} spin={spin} />
        <Wheel cx={162} cy={122} r={17} d={d} spin={spin} />
      </motion.g>
    </IllustrationBase>
  )
}
