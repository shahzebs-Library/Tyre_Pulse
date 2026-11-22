import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock (mirrors dataReconciliation.test.js): a chainable,
// thenable query builder that records every op, plus rpc() / auth.getUser().
const h = vi.hoisted(() => {
  const state = {
    tableResult: { data: [], error: null, count: 0 },
    resultByTable: {},
    rpc: { data: null, error: null },
    rpcByName: {},
    rpcCalls: [],
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
      range(...a) { record('range', ...a); return builder },
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
  function rpc(name, args) {
    state.lastRpc = { name, args }
    state.rpcCalls.push({ name, args })
    return Promise.resolve(state.rpcByName[name] || state.rpc)
  }
  const auth = { getUser() { return Promise.resolve(state.user) } }
  return { state, supabase: { from, rpc, auth } }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const svc = await import('./systemLogs')

beforeEach(() => {
  h.state.tableResult = { data: [], error: null, count: 0 }
  h.state.resultByTable = {}
  h.state.rpc = { data: null, error: null }
  h.state.rpcByName = {}
  h.state.rpcCalls = []
  h.state.user = { data: { user: { id: 'u-1' } }, error: null }
  h.state.calls = []
  h.state.lastRpc = null
  h.state.inserted = null
})

const opCalls = (op) => h.state.calls.filter((c) => c[0] === op)

const MISSING_RPC = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }

describe('systemLogs.listSystemLogs', () => {
  it('reads logs with their Error Center status through the status RPC', async () => {
    const rows = [{ id: 'l1', severity: 'error', group_status: 'resolved', is_open: false }]
    h.state.rpcByName.list_system_logs_with_status = { data: rows, error: null }
    const out = await svc.listSystemLogs({
      severity: 'error', module: 'accidents', status: 'closed', since: '2026-07-01T00:00:00Z', limit: 50,
    })
    expect(out).toEqual(rows)
    expect(h.state.lastRpc).toEqual({
      name: 'list_system_logs_with_status',
      args: { p_severity: 'error', p_module: 'accidents', p_status: 'closed', p_since: '2026-07-01T00:00:00Z', p_limit: 50 },
    })
    // never filters on the immutable system_logs.resolved column
    expect(opCalls('eq').map((c) => c[2])).not.toContain('resolved')
  })

  it('maps the legacy resolved flag onto open / closed', async () => {
    h.state.rpcByName.list_system_logs_with_status = { data: [], error: null }
    await svc.listSystemLogs({ resolved: false })
    expect(h.state.lastRpc.args.p_status).toBe('open')
    await svc.listSystemLogs({ resolved: true })
    expect(h.state.lastRpc.args.p_status).toBe('closed')
    await svc.listSystemLogs({})
    expect(h.state.lastRpc.args.p_status).toBeNull()
  })

  it('falls back to the table, all open, when the status RPC is not deployed', async () => {
    h.state.rpcByName.list_system_logs_with_status = MISSING_RPC
    h.state.tableResult = { data: [{ id: 'l1', severity: 'error', resolved: false }], error: null }
    const out = await svc.listSystemLogs({ severity: 'error' })
    expect(out).toEqual([{ id: 'l1', severity: 'error', resolved: false, group_status: null, is_open: true }])
    expect(opCalls('eq').map((c) => c[2])).not.toContain('resolved')
    expect(await svc.listSystemLogs({ status: 'closed' })).toEqual([])
  })

  it('degrades to [] on a missing relation', async () => {
    h.state.rpcByName.list_system_logs_with_status = { data: null, error: { message: 'relation "system_logs" does not exist', code: '42P01' } }
    expect(await svc.listSystemLogs()).toEqual([])
  })
})

describe('systemLogs.resolveSystemLog', () => {
  it('resolves the group behind the log with a reason and never updates system_logs', async () => {
    h.state.rpcByName.resolve_system_log_groups = { data: { ok: true, resolved: 1 }, error: null }
    const out = await svc.resolveSystemLog('l9', '  Fixed in release 2026-11-16  ')
    expect(out).toEqual({ ok: true, resolved: 1 })
    expect(h.state.lastRpc).toEqual({
      name: 'resolve_system_log_groups',
      args: { p_log_ids: ['l9'], p_module: null, p_severity: null, p_reason: 'Fixed in release 2026-11-16' },
    })
    expect(opCalls('update')).toHaveLength(0)
  })

  it('refuses without a reason, before calling the server', async () => {
    await expect(svc.resolveSystemLog('l9', '')).rejects.toThrow(/reason/i)
    await expect(svc.resolveSystemLog('l9', 'ok')).rejects.toThrow(/reason/i)
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('surfaces a permission refusal instead of pretending it worked', async () => {
    h.state.rpcByName.resolve_system_log_groups = { data: null, error: { code: '42501', message: 'Only a super admin can resolve errors' } }
    await expect(svc.resolveSystemLog('l9', 'valid reason')).rejects.toThrow()
  })
})

describe('systemLogs.resolveAllSystemLogs', () => {
  it('resolves matching open groups with a reason and returns the count', async () => {
    h.state.rpcByName.resolve_system_log_groups = { data: { ok: true, resolved: 4 }, error: null }
    const count = await svc.resolveAllSystemLogs({ module: 'ai', severity: 'error', reason: 'Known outage, closed' })
    expect(h.state.lastRpc).toEqual({
      name: 'resolve_system_log_groups',
      args: { p_log_ids: null, p_module: 'ai', p_severity: 'error', p_reason: 'Known outage, closed' },
    })
    expect(count).toBe(4)
  })

  it('requires a reason', async () => {
    await expect(svc.resolveAllSystemLogs()).rejects.toThrow(/reason/i)
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('falls back to the old RPC when the new one is not deployed', async () => {
    h.state.rpcByName.resolve_system_log_groups = MISSING_RPC
    h.state.rpcByName.resolve_system_logs = { data: 2, error: null }
    const count = await svc.resolveAllSystemLogs({ reason: 'cleanup after release' })
    expect(h.state.lastRpc).toEqual({ name: 'resolve_system_logs', args: { p_module: null, p_severity: null } })
    expect(count).toBe(2)
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

  it('does not call the RPC when the direct insert succeeds', async () => {
    h.state.tableResult = { data: null, error: null }
    await svc.logSystemEvent({ message: 'boom' })
    expect(h.state.lastRpc).toBeNull()
  })

  it('falls back to log_client_error when the direct insert is refused (signed out)', async () => {
    h.state.tableResult = { data: null, error: { message: 'permission denied', code: '42501' } }
    h.state.rpc = { data: true, error: null }
    const res = await svc.logSystemEvent({
      module_id: 'auth', severity: 'warning', source: 'login', message: 'boom',
      detail: { step: 1 }, reference_id: 'ERR-1', url: 'https://x/login', user_email: 'spoof@x',
    })
    expect(res).toEqual({ ok: true })
    expect(h.state.lastRpc.name).toBe('log_client_error')
    expect(h.state.lastRpc.args).toEqual({
      p_severity: 'warning', p_source: 'login', p_message: 'boom', p_module_id: 'auth',
      p_detail: { step: 1 }, p_reference_id: 'ERR-1', p_url: 'https://x/login',
      // Phase 0 attribution: surface, build, browser, screen and grouping key.
      p_platform: 'web', p_app_version: import.meta.env.VITE_APP_VERSION || null, p_device: null, p_screen: '/',
      p_fingerprint: 'login|boom',
    })
    // the server derives identity; a caller-supplied email is never forwarded
    expect(JSON.stringify(h.state.lastRpc.args)).not.toContain('spoof@x')
  })

  it('sends a non-object detail to the RPC as null and caps the message', async () => {
    h.state.tableResult = { data: null, error: { message: 'denied', code: '42501' } }
    h.state.rpc = { data: true, error: null }
    await svc.logSystemEvent({ message: 'x'.repeat(5000), detail: [1, 2] })
    expect(h.state.lastRpc.args.p_detail).toBeNull()
    expect(h.state.lastRpc.args.p_message).toHaveLength(2000)
  })

  it('never throws and returns {ok:false} when both the insert and the RPC fail', async () => {
    h.state.tableResult = { data: null, error: { message: 'denied', code: '42501' } }
    h.state.rpc = { data: null, error: { message: 'boom' } }
    const res = await svc.logSystemEvent({ message: 'boom' })
    expect(res).toEqual({ ok: false })
  })

  it('returns {ok:false} when the RPC rate-limits (returns false)', async () => {
    h.state.tableResult = { data: null, error: { message: 'denied', code: '42501' } }
    h.state.rpc = { data: false, error: null }
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

  it('counts open problems by Error Center status, not by the immutable log flag', async () => {
    h.state.rpcByName.system_log_open_counts = { data: { critical: 1, error: 4, warning: 2 }, error: null }
    const m = await svc.getHealthMetrics()
    expect(m.errors).toEqual({ unresolvedCritical: 1, unresolvedError: 4, total: 7 })
    const resolvedFilters = opCalls('eq').filter((c) => c[1] === 'system_logs' && c[2] === 'resolved')
    expect(resolvedFilters).toHaveLength(0)
  })

  it('a fully triaged log reads zero open, never the raw row count', async () => {
    h.state.rpcByName.system_log_open_counts = { data: {}, error: null }
    h.state.resultByTable = { system_logs: { data: [], error: null, count: 105 } }
    const m = await svc.getHealthMetrics()
    expect(m.errors).toEqual({ unresolvedCritical: 0, unresolvedError: 0, total: 0 })
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
