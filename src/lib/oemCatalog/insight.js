import { normalizePartNumber } from '../oemPartsExtractor'
import { parseRemark } from './records'

/**
 * Detail derived ONLY from what was extracted or stored. A value that is not in
 * the data is null, and the UI shows "not recorded"; nothing is estimated here.
 */
const figId = (r) => (r.printed_page ? `F${r.printed_page}` : `P${r.source_pdf_page}`)

export function partInsight(row, rows, figures = {}, manual = {}) {
  const key = normalizePartNumber(row.part_no)
  const parsed = parseRemark(row.remark)
  const own = figId(row)
  const resolve = (numbers) => numbers.map((no) => ({
    no,
    found: rows.filter((r) => normalizePartNumber(r.part_no) === normalizePartNumber(no)).slice(0, 5).map((r) => ({ id: r.id, figure: figId(r), heading: r.assembly_heading || null })),
  }))
  // A later row elsewhere that lists THIS number as its predecessor is evidence of a replacement.
  const replacedBy = rows.filter((r) => r.id !== row.id && parseRemark(r.remark).supersedes.some((n) => normalizePartNumber(n) === key))
    .map((r) => ({ no: r.part_no, found: [{ id: r.id, figure: figId(r), heading: r.assembly_heading || null }] }))
  const whereUsed = rows.filter((r) => r.id !== row.id && normalizePartNumber(r.part_no) === key)
    .map((r) => ({ id: r.id, figure: figId(r), heading: r.assembly_heading || null, printed_page: r.printed_page || null, callout: r.index_no || r.parent_index || null, quantity: r.quantity ?? null }))
  const fig = figures[own]
  const geo = fig?.geometry || null
  const related = rows.filter((r) => r.id !== row.id && figId(r) === own && normalizePartNumber(r.part_no) !== key)
    .slice(0, 8).map((r) => ({ id: r.id, part_no: r.part_no, description: r.description, callout: r.index_no || r.parent_index || null }))
  const callout = row.index_no || row.parent_index || null
  const calloutOnDrawing = geo?.callouts?.some((c) => c.index === String(Number(callout))) ?? null
  return {
    quantity: row.quantity ?? null,
    uom: null, // the extractor does not read a unit column; shown as not recorded
    callout,
    isVariant: Boolean(row.parent_index),
    fitment: {
      equipmentNo: manual.equipment_no || null, modelCode: manual.model_code || null, generation: manual.generation || null,
      yearFrom: manual.model_year_from || null, yearTo: manual.model_year_to || null, chassisFrom: manual.chassis_from || null, chassisTo: manual.chassis_to || null,
      remarkSerialFrom: parsed.serial_from, remarkSerialTo: parsed.serial_to, remark: parsed.remark || null,
    },
    supersedes: resolve(parsed.supersedes),
    supersededBy: [...resolve(parsed.superseded_by), ...replacedBy],
    whereUsed,
    source: { pdfPage: row.source_pdf_page || null, printedPage: row.printed_page || null, figurePdfPage: row.illustration_pdf_page || null, seePage: row.see_page || null },
    evidence: geo ? {
      status: geo.status, reason: geo.reason || null, score: geo.score ?? null, missing: geo.missing || [], calloutOnDrawing,
      figuresOnPage: geo.figures_on_page ?? null, hasCrop: Boolean(geo.crop),
    } : null,
    category: fig?.hierarchy?.category || null,
    related,
  }
}

/** Per-figure facts from the stored rows and geometry. */
export function figureSummary(group, geometry) {
  const callouts = new Set(group.rows.map((r) => r.index_no || r.parent_index).filter(Boolean).map((v) => String(Number(v))))
  const distinctParts = new Set(group.rows.map((r) => normalizePartNumber(r.part_no))).size
  return {
    rows: group.rows.length,
    parts: distinctParts,
    callouts: callouts.size,
    absentCallouts: geometry?.absent_callouts || [],
    unmatchedNumerals: geometry?.unmatched_numerals ?? null,
    status: geometry?.status || null,
    reason: geometry?.reason || null,
  }
}

/** Counts from the import record. Accuracy is NOT derived: it needs a reviewed sample, so it is reported as unmeasured. */
export function manualCoverage(manual) {
  const s = manual?.import_summary || {}
  const p = s.pipeline || {}
  const figures = Object.values(s.figures || {})
  const withGeo = figures.filter((f) => f.geometry && f.geometry.status !== 'unavailable').length
  const total = figures.length
  return {
    pages: manual?.page_count ?? null,
    parsedPages: s.parsedPages?.length ?? null,
    imageOnlyPages: s.imageOnlyPages?.length ?? 0,
    unparsedTablePages: s.reviewPages?.length ?? 0,
    published: p.published ?? manual?.item_count ?? null,
    queued: p.reviewRows ?? s.reviewQueue?.length ?? null,
    queueTruncated: Boolean(s.reviewQueue && p.reviewRows && s.reviewQueue.length < p.reviewRows),
    figures: total || null,
    figuresWithGeometry: total ? withGeo : null,
    figuresMatched: p.figuresVerified ?? null,
    figuresAmbiguous: p.figuresAmbiguous ?? null,
    derivedCategories: p.derivedCategories?.length ?? null,
    accuracyMeasured: false,
  }
}
