/**
 * marketing/feature-fleet — fleet management hero. A staggered convoy of branded
 * trucks tracked on a live map plane with a route path, telemetry pins and a
 * status panel. Premium depth, rolling motion, theme-aware and reduced-motion safe.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function FeatureFleetIllustration({ size = 280, title = 'Fleet management', desc = 'Live fleet tracking, routing and vehicle telemetry', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const spin = on
    ? { animate: { rotate: 360 }, transition: { duration: 3.2, repeat: Infinity, ease: 'linear' } }
    : {}
  const roll = (delay) => on
    ? { animate: { x: [0, 6, 0] }, transition: { duration: 5, delay, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const ping = on
    ? { animate: { scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }, transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  const truck = (tx, ty, scale, opacity, delay) => (
    <motion.g filter={`url(#${d.shadow})`} {...roll(delay)}>
      <g transform={`translate(${tx} ${ty}) scale(${scale})`} opacity={opacity}>
        <rect x="0" y="0" width="60" height="20" rx={G.radiusSm} fill={`url(#${d.brand})`} />
        <path d="M42 0 h12 a4 4 0 0 1 4 4 l6 12 h-22 Z" fill={C.brand} opacity="0.92" />
        <rect x="45" y="4" width="9" height="8" rx="1.5" fill={C.surface} opacity="0.85" />
        {[15, 47].map((wx, i) => (
          <motion.g key={i} style={{ transformOrigin: `${wx}px 22px` }} {...spin}>
            <circle cx={wx} cy="22" r="7.5" fill={C.ink} opacity="0.92" />
            <circle cx={wx} cy="22" r="7.5" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} />
            <circle cx={wx} cy="22" r="2.8" fill={C.surface} />
          </motion.g>
        ))}
      </g>
    </motion.g>
  )

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 220" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="160" cy="200" rx="140" ry="13" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="150" cy="94" r="120" fill={`url(#${d.glow})`} />

      {/* map plane */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="28" y="28" width="264" height="120" rx={G.radius}
              fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
      </g>
      {/* map grid */}
      {[64, 100, 136, 172, 208, 244].map((x) => (
        <line key={`v${x}`} x1={x} y1="28" x2={x} y2="148" stroke={C.lineSoft} strokeWidth="1" opacity="0.5" />
      ))}
      {[58, 88, 118].map((y) => (
        <line key={`h${y}`} x1="28" y1={y} x2="292" y2={y} stroke={C.lineSoft} strokeWidth="1" opacity="0.5" />
      ))}

      {/* route path across the map */}
      <path d="M48 128 Q110 60 172 96 T280 52" fill="none" stroke={`url(#${d.brand})`}
            strokeWidth={G.stroke} strokeLinecap="round" strokeDasharray="2 8" opacity="0.85" />

      {/* telemetry pins with pings */}
      {[{ x: 48, y: 128 }, { x: 172, y: 96 }, { x: 280, y: 52 }].map((p, i) => (
        <g key={i}>
          <motion.circle cx={p.x} cy={p.y} r="7" fill={C.brandBright} {...ping} style={{ transformOrigin: `${p.x}px ${p.y}px` }} />
          <circle cx={p.x} cy={p.y} r="4" fill={`url(#${d.brand})`} stroke={C.surface} strokeWidth={G.strokeThin} />
        </g>
      ))}

      {/* status panel (floating) */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="200" y="40" width="80" height="42" rx={G.radiusSm}
              fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      </g>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle cx="212" cy={52 + i * 11} r="3" fill={i === 0 ? `url(#${d.brand})` : C.line} />
          <rect x="220" y={50 + i * 11} width={i === 0 ? 46 : 34} height="4" rx="2" fill={i === 0 ? C.line : C.lineSoft} />
        </g>
      ))}

      {/* convoy (foreground, staggered) */}
      <motion.g {...float}>
        {truck(180, 158, 0.72, 0.85, 0.4)}
        {truck(30, 162, 1, 1, 0)}
      </motion.g>
    </IllustrationBase>
  )
}
