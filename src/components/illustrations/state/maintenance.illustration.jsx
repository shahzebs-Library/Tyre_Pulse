/**
 * state/maintenance — a wrench crossing a gear behind a tyre, for a scheduled
 * maintenance / under-service state. The gear rotates slowly and the wrench
 * gives a gentle "tightening" rock when animate.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function MaintenanceIllustration({ size = 200, title = 'Scheduled maintenance', desc = 'This area is being serviced', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const rotate = on ? { animate: { rotate: 360 }, transition: { duration: 14, repeat: Infinity, ease: 'linear' } } : {}
  const rock = on ? { animate: { rotate: [-6, 4, -6] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } } : {}

  // Gear teeth as a toothed ring path.
  const teeth = Array.from({ length: 10 }).map((_, i) => {
    const a = (i / 10) * Math.PI * 2
    const x1 = 92 + Math.cos(a) * 34, y1 = 92 + Math.sin(a) * 34
    const x2 = 92 + Math.cos(a) * 42, y2 = 92 + Math.sin(a) * 42
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brand} strokeWidth="7" strokeLinecap="round" opacity="0.55" />
  })

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="110" cy="94" r="72" fill={`url(#${d.glow})`} />
      <ellipse cx="118" cy="154" rx="66" ry="11" fill="var(--text-primary)" opacity="0.06" />

      {/* gear behind everything */}
      <motion.g style={{ originX: '92px', originY: '92px', transformBox: 'fill-box' }} {...rotate}>
        {teeth}
        <circle cx="92" cy="92" r="34" fill="none" stroke={C.line} strokeWidth={G.stroke} opacity="0.6" />
      </motion.g>

      {/* tyre */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="132" cy="108" r="38" fill={C.ink} opacity="0.9" />
        <circle cx="132" cy="108" r="38" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
        <circle cx="132" cy="108" r="17" fill={C.surface} />
        <circle cx="132" cy="108" r="17" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2
          const x1 = 132 + Math.cos(a) * 28, y1 = 108 + Math.sin(a) * 28
          const x2 = 132 + Math.cos(a) * 34, y2 = 108 + Math.sin(a) * 34
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        })}
      </g>

      {/* wrench, foreground */}
      <motion.g style={{ originX: '92px', originY: '58px', transformBox: 'fill-box' }} {...rock}>
        <g filter={`url(#${d.shadow})`}>
          <path d="M70 44 a13 13 0 0 0 17 17 L120 94 a7 7 0 0 0 10 -10 L96 51 a13 13 0 0 0 -17 -17 l9 9 a4 4 0 0 1 -6 6 Z"
                fill={`url(#${d.surface})`} stroke={C.sub} strokeWidth={G.stroke} strokeLinejoin="round" strokeLinecap="round" />
        </g>
      </motion.g>
    </IllustrationBase>
  )
}
