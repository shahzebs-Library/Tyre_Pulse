/**
 * widget/gauge-ring — a radial gauge: a 270° track with a brand-gradient value
 * arc that sweeps up when animated, a needle, and a centred percentage. Theme-
 * aware; used as a dashboard micro-widget for a bounded metric (compliance %,
 * utilisation, health score).
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function GaugeRingIllustration({ size = 120, title = 'Gauge', desc = 'Metric gauge', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  // Gauge geometry: centre (60,48), radius 30, 270° open arc starting bottom-left.
  const cx = 60, cy = 48, r = 30
  const circ = 2 * Math.PI * r
  const trackFrac = 0.75          // 270° visible track
  const valueFrac = 0.75 * 0.72   // ~72% of the track filled

  const sweep = on
    ? { initial: { strokeDashoffset: circ * trackFrac }, animate: { strokeDashoffset: circ * (trackFrac - valueFrac) }, transition: { duration: 1.6, ease: [0.22, 1, 0.36, 1] } }
    : {}
  const needle = on
    ? { initial: { rotate: -135 }, animate: { rotate: -135 + 360 * valueFrac }, transition: { duration: 1.6, ease: [0.22, 1, 0.36, 1] } }
    : {}

  // Rotate so the 270° gap sits at the bottom (start at 135° from +x, i.e. bottom-left).
  const arcTransform = `rotate(135 ${cx} ${cy})`

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 120 80" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* soft glow */}
      <circle cx={cx} cy={cy} r="34" fill={`url(#${d.glow})`} opacity="0.6" />

      {/* track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.line} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${circ * trackFrac} ${circ}`} transform={arcTransform} opacity="0.5" />

      {/* value arc */}
      <motion.circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#${d.brand})`} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${circ * trackFrac} ${circ}`} transform={arcTransform} {...sweep}
        strokeDashoffset={on ? undefined : circ * (trackFrac - valueFrac)} />

      {/* needle */}
      <motion.g style={{ transformOrigin: `${cx}px ${cy}px` }} {...needle}
        transform={on ? undefined : `rotate(${-135 + 360 * valueFrac} ${cx} ${cy})`}>
        <line x1={cx} y1={cy} x2={cx + r - 6} y2={cy} stroke={C.sub} strokeWidth={G.stroke} strokeLinecap="round" />
      </motion.g>
      <circle cx={cx} cy={cy} r="4" fill={C.brandBright} />
      <circle cx={cx} cy={cy} r="4" fill="none" stroke={C.surface} strokeWidth="1.4" opacity="0.6" />

      {/* value + label */}
      <text x={cx} y={cy + 24} textAnchor="middle" fontSize="14" fontWeight="700" fill={C.ink}>72%</text>
      <text x={cx} y={cy + 34} textAnchor="middle" fontSize="7" fontWeight="600" fill={C.muted} letterSpacing="0.5">HEALTH</text>
    </IllustrationBase>
  )
}
