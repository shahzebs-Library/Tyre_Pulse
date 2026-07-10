/**
 * badge/verified — a shield-with-check trust badge on the brand gradient, the
 * check stroking itself in when animated. Signals a validated / approved /
 * compliant record (audited inspection, approved work order, certified vendor).
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function VerifiedIllustration({ size = 64, title = 'Verified', desc = 'Validated and approved', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const draw = on
    ? { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 0.7, delay: 0.2, ease: 'easeOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 64 64" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* brand glow */}
      <circle cx="32" cy="30" r="28" fill={`url(#${d.glow})`} />

      {/* shield */}
      <g filter={`url(#${d.shadow})`}>
        <path d="M32 10 L50 17 V32 Q50 46 32 54 Q14 46 14 32 V17 Z"
              fill={`url(#${d.brand})`} />
        <path d="M32 10 L50 17 V32 Q50 46 32 54 Q14 46 14 32 V17 Z"
              fill="none" stroke={C.surface} strokeWidth={G.strokeThin} strokeLinejoin="round" opacity="0.5" />
        {/* inner ring */}
        <path d="M32 16 L45 21 V32 Q45 42 32 48 Q19 42 19 32 V21 Z"
              fill="none" stroke={C.surface} strokeWidth="1.2" opacity="0.35" />

        {/* checkmark */}
        <motion.path d="M24 31 L30 37 L41 25"
              fill="none" stroke={C.surface} strokeWidth={G.stroke + 1}
              strokeLinecap="round" strokeLinejoin="round" {...draw} />
      </g>
    </IllustrationBase>
  )
}
