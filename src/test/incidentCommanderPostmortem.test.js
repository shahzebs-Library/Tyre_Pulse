import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  commanderCandidates, reassignError, canWritePostmortem, hasPostmortem,
  normalizeActions, validatePostmortem, actionProgress,
} from '../lib/platformIncidents'

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: (...a) => rpc(...a) },
  unwrap: ({ data, error }) => { if (error) throw error; return data },
}))
vi.mock('../lib/api/systemLogs', () => ({ listSystemLogs: vi.fn() }))
vi.mock('../lib/api/lineageOps', () => ({ listTrustAlerts: vi.fn() }))

describe('commander reassignment rules', () => {
  const profiles = [
    { id: 'a', full_name: 'Zed', is_super_admin: true },
    { id: 'b', email: 'amy@x.io', is_super_admin: true },
    { id: 'c', full_name: 'Locked', is_super_admin: true, locked: true },
    { id: 'd', full_name: 'Manager', is_super_admin: false },
  ]
  it('offers only unlocked super admins other than the current commander, sorted', () => {
    expect(commanderCandidates(profiles, 'a')).toEqual([{ id: 'b', name: 'amy@x.io' }])
    expect(commanderCandidates(profiles, null).map((p) => p.id)).toEqual(['b', 'a'])
    expect(commanderCandidates(null)).toEqual([])
  })
  it('requires a target, a different person and a reason', () => {
    expect(reassignError({})).toMatch(/Choose/)
    expect(reassignError({ userId: 'a', currentCommander: 'a', reason: 'handing over' })).toMatch(/already/)
    expect(reassignError({ userId: 'b', reason: 'hi' })).toMatch(/at least 5/)
    expect(reassignError({ userId: 'b', reason: 'x'.repeat(501) })).toMatch(/under 500/)
    expect(reassignError({ userId: 'b', reason: 'end of shift' })).toBeNull()
  })
})

describe('postmortem rules', () => {
  it('is only writable on a resolved incident', () => {
    expect(canWritePostmortem({ status: 'resolved' })).toBe(true)
    expect(canWritePostmortem({ status: 'monitoring' })).toBe(false)
    expect(canWritePostmortem(null)).toBe(false)
    expect(hasPostmortem({ postmortem_at: '2026-09-25' })).toBe(true)
    expect(hasPostmortem({})).toBe(false)
  })
  it('normalises actions the same way the server does', () => {
    expect(normalizeActions([
      { action: '  Add jitter ', owner: ' Ops ', due: '2026-10-01', done: true },
      { action: '   ' },
      { action: 'Alert', owner: '', done: 'yes' },
    ])).toEqual([
      { action: 'Add jitter', owner: 'Ops', due: '2026-10-01', done: true },
      { action: 'Alert', owner: null, due: null, done: false },
    ])
    expect(normalizeActions('nope')).toEqual([])
  })
  it('validates summary, root cause, actions and status', () => {
    const ok = { summary: 'Cache stampede', rootCause: 'No TTL', actions: [] }
    expect(validatePostmortem(ok, { status: 'resolved' })).toEqual({})
    expect(validatePostmortem(ok, { status: 'identified' }).status).toBeTruthy()
    expect(validatePostmortem({ ...ok, summary: 'short' }).summary).toBeTruthy()
    expect(validatePostmortem({ ...ok, rootCause: 'x' }).rootCause).toBeTruthy()
    expect(validatePostmortem({ ...ok, actions: [{ action: 'a', due: 'tomorrow' }] }).actions).toMatch(/YYYY-MM-DD/)
    expect(validatePostmortem({ ...ok, actions: Array.from({ length: 51 }, () => ({ action: 'a' })) }).actions).toMatch(/50/)
  })
  it('counts open and done actions, ignoring blanks', () => {
    expect(actionProgress([{ action: 'a', done: true }, { action: 'b' }, { action: '' }])).toEqual({ total: 2, done: 1, open: 1 })
  })
})

describe('service', () => {
  let api
  beforeEach(async () => { rpc.mockReset(); api = await import('../lib/api/platformIncidents') })
  it('reassignCommander calls the RPC with trimmed reason and refuses a short one locally', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await api.reassignCommander('i1', 'u2', '  end of shift ')
    expect(rpc).toHaveBeenCalledWith('incident_reassign_commander', { p_id: 'i1', p_user: 'u2', p_reason: 'end of shift' })
    await expect(api.reassignCommander('i1', 'u2', 'no')).rejects.toThrow(/5 characters/)
    await expect(api.reassignCommander('i1', null, 'reason ok')).rejects.toThrow(/commander/)
  })
  it('savePostmortem sends normalised actions and surfaces a server refusal', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await api.savePostmortem('i1', { summary: ' s ummary ', rootCause: 'root', actions: [{ action: ' a ' }, { action: '' }] })
    expect(rpc).toHaveBeenCalledWith('incident_save_postmortem', {
      p_id: 'i1', p_summary: 's ummary', p_root_cause: 'root',
      p_actions: [{ action: 'a', owner: null, due: null, done: false }],
    })
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'resolved first' } })
    await expect(api.savePostmortem('i1', { summary: 'x', rootCause: 'y' })).rejects.toBeTruthy()
  })
})
