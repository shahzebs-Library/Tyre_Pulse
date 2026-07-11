/**
 * marketing/hero-platform — flagship product hero. A fleet of branded trucks on a
 * horizon road feeds a central command dashboard, while a live "tyre pulse" ring
 * converges the whole story: fleet → data → intelligence. Premium, layered depth
 * with ambient glow, all theme-aware via tokens and reduced-motion gated.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function HeroPlatformIllustration({ size = 280, title = 'Tyre Pulse platform', desc = 'Fleet, dashboard and tyre intelligence converging on one platform', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const trend = on
    ? { animate: { pathLength: [0, 1], opacity: [0.35, 1] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const pulse = on
    ? { animate: { scale: [1, 1.12, 1], opacity: [0.5, 0.9, 0.5] }, transition: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const spin = on
    ? { animate: { rotate: 360 }, transition: { duration: 3.2, repeat: Infinity, ease: 'linear' } }
    : {}
  const roll = on
    ? { animate: { x: [0, 6, 0] }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  const cx = 226, cy = 78, r = 30, circ = 2 * Math.PI * r

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 220" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient depth */}
      <ellipse cx="160" cy="196" rx="140" ry="14" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="150" cy="96" r="120" fill={`url(#${d.glow})`} />

      {/* horizon road (perspective) */}
      <path d="M8 190 L120 190 L206 128 L150 128 Z" fill={C.line} opacity="0.4" />
      <line x1="40" y1="188" x2="196" y2="130" stroke={C.brandBright} strokeWidth={G.strokeThin}
            strokeLinecap="round" strokeDasharray="9 10" opacity="0.6" />

      <motion.g {...float}>
        {/* central command dashboard */}
        <g filter={`url(#${d.shadow})`}>
          <rect x="36" y="30" width="176" height="110" rx={G.radius}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        </g>
        {/* header bar */}
        <rect x="36" y="30" width="176" height="20" rx={G.radius} fill={`url(#${d.brand})`} opacity="0.14" />
        <circle cx="50" cy="40" r="3.4" fill={`url(#${d.brand})`} />
        <rect x="60" y="37.5" width="46" height="5" rx="2.5" fill={C.line} />

        {/* KPI mini tiles */}
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x={48 + i * 54} y="58" width="46" height="30" rx={G.radiusSm}
                  fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
            <rect x={54 + i * 54} y="64" width="7" height="7" rx="2" fill={i === 0 ? `url(#${d.brand})` : C.line} />
            <rect x={54 + i * 54} y="76" width="30" height="4" rx="2" fill={C.line} />
            <rect x={54 + i * 54} y="82" width="18" height="3.5" rx="1.75" fill={C.lineSoft} />
          </g>
        ))}

        {/* live trend line inside dashboard */}
        <motion.path
          d="M50 124 L74 116 L98 122 L122 106 L146 112 L170 96 L200 100"
          fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke}
          strokeLinecap="round" strokeLinejoin="round" {...trend} />
        <circle cx="200" cy="100" r="4" fill={C.brandBright} />
      </motion.g>

      {/* tyre pulse ring (intelligence core) — top right */}
      <motion.circle cx={cx} cy={cy} r="40" fill={`url(#${d.glow})`} {...pulse} style={{ transformOrigin: `${cx}px ${cy}px` }} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.line} strokeWidth="10" opacity="0.5" />
      <motion.g style={{ transformOrigin: `${cx}px ${cy}px` }} {...spin}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#${d.brand})`} strokeWidth="10"
                strokeLinecap="round" strokeDasharray={`${circ * 0.7} ${circ}`}
                transform={`rotate(-90 ${cx} ${cy})`} />
      </motion.g>
      <g filter={`url(#${d.shadow})`}>
        <circle cx={cx} cy={cy} r={r - 16} fill={C.ink} opacity="0.9" />
        <circle cx={cx} cy={cy} r={r - 16} fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} />
        <circle cx={cx} cy={cy} r="6" fill={C.surface} />
      </g>
      {/* pulse waveform through the core */}
      <motion.path
        d={`M${cx - 12} ${cy} l4 -8 l5 15 l5 -12 l4 5 h5`}
        fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin}
        strokeLinecap="round" strokeLinejoin="round"
        {...(on ? { animate: { opacity: [0.5, 1, 0.5] }, transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } } : {})} />

      {/* fleet trucks on the road (foreground) */}
      <motion.g filter={`url(#${d.shadow})`} {...roll}>
        <g transform="translate(30 158)">
          <rect x="0" y="0" width="64" height="22" rx={G.radiusSm} fill={`url(#${d.brand})`} />
          <path d="M44 0 h13 a4 4 0 0 1 4 4 l6 13 h-23 Z" fill={C.brand} opacity="0.92" />
          <rect x="47" y="4" width="10" height="9" rx="1.5" fill={C.surface} opacity="0.85" />
          {[16, 50].map((wx, i) => (
            <motion.g key={i} style={{ transformOrigin: `${wx}px 24px` }} {...spin}>
              <circle cx={wx} cy="24" r="8" fill={C.ink} opacity="0.92" />
              <circle cx={wx} cy="24" r="8" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} />
              <circle cx={wx} cy="24" r="3" fill={C.surface} />
            </motion.g>
          ))}
        </g>
      </motion.g>

      {/* second, distant truck */}
      <g transform="translate(150 132)" opacity="0.85">
        <rect x="0" y="0" width="40" height="14" rx="3" fill={C.brand} opacity="0.7" />
        <path d="M28 0 h8 a3 3 0 0 1 3 3 l4 8 h-15 Z" fill={C.brand} opacity="0.6" />
        {[10, 32].map((wx, i) => (
          <circle key={i} cx={wx} cy="15" r="5" fill={C.ink} opacity="0.8" />
        ))}
      </g>

      {/* data link: fleet → dashboard → intelligence */}
      <path d="M120 150 Q150 120 190 100" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin}
            strokeLinecap="round" strokeDasharray="2 7" opacity="0.6" />
    </IllustrationBase>
  )
}
