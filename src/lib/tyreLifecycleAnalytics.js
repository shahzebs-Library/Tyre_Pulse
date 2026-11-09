/**
 * tyreLifecycleAnalytics - pure engine behind the Tyre Lifecycle page.
 *
 * Every figure is measured on the rows that can support it and returns null
 * (rendered N/A) when nothing can: a fleet with no removal km has no average
 * life, a register with no priced tyres has no cost per km. Nothing here reads
 * the clock or the network.
 *
 * Tyre LIFE, CPK, km bands and brand life are measured per PHYSICAL TYRE via the
 * shared lifetime layer (tyreLifetime.js): rows are collapsed first, then the
 * tyres are grouped, so one tyre refitted on three vehicles is one tyre with
 * its km summed and its price counted once. Stage counts and the register rows
 * stay per FITMENT on purpose (they describe fitment events); their money uses
 * withOnePricePerTyre so a refit is never a second purchase.
 */
import {
  toLifetimeTyres, withOnePricePerTyre, fitmentKm, weightedCpk, lifetimeSummary,
  CPK_KIND, CPK_KIND_LABEL,
} from './tyreLifetime'

export const KM_BANDS = [
  { label: '0-20k', min: 0, max: 20000 },
  { label: '20-40k', min: 20000, max: 40000 },
  { label: '40-60k', min: 40000, max: 60000 },
  { label: '60-80k', min: 60000, max: 80000 },
  { label: '80-100k', min: 80000, max: 100000 },
  { label: '100k+', min: 100000, max: Infinity },
]

export const CATEGORIES = ['New', 'Retread', 'Repaired', 'Scrap']

export const STAGES = ['In Service', 'Removed', 'Retread Eligible', 'Retreaded', 'Scrapped']

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null)

/**
 * km ONE fitment ran, by the shared km rule (tyreKm.js): placeholder fitment
 * km 1 and over-cap readings are unknown, a factory 0 fitment is real. Null
 * when not measurable.
 */
export function kmRun(r) {
  const v = fitmentKm(r)
  return v != null && v > 0 ? v : null
}

/** The page reads serial_no as serial_number; the lifetime layer keys on serial_no. */
const asTyreRow = (r) => (r && r.serial_no == null && r.serial_number != null ? { ...r, serial_no: r.serial_number } : r)

/** Physical tyres behind a set of fitment rows (shared lifetime layer). */
export function lifecycleTyres(records = []) {
  return toLifetimeTyres((records || []).map(asTyreRow))
}

const tyreQty = (t) => t._qty || 1
/** Mean life over physical tyres with a measured life (total km / tyre count). */
function meanLife(tyres) {
  let km = 0; let n = 0
  for (const t of tyres) {
    if (t._life_km == null || !(t._life_km > 0)) continue
    km += t._life_km * tyreQty(t); n += tyreQty(t)
  }
  return n ? km / n : null
}
const measuredCount = (tyres) => tyres.reduce((a, t) => a + (t._life_km != null && t._life_km > 0 ? tyreQty(t) : 0), 0)

/** Per-FITMENT cost per km (one stint), null unless it has both a price and a measured run. */
export function cpk(r) {
  const km = kmRun(r)
  const c = num(r?.cost_per_tyre)
  if (!km || !c || c <= 0) return null
  return c / km
}

export function isRemoved(r) {
  return num(r?.km_at_removal) != null || Boolean(r?.removal_date)
}

export function isScrapped(r) {
  return r?.category === 'Scrap' || (r?.risk_level === 'Critical' && isRemoved(r))
}

export function lifecycleStage(r) {
  if (isScrapped(r)) return 'Scrapped'
  if (r?.category === 'Retread') return 'Retreaded'
  const tread = num(r?.tread_depth)
  if (isRemoved(r) && tread != null && tread >= 3) return 'Retread Eligible'
  if (isRemoved(r)) return 'Removed'
  return 'In Service'
}

function lineCost(r) {
  const c = num(r?.cost_per_tyre)
  if (c == null || c <= 0) return null
  const q = num(r?.qty)
  return c * (q != null && q > 0 ? q : 1)
}

const lc = (v) => (v == null ? '' : String(v).toLowerCase())

/** Search (serial / asset / brand) + brand, site, category and stage filters. */
export function filterLifecycle(records = [], { search = '', brand = '', site = '', category = '', stage = '' } = {}) {
  const q = search.trim().toLowerCase()
  return records.filter(r => {
    if (q && !(lc(r.serial_number).includes(q) || lc(r.asset_no).includes(q) || lc(r.brand).includes(q))) return false
    if (brand && r.brand !== brand) return false
    if (site && r.site !== site) return false
    if (category && (r.category || 'New') !== category) return false
    if (stage && lifecycleStage(r) !== stage) return false
    return true
  })
}

/** Distinct sorted non-blank values of a field. */
export function distinct(records = [], field) {
  return [...new Set(records.map(r => r?.[field]).filter(v => v != null && String(v).trim() !== ''))]
    .sort((a, b) => String(a).localeCompare(String(b)))
}

/**
 * Headline KPIs over the filtered rows. Life and CPK are per PHYSICAL TYRE:
 * avgLifeKm = total lifetime km / measured tyres; avgCpk is the WEIGHTED fleet
 * aggregate (total purchase cost / total km of the measurable tyres), never an
 * average of per-tyre ratios. `records` and stage counts stay per fitment.
 */
export function lifecycleKpis(records = []) {
  const total = records.length
  const serials = new Set(records.map(r => r.serial_number).filter(Boolean))
  const tyres = lifecycleTyres(records)
  const summary = lifetimeSummary(tyres)
  const removed = records.filter(isRemoved).length
  const categorised = records.filter(r => r.category).length
  const retreads = records.filter(r => r.category === 'Retread').length
  const scrapped = records.filter(isScrapped).length
  return {
    records: total,
    tyres: tyres.reduce((a, t) => a + tyreQty(t), 0),
    serials: serials.size,
    missingSerial: records.filter(r => !r.serial_number).length,
    avgLifeKm: meanLife(tyres),
    measuredLife: measuredCount(tyres),
    avgCpk: weightedCpk(tyres),
    measuredCpk: summary.measurable,
    cpkKind: CPK_KIND.FLEET_AGGREGATE,
    cpkKindLabel: CPK_KIND_LABEL[CPK_KIND.FLEET_AGGREGATE],
    kmCoverage: summary.coverage,
    provisionalTyres: summary.provisional,
    estimatedCostShare: summary.estimatedShare,
    inService: total - removed,
    removed,
    // Retread share is only meaningful among rows that carry a category.
    retreadRate: categorised ? (retreads / categorised) * 100 : null,
    categorised,
    scrapRate: removed ? (scrapped / removed) * 100 : null,
    scrapped,
  }
}

/** Stage counts, share and average priced cost per stage. */
export function stageFunnel(records = []) {
  const total = records.length
  // Stages are fitment events; the price is the purchase kept once per tyre.
  const priced = withOnePricePerTyre(records.map(asTyreRow))
  return STAGES.map(stage => {
    const rows = priced.filter(r => lifecycleStage(r) === stage)
    const costs = rows.map(r => num(r.cost_per_tyre)).filter(v => v != null && v > 0)
    return {
      stage,
      count: rows.length,
      pct: total ? (rows.length / total) * 100 : null,
      avgCost: mean(costs),
      priced: costs.length,
    }
  })
}

/**
 * Average lifetime km per brand, split new vs retread, per PHYSICAL TYRE: the
 * rows are collapsed into tyres first and each tyre is grouped by its latest
 * fitment's brand/category. Top `limit` by overall average. `samples` = tyres.
 */
export function brandLife(records = [], limit = 12) {
  const map = new Map()
  for (const t of lifecycleTyres(records)) {
    if (!t.brand) continue
    if (t._life_km == null || !(t._life_km > 0)) continue
    if (!map.has(t.brand)) map.set(t.brand, { newT: [], retreadT: [] })
    ;(t.category === 'Retread' ? map.get(t.brand).retreadT : map.get(t.brand).newT).push(t)
  }
  return [...map.entries()]
    .map(([brand, d]) => ({
      brand,
      newAvg: meanLife(d.newT),
      retreadAvg: meanLife(d.retreadT),
      totalAvg: meanLife([...d.newT, ...d.retreadT]),
      samples: measuredCount([...d.newT, ...d.retreadT]),
    }))
    .sort((a, b) => b.totalAvg - a.totalAvg || a.brand.localeCompare(b.brand))
    .slice(0, limit)
}

/** Priced spend by stage category. Null total when nothing is priced. */
export function costByCategory(records = []) {
  const buckets = [
    { key: 'new', label: 'New tyres', test: r => !r.category || r.category === 'New' },
    { key: 'retread', label: 'Retreads', test: r => r.category === 'Retread' },
    { key: 'repair', label: 'Repairs', test: r => r.category === 'Repaired' },
    { key: 'scrap', label: 'Scrapped', test: r => r.category === 'Scrap' },
  ]
  // One tyre one price: a refit row of a real serial carries no purchase.
  const oneprice = withOnePricePerTyre(records.map(asTyreRow))
  const out = buckets.map(b => {
    const costs = oneprice.filter(b.test).map(lineCost).filter(v => v != null)
    return { key: b.key, label: b.label, total: costs.reduce((s, v) => s + v, 0), priced: costs.length }
  })
  const priced = out.reduce((s, b) => s + b.priced, 0)
  return { buckets: out, total: priced ? out.reduce((s, b) => s + b.total, 0) : null, priced }
}

/** Count of measured PHYSICAL tyres per lifetime-km band. */
export function kmBandCounts(records = []) {
  const counts = KM_BANDS.map(() => 0)
  for (const t of lifecycleTyres(records)) {
    const km = t._life_km
    if (km == null || !(km > 0)) continue
    const i = KM_BANDS.findIndex(b => km >= b.min && km < b.max)
    if (i >= 0) counts[i] += tyreQty(t)
  }
  return KM_BANDS.map((b, i) => ({ label: b.label, count: counts[i] }))
}

/**
 * Table rows (one per FITMENT) with the derived fields attached once. `_cpk`
 * is a PER-FITMENT CPK (`_cpkKind`): the purchase sits on the tyre's first
 * priced fitment only, so a refit row has no CPK.
 */
export function lifecycleRows(records = []) {
  const priced = withOnePricePerTyre(records.map(asTyreRow))
  return records.map((r, i) => ({
    ...r,
    _km: kmRun(r),
    _cpk: cpk(priced[i]),
    // Purchase on this fitment row: null on a refit of a real serial (bought once).
    _cost: num(priced[i]?.cost_per_tyre) != null && num(priced[i].cost_per_tyre) > 0 ? num(priced[i].cost_per_tyre) : null,
    _cpkKind: CPK_KIND.PER_FITMENT,
    _stage: lifecycleStage(r),
    _category: r.category || 'New',
  }))
}

export const EXPORT_COLS = [
  'serial_number', 'brand', 'size', 'position', 'asset_no', 'site', 'issue_date',
  'removal_date', 'km_run', 'category', 'cost', 'cpk', 'stage',
]
export const EXPORT_HEADERS = [
  'Serial', 'Brand', 'Size', 'Position', 'Asset', 'Site', 'Fitment date',
  'Removal date', 'km run', 'Category', 'Cost per tyre', 'Cost per km (per fitment)', 'Stage',
]

export function lifecycleExportRows(records = []) {
  return lifecycleRows(records).map(r => ({
    serial_number: r.serial_number || 'N/A',
    brand: r.brand || 'N/A',
    size: r.size || 'N/A',
    position: r.position || 'N/A',
    asset_no: r.asset_no || 'N/A',
    site: r.site || 'N/A',
    issue_date: r.issue_date || 'N/A',
    removal_date: r.removal_date || (isRemoved(r) ? 'Not recorded' : 'In service'),
    km_run: r._km ?? 'N/A',
    category: r._category,
    cost: r._cost ?? 'N/A',
    cpk: r._cpk != null ? Number(r._cpk.toFixed(4)) : 'N/A',
    stage: r._stage,
  }))
}
