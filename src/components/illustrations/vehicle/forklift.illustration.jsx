/**
 * vehicle/forklift — warehouse / yard forklift in clean side profile: counterbalance
 * body, overhead operator cage, vertical lift mast with forks and a palletised load,
 * brand accent stripe, emphasized wheels and soft ground shadow. Gentle wheel spin.
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

export default function ForkliftIllustration({ size = 200, title = 'Forklift', desc = 'Warehouse forklift with mast and load in side profile', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 7, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} viewBox="0 0 260 140" {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="140" cy="120" rx="104" ry="10" fill="var(--text-primary)" opacity="0.08" />

      {/* counterbalance body */}
      <path d="M96 100 L96 74 Q96 66 104 66 L182 66 Q192 66 194 76 L200 100 Z"
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} strokeLinejoin="round" />
      {/* brand accent stripe on chassis */}
      <rect x="96" y="90" width="104" height="8" rx="2" fill={`url(#${d.brand})`} />

      {/* overhead operator cage */}
      <rect x="120" y="26" width="58" height="4" rx="2" fill={C.ink} opacity="0.8" />
      <line x1="126" y1="30" x2="126" y2="66" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.8" />
      <line x1="172" y1="30" x2="172" y2="66" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.8" />
      {/* seat */}
      <path d="M138 66 L138 52 L152 52 L152 66 Z" fill={C.accent} opacity="0.3" stroke={C.line} strokeWidth="1" />

      {/* vertical lift mast (front) */}
      <rect x="66" y="24" width="7" height="86" rx="2" fill={C.ink} opacity="0.85" />
      <rect x="78" y="24" width="7" height="86" rx="2" fill={C.ink} opacity="0.85" />
      {/* mast crossbraces */}
      {[40, 62, 84].map((y) => (
        <line key={y} x1="66" y1={y} x2="85" y2={y} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      ))}

      {/* palletised load on the forks */}
      <rect x="32" y="52" width="34" height="30" rx="2" fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      <rect x="32" y="82" width="34" height="7" fill={C.ink} opacity="0.5" />
      {/* forks */}
      <line x1="36" y1="98" x2="66" y2="98" stroke={C.brandBright} strokeWidth={G.stroke} strokeLinecap="round" />
      <line x1="36" y1="98" x2="36" y2="90" stroke={C.brandBright} strokeWidth={G.stroke} strokeLinecap="round" />

      <line x1="96" y1="100" x2="200" y2="100" stroke={C.ink} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.85" />

      {/* drive wheel (large front) + steer wheel (small rear) */}
      <Wheel cx="112" cy="104" r={16} d={d} spin={spin} />
      <Wheel cx="184" cy="106" r={11} d={d} spin={spin} />
    </IllustrationBase>
  )
}
