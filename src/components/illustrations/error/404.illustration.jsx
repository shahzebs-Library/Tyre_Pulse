/**
 * error/404 — a "4 0 4" wordmark where the middle 0 is a branded tyre, over a
 * lost stretch of road that trails off the edge. Wider 260x180 viewBox for the
 * numerals. The tyre spins slowly and the road dashes drift when animate.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function NotFoundIllustration({ size = 240, title = 'Page not found', desc = 'This route took a wrong turn', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const spin = on ? { animate: { rotate: 360 }, transition: { duration: 6, repeat: Infinity, ease: 'linear' } } : {}
  const drift = on ? { animate: { strokeDashoffset: [0, -28] }, transition: { duration: 1.6, repeat: Infinity, ease: 'linear' } } : {}

  const Digit = ({ x }) => (
    <text x={x} y="96" textAnchor="middle" fontSize="92" fontWeight="800"
          fontFamily="ui-sans-serif, system-ui, sans-serif" fill={C.ink} opacity="0.92"
          style={{ letterSpacing: '-2px' }}>4</text>
  )

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 260 180" animate={animate} {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="130" cy="150" rx="104" ry="12" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="130" cy="72" r="80" fill={`url(#${d.glow})`} />

      {/* lost road running off toward the horizon */}
      <path d="M20 150 L108 118 L152 118 L240 150" fill="none" stroke={C.line} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.7" />
      <motion.line x1="130" y1="150" x2="130" y2="120" stroke={C.brand} strokeWidth={G.stroke} strokeLinecap="round"
                   strokeDasharray="7 8" {...drift} />

      {/* 4 _ 4 */}
      <Digit x="62" />
      <Digit x="198" />

      {/* tyre as the middle 0 */}
      <circle cx="130" cy="72" r="66" fill={`url(#${d.glow})`} />
      <motion.g style={{ originX: '130px', originY: '72px', transformBox: 'fill-box' }} {...spin}>
        <g filter={`url(#${d.shadow})`}>
          <circle cx="130" cy="72" r="42" fill={C.ink} opacity="0.9" />
          <circle cx="130" cy="72" r="42" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
          <circle cx="130" cy="72" r="18" fill={C.surface} />
          <circle cx="130" cy="72" r="18" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2
            const x1 = 130 + Math.cos(a) * 31, y1 = 72 + Math.sin(a) * 31
            const x2 = 130 + Math.cos(a) * 38, y2 = 72 + Math.sin(a) * 38
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
          })}
          {Array.from({ length: 5 }).map((_, i) => {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2
            const x2 = 130 + Math.cos(a) * 16, y2 = 72 + Math.sin(a) * 16
            return <line key={i} x1="130" y1="72" x2={x2} y2={y2} stroke={C.brand} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.7" />
          })}
        </g>
      </motion.g>
    </IllustrationBase>
  )
}
