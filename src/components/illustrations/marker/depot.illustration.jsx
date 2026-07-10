/**
 * marker/depot — a branded teardrop map pin holding a depot / warehouse glyph,
 * hovering over a soft ground shadow. Theme-aware; the pin gives a slow idle
 * float when animated. Used to plot a depot / branch location on maps.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

// Teardrop pin: round top (cx 32, cy 30, r 22) tapering to a point at (32, 74).
const PIN = 'M32 74 C18 54 10 44 10 30 A22 22 0 1 1 54 30 C54 44 46 54 32 74 Z'

export default function DepotMarkerIllustration({ size = 64, title = 'Depot', desc = 'Depot location', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const shadow = on
    ? { animate: { scaleX: [1, 0.86, 1], opacity: [0.18, 0.1, 0.18] }, transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 64 80" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ground shadow */}
      <motion.ellipse cx="32" cy="76" rx="12" ry="3.5" fill="var(--text-primary)"
        style={{ transformOrigin: '32px 76px' }} {...shadow} />

      <motion.g {...float}>
        <g filter={`url(#${d.shadow})`}>
          <path d={PIN} fill={`url(#${d.brand})`} />
          <path d={PIN} fill="none" stroke={C.surface} strokeWidth={G.strokeThin} strokeLinejoin="round" opacity="0.4" />
        </g>

        {/* glyph disc */}
        <circle cx="32" cy="30" r="14" fill={C.surface} />

        {/* warehouse glyph */}
        <path d="M20 30 L32 22 L44 30 Z" fill={`url(#${d.brand})`} opacity="0.9" />
        <rect x="22" y="30" width="20" height="10" rx="1.5" fill={C.surface} stroke={C.line} strokeWidth="1.4" />
        <rect x="28" y="33" width="8" height="7" fill={`url(#${d.brand})`} opacity="0.85" />
        <line x1="24" y1="36" x2="26" y2="36" stroke={C.muted} strokeWidth="1.2" strokeLinecap="round" />
        <line x1="38" y1="36" x2="40" y2="36" stroke={C.muted} strokeWidth="1.2" strokeLinecap="round" />
      </motion.g>
    </IllustrationBase>
  )
}
