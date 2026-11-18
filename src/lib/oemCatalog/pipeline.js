import { parsePrintedPage, figureId } from './pageNumbering'
import { classifyFigures } from './classifier'
import { validateRow, duplicateIndexes, indexesWithoutRows, scoreRow } from './validate'
import { dedupeRows } from './dedupe'
import { classifyFigureHierarchy, derivedCategories } from './taxonomy'
import { matchTableToFigure, reconcileCallouts, figureSignature } from './pageGeometry'

export const PUBLISH_THRESHOLD = 0.7
export const REVIEW_QUEUE_CAP = 500

/**
 * Turn raw extractor output into clean records:
 * dedupe, group into figures, classify each figure (chassis / upper / other),
 * validate and score each row, then split into publish and review queue.
 * extraction: { rows, calloutsByPage?: { [pdfPage]: string[] } }
 * Nothing is dropped silently: every unpublished row lands in `review` with its reasons.
 */
export function processExtraction(extraction, { model = '', manufacturer = '', corrections = [] } = {}) {
  const { rows: deduped, dropped } = dedupeRows(extraction.rows || [])
  const rows = deduped.map((r) => ({ ...r, figure_id: figureId(r.printed_page, r.source_pdf_page) }))

  const figureMap = new Map()
  for (const r of rows) {
    const f = figureMap.get(r.figure_id) || { id: r.figure_id, chapter: parsePrintedPage(r.printed_page)?.chapter ?? null, heading: r.assembly_heading || '', descriptions: [], illustrationPage: r.illustration_pdf_page || null, rowCount: 0 }
    f.rowCount += 1
    f.descriptions.push(r.description)
    if (!f.heading && r.assembly_heading) f.heading = r.assembly_heading
    figureMap.set(r.figure_id, f)
  }
  const figures = {}
  for (const f of classifyFigures([...figureMap.values()])) {
    figures[f.id] = { heading: f.heading, group: f.group, area: f.area, confidence: f.confidence, reason: f.reason, conflict: Boolean(f.conflict), chapter: f.chapter, illustration_pdf_page: f.illustrationPage, rows: f.rowCount }
  }

  for (const f of Object.values(figures)) {
    f.hierarchy = classifyFigureHierarchy({ heading: f.heading, chapter: f.chapter, area: f.area, equipment: model }, { corrections, manufacturer })
  }

  // Figure geometry: pair each parts table with the drawing on its illustration page that it
  // actually describes. Tables that continue across pages (same heading, same drawing) are
  // matched together so a split table is not judged on half its indexes.
  const geometry = extraction.geometryByPage || {}
  const claims = new Map()
  const groups = new Map()
  for (const r of rows) {
    const g = `${(figures[r.figure_id].heading || '').toLowerCase()}|${r.illustration_pdf_page || ''}`
    const e = groups.get(g) || { figureIds: new Set(), indexes: new Set(), page: r.illustration_pdf_page, score: 0 }
    e.figureIds.add(r.figure_id)
    for (const v of [r.index_no, r.parent_index]) if (v) e.indexes.add(String(Number(v)))
    groups.set(g, e)
  }
  const signatures = new Map()
  for (const e of groups.values()) {
    const geo = e.page ? geometry[e.page] : null
    if (!geo || !geo.figures.length) {
      for (const id of e.figureIds) figures[id].geometry = { status: 'unavailable', reason: e.page ? 'No drawing geometry could be read for this page' : 'No illustration page linked' }
      continue
    }
    const m = matchTableToFigure([...e.indexes], geo.figures.map((f) => f.callouts))
    const fig = geo.figures[m.figure]
    const rec = fig ? reconcileCallouts(fig.callouts, [...e.indexes]) : { matched: [], unmatched: [], absent: [...e.indexes] }
    let status = fig?.ambiguous ? 'ambiguous' : m.status
    let reason = fig?.ambiguous ? fig.reason : m.reason
    const key = `${e.page}:${m.figure}`
    e.score = m.score
    claims.set(key, [...(claims.get(key) || []), e])
    const sig = fig ? figureSignature(fig) : ''
    if (sig) signatures.set(sig, [...(signatures.get(sig) || []), e.page])
    for (const id of e.figureIds) {
      figures[id].geometry = {
        status, reason, pdf_page: e.page, page: { width: geo.info.width, height: geo.info.height, rotate: geo.info.rotate, landscape: geo.info.landscape },
        figure_order: fig?.order ?? null, figures_on_page: geo.figures.length, bbox: fig?.bbox || null, crop: fig?.crop || null, caption: fig?.caption?.figureNo || null,
        score: m.score, missing: m.missing, callouts: rec.matched.slice(0, 200), unmatched_numerals: rec.unmatched.length, absent_callouts: rec.absent,
      }
    }
  }
  for (const [key, list] of claims) {
    if (list.length < 2) continue
    // The best-covered table keeps the drawing; a weaker table that shares indexes with it loses it.
    const ranked = [...list].sort((a, b) => b.score - a.score)
    const losers = ranked.slice(1).filter((e) => [...e.indexes].some((v) => ranked[0].indexes.has(v)))
    for (const e of losers) for (const id of e.figureIds) {
      const g = figures[id].geometry
      if (g) { g.status = 'ambiguous'; g.reason = `Another parts table also claims this drawing (${key})` }
    }
  }
  const repeatedFigures = [...signatures].filter(([, pages]) => new Set(pages).size > 1).map(([signature, pages]) => ({ signature, pages: [...new Set(pages)] }))

  const dupes = duplicateIndexes(rows)
  const callouts = extraction.calloutsByPage || {}
  const publish = []
  const review = []
  for (const r of rows) {
    const fig = figures[r.figure_id]
    const known = callouts[r.illustration_pdf_page]
    const issues = validateRow(r, { calloutIndexes: known ? new Set(known.map((v) => String(Number(v)))) : null })
    if (dupes.has(r)) issues.push({ code: 'duplicate_index', severity: 'warn', message: `Index ${r.index_no} used twice on this figure` })
    const gstat = fig.geometry?.status
    if (gstat === 'ambiguous') issues.push({ code: 'figure_ambiguous', severity: 'error', message: fig.geometry.reason || 'Drawing could not be matched to this table with confidence' })
    else if (gstat === 'estimated') issues.push({ code: 'figure_estimated', severity: 'warn', message: fig.geometry.reason })
    else if (gstat === 'unavailable') issues.push({ code: 'figure_unavailable', severity: 'warn', message: fig.geometry.reason })
    if (fig.confidence < 0.5) issues.push({ code: 'area_unsure', severity: 'warn', message: 'Assembly area could not be determined confidently' })
    const rowScore = scoreRow(issues)
    const confidence = Number(Math.min(rowScore, rowScore * 0.5 + fig.confidence * 0.5 + 0.05).toFixed(2))
    const record = { ...r, assembly_group: fig.group, assembly_area: fig.area, confidence, issues }
    if (!issues.some((i) => i.severity === 'error') && confidence >= PUBLISH_THRESHOLD) publish.push(record)
    else review.push(record)
  }

  const orphanCallouts = []
  for (const [page, list] of Object.entries(callouts)) {
    const figRows = rows.filter((r) => String(r.illustration_pdf_page) === String(page))
    if (!figRows.length) continue
    const missing = indexesWithoutRows(figRows, new Set(list.map((v) => String(Number(v)))))
    if (missing.length) orphanCallouts.push({ pdfPage: Number(page), indexes: missing })
  }

  const areaCounts = {}
  for (const f of Object.values(figures)) areaCounts[f.area] = (areaCounts[f.area] || 0) + 1
  return {
    publish,
    review,
    figures,
    orphanCallouts,
    repeatedFigures,
    summary: {
      model,
      rowsIn: (extraction.rows || []).length,
      duplicatesDropped: dropped.length,
      published: publish.length,
      reviewRows: review.length,
      figureCount: Object.keys(figures).length,
      areaCounts,
      lowConfidenceFigures: Object.entries(figures).filter(([, f]) => f.confidence < PUBLISH_THRESHOLD).map(([id]) => id),
      orphanCallouts,
      repeatedFigures,
      derivedCategories: derivedCategories(figures).slice(0, 50),
      hierarchyReview: Object.values(figures).filter((f) => f.hierarchy.review).length,
      figuresVerified: Object.values(figures).filter((f) => f.geometry?.status === 'verified').length,
      figuresAmbiguous: Object.values(figures).filter((f) => f.geometry?.status === 'ambiguous').length,
    },
  }
}

/** Compact review queue for storage in import_summary (full rows stay in the browser session). */
export function reviewQueueForStorage(review) {
  return review.slice(0, REVIEW_QUEUE_CAP).map((r) => ({
    figure: r.figure_id, pdf_page: r.source_pdf_page, index: r.index_no || r.parent_index || null, part_no: r.part_no,
    description: String(r.description || '').slice(0, 120), confidence: r.confidence, reasons: r.issues.map((i) => i.message).slice(0, 4),
  }))
}
