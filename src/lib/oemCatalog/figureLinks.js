/**
 * Saved figure links for the OEM catalog viewer. Pure, no I/O.
 *
 * The import snapshot (manual.import_summary.figures) is written once at import. Admin corrections
 * (crop moved, figure split, merged, parts reassigned) land in oem_figures and in the entries'
 * figure_id, so when those rows exist they are the truth. The snapshot is only a legacy fallback for
 * manuals saved before oem_figures existed.
 */
const AREAS = new Set(['chassis', 'upper', 'other'])

/** Legacy grouping key: the illustration page plus the parts-table heading on it. */
export function legacyGroupKey(row) {
  const page = row.illustration_pdf_page || null
  const heading = String(row.assembly_heading || '').toLowerCase().replace(/\s+/g, ' ').trim()
  return `${page || 'unlinked'}|${heading || row.printed_page || row.source_pdf_page || ''}`
}

/** A row with a saved figure link groups by that figure; anything else keeps the legacy key. */
export function entryGroupKey(row) {
  return row?.figure_id ? `fig:${row.figure_id}` : legacyGroupKey(row || {})
}

/** The figure a viewer group belongs to: its saved link, else the figure named after its printed page. */
export function groupFigureId(group) {
  if (group?.figureId) return group.figureId
  const printed = group?.printedPages?.[0]
  return printed ? `F${printed}` : null
}

/** One oem_figures row in the same shape the import snapshot uses (heading, area, confidence, geometry). */
export function figureFromRow(row) {
  const h = row.hierarchy || {}
  const m = row.match || {}
  const area = AREAS.has(h.area) ? h.area : AREAS.has(h.system) ? h.system : 'other'
  const confidence = typeof h.area_confidence === 'number' ? h.area_confidence : typeof h.confidence === 'number' ? h.confidence : undefined
  return {
    heading: h.heading || (Array.isArray(h.oem_path) ? h.oem_path[h.oem_path.length - 1] : '') || '',
    area,
    confidence,
    hierarchy: h,
    admin_adjusted: Boolean(row.admin_adjusted),
    illustration_pdf_page: row.pdf_page ?? null,
    geometry: {
      status: row.match_status || m.status || null,
      reason: m.reason || null,
      pdf_page: row.pdf_page ?? null,
      page: row.page_info || null,
      bbox: row.bbox || null,
      crop: row.crop || null,
      caption: row.caption || null,
      callouts: Array.isArray(row.callouts) ? row.callouts : [],
      score: m.score ?? null,
      missing: m.missing ?? null,
    },
  }
}

/** Saved figures win; the import snapshot is used only when no oem_figures rows exist for the manual. */
export function resolveFigures(figureRows, snapshot) {
  if (Array.isArray(figureRows) && figureRows.length) {
    return Object.fromEntries(figureRows.filter((r) => r?.figure_id).map((r) => [r.figure_id, figureFromRow(r)]))
  }
  return snapshot || {}
}
