/**
 * audit.js — client-side field-level audit service on top of the existing
 * `audit_log_v2` table (V15 / MASTER_MIGRATION).
 *
 * Every logAudit() call records WHO (user id + email + role + site), WHAT
 * (action + table + record id), and exactly WHICH fields changed with their
 * old and new values (jsonb `old_values` / `new_values`).
 *
 * Schema-drift tolerant: the live DB has a history of drifting from the
 * migration files (two audit_log_v2 variants exist: MASTER_MIGRATION uses
 * `old_values`/`new_values`+`session_id`, MIGRATIONS_SAFE uses
 * `old_data`/`new_data`+`site`). When PostgREST reports a missing column
 * (PGRST204 / 42703) we rename to the known alternate or drop the column and
 * retry, then remember the working shape for the rest of the session — so the
 * first insert self-calibrates and later inserts pay no extra round-trips.
 *
 * Fire-and-forget: an audit failure must NEVER break the user's save. Every
 * path is caught; the worst outcome is a console.warn.
 */
import { supabase } from './supabase'

const AUDIT_TABLE = 'audit_log_v2'
const SESSION_ID = (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** Known alternate column names between the two deployed schema variants. */
const COLUMN_RENAMES = {
  old_values: 'old_data',
  new_values: 'new_data',
  old_data: null, // if the alternate is missing too, drop the value
  new_data: null,
}

// Session-scoped adaptation state: how to rewrite payload keys for the live
// table. Values: undefined (as-is), a string (rename to), or null (drop).
const columnPlan = Object.create(null)

/**
 * Pure field-level diff between two records.
 * Returns `{ field: { from, to } }` for every field whose value changed —
 * unchanged fields, fields undefined on both sides, and fields the `after`
 * patch does not touch (undefined in `after`) are ignored. Objects/arrays are
 * compared structurally (JSON), primitives strictly.
 *
 * @param {object|null|undefined} before
 * @param {object|null|undefined} after
 * @returns {Record<string, { from: any, to: any }>}
 */
export function diffRecords(before, after) {
  const a = before && typeof before === 'object' ? before : {}
  const b = after && typeof after === 'object' ? after : {}
  const changes = {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const oldVal = a[key]
    const newVal = b[key]
    // A patch that doesn't mention a field is not a change to it.
    if (newVal === undefined) continue
    if (oldVal === undefined && newVal === null) continue
    if (isEqual(oldVal, newVal)) continue
    changes[key] = { from: oldVal === undefined ? null : oldVal, to: newVal }
  }
  return changes
}

function isEqual(x, y) {
  if (Object.is(x, y)) return true
  if (x === null || y === null) return false
  if (typeof x === 'object' && typeof y === 'object') {
    try { return JSON.stringify(x) === JSON.stringify(y) } catch { return false }
  }
  // Tolerate number/string representation drift ("5000" vs 5000) from form inputs.
  if ((typeof x === 'number' || typeof y === 'number') && String(x) === String(y)) return true
  return false
}

/**
 * Pure payload builder (exported for tests). Maps a logAudit() call + actor
 * into the audit_log_v2 row shape:
 *  - UPDATE: old_values/new_values hold ONLY the changed fields (old→new)
 *  - CREATE: new_values holds the full record
 *  - DELETE: old_values holds the full removed record
 *  - meta rides inside new_values._meta (no dedicated column needed)
 * Returns null when there is nothing worth writing (a no-op update).
 */
export function buildAuditPayload({ action, entity, entityId, before, after, meta }, actor) {
  const act = String(action || 'UPDATE').toUpperCase()
  const changes = diffRecords(before, after)
  const changedKeys = Object.keys(changes)

  let oldValues = null
  let newValues = null
  if (act === 'DELETE') {
    oldValues = before ?? null
  } else if (act === 'CREATE') {
    newValues = after ?? null
  } else {
    if (before !== undefined && before !== null && changedKeys.length === 0 && !meta) return null // no-op update: nothing to record
    if (changedKeys.length > 0) {
      oldValues = {}
      newValues = {}
      for (const k of changedKeys) {
        oldValues[k] = changes[k].from
        newValues[k] = changes[k].to
      }
    } else if (after) {
      // No before snapshot available — record the patch itself.
      newValues = { ...after }
    }
  }
  if (meta && Object.keys(meta).length > 0) {
    newValues = { ...(newValues || {}), _meta: meta }
  }

  return {
    user_id: actor?.id ?? null,
    user_email: actor?.email ?? null,
    user_role: actor?.role ?? null,
    site: actor?.site ?? null,
    action: act,
    table_name: entity ?? null,
    record_id: entityId == null ? null : String(entityId),
    old_values: oldValues,
    new_values: newValues,
    session_id: SESSION_ID,
  }
}

// ── Actor resolution (session user + profile role/site), cached per user ─────
let actorCache = null

async function getActor() {
  try {
    const { data } = await supabase.auth.getUser()
    const user = data?.user
    if (!user) return null
    if (actorCache?.id === user.id) return actorCache
    let role = null
    let site = null
    try {
      const res = await supabase.from('profiles').select('role, site').eq('id', user.id).maybeSingle()
      if (res.error) {
        // `site` may not exist on profiles in every environment — retry role only.
        const retry = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
        role = retry.data?.role ?? null
      } else {
        role = res.data?.role ?? null
        site = res.data?.site ?? null
      }
    } catch { /* profile lookup is best-effort */ }
    actorCache = { id: user.id, email: user.email ?? null, role, site }
    return actorCache
  } catch {
    return null
  }
}

// ── Drift-tolerant insert ─────────────────────────────────────────────────────
function applyColumnPlan(row) {
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    const plan = columnPlan[key]
    if (plan === null) continue          // known-missing everywhere: drop
    if (typeof plan === 'string') out[plan] = value // known rename
    else out[key] = value
  }
  return out
}

function missingColumnFrom(error) {
  if (!error) return null
  const missing = error.code === 'PGRST204' || error.code === '42703' ||
    /column .* does not exist|could not find the '.*' column/i.test(error.message || '')
  if (!missing) return null
  const m = /'([A-Za-z0-9_]+)' column|column "?([A-Za-z0-9_]+)"?/i.exec(error.message || '')
  return m ? (m[1] || m[2]) : null
}

async function insertAdaptive(row) {
  // At most one attempt per payload column, so a badly drifted table can never loop.
  const maxAttempts = Object.keys(row).length + 1
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const payload = applyColumnPlan(row)
    if (!payload.action) return // core column got dropped: give up quietly
    const { error } = await supabase.from(AUDIT_TABLE).insert(payload)
    if (!error) return
    const col = missingColumnFrom(error)
    if (!col) throw error
    // Find which ORIGINAL key produced this live column name, then rename/drop it.
    const originalKey = Object.keys(row).find((k) => {
      const plan = columnPlan[k]
      return (typeof plan === 'string' ? plan : k) === col
    }) ?? col
    const alternate = COLUMN_RENAMES[col]
    columnPlan[originalKey] = alternate !== undefined ? alternate : null
  }
}

/**
 * Record one audited change. Never throws, never blocks the caller's save —
 * call it without await (or await it; it resolves either way).
 *
 * @param {object} entry
 * @param {string} entry.action    CREATE | UPDATE | DELETE | APPROVE | REJECT | REVERSE | ...
 * @param {string} entry.entity    live table / entity name (e.g. 'work_orders')
 * @param {string|number} [entry.entityId]  primary key / natural key of the record
 * @param {object|null} [entry.before]      snapshot before the change
 * @param {object|null} [entry.after]       snapshot / patch after the change
 * @param {object} [entry.meta]             extra context (counts, batch ids, ...)
 * @returns {Promise<void>}
 */
export async function logAudit(entry) {
  try {
    const actor = await getActor()
    if (!actor) return // no session — nothing to attribute, skip like auditLogger does
    const payload = buildAuditPayload(entry, actor)
    if (!payload) return
    await insertAdaptive(payload)
  } catch (err) {
    console.warn('[audit] logAudit failed (non-blocking):', err?.message || err)
  }
}
