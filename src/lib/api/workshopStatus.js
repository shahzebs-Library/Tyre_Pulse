/**
 * Workshop Status service (Daily Ops -> Workshop Status).
 *
 * Reads go through RLS (workshop_status_records etc.). Every write goes through
 * the SECURITY DEFINER functions of migration 20261007110000:
 *   workshop_status_stage_upload    store the parsed upload (status previewed)
 *   workshop_status_confirm_upload  apply it to the live list in ONE transaction
 *   workshop_status_cancel_upload   drop a previewed upload
 * The server recomputes which vehicles are active; the outcomes sent here are
 * evidence for the upload register, not instructions.
 */
import { supabase, fetchAllPages, ServiceError, toServiceError } from './_client'

/** Columns the Workshop Status list reads (explicit, least privilege). */
export const RECORD_COLS = [
  'id', 'organisation_id', 'country', 'asset_no', 'vehicle_id', 'asset_breakdown_id',
  'reg_no', 'job_card_ref', 'vehicle_category', 'site', 'department', 'complaint', 'diagnostics',
  'ooc_since', 'excel_down_days', 'excel_expected_release', 'excel_status_note', 'source_remarks',
  'excel_updated_at',
  'current_stage', 'delay_reason', 'detailed_reason', 'work_done', 'action_taken', 'next_action',
  'parts_status', 'mr_number', 'po_number', 'responsible_user_id', 'supporting_user_id',
  'expected_part_date', 'expected_release_date', 'blocker', 'remarks',
  'current_active', 'daily_report_status', 'first_seen_upload_id', 'first_seen_at',
  'last_seen_upload_id', 'last_seen_at', 'last_manual_update_at', 'last_updated_by',
  'last_updated_by_name', 'last_update_source', 'created_at', 'updated_at',
].join(',')

const UPLOAD_LOOKUP_COLS = 'id,upload_no,uploaded_at,uploaded_by_name,status'
const MAX_ROWS = 20000

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')
const trimmed = (v) => (blank(v) ? null : String(v).trim())

function requireCountry(country) {
  const c = trimmed(country)
  if (!c) throw new ServiceError('Choose a country first.', 'country_required')
  return c
}

/**
 * The site alias table (alias -> canonical), so the upload preview normalises
 * a site exactly like the normalize_site() trigger. Best effort: a failed read
 * returns an empty Map and the preview falls back to the suffix rule only.
 *
 * @returns {Promise<Map<string, string>>}
 */
export async function listSiteAliases() {
  const out = new Map()
  const { data, error } = await fetchAllPages((from, to) => supabase
    .from('site_aliases').select('alias,canonical').order('alias', { ascending: true }).range(from, to), { max: 5000 })
  if (error) return out
  for (const r of data || []) {
    if (r?.alias && r?.canonical) out.set(String(r.alias).trim().toUpperCase(), String(r.canonical).trim().toUpperCase())
  }
  return out
}

/**
 * Active (current report) records for one country, not soft-deleted, ordered by
 * asset then id so paging is stable. Pages past the 1000-row server cap.
 */
export async function listActiveRecords({ country } = {}) {
  const c = requireCountry(country)
  const { data, error } = await fetchAllPages((from, to) =>
    supabase
      .from('workshop_status_records')
      .select(RECORD_COLS)
      .eq('country', c)
      .eq('current_active', true)
      .is('deleted_at', null)
      .order('asset_no', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to), { max: MAX_ROWS })
  if (error) throw toServiceError(error, 'Could not load the workshop vehicles.')
  return data || []
}

/**
 * Latest confirmed (else previewed) upload of the same file, or null. Matches
 * the server's duplicate check: org + file hash, whatever the country (the same
 * file uploaded under another country is still the same file). `country` is
 * accepted for call-site symmetry and deliberately not used as a filter.
 */
export async function findPreviousUploadByHash({ fileHash, country } = {}) {
  const hash = trimmed(fileHash)
  if (!hash) return null
  const { data, error } = await supabase
    .from('workshop_status_uploads')
    .select(UPLOAD_LOOKUP_COLS)
    .eq('file_hash', hash)
    .in('status', ['confirmed', 'previewed'])
    .order('uploaded_at', { ascending: false })
    .limit(20)
  if (error) throw toServiceError(error, 'Could not check earlier uploads.')
  const rows = data || []
  const pick = rows.find((r) => r.status === 'confirmed') || rows[0]
  return pick
    ? { id: pick.id, upload_no: pick.upload_no, uploaded_at: pick.uploaded_at, uploaded_by_name: pick.uploaded_by_name, status: pick.status }
    : null
}

/** Store a parsed upload for review. Returns { uploadId, uploadNo, duplicateOf }. */
export async function stageUpload({
  country, fileName, fileHash, fileSize, sheetName, reportDate, headerMap, unmappedHeaders, rows,
} = {}) {
  const c = requireCountry(country)
  if (blank(fileName)) throw new ServiceError('The file name is missing.', 'file_name_required')
  const list = Array.isArray(rows) ? rows : []
  if (list.length > 5000) throw new ServiceError('The file has more than 5000 rows. Split it and upload again.', 'too_many_rows')
  const { data, error } = await supabase.rpc('workshop_status_stage_upload', {
    p_country: c,
    p_file_name: String(fileName).trim(),
    p_file_hash: trimmed(fileHash),
    p_file_size: Number.isFinite(Number(fileSize)) && fileSize != null ? Math.round(Number(fileSize)) : null,
    p_sheet_name: trimmed(sheetName),
    p_report_date: trimmed(reportDate),
    p_header_map: headerMap && typeof headerMap === 'object' ? headerMap : {},
    p_unmapped: Array.isArray(unmappedHeaders) ? unmappedHeaders.map(String) : [],
    p_rows: list,
  })
  if (error) throw toServiceError(error, 'Could not save the upload for review.')
  return {
    uploadId: data?.upload_id ?? null,
    uploadNo: data?.upload_no ?? null,
    duplicateOf: data?.duplicate_of ?? null,
  }
}

const CONFIRM_ERRORS = {
  duplicate_file: 'This file was already uploaded. Confirm again only if you really mean to apply it a second time.',
  stale_preview: 'Another workshop upload for this country was confirmed after this preview. Upload the file again so the comparison is up to date.',
  upload_not_previewed: 'This upload was already confirmed or cancelled.',
}

function mapConfirmError(error, fallback) {
  const text = `${error?.message ?? ''} ${error?.details ?? ''}`
  for (const [code, message] of Object.entries(CONFIRM_ERRORS)) {
    if (text.includes(code)) return new ServiceError(message, code, error)
  }
  return toServiceError(error, fallback)
}

/** Apply a previewed upload to the live list (one transaction). Returns the summary. */
export async function confirmUpload(uploadId, { acknowledgeDuplicate = false } = {}) {
  if (blank(uploadId)) throw new ServiceError('No upload to confirm.', 'upload_required')
  const { data, error } = await supabase.rpc('workshop_status_confirm_upload', {
    p_upload_id: uploadId,
    p_acknowledge_duplicate: acknowledgeDuplicate === true,
  })
  if (error) throw mapConfirmError(error, 'Could not confirm the upload. Nothing was changed.')
  return data
}

/** Cancel a previewed upload. */
export async function cancelUpload(uploadId) {
  if (blank(uploadId)) throw new ServiceError('No upload to cancel.', 'upload_required')
  const { data, error } = await supabase.rpc('workshop_status_cancel_upload', { p_upload_id: uploadId })
  if (error) throw mapConfirmError(error, 'Could not cancel the upload.')
  return data
}

/**
 * Turn a compareWorkshopUpload() result + the preview it was built from into the
 * p_rows array for stageUpload: one row per preview row, plus one 'removed' row
 * per record that would leave the report.
 */
export function buildStagedRows(comparison, preview) {
  const cmp = comparison || {}
  const p = preview || {}
  const byRow = new Map()
  for (const r of cmp.newRecords || []) byRow.set(r.row, { outcome: 'new', recordId: null, changes: {} })
  for (const r of cmp.changedRecords || []) byRow.set(r.row, { outcome: 'changed', recordId: r.recordId ?? null, changes: r.changes || {} })
  for (const r of cmp.unchangedRecords || []) byRow.set(r.row, { outcome: 'unchanged', recordId: r.recordId ?? null, changes: {} })

  const sourceRows = Array.isArray(p.rows) && p.rows.length
    ? p.rows
    : [...(p.active || []), ...(p.closed || []), ...(p.invalid || []), ...(p.duplicates || [])]

  const out = []
  for (const row of sourceRows) {
    if (!row) continue
    let outcome
    let recordId = null
    let changes = {}
    if (row.status === 'invalid') outcome = 'invalid'
    else if (row.status === 'duplicate') outcome = 'duplicate'
    else if (row.status === 'closed') outcome = 'closed'
    else {
      const hit = byRow.get(row)
      if (hit) ({ outcome, recordId, changes } = hit)
      else outcome = 'duplicate' // an active row the comparison skipped (repeat asset)
    }
    out.push({
      row_number: row.rowNumber ?? null,
      section: row.section ?? null,
      asset_no: row.asset_no ?? row.data?.asset_no ?? null,
      site: row.data?.site ?? null,
      outcome,
      data: row.data || {},
      raw: row.raw || {},
      changes,
      errors: Array.isArray(row.errors) ? row.errors.map(String) : [],
      record_id: recordId,
    })
  }
  for (const r of cmp.removedRecords || []) {
    out.push({
      row_number: null,
      section: null,
      asset_no: r.asset_no ?? null,
      site: r.record?.site ?? null,
      outcome: 'removed',
      data: {},
      raw: { removal_reason: r.reason ?? null },
      changes: {},
      errors: [],
      record_id: r.recordId ?? null,
    })
  }
  return out
}
