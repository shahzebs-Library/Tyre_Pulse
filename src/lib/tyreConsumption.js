/**
 * tyreConsumption - the pure engine behind "how many tyres do we fit, and what
 * is the daily average". No I/O; the clock is injected so every result is
 * reproducible in a test.
 *
 * THE ONE IDEA THIS FILE EXISTS TO PROTECT
 * ----------------------------------------
 * A "daily average" is a division, and the denominator is a claim about the
 * world. There are two defensible denominators and they answer different
 * questions:
 *
 *   per CALENDAR day = fitments / every day in the period
 *       "what does this fleet consume per day of operation" - the number a
 *       budget or a stock level is built on. Days with no fitment count as
 *       real zero-consumption days.
 *
 *   per ACTIVE day  = fitments / days that actually recorded a fitment
 *       "on a day we fit tyres, how many do we fit" - the number to use when
 *       recording is patchy, because it does not treat an unrecorded day as a
 *       day nothing happened.
 *
 * When recording is near-complete the two nearly agree and the calendar rate is
 * the honest headline. When coverage is thin they diverge hard (measured live:
 * KSA 95.6% coverage -> 11.29 vs 11.80 per day, a 4% gap; Egypt 29.7% coverage
 * -> 1.05 vs 3.56 per day, a 3.4x gap). So BOTH are always computed, coverage is
 * always reported, and `basisDiverges` tells the screen when the headline alone
 * would mislead.
 *
 * The other rule: an absent measurement is null, never 0. A period with no
 * fitments cannot distinguish "we fitted nothing" from "nobody uploaded", so it
 * yields a null rate that renders as "Not measured" - never a confident 0.0/day
 * that reads as a fleet standing still.
 */

/**
 * Coverage at or above this is treated as near-complete recording.
 * Calibrated against the live data rather than picked round: KSA sits at 95.6%
 * coverage where the two bases differ by 4% (genuinely reassuring), while UAE
 * sits at 82.4% where they still differ by 21%. A gate of 80 would have called
 * that 21% gap "almost certainly real quiet days", so the gate is 85.
 */
export const GOOD_COVERAGE_PCT = 85
/** Below this, the calendar rate is very likely an understatement. */
export const WEAK_COVERAGE_PCT = 50

export const RATE_BASIS = {
  calendar: {
    key: 'calendar',
    label: 'Per calendar day',
    help: 'Every day in the period counts, including days with no fitment.',
  },
  active: {
    key: 'active',
    label: 'Per recording day',
    help: 'Only days that actually recorded a fitment count.',
  },
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Local-time YYYY-MM-DD. toISOString() rolls the day back at +03:00. */
export function toIsoDay(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Parse YYYY-MM-DD as a LOCAL date (new Date('2026-08-01') is UTC midnight). */
export function parseIsoDay(s) {
  if (typeof s !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Inclusive whole days between two YYYY-MM-DD strings; null when unusable. */
export function daysBetween(fromIso, toIso) {
  const a = parseIsoDay(fromIso)
  const b = parseIsoDay(toIso)
  if (!a || !b) return null
  const ms = b.getTime() - a.getTime()
  if (ms < 0) return null
  return Math.round(ms / 86400000) + 1
}

/**
 * The core division. Returns nulls rather than a flattering zero whenever the
 * period genuinely carries nothing to measure.
 */
export function consumptionRates({ fitments, calendarDays, activeDays } = {}) {
  const f = num(fitments)
  const cal = num(calendarDays)
  const act = num(activeDays)

  const coveragePct = isNum(cal) && cal > 0 && isNum(act)
    ? Math.round((1000 * act) / cal) / 10
    : null

  // No fitments at all: we cannot tell "nothing was fitted" from "nothing was
  // uploaded", so we decline to state a rate.
  if (!isNum(f) || f <= 0) {
    return {
      fitments: isNum(f) ? f : null,
      calendarDays: cal, activeDays: act, coveragePct,
      perCalendarDay: null, perActiveDay: null,
      basisDiverges: false, ratio: null,
    }
  }

  const perCalendarDay = isNum(cal) && cal > 0 ? Math.round((100 * f) / cal) / 100 : null
  const perActiveDay = isNum(act) && act > 0 ? Math.round((100 * f) / act) / 100 : null
  const ratio = isNum(perCalendarDay) && isNum(perActiveDay) && perCalendarDay > 0
    ? Math.round((100 * perActiveDay) / perCalendarDay) / 100
    : null

  return {
    fitments: f, calendarDays: cal, activeDays: act, coveragePct,
    perCalendarDay, perActiveDay, ratio,
    // Coverage below GOOD means more than a fifth of the period recorded
    // nothing; at that point the two bases are answering different questions
    // loudly enough that showing only one is misleading.
    basisDiverges: isNum(coveragePct) ? coveragePct < GOOD_COVERAGE_PCT : false,
  }
}

/**
 * Plain-English statement of what the headline rate rests on. This is the text
 * that keeps the number honest, so it is never optional and never silent when
 * the bases disagree.
 */
export function basisNote(rates) {
  if (!rates || !isNum(rates.fitments) || rates.fitments <= 0) {
    return 'No fitments are recorded in this period, so no daily rate can be measured. That is not the same as a fleet that fitted no tyres - it may simply mean nothing has been uploaded yet.'
  }
  const cov = rates.coveragePct
  const cal = isNum(rates.perCalendarDay) ? rates.perCalendarDay.toFixed(2) : null
  const act = isNum(rates.perActiveDay) ? rates.perActiveDay.toFixed(2) : null
  if (!cal) return 'The period length is unknown, so a daily rate cannot be measured.'

  const head = `${cal} tyres per calendar day, over ${rates.calendarDays} days.`
  if (!isNum(cov) || !act) return head

  if (cov >= GOOD_COVERAGE_PCT) {
    return `${head} ${cov}% of those days recorded at least one fitment, so the days with none are almost certainly real quiet days rather than missing uploads. On a day that did record fitments the rate is ${act}.`
  }
  if (cov >= WEAK_COVERAGE_PCT) {
    return `${head} Only ${cov}% of days recorded a fitment, so some of the quiet days may be days nobody uploaded rather than days nothing was fitted. On a recording day the rate is ${act} - treat ${cal} as the lower bound.`
  }
  return `Recording is thin: only ${cov}% of the days in this period carry any fitment at all. The calendar rate of ${cal} per day is very likely an understatement of real consumption, and the recording-day rate of ${act} is very likely an overstatement. The true figure sits between them, and neither should be quoted on its own until the feed is complete.`
}

/**
 * Does the fitment date look like an upload artifact? A batch load that stamps
 * every row with the day it was uploaded would produce as many fitment days as
 * upload days, and a high same-day share. Measured live on this data: KSA
 * August 2026 = 1 upload day, 10 fitment days, 0 same-day rows, so the dates are
 * genuine. This function reports that check rather than assuming its answer.
 */
export function batchDateCheck(check, fitments) {
  const uploadDays = num(check?.upload_days)
  const fitDays = num(check?.fit_days)
  const sameDay = num(check?.same_day)
  const total = num(fitments)
  if (!isNum(uploadDays) || !isNum(fitDays) || !isNum(total) || total <= 0) {
    return { ok: null, verdict: 'unknown', note: 'The upload pattern could not be checked for this period.' }
  }
  const sameDayPct = isNum(sameDay) ? Math.round((1000 * sameDay) / total) / 10 : null
  // Dates are suspect when they barely spread beyond the upload days, or when
  // most rows are stamped with their own upload day.
  const spread = uploadDays > 0 ? fitDays / uploadDays : null
  const suspect = (isNum(sameDayPct) && sameDayPct >= 50) || (isNum(spread) && spread <= 1.5 && fitDays <= 3)
  if (suspect) {
    return {
      ok: false, verdict: 'clustered', uploadDays, fitDays, sameDayPct,
      note: `Fitment dates cluster on upload days (${fitDays} fitment date${fitDays === 1 ? '' : 's'} across ${uploadDays} upload day${uploadDays === 1 ? '' : 's'}${isNum(sameDayPct) ? `, ${sameDayPct}% stamped with their own upload day` : ''}). A daily average from these dates would describe when the file was loaded, not when tyres were fitted. Do not read the rate below as a consumption rate.`,
    }
  }
  return {
    ok: true, verdict: 'real', uploadDays, fitDays, sameDayPct,
    note: `Dates check out: ${total} fitments arrived on ${uploadDays} upload day${uploadDays === 1 ? '' : 's'} but carry ${fitDays} distinct fitment dates${isNum(sameDayPct) ? `, and ${sameDayPct}% are stamped with their own upload day` : ''}. The dates are real business dates, so the daily rate is a genuine consumption rate.`,
  }
}

/** Per-month rows with each month's own rate (the current month is partial). */
export function monthRows(byMonth) {
  if (!Array.isArray(byMonth)) return []
  return byMonth.map((r) => {
    const n = num(r?.n) ?? 0
    const cal = num(r?.cal_days)
    const act = num(r?.active_days)
    const rates = consumptionRates({ fitments: n, calendarDays: cal, activeDays: act })
    return {
      month: String(r?.m ?? ''),
      fitments: n,
      calendarDays: cal,
      activeDays: act,
      perCalendarDay: rates.perCalendarDay,
      perActiveDay: rates.perActiveDay,
      coveragePct: rates.coveragePct,
      // A month clipped by the window edge is not comparable with a whole one.
      partial: isNum(cal) ? cal < daysInMonth(String(r?.m ?? '')) : null,
    }
  })
}

/** Calendar length of a YYYY-MM month; null when unparseable. */
export function daysInMonth(m) {
  const mm = /^(\d{4})-(\d{2})$/.exec(String(m || ''))
  if (!mm) return null
  return new Date(Number(mm[1]), Number(mm[2]), 0).getDate()
}

/**
 * Zero-filled daily series across the whole window. The zeros are real days, not
 * padding - a chart that only plots recorded days hides every quiet day and makes
 * consumption look smoother and higher than it is.
 */
export function dailySeries(byDay, fromIso, toIso, { max = 400 } = {}) {
  const start = parseIsoDay(fromIso)
  const end = parseIsoDay(toIso)
  if (!start || !end || end < start) return []
  const seen = new Map()
  for (const r of Array.isArray(byDay) ? byDay : []) {
    const d = String(r?.d ?? '').slice(0, 10)
    if (d) seen.set(d, num(r?.n) ?? 0)
  }
  const out = []
  const cur = new Date(start.getTime())
  while (cur <= end && out.length < max) {
    const key = toIsoDay(cur)
    out.push({ d: key, n: seen.get(key) ?? 0, recorded: seen.has(key) })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/**
 * Month-on-month direction, comparing only WHOLE months - a partial current
 * month always looks like a collapse and would report a fake downturn.
 */
export function monthTrend(rows) {
  const whole = (Array.isArray(rows) ? rows : []).filter(
    (r) => r.partial !== true && isNum(r.perCalendarDay),
  )
  if (whole.length < 2) {
    return { direction: 'unknown', changePct: null, note: 'At least two complete months are needed before a trend can be read.' }
  }
  const prev = whole[whole.length - 2]
  const last = whole[whole.length - 1]
  if (!isNum(prev.perCalendarDay) || prev.perCalendarDay === 0) {
    return { direction: 'unknown', changePct: null, note: 'The earlier month has no measurable rate to compare against.' }
  }
  const changePct = Math.round((1000 * (last.perCalendarDay - prev.perCalendarDay)) / prev.perCalendarDay) / 10
  const direction = Math.abs(changePct) < 5 ? 'flat' : changePct > 0 ? 'up' : 'down'
  return {
    direction, changePct, from: prev.month, to: last.month,
    note: direction === 'flat'
      ? `Consumption is steady between ${prev.month} and ${last.month} (${changePct > 0 ? '+' : ''}${changePct}%).`
      : `Daily consumption is ${direction} ${Math.abs(changePct)}% from ${prev.month} (${prev.perCalendarDay}/day) to ${last.month} (${last.perCalendarDay}/day).`,
  }
}

/** Breakdown rows with share, plus the unresolved coverage the join left behind. */
export function breakdownRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  const total = list.reduce((s, r) => s + (num(r?.n) ?? 0), 0)
  const resolved = list.filter((r) => r?.resolved).reduce((s, r) => s + (num(r?.n) ?? 0), 0)
  return {
    rows: list.map((r) => ({
      key: String(r?.k ?? ''),
      fitments: num(r?.n) ?? 0,
      assets: num(r?.assets) ?? 0,
      resolved: !!r?.resolved,
      sharePct: total > 0 ? Math.round((1000 * (num(r?.n) ?? 0)) / total) / 10 : null,
    })),
    total,
    resolvedPct: total > 0 ? Math.round((1000 * resolved) / total) / 10 : null,
  }
}

/** Honest coverage sentence for a breakdown that could not fully resolve. */
export function breakdownNote(bd, what) {
  if (!bd || bd.total === 0) return null
  const pct = bd.resolvedPct
  if (!isNum(pct) || pct >= 99.9) return null
  return `${(100 - pct).toFixed(1)}% of these fitments could not be attributed to a ${what}; they are grouped separately rather than spread across the named rows.`
}

/** Render a rate, or the honest absence of one. Never prints 0.00 for unknown. */
export function fmtRate(v, unit = '/day') {
  return isNum(v) ? `${v.toFixed(2)}${unit}` : 'Not measured'
}

export function fmtCount(v) {
  return isNum(num(v)) ? num(v).toLocaleString() : 'Not measured'
}

/**
 * Shape the whole server payload into what the screen renders.
 * `now` is injected so tests are deterministic.
 */
export function shapeConsumption(payload, { now = new Date() } = {}) {
  if (!payload || payload.ok === false) {
    return { ok: false, reason: payload?.reason || 'unavailable' }
  }
  const from = String(payload.from ?? '').slice(0, 10)
  const to = String(payload.to ?? '').slice(0, 10)
  const calendarDays = num(payload.calendar_days) ?? daysBetween(from, to)
  const rates = consumptionRates({
    fitments: num(payload.fitments),
    calendarDays,
    activeDays: num(payload.active_days),
  })
  const months = monthRows(payload.by_month)
  const batch = batchDateCheck(payload.batch_check, num(payload.fitments))
  const bySite = breakdownRows(payload.by_site)
  const byClass = breakdownRows(payload.by_class)
  const series = dailySeries(payload.by_day, from, to)

  // The most recent day that recorded anything, and how stale that is. A feed
  // that stopped a month ago drags every rate down and must be visible.
  const lastRecorded = [...series].reverse().find((p) => p.recorded)?.d ?? null
  const todayIso = toIsoDay(now instanceof Date ? now : new Date())
  const staleDays = lastRecorded && todayIso ? (daysBetween(lastRecorded, todayIso) ?? null) : null

  return {
    ok: true,
    from, to, country: payload.country ?? null,
    ...rates,
    assets: num(payload.assets),
    undated: num(payload.undated),
    batch,
    months,
    trend: monthTrend(months),
    series,
    bySite, byClass,
    siteNote: breakdownNote(bySite, 'site'),
    classNote: breakdownNote(byClass, 'vehicle class'),
    lastRecorded,
    staleDays: isNum(staleDays) ? staleDays - 1 : null,
    basisNote: basisNote(rates),
  }
}
