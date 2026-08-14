/**
 * WORKING CONTEXT - the single source for "where am I working right now".
 *
 * This is the OPERATIONAL selection (one place at a time: a country, optionally
 * narrowed to a region and a site). It replaces the hardcoded three-country pill
 * with a permission-aware tree built from the `sites` register, so adding a
 * country or a site is a data change and never a code change.
 *
 * It is deliberately SEPARATE from the reporting scope (src/lib/reportingScope.js),
 * which may aggregate several countries at once. Never write one from the other.
 *
 * Everything here is PURE: no I/O, no React, no imports from contexts. The
 * permission rules mirror the server predicates (RLS is the real boundary, this
 * only decides what the picker may offer):
 *   country: country IS NULL OR is_super_admin() OR app_sees_all_countries()
 *            OR lower(btrim(country)) = ANY(app_country_scope())
 *   site:    site IS NULL OR btrim(site)='' OR app_sees_all_sites()
 *            OR upper(btrim(site)) = ANY(app_site_scope())
 * Country comparison is case-insensitive and trimmed; site comparison is
 * UPPER + trimmed. MIRROR: if those predicates change, change this file too.
 *
 * SHAPE NOTE: region is populated for KSA only today (UAE and Egypt have none),
 * so a country node carries BOTH `regions` (may be empty) and a complete flat
 * `sites` list. A renderer draws Country > Region > Site when regions exist and
 * Country > Site when they do not. There is no project level in the data and
 * none is invented here; the node shape leaves room for one later.
 */

/** No place selected. Bridges to the legacy activeCountry sentinel 'All'. */
export const EMPTY_CONTEXT = Object.freeze({ country: null, region: null, site: null })

// 'Saudi Arabia' is a duplicate spelling of KSA in the sites register (one stray
// row). Fold it so the same country can never appear as two tree nodes.
const COUNTRY_ALIAS = { 'saudi arabia': 'KSA' }
// profiles.sites sentinels meaning "every site" (V309).
const ALL_SITE_SENTINELS = new Set(['ALL', '*'])
// profiles.country sentinel meaning "every country".
const ALL_COUNTRY_SENTINELS = new Set(['all', '*'])

const txt = (v) => (v == null ? '' : String(v).trim())
const up = (v) => txt(v).toUpperCase()
const cmp = (a, b) => String(a).localeCompare(String(b), 'en')

/** Canonical country spelling (trimmed, aliases folded). '' when absent. */
function canonCountry(v) {
  const t = txt(v)
  if (!t) return ''
  return COUNTRY_ALIAS[t.toLowerCase()] || t
}

/** The countries a profile explicitly holds, canonicalised. */
function heldCountries(profile) {
  const raw = Array.isArray(profile?.country) ? profile.country : [profile?.country]
  return raw.map(canonCountry).filter(Boolean)
}

/** The sites a profile explicitly holds, UPPER + trimmed. */
function heldSites(profile) {
  const raw = Array.isArray(profile?.sites) ? profile.sites : [profile?.sites]
  return raw.map(up).filter(Boolean)
}

const isAdminish = (profile) => profile?.is_super_admin === true
  || txt(profile?.role).toLowerCase() === 'admin'

/**
 * True when the profile may see every country. A NULL/empty country list means
 * "all countries" (the historical contract) and so does an 'all' sentinel.
 * A missing profile (still loading) is treated as unrestricted so the app never
 * flashes an empty picker or overwrites a restored choice before login settles.
 */
function seesAllCountries(profile) {
  if (!profile) return true
  if (isAdminish(profile)) return true
  const list = heldCountries(profile)
  if (!list.length) return true
  return list.some(v => ALL_COUNTRY_SENTINELS.has(v.toLowerCase()))
}

/** True when the profile may see every site (ALL/* sentinel, admin, or empty). */
function seesAllSites(profile) {
  if (!profile) return true
  if (isAdminish(profile)) return true
  const list = heldSites(profile)
  if (!list.length) return true
  return list.some(v => ALL_SITE_SENTINELS.has(v))
}

/**
 * Build the context tree from raw `sites` rows ({ name, country, region }).
 *
 * Returns [{ country, regions: [{ region, sites: [name] }], sites: [name] }],
 * countries / regions / sites each sorted alphabetically (deterministic).
 *
 * - 'Saudi Arabia' folds into 'KSA'.
 * - A repeated site name is kept once; the first row that NAMES a region wins
 *   (the same rule siteRegionMap uses), so a duplicate row with a blank region
 *   cannot strip the region off a site.
 * - A row with a blank NAME still REGISTERS its country (with no site added).
 *   That is what lets a country whose sites are not in the register - or the
 *   COUNTRIES fallback used when the fetch fails - still be selectable.
 * - A row with a blank COUNTRY is skipped entirely: it belongs nowhere.
 */
export function buildContextTree(sites) {
  const rows = Array.isArray(sites) ? sites : []
  const byCountry = new Map()

  for (const row of rows) {
    const country = canonCountry(row?.country)
    if (!country) continue
    let node = byCountry.get(country)
    if (!node) {
      node = { country, sites: new Map(), regionOf: new Map() }
      byCountry.set(country, node)
    }
    const name = txt(row?.name)
    if (!name) continue
    const key = name.toUpperCase()
    if (!node.sites.has(key)) node.sites.set(key, name)
    const region = txt(row?.region)
    if (region && !node.regionOf.has(key)) node.regionOf.set(key, region)
  }

  return [...byCountry.values()]
    .map((node) => {
      const names = [...node.sites.values()].sort(cmp)
      const regions = new Map()
      for (const name of names) {
        const region = node.regionOf.get(name.toUpperCase())
        if (!region) continue
        const rk = region.toUpperCase()
        if (!regions.has(rk)) regions.set(rk, { region, sites: [] })
        regions.get(rk).sites.push(name)
      }
      return {
        country: node.country,
        regions: [...regions.values()].sort((a, b) => cmp(a.region, b.region)),
        sites: names,
      }
    })
    .sort((a, b) => cmp(a.country, b.country))
}

/**
 * Filter a tree down to what this profile may actually see. Same shape out.
 *
 * A country whose site list is EMPTY in the register is kept even for a
 * site-scoped user: with no sites recorded we cannot prove the user is excluded,
 * and dropping it would blank the picker whenever the register is unavailable.
 * RLS still decides what data comes back.
 */
export function allowedContext(profile, tree) {
  const nodes = Array.isArray(tree) ? tree : []
  const allCountries = seesAllCountries(profile)
  const allSites = seesAllSites(profile)
  if (allCountries && allSites) return nodes

  const held = new Set(heldCountries(profile).map(v => v.toLowerCase()))
  const sitesHeld = new Set(heldSites(profile))
  const out = []

  for (const node of nodes) {
    if (!allCountries && !held.has(String(node.country).toLowerCase())) continue
    const known = Array.isArray(node.sites) ? node.sites : []
    if (allSites || known.length === 0) {
      out.push(node)
      continue
    }
    const sites = known.filter(n => sitesHeld.has(up(n)))
    if (!sites.length) continue
    const keep = new Set(sites.map(up))
    const regions = (Array.isArray(node.regions) ? node.regions : [])
      .map(r => ({ region: r.region, sites: (r.sites || []).filter(n => keep.has(up(n))) }))
      .filter(r => r.sites.length > 0)
    out.push({ country: node.country, regions, sites })
  }
  return out
}

/** Look a country node up by name, case-insensitively. */
function findCountry(allowed, country) {
  const want = canonCountry(country).toLowerCase()
  if (!want) return null
  return (Array.isArray(allowed) ? allowed : [])
    .find(n => String(n.country).toLowerCase() === want) || null
}

/** The most specific starting point for a country node. */
function leafFor(node) {
  if (!node) return { ...EMPTY_CONTEXT }
  const sites = Array.isArray(node.sites) ? node.sites : []
  // Exactly one site means there is only one place to be: name it, rather than
  // showing a vaguer country-only label the user cannot narrow anyway.
  if (sites.length === 1) {
    return { country: node.country, region: regionOfSite(node, sites[0]), site: sites[0] }
  }
  return { country: node.country, region: null, site: null }
}

function regionOfSite(node, site) {
  const want = up(site)
  const hit = (Array.isArray(node?.regions) ? node.regions : [])
    .find(r => (r.sites || []).some(n => up(n) === want))
  return hit ? hit.region : null
}

/**
 * Validate a restored / incoming context against the CURRENT allowed tree.
 * Never trust persisted state: a user's scope can be narrowed at any time.
 *
 * Returns { context, changed, reason } where reason is one of
 *   null                  the saved context stands
 *   'initial'             nothing was saved, a default was picked
 *   'country_unavailable' the saved country is no longer permitted
 *   'site_unavailable'    the country stands but the saved site does not
 *   'region_unavailable'  the country stands but the saved region does not
 *   'no_access'           the user may see nothing at all
 */
export function normalizeContext(saved, allowed) {
  const nodes = Array.isArray(allowed) ? allowed : []
  if (!nodes.length) {
    return { context: { ...EMPTY_CONTEXT }, changed: true, reason: 'no_access' }
  }

  const first = () => leafFor(nodes[0])
  if (!saved || !txt(saved.country)) {
    return { context: first(), changed: true, reason: 'initial' }
  }

  const node = findCountry(nodes, saved.country)
  if (!node) {
    return { context: first(), changed: true, reason: 'country_unavailable' }
  }

  const site = txt(saved.site)
  if (site) {
    const match = (Array.isArray(node.sites) ? node.sites : []).find(n => up(n) === up(site))
    if (!match) {
      return {
        context: { country: node.country, region: null, site: null },
        changed: true,
        reason: 'site_unavailable',
      }
    }
    // Region is derived from the tree so a stale or missing region self-heals
    // without telling the user anything changed - the place is the same.
    return {
      context: { country: node.country, region: regionOfSite(node, match), site: match },
      changed: false,
      reason: null,
    }
  }

  const region = txt(saved.region)
  if (region) {
    const match = (Array.isArray(node.regions) ? node.regions : [])
      .find(r => up(r.region) === up(region))
    if (!match) {
      return {
        context: { country: node.country, region: null, site: null },
        changed: true,
        reason: 'region_unavailable',
      }
    }
    return {
      context: { country: node.country, region: match.region, site: null },
      changed: false,
      reason: null,
    }
  }

  return { context: { country: node.country, region: null, site: null }, changed: false, reason: null }
}

/**
 * How many places this user can choose between. A country with no sites in the
 * register still counts as one place (the country itself).
 */
export function contextLeafCount(allowed) {
  const nodes = Array.isArray(allowed) ? allowed : []
  return nodes.reduce((n, node) => {
    const sites = Array.isArray(node.sites) ? node.sites.length : 0
    return n + Math.max(1, sites)
  }, 0)
}

/**
 * True when there is genuinely something to switch between. A user with exactly
 * one place must be shown a static label, not a dropdown that does nothing.
 */
export function canSwitchContext(allowed) {
  return contextLeafCount(allowed) > 1
}

/**
 * Readable label, most specific part first: "QIDDIYA-UPPER PLATEAU - KSA".
 * ASCII only (repo rule: no em/en dashes, middle dots or arrows).
 */
export function contextLabel(ctx) {
  const parts = [txt(ctx?.site) || txt(ctx?.region), canonCountry(ctx?.country)].filter(Boolean)
  return parts.length ? parts.join(' - ') : 'All countries'
}

/** The single most specific token, for a narrow header. */
export function contextShortLabel(ctx) {
  return txt(ctx?.site) || txt(ctx?.region) || canonCountry(ctx?.country) || 'All'
}

/**
 * THE BRIDGE to the legacy contract. `activeCountry` is read by 212 files and
 * fed to applyCountry() by 130 API modules, so every context change must map to
 * it. A context with no country means no country filter, i.e. the 'All' sentinel.
 */
export function contextToCountry(ctx) {
  return canonCountry(ctx?.country) || 'All'
}
