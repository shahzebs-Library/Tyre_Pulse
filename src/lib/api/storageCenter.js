/**
 * Storage service (console /console/storage). Pass-throughs over the
 * super-admin RPCs from migration 20260930191000. NOTHING here deletes a file:
 * saving a retention rule records it (not applied), the orphan scan only lists,
 * and duplicates are listed for review. Downloads use a short signed link.
 */
import { supabase, unwrap, toServiceError } from './_client'

export async function getStorageSummary() {
  return unwrap(await supabase.rpc('admin_storage_summary'))
}

export async function listBucketFiles(bucket, { prefix = null, search = null, limit = 100, offset = 0 } = {}) {
  return unwrap(await supabase.rpc('admin_storage_list', {
    p_bucket: bucket, p_prefix: prefix || null, p_search: search || null, p_limit: limit, p_offset: offset,
  }))
}

export async function listDuplicateFiles(bucket = null, limit = 300) {
  const data = unwrap(await supabase.rpc('admin_storage_duplicates', { p_bucket: bucket, p_limit: limit }))
  return Array.isArray(data) ? data : []
}

export async function previewRetention({ bucket, prefix = null, minBytes = null, olderThanDays }) {
  return unwrap(await supabase.rpc('admin_storage_retention_preview', {
    p_bucket: bucket, p_prefix: prefix || null, p_min_bytes: minBytes ?? null, p_older_than_days: olderThanDays,
  }))
}

export async function saveRetentionRule({ id = null, bucket, prefix = null, minBytes = null, olderThanDays, reason }) {
  return unwrap(await supabase.rpc('admin_save_storage_retention_rule', {
    p_id: id, p_bucket: bucket, p_prefix: prefix || null, p_min_bytes: minBytes ?? null,
    p_older_than_days: olderThanDays, p_reason: reason,
  }))
}

export async function removeRetentionRule(id, reason) {
  return unwrap(await supabase.rpc('admin_remove_storage_retention_rule', { p_id: id, p_reason: reason }))
}

export async function setBucketFileLimit(bucket, bytes, reason) {
  return unwrap(await supabase.rpc('admin_set_bucket_file_limit', { p_bucket: bucket, p_bytes: bytes, p_reason: reason }))
}

export async function runOrphanScan() {
  return unwrap(await supabase.rpc('admin_storage_orphan_scan'))
}

/** A 60-second signed link for one file. */
export async function signedFileLink(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60)
  if (error || !data?.signedUrl) throw toServiceError(error || new Error('no link'), 'This file could not be opened. You may not have read access to it.')
  return data.signedUrl
}
