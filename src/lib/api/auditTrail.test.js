import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock (mirrors systemLogs.test.js): a chainable, thenable query
// builder that records every op and resolves per-table to a configurable result.
const h = vi.hoisted(() => {
  const state = {
    tableResult: { data: [], error: null },
    resultByTable: {},
    calls: [],
    lastTable: null,
  }
  function makeBuilder(table) {
    const record = (op, ...args) => { state.calls.push([op, table, ...args]) }
    const builder = {
      select(...a) { record('select', ...a); return builder },
      order(...a) { record('order', ...a); return builder },
      limit(...a) { record('limit', ...a); return builder },
      eq(col, val) { record('eq', col, val); return builder },
      gte(col, val) { record('gte', col, val); return builder },
      ilike(col, val) { record('ilike', col, val); return builder },
      then(resolve, reject) {
        const r = state.resultByTable[table] || state.tableResult
        return Promise.resolve(r).then(resolve, reject)
      },
    }
    return builder
  }
  function from(table) { state.lastTable = table; return makeBuilder(table) }
  return { state, supabase: { from } }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const svc = await import('./auditTrail')

beforeEach(() => {
  h.state.tableResult = { data: [], error: null }
  h.state.resultByTable = {}
  h.state.calls = []
  h.state.lastTable = null
})

const opCalls = (op) => h.state.calls.filter((c) => c[0] === op)
const tableOf = (op) => h.state.calls.filter((c) => c[0] === op).map((c) => c[1])

describe('auditTrail.AUDIT_SOURCES', () => {
  it('exposes the three unified sources in display order', () => {
    expect(svc.AUDIT_SOURCES.map((s) => s.key)).toEqual([
      'audit_log_v2', 'access_audit', 'console_sessions',
    ])
    svc.AUDIT_SOURCES.forEach((s) => expect(typeof s.label).toBe('string'))
  })
})

describe('auditTrail.listDataAudit', () => {
  it('queries audit_log_v2 with eq/ilike/gte filters newest first', async () => {
    const rows = [{
      id: 'd1', user_email: 'a@x.com', user_role: 'Admin', action: 'update',
      table_name: 'tyre_records', record_id: 'r9',
      old_values: { status: 'A' }, new_values: { status: 'B' },
      site: 'NHC', country: 'KSA', created_at: '2026-07-16T10:00:00Z',
    }]
    h.state.tableResult = { data: rows, error: null }
    const out = await svc.listDataAudit({
      action: 'update', table: 'tyre', user: 'a@x', since: '2026-07-01T00:00:00Z', limit: 50,
    })
    expect(tableOf('select')).toEqual(['audit_log_v2'])
    const eqs = opCalls('eq').map((c) => [c[2], c[3]])
    expect(eqs).toContainEqual(['action', 'update'])
    const ilikes = opCalls('ilike').map((c) => [c[2], c[3]])
    expect(ilikes).toContainEqual(['table_name', '%tyre%'])
    expect(ilikes).toContainEqual(['user_email', '%a@x%'])
    expect(opCalls('gte').map((c) => [c[2], c[3]])).toContainEqual(['created_at', '2026-07-01T00:00:00Z'])
    expect(opCalls('order')[0].slice(2)).toEqual(['created_at', { ascending: false }])
    expect(opCalls('limit')[0][2]).toBe(50)
    // normalised shape
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 'd1', actor: 'a@x.com', action: 'update', source: 'audit_log_v2',
      old: { status: 'A' }, new: { status: 'B' }, role: 'Admin',
    })
    expect(out[0].target).toBe('tyre_records r9')
  })

  it('omits filters that are not provided', async () => {
    await svc.listDataAudit({})
    expect(opCalls('eq')).toHaveLength(0)
    expect(opCalls('ilike')).toHaveLength(0)
    expect(opCalls('gte')).toHaveLength(0)
  })

  it('degrades to [] on a read/permission error', async () => {
    h.state.tableResult = { data: null, error: { message: 'denied', code: '42501' } }
    expect(await svc.listDataAudit({ action: 'update' })).toEqual([])
  })
})

describe('auditTrail.listAccessAudit', () => {
  it('queries access_audit ordered by at with eq/ilike/gte filters', async () => {
    const rows = [{
      id: 'a1', actor_email: 'admin@x.com', actor: 'u-1', action: 'set_role',
      target_user: 'u-9', entity: 'profiles',
      before: { role: 'Reporter' }, after: { role: 'Manager' }, at: '2026-07-16T09:00:00Z',
    }]
    h.state.tableResult = { data: rows, error: null }
    const out = await svc.listAccessAudit({
      action: 'set_role', target: 'u-9', since: '2026-07-01T00:00:00Z', limit: 20,
    })
    expect(tableOf('select')).toEqual(['access_audit'])
    expect(opCalls('eq').map((c) => [c[2], c[3]])).toContainEqual(['action', 'set_role'])
    expect(opCalls('ilike').map((c) => [c[2], c[3]])).toContainEqual(['target_user', '%u-9%'])
    expect(opCalls('gte').map((c) => [c[2], c[3]])).toContainEqual(['at', '2026-07-01T00:00:00Z'])
    expect(opCalls('order')[0].slice(2)).toEqual(['at', { ascending: false }])
    expect(out[0]).toMatchObject({
      id: 'a1', actor: 'admin@x.com', action: 'set_role', target: 'u-9 profiles',
      source: 'access_audit', old: { role: 'Reporter' }, new: { role: 'Manager' },
    })
    expect(out[0].when).toBe('2026-07-16T09:00:00Z')
  })

  it('degrades to [] on error', async () => {
    h.state.tableResult = { data: null, error: { message: 'boom' } }
    expect(await svc.listAccessAudit({})).toEqual([])
  })
})

describe('auditTrail.listConsoleAudit', () => {
  it('queries console_sessions with eq/gte filters newest first', async () => {
    const rows = [{
      id: 'c1', admin_id: 'admin-1', action: 'lock_user', target_id: 'u-2',
      target_type: 'user', details: { reason: 'abuse' }, created_at: '2026-07-16T08:00:00Z',
    }]
    h.state.tableResult = { data: rows, error: null }
    const out = await svc.listConsoleAudit({ action: 'lock_user', since: '2026-07-01T00:00:00Z' })
    expect(tableOf('select')).toEqual(['console_sessions'])
    expect(opCalls('eq').map((c) => [c[2], c[3]])).toContainEqual(['action', 'lock_user'])
    expect(opCalls('gte').map((c) => [c[2], c[3]])).toContainEqual(['created_at', '2026-07-01T00:00:00Z'])
    expect(opCalls('order')[0].slice(2)).toEqual(['created_at', { ascending: false }])
    expect(out[0]).toMatchObject({
      id: 'c1', actor: 'admin-1', action: 'lock_user', target: 'user u-2',
      source: 'console_sessions', old: null, new: null,
    })
    expect(out[0].detail).toBe('reason: abuse')
  })

  it('defaults the limit to 200 when not given', async () => {
    await svc.listConsoleAudit({})
    expect(opCalls('limit')[0][2]).toBe(200)
  })

  it('degrades to [] on error', async () => {
    h.state.tableResult = { data: null, error: { message: 'boom' } }
    expect(await svc.listConsoleAudit({})).toEqual([])
  })
})

describe('auditTrail.normalizeRow', () => {
  it('maps an audit_log_v2 row (with before/after)', () => {
    const n = svc.normalizeRow('audit_log_v2', {
      id: 1, user_email: 'x@y.com', user_role: 'Manager', action: 'delete',
      table_name: 'accidents', record_id: 'a5',
      old_values: { a: 1 }, new_values: null, created_at: 't',
    })
    expect(n).toMatchObject({
      id: 1, when: 't', actor: 'x@y.com', action: 'delete',
      target: 'accidents a5', source: 'audit_log_v2', old: { a: 1 }, new: null, role: 'Manager',
    })
  })

  it('falls back to user_id when user_email is absent', () => {
    const n = svc.normalizeRow('audit_log_v2', { id: 2, user_id: 'u-7', action: 'insert' })
    expect(n.actor).toBe('u-7')
  })

  it('maps an access_audit row', () => {
    const n = svc.normalizeRow('access_audit', {
      id: 3, actor: 'u-1', action: 'grant', target_user: 'u-2', entity: 'module', at: 't2',
    })
    expect(n).toMatchObject({
      id: 3, when: 't2', actor: 'u-1', action: 'grant', target: 'u-2 module', source: 'access_audit',
    })
  })

  it('maps a console_sessions row and stringifies details', () => {
    const n = svc.normalizeRow('console_sessions', {
      id: 4, admin_id: 'admin-9', action: 'update_config',
      target_type: 'system', details: { key: 'palette', value: 'Vivid' }, created_at: 't3',
    })
    expect(n).toMatchObject({
      id: 4, when: 't3', actor: 'admin-9', action: 'update_config',
      target: 'system', source: 'console_sessions', old: null, new: null,
    })
    expect(n.detail).toBe('key: palette, value: Vivid')
  })

  it('defensively maps an unknown source without throwing', () => {
    const n = svc.normalizeRow('mystery', { id: 5, action: 'x' })
    expect(n).toMatchObject({ id: 5, action: 'x', source: 'mystery', old: null, new: null })
  })
})

describe('auditTrail.listAudit dispatch', () => {
  it('routes each source key to the matching table', async () => {
    await svc.listAudit('audit_log_v2', {})
    await svc.listAudit('access_audit', {})
    await svc.listAudit('console_sessions', {})
    expect(tableOf('select')).toEqual(['audit_log_v2', 'access_audit', 'console_sessions'])
  })
})
