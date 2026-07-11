/**
 * badge/status-critical — a red critical status badge: an octagon "stop" core
 * with a bang over a pulsing danger ring, theme-aware via C.danger. Signals a
 * failure or safety-critical condition (blowout risk, over-temperature, breach).
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

// Regular octagon points around (32,32), radius 13.
const OCT = Array.from({ length: 8 }).map((_, i) => {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8
  return `${(32 + Math.cos(a) * 13).toFixed(2)} ${(32 + Math.sin(a) * 13).toFixed(2)}`
}).join(' ')

export default function StatusCriticalIllustration({ size = 64, title = 'Critical', desc = 'Critical failure — act now', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const throb = on
    ? { animate: { scale: [1, 1.45], opacity: [0.55, 0] }, transition: { duration: 1.4, repeat: Infinity, ease: 'easeOut' } }
    : {}
  const bang = on
    ? { animate: { opacity: [1, 0.4, 1] }, transition: { duration: 1, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 64 64" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* danger halo */}
      <circle cx="32" cy="32" r="30" fill={C.danger} opacity="0.12" />

      {/* throbbing alert ring */}
      <motion.circle
        cx="32" cy="32" r="19" fill="none" stroke={C.danger} strokeWidth={G.strokeThin}
        style={{ transformOrigin: '32px 32px' }} {...throb} />

      {/* badge body */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="32" cy="32" r="20" fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        <circle cx="32" cy="32" r="20" fill="none" stroke={C.danger} strokeWidth={G.stroke} />

        {/* stop octagon */}
        <polygon points={OCT} fill={C.danger} />
        <polygon points={OCT} fill="none" stroke={C.surface} strokeWidth={G.strokeThin} strokeLinejoin="round" opacity="0.5" />

        {/* exclamation */}
        <motion.g {...bang}>
          <rect x="30.5" y="26" width="3" height="8.5" rx="1.5" fill={C.surface} />
          <circle cx="32" cy="38.5" r="1.9" fill={C.surface} />
        </motion.g>
      </g>
    </IllustrationBase>
  )
}
