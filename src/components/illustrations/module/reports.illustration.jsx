/**
 * module/reports — a report document with a mini bar/trend chart and a PDF /
 * download accent badge. Theme-aware with a gentle idle float and a downloading
 * arrow pulse.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function ReportsIllustration({ size = 200, title = 'Reports', desc = 'Export fleet reports', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -3, 0] }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const dl = on
    ? { animate: { y: [0, 3, 0], opacity: [0.7, 1, 0.7] }, transition: { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  const bars = [16, 26, 20, 34, 28]

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="120" cy="162" rx="82" ry="10" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="120" cy="84" r="78" fill={`url(#${d.glow})`} />

      <motion.g {...float}>
        {/* back sheet (depth) */}
        <rect x="72" y="26" width="96" height="124" rx={G.radius}
              fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} opacity="0.6"
              transform="rotate(-4 120 88)" />

        {/* main document */}
        <g filter={`url(#${d.shadow})`}>
          <rect x="64" y="28" width="102" height="124" rx={G.radius}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        </g>

        {/* header / title lines */}
        <rect x="76" y="42" width="52" height="7" rx="3.5" fill={`url(#${d.brand})`} />
        <rect x="76" y="54" width="78" height="4" rx="2" fill={C.lineSoft} />
        <rect x="76" y="62" width="64" height="4" rx="2" fill={C.lineSoft} />

        {/* mini bar chart */}
        <line x1="78" y1="118" x2="154" y2="118" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" />
        {bars.map((h, i) => (
          <rect key={i} x={80 + i * 15} y={118 - h} width="9" height={h} rx="3"
                fill={i >= bars.length - 1 ? `url(#${d.brand})` : C.line}
                opacity={i >= bars.length - 1 ? 1 : 0.6} />
        ))}

        {/* trend overlay */}
        <path d="M84 100 L99 96 L114 102 L129 88 L149 84"
              fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin}
              strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />

        {/* footer line */}
        <rect x="76" y="132" width="60" height="4" rx="2" fill={C.lineSoft} />

        {/* PDF / download badge */}
        <g filter={`url(#${d.shadow})`}>
          <circle cx="158" cy="128" r="20" fill={`url(#${d.brand})`} />
          <circle cx="158" cy="128" r="20" fill="none" stroke={C.brandBright} strokeWidth={G.strokeThin} opacity="0.5" />
        </g>
        <motion.g {...dl}>
          <line x1="158" y1="119" x2="158" y2="132" stroke={C.surface} strokeWidth={G.stroke} strokeLinecap="round" />
          <path d="M152 127 L158 133 L164 127" fill="none" stroke={C.surface}
                strokeWidth={G.stroke} strokeLinecap="round" strokeLinejoin="round" />
        </motion.g>
        <line x1="150" y1="138" x2="166" y2="138" stroke={C.surface} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.9" />
      </motion.g>
    </IllustrationBase>
  )
}
