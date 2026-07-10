/**
 * Illustration primitives — the shared wrapper + reusable defs every Tyre Pulse
 * illustration is built from. Provides:
 *   • <IllustrationBase>  accessible, theme-aware, motion-safe <svg> shell
 *   • <BrandDefs>         gradients / soft shadows / glows, id-namespaced per
 *                         instance so multiple illustrations on one page never
 *                         collide on gradient ids
 *   • useDefs()           returns unique ids for the current instance
 *
 * All illustration components should render an <IllustrationBase> and pull
 * colours from ../tokens (C) so they adapt to Light/Dark + tenant branding.
 */
import { useId } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { C, DEFAULT_VIEWBOX } from './tokens'

/**
 * Build the namespaced def ids for one illustration instance.
 * Usage: const d = useDefs(); …fill={`url(#${d.brand})`}… plus <BrandDefs d={d} />
 */
export function useDefs() {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '')
  return {
    brand:   `bg_${raw}`,
    surface: `sg_${raw}`,
    accent:  `ag_${raw}`,
    shadow:  `sh_${raw}`,
    glow:    `gl_${raw}`,
    fade:    `fd_${raw}`,
  }
}

/**
 * Reusable gradient / filter definitions. Pass the ids object from useDefs()
 * so references stay unique. Colours are theme CSS variables → adapt on theme
 * switch with no re-render.
 */
export function BrandDefs({ d }) {
  return (
    <defs>
      <linearGradient id={d.brand} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%"  stopColor={C.brandBright} />
        <stop offset="100%" stopColor={C.brand} />
      </linearGradient>
      <linearGradient id={d.accent} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"  stopColor={C.accentStrong} />
        <stop offset="100%" stopColor={C.accent} />
      </linearGradient>
      <linearGradient id={d.surface} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"  stopColor={C.surface} stopOpacity="1" />
        <stop offset="100%" stopColor={C.surface} stopOpacity="0.65" />
      </linearGradient>
      <radialGradient id={d.glow} cx="50%" cy="50%" r="50%">
        <stop offset="0%"  stopColor={C.brandBright} stopOpacity="0.35" />
        <stop offset="100%" stopColor={C.brandBright} stopOpacity="0" />
      </radialGradient>
      <linearGradient id={d.fade} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"  stopColor={C.line} stopOpacity="0.5" />
        <stop offset="100%" stopColor={C.line} stopOpacity="0.05" />
      </linearGradient>
      {/* Soft layered drop shadow for depth. */}
      <filter id={d.shadow} x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.18" />
      </filter>
    </defs>
  )
}

/**
 * Accessible, theme-aware SVG shell.
 *
 * @param {string} title        Short a11y label (required for meaningful art).
 * @param {string} [desc]       Longer description.
 * @param {number} [size=200]   Rendered width in px; height keeps the viewBox aspect.
 * @param {string} [viewBox]    SVG viewBox (default 4:3).
 * @param {boolean}[animate=true] Enable subtle motion (still disabled if the
 *                               user prefers reduced motion).
 * @param {boolean}[decorative] If true, hidden from a11y tree (aria-hidden).
 */
export function IllustrationBase({
  title,
  desc,
  size = 200,
  viewBox = DEFAULT_VIEWBOX,
  animate = true,
  decorative = false,
  className = '',
  style,
  children,
}) {
  const reduce = useReducedMotion()
  const motionOn = animate && !reduce
  const titleId = useId()
  const descId = useId()

  const a11y = decorative
    ? { 'aria-hidden': true, role: 'presentation' }
    : { role: 'img', 'aria-labelledby': `${titleId}${desc ? ' ' + descId : ''}` }

  const Svg = motionOn ? motion.svg : 'svg'
  const anim = motionOn
    ? { initial: { opacity: 0, scale: 0.98 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } }
    : {}

  return (
    <Svg
      viewBox={viewBox}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      className={`tp-illustration max-w-full h-auto ${className}`}
      style={{ display: 'block', ...style }}
      {...a11y}
      {...anim}
    >
      {!decorative && <title id={titleId}>{title}</title>}
      {!decorative && desc && <desc id={descId}>{desc}</desc>}
      {children}
    </Svg>
  )
}

/** Re-export the motion primitive so illustrations can add nested animation. */
export { motion, useReducedMotion, C }
