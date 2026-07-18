/**
 * Odometer Analytics — pure, dependency-free mileage intelligence for the
 * Odometer Logs module (/odometer-logs). Turns a flat set of odometer (km)
 * readings into per-asset mileage, fleet KPIs, data-quality anomalies, and
 * chart-ready series.
 *
 * Everything here is deterministic and I/O free so it can be unit-tested and
 * injected with in-memory rows. The page (`src/pages/OdometerLogs.jsx`) and any
 * report path build on these primitives; the roll-up maths live in exactly one
 * place. Never fabricates: when a value cannot be derived from real readings it
 * returns null (rendered as "N/A" upstream), and every suspect reading is
 * surfaced as an anomaly, never silently dropped.
 *
 * Row shape (from `odometer_logs`, V162):
 *   { id, asset_no, odometer_km, reading_date, source, site, created_at }
 */

const DAY_MS = 86400000

/** Heavy-fleet sanity ceiling for implied distance per day (km/day). */
export const MAX_KM_PER_DAY = 1500
/** Minimum absolute delta (km) before a jump is worth flagging (kills noise). */
export const JUMP_MIN_KM = 3000
/** A tracked asset with no fresh reading for this long is "stale". */
export const STALE_DAYS = 60

export const ANOMALY = Object.freeze({
  BACKWARD: 'backward',
  JUMP: 'jump',
  DUPLICATE: 'duplicate',
})

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toNum(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Sortable ordinal for a reading: prefer reading_date, fall back to created_at. */
function readingTime(r) {
  const d = r?.reading_date || r?.created_at
  if (!d) return 0
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** Whole days between two epoch millis (>= 0). */
function daysBetween(tEarly, tLate) {
  if (!Number.isFinite(tEarly) || !Number.isFinite(tLate)) return 0
  return Math.max(0, Math.round((tLate - tEarly) / DAY_MS))
}

/** 'YYYY-MM' month key for a reading's effective date, or null. */
function monthKey(r) {
  const d = r?.reading_date || r?.created_at
  if (!d) return null
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return null
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
}

const cleanKey = (v) => (v == null ? '' : String(v).trim())

/**
 * Group readings into a per-asset, time-ascending series.
 * Rows with no asset number are ignored. Returns Map<asset, sortedRows[]>.
 * @param {Array<object>} rows
 * @returns {Map<string, Array<object>>}
 */
export function assetSeries(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byAsset = new Map()
  for (const r of list) {
    const asset = cleanKey(r?.asset_no)
    if (!asset) continue
    if (!byAsset.has(asset)) byAsset.set(asset, [])
    byAsset.get(asset).push(r)
  }
  for (const arr of byAsset.values()) {
    // Time-ascending; same instant ordered by km so a same-day upward
    // correction reads as the later value.
    arr.sort((a, b) => {
      const ta = readingTime(a)
      const tb = readingTime(b)
      if (ta !== tb) return ta - tb
      return (toNum(a?.odometer_km) ?? 0) - (toNum(b?.odometer_km) ?? 0)
    })
  }
  return byAsset
}

/**
 * Per-asset mileage roll-up. For each asset, walks its time-ordered readings and
 * sums the POSITIVE deltas (monotonic guard) into distance travelled, records
 * first/latest odometer, average daily km over the observed window, staleness,
 * and per-asset anomalies.
 *
 * @param {Array<object>} rows
 * @param {{ now?:number, maxKmPerDay?:number, jumpMinKm?:number, staleDays?:number }} [opts]
 * @returns {Array<object>} one entry per asset, unsorted
 */
export function computeAssetMileage(rows = [], opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const maxKmPerDay = Number.isFinite(opts.maxKmPerDay) ? opts.maxKmPerDay : MAX_KM_PER_DAY
  const jumpMinKm = Number.isFinite(opts.jumpMinKm) ? opts.jumpMinKm : JUMP_MIN_KM
  const staleDays = Number.isFinite(opts.staleDays) ? opts.staleDays : STALE_DAYS

  const series = assetSeries(rows)
  const out = []

  for (const [asset, arr] of series) {
    const withKm = arr.filter((r) => toNum(r?.odometer_km) != null)
    const first = withKm[0]
    const last = withKm[withKm.length - 1]
    const firstKm = first ? toNum(first.odometer_km) : null
    const latestKm = last ? toNum(last.odometer_km) : null

    let kmAdded = 0
    let hasDelta = false
    const anomalies = []
    let lastSite = ''

    for (let i = 0; i < arr.length; i++) {
      const cur = arr[i]
      const site = cleanKey(cur?.site)
      if (site) lastSite = site
      const curKm = toNum(cur?.odometer_km)
      if (curKm == null || i === 0) continue
      // Nearest previous reading that carries a km value.
      let prev = null
      for (let j = i - 1; j >= 0; j--) {
        if (toNum(arr[j]?.odometer_km) != null) { prev = arr[j]; break }
      }
      if (!prev) continue
      const prevKm = toNum(prev.odometer_km)
      const delta = curKm - prevKm
      const days = daysBetween(readingTime(prev), readingTime(cur))

      if (delta < 0) {
        anomalies.push({
          asset, type: ANOMALY.BACKWARD, id: cur?.id ?? null,
          reading_date: cur?.reading_date || cur?.created_at || null,
          odometer_km: curKm, prevKm, prevDate: prev?.reading_date || prev?.created_at || null,
          delta, days,
          message: `Reading ${curKm.toLocaleString()} km is below the previous ${prevKm.toLocaleString()} km`,
        })
        continue // never count a backward delta as distance
      }
      if (delta === 0 && days === 0) {
        anomalies.push({
          asset, type: ANOMALY.DUPLICATE, id: cur?.id ?? null,
          reading_date: cur?.reading_date || cur?.created_at || null,
          odometer_km: curKm, prevKm, prevDate: prev?.reading_date || prev?.created_at || null,
          delta, days,
          message: `Duplicate same-day reading at ${curKm.toLocaleString()} km`,
        })
      }
      const impliedDaily = delta / Math.max(days, 1)
      if (delta >= jumpMinKm && impliedDaily > maxKmPerDay) {
        anomalies.push({
          asset, type: ANOMALY.JUMP, id: cur?.id ?? null,
          reading_date: cur?.reading_date || cur?.created_at || null,
          odometer_km: curKm, prevKm, prevDate: prev?.reading_date || prev?.created_at || null,
          delta, days,
          message: `Jump of ${delta.toLocaleString()} km${days ? ` over ${days} day${days === 1 ? '' : 's'}` : ' same day'} (~${Math.round(impliedDaily).toLocaleString()} km/day)`,
        })
      }
      kmAdded += delta
      hasDelta = true
    }

    const tFirst = first ? readingTime(first) : 0
    const tLast = last ? readingTime(last) : 0
    const daysCovered = daysBetween(tFirst, tLast)
    const avgDailyKm = hasDelta && daysCovered > 0
      ? Math.round((kmAdded / daysCovered) * 10) / 10
      : null
    const staleFor = tLast ? daysBetween(tLast, now) : null

    out.push({
      asset,
      site: lastSite || null,
      readingCount: arr.length,
      firstKm,
      latestKm,
      firstDate: first?.reading_date || first?.created_at || null,
      latestDate: last?.reading_date || last?.created_at || null,
      kmAdded: hasDelta ? kmAdded : null,
      daysCovered,
      avgDailyKm,
      staleFor,
      isStale: staleFor != null && staleFor > staleDays,
      anomalyCount: anomalies.length,
      anomalies,
    })
  }

  return out
}

/**
 * Flat, chronologically ordered list of every data-quality anomaly across the
 * fleet (backward readings, unrealistic jumps, duplicates). Newest first.
 * @param {Array<object>} rows
 * @param {object} [opts] passthrough to computeAssetMileage
 * @returns {Array<object>}
 */
export function detectAnomalies(rows = [], opts = {}) {
  const flat = []
  for (const a of computeAssetMileage(rows, opts)) {
    for (const an of a.anomalies) flat.push(an)
  }
  return flat.sort((x, y) => {
    const tx = x.reading_date ? new Date(x.reading_date).getTime() : 0
    const ty = y.reading_date ? new Date(y.reading_date).getTime() : 0
    return (ty || 0) - (tx || 0)
  })
}

/**
 * Fleet KPI summary for the header.
 *   assetsTracked   — distinct assets with at least one reading
 *   totalReadings   — number of rows
 *   totalKmLogged   — sum of positive deltas across the whole fleet (distance)
 *   avgDailyKm      — distance-weighted fleet daily rate (km added / days covered)
 *   mostDriven      — { asset, km } by distance travelled, or null
 *   leastDriven     — { asset, km } by distance travelled (assets with a delta), or null
 *   anomalyCount    — total surfaced anomalies
 *   staleAssets     — assets whose latest reading is older than staleDays
 *
 * @param {Array<object>} rows
 * @param {object} [opts]
 * @returns {object}
 */
export function summarizeMileage(rows = [], opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const assets = computeAssetMileage(list, opts)

  let totalKmLogged = 0
  let totalDaysCovered = 0
  let anomalyCount = 0
  let staleAssets = 0
  const driven = []

  for (const a of assets) {
    if (a.kmAdded != null) {
      totalKmLogged += a.kmAdded
      driven.push({ asset: a.asset, km: a.kmAdded })
    }
    if (a.daysCovered > 0 && a.kmAdded != null) totalDaysCovered += a.daysCovered
    anomalyCount += a.anomalyCount
    if (a.isStale) staleAssets += 1
  }

  driven.sort((x, y) => y.km - x.km)
  const avgDailyKm = totalDaysCovered > 0
    ? Math.round((totalKmLogged / totalDaysCovered) * 10) / 10
    : null

  return {
    assetsTracked: assets.length,
    totalReadings: list.length,
    totalKmLogged,
    avgDailyKm,
    mostDriven: driven.length ? driven[0] : null,
    leastDriven: driven.length ? driven[driven.length - 1] : null,
    anomalyCount,
    staleAssets,
  }
}

/**
 * Fleet mileage trend: total km added per calendar month. A month's total is the
 * sum of positive consecutive deltas whose LATER reading falls in that month.
 * Ascending by month key. Returns [] when no distance can be derived.
 *
 * @param {Array<object>} rows
 * @param {object} [opts] passthrough (maxKmPerDay etc. unused here)
 * @returns {Array<{ period:string, km:number }>}
 */
export function mileageTrend(rows = []) {
  const series = assetSeries(rows)
  const byMonth = new Map()
  for (const arr of series.values()) {
    let prev = null
    for (const cur of arr) {
      const curKm = toNum(cur?.odometer_km)
      if (curKm == null) continue
      if (prev != null) {
        const delta = curKm - prev
        if (delta > 0) {
          const key = monthKey(cur)
          if (key) byMonth.set(key, (byMonth.get(key) || 0) + delta)
        }
      }
      prev = curKm
    }
  }
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([period, km]) => ({ period, km: Math.round(km) }))
}

/**
 * Distance travelled per asset (positive deltas), sorted desc. Assets with no
 * derivable distance are excluded (honest — no fabricated zero).
 * @param {Array<object>} rows
 * @param {{ limit?:number }} [opts]
 * @returns {Array<{ label:string, value:number }>}
 */
export function kmByAsset(rows = [], { limit } = {}) {
  const list = computeAssetMileage(rows)
    .filter((a) => a.kmAdded != null && a.kmAdded > 0)
    .map((a) => ({ label: a.asset, value: Math.round(a.kmAdded) }))
    .sort((a, b) => b.value - a.value)
  return Number.isFinite(limit) ? list.slice(0, limit) : list
}

/**
 * Distance travelled per site (sum of per-asset distance grouped by the asset's
 * most recent site), sorted desc. Assets with no site fold into "Unassigned"
 * only when they have derivable distance.
 * @param {Array<object>} rows
 * @param {{ limit?:number }} [opts]
 * @returns {Array<{ label:string, value:number }>}
 */
export function kmBySite(rows = [], { limit } = {}) {
  const bySite = new Map()
  for (const a of computeAssetMileage(rows)) {
    if (a.kmAdded == null || a.kmAdded <= 0) continue
    const site = a.site || 'Unassigned'
    bySite.set(site, (bySite.get(site) || 0) + a.kmAdded)
  }
  const list = [...bySite.entries()]
    .map(([label, value]) => ({ label, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value)
  return Number.isFinite(limit) ? list.slice(0, limit) : list
}
