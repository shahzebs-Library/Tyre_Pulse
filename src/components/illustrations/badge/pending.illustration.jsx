/**
 * badge/pending — a clock-face "pending / in review" badge; the minute hand
 * sweeps slowly when animated. Signals awaiting-action state (approval queued,
 * inspection scheduled, order processing) using neutral + brand accent tokens.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function PendingIllustration({ size = 64, title = 'Pending', desc = 'Awaiting action', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const sweep = on
    ? { animate: { rotate: 360 }, transition: { duration: 8, repeat: Infinity, ease: 'linear' } }
    : {}
  const tick = on
    ? { animate: { rotate: 360 }, transition: { duration: 32, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 64 64" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* soft halo */}
      <circle cx="32" cy="32" r="30" fill={`url(#${d.glow})`} opacity="0.7" />

      {/* clock body */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="32" cy="32" r="20" fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        <circle cx="32" cy="32" r="20" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} opacity="0.85" />

        {/* hour ticks */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2
          const x1 = 32 + Math.cos(a) * 15, y1 = 32 + Math.sin(a) * 15
          const x2 = 32 + Math.cos(a) * 17, y2 = 32 + Math.sin(a) * 17
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.muted} strokeWidth="1.4" strokeLinecap="round" opacity={i % 3 === 0 ? 0.9 : 0.45} />
        })}

        {/* hour hand */}
        <motion.g style={{ transformOrigin: '32px 32px' }} {...tick}>
          <line x1="32" y1="32" x2="32" y2="24" stroke={C.sub} strokeWidth={G.stroke} strokeLinecap="round" />
        </motion.g>
        {/* minute hand */}
        <motion.g style={{ transformOrigin: '32px 32px' }} {...sweep}>
          <line x1="32" y1="32" x2="40" y2="32" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} strokeLinecap="round" />
        </motion.g>
        <circle cx="32" cy="32" r="2.4" fill={C.brandBright} />
      </g>
    </IllustrationBase>
  )
}
