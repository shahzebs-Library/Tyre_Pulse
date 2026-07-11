/**
 * brand/ai-mascot — the friendly Tyre Pulse AI mascot. A premium tyre character
 * with a glowing "pulse" face (eyes + heartbeat smile) that idles with a subtle
 * bob and blink. Square viewBox 0 0 200 200. Theme-aware via tokens.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function AiMascotIllustration({ size = 200, title = 'Tyre Pulse AI', desc = 'Tyre Pulse AI mascot', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const bob = on
    ? { animate: { y: [0, -5, 0] }, transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const blink = on
    ? { animate: { scaleY: [1, 1, 0.15, 1, 1] }, transition: { duration: 4.5, repeat: Infinity, ease: 'easeInOut', times: [0, 0.45, 0.5, 0.55, 1] } }
    : {}
  const beat = on
    ? { animate: { pathLength: [0.6, 1, 0.6], opacity: [0.7, 1, 0.7] }, transition: { duration: 1.9, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const twinkle = on
    ? { animate: { opacity: [0.3, 1, 0.3], scale: [0.85, 1.1, 0.85] }, transition: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  // tyre tread ticks
  const ticks = Array.from({ length: 16 })

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 200 200" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="100" cy="176" rx="60" ry="9" fill="var(--text-primary)" opacity="0.08" />
      <circle cx="100" cy="96" r="78" fill={`url(#${d.glow})`} />

      <motion.g {...bob}>
        {/* tyre body */}
        <g filter={`url(#${d.shadow})`}>
          <circle cx="100" cy="98" r="60" fill={C.ink} opacity="0.92" />
          <circle cx="100" cy="98" r="60" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke + 1} />
          {/* tread ticks */}
          {ticks.map((_, i) => {
            const a = (i / ticks.length) * Math.PI * 2
            const x1 = 100 + Math.cos(a) * 52, y1 = 98 + Math.sin(a) * 52
            const x2 = 100 + Math.cos(a) * 59, y2 = 98 + Math.sin(a) * 59
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
          })}
        </g>

        {/* face plate (inner hub) */}
        <circle cx="100" cy="98" r="42" fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />

        {/* eyes */}
        <motion.g style={{ transformOrigin: '100px 90px' }} {...blink}>
          <circle cx="86" cy="90" r="7" fill={`url(#${d.brand})`} />
          <circle cx="114" cy="90" r="7" fill={`url(#${d.brand})`} />
          {/* eye shine */}
          <circle cx="88.5" cy="87.5" r="2.2" fill={C.surface} opacity="0.9" />
          <circle cx="116.5" cy="87.5" r="2.2" fill={C.surface} opacity="0.9" />
        </motion.g>

        {/* heartbeat / pulse smile */}
        <motion.path
          d="M78 112 h9 l4 -9 l6 16 l5 -12 l4 5 h13"
          fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke}
          strokeLinecap="round" strokeLinejoin="round" {...beat} />

        {/* antenna spark */}
        <line x1="100" y1="38" x2="100" y2="24" stroke={C.brand} strokeWidth={G.strokeThin} strokeLinecap="round" />
        <motion.g style={{ transformOrigin: '100px 20px' }} {...twinkle}>
          <circle cx="100" cy="20" r="5" fill={C.brandBright} />
          <circle cx="100" cy="20" r="8" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} opacity="0.4" />
        </motion.g>
      </motion.g>
    </IllustrationBase>
  )
}
