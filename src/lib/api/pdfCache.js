/**
 * Stored report PDFs: data access.
 *
 * Tables report_pdf_files / report_pdf_events, bucket report-pdfs and the pdf_cache_*
 * functions come from supabase/pending_migrations/20261117090000_report_pdf_cache.sql.
 * Until that migration is applied every call here throws an error that
 * `isPdfCacheNotProvisioned` recognises, and the service falls back to generating the
 * PDF directly, exactly as before.
 *
 * WHY THE SIGNED URL IS MADE BY THE CLIENT (and not by an RPC or edge function):
 * the storage policy on the bucket only lets a caller read an object whose
 * report_pdf_files row that caller can read (organisation, country, site and the
 * source record's own row level security). So `createSignedUrl` is itself the
 * server-side authorisation check, with no service-role code path to get wrong.
 */
import { supabase, toServiceError, isNotProvisioned } from './_client'

export const PDF_BUCKET = 'report-pdfs'
const SIGNED_URL_SECONDS = 120

const NOT_PROVISIONED = 'PDF_CACHE_NOT_PROVISIONED'

export function isPdfCacheNotProvisioned(err) {
  return !!err && (err.code === NOT_PROVISIONED || isNotProvisioned(err)
    || /bucket not found/i.test(String(err.cause?.message || err.message || '')))
}

async function rpc(name, args, fallback) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    if (isNotProvisioned(error)) {
      const e = new Error('Stored PDFs are not set up yet.')
      e.code = NOT_PROVISIONED
      throw e
    }
    throw toServiceError(error, fallback)
  }
  return data
}

const keyArgs = ({ type, sourceId, template, brandingRev, clientRev = '' }) => ({
  p_type: type, p_source: sourceId, p_template: template, p_branding: brandingRev, p_client_rev: clientRev || '',
})

/** Is the current revision stored? Returns { ok, state, cache_key, file, previous } or { ok:false, reason }. */
export function lookupPdf(req) {
  return rpc('pdf_cache_lookup', keyArgs(req), 'Could not check the stored report. Retry.')
}

/** Become the one generator for this revision (or be told who is, or get the ready file). */
export function claimPdf(req, { fileName, leaseSeconds = 180, retry = false } = {}) {
  return rpc('pdf_cache_claim', { ...keyArgs(req), p_file_name: fileName || null, p_lease_seconds: leaseSeconds, p_retry: !!retry },
    'Could not start preparing the report. Retry.')
}

export function heartbeatPdf(fileId, leaseSeconds = 180) {
  return rpc('pdf_cache_heartbeat', { p_file: fileId, p_lease_seconds: leaseSeconds }, 'Could not extend the report job.')
}

export function completePdf(fileId, { sha256, bytes }) {
  return rpc('pdf_cache_complete', { p_file: fileId, p_sha256: sha256, p_bytes: bytes }, 'Could not save the report. Retry.')
}

export function failPdf(fileId, { error = null, retryable = true, countAttempt = true } = {}) {
  return rpc('pdf_cache_fail', { p_file: fileId, p_error: error, p_retryable: retryable, p_count_attempt: countAttempt },
    'Could not record the failed report job.')
}

export function regeneratePdf(req, { fileName, reason = null, leaseSeconds = 180 } = {}) {
  return rpc('pdf_cache_regenerate', { ...keyArgs(req), p_file_name: fileName || null, p_reason: reason, p_lease_seconds: leaseSeconds },
    'Could not start regenerating the report. Retry.')
}

/** Audit only. Never blocks or fails a download. */
export function recordPdfDownload(fileId, via = 'single') {
  return rpc('pdf_cache_record_download', { p_file: fileId, p_via: via }, '').catch(() => null)
}

/** The company's stored-PDF settings and what the caller may do. null before the migration is applied. */
export async function getPdfSettings() {
  try {
    const s = await rpc('pdf_cache_settings', {}, '')
    return s?.ok ? s : null
  } catch { return null }
}

/** Administrator only. Pass only the settings to change. */
export function updatePdfSettings({ bulkLimit = null, retentionDays = null, managerRegenerate = null } = {}) {
  return rpc('pdf_cache_update_settings', { p_bulk_limit: bulkLimit, p_retention_days: retentionDays, p_manager_regenerate: managerRegenerate },
    'Could not save the stored PDF settings. Retry.')
}

/**
 * Ask the server before a bulk download: it enforces the company's limit and answers with
 * the records this account is authorised to see. Returns null when the server path is not
 * set up yet (the client-side limit then applies on its own).
 */
export async function requestBulkPdf(type, sourceIds) {
  try { return await rpc('pdf_cache_bulk_request', { p_type: type, p_sources: sourceIds }, 'Could not start the bulk download. Retry.') }
  catch (err) { if (isPdfCacheNotProvisioned(err)) return null; throw err }
}

/** Retention: working copies whose time is up (administrator; [] for everyone else). */
export async function listPdfPurgeDue(limit = 20) {
  try { return (await rpc('pdf_cache_purge_list', { p_limit: limit }, '')) || [] }
  catch { return [] }
}

/** Remove marked objects. The storage policy refuses anything that is not marked, or is approved. */
export async function removePdfObjects(paths) {
  const { data, error } = await supabase.storage.from(PDF_BUCKET).remove(paths)
  if (error) throw toServiceError(error, 'Could not remove the expired report copies.')
  return (data || []).map((o) => o.name)
}

export function confirmPdfPurge(fileId) {
  return rpc('pdf_cache_purge_confirm', { p_file: fileId }, '').catch(() => null)
}

/** Open requests left by the database trigger for the caller's scope. [] when the queue is not set up. */
export async function listPendingPdfRequests(type, limit = 3) {
  try { return (await rpc('pdf_cache_pending', { p_type: type, p_limit: limit }, '')) || [] }
  catch { return [] }
}

export function closePdfRequest(type, sourceId) {
  return rpc('pdf_cache_queue_done', { p_type: type, p_source: sourceId }, '').catch(() => null)
}

/** Upload the generated bytes to the job's own path. upsert covers an interrupted earlier attempt. */
export async function uploadPdf(path, blob) {
  const { error } = await supabase.storage.from(PDF_BUCKET)
    .upload(path, blob, { contentType: 'application/pdf', upsert: true, cacheControl: '31536000' })
  if (error) throw toServiceError(error, 'The report could not be saved to storage. Retry.')
}

/** Short-lived link to a stored file. `downloadName` makes the browser save it under that name. */
export async function signedPdfUrl(path, { downloadName = null, seconds = SIGNED_URL_SECONDS } = {}) {
  const { data, error } = await supabase.storage.from(PDF_BUCKET)
    .createSignedUrl(path, seconds, downloadName ? { download: downloadName } : undefined)
  if (error || !data?.signedUrl) throw toServiceError(error || new Error('no url'), 'The stored report could not be opened. Retry.')
  return data.signedUrl
}

/** The stored bytes (used by the bulk ZIP and by verified downloads). */
export async function downloadPdfBytes(path) {
  const { data, error } = await supabase.storage.from(PDF_BUCKET).download(path)
  if (error || !data) throw toServiceError(error || new Error('no data'), 'The stored report could not be downloaded. Retry.')
  return data
}

const VERSION_COLS = 'id,report_type,source_id,status,generation,file_name,bytes,sha256,storage_path,immutable,'
  + 'source_approved,superseded_at,completed_at,created_at,template_version,regenerated_from,regenerate_reason,created_by'

/** Stored revisions of one document, newest first (current and previous). RLS scopes the read. */
export async function listPdfVersions(type, sourceId) {
  const { data, error } = await supabase.from('report_pdf_files').select(VERSION_COLS)
    .eq('report_type', type).eq('source_id', sourceId).eq('status', 'ready').is('purged_at', null)
    .order('completed_at', { ascending: false }).limit(25)
  if (error) {
    if (isNotProvisioned(error)) return []
    throw toServiceError(error, 'Could not load the stored report versions.')
  }
  return data || []
}
