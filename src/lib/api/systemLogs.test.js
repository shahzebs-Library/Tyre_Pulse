import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock (mirrors dataReconciliation.test.js): a chainable,
// thenable query builder that records every op, plus rpc() / auth.getUser().
const h = vi.hoisted(() => {
  const state = {
    tableResult: { data: [], error: null, count: 0 },
    resultByTable: {},
    rpc: { data: null, error: null },
    user: { data: { user: { id: 'u-1' } }, error: null },
    calls: [],
    lastRpc: null,
    inserted: null,
  }
  function makeBuilder(table) {
    const record = (op, ...args) => { state.calls.push([op, table, ...args]) }
    const builder = {
      select(...a) { record('select', ...a); return builder },
      order(...a) { record('order', ...a); return builder },
      limit(...a) { record('limit', ...a); return builder },
      eq(col, val) { record('eq', col, val); return builder },
      gte(col, val) { record('gte', col, val); return builder },
      update(p) { record('update', p); return builder },
      insert(p) { state.inserted = { table, payload: p }; record('insert', p); return builder },
      single() { record('single'); return builder },
      then(resolve, reject) {
        const r = state.resultByTable[table] || state.tableResult
        return Promise.resolve(r).then(resolve, reject)
      },
    }
    return builder
  }
  function from(table) { return makeBuilder(table) }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  const auth = { getUser() { return Promise.resolve(state.user) } }
  return { state, supabase: { from, rpc, auth } }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const svc = await import('./systemLogs')

beforeEach(() => {
  h.state.tableResult = { data: [], error: null, count: 0 }
  h.state.resultByTable = {}
  h.state.rpc = { data: null, error: null }
  h.state.user = { data: { user: { id: 'u-1' } }, error: null }
  h.state.calls = []
  h.state.lastRpc = null
  h.state.inserted = null
})

const opCalls = (op) => h.state.calls.filter((c) => c[0] === op)

describe('systemLogs.listSystemLogs', () => {
  it('applies severity / module / resolved / since eq+gte filters', async () => {
    const rows = [{ id: 'l1', severity: 'error', module_id: 'accidents', resolved: false }]
    h.state.tableResult = { data: rows, error: null }
    const out = await svc.listSystemLogs({
      severity: 'error', module: 'accidents', resolved: false, since: '2026-07-01T00:00:00Z', limit: 50,
    })
    expect(out).toEqual(rows)
    const eqs = opCalls('eq').map((c) => [c[2], c[3]])
    expect(eqs).toContainEqual(['severity', 'error'])
    expect(eqs).toContainEqual(['module_id', 'accidents'])
    expect(eqs).toContainEqual(['resolved', false])
    const gtes = opCalls('gte').map((c) => [c[2], c[3]])
    expect(gtes).toContainEqual(['created_at', '2026-07-01T00:00:00Z'])
    expect(opCalls('limit')[0][2]).toBe(50)
  })

  it('does not add a resolved filter when the flag is omitted', async () => {
    await svc.listSystemLogs({ severity: 'critical' })
    const eqCols = opCalls('eq').map((c) => c[2])
    expect(eqCols).toContain('severity')
    expect(eqCols).not.toContain('resolved')
  })

  it('degrades to [] on a missing relation', async () => {
    h.state.tableResult = { data: null, error: { message: 'relation "system_logs" does not exist', code: '42P01' } }
    expect(await svc.listSystemLogs()).toEqual([])
  })
})

describe('systemLogs.resolveSystemLog', () => {
  it('stamps resolved/resolved_at/resolved_by and returns the row', async () => {
    const row = { id: 'l9', resolved: true }
    h.state.tableResult = { data: row, error: null }
    const out = await svc.resolveSystemLog('l9')
    expect(out).toEqual(row)
    const update = opCalls('update')[0][2]
    expect(update.resolved).toBe(true)
    expect(update.resolved_by).toBe('u-1')
    expect(typeof update.resolved_at).toBe('string')
    expect(opCalls('eq')).toContainEqual(['eq', 'system_logs', 'id', 'l9'])
  })

  it('falls back to null resolved_by when no auth user', async () => {
    h.state.user = { data: { user: null }, error: null }
    h.state.tableResult = { data: { id: 'l9' }, error: null }
    await svc.resolveSystemLog('l9')
    expect(opCalls('update')[0][2].resolved_by).toBeNull()
  })
})

describe('systemLogs.resolveAllSystemLogs', () => {
  it('calls resolve_system_logs with p_module/p_severity and returns the count', async () => {
    h.state.rpc = { data: 4, error: null }
    const count = await svc.resolveAllSystemLogs({ module: 'ai', severity: 'error' })
    expect(h.state.lastRpc.name).toBe('resolve_system_logs')
    expect(h.state.lastRpc.args).toEqual({ p_module: 'ai', p_severity: 'error' })
    expect(count).toBe(4)
  })

  it('passes nulls when unscoped', async () => {
    h.state.rpc = { data: 0, error: null }
    await svc.resolveAllSystemLogs()
    expect(h.state.lastRpc.args).toEqual({ p_module: null, p_severity: null })
  })
})

describe('systemLogs.logSystemEvent', () => {
  it('inserts the event and returns {ok:true}', async () => {
    h.state.tableResult = { data: null, error: null }
    const res = await svc.logSystemEvent({ module_id: 'accidents', message: 'boom', severity: 'critical' })
    expect(res).toEqual({ ok: true })
    expect(h.state.inserted.table).toBe('system_logs')
    expect(h.state.inserted.payload.message).toBe('boom')
    expect(h.state.inserted.payload.severity).toBe('critical')
    // DB defaults handle these - never sent from the client
    expect(h.state.inserted.payload).not.toHaveProperty('organisation_id')
    expect(h.state.inserted.payload).not.toHaveProperty('user_id')
  })

  it('skips (no insert) when the message is empty', async () => {
    const res = await svc.logSystemEvent({ message: '   ' })
    expect(res).toEqual({ ok: false })
    expect(h.state.inserted).toBeNull()
  })

  it('never throws and returns {ok:false} on an insert error', async () => {
    h.state.tableResult = { data: null, error: { message: 'denied', code: '42501' } }
    const res = await svc.logSystemEvent({ message: 'boom' })
    expect(res).toEqual({ ok: false })
  })
})

describe('systemLogs.getHealthMetrics', () => {
  it('returns aggregated counts and timestamps on the happy path', async () => {
    h.state.resultByTable = {
      tyre_records: { data: [{ created_at: '2026-07-16T10:00:00Z' }], error: null },
      inspections: { data: [{ created_at: '2026-07-15T10:00:00Z' }], error: null },
      accidents: { data: [], error: null },
      work_orders: { data: [{ created_at: '2026-07-14T10:00:00Z' }], error: null },
      system_logs: { data: [{ created_at: '2026-07-16T01:00:00Z' }, { created_at: '2026-07-16T02:00:00Z' }], error: null, count: 3 },
      ai_token_logs: { data: [], error: null, count: 9 },
      report_send_log: { data: [], error: null, count: 5 },
    }
    const m = await svc.getHealthMetrics()
    expect(m.latestByStream.tyre_records).toBe('2026-07-16T10:00:00Z')
    expect(m.latestByStream.accidents).toBeNull()
    expect(m.latestByStream.work_orders).toBe('2026-07-14T10:00:00Z')
    expect(m.errors.total).toBe(3)
    expect(m.ai.total).toBe(9)
    expect(m.reports.total).toBe(5)
    expect(m.logsByDay).toEqual([{ day: '2026-07-16', count: 2 }])
  })

  it('survives a missing table: shape with nulls/0s', async () => {
    h.state.tableResult = { data: null, error: { message: 'system_logs does not exist', code: '42P01' }, count: undefined }
    const m = await svc.getHealthMetrics()
    expect(m).toEqual({
      latestByStream: { tyre_records: null, inspections: null, accidents: null, work_orders: null },
      errors: { unresolvedCritical: 0, unresolvedError: 0, total: 0 },
      ai: { total: 0, errors: 0 },
      reports: { total: 0, failed: 0 },
      logsByDay: [],
    })
  })
})
