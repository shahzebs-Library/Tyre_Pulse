/**
 * Site operations (pure, no I/O) behind the redesigned Site Management page.
 *
 * Adds the operational layer on top of the site rollup (buildSiteRollup +
 * enrichSites): per-site status, telematics utilisation, document compliance,
 * assets currently down and overdue inspections, plus the KPI strip, health
 * tiles, country bubbles, site-type split and plain insight lines.
 *
 * Definitions (all from recorded data; an empty denominator is null, shown N/A):
 * - Status: Inactive when the register marks the site inactive, or the site has
 *   assets and none are active. Limited when it is active but fewer than half of
 *   its assets are active. Active otherwise.
 * - Utilisation: the latest asset_utilization reading per asset, averaged over
 *   the site's assets that report telematics.
 * - Compliance: share of the site's assets with at least one recorded document
 *   expiry (insurance, MVIP, operating card) where none of the recorded dates
 *   has passed. Assets with no recorded date are not assessed.
 * - Down: assets whose operational status is "breakdown".
 * - Inspection due: last inspection more than 30 days ago.
 */
import {
  utilizationIndex, utilizationFor, complianceStatus, latestInspectionIndex,
  latestInspectionFor, inspectionStatus,
} from './assetManagementAnalytics'

const list = (v) => (Array.isArray(v) ? v : [])
const str = (v) => (v == null ? '' : String(v).trim())
const round1 = (n) => Math.round(n * 10) / 10
const pct = (num, den) => (den > 0 ? round1((num / den) * 100) : null)

export const SITE_STATUSES = [
  { key: 'active', label: 'Active', tone: 'good', color: 'var(--cc-green)' },
  { key: 'limited', label: 'Limited', tone: 'warn', color: 'var(--cc-amber)' },
  { key: 'inactive', label: 'Inactive', tone: 'bad', color: 'var(--cc-red)' },
]
export const STATUS_META = Object.fromEntries(SITE_STATUSES.map((s) => [s.key, s]))

export const STATUS_RULE = 'Inactive: marked inactive in the site register, or no active assets. Limited: fewer than half of the site assets are active. Active: everything else.'
export const COMPLIANCE_RULE = 'Share of assets with a recorded insurance, MVIP or operating card expiry where none of the recorded dates has passed. Assets with no recorded expiry are not counted.'
export const UTILIZATION_RULE = 'Average of the latest telematics utilisation reading per asset, for assets that report telematics.'

const FLAGS = {
  KSA: '🇸🇦', 'SAUDI ARABIA': '🇸🇦', UAE: '🇦🇪', 'UNITED ARAB EMIRATES': '🇦🇪', EGYPT: '🇪🇬',
  QATAR: '🇶🇦', OMAN: '🇴🇲', KUWAIT: '🇰🇼', BAHRAIN: '🇧🇭', JORDAN: '🇯🇴', PAKISTAN: '🇵🇰', INDIA: '🇮🇳',
}
export function countryFlag(country) {
  return FLAGS[str(country).toUpperCase()] || ''
}

/** Status of one site under STATUS_RULE. */
export function siteStatus(s = {}) {
  const assets = s.assetCount || 0
  const active = s.activeAssetCount || 0
  if (s.active === false) return 'inactive'
  if (assets > 0 && active === 0) return 'inactive'
  if (assets > 0 && active / assets < 0.5) return 'limited'
  return 'active'
}

const nameKey = (v) => str(v).toLowerCase()

/**
 * Add operational fields to enriched sites.
 * @param {object[]} sites  enrichSites() output
 * @param {{ masterRows?: object[], utilRows?: object[], inspectionRows?: object[]|null, opsKnown?: boolean, now?: Date }} ctx
 */
export function enrichOperational(sites, { masterRows = [], utilRows = [], inspectionRows = null, opsKnown = false, now = new Date() } = {}) {
  const codeByName = new Map()
  for (const m of list(masterRows)) {
    const k = nameKey(m?.name)
    if (k && !codeByName.has(k)) codeByName.set(k, str(m.site_code) || null)
  }
  const uIdx = utilizationIndex(utilRows)
  const iIdx = inspectionRows ? latestInspectionIndex(inspectionRows) : null
  return list(sites).map((s) => {
    let uSum = 0; let uN = 0; let assessed = 0; let compliant = 0; let expired = 0; let down = 0; let inspDue = 0
    for (const a of list(s.assets)) {
      const u = utilizationFor(uIdx, a)
      if (u != null) { uSum += u; uN += 1 }
      const c = complianceStatus(a, now)
      if (c !== 'none') {
        assessed += 1
        if (c === 'expired') expired += 1
        else compliant += 1
      }
      if (opsKnown && str(a.ops_status).toLowerCase() === 'breakdown') down += 1
      if (iIdx && inspectionStatus(latestInspectionFor(iIdx, a), now) === 'overdue') inspDue += 1
    }
    return {
      ...s,
      _code: codeByName.get(nameKey(s.name)) || null,
      _status: siteStatus(s),
      _util: uN ? round1(uSum / uN) : null,
      _utilAssets: uN,
      _assessed: assessed,
      _expiredAssets: expired,
      _compliance: pct(compliant, assessed),
      _down: opsKnown ? down : null,
      _inspDue: iIdx ? inspDue : null,
    }
  })
}

export function statusCounts(sites) {
  const out = { all: 0, active: 0, limited: 0, inactive: 0 }
  for (const s of list(sites)) { out.all += 1; out[s._status || siteStatus(s)] += 1 }
  return out
}

/** KPI strip: total, active, average utilisation, compliance rate, assets assigned. */
export function operationalKpis(sites) {
  let uSum = 0; let uN = 0; let assessed = 0; let compliant = 0; let assets = 0; let active = 0
  for (const s of list(sites)) {
    if (s._util != null && s._utilAssets) { uSum += s._util * s._utilAssets; uN += s._utilAssets }
    assessed += s._assessed || 0
    compliant += (s._assessed || 0) - (s._expiredAssets || 0)
    assets += s.assetCount || 0
    if ((s._status || siteStatus(s)) === 'active') active += 1
  }
  return {
    total: list(sites).length,
    active,
    avgUtil: uN ? round1(uSum / uN) : null,
    utilAssets: uN,
    complianceRate: pct(compliant, assessed),
    assessedAssets: assessed,
    assets,
  }
}

/** Health tiles. A figure that cannot be measured is null. */
export function healthSummary(sites, { opsKnown = false, inspectionsKnown = false } = {}) {
  const rows = list(sites)
  const assessedSites = rows.filter((s) => (s._assessed || 0) > 0)
  const atRisk = assessedSites.filter((s) => (s._expiredAssets || 0) > 0).length
  return {
    compliantPct: pct(assessedSites.length - atRisk, assessedSites.length),
    compliantSites: assessedSites.length - atRisk,
    assessedSites: assessedSites.length,
    atRisk: assessedSites.length ? atRisk : null,
    inMaintenance: opsKnown ? rows.filter((s) => (s._down || 0) > 0).length : null,
    inspectionsDue: inspectionsKnown ? rows.reduce((n, s) => n + (s._inspDue || 0), 0) : null,
    inspectionSites: inspectionsKnown ? rows.filter((s) => (s._inspDue || 0) > 0).length : null,
  }
}

const TYPE_COLORS = ['var(--cc-green-strong)', 'var(--cc-green)', 'var(--cc-amber)', 'var(--cc-blue)', 'var(--cc-purple)', 'var(--cc-orange)', '#94a3b8']

/** Site type split for the donut; a site with no recorded type is its own bucket. */
export function siteTypeSegments(sites) {
  const m = new Map()
  for (const s of list(sites)) {
    const t = str(s.siteType)
    const label = t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Not recorded'
    m.set(label, (m.get(label) || 0) + 1)
  }
  const segs = [...m.entries()].map(([label, count]) => ({ label, count }))
    .sort((a, b) => (a.label === 'Not recorded') - (b.label === 'Not recorded') || b.count - a.count || a.label.localeCompare(b.label))
  return segs.map((s, i) => ({ ...s, color: s.label === 'Not recorded' ? '#cbd5e1' : TYPE_COLORS[i % (TYPE_COLORS.length - 1)] }))
}

/** One bubble per country with its site count and status split. */
export function countryBubbles(sites) {
  const m = new Map()
  for (const s of list(sites)) {
    const c = str(s.country) || 'Unassigned'
    const b = m.get(c) || { country: c, total: 0, active: 0, limited: 0, inactive: 0 }
    b.total += 1
    b[s._status || siteStatus(s)] += 1
    m.set(c, b)
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.country.localeCompare(b.country))
}

/**
 * Plain insight lines, only where the data says something. Each carries an
 * `action` the page interprets: { type: 'status'|'gap'|'site'|'sort'|'route', value }.
 */
export function siteInsights(sites, { health } = {}) {
  const rows = list(sites)
  const out = []
  const risk = rows.filter((s) => (s._expiredAssets || 0) > 0).sort((a, b) => b._expiredAssets - a._expiredAssets)
  if (risk.length) {
    out.push({
      key: 'risk', tone: 'red', icon: 'shield',
      title: `${risk.length} ${risk.length === 1 ? 'site' : 'sites'} with expired documents`,
      meta: risk.slice(0, 2).map((s) => `${s.name} (${s._expiredAssets})`).join(', '),
      action: { type: 'sort', value: 'compliance' },
    })
  }
  const limited = rows.filter((s) => s._status === 'limited')
  if (limited.length) {
    out.push({
      key: 'limited', tone: 'amber', icon: 'alert',
      title: `${limited.length} ${limited.length === 1 ? 'site' : 'sites'} running limited`,
      meta: 'Under half of their assets active',
      action: { type: 'status', value: 'limited' },
    })
  }
  const withUtil = rows.filter((s) => s._util != null).sort((a, b) => a._util - b._util)
  if (withUtil.length > 1) {
    const low = withUtil[0]
    out.push({
      key: 'lowutil', tone: 'blue', icon: 'chart',
      title: `Lowest utilisation: ${low.name}`,
      meta: `${Math.round(low._util)}% across ${low._utilAssets} ${low._utilAssets === 1 ? 'asset' : 'assets'}`,
      action: { type: 'site', value: low },
    })
  }
  if (health?.inspectionsDue) {
    out.push({
      key: 'insp', tone: 'purple', icon: 'clipboard',
      title: `${health.inspectionsDue} ${health.inspectionsDue === 1 ? 'inspection' : 'inspections'} due`,
      meta: `Over 30 days since last check, ${health.inspectionSites} ${health.inspectionSites === 1 ? 'site' : 'sites'}`,
      action: { type: 'route', value: '/inspection-planner' },
    })
  }
  const noRegion = rows.filter((s) => !str(s.region))
  if (noRegion.length) {
    out.push({
      key: 'region', tone: 'amber', icon: 'pin',
      title: `${noRegion.length} ${noRegion.length === 1 ? 'site' : 'sites'} with no region`,
      meta: 'Cannot be rolled up by region',
      action: { type: 'gap', value: 'no_region' },
    })
  }
  const derived = rows.filter((s) => !s.governed)
  if (derived.length) {
    out.push({
      key: 'derived', tone: 'green', icon: 'plus',
      title: `${derived.length} ${derived.length === 1 ? 'site' : 'sites'} not in the register`,
      meta: 'Found on fleet records only',
      action: { type: 'gap', value: 'derived' },
    })
  }
  return out.slice(0, 5)
}

const SORTERS = {
  name: (s) => str(s.name).toLowerCase(),
  code: (s) => str(s._code).toLowerCase(),
  country: (s) => str(s.country).toLowerCase(),
  type: (s) => str(s.siteType).toLowerCase(),
  assets: (s) => s.assetCount || 0,
  util: (s) => s._util,
  compliance: (s) => s._compliance,
  status: (s) => ['active', 'limited', 'inactive'].indexOf(s._status),
}

/** Sort sites; blanks (null) always sort last whatever the direction. */
export function sortSites(rows, col = 'name', dir = 'asc') {
  const get = SORTERS[col] || SORTERS.name
  const sign = dir === 'desc' ? -1 : 1
  return [...list(rows)].sort((a, b) => {
    const x = get(a); const y = get(b)
    const xn = x == null || x === ''; const yn = y == null || y === ''
    if (xn || yn) return xn === yn ? 0 : (xn ? 1 : -1)
    if (x < y) return -sign
    if (x > y) return sign
    return str(a.name).localeCompare(str(b.name))
  })
}

export const SITE_OPS_EXPORT_COLUMNS = [
  ['name', 'Site'], ['code', 'Code'], ['country', 'Country'], ['region', 'Region'], ['city', 'City'],
  ['type', 'Type'], ['source', 'Source'], ['status', 'Status'], ['assets', 'Assets'], ['active_assets', 'Active assets'],
  ['utilization', 'Utilization %'], ['compliance', 'Compliance %'], ['expired', 'Assets with expired documents'],
  ['gaps', 'Data gaps'],
]

export function siteOpsExportRows(rows, gapLabel = {}) {
  return list(rows).map((s) => ({
    name: s.name,
    code: s._code || '',
    country: s.country ?? '',
    region: s.region ?? '',
    city: s.city ?? '',
    type: s.siteType ?? '',
    source: s.governed ? 'Register' : 'Fleet records',
    status: STATUS_META[s._status]?.label || '',
    assets: s.assetCount || 0,
    active_assets: s.activeAssetCount || 0,
    utilization: s._util == null ? 'N/A' : s._util,
    compliance: s._compliance == null ? 'N/A' : s._compliance,
    expired: s._expiredAssets || 0,
    gaps: list(s._gaps).map((g) => gapLabel[g] || g).join('; ') || 'None',
  }))
}
