/**
 * pdfConditionGlyph - draws the shared tyre-condition picture with jsPDF
 * primitives, so the printed report shows the SAME tick / worn tread / nail /
 * flat tyre / warning / minus / question mark as the screen and the phone
 * (geometry: docs/document-specs/tyre-layouts.json `conditions.kinds`).
 */
import { CONDITION_KIND, CONDITION_KINDS, riskRgb } from './tyreLayoutSpec'

/** Draw `kind`'s glyph centred at (cx, cy), `size` mm square, in `rgb`. */
export function drawConditionGlyph(doc, kind, cx, cy, size, rgb = [255, 255, 255], strokeUnits = 2.6) {
  const g = (CONDITION_KIND[kind] || CONDITION_KIND.none).glyph || {}
  const k = size / 24
  const X = (v) => cx - size / 2 + v * k
  const Y = (v) => cy - size / 2 + v * k
  doc.setDrawColor(...rgb)
  doc.setFillColor(...rgb)
  doc.setLineWidth(strokeUnits * k)
  if (doc.setLineCap) doc.setLineCap('round')
  if (doc.setLineJoin) doc.setLineJoin('round')
  const poly = (p, close) => {
    for (let i = 0; i + 3 < p.length; i += 2) doc.line(X(p[i]), Y(p[i + 1]), X(p[i + 2]), Y(p[i + 3]))
    if (close && p.length >= 4) doc.line(X(p[p.length - 2]), Y(p[p.length - 1]), X(p[0]), Y(p[1]))
  }
  for (const p of g.closed || []) poly(p, true)
  for (const p of g.strokes || []) poly(p, false)
  for (const [x, y, r] of g.circles || []) doc.circle(X(x), Y(y), r * k, 'S')
  for (const [x, y, r] of g.dots || []) doc.circle(X(x), Y(y), r * k, 'F')
  if (doc.setLineCap) doc.setLineCap('butt')
}

/** A filled disc in the kind's (light palette) colour with the white glyph on it. */
export function drawConditionBadge(doc, kind, cx, cy, radius) {
  const band = (CONDITION_KIND[kind] || CONDITION_KIND.none).band
  doc.setFillColor(...riskRgb(band, 'light'))
  doc.circle(cx, cy, radius, 'F')
  drawConditionGlyph(doc, kind, cx, cy, radius * 1.45, [255, 255, 255], 3)
}

/**
 * One legend row per condition: badge + word. Returns the height used (mm).
 * `labelOf(kind)` names a kind (defaults to the spec's English label).
 */
export function drawConditionLegendRow(doc, x, y, width, { labelOf, textRgb = [55, 65, 81], fontSize = 7 } = {}) {
  const name = (k) => (labelOf ? labelOf(k.kind) : null) || k.label
  doc.setFontSize(fontSize)
  doc.setFont('helvetica', 'normal')
  const items = CONDITION_KINDS.map((k) => ({ k, w: 5.2 + doc.getTextWidth(name(k)) + 4 }))
  const total = items.reduce((a, b) => a + b.w, 0)
  let lx = x + Math.max(0, (width - total) / 2)
  for (const { k, w } of items) {
    drawConditionBadge(doc, k.kind, lx + 1.9, y - 1.2, 1.9)
    doc.setTextColor(...textRgb)
    doc.text(name(k), lx + 4.6, y)
    lx += w
  }
  return 5
}
