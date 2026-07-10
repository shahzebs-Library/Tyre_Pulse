/**
 * report/chart-frame — a framed placeholder chart motif (axes + gridlines, bars
 * and a trend line) used where a rendered chart will sit in a report, or as an
 * empty/decorative stand-in. Reads cleanly on light print surfaces; theme-aware
 * for the dark app UI. Motion off by default; optional trend-line draw.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function ChartFrameIllustration({ size = 240, title = 'Chart', desc = 'Framed chart placeholder', animate = false, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const draw = on
    ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 1.2, ease: 'easeOut' } }
    : {}

  // plot area
  const px = 40, py = 24, pw = 180, ph = 96
  const baseY = py + ph
  const bars = [30, 48, 40, 66, 54, 78]
  const barW = 16, step = pw / bars.length

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 240 160" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* frame card */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="12" y="10" width="216" height="140" rx={G.radius}
              fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      </g>

      {/* title + legend chips */}
      <rect x="24" y="20" width="70" height="6" rx="3" fill={`url(#${d.brand})`} />
      <circle cx="176" cy="23" r="3.5" fill={C.brandBright} />
      <rect x="184" y="21" width="18" height="4" rx="2" fill={C.lineSoft} />
      <circle cx="176" cy="34" r="3.5" fill={C.line} />
      <rect x="184" y="32" width="26" height="4" rx="2" fill={C.lineSoft} />

      {/* gridlines */}
      {[0.25, 0.5, 0.75].map((t, i) => (
        <line key={i} x1={px} y1={py + ph * t} x2={px + pw} y2={py + ph * t}
              stroke={C.lineSoft} strokeWidth="1" strokeDasharray="3 5" opacity="0.9" />
      ))}

      {/* axes */}
      <line x1={px} y1={py} x2={px} y2={baseY} stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" />
      <line x1={px} y1={baseY} x2={px + pw} y2={baseY} stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" />

      {/* bars */}
      {bars.map((bh, i) => {
        const cx = px + step * i + step / 2
        return (
          <rect key={i} x={cx - barW / 2} y={baseY - bh} width={barW} height={bh} rx="3"
                fill={i === bars.length - 1 ? `url(#${d.brand})` : C.line}
                opacity={i === bars.length - 1 ? 1 : 0.55} />
        )
      })}

      {/* trend line across bar tops */}
      <motion.path
        d={bars.map((bh, i) => {
          const cx = px + step * i + step / 2
          return `${i === 0 ? 'M' : 'L'}${cx} ${baseY - bh - 6}`
        }).join(' ')}
        fill="none" stroke={C.brandBright} strokeWidth={G.stroke}
        strokeLinecap="round" strokeLinejoin="round" {...draw} />
    </IllustrationBase>
  )
}
