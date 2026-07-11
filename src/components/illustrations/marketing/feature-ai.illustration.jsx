/**
 * marketing/feature-ai — AI intelligence hero. A glowing neural brain-core fused
 * with a tyre pulse ring, orbiting data nodes, synapse links and a running
 * "tyre pulse" waveform. Premium depth + breathing AI glow, theme-aware and
 * reduced-motion safe.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function FeatureAiIllustration({ size = 280, title = 'AI intelligence', desc = 'AI-driven fleet intelligence and tyre diagnostics', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const breathe = on
    ? { animate: { scale: [1, 1.1, 1], opacity: [0.45, 0.85, 0.45] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const orbit = on
    ? { animate: { rotate: 360 }, transition: { duration: 20, repeat: Infinity, ease: 'linear' } }
    : {}
  const wave = on
    ? { animate: { pathLength: [0, 1], opacity: [0.4, 1] }, transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const twinkle = on
    ? { animate: { opacity: [0.4, 1, 0.4], scale: [0.9, 1.15, 0.9] }, transition: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  const cx = 160, cy = 100
  // orbiting data nodes
  const nodes = [
    { a: 0, rad: 74 }, { a: 60, rad: 74 }, { a: 120, rad: 74 },
    { a: 180, rad: 74 }, { a: 240, rad: 74 }, { a: 300, rad: 74 },
  ]

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 220" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="160" cy="198" rx="130" ry="13" fill="var(--text-primary)" opacity="0.06" />
      <circle cx={cx} cy={cy} r="118" fill={`url(#${d.glow})`} />

      {/* orbit ring */}
      <circle cx={cx} cy={cy} r="74" fill="none" stroke={C.line} strokeWidth={G.strokeThin} strokeDasharray="3 8" opacity="0.5" />

      {/* orbiting nodes + synapse links */}
      <motion.g style={{ transformOrigin: `${cx}px ${cy}px` }} {...orbit}>
        {nodes.map((n, i) => {
          const rad = (n.a * Math.PI) / 180
          const x = cx + Math.cos(rad) * n.rad
          const y = cy + Math.sin(rad) * n.rad
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={C.brandBright} strokeWidth={G.strokeThin} opacity="0.25" />
              <circle cx={x} cy={y} r="6" fill={C.surface} stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} filter={`url(#${d.shadow})`} />
              <circle cx={x} cy={y} r="2.5" fill={`url(#${d.brand})`} />
            </g>
          )
        })}
      </motion.g>

      <motion.g {...float}>
        {/* breathing AI aura */}
        <motion.circle cx={cx} cy={cy} r="44" fill={`url(#${d.glow})`} {...breathe} style={{ transformOrigin: `${cx}px ${cy}px` }} />

        {/* brain-core disc (tyre fusion) */}
        <g filter={`url(#${d.shadow})`}>
          <circle cx={cx} cy={cy} r="34" fill={C.ink} opacity="0.92" />
          <circle cx={cx} cy={cy} r="34" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
        </g>
        {/* tread ticks — tyre motif */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2
          const x1 = cx + Math.cos(a) * 27, y1 = cy + Math.sin(a) * 27
          const x2 = cx + Math.cos(a) * 33, y2 = cy + Math.sin(a) * 33
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        })}
        {/* neural filaments inside the core */}
        <circle cx={cx} cy={cy} r="20" fill={C.surface} opacity="0.08" />
        <path d={`M${cx - 14} ${cy - 6} q8 -10 16 0 q8 10 16 0`} fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.6" />
        <path d={`M${cx - 14} ${cy + 8} q8 -10 16 0 q8 10 16 0`} fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.4" />

        {/* pulse waveform through the core */}
        <motion.path
          d={`M${cx - 18} ${cy} l5 -11 l6 20 l6 -16 l5 7 h6`}
          fill="none" stroke={C.surface} strokeWidth={G.strokeThin}
          strokeLinecap="round" strokeLinejoin="round" opacity="0.9" {...wave} />
      </motion.g>

      {/* AI spark accents */}
      <motion.path d="M242 46 l3.5 8 l8 3.5 l-8 3.5 l-3.5 8 l-3.5 -8 l-8 -3.5 l8 -3.5 Z"
                   fill={C.brandBright} {...twinkle} style={{ transformOrigin: '242px 57px' }} />
      <motion.path d="M74 158 l2.6 6 l6 2.6 l-6 2.6 l-2.6 6 l-2.6 -6 l-6 -2.6 l6 -2.6 Z"
                   fill={C.brandElectric}
                   {...(on ? { animate: { opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }, transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } } : {})}
                   style={{ transformOrigin: '74px 166px' }} />
    </IllustrationBase>
  )
}
