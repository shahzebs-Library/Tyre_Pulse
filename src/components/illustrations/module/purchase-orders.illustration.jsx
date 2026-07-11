/**
 * module/purchase-orders — procurement motif: an invoice / PO document with a
 * loaded tyre and a currency accent coin. Theme-aware via tokens with a slow
 * float and a gentle coin spin.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function PurchaseOrdersIllustration({ size = 200, title = 'No purchase orders', desc = 'Raise a PO to start procurement', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce
  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const spin = on
    ? { animate: { scaleX: [1, 0.4, 1] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ground + ambient glow */}
      <ellipse cx="120" cy="156" rx="88" ry="12" fill="var(--text-primary)" opacity="0.06" />
      <circle cx="112" cy="88" r="74" fill={`url(#${d.glow})`} />

      {/* invoice / PO document */}
      <motion.g {...float}>
        <g filter={`url(#${d.shadow})`}>
          <path d="M56 30 h72 l18 18 v100 a6 6 0 0 1 -6 6 H56 a6 6 0 0 1 -6 -6 V36 a6 6 0 0 1 6 -6 z"
                fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
          {/* folded corner */}
          <path d="M128 30 v18 h18 z" fill={C.lineSoft} stroke={C.line} strokeWidth="1.5" />
        </g>
        {/* header bar */}
        <rect x="64" y="42" width="42" height="10" rx="4" fill={`url(#${d.brand})`} />
        {/* line items */}
        {[66, 80, 94].map((y, i) => (
          <g key={y}>
            <line x1="64" y1={y} x2="118" y2={y} stroke={C.lineSoft} strokeWidth={G.strokeThin} strokeLinecap="round" />
            <line x1="124" y1={y} x2={i === 2 ? 132 : 138} y2={y} stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" />
          </g>
        ))}
        {/* total divider + emphasised total */}
        <line x1="64" y1="108" x2="138" y2="108" stroke={C.line} strokeWidth={G.strokeThin} strokeDasharray="3 4" />
        <line x1="64" y1="120" x2="96" y2="120" stroke={C.brandBright} strokeWidth={G.stroke} strokeLinecap="round" />
        <line x1="118" y1="120" x2="138" y2="120" stroke={C.brandBright} strokeWidth={G.stroke} strokeLinecap="round" />
      </motion.g>

      {/* loaded tyre */}
      <g filter={`url(#${d.shadow})`}>
        <circle cx="168" cy="118" r="28" fill={C.ink} opacity="0.9" />
        <circle cx="168" cy="118" r="28" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
        <circle cx="168" cy="118" r="12" fill={C.surface} />
        <circle cx="168" cy="118" r="12" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
        {Array.from({ length: 10 }).map((_, i) => {
          const a = (i / 10) * Math.PI * 2
          const x1 = 168 + Math.cos(a) * 21, y1 = 118 + Math.sin(a) * 21
          const x2 = 168 + Math.cos(a) * 26, y2 = 118 + Math.sin(a) * 26
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        })}
      </g>

      {/* currency accent coin */}
      <motion.g style={{ transformOrigin: '190px 58px' }} {...spin} filter={`url(#${d.shadow})`}>
        <circle cx="190" cy="58" r="20" fill={C.warning} />
        <circle cx="190" cy="58" r="20" fill="none" stroke={C.surface} strokeWidth={G.strokeThin} />
        <text x="190" y="66" textAnchor="middle" fontSize="22" fontWeight="700" fill={C.surface} fontFamily="system-ui, sans-serif">$</text>
      </motion.g>
    </IllustrationBase>
  )
}
