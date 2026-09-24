/**
 * Audit integrity service (tamper-evident daily seals + full audit export).
 * Super-admin only; every RPC refuses anyone else server-side (42501) and the
 * audit_seals table is readable by super admins only (RLS).
 */
import { supabase, unwrap, fetchAllPages } from './_client'
import { EXPORT_PAGE_SIZE, pageOffsets } from '../auditSeals'

const SEAL_COLS = 'id, source, day, row_count, digest, prev_digest, chain_digest, sealed_at'

/** Every seal row, ordered by source then day. Paged past the 1000-row cap. */
export async function listAuditSeals() {
  const { data, error } = await fetchAllPages(
    (from, to) => supabase.from('audit_seals').select(SEAL_COLS)
      .order('source').order('day').order('id').range(from, to),
    { max: 20000 },
  )
  if (error) unwrap({ data: null, error })
  return data || []
}

/** Recompute each sealed day of one source and check the chain. */
export async function verifyAuditSeals(source, from = null, to = null) {
  return unwrap(await supabase.rpc('admin_verify_audit_seals', {
    p_source: source, p_from: from || null, p_to: to || null,
  })) || []
}

export async function countAuditExport(source, from = null, to = null) {
  const n = unwrap(await supabase.rpc('admin_export_audit_count', {
    p_source: source, p_from: from || null, p_to: to || null,
  }))
  return Number(n) || 0
}

export async function exportAuditPage(source, from, to, limit = EXPORT_PAGE_SIZE, offset = 0) {
  return unwrap(await supabase.rpc('admin_export_audit', {
    p_source: source, p_from: from || null, p_to: to || null, p_limit: limit, p_offset: offset,
  })) || []
}

/**
 * Pull the full export in pages. Sequential on purpose: offset paging over an
 * ordered (ts, id) set is exact, and one page at a time keeps load on the
 * database predictable. onProgress(done, total) after each page.
 */
export async function exportAuditAll(source, from, to, total, onProgress) {
  const rows = []
  for (const offset of pageOffsets(total, EXPORT_PAGE_SIZE)) {
    const page = await exportAuditPage(source, from, to, EXPORT_PAGE_SIZE, offset)
    rows.push(...page)
    onProgress?.(rows.length, total)
    if (page.length < EXPORT_PAGE_SIZE) break
  }
  return rows
}
