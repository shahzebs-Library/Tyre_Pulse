/**
 * How a QR label is laid out on an A4 sheet, and how its text is made to fit.
 *
 * THREE THINGS WERE WRONG WITH THE EXPORTED SHEET, all of them measurable:
 *
 * 1. The text was drawn centred with NO width constraint. jsPDF neither wraps
 *    nor clips, so a long value simply ran past the label. Measured against the
 *    live data with the real font: the longest tyre serial in the table is 34
 *    characters and renders 64.8 mm wide inside a 60 mm label - 2.4 mm out of
 *    each side, into the gutter between labels. 76 serials exceed 14 characters.
 *
 * 2. The screen preview truncated with a CSS ellipsis while the PDF did not, so
 *    what you saw was not what printed.
 *
 * 3. The label-size control was decorative. It drove a pixel width in the
 *    preview only; the PDF was hard-coded to 60 mm whatever was chosen, while
 *    the screen said "Print-ready, 70 mm labels". The page stated a size it did
 *    not produce.
 *
 * Pure on purpose - it takes a measuring function rather than a jsPDF document -
 * so the fitting rules can be tested without a PDF engine.
 */

/** A4, millimetres. */
export const PAGE_W = 210
export const PAGE_H = 297
const MARGIN_Y = 12
const GAP = 5

/**
 * The three offered label sizes, in REAL millimetres.
 *
 * `w` is what the sheet prints and what the screen now claims. The height is
 * the width plus a fixed 8 mm of furniture (header bar, serial line, sub line),
 * so a bigger label gives its extra room to the QR code rather than to padding -
 * the code is the part that has to survive a scan off a dusty wheel.
 */
export const LABEL_SIZES = {
  sm: { key: 'sm', label: 'Small', w: 40 },
  md: { key: 'md', label: 'Medium', w: 55 },
  lg: { key: 'lg', label: 'Large', w: 70 },
}

export const DEFAULT_SIZE = 'md'

/**
 * The grid for one label size: how many fit across and down an A4 page, and
 * where the first one starts.
 *
 * DERIVED, never hard-coded. The old code fixed 3 columns and 4 rows around a
 * 60 mm label; at 40 mm that wastes most of the sheet and at 70 mm it would
 * overflow the page width.
 */
export function labelGrid(sizeKey = DEFAULT_SIZE) {
  const size = LABEL_SIZES[sizeKey] || LABEL_SIZES[DEFAULT_SIZE]
  const w = size.w
  const h = w + 8
  // At least one column, however wide the label: a grid of zero prints nothing.
  const cols = Math.max(1, Math.floor((PAGE_W - GAP) / (w + GAP)))
  const rows = Math.max(1, Math.floor((PAGE_H - MARGIN_Y * 2 + GAP) / (h + GAP)))
  const used = cols * w + (cols - 1) * GAP
  return {
    key: size.key,
    label: size.label,
    w,
    h,
    cols,
    rows,
    perPage: cols * rows,
    gap: GAP,
    marginX: (PAGE_W - used) / 2,
    marginY: MARGIN_Y,
  }
}

/** How many sheets a run of labels needs. Zero labels is zero pages, not one. */
export function pageCount(labelCount, sizeKey = DEFAULT_SIZE) {
  const n = Number(labelCount) || 0
  if (n <= 0) return 0
  return Math.ceil(n / labelGrid(sizeKey).perPage)
}

/**
 * Make a string fit a given width.
 *
 * `measure(text, size)` returns the rendered width in mm at that font size, so
 * the caller supplies jsPDF's own measurement and this stays pure.
 *
 * THE TWO MODES ARE NOT INTERCHANGEABLE, and this is the load-bearing decision:
 *
 *   wrap  - shrink, then break across lines. For the SERIAL or asset number.
 *           A truncated identifier is not a shorter identifier, it is a
 *           DIFFERENT one: somebody reading "EP0604207..." off a label and
 *           typing it into the app finds nothing, or worse finds another tyre.
 *           So the identifier is never cut. It gets smaller, then it wraps.
 *
 *   clip  - shrink, then cut with a trailing ellipsis. For the secondary line
 *           (brand, site), which is context. Losing the tail of "QIDDIYA-UPPER
 *           PLATEAU" costs nothing, and the ellipsis says it was shortened.
 *
 * @returns {{lines:string[], size:number, clipped:boolean}}
 */
export function fitLabelText(measure, text, maxW, {
  startSize = 7.5, minSize = 4.5, step = 0.25, mode = 'wrap', maxLines = 2,
} = {}) {
  const raw = String(text == null ? '' : text).trim()
  if (!raw) return { lines: [], size: startSize, clipped: false }
  if (typeof measure !== 'function' || !(maxW > 0)) {
    return { lines: [raw], size: startSize, clipped: false }
  }

  // Biggest size at which the whole string fits on one line.
  for (let s = startSize; s >= minSize; s -= step) {
    if (measure(raw, s) <= maxW) return { lines: [raw], size: round2(s), clipped: false }
  }

  if (mode === 'clip') {
    const s = minSize
    if (measure('...', s) > maxW) return { lines: [], size: round2(s), clipped: true }
    let cut = raw
    while (cut.length > 1 && measure(`${cut}...`, s) > maxW) cut = cut.slice(0, -1)
    return { lines: [`${cut}...`], size: round2(s), clipped: true }
  }

  // wrap: break the identifier across lines rather than lose any of it. Break on
  // spaces where there are any, and mid-token when there are none - a serial is
  // usually one unbroken run, so a character break is the only way to keep all
  // of it.
  for (let s = startSize; s >= minSize; s -= step) {
    const lines = wrapAt(measure, raw, maxW, s)
    if (lines.length <= maxLines) return { lines, size: round2(s), clipped: false }
  }
  const lines = wrapAt(measure, raw, maxW, minSize)
  // Past maxLines even at the smallest size the label genuinely cannot hold it.
  // Report clipped:true so the caller can say so rather than print a half value
  // that looks whole.
  return { lines: lines.slice(0, maxLines), size: round2(minSize), clipped: lines.length > maxLines }
}

function wrapAt(measure, text, maxW, size) {
  const out = []
  let line = ''
  const push = () => { if (line) { out.push(line); line = '' } }
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (measure(next, size) <= maxW) { line = next; continue }
    push()
    if (measure(word, size) <= maxW) { line = word; continue }
    // One token wider than the label: break it by character.
    let chunk = ''
    for (const ch of word) {
      if (measure(chunk + ch, size) > maxW && chunk) { out.push(chunk); chunk = ch }
      else chunk += ch
    }
    line = chunk
  }
  push()
  return out
}

function round2(n) { return Math.round(n * 100) / 100 }
