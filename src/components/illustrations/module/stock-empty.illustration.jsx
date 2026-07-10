/**
 * module/stock-empty — empty warehouse shelving for the low/no-stock empty
 * state. Bare racks with dashed "slot" outlines and a single lonely tyre.
 * Theme-aware, with a gentle idle float.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function StockEmptyIllustration({ size = 200, title = 'Out of stock', desc = 'No tyres in stock', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const float = on ? { animate: { y: [0, -3, 0] }, transition: { duration: 4.5, repeat: Infinity, ease: 'easeInOut' } } : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="120" cy="84" r="78" fill={`url(#${d.glow})`} opacity="0.5" />
      <ellipse cx="120" cy="156" rx="96" ry="10" fill="var(--text-primary)" opacity="0.06" />

      <g filter={`url(#${d.shadow})`}>
        {/* empty shelving frame */}
        <rect x="42" y="32" width="156" height="116" rx={G.radius}
              fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        <line x1="44" y1="72" x2="196" y2="72" stroke={C.line} strokeWidth={G.stroke} strokeLinecap="round" />
        <line x1="44" y1="112" x2="196" y2="112" stroke={C.line} strokeWidth={G.stroke} strokeLinecap="round" />
      </g>

      {/* empty dashed slot outlines — top shelf */}
      {[0, 1, 2].map((i) => (
        <rect key={`t${i}`} x={56 + i * 44} y={42} width="34" height="24" rx={G.radiusSm}
              fill="none" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeDasharray="4 5" />
      ))}
      {/* empty dashed slots — middle shelf */}
      {[0, 1, 2].map((i) => (
        <ellipse key={`m${i}`} cx={73 + i * 44} cy="94" rx="18" ry="14"
                 fill="none" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeDasharray="4 5" />
      ))}

      {/* the single remaining tyre — lonely, on the bottom shelf */}
      <motion.g {...float}>
        <g filter={`url(#${d.shadow})`}>
          <circle cx="120" cy="130" r="16" fill={C.ink} opacity="0.9" />
          <circle cx="120" cy="130" r="16" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
          <circle cx="120" cy="130" r="6" fill={C.surface} stroke={C.line} strokeWidth={G.strokeThin} />
        </g>
      </motion.g>

      {/* low-stock warning badge */}
      <g>
        <circle cx="172" cy="52" r="12" fill={C.surface} stroke={C.warning} strokeWidth={G.strokeThin} />
        <line x1="172" y1="46" x2="172" y2="54" stroke={C.warning} strokeWidth={G.stroke} strokeLinecap="round" />
        <circle cx="172" cy="58.5" r="1.6" fill={C.warning} />
      </g>
    </IllustrationBase>
  )
}
