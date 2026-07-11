/**
 * module/work-orders — a work order clipboard with a checklist of ticked tasks
 * and a wrench accent. Theme-aware via tokens with a slow float and staggered
 * tick reveal.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function WorkOrdersIllustration({ size = 200, title = 'No work orders yet', desc = 'Create a work order to assign shop tasks', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const tick = (i) => on
    ? { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 0.5, delay: 0.5 + i * 0.35, ease: 'easeOut' } }
    : {}

  const rows = [64, 84, 104]

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ground + ambient glow */}
      <ellipse cx="120" cy="156" rx="80" ry="12" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="118" cy="88" r="72" fill={`url(#${d.glow})`} />

      <motion.g {...float}>
        {/* clipboard board */}
        <g filter={`url(#${d.shadow})`}>
          <rect x="62" y="30" width="104" height="120" rx={G.radius}
                fill={C.sub} opacity="0.9" />
          <rect x="70" y="40" width="88" height="104" rx={G.radiusSm}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
          {/* clip */}
          <rect x="98" y="24" width="32" height="14" rx={G.radiusSm} fill={`url(#${d.brand})`} />
          <rect x="106" y="20" width="16" height="8" rx="4" fill={C.brand} />
        </g>

        {/* header line */}
        <line x1="80" y1="52" x2="130" y2="52" stroke={C.line} strokeWidth={G.stroke} strokeLinecap="round" />

        {/* checklist rows */}
        {rows.map((y, i) => (
          <g key={y}>
            <rect x="80" y={y - 8} width="16" height="16" rx="4"
                  fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} />
            <motion.path d={`M83 ${y} l4 4 l7 -9`} fill="none"
                  stroke={C.brandBright} strokeWidth={G.stroke} strokeLinecap="round" strokeLinejoin="round" {...tick(i)} />
            <line x1="104" y1={y} x2={i === 2 ? 136 : 150} y2={y}
                  stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
          </g>
        ))}
      </motion.g>

      {/* wrench accent */}
      <g filter={`url(#${d.shadow})`} transform="rotate(38 164 128)">
        <rect x="158" y="96" width="12" height="46" rx="6" fill={`url(#${d.brand})`} />
        <path d="M154 96 a10 10 0 1 1 20 0 l-4 4 h-12 z" fill={`url(#${d.brand})`} />
        <circle cx="164" cy="93" r="4" fill={C.surface} />
      </g>
    </IllustrationBase>
  )
}
