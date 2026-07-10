import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors customData.api.test.js) with an
// rpc recorder for the workflow engine's SECURITY DEFINER RPCs.
const h = vi.hoisted(() => {
  const state = {
    result: { data: [], error: null, count: 0 },
    last: null,
    rpc: { data: null, error: null },
    lastRpc: null,
  }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  function from(table) {
    const calls = { eq: [], order: [], range: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = { cols, opts }; return b },
      order(col, opts) { calls.order.push([col, opts]); return b },
      range(a, z) { calls.range.push([a, z]); return b },
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
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const workflows = await import('../lib/api/workflows')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null, count: 0 }
  h.state.last = null
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - workflows: definitions CRUD', () => {
  it('lists definitions newest first', async () => {
    h.state.result = { data: [{ id: 'd1', name: 'PO approval' }], error: null, count: 0 }
    const rows = await workflows.listWorkflowDefinitions()
    expect(h.state.last._table).toBe('workflow_definitions')
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(rows).toEqual([{ id: 'd1', name: 'PO approval' }])
  })

  it('creates a definition and returns the inserted row', async () => {
    h.state.result = { data: { id: 'd2', name: 'Accident closure' }, error: null, count: 0 }
    const values = {
      name: 'Accident closure',
      entity_type: 'accident',
      steps: [{ name: 'Review', approver_role: 'manager', sla_hours: 24 }],
    }
    const row = await workflows.createWorkflowDefinition(values)
    expect(h.state.last._table).toBe('workflow_definitions')
    expect(h.state.last._calls.insert).toEqual(values)
    expect(row).toEqual({ id: 'd2', name: 'Accident closure' })
  })

  it('updates and deletes definitions by id', async () => {
    await workflows.updateWorkflowDefinition('d1', { active: false })
    expect(h.state.last._calls.update).toEqual({ active: false })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'd1'])

    await workflows.deleteWorkflowDefinition('d9')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'd9'])
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' }, count: 0 }
    await expect(workflows.listWorkflowDefinitions()).rejects.toBeInstanceOf(ServiceError)
    await expect(workflows.listWorkflowDefinitions()).rejects.toMatchObject({ code: '42501' })
  })
})

describe('service layer - workflows: instances + step events', () => {
  it('lists instances with exact count, latest started first, paged and status-filtered', async () => {
    h.state.result = { data: [{ id: 'i1', status: 'pending' }], error: null, count: 7 }
    const { rows, count } = await workflows.listWorkflowInstances({ status: 'pending', limit: 10, offset: 20 })
    expect(h.state.last._table).toBe('workflow_instances')
    expect(h.state.last._calls.select.opts).toEqual({ count: 'exact' })
    expect(h.state.last._calls.order).toContainEqual(['started_at', { ascending: false }])
    expect(h.state.last._calls.range).toContainEqual([20, 29])
    expect(h.state.last._calls.eq).toContainEqual(['status', 'pending'])
    expect(rows).toEqual([{ id: 'i1', status: 'pending' }])
    expect(count).toBe(7)
  })

  it('omits the status filter when not provided', async () => {
    await workflows.listWorkflowInstances()
    expect(h.state.last._calls.eq).toEqual([])
    expect(h.state.last._calls.range).toContainEqual([0, 49])
  })

  it('lists step events for one instance in chronological order', async () => {
    h.state.result = { data: [{ id: 1, action: 'started' }], error: null, count: 0 }
    const rows = await workflows.listStepEvents('i1')
    expect(h.state.last._table).toBe('workflow_step_events')
    expect(h.state.last._calls.eq).toContainEqual(['instance_id', 'i1'])
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: true }])
    expect(rows).toEqual([{ id: 1, action: 'started' }])
  })
})

describe('service layer - workflows: RPCs', () => {
  it('myPendingApprovals calls the my_pending_approvals RPC', async () => {
    h.state.rpc = { data: [{ id: 'i1' }], error: null }
    const rows = await workflows.myPendingApprovals()
    expect(h.state.lastRpc.name).toBe('my_pending_approvals')
    expect(rows).toEqual([{ id: 'i1' }])
  })

  it('startWorkflow maps camelCase args onto start_workflow p_* params', async () => {
    h.state.rpc = { data: 'uuid-1', error: null }
    const id = await workflows.startWorkflow({
      definitionId: 'd1',
      entityType: 'purchase_order',
      entityId: 'po-9',
      entityLabel: 'PO-9',
      context: { total: 1200 },
    })
    expect(h.state.lastRpc.name).toBe('start_workflow')
    expect(h.state.lastRpc.args).toEqual({
      p_definition_id: 'd1',
      p_entity_type: 'purchase_order',
      p_entity_id: 'po-9',
      p_entity_label: 'PO-9',
      p_context: { total: 1200 },
    })
    expect(id).toBe('uuid-1')
  })

  it('actOnWorkflow calls workflow_act with action and comment', async () => {
    h.state.rpc = { data: { status: 'approved' }, error: null }
    const res = await workflows.actOnWorkflow('i1', 'approve', 'LGTM')
    expect(h.state.lastRpc.name).toBe('workflow_act')
    expect(h.state.lastRpc.args).toEqual({
      p_instance_id: 'i1', p_action: 'approve', p_comment: 'LGTM',
      p_signature_data: null, p_printed_name: null, p_photo_urls: null,
      p_gps: null, p_device_info: null,
    })
    expect(res).toEqual({ status: 'approved' })
  })

  it('cancelWorkflow calls workflow_cancel (comment defaults to null)', async () => {
    await workflows.cancelWorkflow('i2')
    expect(h.state.lastRpc.name).toBe('workflow_cancel')
    expect(h.state.lastRpc.args).toEqual({ p_instance_id: 'i2', p_comment: null })
  })

  it('surfaces RPC errors as ServiceError', async () => {
    h.state.rpc = { data: null, error: { message: 'not authorised', code: 'P0001' } }
    await expect(workflows.actOnWorkflow('i1', 'reject')).rejects.toBeInstanceOf(ServiceError)
    await expect(workflows.actOnWorkflow('i1', 'reject')).rejects.toMatchObject({ code: 'P0001' })
  })
})
