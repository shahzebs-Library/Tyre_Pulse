/**
 * state/loading — a branded tyre/wheel spinning with trailing motion arcs to
 * convey an in-flight load. Slow continuous rotation when animate; fully static
 * (and rotation-free) under reduced motion or animate === false.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function LoadingIllustration({ size = 200, title = 'Loading', desc = 'Fetching your fleet data', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const spin = animate && !reduce
    ? { animate: { rotate: 360 }, transition: { duration: 2.4, repeat: Infinity, ease: 'linear' } }
    : {}

  // Tread ticks around the tyre.
  const ticks = Array.from({ length: 12 }).map((_, i) => {
    const a = (i / 12) * Math.PI * 2
    const x1 = 120 + Math.cos(a) * 34, y1 = 92 + Math.sin(a) * 34
    const x2 = 120 + Math.cos(a) * 42, y2 = 92 + Math.sin(a) * 42
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
  })

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient glow + contact shadow */}
      <circle cx="120" cy="92" r="72" fill={`url(#${d.glow})`} />
      <ellipse cx="120" cy="152" rx="70" ry="11" fill="var(--text-primary)" opacity="0.06" />

      {/* leading motion arc (static hint, sits behind the wheel) */}
      <path d="M46 92 a74 74 0 0 1 22 -52" fill="none" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.5" strokeDasharray="6 10" />
      <path d="M194 92 a74 74 0 0 1 -22 52" fill="none" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.5" strokeDasharray="6 10" />

      {/* spinning wheel */}
      <motion.g style={{ originX: '120px', originY: '92px', transformBox: 'fill-box' }} {...spin}>
        <g filter={`url(#${d.shadow})`}>
          <circle cx="120" cy="92" r="46" fill={C.ink} opacity="0.9" />
          <circle cx="120" cy="92" r="46" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
          {ticks}
          {/* hub */}
          <circle cx="120" cy="92" r="20" fill={C.surface} />
          <circle cx="120" cy="92" r="20" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
          {/* spokes */}
          {Array.from({ length: 5 }).map((_, i) => {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2
            const x2 = 120 + Math.cos(a) * 18, y2 = 92 + Math.sin(a) * 18
            return <line key={i} x1="120" y1="92" x2={x2} y2={y2} stroke={C.brand} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.7" />
          })}
          <circle cx="120" cy="92" r="5" fill={`url(#${d.brand})`} />
          {/* motion accent — one bright arc that reads as speed while spinning */}
          <path d="M120 46 a46 46 0 0 1 40 24" fill="none" stroke={C.brandElectric} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.9" />
        </g>
      </motion.g>
    </IllustrationBase>
  )
}
