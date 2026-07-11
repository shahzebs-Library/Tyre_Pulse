/**
 * module/inventory — warehouse shelving stocked with tyres and boxes, for the
 * inventory / stock module. Theme-aware, with a subtle scan pulse.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

function StackedTyre({ cx, cy, rx, ry, d, branded }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={C.ink} opacity="0.9" />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none"
               stroke={branded ? `url(#${d.brand})` : C.muted} strokeWidth={G.strokeThin} />
      <ellipse cx={cx} cy={cy} rx={rx * 0.4} ry={ry * 0.4} fill={C.surface} opacity="0.85" />
    </g>
  )
}

export default function InventoryIllustration({ size = 200, title = 'Inventory', desc = 'Tyre stock & warehouse', animate = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const scan = animate && !reduce
    ? { animate: { y: [30, 118, 30], opacity: [0, 0.9, 0] }, transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>
      <BrandDefs d={d} />

      <circle cx="120" cy="84" r="80" fill={`url(#${d.glow})`} />
      <ellipse cx="120" cy="156" rx="98" ry="10" fill="var(--text-primary)" opacity="0.06" />

      <g filter={`url(#${d.shadow})`}>
        {/* shelving frame */}
        <rect x="40" y="30" width="160" height="118" rx={G.radius}
              fill={`url(#${d.surface})`} stroke={C.line} strokeWidth={G.strokeThin} />
        {/* shelf dividers */}
        <line x1="42" y1="70" x2="198" y2="70" stroke={C.line} strokeWidth={G.stroke} strokeLinecap="round" />
        <line x1="42" y1="110" x2="198" y2="110" stroke={C.line} strokeWidth={G.stroke} strokeLinecap="round" />
        {/* uprights */}
        <line x1="120" y1="32" x2="120" y2="146" stroke={C.lineSoft} strokeWidth={G.strokeThin} />
      </g>

      {/* top shelf — stacked tyres */}
      <StackedTyre cx={68} cy={56} rx={20} ry={8} d={d} branded />
      <StackedTyre cx={68} cy={50} rx={20} ry={8} d={d} branded={false} />
      <StackedTyre cx={162} cy={56} rx={20} ry={8} d={d} branded={false} />
      <StackedTyre cx={162} cy={50} rx={20} ry={8} d={d} branded />

      {/* middle shelf — boxes */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={52 + i * 44} y={82} width="34" height="24" rx={G.radiusSm}
                fill={C.surface} stroke={C.line} strokeWidth={G.strokeThin} />
          <line x1={52 + i * 44} y1="90" x2={86 + i * 44} y2="90" stroke={C.lineSoft} strokeWidth={G.strokeThin} />
          <rect x={62 + i * 44} y={94} width="14" height="4" rx="2"
                fill={i === 1 ? `url(#${d.brand})` : C.line} />
        </g>
      ))}

      {/* bottom shelf — tyres on edge */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx={62 + i * 38} cy={128} r={13} fill={C.ink} opacity="0.9" />
          <circle cx={62 + i * 38} cy={128} r={13} fill="none"
                  stroke={i % 2 ? `url(#${d.brand})` : C.muted} strokeWidth={G.strokeThin} />
          <circle cx={62 + i * 38} cy={128} r={5} fill={C.surface} />
        </g>
      ))}

      {/* scan pulse sweeping the racks */}
      <motion.line x1="44" x2="196" y1="0" y2="0" stroke={C.brandBright} strokeWidth={G.strokeThin} strokeLinecap="round" {...scan} />
    </IllustrationBase>
  )
}
