import { parsePrintedPage, figureId } from './pageNumbering'
import { classifyFigures } from './classifier'
import { validateRow, duplicateIndexes, indexesWithoutRows, scoreRow } from './validate'
import { dedupeRows } from './dedupe'

export const PUBLISH_THRESHOLD = 0.7
export const REVIEW_QUEUE_CAP = 500

/**
 * Turn raw extractor output into clean records:
 * dedupe, group into figures, classify each figure (chassis / upper / other),
 * validate and score each row, then split into publish and review queue.
 * extraction: { rows, calloutsByPage?: { [pdfPage]: string[] } }
 * Nothing is dropped silently: every unpublished row lands in `review` with its reasons.
 */
export function processExtraction(extraction, { model = '' } = {}) {
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

  const dupes = duplicateIndexes(rows)
  const callouts = extraction.calloutsByPage || {}
  const publish = []
  const review = []
  for (const r of rows) {
    const fig = figures[r.figure_id]
    const known = callouts[r.illustration_pdf_page]
    const issues = validateRow(r, { calloutIndexes: known ? new Set(known.map((v) => String(Number(v)))) : null })
    if (dupes.has(r)) issues.push({ code: 'duplicate_index', severity: 'warn', message: `Index ${r.index_no} used twice on this figure` })
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
