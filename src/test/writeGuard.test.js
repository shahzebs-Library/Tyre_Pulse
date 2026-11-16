import { describe, it, expect, vi, beforeEach } from 'vitest'

// Row security refuses an UPDATE or DELETE by matching zero rows and raising
// nothing. These tests pin that every guarded write turns that silent zero into
// a refusal the page can show (MODA-7, MODB-7, MODB-3).
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, calls: [] }
  function from(table) {
    const calls = { table, eq: [], in: [], select: [] }
    const b = {
      _calls: calls,
      select(c) { calls.select.push(c); return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      insert(v) { calls.insert = v; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      in(c, v) { calls.in.push([c, v]); return b },
      ilike() { return b },
      order() { return b },
      limit() { return b },
      single() { return Promise.resolve(state.result) },
      maybeSingle() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    state.calls.push(calls)
    return b
  }
  return { state, supabase: { from, rpc: () => Promise.resolve({ data: null, error: null }), auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { expectRows, refuseEmpty, WriteRefusedError, isWriteRefused, WRITE_REFUSED_MESSAGE } = await import('../lib/api/writeGuard')
const { ServiceError } = await import('../lib/api/_client')
const { toUserMessage } = await import('../lib/safeError')
const correctiveActions = await import('../lib/api/correctiveActions')
const inspections = await import('../lib/api/inspections')
const tyreRecords = await import('../lib/api/tyreRecords')
const budgets = await import('../lib/api/budgets')
const workOrders = await import('../lib/api/workOrders')
const workshop = await import('../lib/api/workshopLive')
const assets = await import('../lib/api/assets')

const ZERO = { data: [], error: null }
const ONE = { data: [{ id: 'x1' }], error: null }
const DENIED = { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "x"' } }

beforeEach(() => { h.state.result = ZERO; h.state.last = null; h.state.calls = [] })

describe('writeGuard', () => {
  it('expectRows returns the changed rows and throws a refusal on zero rows', () => {
    expect(expectRows(ONE)).toEqual([{ id: 'x1' }])
    expect(expectRows({ data: { id: 'x1' }, error: null })).toEqual([{ id: 'x1' }])
    expect(() => expectRows(ZERO)).toThrow(WriteRefusedError)
    expect(() => expectRows({ data: null, error: null })).toThrow(WriteRefusedError)
    expect(() => expectRows(DENIED)).toThrow(ServiceError)
  })

  it('the refusal reaches the user as written and leaks no database wording', () => {
    let caught
    try { expectRows(ZERO) } catch (e) { caught = e }
    expect(isWriteRefused(caught)).toBe(true)
    expect(caught.code).toBeUndefined()
    expect(toUserMessage(caught, 'fallback')).toBe(WRITE_REFUSED_MESSAGE)
    expect(toUserMessage(caught)).not.toMatch(/row-level|policy|relation|column/i)
  })

  it('refuseEmpty turns a zero-row result into an error and leaves the rest alone', () => {
    expect(refuseEmpty(ONE)).toBe(ONE)
    expect(refuseEmpty(DENIED)).toBe(DENIED)
    const refused = refuseEmpty(ZERO, 'Not saved.')
    expect(refused.error).toBeInstanceOf(WriteRefusedError)
    expect(refused.error.message).toBe('Not saved.')
  })
})

describe('a refused update is reported, never shown as saved', () => {
  const throwing = [
    ['corrective action status change', () => correctiveActions.updateCorrectiveAction('ca1', { status: 'Closed' }), /Manager or an Admin/],
    ['inspection patch', () => inspections.patchInspection('i1', { status: 'Done' }), /inspection was not updated/],
    ['inspection delete', () => inspections.deleteInspection('i1'), /Only an Admin can delete/],
    ['budget status change', () => budgets.updateBudgetStatus('b1', 'Approved'), /budget status was not changed/],
    ['work order update', () => workOrders.updateWorkOrderById('w1', { status: 'Completed' }), /work order was not changed/],
    ['work order update (service form)', () => workOrders.updateWorkOrder('w1', { priority: 'High' }), /work order was not changed/],
    ['workshop live status move', () => workshop.setJobStatus('w1', 'In Progress'), /job was not changed/],
    ['workshop live priority', () => workshop.setJobPriority('w1', 'High'), /job was not changed/],
    ['workshop live vehicle off road', () => workshop.setVor('w1', true), /job was not changed/],
    ['workshop live QC', () => workshop.setQcStatus('w1', 'passed'), /job was not changed/],
    ['fleet register edit', () => assets.saveFleetRecord({ site: 'NHC' }, 'v1'), /vehicle was not updated/],
  ]
  for (const [name, run, message] of throwing) {
    it(`${name}: zero rows throws`, async () => {
      h.state.result = ZERO
      await expect(run()).rejects.toThrow(message)
      // The write asked for its changed rows back, which is what makes zero visible.
      expect(h.state.last._calls.select.length).toBeGreaterThan(0)
    })
    it(`${name}: a real change resolves`, async () => {
      h.state.result = ONE
      // Resolves without throwing (some writers return nothing on success).
      await run()
    })
  }

  it('a work order refusal no longer reads "Not found."', async () => {
    h.state.result = ZERO
    const err = await workshop.setJobStatus('w1', 'In Progress').catch((e) => e)
    expect(toUserMessage(err)).not.toBe('Not found.')
    expect(toUserMessage(err)).toMatch(/not allowed to change work orders/)
  })

  it('tyre record edit: zero rows comes back as an error, a real change does not', async () => {
    h.state.result = ZERO
    const refused = await tyreRecords.updateRecord('r1', { site: 'X' })
    expect(isWriteRefused(refused.error)).toBe(true)
    expect(toUserMessage(refused.error)).toMatch(/tyre record was not updated/)
    h.state.result = ONE
    expect((await tyreRecords.updateRecord('r1', { site: 'X' })).error).toBeNull()
  })

  it('tyre record bulk edit counts what the database changed', async () => {
    h.state.result = { data: [{ id: 'a' }], error: null }
    const part = await tyreRecords.updateRecordsByIds(['a', 'b', 'c'], { site: 'X' })
    expect(part).toMatchObject({ updated: 1, refused: 2, error: null })
    h.state.result = ZERO
    expect(await tyreRecords.updateRecordsByIds(['a', 'b'], { site: 'X' })).toMatchObject({ updated: 0, refused: 2 })
    expect(await tyreRecords.updateRecordsByIds([], { site: 'X' })).toMatchObject({ updated: 0, refused: 0 })
  })

  it('a database refusal with a code still maps to the permission sentence', async () => {
    h.state.result = DENIED
    const err = await correctiveActions.updateCorrectiveAction('ca1', { status: 'Closed' }).catch((e) => e)
    expect(toUserMessage(err)).toBe('You do not have permission to do that.')
  })
})
