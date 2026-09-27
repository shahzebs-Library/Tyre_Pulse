/**
 * fleetGroupsAnalytics - pure presentation engine for the Fleet Groups page
 * (/fleet-groups). Builds the register rows, KPI strip, type breakdown,
 * data-quality findings and export shape on top of the hierarchy primitives in
 * ./fleetGroups.js (tree, roll-up and depth stay THERE; nothing is re-derived).
 *
 * Honesty rules:
 *   - A figure nobody recorded is null (rendered N/A), never 0. A hierarchy with
 *     no asset counts has no measured fleet size.
 *   - Budgets in different currencies are never added together. When groups
 *     carry more than one currency the headline is null and the per-currency
 *     split is returned instead.
 *
 * No I/O, no React. `now` is not needed here (nothing is time based).
 */
import { toFiniteNumber, rollupAssetCount, depthOf } from './fleetGroups'

export const GROUP_TYPE_LABELS = {
  holding: 'Holding',
  subsidiary: 'Subsidiary',
  division: 'Division',
  depot: 'Depot',
  cost_center: 'Cost Center',
  custom: 'Custom',
}

const key = (v) => (v == null ? '' : String(v).trim())

export function groupTypeLabel(type) {
  if (!type) return 'Unclassified'
  return GROUP_TYPE_LABELS[type] || String(type)
}

/**
 * Filter the register. `active` is '' | 'active' | 'inactive'; search is a
 * case-insensitive contains over the descriptive fields.
 */
export function filterGroups(rows = [], { type = '', active = '', search = '' } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(search || '').trim().toLowerCase()
  return list.filter((r) => {
    if (type && r?.group_type !== type) return false
    if (active === 'active' && r?.active === false) return false
    if (active === 'inactive' && r?.active !== false) return false
    if (q) {
      const hay = [r?.group_name, r?.group_code, r?.manager, r?.region, r?.parent_group, r?.notes]
        .map((v) => (v == null ? '' : String(v))).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Enrich rows for the register: depth, own count, rolled-up count and parsed
 * budget. `all` is the full set so depth / roll-up see every ancestor even
 * when the register itself is filtered.
 */
export function groupRegisterRows(rows = [], all = rows) {
  const list = Array.isArray(rows) ? rows : []
  const universe = Array.isArray(all) ? all : list
  return list.map((r) => {
    const own = toFiniteNumber(r?.asset_count)
    return {
      ...r,
      typeLabel: groupTypeLabel(r?.group_type),
      depth: depthOf(universe, r?.group_name),
      ownAssets: own,
      rolledAssets: rollupAssetCount(universe, r?.group_name),
      budgetValue: toFiniteNumber(r?.budget),
      isActive: r?.active !== false,
    }
  })
}

/**
 * Budget split by currency. A group with no currency is attributed to the
 * fallback (the page's active currency), which is what the form defaults to.
 */
export function budgetByCurrency(rows = [], fallbackCurrency = '') {
  const map = new Map()
  let withBudget = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const b = toFiniteNumber(r?.budget)
    if (b == null) continue
    withBudget += 1
    const cur = key(r?.currency) || key(fallbackCurrency) || 'Unspecified'
    map.set(cur, (map.get(cur) || 0) + b)
  }
  const totals = [...map.entries()].map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total)
  const mixed = totals.length > 1
  return {
    totals,
    mixed,
    withBudget,
    total: totals.length === 1 ? totals[0].total : null,
    currency: totals.length === 1 ? totals[0].currency : null,
  }
}

/** Groups whose parent_group names a group that is not in the register. */
export function orphanGroups(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const names = new Set(list.map((r) => key(r?.group_name)).filter(Boolean))
  return list.filter((r) => {
    const p = key(r?.parent_group)
    return p && p !== key(r?.group_name) && !names.has(p)
  })
}

/** Names that appear on more than one row (the tree keeps only the last). */
export function duplicateNames(rows = []) {
  const counts = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const n = key(r?.group_name)
    if (n) counts.set(n, (counts.get(n) || 0) + 1)
  }
  return [...counts.entries()].filter(([, c]) => c > 1).map(([name, count]) => ({ name, count }))
}

/** Count + assets per group type, largest first. */
export function typeBreakdown(rows = []) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = r?.group_type || ''
    const prev = map.get(t) || { type: t, label: groupTypeLabel(t), count: 0, assets: 0, assetsKnown: 0 }
    prev.count += 1
    const a = toFiniteNumber(r?.asset_count)
    if (a != null && a > 0) { prev.assets += a; prev.assetsKnown += 1 }
    map.set(t, prev)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** KPI strip. Every count is honest; unmeasured sizes are null. */
export function buildGroupKpis(rows = [], fallbackCurrency = '') {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => key(r?.group_name))
  const total = list.length
  const active = list.filter((r) => r?.active !== false).length
  const names = new Set(list.map((r) => key(r.group_name)))
  const roots = list.filter((r) => {
    const p = key(r.parent_group)
    return !p || p === key(r.group_name) || !names.has(p)
  }).length
  let assets = 0
  let assetsKnown = 0
  let maxDepth = 0
  for (const r of list) {
    const a = toFiniteNumber(r.asset_count)
    if (a != null) { assetsKnown += 1; if (a > 0) assets += a }
    const d = depthOf(list, r.group_name)
    if (d != null && d > maxDepth) maxDepth = d
  }
  const budget = budgetByCurrency(list, fallbackCurrency)
  return {
    total,
    active,
    inactive: total - active,
    roots,
    maxDepth: total ? maxDepth : null,
    totalAssets: assetsKnown ? assets : null,
    assetCoverage: total ? assetsKnown / total : null,
    budget,
    budgetCoverage: total ? budget.withBudget / total : null,
    orphans: orphanGroups(list).length,
  }
}

/** Plain-language findings, most important first. Empty when nothing to say. */
export function buildGroupInsights(rows = [], fallbackCurrency = '') {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return []
  const k = buildGroupKpis(list, fallbackCurrency)
  const out = []
  const orphans = orphanGroups(list)
  if (orphans.length) {
    out.push(`${orphans.length} group(s) name a parent that is not in the register, so they show as top level: ${orphans.slice(0, 4).map((r) => r.group_name).join(', ')}${orphans.length > 4 ? ' and more' : ''}.`)
  }
  const dups = duplicateNames(list)
  if (dups.length) out.push(`${dups.length} group name(s) are used more than once. The hierarchy keeps only one of each: ${dups.slice(0, 3).map((d) => d.name).join(', ')}.`)
  if (k.budget.mixed) out.push(`Budgets are recorded in ${k.budget.totals.length} currencies, so no single total is shown.`)
  if (k.assetCoverage != null && k.assetCoverage < 1) {
    const missing = k.total - Math.round(k.assetCoverage * k.total)
    out.push(`${missing} group(s) have no asset count, so roll-ups understate the fleet.`)
  }
  if (k.inactive > 0) out.push(`${k.inactive} group(s) are marked inactive.`)
  return out
}

export const GROUP_EXPORT_COLUMNS = [
  { key: 'group_name', header: 'Group' },
  { key: 'group_code', header: 'Code' },
  { key: 'type', header: 'Type' },
  { key: 'parent_group', header: 'Parent' },
  { key: 'depth', header: 'Depth' },
  { key: 'manager', header: 'Manager' },
  { key: 'region', header: 'Region' },
  { key: 'own_assets', header: 'Own assets' },
  { key: 'rolled_assets', header: 'Rolled-up assets' },
  { key: 'active', header: 'Active' },
  { key: 'budget', header: 'Budget' },
  { key: 'currency', header: 'Currency' },
]

/** Rows shaped for exportUtils; blanks are '' so the sheet never shows 0 for unknown. */
export function groupExportRows(rows = [], all = rows, fallbackCurrency = '') {
  return groupRegisterRows(rows, all).map((r) => ({
    group_name: r.group_name || '',
    group_code: r.group_code || '',
    type: r.group_type ? r.typeLabel : '',
    parent_group: r.parent_group || '',
    depth: r.depth ?? '',
    manager: r.manager || '',
    region: r.region || '',
    own_assets: r.ownAssets ?? '',
    rolled_assets: r.rolledAssets,
    active: r.isActive ? 'Yes' : 'No',
    budget: r.budgetValue ?? '',
    currency: r.budgetValue == null ? '' : (r.currency || fallbackCurrency || ''),
  }))
}
