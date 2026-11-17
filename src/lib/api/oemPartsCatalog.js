import { supabase } from './_client'

const MANUAL_COLUMNS = 'id,country,manufacturer,model,model_code,equipment_no,chassis_from,chassis_to,source_file_name,source_sha256,storage_path,page_count,item_count,extraction_status,import_summary,created_at'
const ENTRY_COLUMNS = 'id,manual_id,source_pdf_page,row_order,assembly_heading,printed_page,index_no,parent_index,part_no,description,remark,quantity,see_page,illustration_pdf_page,row_type,source_line,manual:oem_parts_manuals!inner(id,manufacturer,model,model_code,equipment_no,country,storage_path,page_count)'
const BROWSE_ENTRY_COLUMNS = 'id,manual_id,source_pdf_page,row_order,assembly_heading,printed_page,index_no,parent_index,part_no,description,remark,quantity,see_page,illustration_pdf_page,row_type'

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
  return data || []
}

export async function findOemManualByHash(sha256) {
  const { data, error } = await supabase.from('oem_parts_manuals')
    .select(MANUAL_COLUMNS).eq('source_sha256', sha256).maybeSingle()
  raise(error, 'Could not check whether this manual was already imported.')
  return data || null
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
  const results = await Promise.all(queries.map((query) => query))
  const byId = new Map()
  for (const { data, error } of results) {
    raise(error, 'Could not search the OEM parts catalog.')
    for (const row of data || []) byId.set(row.id, row)
  }
  return [...byId.values()].slice(0, limit)
}

/** Load one selected manual in stable pages so users can browse by illustration before knowing a part number. */
export async function listOemManualEntries(manualId) {
  if (!manualId) return []
  const pageSize = 500
  const rows = []
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase.from('oem_parts_entries')
      .select(BROWSE_ENTRY_COLUMNS)
      .eq('manual_id', manualId)
      .order('source_pdf_page', { ascending: true })
      .order('row_order', { ascending: true })
      .range(start, start + pageSize - 1)
    raise(error, 'Could not load this manual’s illustrated parts groups.')
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

export async function getOemPdfSignedUrl(manualId) {
  const { data: manual, error: manualError } = await supabase.from('oem_parts_manuals')
    .select('storage_path').eq('id', manualId).single()
  raise(manualError, 'Could not find the OEM manual.')
  if (!manual?.storage_path) throw new Error('The saved manual does not have a stored PDF.')
  const { data, error } = await supabase.storage.from('oem-parts-catalogs')
    .createSignedUrl(manual.storage_path, 300)
  raise(error, 'Could not open the stored OEM manual.')
  return data?.signedUrl
}

/** Save the PDF once, then idempotently upsert every extracted table row in batches. */
export async function saveOemManual({ id, resume = false, file, sha256, country, manufacturer, model, modelCode, equipmentNo, chassisFrom, chassisTo, pageCount, rows, summary }) {
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

  const storagePath = `${id}/source.pdf`
  const { error: uploadError } = await supabase.storage.from('oem-parts-catalogs')
    .upload(storagePath, file, { contentType: 'application/pdf', upsert: true })
  if (uploadError) {
    await supabase.from('oem_parts_manuals').update({ extraction_status: 'failed' }).eq('id', id)
    raise(uploadError, 'Could not securely store the source PDF.')
  }

  const { error: pathError } = await supabase.from('oem_parts_manuals')
    .update({ storage_path: storagePath }).eq('id', id)
  if (pathError) raise(pathError, 'The PDF was saved, but its catalog record could not be updated.')

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
    }))
    const { error } = await supabase.from('oem_parts_entries')
      .upsert(batch, { onConflict: 'manual_id,source_pdf_page,row_order', ignoreDuplicates: true })
    if (error) {
      await supabase.from('oem_parts_manuals').update({ extraction_status: 'failed' }).eq('id', id)
      raise(error, `Could not save extracted parts ${start + 1}–${Math.min(start + 100, rows.length)}.`)
    }
  }

  const status = rows.length && !summary.reviewPages?.length && !summary.imageOnlyPages?.length ? 'ready' : 'needs_review'
  const { data, error } = await supabase.from('oem_parts_manuals')
    .update({ extraction_status: status }).eq('id', id).select(MANUAL_COLUMNS).single()
  raise(error, 'Parts were saved, but the manual status could not be finalized.')
  return data
}
