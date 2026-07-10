/**
 * state/error — a branded tyre paired with a warning-triangle alert badge for a
 * generic error state. Subtle idle float + a gentle badge pulse when animate.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function ErrorIllustration({ size = 200, title = 'Something went wrong', desc = 'We hit an error loading this', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const float = on ? { animate: { y: [0, -3, 0] }, transition: { duration: 4.5, repeat: Infinity, ease: 'easeInOut' } } : {}
  const pulse = on ? { animate: { scale: [1, 1.06, 1], opacity: [0.9, 1, 0.9] }, transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' } } : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="112" cy="96" r="70" fill={`url(#${d.glow})`} />
      <ellipse cx="112" cy="152" rx="66" ry="11" fill="var(--text-primary)" opacity="0.06" />

      <motion.g {...float}>
        {/* tyre */}
        <g filter={`url(#${d.shadow})`}>
          <circle cx="112" cy="100" r="42" fill={C.ink} opacity="0.9" />
          <circle cx="112" cy="100" r="42" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
          <circle cx="112" cy="100" r="19" fill={C.surface} />
          <circle cx="112" cy="100" r="19" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2
            const x1 = 112 + Math.cos(a) * 31, y1 = 100 + Math.sin(a) * 31
            const x2 = 112 + Math.cos(a) * 38, y2 = 100 + Math.sin(a) * 38
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
          })}
        </g>
      </motion.g>

      {/* warning-triangle alert badge, top-right */}
      <motion.g style={{ originX: '168px', originY: '58px', transformBox: 'fill-box' }} {...pulse}>
        <g filter={`url(#${d.shadow})`}>
          <path d="M168 30 L196 78 A6 6 0 0 1 191 88 L145 88 A6 6 0 0 1 140 78 Z"
                fill={C.surface} stroke={C.danger} strokeWidth={G.stroke} strokeLinejoin="round" />
          <path d="M168 34 L192 76 A4 4 0 0 1 189 82 L147 82 A4 4 0 0 1 144 76 Z"
                fill={C.danger} opacity="0.14" />
          <line x1="168" y1="50" x2="168" y2="68" stroke={C.danger} strokeWidth={G.stroke} strokeLinecap="round" />
          <circle cx="168" cy="76" r="2.4" fill={C.danger} />
        </g>
      </motion.g>
    </IllustrationBase>
  )
}
