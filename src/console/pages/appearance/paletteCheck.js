/**
 * Pure checks behind Report Appearance.
 *
 * A report theme is judged where it is used: on a WHITE printed page. WCAG
 * asks 3:1 contrast for graphical objects (bars, slices, lines), so a pale
 * colour that fails it is hard to see in a PDF. Two colours that are nearly
 * the same are flagged too, because a legend cannot tell those series apart.
 */

function channel(c) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** #rrggbb -> {r,g,b} or null. */
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function luminance(hex) {
  const c = parseHex(hex)
  if (!c) return null
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

/** WCAG contrast ratio between two colours; null when either is unreadable. */
export function contrastRatio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  if (la == null || lb == null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Simple RGB distance; small means two series look the same. */
export function colourDistance(a, b) {
  const x = parseHex(a); const y = parseHex(b)
  if (!x || !y) return null
  return Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2)
}

export const MIN_GRAPHIC_CONTRAST = 3
export const NEAR_DUPLICATE = 40

/**
 * Audit a palette for use on a white report page.
 * Returns { weak:[{index,hex,ratio}], duplicates:[[i,j]], checked } where
 * `checked` counts the colours that could be read at all.
 */
export function auditPalette(colors = [], background = '#ffffff') {
  const list = Array.isArray(colors) ? colors : []
  const weak = []
  const duplicates = []
  let checked = 0
  list.forEach((hex, i) => {
    const ratio = contrastRatio(hex, background)
    if (ratio == null) return
    checked += 1
    if (ratio < MIN_GRAPHIC_CONTRAST) weak.push({ index: i, hex, ratio })
  })
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = colourDistance(list[i], list[j])
      if (d != null && d < NEAR_DUPLICATE) duplicates.push([i, j])
    }
  }
  return { weak, duplicates, checked }
}

/** Is a diagram background too light for the diagram's light wheel labels? */
export function isLightBackground(hex) {
  const l = luminance(hex)
  return l != null && l > 0.35
}
