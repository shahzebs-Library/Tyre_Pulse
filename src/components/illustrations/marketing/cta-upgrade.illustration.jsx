/**
 * marketing/cta-upgrade — upgrade / subscription call-to-action banner. A
 * premium tier badge with an ascending step-up of plan tiers, a crown/spark
 * accent, an unlock ray burst and a "PRO" ribbon. Designed as a wide CTA hero.
 * Premium depth, theme-aware, reduced-motion safe.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function CtaUpgradeIllustration({ size = 280, title = 'Upgrade your plan', desc = 'Unlock premium fleet intelligence features', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const rays = on
    ? { animate: { rotate: 360 }, transition: { duration: 24, repeat: Infinity, ease: 'linear' } }
    : {}
  const rise = (delay) => on
    ? { animate: { y: [0, -4, 0], opacity: [0.9, 1, 0.9] }, transition: { duration: 3, delay, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const twinkle = (delay) => on
    ? { animate: { opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }, transition: { duration: 2.4, delay, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  const bx = 226, by = 92 // premium badge centre

  // ascending plan tiers (left)
  const tiers = [
    { x: 40, h: 30, on: false },
    { x: 76, h: 48, on: false },
    { x: 112, h: 70, on: true },
  ]

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 220" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="160" cy="200" rx="138" ry="13" fill="var(--text-primary)" opacity="0.06" />
      <circle cx={bx} cy={by} r="120" fill={`url(#${d.glow})`} />

      {/* ascending plan step-up */}
      <line x1="30" y1="156" x2="170" y2="156" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
      {tiers.map((t, i) => (
        <motion.g key={i} {...rise(i * 0.2)}>
          <g filter={`url(#${d.shadow})`}>
            <rect x={t.x} y={156 - t.h} width="30" height={t.h} rx={G.radiusSm}
                  fill={t.on ? `url(#${d.brand})` : C.surface}
                  stroke={t.on ? C.brandBright : C.line} strokeWidth={G.strokeThin} />
          </g>
          {t.on && (
            <path d={`M${t.x + 15} ${156 - t.h - 10} l3 8 h-6 Z`} fill={C.brandBright} />
          )}
          <rect x={t.x + 7} y={156 - t.h + 8} width="16" height="3.5" rx="1.75" fill={t.on ? C.surface : C.line} opacity={t.on ? 0.7 : 1} />
        </motion.g>
      ))}
      {/* rising arrow across tiers */}
      <path d="M50 130 L86 108 L122 84" fill="none" stroke={`url(#${d.brand})`}
            strokeWidth={G.strokeThin} strokeLinecap="round" strokeDasharray="2 7" opacity="0.7" />

      {/* unlock ray burst behind premium badge */}
      <motion.g style={{ transformOrigin: `${bx}px ${by}px` }} {...rays}>
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2
          const x1 = bx + Math.cos(a) * 50, y1 = by + Math.sin(a) * 50
          const x2 = bx + Math.cos(a) * 62, y2 = by + Math.sin(a) * 62
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2.5" strokeLinecap="round" opacity={i % 2 ? 0.5 : 0.25} />
        })}
      </motion.g>

      {/* premium hexagon badge */}
      <motion.g {...float}>
        <g filter={`url(#${d.shadow})`}>
          <path d={`M${bx} ${by - 44} L${bx + 38} ${by - 22} L${bx + 38} ${by + 22} L${bx} ${by + 44} L${bx - 38} ${by + 22} L${bx - 38} ${by - 22} Z`}
                fill={`url(#${d.brand})`} stroke={C.brandBright} strokeWidth={G.stroke} />
        </g>
        {/* inner ring */}
        <path d={`M${bx} ${by - 32} L${bx + 28} ${by - 16} L${bx + 28} ${by + 16} L${bx} ${by + 32} L${bx - 28} ${by + 16} L${bx - 28} ${by - 16} Z`}
              fill="none" stroke={C.surface} strokeWidth={G.strokeThin} opacity="0.4" />
        {/* crown glyph */}
        <path d={`M${bx - 18} ${by + 4} l4 -20 l7 11 l7 -14 l7 14 l7 -11 l4 20 Z`}
              fill={C.surface} opacity="0.95" />
        <rect x={bx - 16} y={by + 6} width="32" height="6" rx="2" fill={C.surface} opacity="0.95" />
        {/* PRO ribbon */}
        <g filter={`url(#${d.shadow})`}>
          <rect x={bx - 24} y={by + 30} width="48" height="18" rx="9" fill={C.ink} opacity="0.9" />
        </g>
        <text x={bx} y={by + 43} textAnchor="middle" fontSize="11" fontWeight="700" fill={C.surface} letterSpacing="1">PRO</text>
      </motion.g>

      {/* spark accents */}
      <motion.path d="M278 46 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z" fill={C.brandElectric} {...twinkle(0)} style={{ transformOrigin: '278px 56px' }} />
      <motion.path d="M176 60 l2.4 5.5 l5.5 2.4 l-5.5 2.4 l-2.4 5.5 l-2.4 -5.5 l-5.5 -2.4 l5.5 -2.4 Z" fill={C.brandBright} {...twinkle(0.8)} style={{ transformOrigin: '176px 68px' }} />
    </IllustrationBase>
  )
}
