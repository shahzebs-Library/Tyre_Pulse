/**
 * costVariance.js - the "why did this cost change" engine.
 *
 * Pure and injectable. Everything here takes a payload and returns a shape; no
 * I/O, no clock, no randomness. The same input always produces the same words.
 *
 * WHAT THIS IS FOR. A manager asks "why did Riyadh maintenance cost go up".
 * Today that question is answered by somebody exporting a pivot table. This
 * turns it into arithmetic: one number, the change in spend, taken apart into
 * signed contributions that ADD BACK UP TO IT. Nothing is allowed to go
 * missing. If a part of the change cannot be attributed, it is named and
 * quantified rather than dropped, because a decomposition with a silent
 * remainder is worse than none - it reads as complete when it is not.
 *
 * THE THREE RULES THIS FILE ENFORCES
 *
 *   1. THE PARTS MUST SUM TO THE WHOLE. Every list this returns closes against
 *      the total change. Dimension lists are truncated for display, so the
 *      remainder is carried as an explicit "everything else" row; the price and
 *      volume split carries a named residual when the inputs do not close.
 *      `closes` says whether it did, and the panel shows it.
 *
 *   2. THE DATA SHOWS WHAT CHANGED, NOT WHY ANYONE CHOSE IT. This engine can
 *      say "item 310683-O stopped, 266,668 AED, and 310681-O grew by 137,091".
 *      It must never say "they switched supplier" or "procurement negotiated a
 *      better rate" - those are motives, and no column in this database records
 *      a motive. Every sentence `narrate` produces is a restatement of a figure
 *      that is on screen next to it.
 *
 *   3. NEVER ADD CURRENCIES. Same rule as costCpk.js, for the same reason: SAR,
 *      AED and EGP have been summed at four separate reader sites in this
 *      system's history. A blended payload is refused here, not at the call
 *      site, so no caller can render one by mistake.
 *
 * PRICE VERSUS VOLUME IS THE POINT. 216,790 of 216,792 expense rows carry both
 * a quantity and a unit cost, so "we bought more" and "it cost more each" are
 * separable, and they lead to completely different actions - one is an
 * operations problem, the other is a procurement problem. The split is computed
 * server-side per item code (V378) using the Bennet method, which is exactly
 * additive; see that migration for why the textbook method was rejected.
 */
import { change, movers } from './costCpk'

/** Money rounded to two places, the grain every figure here is stated at. */
const R2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const fin = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
const num = (v) => fin(v) ?? 0
const abs = Math.abs

/** Below this, a leftover is arithmetic dust rather than something unexplained. */
export const ROUNDING_TOLERANCE = 1

/**
 * The five atomic terms, in the order they are always presented.
 *
 * `price` and `volume` only exist for an item bought in both periods, because a
 * price change needs two prices. An item that appears in only one period is its
 * own term - folding it into "volume" would be arithmetically convenient and
 * would invent a unit price that was never paid.
 */
export const EFFECTS = Object.freeze([
  { key: 'volume', label: 'Quantity bought',
    up: 'more was bought of the same items', down: 'less was bought of the same items' },
  { key: 'price', label: 'Unit prices',
    up: 'the same items cost more each', down: 'the same items cost less each' },
  { key: 'newItems', label: 'Lines that started',
    up: 'items with no spend in the earlier period', down: '' },
  { key: 'stoppedItems', label: 'Lines that stopped',
    up: '', down: 'items with no spend in this period' },
  { key: 'notDecomposable', label: 'No quantity recorded',
    up: 'lines carrying no usable quantity or unit cost',
    down: 'lines carrying no usable quantity or unit cost' },
])

/**
 * The same five folded into the three groups a manager actually asks about.
 * Both groupings close against the same total; this one just answers
 * "price, volume or mix" directly.
 */
export const GROUPS = Object.freeze([
  { key: 'volume', label: 'Volume', parts: ['volume'] },
  { key: 'price', label: 'Price', parts: ['price'] },
  { key: 'mix', label: 'Mix of items', parts: ['newItems', 'stoppedItems'] },
  { key: 'notDecomposable', label: 'Not decomposable', parts: ['notDecomposable'] },
])

/* ------------------------------------------------------------------ format */

const NF0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const NF2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** Money as a plain grouped integer plus its currency code, or "N/A". */
export function fmtMoney(n, currency) {
  const v = fin(n)
  if (v == null) return 'N/A'
  const body = abs(v) >= 100 ? NF0.format(v) : NF2.format(v)
  return currency ? `${body} ${currency}` : body
}

/** A share as a whole percent. Null stays "N/A" - it is not zero percent. */
export function fmtPct(n, digits = 0) {
  const v = fin(n)
  if (v == null) return 'N/A'
  return `${(v * 100).toFixed(digits)}%`
}

/** A quantity: integers stay integers, fractions keep two places. */
export function fmtQty(n) {
  const v = fin(n)
  if (v == null) return 'N/A'
  return Number.isInteger(v) ? NF0.format(v) : NF2.format(v)
}

/* ----------------------------------------------------------------- effects */

/**
 * Pure: the price / volume / mix split, guaranteed to close.
 *
 * The server computes the five terms; this checks them against the total and,
 * if they do not meet it, adds a final named term for the difference rather
 * than adjusting one of the real ones. A decomposition that has been quietly
 * balanced is a decomposition you cannot trust.
 *
 * @param {object} snap get_cost_variance payload
 * @returns {{terms:Array, groups:Array, total:number, closes:boolean, residual:number}}
 */
export function effectSplit(snap) {
  const e = snap?.effects || {}
  const total = R2(num(snap?.totals?.delta))
  const raw = {
    volume: R2(num(e.volume)),
    price: R2(num(e.price)),
    newItems: R2(num(e.new_items)),
    stoppedItems: R2(num(e.stopped_items)),
    notDecomposable: R2(num(e.not_decomposable)),
  }
  const summed = R2(Object.values(raw).reduce((s, v) => s + v, 0))
  const residual = R2(total - summed)

  const gross = Object.values(raw).reduce((s, v) => s + abs(v), 0) + abs(residual);
  const share = (v) => (gross > 0 ? v / gross : null)

  const terms = EFFECTS.map((m) => ({
    key: m.key,
    label: m.label,
    amount: raw[m.key],
    share: share(raw[m.key]),
    meaning: raw[m.key] >= 0 ? m.up : m.down,
  }))

  if (abs(residual) > 0) {
    // Named honestly by size. Dust is dust; anything bigger is a real gap and
    // must not be dressed up as rounding.
    const isDust = abs(residual) <= ROUNDING_TOLERANCE
    terms.push({
      key: isDust ? 'rounding' : 'unexplained',
      label: isDust ? 'Rounding' : 'Not attributed',
      amount: residual,
      share: share(residual),
      meaning: isDust
        ? 'difference from rounding each figure to two places'
        : 'change that the item level detail does not account for',
    })
  }

  const groups = GROUPS.map((g) => {
    const amount = R2(g.parts.reduce((s, k) => s + raw[k], 0))
    return { key: g.key, label: g.label, amount, share: share(amount), parts: g.parts }
  }).filter((g) => g.key !== 'notDecomposable' || g.amount !== 0)

  return {
    terms,
    groups,
    total,
    residual,
    closes: abs(residual) <= ROUNDING_TOLERANCE,
    itemsBoth: num(e.items_both),
    itemsNew: num(e.items_new),
    itemsStopped: num(e.items_stopped),
    currency: snap?.currency || null,
  }
}

/* ---------------------------------------------------------- contributions */

/**
 * Pure: signed contribution per member of one dimension, biggest swing first,
 * with an explicit remainder row so the column adds up to the total change.
 *
 * Accepts either shape:
 *   - the V378 `dims.by_*` object `{rows, tail, unchanged}`, already ranked by
 *     the size of the swing
 *   - a V374 `by_*` array of `{label, spend, prev_spend, lines}`, which is
 *     ranked by current spend; `movers` from costCpk re-ranks it
 *
 * Taking both means the panel still works against the older payload alone, and
 * the ranking rule is identical either way.
 *
 * @param {object|Array} dim
 * @param {object} [opts]
 * @param {number} [opts.total] the true total change, used to size the remainder
 * @param {number} [opts.limit]
 */
export function contributions(dim, opts = {}) {
  const { total = null, limit = 12 } = opts
  let rows = []
  let tail = null

  if (Array.isArray(dim)) {
    // V374 shape. movers() already ranks by size of swing and keeps stopped lines.
    rows = movers({ d: dim }, 'd', Math.max(1, limit)).map((m) => ({
      label: m.label,
      current: m.current,
      previous: m.previous,
      delta: R2(m.delta),
      lines: m.lines,
      direction: m.direction,
    }))
  } else {
    const src = Array.isArray(dim?.rows) ? dim.rows : []
    rows = src.slice(0, Math.max(1, limit)).map((r) => ({
      label: r.label ?? 'Unspecified',
      current: num(r.current),
      previous: num(r.previous),
      delta: R2(num(r.delta)),
      lines: num(r.lines),
      direction: change(r.previous, r.current).direction,
    }))
    const t = dim?.tail
    if (t && num(t.count) > 0) {
      tail = {
        label: `${num(t.count)} further ${num(t.count) === 1 ? 'line' : 'lines'}`,
        count: num(t.count),
        current: num(t.current),
        previous: num(t.previous),
        delta: R2(num(t.delta)),
      }
    }
  }

  const shown = R2(rows.reduce((s, r) => s + r.delta, 0));
  const tailDelta = tail ? tail.delta : 0
  const knownTotal = total == null ? R2(shown + tailDelta) : R2(total)
  const missing = R2(knownTotal - shown - tailDelta)

  // Whatever the shown rows and the server's tail do not cover. With a V374
  // array there is no tail at all, so this row is the entire unshown balance -
  // it is the difference between a top-N list and an explanation.
  const remainder = abs(missing) > 0.005
    ? { label: 'Everything else', delta: missing, current: null, previous: null, isRemainder: true }
    : null

  const gross = rows.reduce((s, r) => s + abs(r.delta), 0)
    + abs(tailDelta) + abs(remainder?.delta || 0)

  const withShare = (r) => ({ ...r, share: gross > 0 ? r.delta / gross : null })

  return {
    rows: rows.map(withShare),
    tail: tail ? withShare(tail) : null,
    remainder: remainder ? withShare(remainder) : null,
    total: knownTotal,
    gross,
    // gross netting: members inside the tail can cancel each other, so the real
    // gross movement is at least this much and possibly more
    grossIsLowerBound: Boolean(tail && tail.count > 1),
    closes: true, // by construction, the remainder row absorbs any difference
    unchanged: num(dim?.unchanged) || 0,
  }
}

/* --------------------------------------------------------- concentration */

/**
 * Pure: is this change one thing or a broad drift?
 *
 * The distinction changes what a manager does. One asset that doubled is a
 * maintenance investigation. Three hundred assets each drifting up is a rate or
 * a policy question. Measured against GROSS movement, not net, because a site
 * that rose 300k while another fell 300k has moved a lot and netted nothing.
 *
 * @param {object} contrib the output of contributions()
 */
export function concentration(contrib) {
  const rows = (contrib?.rows || []).filter((r) => !r.isRemainder)
  const gross = contrib?.gross || 0
  if (!rows.length || gross <= 0) {
    return { top1: null, top1Share: null, top3Share: null, countTo80: null,
      breadth: 'unknown', diffuse: null }
  }
  const sorted = [...rows].sort((a, b) => abs(b.delta) - abs(a.delta))
  const top1Share = abs(sorted[0].delta) / gross
  const top3Share = sorted.slice(0, 3).reduce((s, r) => s + abs(r.delta), 0) / gross

  let run = 0
  let countTo80 = null
  for (let i = 0; i < sorted.length; i += 1) {
    run += abs(sorted[i].delta)
    if (run / gross >= 0.8) { countTo80 = i + 1; break }
  }

  // How much of the movement sits outside the named rows. When that dominates,
  // no individual member is the story and saying otherwise would be wrong.
  const outside = (abs(contrib?.tail?.delta || 0) + abs(contrib?.remainder?.delta || 0)) / gross

  let breadth = 'mixed'
  if (outside >= 0.5) breadth = 'broad'
  else if (top1Share >= 0.5 || (countTo80 != null && countTo80 <= 3)) breadth = 'concentrated'
  else if (countTo80 == null || countTo80 > 10) breadth = 'broad'

  return {
    top1: sorted[0],
    top1Share,
    top3Share,
    countTo80,
    outsideShare: outside,
    breadth,
    diffuse: breadth === 'broad',
  }
}

/* ---------------------------------------------------------------- items */

/**
 * Pure: the item lines that moved, each labelled with what drove it.
 *
 * `driver` is decided by which effect dominates the item's own movement. An
 * item where price and volume both moved materially is 'mixed' rather than
 * being forced into one - that is a real answer, not a failure to decide.
 */
export function itemMovers(snap, opts = {}) {
  const { limit = 10 } = opts
  const rows = Array.isArray(snap?.items) ? snap.items : []
  return rows.slice(0, Math.max(1, limit)).map((r) => {
    const price = R2(num(r.price_effect))
    const volume = R2(num(r.volume_effect))
    const mag = abs(price) + abs(volume)
    let driver = r.kind === 'new' || r.kind === 'stopped' ? r.kind : 'mixed'
    if (r.kind === 'both') {
      if (mag === 0) driver = 'flat'
      else if (abs(price) / mag >= 0.7) driver = 'price'
      else if (abs(volume) / mag >= 0.7) driver = 'volume'
    } else if (r.kind === 'unpriced') driver = 'unpriced'
    return {
      code: r.code,
      label: r.label || r.code,
      bucket: r.bucket || null,
      kind: r.kind,
      driver,
      qtyPrevious: fin(r.qty_previous),
      qtyCurrent: fin(r.qty_current),
      pricePrevious: fin(r.price_previous),
      priceCurrent: fin(r.price_current),
      spendPrevious: num(r.spend_previous),
      spendCurrent: num(r.spend_current),
      priceEffect: price,
      volumeEffect: volume,
      linesCurrent: num(r.lines_current),
      linesPrevious: num(r.lines_previous),
      delta: R2(num(r.delta)),
    }
  })
}

/**
 * Pure: how much of the movement is items entering and leaving the basket.
 *
 * Reported gross as well as net on purpose. In the real UAE first half of 2026,
 * 962,123 AED of lines started and 1,896,873 stopped; the net is -934,750 but
 * the churn is 2,858,996. A large gross against a small net usually means the
 * same physical part came back under a different item code, which is a data
 * question, not a spend question. This engine states both figures and does not
 * decide which it was.
 */
export function assortmentChurn(snap) {
  const e = snap?.effects || {}
  const started = R2(num(e.new_items))
  const stopped = R2(num(e.stopped_items))
  const net = R2(started + stopped)
  const gross = R2(abs(started) + abs(stopped))
  const total = R2(num(snap?.totals?.delta))
  return {
    started,
    stopped,
    net,
    gross,
    countStarted: num(e.items_new),
    countStopped: num(e.items_stopped),
    countBoth: num(e.items_both),
    // the two sides largely cancel: churn in the code list, not in the spend
    offsetting: gross > 0 && abs(net) / gross < 0.35,
    shareOfChange: total !== 0 ? net / total : null,
  }
}

/* ---------------------------------------------------------- orchestrator */

const DIM_LABEL = Object.freeze({
  by_site: { one: 'site', many: 'sites' },
  by_asset: { one: 'asset', many: 'assets' },
  by_item: { one: 'item', many: 'items' },
  by_cost_center: { one: 'cost centre', many: 'cost centres' },
  by_asset_type: { one: 'asset type', many: 'asset types' },
})

/**
 * Pure: the whole decomposition, ready to render or narrate.
 *
 * @param {object} snap get_cost_variance payload (V378)
 * @param {object} [opts]
 * @param {object} [opts.fallbackDims] a get_cost_cpk_overview payload, used for
 *   any dimension V378 did not return, so the panel degrades instead of blanking
 * @param {number} [opts.limit]
 */
export function decomposeVariance(snap, opts = {}) {
  const { fallbackDims = null, limit = 12 } = opts

  if (!snap || snap.ok === false) {
    // no reason invented when the server did not give one: an absent payload is
    // not a finding, and narrate must have nothing to say about it
    return { ok: false, reason: snap?.reason || null, blended: false }
  }
  if (snap.blended) {
    // One number made of three currencies is not a number. Refused here so no
    // caller can render it.
    return {
      ok: false,
      blended: true,
      reason: snap.reason
        || 'Spend spans more than one currency. Choose a country to decompose the change.',
      windows: snap.windows || null,
    }
  }

  const currency = snap.currency || null
  const totals = snap.totals || {}
  const current = R2(num(totals.current))
  const previous = R2(num(totals.previous))
  const headline = change(previous, current)

  const byDim = {}
  for (const key of Object.keys(DIM_LABEL)) {
    const fromV378 = snap?.dims?.[key]
    const src = fromV378 && Array.isArray(fromV378.rows) ? fromV378 : fallbackDims?.[key]
    if (!src) continue
    byDim[key] = {
      ...contributions(src, { total: R2(num(totals.delta)), limit }),
      key,
      label: DIM_LABEL[key],
      // a V374 array has no server-side tail, so its remainder row is the only
      // thing standing between a top-25 list and a wrong total
      fromFallback: !(fromV378 && Array.isArray(fromV378.rows)),
    }
  }

  const effects = effectSplit(snap)
  const items = itemMovers(snap, { limit })
  const churn = assortmentChurn(snap)
  const itemsTail = snap.items_tail && num(snap.items_tail.count) > 0
    ? { count: num(snap.items_tail.count), delta: R2(num(snap.items_tail.delta)) }
    : null

  return {
    ok: true,
    blended: false,
    currency,
    country: snap.country || null,
    site: snap.site || null,
    windows: snap.windows || null,
    totals: {
      current,
      previous,
      delta: R2(num(totals.delta)),
      pct: headline.pct,
      direction: headline.direction,
      linesCurrent: num(totals.lines_current),
      linesPrevious: num(totals.lines_previous),
    },
    effects,
    items,
    itemsTail,
    churn,
    byDim,
    concentration: {
      site: byDim.by_site ? concentration(byDim.by_site) : null,
      asset: byDim.by_asset ? concentration(byDim.by_asset) : null,
    },
    // one flag the panel can show without reading five sub-objects
    trustworthy: effects.closes,
  }
}

/* -------------------------------------------------------------- narrative */

const scopeName = (d) => {
  if (d.site && d.country) return `at ${d.site} in ${d.country}`
  if (d.site) return `at ${d.site}`
  if (d.country) return `in ${d.country}`
  return 'across the fleet'
}

const dayCount = (d) => num(d?.windows?.days)

/**
 * Pure: the decomposition in plain language.
 *
 * Rules this obeys, and they are the reason it is worth reading:
 *   - every sentence carries the figure it rests on
 *   - it describes what changed, never why someone chose it
 *   - when nothing dominates it says so, instead of naming the largest of a set
 *     of small things and implying it is the cause
 *   - an unattributed amount is stated, not omitted
 *
 * @returns {{headline:string, lines:string[], text:string}}
 */
export function narrate(dec, opts = {}) {
  const { maxLines = 7 } = opts

  if (!dec || dec.ok === false) {
    return {
      headline: dec?.blended
        ? 'Cannot decompose a total that spans more than one currency.'
        : 'There is nothing to explain yet.',
      lines: dec?.reason ? [dec.reason] : [],
      text: dec?.blended
        ? 'Cannot decompose a total that spans more than one currency. '
          + (dec.reason || '')
        : 'There is nothing to explain yet.',
    }
  }

  const cur = dec.currency
  const M = (n) => fmtMoney(n, cur)
  const t = dec.totals
  const where = scopeName(dec)
  const lines = []

  if (t.current === 0 && t.previous === 0) {
    const only = `No spend was recorded ${where} in either period, so there is nothing to explain.`
    return { headline: only, lines: [], text: only }
  }

  // 1. the headline number, always with both levels behind it
  let headline
  if (t.delta === 0) {
    headline = `Spend ${where} was unchanged at ${M(t.current)}.`
  } else {
    const dir = t.delta > 0 ? 'rose' : 'fell'
    const pct = t.pct == null ? null : fmtPct(abs(t.pct))
    headline = `Spend ${where} ${dir} ${M(abs(t.delta))}`
      + (pct ? ` (${pct})` : '')
      + `, from ${M(t.previous)} to ${M(t.current)}.`
  }

  const w = dec.windows
  if (w?.current?.from && w?.previous?.from) {
    lines.push(`Comparing ${w.current.from} to ${w.current.to} against the `
      + `${dayCount(dec)} days before it, ${w.previous.from} to ${w.previous.to}.`)
  }

  if (t.delta === 0) {
    return { headline, lines, text: [headline, ...lines].join(' ') }
  }

  // 2. price against volume, for the items that existed in both periods
  const byKey = Object.fromEntries(dec.effects.terms.map((x) => [x.key, x]))
  const vol = byKey.volume?.amount || 0
  const price = byKey.price?.amount || 0
  if (dec.effects.itemsBoth > 0 && (vol !== 0 || price !== 0)) {
    const parts = []
    if (vol !== 0) {
      parts.push(`${vol > 0 ? 'buying more' : 'buying less'} accounts for ${M(abs(vol))}`)
    }
    if (price !== 0) {
      parts.push(`unit prices ${price > 0 ? 'rising' : 'falling'} accounts for ${M(abs(price))}`)
    }
    const flat = abs(price) > 0 && abs(vol) > 0 && abs(price) / (abs(price) + abs(vol)) < 0.1
    lines.push(`Across the ${NF0.format(dec.effects.itemsBoth)} items bought in both `
      + `periods, ${parts.join(' and ')}.`
      + (flat ? ' Unit prices were close to flat.' : ''))
  }

  // 3. the basket changing, stated gross as well as net when they differ
  const c = dec.churn
  if (c.started !== 0 || c.stopped !== 0) {
    let s = `${NF0.format(c.countStarted)} item ${c.countStarted === 1 ? 'line' : 'lines'} `
      + `had no spend in the earlier period and added ${M(c.started)}; `
      + `${NF0.format(c.countStopped)} stopped and removed ${M(abs(c.stopped))}, `
      + `a net ${c.net >= 0 ? 'addition' : 'reduction'} of ${M(abs(c.net))}.`
    if (c.offsetting) {
      s += ' The two sides largely cancel, which can also happen when the same part '
        + 'is reissued under a different item code.'
    }
    lines.push(s)
  }

  // 4. the single biggest item, only when it is genuinely big
  const top = dec.items?.[0]
  if (top && t.delta !== 0) {
    const shareOfTotal = abs(top.delta) / abs(t.delta)
    if (shareOfTotal >= 0.1) {
      let s = `The largest single item is ${top.code} ${top.label}, `
        + `${top.delta > 0 ? 'up' : 'down'} ${M(abs(top.delta))}, `
        + `${fmtPct(shareOfTotal)} of the total change.`
      if (top.kind === 'new') {
        s += ` It is new: ${fmtQty(top.qtyCurrent)} units at ${M(top.priceCurrent)} each, `
          + 'with no purchases in the earlier period.'
      } else if (top.kind === 'stopped') {
        s += ` It stopped: ${fmtQty(top.qtyPrevious)} units at ${M(top.pricePrevious)} each `
          + 'previously, none in this period.'
      } else if (top.driver === 'price') {
        s += ` Unit price moved from ${M(top.pricePrevious)} to ${M(top.priceCurrent)} `
          + `on ${fmtQty(top.qtyCurrent)} units.`
      } else if (top.driver === 'volume') {
        s += ` Quantity moved from ${fmtQty(top.qtyPrevious)} to ${fmtQty(top.qtyCurrent)} units `
          + `at about ${M(top.priceCurrent)} each.`
      } else {
        s += ` Quantity ${fmtQty(top.qtyPrevious)} to ${fmtQty(top.qtyCurrent)} units, `
          + `unit price ${M(top.pricePrevious)} to ${M(top.priceCurrent)}.`
      }
      lines.push(s)
    }
  }

  // 5. where it sits, and whether anything actually dominates
  for (const dimKey of ['by_site', 'by_asset']) {
    const con = dec.concentration?.[dimKey === 'by_site' ? 'site' : 'asset']
    const dim = dec.byDim?.[dimKey]
    if (!con || !dim || !con.top1) continue
    // a site-scoped view has one site; splitting it by site says nothing
    if (dimKey === 'by_site' && dec.site) continue
    const dirWord = (v) => (v >= 0 ? 'rose' : 'fell')
    if (con.breadth === 'concentrated') {
      lines.push(`It is concentrated: ${con.top1.label} alone is `
        + `${M(abs(con.top1.delta))} of the movement`
        + (con.countTo80 != null && con.countTo80 > 1
          ? `, and ${con.countTo80} ${dim.label.many} cover 80% of it.` : '.'))
    } else if (con.breadth === 'broad') {
      const outside = dim.tail || dim.remainder
      lines.push(`No single ${dim.label.one} explains it. The largest, ${con.top1.label}, `
        + `is ${M(abs(con.top1.delta))} (${fmtPct(con.top1Share)} of the movement)`
        + (outside && outside.count
          // signed figures are stated as a direction and a positive amount:
          // a minus sign buried in a sentence is read wrong
          ? `, and ${NF0.format(outside.count)} further ${dim.label.many} account for a `
            + `${M(abs(outside.delta))} ${outside.delta >= 0 ? 'rise' : 'reduction'}.` : '.'))
    } else if (con.breadth === 'mixed' && con.top1) {
      // Neither one member nor an even drift. Naming a single cause would be
      // wrong, but saying nothing hides where the money actually moved, so the
      // two largest movers are named with their own figures and no cause.
      const two = [...dim.rows].sort((a, b) => abs(b.delta) - abs(a.delta)).slice(0, 2)
      const named = two.map((r) => `${r.label} ${dirWord(r.delta)} ${M(abs(r.delta))}`).join(' and ')
      lines.push(`It is spread across ${dim.label.many}: ${named}`
        + (con.countTo80 != null
          ? `, with ${con.countTo80} ${dim.label.many} covering 80% of the movement.` : '.'))
    }
  }

  // 6. anything the decomposition could not attribute, said out loud
  const gap = dec.effects.terms.find((x) => x.key === 'unexplained')
  if (gap) {
    lines.push(`${M(abs(gap.amount))} of the change is not attributed to any item line. `
      + 'Treat the split above as incomplete by that amount.')
  }
  const undec = byKey.notDecomposable?.amount || 0
  if (undec !== 0) {
    lines.push(`${M(abs(undec))} sits on lines with no usable quantity or unit cost, `
      + 'so it cannot be split into price and volume.');
  }

  const kept = lines.slice(0, maxLines)
  return { headline, lines: kept, text: [headline, ...kept].join(' ') }
}

/**
 * Pure: rows for the Excel export of the panel.
 *
 * Every section closes on its own, and the money column is named for its
 * currency so a blended export is impossible by construction.
 */
export function buildVarianceExport(dec) {
  if (!dec?.ok) return { rows: [], columns: ['section'], headers: ['Section'] }
  const cur = dec.currency || 'N/A'
  const rows = []
  const pct = (v) => (v == null ? 'N/A' : fmtPct(v, 1))

  rows.push({ section: 'Total', name: 'Previous period', amount: dec.totals.previous, share: '' })
  rows.push({ section: 'Total', name: 'This period', amount: dec.totals.current, share: '' })
  rows.push({ section: 'Total', name: 'Change', amount: dec.totals.delta, share: pct(dec.totals.pct) })

  for (const t of dec.effects.terms) {
    rows.push({ section: 'Why it changed', name: t.label, amount: t.amount, share: pct(t.share) })
  }
  for (const [key, dim] of Object.entries(dec.byDim || {})) {
    const label = DIM_LABEL[key]?.many || key
    for (const r of dim.rows) {
      rows.push({ section: `By ${label}`, name: r.label, amount: r.delta, share: pct(r.share) })
    }
    if (dim.tail) rows.push({ section: `By ${label}`, name: dim.tail.label, amount: dim.tail.delta, share: pct(dim.tail.share) })
    if (dim.remainder) rows.push({ section: `By ${label}`, name: dim.remainder.label, amount: dim.remainder.delta, share: pct(dim.remainder.share) })
  }
  for (const i of dec.items || []) {
    rows.push({ section: 'By item', name: `${i.code} ${i.label}`, amount: i.delta, share: i.driver })
  }
  return {
    rows,
    columns: ['section', 'name', 'amount', 'share'],
    headers: ['Section', 'Name', `Change (${cur})`, 'Share of movement'],
  }
}
