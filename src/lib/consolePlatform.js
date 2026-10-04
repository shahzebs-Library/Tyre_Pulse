/**
 * consolePlatform - pure helpers behind the Control Center PLATFORM screens
 * (Users, User detail, Organizations, Billing, Settings). No I/O here: the
 * service layer is src/lib/api/consolePlatform.js.
 *
 * Honesty rules shared by every screen:
 *  - A value we could not measure is null and renders "N/A" with the reason,
 *    never a flattering 0.
 *  - Names are shortened and emails masked in lists.
 *  - Money is never added across currencies.
 */
import { compareVersions } from './mobileOps'

/* ── names, emails, time ─────────────────────────────────────────────────── */

/** a***@x.com. Null when there is no usable address. */
export function maskEmail(email) {
  const s = String(email ?? '').trim()
  const at = s.indexOf('@')
  if (at < 1) return null
  return `${s[0]}***${s.slice(at)}`
}

/** "Bassam Tariq Khan" -> "Bassam T." ; one word stays as is. */
export function shortName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'No name'
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

export function initials(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const a = parts[0][0] || ''
  const b = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || '')
  return `${a}${b}`.toUpperCase()
}

const RIYADH = 'Asia/Riyadh'

/** "29 Sep 12:21" in Riyadh time; null for blank / invalid. */
export function fmtRiyadh(ts, { date = true, time = true, year = false } = {}) {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  const opts = { timeZone: RIYADH }
  if (date) { opts.day = 'numeric'; opts.month = 'short'; if (year) opts.year = 'numeric' }
  if (time) { opts.hour = '2-digit'; opts.minute = '2-digit'; opts.hour12 = false }
  try {
    return new Intl.DateTimeFormat('en-GB', opts).format(d).replace(',', '')
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

/** Riyadh calendar date "YYYY-MM-DD" of a timestamp. */
export function riyadhDay(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: RIYADH, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  } catch { return d.toISOString().slice(0, 10) }
}

const DAY = 86400000

/**
 * Exclusive sign-in bucket for the distribution chart:
 * today (same Riyadh date) | week (within 7 days) | month (within 30) | earlier | never.
 */
export function signInBucket(ts, now = Date.now()) {
  if (!ts) return 'never'
  const t = Date.parse(ts)
  if (!Number.isFinite(t)) return 'never'
  if (riyadhDay(t) === riyadhDay(now)) return 'today'
  const age = now - t
  if (age <= 7 * DAY) return 'week'
  if (age <= 30 * DAY) return 'month'
  return 'earlier'
}

/** Cumulative sign-in facet test: today | 7d | 30d | over30 | never. */
export function matchesSignInFacet(ts, facet, now = Date.now()) {
  const b = signInBucket(ts, now)
  switch (facet) {
    case 'today': return b === 'today'
    case '7d': return b === 'today' || b === 'week'
    case '30d': return b === 'today' || b === 'week' || b === 'month'
    case 'over30': return b === 'earlier'
    case 'never': return b === 'never'
    default: return true
  }
}

/* ── people ──────────────────────────────────────────────────────────────── */

export function personStatus(p) {
  if (p?.locked) return 'locked'
  if (p?.approved === false) return 'pending'
  return 'active'
}

export function countriesOf(p) {
  const raw = p?.country ?? p?.countries
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : [])
  return list.map((c) => String(c).trim()).filter(Boolean)
}

export function countryLabel(p) {
  if (p?.is_super_admin || p?.role === 'Admin') {
    const c = countriesOf(p)
    return c.length ? c.join(', ') : 'All countries'
  }
  const c = countriesOf(p)
  if (!c.length) return 'No country'
  if (c.length >= 3) return c.slice(0, -1).join(', ') + ' and ' + c[c.length - 1]
  return c.join(', ')
}

export function sitesLabel(p) {
  const s = Array.isArray(p?.sites) ? p.sites.filter(Boolean) : []
  if (!s.length) return p?.site ? p.site : 'no sites'
  if (s.some((x) => String(x).toUpperCase() === 'ALL' || x === '*')) return 'all sites'
  if (s.length <= 2) return s.join(', ')
  return `${s.length} sites`
}

/** Merge profile rows with the directory signals keyed by id. */
export function mergePeople(profiles = [], directory = []) {
  const byId = new Map((directory || []).map((d) => [d.id, d]))
  return (profiles || []).map((p) => {
    const d = byId.get(p.id) || null
    return {
      ...p,
      signals: d,
      last_sign_in_at: d ? d.last_sign_in_at : null,
      status: personStatus(p),
    }
  })
}

/**
 * Problems cell for one person. Returns { label, tone, score } where score
 * sorts people with the most to fix first. `signals` null = not measured.
 */
export function problemSummary(signals) {
  if (!signals) return { label: 'N/A', tone: 'muted', score: -1, parts: [] }
  const parts = []
  if (signals.returned_unopened > 0) parts.push({ key: 'returned', label: `${signals.returned_unopened} unopened`, tone: 'danger', n: signals.returned_unopened })
  if (signals.web_errors_30d > 0) parts.push({ key: 'errors', label: `${signals.web_errors_30d} errors`, tone: 'warning', n: signals.web_errors_30d })
  if (signals.issues_open > 0) parts.push({ key: 'issues', label: `${signals.issues_open} reported`, tone: 'accent', n: signals.issues_open })
  if (!parts.length) return { label: 'None', tone: 'muted', score: 0, parts }
  const score = parts.reduce((a, p) => a + p.n, 0)
  return { label: parts.map((p) => p.label).join(', '), tone: parts[0].tone, score, parts }
}

export function isBelowMinimum(version, minVersion) {
  if (!version || !minVersion) return false
  return compareVersions(version, minVersion) < 0
}

/** Headline numbers for the Users screen. Null = the directory could not be read. */
export function userKpis(people = [], { directoryOk = true, orgCount = null, now = Date.now(), minVersion = null } = {}) {
  const total = people.length
  const has = (fn) => (directoryOk ? people.filter(fn).length : null)
  const signed30 = has((p) => matchesSignInFacet(p.last_sign_in_at, '30d', now))
  const signed7 = has((p) => matchesSignInFacet(p.last_sign_in_at, '7d', now))
  const today = has((p) => matchesSignInFacet(p.last_sign_in_at, 'today', now))
  const never = has((p) => !p.last_sign_in_at)
  const admins = people.filter((p) => p.is_super_admin || p.role === 'Admin')
  const adminsMfa = directoryOk ? admins.filter((p) => p.signals?.mfa).length : null
  const othersMfa = directoryOk ? people.filter((p) => !(p.is_super_admin || p.role === 'Admin') && p.signals?.mfa).length : null
  const withPhone = directoryOk ? people.filter((p) => (p.signals?.phones || 0) > 0) : []
  const versionCounts = {}
  for (const p of withPhone) {
    const v = p.signals?.app_version || 'unknown'
    versionCounts[v] = (versionCounts[v] || 0) + (p.signals?.phones || 0)
  }
  const phones = directoryOk ? withPhone.reduce((a, p) => a + (p.signals?.phones || 0), 0) : null
  const belowMin = directoryOk && minVersion
    ? withPhone.filter((p) => isBelowMinimum(p.signals?.app_version, minVersion))
    : []
  const joined30 = people.filter((p) => p.created_at && now - Date.parse(p.created_at) <= 30 * DAY).length
  return {
    total,
    orgCount,
    joined30,
    signed30, signed7, today,
    never,
    neverPct: never == null || !total ? null : Math.round((never / total) * 100),
    signed30Pct: signed30 == null || !total ? null : Math.round((signed30 / total) * 100),
    pending: people.filter((p) => p.status === 'pending').length,
    locked: people.filter((p) => p.status === 'locked').length,
    phones,
    versionCounts,
    belowMin: belowMin.length,
    belowMinPeople: belowMin,
    admins: admins.length,
    adminsMfa,
    othersMfa,
  }
}

/** Exclusive distribution for the "When people last signed in" chart. */
export function signInDistribution(people = [], now = Date.now()) {
  const out = { today: 0, week: 0, month: 0, earlier: 0, never: 0 }
  for (const p of people) out[signInBucket(p.last_sign_in_at, now)] += 1
  return out
}

/** Facet counts shown next to each filter option. */
export function facetCounts(people = [], now = Date.now(), minVersion = null) {
  const roles = {}; const countries = {}; const versions = {}
  let noPhone = 0
  for (const p of people) {
    roles[p.role || 'No role'] = (roles[p.role || 'No role'] || 0) + 1
    const cs = countriesOf(p)
    const key = (p.is_super_admin || p.role === 'Admin') && !cs.length ? 'All (admins)' : (cs.length ? cs.join(', ') : 'No country')
    countries[key] = (countries[key] || 0) + 1
    if (p.signals && (p.signals.phones || 0) > 0) {
      const v = p.signals.app_version || 'unknown'
      versions[v] = (versions[v] || 0) + 1
    } else if (p.signals) noPhone += 1
  }
  const signIn = {
    today: people.filter((p) => matchesSignInFacet(p.last_sign_in_at, 'today', now)).length,
    '7d': people.filter((p) => matchesSignInFacet(p.last_sign_in_at, '7d', now)).length,
    '30d': people.filter((p) => matchesSignInFacet(p.last_sign_in_at, '30d', now)).length,
    over30: people.filter((p) => matchesSignInFacet(p.last_sign_in_at, 'over30', now)).length,
    never: people.filter((p) => !p.last_sign_in_at).length,
  }
  const status = {
    active: people.filter((p) => p.status === 'active').length,
    pending: people.filter((p) => p.status === 'pending').length,
    locked: people.filter((p) => p.status === 'locked').length,
  }
  const versionRows = Object.entries(versions)
    .map(([v, n]) => ({ v, n, below: isBelowMinimum(v, minVersion) }))
    .sort((a, b) => compareVersions(b.v, a.v))
  return { roles, countries, signIn, status, versions: versionRows, noPhone }
}

/**
 * Apply the Users facets. `f` = { search, roles:Set, signIn, countries:Set,
 * status, version, attention }. Every facet is optional.
 */
export function filterPeople(people = [], f = {}, now = Date.now(), minVersion = null) {
  const q = String(f.search || '').trim().toLowerCase()
  return people.filter((p) => {
    if (q) {
      const hay = `${p.full_name || ''} ${p.username || ''} ${p.employee_id || ''} ${p.role || ''} ${p.site || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (f.roles && f.roles.size && !f.roles.has(p.role || 'No role')) return false
    if (f.signIn && !matchesSignInFacet(p.last_sign_in_at, f.signIn, now)) return false
    if (f.countries && f.countries.size) {
      const cs = countriesOf(p)
      const key = (p.is_super_admin || p.role === 'Admin') && !cs.length ? 'All (admins)' : (cs.length ? cs.join(', ') : 'No country')
      if (!f.countries.has(key)) return false
    }
    if (f.status && p.status !== f.status) return false
    if (f.version) {
      if (f.version === '__none') { if (!p.signals || (p.signals.phones || 0) > 0) return false }
      else if (p.signals?.app_version !== f.version || !(p.signals?.phones > 0)) return false
    }
    if (f.attention === 'returned' && !(p.signals?.returned_unopened > 0)) return false
    if (f.attention === 'errors' && !(p.signals?.web_errors_30d > 0)) return false
    if (f.attention === 'old_app' && !(p.signals?.phones > 0 && isBelowMinimum(p.signals?.app_version, minVersion))) return false
    if (f.attention === 'any' && !(problemSummary(p.signals).score > 0 || (p.signals?.phones > 0 && isBelowMinimum(p.signals?.app_version, minVersion)))) return false
    return true
  })
}

/** Sort people. key: last_sign_in | name | role | problems | created. */
export function sortPeople(people = [], key = 'last_sign_in', dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1
  const val = (p) => {
    switch (key) {
      case 'name': return (p.full_name || '').toLowerCase()
      case 'role': return (p.role || '').toLowerCase()
      case 'problems': return problemSummary(p.signals).score
      case 'created': return p.created_at ? Date.parse(p.created_at) : null
      default: return p.last_sign_in_at ? Date.parse(p.last_sign_in_at) : null
    }
  }
  return [...people].sort((a, b) => {
    const x = val(a); const y = val(b)
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    if (x < y) return -1 * sign
    if (x > y) return 1 * sign
    return 0
  })
}

/** The Users "Needs attention" strip. Every line comes from a real count. */
export function userNeedsAttention(people = [], { orphans = null, minVersion = null, directoryOk = true } = {}) {
  if (!directoryOk) return []
  const items = []
  const returned = people.filter((p) => p.signals?.returned_unopened > 0)
  if (returned.length) {
    const total = returned.reduce((a, p) => a + p.signals.returned_unopened, 0)
    const top = [...returned].sort((a, b) => b.signals.returned_unopened - a.signals.returned_unopened)[0]
    items.push({
      key: 'returned', tone: 'danger',
      title: `${returned.length} ${returned.length === 1 ? 'person has' : 'people have'} ${total} returned inspections they never opened`,
      body: `${shortName(top.full_name)} alone has ${top.signals.returned_unopened}. Supervisors sent the work back; the person may not know.`,
      action: `Show ${returned.length} ${returned.length === 1 ? 'person' : 'people'}`, filter: 'returned',
    })
  }
  const errs = people.filter((p) => p.signals?.web_errors_30d > 0)
  if (errs.length) {
    const total = errs.reduce((a, p) => a + p.signals.web_errors_30d, 0)
    items.push({
      key: 'errors', tone: 'warning',
      title: `${errs.length} ${errs.length === 1 ? 'person' : 'people'} hit app errors in 30 days`,
      body: `${total} web errors recorded under their names. Phone crashes are not linked to a person yet.`,
      action: 'Open Error Center', to: '/console/crash-reports',
    })
  }
  if (Array.isArray(orphans) && orphans.length) {
    const signed = orphans.filter((o) => o.last_sign_in_at).length
    items.push({
      key: 'orphans', tone: 'accent',
      title: `${orphans.length} sign-in ${orphans.length === 1 ? 'account has' : 'accounts have'} no profile`,
      body: `They can pass the password step but see nothing. ${signed} ${signed === 1 ? 'has' : 'have'} signed in before.`,
      action: `Review ${orphans.length}`, drawer: 'orphans',
    })
  }
  if (minVersion) {
    const old = people.filter((p) => p.signals?.phones > 0 && isBelowMinimum(p.signals.app_version, minVersion))
    if (old.length) {
      const byV = {}
      for (const p of old) byV[p.signals.app_version] = (byV[p.signals.app_version] || 0) + (p.signals.phones || 1)
      const phones = Object.values(byV).reduce((a, b) => a + b, 0)
      items.push({
        key: 'old_app', tone: 'info',
        title: `${phones} ${phones === 1 ? 'phone is' : 'phones are'} below the minimum app version`,
        body: `${Object.entries(byV).map(([v, n]) => `${n} on ${v}`).join(' and ')}. They see Update required.`,
        action: 'Show them', filter: 'old_app',
      })
    }
  }
  return items
}

/* ── one person: health ──────────────────────────────────────────────────── */

/**
 * DRAFT weights for the owner to set (flagged on screen). 100 minus the
 * deductions; items we cannot measure are listed as N/A and not counted.
 */
export const HEALTH_WEIGHTS_DRAFT = Object.freeze({
  returnedHigh: 25,   // more than 25% of decided work sent back in 30 days
  returnedSome: 10,   // any sent back in 30 days
  noticesUnopened: 15,
  alertsMostlyUnread: 5,
  oldApp: 10,
  webErrors: 10,
})

export function healthScore(h, { minVersion = null } = {}) {
  if (!h || !h.ok) return { score: null, deductions: [], na: [] }
  const W = HEALTH_WEIGHTS_DRAFT
  const ded = []
  const na = []
  const r = h.returned || {}
  const rate = r.decided_30d ? r.last_30d / r.decided_30d : null
  const teamRate = r.team_decided_30d ? r.team_returned_30d / r.team_decided_30d : null
  const pct = (x) => (x == null ? 'N/A' : `${Math.round(x * 100)}%`)
  const teamPct = teamRate == null ? 'N/A' : `${(teamRate * 100).toFixed(1)}%`
  const share = r.team_returned_30d ? Math.round((r.last_30d / r.team_returned_30d) * 100) : null
  if (r.last_30d > 0) {
    const pts = rate != null && rate > 0.25 ? W.returnedHigh : W.returnedSome
    ded.push({ key: 'returned', label: 'Returned work, 30 days', points: -pts,
      detail: `${r.last_30d} of ${r.decided_30d} sent back (${pct(rate)}). Team: ${r.team_returned_30d} of ${r.team_decided_30d} (${teamPct}).${share != null ? ` That is ${share}% of all send-backs.` : ''}` })
  } else {
    ded.push({ key: 'returned', label: 'Returned work, 30 days', points: 0, detail: `None sent back. Team rate ${teamPct}.` })
  }
  const n = h.notices || {}
  if (n.returned_unread > 0) {
    ded.push({ key: 'notices', label: 'Return notices not opened', points: -W.noticesUnopened,
      detail: `${n.returned_unread} of ${n.returned_total} unopened.${n.last_read?.at ? ` Last alert opened: ${fmtRiyadh(n.last_read.at, { time: false })}.` : ' No alert ever opened.'}` })
  } else {
    ded.push({ key: 'notices', label: 'Return notices not opened', points: 0, detail: n.returned_total ? `All ${n.returned_total} opened.` : 'No return notices sent.' })
  }
  if (n.total > 0 && n.unread / n.total > 0.5) {
    ded.push({ key: 'alerts', label: 'Unread alerts overall', points: -W.alertsMostlyUnread,
      detail: `${n.unread} of ${n.total} unread; the phone may have alerts turned off.` })
  } else {
    ded.push({ key: 'alerts', label: 'Unread alerts overall', points: 0, detail: n.total ? `${n.unread} of ${n.total} unread.` : 'No alerts sent.' })
  }
  const devices = (h.devices || []).filter((d) => !d.revoked)
  if (devices.length) {
    const newest = devices.map((d) => d.app_version).filter(Boolean).sort((a, b) => compareVersions(b, a))[0]
    const below = isBelowMinimum(newest, minVersion)
    ded.push({ key: 'app', label: 'Phone app version', points: below ? -W.oldApp : 0,
      detail: newest ? `${newest}${minVersion ? (below ? `, below the minimum ${minVersion}.` : ', meets the minimum.') : '.'}` : 'Version not reported.' })
  } else {
    na.push({ key: 'app', label: 'Phone app version', detail: 'No phone registered.' })
  }
  const e = h.errors || {}
  ded.push({ key: 'web', label: 'Web errors, 30 days', points: e.web_30d > 0 ? -W.webErrors : 0,
    detail: `${e.web_30d || 0} recorded under this name.` })
  na.push({ key: 'crashes', label: 'Phone crashes', detail: 'The phone app does not attach a person to crashes yet.' })
  na.push({ key: 'offline', label: 'Stuck offline work', detail: 'The offline queue lives only on the phone.' })
  const lost = ded.reduce((a, d) => a + Math.abs(d.points), 0)
  const score = Math.max(0, 100 - lost)
  return { score, deductions: ded, na, rate, teamRate }
}

export function healthLabel(score) {
  if (score == null) return 'Not measured'
  if (score >= 85) return 'Healthy'
  if (score >= 65) return 'Watch'
  return 'Needs help'
}

/**
 * Problem timeline: returned inspections, return notices, web errors and
 * problems the person reported, newest first. kind: returned | notice | error | report.
 */
export function problemTimeline(h) {
  if (!h || !h.ok) return []
  const out = []
  for (const r of h.returned?.recent || []) out.push({ kind: 'returned', at: r.at, title: `Inspection sent back${r.asset_no ? `: ${r.asset_no}` : ''}`, body: 'Recorded in Inspections as returned for correction.' })
  for (const n of h.notices?.recent_returned || []) out.push({ kind: 'notice', at: n.at, title: n.title || 'Return notice', body: n.read ? 'Opened.' : 'Unopened.' })
  for (const e of h.errors?.recent || []) out.push({ kind: 'error', at: e.at, title: `${e.severity === 'critical' ? 'Critical' : 'App'} error${e.module ? ` in ${e.module}` : ''}`, body: e.reference_id ? `Reference ${e.reference_id}` : (e.platform || 'web') })
  for (const i of h.issues?.recent || []) out.push({ kind: 'report', at: i.at, title: `Reported a problem (${i.category})`, body: `${i.severity} severity, status ${String(i.status).replace(/_/g, ' ')}` })
  return out.filter((x) => x.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/* ── organizations ───────────────────────────────────────────────────────── */

export function orgState(org, stats) {
  if (org?.locked) return 'locked'
  if (org?.active === false) return 'archived'
  if (/demo/i.test(org?.name || '')) return 'demo'
  const rows = stats ? (stats.vehicles + stats.tyre_records + stats.job_cards + stats.expense_lines + stats.inspections) : null
  if (stats && stats.members === 0 && rows === 0) return 'empty'
  return 'active'
}

export function orgRecords(stats) {
  if (!stats) return null
  return (stats.vehicles || 0) + (stats.tyre_records || 0) + (stats.job_cards || 0) + (stats.expense_lines || 0) + (stats.inspections || 0)
}

export function isEmptyOrg(stats) {
  return !!stats && stats.members === 0 && orgRecords(stats) === 0
}

/** Needs-attention lines for Organizations. `platformCap` = system_config.max_users_per_org. */
export function orgNeedsAttention(orgs = [], statsById = {}, { platformCap = null } = {}) {
  const items = []
  const over = orgs.filter((o) => {
    const s = statsById[o.id]
    return s && Number(o.max_users) > 0 && s.members > Number(o.max_users)
  })
  if (over.length) {
    const o = over[0]; const s = statsById[o.id]
    items.push({ key: 'cap', tone: 'accent',
      title: `${o.name} is over its member cap`,
      body: `${s.members} members against a stored cap of ${o.max_users}${platformCap ? ` (and a platform setting of ${platformCap})` : ''}. Neither is enforced.`,
      action: 'Review caps', decision: true })
  }
  const locked = orgs.filter((o) => o.locked).length
  items.push({ key: 'lock', tone: 'warning',
    title: 'Lock does not block anyone today',
    body: `The Lock button sets a flag${locked ? ` (${locked} set)` : ''}, but no server rule reads it. Suspending an organization for real needs an owner decision.`,
    action: 'See suspend', decision: true })
  const empty = orgs.filter((o) => o.active !== false && isEmptyOrg(statsById[o.id]))
  if (empty.length) {
    items.push({ key: 'empty', tone: 'info',
      title: `${empty.length} ${empty.length === 1 ? 'organization was' : 'organizations were'} never used`,
      body: `${empty.map((o) => o.name).join(', ')}: 0 members, 0 records.`,
      action: `Archive ${empty.length}`, archive: true })
  }
  const labelled = orgs.filter((o) => o.plan)
  if (labelled.length) {
    items.push({ key: 'plan', tone: 'info',
      title: 'Plan labels are left over',
      body: `${labelled.length} ${labelled.length === 1 ? 'organization carries' : 'organizations carry'} an old plan word (${[...new Set(labelled.map((o) => o.plan))].join(' or ')}) that nothing bills or limits.`,
      action: 'Open Billing', to: '/console/billing' })
  }
  return items
}

/* ── billing ─────────────────────────────────────────────────────────────── */

/** A plan limit of 0 or null means custom / unlimited. */
export function limitLabel(v, unit = '') {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 'Unlimited'
  return `${n.toLocaleString('en-US')}${unit}`
}

/**
 * Does `plan` fit this usage? usage = { users, vehicles, apiKeys }.
 * Storage per organization is not recorded, so it never decides a fit.
 * Returns { fits, blocks: ['users', ...] }.
 */
export function planFit(plan, usage) {
  const blocks = []
  const chk = (limit, used, key) => {
    const n = Number(limit)
    if (Number.isFinite(n) && n > 0 && Number(used) > n) blocks.push(key)
  }
  chk(plan?.max_users, usage?.users, 'users')
  chk(plan?.max_vehicles, usage?.vehicles, 'vehicles')
  chk(plan?.max_api_keys, usage?.apiKeys, 'API keys')
  return { fits: blocks.length === 0, blocks }
}

export function fmtMoney(amount, currency = 'USD') {
  if (amount === null || amount === undefined || amount === '') return 'N/A'
  const n = Number(amount)
  if (!Number.isFinite(n)) return 'N/A'
  const sym = currency === 'USD' ? '$' : `${currency} `
  return `${sym}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

/* ── settings ────────────────────────────────────────────────────────────── */

/**
 * The settings catalogue. `type`: toggle | number | text | email | select | link.
 * `danger` keys need a typed confirmation. `managed` keys are changed on their
 * own screen (the guard triggers refuse a direct write).
 */
export const SETTING_GROUPS = [
  { key: 'general', label: 'General', items: [
    { key: 'maintenance_mode', label: 'Maintenance mode', help: 'Blocks every non-admin user on web and phone', type: 'toggle', danger: 'MAINTENANCE', review: true },
    { key: 'maintenance_message', label: 'Maintenance message', help: 'Shown to blocked users', type: 'text' },
    { key: 'default_currency', label: 'Default currency', help: 'Label only. Each country keeps its own currency; money is never added across SAR, AED, EGP', type: 'text' },
    { key: 'fx_policy', label: 'Exchange-rate policy', help: 'How combined totals would convert, once rates are approved', type: 'select', options: ['monthly_avg', 'transaction', 'closing'] },
    { key: 'support_email', label: 'Support email', help: 'Shown on help and error pages', type: 'email' },
    { key: 'max_users_per_org', label: 'Users per organization', help: 'Upper limit per company. Not enforced; the member cap source is an owner decision', type: 'number', notEnforced: true, decision: true },
    { key: 'app_version', label: 'App version label', help: 'Old label, not the real build. Real versions are on Developer', type: 'text', stale: true },
  ] },
  { key: 'signin', label: 'Sign-in', items: [
    { key: 'registration_open', label: 'Registration open', help: 'Sign-up form on web and phone', type: 'toggle' },
    { key: 'require_approval', label: 'Approve new users first', help: 'New accounts wait for an admin', type: 'toggle' },
    { key: 'allow_signups', label: 'Allow sign-ups (old key)', help: 'Duplicate of Registration open; only the new key is read', type: 'toggle', stale: true },
    { key: 'two_factor_required', label: 'Two-factor for admins', help: 'Required at console sign-in', type: 'toggle' },
    { key: 'session_timeout_hours', label: 'Session timeout', help: 'Web app signs out after this long idle', type: 'number', unit: 'hours' },
    { key: 'max_login_attempts', label: 'Lock after failed sign-ins', help: '15-minute lock', type: 'number', unit: 'attempts' },
    { key: 'password_min_length', label: 'Minimum password length', help: 'Checked at sign-up and reset', type: 'number' },
    { key: 'console_ip_allowlist_enabled', label: 'Console IP allowlist', help: 'Only listed networks reach the console', type: 'toggle', managed: '/console/access-policies', review: true },
    { key: 'dual_control_enabled', label: 'Dual control', help: 'A second admin approves bulk role change, cleanup and restore', type: 'toggle', managed: '/console/approvals', review: true },
    { key: 'auth_google_enabled', label: 'Sign in with Google', help: 'Shows the Google button on the sign-in pages. Turn on only after the provider is set up in Supabase Auth, or the button will fail', type: 'toggle' },
    { key: 'auth_microsoft_enabled', label: 'Sign in with Microsoft', help: 'Shows the Microsoft button on the sign-in pages. Turn on only after the provider is set up in Supabase Auth, or the button will fail', type: 'toggle' },
    { key: 'qr_login_enabled', label: 'Scan to sign in (QR)', help: 'Shows a QR code on the web sign-in page that the phone app approves. Turn on only after a Flutter build with Scan to sign in is on phones', type: 'toggle' },
  ] },
  { key: 'notifications', label: 'Notifications', items: [
    { key: 'email_notifications', label: 'Email notifications', help: 'Reports and workflow emails', type: 'toggle' },
    { key: 'push_notifications', label: 'Push notifications', help: 'Phone alerts', type: 'toggle' },
    { key: 'accident_emails_enabled', label: 'Accident case emails', help: 'Sent to the fixed mailbox below', type: 'toggle' },
    { key: 'accident_email_to', label: 'Accident mailbox', help: 'To address', type: 'email' },
    { key: 'accident_email_cc', label: 'Accident mailbox copy', help: 'CC addresses', type: 'email' },
    { key: 'accident_email_subject_prefix', label: 'Accident subject prefix', help: 'Put before every case email subject', type: 'text' },
    { key: 'accident_vor_sla_days', label: 'Vehicle off-road alert', help: 'Days before an off-road vehicle raises an alert', type: 'number', unit: 'days' },
    { key: 'upload_gap_push', label: 'Missed-upload push', help: 'One push per gap, not a daily nag', type: 'toggle' },
    { key: 'sentry_auto_incidents', label: 'Crash alerts open incidents', help: 'New Sentry crashes open an incident', type: 'toggle' },
    { key: 'alert_email', label: 'Alert email', help: 'Where system alerts go', type: 'email' },
    { key: 'digest_frequency', label: 'Digest frequency', help: 'Stored; each schedule keeps its own cadence', type: 'select', options: ['daily', 'weekly', 'monthly'] },
  ] },
  { key: 'exports', label: 'Exports', items: [
    { key: 'export_enabled', label: 'Exports (Excel, PDF)', help: 'Download buttons across the app', type: 'toggle', danger: 'EXPORTS OFF' },
    { key: 'max_export_rows', label: 'Rows per export', help: 'Larger downloads are refused', type: 'number' },
    { key: 'max_upload_rows', label: 'Rows per upload', help: 'Browser import limit per file', type: 'number' },
    { key: 'inspection_photo_max_mb', label: 'Inspection photo size', help: 'Per photo, before compression', type: 'number', unit: 'MB' },
  ] },
  { key: 'retention', label: 'Data retention', items: [
    { key: 'audit_retention_days', label: 'Keep audit logs', help: 'Older rows are deleted nightly', type: 'number', unit: 'days' },
    { key: 'data_retention_months', label: 'Keep business records', help: 'Protected: business data is never deleted automatically', type: 'number', unit: 'months' },
    { key: 'backup_enabled', label: 'Nightly backup', help: 'Core tables, kept 30 days', type: 'toggle' },
    { key: 'backup_max_table_rows', label: 'Backup row ceiling', help: 'Tables above this are skipped and reported', type: 'number' },
    { key: 'tenant_export_retention_days', label: 'Company export files', help: 'Deleted after', type: 'number', unit: 'days' },
    { key: 'api_key_max_age_days', label: 'API key maximum age', help: 'Keys older than this are flagged', type: 'number', unit: 'days' },
  ] },
  { key: 'ai', label: 'AI', items: [
    { key: 'ai_enabled', label: 'AI features', help: 'Assistant and AI tools', type: 'toggle' },
    { key: 'ai_model', label: 'Default AI model', help: 'The model is locked on the server; this value is not used', type: 'text' },
    { key: 'ai_monthly_budget_usd', label: 'Monthly AI budget', help: 'US dollars', type: 'number', unit: 'USD' },
    { key: 'ai_rate_limit_per_min', label: 'AI requests per minute', help: 'Per person', type: 'number' },
    { key: 'ai_cache_ttl_hours', label: 'AI answer cache', help: 'How long a repeated question is answered from cache', type: 'number', unit: 'hours' },
  ] },
  { key: 'appearance', label: 'Appearance', items: [
    { key: 'report_palette', label: 'Report colours', help: 'Charts on every report and shared board', type: 'link', tab: 'colours' },
    { key: 'company_logo', label: 'Company logo', help: 'On PDFs, QR labels and the TV board', type: 'link', tab: 'colours' },
    { key: 'mobile_login_hero', label: 'Phone login pictures', help: 'One per country, from pictures in the app', type: 'link', to: '/console/mobile-app' },
  ] },
  { key: 'navigation', label: 'Navigation', items: [
    { key: 'nav_layout', label: 'Sidebar layout', help: 'Reorder, rename or hide menu items. Hiding never grants or removes access', type: 'link', tab: 'navigation' },
  ] },
  { key: 'vehicle', label: 'Vehicle designer', items: [
    { key: '__vehicle_designs', label: 'Custom vehicle diagrams', help: 'Tyre layout per vehicle type. Built-in layouts are used where no design exists', type: 'link', tab: 'vehicle' },
  ] },
  { key: 'mobile', label: 'Phone app', items: [
    { key: 'mobile_min_version', label: 'Minimum app version', help: 'Phones below this see Update required', type: 'link', to: '/console/mobile-app' },
    { key: 'mobile_latest_version', label: 'Newest released version', help: 'Recorded on Mobile App', type: 'link', to: '/console/mobile-app' },
  ] },
]

export const CATALOG_KEYS = new Set(SETTING_GROUPS.flatMap((g) => g.items.map((i) => i.key)))

/** Keys stored in system_config that no group lists: shown under "Other". */
export function uncataloguedKeys(rows = []) {
  return (rows || []).map((r) => r.key).filter((k) => !CATALOG_KEYS.has(k)).sort()
}

/** Mask an email-looking value for display (settings and history). */
export function displaySettingValue(item, raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).replace(/^"(.*)"$/, '$1')
  if (item?.type === 'email' || /@/.test(s)) return s.split(',').map((x) => maskEmail(x.trim()) || x.trim()).join(', ')
  return s
}

export function settingsKpis(rows = [], { now = Date.now(), historyAuthors = 0 } = {}) {
  const changed30 = rows.filter((r) => r.updated_at && now - Date.parse(r.updated_at) <= 30 * DAY)
  const last = changed30.map((r) => r.updated_at).sort().pop() || null
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const riskyOff = ['maintenance_mode', 'console_ip_allowlist_enabled', 'dual_control_enabled'].filter((k) => byKey[k] !== undefined)
  return {
    total: rows.length,
    changed30: changed30.length,
    lastChange: last,
    authors: rows.filter((r) => r.updated_by).length,
    historyAuthors,
    riskyWatched: riskyOff.length,
    stale: SETTING_GROUPS.flatMap((g) => g.items).filter((i) => i.stale && byKey[i.key] !== undefined).length,
  }
}

/** Enterprise-style plans store price 0 with no limits: that means "agreed per contract". */
export function isCustomPlan(plan) {
  if (!plan) return false
  const noLimits = [plan.max_vehicles, plan.max_users, plan.max_api_keys].every((v) => v === null || v === undefined || Number(v) <= 0)
  return noLimits && !(Number(plan.price_monthly) > 0)
}

export function planPriceLabel(plan) {
  if (!plan) return 'N/A'
  if (isCustomPlan(plan)) return 'Custom'
  return fmtMoney(plan.price_monthly, plan.currency || 'USD')
}

/**
 * Next-invoice preview for assigning `plan` today: plan price, part-month
 * charge (price x days left / days in month) and first invoice date. Custom
 * plans have no price to split, so they return null amounts.
 */
export function invoicePreview(plan, now = new Date()) {
  const d = new Date(now)
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const daysLeft = daysInMonth - d.getDate() + 1
  const first = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  if (!plan || isCustomPlan(plan)) return { price: null, prorated: null, daysLeft, daysInMonth, firstInvoice: first }
  const price = Number(plan.price_monthly) || 0
  return { price, prorated: Math.round((price * daysLeft / daysInMonth) * 100) / 100, daysLeft, daysInMonth, firstInvoice: first }
}
