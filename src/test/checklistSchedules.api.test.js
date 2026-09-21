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

  it('requests assignment-based compliance with explicit filters', async () => {
    h.state.result = { data: [{ due_count: 4 }], error: null }
    const rpc = vi.spyOn(h.supabase, 'rpc').mockResolvedValueOnce(h.state.result)
    const rows = await cs.getComplianceMonitor({
      from: '2026-09-01', to: '2026-09-30', country: 'KSA', site: 'Riyadh', templateId: 't1',
    })
    expect(rpc).toHaveBeenCalledWith('checklist_compliance_monitor', {
      p_from: '2026-09-01', p_to: '2026-09-30', p_country: 'KSA', p_site: 'Riyadh', p_template_id: 't1',
    })
    expect(rows).toEqual([{ due_count: 4 }])
  })

  it('requests approval age with the tenant-configured SLA threshold', async () => {
    h.state.result = { data: [{ approval_stage: 'supervisor', pending_count: 2, target_hours: 24 }], error: null }
    const rpc = vi.spyOn(h.supabase, 'rpc').mockResolvedValueOnce(h.state.result)
    const rows = await cs.getApprovalAgeMonitor({ country: 'KSA', templateId: 't1' })
    expect(rpc).toHaveBeenCalledWith('checklist_approval_sla_monitor', {
      p_country: 'KSA', p_template_id: 't1',
    })
    expect(rows[0].pending_count).toBe(2)
  })

  it('loads and saves tenant checklist governance through validated RPCs', async () => {
    const rpc = vi.spyOn(h.supabase, 'rpc')
      .mockResolvedValueOnce({ data: { industry_profile: 'mining' }, error: null })
      .mockResolvedValueOnce({ data: { industry_profile: 'logistics' }, error: null })
    rpc.mockClear()
    expect(await cs.getChecklistGovernancePolicy()).toEqual({ industry_profile: 'mining' })
    expect(await cs.saveChecklistGovernancePolicy({ industry_profile: 'logistics' }))
      .toEqual({ industry_profile: 'logistics' })
    expect(rpc).toHaveBeenNthCalledWith(1, 'get_checklist_governance_policy')
    expect(rpc).toHaveBeenNthCalledWith(2, 'save_checklist_governance_policy', {
      p_policy: { industry_profile: 'logistics' },
    })
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
    await cs.skipAssignment('a1', 'Asset out of service')
    expect(h.state.last._calls.update).toEqual({ status: 'skipped', skip_reason: 'Asset out of service' })
  })

  it('skipAssignment refuses an unaudited skip', async () => {
    await expect(cs.skipAssignment('a1', '  ')).rejects.toThrow(/reason is required/i)
  })
})
