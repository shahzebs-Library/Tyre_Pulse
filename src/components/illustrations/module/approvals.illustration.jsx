/**
 * module/approvals — an approval workflow: a document advancing through review
 * steps to an approval stamp/check. Theme-aware via tokens with a slow float, a
 * flowing step pulse, and a stamp settle.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function ApprovalsIllustration({ size = 200, title = 'Nothing to approve', desc = 'Submitted items appear here for review', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const stamp = on
    ? { initial: { scale: 0.6, opacity: 0, rotate: -18 }, animate: { scale: 1, opacity: 1, rotate: -12 }, transition: { duration: 0.5, delay: 0.9, ease: [0.22, 1, 0.36, 1] } }
    : {}
  const step = (i) => on
    ? { animate: { opacity: [0.35, 1, 0.35] }, transition: { duration: 2.4, repeat: Infinity, delay: i * 0.5, ease: 'easeInOut' } }
    : {}

  const steps = [56, 120, 184]

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ground + ambient glow */}
      <ellipse cx="120" cy="158" rx="92" ry="12" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="120" cy="80" r="74" fill={`url(#${d.glow})`} />

      {/* workflow track */}
      <line x1="56" y1="138" x2="184" y2="138" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" strokeDasharray="2 8" />
      {steps.map((x, i) => (
        <g key={x}>
          <motion.circle cx={x} cy="138" r="9"
            fill={i === 2 ? C.brandBright : C.surface}
            stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} {...step(i)} />
          {i === 2 && <path d={`M${x - 4} 138 l3 3 l5 -6`} fill="none" stroke={C.surface} strokeWidth={G.strokeThin} strokeLinecap="round" strokeLinejoin="round" />}
        </g>
      ))}

      {/* document being approved */}
      <motion.g {...float}>
        <g filter={`url(#${d.shadow})`}>
          <path d="M78 34 h60 l16 16 v72 a6 6 0 0 1 -6 6 H78 a6 6 0 0 1 -6 -6 V40 a6 6 0 0 1 6 -6 z"
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
          <path d="M138 34 v16 h16 z" fill={C.lineSoft} stroke={C.line} strokeWidth="1.5" />
        </g>
        <rect x="86" y="46" width="40" height="9" rx="4" fill={`url(#${d.brand})`} />
        {[66, 78, 90].map((y, i) => (
          <line key={y} x1="86" y1={y} x2={i === 2 ? 122 : 142} y2={y}
                stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
        ))}

        {/* approval stamp / check */}
        <motion.g style={{ transformOrigin: '130px 100px' }} {...stamp}>
          <circle cx="130" cy="100" r="22" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} opacity="0.9" />
          <circle cx="130" cy="100" r="16" fill="none" stroke={C.brandBright} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />
          <path d="M121 100 l6 6 l12 -14" fill="none" stroke={C.brandBright} strokeWidth={G.stroke} strokeLinecap="round" strokeLinejoin="round" />
        </motion.g>
      </motion.g>
    </IllustrationBase>
  )
}
