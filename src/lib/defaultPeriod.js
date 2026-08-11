/**
 * What period a results screen opens on.
 *
 * Screens used to open on all of history, which is why they were slow: reading
 * 208,375 expense lines to show a page of them is most of the wait. Opening on
 * the current month is the fix, and it is almost always what someone wants -
 * "how are we doing" means this month.
 *
 * BUT A BLANK MONTH IS NOT A BLANK SCREEN. Measured on live data, three of the
 * seven main feeds have no rows in the current month at all (tyre records last
 * landed 30 Jul, accidents 28 Jul, job-card lines 23 Jul), because they arrive
 * in uploads rather than daily. Defaulting those to the current month would show
 * an empty page and read as "the system lost my data".
 *
 * So the default is: the current month when it has data, otherwise the most
 * recent month that does - and the screen SAYS which month it is showing. A
 * period that quietly became a different period is how someone concludes a feed
 * is empty when it is not.
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
  const from = new Date(d.getFullYear(), d.getMonth(), 1)
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return { from: toIsoDay(from), to: toIsoDay(to) }
}

/** Month name for a label, e.g. "August 2026". */
export function monthLabel(date) {
  const d = parseDay(date)
  if (!d) return null
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/**
 * Resolve the period a screen should open on.
 *
 * @param {object} opts
 * @param {string|Date|null} [opts.latest] newest row date this feed has, when known
 * @param {Date}   [opts.now]              injectable clock (tests, determinism)
 * @returns {{from:string,to:string,label:string,isCurrentMonth:boolean,fellBack:boolean,note:string|null}}
 */
export function resolveDefaultPeriod({ latest, now } = {}) {
  const clock = parseDay(now) || new Date()
  const current = monthBounds(clock)
  const currentLabel = monthLabel(clock)

  const latestDay = parseDay(latest)

  // No idea what this feed holds - open on the current month rather than on all
  // of history. Being wrong here costs one click; loading everything costs the
  // wait this change exists to remove.
  if (!latestDay) {
    return {
      ...current, label: currentLabel, isCurrentMonth: true, fellBack: false, note: null,
    }
  }

  const sameMonth =
    latestDay.getFullYear() === clock.getFullYear() && latestDay.getMonth() === clock.getMonth()

  // A future-dated row (there are some - a job card opened_at runs to Dec 2026)
  // must not drag the default forward into a month that has not happened.
  if (sameMonth || latestDay > clock) {
    return {
      ...current, label: currentLabel, isCurrentMonth: true, fellBack: false, note: null,
    }
  }

  const back = monthBounds(latestDay)
  const backLabel = monthLabel(latestDay)
  return {
    ...back,
    label: backLabel,
    isCurrentMonth: false,
    fellBack: true,
    note: `No records yet in ${currentLabel}. Showing ${backLabel}, the most recent month with data.`,
  }
}

/** Whole history - what a "show everything" control resets to. */
export const ALL_TIME = { from: null, to: null, label: 'All time' }
