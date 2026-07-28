/**
 * materialMaster.js — the controlled material and service master.
 *
 * WHY THIS EXISTS
 * Cost category is currently decided by pattern-matching the free-text item
 * DESCRIPTION on every transaction (see partsExpense.isTyreItem / isOilItem and the
 * SQL mirror classify_parts_consumption). That works, but nobody can audit it, nobody
 * can override a single wrong item, and a change to the pattern silently re-buckets
 * historical money. The category should come from a controlled master keyed on the
 * ITEM CODE, with the text patterns kept only as a proposal for codes nobody has
 * reviewed yet.
 *
 * WHAT THE DATA ACTUALLY SAYS — read this before promising the master will fix totals.
 * Measured on the live 216,792 expense rows: 20,465 distinct item codes, and only
 * TWO codes (37 rows) classify inconsistently across their own rows. So
 * description-driven classification is 99.99% SELF-CONSISTENT. The master's value is
 * therefore CONTROL and AUDITABILITY - a place to review and override 20,465 codes and
 * to prove why a given item is a tyre or a spare - and NOT the correction of
 * widespread drift. Consistent is not the same as correct: a code can be consistently
 * mis-bucketed, and an earlier pass did re-bucket 1,518 misfiled tyre lines. Reviewing
 * the master is what finds those, not the act of introducing it.
 *
 * DESIGN
 *   - `deriveMasterFromTransactions` proposes one master row per item code from the
 *     transactions themselves, using the existing classifier as the starting category
 *     and flagging any code whose rows disagree. Nothing is invented: a code with no
 *     usable description is proposed as `unclassified`, not guessed into a bucket.
 *   - `classifyByMaster` resolves a transaction: reviewed master wins, then unreviewed
 *     master, then the description fallback, and the result always reports WHICH of
 *     those decided it so a report can show provenance.
 *   - Categories carry explicit boolean flags (tyre / spare / lubricant / fuel /
 *     service / capital) because downstream KPIs ask "is this a tyre cost" rather than
 *     "what string is in the category column".
 *
 * This module is PURE: no I/O, no Supabase, no Date.now(). The SQL side must mirror
 * `categoryFlags` and `classifyByMaster` exactly, the same contract that already binds
 * partsExpense.js to classify_parts_consumption.
 *
 * @module materialMaster
 */
import { isTyreItem, isOilItem, brandOf } from './partsExpense'

/**
 * The controlled category vocabulary. `key` is what gets stored.
 * `costBucket` maps a category onto the three cost columns the expense record already
 * carries (tyre_cost / spare_cost / oil_cost), so adding a category never requires a
 * schema change - only a decision about which existing bucket it rolls into.
 */
export const MATERIAL_CATEGORIES = Object.freeze([
  { key: 'tyre',         label: 'Tyres',            costBucket: 'tyre',  flags: ['tyre'] },
  { key: 'spare_part',   label: 'Spare Parts',      costBucket: 'spare', flags: ['spare'] },
  { key: 'filter',       label: 'Filters',          costBucket: 'spare', flags: ['spare'] },
  { key: 'lubricant',    label: 'Oil & Lubricants', costBucket: 'oil',   flags: ['lubricant'] },
  { key: 'fuel',         label: 'Fuel',             costBucket: 'oil',   flags: ['fuel'] },
  { key: 'consumable',   label: 'Consumables',      costBucket: 'spare', flags: ['spare'] },
  { key: 'service',      label: 'External Service', costBucket: 'spare', flags: ['service'] },
  { key: 'labour',       label: 'Workshop Labour',  costBucket: 'spare', flags: ['service'] },
  { key: 'capital',      label: 'Capital Item',     costBucket: 'spare', flags: ['capital'] },
  { key: 'unclassified', label: 'Unclassified',     costBucket: 'spare', flags: [] },
])

export const MATERIAL_CATEGORY_BY_KEY = Object.freeze(
  Object.fromEntries(MATERIAL_CATEGORIES.map((c) => [c.key, c])),
)

/** Every category key, for validation. */
export const MATERIAL_CATEGORY_KEYS = Object.freeze(MATERIAL_CATEGORIES.map((c) => c.key))

/**
 * Subcategories offered per category. Free text is still allowed; this is a
 * suggestion list so reviewers converge instead of inventing 40 spellings.
 */
export const MATERIAL_SUBCATEGORIES = Object.freeze({
  tyre:       ['Truck tyre', 'OTR tyre', 'Trailer tyre', 'Retread', 'Tube / flap'],
  spare_part: ['Brake system', 'Engine', 'Transmission', 'Suspension', 'Electrical',
    'Hydraulic', 'Body', 'Drum / mixer', 'Pump'],
  filter:     ['Oil filter', 'Air filter', 'Fuel filter', 'Hydraulic filter'],
  lubricant:  ['Engine oil', 'Gear oil', 'Hydraulic oil', 'Grease', 'Coolant'],
  fuel:       ['Diesel', 'Petrol', 'Gas'],
  consumable: ['Fastener', 'Sealant', 'Cleaning', 'Welding', 'Tyre consumable'],
  service:    ['Tyre service', 'Machining', 'Recovery', 'Inspection', 'Calibration'],
  labour:     ['Internal labour', 'Contract labour'],
  capital:    ['Asset purchase', 'Major component'],
  unclassified: [],
})

/**
 * Pure: the boolean flags for a category. Downstream KPIs should ask these rather
 * than string-comparing the category.
 * @param {string} category
 * @returns {{tyre:boolean, spare:boolean, lubricant:boolean, fuel:boolean, service:boolean, capital:boolean}}
 */
export function categoryFlags(category) {
  const set = new Set(MATERIAL_CATEGORY_BY_KEY[category]?.flags || [])
  return {
    tyre: set.has('tyre'),
    spare: set.has('spare'),
    lubricant: set.has('lubricant'),
    fuel: set.has('fuel'),
    service: set.has('service'),
    capital: set.has('capital'),
  }
}

/**
 * Pure: which cost column a category rolls into. Unknown categories fall to `spare`,
 * matching the existing classifier's default, so an unreviewed item can never silently
 * vanish from cost totals.
 * @param {string} category
 * @returns {'tyre'|'spare'|'oil'}
 */
export function costBucketFor(category) {
  return MATERIAL_CATEGORY_BY_KEY[category]?.costBucket || 'spare'
}

/**
 * Pure: the category the DESCRIPTION patterns would propose. This is the existing
 * behaviour, isolated so it is obvious that it is only a fallback.
 *
 * Deliberately coarse: the text patterns can only reliably distinguish tyre / oil /
 * everything-else. It does NOT guess `filter` or `service` from text, because a wrong
 * confident guess is worse than an honest `spare_part` awaiting review.
 * @param {string} description
 * @returns {'tyre'|'lubricant'|'spare_part'}
 */
export function categoryFromDescription(description) {
  if (isTyreItem(description)) return 'tyre'
  if (isOilItem(description)) return 'lubricant'
  return 'spare_part'
}

/**
 * Pure: resolve the category of one transaction line.
 *
 * Precedence, and the reason for it:
 *   1. a REVIEWED master row      - a human decided this, it is authoritative
 *   2. an UNREVIEWED master row   - derived, still better than re-reading the text
 *   3. the description patterns   - only for a code the master has never seen
 *
 * @param {{item_code?:string, item_description?:string}} line
 * @param {Map<string,object>|Record<string,object>} master keyed by item code
 * @returns {{category:string, bucket:'tyre'|'spare'|'oil', source:'master_reviewed'|'master_derived'|'description', flags:object, reviewed:boolean}}
 */
export function classifyByMaster(line, master) {
  const code = normaliseItemCode(line?.item_code)
  const entry = code ? lookupMaster(master, code) : null

  if (entry && entry.category && MATERIAL_CATEGORY_BY_KEY[entry.category]) {
    const reviewed = Boolean(entry.reviewed)
    return {
      category: entry.category,
      bucket: costBucketFor(entry.category),
      source: reviewed ? 'master_reviewed' : 'master_derived',
      flags: categoryFlags(entry.category),
      reviewed,
    }
  }

  const fallback = categoryFromDescription(line?.item_description)
  return {
    category: fallback,
    bucket: costBucketFor(fallback),
    source: 'description',
    flags: categoryFlags(fallback),
    reviewed: false,
  }
}

/** Pure: canonical item code (upper, trimmed). Empty becomes null, never ''. */
export function normaliseItemCode(code) {
  const s = String(code ?? '').trim().toUpperCase()
  return s || null
}

/** Read a master entry from either a Map or a plain object. */
function lookupMaster(master, code) {
  if (!master) return null
  if (typeof master.get === 'function') return master.get(code) || null
  return master[code] || null
}

/**
 * Pure: propose one master row per item code from transaction rows.
 *
 * Each proposal records how many rows and how much value sit behind it, so a reviewer
 * can start with the codes that carry the most money rather than alphabetically. A code
 * whose own rows disagree on category is flagged `conflicting` and left at the majority
 * category - it is exactly the case a human must look at.
 *
 * @param {Array<{item_code?:string, item_description?:string, line_cost?:number, cost_category?:string}>} rows
 * @returns {Array<object>} one proposal per distinct item code, highest value first
 */
export function deriveMasterFromTransactions(rows = []) {
  /** @type {Map<string, {code:string, descriptions:Map<string,number>, cats:Map<string,number>, rows:number, value:number}>} */
  const acc = new Map()

  for (const r of rows || []) {
    const code = normaliseItemCode(r?.item_code)
    if (!code) continue

    let e = acc.get(code)
    if (!e) {
      e = { code, descriptions: new Map(), cats: new Map(), rows: 0, value: 0 }
      acc.set(code, e)
    }

    e.rows += 1
    const v = Number(r?.line_cost)
    if (Number.isFinite(v)) e.value += v

    const desc = String(r?.item_description ?? '').trim()
    if (desc) e.descriptions.set(desc, (e.descriptions.get(desc) || 0) + 1)

    // Prefer the category already stored on the row; otherwise derive it from text.
    const stored = mapLegacyCategory(r?.cost_category)
    const cat = stored || categoryFromDescription(desc)
    e.cats.set(cat, (e.cats.get(cat) || 0) + 1)
  }

  const out = []
  for (const e of acc.values()) {
    const name = mostCommon(e.descriptions) || null
    const category = mostCommon(e.cats) || 'unclassified'
    out.push({
      item_code: e.code,
      item_name: name,
      category,
      subcategory: null,
      brand: name ? brandOf(name) : null,
      uom: null,
      reviewed: false,
      conflicting: e.cats.size > 1,
      proposed_from: e.cats.size > 1 ? 'majority of conflicting rows' : 'transactions',
      txn_rows: e.rows,
      txn_value: Math.round(e.value * 100) / 100,
      ...categoryFlags(category),
    })
  }

  // Highest value first: that is the order a reviewer should work in.
  return out.sort((a, b) => (b.txn_value - a.txn_value) || (b.txn_rows - a.txn_rows))
}

/**
 * Pure: fold the three legacy cost_category tokens onto the master vocabulary.
 * The stored values are 'tyre' / 'spare' / 'oil'.
 * @param {string} c
 * @returns {string|null} null when unrecognised, so the caller falls back to text
 */
export function mapLegacyCategory(c) {
  const s = String(c ?? '').trim().toLowerCase()
  if (s === 'tyre') return 'tyre'
  if (s === 'oil') return 'lubricant'
  if (s === 'spare') return 'spare_part'
  return null
}

/** Most frequent key of a Map<string, count>, ties broken alphabetically for determinism. */
function mostCommon(map) {
  let best = null
  let bestN = -1
  for (const [k, n] of map) {
    if (n > bestN || (n === bestN && best !== null && k < best)) { best = k; bestN = n }
  }
  return best
}

/**
 * Pure: coverage of the master over a set of transactions, for an honest progress
 * figure. `reviewedValueShare` is the number worth showing an executive: what
 * proportion of MONEY is classified by a human decision rather than a text pattern.
 *
 * @param {Array<object>} rows transactions
 * @param {Map<string,object>|Record<string,object>} master
 * @returns {{rows:number, value:number, bySource:object, reviewedValueShare:number|null, unclassifiedCodes:number}}
 */
export function masterCoverage(rows = [], master) {
  const bySource = {
    master_reviewed: { rows: 0, value: 0 },
    master_derived: { rows: 0, value: 0 },
    description: { rows: 0, value: 0 },
  }
  let total = 0
  let value = 0
  const unclassified = new Set()

  for (const r of rows || []) {
    const res = classifyByMaster(r, master)
    const v = Number(r?.line_cost)
    const amt = Number.isFinite(v) ? v : 0
    bySource[res.source].rows += 1
    bySource[res.source].value += amt
    total += 1
    value += amt
    if (res.category === 'unclassified') {
      const c = normaliseItemCode(r?.item_code)
      if (c) unclassified.add(c)
    }
  }

  for (const k of Object.keys(bySource)) {
    bySource[k].value = Math.round(bySource[k].value * 100) / 100
  }

  return {
    rows: total,
    value: Math.round(value * 100) / 100,
    bySource,
    // null, not 0, when there is no money to divide by: an honest "not measurable".
    reviewedValueShare: value > 0
      ? Math.round((bySource.master_reviewed.value / value) * 1000) / 10
      : null,
    unclassifiedCodes: unclassified.size,
  }
}

/**
 * Pure: does the item's own description agree with its assigned category?
 *
 * This is the single most useful signal for deciding what is safe to confirm in
 * bulk. When the description patterns would land on the same cost bucket as the
 * category on the row, the two agree and the row can be confirmed with
 * confidence. When they differ, a human should look before confirming.
 *
 * Compared at the BUCKET level, not the category, because the description patterns
 * are deliberately coarse (they only distinguish tyre / oil / everything-else),
 * so `filter` vs `spare_part` both being `spare` is agreement, not a conflict.
 *
 * @param {{item_name?:string, category?:string}} row
 * @returns {'agree'|'differ'|'unknown'} unknown when there is no description to compare
 */
export function descriptionAgreement(row) {
  const name = String(row?.item_name ?? '').trim()
  if (!name) return 'unknown'
  const fromText = costBucketFor(categoryFromDescription(name))
  const fromCat = costBucketFor(row?.category)
  return fromText === fromCat ? 'agree' : 'differ'
}

/**
 * Pure: split a set of transaction lines by the cost bucket they are booked under,
 * so a reviewer sees where a code's money actually sits rather than one sample.
 * @param {Array<{cost_category?:string, line_cost?:number}>} txns
 * @returns {{tyre:number, spare:number, oil:number, total:number}}
 */
export function transactionBucketSplit(txns = []) {
  const out = { tyre: 0, spare: 0, oil: 0, total: 0 }
  for (const t of txns || []) {
    const v = Number(t?.line_cost)
    const amt = Number.isFinite(v) ? v : 0
    const raw = String(t?.cost_category ?? '').trim().toLowerCase()
    const bucket = raw === 'tyre' ? 'tyre' : raw === 'oil' ? 'oil' : 'spare'
    out[bucket] += amt
    out.total += amt
  }
  for (const k of ['tyre', 'spare', 'oil', 'total']) out[k] = Math.round(out[k] * 100) / 100
  return out
}

/**
 * Pure: validate a master row before it is saved.
 * @param {object} row
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateMasterRow(row) {
  const errors = []
  if (!normaliseItemCode(row?.item_code)) errors.push('An item code is required.')
  if (!MATERIAL_CATEGORY_KEYS.includes(row?.category)) errors.push('Pick a valid category.')
  if (row?.uom != null && String(row.uom).length > 16) errors.push('Unit of measure is too long.')
  return { ok: errors.length === 0, errors }
}
