/**
 * marker/alert — a danger-accented teardrop map pin holding a caution glyph,
 * with a throbbing halo when animated. Theme-aware via C.danger. Used to plot an
 * incident / breakdown / active alert location on maps.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

const PIN = 'M32 74 C18 54 10 44 10 30 A22 22 0 1 1 54 30 C54 44 46 54 32 74 Z'

export default function AlertMarkerIllustration({ size = 64, title = 'Alert', desc = 'Incident location', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const throb = on
    ? { animate: { scale: [1, 1.4], opacity: [0.5, 0] }, transition: { duration: 1.6, repeat: Infinity, ease: 'easeOut' } }
    : {}
  const shadow = on
    ? { animate: { scaleX: [1, 0.86, 1], opacity: [0.18, 0.1, 0.18] }, transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 64 80" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* danger halo behind the pin head */}
      <motion.circle cx="32" cy="30" r="20" fill="none" stroke={C.danger} strokeWidth={G.strokeThin}
        style={{ transformOrigin: '32px 30px' }} {...throb} />

      <motion.ellipse cx="32" cy="76" rx="12" ry="3.5" fill="var(--text-primary)"
        style={{ transformOrigin: '32px 76px' }} {...shadow} />

      <motion.g {...float}>
        <g filter={`url(#${d.shadow})`}>
          {/* danger-filled pin */}
          <path d={PIN} fill={C.danger} />
          <path d={PIN} fill="none" stroke={C.surface} strokeWidth={G.strokeThin} strokeLinejoin="round" opacity="0.4" />
        </g>

        {/* glyph disc */}
        <circle cx="32" cy="30" r="14" fill={C.surface} />

        {/* caution triangle + bang */}
        <path d="M32 21 L42 39 Q43 41 40.5 41 L23.5 41 Q21 41 22 39 Z"
              fill={C.danger} opacity="0.95" />
        <rect x="30.7" y="28" width="2.6" height="6.5" rx="1.3" fill={C.surface} />
        <circle cx="32" cy="38" r="1.5" fill={C.surface} />
      </motion.g>
    </IllustrationBase>
  )
}
