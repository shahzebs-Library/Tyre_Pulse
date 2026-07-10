/**
 * state/success — a checkmark badge over a tyre with a celebratory glow, for a
 * success / approved state. The check strokes itself in and the glow blooms
 * gently when animate; fully drawn and static otherwise.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function SuccessIllustration({ size = 200, title = 'Success', desc = 'Completed successfully', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const draw = on
    ? { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 0.7, delay: 0.25, ease: 'easeOut' } }
    : {}
  const bloom = on
    ? { animate: { scale: [0.9, 1.08, 1], opacity: [0, 0.5, 0.35] }, transition: { duration: 1.2, ease: 'easeOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <motion.circle cx="120" cy="86" r="74" fill={`url(#${d.glow})`} style={{ originX: '120px', originY: '86px', transformBox: 'fill-box' }} {...bloom} />
      <ellipse cx="120" cy="152" rx="66" ry="11" fill="var(--text-primary)" opacity="0.06" />

      {/* celebratory rays */}
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2
        const x1 = 120 + Math.cos(a) * 58, y1 = 78 + Math.sin(a) * 58
        const x2 = 120 + Math.cos(a) * 68, y2 = 78 + Math.sin(a) * 68
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandElectric} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.6" />
      })}

      {/* tyre */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="120" cy="112" r="40" fill={C.ink} opacity="0.9" />
        <circle cx="120" cy="112" r="40" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
        <circle cx="120" cy="112" r="18" fill={C.surface} />
        <circle cx="120" cy="112" r="18" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2
          const x1 = 120 + Math.cos(a) * 30, y1 = 112 + Math.sin(a) * 30
          const x2 = 120 + Math.cos(a) * 36, y2 = 112 + Math.sin(a) * 36
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        })}
      </g>

      {/* check badge, top-right */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="162" cy="66" r="24" fill={`url(#${d.brand})`} />
        <circle cx="162" cy="66" r="24" fill="none" stroke={C.surface} strokeWidth={G.strokeThin} opacity="0.6" />
        <motion.path d="M151 66 L159 74 L174 58" fill="none" stroke={C.surface} strokeWidth={G.stroke + 1} strokeLinecap="round" strokeLinejoin="round" {...draw} />
      </g>
    </IllustrationBase>
  )
}
