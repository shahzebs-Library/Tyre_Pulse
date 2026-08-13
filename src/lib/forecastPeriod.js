/**
 * forecastPeriod - saying, in plain months, exactly what a forecast covers.
 *
 * THE PROBLEM THIS SOLVES. Every forecast on this system is anchored to the
 * LATEST MONTH THAT HAS DATA, not to today. That is the right choice - a
 * projection built forward from a month nobody uploaded would be projecting
 * from zero - but it means the horizon control lies by omission. Picking
 * "Next 3 Months" tells you how far ahead, never WHICH three, and never which
 * history produced them. If the last tyre file landed in July, "Next 3 Months"
 * silently means August to October measured from July, and the screen looks
 * identical to a forecast that is fully up to date.
 *
 * So the window is named out loud, and when the anchor has fallen behind the
 * calendar the screen says how far behind and why - because a forecast built on
 * stale data is not wrong, it is answering a question about a different month,
 * and the reader has to know which.
 *
 * Pure and deterministic: `now` is always injected, never read from the clock.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'Aug 2026' from a Date, a 'YYYY-MM' key or a 'YYYY-MM-DD' string. */
export function monthName(value) {
  const d = toDate(value)
  if (!d) return ''
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Whole months from a to b (b later = positive). Null when either is unusable. */
export function monthsBetween(a, b) {
  const x = toDate(a)
  const y = toDate(b)
  if (!x || !y) return null
  return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth())
}

/**
 * The full description of a forecast's window.
 *
 * @param {object}  opts
 * @param {*}       opts.anchor         latest month WITH DATA (Date | 'YYYY-MM' | ISO date)
 * @param {number}  opts.historyMonths  how many months of history feed it
 * @param {number}  opts.ahead          how many months it projects
 * @param {*}       [opts.now]          today, injected; defaults to the anchor
 *                                      so a caller that has no clock never
 *                                      manufactures a staleness claim
 * @returns {{ok:boolean, historyFrom:string, historyTo:string,
 *            forecastFrom:string, forecastTo:string, historyMonths:number,
 *            ahead:number, staleMonths:number|null, stale:boolean,
 *            label:string, note:string}}
 */
export function forecastWindow({ anchor, historyMonths = 12, ahead = 3, now = null } = {}) {
  const a = toDate(anchor)
  const empty = {
    ok: false, historyFrom: '', historyTo: '', forecastFrom: '', forecastTo: '',
    historyMonths: 0, ahead: 0, staleMonths: null, stale: false, label: '', note: '',
  }
  if (!a) return empty

  const hist = Math.max(1, Math.round(Number(historyMonths) || 0))
  const fwd = Math.max(0, Math.round(Number(ahead) || 0))

  const historyFrom = monthName(shift(a, -(hist - 1)))
  const historyTo = monthName(a)
  const forecastFrom = fwd ? monthName(shift(a, 1)) : ''
  const forecastTo = fwd ? monthName(shift(a, fwd)) : ''

  // Staleness is only claimed when a real clock was supplied. Defaulting `now`
  // to the anchor means "we were not told what day it is", which must read as
  // up to date rather than as a fabricated warning.
  const n = toDate(now) || a
  const staleMonths = monthsBetween(a, n)
  const stale = staleMonths != null && staleMonths >= 1

  const label = fwd
    ? `Built from ${historyFrom} to ${historyTo} (${hist} months), projecting ${forecastFrom}${forecastTo && forecastTo !== forecastFrom ? ` to ${forecastTo}` : ''}`
    : `Built from ${historyFrom} to ${historyTo} (${hist} months)`

  return {
    ok: true,
    historyFrom, historyTo, forecastFrom, forecastTo,
    historyMonths: hist, ahead: fwd, staleMonths, stale, label,
    note: stale ? staleNote(historyTo, staleMonths) : '',
  }
}

/**
 * Why the projection does not start next month.
 *
 * Named separately so a caller can style it as a warning without re-deriving
 * the sentence, and so the wording stays identical everywhere it appears.
 */
export function staleNote(latestMonth, staleMonths) {
  if (!latestMonth || !staleMonths || staleMonths < 1) return ''
  const n = Math.round(staleMonths)
  return `The newest data is ${latestMonth}, ${n} month${n === 1 ? '' : 's'} behind today, `
    + 'so the projection runs forward from there rather than from this month. '
    + 'Upload the missing months and the window moves with them.'
}

/**
 * The same description for a demand forecast that already carries its own month
 * axis (forecastTyreDemand returns `months` + `forecastMonths` as 'YYYY-MM'
 * keys). Reads the window off the result rather than being told it again, so
 * the caption and the chart can never describe different months.
 */
export function windowFromMonths(fc, now = null) {
  const months = Array.isArray(fc?.months) ? fc.months : []
  const ahead = Array.isArray(fc?.forecastMonths) ? fc.forecastMonths : []
  if (!months.length) {
    return forecastWindow({ anchor: null })
  }
  return forecastWindow({
    anchor: months[months.length - 1],
    historyMonths: months.length,
    ahead: ahead.length,
    now,
  })
}

/* ---------------------------------------------------------------- helpers */

function toDate(v) {
  if (!v) return null
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null
  const s = String(v).trim()
  // 'YYYY-MM' and 'YYYY-MM-DD' are both built locally: parsing 'YYYY-MM-DD'
  // through Date() treats it as UTC, which rolls the month back for anyone east
  // of Greenwich - and this fleet runs at +03:00.
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1))
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function shift(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}
