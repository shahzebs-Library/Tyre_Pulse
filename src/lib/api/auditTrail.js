/**
 * Audit Trail service - the single Supabase boundary for the super-admin console
 * "Audit Trail" viewer (Module 6). Mirrors the sibling service modules
 * (systemLogs.js / dataReconciliation.js): explicit least-privilege column lists,
 * optional filters applied only when provided, and a guarded read that degrades
 * to an empty array so the page can render an honest empty/error state instead of
 * throwing.
 *
 * This is a READ-ONLY, unified viewer across three existing, independently-owned
 * audit tables. It never writes to them:
 *   - audit_log_v2   : row-level data changes (who changed what row, old vs new).
 *   - access_audit   : access-control / privileged changes (super-admin only RLS).
 *   - console_sessions: console admin actions (login, lock, config, etc.).
 *
 * Each source has a different natural schema; every list function normalises its
 * rows to ONE common shape via `normalizeRow` so the page renders a single table:
 *   { id, when, actor, action, target, detail, source, old, new }
 * (`old`/`new` are only populated for the data-change source so the page can show
 * a before/after diff; they are null elsewhere.)
 */
// The shared Supabase client. `unwrap` is intentionally not used: we hand-handle
// errors so a permission or missing-relation failure degrades to [] rather than
// throwing (this viewer is read-only and best-effort across three tables).
import { supabase as sb } from '../supabase'

/** The three unified audit sources, in display order. */
export const AUDIT_SOURCES = [
  { key: 'audit_log_v2', label: 'Data changes' },
  { key: 'access_audit', label: 'Access control' },
  { key: 'console_sessions', label: 'Console actions' },
]

/** Explicit least-privilege column lists (no SELECT *). */
export const DATA_AUDIT_COLS =
  'id,user_id,user_email,user_role,action,table_name,record_id,' +
  'old_values,new_values,ip_address,site,country,org_id,created_at'
export const ACCESS_AUDIT_COLS =
  'id,actor,actor_email,action,target_user,entity,before,after,at'
export const CONSOLE_AUDIT_COLS =
  'id,admin_id,action,target_id,target_type,details,created_at'

/** ilike wildcard pattern from a raw search value. */
function like(value) {
  return `%${String(value).trim()}%`
}

/** Join non-empty parts with a single space (used for the "target" column). */
function joinTarget(...parts) {
  return parts
    .filter((p) => p != null && String(p).trim() !== '')
    .map((p) => String(p).trim())
    .join(' ')
}

/**
 * Render a compact, human-readable one-line detail string for the table cell.
 * Objects are shown as "key: value" pairs; strings pass through; null becomes ''.
 */
function detailText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)
  try {
    const entries = Object.entries(value)
    if (entries.length === 0) return ''
    return entries
      .map(([k, v]) => `${k}: ${v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ')
  } catch {
    return ''
  }
}

/**
 * Normalise a raw row from any of the three sources into the common shape the
 * page renders. `source` selects the mapping. Unknown sources map defensively.
 *
 * @param {'audit_log_v2'|'access_audit'|'console_sessions'} source
 * @param {object} raw
 * @returns {{ id:(string|number), when:(string|null), actor:string, action:string,
 *            target:string, detail:string, source:string, old:(object|null),
 *            new:(object|null), role:(string|null) }}
 */
export function normalizeRow(source, raw) {
  const r = raw || {}
  if (source === 'audit_log_v2') {
    return {
      id: r.id,
      when: r.created_at || null,
      actor: r.user_email || r.user_id || '',
      action: r.action || '',
      target: joinTarget(r.table_name, r.record_id),
      detail: joinTarget(
        r.table_name ? `table ${r.table_name}` : '',
        r.record_id ? `record ${r.record_id}` : '',
        r.site ? `site ${r.site}` : '',
        r.country ? `country ${r.country}` : '',
      ),
      source: 'audit_log_v2',
      old: r.old_values ?? null,
      new: r.new_values ?? null,
      role: r.user_role || null,
    }
  }
  if (source === 'access_audit') {
    return {
      id: r.id,
      when: r.at || null,
      actor: r.actor_email || r.actor || '',
      action: r.action || '',
      target: joinTarget(r.target_user, r.entity),
      detail: joinTarget(
        r.entity ? `entity ${r.entity}` : '',
        r.target_user ? `target ${r.target_user}` : '',
      ),
      source: 'access_audit',
      old: r.before ?? null,
      new: r.after ?? null,
      role: null,
    }
  }
  if (source === 'console_sessions') {
    return {
      id: r.id,
      when: r.created_at || null,
      actor: r.admin_id || '',
      action: r.action || '',
      target: joinTarget(r.target_type, r.target_id),
      detail: detailText(r.details),
      source: 'console_sessions',
      old: null,
      new: null,
      role: null,
    }
  }
  // Defensive default for an unknown source.
  return {
    id: r.id,
    when: r.created_at || r.at || null,
    actor: r.actor || r.user_email || r.admin_id || '',
    action: r.action || '',
    target: '',
    detail: '',
    source: source || 'unknown',
    old: null,
    new: null,
    role: null,
  }
}

/**
 * List row-level data-change audit entries (audit_log_v2), newest first. All
 * filters are optional. Returns normalised rows, or [] on any read/permission/
 * missing-relation error so the viewer degrades gracefully.
 *
 * @param {object} [opts]
 * @param {string} [opts.action]  eq filter on action
 * @param {string} [opts.table]   ilike filter on table_name
 * @param {string} [opts.user]    ilike filter on user_email
 * @param {string} [opts.since]   ISO timestamp; created_at gte filter
 * @param {number} [opts.limit=200]
 * @returns {Promise<Array<object>>}
 */
export async function listDataAudit({ action, table, user, since, limit = 200 } = {}) {
  try {
    let q = sb.from('audit_log_v2').select(DATA_AUDIT_COLS)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (action) q = q.eq('action', action)
    if (table) q = q.ilike('table_name', like(table))
    if (user) q = q.ilike('user_email', like(user))
    if (since) q = q.gte('created_at', since)
    const { data, error } = await q
    if (error) return []
    return (Array.isArray(data) ? data : []).map((row) => normalizeRow('audit_log_v2', row))
  } catch {
    return []
  }
}

/**
 * List access-control audit entries (access_audit), newest first. Ordered by the
 * `at` column. All filters optional; []-degrades.
 *
 * @param {object} [opts]
 * @param {string} [opts.action]  eq filter on action
 * @param {string} [opts.target]  ilike filter on target_user
 * @param {string} [opts.since]   ISO timestamp; `at` gte filter
 * @param {number} [opts.limit=200]
 * @returns {Promise<Array<object>>}
 */
export async function listAccessAudit({ action, target, since, limit = 200 } = {}) {
  try {
    let q = sb.from('access_audit').select(ACCESS_AUDIT_COLS)
      .order('at', { ascending: false })
      .limit(limit)
    if (action) q = q.eq('action', action)
    if (target) q = q.ilike('target_user', like(target))
    if (since) q = q.gte('at', since)
    const { data, error } = await q
    if (error) return []
    return (Array.isArray(data) ? data : []).map((row) => normalizeRow('access_audit', row))
  } catch {
    return []
  }
}

/**
 * List console admin action entries (console_sessions), newest first. All filters
 * optional; []-degrades.
 *
 * @param {object} [opts]
 * @param {string} [opts.action]  eq filter on action
 * @param {string} [opts.since]   ISO timestamp; created_at gte filter
 * @param {number} [opts.limit=200]
 * @returns {Promise<Array<object>>}
 */
export async function listConsoleAudit({ action, since, limit = 200 } = {}) {
  try {
    let q = sb.from('console_sessions').select(CONSOLE_AUDIT_COLS)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (action) q = q.eq('action', action)
    if (since) q = q.gte('created_at', since)
    const { data, error } = await q
    if (error) return []
    return (Array.isArray(data) ? data : []).map((row) => normalizeRow('console_sessions', row))
  } catch {
    return []
  }
}

/** Dispatch to the right list function by source key. */
export function listAudit(sourceKey, opts) {
  if (sourceKey === 'access_audit') return listAccessAudit(opts)
  if (sourceKey === 'console_sessions') return listConsoleAudit(opts)
  return listDataAudit(opts)
}
