/**
 * tyreRunningLife - pure shaping for the "Running & Remaining" view
 * (per active tyre: km/hours run against the asset's current meters, and the
 * projected remaining km from the fleet's own measured life for that size).
 *
 * Every figure may be null (no meter, placeholder fitment km, no baseline) -
 * callers render N/A, never a fabricated number.
 */

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Normalise one RPC row. */
export function shapeRow(r = {}) {
  return {
    serial: r.serial_no || '',
    asset: r.asset_no || '',
    position: r.position || '',
    vehicleType: r.vehicle_type || '',
    unit: r.unit === 'engine_hours' ? 'hours' : 'km',
    site: r.site || '',
    country: r.country || '',
    brand: r.brand || '',
    size: r.size || '',
    fittedOn: r.fitted_on || null,
    daysOn: num(r.days_on),
    expectedDays: num(r.expected_days),
    daySample: num(r.day_sample),
    remainingDays: num(r.remaining_days),
    lifeBasis: r.life_basis || null,
    kmAtFitment: num(r.km_at_fitment),
    currentKm: num(r.current_km),
    kmRun: num(r.km_run),
    hoursAtFitment: num(r.hours_at_fitment),
    currentHours: num(r.current_hours),
    hoursRun: num(r.hours_run),
    expectedLifeKm: num(r.expected_life_km),
    expectedLifeHours: num(r.expected_life_hours),
    lifeSample: num(r.life_sample),
    remainingKm: num(r.remaining_km),
    remainingHours: num(r.remaining_hours),
    lifeUsedPct: num(r.life_used_pct),
    hoursUsedPct: num(r.hours_used_pct),
  }
}

/** Shape the whole RPC payload -> { ok, rows, summary }. */
export function shapeRunningLife(payload) {
  if (!payload || payload.ok === false) return { ok: false, rows: [], summary: emptySummary() }
  const rows = (Array.isArray(payload.rows) ? payload.rows : []).map(shapeRow)
  return { ok: true, rows, summary: summarize(rows) }
}

function emptySummary() {
  return { total: 0, measurableKm: 0, measurableHours: 0, overdue: 0, dueSoon: 0, avgUsedPct: null }
}

/**
 * Summary tiles. "Due soon" = remaining under 10,000 km or >= 90% of expected
 * life used; "overdue" = past the expected life entirely (remaining 0).
 */
export function summarize(rows = []) {
  const total = rows.length
  const measurableKm = rows.filter((r) => r.kmRun != null).length
  const measurableHours = rows.filter((r) => r.hoursRun != null).length
  // Tiles and row badges share ONE judgement (bandFor) so they can never disagree.
  const overdue = rows.filter((r) => bandFor(r) === 'overdue').length
  const dueSoon = rows.filter((r) => bandFor(r) === 'due-soon').length
  const pcts = rows.map((r) => (r.lifeUsedPct != null ? r.lifeUsedPct : r.hoursUsedPct)).filter((v) => v != null)
  const avgUsedPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null
  return { total, measurableKm, measurableHours, overdue, dueSoon, avgUsedPct, ...coverage(rows) }
}

/**
 * WHY a row shows a blank "Km run", counted rather than left for the reader to
 * guess from empty cells.
 *
 * Measured on the live KSA fleet: of 3,505 active tyres only 2,059 can show a km
 * run. NONE of them is missing its fitment km - the gap is entirely on the other
 * side: 1,260 sit on a vehicle whose CURRENT odometer is unknown, because nobody
 * has logged a meter reading for it, and 304 are plant measured on the hour
 * meter (correctly no km at all).
 *
 * A blank cell reads as a broken report. The same blank, counted and explained,
 * reads as a meter-reading backlog - which is the true and actionable statement,
 * and points at the person who can fix it.
 */
export function coverage(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let noCurrentKm = 0
  let onHours = 0
  let noFitmentKm = 0
  for (const r of list) {
    if (!r || r.kmRun != null) continue
    if (r.unit === 'engine_hours') { onHours += 1; continue }
    if (r.currentKm == null) { noCurrentKm += 1; continue }
    if (r.kmAtFitment == null) { noFitmentKm += 1 }
  }
  return { noCurrentKm, onHours, noFitmentKm }
}

/**
 * One plain-English sentence for the coverage gap, or '' when every tyre on
 * screen can be measured (saying "3,505 of 3,505" on a complete view is noise).
 */
export function coverageNote(summary) {
  if (!summary || !summary.total) return ''
  const parts = []
  if (summary.noCurrentKm > 0) {
    parts.push(`${summary.noCurrentKm.toLocaleString()} are on a vehicle with no current odometer reading, so their km run cannot be worked out - log a meter reading for those assets and they fill in automatically`)
  }
  if (summary.onHours > 0) {
    parts.push(`${summary.onHours.toLocaleString()} are plant measured on the hour meter, so they correctly show hours instead of km`)
  }
  if (summary.noFitmentKm > 0) {
    parts.push(`${summary.noFitmentKm.toLocaleString()} have no fitment km recorded`)
  }
  if (!parts.length) return ''
  const blank = summary.total - summary.measurableKm
  return `${blank.toLocaleString()} of ${summary.total.toLocaleString()} tyres show a blank Km run: ${parts.join('; ')}.`
}

/**
 * The three numbers that decide "due soon".
 *
 * V526 MIRRORS THESE IN SQL (get_tyre_running_life p_due_only). A rule written
 * twice is a rule that drifts, so they live here as named constants, the SQL
 * carries the same figures with a comment pointing back, and
 * src/test/tyreRunningLifeBands.test.js fails if these move without the SQL.
 * CHANGE BOTH TOGETHER.
 */
export const DUE_SOON_KM = 10000
export const DUE_SOON_HOURS = 500
export const LIFE_USED_DUE_PCT = 90

/**
 * Traffic-light band for a row (drives the row badge). Judged in km when the
 * tyre has a km reading; an hour-metered tyre with only an hours target is
 * judged against that target instead (never 'unknown' just because the asset
 * runs on the hour meter).
 */
export function bandFor(row) {
  if (!row) return 'unknown'
  let rem = row.remainingKm
  let used = row.lifeUsedPct
  let soon = rem != null && rem < DUE_SOON_KM
  if (rem == null && row.remainingHours != null) {
    rem = row.remainingHours
    used = row.hoursUsedPct
    soon = rem < DUE_SOON_HOURS
  }
  if (rem == null) return 'unknown'
  if (rem === 0) return 'overdue'
  if (soon || (used != null && used >= LIFE_USED_DUE_PCT)) return 'due-soon'
  if (used != null && used >= 60) return 'mid-life'
  return 'healthy'
}

/**
 * Is this row one the p_due_only server filter would return? Exactly
 * overdue + due-soon; an 'unknown' row (nothing remaining to measure) is NOT
 * due - saying a tyre we cannot measure is due would be a fabrication.
 */
export function isDueRow(row) {
  const b = bandFor(row)
  return b === 'overdue' || b === 'due-soon'
}

/**
 * The bands a due-only fetch can hold. Anything else (mid-life, healthy, not
 * measurable) simply is not in that payload.
 *
 * THIS IS WHY IT MATTERS: if the screen holds only the due subset and someone
 * picks "Healthy", an empty table would say "there are no healthy tyres" when
 * the truth is "we never fetched them". Those are opposite statements and must
 * never look the same, so the caller widens the fetch instead.
 */
export const DUE_ONLY_BANDS = ['overdue', 'due-soon']

/** Does this band selection require the full country set to be loaded? */
export function bandNeedsFullSet(band) {
  return Boolean(band) && band !== 'all' && !DUE_ONLY_BANDS.includes(band)
}

export const BAND_META = {
  overdue: { label: 'Past expected life', tone: 'danger' },
  'due-soon': { label: 'Due soon', tone: 'warning' },
  'mid-life': { label: 'Mid life', tone: 'info' },
  healthy: { label: 'Healthy', tone: 'good' },
  unknown: { label: 'Not measurable', tone: 'quiet' },
}

/** Search + band + unit filter over shaped rows. */
export function filterRows(rows = [], { search = '', band = 'all', unit = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (unit !== 'all' && r.unit !== unit) return false
    if (band !== 'all' && bandFor(r) !== band) return false
    if (!q) return true
    return r.serial.toLowerCase().includes(q)
      || r.asset.toLowerCase().includes(q)
      || r.site.toLowerCase().includes(q)
      || r.brand.toLowerCase().includes(q)
      || r.size.toLowerCase().includes(q)
      || r.vehicleType.toLowerCase().includes(q)
  })
}

export const fmtNum = (v) => (v == null ? 'N/A' : Math.round(v).toLocaleString('en-US'))

/** "60,000 km / 8,000 hrs" - whichever of the two dimensions is set; N/A when neither. */
export function lifeDisplay(kmVal, hoursVal) {
  const parts = []
  if (kmVal != null) parts.push(`${fmtNum(kmVal)} km`)
  if (hoursVal != null) parts.push(`${fmtNum(hoursVal)} hrs`)
  return parts.length ? parts.join(' / ') : 'N/A'
}

/** Binary due flag from the band: Due / Not due / Unknown. */
export function dueLabel(row) {
  const b = bandFor(row)
  if (b === 'overdue' || b === 'due-soon') return 'Due'
  if (b === 'unknown') return 'Unknown'
  return 'Not due'
}

/**
 * Fitted-date range test (string-safe 'YYYY-MM-DD' prefix comparison).
 * With no range set every row passes; with a range active, a row that has no
 * fitment date is excluded (its date is unknown, not "inside the range").
 */
export function inFittedRange(row, from = '', to = '') {
  if (!from && !to) return true
  const d = row && row.fittedOn ? String(row.fittedOn).slice(0, 10) : ''
  if (!d) return false
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

/**
 * What a due-only export actually covers. An export headed "All active tyres"
 * that in fact holds 465 of 3,595 rows is a false statement that outlives the
 * screen it came from, so the scope is named first in every report header.
 */
export const DUE_SCOPE_LABEL = 'Tyres currently due (past expected life or due soon)'

/**
 * Plain-English description of the active filters, for report headers.
 * `scope` is 'due' when only the due subset was fetched, 'all' otherwise.
 */
export function filterDescription({ search = '', band = 'all', unit = 'all', fromDate = '', toDate = '', scope = 'all' } = {}) {
  const parts = []
  if (scope === 'due') parts.push(DUE_SCOPE_LABEL)
  const q = String(search || '').trim()
  if (q) parts.push(`search "${q}"`)
  if (band !== 'all') parts.push(`state: ${BAND_META[band] ? BAND_META[band].label : band}`)
  if (unit !== 'all') parts.push(unit === 'km' ? 'km-measured assets only' : 'hour-measured assets only')
  if (fromDate && toDate) parts.push(`fitted ${fromDate} to ${toDate}`)
  else if (fromDate) parts.push(`fitted from ${fromDate}`)
  else if (toDate) parts.push(`fitted up to ${toDate}`)
  return parts.length ? parts.join(', ') : 'All active tyres'
}

/**
 * The rows a manager acts on: overdue first, then due-soon, each group sorted
 * by life-used % descending (most consumed first). Unmeasured pct sorts last.
 */
export function actionRows(rows = []) {
  const rank = { overdue: 0, 'due-soon': 1 }
  const usedOf = (r) => {
    const p = r.lifeUsedPct != null ? r.lifeUsedPct : r.hoursUsedPct
    return p != null ? p : -1
  }
  return rows
    .filter((r) => {
      const b = bandFor(r)
      return b === 'overdue' || b === 'due-soon'
    })
    .sort((a, b) => {
      const d = rank[bandFor(a)] - rank[bandFor(b)]
      if (d) return d
      return usedOf(b) - usedOf(a)
    })
}

/** Plain-English label for what an expected life is based on. */
export const BASIS_META = {
  manual: { label: 'Your target', tone: 'info' },
  measured_type: { label: 'Type avg', tone: 'good' },
  measured_size: { label: 'Size avg', tone: 'quiet' },
}
export function basisLabel(row) {
  if (!row || !row.lifeBasis) return 'No baseline'
  const meta = BASIS_META[row.lifeBasis]
  if (!meta) return 'No baseline'
  if (row.lifeBasis === 'manual') return meta.label
  return row.lifeSample != null ? `${meta.label} (${row.lifeSample})` : meta.label
}
