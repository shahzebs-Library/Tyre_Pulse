/**
 * retreadManagementAnalytics - the pure engine behind /retread-management.
 *
 * Every figure the Retread Management page prints is computed here, with no
 * I/O and an injectable `now`, so the screen, the Excel/PDF exports and the
 * tests all read ONE definition.
 *
 * HONESTY RULES (pinned by src/test/retreadManagementAnalytics.test.js):
 *   - A figure that cannot be measured is `null` (rendered N/A), never 0.
 *     An unknown success rate is an unknown FAILURE rate, never "0% failure".
 *   - A ROI input that is missing or zero does not become a divisor of 1:
 *     the dependent result is null instead of a fabricated number.
 *   - CPK needs BOTH a positive km life and a positive cost.
 *
 * Retread / scrap classification is kept identical to kpiEngine
 * (computeRetreadPerformance) so a casing tagged "Retread", "Retreaded" or
 * "Retread x2" is treated the same everywhere in the app.
 */

export const RETREAD_RE = /retread/i
export const SCRAP_RE = /scrap/i
export const RISK_HIGH = new Set(['High', 'Critical'])
export const RISK_OPTIONS = ['Low', 'Medium', 'High', 'Critical']
/** Default annual distance a tyre position runs, used only by the ROI projection. */
export const DEFAULT_ANNUAL_KM = 100000

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const mean = (vals) => {
  const v = vals.filter((x) => x != null && Number.isFinite(x))
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
}

export const isRetread = (r) => RETREAD_RE.test(String(r?.category ?? ''))
export const isScrap = (r) => SCRAP_RE.test(String(r?.category ?? ''))

/** Distance the tyre ran between fitment and removal; null when not measurable. */
export function kmLife(t) {
  const fit = num(t?.km_at_fitment)
  const rem = num(t?.km_at_removal)
  if (fit == null || rem == null) return null
  const km = rem - fit
  return km > 0 ? km : null
}

/** Cost per km; null unless both a positive life and a positive cost exist. */
export function cpk(t) {
  const life = kmLife(t)
  const cost = num(t?.cost_per_tyre)
  if (!life || cost == null || cost <= 0) return null
  return cost / life
}

/**
 * Retread cycle count. Prefers an explicit numeric field, then a number in the
 * category label ("Retread x2", "2nd Retread"); a bare "Retread" is cycle 1.
 * Null for a non-retread.
 */
export function retreadCycle(t) {
  const cat = String(t?.category ?? '')
  if (!RETREAD_RE.test(cat)) return null
  const explicit = Number(t?.retread_count ?? t?.retread_cycle ?? t?.retread_number)
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit)
  const m = cat.match(/(\d+)/)
  if (m) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) return n
  }
  return 1
}

export function daysInService(t, now = new Date()) {
  if (!t?.issue_date) return null
  const start = new Date(t.issue_date)
  if (Number.isNaN(start.getTime())) return null
  const end = t.removal_date ? new Date(t.removal_date) : now
  if (Number.isNaN(end.getTime())) return null
  return Math.max(0, Math.round((end - start) / 86400000))
}

/** The 12 calendar months ending with `now`, oldest first, as 'YYYY-MM'. */
export function last12Months(now = new Date()) {
  const out = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export function enrichRetread(t, now = new Date()) {
  const removed = num(t?.km_at_removal) != null && num(t?.km_at_removal) > 0
  return {
    ...t,
    km_life: kmLife(t),
    cpk: cpk(t),
    status: removed ? 'Removed' : 'Active',
    days_in_service: daysInService(t, now),
    retread_cycle: retreadCycle(t),
  }
}

/** Split raw tyre rows into enriched retreads and the new-tyre CPK baseline set. */
export function splitRecords(records = [], now = new Date()) {
  const retreads = []
  const newTyres = []
  for (const r of records) {
    if (isRetread(r)) retreads.push(enrichRetread(r, now))
    else if (!isScrap(r)) newTyres.push(r)
  }
  return { retreads, newTyres }
}

/** Success rate among REMOVED casings: share not at High/Critical risk. Null when none removed. */
export function successRate(tyres = []) {
  const removed = tyres.filter((t) => t.status === 'Removed' || (num(t.km_at_removal) ?? 0) > 0)
  if (!removed.length) return null
  const ok = removed.filter((t) => !RISK_HIGH.has(t.risk_level)).length
  return (ok / removed.length) * 100
}

/** Failure rate is the complement of success; unknown success is unknown failure. */
export function failureRate(success) {
  return success == null || !Number.isFinite(success) ? null : 100 - success
}

export function retreadKpis(retreads = [], newTyres = []) {
  const retreadCpk = mean(retreads.map((t) => t.cpk))
  const newCpk = mean(newTyres.map(cpk))

  // Realised saving per retread = newCpk x km_life - what the retread cost.
  let savings = null
  if (newCpk != null) {
    const measurable = retreads.filter((t) => t.km_life && (num(t.cost_per_tyre) ?? 0) > 0)
    if (measurable.length) {
      savings = measurable.reduce((s, t) => s + (newCpk * t.km_life - num(t.cost_per_tyre)), 0)
    }
  }

  const cycles = retreads.map((t) => t.retread_cycle).filter((v) => v != null)
  const removedCount = retreads.filter((t) => t.status === 'Removed').length
  const success = successRate(retreads)
  return {
    totalRetreads: retreads.length,
    activeCount: retreads.length - removedCount,
    removedCount,
    retreadCpk,
    newCpk,
    cpkDeltaPct: retreadCpk != null && newCpk != null && newCpk > 0
      ? ((newCpk - retreadCpk) / newCpk) * 100
      : null,
    savings,
    successRate: success,
    failureRate: failureRate(success),
    avgCycle: mean(cycles),
    maxCycle: cycles.length ? Math.max(...cycles) : null,
    retreadShare: retreads.length + newTyres.length > 0
      ? (retreads.length / (retreads.length + newTyres.length)) * 100
      : null,
  }
}

export function filterRetreads(retreads = [], { site = 'All', brand = 'All', risk = 'All', status = 'All', search = '' } = {}) {
  const s = String(search || '').trim().toLowerCase()
  return retreads.filter((t) => {
    if (site !== 'All' && t.site !== site) return false
    if (brand !== 'All' && t.brand !== brand) return false
    if (risk !== 'All' && t.risk_level !== risk) return false
    if (status !== 'All' && t.status !== status) return false
    if (!s) return true
    return [t.serial_number, t.brand, t.asset_no, t.size, t.site, t.position]
      .some((v) => String(v ?? '').toLowerCase().includes(s))
  })
}

export function optionsFor(rows = [], key) {
  return [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort()
}

export function brandSummary(retreads = []) {
  const map = new Map()
  for (const t of retreads) {
    const b = String(t.brand ?? '').trim() || 'Unknown'
    if (!map.has(b)) map.set(b, [])
    map.get(b).push(t)
  }
  return [...map.entries()].map(([brand, tyres]) => {
    const life = mean(tyres.map((t) => t.km_life))
    const sr = successRate(tyres)
    return {
      brand,
      count: tyres.length,
      avgCpk: mean(tyres.map((t) => t.cpk)),
      avgLife: life != null ? Math.round(life) : null,
      successRate: sr != null ? Math.round(sr) : null,
    }
  }).sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand))
}

/**
 * 0-100 composite vendor score: CPK efficiency 40%, success 40%, life 20%.
 * CPK and life are min-max normalised against the fleet's own spread; a
 * missing metric scores a neutral 50 so it neither helps nor hurts.
 */
export function scoreVendor(v, range) {
  const norm = (val, lo, hi, invert) => {
    if (val == null || !Number.isFinite(val)) return 50
    if (hi <= lo) return 50
    const t = (val - lo) / (hi - lo)
    return Math.round((invert ? 1 - t : t) * 100)
  }
  const cpkScore = norm(v.avgCpk, range.cpkMin, range.cpkMax, true)
  const lifeScore = norm(v.avgLife, range.lifeMin, range.lifeMax, false)
  const successScore = v.successRate ?? 50
  return Math.round(cpkScore * 0.4 + successScore * 0.4 + lifeScore * 0.2)
}

export function vendorScorecard(brands = [], newCpk = null) {
  const cpks = brands.map((b) => b.avgCpk).filter((v) => v != null)
  const lifes = brands.map((b) => b.avgLife).filter((v) => v != null)
  const range = {
    cpkMin: cpks.length ? Math.min(...cpks) : 0,
    cpkMax: cpks.length ? Math.max(...cpks) : 0,
    lifeMin: lifes.length ? Math.min(...lifes) : 0,
    lifeMax: lifes.length ? Math.max(...lifes) : 0,
  }
  return brands.map((b) => ({
    ...b,
    failureRate: failureRate(b.successRate),
    savingsVsNew: newCpk != null && b.avgCpk != null && b.avgLife != null
      ? (newCpk - b.avgCpk) * b.avgLife * b.count
      : null,
    score: scoreVendor(b, range),
  })).sort((a, b) => b.score - a.score || a.brand.localeCompare(b.brand))
}

/** Retreads fitted per month over the last 12 months. */
export function monthlyFitments(retreads = [], now = new Date()) {
  const months = last12Months(now)
  const counts = Object.fromEntries(months.map((m) => [m, 0]))
  for (const t of retreads) {
    const m = String(t.issue_date ?? '').slice(0, 7)
    if (m in counts) counts[m] += 1
  }
  return months.map((m) => ({ month: m, count: counts[m] }))
}

/** Monthly average CPK per brand (null where the month has no measurable casing). */
export function vendorCpkTrend(retreads = [], brands = [], now = new Date()) {
  const months = last12Months(now)
  return {
    months,
    series: brands.map((brand) => ({
      brand,
      data: months.map((m) => mean(retreads
        .filter((t) => t.brand === brand && String(t.issue_date ?? '').startsWith(m))
        .map((t) => t.cpk))),
    })),
  }
}

/** Size with the longest average km life; null when no size has a measured life. */
export function bestSize(retreads = []) {
  const map = new Map()
  for (const t of retreads) {
    if (!t.km_life || !t.size) continue
    if (!map.has(t.size)) map.set(t.size, [])
    map.get(t.size).push(t.km_life)
  }
  let best = null
  let bestAvg = -Infinity
  for (const [size, vals] of map) {
    const avg = mean(vals)
    if (avg > bestAvg) { bestAvg = avg; best = size }
  }
  return best
}

/** Distribution of casings by retread cycle depth. */
export function cycleDistribution(retreads = []) {
  const map = new Map()
  for (const t of retreads) {
    if (t.retread_cycle == null) continue
    const key = t.retread_cycle >= 4 ? '4+' : String(t.retread_cycle)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return ['1', '2', '3', '4+'].filter((k) => map.has(k)).map((k) => ({ cycle: k, count: map.get(k) }))
}

/**
 * Data-driven findings. Each is emitted only when its triggering condition is
 * actually met by the data. `fmt` supplies money/CPK formatting so the engine
 * stays locale- and currency-free.
 */
export function retreadInsights({ retreads = [], kpis, brands = [] }, fmt) {
  const out = []
  const f = {
    cpk: fmt?.cpk ?? ((v) => (v == null ? 'N/A' : v.toFixed(4))),
    money: fmt?.money ?? ((v) => (v == null ? 'N/A' : String(Math.round(v)))),
  }
  const removed = retreads.filter((t) => t.status === 'Removed')

  if (kpis?.retreadCpk != null && kpis?.newCpk != null && kpis.newCpk > 0) {
    const deltaPct = ((kpis.newCpk - kpis.retreadCpk) / kpis.newCpk) * 100
    if (kpis.retreadCpk <= kpis.newCpk) {
      out.push({
        tone: 'success',
        title: `Retreading is cutting cost per km by ${deltaPct.toFixed(0)}%`,
        body: `Fleet retread CPK (${f.cpk(kpis.retreadCpk)}) is below new-tyre CPK (${f.cpk(kpis.newCpk)}). Retreading is the right economic choice for eligible casings. Protect casing quality to keep this advantage.`,
      })
    } else {
      out.push({
        tone: 'danger',
        title: `Retreads cost ${Math.abs(deltaPct).toFixed(0)}% more per km than new`,
        body: `Retread CPK (${f.cpk(kpis.retreadCpk)}) exceeds new-tyre CPK (${f.cpk(kpis.newCpk)}). The usual root cause is short retread life (poor casing selection or vendor cure quality) or over-priced retreads. Audit the low-scoring vendors and tighten casing acceptance before further send-outs.`,
      })
    }
  }

  if (kpis?.successRate != null && removed.length >= 3) {
    if (kpis.successRate < 70) {
      out.push({
        tone: 'danger',
        title: `${(100 - kpis.successRate).toFixed(0)}% of retreads reached high or critical risk at removal`,
        body: 'A high failure share points to casings retreaded past their safe limit, under-inflation in service, or a weak retread vendor. Cross-check the worst vendors, enforce pressure compliance and cap retread cycles on failure-prone sizes.',
      })
    } else if (kpis.successRate >= 90) {
      out.push({
        tone: 'success',
        title: `Strong retread reliability: ${kpis.successRate.toFixed(0)}% success at removal`,
        body: 'Casing selection and vendor quality are sound. Extend the retread programme to more eligible casings to grow the CPK saving.',
      })
    }
  }

  const rankable = brands.filter((b) => b.avgCpk != null && b.count >= 2)
  if (rankable.length >= 2) {
    const worst = [...rankable].sort((a, b) => b.avgCpk - a.avgCpk)[0]
    const best = [...rankable].sort((a, b) => a.avgCpk - b.avgCpk)[0]
    if (worst.brand !== best.brand && best.avgCpk > 0) {
      const gap = ((worst.avgCpk - best.avgCpk) / best.avgCpk) * 100
      if (gap >= 25) {
        out.push({
          tone: 'warning',
          title: `${worst.brand} retreads cost ${gap.toFixed(0)}% more per km than ${best.brand}`,
          body: `${worst.brand} averages ${f.cpk(worst.avgCpk)} against ${best.brand} at ${f.cpk(best.avgCpk)}. Shift send-out volume toward ${best.brand} and put ${worst.brand} on review.`,
        })
      }
    }
  }

  if (kpis?.maxCycle != null && kpis.maxCycle >= 3) {
    const deep = retreads.filter((t) => (t.retread_cycle ?? 0) >= 3)
    const deepFail = deep.filter((t) => t.status === 'Removed' && RISK_HIGH.has(t.risk_level)).length
    out.push({
      tone: deepFail > 0 ? 'danger' : 'warning',
      title: `${deep.length} casing(s) retreaded ${kpis.maxCycle} times${deepFail > 0 ? `, ${deepFail} failed` : ''}`,
      body: `Each retread cycle removes rubber and heat-cures the casing further, raising blow-out risk.${deepFail > 0 ? ' Failures are already appearing at deep cycles.' : ''} Set a maximum retread-cycle policy (commonly 2 to 3) and scrap casings that exceed it.`,
    })
  }

  if (kpis?.savings != null && kpis.savings > 0) {
    out.push({
      tone: 'success',
      title: `Retreading has saved ${f.money(kpis.savings)} against buying new`,
      body: 'Measured across retreads with a completed life and a recorded cost, against running new tyres the same distance at fleet new-tyre CPK.',
    })
  }
  return out
}

/**
 * ROI projection. Every missing or non-positive input yields null for the
 * results that depend on it; nothing is divided by a placeholder of 1.
 */
export function roiProjection({ newCost, retreadCost, retreadLifeKm, newLifeKm, fleetSize, annualKm = DEFAULT_ANNUAL_KM } = {}) {
  const pos = (v) => { const n = num(v); return n != null && n > 0 ? n : null }
  const nC = pos(newCost)
  const rC = pos(retreadCost)
  const rL = pos(retreadLifeKm)
  const nL = pos(newLifeKm)
  const fS = num(fleetSize) != null && num(fleetSize) >= 0 ? num(fleetSize) : null
  const aK = pos(annualKm)

  const newCpkVal = nC != null && nL != null ? nC / nL : null
  const rCpkVal = rC != null && rL != null ? rC / rL : null
  const savingsPerTyre = newCpkVal != null && rCpkVal != null ? (newCpkVal - rCpkVal) * rL : null
  const breakEvenKm = newCpkVal != null && rC != null ? rC / newCpkVal : null
  const annualReplacements = fS != null && aK != null && rL != null ? fS * (aK / rL) : null
  const annualSavings = savingsPerTyre != null && annualReplacements != null ? savingsPerTyre * annualReplacements : null
  const cpkImprovement = newCpkVal != null && rCpkVal != null && newCpkVal > 0
    ? ((newCpkVal - rCpkVal) / newCpkVal) * 100
    : null
  return {
    newCpkVal, rCpkVal, savingsPerTyre, breakEvenKm, annualReplacements, annualSavings, cpkImprovement,
    per100k: {
      newTyre: newCpkVal != null ? newCpkVal * 100000 : null,
      retread: rCpkVal != null ? rCpkVal * 100000 : null,
    },
  }
}
