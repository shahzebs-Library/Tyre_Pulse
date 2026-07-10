/**
 * state/offline — a disconnected cloud above a tyre with broken/severed signal
 * arcs, for an offline / no-connection state. The cloud drifts and the broken
 * signal bars fade when animate.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function OfflineIllustration({ size = 200, title = 'You are offline', desc = 'No connection to the fleet server', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const drift = on ? { animate: { y: [0, -3, 0] }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' } } : {}
  const flicker = on ? { animate: { opacity: [0.25, 0.5, 0.25] }, transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } } : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="120" cy="70" r="66" fill={`url(#${d.glow})`} />
      <ellipse cx="120" cy="156" rx="62" ry="10" fill="var(--text-primary)" opacity="0.06" />

      {/* severed signal arcs radiating from the tyre up toward the cloud */}
      <motion.g {...flicker}>
        <path d="M96 118 a34 34 0 0 1 48 0" fill="none" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" strokeDasharray="5 8" />
        <path d="M84 128 a52 52 0 0 1 72 0" fill="none" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" strokeDasharray="5 8" />
      </motion.g>

      {/* disconnected cloud */}
      <motion.g {...drift}>
        <g filter={`url(#${d.shadow})`}>
          <path d="M92 56 a20 20 0 0 1 38 -6 a16 16 0 0 1 22 18 a14 14 0 0 1 -4 27 L96 95 a19 19 0 0 1 -4 -39 Z"
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.stroke} strokeLinejoin="round" />
          {/* disconnect slash */}
          <line x1="106" y1="52" x2="138" y2="84" stroke={C.danger} strokeWidth={G.stroke} strokeLinecap="round" />
        </g>
      </motion.g>

      {/* tyre */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="120" cy="128" r="30" fill={C.ink} opacity="0.9" />
        <circle cx="120" cy="128" r="30" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
        <circle cx="120" cy="128" r="13" fill={C.surface} />
        <circle cx="120" cy="128" r="13" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
        {Array.from({ length: 10 }).map((_, i) => {
          const a = (i / 10) * Math.PI * 2
          const x1 = 120 + Math.cos(a) * 22, y1 = 128 + Math.sin(a) * 22
          const x2 = 120 + Math.cos(a) * 27, y2 = 128 + Math.sin(a) * 27
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        })}
      </g>
    </IllustrationBase>
  )
}
