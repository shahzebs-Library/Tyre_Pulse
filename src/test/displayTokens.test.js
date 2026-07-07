import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: chainable from() query builder + configurable rpc().
// Mirrors src/test/notifications.test.js.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, rpc: [], rpcResult: undefined }
  function from(table) {
    const calls = { order: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      order(col, opts) { calls.order.push([col, opts]); return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  function rpc(fn, args) {
    state.rpc.push([fn, args])
    return Promise.resolve(state.rpcResult ?? { data: null, error: null })
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const {
  isBackendMissing,
  buildDisplayUrl,
  shapeSnapshot,
  listDisplayTokens,
  createDisplayToken,
  revokeDisplayToken,
  getDisplaySnapshot,
} = await import('../lib/api/displayTokens')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.rpcResult = undefined
  h.state.last = null
  h.state.rpc = []
})

// ─────────────────────────────────────────────────────────────────────────────
// isBackendMissing — graceful-degradation code mapping
// ─────────────────────────────────────────────────────────────────────────────
describe('isBackendMissing', () => {
  it('maps V103-unapplied Postgres/PostgREST codes to true', () => {
    expect(isBackendMissing({ code: '42883' })).toBe(true)   // undefined_function
    expect(isBackendMissing({ code: '42P01' })).toBe(true)   // undefined_table
    expect(isBackendMissing({ code: 'PGRST202' })).toBe(true) // no function match
    expect(isBackendMissing({ code: 'PGRST205' })).toBe(true) // no table match
  })

  it('sniffs messages when no code is present', () => {
    expect(isBackendMissing({ message: 'function public.get_display_snapshot does not exist' })).toBe(true)
    expect(isBackendMissing({ message: 'relation "display_tokens" does not exist' })).toBe(true)
    expect(isBackendMissing({ message: 'Could not find the function public.create_display_token' })).toBe(true)
  })

  it('returns false for genuine errors and nullish input', () => {
    expect(isBackendMissing(null)).toBe(false)
    expect(isBackendMissing(undefined)).toBe(false)
    expect(isBackendMissing({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isBackendMissing({ message: 'permission denied' })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildDisplayUrl — pure URL builder
// ─────────────────────────────────────────────────────────────────────────────
describe('buildDisplayUrl', () => {
  it('builds an absolute board URL from an explicit origin', () => {
    expect(buildDisplayUrl('disp_abc', 'https://app.example.com')).toBe('https://app.example.com/display/disp_abc')
  })

  it('trims trailing slashes on the origin', () => {
    expect(buildDisplayUrl('disp_x', 'https://app.example.com/')).toBe('https://app.example.com/display/disp_x')
  })

  it('url-encodes the token and tolerates empties', () => {
    expect(buildDisplayUrl('a b', 'https://x.io')).toBe('https://x.io/display/a%20b')
    expect(buildDisplayUrl('', 'https://x.io')).toBe('https://x.io/display/')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// shapeSnapshot — snapshot shaping from the exact RPC keys
// ─────────────────────────────────────────────────────────────────────────────
describe('shapeSnapshot', () => {
  it('maps the full get_display_snapshot payload to camelCase board shape', () => {
    const s = shapeSnapshot({
      ok: true,
      name: 'Lobby',
      template: { pages: ['overview', 'risk'] },
      refresh_seconds: 45,
      rotate_seconds: 20,
      generated_at: '2026-07-07T00:00:00Z',
      branding: { name: 'Acme', logo_url: 'l.png', primary_color: '#123456' },
      kpis: {
        tyres_total: 10, spend_30d: 999.5, high_risk: 3, inspections_30d: 7,
        open_workorders: 2, open_accidents: 1, fleet_size: 12,
      },
      spend_trend: [{ month: '2026-06', spend: 500 }],
      risk_breakdown: [{ level: 'High', count: 4 }],
      recent_activity: [{ type: 'tyre.created', count: 6 }],
    })
    expect(s.name).toBe('Lobby')
    expect(s.pages).toEqual(['overview', 'risk'])
    expect(s.refreshSeconds).toBe(45)
    expect(s.rotateSeconds).toBe(20)
    expect(s.branding).toEqual({ name: 'Acme', logoUrl: 'l.png', primaryColor: '#123456' })
    expect(s.kpis).toEqual({
      tyresTotal: 10, spend30d: 999.5, highRisk: 3, inspections30d: 7,
      openWorkorders: 2, openAccidents: 1, fleetSize: 12,
    })
    expect(s.spendTrend).toEqual([{ month: '2026-06', spend: 500 }])
    expect(s.riskBreakdown).toEqual([{ level: 'High', count: 4 }])
    expect(s.recentActivity).toEqual([{ type: 'tyre.created', count: 6 }])
  })

  it('applies safe defaults and clamps cadence for a partial/missing payload', () => {
    const s = shapeSnapshot({})
    expect(s.pages).toEqual(['overview'])
    expect(s.refreshSeconds).toBe(60)
    expect(s.rotateSeconds).toBe(15)
    expect(s.kpis.tyresTotal).toBe(0)
    expect(s.spendTrend).toEqual([])
    expect(s.branding).toEqual({ name: null, logoUrl: null, primaryColor: null })

    const clamped = shapeSnapshot({ refresh_seconds: 999999, rotate_seconds: 1 })
    expect(clamped.refreshSeconds).toBe(3600) // clamped to max
    expect(clamped.rotateSeconds).toBe(5)     // clamped to min
  })

  it('tolerates non-array collections and bad numbers', () => {
    const s = shapeSnapshot({ spend_trend: null, kpis: { tyres_total: 'x' } })
    expect(s.spendTrend).toEqual([])
    expect(s.kpis.tyresTotal).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// listDisplayTokens — degrades on missing backend, surfaces real errors
// ─────────────────────────────────────────────────────────────────────────────
describe('listDisplayTokens', () => {
  it('queries display_tokens newest-first and returns rows', async () => {
    h.state.result = { data: [{ id: '1', name: 'Lobby' }], error: null }
    const res = await listDisplayTokens()
    expect(h.state.last._table).toBe('display_tokens')
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(res).toEqual({ available: true, tokens: [{ id: '1', name: 'Lobby' }], error: null })
  })

  it('never selects password_hash', async () => {
    await listDisplayTokens()
    expect(h.state.last._calls.select).not.toContain('password_hash')
  })

  it('returns available:false when V103 is unapplied (42P01)', async () => {
    h.state.result = { data: null, error: { code: '42P01', message: 'relation does not exist' } }
    expect(await listDisplayTokens()).toEqual({ available: false, tokens: [], error: null })
  })

  it('surfaces a genuine error without throwing', async () => {
    h.state.result = { data: null, error: { code: '42501', message: 'permission denied' } }
    const res = await listDisplayTokens()
    expect(res.available).toBe(true)
    expect(res.tokens).toEqual([])
    expect(res.error).toBe('permission denied')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createDisplayToken
// ─────────────────────────────────────────────────────────────────────────────
describe('createDisplayToken', () => {
  it('calls create_display_token with mapped params and returns id + token', async () => {
    h.state.rpcResult = { data: { id: 'uuid-1', token: 'disp_deadbeef' }, error: null }
    const res = await createDisplayToken({
      name: 'Lobby', template: { pages: ['overview'] },
      refreshSeconds: 30, rotateSeconds: 10, password: 'secret', expiresAt: '2026-08-01T00:00:00Z',
    })
    expect(h.state.rpc).toContainEqual(['create_display_token', {
      p_name: 'Lobby', p_template: { pages: ['overview'] },
      p_refresh_seconds: 30, p_rotate_seconds: 10, p_password: 'secret', p_expires_at: '2026-08-01T00:00:00Z',
    }])
    expect(res).toEqual({ available: true, id: 'uuid-1', token: 'disp_deadbeef', error: null })
  })

  it('coerces empty password/expiry to null', async () => {
    h.state.rpcResult = { data: { id: 'x', token: 't' }, error: null }
    await createDisplayToken({ name: 'X', password: '', expiresAt: '' })
    const args = h.state.rpc[0][1]
    expect(args.p_password).toBeNull()
    expect(args.p_expires_at).toBeNull()
  })

  it('returns available:false when the RPC is missing (42883)', async () => {
    h.state.rpcResult = { data: null, error: { code: '42883', message: 'function does not exist' } }
    expect(await createDisplayToken({ name: 'X' })).toEqual({ available: false, error: null })
  })

  it('surfaces a genuine RPC error', async () => {
    h.state.rpcResult = { data: null, error: { code: 'P0001', message: 'not authorised' } }
    expect(await createDisplayToken({ name: 'X' })).toEqual({ available: true, error: 'not authorised' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// revokeDisplayToken
// ─────────────────────────────────────────────────────────────────────────────
describe('revokeDisplayToken', () => {
  it('calls revoke_display_token with p_id', async () => {
    const res = await revokeDisplayToken('uuid-9')
    expect(h.state.rpc).toContainEqual(['revoke_display_token', { p_id: 'uuid-9' }])
    expect(res).toEqual({ available: true, error: null })
  })

  it('returns available:false when the RPC is missing (PGRST202)', async () => {
    h.state.rpcResult = { data: null, error: { code: 'PGRST202', message: 'no function' } }
    expect(await revokeDisplayToken('x')).toEqual({ available: false, error: null })
  })

  it('surfaces a genuine error', async () => {
    h.state.rpcResult = { data: null, error: { code: 'P0001', message: 'display token not found' } }
    expect(await revokeDisplayToken('x')).toEqual({ available: true, error: 'display token not found' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getDisplaySnapshot — three-way outcome mapping
// ─────────────────────────────────────────────────────────────────────────────
describe('getDisplaySnapshot', () => {
  it('calls get_display_snapshot with token + password', async () => {
    h.state.rpcResult = { data: { ok: true, kpis: {} }, error: null }
    await getDisplaySnapshot('disp_x', 'pw')
    expect(h.state.rpc).toContainEqual(['get_display_snapshot', { p_token: 'disp_x', p_password: 'pw' }])
  })

  it('passes null password when omitted', async () => {
    h.state.rpcResult = { data: { ok: true }, error: null }
    await getDisplaySnapshot('disp_x')
    expect(h.state.rpc[0][1].p_password).toBeNull()
  })

  it('returns ok:true with the raw snapshot on success', async () => {
    const payload = { ok: true, name: 'Lobby', kpis: {} }
    h.state.rpcResult = { data: payload, error: null }
    const res = await getDisplaySnapshot('disp_x')
    expect(res).toEqual({ available: true, ok: true, reason: null, snapshot: payload })
  })

  it('maps the token-gate failure signals from the RPC body', async () => {
    for (const reason of ['invalid_token', 'password_required', 'invalid_password']) {
      h.state.rpcResult = { data: { ok: false, error: reason }, error: null }
      const res = await getDisplaySnapshot('disp_x')
      expect(res).toEqual({ available: true, ok: false, reason, snapshot: null })
    }
  })

  it('defaults a missing/blank body to invalid_token', async () => {
    h.state.rpcResult = { data: null, error: null }
    expect(await getDisplaySnapshot('disp_x')).toEqual({ available: true, ok: false, reason: 'invalid_token', snapshot: null })
  })

  it('returns available:false when the RPC is missing (42883)', async () => {
    h.state.rpcResult = { data: null, error: { code: '42883', message: 'function does not exist' } }
    expect(await getDisplaySnapshot('disp_x')).toEqual({ available: false, ok: false, reason: null, snapshot: null })
  })

  it('maps a transport error to request_failed', async () => {
    h.state.rpcResult = { data: null, error: { code: '08006', message: 'connection failure' } }
    const res = await getDisplaySnapshot('disp_x')
    expect(res.available).toBe(true)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('request_failed')
    expect(res.error).toBe('connection failure')
  })
})
