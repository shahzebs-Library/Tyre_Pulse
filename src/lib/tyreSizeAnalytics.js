/**
 * tyreSizeAnalytics - pure engine for /tyre-size-analysis.
 *
 * Everything the Tyre Size & Specification Optimizer used to compute inline:
 * per-size metrics, KPI values, size x brand CPK matrix, position compliance,
 * the 12-month size-brand CPK trend and consolidation opportunities.
 * No I/O. The clock is injectable (`now`) so every result is reproducible.
 *
 * HONESTY RULES
 *  - Size labels are folded through the shared `buildSizeCanonicalizer`
 *    (tyreDemandForecast) so "315/80 R 22.5" and "315/80R22.5" are ONE size.
 *    A raw value the canonicaliser cannot place keeps its own trimmed label
 *    rather than being silently merged into "Unknown".
 *  - Failure rate is measured only over tyres that carry a risk rating. A size
 *    with no rated tyres reads null (N/A), not 0% (a perfect record from no data).
 *  - Estimated savings need a measured average life. When a size has none the
 *    saving is null; no 50,000 km default is ever substituted.
 *  - Per-tyre CPK uses tyre_records.cost_per_tyre because that is the per-km
 *    measure. It is never summed into a fleet spend total; that total comes
 *    from the expense grid (loadGovernedCostSplit) on the page.
 *  - PHYSICAL TYRES (src/lib/tyreLifetime.js): rows are collapsed into physical
 *    tyres BEFORE grouping by size/brand (one tyre one price, km summed across
 *    refits, rule T1/T8). Size/brand CPK is WEIGHTED (total cost / total
 *    tyre-km), average life is the mean lifetime km of tyres with a measured
 *    life, counts are physical tyres. Failure rate and position compliance stay
 *    EVENT measures over fitment rows on purpose. calcLife / calcCpk are the
 *    PER-FITMENT primitives (one stint, shared km rule T7).
 */
import { buildSizeCanonicalizer } from './tyreDemandForecast'
import { toLifetimeTyres, tyreKey, fitmentKm, weightedCpk, lifetimeSummary, CPK_KIND, CPK_KIND_LABEL } from './tyreLifetime'

export const BENCHMARK_GOOD = 1.20
export const BENCHMARK_AVG = 1.80
export const MIN_RECORDS_CPK = 5
export const UNKNOWN_SIZE = 'Unknown'

const RATED = new Set(['low', 'medium', 'high', 'critical'])

/** km ONE fitment ran by the shared km rule (T7); null when not measurable. */
export function calcLife(r) {
  const km = fitmentKm(r)
  return km != null && km > 0 ? km : null
}

/** PER-FITMENT CPK (one stint). Aggregates use the physical-tyre helpers below. */
export function calcCpk(r) {
  const km = calcLife(r)
  const cost = Number(r?.cost_per_tyre)
  if (km == null || !Number.isFinite(cost) || cost <= 0) return null
  return cost / km
}

export function avg(arr = []) {
  const clean = arr.filter((v) => v != null && Number.isFinite(v))
  if (!clean.length) return null
  return clean.reduce((s, v) => s + v, 0) / clean.length
}

export function stdFlag(count) {
  if (count >= 6) return 'Standard'
  if (count >= 2) return 'Low Volume'
  return 'Outlier'
}

/** Band for a CPK value: 'good' | 'avg' | 'poor' | null. */
export function cpkBand(cpk) {
  if (cpk == null || !Number.isFinite(cpk)) return null
  if (cpk <= BENCHMARK_GOOD) return 'good'
  if (cpk <= BENCHMARK_AVG) return 'avg'
  return 'poor'
}

/** Build a size labeller over the loaded records (canonical where possible). */
export function makeSizeLabeller(records = []) {
  const canon = buildSizeCanonicalizer((records || []).map((r) => r?.size))
  const cache = new Map()
  return (raw) => {
    const key = raw == null ? '' : String(raw)
    if (cache.has(key)) return cache.get(key)
    const trimmed = key.trim()
    let label
    if (!trimmed) label = UNKNOWN_SIZE
    else {
      const c = canon(trimmed)
      label = c && c !== 'UNKNOWN' ? c : trimmed
    }
    cache.set(key, label)
    return label
  }
}

/** Apply the page filters. `normalizePosition` is injected (tyrePositions). */
export function filterSizeRecords(records = [], f = {}, normalizePosition = (p) => p) {
  const { country = 'All', site = 'All', brand = 'All', position = 'All', from = '', to = '' } = f
  return (records || []).filter((r) => {
    if (country !== 'All' && r.country !== country) return false
    if (site !== 'All' && r.site !== site) return false
    if (brand !== 'All' && r.brand !== brand) return false
    if (position !== 'All' && normalizePosition(r.position) !== position) return false
    if (from && r.issue_date && r.issue_date < from) return false
    if (to && r.issue_date && r.issue_date > to) return false
    return true
  })
}

/** Distinct filter option lists, each led by 'All'. */
export function filterOptionsFor(records = []) {
  const opts = (key) => ['All', ...[...new Set((records || []).map((r) => r[key]).filter(Boolean))].sort()]
  return {
    countries: opts('country'),
    sites: opts('site'),
    brands: opts('brand'),
    positions: ['All', 'Steer', 'Drive', 'Trailer', 'Lift Axle', 'Tag Axle', 'Other'],
  }
}

/** Preset date window ending at `now` (YYYY-MM-DD strings); empty when days is falsy. */
export function datePresetRange(days, now = new Date()) {
  if (!days) return { from: '', to: '' }
  const to = new Date(now)
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export const SIZE_CPK_KIND = CPK_KIND.FLEET_AGGREGATE
export const SIZE_CPK_KIND_LABEL = CPK_KIND_LABEL[CPK_KIND.FLEET_AGGREGATE]

const lifeCache = new WeakMap()
/**
 * Physical tyres for a record set, plus the fitment rows of each tyre (by key).
 * Cached per array so the many per-size calls collapse the records once.
 */
export function physicalTyres(records = []) {
  if (lifeCache.has(records)) return lifeCache.get(records)
  const tyres = toLifetimeTyres(records)
  const rowsByKey = new Map()
  records.forEach((r, i) => {
    const k = tyreKey(r, i)
    if (!rowsByKey.has(k)) rowsByKey.set(k, [])
    rowsByKey.get(k).push(r)
  })
  const out = { tyres, rowsByKey }
  if (records && typeof records === 'object') lifeCache.set(records, out)
  return out
}

const measurable = (t) => (t._cost ?? 0) > 0 && (t._life_km ?? 0) > 0
const tyreCount = (tyres) => tyres.reduce((s, t) => s + (t._qty || 1), 0)
const lifeAvg = (tyres) => avg(tyres.map((t) => t._life_km).filter((v) => v != null && v > 0))

function isRated(r) {
  return RATED.has(String(r?.risk_level || '').trim().toLowerCase())
}
function isFailed(r) {
  const v = String(r?.risk_level || '').trim().toLowerCase()
  return v === 'high' || v === 'critical'
}

/** Per-size metrics over already-filtered records (physical tyres grouped by latest size). */
export function sizeMetrics(records = [], label = (s) => s || UNKNOWN_SIZE) {
  const { tyres, rowsByKey } = physicalTyres(records)
  const total = tyreCount(tyres)
  const bySize = new Map()
  for (const t of tyres) {
    const sz = label(t.size)
    if (!bySize.has(sz)) bySize.set(sz, { tyres: [], fitments: 0, brands: new Set(), sites: new Set(), vehicles: new Set(), rated: 0, failed: 0 })
    const g = bySize.get(sz)
    g.tyres.push(t)
    if (t.brand) g.brands.add(t.brand)
    if (t.site) g.sites.add(t.site)
    // Failures are EVENTS: counted over the tyre's fitment rows.
    for (const r of rowsByKey.get(t._key) || [t]) {
      g.fitments += 1
      if (r.asset_no) g.vehicles.add(r.asset_no)
      if (isRated(r)) { g.rated += 1; if (isFailed(r)) g.failed += 1 }
    }
  }
  return [...bySize.entries()].map(([size, g]) => {
    const count = tyreCount(g.tyres)
    const sample = g.tyres.filter(measurable).length
    const summary = lifetimeSummary(g.tyres)
    return {
      size,
      count,
      fitments: g.fitments,
      pct: total > 0 ? (count / total) * 100 : 0,
      cpkSample: sample,
      avgCpk: sample >= MIN_RECORDS_CPK ? weightedCpk(g.tyres) : null,
      cpkKind: SIZE_CPK_KIND,
      kmCoverage: summary.coverage,
      avgLife: lifeAvg(g.tyres),
      brands: [...g.brands].sort(),
      sites: [...g.sites].sort(),
      vehicles: [...g.vehicles],
      ratedCount: g.rated,
      failRate: g.rated > 0 ? (g.failed / g.rated) * 100 : null,
      flag: stdFlag(count),
    }
  })
}

/** Sort by count desc (the page's default order). */
export function bySizeCount(metrics = []) {
  return [...metrics].sort((a, b) => b.count - a.count || a.size.localeCompare(b.size))
}

export function sizeKpis(records = [], metrics = []) {
  const { tyres } = physicalTyres(records)
  const total = tyreCount(tyres)
  const uniqueSz = metrics.length
  const mostCommon = metrics.reduce((best, m) => (!best || m.count > best.count ? m : best), null)
  const qualified = metrics.filter((m) => m.avgCpk != null)
  const bestPerf = qualified.reduce((best, m) => (!best || m.avgCpk < best.avgCpk ? m : best), null)
  const stdScore = total > 0 ? Math.max(0, (1 - uniqueSz / total) * 100) : null
  // Rated FITMENTS (risk is an event rating on each fitment row).
  const rated = records.filter(isRated).length
  const fleetAvgCpk = weightedCpk(tyres)
  return {
    uniqueSz, total, fitments: records.length, mostCommon, bestPerf, stdScore, rated, fleetAvgCpk,
    cpkKind: SIZE_CPK_KIND, cpkKindLabel: SIZE_CPK_KIND_LABEL, lifetime: lifetimeSummary(tyres),
  }
}

/** Size x brand CPK matrix for the top-5 sizes and brands. Needs 2+ CPK samples per cell. */
export function sizeBrandMatrix(records = [], metrics = [], label = (s) => s) {
  const sizes = bySizeCount(metrics).slice(0, 5).map((m) => m.size)
  const { tyres } = physicalTyres(records)
  const brandCount = new Map()
  for (const t of tyres) if (t.brand) brandCount.set(t.brand, (brandCount.get(t.brand) || 0) + (t._qty || 1))
  const brands = [...brandCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([b]) => b)
  const matrix = {}
  for (const sz of sizes) {
    matrix[sz] = {}
    for (const br of brands) {
      const cell = tyres.filter((t) => label(t.size) === sz && t.brand === br)
      matrix[sz][br] = cell.filter(measurable).length >= 2 ? weightedCpk(cell) : null
    }
  }
  return { sizes, brands, matrix }
}

/** Per-brand breakdown for a single size. */
export function brandBreakdown(records = [], size, label = (s) => s) {
  const byBrand = new Map()
  for (const t of physicalTyres(records).tyres) {
    if (label(t.size) !== size) continue
    const br = t.brand || 'Unknown'
    if (!byBrand.has(br)) byBrand.set(br, [])
    byBrand.get(br).push(t)
  }
  return [...byBrand.entries()]
    .map(([brand, tyres]) => {
      const lives = tyres.map((t) => t._life_km).filter((v) => v != null && v > 0)
      return {
        brand,
        count: tyreCount(tyres),
        avgCpk: tyres.filter(measurable).length >= 2 ? weightedCpk(tyres) : null,
        avgLife: lives.length >= 2 ? avg(lives) : null,
      }
    })
    .sort((a, b) => b.count - a.count)
}

/**
 * Position-size compliance: the two most common sizes at a position are its
 * "required" sizes; anything else is non-standard.
 */
export function positionCompliance(records = [], label = (s) => s, normalizePosition = (p) => p) {
  const groups = new Map()
  for (const r of records) {
    const pos = normalizePosition(r.position)
    if (!groups.has(pos)) groups.set(pos, [])
    groups.get(pos).push(r)
  }
  return [...groups.entries()].map(([pos, recs]) => {
    const szCount = new Map()
    for (const r of recs) { const sz = label(r.size); szCount.set(sz, (szCount.get(sz) || 0) + 1) }
    const required = [...szCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sz]) => sz)
    const req = new Set(required)
    const nonStd = recs.filter((r) => !req.has(label(r.size))).length
    const compliance = recs.length > 0 ? ((recs.length - nonStd) / recs.length) * 100 : null
    return { pos, total: recs.length, required, nonStd, compliance }
  }).sort((a, b) => (a.compliance ?? 101) - (b.compliance ?? 101))
}

export function monthKey(d) {
  if (!d) return null
  const s = String(d).slice(0, 7)
  return /^\d{4}-\d{2}$/.test(s) ? s : null
}

export function monthLabel(k) {
  if (!k) return ''
  const [y, m] = k.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[parseInt(m, 10) - 1]} ${y}`
}

export function lastNMonths(n = 12, now = new Date()) {
  const out = []
  const d0 = new Date(now)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/**
 * Monthly average CPK for the top 3 size/brand combinations over 12 months.
 * A month with no measured CPK is null (a gap), never 0.
 */
export function comboTrend(records = [], label = (s) => s, now = new Date()) {
  const months = lastNMonths(12, now)
  const { tyres } = physicalTyres(records)
  const comboCount = new Map()
  for (const t of tyres) {
    const sz = label(t.size)
    if (!sz || sz === UNKNOWN_SIZE || !t.brand) continue
    const k = `${sz} / ${t.brand}`
    comboCount.set(k, (comboCount.get(k) || 0) + (t._qty || 1))
  }
  const top3 = [...comboCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([k]) => k)
  const series = top3.map((combo) => {
    const idx = combo.lastIndexOf(' / ')
    const sz = combo.slice(0, idx)
    const br = combo.slice(idx + 3)
    // Physical tyres bucketed by their latest fitment month; weighted CPK per month.
    const buckets = Object.fromEntries(months.map((m) => [m, []]))
    for (const t of tyres) {
      if (label(t.size) !== sz || t.brand !== br) continue
      const mk = monthKey(t.issue_date)
      if (!mk || !buckets[mk]) continue
      buckets[mk].push(t)
    }
    return { label: combo, data: months.map((m) => weightedCpk(buckets[m])) }
  }).filter((s) => s.data.some((v) => v != null))
  return { months, labels: months.map(monthLabel), series }
}

const IMPACT_RANK = { Critical: 0, High: 1, Low: 2 }

/**
 * Consolidation opportunities. Each item carries raw numbers; the page writes
 * the sentence. `savings` is null whenever the average life is unmeasured.
 */
export function consolidationOps(records = [], metrics = [], label = (s) => s, fleetAvgCpk = null) {
  const ops = []
  for (const m of metrics) {
    if (m.size === UNKNOWN_SIZE) continue
    if (m.vehicles.length === 1) {
      ops.push({ type: 'eliminate', impact: 'Low', size: m.size, vehicle: m.vehicles[0], savings: null })
    }
    if (m.brands.length >= 2 && m.avgCpk != null) {
      const brandCpks = brandBreakdown(records, m.size, label).filter((b) => b.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk)
      if (brandCpks.length >= 2) {
        const best = brandCpks[0]
        const worst = brandCpks[brandCpks.length - 1]
        if (worst.avgCpk / best.avgCpk > 1.25) {
          const savings = m.avgLife != null ? worst.count * (worst.avgCpk - best.avgCpk) * m.avgLife : null
          ops.push({ type: 'standardize', impact: 'High', size: m.size, best, worst, savings })
        }
      }
    }
    if (fleetAvgCpk && m.avgCpk != null && m.avgCpk > 2 * fleetAvgCpk) {
      const savings = m.avgLife != null ? m.count * (m.avgCpk - fleetAvgCpk) * m.avgLife : null
      ops.push({ type: 'review', impact: 'Critical', size: m.size, avgCpk: m.avgCpk, fleetAvgCpk, savings })
    }
  }
  return ops.sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact])
}
