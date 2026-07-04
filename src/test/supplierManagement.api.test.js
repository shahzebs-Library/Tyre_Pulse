import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors src/test/dashboard.api.test.js)
// extended with the builders the Supplier Management page functions use. Records
// the table queried and the select/order/range/eq/or/insert/update/upsert/delete
// calls applied, resolving to a configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], order: [], range: null, delete: false }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = cols; calls.selectOpts = opts; return b },
      order(c, o) { calls.order.push([c, o]); return b },
      range(f, t) { calls.range = [f, t]; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      upsert(v, o) { calls.upsert = v; calls.upsertOpts = o; return b },
      delete() { calls.delete = true; return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const supplierApi = await import('../lib/api/supplierManagementApi')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - supplierManagementApi', () => {
  it('listSupplierTyres selects supplier columns, null-safe country scope, paged range', async () => {
    await supplierApi.listSupplierTyres({ from: 0, to: 999, country: 'KSA' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select).toContain('supplier')
    expect(h.state.last._calls.select).toContain('cost_per_tyre')
    expect(h.state.last._calls.or).toContainEqual('country.eq.KSA,country.is.null')
    expect(h.state.last._calls.eq).toHaveLength(0)
    expect(h.state.last._calls.range).toEqual([0, 999])
  })

  it('listSupplierTyres omits the country OR for "All"', async () => {
    await supplierApi.listSupplierTyres({ from: 0, to: 999, country: 'All' })
    expect(h.state.last._calls.or).toHaveLength(0)
  })

  it('listSupplierRatings reads supplier_ratings, country-scoped', async () => {
    await supplierApi.listSupplierRatings({ country: 'UAE' })
    expect(h.state.last._table).toBe('supplier_ratings')
    expect(h.state.last._calls.select).toBe('id, brand, rating, notes, country')
    expect(h.state.last._calls.or).toContainEqual('country.eq.UAE,country.is.null')
  })

  it('listSupplierContracts orders newest-first, country-scoped', async () => {
    await supplierApi.listSupplierContracts({ country: 'Oman' })
    expect(h.state.last._table).toBe('supplier_contracts')
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(h.state.last._calls.or).toContainEqual('country.eq.Oman,country.is.null')
  })

  it('scorecard sources read warranty_claims + purchase_orders, country-scoped', async () => {
    await supplierApi.listScorecardWarrantyClaims({ country: 'KSA' })
    expect(h.state.last._table).toBe('warranty_claims')
    expect(h.state.last._calls.or).toContainEqual('country.eq.KSA,country.is.null')

    await supplierApi.listScorecardPurchaseOrders({ country: 'KSA' })
    expect(h.state.last._table).toBe('purchase_orders')
    expect(h.state.last._calls.select).toContain('vendor_name')
  })

  it('upsertSupplierRating upserts with the (brand,country) conflict target', async () => {
    await supplierApi.upsertSupplierRating({ brand: 'X', rating: 1 })
    expect(h.state.last._table).toBe('supplier_ratings')
    expect(h.state.last._calls.upsert).toEqual({ brand: 'X', rating: 1 })
    expect(h.state.last._calls.upsertOpts).toEqual({ onConflict: 'brand,country' })
  })

  it('updateSupplierContract updates and scopes by id', async () => {
    await supplierApi.updateSupplierContract('c1', { notes: 'n' })
    expect(h.state.last._calls.update).toEqual({ notes: 'n' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'c1'])
  })

  it('insertSupplierContract inserts the payload', async () => {
    await supplierApi.insertSupplierContract({ supplier_name: 'S' })
    expect(h.state.last._calls.insert).toEqual({ supplier_name: 'S' })
  })

  it('deleteSupplierContract deletes by id and returns the id for no-op detection', async () => {
    await supplierApi.deleteSupplierContract('c1')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'c1'])
    expect(h.state.last._calls.select).toBe('id')
  })

  it('pass-through surfaces the raw { data, error } the page reads', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    const res = await supplierApi.listSupplierRatings({ country: 'All' })
    expect(res).toEqual({ data: null, error: { message: 'boom', code: '42501' } })
  })
})
