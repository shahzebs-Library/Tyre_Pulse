/**
 * TyreConditionGlyph - the ONE picture for a tyre condition (tick, worn tread,
 * nail, flat tyre on the ground, cracked warning, missing, question mark).
 *
 * The geometry is the shared tyre map's (docs/document-specs/tyre-layouts.json
 * `conditions.kinds[].glyph`), the same lines the printed report and the
 * Flutter app draw, so a tyre man who cannot read the word still sees the same
 * picture on every screen. Paints with `currentColor` unless `color` is given.
 *
 * Works standalone (an <svg>) or inside another SVG: pass x / y / size and it
 * renders a nested <svg> positioned in the parent's units.
 */
import { CONDITION_KIND } from '../../lib/tyreLayoutSpec'

const pts = (a) => {
  const out = []
  for (let i = 0; i + 1 < a.length; i += 2) out.push(`${a[i]},${a[i + 1]}`)
  return out.join(' ')
}

export function GlyphShapes({ kind, color = 'currentColor', strokeWidth = 2.4 }) {
  const g = (CONDITION_KIND[kind] || CONDITION_KIND.none).glyph || {}
  const stroke = { fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' }
  return (
    <>
      {(g.closed || []).map((p, i) => <polygon key={`p${i}`} points={pts(p)} {...stroke} />)}
      {(g.strokes || []).map((p, i) => <polyline key={`s${i}`} points={pts(p)} {...stroke} />)}
      {(g.circles || []).map(([cx, cy, r], i) => <circle key={`c${i}`} cx={cx} cy={cy} r={r} {...stroke} />)}
      {(g.dots || []).map(([cx, cy, r], i) => <circle key={`d${i}`} cx={cx} cy={cy} r={r} fill={color} />)}
    </>
  )
}

export default function TyreConditionGlyph({ kind, size = 20, color, strokeWidth, title, x, y, className = '', style }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true, focusable: false }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      x={x}
      y={y}
      className={`tp-cond-glyph ${className}`}
      style={style}
      data-kind={kind}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      <GlyphShapes kind={kind} color={color || 'currentColor'} strokeWidth={strokeWidth} />
    </svg>
  )
}
