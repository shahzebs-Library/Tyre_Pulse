import { buildRecord, reprocessPreview } from './records'
import { figureId } from './pageNumbering'

/** Stored entries as comparable records. Keeps id and the admin-corrected flag so the preview can protect them. */
export function storedRecords(entries, { manufacturer = '', model = '' } = {}, figures = {}) {
  return entries.map((e) => {
    const fid = e.figure_id || figureId(e.printed_page, e.source_pdf_page)
    const rec = buildRecord({ ...e, figure_id: fid }, { manufacturer, model, category: e.category || null })
    return { ...rec, id: e.id, admin_corrected: Boolean(e.admin_corrected), category: e.category ?? figures[fid]?.hierarchy?.category ?? null }
  })
}

/** Freshly processed rows (published plus review) as comparable records. */
export function proposedRecords(pipeline, { manufacturer = '', model = '' } = {}) {
  return [...(pipeline.publish || []), ...(pipeline.review || [])].map((r) =>
    buildRecord(r, { manufacturer, model, category: pipeline.figures?.[r.figure_id]?.hierarchy?.category || null, heading: r.assembly_heading }))
}

/**
 * Compare a re-run of the pipeline with what is stored. Nothing is written: the caller shows the
 * result and, only on approval, sends the genuinely new parts to the review queue.
 * Stored parts that an admin corrected, or that a work order references, are never overwritten.
 */
export function reprocessAgainstStored({ entries, pipeline, manual, referencedIds = new Set(), storedFigures = {} }) {
  const ctx = { manufacturer: manual?.manufacturer || '', model: manual?.model || '' }
  return reprocessPreview(storedRecords(entries, ctx, { ...(pipeline.figures || {}), ...storedFigures }), proposedRecords(pipeline, ctx), { referencedIds })
}
