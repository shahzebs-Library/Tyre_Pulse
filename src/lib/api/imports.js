/**
 * Imports service — the only place the Data Intake Center talks to the import_*
 * staging tables (V45) and the commit RPCs (V46). Thin Supabase wrappers with
 * explicit columns; every method throws on error.
 */
import { supabase } from '../supabase'
import { ServiceError, unwrap } from './_client'

const BUCKET = 'import-files'

function uuid() {
  return (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

async function currentUser() {
  const { data } = await supabase.auth.getUser()
  return data?.user ?? null
}

/** The caller's organisation_id (for storage paths); falls back to default org. */
async function currentOrgId(userId) {
  if (!userId) return '00000000-0000-0000-0000-000000000001'
  const { data } = await supabase.from('profiles').select('org_id').eq('id', userId).maybeSingle()
  return data?.org_id ?? '00000000-0000-0000-0000-000000000001'
}

/**
 * Upload the original file to the PRIVATE import-files bucket and record it.
 * Path: <org>/<country>/<module>/<uuid>/<filename>. Returns file metadata.
 */
export async function uploadOriginalFile(file, { module, country, sha256 }) {
  const user = await currentUser()
  const org = await currentOrgId(user?.id)
  const safeName = (file.name || 'upload').replace(/[^\w.\-]+/g, '_')
  const path = `${org}/${country || 'NA'}/${module}/${uuid()}/${safeName}`

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (upErr) throw new ServiceError(upErr.message, upErr.statusCode, upErr)

  const row = {
    country: country || null,
    storage_bucket: BUCKET,
    storage_path: path,
    original_filename: file.name || safeName,
    mime_type: file.type || null,
    size_bytes: file.size ?? null,
    sha256: sha256 ?? null,
    created_by: user?.id ?? null,
  }
  const { data, error } = await supabase.from('import_files').insert(row).select('id').single()
  if (error) {
    // 23505 = duplicate sha256 for this org
    if (error.code === '23505') throw new ServiceError('This file has already been imported.', error.code, error)
    throw new ServiceError(error.message, error.code, error)
  }
  return { fileId: data.id, bucket: BUCKET, path, sha256 }
}

/** Create a staging batch for one sheet/module/country. Returns the batch id. */
export async function createBatch(b) {
  const user = await currentUser()
  const row = {
    country: b.country,
    module: b.module,
    file_id: b.fileId ?? null,
    sheet: b.sheet ?? null,
    source_system: b.sourceSystem ?? null,
    header_row_detected: b.headerRowDetected ?? null,
    header_row_confirmed: b.headerRowConfirmed ?? null,
    mapping_profile_id: b.mappingProfileId ?? null,
    date_format: b.dateFormat ?? null,
    timezone: b.timezone ?? null,
    source_currency: b.sourceCurrency ?? null,
    unit_system: b.unitSystem ?? null,
    uploader: user?.id ?? null,
    created_by: user?.id ?? null,
    approval_status: 'draft',
    import_status: 'staged',
  }
  const { data, error } = await supabase.from('import_batches').insert(row).select('id').single()
  if (error) throw new ServiceError(error.message, error.code, error)
  return data.id
}

export async function saveSheets(batchId, sheets) {
  if (!sheets?.length) return
  const rows = sheets.map((s, i) => ({
    batch_id: batchId,
    sheet_name: s.name,
    sheet_order: s.sheetOrder ?? i,
    header_row: s.headerRow ?? null,
    total_rows: s.rows?.length ?? s.totalRows ?? 0,
    selected: s.selected ?? true,
    source_columns: s.columns ?? [],
    summary: s.summary ?? {},
  }))
  const { error } = await supabase.from('import_batch_sheets').insert(rows)
  if (error) throw new ServiceError(error.message, error.code, error)
}

/** Bulk-insert staged rows (chunked to stay within request limits). */
export async function stageRows(batchId, rows) {
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      batch_id: batchId,
      sheet_name: r.sheetName ?? null,
      source_row_no: r.sourceRowNo ?? null,
      raw_source_data: r.raw ?? {},
      mapped_data: r.mapped ?? {},
      transformed_data: r.transformed ?? {},
      custom_data: r.custom ?? {},
      validation_status: r.validationStatus ?? 'pending',
      dup_status: r.dupStatus ?? 'none',
      action: r.action ?? 'insert',
      row_fingerprint: r.fingerprint ?? null,
    }))
    const { error } = await supabase.from('import_rows').insert(chunk)
    if (error) throw new ServiceError(error.message, error.code, error)
  }
}

export async function saveRowIssues(issues) {
  if (!issues?.length) return
  const { error } = await supabase.from('import_row_issues').insert(issues)
  if (error) throw new ServiceError(error.message, error.code, error)
}

export async function setBatchCounts(batchId, c) {
  const { error } = await supabase.from('import_batches').update({
    total_rows: c.total ?? 0,
    ready_rows: c.ready ?? 0,
    warning_rows: c.warning ?? 0,
    error_rows: c.error ?? 0,
    duplicate_rows: c.duplicate ?? 0,
    conflict_rows: c.conflict ?? 0,
  }).eq('id', batchId)
  if (error) throw new ServiceError(error.message, error.code, error)
}

export async function submitForApproval(batchId) {
  const { error } = await supabase.from('import_batches')
    .update({ approval_status: 'pending_approval' }).eq('id', batchId)
  if (error) throw new ServiceError(error.message, error.code, error)
}

export async function approveBatch(batchId) {
  const user = await currentUser()
  const { error } = await supabase.from('import_batches')
    .update({ approval_status: 'approved', approver: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq('id', batchId)
  if (error) throw new ServiceError(error.message, error.code, error)
}

/** Commit an approved batch into live tables via the secure server RPC. */
export async function commitBatch(batchId) {
  const { data, error } = await supabase.rpc('import_commit_batch', { p_batch_id: batchId })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data
}

export async function reverseBatch(batchId) {
  const { data, error } = await supabase.rpc('import_reverse_batch', { p_batch_id: batchId })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data
}

export async function reprocessRow(rowId) {
  const { error } = await supabase.rpc('import_reprocess_row', { p_row_id: rowId })
  if (error) throw new ServiceError(error.message, error.code, error)
}

// ── Reads ────────────────────────────────────────────────────────────────────
const BATCH_COLS =
  'id,country,module,sheet,source_system,approval_status,import_status,total_rows,ready_rows,warning_rows,error_rows,duplicate_rows,imported_rows,skipped_rows,created_at,approved_at,completed_at'

export async function listBatches({ country, module, status, limit = 50 } = {}) {
  let q = supabase.from('import_batches').select(BATCH_COLS).order('created_at', { ascending: false }).limit(limit)
  if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
  if (module) q = q.eq('module', module)
  if (status) q = q.eq('import_status', status)
  return unwrap(await q)
}

export async function getBatch(id) {
  return unwrap(await supabase.from('import_batches').select(BATCH_COLS).eq('id', id).maybeSingle())
}

export async function getBatchRows(batchId, limit = 500) {
  return unwrap(
    await supabase.from('import_rows')
      .select('id,source_row_no,validation_status,dup_status,action,transformed_data,target_record_id,processed_at')
      .eq('batch_id', batchId).order('source_row_no').limit(limit),
  )
}

export async function getRowIssues(rowId) {
  return unwrap(
    await supabase.from('import_row_issues')
      .select('id,source_field,target_field,severity,issue_code,message,original_value,resolved')
      .eq('row_id', rowId).order('severity'),
  )
}

export async function listProfiles({ module, country } = {}) {
  let q = supabase.from('import_mapping_profiles')
    .select('id,name,module,source_system,country,version,active,last_used_at')
    .eq('active', true).order('last_used_at', { ascending: false, nullsFirst: false })
  if (module) q = q.eq('module', module)
  if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
  return unwrap(await q)
}

export async function saveProfile(profile, rules = []) {
  const user = await currentUser()
  const { data, error } = await supabase.from('import_mapping_profiles').insert({
    name: profile.name,
    module: profile.module,
    source_system: profile.sourceSystem ?? null,
    country: profile.country ?? null,
    header_fingerprint: profile.headerFingerprint ?? null,
    date_format: profile.dateFormat ?? null,
    source_currency: profile.sourceCurrency ?? null,
    unit_settings: profile.unitSettings ?? {},
    created_by: user?.id ?? null,
  }).select('id').single()
  if (error) throw new ServiceError(error.message, error.code, error)
  if (rules.length) {
    const ruleRows = rules.map((r) => ({
      profile_id: data.id, source_header: r.sourceHeader, target_field: r.target ?? null,
      transform: r.transform ?? {}, alias_rule: r.aliasRule ?? {}, confidence: r.confidence ?? null,
    }))
    const { error: rErr } = await supabase.from('import_mapping_rules').insert(ruleRows)
    if (rErr) throw new ServiceError(rErr.message, rErr.code, rErr)
  }
  return data.id
}

/** Mapping rules for a saved profile (source_header → target_field). */
export async function getProfileRules(profileId) {
  return unwrap(
    await supabase.from('import_mapping_rules')
      .select('source_header,target_field,transform,confidence')
      .eq('profile_id', profileId),
  )
}

/** Touch last_used_at when a profile is applied (best-effort, non-blocking). */
export async function touchProfile(profileId) {
  await supabase.from('import_mapping_profiles')
    .update({ last_used_at: new Date().toISOString() }).eq('id', profileId)
}

export async function listCustomFields({ module, country } = {}) {
  let q = supabase.from('custom_field_catalog')
    .select('id,module,country,field_name,occurrence_count,example_values,mapping_status,last_seen_at')
    .order('occurrence_count', { ascending: false }).limit(200)
  if (module) q = q.eq('module', module)
  if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
  return unwrap(await q)
}

/** Aggregate counts for the import quality dashboard. */
export async function importQualityStats({ country } = {}) {
  const batches = await listBatches({ country, limit: 500 })
  const stat = { total: batches.length, byStatus: {}, byModule: {}, pendingApproval: 0, errorRows: 0, duplicateRows: 0, importedRows: 0 }
  for (const b of batches) {
    stat.byStatus[b.import_status] = (stat.byStatus[b.import_status] || 0) + 1
    stat.byModule[b.module] = (stat.byModule[b.module] || 0) + 1
    if (b.approval_status === 'pending_approval') stat.pendingApproval++
    stat.errorRows += b.error_rows || 0
    stat.duplicateRows += b.duplicate_rows || 0
    stat.importedRows += b.imported_rows || 0
  }
  return stat
}
