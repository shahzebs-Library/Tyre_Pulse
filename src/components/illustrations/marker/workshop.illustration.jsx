/**
 * marker/workshop — a branded teardrop map pin holding a crossed wrench +
 * screwdriver service glyph, hovering over a soft ground shadow. Theme-aware;
 * slow idle float when animated. Used to plot a workshop / service centre.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

const PIN = 'M32 74 C18 54 10 44 10 30 A22 22 0 1 1 54 30 C54 44 46 54 32 74 Z'

export default function WorkshopMarkerIllustration({ size = 64, title = 'Workshop', desc = 'Service centre location', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const shadow = on
    ? { animate: { scaleX: [1, 0.86, 1], opacity: [0.18, 0.1, 0.18] }, transition: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' } }
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

        {/* crossed tools */}
        <g stroke={`url(#${d.brand})`} strokeWidth="2.6" strokeLinecap="round" fill="none">
          {/* wrench */}
          <path d="M25 23 a3 3 0 0 0 4 4 L38 36" opacity="0.9" />
          {/* screwdriver */}
          <line x1="39" y1="23" x2="27" y2="37" opacity="0.9" />
        </g>
        <path d="M25 23 a3 3 0 0 0 4 4" fill="none" stroke={C.brandBright} strokeWidth="2.6" strokeLinecap="round" />
        <rect x="37" y="21.5" width="4.5" height="3.5" rx="1" transform="rotate(45 39 23)" fill={`url(#${d.brand})`} />
      </motion.g>
    </IllustrationBase>
  )
}
