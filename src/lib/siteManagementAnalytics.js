/**
 * Site Management analytics (pure, no I/O) behind /site-management.
 *
 * Works on the rollup built by buildSiteRollup (src/lib/api/sites.js), which
 * merges the governed `sites` register with the sites that actually appear on
 * `vehicle_fleet`. This engine adds filters, the KPI strip (including the data
 * gaps a site register should surface: sites with no region, derived sites not
 * yet governed, governed sites with no assets), chart series and export rows.
 * It never changes how a site name is normalised; that stays in sites.js.
 *
 * Honesty: an average or share with an empty denominator is null (N/A).
 */

export const EMPTY_SITE_FILTERS = { search: '', country: '', region: '', governed: '', active: '', gap: '' }
export const GAP_KEYS = ['no_region', 'derived', 'empty']
export const GAP_LABEL = {
  no_region: 'No region set',
  derived: 'Not in the site register',
  empty: 'Registered, no assets',
}

const str = (v) => (v == null ? '' : String(v).trim())
const round1 = (n) => Math.round(n * 10) / 10
const pct = (num, den) => (den > 0 ? round1((num / den) * 100) : null)
const list = (v) => (Array.isArray(v) ? v : [])

/** Data gaps present on one site. */
export function siteGaps(s = {}) {
  const gaps = []
  if (!str(s.region)) gaps.push('no_region')
  if (!s.governed) gaps.push('derived')
  if (s.governed && !(s.assetCount > 0)) gaps.push('empty')
  return gaps
}

export function enrichSites(rollup = []) {
  return list(rollup).map((s) => ({
    ...s,
    _gaps: siteGaps(s),
    _activePct: pct(s.activeAssetCount || 0, s.assetCount || 0),
    _location: [s.country, s.region, s.city].map(str).filter(Boolean).join(', '),
  }))
}

export function countryOptions(rollup = []) {
  return [...new Set(list(rollup).map((s) => str(s.country)).filter(Boolean))].sort()
}
export function regionOptions(rollup = []) {
  return [...new Set(list(rollup).map((s) => str(s.region)).filter(Boolean))].sort()
}

export function activeSiteFilterCount(f = EMPTY_SITE_FILTERS) {
  return ['search', 'country', 'region', 'governed', 'active', 'gap'].filter((k) => str(f[k])).length
}

export function filterSites(enriched = [], f = EMPTY_SITE_FILTERS) {
  const q = str(f.search).toLowerCase()
  return list(enriched).filter((s) => {
    if (f.country && s.country !== f.country) return false
    if (f.region && str(s.region) !== f.region) return false
    if (f.governed === 'governed' && !s.governed) return false
    if (f.governed === 'derived' && s.governed) return false
    if (f.active === 'active' && !s.active) return false
    if (f.active === 'inactive' && s.active) return false
    if (f.gap && !(s._gaps || siteGaps(s)).includes(f.gap)) return false
    if (q) {
      const hay = `${s.name || ''} ${s.country || ''} ${s.region || ''} ${s.city || ''} ${s.siteType || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function siteKpis(enriched = []) {
  const rows = list(enriched)
  let assets = 0
  let activeAssets = 0
  let governed = 0
  let noRegion = 0
  let empty = 0
  let withAssets = 0
  const countries = new Set()
  for (const s of rows) {
    assets += s.assetCount || 0
    activeAssets += s.activeAssetCount || 0
    if (s.governed) governed += 1
    if (!str(s.region)) noRegion += 1
    if (s.governed && !(s.assetCount > 0)) empty += 1
    if (s.assetCount > 0) withAssets += 1
    if (str(s.country)) countries.add(str(s.country))
  }
  return {
    total: rows.length,
    governed,
    derived: rows.length - governed,
    governedPct: pct(governed, rows.length),
    assets,
    activeAssets,
    activeAssetPct: pct(activeAssets, assets),
    countries: countries.size,
    noRegion,
    emptyGoverned: empty,
    avgAssetsPerSite: withAssets ? round1(assets / withAssets) : null,
  }
}

/** Largest sites by asset count, with active and inactive split. */
export function topSitesByAssets(enriched = [], limit = 12) {
  return list(enriched)
    .filter((s) => s.assetCount > 0)
    .sort((a, b) => b.assetCount - a.assetCount || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((s) => ({ name: s.name, active: s.activeAssetCount || 0, inactive: (s.assetCount || 0) - (s.activeAssetCount || 0) }))
}

/** Sites and assets per region; blank region buckets as "No region". */
export function sitesByRegion(enriched = []) {
  const m = new Map()
  for (const s of list(enriched)) {
    const r = str(s.region) || 'No region'
    const b = m.get(r) || { region: r, sites: 0, assets: 0 }
    b.sites += 1
    b.assets += s.assetCount || 0
    m.set(r, b)
  }
  return [...m.values()].sort((a, b) => b.assets - a.assets || b.sites - a.sites || a.region.localeCompare(b.region))
}

export const SITE_EXPORT_COLUMNS = [
  ['name', 'Site'], ['country', 'Country'], ['region', 'Region'], ['city', 'City'], ['type', 'Type'],
  ['governed', 'Source'], ['active', 'Status'], ['assets', 'Assets'], ['active_assets', 'Active assets'],
  ['active_pct', 'Active %'], ['gaps', 'Data gaps'],
]

export function siteExportRows(enriched = []) {
  return list(enriched).map((s) => ({
    name: s.name,
    country: s.country ?? '',
    region: s.region ?? '',
    city: s.city ?? '',
    type: s.siteType ?? '',
    governed: s.governed ? 'Master' : 'Derived',
    active: s.active ? 'Active' : 'Inactive',
    assets: s.assetCount,
    active_assets: s.activeAssetCount,
    active_pct: s._activePct == null ? 'N/A' : s._activePct,
    gaps: (s._gaps || siteGaps(s)).map((g) => GAP_LABEL[g]).join('; ') || 'None',
  }))
}
