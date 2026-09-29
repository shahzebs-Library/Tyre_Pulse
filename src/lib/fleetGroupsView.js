/**
 * fleetGroupsView - pure engine for the redesigned Fleet Groups page
 * (/fleet-groups). Sits on top of the hierarchy primitives in ./fleetGroups.js
 * and the register shaping in ./fleetGroupsAnalytics.js; nothing there is
 * re-derived here.
 *
 * THE MEMBERSHIP RULE, stated once because every per-group figure rests on it:
 * `fleet_groups` (V189) records a group and a typed asset COUNT, but no list of
 * member assets. The only honest link from a group to real assets is the site
 * register: when a group's name or code is the name or code of a registered
 * site, the assets registered at that site are its members, and a parent group
 * takes the matched sites of every group beneath it. A group that matches no
 * site has no measurable members, so its utilisation and issues are null
 * (rendered N/A), never 0.
 *
 * No I/O, no React. Anything time based takes an explicit `now`.
 */
import { buildHierarchy, collectSubtree, toFiniteNumber } from './fleetGroups'

/** Site / group key: upper case, single spaces, a trailing store suffix dropped. */
export function siteKey(v) {
  if (v == null) return ''
  return String(v).replace(/\s+/g, ' ').trim().toUpperCase().replace(/[\s_-]+ST$/, '')
}

const assetKey = (v) => (v == null ? '' : String(v).replace(/\s+/g, '').toUpperCase())

/**
 * Index the site register by name and code. Returns Map key -> canonical site
 * name (the register's own spelling, which is what vehicle_fleet.site holds).
 */
export function indexSites(sites = []) {
  const map = new Map()
  for (const s of Array.isArray(sites) ? sites : []) {
    const name = String(s?.name ?? '').trim()
    if (!name) continue
    const canon = name.toUpperCase()
    for (const k of [siteKey(s.name), siteKey(s.site_code)]) {
      if (k && !map.has(k)) map.set(k, canon)
    }
  }
  return map
}

/** The site a single group names directly (its name or code), or ''. */
export function directSiteFor(group, siteIndex) {
  if (!group || !siteIndex) return ''
  return siteIndex.get(siteKey(group.group_name)) || siteIndex.get(siteKey(group.group_code)) || ''
}

/**
 * Map group id -> sorted list of matched site names, rolled up through the
 * hierarchy (a parent owns the sites of its whole subtree).
 */
export function matchGroupSites(groups = [], sites = []) {
  const idx = indexSites(sites)
  const list = Array.isArray(groups) ? groups : []
  const out = new Map()
  for (const g of list) {
    const set = new Set()
    for (const node of collectSubtree(list, g.group_name)) {
      const s = directSiteFor(node, idx)
      if (s) set.add(s)
    }
    out.set(g.id, [...set].sort((a, b) => a.localeCompare(b)))
  }
  return out
}

/**
 * The region shown for a group: the group's own recorded region, else the one
 * region all its matched sites sit in (read from the site register). `derived`
 * tells the page to say where the value came from.
 */
export function regionForGroup(group, matchedSites = [], regionMap) {
  const own = String(group?.region ?? '').trim()
  if (own) return { region: own, derived: false }
  const found = new Set()
  for (const s of matchedSites) {
    const r = regionMap?.get?.(String(s).trim().toUpperCase())
    if (r) found.add(r)
  }
  if (found.size === 1) return { region: [...found][0], derived: true }
  if (found.size > 1) return { region: 'Multiple', derived: true }
  return { region: '', derived: false }
}

/** Assets (vehicle_fleet rows) at any of the given sites, same country when both are known. */
export function membersFor(matchedSites = [], fleet = [], country = '') {
  const want = new Set(matchedSites.map((s) => String(s).trim().toUpperCase()))
  if (!want.size) return []
  return (Array.isArray(fleet) ? fleet : []).filter((a) => {
    if (!want.has(String(a?.site ?? '').trim().toUpperCase())) return false
    if (country && a?.country && a.country !== country) return false
    return true
  })
}

/** Latest utilisation snapshot per asset (by captured_at), keyed by asset. */
export function latestUtilByAsset(utilRows = []) {
  const map = new Map()
  for (const r of Array.isArray(utilRows) ? utilRows : []) {
    const k = assetKey(r?.asset_no)
    const v = toFiniteNumber(r?.utilization_pct)
    if (!k || v == null) continue
    const prev = map.get(k)
    const t = r?.captured_at ? Date.parse(r.captured_at) || 0 : 0
    if (!prev || t >= prev.t) map.set(k, { v, t })
  }
  return map
}

/**
 * Mean utilisation over the given assets that carry a snapshot. Returns
 * { value, measured, total }; value is null when none are measured.
 */
export function utilizationFor(assets = [], latestMap) {
  let sum = 0
  let n = 0
  for (const a of assets) {
    const hit = latestMap?.get?.(assetKey(a?.asset_no))
    if (hit) { sum += hit.v; n += 1 }
  }
  return { value: n ? sum / n : null, measured: n, total: assets.length }
}

/**
 * Open issue counts for a set of assets, from real signals:
 *   actions  - open corrective actions on the asset
 *   tyres    - fitted tyres rated Critical
 *   pm       - active PM programs past their next due date
 * A signal whose source could not be read is null and the total says so.
 */
export function issuesFor(assets = [], signals = {}) {
  const keys = new Set(assets.map((a) => assetKey(a?.asset_no)).filter(Boolean))
  const count = (rows) => (rows == null ? null : rows.filter((r) => keys.has(assetKey(r?.asset_no))).length)
  const actions = count(signals.actions)
  const tyres = count(signals.criticalTyres)
  const pm = count(signals.overduePm)
  const parts = [actions, tyres, pm]
  const known = parts.filter((p) => p != null)
  return {
    actions, tyres, pm,
    total: known.length ? known.reduce((s, x) => s + x, 0) : null,
    complete: known.length === parts.length,
  }
}

/** The biggest single issue driver in plain words, or ''. */
export function issueHeadline(iss) {
  if (!iss) return ''
  const items = [
    { n: iss.tyres, one: 'critical tyre', many: 'critical tyres' },
    { n: iss.pm, one: 'overdue maintenance plan', many: 'overdue maintenance plans' },
    { n: iss.actions, one: 'open action item', many: 'open action items' },
  ].filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
  if (!items.length) return ''
  const top = items[0]
  return `${top.n} ${top.n === 1 ? top.one : top.many}`
}

/** Register rows in hierarchy order (parent, then its children), each with depth. */
export function hierarchyOrder(rows = []) {
  const out = []
  const seen = new Set()
  const walk = (node, depth) => {
    if (seen.has(node.group.id)) return
    seen.add(node.group.id)
    out.push({ row: node.group, depth })
    for (const c of node.children) walk(c, depth + 1)
  }
  for (const root of buildHierarchy(rows)) walk(root, 0)
  // Rows the tree dropped (duplicate names) are kept at the end, never lost.
  for (const r of Array.isArray(rows) ? rows : []) if (!seen.has(r.id)) out.push({ row: r, depth: 0 })
  return out
}

/**
 * Donut segments over each group's OWN recorded asset count (never the
 * rolled-up count, which would count a child's assets twice).
 */
export function compositionSegments(groups = [], colors = [], top = 8) {
  const sized = (Array.isArray(groups) ? groups : [])
    .map((g) => ({ label: g.group_name, count: toFiniteNumber(g.asset_count) }))
    .filter((s) => s.label && s.count != null && s.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  const head = sized.slice(0, top).map((s, i) => ({ ...s, color: colors[i % Math.max(colors.length, 1)] || '#16a34a' }))
  const rest = sized.slice(top).reduce((s, x) => s + x.count, 0)
  if (rest > 0) head.push({ label: 'Others', count: rest, color: '#98a2b3' })
  return head
}

/** Month keys (YYYY-MM) for the last `n` months ending with `now`'s month. */
export function lastMonths(n, now = new Date()) {
  const out = []
  const y = now.getFullYear(); const m = now.getMonth()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/**
 * Mean utilisation per month for the given assets, from every snapshot taken in
 * that month. A month with no snapshot is null (a gap, not a zero).
 */
export function monthlyUtilization(assets = [], utilRows = [], months = []) {
  const keys = new Set(assets.map((a) => assetKey(a?.asset_no)).filter(Boolean))
  const acc = new Map(months.map((m) => [m, { sum: 0, n: 0 }]))
  for (const r of Array.isArray(utilRows) ? utilRows : []) {
    if (!keys.has(assetKey(r?.asset_no))) continue
    const v = toFiniteNumber(r?.utilization_pct)
    const m = String(r?.captured_at ?? '').slice(0, 7)
    if (v == null || !acc.has(m)) continue
    const a = acc.get(m); a.sum += v; a.n += 1
  }
  return months.map((m) => {
    const a = acc.get(m)
    return { month: m, value: a.n ? a.sum / a.n : null, samples: a.n }
  })
}

/** Fitted-tyre count per asset. */
export function tyresByAsset(tyreRows = []) {
  const map = new Map()
  for (const r of Array.isArray(tyreRows) ? tyreRows : []) {
    const k = assetKey(r?.asset_no)
    if (k) map.set(k, (map.get(k) || 0) + 1)
  }
  return map
}

export { assetKey }
