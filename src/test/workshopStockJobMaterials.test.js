import { describe, it, expect } from 'vitest'
import {
  buildJobMaterials, summariseJobMaterials, planRequest, validateInstall, validateReturn,
  assetMaterialCost, reservationOpen, issueValued,
} from '../lib/workshopStock/jobMaterials'

const bal = [{ id: 's1', item_id: 'i1', item_code: 'OF-1', description: 'Oil filter', site: 'NHC', country: 'KSA', location_code: 'B01', qty_on_hand: 7, qty_reserved: 0, uom: 'EA' }]

describe('job card materials engine', () => {
  it('reconciles issued minus installed minus returned per stock line', () => {
    const rows = buildJobMaterials({
      reservations: [{ id: 'r1', stock_id: 's1', qty: 3, qty_released: 0, qty_consumed: 3, status: 'consumed' }],
      movements: [
        { id: 'm1', stock_id: 's1', movement_type: 'issue', qty_change: -3, value_change: -135, unvalued_qty_change: 0, currency: 'SAR' },
        { id: 'm2', stock_id: 's1', movement_type: 'issue_return', qty_change: 1, value_change: 45, currency: 'SAR' },
      ],
      installations: [{ id: 'n1', stock_id: 's1', movement_id: 'm1', qty: 2 }],
      balances: bal,
    })
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r).toMatchObject({ itemCode: 'OF-1', requested: 3, reserved: 0, issued: 3, installed: 2, returned: 1, unreconciled: 0 })
    expect(r.cost).toEqual([{ currency: 'SAR', amount: 90 }])
    expect(r.issues[0]).toMatchObject({ id: 'm1', installed: 2, open: 1 })
  })

  it('excludes reversed issues and keeps an unvalued issue out of the cost', () => {
    const rows = buildJobMaterials({
      movements: [
        { id: 'm1', stock_id: 's1', movement_type: 'issue', qty_change: -2, value_change: null, unvalued_qty_change: -2, currency: 'SAR' },
        { id: 'm3', stock_id: 's1', movement_type: 'issue', qty_change: -5, value_change: -10, currency: 'SAR' },
      ],
      reversals: [{ id: 'rv', reverses_movement_id: 'm3' }],
      balances: bal,
    })
    expect(rows[0].issued).toBe(2)
    expect(rows[0].cost).toEqual([])
    expect(rows[0].unvaluedQty).toBe(2)
    expect(rows[0].unreconciled).toBe(2)
  })

  it('never adds currencies together', () => {
    const rows = buildJobMaterials({
      movements: [
        { id: 'a', stock_id: 's1', movement_type: 'issue', qty_change: -1, value_change: -10, currency: 'SAR' },
        { id: 'b', stock_id: 's2', movement_type: 'issue', qty_change: -1, value_change: -20, currency: 'AED' },
      ],
    })
    const s = summariseJobMaterials(rows, [{ status: 'submitted', quantity: 4 }, { status: 'rejected', quantity: 9 }])
    expect(s.cost).toEqual([{ currency: 'AED', amount: 20 }, { currency: 'SAR', amount: 10 }])
    expect(s.mixedCurrency).toBe(true)
    expect(s.openRequisitions).toBe(1)
    expect(s.onOrderQty).toBe(4)
    expect(s.reconciled).toBe(false)
  })

  it('reservationOpen and issueValued', () => {
    expect(reservationOpen({ qty: 5, qty_released: 1, qty_consumed: 2, status: 'active' })).toBe(2)
    expect(reservationOpen({ qty: 5, status: 'consumed' })).toBe(0)
    expect(issueValued({ value_change: -1, unvalued_qty_change: 0 })).toBe(true)
    expect(issueValued({ value_change: null })).toBe(false)
  })
})

describe('reserve before buying', () => {
  const lines = [
    { id: 'a', site: 'NHC', qty_on_hand: 4, qty_reserved: 1, location_code: 'B1' },
    { id: 'b', site: 'NHC', qty_on_hand: 2, qty_reserved: 0, location_code: 'B2' },
    { id: 'c', site: 'JED', qty_on_hand: 50, qty_reserved: 0, location_code: 'X' },
  ]
  it('reserves free stock of the job site and requisitions only the shortage', () => {
    const p = planRequest({ qty: 7, balances: lines, site: 'nhc' })
    expect(p.allocations).toEqual([
      { stockId: 'a', qty: 3, location: 'B1', itemId: null },
      { stockId: 'b', qty: 2, location: 'B2', itemId: null },
    ])
    expect(p.covered).toBe(5)
    expect(p.shortage).toBe(2)
  })
  it('needs nothing bought when the store covers it', () => {
    expect(planRequest({ qty: 2, balances: lines, site: 'NHC' }).shortage).toBe(0)
  })
  it('refuses a zero quantity', () => {
    expect(planRequest({ qty: 0, balances: lines }).error).toBeTruthy()
  })
})

describe('install and return bounds', () => {
  const row = { stockId: 's1', unreconciled: 2 }
  it('install is bounded by the issue and the unreconciled quantity', () => {
    expect(validateInstall({ issue: { id: 'm', qty: 3, open: 3 }, row, qty: 3 }).ok).toBe(false)
    expect(validateInstall({ issue: { id: 'm', qty: 3, open: 3 }, row, qty: 2 })).toEqual({ ok: true, qty: 2 })
    expect(validateInstall({ issue: null, row, qty: 1 }).ok).toBe(false)
  })
  it('return is bounded and needs a reason', () => {
    expect(validateReturn({ row, qty: 3, reason: 'x' }).ok).toBe(false)
    expect(validateReturn({ row, qty: 1, reason: '' }).ok).toBe(false)
    expect(validateReturn({ row, qty: 1, reason: 'not used' })).toEqual({ ok: true, qty: 1 })
  })
})

describe('asset material cost', () => {
  it('groups by job card, per currency, newest first', () => {
    const out = assetMaterialCost({
      jobCards: [{ work_order_no: 'JC1', opened_at: '2026-01-01' }, { work_order_no: 'JC2', opened_at: '2026-03-01' }, { work_order_no: 'JC3', opened_at: '2026-04-01' }],
      movements: [
        { id: 'a', source_doc_id: 'JC1', stock_id: 's', movement_type: 'issue', qty_change: -2, value_change: -20, currency: 'SAR' },
        { id: 'b', source_doc_id: 'JC2', stock_id: 's', movement_type: 'issue', qty_change: -1, value_change: null, unvalued_qty_change: -1, currency: 'SAR' },
      ],
      installations: [{ job_card_no: 'JC1', stock_id: 's', movement_id: 'a', qty: 2 }],
    })
    expect(out.cards.map((c) => c.jobCard)).toEqual(['JC2', 'JC1'])
    expect(out.cost).toEqual([{ currency: 'SAR', amount: 20 }])
    expect(out.unvaluedQty).toBe(1)
    expect(out.unreconciled).toBe(1)
  })
})
