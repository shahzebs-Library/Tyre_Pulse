/**
 * marketing/predictive-maintenance — predictive / forecast hero. A tyre wear
 * gauge, a forecast trend that extends past "now" into a dashed prediction with
 * a target flag, plus a calendar/wrench schedule badge. Communicates predicted
 * replacement dates and budget forecasting. Premium depth, theme-aware,
 * reduced-motion safe.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function PredictiveMaintenanceIllustration({ size = 280, title = 'Predictive maintenance', desc = 'Forecast tyre replacement dates and maintenance budgets', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const forecast = on
    ? { animate: { pathLength: [0, 1], opacity: [0.4, 1] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const needle = on
    ? { animate: { rotate: [-38, 20, -38] }, transition: { duration: 4.5, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const flagWave = on
    ? { animate: { scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }, transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  // gauge geometry
  const gx = 78, gy = 108, gr = 40

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 220" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="160" cy="200" rx="132" ry="13" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="150" cy="94" r="118" fill={`url(#${d.glow})`} />

      {/* forecast panel (right) */}
      <motion.g {...float}>
        <g filter={`url(#${d.shadow})`}>
          <rect x="140" y="34" width="164" height="118" rx={G.radius}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        </g>
        <rect x="156" y="48" width="60" height="6" rx="3" fill={C.line} />
        <rect x="156" y="58" width="36" height="4.5" rx="2.25" fill={C.lineSoft} />

        {/* baseline + "now" divider */}
        <line x1="156" y1="134" x2="290" y2="134" stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
        <line x1="228" y1="72" x2="228" y2="134" stroke={C.line} strokeWidth={G.strokeThin} strokeDasharray="3 5" opacity="0.7" />
        <text x="228" y="148" textAnchor="middle" fontSize="8" fontWeight="700" fill={C.muted}>now</text>

        {/* historical trend (solid) */}
        <motion.path
          d="M156 120 L172 116 L188 118 L204 108 L228 104"
          fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke}
          strokeLinecap="round" strokeLinejoin="round" {...forecast} />
        {/* predicted trend (dashed, extending) */}
        <path d="M228 104 L250 96 L272 84 L290 74"
              fill="none" stroke={C.brandBright} strokeWidth={G.stroke}
              strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 6" opacity="0.85" />
        {/* prediction cone */}
        <path d="M228 104 L290 62 L290 88 Z" fill={`url(#${d.brand})`} opacity="0.1" />

        {/* target flag at forecast endpoint */}
        <line x1="290" y1="74" x2="290" y2="56" stroke={C.sub} strokeWidth={G.strokeThin} strokeLinecap="round" />
        <motion.path d="M290 56 l-14 5 l14 5 Z" fill={`url(#${d.brand})`} {...flagWave} style={{ transformOrigin: '290px 61px' }} />
      </motion.g>

      {/* tyre wear gauge (left) */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx={gx} cy={gy} r={gr + 8} fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      </g>
      {/* gauge arc track */}
      <path d={`M${gx - gr} ${gy} A${gr} ${gr} 0 0 1 ${gx + gr} ${gy}`}
            fill="none" stroke={C.line} strokeWidth="8" strokeLinecap="round" opacity="0.5" />
      {/* gauge value arc */}
      <path d={`M${gx - gr} ${gy} A${gr} ${gr} 0 0 1 ${gx + gr * 0.3} ${gy - gr * 0.95}`}
            fill="none" stroke={`url(#${d.brand})`} strokeWidth="8" strokeLinecap="round" />
      {/* tick marks */}
      {Array.from({ length: 7 }).map((_, i) => {
        const a = Math.PI - (i / 6) * Math.PI
        const x1 = gx + Math.cos(a) * (gr - 4), y1 = gy - Math.sin(a) * (gr - 4)
        const x2 = gx + Math.cos(a) * (gr + 2), y2 = gy - Math.sin(a) * (gr + 2)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.muted} strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      })}
      {/* needle */}
      <motion.g style={{ transformOrigin: `${gx}px ${gy}px` }} {...needle}>
        <line x1={gx} y1={gy} x2={gx} y2={gy - gr + 6} stroke={C.brandBright} strokeWidth={G.stroke} strokeLinecap="round" />
      </motion.g>
      <circle cx={gx} cy={gy} r="5" fill={`url(#${d.brand})`} stroke={C.surface} strokeWidth={G.strokeThin} />
      <text x={gx} y={gy + 24} textAnchor="middle" fontSize="10" fontWeight="700" fill={C.sub}>WEAR</text>

      {/* schedule badge (calendar + wrench) */}
      <g filter={`url(#${d.shadow})`}>
        <rect x="44" y="150" width="70" height="34" rx={G.radiusSm} fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      </g>
      <rect x="52" y="156" width="20" height="20" rx="3" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} />
      <line x1="52" y1="162" x2="72" y2="162" stroke={`url(#${d.brand})`} strokeWidth="1.6" />
      <line x1="58" y1="154" x2="58" y2="158" stroke={C.sub} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="66" y1="154" x2="66" y2="158" stroke={C.sub} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="62" cy="170" r="2.4" fill={C.brandBright} />
      <rect x="80" y="160" width="26" height="4" rx="2" fill={C.line} />
      <rect x="80" y="169" width="18" height="4" rx="2" fill={C.lineSoft} />
    </IllustrationBase>
  )
}
