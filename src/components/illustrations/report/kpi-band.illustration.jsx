/**
 * report/kpi-band — a horizontal band of four KPI chips (CPK, tyre life, failure
 * rate, pressure compliance style) with sparkline/gauge motifs. Used as a header
 * strip on report screens and generated dashboards. Reads cleanly on light print
 * surfaces; fully theme-aware. Motion off by default; optional sparkline draw.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function KpiBandIllustration({ size = 320, title = 'KPI band', desc = 'Key performance indicators', animate = false, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const draw = on
    ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 1.1, ease: 'easeOut' } }
    : {}

  // four evenly spaced chips
  const chipW = 70, gap = 8, x0 = 8, y = 12, h = 66
  const chips = [0, 1, 2, 3].map((i) => x0 + i * (chipW + gap))

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 90" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {chips.map((x, i) => (
        <g key={i} filter={`url(#${d.shadow})`}>
          <rect x={x} y={y} width={chipW} height={h} rx={G.radius}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
          {/* accent tab */}
          <rect x={x} y={y} width="5" height={h} rx="2.5" fill={`url(#${d.brand})`} />
          {/* label + value placeholders */}
          <rect x={x + 14} y={y + 12} width={chipW - 26} height="4" rx="2" fill={C.lineSoft} />
          <rect x={x + 14} y={y + 22} width={chipW - 40} height="8" rx="3" fill={`url(#${d.brand})`} opacity="0.9" />
        </g>
      ))}

      {/* chip 0: sparkline trend */}
      <motion.path d={`M${chips[0] + 14} 66 L${chips[0] + 26} 60 L${chips[0] + 38} 64 L${chips[0] + 50} 52 L${chips[0] + 60} 56`}
            fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin}
            strokeLinecap="round" strokeLinejoin="round" {...draw} />

      {/* chip 1: mini bars */}
      {[8, 14, 10, 18].map((bh, j) => (
        <rect key={j} x={chips[1] + 14 + j * 12} y={68 - bh} width="7" height={bh} rx="2"
              fill={j === 3 ? `url(#${d.brand})` : C.line} opacity={j === 3 ? 1 : 0.6} />
      ))}

      {/* chip 2: donut / failure gauge */}
      <g transform={`translate(${chips[2] + 38} 56)`}>
        <circle r="12" fill="none" stroke={C.lineSoft} strokeWidth={G.stroke} />
        <motion.circle r="12" fill="none" stroke={C.warning} strokeWidth={G.stroke}
              strokeLinecap="round" strokeDasharray="46 76" transform="rotate(-90)" {...draw} />
      </g>

      {/* chip 3: pressure compliance gauge */}
      <g transform={`translate(${chips[3] + 38} 60)`}>
        <path d="M-14 0 A14 14 0 0 1 14 0" fill="none" stroke={C.lineSoft} strokeWidth={G.stroke} strokeLinecap="round" />
        <motion.path d="M-14 0 A14 14 0 0 1 10 -10" fill="none" stroke={`url(#${d.brand})`}
              strokeWidth={G.stroke} strokeLinecap="round" {...draw} />
      </g>
    </IllustrationBase>
  )
}
