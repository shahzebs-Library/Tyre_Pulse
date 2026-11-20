import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  num, roundMoney, emptyBalance, applyMovement, replay, transfer, onHand, averageCost, valuationStatus,
  allocateLandedCost, summarizeValuation, adjustmentValue, ageingBuckets, exposure, tyreStockValuation, MOVEMENT_TYPES,
  reconcileCost,
} from '../lib/inventory/valuation'

const SAR = (over = {}) => emptyBalance({ currency: 'SAR', ...over })
const step = (b, m) => {
  const r = applyMovement(b, { currency: 'SAR', ...m })
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r
}

describe('num / rounding', () => {
  it('null-preserving: null, blank and NaN are null, never 0', () => {
    expect(num(null)).toBe(null)
    expect(num('')).toBe(null)
    expect(num('abc')).toBe(null)
    expect(num(true)).toBe(null)
    expect(num('1,250.50')).toBe(1250.5)
    expect(num(0)).toBe(0)
  })
  it('rounds money without float drift', () => {
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(-2.345)).toBe(-2.35)
  })
})

describe('perpetual weighted average', () => {
  it('blends receipts and issues at the current average', () => {
    let r = step(SAR(), { type: 'receipt', qty: 10, unitCost: 100 })
    r = step(r.balance, { type: 'receipt', qty: 10, unitCost: 120 })
    expect(averageCost(r.balance)).toBe(110)
    r = step(r.balance, { type: 'issue', qty: 5 })
    expect(r.valueChange).toBe(-550)
    expect(r.unitCostApplied).toBe(110)
    expect(r.balance.valuedValue).toBe(1650)
    expect(onHand(r.balance)).toBe(15)
  })

  it('last issue takes the whole remaining value (no rounding residue)', () => {
    let r = step(SAR(), { type: 'receipt', qty: 3, unitCost: 10 })
    r = step(r.balance, { type: 'receipt', qty: 3, unitCost: 10.01 })
    r = step(r.balance, { type: 'issue', qty: 1 })
    r = step(r.balance, { type: 'issue', qty: 5 })
    expect(r.balance.valuedValue).toBe(0)
    expect(r.balance.valuedQty).toBe(0)
  })

  it('refuses an issue that would make stock negative (no override)', () => {
    const r1 = step(SAR(), { type: 'receipt', qty: 2, unitCost: 50 })
    const r2 = applyMovement(r1.balance, { type: 'issue', qty: 3 })
    expect(r2.ok).toBe(false)
    expect(r2.reason).toBe('insufficient_stock')
    expect(r2.shortage).toBe(1)
    expect(r2.balance).toEqual(r1.balance)
  })

  it('refuses a movement in another currency', () => {
    const r1 = step(SAR(), { type: 'receipt', qty: 1, unitCost: 5 })
    const r2 = applyMovement(r1.balance, { type: 'receipt', qty: 1, unitCost: 5, currency: 'AED' })
    expect(r2.ok).toBe(false)
    expect(r2.reason).toBe('currency_mismatch')
  })

  it('refuses unknown types and bad quantities', () => {
    expect(applyMovement(SAR(), { type: 'teleport', qty: 1 }).reason).toBe('unknown_movement_type')
    expect(applyMovement(SAR(), { type: 'receipt', qty: -1, unitCost: 1 }).reason).toBe('invalid_quantity')
    expect(applyMovement(SAR(), { type: 'receipt', qty: 0, unitCost: 1 }).reason).toBe('invalid_quantity')
  })

  it('every documented movement type exists', () => {
    expect(Object.keys(MOVEMENT_TYPES)).toEqual(expect.arrayContaining([
      'opening', 'receipt', 'issue', 'issue_return', 'transfer_out', 'transfer_in', 'supplier_return',
      'supplier_credit', 'landed_cost', 'cost_assignment', 'adjustment_up', 'adjustment_down', 'scrap', 'reversal',
    ]))
  })
})

describe('unvalued stock is never valued at 0', () => {
  it('a receipt without cost is unvalued', () => {
    const r = step(SAR(), { type: 'receipt', qty: 4 })
    expect(r.valueChange).toBe(null)
    expect(r.valuationStatus).toBe('unvalued')
    expect(averageCost(r.balance)).toBe(null)
    expect(valuationStatus(r.balance)).toBe('unvalued')
  })

  it('mixed balance: valued units leave first; only the uncovered part is unvalued (owner decision)', () => {
    let r = step(SAR(), { type: 'opening', qty: 3 })
    r = step(r.balance, { type: 'receipt', qty: 2, unitCost: 100 })
    expect(valuationStatus(r.balance)).toBe('partially_valued')
    r = step(r.balance, { type: 'issue', qty: 4 })
    expect(r.valuedQty).toBe(2)
    expect(r.unvaluedQty).toBe(2)
    expect(r.unvaluedQtyChange).toBe(-2)
    expect(r.valueChange).toBe(-200) // valued part only; no cost invented for the other 2
    expect(r.valuationStatus).toBe('partially_valued')
    expect(r.reconciliation).toEqual({ required: true, qty: 2, consumed: true, kind: 'consumed' })
    expect(r.balance.unvaluedQty).toBe(1)
    expect(r.balance.valuedQty).toBe(0)
    expect(averageCost(r.balance)).toBe(null)
  })

  it('an issue fully covered by valued units leaves unpriced units untouched', () => {
    let r = step(SAR(), { type: 'opening', qty: 3 })
    r = step(r.balance, { type: 'receipt', qty: 5, unitCost: 10 })
    r = step(r.balance, { type: 'issue', qty: 4 })
    expect(r.unvaluedQty).toBe(0)
    expect(r.valueChange).toBe(-40)
    expect(r.reconciliation).toBe(null)
    expect(r.balance.unvaluedQty).toBe(3)
    expect(averageCost(r.balance)).toBe(10)
  })

  it('issue entirely from unvalued units has null value and needs a reconciliation', () => {
    const r1 = step(SAR(), { type: 'opening', qty: 3 })
    const r2 = step(r1.balance, { type: 'issue', qty: 1 })
    expect(r2.valueChange).toBe(null)
    expect(r2.valuationStatus).toBe('unvalued')
    expect(r2.reconciliation.qty).toBe(1)
  })

  it('an unpriced receipt is flagged for reconciliation, never priced', () => {
    const r = step(SAR(), { type: 'receipt', qty: 4 })
    expect(r.reconciliation).toEqual({ required: true, qty: 4, consumed: false, kind: 'unpriced_inbound' })
    expect(r.unvaluedQty).toBe(4)
  })

  it('cost assignment values units that arrived unpriced', () => {
    let r = step(SAR(), { type: 'opening', qty: 3 })
    r = step(r.balance, { type: 'cost_assignment', qty: 3, unitCost: 40 })
    expect(r.valueChange).toBe(120)
    expect(valuationStatus(r.balance)).toBe('valued')
    expect(applyMovement(r.balance, { type: 'cost_assignment', qty: 1, unitCost: 1 }).reason).toBe('exceeds_unvalued_qty')
  })
})

describe('cost reconciliation (nothing becomes valued without it)', () => {
  const bal = () => step(SAR(), { type: 'opening', qty: 3 }).balance
  const rec = { status: 'open', qty: 3, consumed: false, createdBy: 'u1', proposedBy: 'u2' }
  it('refuses without an approved approval', () => {
    expect(reconcileCost(bal(), rec, { resolution: 'resolved', unitCost: 5, approved: false }).reason).toBe('approval_required')
  })
  it('refuses the creator as resolver and the creator or preparer as approver', () => {
    const d = { resolution: 'resolved', unitCost: 5, approved: true, approvedBy: 'u3' }
    expect(reconcileCost(bal(), rec, { ...d, resolvedBy: 'u1' }).reason).toBe('segregation_of_duties')
    expect(reconcileCost(bal(), rec, { ...d, approvedBy: 'u1', resolvedBy: 'u4' }).reason).toBe('segregation_of_duties')
    expect(reconcileCost(bal(), rec, { ...d, approvedBy: 'u2', resolvedBy: 'u4' }).reason).toBe('segregation_of_duties')
  })
  it('in-stock reconciliation values the units through a cost assignment', () => {
    const r = reconcileCost(bal(), rec, { resolution: 'resolved', unitCost: 5, approved: true, approvedBy: 'u3', resolvedBy: 'u4' })
    expect(r.ok).toBe(true)
    expect(r.appliedQty).toBe(3)
    expect(r.balance.valuedValue).toBe(15)
    expect(valuationStatus(r.balance)).toBe('valued')
  })
  it('consumed reconciliation records the value; the shelf does not change', () => {
    const b = bal()
    const r = reconcileCost(b, { ...rec, consumed: true }, { resolution: 'resolved', unitCost: 5, approved: true, approvedBy: 'u3', resolvedBy: 'u4' })
    expect(r.recognisedValue).toBe(15)
    expect(r.balance).toEqual(b)
  })
  it('write-off never invents a value', () => {
    const r = reconcileCost(bal(), rec, { resolution: 'written_off', approved: true, approvedBy: 'u3', resolvedBy: 'u4' })
    expect(r.recognisedValue).toBe(null)
    expect(r.balance.unvaluedQty).toBe(3)
  })
  it('only an open reconciliation can be resolved', () => {
    expect(reconcileCost(bal(), { ...rec, status: 'resolved' }, { approved: true }).reason).toBe('not_open')
  })
})

describe('returns, credits, landed cost, scrap, adjustments', () => {
  it('issue return comes back at the cost carried, else at current average, else unvalued', () => {
    let r = step(SAR(), { type: 'receipt', qty: 10, unitCost: 10 })
    r = step(r.balance, { type: 'issue_return', qty: 2, unitCost: 13 })
    expect(r.valueChange).toBe(26)
    r = step(r.balance, { type: 'issue_return', qty: 1 })
    expect(r.unitCostApplied).toBe(10.5)
    expect(r.valueChange).toBe(10.5)
    const empty = step(SAR(), { type: 'issue_return', qty: 1 })
    expect(empty.valueChange).toBe(null)
  })

  it('supplier return leaves at average and reports the price variance separately', () => {
    const r1 = step(SAR(), { type: 'receipt', qty: 10, unitCost: 100 })
    const r2 = step(r1.balance, { type: 'supplier_return', qty: 2, creditUnitCost: 90 })
    expect(r2.valueChange).toBe(-200)
    expect(r2.variance).toEqual({ kind: 'supplier_return_price_variance', amount: -20, currency: 'SAR' })
  })

  it('supplier credit reduces value; the excess over stock value is a variance', () => {
    const r1 = step(SAR(), { type: 'receipt', qty: 2, unitCost: 100 })
    const r2 = step(r1.balance, { type: 'supplier_credit', value: 50 })
    expect(r2.valueChange).toBe(-50)
    expect(averageCost(r2.balance)).toBe(75)
    const r3 = step(r2.balance, { type: 'supplier_credit', value: 500 })
    expect(r3.balance.valuedValue).toBe(0)
    expect(r3.variance.amount).toBe(-350)
  })

  it('landed cost raises the average; on consumed stock it is a variance', () => {
    const r1 = step(SAR(), { type: 'receipt', qty: 4, unitCost: 100 })
    const r2 = step(r1.balance, { type: 'landed_cost', value: 40 })
    expect(averageCost(r2.balance)).toBe(110)
    const gone = step(r2.balance, { type: 'issue', qty: 4 })
    const r3 = step(gone.balance, { type: 'landed_cost', value: 40 })
    expect(r3.valueChange).toBe(0)
    expect(r3.variance.kind).toBe('landed_cost_on_consumed_stock')
  })

  it('scrap and count adjustments use current average', () => {
    let r = step(SAR(), { type: 'receipt', qty: 10, unitCost: 20 })
    r = step(r.balance, { type: 'scrap', qty: 1 })
    expect(r.valueChange).toBe(-20)
    r = step(r.balance, { type: 'adjustment_up', qty: 2 })
    expect(r.valueChange).toBe(40)
    r = step(r.balance, { type: 'adjustment_down', qty: 1 })
    expect(r.valueChange).toBe(-20)
  })
})

describe('reversal', () => {
  it('reverses a receipt exactly', () => {
    const a = step(SAR(), { type: 'receipt', qty: 10, unitCost: 100 })
    const b = step(a.balance, { type: 'receipt', qty: 10, unitCost: 120 })
    const rev = step(b.balance, { type: 'reversal', original: { type: 'receipt', ...b } })
    expect(rev.balance.valuedQty).toBe(10)
    expect(rev.balance.valuedValue).toBe(1000)
    expect(rev.reversedType).toBe('receipt')
  })

  it('reverses an issue (units come back at the cost they left at)', () => {
    const a = step(SAR(), { type: 'receipt', qty: 10, unitCost: 100 })
    const iss = step(a.balance, { type: 'issue', qty: 3 })
    const rev = step(iss.balance, { type: 'reversal', original: iss })
    expect(rev.balance).toMatchObject({ valuedQty: 10, valuedValue: 1000 })
  })

  it('refuses a receipt reversal once the units have been issued', () => {
    const a = step(SAR(), { type: 'receipt', qty: 5, unitCost: 10 })
    const iss = step(a.balance, { type: 'issue', qty: 4 })
    const rev = applyMovement(iss.balance, { type: 'reversal', original: a })
    expect(rev.ok).toBe(false)
    expect(rev.reason).toBe('insufficient_stock')
  })

  it('residual value on an emptied balance moves to a variance', () => {
    const a = step(SAR(), { type: 'receipt', qty: 1, unitCost: 100 })
    const lc = step(a.balance, { type: 'landed_cost', value: 10 })
    const rev = step(lc.balance, { type: 'reversal', original: a })
    expect(rev.balance.valuedValue).toBe(0)
    expect(rev.variance).toEqual({ kind: 'reversal_residual', amount: 10, currency: 'SAR' })
  })

  it('needs the original movement', () => {
    expect(applyMovement(SAR(), { type: 'reversal' }).reason).toBe('missing_original_movement')
  })
})

describe('transfer carries cost', () => {
  it('moves units at the source average and blends at destination', () => {
    const src = step(SAR(), { type: 'receipt', qty: 10, unitCost: 50 }).balance
    const dst = step(SAR(), { type: 'receipt', qty: 10, unitCost: 70 }).balance
    const t = transfer(src, dst, 4)
    expect(t.ok).toBe(true)
    expect(t.carriedUnitCost).toBe(50)
    expect(t.valueMoved).toBe(200)
    expect(t.source.valuedValue).toBe(300)
    expect(t.destination.valuedQty).toBe(14)
    expect(averageCost(t.destination)).toBe(64.2857)
  })
  it('keeps unvalued units unvalued at the destination', () => {
    const src = step(SAR(), { type: 'opening', qty: 2 }).balance
    const t = transfer(src, null, 2)
    expect(t.destination.unvaluedQty).toBe(2)
    expect(t.valueMoved).toBe(0)
    expect(t.reconciliation).toEqual({ required: true, qty: 2, consumed: false, kind: 'transfer' })
  })
  it('refuses cross currency and over-quantity', () => {
    const src = step(SAR(), { type: 'receipt', qty: 1, unitCost: 1 }).balance
    expect(transfer(src, emptyBalance({ currency: 'AED' }), 1).reason).toBe('cross_currency_transfer')
    expect(transfer(src, null, 5).reason).toBe('insufficient_stock')
  })
})

describe('consignment issue', () => {
  it('records consumption for invoice matching, never a posting', () => {
    const b = emptyBalance({ currency: 'SAR', ownership: 'consignment', ownerSupplierId: 'sup-1', agreedUnitPrice: 900 })
    const r1 = step(b, { type: 'receipt', qty: 4 })
    const r2 = step(r1.balance, { type: 'issue', qty: 2 })
    expect(r2.consignmentConsumption).toMatchObject({ supplierId: 'sup-1', qty: 2, agreedValue: 1800 })
    expect(r2.consignmentConsumption.note).toMatch(/not an accounting posting/)
  })
})

describe('replay', () => {
  it('continues past refused movements and reports them', () => {
    const { balance, refused } = replay([
      { type: 'receipt', qty: 2, unitCost: 10, currency: 'SAR' },
      { type: 'issue', qty: 5 },
      { type: 'issue', qty: 1 },
    ])
    expect(refused).toHaveLength(1)
    expect(onHand(balance)).toBe(1)
  })
})

describe('landed cost allocation', () => {
  it('splits by value exactly to the cent', () => {
    const r = allocateLandedCost([{ qty: 1, unitCost: 100 }, { qty: 1, unitCost: 100 }, { qty: 1, unitCost: 100 }], 100)
    expect(r.ok).toBe(true)
    const total = r.allocations.reduce((s, a) => s + a.amount, 0)
    expect(Math.round(total * 100)).toBe(10000)
  })
  it('splits by qty and excludes lines with no basis', () => {
    const r = allocateLandedCost([{ id: 'a', qty: 3 }, { id: 'b', qty: 1 }, { id: 'c', qty: null }], 40, { basis: 'qty' })
    expect(r.allocations.map((a) => a.amount)).toEqual([30, 10])
    expect(r.allocations[0].perUnit).toBe(10)
    expect(r.excluded[0].id).toBe('c')
  })
  it('refuses with no basis or a bad total', () => {
    expect(allocateLandedCost([{ qty: 1 }], 10).reason).toBe('no_allocation_basis')
    expect(allocateLandedCost([{ qty: 1, unitCost: 1 }], -1).reason).toBe('invalid_total')
  })
})

describe('summarizeValuation', () => {
  const rows = [
    { currency: 'SAR', ownership: 'owned', valuedQty: 2, valuedValue: 200, unvaluedQty: 0 },
    { currency: 'SAR', ownership: 'owned', valuedQty: 0, valuedValue: 0, unvaluedQty: 3 },
    { currency: 'AED', ownership: 'owned', valuedQty: 1, valuedValue: 50, unvaluedQty: 0 },
    { currency: 'SAR', ownership: 'consignment', valuedQty: 0, valuedValue: 0, unvaluedQty: 5, agreedUnitPrice: 10 },
    { currency: 'SAR', ownership: 'supplier', valuedQty: 0, unvaluedQty: 7 },
  ]
  it('never blends currencies and withholds an incomplete owned value', () => {
    const s = summarizeValuation(rows)
    expect(s.mixedCurrency).toBe(true)
    expect(s.byCurrency.SAR.owned.value).toBe(null)
    expect(s.byCurrency.SAR.owned.valueReason).toBe('unvalued_stock_present')
    expect(s.byCurrency.SAR.owned.valuedValue).toBe(200)
    expect(s.byCurrency.SAR.owned.pricedPct).toBe(40)
    expect(s.byCurrency.AED.owned.value).toBe(50)
  })
  it('consignment at agreed price and supplier custody kept apart from owned value', () => {
    const s = summarizeValuation(rows)
    expect(s.byCurrency.SAR.consignment.agreedValue).toBe(50)
    expect(s.byCurrency.SAR.supplier.qty).toBe(7)
  })
})

describe('adjustmentValue', () => {
  it('keeps gross gain and loss apart and counts unvalued', () => {
    const a = adjustmentValue([
      { type: 'adjustment_up', currency: 'SAR', qtyChange: 2, valueChange: 40 },
      { type: 'adjustment_down', currency: 'SAR', qtyChange: -3, valueChange: -90 },
      { type: 'adjustment_down', currency: 'SAR', qtyChange: -1, valueChange: null },
      { type: 'receipt', currency: 'SAR', valueChange: 1000 },
    ])
    expect(a.SAR).toMatchObject({ gain: 40, loss: 90, net: -50, absolute: 130, unvaluedMovements: 1, complete: false, lossQty: 4 })
  })
})

describe('ageing and exposure', () => {
  const now = '2026-11-19'
  it('ages by last receipt; no date is unknown, not new', () => {
    const r = ageingBuckets([
      { currency: 'SAR', valuedQty: 1, valuedValue: 10, unvaluedQty: 0, lastReceiptAt: '2026-11-01' },
      { currency: 'SAR', valuedQty: 1, valuedValue: 20, unvaluedQty: 0, lastReceiptAt: '2025-01-01' },
      { currency: 'SAR', valuedQty: 1, valuedValue: 30, unvaluedQty: 0 },
    ], { now })
    expect(r.byCurrency.SAR['0_90'].valuedValue).toBe(10)
    expect(r.byCurrency.SAR.over_365.valuedValue).toBe(20)
    expect(r.byCurrency.SAR.unknown.valuedValue).toBe(30)
    expect(ageingBuckets([], {}).ok).toBe(false)
  })

  it('dead, slow, too-new, reserved and unknown are honest', () => {
    const base = { currency: 'SAR', valuedQty: 2, valuedValue: 100, unvaluedQty: 0, itemCreatedAt: '2020-01-01' }
    const r = exposure([
      { ...base, item_id: 'dead', lastIssueAt: '2025-01-01' },
      { ...base, item_id: 'slow', lastIssueAt: '2026-04-01' },
      { ...base, item_id: 'new', itemCreatedAt: '2026-10-01' },
      { ...base, item_id: 'res', hasOpenReservation: true },
      { ...base, item_id: 'unk' },
    ], { now, ledgerStartAt: '2026-08-01' })
    const by = Object.fromEntries(r.lines.map((l) => [l.item_id, l.movement]))
    expect(by).toEqual({ dead: 'dead', slow: 'slow', new: 'too_new', res: 'active', unk: 'unknown' })
    expect(r.byCurrency.SAR.dead.valuedValue).toBe(100)
  })

  it('no issue on record is dead only when the ledger covers the window', () => {
    const row = { currency: 'SAR', valuedQty: 1, valuedValue: 10, unvaluedQty: 0, itemCreatedAt: '2020-01-01' }
    expect(exposure([row], { now, ledgerStartAt: '2024-01-01' }).lines[0].movement).toBe('dead')
    expect(exposure([row], { now, ledgerStartAt: '2026-04-01' }).lines[0].movement).toBe('slow')
  })

  it('obsolete and excess over max are reported', () => {
    const r = exposure([
      { currency: 'SAR', valuedQty: 10, valuedValue: 100, unvaluedQty: 0, itemStatus: 'obsolete', maxQty: 4, lastIssueAt: '2026-11-01' },
      { currency: 'SAR', valuedQty: 1, valuedValue: 10, unvaluedQty: 0, lastIssueAt: '2026-11-01' },
    ], { now })
    expect(r.byCurrency.SAR.obsolete.valuedValue).toBe(100)
    expect(r.byCurrency.SAR.excess.qty).toBe(6)
    expect(r.byCurrency.SAR.excess.valuedValue).toBe(60)
    expect(r.byCurrency.SAR.excess.unknownMaxLines).toBe(1)
  })
})

describe('tyre specific identification', () => {
  it('values stock tyres at their own cost; used tyres separate; unpriced never 0', () => {
    const v = tyreStockValuation([
      { custody_state: 'new_stock', purchase_cost: 900, currency: 'SAR' },
      { custody_state: 'new_stock', purchase_cost: 1100, currency: 'SAR' },
      { custody_state: 'reusable', purchase_cost: 950, currency: 'SAR' },
      { custody_state: 'fitted', purchase_cost: 1000, currency: 'SAR' },
    ])
    expect(v.SAR.stock).toMatchObject({ tyres: 2, value: 2000, reportedValue: 2000 })
    expect(v.SAR.used).toMatchObject({ tyres: 1, originalCost: 950 })
    const w = tyreStockValuation([{ custody_state: 'new_stock', currency: 'SAR' }, { custody_state: 'new_stock', purchase_cost: 5, currency: 'SAR' }])
    expect(w.SAR.stock.reportedValue).toBe(null)
    expect(w.SAR.stock.unvalued).toBe(1)
  })
})

describe('separation guards (two ledgers, never summed)', () => {
  const root = path.resolve(__dirname, '..')
  const engines = ['valuation', 'kpi', 'classification', 'simulation', 'tyreCustody'].map((f) => path.join(root, 'lib/inventory', `${f}.js`))
  it('inventory engines are pure: no supabase, no service layer', () => {
    for (const f of engines) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/from\s+['"][^'"]*(supabase|\/api\/|_client)[^'"]*['"]/)
    }
  })
  it('cost readers and CPK never import inventory value', () => {
    const readers = ['lib/governedCost.js', 'lib/api/governedCost.js', 'lib/api/costSummary.js', 'lib/kpiEngine.js', 'lib/partsExpense.js', 'lib/tyreLifetime.js']
    for (const r of readers) {
      const src = fs.readFileSync(path.join(root, r), 'utf8')
      expect(src, r).not.toMatch(/lib\/inventory|['"]\.\.?\/inventory\//)
    }
  })
})
