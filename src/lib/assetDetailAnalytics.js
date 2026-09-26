/**
 * assetDetailAnalytics - pure calculations behind the Asset Detail page
 * (/asset-management/:assetNo).
 *
 * Identity: an asset is country + asset_no. The same code in two countries is
 * two different machines (V376), so nothing here merges rows across countries;
 * the cross-country rollup keeps each country in its own currency and never
 * produces a total.
 *
 * Pure, no I/O, `now` injectable. Honest nulls: an unmeasured figure is null
 * (printed N/A), never a fabricated zero.
 */
import { severityRank } from './severity'
import { isOpenWoStatus, normalizeWoStatus } from './workOrderStatus'

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** The worst risk band among tyres, or null when none carries a rating. */
export function worstRisk(tyres = []) {
  let best = null
  for (const t of tyres || []) {
    if (t?.risk_level && (best === null || severityRank(t.risk_level) > severityRank(best))) best = t.risk_level
  }
  return best
}

/** Tyres still on the vehicle: no removal meter reading recorded. */
export function activeTyresOf(tyres = []) {
  return (tyres || []).filter((t) => t && (t.km_at_removal == null || t.km_at_removal === ''))
}

const lineCost = (t) => {
  const c = num(t?.cost_per_tyre)
  if (c == null) return null
  const q = num(t?.qty)
  return c * (q && q > 0 ? q : 1)
}

/**
 * Tyre spend recorded on tyre_records. `total` is null when NO tyre carries a
 * price, so an unpriced history does not read as a free one.
 */
export function tyreRecordCost(tyres = []) {
  let total = 0
  let priced = 0
  for (const t of tyres || []) {
    const c = lineCost(t)
    if (c == null) continue
    total += c
    priced += 1
  }
  return { total: priced ? total : null, priced, count: (tyres || []).length }
}

/** Open work orders through the one canonical status vocabulary. */
export function countOpenWorkOrders(workOrders = []) {
  return (workOrders || []).filter((w) => w && isOpenWoStatus(w.status)).length
}

/** Work order spend: null when no work order carries a cost. */
export function workOrderSpend(workOrders = []) {
  let total = 0
  let priced = 0
  for (const w of workOrders || []) {
    const c = num(w?.total_cost)
    if (c == null) continue
    total += c
    priced += 1
  }
  return { total: priced ? total : null, priced }
}

/** Canonical work-order status label (legacy lowercase tokens folded). */
export const workOrderStatusLabel = (status) => (status ? normalizeWoStatus(status) : null)

/** Current km: the fleet row's synced value, else the latest logged reading, else null. */
export function currentKmOf(asset, meter) {
  return num(asset?.current_km) ?? num(meter?.odometer?.odometer_km)
}

/**
 * Twelve calendar months ending in the month of `now`, oldest first, with the
 * tyre spend fitted in each. A month with no fitment is a genuine 0 of recorded
 * spend; `priced` says how many fitments carried a price at all.
 */
export function monthlyTyreCost(tyres = [], now = Date.now()) {
  const ref = new Date(now)
  const months = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1)
    months.push({ date: d, year: d.getFullYear(), month: d.getMonth(), cost: 0, fitments: 0 })
  }
  let priced = 0
  for (const t of tyres || []) {
    if (!t?.issue_date) continue
    const td = new Date(t.issue_date)
    if (Number.isNaN(td.getTime())) continue
    const m = months.find((x) => x.year === td.getFullYear() && x.month === td.getMonth())
    if (!m) continue
    m.fitments += 1
    const c = lineCost(t)
    if (c != null) { m.cost += c; priced += 1 }
  }
  return { months, priced }
}

/**
 * Recommendations from the fitted tyres, as keys + counts so the page renders
 * them in its own language. Low tread only counts a MEASURED depth: a blank
 * reading is not "low".
 */
export function tyreRecommendations(activeTyres = []) {
  const list = activeTyres || []
  const out = []
  const critical = list.filter((t) => t?.risk_level === 'Critical').length
  const high = list.filter((t) => t?.risk_level === 'High').length
  const lowTread = list.filter((t) => { const d = num(t?.tread_depth); return d != null && d < 3 }).length
  if (critical) out.push({ level: 'Critical', key: 'recCriticalRisk', count: critical })
  if (high) out.push({ level: 'High', key: 'recHighRisk', count: high })
  if (lowTread) out.push({ level: 'High', key: 'recLowTread', count: lowTread })
  if (!list.length) out.push({ level: 'Medium', key: 'recNoActive', count: 0 })
  if (!out.length) out.push({ level: 'Low', key: 'recAllGood', count: 0 })
  return out
}

/** Severity text to a tone: danger / warning / good, or none when blank. */
export function severityTone(severity) {
  const s = String(severity ?? '').trim().toLowerCase()
  if (!s) return 'none'
  if (['critical', 'high', 'major', 'severe', 'fatal'].includes(s)) return 'danger'
  if (['medium', 'moderate'].includes(s)) return 'warning'
  return 'good'
}

/** The date an inspection happened, falling back through the lifecycle columns. */
export const inspectionDateOf = (ins) => ins?.inspection_date ?? ins?.completed_date ?? ins?.scheduled_date ?? ins?.created_at ?? null

/** Repair cost when recorded, else the estimate, else null (never 0 for "unknown"). */
export function accidentCostOf(ac) {
  const repair = num(ac?.repair_cost)
  if (repair != null && repair > 0) return repair
  const est = num(ac?.estimated_damage_cost)
  if (est != null && est > 0) return est
  return null
}

/** km / h / '' for a PM service meter reading. */
export const serviceMeterUnit = (sv) => (sv?.meter_type === 'engine_hours' ? 'h' : sv?.meter_type === 'odometer' ? 'km' : '')

/** PM plan due-band counts for the KPI strip. */
export function pmDueSummary(pmDueRows = []) {
  const out = { total: 0, overdue: 0, dueSoon: 0, scheduled: 0, undated: 0 }
  for (const r of pmDueRows || []) {
    out.total += 1
    const band = r?.due?.band
    if (band === 'overdue') out.overdue += 1
    else if (band === 'due_soon') out.dueSoon += 1
    else if (band === 'scheduled') out.scheduled += 1
    else out.undated += 1
  }
  return out
}

/**
 * One row per country for the cross-country panel: the fleet rollup (V356)
 * merged with the ownership view (V376). A country in only one source is still
 * shown, with null (N/A) for the other side. Sorted by country; never summed.
 */
export function crossCountryRows(masterRow, ownership, currencyMap = {}) {
  const byCountry = new Map()
  for (const bc of Array.isArray(masterRow?.by_country) ? masterRow.by_country : []) {
    const key = String(bc?.country ?? '')
    if (!key) continue
    byCountry.set(key, {
      country: key,
      tyres: num(bc.tyres), workOrders: num(bc.work_orders), tyreExpense: num(bc.tyre_expense),
      borne: null, currency: currencyMap[key] || null, role: null,
    })
  }
  for (const c of Array.isArray(ownership?.countries) ? ownership.countries : []) {
    const key = c?.country
    if (!key) continue
    const prev = byCountry.get(key) || {
      country: key, tyres: null, workOrders: null, tyreExpense: null,
      borne: null, currency: null, role: null,
    }
    prev.borne = num(c.cost)
    prev.currency = c.currency || prev.currency || currencyMap[key] || null
    prev.role = !ownership?.owningCountry ? 'contested' : c.isOwner ? 'owner' : 'bears'
    byCountry.set(key, prev)
  }
  return [...byCountry.values()].sort((a, b) => a.country.localeCompare(b.country))
}
