/**
 * Inventory valuation engine (pure, no I/O, no supabase).
 *
 * Contract: docs/inventory/07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md
 * Rules:    docs/inventory/20_VALUATION_RULES.md
 *
 * What this answers: "what is the stock on the shelf worth" (balance sheet view).
 * It NEVER answers "what did maintenance cost" - that is parts_consumption (the ERP
 * expense grid) and nothing here may ever be summed into a cost reader, CPK or
 * cost per m3. Inventory never creates accounting postings (owner rule 6).
 *
 * Method:
 *   - Perpetual weighted average cost (WAC) per balance key
 *     (org, country, location, item, condition, ownership, owner_supplier_id),
 *     in that balance's own currency.
 *   - Serial-tracked tyres: specific identification (each tyre keeps its own
 *     purchase price; see tyreStockValuation()).
 *   - A unit whose cost is unknown is UNVALUED, never 0. It is tracked in its own
 *     bucket (unvaluedQty) so the valued part keeps an honest average.
 *   - Owner decision 2026-11-20 (binding): unpriced units are NEVER consumed first.
 *     An outbound movement takes valued units first at the weighted average, and
 *     only the quantity the valued bucket cannot cover leaves as UNVALUED. That
 *     unvalued part carries no invented cost; it raises a cost reconciliation
 *     (inventory_cost_reconciliations) and only an approved reconciliation can
 *     turn it into a known value (reconcileCost below).
 *   - Physical stock can never go negative (owner rule 1, no override). A movement
 *     that would do so is refused, the balance is returned unchanged.
 *   - Currencies are never blended. A movement in another currency is refused.
 */

// ---------------------------------------------------------------------------
// Shared numeric helpers (null-preserving: Number(null) is 0, so never use it raw)
// ---------------------------------------------------------------------------

/** Null-preserving number: '' / null / undefined / NaN / Infinity -> null. */
export function num(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/** Round money to 2 dp without binary drift (half away from zero). */
export function roundMoney(v) {
  const n = num(v)
  if (n === null) return null
  const r = Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
  return n < 0 ? -r : r
}

/** Round a unit cost to 4 dp. */
export function roundUnit(v) {
  const n = num(v)
  if (n === null) return null
  const r = Math.round((Math.abs(n) + Number.EPSILON) * 10000) / 10000
  return n < 0 ? -r : r
}

const QTY_EPS = 1e-9
const isZero = (n) => Math.abs(n) < QTY_EPS
const normCurrency = (c) => {
  const s = String(c ?? '').trim().toUpperCase()
  return s || null
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const OWNERSHIP = Object.freeze(['owned', 'consignment', 'supplier'])

/**
 * Every movement type the engine values, and what it does to quantity and value.
 * `qty`: +1 inbound, -1 outbound, 0 value-only. Kept in sync with the table in
 * docs/inventory/20_VALUATION_RULES.md.
 */
export const MOVEMENT_TYPES = Object.freeze({
  opening: { qty: +1, label: 'Opening balance (approved batch)' },
  receipt: { qty: +1, label: 'Goods receipt' },
  issue: { qty: -1, label: 'Issue to work / asset' },
  issue_return: { qty: +1, label: 'Return from work to stock' },
  transfer_out: { qty: -1, label: 'Transfer out (cost carried)' },
  transfer_in: { qty: +1, label: 'Transfer in (carried cost)' },
  supplier_return: { qty: -1, label: 'Return to supplier' },
  supplier_credit: { qty: 0, label: 'Supplier price credit (value only)' },
  landed_cost: { qty: 0, label: 'Landed cost allocation (value only)' },
  cost_assignment: { qty: 0, label: 'Cost assigned to unvalued units (approved cost reconciliation only)' },
  adjustment_up: { qty: +1, label: 'Approved count adjustment (gain)' },
  adjustment_down: { qty: -1, label: 'Approved count adjustment (loss)' },
  scrap: { qty: -1, label: 'Scrap / write-off' },
  reversal: { qty: null, label: 'Reversal of an earlier movement' },
})

// ---------------------------------------------------------------------------
// Balance state
// ---------------------------------------------------------------------------

/**
 * A fresh balance. `valuedQty` + `valuedValue` carry the weighted average;
 * `unvaluedQty` holds units whose cost is not known (never priced at 0).
 */
export function emptyBalance({ currency = null, ownership = 'owned', ownerSupplierId = null, agreedUnitPrice = null } = {}) {
  return {
    currency: normCurrency(currency),
    ownership: OWNERSHIP.includes(ownership) ? ownership : 'owned',
    ownerSupplierId: ownerSupplierId ?? null,
    agreedUnitPrice: num(agreedUnitPrice),
    valuedQty: 0,
    valuedValue: 0,
    unvaluedQty: 0,
    lastReceiptAt: null,
    lastIssueAt: null,
  }
}

/** Total physical quantity of a balance. */
export function onHand(balance) {
  return (num(balance?.valuedQty) ?? 0) + (num(balance?.unvaluedQty) ?? 0)
}

/** Weighted average unit cost of the valued part; null when nothing is valued. */
export function averageCost(balance) {
  const q = num(balance?.valuedQty) ?? 0
  if (q <= QTY_EPS) return null
  return roundUnit((num(balance.valuedValue) ?? 0) / q)
}

/** 'valued' | 'partially_valued' | 'unvalued' | 'empty'. */
export function valuationStatus(balance) {
  const v = num(balance?.valuedQty) ?? 0
  const u = num(balance?.unvaluedQty) ?? 0
  if (v <= QTY_EPS && u <= QTY_EPS) return 'empty'
  if (u <= QTY_EPS) return 'valued'
  if (v <= QTY_EPS) return 'unvalued'
  return 'partially_valued'
}

const refuse = (balance, reason, detail = {}) => ({
  ok: false,
  reason,
  ...detail,
  balance,
  qtyChange: 0,
  valueChange: 0,
  valuationStatus: 'refused',
})

const done = (balance, extra) => ({ ok: true, balance, variance: null, consignmentConsumption: null, reconciliation: null, ...extra })

// Take `qty` out of a balance. Valued units go first at the weighted average
// (owner decision 2026-11-20: never consume unpriced units first, never invent
// a proportional cost); only the remainder the valued bucket cannot cover
// leaves as unvalued and needs a cost reconciliation.
// Returns { next, valueOut (null when no valued unit left), valuedOut, unvaluedOut, unitCost }.
function takeOut(balance, qty, at) {
  const valuedOut = Math.min(balance.valuedQty, qty)
  const unvaluedOut = qty - valuedOut
  const avg = averageCost(balance)
  let valueOut = 0
  const next = { ...balance, unvaluedQty: balance.unvaluedQty - unvaluedOut }
  if (valuedOut > QTY_EPS) {
    if (isZero(valuedOut - balance.valuedQty)) {
      // last valued units leave: take the whole remaining value (no rounding residue)
      valueOut = balance.valuedValue
      next.valuedQty = 0
      next.valuedValue = 0
    } else {
      valueOut = roundMoney(valuedOut * (balance.valuedValue / balance.valuedQty))
      next.valuedQty = balance.valuedQty - valuedOut
      next.valuedValue = roundMoney(balance.valuedValue - valueOut)
    }
  }
  if (isZero(next.unvaluedQty)) next.unvaluedQty = 0
  if (at) next.lastIssueAt = at
  return {
    next,
    valueOut: valuedOut > QTY_EPS ? roundMoney(valueOut) : null,
    valuedOut,
    unvaluedOut,
    unitCost: avg,
  }
}

function putIn(balance, qty, unitCost, at) {
  const cost = num(unitCost)
  const next = { ...balance }
  if (cost === null || cost < 0) {
    next.unvaluedQty = balance.unvaluedQty + qty
    if (at) next.lastReceiptAt = at
    return { next, valueIn: null }
  }
  const valueIn = roundMoney(qty * cost)
  next.valuedQty = balance.valuedQty + qty
  next.valuedValue = roundMoney(balance.valuedValue + valueIn)
  if (at) next.lastReceiptAt = at
  return { next, valueIn }
}

function movementStatus(valuePart, unvaluedPart) {
  if (unvaluedPart > QTY_EPS && valuePart === null) return 'unvalued'
  if (unvaluedPart > QTY_EPS) return 'partially_valued'
  return 'valued'
}

/**
 * Apply one movement to a balance. Pure: never mutates the input.
 *
 * movement = {
 *   type,                 // a MOVEMENT_TYPES key
 *   qty,                  // positive magnitude (ignored for value-only types)
 *   unitCost,             // receipt / opening / issue_return / transfer_in / adjustment_up override
 *   currency,             // must equal the balance currency once set
 *   value,                // value-only types: landed_cost / supplier_credit amount
 *   creditUnitCost,       // supplier_return: price the supplier credits
 *   original,             // reversal: the original movement result { type, qtyChange, valueChange, unvaluedQtyChange }
 *   at,                   // ISO timestamp (effective_at)
 * }
 *
 * Returns { ok, reason?, balance, qtyChange, valueChange, unvaluedQtyChange,
 *           unitCostApplied, valuationStatus, variance?, consignmentConsumption? }.
 * valueChange is signed (+ in, - out); null means "no known value moved".
 */
export function applyMovement(balance, movement) {
  const b = balance ? { ...balance } : emptyBalance({ currency: movement?.currency })
  const m = movement || {}
  const type = m.type
  const spec = MOVEMENT_TYPES[type]
  if (!spec) return refuse(b, 'unknown_movement_type', { type })

  const cur = normCurrency(m.currency)
  if (cur && b.currency && cur !== b.currency) {
    return refuse(b, 'currency_mismatch', { balanceCurrency: b.currency, movementCurrency: cur })
  }
  if (cur && !b.currency) b.currency = cur

  if (type === 'reversal') return reverseMovement(b, m.original, m.at)

  if (spec.qty === 0) return valueOnly(b, m)

  const qty = num(m.qty)
  if (qty === null || qty <= 0) return refuse(b, 'invalid_quantity', { qty: m.qty })

  if (spec.qty > 0) {
    let unitCost = num(m.unitCost)
    if (type === 'issue_return' && unitCost === null) unitCost = averageCost(b)
    if (type === 'adjustment_up' && unitCost === null) unitCost = averageCost(b)
    const { next, valueIn } = putIn(b, qty, unitCost, m.at)
    return done(next, {
      qtyChange: qty,
      valueChange: valueIn,
      unvaluedQtyChange: valueIn === null ? qty : 0,
      valuedQty: valueIn === null ? 0 : qty,
      unvaluedQty: valueIn === null ? qty : 0,
      unitCostApplied: valueIn === null ? null : roundUnit(unitCost),
      valuationStatus: valueIn === null ? 'unvalued' : 'valued',
      reconciliation: valueIn === null ? { required: true, qty, consumed: false, kind: 'unpriced_inbound' } : null,
    })
  }

  // outbound
  const have = onHand(b)
  if (qty - have > QTY_EPS) {
    // Owner rule 1: no negative physical stock, no override. The shortage is a
    // separate exception record, never a negative balance.
    return refuse(b, 'insufficient_stock', { onHand: have, requested: qty, shortage: qty - have })
  }
  const out = takeOut(b, qty, m.at)
  const result = done(out.next, {
    qtyChange: -qty,
    valueChange: out.valueOut === null ? null : -out.valueOut,
    unvaluedQtyChange: -out.unvaluedOut,
    valuedQty: out.valuedOut,
    unvaluedQty: out.unvaluedOut,
    unitCostApplied: out.unitCost,
    valuationStatus: movementStatus(out.valueOut, out.unvaluedOut),
    // The unvalued part keeps no invented cost; it opens a cost reconciliation.
    // A transfer leg moves the open reconciliation with the units instead of
    // creating a second one (see transfer()).
    reconciliation: out.unvaluedOut > QTY_EPS
      ? { required: true, qty: out.unvaluedOut, consumed: type !== 'transfer_out', kind: type === 'transfer_out' ? 'transfer' : 'consumed' }
      : null,
  })

  if (type === 'supplier_return') {
    const credit = num(m.creditUnitCost)
    if (credit !== null && out.valueOut !== null) {
      // Difference between what the supplier credits and the book value leaving is
      // a purchase price variance. Reported, never added to stock value.
      const variance = roundMoney(credit * out.valuedOut - out.valueOut)
      result.variance = { kind: 'supplier_return_price_variance', amount: variance, currency: b.currency }
    }
  }
  if (b.ownership === 'consignment' && type === 'issue') {
    // Ownership passes on issue. Informational record for invoice matching only:
    // inventory never creates a liability or a posting (owner rule 6).
    result.consignmentConsumption = {
      supplierId: b.ownerSupplierId,
      qty,
      agreedUnitPrice: b.agreedUnitPrice,
      agreedValue: b.agreedUnitPrice === null ? null : roundMoney(qty * b.agreedUnitPrice),
      currency: b.currency,
      note: 'For supplier invoice matching only - not an accounting posting.',
    }
  }
  return result
}

function valueOnly(b, m) {
  const type = m.type
  if (type === 'cost_assignment') {
    // Give a known cost to units that arrived unvalued (e.g. invoice now known).
    const qty = num(m.qty)
    const cost = num(m.unitCost)
    if (qty === null || qty <= 0) return refuse(b, 'invalid_quantity', { qty: m.qty })
    if (cost === null || cost < 0) return refuse(b, 'invalid_unit_cost', { unitCost: m.unitCost })
    if (qty - b.unvaluedQty > QTY_EPS) return refuse(b, 'exceeds_unvalued_qty', { unvaluedQty: b.unvaluedQty })
    const value = roundMoney(qty * cost)
    const next = {
      ...b,
      unvaluedQty: isZero(b.unvaluedQty - qty) ? 0 : b.unvaluedQty - qty,
      valuedQty: b.valuedQty + qty,
      valuedValue: roundMoney(b.valuedValue + value),
    }
    return done(next, { qtyChange: 0, valueChange: value, unvaluedQtyChange: -qty, unitCostApplied: roundUnit(cost), valuationStatus: 'valued' })
  }

  const amount = num(m.value)
  if (amount === null || amount < 0) return refuse(b, 'invalid_value', { value: m.value })
  const sign = type === 'landed_cost' ? +1 : -1

  if (b.valuedQty <= QTY_EPS) {
    // Nothing valued left on the shelf to carry it (already issued or never valued):
    // the whole amount is a variance against consumed stock, not inventory value.
    return done(b, {
      qtyChange: 0,
      valueChange: 0,
      unvaluedQtyChange: 0,
      unitCostApplied: null,
      valuationStatus: 'valued',
      variance: { kind: `${type}_on_consumed_stock`, amount: roundMoney(sign * amount), currency: b.currency },
    })
  }

  if (sign > 0) {
    const next = { ...b, valuedValue: roundMoney(b.valuedValue + amount) }
    return done(next, { qtyChange: 0, valueChange: roundMoney(amount), unvaluedQtyChange: 0, unitCostApplied: null, valuationStatus: 'valued' })
  }
  // supplier credit cannot make stock value negative; the excess is a variance
  const applied = Math.min(amount, b.valuedValue)
  const next = { ...b, valuedValue: roundMoney(b.valuedValue - applied) }
  const excess = roundMoney(amount - applied)
  return done(next, {
    qtyChange: 0,
    valueChange: -roundMoney(applied),
    unvaluedQtyChange: 0,
    unitCostApplied: null,
    valuationStatus: 'valued',
    variance: excess > 0 ? { kind: 'supplier_credit_exceeds_stock_value', amount: -excess, currency: b.currency } : null,
  })
}

/**
 * Reverse an earlier movement exactly (quantity, valued value and unvalued qty).
 * A reversal that would push stock negative is refused (the original's units are
 * gone). Residual value left on a zero-quantity balance, or a negative value, is
 * moved to a variance rather than carried as stock value.
 */
function reverseMovement(b, original, at) {
  if (!original || num(original.qtyChange) === null) return refuse(b, 'missing_original_movement')
  const qtyChange = -num(original.qtyChange)
  const unvaluedChange = -(num(original.unvaluedQtyChange) ?? 0)
  const valueChange = original.valueChange === null || original.valueChange === undefined ? 0 : -num(original.valueChange)
  const valuedQtyChange = qtyChange - unvaluedChange

  const next = {
    ...b,
    valuedQty: b.valuedQty + valuedQtyChange,
    unvaluedQty: b.unvaluedQty + unvaluedChange,
    valuedValue: roundMoney(b.valuedValue + valueChange),
  }
  if (next.valuedQty < -QTY_EPS || next.unvaluedQty < -QTY_EPS) {
    return refuse(b, 'insufficient_stock', { onHand: onHand(b), requested: -qtyChange })
  }
  if (isZero(next.valuedQty)) next.valuedQty = 0
  if (isZero(next.unvaluedQty)) next.unvaluedQty = 0

  let variance = null
  if (next.valuedQty === 0 && next.valuedValue !== 0) {
    variance = { kind: 'reversal_residual', amount: next.valuedValue, currency: b.currency }
    next.valuedValue = 0
  } else if (next.valuedValue < 0) {
    variance = { kind: 'reversal_negative_value', amount: next.valuedValue, currency: b.currency }
    next.valuedValue = 0
  }
  if (at) next.lastMovementAt = at
  return done(next, {
    qtyChange,
    valueChange: roundMoney(next.valuedValue - b.valuedValue),
    unvaluedQtyChange: unvaluedChange,
    unitCostApplied: null,
    valuationStatus: 'valued',
    variance,
    reversedType: original.type ?? null,
  })
}

/**
 * Transfer between two balances of the same currency. The issuing location's
 * average travels with the units (transfer carries cost); unvalued units stay
 * unvalued at the destination. Refused across currencies (needs approved FX).
 */
export function transfer(source, destination, qty, { at = null } = {}) {
  const src = source || emptyBalance()
  const dst = destination || emptyBalance({ currency: src.currency })
  if (src.currency && dst.currency && src.currency !== dst.currency) {
    return { ok: false, reason: 'cross_currency_transfer', source: src, destination: dst }
  }
  const out = applyMovement(src, { type: 'transfer_out', qty, at })
  if (!out.ok) return { ok: false, reason: out.reason, ...out, source: src, destination: dst }
  const unvaluedMoved = -out.unvaluedQtyChange
  const valuedMoved = num(qty) - unvaluedMoved
  let nextDst = { ...dst, currency: dst.currency || src.currency }
  let valueIn = 0
  if (valuedMoved > QTY_EPS) {
    nextDst = {
      ...nextDst,
      valuedQty: nextDst.valuedQty + valuedMoved,
      valuedValue: roundMoney(nextDst.valuedValue - (out.valueChange ?? 0)),
    }
    valueIn = -(out.valueChange ?? 0)
  }
  if (unvaluedMoved > QTY_EPS) nextDst = { ...nextDst, unvaluedQty: nextDst.unvaluedQty + unvaluedMoved }
  if (at) nextDst.lastReceiptAt = at
  return {
    ok: true,
    source: out.balance,
    destination: nextDst,
    qty: num(qty),
    carriedUnitCost: out.unitCostApplied,
    valueMoved: roundMoney(valueIn),
    unvaluedQtyMoved: unvaluedMoved,
    // Unvalued units travel with their open reconciliation (one record, never two).
    reconciliation: unvaluedMoved > QTY_EPS ? { required: true, qty: unvaluedMoved, consumed: false, kind: 'transfer' } : null,
  }
}

// ---------------------------------------------------------------------------
// Cost reconciliation (mirror of inv_cost_reconcile, docs/inventory/20 section 4)
// ---------------------------------------------------------------------------

export const RECONCILIATION_STATUSES = Object.freeze(['open', 'resolved', 'written_off', 'cancelled'])

/**
 * Resolve one open cost reconciliation. Nothing becomes valued without it.
 *
 * reconciliation = { status, qty, consumed, createdBy, proposedBy }
 * decision = { resolution: 'resolved' | 'written_off', unitCost, approved, approvedBy, resolvedBy }
 *
 * - Refused unless the matching approval is approved, the resolver is not the
 *   creator, and the approver is neither the creator nor the preparer.
 * - written_off: the units stay unvalued for good (the cost is accepted as
 *   unknowable); no value is invented.
 * - resolved + consumed (the units already left in an issue, scrap, ...):
 *   the consumption value becomes known (`recognisedValue`); the shelf balance
 *   does not change because the units are no longer there.
 * - resolved + in stock: a cost_assignment values min(qty, unvalued on the
 *   balance) units; anything the balance no longer holds is `notAppliedQty`.
 */
export function reconcileCost(balance, reconciliation = {}, decision = {}) {
  const b = balance || emptyBalance()
  const rec = reconciliation || {}
  const d = decision || {}
  const no = (reason) => ({ ok: false, reason, balance: b })
  if ((rec.status ?? 'open') !== 'open') return no('not_open')
  if (!d.approved) return no('approval_required')
  if (d.resolvedBy && rec.createdBy && d.resolvedBy === rec.createdBy) return no('segregation_of_duties')
  if (d.approvedBy && (d.approvedBy === rec.createdBy || d.approvedBy === rec.proposedBy)) return no('segregation_of_duties')
  const qty = num(rec.qty)
  if (qty === null || qty <= 0) return no('invalid_quantity')
  if (d.resolution === 'written_off') {
    return { ok: true, status: 'written_off', balance: b, recognisedValue: null, appliedQty: 0, notAppliedQty: qty }
  }
  if (d.resolution !== 'resolved') return no('invalid_resolution')
  const cost = num(d.unitCost)
  if (cost === null || cost < 0) return no('invalid_unit_cost')
  if (rec.consumed) {
    return { ok: true, status: 'resolved', balance: b, recognisedValue: roundMoney(qty * cost), appliedQty: 0, notAppliedQty: 0 }
  }
  const apply = Math.min(qty, num(b.unvaluedQty) ?? 0)
  if (apply <= QTY_EPS) {
    return { ok: true, status: 'resolved', balance: b, recognisedValue: roundMoney(qty * cost), appliedQty: 0, notAppliedQty: qty }
  }
  const r = applyMovement(b, { type: 'cost_assignment', qty: apply, unitCost: cost })
  if (!r.ok) return no(r.reason)
  return {
    ok: true, status: 'resolved', balance: r.balance, recognisedValue: roundMoney(qty * cost),
    appliedQty: apply, notAppliedQty: qty - apply, valueChange: r.valueChange,
  }
}

/** Replay a list of movements from an empty (or given) balance. */
export function replay(movements = [], initial = null) {
  let balance = initial || emptyBalance({ currency: movements.find((m) => m?.currency)?.currency })
  const results = []
  for (const m of movements) {
    const r = applyMovement(balance, m)
    results.push(r)
    if (r.ok) balance = r.balance
  }
  return { balance, results, refused: results.filter((r) => !r.ok) }
}

// ---------------------------------------------------------------------------
// Landed cost allocation
// ---------------------------------------------------------------------------

/**
 * Split a landed cost (freight, duty, clearing) across receipt lines.
 * basis: 'value' (line value), 'qty', or 'weight' (line.weight).
 * Shares are exact to the cent: the rounding remainder goes to the largest line.
 * Lines with no usable basis receive nothing and are listed in `excluded`.
 */
export function allocateLandedCost(lines = [], total, { basis = 'value' } = {}) {
  const amount = num(total)
  if (amount === null || amount < 0) return { ok: false, reason: 'invalid_total', allocations: [] }
  const weightOf = (l) => {
    if (basis === 'qty') return num(l.qty)
    if (basis === 'weight') return num(l.weight)
    const q = num(l.qty)
    const c = num(l.unitCost)
    return q === null || c === null ? null : q * c
  }
  const eligible = []
  const excluded = []
  lines.forEach((l, i) => {
    const w = weightOf(l)
    if (w === null || w <= 0) excluded.push({ index: i, id: l?.id ?? null, reason: `no_${basis}` })
    else eligible.push({ index: i, id: l?.id ?? null, w, qty: num(l.qty) })
  })
  const sumW = eligible.reduce((s, e) => s + e.w, 0)
  if (!eligible.length || sumW <= 0) return { ok: false, reason: 'no_allocation_basis', allocations: [], excluded }
  const cents = Math.round(amount * 100)
  let allocated = 0
  const allocations = eligible.map((e) => {
    const c = Math.floor((cents * e.w) / sumW)
    allocated += c
    return { ...e, cents: c }
  })
  const remainder = cents - allocated
  if (remainder !== 0) {
    const biggest = allocations.reduce((a, b) => (b.w > a.w ? b : a))
    biggest.cents += remainder
  }
  return {
    ok: true,
    basis,
    excluded,
    allocations: allocations.map((a) => ({
      index: a.index,
      id: a.id,
      amount: a.cents / 100,
      perUnit: a.qty && a.qty > 0 ? roundUnit(a.cents / 100 / a.qty) : null,
    })),
  }
}

// ---------------------------------------------------------------------------
// Summaries (per currency, never blended)
// ---------------------------------------------------------------------------

/**
 * Summarise balance rows. Each row: { item_id, location_id, currency, ownership,
 * owner_supplier_id, valuedQty, valuedValue, unvaluedQty, agreedUnitPrice }.
 * Returns { byCurrency: { SAR: {...}, AED: {...} }, currencies, mixedCurrency,
 *           noCurrency: {...} }.
 * Owned value is reported with its completeness; consignment is shown at the
 * agreed price, separately; supplier-custody stock is quantity only.
 */
export function summarizeValuation(rows = []) {
  const byCurrency = {}
  const noCurrency = { lines: 0, qty: 0 }
  const blank = () => ({
    owned: { lines: 0, valuedLines: 0, unvaluedLines: 0, partiallyValuedLines: 0, valuedQty: 0, unvaluedQty: 0, valuedValue: 0 },
    consignment: { lines: 0, qty: 0, agreedValue: 0, unpricedLines: 0 },
    supplier: { lines: 0, qty: 0 },
  })
  for (const r of rows) {
    const qtyV = num(r.valuedQty) ?? 0
    const qtyU = num(r.unvaluedQty) ?? 0
    const qty = qtyV + qtyU
    if (qty <= QTY_EPS) continue
    const cur = normCurrency(r.currency)
    const ownership = OWNERSHIP.includes(r.ownership) ? r.ownership : 'owned'
    if (!cur && ownership !== 'supplier') {
      noCurrency.lines += 1
      noCurrency.qty += qty
      continue
    }
    const key = cur || 'N/A'
    const s = (byCurrency[key] ||= blank())
    if (ownership === 'owned') {
      s.owned.lines += 1
      s.owned.valuedQty += qtyV
      s.owned.unvaluedQty += qtyU
      s.owned.valuedValue = roundMoney(s.owned.valuedValue + (num(r.valuedValue) ?? 0))
      const st = valuationStatus(r)
      if (st === 'valued') s.owned.valuedLines += 1
      else if (st === 'unvalued') s.owned.unvaluedLines += 1
      else s.owned.partiallyValuedLines += 1
    } else if (ownership === 'consignment') {
      s.consignment.lines += 1
      s.consignment.qty += qty
      const p = num(r.agreedUnitPrice)
      if (p === null) s.consignment.unpricedLines += 1
      else s.consignment.agreedValue = roundMoney(s.consignment.agreedValue + qty * p)
    } else {
      s.supplier.lines += 1
      s.supplier.qty += qty
    }
  }
  for (const s of Object.values(byCurrency)) {
    const o = s.owned
    const totalQty = o.valuedQty + o.unvaluedQty
    o.pricedPct = totalQty > 0 ? Math.round((o.valuedQty / totalQty) * 1000) / 10 : null
    o.complete = o.lines > 0 && o.unvaluedLines === 0 && o.partiallyValuedLines === 0
    // The headline owned value is only a measurement when every line is valued.
    o.value = o.lines === 0 ? null : o.complete ? o.valuedValue : null
    o.valueReason = o.lines === 0 ? 'no_owned_stock' : o.complete ? null : 'unvalued_stock_present'
    // Finance view vocabulary (v_inv_valuation): valuedAmount is the valued PART
    // only and must never be labelled as the total while valuationComplete is false.
    o.valuationComplete = o.complete
    o.valuedAmount = o.valuedValue
    if (s.consignment.lines === 0) s.consignment.agreedValue = null
    else if (s.consignment.unpricedLines > 0) s.consignment.agreedValueComplete = false
  }
  const currencies = Object.keys(byCurrency).filter((c) => c !== 'N/A')
  return { byCurrency, currencies, mixedCurrency: currencies.length > 1, noCurrency }
}

/**
 * Adjustment value from approved count adjustments, per currency.
 * Gross gain and gross loss stay separate; net and absolute are both given
 * (net alone hides offsetting losses). Unvalued adjustments are counted, not zeroed.
 */
export function adjustmentValue(movements = []) {
  const out = {}
  for (const m of movements) {
    if (m?.type !== 'adjustment_up' && m?.type !== 'adjustment_down') continue
    const cur = normCurrency(m.currency) || 'N/A'
    const s = (out[cur] ||= { gain: 0, loss: 0, gainQty: 0, lossQty: 0, unvaluedMovements: 0, movements: 0 })
    s.movements += 1
    const qty = Math.abs(num(m.qtyChange ?? m.qty) ?? 0)
    const v = num(m.valueChange)
    if (m.type === 'adjustment_up') s.gainQty += qty
    else s.lossQty += qty
    if (v === null) {
      s.unvaluedMovements += 1
      continue
    }
    if (m.type === 'adjustment_up') s.gain = roundMoney(s.gain + Math.abs(v))
    else s.loss = roundMoney(s.loss + Math.abs(v))
  }
  for (const s of Object.values(out)) {
    s.net = roundMoney(s.gain - s.loss)
    s.absolute = roundMoney(s.gain + s.loss)
    s.complete = s.unvaluedMovements === 0
  }
  return out
}

// ---------------------------------------------------------------------------
// Ageing, dead / slow / obsolete / excess exposure
// ---------------------------------------------------------------------------

export const AGEING_BUCKETS = Object.freeze([
  { key: '0_90', label: '0-90 days', max: 90 },
  { key: '91_180', label: '91-180 days', max: 180 },
  { key: '181_365', label: '181-365 days', max: 365 },
  { key: 'over_365', label: 'Over 365 days', max: Infinity },
])

const toMs = (d) => {
  if (!d) return null
  const t = d instanceof Date ? d.getTime() : Date.parse(d)
  return Number.isFinite(t) ? t : null
}
const daysBetween = (a, b) => Math.floor((b - a) / 86400000)

/**
 * Age owned stock by days since `basis` ('lastReceiptAt' or 'lastIssueAt').
 * A balance with no date goes to 'unknown', never to the newest bucket.
 * Value per bucket per currency; unvalued qty counted separately.
 */
export function ageingBuckets(rows = [], { now, basis = 'lastReceiptAt' } = {}) {
  const nowMs = toMs(now)
  if (nowMs === null) return { ok: false, reason: 'now_required' }
  const out = {}
  for (const r of rows) {
    if ((r.ownership ?? 'owned') !== 'owned') continue
    const qty = onHand(r)
    if (qty <= QTY_EPS) continue
    const cur = normCurrency(r.currency) || 'N/A'
    const s = (out[cur] ||= Object.fromEntries([...AGEING_BUCKETS.map((b) => b.key), 'unknown'].map((k) => [k, { lines: 0, qty: 0, valuedValue: 0, unvaluedQty: 0 }])))
    const t = toMs(r[basis])
    let key = 'unknown'
    if (t !== null) {
      const d = Math.max(0, daysBetween(t, nowMs))
      key = AGEING_BUCKETS.find((b) => d <= b.max).key
    }
    const bucket = s[key]
    bucket.lines += 1
    bucket.qty += qty
    bucket.valuedValue = roundMoney(bucket.valuedValue + (num(r.valuedValue) ?? 0))
    bucket.unvaluedQty += num(r.unvaluedQty) ?? 0
  }
  return { ok: true, basis, byCurrency: out }
}

/**
 * Dead / slow / obsolete / excess exposure of OWNED stock.
 * row: balance + { itemCreatedAt, itemStatus, maxQty, hasOpenReservation }.
 * options: { now, ledgerStartAt, deadDays=365, slowDays=180 }.
 * - An item created inside the window is 'too_new', not dead.
 * - If the movement ledger is younger than the window the classification is
 *   unknowable: the result is null with reason 'ledger_history_too_short'.
 * - A balance with an open reservation is not dead (demand exists).
 */
export function exposure(rows = [], { now, ledgerStartAt = null, deadDays = 365, slowDays = 180 } = {}) {
  const nowMs = toMs(now)
  if (nowMs === null) return { ok: false, reason: 'now_required' }
  const ledgerMs = toMs(ledgerStartAt)
  const ledgerDays = ledgerMs === null ? null : daysBetween(ledgerMs, nowMs)
  const out = {}
  const lines = []
  for (const r of rows) {
    if ((r.ownership ?? 'owned') !== 'owned') continue
    const qty = onHand(r)
    if (qty <= QTY_EPS) continue
    const cur = normCurrency(r.currency) || 'N/A'
    const s = (out[cur] ||= {
      dead: { lines: 0, qty: 0, valuedValue: 0, unvaluedQty: 0 },
      slow: { lines: 0, qty: 0, valuedValue: 0, unvaluedQty: 0 },
      obsolete: { lines: 0, qty: 0, valuedValue: 0, unvaluedQty: 0 },
      excess: { lines: 0, qty: 0, valuedValue: 0, unvaluedQty: 0, unknownMaxLines: 0 },
      tooNew: { lines: 0 },
      unknown: { lines: 0 },
    })
    const add = (bucket, q = qty, frac = 1) => {
      bucket.lines += 1
      bucket.qty += q
      bucket.valuedValue = roundMoney(bucket.valuedValue + (num(r.valuedValue) ?? 0) * frac)
      bucket.unvaluedQty += (num(r.unvaluedQty) ?? 0) * frac
    }
    const created = toMs(r.itemCreatedAt)
    const ageDays = created === null ? null : daysBetween(created, nowMs)
    const lastIssue = toMs(r.lastIssueAt)
    const sinceIssue = lastIssue === null ? null : daysBetween(lastIssue, nowMs)
    let movement
    if (r.hasOpenReservation) movement = 'active'
    else if (ageDays !== null && ageDays < slowDays) movement = 'too_new'
    else if (sinceIssue !== null) {
      // A real last issue date is evidence on its own.
      movement = sinceIssue < slowDays ? 'active' : sinceIssue < deadDays ? 'slow' : 'dead'
    } else {
      // No issue on record: only provable over the span the ledger actually covers.
      const provable = ledgerDays === null ? 0 : Math.min(ledgerDays, ageDays ?? ledgerDays)
      movement = provable >= deadDays ? 'dead' : provable >= slowDays ? 'slow' : 'unknown'
    }

    if (movement === 'dead') add(s.dead)
    else if (movement === 'slow') add(s.slow)
    else if (movement === 'too_new') s.tooNew.lines += 1
    else if (movement === 'unknown') s.unknown.lines += 1

    if (String(r.itemStatus ?? '').toLowerCase() === 'obsolete') add(s.obsolete)
    const maxQty = num(r.maxQty)
    if (maxQty === null) s.excess.unknownMaxLines += 1
    else if (qty - maxQty > QTY_EPS) add(s.excess, qty - maxQty, (qty - maxQty) / qty)
    lines.push({ item_id: r.item_id ?? null, location_id: r.location_id ?? null, currency: cur, movement, daysSinceIssue: sinceIssue })
  }
  return { ok: true, byCurrency: out, lines, ledgerHistoryDays: ledgerDays }
}

// ---------------------------------------------------------------------------
// Serial-tracked tyres: specific identification
// ---------------------------------------------------------------------------

const TYRE_STOCK_STATES = new Set(['new_stock', 'reserved', 'in_transit', 'quarantine'])
const TYRE_USED_STATES = new Set(['reusable', 'removed_pending', 'under_repair', 'warranty'])

/**
 * Value tyre items by their OWN purchase cost (specific identification).
 * - new / reserved / in-transit / quarantine tyres = stock value.
 * - used tyres (reusable, removed pending, repair, warranty) are listed
 *   separately at original cost and are NOT stock value by default: their
 *   purchase was already consumed into CPK; counting them again would double
 *   count. includeUsed=true adds them for a view that explicitly asks for it.
 * - A tyre with no cost is unvalued (counted), never 0.
 */
export function tyreStockValuation(items = [], { includeUsed = false } = {}) {
  const out = {}
  const blank = () => ({ stock: { tyres: 0, valued: 0, unvalued: 0, value: 0 }, used: { tyres: 0, valued: 0, unvalued: 0, originalCost: 0 } })
  for (const t of items) {
    const state = String(t.custody_state ?? t.state ?? '').toLowerCase()
    const isStock = TYRE_STOCK_STATES.has(state)
    const isUsed = TYRE_USED_STATES.has(state)
    if (!isStock && !isUsed) continue
    const cur = normCurrency(t.currency) || 'N/A'
    const s = (out[cur] ||= blank())
    const cost = num(t.purchase_cost)
    const bucket = isStock ? s.stock : s.used
    bucket.tyres += 1
    if (cost === null || cost <= 0) bucket.unvalued += 1
    else {
      bucket.valued += 1
      if (isStock) bucket.value = roundMoney(bucket.value + cost)
      else bucket.originalCost = roundMoney(bucket.originalCost + cost)
    }
  }
  for (const s of Object.values(out)) {
    s.stock.complete = s.stock.unvalued === 0
    s.stock.reportedValue = s.stock.tyres === 0 ? null : s.stock.complete ? s.stock.value : null
    if (includeUsed) {
      s.totalIncludingUsed = s.stock.unvalued === 0 && s.used.unvalued === 0 ? roundMoney(s.stock.value + s.used.originalCost) : null
    }
  }
  return out
}
