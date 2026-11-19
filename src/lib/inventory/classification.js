/**
 * ABC (value), FSN (movement) and VED (criticality) classification. Pure.
 * Method and thresholds: docs/inventory/23_CLASSIFICATION_ABC_FSN_VED.md
 *
 * Rules:
 * - ABC ranks consumption value, which only makes sense inside ONE currency, so
 *   ranking is done per (scope, currency). Never across currencies.
 * - Thresholds are configurable per company / category / location via a
 *   resolver; the most specific configured scope wins.
 * - An item whose value or movement cannot be measured is 'unclassified' with a
 *   reason. It is never silently pushed into C or N.
 * - VED comes only from recorded criticality. Unset -> 'unassessed', never D.
 * - A Vital item that does not move is a critical insurance spare, not dead stock.
 */
import { num } from './valuation'

export const DEFAULT_THRESHOLDS = Object.freeze({
  abc: { a: 0.8, b: 0.95 }, // cumulative share of consumption value
  fsn: { fastMonths: 6, windowMonths: 12 }, // months with at least one issue, out of the window
})

/**
 * Pick thresholds for an item: most specific configured scope wins.
 * config = { default, byCompany: {orgId}, byCategory: {cat}, byLocation: {locId} }
 * Order: location > category > company > default > built-in.
 */
export function thresholdsFor(item = {}, config = {}) {
  const pick = (k) =>
    (item.location_id && config.byLocation?.[item.location_id]?.[k]) ||
    (item.category && config.byCategory?.[String(item.category).toLowerCase()]?.[k]) ||
    (item.organisation_id && config.byCompany?.[item.organisation_id]?.[k]) ||
    config.default?.[k] ||
    DEFAULT_THRESHOLDS[k]
  const abc = { ...DEFAULT_THRESHOLDS.abc, ...pick('abc') }
  const fsn = { ...DEFAULT_THRESHOLDS.fsn, ...pick('fsn') }
  return { abc, fsn }
}

export function validateThresholds(t = {}) {
  const errors = []
  const a = num(t.abc?.a)
  const b = num(t.abc?.b)
  if (a === null || a <= 0 || a >= 1) errors.push('abc.a must be between 0 and 1')
  if (b === null || b <= 0 || b > 1) errors.push('abc.b must be between 0 and 1')
  if (a !== null && b !== null && b <= a) errors.push('abc.b must be greater than abc.a')
  const f = num(t.fsn?.fastMonths)
  const w = num(t.fsn?.windowMonths)
  if (w === null || w < 1) errors.push('fsn.windowMonths must be at least 1')
  if (f === null || f < 1 || (w !== null && f > w)) errors.push('fsn.fastMonths must be between 1 and windowMonths')
  return { ok: errors.length === 0, errors }
}

const scopeOf = (it, scopeBy) => {
  if (typeof scopeBy === 'function') return String(scopeBy(it) ?? 'all')
  if (!scopeBy || scopeBy === 'company') return String(it.organisation_id ?? 'all')
  return `${it.organisation_id ?? 'all'}|${it[scopeBy] ?? 'none'}`
}

/**
 * ABC by consumption value.
 * items: [{ item_id, organisation_id, category, location_id, currency, consumptionValue }]
 * options: { config, scopeBy: 'company' | 'category' | 'location_id' | fn }
 * Returns rows with { abc, reason, share, cumulativeShare, scope }.
 */
export function classifyAbc(items = [], { config = {}, scopeBy = 'company' } = {}) {
  const groups = new Map()
  const result = []
  for (const it of items) {
    const v = num(it.consumptionValue)
    const cur = String(it.currency ?? '').trim().toUpperCase()
    if (v === null) {
      result.push({ ...it, abc: 'unclassified', reason: 'consumption_value_unknown' })
      continue
    }
    if (!cur) {
      result.push({ ...it, abc: 'unclassified', reason: 'currency_unknown' })
      continue
    }
    const key = `${scopeOf(it, scopeBy)}|${cur}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(it)
  }
  for (const [key, list] of groups) {
    const total = list.reduce((s, it) => s + Math.max(0, num(it.consumptionValue)), 0)
    const sorted = [...list].sort((x, y) => num(y.consumptionValue) - num(x.consumptionValue) || String(x.item_id).localeCompare(String(y.item_id)))
    let cum = 0
    for (const it of sorted) {
      const v = Math.max(0, num(it.consumptionValue))
      if (total <= 0 || v <= 0) {
        result.push({ ...it, abc: 'C', reason: 'no_consumption_in_period', share: 0, cumulativeShare: null, scope: key })
        continue
      }
      const t = thresholdsFor(it, config).abc
      const prior = cum
      cum += v / total
      // An item is A if the cumulative share BEFORE it is still under the A cut,
      // so the item that crosses the line is included (standard Pareto reading).
      const abc = prior < t.a ? 'A' : prior < t.b ? 'B' : 'C'
      result.push({ ...it, abc, reason: null, share: v / total, cumulativeShare: Math.min(1, cum), scope: key })
    }
  }
  return result
}

const monthKey = (d) => {
  const t = Date.parse(d)
  if (!Number.isFinite(t)) return null
  const x = new Date(t)
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * FSN by movement frequency: months (in the window) with at least one issue.
 * items: [{ item_id, createdAt, issueDates: [iso...], category, location_id, organisation_id }]
 * options: { now, ledgerStartAt, config }
 * F: >= fastMonths active months; S: >= 1; N: 0 issues across the full window.
 * Item younger than the window, or ledger shorter than it, with no issue: 'unclassified'.
 */
export function classifyFsn(items = [], { now, ledgerStartAt = null, config = {} } = {}) {
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) return items.map((it) => ({ ...it, fsn: 'unclassified', reason: 'now_required' }))
  const ledgerMs = ledgerStartAt ? Date.parse(ledgerStartAt) : null
  return items.map((it) => {
    const t = thresholdsFor(it, config).fsn
    const windowStart = new Date(nowMs)
    windowStart.setUTCMonth(windowStart.getUTCMonth() - t.windowMonths)
    const ws = windowStart.getTime()
    const months = new Set()
    for (const d of it.issueDates || []) {
      const ms = Date.parse(d)
      if (!Number.isFinite(ms) || ms < ws || ms > nowMs) continue
      months.add(monthKey(d))
    }
    const activeMonths = months.size
    const created = it.createdAt ? Date.parse(it.createdAt) : null
    if (activeMonths >= t.fastMonths) return { ...it, fsn: 'F', activeMonths, reason: null }
    if (activeMonths >= 1) return { ...it, fsn: 'S', activeMonths, reason: null }
    if (created !== null && Number.isFinite(created) && created > ws) return { ...it, fsn: 'unclassified', activeMonths, reason: 'item_younger_than_window' }
    if (ledgerMs === null || !Number.isFinite(ledgerMs) || ledgerMs > ws) return { ...it, fsn: 'unclassified', activeMonths, reason: 'ledger_shorter_than_window' }
    return { ...it, fsn: 'N', activeMonths, reason: null }
  })
}

const VED_MAP = {
  v: 'V', vital: 'V', critical: 'V', safety_critical: 'V',
  e: 'E', essential: 'E', high: 'E', important: 'E',
  d: 'D', desirable: 'D', low: 'D', normal: 'D',
}

/** VED from the recorded criticality only. */
export function classifyVed(item = {}) {
  const raw = String(item.criticality ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!raw) return { ved: 'unassessed', reason: 'criticality_not_recorded' }
  const v = VED_MAP[raw]
  return v ? { ved: v, reason: null } : { ved: 'unassessed', reason: 'criticality_not_recognised' }
}

/**
 * Combine the three into a stock disposition used by planning and reports.
 * - V + non-moving   -> 'critical_insurance_spare' (keep; never written off as dead)
 * - V + slow         -> 'critical_slow_mover'
 * - E/D/unassessed + non-moving -> 'dead_stock_candidate' (review, never auto-write-off)
 * - slow             -> 'slow_mover'
 * - fast             -> 'active'
 * - unclassified movement -> 'insufficient_history'
 */
export function stockDisposition({ fsn, ved } = {}) {
  if (fsn === 'unclassified' || !fsn) return 'insufficient_history'
  if (ved === 'V') return fsn === 'N' ? 'critical_insurance_spare' : fsn === 'S' ? 'critical_slow_mover' : 'active'
  if (fsn === 'N') return 'dead_stock_candidate'
  if (fsn === 'S') return 'slow_mover'
  return 'active'
}

/** Classify a set of items on all three axes plus the disposition. */
export function classifyItems(items = [], { now, ledgerStartAt, config = {}, scopeBy = 'company' } = {}) {
  const abc = new Map(classifyAbc(items, { config, scopeBy }).map((r) => [r.item_id, r]))
  const fsn = new Map(classifyFsn(items, { now, ledgerStartAt, config }).map((r) => [r.item_id, r]))
  return items.map((it) => {
    const a = abc.get(it.item_id)
    const f = fsn.get(it.item_id)
    const v = classifyVed(it)
    return {
      item_id: it.item_id,
      abc: a?.abc ?? 'unclassified',
      abcReason: a?.reason ?? null,
      fsn: f?.fsn ?? 'unclassified',
      fsnReason: f?.reason ?? null,
      activeMonths: f?.activeMonths ?? null,
      ved: v.ved,
      vedReason: v.reason,
      disposition: stockDisposition({ fsn: f?.fsn, ved: v.ved }),
    }
  })
}

/** Counts per class for a summary tile (matrix ABC x VED included). */
export function classificationMatrix(rows = []) {
  const matrix = {}
  const counts = { abc: {}, fsn: {}, ved: {}, disposition: {} }
  for (const r of rows) {
    counts.abc[r.abc] = (counts.abc[r.abc] || 0) + 1
    counts.fsn[r.fsn] = (counts.fsn[r.fsn] || 0) + 1
    counts.ved[r.ved] = (counts.ved[r.ved] || 0) + 1
    counts.disposition[r.disposition] = (counts.disposition[r.disposition] || 0) + 1
    const k = `${r.abc}${r.ved}`
    matrix[k] = (matrix[k] || 0) + 1
  }
  return { counts, matrix }
}
