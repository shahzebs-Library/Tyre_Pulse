/**
 * module/inspections — an inspection checklist clipboard over a tyre with a
 * magnifier examining the tread. Theme-aware via tokens with a slow float and a
 * gentle magnifier drift.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function InspectionsIllustration({ size = 200, title = 'No inspections yet', desc = 'Run a tyre inspection to capture readings', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const float = on
    ? { animate: { y: [0, -3, 0] }, transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const scan = on
    ? { animate: { x: [0, 6, 0], y: [0, -4, 0] }, transition: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ground + ambient glow */}
      <ellipse cx="120" cy="156" rx="88" ry="12" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="120" cy="90" r="74" fill={`url(#${d.glow})`} />

      {/* tyre under inspection */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="92" cy="112" r="36" fill={C.ink} opacity="0.9" />
        <circle cx="92" cy="112" r="36" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
        <circle cx="92" cy="112" r="16" fill={C.surface} />
        <circle cx="92" cy="112" r="16" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2
          const x1 = 92 + Math.cos(a) * 27, y1 = 112 + Math.sin(a) * 27
          const x2 = 92 + Math.cos(a) * 33, y2 = 112 + Math.sin(a) * 33
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        })}
      </g>

      {/* inspection checklist clipboard */}
      <motion.g {...float}>
        <g filter={`url(#${d.shadow})`}>
          <rect x="128" y="34" width="76" height="96" rx={G.radius}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
          <rect x="152" y="28" width="28" height="12" rx={G.radiusSm} fill={`url(#${d.brand})`} />
        </g>
        {[56, 76, 96].map((y, i) => (
          <g key={y}>
            <rect x="138" y={y - 7} width="14" height="14" rx="4" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} />
            {i < 2 && <path d={`M141 ${y} l3 3.5 l6 -8`} fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} strokeLinecap="round" strokeLinejoin="round" />}
            <line x1="160" y1={y} x2={i === 2 ? 178 : 192} y2={y} stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
          </g>
        ))}
      </motion.g>

      {/* magnifier examining tread */}
      <motion.g {...scan} filter={`url(#${d.shadow})`}>
        <circle cx="104" cy="108" r="20" fill={C.surface} opacity="0.55" />
        <circle cx="104" cy="108" r="20" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
        <circle cx="104" cy="108" r="14" fill="none" stroke={C.line} strokeWidth="1.5" opacity="0.6" />
        <line x1="119" y1="123" x2="134" y2="138" stroke={`url(#${d.brand})`} strokeWidth={G.stroke + 1} strokeLinecap="round" />
      </motion.g>
    </IllustrationBase>
  )
}
