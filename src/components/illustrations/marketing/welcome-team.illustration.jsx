/**
 * marketing/welcome-team — onboarding / team collaboration hero. A cluster of
 * team member avatars connected to a shared Tyre Pulse workspace panel, with a
 * central linking hub, a welcome checklist and a friendly tyre-pulse accent.
 * Premium depth, theme-aware, reduced-motion safe.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function WelcomeTeamIllustration({ size = 280, title = 'Welcome your team', desc = 'Onboard teammates into a shared fleet workspace', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const bob = (delay) => on
    ? { animate: { y: [0, -5, 0] }, transition: { duration: 3.4, delay, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const check = (delay) => on
    ? { animate: { pathLength: [0, 1] }, transition: { duration: 1, delay, repeat: Infinity, repeatDelay: 2.2, ease: 'easeInOut' } }
    : {}
  const hubPulse = on
    ? { animate: { scale: [1, 1.1, 1], opacity: [0.4, 0.7, 0.4] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  const hx = 160, hy = 60 // linking hub

  // team avatars around the hub
  const team = [
    { x: 68, y: 96, tone: `url(#${d.brand})`, delay: 0 },
    { x: 160, y: 118, tone: C.brandBright, delay: 0.4 },
    { x: 252, y: 96, tone: C.accentStrong, delay: 0.8 },
  ]

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 220" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="160" cy="200" rx="140" ry="13" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="160" cy="96" r="120" fill={`url(#${d.glow})`} />

      {/* connecting links hub → avatars */}
      {team.map((t, i) => (
        <path key={i} d={`M${hx} ${hy} Q${(hx + t.x) / 2} ${(hy + t.y) / 2 - 12} ${t.x} ${t.y - 18}`}
              fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin}
              strokeDasharray="2 7" strokeLinecap="round" opacity="0.6" />
      ))}

      {/* central linking hub */}
      <motion.circle cx={hx} cy={hy} r="30" fill={`url(#${d.glow})`} {...hubPulse} style={{ transformOrigin: `${hx}px ${hy}px` }} />
      <g filter={`url(#${d.shadow})`}>
        <circle cx={hx} cy={hy} r="20" fill={`url(#${d.brand})`} stroke={C.brandBright} strokeWidth={G.strokeThin} />
      </g>
      {/* tyre-pulse waveform inside hub */}
      <path d={`M${hx - 12} ${hy} l4 -7 l5 13 l5 -10 l4 4 h5`} fill="none"
            stroke={C.surface} strokeWidth={G.strokeThin} strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />

      {/* team avatars */}
      {team.map((t, i) => (
        <motion.g key={i} {...bob(t.delay)}>
          <g filter={`url(#${d.shadow})`}>
            <circle cx={t.x} cy={t.y} r="26" fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
          </g>
          {/* avatar: head + shoulders */}
          <circle cx={t.x} cy={t.y - 6} r="9" fill={t.tone} />
          <path d={`M${t.x - 15} ${t.y + 18} a15 13 0 0 1 30 0 Z`} fill={t.tone} opacity="0.85" />
          {/* online dot */}
          <circle cx={t.x + 18} cy={t.y - 16} r="5" fill={C.surface} />
          <circle cx={t.x + 18} cy={t.y - 16} r="3" fill={C.brandBright} />
        </motion.g>
      ))}

      {/* welcome checklist panel (floating, bottom) */}
      <motion.g {...float}>
        <g filter={`url(#${d.shadow})`}>
          <rect x="98" y="150" width="124" height="52" rx={G.radius}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        </g>
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <circle cx="114" cy={166 + i * 13} r="6.5"
                    fill={i < 2 ? `url(#${d.brand})` : 'none'}
                    stroke={i < 2 ? C.brandBright : C.line} strokeWidth={G.strokeThin} />
            {i < 2 && (
              <motion.path d={`M110.5 ${166 + i * 13} l2.5 3 l4 -5`} fill="none"
                           stroke={C.surface} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                           {...check(i * 0.3)} />
            )}
            <rect x="128" y={163 + i * 13} width={i < 2 ? 78 : 54} height="5" rx="2.5"
                  fill={i < 2 ? C.line : C.lineSoft} />
          </g>
        ))}
      </motion.g>
    </IllustrationBase>
  )
}
