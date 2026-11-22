/**
 * Admin working data for the OEM catalog: review queue, figures, corrections and
 * category rules. These tables come from the PENDING migration
 * 20261118100000_oem_catalog_advanced.sql. Until it is applied every call here
 * reports `NOT_PROVISIONED` and the UI says so instead of pretending. The
 * database (RLS) is the real gate; the checks here only fail fast and give a
 * clean message.
 */
import { supabase, isMissingRelation } from './_client'

export const NOT_PROVISIONED = 'OEM_NOT_PROVISIONED'
export const REVIEW_PARTIAL = 'OEM_REVIEW_PARTIAL'
const fail = (error, fallback) => {
  if (isMissingRelation(error) || /oem_catalog_admin|oem_apply_correction|oem_reassign_entries|oem_figure_merge|oem_figure_split/.test(String(error?.message || '')) && /does not exist|not found/i.test(String(error?.message || ''))) {
    const e = new Error('The advanced catalog tables are not installed yet. An administrator must approve the pending catalog migration.')
    e.code = NOT_PROVISIONED
    throw e
  }
  const e = new Error(error?.message || fallback)
  e.code = error?.code
  throw e
}

/** true / false from the database; null when the function is not installed (then the server decides on each write). */
export async function isCatalogAdmin() {
  const { data, error } = await supabase.rpc('oem_catalog_admin')
  if (error) return null
  return data === true
}

export async function requireCatalogAdmin() {
  const ok = await isCatalogAdmin()
  if (ok === false) { const e = new Error('Only a catalog administrator can do this.'); e.code = '42501'; throw e }
}

const REVIEW_COLS = 'id,manual_id,entry_id,figure_id,pdf_page,part_no,payload,reasons,confidence,status,decided_at,created_at'

/** Paginated, filterable, searchable queue. Nothing is capped: the caller pages with `page`. */
export async function listReviewItems({ manualId, status = 'pending', search = '', maxConfidence, page = 0, pageSize = 25 } = {}) {
  let q = supabase.from('oem_review_items').select(REVIEW_COLS, { count: 'exact' }).eq('manual_id', manualId)
  if (status && status !== 'all') q = q.eq('status', status)
  if (maxConfidence != null) q = q.lte('confidence', maxConfidence)
  const term = String(search || '').trim().replace(/[%,()]/g, ' ')
  if (term) q = q.or(`part_no.ilike.%${term}%,figure_id.ilike.%${term}%`)
  const { data, error, count } = await q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) fail(error, 'Could not load the review queue.')
  return { items: data || [], total: count ?? 0, page, pageSize }
}

/**
 * True when the database does not yet have the source-row key from the follow-up migration
 * 20261119100000_oem_review_items_source_row (row_order column missing, or no unique constraint on
 * manual_id,pdf_page,row_order). Then the save falls back to plain inserts.
 */
export function isMissingSourceRowKey(error) {
  const code = String(error?.code || '')
  if (code === 'PGRST204' || code === '42703' || code === '42P10') return true
  return /row_order/i.test(String(error?.message || '')) && /column|constraint|conflict/i.test(String(error?.message || ''))
}

const reviewRow = (manualId, r, withRowOrder) => {
  const row = {
    manual_id: manualId, figure_id: r.figure_id || null, pdf_page: r.source_pdf_page || null, part_no: r.part_no,
    payload: r, reasons: (r.issues || []).map((x) => x.message), confidence: r.confidence ?? null,
  }
  if (withRowOrder) row.row_order = Number.isInteger(r.row_order) ? r.row_order : null
  return row
}

/**
 * Persist the whole queue in chunks (no 500 cap). One review row per SOURCE row: the key is the page
 * and the row order on that page, so the same part number listed twice on one page keeps both rows.
 * Returns how many rows were stored. If the database still has the old part-number key and some rows
 * cannot be stored, it throws after saving the rest, saying how many were not queued (never silent).
 */
export async function saveReviewItems(manualId, records) {
  await requireCatalogAdmin()
  let saved = 0
  let legacy = false
  let notQueued = 0
  for (let i = 0; i < records.length; i += 200) {
    const slice = records.slice(i, i + 200)
    if (!legacy) {
      const { error } = await supabase.from('oem_review_items')
        .upsert(slice.map((r) => reviewRow(manualId, r, true)), { onConflict: 'manual_id,pdf_page,row_order', ignoreDuplicates: true })
      if (!error) { saved += slice.length; continue }
      if (!isMissingSourceRowKey(error)) fail(error, 'Could not save the review queue.')
      legacy = true
    }
    // Old key still installed: insert without row_order. A conflict means the row is already queued
    // or repeats a part number on its page; insert one by one so the rest of the batch is kept.
    const batch = slice.map((r) => reviewRow(manualId, r, false))
    const { error } = await supabase.from('oem_review_items').insert(batch)
    if (!error) { saved += batch.length; continue }
    if (String(error.code) !== '23505') fail(error, 'Could not save the review queue.')
    for (const row of batch) {
      const { error: oneErr } = await supabase.from('oem_review_items').insert(row)
      if (!oneErr) saved += 1
      else if (String(oneErr.code) === '23505') notQueued += 1
      else fail(oneErr, 'Could not save the review queue.')
    }
  }
  if (notQueued) {
    const e = new Error(`${saved} review rows saved. ${notQueued} rows were not queued because they are already in the queue or repeat a part number on the same page; repeated part numbers can be queued once the catalog database update is applied.`)
    e.code = REVIEW_PARTIAL
    e.saved = saved
    e.notQueued = notQueued
    throw e
  }
  return saved
}

export async function decideReviewItems(ids, status) {
  await requireCatalogAdmin()
  if (!['approved', 'rejected', 'pending'].includes(status)) throw new Error('Unknown review status')
  const { data: user } = await supabase.auth.getUser()
  const { error } = await supabase.from('oem_review_items')
    .update({ status, decided_by: user?.user?.id || null, decided_at: new Date().toISOString() }).in('id', ids)
  if (error) fail(error, 'Could not save the decision.')
}

/**
 * Publish approved items as catalog entries. Existing rows (same manual, page, row) are never overwritten.
 * Each entry carries the manual's company and country so country-filtered searches find it, and the
 * figure link the review row was proposed under.
 */
export async function publishApproved(manualId) {
  await requireCatalogAdmin()
  const { data: manual, error: manualErr } = await supabase.from('oem_parts_manuals').select('organisation_id,country').eq('id', manualId).single()
  if (manualErr) fail(manualErr, 'Could not read the manual.')
  const { data, error } = await supabase.from('oem_review_items').select('id,payload').eq('manual_id', manualId).eq('status', 'approved').limit(1000)
  if (error) fail(error, 'Could not read approved items.')
  let published = 0
  for (let i = 0; i < (data || []).length; i += 100) {
    const chunk = data.slice(i, i + 100)
    const rows = chunk.map(({ payload: r }) => ({
      manual_id: manualId, organisation_id: manual.organisation_id, country: manual.country || null,
      source_pdf_page: r.source_pdf_page, row_order: r.row_order, assembly_heading: r.assembly_heading || null, printed_page: r.printed_page || null,
      index_no: r.index_no || null, parent_index: r.parent_index || null, part_no: r.part_no, description: r.description, remark: r.remark || null, quantity: r.quantity ?? null,
      see_page: r.see_page || null, illustration_pdf_page: r.illustration_pdf_page || null, row_type: r.row_type || 'catalog_item', source_line: r.source_line || null,
      figure_id: r.figure_id || null,
      attributes: { ...(r.attributes || {}), ...(r.subassembly_pdf_page ? { subassembly_pdf_page: r.subassembly_pdf_page } : {}) },
    }))
    const { error: insErr } = await supabase.from('oem_parts_entries').upsert(rows, { onConflict: 'manual_id,source_pdf_page,row_order', ignoreDuplicates: true })
    if (insErr) fail(insErr, 'Could not publish approved parts.')
    const { error: stErr } = await supabase.from('oem_review_items').update({ status: 'published' }).in('id', chunk.map((c) => c.id))
    if (stErr) fail(stErr, 'Parts were published but their status could not be updated.')
    published += rows.length
  }
  return published
}

/** The sanctioned edit path: audited, flags the record as admin corrected so imports never overwrite it. */
export async function applyCorrection(entryId, field, value, reason = '') {
  const { data, error } = await supabase.rpc('oem_apply_correction', { p_entry: entryId, p_field: field, p_value: String(value ?? ''), p_reason: reason || null })
  if (error) fail(error, 'Could not save the correction.')
  return data
}

export async function listCategoryRules() {
  const { data, error } = await supabase.from('oem_category_rules').select('heading,heading_key,category,system,scope,manufacturer')
  if (error) { if (isMissingRelation(error)) return []; fail(error, 'Could not load category rules.') }
  return data || []
}

export async function saveCategoryRule({ heading, headingKey, category, system, scope = 'manufacturer', manufacturer = '' }) {
  await requireCatalogAdmin()
  const { error } = await supabase.from('oem_category_rules').upsert({ heading, heading_key: headingKey, category, system: system || null, scope, manufacturer }, { onConflict: 'organisation_id,heading_key,scope,manufacturer' })
  if (error) fail(error, 'Could not save the category rule.')
}

export async function saveFigures(manualId, figures) {
  await requireCatalogAdmin()
  const rows = Object.entries(figures).map(([figureId, f]) => ({
    manual_id: manualId, figure_id: figureId, pdf_page: f.geometry?.pdf_page || f.illustration_pdf_page || 1, printed_page: figureId.replace(/^F/, ''),
    caption: f.geometry?.caption || null, page_info: f.geometry?.page || {}, bbox: f.geometry?.bbox || null, crop: f.geometry?.crop || null,
    callouts: f.geometry?.callouts || [], match: { status: f.geometry?.status, score: f.geometry?.score, missing: f.geometry?.missing, reason: f.geometry?.reason },
    match_status: ['estimated', 'verified', 'ambiguous', 'unavailable'].includes(f.geometry?.status) ? f.geometry.status : 'estimated',
    // area, heading and area confidence ride in hierarchy so the viewer needs no import snapshot.
    hierarchy: { ...(f.hierarchy || {}), area: f.area || null, heading: f.heading || null, area_confidence: f.confidence ?? null },
  }))
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('oem_figures').upsert(rows.slice(i, i + 100), { onConflict: 'manual_id,figure_id', ignoreDuplicates: true })
    if (error) fail(error, 'Could not save figure geometry.')
  }
  return rows.length
}

export async function listFigures(manualId) {
  const { data, error } = await supabase.from('oem_figures').select('figure_id,pdf_page,printed_page,caption,page_info,bbox,crop,callouts,match,match_status,hierarchy,admin_adjusted').eq('manual_id', manualId)
  if (error) { if (isMissingRelation(error)) return []; fail(error, 'Could not load figures.') }
  return data || []
}

/** Admin moves a figure boundary; stored as adjusted so a re-import never replaces it. */
export async function adjustFigureCrop(manualId, figureId, crop) {
  await requireCatalogAdmin()
  const { error } = await supabase.from('oem_figures').update({ crop, admin_adjusted: true }).eq('manual_id', manualId).eq('figure_id', figureId)
  if (error) fail(error, 'Could not save the new figure boundary.')
}

export async function updateReviewPayload(id, payload) {
  await requireCatalogAdmin()
  const { error } = await supabase.from('oem_review_items').update({ payload, part_no: payload.part_no }).eq('id', id)
  if (error) fail(error, 'Could not save the edit.')
}

export async function listCorrections(entryId) {
  if (!entryId) return []
  const { data, error } = await supabase.from('oem_corrections').select('id,field,old_value,new_value,reason,corrected_at').eq('entry_id', entryId).order('corrected_at', { ascending: false }).limit(50)
  if (error) { if (isMissingRelation(error)) return []; fail(error, 'Could not load the correction history.') }
  return data || []
}

/** Move parts to another figure. Audited and protected from reprocess overwrite. */
export async function reassignEntries(manualId, entryIds, toFigure) {
  await requireCatalogAdmin()
  const { data, error } = await supabase.rpc('oem_reassign_entries', { p_manual: manualId, p_entry_ids: entryIds, p_to_figure: toFigure })
  if (error) fail(error, 'Could not move the parts.')
  return data
}

/** Merge figure `from` into `into` (same PDF page only). */
export async function mergeFigures(manualId, from, into) {
  await requireCatalogAdmin()
  const { data, error } = await supabase.rpc('oem_figure_merge', { p_manual: manualId, p_from: from, p_into: into })
  if (error) fail(error, 'Could not merge the figures.')
  return data
}

/** Split a figure: create `newFigure` with its own crop and move the chosen parts to it. */
export async function splitFigure(manualId, figure, newFigure, crop, entryIds) {
  await requireCatalogAdmin()
  const { data, error } = await supabase.rpc('oem_figure_split', { p_manual: manualId, p_figure: figure, p_new_figure: newFigure, p_crop: crop, p_entry_ids: entryIds })
  if (error) fail(error, 'Could not split the figure.')
  return data
}

/** Entries with their stored figure link; falls back to the base columns until the migration adds figure_id. */
export async function listEntriesWithFigure(manualId) {
  const base = 'id,source_pdf_page,row_order,assembly_heading,printed_page,index_no,parent_index,part_no,description,remark,quantity,illustration_pdf_page'
  const rows = []
  for (let start = 0; ; start += 500) {
    let res = await supabase.from('oem_parts_entries').select(`${base},figure_id,admin_corrected`).eq('manual_id', manualId).order('source_pdf_page').order('row_order').range(start, start + 499)
    if (res.error && /figure_id|admin_corrected|column/i.test(res.error.message || '')) {
      res = await supabase.from('oem_parts_entries').select(base).eq('manual_id', manualId).order('source_pdf_page').order('row_order').range(start, start + 499)
    }
    if (res.error) fail(res.error, 'Could not load the parts of this manual.')
    rows.push(...(res.data || []))
    if (!res.data || res.data.length < 500) break
  }
  return rows
}
