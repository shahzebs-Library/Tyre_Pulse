/**
 * maintenanceCostBoardAnalytics.js - pure shaping for the Maintenance Cost &
 * Tasks board's detail register (src/pages/MaintenanceCostBoard.jsx).
 *
 * The chart shapers live in maintenanceBoard.js; this module owns the TABLE side:
 * one flat register built from every breakdown the `get_maintenance_snapshot`
 * aggregate returns (tasks, corrective actions, work types, sites, assets), the
 * search/type/site filter over it, and the derived share-of-spend figures shown
 * in the KPI strip. No I/O, no React, no colours.
 *
 * Honesty rules:
 *   - a count or spend the snapshot did not carry is null (renders N/A), never 0
 *   - a share of spend is null when the total spend is unknown or zero
 *   - no em/en dashes in any output string
 */

const arr = (v) => (Array.isArray(v) ? v : [])
const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const label = (v) => {
  const s = v == null ? '' : String(v).trim()
  return s || 'Not recorded'
}

export const DETAIL_TYPES = Object.freeze([
  { value: 'task', label: 'Task' },
  { value: 'action', label: 'Corrective action' },
  { value: 'work_type', label: 'Work type' },
  { value: 'site', label: 'Site' },
  { value: 'asset', label: 'Asset' },
])
export const DETAIL_TYPE_LABEL = Object.freeze(Object.fromEntries(DETAIL_TYPES.map((t) => [t.value, t.label])))

/** Sum of a spend column; null when no row carries a numeric spend. */
function spendTotal(rows) {
  let sum = 0
  let seen = false
  for (const r of rows) {
    const n = numOrNull(r?.spend)
    if (n != null) { sum += n; seen = true }
  }
  return seen ? sum : null
}

function sharePct(part, total) {
  if (part == null || total == null || total <= 0) return null
  return Math.round((part / total) * 1000) / 10
}

/**
 * One flat register over every breakdown in the snapshot. Each row:
 *   { id, type, name, site, jobs, occurrences, spend, sharePct }
 * `sharePct` is the row's share of the spend total OF ITS OWN BREAKDOWN (a site
 * row against all sites), so shares within one type add up to 100.
 */
export function buildDetailRows(snapshot) {
  if (!snapshot || snapshot.ok === false) return []
  const out = []
  const push = (type, rows, map) => {
    const list = arr(rows)
    const total = spendTotal(list)
    list.forEach((r, i) => {
      const base = map(r)
      out.push({
        id: `${type}-${i}-${base.name}`,
        type,
        site: '',
        jobs: null,
        occurrences: null,
        spend: null,
        ...base,
        sharePct: sharePct(base.spend ?? null, total),
      })
    })
  }
  push('task', snapshot.top_tasks, (r) => ({ name: label(r?.label), occurrences: numOrNull(r?.n) }))
  push('action', snapshot.top_actions, (r) => ({ name: label(r?.label), occurrences: numOrNull(r?.n) }))
  push('work_type', snapshot.by_work_type, (r) => ({ name: label(r?.label), jobs: numOrNull(r?.jobs), spend: numOrNull(r?.spend) }))
  push('site', snapshot.spend_by_site, (r) => ({ name: label(r?.label), site: label(r?.label), jobs: numOrNull(r?.jobs), spend: numOrNull(r?.spend) }))
  push('asset', snapshot.spend_by_asset, (r) => ({ name: label(r?.label), jobs: numOrNull(r?.jobs), spend: numOrNull(r?.spend) }))
  return out
}

/** Distinct site names present on site rows, sorted. */
export function detailSiteOptions(rows) {
  return [...new Set(arr(rows).map((r) => r.site).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** Search (name/site/type label) + exact type + exact site. */
export function filterDetails(rows, { q = '', rowType = '', site = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase()
  return arr(rows).filter((r) => {
    if (rowType && r.type !== rowType) return false
    if (site && r.site !== site) return false
    if (!needle) return true
    return `${r.name} ${r.site} ${DETAIL_TYPE_LABEL[r.type] || ''}`.toLowerCase().includes(needle)
  })
}

/** Count of rows per detail type, for the filter options. */
export function detailTypeCounts(rows) {
  const counts = Object.fromEntries(DETAIL_TYPES.map((t) => [t.value, 0]))
  for (const r of arr(rows)) if (counts[r.type] != null) counts[r.type] += 1
  return counts
}

/**
 * Derived board insights for the KPI strip:
 *   repairSharePct   repair work type spend / all work type spend
 *   tyreLineSharePct tyre-related lines / all line items
 *   topSite / topSiteSharePct   the highest-spend site and its share
 *   openJobSharePct  open job cards / all job cards
 */
export function boardInsights(snapshot) {
  const empty = { repairSharePct: null, tyreLineSharePct: null, topSite: null, topSiteSharePct: null, openJobSharePct: null }
  if (!snapshot || snapshot.ok === false) return empty
  const k = snapshot.kpis || {}
  const byType = arr(snapshot.by_work_type)
  const typeTotal = spendTotal(byType)
  const repair = byType.filter((r) => /repair/i.test(String(r?.label || '')))
  const repairSpend = repair.length ? spendTotal(repair) : null

  const sites = arr(snapshot.spend_by_site)
  const siteTotal = spendTotal(sites)
  let top = null
  for (const r of sites) {
    const s = numOrNull(r?.spend)
    if (s != null && (top == null || s > top.spend)) top = { name: label(r?.label), spend: s }
  }

  const lines = numOrNull(k.line_items)
  const tyre = numOrNull(k.tyre_lines)
  const jobs = numOrNull(k.job_cards)
  const open = numOrNull(k.open_jobs)
  return {
    repairSharePct: repair.length ? sharePct(repairSpend, typeTotal) : null,
    tyreLineSharePct: lines && lines > 0 && tyre != null ? Math.round((tyre / lines) * 1000) / 10 : null,
    topSite: top ? top.name : null,
    topSiteSharePct: top ? sharePct(top.spend, siteTotal) : null,
    openJobSharePct: jobs && jobs > 0 && open != null ? Math.round((open / jobs) * 1000) / 10 : null,
  }
}
