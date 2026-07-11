/**
 * widget/kpi-spark — a compact KPI tile: a value + delta chip over an animated
 * sparkline that draws itself and pulses its leading dot. Theme-aware; used as a
 * dashboard micro-widget placeholder / hero for a single tracked metric.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

const SPARK = 'M14 60 L28 54 L42 58 L56 46 L70 50 L84 36 L98 40 L112 26'

export default function KpiSparkIllustration({ size = 120, title = 'KPI', desc = 'Key metric trend', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const draw = on
    ? { animate: { pathLength: [0, 1], opacity: [0.4, 1] }, transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const ping = on
    ? { animate: { scale: [1, 1.6], opacity: [0.5, 0] }, transition: { duration: 2, repeat: Infinity, ease: 'easeOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 120 80" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* tile */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="4" y="4" width="112" height="72" rx={G.radius}
              fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      </g>

      {/* value label */}
      <text x="14" y="26" fontSize="15" fontWeight="700" fill={C.ink}>4.2k</text>

      {/* delta chip */}
      <rect x="72" y="14" width="34" height="15" rx="7.5" fill={C.brandBright} opacity="0.15" />
      <path d="M78 25 L81 20 L84 25 Z" fill={C.brandBright} />
      <text x="88" y="25" fontSize="9" fontWeight="700" fill={C.brand}>8%</text>

      {/* baseline */}
      <line x1="14" y1="66" x2="112" y2="66" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />

      {/* sparkline */}
      <motion.path d={SPARK} fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke}
        strokeLinecap="round" strokeLinejoin="round" {...draw} />

      {/* leading dot + ping */}
      <motion.circle cx="112" cy="26" r="4" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin}
        style={{ transformOrigin: '112px 26px' }} {...ping} />
      <circle cx="112" cy="26" r="3.4" fill={C.brandBright} />
    </IllustrationBase>
  )
}
