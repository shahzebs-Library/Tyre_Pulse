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

function toHex({ r, g, b }) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/**
 * The nearest darker shade of `hex` that reaches `target` contrast on `bg`
 * (keeps the hue by scaling the channels down). Returns the colour unchanged
 * when it already passes, or null when it cannot be read.
 */
export function darkenToContrast(hex, target = MIN_GRAPHIC_CONTRAST, bg = '#ffffff') {
  const c = parseHex(hex)
  if (!c) return null
  const start = contrastRatio(hex, bg)
  if (start != null && start >= target) return toHex(c)
  for (let f = 0.98; f > 0; f -= 0.02) {
    const next = toHex({ r: c.r * f, g: c.g * f, b: c.b * f })
    const ratio = contrastRatio(next, bg)
    if (ratio != null && ratio >= target) return next
  }
  return '#000000'
}

/** Replace every pale colour in a palette with its darker suggestion. */
export function fixPalette(colors = [], target = MIN_GRAPHIC_CONTRAST) {
  return (Array.isArray(colors) ? colors : []).map((hex) => darkenToContrast(hex, target) || hex)
}

/**
 * Plain-English name for a colour so a pale swatch can be named in a list
 * ("pale yellow"). Based on hue and lightness; good enough to point at it.
 */
export function colourName(hex) {
  const c = parseHex(hex)
  if (!c) return 'unreadable colour'
  const r = c.r / 255; const g = c.g / 255; const b = c.b / 255
  const max = Math.max(r, g, b); const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d < 0.08) return l > 0.85 ? 'white' : l < 0.15 ? 'black' : 'grey'
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  const names = [[15, 'red'], [45, 'orange'], [70, 'yellow'], [160, 'green'], [200, 'teal'], [255, 'blue'], [290, 'purple'], [335, 'pink'], [360, 'red']]
  const base = names.find(([edge]) => h < edge)[1]
  return l > 0.7 ? `pale ${base}` : l < 0.3 ? `dark ${base}` : base
}

/**
 * Average lightness of the visible pixels of an image (0 dark to 1 light),
 * from RGBA bytes. Transparent pixels are ignored. null when nothing is visible.
 */
export function averageLightness(rgba) {
  if (!rgba || !rgba.length) return null
  let sum = 0; let n = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 32) continue
    sum += (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255
    n += 1
  }
  return n ? sum / n : null
}
