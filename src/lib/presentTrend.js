/**
 * Trend lines for the presentation studio.
 *
 * Pure: no I/O, no chart library. The regression itself is the least-squares
 * `linearFit` already used by the expense forecast - one fit in the codebase,
 * not two that can disagree about the same numbers.
 *
 * THE RULE THAT MATTERS: a trend line is only meaningful when the x axis is
 * ORDERED. The studio's category sources (by asset, by site, by brand) are
 * sorted by value, so a line through them would trace the SORT and look like a
 * finding. `canTrend` is what stops that, and it is deliberately a property of
 * the data source rather than a checkbox the user can defeat.
 *
 * The fit also reports R squared, so a line drawn through scattered points is
 * labelled weak instead of being presented with the same confidence as a line
 * through a real trend.
 */
import { linearFit } from './expenseTrends'

/** Below this many points a straight line is arithmetic, not evidence. */
export const MIN_TREND_POINTS = 3

/** R squared under this means the points do not really sit on a line. */
export const WEAK_FIT_R2 = 0.3

// null/undefined/'' are GAPS, not zeros. Number(null) is 0 and 0 is finite, so
// a bare Number.isFinite check silently turns "no reading" into "spent nothing"
// and drags the fitted line toward the floor.
const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Can this source carry a trend line at all?
 * Only an ordered series can - see the rule at the top of this file.
 * @param {{kind?:string, ordered?:boolean}|null|undefined} src studio catalog entry
 */
export function canTrend(src) {
  if (!src) return false
  // An explicit `ordered` flag wins, so a future ordered flat source can opt in.
  if (typeof src.ordered === 'boolean') return src.ordered
  return src.kind === 'series'
}

/**
 * Least-squares trend over one numeric series.
 *
 * Returns null when there is nothing honest to draw: too few points, or every
 * point identical (a flat line through flat data tells the reader nothing they
 * cannot already see).
 *
 * @param {Array<number|null>} values
 * @returns {{fitted:number[], slope:number, intercept:number, r2:number|null,
 *            direction:'up'|'down'|'flat', weak:boolean, points:number}|null}
 */
export function trendLine(values) {
  const raw = Array.isArray(values) ? values.map(num) : []
  const present = raw.filter((v) => v != null)
  if (present.length < MIN_TREND_POINTS) return null

  const fit = linearFit(raw)
  if (!fit) return null

  // Fitted value at every x, including where the source had a gap: the line is
  // a model over the whole axis, not only where a reading happened to exist.
  const fitted = raw.map((_, i) => fit.predict(i))

  // R squared against the points that actually exist.
  const mean = present.reduce((a, b) => a + b, 0) / present.length
  let ssRes = 0
  let ssTot = 0
  raw.forEach((v, i) => {
    if (v == null) return
    ssRes += (v - fit.predict(i)) ** 2
    ssTot += (v - mean) ** 2
  })
  // ssTot of 0 means every point is the same value; there is no variation to
  // explain, so R squared is undefined rather than a perfect 1.
  const r2 = ssTot === 0 ? null : Math.max(0, Math.min(1, 1 - ssRes / ssTot))

  // Judge direction against the data's own SCALE, never against zero. Scale is
  // the larger of the spread and the typical level, because both can mislead
  // alone: measured against spread only, a 2.4 rise on values of 5,000,000
  // counts as a climb; measured against level only, a real swing in small
  // numbers disappears. A move under 1% of scale is not something to report.
  const span = Math.max(...present) - Math.min(...present)
  const scale = Math.max(span, Math.abs(mean))
  const move = fit.slope * (raw.length - 1)
  const direction = scale === 0 || Math.abs(move) < scale * 0.01
    ? 'flat'
    : (fit.slope > 0 ? 'up' : 'down')

  return {
    fitted,
    slope: fit.slope,
    intercept: fit.intercept,
    r2,
    direction,
    weak: r2 != null && r2 < WEAK_FIT_R2,
    points: present.length,
  }
}

/**
 * Total change the fitted line implies across the whole window - the honest
 * headline number, because a per-step slope means little to a reader.
 */
export function trendChange(trend, length) {
  if (!trend || !length || length < 2) return null
  return trend.slope * (length - 1)
}

/**
 * One plain sentence describing the trend, or null when there is none.
 * Says outright when the fit is poor rather than letting a drawn line imply
 * more certainty than the points support.
 *
 * @param {ReturnType<typeof trendLine>} trend
 * @param {number} length number of points on the axis
 * @param {(v:number)=>string} fmt value formatter
 */
export function trendSummary(trend, length, fmt) {
  if (!trend) return null
  const f = typeof fmt === 'function' ? fmt : (v) => String(Math.round(v))
  if (trend.direction === 'flat') {
    return `Trend line: broadly flat across these ${length} points.`
  }
  const total = trendChange(trend, length)
  const word = trend.direction === 'up' ? 'rising' : 'falling'
  const base = `Trend line: ${word} by about ${f(Math.abs(total))} across these ${length} points.`
  if (trend.weak) {
    return `${base} The points are scattered, so treat the direction as a hint rather than a measurement.`
  }
  return base
}

/**
 * A chart.js dataset for the trend line, or null when there is nothing to draw.
 * Dashed and point-less on purpose: it must read as a model laid over the data,
 * never as another measured series.
 */
export function trendDataset(trend, { color = '#94a3b8', label = 'Trend' } = {}) {
  if (!trend) return null
  return {
    type: 'line',
    label,
    data: trend.fitted,
    borderColor: color,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 0,
    pointHitRadius: 6,
    fill: false,
    tension: 0,
    order: -1,        // draw above the bars
    _isTrend: true,   // so value labels can skip it
    // Its OWN stack group. `stacked: true` is set on the scale, so without this
    // the trend would be stacked on top of the bar total and float above the
    // chart instead of sitting at its fitted values. A lone dataset in its own
    // group stacks against nothing, which is the raw value. Harmless when the
    // chart is not stacked - the group id is simply unused.
    stack: '_trend',
  }
}
