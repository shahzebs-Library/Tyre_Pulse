/**
 * Tenant Data Export service. Super-admin only: every RPC refuses anyone who is
 * not a super admin (42501), and the table list is a server-side safelist.
 */
import { supabase, unwrap } from './_client'
import { toUserMessage } from '../safeError'
import { shapeManifest, PAGE_SIZE, parseCeiling, shapeRetentionStatus } from '../tenantExport'

export async function listExportOrganisations() {
  return unwrap(await supabase
    .from('organisations')
    .select('id, name, slug, active, country')
    .order('name', { ascending: true })) || []
}

export async function getExportManifest(orgId) {
  const raw = unwrap(await supabase.rpc('admin_tenant_export_manifest', { p_org: orgId }))
  return shapeManifest(raw)
}

export async function fetchExportPage(orgId, table, after = null, limit = PAGE_SIZE) {
  return unwrap(await supabase.rpc('admin_tenant_export_page', {
    p_org: orgId, p_table: table, p_after: after, p_limit: limit,
  })) || { rows: [], count: 0, done: true, next_after: null }
}

/**
 * Read one table by keyset until it is done or the ceiling is reached. Never
 * throws: a failure is returned as `error` with the rows read so far, so the
 * caller can report a PARTIAL table instead of pretending it is complete.
 */
export async function exportTableRows(orgId, table, { expected = null, ceiling, onProgress, isCancelled } = {}) {
  const cap = parseCeiling(ceiling)
  const rows = []
  let after = null
  try {
    for (;;) {
      if (isCancelled?.()) {
        return { table, expected, rows, complete: false, truncated: false, error: 'Cancelled' }
      }
      const want = Math.min(PAGE_SIZE, cap - rows.length)
      const page = await fetchExportPage(orgId, table, after, want)
      const got = Array.isArray(page?.rows) ? page.rows : []
      rows.push(...got)
      onProgress?.(rows.length)
      if (page?.done || !page?.next_after || got.length < want) {
        return { table, expected, rows, complete: true, truncated: false, error: null }
      }
      if (rows.length >= cap) {
        // At the ceiling: probe one more row so a table of exactly `cap` rows
        // is not falsely reported as truncated.
        const probe = await fetchExportPage(orgId, table, page.next_after, 1)
        const more = Array.isArray(probe?.rows) && probe.rows.length > 0
        return { table, expected, rows, complete: !more, truncated: more, error: null }
      }
      after = page.next_after
    }
  } catch (err) {
    return { table, expected, rows, complete: false, truncated: false, error: toUserMessage(err, 'The read failed') }
  }
}

export async function logTenantExport(orgId, reason, tables, counts, status) {
  return unwrap(await supabase.rpc('admin_tenant_export_log', {
    p_org: orgId,
    p_reason: reason,
    p_tables: tables,
    p_counts: { ...(counts || {}), _status: status || 'completed' },
  }))
}

export async function listExportJobs(limit = 25) {
  return unwrap(await supabase
    .from('tenant_export_jobs')
    .select('id, org_id, requested_by, reason, tables, status, row_counts, created_at, completed_at, mode, progress, files, error, started_at, updated_at, expired_at')
    .order('created_at', { ascending: false })
    .limit(limit)) || []
}

// ---------------------------------------------------------------------------
// Server export (edge function `tenant-export`). The function validates the
// caller is a super admin and every action is audited server-side.
// ---------------------------------------------------------------------------

/** Read the function's own JSON { error } so the user sees the real, sanitized reason. */
async function invokeTenantExport(body, fallback) {
  const { data, error } = await supabase.functions.invoke('tenant-export', { body })
  if (error) {
    let msg = null
    try {
      const res = error.context
      if (res && typeof res.json === 'function') msg = (await res.json())?.error || null
    } catch { /* keep the fallback */ }
    throw new Error(msg || toUserMessage(error, fallback))
  }
  if (data && data.ok === false) throw new Error(data.error || fallback)
  return data
}

export async function startServerExport(orgId, reason, tables = null) {
  const data = await invokeTenantExport(
    { action: 'start', org_id: orgId, reason, tables: tables && tables.length ? tables : null },
    'The server export could not be started.',
  )
  return data?.job_id || null
}

export async function resumeServerExport(jobId) {
  await invokeTenantExport({ action: 'resume', job_id: jobId }, 'The export could not be resumed.')
  return true
}

/** Short-lived signed links (the function audits the download first). */
export async function getServerExportLinks(jobId) {
  const data = await invokeTenantExport({ action: 'download', job_id: jobId }, 'The download could not be prepared.')
  return { expiresIn: data?.expires_in ?? null, files: Array.isArray(data?.files) ? data.files : [] }
}

export async function getExportJob(jobId) {
  return unwrap(await supabase
    .from('tenant_export_jobs')
    .select('id, org_id, reason, tables, status, mode, progress, files, row_counts, error, started_at, updated_at, created_at, completed_at')
    .eq('id', jobId)
    .maybeSingle())
}

// ---------------------------------------------------------------------------
// Retention: server export files are deleted after N days by a daily cron (and
// on demand). The deletion itself runs in the edge function via the Storage
// API; these RPCs are super-admin only and audited.
// ---------------------------------------------------------------------------

export async function getRetentionStatus() {
  return shapeRetentionStatus(unwrap(await supabase.rpc('admin_tenant_export_retention_status')))
}

export async function setRetentionDays(days) {
  return unwrap(await supabase.rpc('admin_tenant_export_set_retention', { p_days: Number(days) }))
}

/** Queue the same cleanup the daily cron runs. Returns { queued, due }. */
export async function purgeExpiredNow() {
  const r = unwrap(await supabase.rpc('admin_tenant_export_purge_now')) || {}
  return { queued: r.queued === true, due: Number(r.due) || 0 }
}
