/**
 * duplicateControl.js — client boundary for Console -> Duplicate Control (V362).
 *
 * Finds, prices, deletes and UNDOES duplicate rows created by re-run imports.
 * All the real work is behind self-gating SECURITY DEFINER RPCs that resolve the
 * table and its business-key columns from a fixed server-side safelist, so there
 * is no injection surface and no way to point this at an unlisted table.
 *
 * THE RULE THIS SURFACES (see MIGRATIONS_V362 for the evidence): a repeated
 * business key is NOT automatically a duplicate. Groups whose rows carry more
 * than one distinct `source_row` are GENUINE repeated lines in the customer's
 * source file and the server refuses to delete them. The UI must show that
 * protected count rather than hide it, so nobody assumes "0 deletable" means
 * "nothing found".
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

/** Every scannable target: {key, tbl, label, kind, has_source_row}. */
export async function listDuplicateTargets() {
  const { data, error } = await supabase.rpc('admin_dup_targets')
  if (error) throw new Error(toUserMessage(error, 'Could not load duplicate targets.'))
  return Array.isArray(data) ? data : []
}

/**
 * Counts + money for one target, without changing anything.
 * @returns {Promise<{groups_total:number, groups_deletable:number, groups_protected:number,
 *                    extra_deletable:number, extra_protected:number, money_deletable:number,
 *                    key:string, tbl:string, label:string, money_col:string|null}>}
 */
export async function previewDuplicates(key, country = null) {
  const { data, error } = await supabase.rpc('admin_dup_preview', {
    p_key: key,
    p_country: country || null,
  })
  if (error) throw new Error(toUserMessage(error, 'Could not preview duplicates.'))
  return data || {}
}

/** The individual duplicate groups, newest/worst first, so a human can eyeball them. */
export async function scanDuplicates(key, country = null, limit = 200) {
  const { data, error } = await supabase.rpc('admin_dup_scan', {
    p_key: key,
    p_country: country || null,
    p_limit: limit,
  })
  if (error) throw new Error(toUserMessage(error, 'Could not scan for duplicates.'))
  return Array.isArray(data) ? data : []
}

/**
 * Delete the extra copies, keeping the earliest row of each group. Archives every
 * deleted row first, so `restoreDuplicateBatch(batch_id)` is a complete undo.
 * @returns {Promise<{ok:boolean, batch_id:string, deleted:number, tbl:string}>}
 */
export async function resolveDuplicates(key, country = null, reason = null) {
  const { data, error } = await supabase.rpc('admin_dup_resolve', {
    p_key: key,
    p_country: country || null,
    p_reason: reason || null,
  })
  if (error) throw new Error(toUserMessage(error, 'Could not remove the duplicates.'))
  return data || { ok: false, deleted: 0 }
}

/** Put a previously deleted batch back, exactly as it was. */
export async function restoreDuplicateBatch(batchId) {
  const { data, error } = await supabase.rpc('admin_dup_restore', { p_batch_id: batchId })
  if (error) throw new Error(toUserMessage(error, 'Could not restore that batch.'))
  return data || { ok: false, restored: 0 }
}

/** Past delete batches, so every removal stays visible and undoable. */
export async function listDuplicateBatches(limit = 50) {
  const { data, error } = await supabase
    .from('dup_resolve_archive')
    .select('batch_id, target_key, tbl, country, reason, created_at, restored_at')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit) || 50, 2000)))
  // The table only exists from V362 onward; degrade quietly rather than break the page.
  if (error) return []
  return groupBatches(Array.isArray(data) ? data : [])
}

/**
 * Pure: collapse archive rows into one entry per delete batch.
 * @param {Array<object>} rows
 * @returns {Array<{batch_id:string, target_key:string, tbl:string, country:string|null,
 *                  reason:string|null, created_at:string, rows:number, restored:boolean}>}
 */
export function groupBatches(rows) {
  const byBatch = new Map()
  for (const r of rows || []) {
    if (!r || !r.batch_id) continue
    const cur = byBatch.get(r.batch_id)
    if (cur) {
      cur.rows += 1
      // A batch counts as restored only when every archived row went back.
      if (!r.restored_at) cur.restored = false
      continue
    }
    byBatch.set(r.batch_id, {
      batch_id: r.batch_id,
      target_key: r.target_key,
      tbl: r.tbl,
      country: r.country || null,
      reason: r.reason || null,
      created_at: r.created_at,
      rows: 1,
      restored: Boolean(r.restored_at),
    })
  }
  return Array.from(byBatch.values())
}

/**
 * Pure: a plain-English verdict line for a preview result. Deliberately explicit
 * about protected rows, so "nothing to delete" never reads as "nothing found".
 * @param {object} p preview payload
 * @returns {string}
 */
export function previewSummary(p) {
  if (!p || !p.groups_total) return 'No repeated rows found.'
  const del = Number(p.extra_deletable) || 0
  const prot = Number(p.extra_protected) || 0
  const parts = []
  if (del) parts.push(`${del.toLocaleString()} extra row(s) can be removed`)
  if (prot) parts.push(`${prot.toLocaleString()} row(s) are genuine repeats and are protected`)
  if (!parts.length) return 'No repeated rows found.'
  return parts.join('; ') + '.'
}
