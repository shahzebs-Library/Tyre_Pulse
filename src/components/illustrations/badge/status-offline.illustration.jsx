/**
 * badge/status-offline — a muted/grey offline status badge: a hollow ring with a
 * severed-signal slash, drawn entirely from neutral theme tokens (no brand /
 * semantic accent) so it reads as "no signal / disconnected / dormant".
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function StatusOfflineIllustration({ size = 64, title = 'Offline', desc = 'Disconnected — no signal', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const fade = on
    ? { animate: { opacity: [0.55, 0.25, 0.55] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 64 64" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* faint neutral halo */}
      <circle cx="32" cy="32" r="30" fill={C.muted} opacity="0.08" />

      {/* badge body */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="32" cy="32" r="20" fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        <circle cx="32" cy="32" r="20" fill="none" stroke={C.muted} strokeWidth={G.stroke} strokeDasharray="3 4" opacity="0.7" />

        {/* dim signal core */}
        <motion.g {...fade}>
          <circle cx="32" cy="32" r="8" fill="none" stroke={C.muted} strokeWidth={G.strokeThin} />
          <circle cx="32" cy="32" r="3" fill={C.dim} />
        </motion.g>

        {/* disconnected slash */}
        <line x1="21" y1="21" x2="43" y2="43" stroke={C.dim} strokeWidth={G.stroke} strokeLinecap="round" />
        <line x1="21" y1="21" x2="43" y2="43" stroke={C.surface} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.5" />
      </g>
    </IllustrationBase>
  )
}
