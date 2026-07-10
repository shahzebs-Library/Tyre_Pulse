/**
 * widget/donut-mini — a mini donut breakdown: three theme-aware segments (brand,
 * accent, neutral) around a centred total, with a compact legend. The primary
 * segment sweeps in when animated. Used as a dashboard micro-widget for a small
 * categorical split (status mix, cost breakdown, position share).
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function DonutMiniIllustration({ size = 120, title = 'Breakdown', desc = 'Category breakdown', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  // Donut geometry — left of the legend.
  const cx = 40, cy = 40, r = 26, sw = 12
  const circ = 2 * Math.PI * r

  // Segment fractions (sum < 1 leaves the neutral remainder).
  const segs = [
    { frac: 0.52, stroke: `url(#${d.brand})`, off: 0 },
    { frac: 0.30, stroke: C.accentStrong, off: 0.52 },
    { frac: 0.18, stroke: C.line, off: 0.82 },
  ]

  const sweep = on
    ? { initial: { strokeDasharray: `0 ${circ}` }, animate: { strokeDasharray: `${circ * segs[0].frac} ${circ}` }, transition: { duration: 1.4, ease: [0.22, 1, 0.36, 1] } }
    : {}

  const legend = [
    { label: 'Active', color: C.brand, val: '52%' },
    { label: 'Review', color: C.accentStrong, val: '30%' },
    { label: 'Other', color: C.muted, val: '18%' },
  ]

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 120 80" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* soft glow behind donut */}
      <circle cx={cx} cy={cy} r="30" fill={`url(#${d.glow})`} opacity="0.5" />

      {/* track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.lineSoft} strokeWidth={sw} />

      {/* static secondary + tertiary segments */}
      {segs.slice(1).map((s, i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.stroke} strokeWidth={sw}
          strokeDasharray={`${circ * s.frac} ${circ}`}
          strokeDashoffset={-circ * s.off}
          transform={`rotate(-90 ${cx} ${cy})`} opacity={i === 1 ? 0.55 : 0.9} />
      ))}

      {/* animated primary segment (on top, starts at -90°) */}
      <motion.circle cx={cx} cy={cy} r={r} fill="none" stroke={segs[0].stroke} strokeWidth={sw}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        strokeDasharray={on ? undefined : `${circ * segs[0].frac} ${circ}`} {...sweep} />

      {/* centre total */}
      <circle cx={cx} cy={cy} r={r - sw / 2 - 2} fill={C.surface} />
      <text x={cx} y={cy - 1} textAnchor="middle" fontSize="13" fontWeight="700" fill={C.ink}>248</text>
      <text x={cx} y={cy + 9} textAnchor="middle" fontSize="6.5" fontWeight="600" fill={C.muted} letterSpacing="0.5">TOTAL</text>

      {/* legend */}
      {legend.map((l, i) => (
        <g key={i} transform={`translate(78 ${24 + i * 16})`}>
          <rect x="0" y="-6" width="8" height="8" rx="2.5" fill={l.color} />
          <text x="13" y="1" fontSize="7.5" fontWeight="600" fill={C.sub}>{l.label}</text>
          <text x="42" y="1" fontSize="7.5" fontWeight="700" fill={C.ink}>{l.val}</text>
        </g>
      ))}
    </IllustrationBase>
  )
}
