/**
 * badge/status-active — a compact "active / healthy" status badge: a branded
 * ring with a solid dot core and an expanding pulse ring, theme-aware. Signals a
 * live, operational asset (vehicle online, sensor reporting, service healthy).
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function StatusActiveIllustration({ size = 64, title = 'Active', desc = 'Healthy and operational', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const pulse = on
    ? { animate: { scale: [1, 1.6], opacity: [0.5, 0] }, transition: { duration: 2, repeat: Infinity, ease: 'easeOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 64 64" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient glow */}
      <circle cx="32" cy="32" r="30" fill={`url(#${d.glow})`} />

      {/* expanding pulse ring */}
      <motion.circle
        cx="32" cy="32" r="18" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin}
        style={{ transformOrigin: '32px 32px' }} {...pulse} />

      {/* badge body */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="32" cy="32" r="20" fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        <circle cx="32" cy="32" r="20" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} opacity="0.9" />
        {/* core dot */}
        <circle cx="32" cy="32" r="8" fill={`url(#${d.brand})`} />
        <circle cx="32" cy="32" r="8" fill="none" stroke={C.surface} strokeWidth={G.strokeThin} opacity="0.5" />
      </g>
    </IllustrationBase>
  )
}
