/**
 * marker/vehicle — a branded teardrop map pin holding a side-view truck glyph,
 * hovering over a soft ground shadow. Theme-aware; the pin gives a slow idle
 * float when animated. Used to plot a vehicle's live location on maps.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

const PIN = 'M32 74 C18 54 10 44 10 30 A22 22 0 1 1 54 30 C54 44 46 54 32 74 Z'

export default function VehicleMarkerIllustration({ size = 64, title = 'Vehicle', desc = 'Vehicle location', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 4.4, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const shadow = on
    ? { animate: { scaleX: [1, 0.86, 1], opacity: [0.18, 0.1, 0.18] }, transition: { duration: 4.4, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 64 80" animate={animate} {...rest}>
      <BrandDefs d={d} />

      <motion.ellipse cx="32" cy="76" rx="12" ry="3.5" fill="var(--text-primary)"
        style={{ transformOrigin: '32px 76px' }} {...shadow} />

      <motion.g {...float}>
        <g filter={`url(#${d.shadow})`}>
          <path d={PIN} fill={`url(#${d.brand})`} />
          <path d={PIN} fill="none" stroke={C.surface} strokeWidth={G.strokeThin} strokeLinejoin="round" opacity="0.4" />
        </g>

        {/* glyph disc */}
        <circle cx="32" cy="30" r="14" fill={C.surface} />

        {/* truck glyph (cab + box) */}
        <g>
          <rect x="21" y="26" width="13" height="8" rx="1.5" fill={`url(#${d.brand})`} opacity="0.9" />
          <path d="M34 28 L40 28 L43 32 L43 34 L34 34 Z" fill={`url(#${d.brand})`} opacity="0.9" />
          <rect x="36" y="29.5" width="4" height="3" rx="0.6" fill={C.surface} opacity="0.85" />
          {/* wheels */}
          <circle cx="26" cy="35" r="2.6" fill={C.ink} />
          <circle cx="26" cy="35" r="1" fill={C.surface} />
          <circle cx="39" cy="35" r="2.6" fill={C.ink} />
          <circle cx="39" cy="35" r="1" fill={C.surface} />
        </g>
      </motion.g>
    </IllustrationBase>
  )
}
