/**
 * Audience directory for "Message the team".
 *
 * Pure, I/O free. Everything a picker may offer is DERIVED from the rows the
 * caller's organisation really has, never from a static list, and every value
 * is the EXACT string the server filters on, because `broadcast_audience` /
 * `broadcast_send` compare with plain equality or array overlap:
 *
 *   roles      p.role = any(p_roles)                       exact, case sensitive
 *   countries  p.country && p_countries                    exact text[] overlap
 *   sites      p.sites && (p_sites || array['ALL'])        canonical UPPER names
 *
 * (A profile with no country / no sites matches any country / site filter; that
 * is the server's rule and is mirrored below only so tests can prove the
 * client's option values hit the same rows. The server stays the authority.)
 *
 * Roles are NOT job titles. `profiles.role` is the access role, so the list is
 * the distinct roles actually held by eligible people plus the organisation's
 * custom roles - renaming them to job titles would stop matching the backend.
 *
 * @module broadcastAudience
 */
import { normaliseSite } from './workshopStatus/compareUpload'

const clean = (v) => String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
const orgOf = (row) => row?.organisation_id || row?.org_id || null
const arr = (v) => (Array.isArray(v) ? v : [])

/** Approved and not locked: the same people the server will ever address. */
export const isEligible = (p) => Boolean(p) && p.approved !== false && !p.locked

/* ── search text ────────────────────────────────────────────────────────── */

const ARABIC_INDIC = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' }

/**
 * Case / diacritic / Arabic-variant insensitive key for searching.
 * Strips harakat and tatweel, folds alef and yeh/teh-marbuta variants and
 * Arabic-Indic digits, so a name typed with or without marks still matches.
 */
export function searchKey(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/[ً-ٰٟـ̀-ͯ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => ARABIC_INDIC[d])
    .toLocaleLowerCase()
}

/** Every whitespace separated token of the query must appear in the haystack. */
export function matchesQuery(haystack, query) {
  const tokens = searchKey(query).split(' ').filter(Boolean)
  if (!tokens.length) return true
  const hay = searchKey(haystack)
  return tokens.every((t) => hay.includes(t))
}

/* ── roles ──────────────────────────────────────────────────────────────── */

/**
 * Job role options: the distinct `profiles.role` of ELIGIBLE people in this
 * organisation, plus the organisation's active custom roles (which may have
 * nobody yet). Values keep the exact stored spelling and case.
 *
 * @returns {{value:string,label:string,count:number,custom:boolean,hint:string}[]}
 */
export function buildRoleOptions({ profiles = [], customRoles = [], orgId = null } = {}) {
  const inOrg = (row) => !orgId || !orgOf(row) || orgOf(row) === orgId
  const counts = new Map()
  for (const p of arr(profiles)) {
    if (!isEligible(p) || !inOrg(p)) continue
    const role = clean(p.role)
    if (role) counts.set(role, (counts.get(role) || 0) + 1)
  }
  const customNames = new Set()
  for (const r of arr(customRoles)) {
    if (r?.active === false || !inOrg(r)) continue
    const name = clean(r?.name)
    if (name) customNames.add(name)
  }
  const values = [...new Set([...counts.keys(), ...customNames])]
  return values
    .map((value) => {
      const count = counts.get(value) || 0
      return {
        value,
        label: value,
        count,
        custom: customNames.has(value),
        hint: `${count} ${count === 1 ? 'person' : 'people'}`,
      }
    })
    .sort((a, b) => a.value.localeCompare(b.value))
}

/* ── countries ──────────────────────────────────────────────────────────── */

/**
 * Countries that really exist for the organisation: those of its active
 * registered sites and those held by its eligible people.
 */
export function buildCountryOptions({ sites = [], profiles = [], orgId = null } = {}) {
  const inOrg = (row) => !orgId || !orgOf(row) || orgOf(row) === orgId
  const found = new Set()
  for (const s of arr(sites)) {
    if (s?.active === false || !inOrg(s)) continue
    const c = clean(s?.country)
    if (c) found.add(c)
  }
  for (const p of arr(profiles)) {
    if (!isEligible(p) || !inOrg(p)) continue
    for (const c of arr(p.country)) {
      const v = clean(c)
      if (v) found.add(v)
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }))
}

/* ── sites ──────────────────────────────────────────────────────────────── */

/** alias -> canonical Map from raw site_aliases rows (keys UPPER, like the DB). */
export function aliasMap(rows) {
  const out = new Map()
  for (const r of arr(rows)) {
    if (r?.alias && r?.canonical) out.set(clean(r.alias).toUpperCase(), clean(r.canonical).toUpperCase())
  }
  return out
}

/**
 * Canonical site value, exactly as normalize_site() stores it. This is what
 * `profiles.sites` holds, so it is what the audience filter has to send.
 */
export function canonicalSite(name, aliases) {
  return normaliseSite(name, aliases instanceof Map ? aliases : aliasMap(aliases))
}

/**
 * Site directory for one organisation: active sites only, other organisations'
 * sites dropped, de-duplicated on the canonical value (so "NHC", "nhc " and the
 * retired "NHC-ST" are ONE option), narrowed to the selected countries.
 *
 * One canonical name can exist in several countries; the option then lists them
 * all, because the server filter takes the name alone.
 *
 * @param {object} p
 * @param {object[]} p.sites     rows from `sites` (name,country,active,organisation_id)
 * @param {Map|object[]} [p.aliases]
 * @param {string|null} [p.orgId]
 * @param {string[]} [p.countries] selected countries; [] = no narrowing
 * @param {string[]} [p.keep]    already chosen values that must stay on offer
 *                               even if the country filter now hides them
 * @returns {{value:string,label:string,countries:string[],hint:string}[]}
 */
export function buildSiteDirectory({ sites = [], aliases, orgId = null, countries = [], keep = [] } = {}) {
  const amap = aliases instanceof Map ? aliases : aliasMap(aliases)
  const wanted = new Set(arr(countries).map(clean).filter(Boolean))
  const all = new Map()
  for (const s of arr(sites)) {
    if (s?.active === false) continue
    if (orgId && orgOf(s) && orgOf(s) !== orgId) continue
    const value = canonicalSite(s?.name, amap)
    if (!value) continue
    const entry = all.get(value) || { value, countries: new Set() }
    const c = clean(s?.country)
    if (c) entry.countries.add(c)
    all.set(value, entry)
  }
  const keepSet = new Set(arr(keep))
  const out = []
  for (const entry of all.values()) {
    const cs = [...entry.countries].sort()
    const visible = wanted.size === 0 || cs.some((c) => wanted.has(c))
    if (!visible && !keepSet.has(entry.value)) continue
    out.push({
      value: entry.value,
      label: entry.value,
      countries: cs,
      hint: cs.join(', '),
    })
  }
  return out.sort((a, b) => a.value.localeCompare(b.value))
}

/* ── employees ──────────────────────────────────────────────────────────── */

const siteNames = (p) => [...new Set([clean(p?.site), ...arr(p?.sites).map(clean)].filter((s) => s && s !== 'ALL'))]

/** Option for the employee picker: id value, searchable across every field. */
export function toEmployeeOption(p) {
  const name = clean(p.full_name) || clean(p.username) || String(p.id)
  const sites = siteNames(p)
  const hint = [clean(p.role), sites.join(', ')].filter(Boolean).join(' | ')
  return {
    value: String(p.id),
    label: clean(p.employee_id) ? `${name} (${clean(p.employee_id)})` : name,
    name,
    hint,
    search: [p.full_name, p.username, p.employee_id, p.role, ...sites, ...arr(p.country)].map(clean).join(' '),
  }
}

/** Eligible employees of one organisation as picker options, sorted by name. */
export function buildEmployeeOptions({ profiles = [], orgId = null } = {}) {
  return arr(profiles)
    .filter((p) => isEligible(p) && (!orgId || !orgOf(p) || orgOf(p) === orgId))
    .map(toEmployeeOption)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/* ── mirrors of the server filter (used by tests and sanity checks) ─────── */

/** `broadcast_audience` role predicate: exact, case sensitive. */
export function serverRoleMatch(profile, roles) {
  return arr(roles).length === 0 || arr(roles).includes(profile?.role)
}

/** `broadcast_audience` country predicate: unrestricted profiles always match. */
export function serverCountryMatch(profile, countries) {
  if (arr(countries).length === 0) return true
  const own = arr(profile?.country)
  return own.length === 0 || own.some((c) => countries.includes(c))
}

/** `broadcast_audience` site predicate; the 'ALL' sentinel is always matched. */
export function serverSiteMatch(profile, sites) {
  if (arr(sites).length === 0) return true
  const own = arr(profile?.sites)
  return own.length === 0 || own.some((s) => [...sites, 'ALL'].includes(s))
}

/** Which of the chosen values are NOT on offer (stale or foreign). */
export function unknownSelections(selected, options) {
  const valid = new Set(arr(options).map((o) => (typeof o === 'object' ? o.value : o)))
  return arr(selected).filter((v) => !valid.has(v))
}

/** Drop values that are no longer on offer; keeps the same array if nothing changed. */
export function pruneSelection(selected, options) {
  const drop = unknownSelections(selected, options)
  return drop.length ? arr(selected).filter((v) => !drop.includes(v)) : selected
}

/** True when nothing narrows the audience: the message goes to everybody. */
export function isEveryone({ roles = [], countries = [], sites = [] } = {}) {
  return arr(roles).length === 0 && arr(countries).length === 0 && arr(sites).length === 0
}

/** One-line plain English summary of who is being addressed. */
export function audienceSummary({ roles = [], countries = [], sites = [] } = {}) {
  const part = (list, all, noun) => (arr(list).length
    ? `${arr(list).length === 1 ? arr(list)[0] : `${arr(list).length} ${noun}`}` : all)
  return `${part(roles, 'All job roles', 'job roles')} | ${part(countries, 'all countries', 'countries')} | ${part(sites, 'all sites', 'sites')}`
}
