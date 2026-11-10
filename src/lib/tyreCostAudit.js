/**
 * tyreCostAudit.js - THE rule set for auditing and recovering tyre acquisition costs.
 *
 * Deterministic, no AI, no network. Used by:
 *   - the import preview (validateUploadRows)
 *   - the Tyre Cost Audit dashboard and agent (classifyTyre / summarizeFindings)
 *   - MIRRORED by SQL public.tyre_cost_audit_classify (migration 20261112106000).
 *     Change both together; src/test/tyreCostAudit.test.js pins the rules.
 *
 * Non-negotiable rules encoded here:
 *   1. No guessed prices. A price is only proposed from a real expense-grid line.
 *   2. No cross-month substitution: the source line's month must equal the tyre's month.
 *   3. Same normalised item code only. Size, brand or pattern alone never match two products.
 *   4. Warranty is never repriced. Unclear warranty status goes to review.
 *   5. Tubes, flaps, valves, repairs and fitting services are never a tyre price.
 *   6. An unknown cost is "Cost Pending Verification", never zero.
 *   7. More than one valid price in the month = conflict for review, never an average.
 *
 * Source of truth for prices: there is no invoice, GRN or PO data in the database
 * (those tables hold 0 rows). The only transaction-level tyre prices are the ERP
 * store-issue lines in parts_consumption (the expense grid). They are treated as the
 * verified source; that limit is stated on every report.
 */
import { TYRE_BRANDS, hasTyreSize } from './classificationBrain'
import { isTyreRepair, isTyreWarranty, unitPrice } from './tyrePriceRules'

export const COST_PENDING_LABEL = 'Cost Pending Verification'

export const AUDIT_CLASSES = Object.freeze({
  priced_verified: { label: 'Verified, correctly priced', group: 'ok', action: 'None' },
  excluded_warranty: { label: 'Warranty, excluded from repricing', group: 'ok', action: 'None' },
  exact_match: { label: 'Missing cost, exact own-transaction price found', group: 'recoverable', action: 'Approve proposed price' },
  same_month_item_match: { label: 'Missing cost, same item code same month price found', group: 'recoverable', action: 'Approve proposed price' },
  priced_estimate_not_verified: { label: 'Priced by an estimate (comparable median), not a transaction', group: 'review', action: 'Approve reverting to Cost Pending Verification' },
  priced_unreconciled: { label: 'Priced, but differs from its own transaction', group: 'review', action: 'Check the source line' },
  priced_no_source: { label: 'Priced, no transaction found to confirm it', group: 'info', action: 'Keep; confirm when the source is loaded' },
  conflict: { label: 'Conflicting prices in the same month', group: 'review', action: 'Pick the correct line or apply the valuation policy' },
  month_mismatch: { label: 'Only a different month has a price', group: 'review', action: 'Confirm the accounting month; no cross-month substitution' },
  zero_line_uncertain: { label: 'Tyre line issued at zero, warranty not proven', group: 'review', action: 'Confirm warranty or supply the price' },
  mixed_tyre_tube: { label: 'Tyre and tube on one line', group: 'review', action: 'Split the line into tyre and tube' },
  spec_mismatch: { label: 'Source line size or brand differs from the tyre', group: 'review', action: 'Check the item code on the job card' },
  invalid_cost: { label: 'Negative or invalid cost', group: 'review', action: 'Correct the source value' },
  duplicate_price: { label: 'Same physical tyre priced more than once', group: 'review', action: 'Keep one purchase price' },
  unresolved: { label: 'Missing cost, no reliable price', group: 'pending', action: 'Leave as Cost Pending Verification' },
})

const str = (v) => (v == null ? '' : String(v)).trim()
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }

export function normItemCode(code) {
  return str(code).toUpperCase().replace(/\s+/g, '')
}

/** 'YYYY-MM' from a date or ISO string; null when unparseable. */
export function monthKey(d) {
  const s = str(d instanceof Date ? d.toISOString() : d)
  const m = /^(\d{4})-(\d{2})/.exec(s)
  return m ? `${m[1]}-${m[2]}` : null
}

/** Size with every separator removed: "315/80 R 22.5" -> "31580R225". */
export function sizeNorm(size) {
  return str(size).toUpperCase().replace(/[^0-9A-Z]/g, '')
}

const TUBE_RE = /(^|[^a-z])(inner\s*)?tubes?([^a-z]|$)/i
const FLAP_RE = /(^|[^a-z])flaps?([^a-z]|$)/i
const VALVE_RE = /(^|[^a-z])valves?([^a-z]|$)/i
const SERVICE_RE = /(fitting|mounting|dismount|labou?r|service charge|alignment|balanc|installation)/i
const TYRE_RE = /(^|[^a-z])(tyres?|tires?)([^a-z]|$)/i

/**
 * What a cost line is, financially. Tubes, flaps and valves are SPARE PARTS,
 * fitting is a SERVICE, a repair is a REPAIR, and only 'tyre' may price a tyre.
 * A line that names a tyre AND a tube is 'mixed': it must be split, never used whole.
 */
export function lineKind(description) {
  const d = str(description)
  if (!d) return 'other'
  if (isTyreWarranty(d)) return 'warranty'
  if (isTyreRepair(d)) return 'repair'
  const tyre = TYRE_RE.test(d) || hasTyreSize(d)
  const tube = TUBE_RE.test(d)
  const flap = FLAP_RE.test(d)
  // 'TYRE ... WITH TUBE & FLAP' is two products on one line; 'TYRE FLAP' alone is a flap.
  if (TYRE_RE.test(d) && (tube || flap) && /(^|[^a-z])(with|and|incl\w*)([^a-z]|$)|[+&]/i.test(d)) return 'mixed'
  if (tube) return 'tube'
  if (flap) return 'flap'
  if (VALVE_RE.test(d)) return 'valve'
  if (SERVICE_RE.test(d) && !hasTyreSize(d)) return 'service'
  if (tyre) return 'tyre'
  return 'other'
}

/** Financial bucket for a line kind. */
export function costBucket(kind) {
  if (kind === 'tyre') return 'tyre'
  if (kind === 'service') return 'service'
  if (kind === 'repair') return 'repair'
  if (kind === 'warranty') return 'warranty'
  if (kind === 'mixed') return 'mixed'
  return 'spare'
}

function brandsIn(text) {
  const t = str(text).toUpperCase()
  return TYRE_BRANDS.filter((b) => new RegExp(`(^|[^A-Z])${b.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z]|$)`).test(t))
}

/**
 * Does the source line describe the same product as the tyre record?
 * Unknown on either side = no evidence of a mismatch (returns ok:true, checked:false).
 */
export function specCheck(tyre, description) {
  const reasons = []
  const sz = sizeNorm(tyre?.size)
  if (sz && hasTyreSize(description) && !sizeNorm(description).includes(sz)) reasons.push(`size ${str(tyre.size)} not in "${str(description).slice(0, 60)}"`)
  const tb = str(tyre?.brand).toUpperCase()
  const lineBrands = brandsIn(description)
  if (tb && lineBrands.length && !lineBrands.some((b) => tb.includes(b.toUpperCase()) || b.toUpperCase().includes(tb))) {
    reasons.push(`brand ${tb} differs from ${lineBrands.join('/')}`)
  }
  return { ok: reasons.length === 0, reasons, checked: !!(sz || tb) }
}

/** Eligible per-tyre price from one line, or null. */
export function eligibleUnitPrice(line) {
  if (lineKind(line?.description) !== 'tyre') return null
  return unitPrice(line?.value, line?.qty)
}

/**
 * Same country + same item code + same month price index from grid lines.
 * Lines: { country, itemCode, date, description, value, qty, id }
 */
export function buildPriceIndex(lines = []) {
  const idx = new Map()
  for (const l of lines) {
    const p = eligibleUnitPrice(l)
    const item = normItemCode(l.itemCode)
    const m = monthKey(l.date)
    if (p == null || !item || !m) continue
    const k = `${str(l.country)}|${item}|${m}`
    const e = idx.get(k) || { prices: new Map() }
    if (!e.prices.has(p)) e.prices.set(p, l.id ?? null)
    idx.set(k, e)
  }
  return idx
}

export function lookupSameMonth(index, country, itemCode, month) {
  const e = index?.get(`${str(country)}|${normItemCode(itemCode)}|${month}`)
  if (!e) return { status: 'none' }
  if (e.prices.size > 1) return { status: 'conflict', prices: [...e.prices.keys()].sort((a, b) => a - b) }
  const [[price, id]] = [...e.prices.entries()]
  return { status: 'one', price, sourceId: id }
}

const finding = (cls, extra = {}) => ({ class: cls, group: AUDIT_CLASSES[cls].group, action: AUDIT_CLASSES[cls].action, proposed: null, confidence: null, reasons: [], ...extra })

/**
 * Classify ONE tyre record.
 * @param tyre  { id, country, cost, date (issue/fitment), size, brand, serial }
 * @param ctx   { ownLines: lines on the tyre's own job card (any bucket),
 *                priceIndex, backfillSource ('comparable'|'own_jobcard'|null),
 *                warrantyClaim: boolean (a warranty_claims record exists),
 *                duplicatePrice: boolean (same strong serial priced on another row) }
 */
export function classifyTyre(tyre = {}, ctx = {}) {
  const cost = tyre.cost == null || tyre.cost === '' ? null : Number(tyre.cost)
  const month = monthKey(tyre.date)
  const own = (ctx.ownLines || []).map((l) => ({ ...l, kind: lineKind(l.description), month: monthKey(l.date) }))
  const tyreLines = own.filter((l) => ['tyre', 'mixed', 'warranty'].includes(l.kind))

  if (cost != null && !Number.isFinite(cost)) return finding('invalid_cost', { reasons: ['cost is not a number'] })
  if (cost != null && cost < 0) return finding('invalid_cost', { reasons: [`negative cost ${cost}`] })

  // Warranty: proven by a claim record or warranty wording on the tyre's own line. Never repriced.
  if (ctx.warrantyClaim || own.some((l) => l.kind === 'warranty')) {
    return finding('excluded_warranty', { reasons: [ctx.warrantyClaim ? 'warranty claim record' : 'warranty wording on its own job card line'] })
  }

  if (cost != null && cost > 0) {
    if (ctx.duplicatePrice) return finding('duplicate_price', { reasons: ['the same strong serial carries a purchase price on another row'] })
    if (ctx.backfillSource === 'comparable') {
      return finding('priced_estimate_not_verified', { proposed: null, confidence: 'high', reasons: ['price came from a median of other tyres of the same brand and size in earlier months, not from this tyre\'s transaction'] })
    }
    const p = tyreLines.filter((l) => l.kind === 'tyre').map((l) => ({ l, p: unitPrice(l.value, l.qty) })).filter((x) => x.p != null)
    if (!p.length) return finding('priced_no_source', { reasons: ['no tyre line on its job card to confirm the price'] })
    if (p.some((x) => Math.abs(x.p - cost) <= Math.max(0.01, cost * 0.005))) return finding('priced_verified', { reasons: ['matches its own job card line'] })
    return finding('priced_unreconciled', { reasons: [`stored ${cost} vs own line ${p.map((x) => x.p).join(', ')}`] })
  }

  // ── cost missing (null) or zero: never assume either is correct ──
  const reasons = [cost === 0 ? 'cost recorded as 0 with no warranty evidence' : 'no cost recorded']
  if (tyreLines.some((l) => l.kind === 'mixed')) return finding('mixed_tyre_tube', { reasons: [...reasons, 'its job card line combines tyre and tube'] })

  const priced = tyreLines.filter((l) => l.kind === 'tyre' && unitPrice(l.value, l.qty) != null)
  const items = new Set(priced.map((l) => normItemCode(l.itemCode)).filter(Boolean))
  const sameMonth = priced.filter((l) => l.month && l.month === month)
  const sameMonthPrices = new Set(sameMonth.map((l) => unitPrice(l.value, l.qty)))

  if (items.size > 1 || sameMonthPrices.size > 1) {
    return finding('conflict', { reasons: [...reasons, `job card has ${items.size} tyre item codes and ${sameMonthPrices.size} prices this month`] })
  }
  if (sameMonth.length) {
    const l = sameMonth[0]
    const spec = specCheck(tyre, l.description)
    if (!spec.ok) return finding('spec_mismatch', { reasons: [...reasons, ...spec.reasons] })
    return finding('exact_match', {
      proposed: unitPrice(l.value, l.qty), confidence: spec.checked ? 'high' : 'medium',
      source: { kind: 'own_jobcard_line', id: l.id ?? null, itemCode: normItemCode(l.itemCode), month },
      reasons: [...reasons, `own job card line ${normItemCode(l.itemCode) || '(no item code)'} in ${month}, value / qty`, spec.checked ? 'size/brand consistent' : 'size/brand not recorded, could not cross-check'],
    })
  }
  if (priced.length) return finding('month_mismatch', { reasons: [...reasons, `own line is in ${priced[0].month}, tyre is in ${month}; cross-month prices are not used`] })

  // Own tyre line exists but carries no price: search the SAME item code in the SAME month.
  const zeroLines = tyreLines.filter((l) => l.kind === 'tyre')
  const codes = [...new Set(zeroLines.map((l) => normItemCode(l.itemCode)).filter(Boolean))]
  if (codes.length === 1 && month) {
    const hit = lookupSameMonth(ctx.priceIndex, tyre.country, codes[0], month)
    if (hit.status === 'conflict') return finding('conflict', { reasons: [...reasons, `item ${codes[0]} has ${hit.prices.length} different prices in ${month}: ${hit.prices.join(', ')}`] })
    if (hit.status === 'one') {
      const spec = specCheck(tyre, zeroLines[0].description)
      if (!spec.ok) return finding('spec_mismatch', { reasons: [...reasons, ...spec.reasons] })
      return finding('same_month_item_match', {
        proposed: hit.price, confidence: 'medium',
        source: { kind: 'same_item_same_month', id: hit.sourceId, itemCode: codes[0], month },
        reasons: [...reasons, `own line ${codes[0]} was issued at zero; same item code priced ${hit.price} in ${month}`],
      })
    }
    return finding('zero_line_uncertain', { reasons: [...reasons, `own line ${codes[0]} issued at zero and no same-month price for that item`] })
  }
  if (zeroLines.length) return finding('zero_line_uncertain', { reasons: [...reasons, 'own tyre line issued at zero'] })
  return finding('unresolved', { reasons: [...reasons, tyre.jobCard ? 'its job card has no tyre line' : 'no job card to trace'] })
}

/** Totals for the dashboard; money is per currency, never added across currencies. */
export function summarizeFindings(findings = []) {
  const byClass = {}
  const proposed = {}
  let checked = 0
  for (const f of findings) {
    checked++
    byClass[f.class] = (byClass[f.class] || 0) + 1
    if (f.proposed != null) {
      const c = f.currency || 'UNKNOWN'
      proposed[c] = Math.round(((proposed[c] || 0) + Number(f.proposed)) * 100) / 100
    }
  }
  return {
    checked,
    byClass,
    warrantyExcluded: byClass.excluded_warranty || 0,
    missingNonWarranty: Object.entries(byClass).filter(([k]) => ['exact_match', 'same_month_item_match', 'conflict', 'month_mismatch', 'zero_line_uncertain', 'mixed_tyre_tube', 'spec_mismatch', 'unresolved'].includes(k)).reduce((a, [, n]) => a + n, 0),
    recoverable: (byClass.exact_match || 0) + (byClass.same_month_item_match || 0),
    conflicts: byClass.conflict || 0,
    unresolved: (byClass.unresolved || 0) + (byClass.zero_line_uncertain || 0) + (byClass.month_mismatch || 0),
    proposedByCurrency: proposed,
  }
}

/** A proposal may be applied without a second look only when it is high confidence. */
export function canAutoApprove(f) {
  return (f?.class === 'exact_match' && f.confidence === 'high')
}

/** Display a tyre cost: unknown is never shown as 0. */
export function costDisplay(cost, fmt = (n) => String(n)) {
  const n = num(cost)
  return n == null ? COST_PENDING_LABEL : fmt(n)
}

/**
 * Import preview: Uploaded price -> Proposed price -> Matching source -> Validation result -> Action.
 * rows: { line, description, itemCode, date, qty, value, currency, size, brand, warranty }
 * opts: { priceIndex, country, currency, seenKeys:Set (dedupe within the file) }
 */
export function validateUploadRows(rows = [], opts = {}) {
  const seen = new Set()
  return rows.map((r, i) => {
    const issues = []    // block the row
    const warnings = []  // shown, row still imports (returns and reversals are real money)
    const kind = lineKind(r.description)
    const bucket = costBucket(kind)
    const date = monthKey(r.date)
    const qty = num(r.qty)
    const value = num(r.value)
    const item = normItemCode(r.itemCode)
    if (!date) issues.push('missing or invalid date')
    if (!item) (bucket === 'tyre' ? issues : warnings).push('missing item code')
    if (qty == null || qty === 0) (bucket === 'tyre' ? issues : warnings).push('quantity must be above 0')
    if (qty != null && qty < 0) warnings.push('negative quantity (return or reversal)')
    if (value != null && value < 0) warnings.push('negative value (return or reversal)')
    if (opts.currency && r.currency && str(r.currency).toUpperCase() !== str(opts.currency).toUpperCase()) issues.push(`currency ${r.currency} does not match ${opts.currency}`)
    const key = [item, date, qty, value, str(r.jobCard), str(r.serial)].join('|')
    const dup = seen.has(key); seen.add(key)
    if (dup) issues.push('duplicate of an earlier row in this file')

    let proposed = null, source = null, result = 'valid', action = 'Import'
    const uploadedUnit = unitPrice(value, qty)
    if (kind === 'mixed') { result = 'review'; action = 'Split into tyre and tube lines' }
    else if (kind === 'warranty' || r.warranty === true) { result = 'warranty'; action = 'Import as warranty (no price recovery)' }
    else if (bucket === 'tyre' && uploadedUnit == null) {
      const hit = lookupSameMonth(opts.priceIndex, opts.country, item, date)
      if (hit.status === 'one') { proposed = hit.price; source = `Same item ${item} in ${date}`; result = 'price_proposed'; action = 'Approve proposed price or enter the real price' }
      else if (hit.status === 'conflict') { result = 'review'; source = `Prices ${hit.prices.join(', ')} in ${date}`; action = 'Choose the correct price' }
      else { result = 'cost_pending'; action = `Import as ${COST_PENDING_LABEL}` }
    }
    if (issues.length) { result = dup ? 'duplicate' : 'invalid'; action = dup ? 'Skip duplicate' : 'Correct the row' }
    return {
      row: r.line ?? i + 1, kind, bucket, uploaded: uploadedUnit ?? (value === 0 ? 0 : null),
      proposed, source, result, action, issues, warnings,
    }
  })
}

/** Reconciliation for an import: tyre vs spare vs service totals preserve the file total. */
export function importReconciliation(rows = []) {
  const totals = { tyre: 0, spare: 0, service: 0, repair: 0, warranty: 0, mixed: 0 }
  let fileTotal = 0
  for (const r of rows) {
    const v = num(r.value) ?? 0
    fileTotal += v
    totals[costBucket(lineKind(r.description))] += v
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0)
  const round = (n) => Math.round(n * 100) / 100
  return { totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)])), fileTotal: round(fileTotal), reconciles: Math.abs(sum - fileTotal) < 0.005 }
}
