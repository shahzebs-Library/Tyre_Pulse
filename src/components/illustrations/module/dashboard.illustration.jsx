/**
 * module/dashboard — analytics dashboard hero/empty art. KPI cards over a
 * rising bar chart with a live pulse line and a tyre accent, all theme-aware.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function DashboardIllustration({ size = 200, title = 'Dashboard', desc = 'Fleet analytics overview', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -3, 0] }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const pulse = on
    ? { animate: { pathLength: [0, 1], opacity: [0.35, 1] }, transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  const bars = [22, 34, 28, 46, 40, 58]

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="120" cy="164" rx="92" ry="9" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="120" cy="86" r="78" fill={`url(#${d.glow})`} />

      <motion.g {...float}>
        {/* main analytics panel */}
        <g filter={`url(#${d.shadow})`}>
          <rect x="34" y="26" width="172" height="118" rx={G.radius}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        </g>

        {/* KPI cards */}
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x={44 + i * 52} y={36} width="44" height="26" rx={G.radiusSm}
                  fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
            <rect x={49 + i * 52} y={42} width="20" height="4" rx="2" fill={C.lineSoft} />
            <rect x={49 + i * 52} y={50} width="30" height="6" rx="3"
                  fill={i === 2 ? `url(#${d.brand})` : C.line} />
          </g>
        ))}

        {/* chart baseline */}
        <line x1="46" y1="130" x2="196" y2="130" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" />

        {/* rising bars */}
        {bars.map((h, i) => (
          <rect key={i} x={50 + i * 24} y={130 - h} width="14" height={h} rx={G.radiusSm}
                fill={i >= bars.length - 2 ? `url(#${d.brand})` : C.line}
                opacity={i >= bars.length - 2 ? 1 : 0.65} />
        ))}

        {/* live pulse trend line */}
        <motion.path
          d="M50 108 L74 100 L98 104 L122 88 L146 92 L170 74 L188 78"
          fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke}
          strokeLinecap="round" strokeLinejoin="round" {...pulse} />
        <circle cx="188" cy="78" r="4" fill={C.brandBright} />
        <circle cx="188" cy="78" r="7" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} opacity="0.4" />
      </motion.g>
    </IllustrationBase>
  )
}
