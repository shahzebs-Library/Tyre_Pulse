/**
 * carbonTrackerAnalytics - pure presentation engine for /carbon-tracker.
 *
 * The carbon MATHS lives in `src/lib/carbon.js` (computeCarbon for the fuel
 * view, computeLifecycleCarbon for the ESG view). This module only decides
 * what the page may honestly SAY about those results: which figures are
 * measurable, how rows are filtered and exported, and how the offsets and
 * initiatives ledgers roll up. No I/O, no React, and `now` is injectable so
 * every date-windowed answer is deterministic in a test.
 *
 * Honesty rules applied here, not in the page:
 *   - A figure with no measurable basis is `null` (rendered N/A), never 0.
 *     computeLifecycleCarbon returns an ESG score and a pressure compliance
 *     even for an empty estate (100 - 0/1 = 100%); showing those would claim a
 *     perfect fleet from no data.
 *   - A share of a zero total is null, not 0%.
 *   - An offset with no cost recorded does not add a fabricated 0 to the cost
 *     total: the total is null when NO offset carries a cost.
 */

export const PERIODS = Object.freeze([
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '12 months' },
  { value: 0, label: 'All time' },
])

export const INITIATIVE_STATUSES = Object.freeze(['active', 'pilot', 'planned', 'completed', 'on_hold'])

/** A finite number, or null. Blank and non-numeric values are null, never 0. */
export function toNum(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** kg -> tonnes at one decimal. Null stays null. */
export function asTonnes(kg) {
  const n = toNum(kg)
  return n == null ? null : Math.round((n / 1000) * 10) / 10
}

/** Rounded, locale-grouped integer, or 'N/A' when unmeasurable. */
export function fmtNum(v) {
  const n = toNum(v)
  return n == null ? 'N/A' : Math.round(n).toLocaleString()
}

/** Tonnes label, or 'N/A'. */
export function fmtTonnes(kg) {
  const t = asTonnes(kg)
  return t == null ? 'N/A' : `${t.toLocaleString()} t`
}

/** Human label for a snake_case class/status token. */
export function humanize(s) {
  return String(s ?? '').replace(/_/g, ' ').trim()
}

/**
 * Keep fuel rows dated inside the last `months` months (0 = all time). Rows
 * with no parseable date are dropped from a windowed view (they cannot be
 * placed inside it) but kept for "all time".
 */
export function scopeRowsByPeriod(rows, months, now = new Date()) {
  const all = Array.isArray(rows) ? rows : []
  if (!months) return all
  const cutoff = new Date(now.getTime())
  cutoff.setMonth(cutoff.getMonth() - months)
  cutoff.setHours(0, 0, 0, 0)
  return all.filter((r) => {
    if (!r?.date) return false
    const d = new Date(r.date)
    return !Number.isNaN(d.getTime()) && d >= cutoff
  })
}

/**
 * Lifecycle ESG figures with measurability applied.
 * @param {object} carbon  computeLifecycleCarbon() result
 */
export function lifecycleKpis(carbon) {
  const s = carbon?.summary || {}
  const fs = carbon?.fleetStats || {}
  const vehicles = toNum(fs.totalVehicles) || 0
  const breakdown = Array.isArray(carbon?.tyreBreakdown) ? carbon.tyreBreakdown : []
  const retreads = toNum(fs.retreadsPeriod) || 0
  const scrapped = toNum(fs.scrappedPeriod) || 0
  const newTyres = toNum(fs.newTyresPeriod) || 0
  const hasData = vehicles > 0 || breakdown.length > 0 || retreads > 0 || scrapped > 0 || newTyres > 0

  return {
    hasData,
    netCo2Kg: hasData ? toNum(s.totalCo2NetKg) : null,
    grossCo2Kg: hasData ? toNum(s.totalCo2GrossKg) : null,
    savedRetreadKg: hasData ? toNum(s.co2SavedRetreadingKg) : null,
    underinflationKg: vehicles > 0 ? toNum(s.co2FromUnderinflationKg) : null,
    scrappedKg: hasData ? toNum(s.co2FromScrappedKg) : null,
    // A retread RATE needs at least one retread-or-scrap event to divide by.
    retreadRatePct: retreads + scrapped > 0 ? toNum(s.retreadRatePct) : null,
    // Compliance is measured against the active fleet; no fleet, no reading.
    pressureCompliancePct: vehicles > 0 ? toNum(s.pressureCompliancePct) : null,
    esgScore: hasData ? toNum(s.esgScore) : null,
    certificationReady: hasData ? !!s.certificationReady : null,
    vehicles,
    retreads,
    scrapped,
    newTyres,
    lowPressure: toNum(fs.lowPressureCurrently) || 0,
  }
}

/** ESG band for a 0-100 score. Null score reads "Not measured". */
export function esgBand(score) {
  const n = toNum(score)
  if (n == null) return { key: 'none', label: 'Not measured', tone: 'neutral' }
  if (n >= 70) return { key: 'good', label: 'Certification-ready', tone: 'accent' }
  if (n >= 50) return { key: 'watch', label: 'Below threshold', tone: 'warn' }
  return { key: 'poor', label: 'Well below threshold', tone: 'crit' }
}

/**
 * Fuel-emission figures. CO2 per vehicle is null with no vehicles rather than
 * 0 t (a fleet of none does not emit zero per head; it has no per-head figure).
 * @param {object} carbon computeCarbon() result
 */
export function fuelKpis(carbon) {
  const totalCo2 = toNum(carbon?.totalCo2) || 0
  const vehicles = toNum(carbon?.vehicleCount) || 0
  const bySite = Array.isArray(carbon?.bySite) ? carbon.bySite : []
  const top = bySite[0] || null
  const hasData = totalCo2 > 0
  return {
    hasData,
    totalCo2Kg: hasData ? totalCo2 : null,
    co2PerVehicleKg: hasData && vehicles > 0 ? totalCo2 / vehicles : null,
    vehicles,
    litres: hasData ? toNum(carbon?.totalLitres) : null,
    distanceKm: hasData ? toNum(carbon?.totalDistanceKm) : null,
    topSite: top ? top.site : null,
    topSiteCo2Kg: top ? toNum(top.co2) : null,
    topSiteSharePct: top && hasData ? Math.round((toNum(top.co2) / totalCo2) * 1000) / 10 : null,
    sites: bySite.length,
  }
}

/**
 * Vehicle rows for the fuel register, carrying each vehicle's share of the
 * period total. Share is null when the total is zero.
 */
export function vehicleRows(carbon) {
  const total = toNum(carbon?.totalCo2) || 0
  return (Array.isArray(carbon?.byVehicle) ? carbon.byVehicle : []).map((v, i) => ({
    rank: i + 1,
    vehicle: v.vehicle,
    site: v.site || 'Unassigned',
    litres: toNum(v.litres),
    co2Kg: toNum(v.co2),
    co2Tonnes: asTonnes(v.co2),
    sharePct: total > 0 && toNum(v.co2) != null ? Math.round((v.co2 / total) * 1000) / 10 : null,
  }))
}

/** Filter vehicle rows by site and a free-text query over vehicle + site. */
export function filterVehicleRows(rows, { site = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((v) => {
    if (site && v.site !== site) return false
    if (q && !`${v.vehicle} ${v.site}`.toLowerCase().includes(q)) return false
    return true
  })
}

/** Distinct sorted site names from a computeCarbon() result. */
export function siteOptions(carbon) {
  return (Array.isArray(carbon?.bySite) ? carbon.bySite : [])
    .map((s) => s.site)
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)))
}

/**
 * Offsets ledger roll-up. `totalCost` is null when no offset records a cost:
 * summing blanks would publish a 0 spend nobody recorded.
 */
export function offsetsSummary(offsets) {
  const list = Array.isArray(offsets) ? offsets : []
  let tonnes = 0
  let cost = 0
  let costed = 0
  const providers = new Set()
  for (const o of list) {
    const t = toNum(o?.tonnes)
    if (t != null) tonnes += t
    const c = toNum(o?.aed_cost)
    if (c != null) { cost += c; costed += 1 }
    if (o?.provider) providers.add(String(o.provider).trim())
  }
  return {
    count: list.length,
    totalTonnes: list.length ? Math.round(tonnes * 100) / 100 : null,
    totalCost: costed > 0 ? cost : null,
    costedCount: costed,
    avgCostPerTonne: costed > 0 && tonnes > 0 ? Math.round((cost / tonnes) * 100) / 100 : null,
    providers: providers.size,
  }
}

/**
 * Net lifecycle CO2 after purchased offsets, in kg. Null when either side is
 * unmeasurable (an offset cannot be netted against an unmeasured footprint).
 */
export function netAfterOffsetsKg(netCo2Kg, offsetTonnes) {
  const net = toNum(netCo2Kg)
  const off = toNum(offsetTonnes)
  if (net == null) return null
  return net - (off == null ? 0 : off * 1000)
}

/** Initiatives roll-up: count, claimed savings (kg) and per-status counts. */
export function initiativesSummary(initiatives) {
  const list = Array.isArray(initiatives) ? initiatives : []
  let kg = 0
  let claimed = 0
  const byStatus = {}
  for (const i of list) {
    const v = toNum(i?.claimed_savings_kg)
    if (v != null) { kg += v; claimed += 1 }
    const st = i?.status || 'unknown'
    byStatus[st] = (byStatus[st] || 0) + 1
  }
  return {
    count: list.length,
    totalSavingsKg: claimed > 0 ? kg : null,
    claimedCount: claimed,
    live: (byStatus.active || 0) + (byStatus.pilot || 0),
    completed: byStatus.completed || 0,
    byStatus,
  }
}

/** Filter offsets by a query over provider + project. */
export function filterOffsets(offsets, search = '') {
  const q = String(search || '').trim().toLowerCase()
  const list = Array.isArray(offsets) ? offsets : []
  if (!q) return list
  return list.filter((o) => `${o?.provider || ''} ${o?.project || ''}`.toLowerCase().includes(q))
}

/** Filter initiatives by status and a query over name, owner and description. */
export function filterInitiatives(initiatives, { status = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(initiatives) ? initiatives : []).filter((i) => {
    if (status && i?.status !== status) return false
    if (q && !`${i?.name || ''} ${i?.owner || ''} ${i?.description || ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

/** Export rows for the fuel vehicle register (every row, not the page). */
export function vehicleExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((v) => ({
    vehicle: v.vehicle,
    site: v.site,
    litres: v.litres ?? '',
    co2Kg: v.co2Kg ?? '',
    co2Tonnes: v.co2Tonnes ?? '',
    sharePct: v.sharePct ?? '',
  }))
}

