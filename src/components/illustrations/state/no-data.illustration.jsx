/**
 * state/no-data — the canonical example illustration. Contributors: copy this
 * pattern. A branded tyre sitting on a baseline with an empty dashed "data"
 * card, all theme-aware via tokens, with a slow idle float.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function NoDataIllustration({ size = 200, title = 'No data yet', desc = 'Nothing here to show', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const float = animate && !reduce
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient glow */}
      <ellipse cx="120" cy="150" rx="78" ry="12" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="120" cy="86" r="70" fill={`url(#${d.glow})`} />

      <motion.g {...float}>
        {/* empty dashed data card */}
        <rect x="70" y="34" width="100" height="60" rx={G.radius}
              fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        <line x1="84" y1="52" x2="140" y2="52" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" strokeDasharray="4 6" />
        <line x1="84" y1="66" x2="156" y2="66" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" strokeDasharray="4 6" />
        <line x1="84" y1="80" x2="122" y2="80" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" strokeDasharray="4 6" />

        {/* tyre */}
        <g filter={`url(#${d.shadow})`}>
          <circle cx="120" cy="118" r="34" fill={C.ink} opacity="0.9" />
          <circle cx="120" cy="118" r="34" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
          <circle cx="120" cy="118" r="16" fill={C.surface} />
          <circle cx="120" cy="118" r="16" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
          {/* tread ticks */}
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2
            const x1 = 120 + Math.cos(a) * 26, y1 = 118 + Math.sin(a) * 26
            const x2 = 120 + Math.cos(a) * 32, y2 = 118 + Math.sin(a) * 32
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
          })}
        </g>
      </motion.g>
    </IllustrationBase>
  )
}
