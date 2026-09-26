/**
 * Tyre Scrap Management analytics (pure, no I/O).
 *
 * THE ONE HOME for every figure on the heuristic tabs of /scrap (Overview,
 * By Brand, By Site, Disposal Log). Those tabs are deliberately a scrap-RATE
 * ANALYSIS: a tyre counts as "scrap" when it LOOKS scrap-worthy
 * (risk_level Critical or category Scrap). That is NOT the list of tyres
 * somebody actually pressed Scrap on - that list is the Scrapped Register tab
 * (src/components/tyre/ScrappedRegister.jsx, over list_scrapped_tyres). Keep
 * the two definitions apart.
 *
 * Honesty rules:
 *   - an unmeasurable figure is null (rendered N/A), never a fabricated 0;
 *   - cost only sums rows that carry a price, and says how many did;
 *   - "now" is injectable, and every window is anchored to the data's own
 *     latest activity so a historic import still fills the charts.
 */
import { cleanRemovalReason } from './removalReason'

export const DATE_RANGE_OPTS = Object.freeze([
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 180 days', days: 180 },
  { label: 'Last 365 days', days: 365 },
  { label: 'All time', days: null },
])

export const REMOVAL_REASONS = Object.freeze(['All', 'Flat', 'Wear', 'Damage', 'Cut', 'Burst', 'Sidewall', 'Other'])

/** Share of scrapped tyres assumed retreadable, and the saving vs new. Estimates, labelled as such. */
export const RETREAD_SHARE = 0.30
export const RETREAD_SAVING = 0.40
/** A tyre scrapped below this share of the fleet average life is "early". */
export const EARLY_SCRAP_SHARE = 0.5
/** Scrap-rate bands (percent). */
export const RATE_BANDS = Object.freeze({ review: 20, watch: 10 })

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const trimOr = (v, fallback) => {
  const s = v == null ? '' : String(v).trim()
  return s || fallback
}

/** The serial, whichever column the read used (serial_no is canonical). */
export const serialOf = (t) => trimOr(t?.serial_no ?? t?.serial_number, null)
/** The business date a scrap is judged on: removal, else issue. */
export const refDate = (t) => (t?.removal_date || t?.issue_date || null)

export function isScrap(t) {
  return t?.risk_level === 'Critical' || t?.category === 'Scrap'
}

/** Distance the tyre ran, or null when the odometer pair is missing or reversed. */
export function kmLife(t) {
  const f = num(t?.km_at_fitment)
  const r = num(t?.km_at_removal)
  if (f != null && r != null && r > f) return r - f
  return null
}

/** Cost of the row (unit price x quantity), or null when no price is recorded. */
export function tyreCost(t) {
  const c = num(t?.cost_per_tyre)
  if (c == null) return null
  const q = num(t?.qty)
  return c * (q && q > 0 ? q : 1)
}

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/** Latest activity date in the data; falls back to `now` (injectable). */
export function dataAnchor(tyres = [], now = new Date()) {
  let max = null
  for (const t of tyres) {
    const ref = refDate(t)
    if (ref && (!max || ref > max)) max = ref
  }
  return max ? new Date(String(max).slice(0, 10) + 'T00:00:00') : new Date(now)
}

/** Inclusive lower bound for a "last N days" window, or null for all time. */
export function cutoffFor(days, anchor) {
  if (days == null) return null
  const d = new Date(anchor)
  d.setDate(d.getDate() - days)
  return d
}

/** Mean km life across every tyre that has a measurable one, or null. */
export function fleetAvgKmLife(tyres = []) {
  const lives = tyres.map(kmLife).filter((v) => v != null && v > 0)
  if (!lives.length) return null
  return lives.reduce((s, v) => s + v, 0) / lives.length
}

const sumCosts = (rows) => {
  let total = 0
  let costed = 0
  for (const t of rows) {
    const c = tyreCost(t)
    if (c != null) { total += c; costed++ }
  }
  return { total: costed ? total : null, costed }
}

/**
 * Headline KPIs over the filtered population and its scrapped subset.
 * scrapRate is null (not 0) when there are no tyres to rate.
 */
export function scrapKpis(filtered = [], scrapped = []) {
  const totalCount = filtered.length
  const scrapCount = scrapped.length
  const { total: totalCost, costed } = sumCosts(scrapped)
  const lives = scrapped.map(kmLife).filter((v) => v != null && v > 0)
  const avgKmLife = lives.length ? lives.reduce((a, b) => a + b, 0) / lives.length : null
  const scrapRate = totalCount > 0 ? (scrapCount / totalCount) * 100 : null
  const retreadCandidates = Math.round(scrapCount * RETREAD_SHARE)
  const avgCost = totalCost != null && costed > 0 ? totalCost / costed : null
  const retreadSavings = avgCost != null ? retreadCandidates * avgCost * RETREAD_SAVING : null
  return {
    totalCount, scrapCount, totalCost, costedCount: costed,
    avgKmLife, livesMeasured: lives.length, scrapRate,
    retreadCandidates, retreadSavings,
  }
}

/** Zero-filled monthly count + cost ending at the anchor month. */
export function monthlyScrapTrend(rows = [], anchor = new Date(), months = 12, labelFn = monthKey) {
  const a = new Date(anchor)
  const out = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(a.getFullYear(), a.getMonth() - i, 1)
    out.push({ key: monthKey(d), label: labelFn(d), count: 0, cost: 0 })
  }
  const byKey = new Map(out.map((m) => [m.key, m]))
  for (const t of rows) {
    const ref = refDate(t)
    if (!ref) continue
    const bucket = byKey.get(String(ref).slice(0, 7))
    if (!bucket) continue
    bucket.count++
    bucket.cost += tyreCost(t) ?? 0
  }
  return out
}

/** Count rows by a key; returns [{label, count}] sorted by count desc. */
export function countBy(rows = [], keyFn) {
  const map = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

/** Removal reasons of scrapped tyres (a brand stored as a reason is not one). */
export const reasonBreakdown = (scrapped = []) =>
  countBy(scrapped, (t) => cleanRemovalReason(t.removal_reason) || 'Unknown')

/** Wheel positions of scrapped tyres. */
export const positionBreakdown = (scrapped = []) =>
  countBy(scrapped, (t) => trimOr(t.position, 'Unknown'))

/** Scrapped tyres whose life fell below half the fleet average. [] when the average is unknown. */
export function earlyScrap(scrapped = [], fleetAvg = null) {
  if (fleetAvg == null || !(fleetAvg > 0)) return []
  const threshold = fleetAvg * EARLY_SCRAP_SHARE
  return scrapped
    .map((t) => {
      const life = kmLife(t)
      return { ...t, life, pctOfAvg: life != null ? (life / fleetAvg) * 100 : null }
    })
    .filter((t) => t.life != null && t.life < threshold)
    .sort((a, b) => a.life - b.life)
}

/** Estimated retread opportunity in the anchor month. savings null when no row is priced. */
export function retreadOpportunity(allScrapped = [], anchor = new Date()) {
  const key = monthKey(new Date(anchor))
  const month = allScrapped.filter((t) => {
    const ref = refDate(t)
    return ref && String(ref).slice(0, 7) === key
  })
  const count = Math.round(month.length * RETREAD_SHARE)
  const { total, costed } = sumCosts(month)
  const units = month.reduce((s, t) => s + ((num(t.qty) || 0) > 0 ? num(t.qty) : 1), 0)
  const avgCost = total != null && costed > 0 ? total / Math.max(units, 1) : null
  return { monthKey: key, scrappedThisMonth: month.length, count, savings: avgCost != null ? count * avgCost * RETREAD_SAVING : null }
}

export function rateBand(rate) {
  if (rate == null) return 'unknown'
  if (rate > RATE_BANDS.review) return 'review'
  if (rate > RATE_BANDS.watch) return 'watch'
  return 'normal'
}

/** Per-brand scrap performance over the filtered population. */
export function brandScrapAnalysis(filtered = [], fleetAvg = null) {
  const map = new Map()
  for (const t of filtered) {
    const b = trimOr(t.brand, 'Unknown')
    if (!map.has(b)) map.set(b, { brand: b, total: 0, scrap: 0, lives: [], cost: 0, costed: 0, earlyCount: 0 })
    const e = map.get(b)
    e.total++
    if (!isScrap(t)) continue
    e.scrap++
    const life = kmLife(t)
    if (life != null && life > 0) e.lives.push(life)
    const c = tyreCost(t)
    if (c != null) { e.cost += c; e.costed++ }
    if (fleetAvg != null && life != null && life < fleetAvg * EARLY_SCRAP_SHARE) e.earlyCount++
  }
  return [...map.values()].map((e) => {
    const scrapRate = e.total > 0 ? (e.scrap / e.total) * 100 : null
    const avgKm = e.lives.length ? e.lives.reduce((a, v) => a + v, 0) / e.lives.length : null
    const totalCost = e.costed ? e.cost : null
    const avgCPK = avgKm && totalCost != null && totalCost > 0 && e.scrap > 0 ? totalCost / (avgKm * e.scrap) : null
    const earlyPct = e.scrap > 0 && fleetAvg != null ? (e.earlyCount / e.scrap) * 100 : null
    const band = rateBand(scrapRate)
    const rec = band === 'review' ? 'High scrap, review' : band === 'unknown' ? 'Not measurable' : 'Normal performance'
    return {
      brand: e.brand, total: e.total, scrap: e.scrap, earlyCount: e.earlyCount,
      scrapRate, avgKm, totalCost, avgCPK, earlyPct, band, rec,
    }
  }).sort((a, b) => (b.scrapRate ?? -1) - (a.scrapRate ?? -1))
}

/** Per-site scrap analysis with a last-two-months direction. */
export function siteScrapAnalysis(filtered = []) {
  const map = new Map()
  for (const t of filtered) {
    const s = trimOr(t.site, 'Unknown')
    if (!map.has(s)) map.set(s, { site: s, total: 0, scrap: 0, cost: 0, costed: 0, brands: {}, monthly: {} })
    const e = map.get(s)
    e.total++
    if (!isScrap(t)) continue
    e.scrap++
    const c = tyreCost(t)
    if (c != null) { e.cost += c; e.costed++ }
    const b = trimOr(t.brand, 'Unknown')
    e.brands[b] = (e.brands[b] || 0) + 1
    const ref = refDate(t)
    if (ref) {
      const mk = String(ref).slice(0, 7)
      e.monthly[mk] = (e.monthly[mk] || 0) + 1
    }
  }
  return [...map.values()].map((e) => {
    const scrapRate = e.total > 0 ? (e.scrap / e.total) * 100 : null
    const worstBrand = Object.entries(e.brands).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const keys = Object.keys(e.monthly).sort()
    let trend = keys.length >= 2 ? 'stable' : 'unknown'
    if (keys.length >= 2) {
      const last = e.monthly[keys[keys.length - 1]] || 0
      const prev = e.monthly[keys[keys.length - 2]] || 0
      if (last > prev * 1.1) trend = 'up'
      else if (last < prev * 0.9) trend = 'down'
    }
    return {
      site: e.site, total: e.total, scrap: e.scrap,
      cost: e.costed ? e.cost : null, scrapRate, band: rateBand(scrapRate),
      worstBrand, trend, monthly: e.monthly,
    }
  }).sort((a, b) => (b.scrapRate ?? -1) - (a.scrapRate ?? -1))
}

/** Scrap count per month for the top sites over the last N months. */
export function siteMonthlySeries(siteAnalysis = [], anchor = new Date(), months = 6, top = 5, labelFn = monthKey) {
  const a = new Date(anchor)
  const buckets = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(a.getFullYear(), a.getMonth() - i, 1)
    buckets.push({ key: monthKey(d), label: labelFn(d) })
  }
  const series = siteAnalysis.slice(0, top).map((s) => ({
    site: s.site,
    data: buckets.map((m) => s.monthly?.[m.key] ?? 0),
  }))
  return { labels: buckets.map((m) => m.label), series }
}

/** Brand x site scrap counts for the top brands and sites. */
export function brandSiteMatrix(scrapped = [], brands = [], sites = []) {
  const counts = {}
  let maxVal = 0
  const brandSet = new Set(brands)
  const siteSet = new Set(sites)
  for (const t of scrapped) {
    const bk = trimOr(t.brand, 'Unknown')
    const sk = trimOr(t.site, 'Unknown')
    if (!brandSet.has(bk) || !siteSet.has(sk)) continue
    const key = `${bk}__${sk}`
    counts[key] = (counts[key] || 0) + 1
    if (counts[key] > maxVal) maxVal = counts[key]
  }
  const rows = brands.map((brand) => {
    const row = { brand }
    for (const site of sites) row[site] = counts[`${brand}__${site}`] ?? 0
    return row
  })
  return { brands, sites, rows, maxVal }
}

/** Heat level for a matrix cell, so the UI can label a band as well as colour it. */
export function heatLevel(value, maxVal) {
  if (!value) return 'none'
  const i = maxVal > 0 ? value / maxVal : 0
  if (i > 0.7) return 'high'
  if (i > 0.4) return 'medium'
  return 'low'
}

/** Disposal log: scrapped tyres filtered by free text / brand / site / date, newest first. */
export function filterDisposalLog(allScrapped = [], { search = '', brand = 'All', site = 'All', from = '', to = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return allScrapped
    .filter((t) => {
      if (q) {
        const hay = [serialOf(t), t.brand, t.asset_no, t.site].map((v) => String(v ?? '').toLowerCase())
        if (!hay.some((h) => h.includes(q))) return false
      }
      if (brand !== 'All' && t.brand !== brand) return false
      if (site !== 'All' && t.site !== site) return false
      const ref = refDate(t)
      if (from && (!ref || ref < from)) return false
      if (to && (!ref || ref > to)) return false
      return true
    })
    .sort((a, b) => String(refDate(b) || '').localeCompare(String(refDate(a) || '')))
}

/** Disposal status counts for the log. Unrecorded = Pending. */
export function disposalSummary(log = [], disposals = {}) {
  const out = { Disposed: 0, Retreaded: 0, Pending: 0 }
  for (const t of log) {
    const s = disposals[t.id] ?? 'Pending'
    out[s] = (out[s] || 0) + 1
  }
  return out
}
