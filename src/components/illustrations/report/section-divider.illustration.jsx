/**
 * report/section-divider — a thin decorative band used to separate report
 * sections. A centred brand-gradient rule with a small tyre node and tapered
 * fade lines either side. Reads crisply on light print surfaces; theme-aware for
 * the dark app UI. Motion off by default; a gentle node pulse when enabled.
 */
import { IllustrationBase, BrandDefs, useDefs, motion, useReducedMotion, C } from '../primitives'
import { G } from '../tokens'

export default function SectionDividerIllustration({ size = 320, title = 'Section divider', desc = 'Decorative section divider', animate = false, decorative = true, ...rest }) {
  const d = useDefs()
  const reduce = useReducedMotion()
  const on = animate && !reduce

  const pulse = on
    ? { animate: { scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
    : {}

  return (
    <IllustrationBase title={title} desc={desc} size={size} viewBox="0 0 320 60" animate={animate} decorative={decorative} {...rest}>
      <BrandDefs d={d} />

      {/* left tapered rule */}
      <line x1="20" y1="30" x2="132" y2="30" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.5" />
      <line x1="60" y1="30" x2="130" y2="30" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.55" />

      {/* right tapered rule */}
      <line x1="188" y1="30" x2="300" y2="30" stroke={C.line} strokeWidth={G.strokeThin} strokeLinecap="round" opacity="0.5" />
      <line x1="190" y1="30" x2="260" y2="30" stroke={`url(#${d.brand})`} strokeWidth={G.stroke} strokeLinecap="round" opacity="0.55" />

      {/* flanking diamonds */}
      <rect x="146" y="26" width="8" height="8" rx="1.5" transform="rotate(45 150 30)" fill={C.brandBright} opacity="0.5" />
      <rect x="166" y="26" width="8" height="8" rx="1.5" transform="rotate(45 170 30)" fill={C.brandBright} opacity="0.5" />

      {/* centre tyre node */}
      <motion.g {...pulse} style={{ transformOrigin: '160px 30px' }}>
        <circle cx="160" cy="30" r="15" fill={`url(#${d.glow})`} />
        <circle cx="160" cy="30" r="11" fill={C.ink} opacity="0.9" />
        <circle cx="160" cy="30" r="11" fill="none" stroke={`url(#${d.brand})`} strokeWidth={G.strokeThin} />
        <circle cx="160" cy="30" r="4" fill={C.surface} />
      </motion.g>
    </IllustrationBase>
  )
}
