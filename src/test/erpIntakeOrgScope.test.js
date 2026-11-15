import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TEN-1b made work_orders unique per (organisation_id, work_order_no). The ERP
 * work-order merge must therefore look for an existing job card inside the
 * caller's company only: the same number in another company is a different job
 * card, and merging into it would overwrite another tenant's row. RLS already
 * scopes an ordinary user; the explicit filter is what protects a super admin.
 */
const h = vi.hoisted(() => {
  const state = { org: null, rpcFails: false, existing: [], calls: [], inserted: [], updated: [] }
  function from(table) {
    const call = { table, eqs: [], usedIn: false }
    state.calls.push(call)
    const b = {
      select() { return b },
      not() { return b },
      gt() { return b },
      eq(c, v) { call.eqs.push([c, v]); return b },
      in() { call.usedIn = true; return b },
      order() { return b },
      range(f) { return Promise.resolve({ data: f === 0 ? state.existing : [], error: null }) },
      insert(rows) { state.inserted.push(...rows); return Promise.resolve({ error: null, data: null }) },
      update(patch) {
        return { eq(_c, id) { state.updated.push({ id, patch }); return Promise.resolve({ error: null, data: null }) } }
      },
      then(onF, onR) {
        return Promise.resolve({ data: call.usedIn ? state.existing : [], error: null }).then(onF, onR)
      },
    }
    return b
  }
  const rpc = async (name) => {
    if (name !== 'app_current_org') return { data: null, error: null }
    if (state.rpcFails) return { data: null, error: { code: 'PGRST202', message: 'not found' } }
    return { data: state.org, error: null }
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const intake = await import('../lib/api/erpIntake')

const ORG = '00000000-0000-0000-0000-000000000001'

beforeEach(() => {
  Object.assign(h.state, { org: ORG, rpcFails: false, existing: [], calls: [], inserted: [], updated: [] })
})

describe('insertWorkOrders stays inside the caller company', () => {
  it('reads existing job card numbers and their rows for the caller company only', async () => {
    h.state.existing = [{ id: 'w1', work_order_no: 'GCKR/JC/0001/0126', status: 'Open', organisation_id: ORG }]
    await intake.insertWorkOrders([
      { work_order_no: 'GCKR/JC/0001/0126', status: 'Completed' },
      { work_order_no: 'GCKR/JC/0002/0126', status: 'Open' },
    ])
    const reads = h.state.calls.filter((c) => c.table === 'work_orders')
    const existence = reads.find((c) => !c.usedIn && c.eqs.some(([k]) => k === 'organisation_id'))
    const overlap = reads.find((c) => c.usedIn)
    expect(existence.eqs).toContainEqual(['organisation_id', ORG])
    expect(overlap.eqs).toContainEqual(['organisation_id', ORG])
    // One company, every country: no country filter on the work-order merge.
    expect(reads.flatMap((c) => c.eqs).some(([k]) => k === 'country')).toBe(false)
    expect(h.state.inserted.map((r) => r.work_order_no)).toEqual(['GCKR/JC/0002/0126'])
  })

  it('an unreadable company keeps the RLS-only behaviour instead of blocking the import', async () => {
    h.state.rpcFails = true
    const res = await intake.insertWorkOrders([{ work_order_no: 'GCKR/JC/0009/0126', status: 'Open' }])
    expect(res.inserted).toBe(1)
    const eqs = h.state.calls.filter((c) => c.table === 'work_orders').flatMap((c) => c.eqs)
    expect(eqs.some(([k]) => k === 'organisation_id')).toBe(false)
  })
})
