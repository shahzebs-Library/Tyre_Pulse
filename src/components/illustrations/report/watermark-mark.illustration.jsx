/**
 * report/watermark-mark — a faint, large tyre + pulse-wave watermark for page
 * backgrounds behind report content. Intentionally low-contrast/low-opacity so
 * text stays readable on top; theme-aware so it fades correctly on light print
 * and dark UI. Motion off by default (background element); optional slow drift.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function WatermarkMarkIllustration({ size = 200, title = 'Tyre Pulse watermark', desc = 'Background brand watermark', animate = false, decorative = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const drift = on
    ? { animate: { rotate: [0, 4, 0] }, transition: { duration: 12, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  const R = 78
  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 200 200" animate={animate} decorative={decorative} {...rest}>
      <BrandDefs d={d} />

      {/* whole mark held at watermark opacity */}
      <g opacity="0.08">
        <motion.g {...drift} style={{ transformOrigin: '100px 100px' }}>
          {/* outer tyre ring */}
          <circle cx="100" cy="100" r={R} fill="none" stroke={C.ink} strokeWidth="10" />
          {/* tread ticks */}
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i / 24) * Math.PI * 2
            const x1 = 100 + Math.cos(a) * (R - 8), y1 = 100 + Math.sin(a) * (R - 8)
            const x2 = 100 + Math.cos(a) * (R + 2), y2 = 100 + Math.sin(a) * (R + 2)
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brand} strokeWidth="3" strokeLinecap="round" />
          })}
          {/* inner hub ring */}
          <circle cx="100" cy="100" r="34" fill="none" stroke={C.ink} strokeWidth={G.stroke} />
        </motion.g>

        {/* pulse wave through the hub */}
        <path d="M56 100 H80 L88 78 L100 122 L112 88 L120 100 H144"
              fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke}
              strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </IllustrationBase>
  )
}
