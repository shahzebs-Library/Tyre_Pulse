/**
 * error/500 — a "5 0 0" wordmark where the middle 0 is a branded tyre, fronted
 * by a stacked server rack with a warning light, for an internal server error.
 * Wider 260x180 viewBox for the numerals. The warning light pulses and the tyre
 * turns slowly when animate.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function ServerErrorIllustration({ size = 240, title = 'Server error', desc = 'Something broke on our end', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const spin = on ? { animate: { rotate: 360 }, transition: { duration: 8, repeat: Infinity, ease: 'linear' } } : {}
  const blink = on ? { animate: { opacity: [1, 0.25, 1] }, transition: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } } : {}

  const Digit = ({ x }) => (
    <text x={x} y="96" textAnchor="middle" fontSize="92" fontWeight="800"
          fontFamily="ui-sans-serif, system-ui, sans-serif" fill={C.ink} opacity="0.92"
          style={{ letterSpacing: '-2px' }}>5</text>
  )

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 260 180" animate={animate} {...rest}>
      <BrandDefs d={d} />

      <ellipse cx="130" cy="152" rx="104" ry="12" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="130" cy="72" r="80" fill={`url(#${d.glow})`} />

      {/* 5 _ 0(=tyre) */}
      <Digit x="62" />
      {/* third glyph rendered as a plain 0 outline to keep the tyre distinct */}
      <text x="198" y="96" textAnchor="middle" fontSize="92" fontWeight="800"
            fontFamily="ui-sans-serif, system-ui, sans-serif" fill={C.ink} opacity="0.92"
            style={{ letterSpacing: '-2px' }}>0</text>

      {/* tyre as the middle 0 */}
      <motion.g style={{ originX: '130px', originY: '72px', transformBox: 'fill-box' }} {...spin}>
        <g filter={`url(#${d.shadow})`}>
          <circle cx="130" cy="72" r="40" fill={C.ink} opacity="0.9" />
          <circle cx="130" cy="72" r="40" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
          <circle cx="130" cy="72" r="17" fill={C.surface} />
          <circle cx="130" cy="72" r="17" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2
            const x1 = 130 + Math.cos(a) * 29, y1 = 72 + Math.sin(a) * 29
            const x2 = 130 + Math.cos(a) * 36, y2 = 72 + Math.sin(a) * 36
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
          })}
        </g>
      </motion.g>

      {/* server rack in the foreground */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="96" y="104" width="68" height="52" rx={G.radiusSm} fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.stroke} />
        {/* two rack units */}
        <line x1="104" y1="122" x2="156" y2="122" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
        <line x1="104" y1="140" x2="156" y2="140" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
        {/* status LEDs — one danger, blinking */}
        <motion.circle cx="150" cy="116" r="3.4" fill={C.danger} {...blink} />
        <circle cx="150" cy="134" r="3.4" fill={C.brandBright} opacity="0.8" />
        {/* vents */}
        <line x1="106" y1="150" x2="120" y2="150" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.6" />
      </g>

      {/* warning triangle over the rack */}
      <motion.g {...blink}>
        <path d="M130 90 L146 118 A4 4 0 0 1 142 124 L118 124 A4 4 0 0 1 114 118 Z"
              fill={C.surface} stroke={C.danger} strokeWidth={G.stroke} strokeLinejoin="round" />
        <line x1="130" y1="102" x2="130" y2="112" stroke={C.danger} strokeWidth={G.strokeThin} strokeLinecap="round" />
        <circle cx="130" cy="118" r="1.8" fill={C.danger} />
      </motion.g>
    </IllustrationBase>
  )
}
