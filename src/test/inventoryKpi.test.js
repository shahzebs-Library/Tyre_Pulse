import { describe, it, expect } from 'vitest'
import {
  KPI_CATALOGUE, KPI_BY_ID, countAccuracy, serialAccuracy, countCompletion, inventoryValue, adjustmentValueKpi,
  turnoverAndDio, exposureKpis, stockoutFrequency, criticalAvailability, supplierDeliveryPerformance,
  leadTimeVariance, discrepancyKpis, outstandingPoQty, consignmentUtilisation, emergencyPurchaseRate,
  reservedNotIssued, purchaseAvoidance,
} from '../lib/inventory/kpi'

const now = '2026-11-19'

describe('catalogue', () => {
  it('every KPI has formula, unit, scope, period, source and a null rule', () => {
    expect(KPI_CATALOGUE.length).toBeGreaterThanOrEqual(24)
    for (const k of KPI_CATALOGUE) {
      for (const f of ['id', 'label', 'formula', 'unit', 'scope', 'period', 'source', 'nullRule']) expect(k[f], `${k.id}.${f}`).toBeTruthy()
    }
    expect(new Set(KPI_CATALOGUE.map((k) => k.id)).size).toBe(KPI_CATALOGUE.length)
    expect(KPI_BY_ID.inv_turnover.unit).toBe('times')
  })
})

describe('count accuracy', () => {
  const lines = [
    { expected_qty: 10, counted_qty: 10, unit_cost: 5, currency: 'SAR' },
    { expected_qty: 10, counted_qty: 8, unit_cost: 5, currency: 'SAR' },
    { expected_qty: 0, counted_qty: 3, unit_cost: 5, currency: 'SAR' },
    { expected_qty: 4, confirmed_zero: true, unit_cost: 2, currency: 'SAR' },
    { expected_qty: 5, counted_qty: null },
  ]
  it('exact-line, quantity, gross shortage and gross excess kept apart', () => {
    const a = countAccuracy(lines)
    expect(a.exactLine).toMatchObject({ value: 25, numerator: 1, denominator: 4 })
    expect(a.quantity.value).toBe(62.5)
    expect(a.grossShortage.value).toBe(6)
    expect(a.grossExcess.value).toBe(3)
    expect(a.netVarianceQty).toBe(-3)
    expect(a.absoluteVarianceQty).toBe(9)
    expect(a.grossShortage.byCurrency.SAR.value).toBe(18)
    expect(a.grossExcess.byCurrency.SAR.value).toBe(15)
  })
  it('tolerance applies except for serial-tracked lines', () => {
    const a = countAccuracy([{ expected_qty: 10, counted_qty: 9 }, { expected_qty: 1, counted_qty: 0, serial_tracked: true }], { tolerance: 1 })
    expect(a.exactLine.numerator).toBe(1)
  })
  it('mixed units make qty KPIs null with a reason', () => {
    const a = countAccuracy([{ expected_qty: 1, counted_qty: 1, uom: 'EA' }, { expected_qty: 2, counted_qty: 1, uom: 'L' }])
    expect(a.quantity).toMatchObject({ value: null, reason: 'mixed_units' })
    expect(a.grossShortage.value).toBe(null)
    expect(a.exactLine.value).toBe(50)
  })
  it('unvalued variance lines leave value null, not 0', () => {
    const a = countAccuracy([{ expected_qty: 2, counted_qty: 1, currency: 'SAR' }])
    expect(a.grossShortage.byCurrency.SAR.value).toBe(null)
  })
  it('no counted lines is null', () => {
    expect(countAccuracy([]).exactLine).toMatchObject({ value: null, reason: 'no_counted_lines' })
  })
})

describe('serial accuracy and completion', () => {
  it('lists missing and unexpected', () => {
    const s = serialAccuracy(['abc123', 'DEF456', 'GHI789'], ['ABC123', 'def 456', 'ZZZ999'])
    expect(s.value).toBe(50)
    expect(s.missing).toEqual(['GHI789'])
    expect(s.unexpected).toEqual(['ZZZ999'])
    expect(serialAccuracy([], []).value).toBe(null)
  })
  it('completion', () => {
    expect(countCompletion([{ counted_qty: 1 }, { confirmed_zero: true }, {}]).value).toBe(66.67)
    expect(countCompletion([]).reason).toBe('no_lines_in_scope')
  })
})

describe('value KPIs', () => {
  it('inventory value withholds incomplete and mixed currency headlines', () => {
    const one = inventoryValue([{ currency: 'SAR', valuedQty: 2, valuedValue: 100, unvaluedQty: 0 }])
    expect(one.value).toMatchObject({ value: 100, currency: 'SAR' })
    const part = inventoryValue([{ currency: 'SAR', valuedQty: 2, valuedValue: 100, unvaluedQty: 1 }])
    expect(part.value.value).toBe(null)
    expect(part.unvalued.value).toBe(1)
    const mixed = inventoryValue([
      { currency: 'SAR', valuedQty: 2, valuedValue: 100, unvaluedQty: 0 },
      { currency: 'AED', valuedQty: 2, valuedValue: 100, unvaluedQty: 0 },
    ])
    expect(mixed.value).toMatchObject({ value: null, reason: 'mixed_currency' })
    expect(mixed.value.byCurrency.AED.value).toBe(100)
  })
  it('adjustment value', () => {
    const k = adjustmentValueKpi([{ type: 'adjustment_up', currency: 'SAR', qty: 1, valueChange: 10 }, { type: 'adjustment_down', currency: 'SAR', qty: 1, valueChange: -30 }])
    expect(k.value).toBe(-20)
    expect(adjustmentValueKpi([]).reason).toBe('no_adjustments')
  })
})

describe('turnover and DIO', () => {
  const snaps = [1000, 1200, 800].map((v, i) => ({ date: `2026-0${i + 1}-28`, value: v, currency: 'SAR' }))
  it('computes from issue value and average month-end value', () => {
    const k = turnoverAndDio({ issues: [{ value: 3000, currency: 'SAR' }, { value: -1000, currency: 'SAR' }], snapshots: snaps })
    expect(k.turnover.value).toBe(4)
    expect(k.dio.value).toBe(91.3)
  })
  it('null rules', () => {
    expect(turnoverAndDio({ issues: [{ value: 1, currency: 'SAR' }], snapshots: snaps.slice(0, 2) }).turnover.reason).toBe('fewer_than_3_complete_snapshots')
    expect(turnoverAndDio({ issues: [{ value: null, currency: 'SAR' }], snapshots: snaps }).turnover.reason).toBe('issue_value_incomplete')
    expect(turnoverAndDio({ issues: [{ value: 1, currency: 'SAR' }], snapshots: snaps, issueCoverage: 0.5 }).turnover.reason).toBe('issue_coverage_below_80pct')
    expect(turnoverAndDio({ issues: [{ value: 1, currency: 'SAR' }], snapshots: snaps.map((s) => ({ ...s, value: 0 })) }).turnover.reason).toBe('average_stock_value_zero')
    const mixed = turnoverAndDio({ issues: [{ value: 1, currency: 'SAR' }, { value: 1, currency: 'AED' }], snapshots: snaps })
    expect(mixed.turnover.reason).toBe('mixed_currency')
    expect(turnoverAndDio({ issues: [{ value: 0, currency: 'SAR' }], snapshots: snaps }).dio.value).toBe(null)
  })
})

describe('exposure KPIs', () => {
  it('dead / slow / excess / obsolete', () => {
    const k = exposureKpis([
      { currency: 'SAR', valuedQty: 2, valuedValue: 100, unvaluedQty: 0, itemCreatedAt: '2020-01-01', lastIssueAt: '2025-01-01', itemStatus: 'obsolete', maxQty: 1 },
      { currency: 'SAR', valuedQty: 1, valuedValue: 10, unvaluedQty: 0, itemCreatedAt: '2026-10-01' },
    ], { now })
    expect(k.dead.value).toBe(100)
    expect(k.obsolescence.value).toBe(100)
    expect(k.excess.value).toBe(50)
    expect(k.dead.tooNewLines).toBe(1)
    expect(exposureKpis([], {}).dead.reason).toBe('now_required')
  })
})

describe('service level', () => {
  it('stock-out frequency excludes unknown outcomes', () => {
    const k = stockoutFrequency([{ fulfilled_from_stock: true }, { fulfilled_from_stock: false }, { fulfilled_from_stock: null }])
    expect(k).toMatchObject({ value: 50, unknownOutcome: 1 })
    expect(stockoutFrequency([]).value).toBe(null)
  })
  it('critical availability uses safety stock, >0 when unset', () => {
    const k = criticalAvailability([
      { ved: 'V', on_hand: 5, reserved: 1, safety_stock: 4 },
      { ved: 'V', on_hand: 5, reserved: 3, safety_stock: 4 },
      { criticality: 'critical', on_hand: 1 },
      { ved: 'D', on_hand: 0 },
    ])
    expect(k).toMatchObject({ value: 66.67, vitalItems: 3, safetyStockUnset: 1 })
    expect(criticalAvailability([{ ved: 'E' }]).reason).toBe('no_vital_items')
  })
})

describe('suppliers', () => {
  it('OTIF counts overdue unreceived lines as failures and skips cancelled', () => {
    const k = supplierDeliveryPerformance([
      { supplier_id: 's1', ordered_qty: 10, accepted_qty: 10, promised_at: '2026-11-01', received_at: '2026-11-01T15:00:00Z' },
      { supplier_id: 's1', ordered_qty: 10, accepted_qty: 8, promised_at: '2026-11-01', received_at: '2026-10-30' },
      { supplier_id: 's1', ordered_qty: 10, promised_at: '2026-11-10' },
      { supplier_id: 's1', ordered_qty: 10, promised_at: '2026-12-10' },
      { supplier_id: 's1', status: 'cancelled', promised_at: '2026-01-01' },
      { supplier_id: 's2', ordered_qty: 1, accepted_qty: 1, received_at: '2026-11-01' },
    ], { now })
    expect(k.bySupplier.s1).toMatchObject({ due: 3, otif: 1, inFull: 1 })
    expect(k.value).toBe(33.33)
    expect(k.linesWithoutPromisedDate).toBe(1)
    expect(supplierDeliveryPerformance([], { now }).value).toBe(null)
  })
  it('lead-time variance', () => {
    const k = leadTimeVariance([
      { supplier_id: 's1', ordered_at: '2026-10-01', received_at: '2026-10-11', agreed_lead_days: 7 },
      { supplier_id: 's1', ordered_at: '2026-10-01', received_at: '2026-10-06', agreed_lead_days: 7 },
      { supplier_id: 's1', ordered_at: '2026-10-01', received_at: '2026-10-06' },
    ])
    expect(k.value).toBe(0.5)
    expect(k.bySupplier.s1.meanActualDays).toBe(7.5)
    expect(k.excludedLines).toBe(1)
    expect(leadTimeVariance([]).value).toBe(null)
  })
})

describe('discrepancies, POs, consignment, emergencies, reservations, avoidance', () => {
  it('discrepancies split shortage and excess value', () => {
    const k = discrepancyKpis([
      { category: 'counting_error', status: 'open', value_impact: -50, currency: 'SAR' },
      { category: 'theft_suspected', status: 'closed', value_impact: 20, currency: 'SAR' },
    ])
    expect(k).toMatchObject({ value: 2, open: 1 })
    expect(k.byCurrency.SAR).toMatchObject({ shortageValue: 50, excessValue: 20 })
  })
  it('outstanding PO qty', () => {
    const k = outstandingPoQty([
      { item_id: 'i1', ordered_qty: 10, received_qty: 4, unit_price: 2, currency: 'SAR' },
      { item_id: 'i2', ordered_qty: 5, received_qty: 5, unit_price: 2, currency: 'SAR' },
      { item_id: 'i3', ordered_qty: 5, received_qty: 0, currency: 'SAR', status: 'cancelled' },
    ])
    expect(k.value).toBe(6)
    expect(k.byCurrency.SAR.value).toBe(12)
    expect(outstandingPoQty([{ ordered_qty: 1, uom: 'EA' }, { ordered_qty: 1, uom: 'L' }]).reason).toBe('mixed_units')
  })
  it('consignment utilisation', () => {
    const k = consignmentUtilisation([{ supplier_id: 's', issued_qty: 30, avg_on_hand_qty: 10, agreed_max_qty: 20 }])
    expect(k.value).toBe(3)
    expect(k.bySupplier.s.holdingVsMaxPct).toBe(50)
    expect(consignmentUtilisation([]).value).toBe(null)
  })
  it('emergency purchase rate', () => {
    const k = emergencyPurchaseRate([
      { is_emergency: true, total: 100, currency: 'SAR' },
      { is_emergency: false, total: 300, currency: 'SAR' },
      { is_emergency: true, total: 999, currency: 'SAR', status: 'cancelled' },
    ])
    expect(k.value).toBe(50)
    expect(k.byCurrency.SAR.valueSharePct).toBe(25)
  })
  it('reserved but not issued', () => {
    const k = reservedNotIssued([
      { qty_reserved: 5, qty_issued: 2, reserved_at: '2026-10-01', unit_cost: 10, currency: 'SAR' },
      { qty_reserved: 5, qty_issued: 0, reserved_at: '2026-11-18', unit_cost: 10, currency: 'SAR' },
      { qty_reserved: 5, qty_issued: 0, reserved_at: '2026-10-01', status: 'released' },
    ], { now })
    expect(k).toMatchObject({ value: 3, lines: 1 })
    expect(k.byCurrency.SAR.value).toBe(30)
    expect(reservedNotIssued([], {}).reason).toBe('now_required')
  })
  it('purchase avoidance is labelled book value, never a saving', () => {
    const k = purchaseAvoidance([
      { fulfilled_from: 'stock', qty: 2, book_unit_cost: 100, currency: 'SAR' },
      { fulfilled_from: 'reusable_stock', qty: 1, book_unit_cost: 400, currency: 'SAR' },
      { fulfilled_from: 'purchase', qty: 1 },
      { fulfilled_from: null },
    ])
    expect(k.value).toBe(66.67)
    expect(k.byCurrency.SAR.bookValue).toBe(600)
    expect(k.valueLabel).toMatch(/not a saving/)
  })
})
