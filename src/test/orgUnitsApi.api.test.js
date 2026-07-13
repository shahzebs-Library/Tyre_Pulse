import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted chainable Supabase mock (mirrors alertThresholds.api.test.js): records
// the table, insert/update payloads and eq filters, resolves to a configurable
// { data, error }. Used to assert the org_units / user_org_assignments service
// validation and payload shaping without a live database.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
      limit() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
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

const orgUnits = await import('../lib/api/orgUnits')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - org units', () => {
  it('lists units from org_units', async () => {
    h.state.result = { data: [{ id: 'u1', name: 'HQ' }], error: null }
    const rows = await orgUnits.listUnits({})
    expect(h.state.last._table).toBe('org_units')
    expect(rows).toEqual([{ id: 'u1', name: 'HQ' }])
  })

  it('createUnit requires a name and a valid type', async () => {
    await expect(orgUnits.createUnit({ unit_type: 'company' })).rejects.toThrow(/name is required/i)
    await expect(orgUnits.createUnit({ name: 'X', unit_type: 'nope' })).rejects.toThrow(/valid unit type/i)
  })

  it('createUnit shapes the payload and defaults active=true', async () => {
    h.state.result = { data: { id: 'n1' }, error: null }
    await orgUnits.createUnit({ name: '  Eastern  ', unit_type: 'region', code: 'ER' })
    expect(h.state.last._table).toBe('org_units')
    expect(h.state.last._calls.insert).toMatchObject({ name: 'Eastern', unit_type: 'region', code: 'ER', active: true })
  })
})

describe('service layer - org unit assignments', () => {
  it('lists all assignments from user_org_assignments', async () => {
    h.state.result = { data: [{ id: 'a1' }], error: null }
    const rows = await orgUnits.listAssignments({})
    expect(h.state.last._table).toBe('user_org_assignments')
    expect(rows).toEqual([{ id: 'a1' }])
  })

  it('scopes the list by org_unit_id when a unitId is passed', async () => {
    await orgUnits.listAssignments({ unitId: 'u9' })
    expect(h.state.last._calls.eq).toContainEqual(['org_unit_id', 'u9'])
  })

  it('createAssignment requires both a user and a unit', async () => {
    await expect(orgUnits.createAssignment({ org_unit_id: 'u1' })).rejects.toThrow(/user is required/i)
    await expect(orgUnits.createAssignment({ user_id: 'x1' })).rejects.toThrow(/unit is required/i)
  })

  it('createAssignment shapes payload, coerces is_primary and normalises dates', async () => {
    h.state.result = { data: { id: 'a1' }, error: null }
    await orgUnits.createAssignment({
      user_id: 'x1', org_unit_id: 'u1', role: 'Manager',
      is_primary: 'yes', starts_at: '2026-01-01', ends_at: '',
    })
    const p = h.state.last._calls.insert
    expect(p.user_id).toBe('x1')
    expect(p.org_unit_id).toBe('u1')
    expect(p.role).toBe('Manager')
    expect(p.is_primary).toBe(true)
    expect(p.starts_at).toMatch(/^2026-01-01T/)
    expect(p.ends_at).toBeNull()
  })

  it('updateAssignment patches only supplied fields and coerces is_primary', async () => {
    h.state.result = { data: { id: 'a1' }, error: null }
    await orgUnits.updateAssignment('a1', { is_primary: false, role: 'Lead' })
    expect(h.state.last._calls.update).toEqual({ is_primary: false, role: 'Lead' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'a1'])
  })

  it('deleteAssignment removes by id', async () => {
    await orgUnits.deleteAssignment('a9')
    expect(h.state.last._table).toBe('user_org_assignments')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'a9'])
  })
})
