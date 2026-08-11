/**
 * What period a results screen opens on.
 *
 * THE DEFAULT IS THE CURRENT YEAR, with a floor of three months.
 *
 * It used to be the current month, and that is what made screens look empty.
 * Measured on live data: tyre records, accidents and job-card lines all have
 * ZERO rows in the current month, because they arrive in uploads rather than
 * daily. Any screen reading those opened blank, which reads as lost data.
 *
 * The current year has data in every feed (tyre records 3,653, accidents 38,
 * inspections 244, job-card lines all 184,025) and still cuts what is read by
 * four to five times against all of history - expenses 43,755 of 208,375, job
 * cards 21,338 of 88,773. So it is both the fast answer and the honest one.
 *
 * The three-month floor matters in January, when "this year" is a few days and
 * a year-to-date screen would go blank again on New Year's Day.
 *
 * A year with no data at all still falls back to the most recent year that has
 * some, and the screen SAYS which period it is showing. A period that quietly
 * became a different period is how someone reads a partial year as a full one.
 */

/** Local-time YYYY-MM-DD (never toISOString - that shifts the day in +03:00). */
export function toIsoDay(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Parse a date-ish value; null when it is not a real date. */
export function parseDay(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** First and last day of the month containing `date`. */
export function monthBounds(date) {
  const d = parseDay(date) || new Date()
  return {
    from: toIsoDay(new Date(d.getFullYear(), d.getMonth(), 1)),
    to: toIsoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  }
}

/** The whole calendar year containing `date`. */
export function yearBounds(date) {
  const d = parseDay(date) || new Date()
  return {
    from: toIsoDay(new Date(d.getFullYear(), 0, 1)),
    to: toIsoDay(new Date(d.getFullYear(), 11, 31)),
  }
}

/** Shortest window a screen may open on, so January is never a few days. */
export const MIN_MONTHS = 3

/**
 * Year to date, widened to at least MIN_MONTHS. In August this is Jan-Aug; in
 * January it reaches back into the previous year rather than showing four days.
 */
export function defaultWindow(now) {
  const clock = parseDay(now) || new Date()
  const yearStart = new Date(clock.getFullYear(), 0, 1)
  const floorStart = new Date(clock.getFullYear(), clock.getMonth() - (MIN_MONTHS - 1), 1)
  const start = floorStart < yearStart ? floorStart : yearStart
  return { from: toIsoDay(start), to: toIsoDay(clock) }
}

/** Month name for a label, e.g. "August 2026". */
export function monthLabel(date) {
  const d = parseDay(date)
  return d ? d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : null
}

/**
 * The period's own name, so no screen has to say "this period" or "previous".
 * A whole calendar year reads "2026"; a year to date reads "2026 to date"; a
 * single month reads "August 2026"; anything else names both ends.
 */
export function periodName(from, to) {
  const f = parseDay(from)
  const t = parseDay(to)
  if (!f && !t) return 'All time'
  if (!f) return `Up to ${monthLabel(t)}`
  if (!t) return `From ${monthLabel(f)}`

  const sameYear = f.getFullYear() === t.getFullYear()
  if (sameYear && f.getMonth() === t.getMonth()) return monthLabel(f)

  if (sameYear && f.getMonth() === 0 && f.getDate() === 1) {
    const endsYear = t.getMonth() === 11 && t.getDate() === 31
    if (endsYear) return String(f.getFullYear())
    const now = new Date()
    const toDate = t.getFullYear() === now.getFullYear()
    return toDate ? `${f.getFullYear()} to date` : `${f.getFullYear()} to ${monthLabel(t)}`
  }

  const short = (d) => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  return `${short(f)} to ${short(t)}`
}

/** The name of the period immediately before [from, to], for comparisons. */
export function previousPeriodName(from, to) {
  const f = parseDay(from)
  const t = parseDay(to)
  if (!f || !t) return 'Earlier'
  const span = t.getTime() - f.getTime()
  const prevTo = new Date(f.getTime() - 86400000)
  const prevFrom = new Date(prevTo.getTime() - span)
  return periodName(toIsoDay(prevFrom), toIsoDay(prevTo))
}

/**
 * Resolve the period a screen should open on.
 *
 * @param {object} opts
 * @param {string|Date|null} [opts.latest] newest row date this feed has, when known
 * @param {Date}   [opts.now]              injectable clock (tests, determinism)
 * @returns {{from:string,to:string,label:string,isDefault:boolean,fellBack:boolean,note:string|null}}
 */
export function resolveDefaultPeriod({ latest, now } = {}) {
  const clock = parseDay(now) || new Date()
  const current = defaultWindow(clock)
  const currentLabel = periodName(current.from, current.to)

  const latestDay = parseDay(latest)

  // Unknown is not empty. A feed we could not read opens on the default and
  // says nothing, rather than claiming a year has no data when we never looked.
  if (!latestDay) {
    return { ...current, label: currentLabel, isDefault: true, fellBack: false, note: null }
  }

  // In range, or dated into the future (job cards carry opened_at into December
  // - a future row must not drag the window into a year that has not happened).
  if (latestDay >= parseDay(current.from) || latestDay > clock) {
    return { ...current, label: currentLabel, isDefault: true, fellBack: false, note: null }
  }

  const back = yearBounds(latestDay)
  const backLabel = periodName(back.from, back.to)
  return {
    ...back,
    label: backLabel,
    isDefault: false,
    fellBack: true,
    note: `No records yet in ${currentLabel}. Showing ${backLabel}, the most recent year with data.`,
  }
}

/** Whole history - what a "show everything" control resets to. */
export const ALL_TIME = { from: null, to: null, label: 'All time' }
