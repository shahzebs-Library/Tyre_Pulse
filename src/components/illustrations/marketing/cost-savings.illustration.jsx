/**
 * marketing/cost-savings — cost reduction hero. A falling cost curve over a
 * panel, a rising stack of savings coins with a "down %" badge and a piggy/
 * wallet accent. Communicates lower CPK and budget savings. Premium depth,
 * theme-aware, reduced-motion safe.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function CostSavingsIllustration({ size = 280, title = 'Cost savings', desc = 'Lower cost-per-kilometre and reduced tyre spend', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const drop = on
    ? { animate: { pathLength: [0, 1], opacity: [0.4, 1] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const rise = (delay) => on
    ? { animate: { y: [0, -3, 0], opacity: [0.9, 1, 0.9] }, transition: { duration: 3, delay, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const badge = on
    ? { animate: { scale: [1, 1.08, 1] }, transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  // stacked savings coins (rising column)
  const coins = [
    { cx: 236, cy: 150, w: 2 },
    { cx: 236, cy: 136, w: 3 },
    { cx: 236, cy: 122, w: 4 },
    { cx: 236, cy: 108, w: 5 },
  ]

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 220" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="160" cy="198" rx="132" ry="13" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="130" cy="94" r="112" fill={`url(#${d.glow})`} />

      <motion.g {...float}>
        {/* cost panel */}
        <g filter={`url(#${d.shadow})`}>
          <rect x="30" y="36" width="180" height="122" rx={G.radius}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        </g>
        <rect x="46" y="50" width="54" height="6" rx="3" fill={C.line} />
        <rect x="46" y="60" width="34" height="4.5" rx="2.25" fill={C.lineSoft} />

        {/* baseline + faded high bars → low bars showing decline */}
        <line x1="46" y1="140" x2="194" y2="140" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
        {[62, 52, 44, 32, 24, 16].map((h, i) => (
          <rect key={i} x={52 + i * 24} y={140 - h} width="14" height={h} rx="3"
                fill={C.line} opacity={0.35} />
        ))}

        {/* falling cost curve */}
        <motion.path
          d="M52 82 L76 90 L100 88 L124 104 L148 108 L172 122 L196 126"
          fill="none" stroke={C.danger} strokeWidth={G.stroke}
          strokeLinecap="round" strokeLinejoin="round" opacity="0.9" {...drop} />
        <circle cx="196" cy="126" r="4.5" fill={C.danger} />
        {/* down arrow */}
        <path d="M196 132 l-5 -7 h10 Z" fill={C.danger} />
      </motion.g>

      {/* savings coin stack (rising) */}
      <g filter={`url(#${d.shadow})`}>
        {coins.map((c, i) => (
          <motion.g key={i} {...rise(i * 0.2)}>
            <ellipse cx={c.cx} cy={c.cy} rx="26" ry="9" fill={`url(#${d.brand})`} />
            <ellipse cx={c.cx} cy={c.cy - 3} rx="26" ry="9" fill={C.brandBright} />
            <ellipse cx={c.cx} cy={c.cy - 3} rx="26" ry="9" fill="none" stroke={C.surface} strokeWidth={G.strokeThin} opacity="0.5" />
            <text x={c.cx} y={c.cy} textAnchor="middle" fontSize="9" fontWeight="700" fill={C.surface} opacity="0.9">$</text>
          </motion.g>
        ))}
      </g>

      {/* "down %" savings badge */}
      <motion.g {...badge} style={{ transformOrigin: '250px 62px' }}>
        <g filter={`url(#${d.shadow})`}>
          <rect x="216" y="44" width="72" height="36" rx="18"
                fill={C.surface} stroke={C.brandBright} strokeWidth={G.strokeThin} />
        </g>
        <path d="M232 62 l-6 8 h12 Z" fill={`url(#${d.brand})`} />
        <path d="M232 70 v-14" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} strokeLinecap="round" />
        <text x="264" y="66" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.ink}>-24%</text>
      </motion.g>
    </IllustrationBase>
  )
}
