/**
 * report/data-quality-seal — a circular "verified data" seal / stamp for reports:
 * a scalloped brand ring with tick notches, an inner ring, a tyre-mark centre and
 * a check, signalling the report's data passed integrity/QA checks. Reads cleanly
 * on light print surfaces; theme-aware. Motion off by default; optional check draw
 * and slow ring rotation.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function DataQualitySealIllustration({ size = 120, title = 'Data verified', desc = 'Data quality verified seal', animate = false, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const draw = on
    ? { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 0.7, delay: 0.2, ease: 'easeOut' } }
    : {}
  const spin = on
    ? { animate: { rotate: 360 }, transition: { duration: 22, repeat: Infinity, ease: 'linear' } }
    : {}

  const cx = 60, cy = 60

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 120 120" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* brand glow */}
      <circle cx={cx} cy={cy} r="52" fill={`url(#${d.glow})`} />

      {/* scalloped outer stamp */}
      <motion.g {...spin} style={{ transformOrigin: '60px 60px' }}>
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i / 24) * Math.PI * 2
          const x = cx + Math.cos(a) * 46
          const y = cy + Math.sin(a) * 46
          return <circle key={i} cx={x} cy={y} r="3.4" fill={`url(#${d.brand})`} opacity="0.85" />
        })}
      </motion.g>

      {/* seal disc */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx={cx} cy={cy} r="42" fill={`url(#${d.surface})`} stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
      </g>
      {/* inner ring */}
      <circle cx={cx} cy={cy} r="34" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} strokeDasharray="2 4" opacity="0.7" />

      {/* tyre-mark centre */}
      <circle cx={cx} cy={cy} r="24" fill={C.ink} opacity="0.9" />
      <circle cx={cx} cy={cy} r="24" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} />
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * Math.PI * 2
        const x1 = cx + Math.cos(a) * 17, y1 = cy + Math.sin(a) * 17
        const x2 = cx + Math.cos(a) * 22, y2 = cy + Math.sin(a) * 22
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
      })}

      {/* check */}
      <motion.path d="M50 60 L57 67 L71 51"
            fill="none" stroke={C.surface} strokeWidth={G.stroke + 1}
            strokeLinecap="round" strokeLinejoin="round" {...draw} />
    </IllustrationBase>
  )
}
