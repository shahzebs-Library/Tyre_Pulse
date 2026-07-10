/**
 * marketing/integration-erp — ERP / data integration hero. External source
 * systems (ERP, database, spreadsheet, API) flow through animated connector
 * links into a central Tyre Pulse hub disc. Premium depth, travelling data
 * packets, theme-aware and reduced-motion safe.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function IntegrationErpIllustration({ size = 280, title = 'ERP integration', desc = 'Connect ERP, databases and spreadsheets into one hub', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const float = on
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const hubSpin = on
    ? { animate: { rotate: 360 }, transition: { duration: 18, repeat: Infinity, ease: 'linear' } }
    : {}
  const corePulse = on
    ? { animate: { scale: [1, 1.1, 1], opacity: [0.45, 0.8, 0.45] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}
  const packet = (delay) => on
    ? { animate: { offsetDistance: ['0%', '100%'], opacity: [0, 1, 0] }, transition: { duration: 2.6, delay, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  const hx = 216, hy = 100 // hub centre

  // source nodes (left column)
  const sources = [
    { x: 46, y: 44, label: 'ERP', icon: 'erp' },
    { x: 46, y: 96, label: 'DB', icon: 'db' },
    { x: 46, y: 148, label: 'XLS', icon: 'xls' },
  ]

  const paths = sources.map((s) => `M${s.x + 44} ${s.y} C${s.x + 100} ${s.y}, ${hx - 70} ${hy}, ${hx - 40} ${hy}`)

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 220" animate={animate} {...rest}>
      <BrandDefs d={d} />

      {/* ambient */}
      <ellipse cx="160" cy="200" rx="134" ry="13" fill="var(--text-primary)" opacity="0.06" />
      <circle cx={hx} cy={hy} r="112" fill={`url(#${d.glow})`} />

      {/* connector links */}
      {paths.map((p, i) => (
        <g key={i}>
          <path d={p} fill="none" stroke={C.line} strokeWidth={G.strokeThin} opacity="0.5" />
          <path d={p} fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin}
                strokeDasharray="2 8" strokeLinecap="round" opacity="0.7" />
          {/* travelling data packet */}
          <motion.circle r="3.4" fill={C.brandBright} style={{ offsetPath: `path("${p}")` }} {...packet(i * 0.5)} />
        </g>
      ))}

      {/* source system cards */}
      {sources.map((s, i) => (
        <g key={i}>
          <g filter={`url(#${d.shadow})`}>
            <rect x={s.x} y={s.y - 18} width="44" height="36" rx={G.radiusSm}
                  fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
          </g>
          {/* icon glyphs */}
          {s.icon === 'erp' && (
            <g>
              <rect x={s.x + 8} y={s.y - 8} width="12" height="16" rx="1.5" fill={`url(#${d.brand})`} opacity="0.85" />
              <rect x={s.x + 24} y={s.y - 4} width="12" height="12" rx="1.5" fill={C.line} />
            </g>
          )}
          {s.icon === 'db' && (
            <g fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin}>
              <ellipse cx={s.x + 22} cy={s.y - 8} rx="12" ry="4" />
              <path d={`M${s.x + 10} ${s.y - 8} v14 a12 4 0 0 0 24 0 v-14`} />
              <path d={`M${s.x + 10} ${s.y - 1} a12 4 0 0 0 24 0`} />
            </g>
          )}
          {s.icon === 'xls' && (
            <g>
              <rect x={s.x + 10} y={s.y - 9} width="24" height="18" rx="2" fill="none" stroke={C.line} strokeWidth={G.strokeThin} />
              <line x1={s.x + 22} y1={s.y - 9} x2={s.x + 22} y2={s.y + 9} stroke={C.lineSoft} strokeWidth="1.4" />
              <line x1={s.x + 10} y1={s.y} x2={s.x + 34} y2={s.y} stroke={`url(#${d.brand})`} strokeWidth="1.6" />
            </g>
          )}
        </g>
      ))}

      {/* API pill (top, curved link into hub) */}
      <path d={`M170 34 C196 34, ${hx - 20} 64, ${hx} ${hy - 40}`} fill="none"
            stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} strokeDasharray="2 8" opacity="0.7" />
      <g filter={`url(#${d.shadow})`}>
        <rect x="130" y="24" width="44" height="20" rx="10" fill={C.surface} stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      </g>
      <text x="152" y="38" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.sub}>API</text>

      {/* central hub */}
      <motion.g {...float}>
        <motion.circle cx={hx} cy={hy} r="46" fill={`url(#${d.glow})`} {...corePulse} style={{ transformOrigin: `${hx}px ${hy}px` }} />
        {/* rotating connector ring */}
        <motion.g style={{ transformOrigin: `${hx}px ${hy}px` }} {...hubSpin}>
          <circle cx={hx} cy={hy} r="38" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} strokeDasharray="3 6" opacity="0.7" />
        </motion.g>
        <g filter={`url(#${d.shadow})`}>
          <circle cx={hx} cy={hy} r="30" fill={C.ink} opacity="0.92" />
          <circle cx={hx} cy={hy} r="30" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} />
        </g>
        {/* tyre-tread motif in hub */}
        {Array.from({ length: 10 }).map((_, i) => {
          const a = (i / 10) * Math.PI * 2
          const x1 = hx + Math.cos(a) * 22, y1 = hy + Math.sin(a) * 22
          const x2 = hx + Math.cos(a) * 27, y2 = hy + Math.sin(a) * 27
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brandBright} strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />
        })}
        <circle cx={hx} cy={hy} r="11" fill={C.surface} />
        {/* central link/plug glyph */}
        <path d={`M${hx - 5} ${hy - 4} h10 M${hx - 5} ${hy + 4} h10 M${hx} ${hy - 8} v16`}
              stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} strokeLinecap="round" />
      </motion.g>
    </IllustrationBase>
  )
}
