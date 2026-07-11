/**
 * marketing/security-trust — security & compliance hero. A branded shield with a
 * verified checkmark and a tyre-tread motif in the crest, an orbiting protection
 * ring, a lock node and compliance badges. Premium depth, theme-aware,
 * reduced-motion safe.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function SecurityTrustIllustration({ size = 280, title = 'Security & compliance', desc = 'Enterprise-grade security, audit logging and compliance', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const ring = on
    ? { animate: { rotate: 360 }, transition: { duration: 22, repeat: Infinity, ease: 'linear' } }
    : {}
  const draw = on
    ? { animate: { pathLength: [0, 1] }, transition: { duration: 1.6, repeat: Infinity, repeatDelay: 1.4, ease: 'easeInOut' } }
    : {}
  const glowPulse = on
    ? { animate: { scale: [1, 1.08, 1], opacity: [0.4, 0.75, 0.4] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  const cx = 160, cy = 96

  // shield path (crest)
  const shield = `M${cx} 46
    L${cx + 44} 62
    V104
    C${cx + 44} 134 ${cx + 24} 152 ${cx} 160
    C${cx - 24} 152 ${cx - 44} 134 ${cx - 44} 104
    V62 Z`

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 220" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="160" cy="198" rx="120" ry="13" fill="var(--text-primary)" opacity="0.06" />
      <circle cx={cx} cy={cy} r="112" fill={`url(#${d.glow})`} />

      {/* orbiting protection ring with satellite nodes */}
      <motion.g style={{ transformOrigin: `${cx}px ${cy}px` }} {...ring}>
        <circle cx={cx} cy={cy} r="82" fill="none" stroke={C.line} strokeWidth={G.strokeThin} strokeDasharray="4 10" opacity="0.5" />
        {[0, 90, 180, 270].map((a) => {
          const rad = (a * Math.PI) / 180
          const x = cx + Math.cos(rad) * 82
          const y = cy + Math.sin(rad) * 82
          return (
            <g key={a}>
              <circle cx={x} cy={y} r="5.5" fill={C.surface} stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} filter={`url(#${d.shadow})`} />
              <circle cx={x} cy={y} r="2.2" fill={`url(#${d.brand})`} />
            </g>
          )
        })}
      </motion.g>

      <motion.g {...float}>
        {/* aura behind shield */}
        <motion.g style={{ transformOrigin: `${cx}px ${cy}px` }} {...glowPulse}>
          <path d={shield} fill={`url(#${d.glow})`} transform={`scale(1.14) translate(${-cx * 0.14 / 1} ${-cy * 0.14 / 1})`} style={{ transformOrigin: `${cx}px ${cy}px` }} />
        </motion.g>

        {/* shield body */}
        <g filter={`url(#${d.shadow})`}>
          <path d={shield} fill={`url(#${d.surface})`} stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
        </g>
        {/* inner brand crest */}
        <path d={shield} fill={`url(#${d.brand})`} opacity="0.1"
              transform={`scale(0.82) translate(${cx * 0.18} ${cy * 0.18})`} style={{ transformOrigin: `${cx}px ${cy}px` }} />

        {/* tyre-tread ring inside the crest (motif) */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2
          const x1 = cx + Math.cos(a) * 30, y1 = (cy + 6) + Math.sin(a) * 30
          const x2 = cx + Math.cos(a) * 35, y2 = (cy + 6) + Math.sin(a) * 35
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="1.6" strokeLinecap="round" opacity="0.4" />
        })}

        {/* verified checkmark */}
        <motion.path
          d={`M${cx - 20} ${cy + 6} l13 14 l26 -30`}
          fill="none" stroke={`url(#${d.brand})`} strokeWidth="7"
          strokeLinecap="round" strokeLinejoin="round" {...draw} />
      </motion.g>

      {/* lock node badge (floating) */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="252" cy="60" r="18" fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      </g>
      <path d="M246 60 v-4 a6 6 0 0 1 12 0 v4" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} strokeLinecap="round" />
      <rect x="245" y="60" width="14" height="11" rx="2.5" fill={`url(#${d.brand})`} />
      <circle cx="252" cy="65" r="1.8" fill={C.surface} />

      {/* audit-log badge (floating) */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="52" y="48" width="34" height="40" rx={G.radiusSm} fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      </g>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <path d={`M58 ${58 + i * 10} l2.5 3 l4 -5`} fill="none" stroke={`url(#${d.brand})`} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="66" y={57 + i * 10} width="14" height="3" rx="1.5" fill={C.line} />
        </g>
      ))}
    </IllustrationBase>
  )
}
