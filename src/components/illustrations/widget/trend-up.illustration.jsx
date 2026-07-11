/**
 * widget/trend-up — a rising bar chart with an overlaid trend line and an arrow
 * head; bars grow and the line draws when animated. Theme-aware; used as a
 * dashboard micro-widget signalling positive growth / improving performance.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

const BARS = [
  { x: 16, h: 20 },
  { x: 34, h: 30 },
  { x: 52, h: 26 },
  { x: 70, h: 42 },
  { x: 88, h: 52 },
]
const BASE_Y = 66
const BAR_W = 12

export default function TrendUpIllustration({ size = 120, title = 'Trend up', desc = 'Rising trend', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const line = on
    ? { animate: { pathLength: [0, 1], opacity: [0.4, 1] }, transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 120 80" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* tile */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="4" y="4" width="112" height="72" rx={G.radius}
              fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      </g>

      {/* baseline */}
      <line x1="14" y1={BASE_Y} x2="106" y2={BASE_Y} stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />

      {/* bars */}
      {BARS.map((b, i) => {
        const grow = on
          ? { initial: { scaleY: 0 }, animate: { scaleY: 1 }, transition: { duration: 0.7, delay: 0.12 * i, ease: [0.22, 1, 0.36, 1] } }
          : {}
        const last = i === BARS.length - 1
        return (
          <motion.rect key={i}
            x={b.x} y={BASE_Y - b.h} width={BAR_W} height={b.h} rx={G.radiusSm}
            fill={last ? `url(#${d.brand})` : C.line}
            opacity={last ? 1 : 0.55}
            style={{ transformOrigin: `${b.x}px ${BASE_Y}px` }} {...grow} />
        )
      })}

      {/* trend line + arrow head */}
      <motion.path d="M22 50 L40 42 L58 46 L76 30 L98 16"
        fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke}
        strokeLinecap="round" strokeLinejoin="round" {...line} />
      <path d="M98 16 L90 18 M98 16 L96 24" fill="none" stroke={C.brandBright}
        strokeWidth={G.stroke} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="98" cy="16" r="3" fill={C.brandBright} />
    </IllustrationBase>
  )
}
