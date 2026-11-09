/**
 * Pure, dependency-free helpers for the Combination Manager. No Supabase, no
 * React — safe to unit-test in isolation. Handles the loose text ↔ array shape
 * of trailer lists and rolls a set of combination rows up into headline KPIs.
 *
 * Combined-unit intelligence (member resolution, blended CPK/spend/scrap
 * rollup, position-class breakdown, duplicate-trailer detection) layers on top
 * of the CANONICAL calc services rather than re-implementing them:
 *   • per-record spend/km come from `src/lib/tco.js` (recordTyreCost/recordKm),
 *   • the headline fleet-CPK number comes from `src/lib/kpiEngine.js`
 *     (`computeCpkFleet`). The per-combination blended cost/km exposed here is a
 *     labelled drill-down, never a second CPK engine.
 * Live per-tyre pressure/temperature and axle/wheel-position schematics have NO
 * source columns in this dataset; those surfaces stay honestly empty instead of
 * being fabricated.
 */
import { recordTyreCost, recordKm } from './tco'
import { computeCpkFleet } from './kpiEngine'
import { withOnePricePerTyre, toLifetimeTyres, tyreKey, weightedCpk, CPK_KIND, CPK_KIND_LABEL } from './tyreLifetime'

// PHYSICAL TYRES (src/lib/tyreLifetime.js): the unit's tyres are the physical
// tyres whose LATEST fitment is on a member asset (all records are collapsed
// first, then grouped). tyreCount / fitted / scrap / position counts are physical
// tyres; blendedCpk and the per-class cpk are WEIGHTED lifetime CPK (total
// purchase cost / total tyre-km, rule T8); avgTyreLifeKm = mean lifetime km.
// totalSpend and totalKm stay per FITMENT on member assets (money with one
// price per tyre, km run ON the unit by the shared km rule).
export const COMBINATION_CPK_KIND = CPK_KIND.FLEET_AGGREGATE
export const COMBINATION_CPK_KIND_LABEL = CPK_KIND_LABEL[CPK_KIND.FLEET_AGGREGATE]

/**
 * Normalise a free-text trailer list into a clean array of trailer numbers.
 * Accepts a raw string ("T1, T2 T3") or an array; splits on commas and
 * whitespace, trims, uppercases-agnostically dedupes (case-insensitive, first
 * spelling wins), and drops blanks. Order is preserved.
 *
 * @param {string|string[]|null|undefined} raw
 * @returns {string[]}
 */
export function parseTrailerList(raw) {
  if (raw == null) return []
  const parts = Array.isArray(raw)
    ? raw
    : String(raw).split(/[,\s]+/)
  const out = []
  const seen = new Set()
  for (const p of parts) {
    const t = String(p ?? '').trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/**
 * Roll combination rows up into headline KPIs for the dashboard tiles.
 *   - total     : number of combinations
 *   - active    : combinations with status === 'active'
 *   - inactive  : combinations with any non-active status
 *   - trailers  : total trailers linked across all combinations
 *   - units     : total physical units (prime movers + trailers)
 *
 * @param {Array<{status?:string, trailer_nos?:string[]|string, prime_mover_no?:string}>} rows
 */
export function summarizeCombinations(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let active = 0
  let trailers = 0
  let movers = 0
  for (const r of list) {
    if (r?.status === 'active') active += 1
    const tl = parseTrailerList(r?.trailer_nos)
    trailers += tl.length
    if (String(r?.prime_mover_no ?? '').trim()) movers += 1
  }
  return {
    total: list.length,
    active,
    inactive: list.length - active,
    trailers,
    units: movers + trailers,
  }
}

// ── Combined-unit intelligence ───────────────────────────────────────────────

const _norm = (v) => String(v ?? '').trim().toLowerCase()
const _qty = (r) => {
  const q = Number(r?.qty)
  return Number.isFinite(q) && q > 0 ? q : 1
}

/** Position-class order used for stable, engineering-meaningful table sorting. */
export const POSITION_CLASSES = ['steer', 'drive', 'trailer', 'other']

/**
 * Classify a free-text tyre `position` string into an axle role class. Handles
 * the common spellings/codes present in `tyre_records.position` (e.g. "Steer",
 * "Front", "Drive", "Trailer", "TR-2"). Anything that does not clearly parse is
 * honestly bucketed as 'other' rather than guessed.
 * @param {string|null|undefined} position
 * @returns {'steer'|'drive'|'trailer'|'other'}
 */
export function normalizePositionClass(position) {
  const p = _norm(position)
  if (!p) return 'other'
  if (/steer|front/.test(p)) return 'steer'
  if (/drive/.test(p)) return 'drive'
  if (/trail|^tr[\s-]?\d|^t\d/.test(p)) return 'trailer'
  return 'other'
}

/**
 * Resolve a combination's member assets (prime mover + each trailer) against
 * the `vehicle_fleet` master data. Matching is case-insensitive on asset_no.
 * Unresolved members (no fleet-master row) are flagged so the UI can raise a
 * data-quality warning rather than silently dropping them.
 *
 * @param {{prime_mover_no?:string, trailer_nos?:string|string[]}} combo
 * @param {Array<{asset_no?:string, vehicle_type?:string, make?:string, model?:string, status?:string, is_active?:boolean}>} vehicleRows
 * @returns {{members:Array, assetNos:string[], resolvedCount:number, unresolvedCount:number, unresolved:string[]}}
 */
export function resolveCombinationMembers(combo, vehicleRows = []) {
  const byAsset = new Map()
  for (const v of Array.isArray(vehicleRows) ? vehicleRows : []) {
    const key = _norm(v?.asset_no)
    if (key && !byAsset.has(key)) byAsset.set(key, v)
  }

  const wanted = []
  const prime = String(combo?.prime_mover_no ?? '').trim()
  if (prime) wanted.push({ asset_no: prime, role: 'prime_mover' })
  for (const t of parseTrailerList(combo?.trailer_nos)) wanted.push({ asset_no: t, role: 'trailer' })

  const members = wanted.map(({ asset_no, role }) => {
    const v = byAsset.get(_norm(asset_no))
    return {
      asset_no,
      role,
      resolved: !!v,
      vehicle_type: v?.vehicle_type ?? null,
      make: v?.make ?? null,
      model: v?.model ?? null,
      status: v?.status ?? null,
      is_active: v?.is_active ?? null,
    }
  })

  const unresolved = members.filter((m) => !m.resolved).map((m) => m.asset_no)
  return {
    members,
    assetNos: members.map((m) => m.asset_no),
    resolvedCount: members.length - unresolved.length,
    unresolvedCount: unresolved.length,
    unresolved,
  }
}

const _isFitted = (r) => /fitted|active|in.?service|fit\b/i.test(String(r?.status ?? ''))
const _isScrap = (r) => /scrap/i.test(String(r?.status ?? ''))

/** Tyre records belonging to any of the given member asset_nos (case-insensitive). */
export function memberTyres(assetNos = [], tyreRows = []) {
  const set = new Set((Array.isArray(assetNos) ? assetNos : []).map(_norm).filter(Boolean))
  if (!set.size) return []
  return (Array.isArray(tyreRows) ? tyreRows : []).filter((r) => set.has(_norm(r?.asset_no)))
}

/** Weighted lifetime CPK of physical tyres (3dp), null when none is measurable. */
function _blendedCpk(tyres) {
  const v = weightedCpk(tyres)
  return v == null ? null : Math.round(v * 1000) / 1000
}

/**
 * Roll a whole combined unit (prime mover + trailers) up into blended
 * tyre-economics. Everything is computed across ALL member asset_nos.
 *
 * @param {object} combo                       one asset_combinations row
 * @param {object[]} tyreRows                   tyre_records in scope
 * @param {object[]} vehicleRows                vehicle_fleet in scope
 * @returns {{
 *   members, resolution, tyreCount, fittedTyres, scrapTyres, totalSpend,
 *   avgTyreLifeKm, totalKm, blendedCpk, canonicalCpk, positionBreakdown
 * }}
 */
export function computeCombinationRollup(combo, tyreRows = [], vehicleRows = []) {
  const resolution = resolveCombinationMembers(combo, vehicleRows)
  const all = withOnePricePerTyre((Array.isArray(tyreRows) ? tyreRows : []).filter(Boolean))
  const memberSet = new Set(resolution.assetNos.map(_norm).filter(Boolean))
  const isMember = (r) => memberSet.has(_norm(r?.asset_no))
  // Fitment rows ON the unit (money and km run on the unit).
  const rows = memberSet.size ? all.filter(isMember) : []
  // Physical tyres whose latest fitment is on the unit, and all their rows.
  const unitTyres = memberSet.size ? toLifetimeTyres(all).filter(isMember) : []
  const unitKeys = new Set(unitTyres.map((t) => t._key))
  const unitTyreRows = all.filter((r, i) => unitKeys.has(tyreKey(r, i)))

  let totalSpend = 0
  let totalKm = 0
  for (const r of rows) {
    totalSpend += recordTyreCost(r)
    totalKm += recordKm(r)
  }
  let fittedTyres = 0
  let scrapTyres = 0
  const lives = []
  for (const t of unitTyres) {
    const q = t._qty || 1
    if (t._life_km != null && t._life_km > 0) lives.push(t._life_km)
    if (_isFitted(t)) fittedTyres += q
    if (_isScrap(t)) scrapTyres += q
  }

  // Position-class breakdown by the tyre's latest position: physical count,
  // spend of its fitment rows on the unit, weighted lifetime CPK.
  const groups = {}
  for (const t of unitTyres) {
    const cls = normalizePositionClass(t?.position ?? t?.tyre_position)
    ;(groups[cls] ||= []).push(t)
  }
  const positionBreakdown = POSITION_CLASSES
    .filter((cls) => groups[cls]?.length)
    .map((cls) => {
      const tyres = groups[cls]
      const keys = new Set(tyres.map((t) => t._key))
      const spend = all.reduce((s, r, i) => (isMember(r) && keys.has(tyreKey(r, i)) ? s + recordTyreCost(r) : s), 0)
      return {
        positionClass: cls,
        count: tyres.reduce((s, t) => s + (t._qty || 1), 0),
        spend: Math.round(spend * 100) / 100,
        cpk: _blendedCpk(tyres),
      }
    })

  return {
    members: resolution.members,
    resolution,
    tyreCount: unitTyres.reduce((s, t) => s + (t._qty || 1), 0),
    fitments: rows.length,
    fittedTyres,
    scrapTyres,
    totalSpend: Math.round(totalSpend * 100) / 100,
    avgTyreLifeKm: lives.length ? Math.round(lives.reduce((s, v) => s + v, 0) / lives.length) : null,
    totalKm: Math.round(totalKm),
    // Weighted physical-tyre lifetime CPK of the unit's tyres (fleet aggregate kind).
    blendedCpk: _blendedCpk(unitTyres),
    cpkKind: COMBINATION_CPK_KIND,
    cpkKindLabel: COMBINATION_CPK_KIND_LABEL,
    // Canonical fleet-CPK object from the shared KPI engine over the same tyres.
    canonicalCpk: computeCpkFleet(unitTyreRows),
    positionBreakdown,
  }
}

/**
 * Data-quality check: a trailer assigned to more than one ACTIVE combination at
 * once is physically impossible and signals a stale/duplicated registry entry.
 * Matching is case-insensitive; the first spelling seen is reported.
 *
 * @param {Array<{id?:any, name?:string, prime_mover_no?:string, status?:string, trailer_nos?:string|string[]}>} combos
 * @returns {Array<{trailer:string, combinations:Array<{id:any, name:string}>}>}
 */
export function detectDuplicateTrailers(combos = []) {
  const active = (Array.isArray(combos) ? combos : []).filter((c) => c?.status === 'active')
  const map = new Map() // key → { trailer, combinations: [] }
  for (const c of active) {
    for (const t of parseTrailerList(c?.trailer_nos)) {
      const key = t.toLowerCase()
      if (!map.has(key)) map.set(key, { trailer: t, combinations: [] })
      map.get(key).combinations.push({ id: c?.id ?? null, name: c?.name || c?.prime_mover_no || 'N/A' })
    }
  }
  return [...map.values()].filter((e) => e.combinations.length > 1)
}
