/**
 * Pure helpers behind the manual figure tools (split, merge, reassign). The database
 * functions oem_figure_split / oem_figure_merge / oem_reassign_entries do the write; these
 * helpers validate the request first so the admin gets a clear message before any call.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
const validCrop = (c) => c && ['x0', 'y0', 'x1', 'y1'].every((k) => num(c[k]) != null) && c.x1 > c.x0 && c.y1 > c.y0

/** Bounding box of two crops in PDF user space. */
export function unionCrop(a, b) {
  if (!validCrop(a)) return validCrop(b) ? { ...b } : null
  if (!validCrop(b)) return { ...a }
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}

/** Split a crop into two non-overlapping halves along `axis` ('x' vertical cut, 'y' horizontal cut) at `ratio` (0.1 to 0.9). */
export function splitCrop(crop, axis = 'x', ratio = 0.5) {
  if (!validCrop(crop)) return null
  const r = Math.min(0.9, Math.max(0.1, Number(ratio) || 0.5))
  if (axis === 'y') { const m = crop.y0 + (crop.y1 - crop.y0) * r; return [{ ...crop, y1: m }, { ...crop, y0: m }] }
  const m = crop.x0 + (crop.x1 - crop.x0) * r
  return [{ ...crop, x1: m }, { ...crop, x0: m }]
}

/** Why a merge is not allowed, or null when it is. Figures on different PDF pages are different drawings. */
export function mergeProblem(figures, fromId, intoId) {
  if (!fromId || !intoId) return 'Choose both figures.'
  if (fromId === intoId) return 'Choose two different figures.'
  const a = figures[fromId]; const b = figures[intoId]
  if (!a || !b) return 'Figure not found.'
  const pa = a.geometry?.pdf_page ?? a.illustration_pdf_page; const pb = b.geometry?.pdf_page ?? b.illustration_pdf_page
  if (pa != null && pb != null && pa !== pb) return 'These figures are on different PDF pages, so they are different drawings.'
  return null
}

/** Why a split is not allowed, or null when it is. */
export function splitProblem(figures, figureId, newId, entryIds) {
  const name = String(newId || '').trim()
  if (!name) return 'Name the new figure.'
  if (name === figureId || figures[name]) return 'That figure name is already used.'
  if (!entryIds?.length) return 'Pick at least one part to move to the new figure.'
  return null
}

/** Why a reassign is not allowed, or null when it is. */
export function reassignProblem(figures, toId, entryIds) {
  if (!toId || !figures[toId]) return 'Choose the figure to move the parts to.'
  if (!entryIds?.length) return 'Pick at least one part.'
  return null
}
