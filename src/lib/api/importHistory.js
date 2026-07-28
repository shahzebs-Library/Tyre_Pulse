/**
 * importHistory.js — client boundary for Console -> Import History (V364).
 *
 * Surfaces two things that were previously invisible:
 *
 *  1. LOGGED imports. `import_files` / `import_batches` already recorded every
 *     in-app upload, including a sha256 of the file content, and already had a
 *     `duplicate_rows` column. Nothing ever displayed it or acted on it, so a file
 *     uploaded twice produced no warning at all.
 *
 *  2. UNLOGGED imports. The Supabase Table Editor path writes NO batch row, so
 *     those loads left no trace whatsoever - which is why a re-run of the expense
 *     grid went unnoticed until the totals were wrong. `admin_unlogged_imports`
 *     reconstructs them from insertion-time clusters on the destination table, and
 *     `flagSuspiciousClusters` below marks the tell-tale pattern: two clusters of
 *     the SAME row count close together in time, which is a resent chunk.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

/** Logged uploads, newest first, each flagged if the same file content came before. */
export async function listImportHistory(limit = 100) {
  const { data, error } = await supabase.rpc('admin_import_history', { p_limit: limit })
  if (error) throw new Error(toUserMessage(error, 'Could not load import history.'))
  return Array.isArray(data) ? data : []
}

/** Insertion-time clusters on a destination table, including loads that were never logged. */
export async function listUnloggedImports(key = 'parts_expense', limit = 60) {
  const { data, error } = await supabase.rpc('admin_unlogged_imports', {
    p_key: key,
    p_limit: limit,
  })
  if (error) throw new Error(toUserMessage(error, 'Could not load import activity.'))
  return Array.isArray(data) ? data : []
}

/**
 * Has this exact file content been imported before? Call before committing an
 * upload so the user is told rather than silently double-loading.
 * @param {string} sha256 hex digest of the file bytes
 * @returns {Promise<{seen:boolean, filename?:string, imported_at?:string, module?:string, imported_rows?:number}>}
 */
export async function checkImportFingerprint(sha256) {
  const { data, error } = await supabase.rpc('admin_check_import_fingerprint', {
    p_sha256: sha256,
  })
  // A missing RPC must not block an import; fall back to "not seen before".
  if (error) return { seen: false }
  return data || { seen: false }
}

/**
 * Pure: hex sha256 of a File/Blob/ArrayBuffer, using the browser's own crypto.
 * Returns null when SubtleCrypto is unavailable (non-secure context) so callers
 * degrade to no fingerprint rather than throwing.
 * @param {File|Blob|ArrayBuffer} file
 * @returns {Promise<string|null>}
 */
export async function fileSha256(file) {
  try {
    if (!file || typeof globalThis.crypto?.subtle?.digest !== 'function') return null
    const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}

/** How close two clusters must be to read as one interrupted upload. */
export const CLUSTER_WINDOW_SECONDS = 600

/**
 * Pure: mark clusters that look like a resent chunk.
 *
 * The signature, measured on the live duplicates: two inserts of the SAME row
 * count, for the same country, within a few minutes of each other. A genuine
 * second upload of different data almost never matches row-for-row.
 *
 * @param {Array<{country:string, inserted_at:string, rows:number}>} clusters
 * @param {number} windowSeconds
 * @returns {Array<object>} same rows plus {suspicious:boolean, pairedWith:string|null}
 */
export function flagSuspiciousClusters(clusters, windowSeconds = CLUSTER_WINDOW_SECONDS) {
  const rows = (clusters || []).filter((c) => c && c.inserted_at)
  const withTime = rows.map((c) => ({
    ...c,
    _t: new Date(c.inserted_at).getTime(),
    rows: Number(c.rows) || 0,
  }))

  return withTime.map((c) => {
    const twin = withTime.find((o) => (
      o !== c
      && o.rows === c.rows
      && o.rows > 0
      && (o.country || null) === (c.country || null)
      && Number.isFinite(o._t) && Number.isFinite(c._t)
      && Math.abs(o._t - c._t) <= windowSeconds * 1000
    ))
    const { _t, ...rest } = c
    return { ...rest, suspicious: Boolean(twin), pairedWith: twin ? twin.inserted_at : null }
  })
}

/**
 * Pure: what actually happened to an upload, in one line.
 *
 * "0 imported" was the single most confusing thing on this page, because it
 * means three completely different things and the old summary said the same
 * words for all of them:
 *
 *   staged / draft   the file was uploaded and previewed but never approved, so
 *                    nothing was ever written. NOT finished - the commonest case
 *                    by far, and the one people read as "it failed".
 *   reversed         it WAS imported and then deliberately undone. 0 is correct.
 *   committed with 0 it ran, and every row was rejected or skipped.
 *
 * @param {object} r row from listImportHistory
 * @returns {string}
 */
export function importRowSummary(r) {
  if (!r) return ''
  const total = Number(r.total_rows) || 0
  const done = Number(r.imported_rows) || 0
  const status = String(r.import_status || '').toLowerCase()
  const approval = String(r.approval_status || '').toLowerCase()

  if (done && total && done < total) return `${done.toLocaleString()} of ${total.toLocaleString()} rows imported`
  if (done) return `${done.toLocaleString()} rows imported`

  // From here everything imported nothing, so say WHY rather than repeating 0.
  if (status === 'reversed') {
    return total
      ? `Imported then undone, ${total.toLocaleString()} rows removed again`
      : 'Imported then undone'
  }
  if (status === 'staged' || approval === 'draft' || approval === 'pending') {
    return total
      ? `Not imported: ${total.toLocaleString()} rows are waiting for approval`
      : 'Not imported: uploaded but never approved'
  }
  if (status === 'committed') {
    return total
      ? `Finished, but none of the ${total.toLocaleString()} rows could be imported`
      : 'Finished with nothing to import'
  }
  if (!total) return 'No rows recorded'
  return `${total.toLocaleString()} rows read, none imported`
}

/**
 * Pure: is this upload actually done? Drives the badge beside the summary, so a
 * half-finished draft cannot look the same as a completed load.
 * @returns {'done'|'undone'|'unfinished'|'nothing'|'unknown'}
 */
export function importRowOutcome(r) {
  if (!r) return 'unknown'
  const done = Number(r.imported_rows) || 0
  const status = String(r.import_status || '').toLowerCase()
  const approval = String(r.approval_status || '').toLowerCase()
  if (done > 0) return 'done'
  if (status === 'reversed') return 'undone'
  if (status === 'staged' || approval === 'draft' || approval === 'pending') return 'unfinished'
  if (status === 'committed') return 'nothing'
  return 'unknown'
}

/** Label and tone for each outcome, so the two never drift apart. */
export const OUTCOME_META = Object.freeze({
  done: { label: 'Imported', tone: 'good' },
  undone: { label: 'Undone', tone: 'info' },
  unfinished: { label: 'Never approved', tone: 'warning' },
  nothing: { label: 'Nothing imported', tone: 'danger' },
  unknown: { label: 'Unknown', tone: 'quiet' },
})
