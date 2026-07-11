/**
 * badge/status-warning — an amber caution status badge: a triangle-with-bang
 * over a soft ring, theme-aware via C.warning. Signals attention needed
 * (pressure drifting, inspection due, threshold approaching).
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function StatusWarningIllustration({ size = 64, title = 'Warning', desc = 'Attention required', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const blink = on
    ? { animate: { opacity: [1, 0.35, 1] }, transition: { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 64 64" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient amber halo */}
      <circle cx="32" cy="32" r="30" fill={C.warning} opacity="0.1" />

      {/* badge body */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="32" cy="32" r="20" fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        <circle cx="32" cy="32" r="20" fill="none" stroke={C.warning} strokeWidth={G.stroke} opacity="0.85" />

        {/* caution triangle */}
        <path d="M32 20 L45 42 Q46 44 43.5 44 L20.5 44 Q18 44 19 42 Z"
              fill={C.warning} opacity="0.95" />
        <path d="M32 20 L45 42 Q46 44 43.5 44 L20.5 44 Q18 44 19 42 Z"
              fill="none" stroke={C.surface} strokeWidth={G.strokeThin} strokeLinejoin="round" opacity="0.55" />

        {/* exclamation */}
        <motion.g {...blink}>
          <rect x="30.5" y="28" width="3" height="8" rx="1.5" fill={C.surface} />
          <circle cx="32" cy="40" r="1.8" fill={C.surface} />
        </motion.g>
      </g>
    </IllustrationBase>
  )
}
