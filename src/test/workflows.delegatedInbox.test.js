import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { rows: {} }
  function from(table) {
    const query = {
      select() { return query },
      eq() { return query },
      in() { return query },
      order() { return query },
      range() { return query },
      then(resolve, reject) {
        return Promise.resolve({ data: state.rows[table] || [], error: null }).then(resolve, reject)
      },
    }
    return query
  }
  return {
    state,
    supabase: {
      from,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'delegate' } } }) },
    },
  }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { myDelegatedApprovals } = await import('../lib/api/workflows')

beforeEach(() => {
  h.state.rows = {
    approval_delegations: [{
      id: 'delegation-1',
      delegator_id: 'manager',
      delegate_id: 'delegate',
      entity_type: 'work_order',
      active: true,
      approval_workflow_id: 'workflow-1',
      approval_stage_token: 'workflow-1:0:3',
    }],
    profiles: [{ id: 'manager', role: 'Manager' }],
    workflow_instances: [
      { id: 'workflow-1', entity_type: 'work_order', current_step: 0, approval_route_revision: 3, steps: [{ approver_role: 'Manager' }] },
      { id: 'workflow-2', entity_type: 'work_order', current_step: 0, approval_route_revision: 1, steps: [{ approver_role: 'Manager' }] },
      { id: 'workflow-3', entity_type: 'work_order', current_step: 1, approval_route_revision: 3, steps: [{ approver_role: 'Manager' }, { approver_role: 'Manager' }] },
    ],
  }
})

describe('delegated workflow inbox', () => {
  it('only includes the workflow and exact stage named by a governed delegation', async () => {
    const rows = await myDelegatedApprovals()
    expect(rows.map(row => row.id)).toEqual(['workflow-1'])
    expect(rows[0]).toMatchObject({ viaDelegation: true, delegatedFrom: 'manager' })
  })
})
