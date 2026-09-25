import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  clampMinutes, durationError, reasonError, capabilityError, validateRequest, remainingMs,
  effectiveStatus, formatRemaining, formatMinutes, elapsedPct, summarize, partition, filterRows,
  canTransition, JIT_CAPABILITIES, MAX_MINUTES,
} from '../lib/jitElevation'

const NOW = Date.parse('2026-09-25T12:00:00Z')
const iso = (ms) => new Date(ms).toISOString()

describe('jitElevation rules', () => {
  it('clamps duration to 5..480 and never guesses on junk', () => {
    expect(clampMinutes(1)).toBe(5)
    expect(clampMinutes(9999)).toBe(MAX_MINUTES)
    expect(clampMinutes('60')).toBe(60)
    expect(clampMinutes(null)).toBeNull()
    expect(clampMinutes('abc')).toBeNull()
    expect(clampMinutes(200, 90)).toBe(90)
  })
  it('explains bad durations, reasons and capabilities', () => {
    expect(durationError(4)).toMatch(/at least 5/)
    expect(durationError(481)).toMatch(/8 hours/)
    expect(durationError(30.5)).toMatch(/whole/)
    expect(durationError(null)).toMatch(/Enter/)
    expect(durationError(60)).toBeNull()
    expect(reasonError('short')).toMatch(/10 characters/)
    expect(reasonError('a genuine reason')).toBeNull()
    expect(capabilityError('delete')).toBeTruthy()
    expect(JIT_CAPABILITIES.map((c) => c.key)).not.toContain('delete')
  })
  it('validates a whole request', () => {
    expect(validateRequest({})).toHaveProperty('userId')
    const ok = validateRequest({ userId: 'u', moduleKey: 'stock', capability: 'edit', minutes: 60, reason: 'month end count' })
    expect(ok).toEqual({})
    expect(validateRequest({ moduleKey: 'stock', capability: 'edit', minutes: 60, reason: 'month end count' }, { requireUser: false })).toEqual({})
    expect(validateRequest({ userId: 'u', moduleKey: 'Bad Key!', capability: 'edit', minutes: 60, reason: 'month end count' })).toHaveProperty('moduleKey')
  })
  it('follows the status machine', () => {
    expect(canTransition('pending', 'approved')).toBe(true)
    expect(canTransition('approved', 'revoked')).toBe(true)
    expect(canTransition('denied', 'approved')).toBe(false)
    expect(canTransition('expired', 'approved')).toBe(false)
  })
  it('reads an approved row past expiry as expired (lazy expiry)', () => {
    const active = { status: 'approved', starts_at: iso(NOW - 30 * 60000), expires_at: iso(NOW + 30 * 60000) }
    const past = { status: 'approved', starts_at: iso(NOW - 90 * 60000), expires_at: iso(NOW - 1000) }
    expect(remainingMs(active, NOW)).toBe(30 * 60000)
    expect(effectiveStatus(active, NOW)).toBe('approved')
    expect(effectiveStatus(past, NOW)).toBe('expired')
    expect(remainingMs({ status: 'denied' }, NOW)).toBeNull()
    expect(elapsedPct(active, NOW)).toBe(50)
    expect(effectiveStatus({ status: 'pending', created_at: iso(NOW - 25 * 3600000) }, NOW)).toBe('lapsed')
  })
  it('formats time honestly', () => {
    expect(formatRemaining(null)).toBe('N/A')
    expect(formatRemaining(0)).toBe('Expired')
    expect(formatRemaining(65 * 60000)).toBe('1h 05m')
    expect(formatRemaining(90 * 1000)).toBe('1m 30s')
    expect(formatMinutes(90)).toBe('1h 30m')
    expect(formatMinutes(480)).toBe('8h')
    expect(formatMinutes(null)).toBe('N/A')
  })
  it('summarises and partitions, returning null not 0 when nothing is decided', () => {
    expect(summarize([], NOW).approvalRate).toBeNull()
    const rows = [
      { id: 1, status: 'pending', created_at: iso(NOW - 60000) },
      { id: 2, status: 'approved', requested_by: 'm', decided_by: 's', created_at: iso(NOW - 40 * 60000), decided_at: iso(NOW - 30 * 60000), starts_at: iso(NOW - 30 * 60000), expires_at: iso(NOW + 30 * 60000) },
      { id: 3, status: 'approved', requested_by: 's', decided_by: 's', created_at: iso(NOW - 120 * 60000), decided_at: iso(NOW - 120 * 60000), expires_at: iso(NOW - 60000) },
      { id: 4, status: 'denied', requested_by: 'm', decided_by: 's', created_at: iso(NOW - 20 * 60000), decided_at: iso(NOW - 10 * 60000), module_key: 'stock' },
    ]
    const s = summarize(rows, NOW)
    expect(s.pending).toBe(1)
    expect(s.active).toBe(1)
    expect(s.expired).toBe(1)
    expect(s.approvalRate).toBe(67)
    expect(s.medianDecisionMinutes).toBe(10)
    const p = partition(rows, NOW)
    expect(p.pending.map((r) => r.id)).toEqual([1])
    expect(p.active.map((r) => r.id)).toEqual([2])
    expect(p.history.map((r) => r.id).sort()).toEqual([3, 4])
    expect(filterRows(p.history, { status: 'denied' }, NOW).map((r) => r.id)).toEqual([4])
    expect(filterRows(p.history, { search: 'STOCK' }, NOW).map((r) => r.id)).toEqual([4])
  })
})

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: (...a) => rpc(...a) },
  unwrap: (r) => { if (r?.error) throw new Error(r.error.message); return r?.data },
  fetchAllPages: vi.fn(),
}))

describe('jitElevation service', () => {
  beforeEach(() => { rpc.mockReset() })
  it('pages past 1000 rows against the server total', async () => {
    const page = (n, start) => Array.from({ length: n }, (_, i) => ({ id: start + i }))
    rpc.mockImplementation(async (_fn, args) => {
      if (args.p_offset === 0) return { data: { rows: page(1000, 0), total: 1500, generated_at: 'x' } }
      return { data: { rows: page(500, 1000), total: 1500 } }
    })
    const { listElevations } = await import('../lib/api/jitElevation')
    const res = await listElevations()
    expect(res.rows).toHaveLength(1500)
    expect(res.truncated).toBe(false)
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_offset: 1000, p_limit: 1000 })
  })
  it('throws on a failed read instead of returning an empty list', async () => {
    rpc.mockResolvedValue({ error: { message: 'Permission denied' } })
    const { listElevations } = await import('../lib/api/jitElevation')
    await expect(listElevations()).rejects.toThrow()
  })
  it('passes decision arguments through', async () => {
    rpc.mockResolvedValue({ data: { ok: true } })
    const { decideElevation, revokeElevation } = await import('../lib/api/jitElevation')
    await decideElevation('r1', { approve: true, minutes: '30' })
    expect(rpc).toHaveBeenCalledWith('admin_decide_elevation', { p_id: 'r1', p_approve: true, p_note: null, p_minutes: 30 })
    await revokeElevation('r1', '  done early ')
    expect(rpc).toHaveBeenCalledWith('admin_revoke_elevation', { p_id: 'r1', p_reason: 'done early' })
  })
})
