/**
 * cpkDrivers.js - pure engine for the "WHY did my CPK go up?" driver breakdown.
 *
 * It answers the one question management actually asks about cost per km / hour:
 * not "what is it" but "what MOVED it". Given a prior window and a current window,
 * fleet tyre CPK is C / D (tyre cost over the distance or engine-hours it ran), per
 * country and per unit (km for road assets, engine-hours for plant - a blended
 * /km + /hour figure is meaningless, so the two never mix). Between the windows:
 *
 *   deltaCPK = C1/D1 - C0/D0
 *
 * split into two effects that ADD BACK UP TO IT EXACTLY:
 *
 *   COST effect        = (C1 - C0) / D1        (spend went up or down)
 *   UTILIZATION effect = C0 * (1/D1 - 1/D0)    (running fewer km/hours raises CPK
 *                                               even at flat cost, and vice versa)
 *
 * Proof of closure: (C1-C0)/D1 + C0/D1 - C0/D0 = C1/D1 - C0/D0. A test pins it.
 *
 * The COST effect is then broken down by cause - price, brand/size mix, volume,
 * new equipment, retired equipment - each a money amount the server computed so
 * they sum to (C1 - C0) by construction (Bennet price/volume on continuing groups
 * + entry/exit for groups and assets; see get_cpk_drivers, V447). This engine
 * divides each by D1 to express it as a slice of the COST effect, and if the parts
 * do not perfectly hit (C1 - C0) it carries the gap as an explicit "other" row
 * rather than silently balancing one of the real causes. A decomposition with a
 * hidden remainder reads as complete when it is not.
 *
 * HONESTY RULES baked in:
 *  - A CPK is null when its denominator is 0 (never a fabricated 0). If either
 *    window has no measured distance, delta / effects that need it stay null.
 *  - `comparable` is false when the prior window measured too few assets to trust
 *    (the documented coverage trap: KSA km data is almost all recent, so a
 *    365-vs-prior-365 comparison rests on a handful of prior assets). The panel
 *    then WITHHOLDS the strong claim and says why, instead of overstating an
 *    apparent swing that is really a coverage artifact.
 *  - Every figure carries its own currency; nothing is blended across countries.
 *
 * Pure and deterministic: no I/O, no clock (windows arrive on the payload).
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const fin = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))

/** Below this money amount a leftover is rounding dust, not an unexplained gap. */
export const ROUNDING_TOLERANCE = 0.5

/** The prior window must measure at least this many assets to be trustworthy... */
export const COVERAGE_MIN_ABS = 3
/** ...and at least this fraction of what the current window measures. */
export const COVERAGE_MIN_RATIO = 0.25

/**
 * The cost-effect causes, in the fixed order they are always presented, plus the
 * utilization effect (which is not a cost cause but the other half of the delta).
 * `up` raises CPK (bad); `down` lowers it (good).
 */
export const CAUSE_META = Object.freeze([
  { key: 'price', label: 'Tyre price',
    up: 'the same tyres cost more each', down: 'the same tyres cost less each' },
  { key: 'mix', label: 'Brand / size mix',
    up: 'a shift toward pricier brands or sizes', down: 'a shift toward cheaper brands or sizes' },
  { key: 'volume', label: 'Tyres consumed',
    up: 'more tyres fitted', down: 'fewer tyres fitted' },
  { key: 'new_equipment', label: 'New equipment',
    up: 'assets that newly bear tyre cost', down: 'assets that newly bear tyre cost' },
  { key: 'stopped_equipment', label: 'Retired equipment',
    up: 'assets no longer bearing tyre cost', down: 'assets no longer bearing tyre cost' },
  { key: 'other', label: 'Other',
    up: 'change the cause split does not account for', down: 'change the cause split does not account for' },
])

const CAUSE_ORDER = CAUSE_META.map((m) => m.key)
const CAUSE_LABEL = Object.fromEntries(CAUSE_META.map((m) => [m.key, m.label]))

/** Short unit noun for a segment ('km' | 'engine_hours'). */
export function unitNoun(unit) {
  return unit === 'engine_hours' ? 'hour' : 'km'
}

/* ------------------------------------------------------------------ format */

const NF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** A CPK figure to 4 dp with its currency + unit suffix, or "N/A". */
export function fmtCpk(value, currency, unit) {
  const v = fin(value)
  if (v == null) return 'N/A'
  const cur = currency ? `${currency} ` : ''
  return `${cur}${v.toFixed(4)}/${unitNoun(unit)}`
}

/** A signed CPK delta ("+0.0152" / "-0.0030"), or "N/A". No dash characters used for minus beyond the ASCII sign. */
export function fmtCpkDelta(value) {
  const v = fin(value)
  if (v == null) return 'N/A'
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  return `${sign}${Math.abs(v).toFixed(4)}`
}

/** A money amount, grouped, with its currency, or "N/A". */
export function fmtMoney(value, currency) {
  const v = fin(value)
  if (v == null) return 'N/A'
  const sign = v < 0 ? '-' : ''
  return `${sign}${currency ? currency + ' ' : ''}${NF.format(Math.abs(Math.round(v)))}`
}

/* --------------------------------------------------------------- decompose */

/**
 * Pure: decompose one (country, unit) segment into the exact-closing driver split.
 *
 * @param {object} seg one element of get_cpk_drivers().segments
 * @returns {object} a rendered-ready driver object (see the fields below)
 */
export function decomposeSegment(seg = {}) {
  const c0 = num(seg.c0)
  const d0 = num(seg.d0)
  const c1 = num(seg.c1)
  const d1 = num(seg.d1)
  const currency = seg.currency || seg.country || null
  const unit = seg.unit === 'engine_hours' ? 'engine_hours' : 'km'
  const matchedPrev = num(seg.matched_prev)
  const matchedNow = num(seg.matched_now)

  const cpkPrev = d0 > 0 ? c0 / d0 : null
  const cpkNow = d1 > 0 ? c1 / d1 : null
  const delta = cpkPrev != null && cpkNow != null ? cpkNow - cpkPrev : null

  // The two exactly-closing halves of the delta.
  const costEffect = d1 > 0 ? (c1 - c0) / d1 : null
  const utilizationEffect = d1 > 0 && d0 > 0 ? c0 * (1 / d1 - 1 / d0) : null

  // Cause money amounts (server) -> cost-effect slices (money / D1). Any gap
  // between the parts and the true (C1 - C0) is carried as an explicit residual.
  const cm = seg.causes || {}
  const known = ['price', 'volume', 'mix', 'new_equipment', 'stopped_equipment']
  const moneyByKey = {}
  let sumMoney = 0
  for (const k of known) {
    moneyByKey[k] = num(cm[k])
    sumMoney += moneyByKey[k]
  }
  const deltaCost = c1 - c0
  const residual = deltaCost - sumMoney
  if (Math.abs(residual) > 0.0000001) moneyByKey.other = residual

  const causes = CAUSE_ORDER
    .filter((k) => k in moneyByKey)
    .map((k) => {
      const money = moneyByKey[k]
      const cpk = d1 > 0 ? money / d1 : null
      const meta = CAUSE_META.find((m) => m.key === k)
      return {
        key: k,
        label: CAUSE_LABEL[k] || k,
        money,
        cpk,
        direction: money > 0 ? 'up' : money < 0 ? 'down' : 'flat',
        meaning: money >= 0 ? meta?.up || '' : meta?.down || '',
        isResidual: k === 'other',
      }
    })
    .filter((row) => Math.abs(row.money) > 0.0000001)

  // Closure check on the rendered cost-effect slices (guaranteed by the residual).
  const causeCpkSum = causes.reduce((s, r) => s + num(r.cpk), 0)
  const closes = costEffect == null
    ? causes.length === 0
    : Math.abs(causeCpkSum - costEffect) < 1e-6

  // The prior window is only trustworthy if it measured enough assets.
  const comparable =
    cpkPrev != null &&
    cpkNow != null &&
    matchedPrev >= COVERAGE_MIN_ABS &&
    matchedPrev >= COVERAGE_MIN_RATIO * Math.max(1, matchedNow)

  return {
    country: seg.country ?? null,
    unit,
    currency,
    c0, d0, c1, d1,
    matchedPrev,
    matchedNow,
    cpkPrev,
    cpkNow,
    delta,
    direction: delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    costEffect,
    utilizationEffect,
    causes,
    residual: Math.abs(residual) > ROUNDING_TOLERANCE ? residual : 0,
    comparable,
    closes,
    // one flag the panel can trust without re-deriving: the split adds up AND the
    // prior window is thick enough to believe the delta.
    trustworthy: closes && comparable,
  }
}

/**
 * Pure: decompose a whole get_cpk_drivers payload.
 * @param {object} payload the RPC result { ok, windows, segments }
 * @returns {{ ok:boolean, reason?:string, windows:object|null, segments:Array }}
 */
export function decomposeDrivers(payload) {
  if (!payload || payload.ok === false) {
    return { ok: false, reason: payload?.reason || null, windows: null, segments: [] }
  }
  const segs = Array.isArray(payload.segments) ? payload.segments : []
  return {
    ok: true,
    windows: payload.windows || null,
    segments: segs.map(decomposeSegment),
  }
}

/* ---------------------------------------------------------------- waterfall */

// The order the steps of the waterfall are drawn: cost causes first, utilization
// last (it is the answer to "did it run more or less", read after "did it cost more").
const STEP_ORDER = [...CAUSE_ORDER, 'utilization']

/**
 * Pure: the ordered steps from prior CPK to current CPK, each a signed CPK amount.
 * Running from/to levels are filled when both CPK endpoints exist; otherwise the
 * amounts still stand on their own (a valid delta of cost pieces).
 *
 * @param {object} dec a decomposeSegment() result
 * @returns {{ start:number|null, end:number|null, steps:Array }}
 */
export function waterfallSteps(dec) {
  if (!dec) return { start: null, end: null, steps: [] }
  const raw = dec.causes.map((c) => ({
    key: c.key,
    label: c.label,
    amount: fin(c.cpk),
    money: c.money,
    direction: c.direction,
    isResidual: c.isResidual,
  }))
  if (dec.utilizationEffect != null && Math.abs(dec.utilizationEffect) > 0) {
    raw.push({
      key: 'utilization',
      label: 'Utilization',
      amount: dec.utilizationEffect,
      money: null,
      direction: dec.utilizationEffect > 0 ? 'up' : 'down',
      isResidual: false,
    })
  }
  const steps = raw
    .filter((s) => s.amount != null && Math.abs(s.amount) > 0)
    .sort((a, b) => STEP_ORDER.indexOf(a.key) - STEP_ORDER.indexOf(b.key))

  let running = dec.cpkPrev
  const withLevels = steps.map((s) => {
    const from = running
    const to = running == null || s.amount == null ? null : running + s.amount
    running = to
    return { ...s, from, to }
  })
  return { start: dec.cpkPrev, end: dec.cpkNow, steps: withLevels }
}

/**
 * Pure: the biggest movers, largest absolute CPK impact first.
 * @param {object} dec decomposeSegment() result
 * @param {number} [n]
 */
export function topDrivers(dec, n = 3) {
  const { steps } = waterfallSteps(dec)
  return [...steps].sort((a, b) => Math.abs(num(b.amount)) - Math.abs(num(a.amount))).slice(0, Math.max(1, n))
}

/* --------------------------------------------------------------- narrative */

/**
 * Pure: the segment in one honest management sentence. Never claims a cause the
 * data cannot support, and leads with the coverage caveat when the prior window
 * is too thin to trust.
 * @param {object} dec decomposeSegment() result
 * @returns {string}
 */
export function managementSentence(dec) {
  if (!dec) return 'There is nothing to explain yet.'
  const unit = unitNoun(dec.unit)
  const cur = dec.currency || ''
  const where = dec.country ? `${dec.country} ${unit}` : unit

  if (dec.cpkPrev == null || dec.cpkNow == null) {
    return `No cost per ${unit} could be measured in one of the two periods for ${where}, so there is no change to explain.`
  }

  if (!dec.comparable) {
    return (
      `The ${where} comparison is coverage limited: only ${NF.format(dec.matchedPrev)} ` +
      `${dec.matchedPrev === 1 ? 'asset' : 'assets'} had measured ${unit} in the prior period ` +
      `against ${NF.format(dec.matchedNow)} now, so the apparent move from ` +
      `${fmtCpk(dec.cpkPrev, cur, dec.unit)} to ${fmtCpk(dec.cpkNow, cur, dec.unit)} is not reliable ` +
      `and is largely a data coverage effect, not a real cost change.`
    )
  }

  const verb = dec.delta > 0 ? 'rose' : dec.delta < 0 ? 'fell' : 'held'
  const top = topDrivers(dec, 3)
  const parts = top.map((s) => {
    const sign = s.amount > 0 ? '+' : '-'
    return `${sign}${Math.abs(s.amount).toFixed(4)} from ${s.label.toLowerCase()}`
  })
  const head = dec.delta === 0
    ? `Tyre cost per ${unit} for ${where} held at ${fmtCpk(dec.cpkNow, cur, dec.unit)}`
    : `Tyre cost per ${unit} for ${where} ${verb} ${Math.abs(dec.delta).toFixed(4)} ${cur ? cur + '/' : 'per '}${cur ? unit : unit} ` +
      `(${fmtCpk(dec.cpkPrev, cur, dec.unit)} to ${fmtCpk(dec.cpkNow, cur, dec.unit)})`
  return parts.length ? `${head}: ${parts.join(', ')}.` : `${head}.`
}

/* ------------------------------------------------------- best-value brand */

/**
 * Pure: pick the single best-value brand across brand/size groups (lowest real
 * CPK, backed by the most tyres), for the management summary. Returns null when
 * nothing is measurable. Feed it the output of brandSizeCpk.groupBySize().
 *
 * @param {Array<object>} groups groupBySize() output
 * @returns {{ brand:string, size:string, cpk:number, currency:string, tyres:number }|null}
 */
export function bestValueBrandFromGroups(groups) {
  const cands = []
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g || g.thin) continue // need >= 2 measurable brands to call a winner
    const best = (g.brands || []).find((b) => b.isBestValue && b.cpk != null)
    if (best) cands.push({ brand: best.brand, size: g.size, cpk: best.cpk, currency: g.currency || '', tyres: best.tyres || 0 })
  }
  if (!cands.length) return null
  // Lowest CPK first; break ties on the deepest evidence (most tyres).
  cands.sort((a, b) => (a.cpk !== b.cpk ? a.cpk - b.cpk : b.tyres - a.tyres))
  return cands[0]
}

/* --------------------------------------------------------------- export */

/**
 * Pure: flat rows for the management-summary PDF/Excel export.
 * @param {object} dec decomposeSegment() result
 * @returns {Array<object>}
 */
export function segmentExportRows(dec) {
  if (!dec) return []
  const cur = dec.currency || ''
  const rows = [
    { item: `Prior cost per ${unitNoun(dec.unit)}`, cpk: dec.cpkPrev == null ? 'N/A' : dec.cpkPrev.toFixed(4), money: '' },
    { item: `Current cost per ${unitNoun(dec.unit)}`, cpk: dec.cpkNow == null ? 'N/A' : dec.cpkNow.toFixed(4), money: '' },
    { item: 'Change', cpk: dec.delta == null ? 'N/A' : fmtCpkDelta(dec.delta), money: '' },
    { item: 'Cost effect', cpk: dec.costEffect == null ? 'N/A' : fmtCpkDelta(dec.costEffect), money: '' },
    { item: 'Utilization effect', cpk: dec.utilizationEffect == null ? 'N/A' : fmtCpkDelta(dec.utilizationEffect), money: '' },
  ]
  for (const c of dec.causes) {
    rows.push({
      item: `  ${c.label}`,
      cpk: c.cpk == null ? 'N/A' : fmtCpkDelta(c.cpk),
      money: fmtMoney(c.money, cur),
    })
  }
  return rows.map((r) => ({ ...r, currency: cur }))
}
