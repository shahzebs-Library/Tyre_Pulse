import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  currencyForCountry, scopedCountry, currencyScope, sumByCurrency,
  requisitionStatusOptions, canEditRequisition, canDecideRequisition, canRaisePo, requisitionPoDraft,
  poLinePayloads, outstandingQty, receiptPlan, summarizeGrnLines, withLineTotals,
  RECEIVABLE_PO_STATUSES, LINE_EDITABLE_PO_STATUSES, requisitionMaterial, poStatusOptions,
} from '../lib/procurementChain'
import {
  listRequisitions, createRequisition, updateRequisition, _resetRequisitionColumnProbe, WP4_COLS, COLS,
} from '../lib/api/requisitions'
import { decideRequisition, NO_ROW_DECISION } from '../lib/api/procurementChain'

// A scripted PostgREST stand-in: each awaited query takes the next scripted result.
const calls = []
const script = []
function builder(op) {
  const call = { op, select: null, body: null }
  calls.push(call)
  const b = {
    select(cols) { call.select = cols; return b },
    insert(body) { call.body = body; return b },
    update(body) { call.body = body; return b },
    eq() { return b }, or() { return b }, order() { return b }, limit() { return b },
    single() { return b }, maybeSingle() { return b },
    then(res, rej) { return Promise.resolve(script.shift() ?? { data: [], error: null }).then(res, rej) },
  }
  return b
}
vi.mock('../lib/api/_client', async () => {
  const actual = await vi.importActual('../lib/api/_client')
  return {
    ...actual,
    supabase: { from: () => ({ select: (c) => builder('select').select(c), insert: (b) => builder('insert').insert(b), update: (b) => builder('update').update(b) }) },
    applyCountry: (q) => q,
  }
})


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

  it('keeps the line key minted in the form with the line payload', () => {
    const { lines } = poLinePayloads([
      { item_id: 'm1', quantity: 1, line_key: 'k-1' },
      { item_id: 'm2', quantity: 1 },
    ])
    expect(lines[0].idempotency_key).toBe('k-1')
    expect(lines[1]).not.toHaveProperty('idempotency_key')
  })

  it('offers only the status moves allowed from the current status', () => {
    expect(poStatusOptions('Draft', { isNew: true })).toEqual(['Draft', 'Submitted'])
    expect(poStatusOptions('Draft')).toEqual(['Draft', 'Submitted', 'Cancelled'])
    expect(poStatusOptions('Submitted')).toEqual(['Submitted', 'Approved', 'Cancelled'])
    expect(poStatusOptions('Submitted', { ownPo: true })).toEqual(['Submitted', 'Cancelled'])
    expect(poStatusOptions('Approved')).toEqual(['Approved', 'Ordered', 'Cancelled'])
    expect(poStatusOptions('Ordered', { hasLines: true })).toEqual(['Ordered', 'Cancelled'])
    expect(poStatusOptions('Ordered')).toEqual(['Ordered', 'Partial Delivery', 'Delivered', 'Cancelled'])
    expect(poStatusOptions('Draft', { isEmergency: true })).toContain('Ordered')
    expect(poStatusOptions('Delivered')).toEqual(['Delivered'])
    expect(poStatusOptions('Closed')).toEqual(['Closed'])
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
    const p = receiptPlan(lines, { l1: { qty_received: '5', qty_rejected: '1', rejection_reason: 'damaged: crushed', location_id: 'loc1' } })
    expect(p.errors).toEqual([])
    expect(p.lines).toEqual([{
      item_id: 'm1', po_line_id: 'l1', location_id: 'loc1', qty_received: 5, qty_rejected: 1,
      rejection_reason: 'damaged: crushed', unit_cost: 5, currency: 'SAR', condition: 'new',
    }])
  })

  it('needs a reason for a rejected quantity (the database refuses one without)', () => {
    const p = receiptPlan(lines, { l1: { qty_received: '5', qty_rejected: '1', location_id: 'loc1' } })
    expect(p.lines).toEqual([])
    expect(p.errors[0]).toMatch(/give a reason for the rejected quantity/)
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

describe('WP4: self-approval and the Material Master link', () => {
  it('never offers approve / reject on the requester\'s own requisition', () => {
    const own = { status: 'submitted', created_by: 'u1' }
    expect(canDecideRequisition(own, { canProcure: true, userId: 'u1' })).toBe(false)
    expect(canDecideRequisition(own, { canProcure: true, userId: 'u2' })).toBe(true)
    expect(canDecideRequisition({ status: 'submitted' }, { canProcure: true, userId: 'u1' })).toBe(true)
  })

  it('turns a stored item_id back into a picker value without asking again', () => {
    expect(requisitionMaterial({ item: 'Tyre' })).toBeNull()
    expect(requisitionMaterial({ item_id: 'm1', item: '140089-O OIL FILTER' }))
      .toEqual({ id: 'm1', item_code: '140089-O', item_name: 'OIL FILTER' })
    expect(requisitionMaterial({ item_id: 'm1', item: 'ABC' })).toEqual({ id: 'm1', item_code: 'ABC', item_name: 'ABC' })
  })
})

describe('WP4: requisitions service works before and after the migration', () => {
  const UUID = '0b7e5f19-4ef4-490c-a807-60a437b955fd'
  const missing = { data: null, error: { code: '42703', message: 'column requisitions.item_id does not exist' } }
  beforeEach(() => { calls.length = 0; script.length = 0; _resetRequisitionColumnProbe() })

  it('reads the WP4 columns when they exist', async () => {
    script.push({ data: [{ id: 'r1', item_id: UUID }], error: null })
    const rows = await listRequisitions()
    expect(rows[0].item_id).toBe(UUID)
    expect(calls[0].select).toBe(WP4_COLS)
  })

  it('falls back to the base columns when the migration is not applied, and remembers it', async () => {
    script.push(missing, { data: [{ id: 'r1' }], error: null })
    expect(await listRequisitions()).toEqual([{ id: 'r1' }])
    expect(calls.map((c) => c.select)).toEqual([WP4_COLS, COLS])
    script.push({ data: { id: 'r2' }, error: null })
    await createRequisition({ item: 'Tyre', item_id: UUID })
    expect(calls[2].body).not.toHaveProperty('item_id')
    expect(calls[2].select).toBe(COLS)
  })

  it('retries a create without item_id when the column is missing', async () => {
    script.push(missing, { data: { id: 'r3' }, error: null })
    const row = await createRequisition({ item: 'Tyre', item_id: UUID, approved_by: 'Forged' })
    expect(row).toEqual({ id: 'r3' })
    expect(calls[0].body.item_id).toBe(UUID)
    expect(calls[0].body).not.toHaveProperty('approved_by')
    expect(calls[1].body).not.toHaveProperty('item_id')
  })

  it('never sends server-owned approval or currency fields on update, and drops a non-uuid item_id', async () => {
    script.push({ data: { id: 'r1' }, error: null })
    await updateRequisition('r1', { item: 'Tyre', approved_by: 'X', approved_by_id: UUID, decided_at: 'now', currency: 'AED', item_id: 'nope' })
    expect(calls[0].body).toEqual({ item: 'Tyre', item_id: null })
  })
})

describe('WP4: a refused decision is reported, not swallowed', () => {
  beforeEach(() => { calls.length = 0; script.length = 0 })
  it('turns an RLS-refused approval (0 rows, no error) into a plain message', async () => {
    script.push({ data: null, error: null })
    await expect(decideRequisition('r1', 'approved')).rejects.toThrow(NO_ROW_DECISION)
  })
  it('returns the row when the decision was recorded', async () => {
    script.push({ data: { id: 'r1', status: 'approved' }, error: null })
    await expect(decideRequisition('r1', 'approved')).resolves.toMatchObject({ status: 'approved' })
  })
})
