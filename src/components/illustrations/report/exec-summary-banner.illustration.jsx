/**
 * report/exec-summary-banner — an executive summary header banner: a brand-tinted
 * panel with a document/insight glyph, a heading + subheading space, and a small
 * KPI trend chip on the right. Reads cleanly on light print surfaces; theme-aware
 * for the dark app UI. Motion off by default; optional trend draw + subtle lift.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function ExecSummaryBannerIllustration({ size = 320, title = 'Executive summary', desc = 'Executive summary banner', animate = false, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const draw = on
    ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 1.1, ease: 'easeOut' } }
    : {}
  const lift = on
    ? { animate: { y: [0, -2, 0] }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 100" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* banner panel */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="8" y="12" width="304" height="76" rx={G.radius}
              fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      </g>
      {/* brand accent bar */}
      <rect x="8" y="12" width="8" height="76" rx="4" fill={`url(#${d.brand})`} />
      {/* faint brand wash */}
      <rect x="16" y="12" width="150" height="76" fill={`url(#${d.glow})`} opacity="0.5" />

      <motion.g {...lift}>
        {/* insight document glyph */}
        <g filter={`url(#${d.shadow})`}>
          <rect x="30" y="30" width="40" height="40" rx={G.radiusSm}
                fill={C.surface} stroke={C.line} strokeWidth={G.strokeThin} />
        </g>
        <rect x="37" y="38" width="20" height="4" rx="2" fill={`url(#${d.brand})`} />
        <rect x="37" y="46" width="26" height="3" rx="1.5" fill={C.lineSoft} />
        <rect x="37" y="53" width="22" height="3" rx="1.5" fill={C.lineSoft} />
        {/* insight spark */}
        <path d="M60 60 l3 -6 l3 6 l6 3 l-6 3 l-3 6 l-3 -6 l-6 -3 z"
              fill={C.brandBright} opacity="0.9" transform="translate(2 2) scale(0.6)" />
      </motion.g>

      {/* heading + subheading placeholders */}
      <rect x="88" y="34" width="120" height="9" rx="4.5" fill={`url(#${d.brand})`} />
      <rect x="88" y="49" width="150" height="5" rx="2.5" fill={C.lineSoft} />
      <rect x="88" y="59" width="120" height="5" rx="2.5" fill={C.lineSoft} />

      {/* right KPI trend chip */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="250" y="30" width="52" height="40" rx={G.radiusSm}
              fill={C.surface} stroke={C.line} strokeWidth={G.strokeThin} />
      </g>
      <rect x="258" y="37" width="24" height="5" rx="2.5" fill={`url(#${d.brand})`} opacity="0.9" />
      <motion.path d="M258 60 L266 54 L274 58 L294 46"
            fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin}
            strokeLinecap="round" strokeLinejoin="round" {...draw} />
    </IllustrationBase>
  )
}
