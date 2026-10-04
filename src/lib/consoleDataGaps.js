/**
 * Pure shapers for values the console now reads instead of saying "Not recorded".
 *   orgStorageMap   admin_org_storage() payload -> { byOrg, unattributed, total }
 *   signinSummary   admin_user_signin_facts() payload -> plain-English lines
 *   defaultsDiff    system_config rows vs the app's code defaults (CONFIG_DEFAULTS)
 * Every function returns null rather than a fake 0 when its input is missing.
 */

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function orgStorageMap(payload) {
  if (!payload || typeof payload !== 'object') return null
  const byOrg = {}
  for (const o of Array.isArray(payload.orgs) ? payload.orgs : []) {
    if (!o?.org_id) continue
    byOrg[o.org_id] = { files: num(o.files), bytes: num(o.bytes), byBucket: o.by_bucket || {} }
  }
  return {
    byOrg,
    unattributed: { files: num(payload.unattributed_files), bytes: num(payload.unattributed_bytes) },
    total: { files: num(payload.total_files), bytes: num(payload.total_bytes) },
  }
}

/** Storage for one org: a known org with no files is a real 0, an unread map is null. */
export function storageFor(map, orgId) {
  if (!map) return null
  return map.byOrg[orgId] || { files: 0, bytes: 0, byBucket: {} }
}

export function signinSummary(facts, fmtDate = (d) => String(d)) {
  if (!facts || typeof facts !== 'object') return null
  const b = facts.failed_burst
  let failed
  if (!b) failed = 'None on the lockout counter. Only the latest failed burst is kept, so older failures are not stored.'
  else {
    const n = num(b.attempts)
    failed = `${n == null ? 'N/A' : n} in the last burst (started ${fmtDate(b.started_at)})${b.locked_now ? ', locked now' : b.locked_until ? `, was locked until ${fmtDate(b.locked_until)}` : ''}. Older bursts are not kept.`
  }
  const l30 = num(facts.logins_30d)
  const all = num(facts.logins_all)
  return {
    failed,
    logins: l30 == null ? 'N/A' : `${l30} in 30 days${all == null ? '' : `, ${all} since ${facts.first_login_logged ? fmtDate(facts.first_login_logged) : 'the sign-in log began'}`}`,
    mfaChecks: num(facts.mfa_checks_30d),
  }
}

/**
 * Compare stored settings with the code defaults the app falls back to.
 * parse: the systemConfig parser. Returns { withDefault, changed, changedKeys }.
 * Settings with no code default are not counted (there is nothing to compare).
 */
export function defaultsDiff(rows, defaults, parse) {
  if (!Array.isArray(rows) || !defaults) return null
  const changedKeys = []
  let withDefault = 0
  for (const r of rows) {
    if (!r || !Object.prototype.hasOwnProperty.call(defaults, r.key)) continue
    withDefault += 1
    const v = parse ? parse(r.value) : r.value
    if (v === null || v === '') continue
    if (String(v) !== String(defaults[r.key])) changedKeys.push(r.key)
  }
  return { withDefault, changed: changedKeys.length, changedKeys }
}

export function defaultLabel(value) {
  if (value === true) return 'On'
  if (value === false) return 'Off'
  return String(value)
}
