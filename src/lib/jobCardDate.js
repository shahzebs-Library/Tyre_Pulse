/**
 * jobCardDate - single source for reading the MMYY period encoded in the LAST
 * four digits of a job-card / work-order number, and checking it against the
 * record's actual date.
 *
 * The ERP job-card numbers end in a four digit group that is MMYY:
 *   "GCKR/JC/0131/0726" -> 07/26 -> July 2026
 *   "RM/RMJC/0001/0226" -> 02/26 -> February 2026
 *   "EG/JC/0001/0120"   -> 01/20 -> January 2020
 * The digit before the period is a running sequence, NOT part of the date.
 *
 * DATA QUALITY CHECK (user requirement): when the month/year encoded in the
 * job card does not equal the month/year of the record date (opened_at /
 * issue_date), the row is flagged as a likely data-entry error (a typo such as
 * "0336" = year 2036 where the work order actually opened in March 2026).
 *
 * Pure engine: no I/O, no clock. Every value is injected. YY is always read as
 * 20YY (the fleet has no pre-2000 job cards). An invalid month (00 or > 12) or
 * a number with no trailing 4 digit group yields null so callers never treat a
 * garbage code as a real period.
 */

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * Extract the MMYY period from a job-card / work-order number.
 * Reads the FINAL four digit group (separator and trailing spaces tolerant),
 * splits it MM + YY, maps YY -> 2000 + YY, and rejects an out of range month.
 *
 * @param {string|number|null|undefined} jobCardNo
 * @returns {{month:number, year:number}|null} month 1..12, year e.g. 2026, or null
 */
export function parseJobCardPeriod(jobCardNo) {
  if (jobCardNo === null || jobCardNo === undefined) return null
  const s = String(jobCardNo).trim()
  if (!s) return null
  const m = s.match(/(\d{4})\s*$/)
  if (!m) return null
  const grp = m[1]
  const month = Number(grp.slice(0, 2))
  const yy = Number(grp.slice(2, 4))
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  return { month, year: 2000 + yy }
}

/**
 * Break a date value (ISO string, date-only string, or Date) into calendar
 * {month, year}. Reads the leading YYYY-MM textually first so a timezone offset
 * can never shift the month; falls back to Date parsing for other formats.
 * Returns null when the value is missing or unparseable.
 *
 * @param {string|Date|null|undefined} dateISO
 * @returns {{month:number, year:number}|null}
 */
export function dateParts(dateISO) {
  if (dateISO === null || dateISO === undefined) return null
  if (dateISO instanceof Date) {
    if (Number.isNaN(dateISO.getTime())) return null
    return { month: dateISO.getUTCMonth() + 1, year: dateISO.getUTCFullYear() }
  }
  const s = String(dateISO).trim()
  if (!s) return null
  const textual = s.match(/^(\d{4})-(\d{2})/)
  if (textual) {
    const year = Number(textual[1])
    const month = Number(textual[2])
    if (month >= 1 && month <= 12) return { month, year }
    return null
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }
}

/**
 * True only when a real period and a real date agree on month AND year.
 * Null-safe: a null period, unknown date, or either side unparseable yields
 * false (unknown is never reported as a match).
 *
 * @param {{month:number, year:number}|null|undefined} period
 * @param {string|Date|null|undefined} dateISO
 * @returns {boolean}
 */
export function periodMatchesDate(period, dateISO) {
  if (!period) return false
  const dp = dateParts(dateISO)
  if (!dp) return false
  return dp.month === period.month && dp.year === period.year
}

/**
 * Full check for one record: derive the job-card period, compare it to the
 * record date, and classify.
 *   known    - both the period and the date were derivable (comparable)
 *   match    - known AND they agree
 *   mismatch - known AND they disagree (the data-quality flag)
 * When not known, both match and mismatch are false (do not flag the unknown).
 *
 * @param {string|number|null|undefined} jobCardNo
 * @param {string|Date|null|undefined} dateISO
 * @returns {{period:({month:number,year:number}|null), date:({month:number,year:number}|null), known:boolean, match:boolean, mismatch:boolean}}
 */
export function checkJobCardPeriod(jobCardNo, dateISO) {
  const period = parseJobCardPeriod(jobCardNo)
  const date = dateParts(dateISO)
  const known = !!(period && date)
  const match = known && date.month === period.month && date.year === period.year
  return { period, date, known, match, mismatch: known && !match }
}

/**
 * Human label for a period, e.g. "Jul 2026". Returns "Unknown" for null.
 * @param {{month:number, year:number}|null|undefined} period
 * @returns {string}
 */
export function describePeriod(period) {
  if (!period) return 'Unknown'
  return `${MONTH_NAMES[period.month - 1]} ${period.year}`
}

/**
 * Zero-padded MMYY string for a period, e.g. {month:7,year:2026} -> "0726".
 * Returns "" for null.
 * @param {{month:number, year:number}|null|undefined} period
 * @returns {string}
 */
export function formatPeriodMMYY(period) {
  if (!period) return ''
  const mm = String(period.month).padStart(2, '0')
  const yy = String(period.year % 100).padStart(2, '0')
  return `${mm}${yy}`
}

/**
 * One line explanation of a check result, suitable for a flag list / tooltip.
 * No dash punctuation (ASCII colon separators only).
 * @param {ReturnType<typeof checkJobCardPeriod>} result
 * @returns {string}
 */
export function describeCheck(result) {
  if (!result || !result.known) return 'Period not verifiable'
  if (result.match) return `Job card period ${describePeriod(result.period)} matches the record date`
  return `Job card period ${describePeriod(result.period)} does not match record date ${describePeriod(result.date)}`
}

/**
 * Summarize a batch of {jobCardNo, dateISO} records into counts.
 * @param {Array<{jobCardNo?:string, dateISO?:(string|Date)}>} rows
 * @returns {{total:number, checked:number, matched:number, mismatched:number, unknown:number}}
 */
export function summarizeJobCardChecks(rows) {
  const list = Array.isArray(rows) ? rows : []
  let matched = 0
  let mismatched = 0
  let unknown = 0
  for (const r of list) {
    const res = checkJobCardPeriod(r && r.jobCardNo, r && r.dateISO)
    if (!res.known) unknown += 1
    else if (res.mismatch) mismatched += 1
    else matched += 1
  }
  return {
    total: list.length,
    checked: matched + mismatched,
    matched,
    mismatched,
    unknown,
  }
}

export { MONTH_NAMES }
