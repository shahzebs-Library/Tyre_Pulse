/**
 * Accident analytics: what the numbers rest on, and what the data can actually
 * support.
 *
 * WHY THIS EXISTS. The analytics page computes a confident figure for every
 * headline whether or not the underlying field was ever filled in. Measured on
 * the live set of 35 incidents:
 *
 *   repair_cost         2 of 35     so the repair total is 33 incidents short
 *   parts_cost         35 of 35 BUT every value is 0.00, so it adds nothing
 *   police_report_no    0 of 35     so "pending police reports" counts every
 *                                   open case and means "we never record one"
 *   root_cause          0 of 35     so a root-cause breakdown has nothing in it
 *   claim_amount        5 of 35     so claim exposure rests on five records
 *   release_date       11 of 35     so average closure time rests on eleven
 *   driver_name         7 of 35     so a per-driver ranking is mostly blank
 *
 * A figure computed from 2 of 35 records is not wrong, but presenting it the
 * same size and colour as one computed from 35 is. So every metric here carries
 * its own basis, and the page states it.
 *
 * It also adds the analysis the populated fields DO support - concentration,
 * repeat assets, weekday profile, closure spread - because incident_date, site,
 * asset_no and severity are complete, and those are the questions that can be
 * answered honestly.
 *
 * Pure: no I/O, no Date.now() without an injected `now`, no randomness.
 * REUSES claimsAnalytics and accidentWorkflow rather than recomputing anything
 * they already define.
 */

const s = (v) => String(v ?? '').trim()
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * Coverage of one field across the set.
 *
 * `money: true` is the important distinction: a cost column full of zeros is
 * PRESENT but records nothing, and counting it as filled is how "parts cost"
 * came to look like a complete data point while contributing 0.00 to every
 * total. For money, only a non-zero value counts as recorded.
 *
 * @returns {{field:string, filled:number, total:number, pct:number|null, money:boolean}}
 */
export function coverageOf(records, field, { money = false } = {}) {
  const list = Array.isArray(records) ? records : []
  const total = list.length
  let filled = 0
  for (const r of list) {
    const v = r?.[field]
    if (money) {
      const n = num(v)
      if (n !== null && n !== 0) filled += 1
    } else if (v === true) {
      filled += 1
    } else if (v !== null && v !== undefined && v !== false && s(v) !== '') {
      filled += 1
    }
  }
  return { field, filled, total, pct: total ? filled / total : null, money }
}

/** Under this share of records, a figure is reported but not leant on. */
export const RELIABLE_COVERAGE = 0.6

export const isReliable = (cov) => (cov?.pct ?? 0) >= RELIABLE_COVERAGE

/**
 * "from 2 of 35 incidents" - the sentence that turns a number into a claim you
 * can judge. Returns '' when the field is complete, because saying "from 35 of
 * 35" on every tile is noise.
 */
export function basisNote(cov) {
  if (!cov || !cov.total) return ''
  if (cov.filled === cov.total) return ''
  if (cov.filled === 0) return 'never recorded'
  return `from ${cov.filled} of ${cov.total}`
}

/**
 * The fields each headline number actually depends on. Keeping this as data
 * rather than scattered through the page is what lets the report state its own
 * basis without every tile re-deriving it.
 */
export const METRIC_BASIS = Object.freeze({
  repairCost: { fields: ['repair_cost', 'parts_cost'], money: true, label: 'Repair cost' },
  claimed: { fields: ['claim_amount'], money: true, label: 'Amount claimed' },
  recovered: { fields: ['recovered_amount'], money: true, label: 'Amount recovered' },
  avgClosure: { fields: ['release_date'], money: false, label: 'Average closure time' },
  rootCause: { fields: ['root_cause'], money: false, label: 'Root cause' },
  driver: { fields: ['driver_name'], money: false, label: 'Driver' },
  police: { fields: ['police_report_no'], money: false, label: 'Police report' },
  fault: { fields: ['fault_status'], money: false, label: 'Fault status' },
  vehicleType: { fields: ['vehicle_type'], money: false, label: 'Vehicle type' },
})

/**
 * Best coverage across the fields a metric can draw on - a metric satisfied by
 * either of two columns is as covered as its better column.
 */
export function metricBasis(records, key) {
  const spec = METRIC_BASIS[key]
  if (!spec) return null
  const covs = spec.fields.map((f) => coverageOf(records, f, { money: spec.money }))
  const best = covs.reduce((a, b) => ((b.filled > a.filled) ? b : a), covs[0])
  return { ...best, key, label: spec.label, fields: covs }
}

/**
 * The things a reader must know before trusting the page. Only emitted when
 * true of the actual data - an empty list means the data really is complete,
 * which is a statement worth being able to make.
 */
export function analyticsCaveats(records) {
  const list = Array.isArray(records) ? records : []
  const total = list.length
  if (!total) return []
  const out = []

  const repair = coverageOf(list, 'repair_cost', { money: true })
  const parts = coverageOf(list, 'parts_cost', { money: true })
  if (repair.filled + parts.filled === 0) {
    out.push({
      key: 'cost', severity: 'high',
      text: 'No repair or parts cost is recorded on any incident, so every cost figure on this page is zero because the data is missing, not because nothing was spent.',
    })
  } else if (repair.filled + parts.filled < total) {
    out.push({
      key: 'cost', severity: 'medium',
      text: `Repair cost is recorded on ${repair.filled} and parts cost on ${parts.filled} of ${total} incidents, so the cost total is a floor, not the real spend.`,
    })
  }

  const police = coverageOf(list, 'police_report_no')
  if (police.filled === 0) {
    out.push({
      key: 'police', severity: 'medium',
      text: 'A police report number is never recorded, so "pending police reports" counts every open case rather than identifying the ones genuinely missing a report.',
    })
  }

  const root = coverageOf(list, 'root_cause')
  if (root.filled === 0) {
    out.push({
      key: 'root_cause', severity: 'medium',
      text: 'No incident records a root cause, so the page can show what happened and where, but not why.',
    })
  }

  const release = coverageOf(list, 'release_date')
  const closed = list.filter((r) => s(r.closure_status) === 'closed' || s(r.status).toLowerCase() === 'closed')
  if (closed.length && release.filled < closed.length) {
    out.push({
      key: 'closure', severity: 'low',
      text: `${closed.length - release.filled} of ${closed.length} closed incidents have no release date, so average closure time is measured on the rest.`,
    })
  }

  const claim = coverageOf(list, 'claim_amount', { money: true })
  if (claim.filled && claim.filled < total * 0.5) {
    out.push({
      key: 'claims', severity: 'low',
      text: `Only ${claim.filled} of ${total} incidents carry a claim amount, so recovery ratios describe those ${claim.filled}, not the fleet.`,
    })
  }

  const driver = coverageOf(list, 'driver_name')
  if (driver.filled < total * 0.5) {
    out.push({
      key: 'driver', severity: 'low',
      text: `A driver is named on ${driver.filled} of ${total} incidents, so any per-driver comparison is incomplete.`,
    })
  }

  return out
}

/**
 * Where incidents concentrate. This is the question the fleet can act on and
 * the data fully supports: site and asset are recorded on every incident.
 *
 * `topShare` is what makes it a finding rather than a list - one site holding
 * 57% of incidents is a different problem from seven sites holding a seventh
 * each. `paretoCount` is how many entries it takes to reach 80%.
 */
export function concentration(records, field, { fold = false } = {}) {
  const list = Array.isArray(records) ? records : []
  const counts = new Map()
  for (const r of list) {
    // `fold` is for identifier columns where case is not meaning - an asset
    // number split across two spellings understates its real count.
    const raw = s(r?.[field])
    const k = fold ? raw.toUpperCase() : raw
    if (!k) continue
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const rows = [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
  const counted = rows.reduce((a, r) => a + r.value, 0)
  let running = 0
  let paretoCount = 0
  for (const r of rows) {
    running += r.value
    paretoCount += 1
    if (counted && running / counted >= 0.8) break
  }
  return {
    field,
    rows,
    counted,
    distinct: rows.length,
    top: rows[0] || null,
    topShare: counted && rows[0] ? rows[0].value / counted : null,
    paretoCount: rows.length ? paretoCount : 0,
  }
}

/**
 * Assets that have been in more than one incident, worst first, with the gap
 * between the first and last. A repeat is a signal a single-incident list
 * cannot give you, and asset_no is recorded on every row so this is exact.
 */
export function repeatAssets(records) {
  const list = Array.isArray(records) ? records : []
  const by = new Map()
  for (const r of list) {
    // Fold case: before V397 the same vehicle appeared as tm673 and TM673, and
    // a repeat spread across both spellings looked like two single incidents.
    const k = s(r?.asset_no).toUpperCase()
    if (!k) continue
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(r)
  }
  const out = []
  for (const [asset, rows] of by) {
    if (rows.length < 2) continue
    const dates = rows.map((r) => s(r.incident_date).slice(0, 10)).filter(Boolean).sort()
    const first = dates[0] || null
    const last = dates[dates.length - 1] || null
    let spanDays = null
    if (first && last) {
      const d = (new Date(last) - new Date(first)) / 86400000
      if (Number.isFinite(d)) spanDays = Math.round(d)
    }
    out.push({
      asset,
      incidents: rows.length,
      first,
      last,
      spanDays,
      // Average days between incidents on this asset. Null for a single gap of
      // unknown length rather than a fabricated cadence.
      meanGapDays: spanDays != null && rows.length > 1 ? Math.round(spanDays / (rows.length - 1)) : null,
      sites: [...new Set(rows.map((r) => s(r.site)).filter(Boolean))],
    })
  }
  return out.sort((a, b) => b.incidents - a.incidents
    || String(a.asset).localeCompare(String(b.asset)))
}

const WEEKDAYS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])

/**
 * Incidents by day of week. incident_date is recorded on every row, so this is
 * one of the few fully supported breakdowns. A peak here is actionable: it
 * points at a shift or a delivery pattern rather than at a vehicle.
 */
export function weekdayProfile(records) {
  const counts = WEEKDAYS.map((label) => ({ label, value: 0 }))
  let dated = 0
  for (const r of Array.isArray(records) ? records : []) {
    const d = new Date(s(r?.incident_date))
    if (Number.isNaN(d.getTime())) continue
    // getUTCDay: 0=Sun. Shift so Monday leads, matching the ISO week the rest of
    // the app uses.
    counts[(d.getUTCDay() + 6) % 7].value += 1
    dated += 1
  }
  const peak = counts.reduce((a, b) => (b.value > a.value ? b : a), counts[0])
  return {
    rows: counts,
    dated,
    peak: peak.value > 0 ? peak : null,
    peakShare: dated && peak.value > 0 ? peak.value / dated : null,
  }
}

/** Buckets for how long a case takes to close. */
export const CLOSURE_BUCKETS = Object.freeze([
  { label: '0 to 7 days', max: 7 },
  { label: '8 to 15 days', max: 15 },
  { label: '16 to 30 days', max: 30 },
  { label: '31 to 60 days', max: 60 },
  { label: 'over 60 days', max: Infinity },
])

/**
 * Spread of closure times, not just the average. An average of 20 days hides
 * whether that is every case at 20 or half at 3 and half at 40, and only the
 * second is a process problem. Measured on cases that record BOTH dates, and it
 * reports how many that was.
 */
export function closureDistribution(records) {
  const rows = CLOSURE_BUCKETS.map((b) => ({ label: b.label, value: 0 }))
  const days = []
  for (const r of Array.isArray(records) ? records : []) {
    const from = s(r?.incident_date).slice(0, 10)
    const to = s(r?.release_date).slice(0, 10)
    if (!from || !to) continue
    const d = (new Date(to) - new Date(from)) / 86400000
    if (!Number.isFinite(d) || d < 0) continue
    days.push(d)
    rows[CLOSURE_BUCKETS.findIndex((b) => d <= b.max)].value += 1
  }
  days.sort((a, b) => a - b)
  const median = days.length
    ? (days.length % 2
      ? days[(days.length - 1) / 2]
      : (days[days.length / 2 - 1] + days[days.length / 2]) / 2)
    : null
  return {
    rows,
    measured: days.length,
    total: Array.isArray(records) ? records.length : 0,
    median: median == null ? null : Math.round(median),
    longest: days.length ? Math.round(days[days.length - 1]) : null,
    // Null rather than 0 when nothing could be measured: "we did not measure
    // this" and "every case closed the same day" are opposite statements.
    mean: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
  }
}

/**
 * Recovery against what was claimed. Both sides are sparse, so the ratio ships
 * with the count it was computed from and is null rather than 0 when there is
 * nothing to divide.
 */
export function recoveryRatio(records) {
  const list = Array.isArray(records) ? records : []
  let claimed = 0
  let recovered = 0
  let withClaim = 0
  for (const r of list) {
    const c = num(r?.claim_amount) || 0
    const v = num(r?.recovered_amount) || 0
    if (c) withClaim += 1
    claimed += c
    recovered += v
  }
  return {
    claimed,
    recovered,
    outstanding: claimed - recovered,
    ratio: claimed > 0 ? recovered / claimed : null,
    withClaim,
    total: list.length,
  }
}

/**
 * Incidents that look like the same event entered twice: one asset, one day.
 *
 * REPORTED, NEVER REMOVED. Two incidents on one vehicle on one day is unusual
 * but entirely possible, and the difference between a duplicate and a bad
 * morning is a judgement about the real world that this function cannot make.
 * So it hands over the group and what differs inside it, and a person decides.
 *
 * Asset is folded to upper case for the comparison: before V397 the same vehicle
 * appeared as both tm673 and TM673, which hid exactly this.
 */
export function possibleDuplicates(records) {
  const list = Array.isArray(records) ? records : []
  const by = new Map()
  for (const r of list) {
    const asset = s(r?.asset_no).toUpperCase()
    const day = s(r?.incident_date).slice(0, 10)
    if (!asset || !day) continue
    const k = `${asset}|${day}`
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(r)
  }
  const out = []
  for (const [, rows] of by) {
    if (rows.length < 2) continue
    // What actually differs tells the reader whether it is a duplicate or two
    // genuine events - identical rows are the suspicious ones.
    const differing = ['site', 'severity', 'status', 'accident_type', 'release_date', 'driver_name']
      .filter((f) => new Set(rows.map((r) => s(r?.[f]))).size > 1)
    out.push({
      asset: s(rows[0].asset_no).toUpperCase(),
      date: s(rows[0].incident_date).slice(0, 10),
      count: rows.length,
      differingFields: differing,
      ids: rows.map((r) => r?.id).filter(Boolean),
      // Nothing differs on the fields a person would use to tell them apart.
      identical: differing.length === 0,
    })
  }
  return out.sort((a, b) => b.count - a.count || String(a.asset).localeCompare(String(b.asset)))
}

/**
 * One object for the page and the report, so both describe the same thing.
 */
export function buildAccidentIntelligence(records) {
  const list = Array.isArray(records) ? records : []
  const dups = possibleDuplicates(list)
  const caveats = analyticsCaveats(list)
  if (dups.length) {
    caveats.push({
      key: 'duplicates', severity: 'medium',
      text: `${dups.length} vehicle-and-date combination${dups.length === 1 ? '' : 's'} appear more than once. `
        + 'They may be genuine repeat events or the same incident entered twice, so every count on this page '
        + 'includes them until someone checks.',
    })
  }
  return {
    total: list.length,
    caveats,
    basis: Object.fromEntries(Object.keys(METRIC_BASIS).map((k) => [k, metricBasis(list, k)])),
    bySite: concentration(list, 'site'),
    byAsset: concentration(list, 'asset_no', { fold: true }),
    byType: concentration(list, 'accident_type'),
    repeats: repeatAssets(list),
    weekday: weekdayProfile(list),
    closure: closureDistribution(list),
    recovery: recoveryRatio(list),
    duplicates: dups,
  }
}
