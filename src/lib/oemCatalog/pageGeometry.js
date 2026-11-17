/**
 * Page geometry for OEM parts books. Pure functions over pdf.js data, no canvas
 * and no network. Everything is in PDF USER SPACE (origin bottom-left, y up,
 * before page rotation) so a stored crop survives zoom, resize and rotation:
 * the viewer converts it with viewport.convertToViewportPoint at render time.
 *
 * Inputs
 *   opList  = await page.getOperatorList()   (vector paths and images)
 *   OPS     = pdfjsLib.OPS
 *   items   = (await page.getTextContent()).items
 * Output boxes are { x0, y0, x1, y1 } with x0 < x1 and y0 < y1.
 */

export const bboxOf = (pts) => ({
  x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])),
})
export const width = (b) => b.x1 - b.x0
export const height = (b) => b.y1 - b.y0
export const area = (b) => Math.max(0, width(b)) * Math.max(0, height(b))
export const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })
export const expand = (b, m) => ({ x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m })
export const intersects = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
export function intersection(a, b) {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) }
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null
}
export function iou(a, b) {
  const i = intersection(a, b)
  if (!i) return 0
  return area(i) / (area(a) + area(b) - area(i))
}
export const contains = (b, x, y) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1

function applyCtm(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] }
function mul(m, n) { // m applied after n  (PDF: new CTM = n x CTM)
  return [
    n[0] * m[0] + n[1] * m[2], n[0] * m[1] + n[1] * m[3],
    n[2] * m[0] + n[3] * m[2], n[2] * m[1] + n[3] * m[3],
    n[4] * m[0] + n[5] * m[2] + m[4], n[4] * m[1] + n[5] * m[3] + m[5],
  ]
}

/** Vector path and image extents with the CTM applied. kind: 'path' | 'image'. */
export function drawingBoxes(opList, OPS) {
  const boxes = []
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject].filter((v) => v != null))
  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i]
    const args = opList.argsArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.transform) ctm = mul(ctm, args)
    else if (fn === OPS.constructPath) {
      const mm = args?.[2]
      if (mm && mm.length === 4 && mm.every(Number.isFinite)) {
        const [a, b, c, d] = mm
        boxes.push({ ...bboxOf([applyCtm(ctm, a, b), applyCtm(ctm, c, b), applyCtm(ctm, a, d), applyCtm(ctm, c, d)]), kind: 'path' })
      }
    } else if (imageOps.has(fn)) {
      boxes.push({ ...bboxOf([applyCtm(ctm, 0, 0), applyCtm(ctm, 1, 0), applyCtm(ctm, 0, 1), applyCtm(ctm, 1, 1)]), kind: 'image' })
    }
  }
  return boxes
}

/** Text items as boxes in user space. */
export function textBoxes(items) {
  return items.filter((it) => String(it.str || '').trim()).map((it) => {
    const x = it.transform[4]; const y = it.transform[5]
    const h = it.height || Math.abs(it.transform[3]) || 8
    return { str: String(it.str).trim(), x0: x, y0: y, x1: x + (it.width || it.str.length * h * 0.5), y1: y + h }
  })
}

/** Real page size, rotation and orientation as the reader sees them. */
export function pageInfo(page) {
  const [x0, y0, x1, y1] = page.view
  const rotate = ((page.rotate || 0) % 360 + 360) % 360
  const w = x1 - x0; const h = y1 - y0
  const swap = rotate === 90 || rotate === 270
  const dispW = swap ? h : w; const dispH = swap ? w : h
  return { width: w, height: h, rotate, displayWidth: dispW, displayHeight: dispH, landscape: dispW > dispH, view: [x0, y0, x1, y1] }
}

/** Drop frame borders, page-wide rules and specks: they are not drawing content. */
export function contentBoxes(boxes, info, { minSide = 0.4, frameRatio = 0.9 } = {}) {
  const pageArea = info.width * info.height
  return boxes.filter((b) => {
    if (area(b) > frameRatio * pageArea) return false // page frame / background
    const w = width(b); const h = height(b)
    if (w < minSide && h < minSide) return false
    if ((w > 0.8 * info.width && h < 2) || (h > 0.8 * info.height && w < 2)) return false // long rules
    return true
  })
}

/** Union-find clustering of boxes whose gap-expanded rectangles touch. */
export function clusterBoxes(boxes, gap) {
  const n = boxes.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const ex = boxes.map((b) => expand(b, gap / 2))
  const order = [...ex.keys()].sort((a, b) => ex[a].x0 - ex[b].x0)
  for (let ai = 0; ai < n; ai += 1) {
    const a = order[ai]
    for (let bi = ai + 1; bi < n; bi += 1) {
      const b = order[bi]
      if (ex[b].x0 > ex[a].x1) break
      if (intersects(ex[a], ex[b])) parent[find(a)] = find(b)
    }
  }
  const groups = new Map()
  boxes.forEach((b, i) => { const r = find(i); groups.set(r, [...(groups.get(r) || []), b]) })
  return [...groups.values()].map((members) => ({
    bbox: members.reduce((u, b) => union(u, b), members[0]),
    members: members.length,
    images: members.filter((m) => m.kind === 'image').length,
  }))
}

/**
 * Separate the drawings on one page.
 * Returns figures [{ bbox, members, ambiguous, reason }] sorted top-to-bottom,
 * left-to-right. A cluster that falls apart into two substantial drawings at a
 * tighter gap is flagged ambiguous: the engine will not guess where to cut.
 */
export function segmentFigures(boxes, info, { gap = 14, tightGap = 1.5, minArea = 1500, minMembers = 3 } = {}) {
  const content = contentBoxes(boxes, info)
  const coarse = clusterBoxes(content, gap).filter((c) => area(c.bbox) >= minArea && (c.members >= minMembers || c.images > 0))
  const figures = coarse.map((c) => {
    const inner = content.filter((b) => intersects(b, c.bbox) && b.x0 >= c.bbox.x0 - 0.01 && b.x1 <= c.bbox.x1 + 0.01 && b.y0 >= c.bbox.y0 - 0.01 && b.y1 <= c.bbox.y1 + 0.01)
    const tight = clusterBoxes(inner, tightGap).filter((t) => area(t.bbox) >= 0.2 * area(c.bbox) && t.members >= minMembers)
    const ambiguous = tight.length >= 2
    return { bbox: c.bbox, members: c.members, ambiguous, reason: ambiguous ? `Splits into ${tight.length} drawings at a tighter gap; cut not certain` : '', parts: ambiguous ? tight.map((t) => t.bbox) : [] }
  })
  const rowTol = 0.15 * info.height
  figures.sort((a, b) => (Math.abs(b.bbox.y1 - a.bbox.y1) > rowTol ? b.bbox.y1 - a.bbox.y1 : a.bbox.x0 - b.bbox.x0))
  return figures.map((f, i) => ({ ...f, order: i + 1 }))
}

/**
 * Pad a figure box for cropping without swallowing neighbours: the padding on
 * each side is capped at half the gutter to the nearest other figure, and the
 * result stays inside the page.
 */
export function cropFor(figure, all, info, pad = 14) {
  const others = all.filter((f) => f !== figure)
  const view = { x0: info.view[0], y0: info.view[1], x1: info.view[2], y1: info.view[3] }
  const b = figure.bbox
  const room = (side) => {
    let p = pad
    for (const o of others) {
      const ob = o.bbox
      const yOverlap = b.y0 < ob.y1 && ob.y0 < b.y1
      const xOverlap = b.x0 < ob.x1 && ob.x0 < b.x1
      if (side === 'left' && yOverlap && ob.x1 <= b.x0) p = Math.min(p, (b.x0 - ob.x1) / 2)
      if (side === 'right' && yOverlap && ob.x0 >= b.x1) p = Math.min(p, (ob.x0 - b.x1) / 2)
      if (side === 'bottom' && xOverlap && ob.y1 <= b.y0) p = Math.min(p, (b.y0 - ob.y1) / 2)
      if (side === 'top' && xOverlap && ob.y0 >= b.y1) p = Math.min(p, (ob.y0 - b.y1) / 2)
    }
    return Math.max(0, p)
  }
  return {
    x0: Math.max(view.x0, b.x0 - room('left')), y0: Math.max(view.y0, b.y0 - room('bottom')),
    x1: Math.min(view.x1, b.x1 + room('right')), y1: Math.min(view.y1, b.y1 + room('top')),
  }
}

const CALLOUT_RE = /^\d{1,3}$/
const FIGURE_CAPTION_RE = /^(?:Fig(?:ure)?\.?\s*)?(\d{1,3}-\d{1,4})$/i

/**
 * Callout numerals belonging to each figure. A numeral is taken when it lies
 * inside the figure box expanded by `reach` (labels usually sit just outside
 * the artwork). When two figures claim it the nearer one wins. Everything is
 * labelled 'estimated': a text-layer numeral near a drawing is evidence, not
 * proof, and stays unverified until a reviewer confirms it.
 */
export function assignCallouts(texts, figures, { reach = 22 } = {}) {
  const out = figures.map(() => [])
  const orphans = []
  for (const t of texts) {
    if (!CALLOUT_RE.test(t.str) || Number(t.str) < 1) continue
    const cx = (t.x0 + t.x1) / 2; const cy = (t.y0 + t.y1) / 2
    let best = -1; let bestD = Infinity
    figures.forEach((f, i) => {
      const r = expand(f.bbox, reach)
      if (!contains(r, cx, cy)) return
      const dx = Math.max(f.bbox.x0 - cx, 0, cx - f.bbox.x1); const dy = Math.max(f.bbox.y0 - cy, 0, cy - f.bbox.y1)
      const d = Math.hypot(dx, dy)
      if (d < bestD) { bestD = d; best = i }
    })
    if (best >= 0) out[best].push({ index: String(Number(t.str)), x: cx, y: cy, status: 'estimated' })
    else orphans.push({ index: String(Number(t.str)), x: cx, y: cy })
  }
  return { byFigure: out, orphans }
}

/** Figure caption such as "2-14" printed under or beside the drawing. */
export function captionFor(figure, texts, { below = 40, beside = 24 } = {}) {
  const b = figure.bbox
  const near = texts.filter((t) => t.x1 >= b.x0 - beside && t.x0 <= b.x1 + beside && t.y1 >= b.y0 - below && t.y0 <= b.y1 + beside)
  for (const t of near) { const m = t.str.match(FIGURE_CAPTION_RE); if (m) return { figureNo: m[1], text: t.str } }
  return null
}

/** Strings that repeat in the top or bottom margin of at least half the pages (headers and footers). */
export function repeatedMargins(pagesTexts, infos, { margin = 0.07, share = 0.5 } = {}) {
  const counts = new Map()
  pagesTexts.forEach((texts, i) => {
    const h = infos[i].height
    const seen = new Set()
    for (const t of texts) {
      if (t.y0 > h * (1 - margin) || t.y1 < h * margin) {
        const key = t.str.replace(/\d+/g, '#')
        if (!seen.has(key)) { seen.add(key); counts.set(key, (counts.get(key) || 0) + 1) }
      }
    }
  })
  return new Set([...counts].filter(([, n]) => n >= Math.max(2, share * pagesTexts.length)).map(([k]) => k))
}

/**
 * Decide which figure a parts table belongs to by coverage of its index
 * numbers against each figure's callouts. status:
 *  verified  - strong coverage, clear winner (still text-derived, labelled so)
 *  estimated - usable but incomplete
 *  ambiguous - two figures fit about equally, or nothing fits: needs a human
 */
export function matchTableToFigure(tableIndexes, figureCallouts) {
  const want = new Set(tableIndexes.map((v) => String(Number(v))).filter((v) => v !== 'NaN'))
  if (!want.size || !figureCallouts.length) return { figure: -1, score: 0, status: 'ambiguous', missing: [...want], extra: [], reason: 'No indexes or no figure callouts to compare' }
  const scores = figureCallouts.map((list, i) => {
    const have = new Set(list.map((c) => c.index))
    const hit = [...want].filter((v) => have.has(v)).length
    const score = hit / want.size
    const precision = have.size ? hit / have.size : 0
    return { i, score, precision, have, hit }
  }).sort((a, b) => (b.score + b.precision * 0.25) - (a.score + a.precision * 0.25))
  const best = scores[0]; const next = scores[1]
  const missing = [...want].filter((v) => !best.have.has(v))
  const extra = [...best.have].filter((v) => !want.has(v))
  const clear = !next || (best.score + best.precision * 0.25) - (next.score + next.precision * 0.25) >= 0.15
  let status = 'ambiguous'; let reason = ''
  if (best.score >= 0.8 && clear) { status = 'verified'; reason = `${best.hit} of ${want.size} table indexes found as callouts` }
  else if (best.score >= 0.5 && clear) { status = 'estimated'; reason = `Only ${best.hit} of ${want.size} table indexes found; missing ${missing.slice(0, 6).join(', ')}` }
  else reason = clear ? `Best figure covers only ${best.hit} of ${want.size} indexes` : 'Two figures fit the table about equally'
  return { figure: best.i, score: Number(best.score.toFixed(2)), status, missing, extra, reason }
}

/** Layout of one page: figures with crops, callouts, captions and orphan numerals. */
export function analyzePageGeometry({ opList, OPS, items, info }) {
  const texts = textBoxes(items)
  const figures = segmentFigures(drawingBoxes(opList, OPS), info)
  const { byFigure, orphans } = assignCallouts(texts, figures)
  const analysed = figures.map((f, i) => ({
    order: f.order, bbox: f.bbox, crop: cropFor(f, figures, info), ambiguous: f.ambiguous, reason: f.reason,
    callouts: byFigure[i], caption: captionFor(f, texts),
  }))
  return { info, figures: analysed, orphanNumerals: orphans }
}

/** Repeated-figure signature: same caption, size and callout set on another page. */
export function figureSignature(fig) {
  return [fig.caption?.figureNo || '', Math.round(width(fig.bbox) / 20), Math.round(height(fig.bbox) / 20), fig.callouts.map((c) => c.index).sort((a, b) => a - b).join(',')].join('|')
}

/**
 * Keep as callouts only the numerals that the figure's own parts table lists.
 * Dimension numbers and stray digits inside a drawing then drop out. Callouts
 * the table never mentions are returned as `unmatched` for review, not shown.
 */
export function reconcileCallouts(callouts, tableIndexes) {
  const want = new Set(tableIndexes.map((v) => String(Number(v))))
  const matched = []; const unmatched = []
  const seen = new Set()
  for (const c of callouts) {
    if (want.has(c.index)) { if (!seen.has(c.index)) { seen.add(c.index); matched.push({ ...c, status: 'estimated' }) } else matched.push({ ...c, status: 'estimated', repeat: true }) } else unmatched.push(c)
  }
  const absent = [...want].filter((v) => !seen.has(v))
  return { matched, unmatched, absent }
}
