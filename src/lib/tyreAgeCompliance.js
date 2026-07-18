/**
 * Tyre Age Compliance - pure engine (no I/O, injectable `now`).
 *
 * Tyre rubber degrades with CALENDAR age regardless of remaining tread. In GCC
 * heat this is a real safety and insurance concern: an under-worn but old tyre
 * can still blow out. This module computes each tyre's calendar age from the
 * best available birth date and classifies it into tunable policy bands.
 *
 * Date preference (best = truest birth date first):
 *   1. DOT code (WWYY on the sidewall) or an explicit manufacture/DOT date
 *      -> the true birth date (dateEstimated = false)
 *   2. issue_date (stock issue) then fitment_date -> in-service proxies; real
 *      shelf age before that is unknown, so age is a floor (dateEstimated = true)
 *   3. no usable date -> the "date unknown" bucket (never guessed)
 *
 * All bands, thresholds and metadata live here so the page, service, exports and
 * tests share exactly one source of truth. Every function is deterministic:
 * callers pass the reference clock (`now` = Date | ms) explicitly.
 */

// ── Policy thresholds (YEARS from birth date). Tunable - override per call. ────
// OK        : age < watchYears
// Watch     : watchYears   <= age < replaceYears   (aging, monitor)
// Replace   : replaceYears <= age < overdueYears   (past service life, plan out)
// Overdue   : age >= overdueYears                  (must remove now)
export const DEFAULT_AGE_POLICY = Object.freeze({
  watchYears: 3,
  replaceYears: 5,
  overdueYears: 7,
})

export const AGE_BANDS = ['ok', 'watch', 'replace', 'overdue', 'unknown']

// Bands considered compliant (still within safe calendar service life).
export const COMPLIANT_BANDS = ['ok', 'watch']
// Bands considered non-compliant (at or past the replace threshold).
export const NON_COMPLIANT_BANDS = ['replace', 'overdue']

export const AGE_BAND_META = Object.freeze({
  ok: { key: 'ok', label: 'OK', tone: 'green', order: 0, description: 'Within safe calendar age.' },
  watch: { key: 'watch', label: 'Watch', tone: 'amber', order: 1, description: 'Aging. Monitor at each inspection.' },
  replace: { key: 'replace', label: 'Replace', tone: 'orange', order: 2, description: 'Past service life. Plan replacement.' },
  overdue: { key: 'overdue', label: 'Overdue', tone: 'red', order: 3, description: 'Beyond age limit. Remove now.' },
  unknown: { key: 'unknown', label: 'Date unknown', tone: 'slate', order: 4, description: 'No birth date on record.' },
})

export const DATE_SOURCE_META = Object.freeze({
  dot: { key: 'dot', label: 'DOT code', estimated: false },
  manufacture: { key: 'manufacture', label: 'Manufacture date', estimated: false },
  issue: { key: 'issue', label: 'Issue date (estimated)', estimated: true },
  fitment: { key: 'fitment', label: 'Fitment date (estimated)', estimated: true },
  unknown: { key: 'unknown', label: 'No date', estimated: false },
})

const MS_PER_DAY = 24 * 3600 * 1000
const MS_PER_YEAR = 365.25 * MS_PER_DAY

// ── Serial / position helpers (tyre_records carries several legacy aliases). ───
export function serialOf(rec) {
  return (rec && (rec.serial_no || rec.serial_number || rec.tyre_serial)) || null
}
export function positionOf(rec) {
  return (rec && (rec.position || rec.tyre_position)) || null
}

function round1(n) {
  return Math.round(n * 10) / 10
}

/** Parse a date-ish value into a valid Date, or null. */
export function parseDate(raw) {
  if (raw == null || raw === '') return null
  const d = raw instanceof Date ? raw : new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Parse a 4-digit DOT week code (WWYY, e.g. "2519" = week 25 of 2019) into an
 * approximate manufacture Date (mid-week, UTC). Accepts a longer string and
 * uses its trailing 4 digits. Returns null on anything invalid. Only 4-digit
 * (post-2000) codes are supported; 3-digit pre-2000 codes are ignored.
 */
export function parseDotCode(code) {
  if (code == null) return null
  const s = String(code).trim()
  const m = s.match(/(\d{2})(\d{2})\s*$/)
  if (!m) return null
  const ww = parseInt(m[1], 10)
  const yy = parseInt(m[2], 10)
  if (!(ww >= 1 && ww <= 53)) return null
  const year = 2000 + yy
  const jan1 = Date.UTC(year, 0, 1)
  const d = new Date(jan1 + ((ww - 1) * 7 + 3) * MS_PER_DAY)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Resolve the best available birth date for a tyre record.
 * @returns {{ date: Date|null, source: string, estimated: boolean }}
 */
export function resolveTyreDate(rec) {
  if (!rec || typeof rec !== 'object') return { date: null, source: 'unknown', estimated: false }

  const dot = parseDotCode(rec.dot_code)
  if (dot) return { date: dot, source: 'dot', estimated: false }

  const man = parseDate(rec.manufacture_date || rec.dot_date || rec.manufactured_at)
  if (man) return { date: man, source: 'manufacture', estimated: false }

  const iss = parseDate(rec.issue_date)
  if (iss) return { date: iss, source: 'issue', estimated: true }

  const fit = parseDate(rec.fitment_date)
  if (fit) return { date: fit, source: 'fitment', estimated: true }

  return { date: null, source: 'unknown', estimated: false }
}

function toNow(now) {
  const n = now instanceof Date ? now : new Date(now == null ? Date.now() : now)
  return Number.isNaN(n.getTime()) ? null : n
}

/**
 * Age of a tyre in years (1 decimal) as of `now`, or null when no usable date.
 * Future dates clamp to 0 (a data error should not read as a negative age).
 */
export function tyreAgeYears(rec, now) {
  const { date } = resolveTyreDate(rec)
  if (!date) return null
  const n = toNow(now)
  if (!n) return null
  const years = (n.getTime() - date.getTime()) / MS_PER_YEAR
  return years < 0 ? 0 : round1(years)
}

/** Classify a numeric age (years) into a policy band. */
export function classifyAge(years, policy = DEFAULT_AGE_POLICY) {
  if (years == null || typeof years !== 'number' || Number.isNaN(years)) return 'unknown'
  const p = { ...DEFAULT_AGE_POLICY, ...(policy || {}) }
  if (years >= p.overdueYears) return 'overdue'
  if (years >= p.replaceYears) return 'replace'
  if (years >= p.watchYears) return 'watch'
  return 'ok'
}

/** Band a tyre record directly. */
export function tyreAgeBand(rec, now, policy = DEFAULT_AGE_POLICY) {
  return classifyAge(tyreAgeYears(rec, now), policy)
}

export function isCompliantBand(band) {
  return COMPLIANT_BANDS.includes(band)
}
export function isNonCompliantBand(band) {
  return NON_COMPLIANT_BANDS.includes(band)
}

/**
 * Enrich a single record with age fields (non-mutating).
 * @returns record + { ageYears, ageMonths, ageBand, dateSource, dateEstimated, birthDate }
 */
export function assessTyre(rec, now, policy = DEFAULT_AGE_POLICY) {
  const { date, source, estimated } = resolveTyreDate(rec)
  const n = toNow(now)
  let ageYears = null
  let ageMonths = null
  if (date && n) {
    const years = (n.getTime() - date.getTime()) / MS_PER_YEAR
    ageYears = years < 0 ? 0 : round1(years)
    ageMonths = Math.max(0, Math.round((n.getTime() - date.getTime()) / (MS_PER_DAY * 30.4375)))
  }
  return {
    ...rec,
    ageYears,
    ageMonths,
    ageBand: classifyAge(ageYears, policy),
    dateSource: source,
    dateEstimated: estimated,
    birthDate: date ? date.toISOString().slice(0, 10) : null,
  }
}

function emptyCounts() {
  return { total: 0, ok: 0, watch: 0, replace: 0, overdue: 0, unknown: 0 }
}

function topGroups(map, limit = 10) {
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.sort - a.sort || a.key.localeCompare(b.key))
    .slice(0, limit)
}

/**
 * Assess a whole fleet. Returns enriched rows plus band counts, headline KPIs,
 * an ordered band distribution and site/brand breakdowns - everything the page
 * needs, computed once. Honest throughout: KPIs that need a birth date are null
 * when no dated tyres exist; nothing is fabricated.
 *
 * @param {Array<object>} records
 * @param {Date|number}   now      reference clock (injected)
 * @param {object}        policy   age thresholds
 */
export function assessFleet(records, now, policy = DEFAULT_AGE_POLICY) {
  const list = Array.isArray(records) ? records : []
  const rows = list.map((r) => assessTyre(r, now, policy))

  const counts = emptyCounts()
  counts.total = rows.length

  let ageSum = 0
  let ageN = 0
  let oldest = null
  let unknownEstimated = 0
  const siteMap = new Map()
  const brandMap = new Map()

  for (const r of rows) {
    counts[r.ageBand] += 1
    if (r.dateEstimated) unknownEstimated += 1

    if (typeof r.ageYears === 'number') {
      ageSum += r.ageYears
      ageN += 1
      if (!oldest || r.ageYears > oldest.ageYears) {
        oldest = {
          ageYears: r.ageYears,
          serial: serialOf(r) || 'N/A',
          asset_no: r.asset_no || 'N/A',
          site: r.site || 'N/A',
          brand: r.brand || 'N/A',
          band: r.ageBand,
        }
      }
      const nonCompliant = isNonCompliantBand(r.ageBand)
      const site = r.site || 'Unassigned'
      const sEntry = siteMap.get(site) || { total: 0, ageSum: 0, ageN: 0, nonCompliant: 0, sort: 0 }
      sEntry.total += 1; sEntry.ageSum += r.ageYears; sEntry.ageN += 1
      if (nonCompliant) sEntry.nonCompliant += 1
      siteMap.set(site, sEntry)

      const brand = r.brand || 'Unbranded'
      const bEntry = brandMap.get(brand) || { total: 0, ageSum: 0, ageN: 0, nonCompliant: 0, sort: 0 }
      bEntry.total += 1; bEntry.ageSum += r.ageYears; bEntry.ageN += 1
      if (nonCompliant) bEntry.nonCompliant += 1
      brandMap.set(brand, bEntry)
    }
  }

  const withDate = counts.total - counts.unknown
  const compliantCount = counts.ok + counts.watch
  const nonCompliantCount = counts.replace + counts.overdue
  const overdueCount = counts.overdue

  const kpis = {
    totalAssessed: counts.total,
    withDate,
    unknownDate: counts.unknown,
    unknownDatePct: counts.total > 0 ? Math.round((counts.unknown / counts.total) * 100) : null,
    estimatedDate: unknownEstimated,
    compliantCount,
    nonCompliantCount,
    overdueCount,
    compliancePct: withDate > 0 ? Math.round((compliantCount / withDate) * 100) : null,
    avgAgeYears: ageN > 0 ? round1(ageSum / ageN) : null,
    oldest,
  }

  // Ordered band distribution for the chart.
  const distribution = AGE_BANDS.map((band) => ({
    band,
    label: AGE_BAND_META[band].label,
    count: counts[band],
  }))

  // finalize breakdown sort keys: rank by non-compliant then avg age.
  const finalize = (map) => {
    for (const v of map.values()) {
      v.avgAge = v.ageN > 0 ? round1(v.ageSum / v.ageN) : null
      v.sort = v.nonCompliant * 1000 + (v.avgAge || 0)
    }
    return topGroups(map, 10).map(({ key, total, avgAge, nonCompliant }) => ({
      name: key, total, avgAge, nonCompliant,
    }))
  }

  return {
    rows,
    counts,
    kpis,
    distribution,
    bySite: finalize(siteMap),
    byBrand: finalize(brandMap),
  }
}

/**
 * Back-compat shim mirroring the older tyreAge.summarizeTyreAges shape but built
 * on the deeper engine. `advisory`/`nonCompliant` threshold names map onto the
 * new policy. Kept so older callers keep working if any adopt this module.
 */
export function summarizeTyreAges(records, now, thresholds) {
  const policy = thresholds
    ? {
        watchYears: thresholds.watchYears ?? thresholds.advisory ?? DEFAULT_AGE_POLICY.watchYears,
        replaceYears: thresholds.replaceYears ?? thresholds.nonCompliant ?? DEFAULT_AGE_POLICY.replaceYears,
        overdueYears: thresholds.overdueYears ?? DEFAULT_AGE_POLICY.overdueYears,
      }
    : DEFAULT_AGE_POLICY
  const { rows, counts, kpis } = assessFleet(records, now, policy)
  return { rows, counts, compliancePct: kpis.compliancePct, avgAge: kpis.avgAgeYears }
}
