import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: a chainable, thenable query builder that
// records the table queried and the eq/or/ilike filters + insert/update/delete
// intents, resolving to a configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], ilike: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
      limit() { return b },
      range() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      ilike(c, v) { calls.ilike.push([c, v]); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const warranty = await import('../lib/api/warranty')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - warranty', () => {
  it('lists from warranty_claims (no country filter)', async () => {
    h.state.result = { data: [{ id: 'w1', claim_no: 'WAR-2026-00001' }], error: null }
    const rows = await warranty.listWarrantyClaims()
    expect(h.state.last._table).toBe('warranty_claims')
    expect(h.state.last._calls.or).toHaveLength(0)
    expect(h.state.last._calls.eq).toHaveLength(0)
    expect(rows).toEqual([{ id: 'w1', claim_no: 'WAR-2026-00001' }])
  })

  it('findTyreForClaim fuzzy-matches serial_number on tyre_records', async () => {
    h.state.result = { data: { serial_number: 'SN1' }, error: null }
    const t = await warranty.findTyreForClaim('SN1')
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.ilike).toContainEqual(['serial_number', '%SN1%'])
    expect(t).toEqual({ serial_number: 'SN1' })
  })

  it('updates and deletes a warranty claim by id', async () => {
    await warranty.updateWarrantyClaim('w1', { claim_status: 'Approved' })
    expect(h.state.last._table).toBe('warranty_claims')
    expect(h.state.last._calls.update).toEqual({ claim_status: 'Approved' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'w1'])

    await warranty.deleteWarrantyClaim('w1')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'w1'])
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(warranty.listWarrantyClaims()).rejects.toBeInstanceOf(ServiceError)
    await expect(warranty.listWarrantyClaims()).rejects.toMatchObject({ code: '42501' })
  })
})
