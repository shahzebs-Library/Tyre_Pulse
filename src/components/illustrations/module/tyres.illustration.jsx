/**
 * module/tyres — a row of tyres with tread detail and a pulse line sweeping
 * across them, representing the tyre catalogue / health module. Theme-aware.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

function Tyre({ cx, cy, r, d, branded, spin }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={C.ink} opacity="0.92" />
      <circle cx={cx} cy={cy} r={r} fill="none"
              stroke={branded ? `url(#${d.brand})` : C.muted} strokeWidth={G.stroke} />
      {/* tread ticks */}
      <motion.g {...spin} style={{ originX: `${cx}px`, originY: `${cy}px` }}>
        {Array.from({ length: 14 }).map((_, i) => {
          const a = (i / 14) * Math.PI * 2
          return (
            <line key={i}
                  x1={cx + Math.cos(a) * (r - 6)} y1={cy + Math.sin(a) * (r - 6)}
                  x2={cx + Math.cos(a) * (r - 1)} y2={cy + Math.sin(a) * (r - 1)}
                  stroke={branded ? C.brandBright : C.dim} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.85" />
          )
        })}
      </motion.g>
      {/* hub */}
      <circle cx={cx} cy={cy} r={r * 0.42} fill={C.surface} stroke={C.line} strokeWidth={G.strokeThin} />
      <circle cx={cx} cy={cy} r={r * 0.16} fill={C.line} />
    </g>
  )
}

export default function TyresIllustration({ size = 200, title = 'Tyres', desc = 'Tyre inventory & health', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const spin = on ? { animate: { rotate: 360 }, transition: { duration: 12, repeat: Infinity, ease: 'linear' } } : {}
  const pulse = on
    ? { animate: { pathLength: [0, 1], opacity: [0.3, 1] }, transition: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="120" cy="86" r="82" fill={`url(#${d.glow})`} />
      <ellipse cx="120" cy="150" rx="100" ry="11" fill="var(--text-primary)" opacity="0.06" />

      <g filter={`url(#${d.shadow})`}>
        <Tyre cx={58} cy={110} r={26} d={d} branded={false} spin={spin} />
        <Tyre cx={182} cy={110} r={26} d={d} branded={false} spin={spin} />
        <Tyre cx={120} cy={104} r={34} d={d} branded spin={spin} />
      </g>

      {/* pulse line sweeping across the tyres */}
      <motion.path
        d="M28 60 L64 60 L78 42 L96 76 L112 34 L128 76 L144 48 L160 60 L212 60"
        fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke}
        strokeLinecap="round" strokeLinejoin="round" {...pulse} />
    </IllustrationBase>
  )
}
