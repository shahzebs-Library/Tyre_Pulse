import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable Supabase mock + rpc stub, matching accidentsPage.api.test.js style.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, rpc: null }
  function from(table) {
    const calls = { eq: [], or: [] }
    const b = {
      _table: table, _calls: calls,
      select(cols) { calls.select = cols; return b },
      order() { return b },
      limit() { return b },
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
  function rpc(name, args) { state.rpc = { name, args }; return Promise.resolve({ data: 5, error: null }) }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const cs = await import('../lib/api/checklistSchedules')

beforeEach(() => { h.state.result = { data: [], error: null }; h.state.last = null; h.state.rpc = null })

describe('checklist schedules service', () => {
  it('listSchedules scopes by active + country', async () => {
    h.state.result = { data: [{ id: 's1' }], error: null }
    await cs.listSchedules({ active: true, country: 'KSA' })
    expect(h.state.last._table).toBe('checklist_schedules')
    expect(h.state.last._calls.eq).toContainEqual(['active', true])
    expect(h.state.last._calls.or[0]).toMatch(/country\.eq\.KSA/)
  })

  it('createSchedule normalises arrays and defaults cadence', async () => {
    h.state.result = { data: { id: 's1' }, error: null }
    await cs.createSchedule({ template_id: 't1', name: 'Weekly safety', sites: ['A', 'B'] })
    const ins = h.state.last._calls.insert
    expect(ins.template_id).toBe('t1')
    expect(ins.cadence).toBe('weekly')
    expect(ins.sites).toEqual(['A', 'B'])
    expect(ins.asset_nos).toEqual([])
  })

  it('generateNow calls the RPC', async () => {
    const n = await cs.generateNow()
    expect(h.state.rpc.name).toBe('generate_checklist_assignments')
    expect(n).toBe(5)
  })

  it('listAssignments filters by status + template', async () => {
    await cs.listAssignments({ status: 'overdue', templateId: 't1', country: 'KSA' })
    expect(h.state.last._table).toBe('checklist_assignments')
    expect(h.state.last._calls.eq).toContainEqual(['status', 'overdue'])
    expect(h.state.last._calls.eq).toContainEqual(['template_id', 't1'])
  })

  it('completeAssignment sets status + submission + completed_at', async () => {
    h.state.result = { data: { id: 'a1', status: 'completed' }, error: null }
    await cs.completeAssignment('a1', 'sub1')
    const up = h.state.last._calls.update
    expect(up.status).toBe('completed')
    expect(up.submission_id).toBe('sub1')
    expect(up.completed_at).toBeTruthy()
    expect(h.state.last._calls.eq).toContainEqual(['id', 'a1'])
  })

  it('skipAssignment sets status skipped', async () => {
    h.state.result = { data: { id: 'a1' }, error: null }
    await cs.skipAssignment('a1')
    expect(h.state.last._calls.update).toEqual({ status: 'skipped' })
  })
})
