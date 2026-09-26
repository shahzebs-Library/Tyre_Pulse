/**
 * Pure helpers for the console Access Audit trail.
 *
 * Every row is { id, actor, actor_email, action, target_user, entity, before,
 * after, at }. Nothing here reads the network; the page owns loading.
 */

/** A readable scalar for one side of a diff. Empty reads N/A, never a dash. */
export function toScalar(v) {
  if (v === null || v === undefined || v === '') return 'N/A'
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'N/A'
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

/** Fields whose value differs between the before and after payloads. */
export function diffFields(before, after) {
  const b = before && typeof before === 'object' ? before : {}
  const a = after && typeof after === 'object' ? after : {}
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort()
  const rows = []
  for (const k of keys) {
    const from = toScalar(b[k])
    const to = toScalar(a[k])
    if (from !== to) rows.push({ key: k, from, to })
  }
  return rows
}

const KIND_RULES = [
  ['revoke', 'removal'], ['delete', 'removal'], ['remove', 'removal'],
  ['grant', 'grant'], ['create', 'grant'], ['insert', 'grant'],
  ['role', 'role'], ['country', 'scope'], ['site', 'scope'],
  ['update', 'change'],
]

/** One of grant | removal | role | scope | change | other. */
export function actionKind(action) {
  const a = String(action || '').toLowerCase()
  for (const [needle, kind] of KIND_RULES) if (a.includes(needle)) return kind
  return 'other'
}

export const KIND_TONE = { grant: 'good', removal: 'danger', role: 'accent', scope: 'info', change: 'warning', other: 'default' }

/** Headline numbers for the loaded window. */
export function summarizeAudit(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const actors = new Set()
  const targets = new Set()
  const byKind = { grant: 0, removal: 0, role: 0, scope: 0, change: 0, other: 0 }
  let latest = null
  for (const r of list) {
    if (r?.actor || r?.actor_email) actors.add(r.actor || r.actor_email)
    if (r?.target_user) targets.add(r.target_user)
    byKind[actionKind(r?.action)] += 1
    const t = r?.at ? Date.parse(r.at) : NaN
    if (Number.isFinite(t) && (latest === null || t > latest)) latest = t
  }
  return {
    total: list.length,
    actors: actors.size,
    targets: targets.size,
    byKind,
    latest: latest === null ? null : new Date(latest).toISOString(),
  }
}
