/**
 * report/cover-hero — a report cover hero graphic: a haulage truck silhouette on
 * a road horizon with a branded tyre and a clear title band, leaving space for a
 * report heading. Tuned to read cleanly on light print surfaces while remaining
 * fully theme-aware for the app's dark UI. Motion is off by default (rasterised
 * for print) but a subtle idle float is supported when animate is enabled.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function CoverHeroIllustration({ size = 320, title = 'Fleet report', desc = 'Report cover hero graphic', animate = false, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -3, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const spin = on
    ? { animate: { rotate: 360 }, transition: { duration: 14, repeat: Infinity, ease: 'linear' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 180" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* soft brand wash behind the horizon */}
      <rect x="0" y="0" width="320" height="120" fill={`url(#${d.glow})`} opacity="0.7" />

      {/* road horizon */}
      <line x1="18" y1="132" x2="302" y2="132" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" />
      <line x1="18" y1="132" x2="302" y2="132" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.4" />
      {/* lane dashes */}
      <line x1="30" y1="146" x2="290" y2="146" stroke={C.lineSoft} strokeWidth={G.strokeThin}
            strokeLinecap="round" strokeDasharray="10 12" opacity="0.9" />

      {/* ground shadow */}
      <ellipse cx="150" cy="132" rx="120" ry="7" fill="var(--text-primary)" opacity="0.06" />

      <motion.g {...float}>
        {/* truck silhouette (cab + trailer) */}
        <g filter={`url(#${d.shadow})`}>
          {/* trailer body */}
          <rect x="150" y="70" width="118" height="46" rx={G.radiusSm}
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
          {/* cab */}
          <path d="M92 116 V88 Q92 80 100 80 H132 L150 96 V116 Z"
                fill={`url(#${d.brand})`} stroke={C.brandBright} strokeWidth={G.strokeThin} strokeLinejoin="round" />
          {/* windshield */}
          <path d="M116 88 H132 L146 100 H116 Z" fill={C.surface} opacity="0.85" />
          {/* trailer accent stripe */}
          <rect x="158" y="82" width="102" height="8" rx="4" fill={C.brandBright} opacity="0.35" />
          <rect x="158" y="96" width="72" height="4" rx="2" fill={C.lineSoft} />
        </g>

        {/* wheels */}
        {[122, 178, 214, 246].map((cx, i) => (
          <g key={i}>
            <circle cx={cx} cy="120" r="12" fill={C.ink} opacity="0.9" />
            <circle cx={cx} cy="120" r="12" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} />
            <circle cx={cx} cy="120" r="4.5" fill={C.surface} />
          </g>
        ))}
      </motion.g>

      {/* hero brand tyre (left, title anchor) */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="52" cy="70" r="30" fill={C.ink} opacity="0.92" />
        <motion.g {...spin} style={{ transformOrigin: '52px 70px' }}>
          <circle cx="52" cy="70" r="30" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2
            const x1 = 52 + Math.cos(a) * 22, y1 = 70 + Math.sin(a) * 22
            const x2 = 52 + Math.cos(a) * 28, y2 = 70 + Math.sin(a) * 28
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
          })}
        </motion.g>
        <circle cx="52" cy="70" r="12" fill={C.surface} />
        <circle cx="52" cy="70" r="12" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
      </g>

      {/* title band placeholder */}
      <g>
        <rect x="96" y="24" width="132" height="9" rx="4.5" fill={`url(#${d.brand})`} />
        <rect x="96" y="40" width="94" height="5" rx="2.5" fill={C.lineSoft} />
      </g>
    </IllustrationBase>
  )
}
