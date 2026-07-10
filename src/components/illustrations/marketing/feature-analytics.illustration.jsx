/**
 * marketing/feature-analytics — analytics feature hero. A large branded chart
 * panel with animated growth columns, a sweeping trend line, a donut KPI and
 * floating metric chips. Premium layered depth, theme-aware, reduced-motion safe.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function FeatureAnalyticsIllustration({ size = 280, title = 'Fleet analytics', desc = 'Rich analytics with trends, KPIs and performance charts', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const trend = on
    ? { animate: { pathLength: [0, 1], opacity: [0.4, 1] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const spin = on
    ? { animate: { rotate: 360 }, transition: { duration: 16, repeat: Infinity, ease: 'linear' } }
    : {}
  const chip = on
    ? { animate: { y: [0, -5, 0] }, transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  const cx = 250, cy = 76, r = 24, circ = 2 * Math.PI * r
  const bars = [26, 40, 34, 54, 46, 66]

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 220" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="160" cy="198" rx="132" ry="13" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="140" cy="96" r="112" fill={`url(#${d.glow})`} />

      <motion.g {...float}>
        {/* main chart panel */}
        <g filter={`url(#${d.shadow})`}>
          <rect x="30" y="36" width="200" height="128" rx={G.radius}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        </g>
        <rect x="46" y="50" width="60" height="6" rx="3" fill={C.line} />
        <rect x="46" y="60" width="38" height="4.5" rx="2.25" fill={C.lineSoft} />

        {/* baseline */}
        <line x1="46" y1="146" x2="214" y2="146" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />

        {/* growth columns */}
        {bars.map((h, i) => (
          <motion.rect
            key={i} x={52 + i * 27} y={146 - h} width="16" height={h} rx="4"
            fill={i === bars.length - 1 ? `url(#${d.brand})` : C.line}
            opacity={i === bars.length - 1 ? 1 : 0.7}
            style={{ transformOrigin: `${60 + i * 27}px 146px` }}
            {...(on ? { animate: { scaleY: [0.85, 1, 0.85] }, transition: { duration: 4, delay: i * 0.15, repeat: Infinity, ease: 'easeInOut' } } : {})} />
        ))}

        {/* sweeping trend line */}
        <motion.path
          d="M52 120 L79 112 L106 118 L133 100 L160 106 L187 86 L214 90"
          fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke}
          strokeLinecap="round" strokeLinejoin="round" {...trend} />
        <circle cx="214" cy="90" r="4.5" fill={C.brandBright} />
        <circle cx="214" cy="90" r="8" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} opacity="0.4" />
      </motion.g>

      {/* donut KPI (floating, top right) */}
      <motion.g {...chip}>
        <g filter={`url(#${d.shadow})`}>
          <circle cx={cx} cy={cy} r="34" fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
        </g>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.line} strokeWidth="9" opacity="0.5" />
        <motion.g style={{ transformOrigin: `${cx}px ${cy}px` }} {...spin}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#${d.brand})`} strokeWidth="9"
                  strokeLinecap="round" strokeDasharray={`${circ * 0.68} ${circ}`}
                  transform={`rotate(-90 ${cx} ${cy})`} />
        </motion.g>
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill={C.ink}>68%</text>
      </motion.g>

      {/* metric chip (floating, bottom right) */}
      <motion.g {...(on ? { animate: { y: [0, 5, 0] }, transition: { duration: 4.5, repeat: Infinity, ease: 'easeInOut' } } : {})}>
        <g filter={`url(#${d.shadow})`}>
          <rect x="228" y="126" width="72" height="34" rx={G.radiusSm}
                fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
        </g>
        <path d="M236 148 l6 -7 l5 4 l8 -10" fill="none" stroke={`url(#${d.brand})`}
              strokeWidth={G.strokeThin} strokeLinecap="round" strokeLinejoin="round" />
        <rect x="264" y="134" width="28" height="4.5" rx="2.25" fill={C.line} />
        <rect x="264" y="143" width="18" height="4" rx="2" fill={C.lineSoft} />
      </motion.g>
    </IllustrationBase>
  )
}
