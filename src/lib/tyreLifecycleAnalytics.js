/**
 * tyreLifecycleAnalytics - pure engine behind the Tyre Lifecycle page.
 *
 * Every figure is measured on the rows that can support it and returns null
 * (rendered N/A) when nothing can: a fleet with no removal km has no average
 * life, a register with no priced tyres has no cost per km. Nothing here reads
 * the clock or the network.
 */

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

/** km a tyre ran (removal minus fitment), null when either reading is missing or not positive. */
export function kmRun(r) {
  const f = num(r?.km_at_fitment)
  const x = num(r?.km_at_removal)
  if (f == null || x == null) return null
  const v = x - f
  return v > 0 ? v : null
}

/** Cost per km for one tyre, null unless it has both a price and a measured run. */
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

/** Headline KPIs over the filtered rows. */
export function lifecycleKpis(records = []) {
  const total = records.length
  const serials = new Set(records.map(r => r.serial_number).filter(Boolean))
  const lives = records.map(kmRun).filter(v => v != null)
  const cpks = records.map(cpk).filter(v => v != null)
  const removed = records.filter(isRemoved).length
  const categorised = records.filter(r => r.category).length
  const retreads = records.filter(r => r.category === 'Retread').length
  const scrapped = records.filter(isScrapped).length
  return {
    records: total,
    serials: serials.size,
    missingSerial: records.filter(r => !r.serial_number).length,
    avgLifeKm: mean(lives),
    measuredLife: lives.length,
    avgCpk: mean(cpks),
    measuredCpk: cpks.length,
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
  return STAGES.map(stage => {
    const rows = records.filter(r => lifecycleStage(r) === stage)
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

/** Average measured km per brand, split new vs retread. Top `limit` by overall average. */
export function brandLife(records = [], limit = 12) {
  const map = new Map()
  for (const r of records) {
    if (!r.brand) continue
    const km = kmRun(r)
    if (km == null) continue
    if (!map.has(r.brand)) map.set(r.brand, { newKm: [], retreadKm: [] })
    ;(r.category === 'Retread' ? map.get(r.brand).retreadKm : map.get(r.brand).newKm).push(km)
  }
  return [...map.entries()]
    .map(([brand, d]) => ({
      brand,
      newAvg: mean(d.newKm),
      retreadAvg: mean(d.retreadKm),
      totalAvg: mean([...d.newKm, ...d.retreadKm]),
      samples: d.newKm.length + d.retreadKm.length,
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
  const out = buckets.map(b => {
    const costs = records.filter(b.test).map(lineCost).filter(v => v != null)
    return { key: b.key, label: b.label, total: costs.reduce((s, v) => s + v, 0), priced: costs.length }
  })
  const priced = out.reduce((s, b) => s + b.priced, 0)
  return { buckets: out, total: priced ? out.reduce((s, b) => s + b.total, 0) : null, priced }
}

/** Count of measured tyres per km band. */
export function kmBandCounts(records = []) {
  const counts = KM_BANDS.map(() => 0)
  for (const r of records) {
    const km = kmRun(r)
    if (km == null) continue
    const i = KM_BANDS.findIndex(b => km >= b.min && km < b.max)
    if (i >= 0) counts[i] += 1
  }
  return KM_BANDS.map((b, i) => ({ label: b.label, count: counts[i] }))
}

/** Table rows with the derived fields attached once. */
export function lifecycleRows(records = []) {
  return records.map(r => ({
    ...r,
    _km: kmRun(r),
    _cpk: cpk(r),
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
  'Removal date', 'km run', 'Category', 'Cost per tyre', 'Cost per km', 'Stage',
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
    cost: num(r.cost_per_tyre) ?? 'N/A',
    cpk: r._cpk != null ? Number(r._cpk.toFixed(4)) : 'N/A',
    stage: r._stage,
  }))
}
