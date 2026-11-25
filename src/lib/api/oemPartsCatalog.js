import { supabase } from './_client'
import { fetchAllPages } from '../fetchAll'
import { requireCatalogAdmin } from './oemCatalogAdmin'
import { chunkForPage, chunkPath, createChunkedDoc, splitPdf } from '../oemPdfChunks'

const MANUAL_COLUMNS = 'id,country,manufacturer,model,model_code,equipment_no,chassis_from,chassis_to,source_file_name,source_sha256,storage_path,page_count,item_count,extraction_status,import_summary,created_at'
const ENTRY_COLUMNS = 'id,manual_id,source_pdf_page,row_order,assembly_heading,printed_page,index_no,parent_index,part_no,description,remark,quantity,see_page,illustration_pdf_page,row_type,source_line,manual:oem_parts_manuals!inner(id,manufacturer,model,model_code,equipment_no,chassis_from,chassis_to,country,storage_path,page_count)'
const BROWSE_ENTRY_COLUMNS = 'id,manual_id,source_pdf_page,row_order,assembly_heading,printed_page,index_no,parent_index,part_no,description,remark,quantity,see_page,illustration_pdf_page,row_type,attributes'

function raise(error, fallback) {
  if (!error) return
  const wrapped = new Error(error.message || fallback)
  wrapped.code = error.code
  throw wrapped
}

export async function listOemManuals(country) {
  let query = supabase.from('oem_parts_manuals').select(MANUAL_COLUMNS)
  if (country && country !== 'All') query = query.eq('country', country)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1000)
  raise(error, 'Could not load OEM manuals.')
  return (data || []).map(withFitmentMetadata)
}

function withFitmentMetadata(manual) {
  const fitment = manual?.import_summary?.fitment || {}
  return {
    ...manual,
    generation: fitment.generation || null,
    model_year_from: fitment.model_year_from || null,
    model_year_to: fitment.model_year_to || null,
  }
}

export async function findOemManualByHash(sha256) {
  const { data, error } = await supabase.from('oem_parts_manuals')
    .select(MANUAL_COLUMNS).eq('source_sha256', sha256).maybeSingle()
  raise(error, 'Could not check whether this manual was already imported.')
  return data ? withFitmentMetadata(data) : null
}

export async function searchOemEntries(search, { manualId, country, limit = 100 } = {}) {
  const term = String(search || '').trim()
  if (term.length < 2) return []
  const normalized = term.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const queries = []
  if (normalized) {
    let q = supabase.from('oem_parts_entries').select(ENTRY_COLUMNS)
      .ilike('part_no_normalized', `${normalized}%`).limit(limit)
    if (manualId) q = q.eq('manual_id', manualId)
    if (country && country !== 'All') q = q.eq('country', country)
    queries.push(q)
  }
  if (!/^[\s\-./_A-Za-z0-9]+$/.test(term) || term.length >= 3) {
    let q = supabase.from('oem_parts_entries').select(ENTRY_COLUMNS)
      .textSearch('search_vector', term, { type: 'websearch', config: 'simple' }).limit(limit)
    if (manualId) q = q.eq('manual_id', manualId)
    if (country && country !== 'All') q = q.eq('country', country)
    queries.push(q)
  }
  // Old and replacement numbers live in the OEM remark text, not in the part-number column.
  if (normalized.length >= 6) {
    let q = supabase.from('oem_parts_entries').select(ENTRY_COLUMNS).ilike('remark', `%${term.replace(/[%,()]/g, ' ')}%`).limit(limit)
    if (manualId) q = q.eq('manual_id', manualId)
    if (country && country !== 'All') q = q.eq('country', country)
    queries.push(q)
  }
  const results = await Promise.all(queries.map((query) => query))
  const byId = new Map()
  for (const { data, error } of results) {
    raise(error, 'Could not search the OEM parts catalog.')
    for (const row of data || []) byId.set(row.id, row)
  }
  return [...byId.values()].slice(0, limit)
}

/**
 * Load one selected manual in stable pages so users can browse by illustration before knowing a part number.
 * Includes the saved figure link (figure_id) so the viewer groups by the corrected figure, not the import
 * snapshot. Falls back to the base columns on a database that has not got figure_id yet.
 */
export async function listOemManualEntries(manualId) {
  if (!manualId) return []
  const pageSize = 500
  const rows = []
  let columns = `${BROWSE_ENTRY_COLUMNS},figure_id`
  for (let start = 0; ; start += pageSize) {
    const page = () => supabase.from('oem_parts_entries')
      .select(columns)
      .eq('manual_id', manualId)
      .order('source_pdf_page', { ascending: true })
      .order('row_order', { ascending: true })
      .range(start, start + pageSize - 1)
    let { data, error } = await page()
    if (error && columns !== BROWSE_ENTRY_COLUMNS && /figure_id/i.test(String(error.message || '')) && /column|schema/i.test(String(error.message || ''))) {
      columns = BROWSE_ENTRY_COLUMNS
      ;({ data, error } = await page())
    }
    raise(error, 'Could not load this manual’s illustrated parts groups.')
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

async function signedPath(path) {
  const { data, error } = await supabase.storage.from('oem-parts-catalogs').createSignedUrl(path, 600)
  raise(error, 'Could not open the stored OEM manual.')
  return data?.signedUrl
}

async function manualPdfInfo(manualId) {
  const { data: manual, error } = await supabase.from('oem_parts_manuals')
    .select('storage_path,page_count,import_summary').eq('id', manualId).single()
  raise(error, 'Could not find the OEM manual.')
  if (!manual?.storage_path) throw new Error('The saved manual does not have a stored PDF.')
  const chunks = Array.isArray(manual.import_summary?.pdf_chunks) ? manual.import_summary.pdf_chunks : null
  return { manual, chunks }
}

/**
 * Signed link to open the stored PDF in a new tab. For a manual stored as page
 * packs this is the pack holding `page` (or the first pack), opened at that page.
 */
export async function getOemPdfSignedUrl(manualId, page = null) {
  const { manual, chunks } = await manualPdfInfo(manualId)
  if (!chunks) return signedPath(manual.storage_path)
  const chunk = chunkForPage(chunks, page) || chunks[0]
  const url = await signedPath(chunk.path)
  const local = page ? Number(page) - chunk.from + 1 : 1
  return `${url}#page=${local}`
}

/**
 * Open a stored manual for viewing without downloading the whole book. Page
 * packs load one pack at a time; an older single-file manual is read with
 * range requests (pdf.js fetches only the bytes a page needs).
 */
export async function openOemPdfDocument(manualId, pdfjsLib) {
  const { manual, chunks } = await manualPdfInfo(manualId)
  const lazy = { disableAutoFetch: true, disableStream: true }
  if (!chunks) return pdfjsLib.getDocument({ url: await signedPath(manual.storage_path), ...lazy }).promise
  return createChunkedDoc({
    numPages: manual.page_count,
    chunks,
    openChunk: async (c) => pdfjsLib.getDocument({ url: await signedPath(c.path), ...lazy }).promise,
  })
}

/** Save the PDF once, then idempotently upsert every extracted table row in batches. */
export async function saveOemManual({ id, resume = false, file, sha256, country, manufacturer, model, modelCode, equipmentNo, chassisFrom, chassisTo, pageCount, rows, summary }) {
  await requireCatalogAdmin()
  const manual = {
    id,
    country: country || null,
    manufacturer: String(manufacturer || '').trim(),
    model: String(model || '').trim(),
    model_code: modelCode || null,
    equipment_no: equipmentNo || null,
    chassis_from: chassisFrom || null,
    chassis_to: chassisTo || null,
    source_file_name: file.name,
    source_sha256: sha256,
    page_count: pageCount,
    item_count: rows.length,
    extraction_status: 'processing',
    import_summary: summary,
  }
  const manualValues = { ...manual }
  delete manualValues.id
  const { error: createError } = resume
    ? await supabase.from('oem_parts_manuals').update(manualValues).eq('id', id)
    : await supabase.from('oem_parts_manuals').insert(manual)
  raise(createError, 'Could not start saving this OEM manual.')

  for (let start = 0; start < rows.length; start += 100) {
    const batch = rows.slice(start, start + 100).map((row) => ({
      manual_id: id,
      country: country || null,
      source_pdf_page: row.source_pdf_page,
      row_order: row.row_order,
      assembly_heading: row.assembly_heading || null,
      printed_page: row.printed_page || null,
      index_no: row.index_no || null,
      parent_index: row.parent_index || null,
      part_no: row.part_no,
      description: row.description,
      remark: row.remark || null,
      quantity: row.quantity,
      see_page: row.see_page || null,
      illustration_pdf_page: row.illustration_pdf_page || null,
      row_type: row.row_type || 'catalog_item',
      source_line: row.source_line || null,
      figure_id: row.figure_id || null,
      attributes: { ...(row.attributes || {}), ...(row.subassembly_pdf_page ? { subassembly_pdf_page: row.subassembly_pdf_page } : {}) },
    }))
    const { error } = await supabase.from('oem_parts_entries')
      .upsert(batch, { onConflict: 'manual_id,source_pdf_page,row_order', ignoreDuplicates: true })
    if (error) {
      await supabase.from('oem_parts_manuals').update({ extraction_status: 'failed' }).eq('id', id)
      raise(error, `Could not save extracted parts ${start + 1}–${Math.min(start + 100, rows.length)}.`)
    }
  }

  // The parts are saved first, so a PDF the storage refuses (a large manual over
  // the project upload limit) no longer loses thousands of extracted parts. The
  // PDF is only needed to view the pages; parts search works without it.
  // The PDF is stored as page packs (see lib/oemPdfChunks): small files stay
  // under the storage upload limit, and the viewer opens only the pack it needs.
  let pdfStored = false
  let pdfChunks = null
  try {
    const packs = await splitPdf(await file.arrayBuffer())
    const stored = []
    for (const pack of packs) {
      const path = chunkPath(id, pack)
      const { error: upErr } = await supabase.storage.from('oem-parts-catalogs')
        .upload(path, new Blob([pack.bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true })
      if (upErr) throw upErr
      stored.push({ from: pack.from, to: pack.to, path })
    }
    pdfChunks = stored
    const { error: pathError } = await supabase.from('oem_parts_manuals')
      .update({ storage_path: stored[0]?.path || null }).eq('id', id)
    pdfStored = !pathError && stored.length > 0
  } catch {
    pdfStored = false
  }

  const fullyReady = rows.length && !summary.reviewPages?.length && !summary.imageOnlyPages?.length && !summary.reviewQueue?.length
  const status = fullyReady && pdfStored ? 'ready' : 'needs_review'
  const patch = { extraction_status: status }
  if (!pdfStored) {
    patch.import_summary = { ...summary, pdf_not_stored: true, pdf_size_mb: Math.round((file.size || 0) / 1048576) }
  } else {
    patch.import_summary = { ...summary, pdf_chunks: pdfChunks }
  }
  const { data, error } = await supabase.from('oem_parts_manuals')
    .update(patch).eq('id', id).select(MANUAL_COLUMNS).single()
  raise(error, 'Parts were saved, but the manual status could not be finalized.')
  return { ...data, pdfStored, pdfSizeMb: Math.round((file.size || 0) / 1048576) }
}

/**
 * Stock for OEM part numbers through APPROVED OEM links only
 * (oem_part_references.status = 'approved', decided by a second person) to the
 * ERP item, then the posted balances (v_inv_balances) summed across the stores
 * the user can see. An identical number alone is never treated as a link. A
 * part number with no approved link returns nothing ("not linked to stock").
 * Read errors return {} so the basket still opens; nothing is invented.
 */
const MAX_LOOKUP_ITEMS = 200

export async function lookupStockByPartNumbers(partNos) {
  const keys = [...new Set(partNos.filter(Boolean).map(normalizePartNumberKey).filter(Boolean))].slice(0, 200)
  if (!keys.length) return {}
  const { data: refs, error } = await supabase.from('oem_part_references')
    .select('oem_part_no,oem_part_no_normalized,item_id').eq('status', 'approved').in('oem_part_no_normalized', keys).limit(1000)
  if (error || !refs?.length) return {}
  const itemIds = [...new Set(refs.map((r) => r.item_id).filter(Boolean))].slice(0, MAX_LOOKUP_ITEMS)
  // At most 200 ids, so one bounded read for the names. Balances are one row per
  // stock line and can pass the server's 1,000-row cap, so they are paged: a cut-off
  // read would silently understate stock.
  const [{ data: items }, { data: bal }] = await Promise.all([
    supabase.from('material_master').select('id,item_code,item_name').in('id', itemIds).limit(MAX_LOOKUP_ITEMS),
    fetchAllPages((from, to) => supabase.from('v_inv_balances').select('id,item_id,qty_on_hand,qty_reserved,uom')
      .in('item_id', itemIds).order('id').range(from, to), { max: 20000 }),
  ])
  const itemById = new Map((items || []).map((i) => [i.id, i]))
  const out = {}
  for (const r of refs) {
    const k = normalizePartNumberKey(r.oem_part_no_normalized || r.oem_part_no)
    const prev = out[k] || { part_no: r.oem_part_no, name: null, on_hand_qty: 0, reserved_qty: 0, uom: null, linked: true }
    const it = itemById.get(r.item_id)
    if (it && !prev.name) prev.name = [it.item_code, it.item_name].filter(Boolean).join(' ')
    for (const b of (bal || []).filter((x) => x.item_id === r.item_id)) {
      prev.on_hand_qty += Number(b.qty_on_hand) || 0
      prev.reserved_qty += Number(b.qty_reserved) || 0
      prev.uom = prev.uom || b.uom || null
    }
    out[k] = prev
  }
  return out
}
const normalizePartNumberKey = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Delete one manual (admin only, enforced by RLS). The row delete comes first so a refusal (for example a
 * manual holding admin-corrected parts, which the database protects) leaves the PDF in place.
 */
export async function deleteOemManual(manualId) {
  const { data: manual, error: readError } = await supabase.from('oem_parts_manuals').select('storage_path,import_summary').eq('id', manualId).single()
  raise(readError, 'Could not find the OEM manual.')
  const { error } = await supabase.from('oem_parts_manuals').delete().eq('id', manualId)
  if (error) {
    if (/corrected by an administrator|42501/.test(`${error.message} ${error.code}`)) throw new Error('This manual has parts corrected by an administrator. It cannot be deleted; reprocess or edit it instead.')
    raise(error, 'Could not delete the OEM manual.')
  }
  const packs = Array.isArray(manual?.import_summary?.pdf_chunks) ? manual.import_summary.pdf_chunks.map((c) => c.path) : []
  const paths = [...new Set([manual?.storage_path, ...packs].filter(Boolean))]
  if (paths.length) await supabase.storage.from('oem-parts-catalogs').remove(paths)
}
