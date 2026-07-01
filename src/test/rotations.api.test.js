import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors src/test/api.test.js) with a
// range() method so fetchAllPages — used by listRotationRecords — resolves.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], range: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
      limit() { return b },
      range(f, t) { calls.range.push([f, t]); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
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

const rotations = await import('../lib/api/rotations')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer — rotations (tyre_rotations)', () => {
  it('lists from tyre_rotations with null-safe country scoping', async () => {
    h.state.result = { data: [{ id: 'r1', asset_no: 'V-1' }], error: null }
    const rows = await rotations.listRotations({ country: 'KSA' })
    expect(h.state.last._table).toBe('tyre_rotations')
    expect(h.state.last._calls.or).toContain('country.eq.KSA,country.is.null')
    expect(rows).toEqual([{ id: 'r1', asset_no: 'V-1' }])
  })

  it('does NOT filter country for "All"', async () => {
    await rotations.listRotations({ country: 'All' })
    expect(h.state.last._calls.or).toHaveLength(0)
  })

  it('updateRotation patches by id and deleteRotation removes by id', async () => {
    await rotations.updateRotation('r1', { status: 'Done' })
    expect(h.state.last._calls.update).toEqual({ status: 'Done' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'r1'])

    await rotations.deleteRotation('r2')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'r2'])
  })

  it('listRotationRecords reads tyre_records with STRICT country eq (not null-inclusive)', async () => {
    h.state.result = { data: [{ id: 't1' }], error: null }
    const recs = await rotations.listRotationRecords({ country: 'UAE' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.eq).toContainEqual(['country', 'UAE'])
    expect(h.state.last._calls.or).toHaveLength(0)
    expect(recs).toEqual([{ id: 't1' }])
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(rotations.listRotations()).rejects.toBeInstanceOf(ServiceError)
    await expect(rotations.listRotations()).rejects.toMatchObject({ code: '42501' })
  })
})
