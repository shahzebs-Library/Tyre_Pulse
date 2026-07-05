/**
 * Imports service - the only place the Data Intake Center talks to the import_*
 * staging tables (V45) and the commit RPCs (V46). Thin Supabase wrappers with
 * explicit columns; every method throws on error.
 */
import { supabase } from '../supabase'
import { ServiceError, unwrap } from './_client'
import { normaliseToken } from '../import/synonyms'

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
 * Look up a previously-uploaded file by content hash and tell whether it was
 * ever committed. Used to recover gracefully from duplicate-hash uploads instead
 * of dead-ending the user.
 */
async function findFileBySha(sha256) {
  if (!sha256) return null
  const { data: f } = await supabase.from('import_files')
    .select('id,storage_path').eq('sha256', sha256).maybeSingle()
  if (!f) return null
  const { data: b } = await supabase.from('import_batches')
    .select('id').eq('file_id', f.id).eq('import_status', 'committed').limit(1).maybeSingle()
  return { id: f.id, storagePath: f.storage_path, committedBatchId: b?.id ?? null }
}

/**
 * Upload the original file to the PRIVATE import-files bucket and record it.
 * Path: <org>/<country>/<module>/<uuid>/<filename>. Returns file metadata.
 *
 * Duplicate-hash recovery: the same bytes may already have a file row (e.g. an
 * earlier attempt that never finished). Rather than dead-ending with "already
 * imported", we: (a) remove the redundant object we just stored, (b) if the
 * prior upload was actually COMMITTED, block with a pointer to History, else
 * (c) REUSE the orphaned prior file and let the import continue.
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
    // 23505 = duplicate sha256 for this org - recover instead of dead-ending.
    if (error.code === '23505') {
      await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
      const prior = await findFileBySha(sha256)
      if (prior?.committedBatchId) {
        const e = new ServiceError(
          'This file was already imported and committed. Open it from Import History instead of re-importing.',
          '23505', error,
        )
        e.alreadyCommitted = true
        e.batchId = prior.committedBatchId
        throw e
      }
      // Orphaned earlier upload (never committed) → reuse it and continue.
      return { fileId: prior?.id ?? null, bucket: BUCKET, path: prior?.storagePath ?? path, sha256, reused: true }
    }
    throw new ServiceError(error.message, error.code, error)
  }
  return { fileId: data.id, bucket: BUCKET, path, sha256 }
}

/**
 * Upload one extracted attachment (from an accident evidence ZIP) to the PRIVATE
 * import-files bucket and record it in import_files. We reuse the import-files
 * bucket (not accident-photos) so EVERY artefact of an import - the source
 * workbook and its evidence package - lives under one org/country/batch path,
 * shares one RLS surface, and is governed by one retention policy. Downloads are
 * always via short-lived signed URLs; no public URL is ever produced.
 *
 * Path: <org>/<country>/accident/<batchId>/attachments/<uuid>/<filename>.
 *
 * @param {File|Blob} file            Extracted file (a Blob carries no .name).
 * @param {Object}    opts
 * @param {string}    opts.batchId    Owning import batch.
 * @param {string}    [opts.country]  Country scope for the storage path.
 * @param {string}    [opts.filename] Original filename (required when file is a Blob).
 * @param {string}    [opts.sha256]   Optional content hash for dedupe.
 * @returns {Promise<{ fileId: string|null, bucket: string, path: string }>}
 */
export async function uploadAttachment(file, { batchId, country, filename, sha256 } = {}) {
  const user = await currentUser()
  const org = await currentOrgId(user?.id)
  const name = filename || file?.name || 'attachment'
  const safeName = name.replace(/[^\w.\-]+/g, '_')
  const path = `${org}/${country || 'NA'}/accident/${batchId || 'unbatched'}/attachments/${uuid()}/${safeName}`

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file?.type || 'application/octet-stream',
    upsert: false,
  })
  if (upErr) throw new ServiceError(upErr.message, upErr.statusCode, upErr)

  // Record the bytes as an import_files row so the attachment is a first-class,
  // retention-tracked artefact (best-effort: a missing row must not lose the file).
  let fileId = null
  try {
    const row = {
      country: country || null,
      storage_bucket: BUCKET,
      storage_path: path,
      original_filename: name,
      mime_type: file?.type || null,
      size_bytes: file?.size ?? null,
      sha256: sha256 ?? null,
      created_by: user?.id ?? null,
    }
    const { data, error } = await supabase.from('import_files').insert(row).select('id').single()
    if (error && error.code !== '23505') throw new ServiceError(error.message, error.code, error)
    fileId = data?.id ?? null
  } catch (err) {
    if (err instanceof ServiceError && err.code === '23505') fileId = null
    else throw err
  }

  return { fileId, bucket: BUCKET, path }
}

/**
 * Bulk-insert attachment match records (V45 import_attachment_matches). Columns
 * are explicit and real: batch_id, file_id, match_key, match_kind,
 * matched_entity_type, matched_entity_id, status. organisation_id is set by the
 * table default + RLS (app_current_org), never by the client.
 *
 * @param {Array<{ batchId?: string, fileId?: string|null, matchKey?: string,
 *   matchKind?: string, matchedEntityType?: string|null,
 *   matchedEntityId?: string|null, status?: string }>} rows
 * @returns {Promise<number>} number of rows recorded
 */
export async function recordAttachmentMatches(rows) {
  if (!rows?.length) return 0
  const payload = rows.map((r) => ({
    batch_id: r.batchId ?? null,
    file_id: r.fileId ?? null,
    match_key: r.matchKey ?? null,
    match_kind: r.matchKind ?? null,
    matched_entity_type: r.matchedEntityType ?? null,
    matched_entity_id: r.matchedEntityId ?? null,
    status: r.status ?? 'unmatched',
  }))
  const { error } = await supabase.from('import_attachment_matches').insert(payload)
  if (error) throw new ServiceError(error.message, error.code, error)
  return payload.length
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
// Insert one chunk, retrying transient network failures. A big/​wide file used to
// fail here with a bare "Failed to fetch" because a single 500-row POST body (four
// JSONB blobs per row) exceeded the gateway's request-size limit, leaving the
// batch staged with 0 rows.
async function insertRowChunk(chunk, attempts = 4) {
  for (let a = 1; a <= attempts; a++) {
    try {
      const { error } = await supabase.from('import_rows').insert(chunk)
      if (error) throw new ServiceError(error.message, error.code, error)
      return
    } catch (e) {
      const networkish = e?.name === 'TypeError' || /failed to fetch|network|load failed|timeout/i.test(e?.message || '')
      if (!networkish || a === attempts) {
        throw new ServiceError(
          networkish
            ? `Could not save the rows after ${attempts} attempts — the request may be too large or the connection dropped. Try a smaller file or a stronger connection.`
            : (e?.message || 'Could not stage the rows.'),
          e?.code, e,
        )
      }
      await new Promise((res) => setTimeout(res, 400 * a * a)) // 0.4s, 1.6s, 3.6s backoff
    }
  }
}

export async function stageRows(batchId, rows) {
  const MAX_ROWS = 100          // hard cap per request
  const MAX_BYTES = 1_200_000   // ~1.2 MB serialized budget per request
  const payload = rows.map((r) => ({
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

  // Size-bounded chunking: grow each chunk until it hits the row cap or the byte
  // budget, so no single request body can get large enough to be dropped.
  let i = 0
  while (i < payload.length) {
    let end = i
    let bytes = 0
    while (end < payload.length && (end - i) < MAX_ROWS) {
      const sz = JSON.stringify(payload[end]).length
      if (end > i && bytes + sz > MAX_BYTES) break
      bytes += sz
      end++
    }
    await insertRowChunk(payload.slice(i, end))
    i = end
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

// Tunable company limits for post-import automation. Overridable via opts.limits
// so thresholds can move to a per-org config table later with no code change.
const AUTOMATION_LIMITS = { TREAD_MIN_MM: 3, PRESSURE_MIN: 90, PRESSURE_LOW_REPEAT: 2 }

/**
 * Value-producing automation (directive §20). After a batch commits, generate
 * org/country-scoped operational alerts + corrective actions from the just-
 * committed rows. Best-effort and idempotent (skips assets already alerted /
 * with an open action); NEVER throws - the commit result stays authoritative.
 *
 * @returns {Promise<{alerts:number, actions:number, skipped:number, error?:string}>}
 */
export async function runPostImportAutomation(batchId, module, opts = {}) {
  const limits = { ...AUTOMATION_LIMITS, ...(opts.limits || {}) }
  try {
    if (module !== 'tyre') return { alerts: 0, actions: 0, skipped: 0 }
    const batch = await getBatch(batchId)
    const scopeCountry = batch?.country ?? opts.country ?? null
    const rows = await getBatchRows(batchId, 5000)
    // Only act on rows that actually became live records.
    const live = rows.filter((r) => r.target_record_id != null).map((r) => r.transformed_data || {})
    const user = await currentUser()

    // ── Alerts: critical risk or low tread ───────────────────────────────────
    const alertCand = []
    for (const t of live) {
      if (!t.asset_no) continue
      const critical = String(t.risk_level || '').toLowerCase() === 'critical'
      const tread = Number(t.tread_depth)
      const lowTread = Number.isFinite(tread) && tread < limits.TREAD_MIN_MM
      if (!critical && !lowTread) continue
      const bits = [t.serial_no && `serial ${t.serial_no}`, lowTread && `tread ${tread}mm`, critical && 'risk Critical'].filter(Boolean)
      alertCand.push({
        asset_no: t.asset_no, alert_type: 'tyre_risk', severity: critical ? 'critical' : 'high',
        message: `Imported tyre on ${t.asset_no}${bits.length ? ' - ' + bits.join(', ') : ''}.`,
        site: t.site ?? null, country: scopeCountry ?? t.country ?? null,
        resolved: false, is_active: true, created_by: user?.id ?? null,
      })
    }

    // ── Corrective actions: repeated low pressure on one asset ────────────────
    const byAsset = new Map()
    for (const t of live) {
      if (!t.asset_no) continue
      const p = Number(t.pressure_reading)
      if (!(Number.isFinite(p) && p < limits.PRESSURE_MIN)) continue
      const a = byAsset.get(t.asset_no) || { count: 0, site: t.site ?? null, serial: t.serial_no ?? null }
      a.count++
      byAsset.set(t.asset_no, a)
    }
    const actionCand = []
    for (const [asset, a] of byAsset) {
      if (a.count < limits.PRESSURE_LOW_REPEAT) continue
      actionCand.push({
        title: `Repeated low tyre pressure - asset ${asset}`, priority: 'high',
        site: a.site, region: null,
        description: `${a.count} tyres on asset ${asset} imported with pressure below ${limits.PRESSURE_MIN}.`,
        root_cause: 'Under-inflation', asset_no: asset, tyre_serial: a.serial,
        status: 'open', country: scopeCountry, due_date: null, created_by: user?.id ?? null,
      })
    }

    let skipped = 0
    // Idempotency: skip assets already alerted / with an open action (RLS org-scoped).
    if (alertCand.length) {
      const assets = [...new Set(alertCand.map((c) => c.asset_no))]
      let eq = supabase.from('alerts').select('asset_no').eq('alert_type', 'tyre_risk').eq('is_active', true).in('asset_no', assets)
      if (scopeCountry) eq = eq.eq('country', scopeCountry)
      const { data: existing } = await eq
      const seen = new Set((existing || []).map((e) => e.asset_no))
      const fresh = alertCand.filter((c) => !seen.has(c.asset_no))
      skipped += alertCand.length - fresh.length
      alertCand.length = 0; alertCand.push(...fresh)
    }
    if (actionCand.length) {
      const assets = [...new Set(actionCand.map((c) => c.asset_no))]
      let eq = supabase.from('corrective_actions').select('asset_no').eq('status', 'open').in('asset_no', assets)
      if (scopeCountry) eq = eq.eq('country', scopeCountry)
      const { data: existing } = await eq
      const seen = new Set((existing || []).map((e) => e.asset_no))
      const fresh = actionCand.filter((c) => !seen.has(c.asset_no))
      skipped += actionCand.length - fresh.length
      actionCand.length = 0; actionCand.push(...fresh)
    }

    let alerts = 0
    let actions = 0
    if (alertCand.length) {
      const { error } = await supabase.from('alerts').insert(alertCand)
      if (error) console.warn('[automation] alerts insert failed:', error.message)
      else alerts = alertCand.length
    }
    if (actionCand.length) {
      const { error } = await supabase.from('corrective_actions').insert(actionCand)
      if (error) console.warn('[automation] corrective_actions insert failed:', error.message)
      else actions = actionCand.length
    }
    return { alerts, actions, skipped }
  } catch (err) {
    console.warn('[automation] post-import automation failed:', err?.message || err)
    return { alerts: 0, actions: 0, skipped: 0, error: err?.message || String(err) }
  }
}

/** Commit an approved batch into live tables via the secure server RPC. */
export async function commitBatch(batchId) {
  const { data, error } = await supabase.rpc('import_commit_batch', { p_batch_id: batchId })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data
}

/**
 * Cross-file enrichment (V79). For the batch's `action='update'` rows (rows whose
 * natural key already exists live), fill ONLY the empty columns on the matching
 * live record from this file — never overwriting existing values. Returns
 * `{ enriched, skipped, no_match }`.
 */
export async function enrichBatch(batchId) {
  const { data, error } = await supabase.rpc('import_enrich_batch', { p_batch_id: batchId })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data
}

/**
 * Live-table duplicate detection (V47). Returns the set of natural-key strings
 * already present in the module's live table for the caller's organisation, so
 * the Data Intake Center can skip re-importing an existing record. The key is
 * built server-side identically to validate.naturalKey().
 *
 * @param {{ module: 'fleet'|'tyre'|'stock', country?: string }} params
 * @returns {Promise<Set<string>>}
 */
export async function existingKeys({ module, country }) {
  const { data, error } = await supabase.rpc('import_existing_keys', {
    p_module: module,
    p_country: country ?? null,
  })
  if (error) throw new ServiceError(error.message, error.code, error)
  // RPC returns SETOF text → array of strings (rows) or array of { import_existing_keys }.
  const keys = (data || []).map((r) => (typeof r === 'string' ? r : r?.import_existing_keys)).filter(Boolean)
  return new Set(keys)
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

/**
 * Permanently delete an import batch and (via ON DELETE CASCADE) its staged
 * rows, sheets and attachment matches. Use for abandoned / draft / staged /
 * rejected batches. A COMMITTED batch must be reversed first (reverseBatch) so
 * the live rows it produced are removed too - this guards against orphaning them.
 */
export async function deleteBatch(batchId) {
  const { error } = await supabase.from('import_batches').delete().eq('id', batchId)
  if (error) throw new ServiceError(error.message, error.code, error)
}

/**
 * Recently uploaded original files, each tagged with whether it ever became a
 * batch (hasBatch) / was committed (committed) / is an ORPHAN (uploaded but no
 * batch - e.g. an abandoned attempt). Surfaces files that would otherwise be
 * invisible in the batch-centric views.
 */
export async function listFiles({ country, limit = 25 } = {}) {
  let q = supabase.from('import_files')
    .select('id,original_filename,country,mime_type,size_bytes,created_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
  const files = unwrap(await q)
  if (!files.length) return files
  const ids = files.map((f) => f.id)
  const { data: batches } = await supabase.from('import_batches').select('file_id,import_status').in('file_id', ids)
  const withBatch = new Set((batches || []).map((b) => b.file_id))
  const committed = new Set((batches || []).filter((b) => b.import_status === 'committed').map((b) => b.file_id))
  return files.map((f) => ({ ...f, hasBatch: withBatch.has(f.id), committed: committed.has(f.id), orphan: !withBatch.has(f.id) }))
}

/**
 * Delete an uploaded file record and its stored object. Intended for ORPHAN
 * cleanup (a file with a batch is protected by the FK); the stored object is
 * removed first so no private bytes are left behind.
 */
export async function deleteFile(fileId) {
  const { data: f } = await supabase.from('import_files')
    .select('storage_bucket,storage_path').eq('id', fileId).maybeSingle()
  if (f?.storage_path) {
    await supabase.storage.from(f.storage_bucket || BUCKET).remove([f.storage_path]).catch(() => {})
  }
  const { error } = await supabase.from('import_files').delete().eq('id', fileId)
  if (error) throw new ServiceError(error.message, error.code, error)
}

/** Data Intake batches awaiting an approver's decision (canonical pipeline). */
export async function listForApproval({ country, limit = 100 } = {}) {
  let q = supabase.from('import_batches').select(BATCH_COLS)
    .eq('approval_status', 'pending_approval')
    .order('created_at', { ascending: false }).limit(limit)
  if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
  return unwrap(await q)
}

/** Reject a submitted batch without committing it to the live tables. */
export async function rejectBatch(batchId) {
  const user = await currentUser()
  const { error } = await supabase.from('import_batches')
    .update({ approval_status: 'rejected', approver: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq('id', batchId)
  if (error) throw new ServiceError(error.message, error.code, error)
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

/**
 * Exact-format recognition: find the active mapping profile whose header
 * fingerprint matches this upload. When found the wizard applies it
 * automatically - the user's known report formats map with zero clicks.
 */
export async function findProfileByFingerprint({ module, fingerprint }) {
  if (!fingerprint) return null
  let q = supabase.from('import_mapping_profiles')
    .select('id,name,module,country,unit_settings')
    .eq('active', true).eq('header_fingerprint', fingerprint)
    .order('last_used_at', { ascending: false, nullsFirst: false }).limit(1)
  if (module) q = q.eq('module', module)
  const { data, error } = await q.maybeSingle()
  if (error || !data) return null
  const rules = await getProfileRules(data.id).catch(() => [])
  return { ...data, rules }
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

// ── Data linkage (V87) ────────────────────────────────────────────────────────
/**
 * Cross-table link health: for each business table, how many rows link to a real
 * vehicle by asset_no vs orphaned vs blank, plus the distinct missing assets.
 */
export async function linkAudit() {
  const { data, error } = await supabase.rpc('data_link_audit')
  if (error) throw new ServiceError(error.message, error.code, error)
  return data
}

/**
 * Linkage repair (admin only): create a skeleton vehicle_fleet row for every
 * orphan asset_no found in tyre_records, so tyres/work-orders/inspections link
 * to a real vehicle. Org-scoped, audited. Returns { created }.
 */
export async function linkCreateMissingAssets() {
  const { data, error } = await supabase.rpc('data_link_create_missing_assets')
  if (error) throw new ServiceError(error.message, error.code, error)
  return data
}

/**
 * Every saved mapping profile for the org (active AND inactive, all modules),
 * newest-used first, with a column-rule count — powers the Saved Mappings
 * manager so users can browse and manage their remembered formats without
 * having to start an upload.
 */
export async function listAllProfiles() {
  const rows = unwrap(
    await supabase.from('import_mapping_profiles')
      .select('id,name,module,source_system,country,active,version,last_used_at,created_at,import_mapping_rules(count)')
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
  )
  return (rows ?? []).map((p) => ({
    ...p,
    rule_count: Array.isArray(p.import_mapping_rules) ? (p.import_mapping_rules[0]?.count ?? 0) : 0,
  }))
}

/** Rename a saved mapping profile. */
export async function renameProfile(profileId, name) {
  const { error } = await supabase.from('import_mapping_profiles')
    .update({ name: String(name).trim() }).eq('id', profileId)
  if (error) throw new ServiceError(error.message, error.code, error)
}

/** Activate / deactivate a saved mapping profile (inactive ones are not auto-suggested). */
export async function setProfileActive(profileId, active) {
  const { error } = await supabase.from('import_mapping_profiles')
    .update({ active: !!active }).eq('id', profileId)
  if (error) throw new ServiceError(error.message, error.code, error)
}

/** Delete a saved mapping profile and its column rules. */
export async function deleteProfile(profileId) {
  // Remove rules first in case the FK is not ON DELETE CASCADE.
  await supabase.from('import_mapping_rules').delete().eq('profile_id', profileId)
  const { error } = await supabase.from('import_mapping_profiles').delete().eq('id', profileId)
  if (error) throw new ServiceError(error.message, error.code, error)
}

// ── Master-data aliases (directive §9) ───────────────────────────────────────
/** Active raw→canonical aliases for an entity type, country-scoped. */
export async function listAliases({ entityType, country } = {}) {
  let q = supabase.from('import_master_aliases')
    .select('id,entity_type,country,raw_value,canonical_value,canonical_id,active,created_at')
    .eq('active', true).order('raw_value')
  if (entityType) q = q.eq('entity_type', entityType)
  if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
  return unwrap(await q)
}

/**
 * Create or update one alias. Manual upsert (the unique key is on
 * COALESCE(country,'') - a functional index PostgREST can't name for onConflict).
 * organisation_id is set by the table DEFAULT + RLS, never by the client.
 */
export async function saveAlias({ entityType, country, rawValue, canonicalValue, canonicalId } = {}) {
  if (!entityType || !rawValue || !canonicalValue) {
    throw new ServiceError('entityType, rawValue and canonicalValue are required', 'validation')
  }
  const user = await currentUser()
  const norm = normaliseToken(rawValue)
  const scopeCountry = country && country !== 'All' ? country : null
  let sel = supabase.from('import_master_aliases').select('id')
    .eq('entity_type', entityType).eq('raw_value_norm', norm)
  sel = scopeCountry ? sel.eq('country', scopeCountry) : sel.is('country', null)
  const { data: existing } = await sel.maybeSingle()
  const row = {
    entity_type: entityType, country: scopeCountry,
    raw_value: String(rawValue).trim(), raw_value_norm: norm,
    canonical_value: String(canonicalValue).trim(), canonical_id: canonicalId ?? null,
    active: true, created_by: user?.id ?? null,
  }
  if (existing?.id) {
    const { error } = await supabase.from('import_master_aliases')
      .update({ canonical_value: row.canonical_value, canonical_id: row.canonical_id, active: true })
      .eq('id', existing.id)
    if (error) throw new ServiceError(error.message, error.code, error)
    return existing.id
  }
  const { data, error } = await supabase.from('import_master_aliases').insert(row).select('id').single()
  if (error) throw new ServiceError(error.message, error.code, error)
  return data.id
}

// ── Currency rates (directive §12) ───────────────────────────────────────────
/** Approved (default) or draft FX rates, newest first. */
export async function listCurrencyRates({ baseCurrency, quoteCurrency, approvedOnly = true } = {}) {
  let q = supabase.from('currency_rates')
    .select('id,base_currency,quote_currency,rate,rate_date,source,approved,approved_at,created_at')
    .order('rate_date', { ascending: false })
  if (approvedOnly) q = q.eq('approved', true)
  if (baseCurrency) q = q.eq('base_currency', baseCurrency)
  if (quoteCurrency) q = q.eq('quote_currency', quoteCurrency)
  return unwrap(await q)
}

/**
 * Preload a { [quoteCurrency]: { rate, rate_date, source } } map of the newest
 * APPROVED rate ≤ today for a base currency - fed into transformRow so currency
 * conversion stays synchronous and only ever uses approved rates.
 */
export async function listApprovedRatesMap({ baseCurrency } = {}) {
  if (!baseCurrency) return {}
  const rows = await listCurrencyRates({ baseCurrency, approvedOnly: true })
  const today = new Date().toISOString().slice(0, 10)
  const map = {}
  for (const r of rows) {
    if (r.rate_date > today) continue
    // rows are date-desc; first seen per quote currency is the newest approved.
    if (!map[r.quote_currency]) map[r.quote_currency] = { rate: Number(r.rate), rate_date: r.rate_date, source: r.source }
  }
  return map
}

/** Insert a draft (unapproved) FX rate. organisation_id set by DB default + RLS. */
export async function saveCurrencyRate({ baseCurrency, quoteCurrency, rate, rateDate, source } = {}) {
  if (!baseCurrency || !quoteCurrency || !(Number(rate) > 0) || !rateDate) {
    throw new ServiceError('baseCurrency, quoteCurrency, a positive rate and rateDate are required', 'validation')
  }
  const user = await currentUser()
  const { data, error } = await supabase.from('currency_rates').insert({
    base_currency: baseCurrency, quote_currency: quoteCurrency, rate: Number(rate),
    rate_date: rateDate, source: source || 'manual', created_by: user?.id ?? null,
  }).select('id').single()
  if (error) throw new ServiceError(error.message, error.code, error)
  return data.id
}

/** Approve a draft rate (RLS gates this to approved+unlocked users). */
export async function approveCurrencyRate(id) {
  const user = await currentUser()
  const { error } = await supabase.from('currency_rates')
    .update({ approved: true, approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new ServiceError(error.message, error.code, error)
}

export async function listCustomFields({ module, country } = {}) {
  let q = supabase.from('custom_field_catalog')
    .select('id,module,country,field_name,occurrence_count,example_values,mapping_status,last_seen_at')
    .order('occurrence_count', { ascending: false }).limit(200)
  if (module) q = q.eq('module', module)
  if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
  return unwrap(await q)
}

/**
 * Rich Import Control Dashboard aggregation (directive Section 21). Windowed over
 * the most-recent 1000 org+country-scoped batches; every rate is divide-by-zero
 * guarded and avgApprovalHours is null when no batch has been approved.
 */
export async function importControlStats({ country } = {}) {
  let q = supabase.from('import_batches')
    .select('id,country,module,source_system,approval_status,import_status,total_rows,ready_rows,warning_rows,error_rows,duplicate_rows,conflict_rows,imported_rows,skipped_rows,uploader,created_at,approved_at')
    .order('created_at', { ascending: false }).limit(1000)
  if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
  const batches = unwrap(await q)

  const bump = (o, k) => { const key = k ?? 'Unassigned'; o[key] = (o[key] || 0) + 1 }
  const s = {
    total: batches.length, byCountry: {}, byModule: {}, bySource: {}, byStatus: {},
    successRate: 0, validationErrorRate: 0, duplicateRate: 0, conflictRate: 0,
    totalRows: 0, errorRows: 0, warningRows: 0, duplicateRows: 0, conflictRows: 0,
    importedRows: 0, skippedRows: 0, failedRows: 0, pendingApproval: 0,
    avgApprovalHours: null, topUploaders: [], latest: [],
  }
  let committed = 0
  let apprMs = 0
  let apprN = 0
  const uploaders = new Map()
  for (const b of batches) {
    bump(s.byCountry, b.country); bump(s.byModule, b.module)
    bump(s.bySource, b.source_system ?? 'Unknown'); bump(s.byStatus, b.import_status)
    if (b.import_status === 'committed') committed++
    if (b.approval_status === 'pending_approval') s.pendingApproval++
    s.totalRows += b.total_rows || 0
    s.errorRows += b.error_rows || 0
    s.warningRows += b.warning_rows || 0
    s.duplicateRows += b.duplicate_rows || 0
    s.conflictRows += b.conflict_rows || 0
    s.importedRows += b.imported_rows || 0
    s.skippedRows += b.skipped_rows || 0
    if (b.approved_at && b.created_at) {
      const ms = new Date(b.approved_at).getTime() - new Date(b.created_at).getTime()
      if (Number.isFinite(ms) && ms >= 0) { apprMs += ms; apprN++ }
    }
    if (b.uploader) uploaders.set(b.uploader, (uploaders.get(b.uploader) || 0) + 1)
  }
  s.failedRows = s.errorRows
  s.successRate = s.total ? Math.round((committed / s.total) * 100) : 0
  s.validationErrorRate = s.totalRows ? Math.round((s.errorRows / s.totalRows) * 100) : 0
  s.duplicateRate = s.totalRows ? Math.round((s.duplicateRows / s.totalRows) * 100) : 0
  s.conflictRate = s.totalRows ? Math.round((s.conflictRows / s.totalRows) * 100) : 0
  s.avgApprovalHours = apprN ? Math.round((apprMs / apprN) / 3600000 * 10) / 10 : null
  s.topUploaders = [...uploaders.entries()]
    .map(([uploader, count]) => ({ uploader, count }))
    .sort((a, b) => b.count - a.count).slice(0, 5)
  s.latest = batches.slice(0, 8).map((b) => ({
    id: b.id, module: b.module, country: b.country, status: b.import_status,
    importedRows: b.imported_rows || 0, totalRows: b.total_rows || 0, createdAt: b.created_at,
  }))
  return s
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
