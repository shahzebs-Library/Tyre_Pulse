/**
 * module/analytics — layered analytics hero. A branded donut ring, a live trend
 * line, and a column of KPI tiles, all theme-aware with a subtle float and a
 * sweeping donut segment.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function AnalyticsIllustration({ size = 200, title = 'Analytics', desc = 'Fleet performance analytics', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -3, 0] }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const trend = on
    ? { animate: { pathLength: [0, 1], opacity: [0.35, 1] }, transition: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const spin = on
    ? { animate: { rotate: 360 }, transition: { duration: 14, repeat: Infinity, ease: 'linear' } }
    : {}

  // Donut geometry
  const cx = 74, cy = 92, r = 30, circ = 2 * Math.PI * r

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="120" cy="162" rx="88" ry="10" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="110" cy="84" r="82" fill={`url(#${d.glow})`} />

      <motion.g {...float}>
        {/* base panel */}
        <g filter={`url(#${d.shadow})`}>
          <rect x="28" y="34" width="184" height="112" rx={G.radius}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        </g>

        {/* donut */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.line} strokeWidth="12" opacity="0.5" />
        <motion.g style={{ transformOrigin: `${cx}px ${cy}px` }} {...spin}>
          <circle
            cx={cx} cy={cy} r={r} fill="none" stroke={`url(#${d.brand})`} strokeWidth="12"
            strokeLinecap="round" strokeDasharray={`${circ * 0.62} ${circ}`}
            transform={`rotate(-90 ${cx} ${cy})`} />
        </motion.g>
        <circle cx={cx} cy={cy} r={r - 14} fill={C.surface} />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill={C.ink}>62%</text>

        {/* KPI tiles */}
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x="128" y={44 + i * 22} width="72" height="17" rx={G.radiusSm}
                  fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
            <rect x="134" y={49 + i * 22} width="7" height="7" rx="2"
                  fill={i === 0 ? `url(#${d.brand})` : C.line} />
            <rect x="146" y={49 + i * 22} width="30" height="3.5" rx="1.75" fill={C.line} />
            <rect x="146" y={55 + i * 22} width="18" height="3.5" rx="1.75" fill={C.lineSoft} />
          </g>
        ))}

        {/* live trend line across the base */}
        <motion.path
          d="M40 132 L66 126 L92 130 L118 118 L144 122 L170 108 L200 112"
          fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke}
          strokeLinecap="round" strokeLinejoin="round" {...trend} />
        <circle cx="200" cy="112" r="4" fill={C.brandBright} />
        <circle cx="200" cy="112" r="7" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} opacity="0.4" />
      </motion.g>
    </IllustrationBase>
  )
}
