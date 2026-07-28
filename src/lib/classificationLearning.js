/**
 * classificationLearning.js - reading the evidence behind a proposed rule.
 *
 * Pure, no I/O. The SQL in V400 decides WHICH rules to propose; this module
 * decides how a person is asked to judge one, which is a different problem and
 * the one that determines whether the loop actually improves anything.
 *
 * THE NUMBER THAT MATTERS IS LIFT, NOT PRECISION. 89.6% of reviewed items in
 * this dataset are spare_part, so a rule claiming spare_part at 90% precision
 * has learned nothing at all - it has learned to guess the most common answer.
 * Lift divides precision by that base rate, so the same rule scores 1.0 and is
 * correctly read as worthless. Every label and sort here leads with lift for
 * that reason; showing precision first would make noise look like knowledge.
 */

/** Below this, a rule is not distinguishable from guessing the common answer. */
export const MIN_USEFUL_LIFT = 1.5

/**
 * A number, or null when there is no measurement.
 *
 * `Number(null)` is 0 and 0 is finite, so reading a missing value with Number()
 * alone silently turns "not measured" into a real reading of zero - which would
 * label an unmeasured rule "no better than guessing" and let an empty month drag
 * the accuracy trend down. Both are claims the data does not support.
 */
function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Lift bands, in the words a reviewer needs rather than statistical ones. */
// Tones are the console UI kit's vocabulary (good/info/warning/accent/danger),
// NOT raw colour names. The kit falls back to grey for anything it does not
// recognise, so a band emitting 'emerald' would render identically to one
// emitting 'rose' and the entire visual signal would quietly disappear.
export const LIFT_BANDS = [
  { min: 8, key: 'decisive', label: 'Decisive', tone: 'good' },
  { min: 4, key: 'strong', label: 'Strong', tone: 'info' },
  { min: 2, key: 'moderate', label: 'Moderate', tone: 'warning' },
  { min: MIN_USEFUL_LIFT, key: 'weak', label: 'Weak', tone: 'accent' },
  { min: 0, key: 'noise', label: 'No better than guessing', tone: 'danger' },
]

/** The band a lift value falls in. Non-numeric lift is unknown, never 'weak'. */
export function liftBand(lift) {
  const n = num(lift)
  if (n === null) return { key: 'unknown', label: 'Not measured', tone: 'quiet', min: null }
  return LIFT_BANDS.find((b) => n >= b.min) || LIFT_BANDS[LIFT_BANDS.length - 1]
}

/**
 * Support below this is a coincidence rather than a pattern. Four is the SQL
 * default and is deliberately low, because the whole reviewed set is only a few
 * hundred items - a higher floor would propose nothing at all until the customer
 * had reviewed for months.
 */
export const MIN_SUPPORT = 4

/**
 * Plain-language reason a rule is being offered. This is the text a reviewer
 * actually reads, so it states the comparison rather than the raw percentage:
 * "94% against a base rate of 8%" is judgeable; "94%" alone is not.
 */
export function explainProposal(p) {
  if (!p) return ''
  const token = p.token ? `"${p.token}"` : 'This word'
  const cat = p.category || 'that category'
  const prec = num(p.precision_pct)
  const base = num(p.base_rate_pct)
  const support = num(p.support)

  const parts = []
  if (support !== null) {
    parts.push(`${token} appears in ${support} item${support === 1 ? '' : 's'} you have reviewed`)
  } else {
    parts.push(`${token} appears in items you have reviewed`)
  }
  if (prec !== null) parts.push(`${prec}% of them are ${cat}`)
  if (base !== null) parts.push(`against ${base}% for items in general`)
  return `${parts.join(', ')}.`
}

/**
 * What accepting this rule would change. Returns null when nothing would move -
 * a rule with no impact is not worth a reviewer's attention and should not be
 * dressed up as an opportunity.
 */
export function impactOf(p) {
  const lines = num(p?.affects_lines)
  if (lines === null || lines <= 0) return null
  return {
    lines,
    value: num(p?.affects_value),
    sample: p?.sample || null,
  }
}

/**
 * Order proposals for review: biggest money first, then strongest evidence.
 * Deliberately NOT by lift alone - a decisive rule affecting one line of 28 is
 * true and irrelevant, and putting it at the top wastes the reviewer's time.
 */
export function rankProposals(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const av = Number(a?.affects_value) || 0
    const bv = Number(b?.affects_value) || 0
    if (bv !== av) return bv - av
    return (Number(b?.lift) || 0) - (Number(a?.lift) || 0)
  })
}

/**
 * Whether a proposal is safe to offer at all. A rule that clears the floors but
 * moves nothing, or names no category, is filtered rather than shown - the
 * reviewer's list should contain only decisions worth making.
 */
export function isOfferable(p) {
  if (!p?.token || !p?.category) return false
  if ((Number(p.support) || 0) < MIN_SUPPORT) return false
  if ((Number(p.lift) || 0) < MIN_USEFUL_LIFT) return false
  return impactOf(p) !== null
}

/**
 * Direction of the accuracy trend, oldest to newest.
 *
 * Returns null - never 0, never "flat" - when there is only one period, because
 * a single point has no direction and saying "no change" would be a claim the
 * data cannot support.
 */
export function accuracyTrend(periods) {
  const rows = (Array.isArray(periods) ? periods : [])
    .filter((r) => num(r?.agreement_pct) !== null)
    .slice()
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
  if (rows.length < 2) return null
  const first = Number(rows[0].agreement_pct)
  const last = Number(rows[rows.length - 1].agreement_pct)
  return {
    from: first,
    to: last,
    delta: Math.round((last - first) * 10) / 10,
    improving: last > first,
    periods: rows.length,
  }
}

/**
 * Turn a weak spot into the sentence a maintainer can act on.
 *
 * `share_of_source_pct` is the load-bearing figure: a layer overruled 22 times
 * out of 39 firings is broken, while one overruled 16 times out of 271 is merely
 * imperfect. Reporting the count alone would rank them the same way round and
 * point the maintainer at the wrong layer.
 */
export function describeWeakSpot(w) {
  if (!w) return ''
  const src = w.machine_source || 'the classifier'
  const said = w.machine_said || 'something'
  const human = w.human_said || 'something else'
  const items = Number(w.items) || 0
  const share = Number(w.share_of_source_pct)
  const base = `${src} called ${items} item${items === 1 ? '' : 's'} ${said}; you said ${human}`
  if (!Number.isFinite(share)) return `${base}.`
  return `${base}. That is ${share}% of everything ${src} decided.`
}

/**
 * Rank weak spots by how unreliable the LAYER is, not by raw count, so the most
 * broken part of the brain surfaces first even when it fires rarely. A layer
 * needs a few decisions behind it before its share means anything.
 */
export const MIN_DECISIONS_FOR_SHARE = 5

export function rankWeakSpots(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const aEnough = (Number(a?.items) || 0) >= MIN_DECISIONS_FOR_SHARE
    const bEnough = (Number(b?.items) || 0) >= MIN_DECISIONS_FOR_SHARE
    if (aEnough !== bEnough) return aEnough ? -1 : 1
    const as = Number(a?.share_of_source_pct) || 0
    const bs = Number(b?.share_of_source_pct) || 0
    if (bs !== as) return bs - as
    return (Number(b?.items) || 0) - (Number(a?.items) || 0)
  })
}

/** Category tokens the master uses, in the order a reviewer scans them. */
export const LEARNABLE_CATEGORIES = ['tyre', 'lubricant', 'spare_part', 'filter']

export const CATEGORY_LABEL = {
  tyre: 'Tyre',
  lubricant: 'Oil and lubricant',
  spare_part: 'Spare part',
  filter: 'Filter',
}

export const categoryLabel = (c) => CATEGORY_LABEL[c] || c || 'Unclassified'
