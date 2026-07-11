/**
 * state/search-empty — a magnifier sweeping over an empty stretch of road with a
 * faint tyre track, for a "no search results" state. The magnifier drifts in a
 * gentle scanning arc when animate.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function SearchEmptyIllustration({ size = 200, title = 'No results found', desc = 'Try a different search', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const scan = on ? { animate: { x: [0, 10, 0], y: [0, -4, 0] }, transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } } : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="120" cy="92" r="70" fill={`url(#${d.glow})`} />
      <ellipse cx="120" cy="150" rx="72" ry="11" fill="var(--text-primary)" opacity="0.06" />

      {/* empty road with centre line + faint tyre track */}
      <g>
        <path d="M40 138 L96 96 L144 96 L200 138 Z" fill={`url(#${d.fade})`} opacity="0.5" />
        <path d="M40 138 L96 96 M200 138 L144 96" fill="none" stroke={C.line} strokeWidth={G.stroke} strokeLinecap="round" />
        <line x1="120" y1="100" x2="120" y2="134" stroke={C.lineSoft} strokeWidth={G.stroke} strokeLinecap="round" strokeDasharray="6 9" />
        {/* faint tyre track — nothing found on it */}
        <line x1="104" y1="132" x2="112" y2="104" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.4" strokeDasharray="3 5" />
        <line x1="116" y1="132" x2="122" y2="104" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.4" strokeDasharray="3 5" />
      </g>

      {/* magnifier */}
      <motion.g {...scan}>
        <g filter={`url(#${d.shadow})`}>
          <circle cx="118" cy="78" r="30" fill={C.surface} opacity="0.55" />
          <circle cx="118" cy="78" r="30" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
          <circle cx="118" cy="78" r="30" fill="none" stroke={C.brandElectric} strokeWidth={G.strokeThin} opacity="0.5" />
          {/* highlight glint */}
          <path d="M104 68 a18 18 0 0 1 14 -10" fill="none" stroke={C.surface} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.7" />
          {/* handle */}
          <line x1="140" y1="100" x2="158" y2="118" stroke={C.sub} strokeWidth="6" strokeLinecap="round" />
          {/* empty ⌀ mark */}
          <line x1="108" y1="88" x2="128" y2="68" stroke={C.muted} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.7" />
        </g>
      </motion.g>
    </IllustrationBase>
  )
}
