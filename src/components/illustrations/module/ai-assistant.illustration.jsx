/**
 * module/ai-assistant — AI assistant motif. A glowing pulse orb + chat bubble
 * with a live "tyre pulse" waveform running through it, plus a spark/star accent.
 * Theme-aware via tokens with a subtle breathing AI pulse.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function AiAssistantIllustration({ size = 200, title = 'AI Assistant', desc = 'Fleet intelligence assistant', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -3, 0] }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const breathe = on
    ? { animate: { scale: [1, 1.06, 1], opacity: [0.5, 0.85, 0.5] }, transition: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const wave = on
    ? { animate: { pathLength: [0, 1], opacity: [0.4, 1] }, transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const twinkle = on
    ? { animate: { opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }, transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="120" cy="160" rx="86" ry="10" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="120" cy="84" r="80" fill={`url(#${d.glow})`} />

      <motion.g {...float}>
        {/* chat bubble */}
        <g filter={`url(#${d.shadow})`}>
          <path
            d={`M52 40 h136 a${G.radius} ${G.radius} 0 0 1 ${G.radius} ${G.radius} v58 a${G.radius} ${G.radius} 0 0 1 -${G.radius} ${G.radius} h-96 l-18 18 v-18 h-22 a${G.radius} ${G.radius} 0 0 1 -${G.radius} -${G.radius} v-58 a${G.radius} ${G.radius} 0 0 1 ${G.radius} -${G.radius} Z`}
            fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        </g>

        {/* pulse orb (AI core) */}
        <motion.circle cx="80" cy="76" r="24" fill={`url(#${d.glow})`} {...breathe} />
        <circle cx="80" cy="76" r="15" fill={`url(#${d.brand})`} filter={`url(#${d.shadow})`} />
        <circle cx="80" cy="76" r="15" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} opacity="0.6" />
        {/* inner tyre-pulse hint */}
        <circle cx="80" cy="76" r="6" fill={C.surface} opacity="0.9" />

        {/* tyre pulse waveform through the bubble */}
        <motion.path
          d="M112 76 h10 l6 -16 l7 30 l7 -22 l6 12 h16"
          fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke}
          strokeLinecap="round" strokeLinejoin="round" {...wave} />
        <circle cx="164" cy="76" r="3.5" fill={C.brandBright} />

        {/* AI spark accent */}
        <motion.g {...twinkle} style={{ transformOrigin: '176px 44px' }}>
          <path
            d="M176 34 l3.5 8 l8 3.5 l-8 3.5 l-3.5 8 l-3.5 -8 l-8 -3.5 l8 -3.5 Z"
            fill={C.brandBright} opacity="0.9" />
        </motion.g>
      </motion.g>
    </IllustrationBase>
  )
}
