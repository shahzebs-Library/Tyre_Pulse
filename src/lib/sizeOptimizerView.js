/**
 * sizeOptimizerView - pure engine for the Size Optimizer page (/tyre-size).
 *
 * Builds on tyreSizeAnalytics (calcCpk / calcLife / MIN_RECORDS_CPK) and adds
 * the per-asset recommendation layer: for each asset, the sizes the SAME
 * vehicle type runs in the SAME country are compared on measured CPK and life.
 *
 * HONESTY RULES
 *  - Sizes are only compared inside one country, so CPK in SAR is never
 *    compared with CPK in AED or EGP, and savings are grouped per currency.
 *  - A size needs MIN_RECORDS_CPK measured tyres before its CPK is trusted.
 *  - Application is DERIVED from the vehicle type (no application column).
 *    Terrain and fuel have no source at all and are always reported as unused.
 *  - Estimated saving = (current CPK - recommended CPK) x the tyre-km actually
 *    recorded on this asset at its current size. No default km is invented.
 */
import { calcCpk, calcLife, avg, MIN_RECORDS_CPK, UNKNOWN_SIZE } from './tyreSizeAnalytics'

export const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }
export const currencyFor = (country) => COUNTRY_CURRENCY[country] || null

/** Minimum CPK improvement (percent) before a size is recommended. */
export const MIN_IMPROVEMENT_PCT = 5

export const APPLICATIONS = ['On Road', 'Off Road', 'Construction', 'Industrial', 'Mining', 'Agriculture']
export const TERRAINS = ['Soft', 'Mixed', 'Rocky', 'Highway']
export const LOAD_CONDITIONS = ['Light', 'Normal', 'Heavy', 'Severe']
export const PRIORITIES = [
  { key: 'life', label: 'Best Tyre Life' },
  { key: 'cpk', label: 'Lowest Cost per KM' },
  { key: 'load', label: 'Load Capacity' },
]
export const TARGETS = [
  { key: 0, label: 'Any improvement' },
  { key: 5, label: 'At least 5% better' },
  { key: 10, label: 'At least 10% better' },
  { key: 20, label: 'At least 20% better' },
]
export const STATUSES = ['Recommended', 'Under Review', 'Current is best', 'Not enough data']

const APP_RULES = [
  [/mining|dump|haul|rigid/i, 'Mining'],
  [/loader|dozer|grader|excavat|backhoe|skid|off.?road|telehandler/i, 'Off Road'],
  [/mixer|pump|boom|batch|crane|concrete/i, 'Construction'],
  [/forklift|generator|compressor|stacker|industrial|plant/i, 'Industrial'],
  [/tractor|agri|harvest/i, 'Agriculture'],
  [/bus|pick.?up|car|van|trailer|truck|tanker|water|prime|head|tipper|lorry|jeep|suv/i, 'On Road'],
]

/** Application derived from a vehicle type, or null when nothing matches. */
export function deriveApplication(vehicleType) {
  const t = String(vehicleType || '').trim()
  if (!t) return null
  for (const [re, app] of APP_RULES) if (re.test(t)) return app
  return null
}

const normType = (t) => String(t || '').trim().toUpperCase() || null
const key = (...parts) => parts.map((p) => p ?? '').join('|')

/** Map asset -> fleet row, keyed by country|asset_no (the same code can exist in two countries). */
export function fleetIndex(fleet = []) {
  const m = new Map()
  for (const f of fleet || []) {
    if (!f?.asset_no) continue
    m.set(key(f.country, String(f.asset_no).trim().toUpperCase()), f)
  }
  return m
}

function fleetFor(idx, r) {
  const a = String(r?.asset_no || '').trim().toUpperCase()
  return idx.get(key(r?.country, a)) || null
}

/** Vehicle type of a tyre record: its own column, else the fleet register. */
export function recordType(r, idx) {
  return normType(r?.vehicle_type) || normType(fleetFor(idx, r)?.vehicle_type)
}

/**
 * Per type|country|size stats. avgCpk only when enough measured tyres.
 * `appFilter` keeps only records whose derived application matches.
 */
export function typeSizeStats(records = [], label = (s) => s, idx = new Map(), { appFilter } = {}) {
  const groups = new Map()
  for (const r of records || []) {
    const type = recordType(r, idx)
    if (!type) continue
    if (appFilter && deriveApplication(type) !== appFilter) continue
    const size = label(r.size)
    if (!size || size === UNKNOWN_SIZE) continue
    const k = key(type, r.country, size)
    if (!groups.has(k)) groups.set(k, { type, country: r.country || null, size, count: 0, cpks: [], lives: [], assets: new Set() })
    const g = groups.get(k)
    g.count += 1
    const c = calcCpk(r); if (c != null) g.cpks.push(c)
    const l = calcLife(r); if (l != null) g.lives.push(l)
    if (r.asset_no) g.assets.add(String(r.asset_no).trim().toUpperCase())
  }
  const out = new Map()
  for (const [k, g] of groups) {
    out.set(k, {
      type: g.type, country: g.country, size: g.size, count: g.count,
      cpkSample: g.cpks.length,
      avgCpk: g.cpks.length >= MIN_RECORDS_CPK ? avg(g.cpks) : null,
      lifeSample: g.lives.length,
      avgLife: g.lives.length >= 2 ? avg(g.lives) : null,
      assets: g.assets.size,
    })
  }
  return out
}

/** Stats rows for one type + country. */
export function candidatesFor(stats, type, country) {
  return [...stats.values()].filter((s) => s.type === type && (s.country || null) === (country || null))
}

const pctDelta = (from, to) => (from != null && to != null && from > 0 ? ((to - from) / from) * 100 : null)

/**
 * One row per asset with tyre history. Current size = the size of its most
 * recently issued tyre. Recommended = the candidate with the lowest measured
 * CPK for the same type and country, when it beats current by the threshold.
 */
export function assetRecommendations(records = [], label = (s) => s, fleet = [], { minImprovement = MIN_IMPROVEMENT_PCT } = {}) {
  const idx = fleetIndex(fleet)
  const stats = typeSizeStats(records, label, idx)
  const assets = new Map()
  for (const r of records || []) {
    if (!r?.asset_no) continue
    const a = String(r.asset_no).trim().toUpperCase()
    const k = key(r.country, a)
    if (!assets.has(k)) assets.set(k, { asset_no: a, country: r.country || null, site: r.site || null, recs: [] })
    assets.get(k).recs.push(r)
  }
  const rows = []
  for (const [k, a] of assets) {
    const f = idx.get(k) || null
    const latest = [...a.recs].sort((x, y) => String(y.issue_date || '').localeCompare(String(x.issue_date || '')))[0]
    const currentSize = label(latest?.size)
    const type = recordType(latest, idx) || normType(f?.vehicle_type)
    const cur = type && currentSize ? stats.get(key(type, a.country, currentSize)) || null : null
    const peers = type ? candidatesFor(stats, type, a.country).filter((s) => s.size !== currentSize && s.avgCpk != null) : []
    const best = peers.sort((x, y) => x.avgCpk - y.avgCpk)[0] || null
    const tyreKm = a.recs.filter((r) => label(r.size) === currentSize).map(calcLife).filter((v) => v != null).reduce((s, v) => s + v, 0)
    let status = 'Not enough data'
    let rec = null
    if (cur?.avgCpk != null && best) {
      const gain = ((cur.avgCpk - best.avgCpk) / cur.avgCpk) * 100
      if (gain >= minImprovement) { status = 'Recommended'; rec = best } else status = 'Current is best'
    } else if (cur?.avgCpk != null) status = 'Current is best'
    else if (best) { status = 'Under Review'; rec = best }
    const saving = status === 'Recommended' && tyreKm > 0 ? (cur.avgCpk - rec.avgCpk) * tyreKm : null
    rows.push({
      id: k,
      asset_no: a.asset_no,
      country: a.country,
      currency: currencyFor(a.country),
      site: f?.site || a.site,
      vehicle_type: type,
      make: f?.make || null,
      model: f?.model || null,
      application: deriveApplication(type),
      currentSize: currentSize && currentSize !== UNKNOWN_SIZE ? currentSize : null,
      recommendedSize: rec?.size || null,
      currentCpk: cur?.avgCpk ?? null,
      recommendedCpk: rec?.avgCpk ?? null,
      currentLife: cur?.avgLife ?? null,
      recommendedLife: rec?.avgLife ?? null,
      lifeDeltaPct: rec ? pctDelta(cur?.avgLife, rec.avgLife) : null,
      cpkGainPct: rec && cur?.avgCpk != null ? ((cur.avgCpk - rec.avgCpk) / cur.avgCpk) * 100 : null,
      tyreKm: tyreKm > 0 ? tyreKm : null,
      saving,
      status,
      tyres: a.recs.length,
    })
  }
  return rows.sort((x, y) => (y.saving ?? -1) - (x.saving ?? -1) || x.asset_no.localeCompare(y.asset_no))
}

/** Money per currency, never summed across currencies. */
export function savingsByCurrency(rows = []) {
  const m = new Map()
  for (const r of rows) {
    if (r.saving == null || !r.currency) continue
    m.set(r.currency, (m.get(r.currency) || 0) + r.saving)
  }
  return [...m.entries()].map(([currency, amount]) => ({ currency, amount }))
}

export function optimizerKpis(rows = []) {
  const recs = rows.filter((r) => r.status === 'Recommended')
  const savings = savingsByCurrency(rows)
  const lifeDeltas = recs.map((r) => r.lifeDeltaPct).filter((v) => v != null && Number.isFinite(v))
  return {
    vehiclesAnalysed: rows.length,
    recommendations: recs.length,
    underReview: rows.filter((r) => r.status === 'Under Review').length,
    savings,
    savingSingle: savings.length === 1 ? savings[0] : null,
    lifeImprovementPct: lifeDeltas.length ? avg(lifeDeltas) : null,
    lifeSample: lifeDeltas.length,
    fuelGainPct: null,
  }
}

/** Filter rows by the page filter bar. Empty or 'All' means no filter. */
export function filterRows(rows = [], f = {}) {
  const q = String(f.search || '').trim().toLowerCase()
  const on = (v) => v && v !== 'All'
  return rows.filter((r) => {
    if (on(f.site) && r.site !== f.site) return false
    if (on(f.vehicleType) && r.vehicle_type !== f.vehicleType) return false
    if (on(f.application) && r.application !== f.application) return false
    if (on(f.status) && r.status !== f.status) return false
    if (q && ![r.asset_no, r.vehicle_type, r.site, r.currentSize, r.recommendedSize, r.make, r.model].some((v) => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
}

export function rowOptions(rows = []) {
  const opts = (fn) => ['All', ...[...new Set(rows.map(fn).filter(Boolean))].sort()]
  return {
    sites: opts((r) => r.site),
    vehicleTypes: opts((r) => r.vehicle_type),
    applications: opts((r) => r.application),
  }
}

/** Group recommendation rows per vehicle type + country for the vehicle-wise tab. */
export function byVehicleType(rows = []) {
  const m = new Map()
  for (const r of rows) {
    const k = key(r.vehicle_type || 'Not recorded', r.country)
    if (!m.has(k)) m.set(k, { vehicle_type: r.vehicle_type || 'Not recorded', country: r.country, currency: r.currency, assets: 0, recommended: 0, sizes: new Set(), saving: 0, hasSaving: false })
    const g = m.get(k)
    g.assets += 1
    if (r.status === 'Recommended') g.recommended += 1
    if (r.currentSize) g.sizes.add(r.currentSize)
    if (r.saving != null) { g.saving += r.saving; g.hasSaving = true }
  }
  return [...m.values()].map((g) => ({ ...g, id: key(g.vehicle_type, g.country), sizes: [...g.sizes].sort(), saving: g.hasSaving ? g.saving : null }))
    .sort((a, b) => b.assets - a.assets)
}

/** Parse a catalogue load index ("154/150") into the single-tyre number. */
export function loadIndexOf(spec) {
  const n = parseInt(String(spec?.load_index_single ?? '').split('/')[0], 10)
  return Number.isFinite(n) ? n : null
}

const normSize = (s) => String(s || '').toUpperCase().replace(/\s+/g, '')

/** Catalogue entries for a size (approved first). */
export function catalogueFor(catalogue = [], size) {
  const n = normSize(size)
  if (!n) return []
  return (catalogue || []).filter((c) => normSize(c.size) === n)
    .sort((a, b) => (a.approval_status === 'approved' ? -1 : 0) - (b.approval_status === 'approved' ? -1 : 0))
}

/** Catalogue sizes suitable for a vehicle type (via suitable_for text). */
export function catalogueSizesForType(catalogue = [], type) {
  const t = String(type || '').toLowerCase()
  if (!t) return []
  return [...new Set((catalogue || []).filter((c) => {
    const s = Array.isArray(c.suitable_for) ? c.suitable_for.join(' ') : String(c.suitable_for || '')
    return s && s.toLowerCase().includes(t)
  }).map((c) => c.size).filter(Boolean))]
}

/**
 * Run an optimization for one asset. Scores candidate sizes the same vehicle
 * type runs (same country) plus catalogue sizes for that type, weighted by
 * priority. Returns ranked candidates and a list of inputs used / not used.
 */
export function runOptimization({ records = [], label = (s) => s, fleet = [], catalogue = [], asset, currentSize, application, terrain, load, priority = 'cpk', target = 0 } = {}) {
  const used = []
  const unused = []
  const idx = fleetIndex(fleet)
  const assetNo = String(asset?.asset_no || '').trim().toUpperCase()
  const country = asset?.country || null
  const type = normType(asset?.vehicle_type)
  if (!type) return { ok: false, reason: 'This asset has no vehicle type recorded, so there are no comparable vehicles.', candidates: [], used, unused }
  used.push(`Vehicle type ${type}${country ? ` in ${country}` : ''}`)
  let appFilter = null
  if (application) {
    if (application === deriveApplication(type)) used.push(`Application ${application} (matches the vehicle type)`)
    else { appFilter = application; used.push(`Application ${application}: only vehicles whose type derives to it`) }
  }
  if (terrain) unused.push(`Terrain ${terrain}: no terrain data is recorded`)
  unused.push('Fuel efficiency: no fuel source is linked')
  let stats = typeSizeStats(records, label, idx, { appFilter: appFilter || undefined })
  let peers = candidatesFor(stats, type, country)
  if (appFilter && !peers.length) {
    unused.push(`Application ${application}: no vehicles of this type match, so it was not applied`)
    stats = typeSizeStats(records, label, idx)
    peers = candidatesFor(stats, type, country)
  }
  const cur = label(currentSize || '')
  const bySize = new Map(peers.map((p) => [p.size, { ...p, source: 'fleet' }]))
  for (const s of catalogueSizesForType(catalogue, type)) {
    const lbl = label(s)
    if (!bySize.has(lbl)) bySize.set(lbl, { size: lbl, type, country, count: 0, avgCpk: null, avgLife: null, cpkSample: 0, source: 'catalogue' })
  }
  if (!bySize.has(cur) && cur && cur !== UNKNOWN_SIZE) bySize.set(cur, { size: cur, type, country, count: 0, avgCpk: null, avgLife: null, cpkSample: 0, source: 'current' })
  const withLoad = [...bySize.values()].map((c) => {
    const spec = catalogueFor(catalogue, c.size)[0] || null
    return { ...c, spec, loadIndex: loadIndexOf(spec) }
  })
  const current = withLoad.find((c) => c.size === cur) || null
  let pool = withLoad
  if (load === 'Heavy' || load === 'Severe') {
    if (current?.loadIndex != null) {
      pool = withLoad.filter((c) => c.loadIndex == null || c.loadIndex >= current.loadIndex)
      used.push(`Load ${load}: sizes with a lower load index than the current one were removed`)
    } else unused.push(`Load ${load}: the current size has no load index in the catalogue`)
  } else if (load) used.push(`Load ${load}: no sizes removed`)
  const metric = priority === 'life' ? (c) => c.avgLife : priority === 'load' ? (c) => c.loadIndex : (c) => (c.avgCpk != null ? -c.avgCpk : null)
  used.push(`Priority ${PRIORITIES.find((p) => p.key === priority)?.label || priority}`)
  const curVal = current ? metric(current) : null
  const ranked = pool.filter((c) => c.size !== cur).map((c) => {
    const v = metric(c)
    let gain = null
    if (v != null && curVal != null) {
      if (priority === 'cpk') gain = ((-curVal) - (-v)) / (-curVal) * 100
      else gain = curVal > 0 ? ((v - curVal) / curVal) * 100 : null
    }
    return { ...c, score: v, gainPct: gain, meetsTarget: gain != null && gain >= Number(target || 0) && gain > 0 }
  }).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
  if (target) used.push(`Target: at least ${target}% better`)
  const best = ranked.find((c) => c.meetsTarget) || null
  return {
    ok: true, type, country, currency: currencyFor(country), assetNo,
    current, best, candidates: ranked, used, unused,
    reason: best ? null : ranked.length ? 'No candidate size beats the current size on the chosen priority with enough measured data.' : 'The fleet runs no other size on this vehicle type yet.',
  }
}

/**
 * Five-year tyre cost for one size: CPK x (tyre-km recorded per year x 5).
 * annualKm comes from the asset's own records; null when unknown.
 */
export function fiveYearCost(cpk, annualKm) {
  if (cpk == null || annualKm == null || !Number.isFinite(cpk) || !Number.isFinite(annualKm) || annualKm <= 0) return null
  return cpk * annualKm * 5
}

/** Tyre-km recorded per year on an asset, from its dated records. */
export function annualTyreKm(records = [], assetNo, country) {
  const a = String(assetNo || '').trim().toUpperCase()
  const mine = (records || []).filter((r) => String(r.asset_no || '').trim().toUpperCase() === a && (r.country || null) === (country || null))
  const km = mine.map(calcLife).filter((v) => v != null).reduce((s, v) => s + v, 0)
  const dates = mine.map((r) => r.issue_date).filter(Boolean).sort()
  if (!km || dates.length < 2) return null
  const days = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000
  if (!(days >= 90)) return null
  return km / (days / 365)
}
