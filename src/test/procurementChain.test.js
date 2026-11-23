import { describe, it, expect } from 'vitest'
import {
  currencyForCountry, scopedCountry, currencyScope, sumByCurrency,
  requisitionStatusOptions, canEditRequisition, canDecideRequisition, canRaisePo, requisitionPoDraft,
  poLinePayloads, outstandingQty, receiptPlan, summarizeGrnLines, withLineTotals,
  RECEIVABLE_PO_STATUSES, LINE_EDITABLE_PO_STATUSES,
} from '../lib/procurementChain'

describe('currency rules', () => {
  it('maps each country to its own currency, case-insensitively', () => {
    expect(currencyForCountry('KSA')).toBe('SAR')
    expect(currencyForCountry('uae')).toBe('AED')
    expect(currencyForCountry('Egypt')).toBe('EGP')
    expect(currencyForCountry(null)).toBeNull()
    expect(currencyForCountry('Mars')).toBeNull()
  })

  it('never stamps the All view as a country', () => {
    expect(scopedCountry('All')).toBeNull()
    expect(scopedCountry('')).toBeNull()
    expect(scopedCountry('KSA')).toBe('KSA')
  })

  it('reports a mixed currency set instead of one currency', () => {
    expect(currencyScope([{ country: 'KSA' }, { country: 'KSA' }])).toMatchObject({ mixed: false, currency: 'SAR' })
    const mixed = currencyScope([{ country: 'KSA' }, { currency: 'AED' }, { country: null }])
    expect(mixed.mixed).toBe(true)
    expect(mixed.currency).toBeNull()
    expect(mixed.currencies).toEqual(['AED', 'SAR'])
    expect(mixed.unknown).toBe(1)
  })

  it('sums money per currency and skips blanks instead of reading them as zero', () => {
    const out = sumByCurrency([
      { country: 'KSA', total: 100 }, { country: 'KSA', total: '50.5' },
      { country: 'UAE', total: 10 }, { country: 'UAE', total: null }, { country: 'Egypt', total: '' },
    ], 'total')
    expect(out).toEqual({ SAR: 150.5, AED: 10 })
  })
})

describe('requisition rules (mirror requisitions RLS)', () => {
  it('limits a requester to draft and submitted', () => {
    expect(requisitionStatusOptions({ canProcure: false })).toEqual(['draft', 'submitted'])
  })

  it('lets procurement decide but never set ordered by hand', () => {
    expect(requisitionStatusOptions({ canProcure: true })).toEqual(['draft', 'submitted', 'approved', 'rejected'])
  })

  it('keeps the current status visible on an existing row', () => {
    expect(requisitionStatusOptions({ canProcure: false, current: 'ordered' })).toEqual(['draft', 'submitted', 'ordered'])
  })

  it('allows the requester to edit only their own draft', () => {
    const own = { created_by: 'u1', status: 'draft' }
    expect(canEditRequisition(own, { userId: 'u1' })).toBe(true)
    expect(canEditRequisition({ ...own, status: 'submitted' }, { userId: 'u1' })).toBe(false)
    expect(canEditRequisition(own, { userId: 'u2' })).toBe(false)
    expect(canEditRequisition({ ...own, status: 'approved' }, { canProcure: true })).toBe(true)
    expect(canEditRequisition(null, {})).toBe(true)
  })

  it('offers approve only on submitted rows and Raise PO only on approved rows without a PO', () => {
    expect(canDecideRequisition({ status: 'submitted' }, { canProcure: true })).toBe(true)
    expect(canDecideRequisition({ status: 'submitted' }, { canProcure: false })).toBe(false)
    expect(canDecideRequisition({ status: 'draft' }, { canProcure: true })).toBe(false)
    expect(canRaisePo({ status: 'approved' }, { canProcure: true })).toBe(true)
    expect(canRaisePo({ status: 'approved', po_ref: 'PO-1' }, { canProcure: true })).toBe(false)
    expect(canRaisePo({ status: 'approved' }, { canProcure: false })).toBe(false)
  })
})

describe('requisition to PO draft', () => {
  const req = { id: 'r1', requisition_no: 'REQ-1', item: 'Tyre', quantity: 4, site: 'NHC', country: 'KSA', requester: 'Ali' }
  const supplier = { id: 's1', supplier_name: 'Acme Tyres' }
  const material = { id: 'm1', item_code: '310100', item_name: 'TYRE 315/80R22.5' }

  it('builds a Draft PO in the country currency with a catalogued line', () => {
    const d = requisitionPoDraft(req, { supplier, material, unitPrice: '950', today: '2026-11-23' })
    expect(d.errors).toEqual([])
    expect(d.header).toMatchObject({ status: 'Draft', currency: 'SAR', supplier_id: 's1', country: 'KSA', site: 'NHC', total_amount: 3800 })
    expect(d.line).toEqual({ item_id: 'm1', description: 'TYRE 315/80R22.5', qty_ordered: 4, unit_price: 950, currency: 'SAR' })
  })

  it('keeps an unknown price as null, never 0', () => {
    const d = requisitionPoDraft(req, { supplier, material, unitPrice: '' })
    expect(d.line.unit_price).toBeNull()
    expect(d.errors).toEqual([])
  })

  it('refuses without a supplier, a catalogue item or a quantity', () => {
    const d = requisitionPoDraft({ ...req, quantity: null }, {})
    expect(d.errors.length).toBe(3)
  })
})

describe('PO lines', () => {
  it('turns only catalogued items into line payloads and reports the rest', () => {
    const { lines, uncatalogued } = poLinePayloads([
      { item_id: 'm1', quantity: 2, unit_price: 10, description: 'A' },
      { brand: 'X', size: 'Y', quantity: 1, unit_price: 5 },
      { item_id: 'm2', quantity: 0 },
      { item_id: 'm3', quantity: 1, unit_price: '' },
    ], { currency: 'AED' })
    expect(lines).toEqual([
      { item_id: 'm1', description: 'A', qty_ordered: 2, unit_price: 10, currency: 'AED' },
      { item_id: 'm3', description: null, qty_ordered: 1, unit_price: null, currency: 'AED' },
    ])
    expect(uncatalogued).toEqual([1])
  })

  it('computes outstanding from accepted, never below zero', () => {
    expect(outstandingQty({ qty_ordered: 10, qty_accepted: 4 })).toBe(6)
    expect(outstandingQty({ qty_ordered: 10, qty_accepted: 12 })).toBe(0)
    expect(outstandingQty({ qty_ordered: null })).toBeNull()
  })

  it('exposes the PO statuses the server accepts lines and receipts on', () => {
    expect(LINE_EDITABLE_PO_STATUSES).toEqual(['Draft', 'Submitted'])
    expect(RECEIVABLE_PO_STATUSES).toContain('Partial Delivery')
  })
})

describe('receipt plan (mirrors _inv_receive_goods)', () => {
  const lines = [
    { id: 'l1', item_id: 'm1', item_code: 'A', qty_ordered: 10, qty_accepted: 4, unit_price: 5, currency: 'SAR' },
    { id: 'l2', item_id: null, description: 'free text', qty_ordered: 3, qty_accepted: 0 },
  ]

  it('builds a payload for a valid line, carrying the PO price', () => {
    const p = receiptPlan(lines, { l1: { qty_received: '5', qty_rejected: '1', location_id: 'loc1' } })
    expect(p.errors).toEqual([])
    expect(p.lines).toEqual([{
      item_id: 'm1', po_line_id: 'l1', location_id: 'loc1', qty_received: 5, qty_rejected: 1,
      rejection_reason: null, unit_cost: 5, currency: 'SAR', condition: 'new',
    }])
  })

  it('refuses accepting more than is outstanding', () => {
    const p = receiptPlan(lines, { l1: { qty_received: '7', location_id: 'loc1' } })
    expect(p.lines).toEqual([])
    expect(p.errors[0]).toMatch(/exceeds the 6 still outstanding/)
  })

  it('refuses rejected above received, a missing location and an uncatalogued line', () => {
    expect(receiptPlan(lines, { l1: { qty_received: 1, qty_rejected: 2, location_id: 'x' } }).errors[0]).toMatch(/rejected cannot be more/)
    expect(receiptPlan(lines, { l1: { qty_received: 1 } }).errors[0]).toMatch(/receiving location/)
    expect(receiptPlan(lines, { l2: { qty_received: 1, location_id: 'x' } }).errors[0]).toMatch(/no Material Master item/)
  })

  it('asks for a quantity when nothing was entered', () => {
    expect(receiptPlan(lines, {}).errors).toEqual(['Enter a received quantity on at least one line.'])
  })
})

describe('GRN line totals', () => {
  it('folds lines into a ledger-posted GRN header that carries none', () => {
    const sum = summarizeGrnLines([
      { grn_id: 'g1', qty_received: 5, qty_accepted: 4, qty_rejected: 1, item_code: 'A' },
      { grn_id: 'g1', qty_received: 2, qty_accepted: 2, qty_rejected: 0, item_code: 'B' },
      { grn_id: 'g1', qty_received: 1, qty_accepted: 1, qty_rejected: 0, item_code: 'C' },
    ])
    const [r, other] = withLineTotals([{ id: 'g1', item: null, qty_received: null }, { id: 'g2', item: 'X', qty_received: 3 }], sum)
    expect(r).toMatchObject({ item: 'A, B +1 more', qty_received: 8, qty_rejected: 1, line_count: 3, posted_to_stock: true })
    expect(other).toEqual({ id: 'g2', item: 'X', qty_received: 3 })
  })
})
