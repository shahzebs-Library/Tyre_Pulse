/**
 * report/footer-strip — a branded footer strip for report pages: a brand rule, a
 * small tyre mark with the product wordmark space, and page/meta placeholders on
 * the right. Reads cleanly on light print surfaces; theme-aware for the dark app
 * UI. Motion off by default (footers are static/print); optional node pulse.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function FooterStripIllustration({ size = 320, title = 'Report footer', desc = 'Branded report footer', animate = false, decorative = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const pulse = on
    ? { animate: { opacity: [0.8, 1, 0.8] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 50" animate={animate} decorative={decorative} {...rest}>
      <BrandDefs d={d} />

      {/* top brand rule */}
      <line x1="16" y1="12" x2="304" y2="12" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
      <line x1="16" y1="12" x2="120" y2="12" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} strokeLinecap="round" />

      {/* left: tyre mark + wordmark space */}
      <motion.g {...pulse}>
        <circle cx="30" cy="30" r="10" fill={C.ink} opacity="0.9" />
        <circle cx="30" cy="30" r="10" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} />
        <circle cx="30" cy="30" r="3.5" fill={C.surface} />
      </motion.g>
      <rect x="48" y="24" width="56" height="6" rx="3" fill={`url(#${d.brand})`} />
      <rect x="48" y="34" width="80" height="4" rx="2" fill={C.lineSoft} />

      {/* right: meta / page number placeholders */}
      <rect x="214" y="25" width="52" height="4" rx="2" fill={C.lineSoft} />
      <rect x="214" y="34" width="34" height="4" rx="2" fill={C.lineSoft} opacity="0.8" />
      <g transform="translate(288 30)">
        <circle r="9" fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        <rect x="-4" y="-2" width="8" height="4" rx="2" fill={C.brand} />
      </g>
    </IllustrationBase>
  )
}
