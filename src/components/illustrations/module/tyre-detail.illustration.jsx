/**
 * module/tyre-detail — one tyre in focus with a tread-depth gauge and a
 * measurement callout, for the single-tyre detail screen. Theme-aware.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function TyreDetailIllustration({ size = 200, title = 'Tyre detail', desc = 'Tread depth & measurements', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const float = on ? { animate: { y: [0, -3, 0] }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' } } : {}
  const spin = on ? { animate: { rotate: 360 }, transition: { duration: 16, repeat: Infinity, ease: 'linear' } } : {}
  const gauge = on
    ? { animate: { strokeDashoffset: [188, 66] }, transition: { duration: 2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' } }
    : {}

  const cx = 92, cy = 96, r = 46
  const gaugeR = 30
  const circ = 2 * Math.PI * gaugeR

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="104" cy="86" r="82" fill={`url(#${d.glow})`} />
      <ellipse cx="100" cy="152" rx="86" ry="10" fill="var(--text-primary)" opacity="0.06" />

      <motion.g {...float}>
        {/* focused tyre */}
        <g filter={`url(#${d.shadow})`}>
          <circle cx={cx} cy={cy} r={r} fill={C.ink} opacity="0.92" />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
          <motion.g {...spin} style={{ originX: `${cx}px`, originY: `${cy}px` }}>
            {Array.from({ length: 18 }).map((_, i) => {
              const a = (i / 18) * Math.PI * 2
              return (
                <line key={i}
                      x1={cx + Math.cos(a) * (r - 8)} y1={cy + Math.sin(a) * (r - 8)}
                      x2={cx + Math.cos(a) * (r - 2)} y2={cy + Math.sin(a) * (r - 2)}
                      stroke={C.brandBright} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.8" />
              )
            })}
          </motion.g>
        </g>

        {/* tread-depth ring gauge over the hub */}
        <circle cx={cx} cy={cy} r={gaugeR} fill={C.surface} stroke={C.lineSoft} strokeWidth={G.stroke} />
        <motion.circle
          cx={cx} cy={cy} r={gaugeR} fill="none"
          stroke={`url(#${d.brand})`} strokeWidth={G.stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={on ? 188 : 96}
          transform={`rotate(-90 ${cx} ${cy})`} {...gauge} />
        <circle cx={cx} cy={cy} r={gaugeR * 0.42} fill={C.line} opacity="0.6" />
      </motion.g>

      {/* measurement callout card */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="150" y="52" width="66" height="52" rx={G.radius}
              fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      </g>
      <line x1={cx + r * 0.7} y1={cy - r * 0.5} x2="150" y2="66" stroke={C.line} strokeWidth={G.strokeThin} strokeDasharray="3 4" />
      {/* gauge readout: label + value bar + scale ticks */}
      <rect x="158" y="60" width="30" height="5" rx="2.5" fill={C.lineSoft} />
      <rect x="158" y="72" width="42" height="8" rx="4" fill={`url(#${d.brand})`} />
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1={158 + i * 12} y1="90" x2={158 + i * 12} y2={i === 2 ? 98 : 94}
              stroke={C.muted} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.8" />
      ))}
    </IllustrationBase>
  )
}
