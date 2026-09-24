import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  canonicalPayload, describePayload, canDecide, canCancel, timeLeft, summarizeApprovals,
  parseUserIds, isApprovalRequiredError, readableServerMessage, APPROVAL_REQUIRED_MESSAGE,
} from '../lib/dualControl'

const rpc = vi.fn()
vi.mock('../lib/api/_client', async () => {
  const actual = await vi.importActual('../lib/api/_client')
  return { ...actual, supabase: { rpc: (...a) => rpc(...a) } }
})

const U1 = '58787CC7-818B-4FD5-8B7B-C93E4E01F641'
const U2 = 'd2d43a5f-0906-4f7a-9577-e36d89164914'

describe('canonicalPayload mirrors the server', () => {
  it('sorts, lower-cases and de-duplicates user ids for a role change', () => {
    expect(canonicalPayload('admin_bulk_set_role', { role: ' Admin ', user_ids: [U1, U2, U1.toLowerCase()] }))
      .toEqual({ role: 'Admin', user_ids: [U2, U1.toLowerCase()].sort() })
  })
  it('accepts user ids as pasted text', () => {
    expect(canonicalPayload('admin_bulk_set_role', { role: 'Manager', user_ids: `${U1}\n${U2}` }).user_ids).toHaveLength(2)
  })
  it('trims a cleanup date to YYYY-MM-DD', () => {
    expect(canonicalPayload('admin_data_cleanup_run', { key: 'system_logs', before: '2025-01-31T10:00:00Z' }))
      .toEqual({ key: 'system_logs', before: '2025-01-31' })
  })
  it('lower-cases a restore snapshot id', () => {
    expect(canonicalPayload('backup_restore_missing', { snapshot_id: U1, table: 'tyre_records' }))
      .toEqual({ snapshot_id: U1.toLowerCase(), table: 'tyre_records' })
  })
  it('refuses incomplete payloads with a readable message', () => {
    expect(() => canonicalPayload('admin_data_cleanup_run', { key: 'x' })).toThrow(/cutoff date/)
    expect(() => canonicalPayload('backup_restore_missing', { snapshot_id: 'nope', table: 't' })).toThrow(/snapshot/)
    expect(() => canonicalPayload('admin_bulk_set_role', { role: 'Admin', user_ids: [] })).toThrow(/user id/)
    expect(() => canonicalPayload('drop_everything', {})).toThrow(/cannot be sent/)
  })
  it('disable has an empty payload', () => {
    expect(canonicalPayload('dual_control_disable', { x: 1 })).toEqual({})
  })
})

describe('row rules', () => {
  const now = new Date('2026-09-24T10:00:00Z')
  const future = '2026-09-24T12:30:00Z'
  it('a person can never decide their own request', () => {
    expect(canDecide({ status: 'pending', is_mine: true, expires_at: future }, now)).toBe(false)
    expect(canDecide({ status: 'pending', is_mine: false, expires_at: future }, now)).toBe(true)
  })
  it('only pending, unexpired rows are decidable', () => {
    expect(canDecide({ status: 'approved', is_mine: false, expires_at: future }, now)).toBe(false)
    expect(canDecide({ status: 'pending', is_mine: false, expires_at: '2026-09-24T09:00:00Z' }, now)).toBe(false)
  })
  it('only the requester can withdraw an open request', () => {
    expect(canCancel({ status: 'approved', is_mine: true })).toBe(true)
    expect(canCancel({ status: 'pending', is_mine: false })).toBe(false)
    expect(canCancel({ status: 'executed', is_mine: true })).toBe(false)
  })
  it('timeLeft states the window honestly', () => {
    expect(timeLeft(future, now)).toBe('2h 30m left')
    expect(timeLeft('2026-09-24T09:00:00Z', now)).toBe('Expired')
    expect(timeLeft(null, now)).toBe('N/A')
  })
  it('summarizes who is waiting on whom', () => {
    const s = summarizeApprovals([
      { status: 'pending', is_mine: false, action: 'admin_bulk_set_role' },
      { status: 'pending', is_mine: true, action: 'admin_bulk_set_role' },
      { status: 'approved', is_mine: true, action: 'backup_restore_missing' },
      { status: 'executed', is_mine: true, action: 'admin_data_cleanup_run' },
    ])
    expect(s).toMatchObject({ total: 4, pending: 2, awaitingMe: 1, readyToRun: 1, executed: 1 })
    expect(s.byAction.admin_bulk_set_role).toBe(2)
  })
  it('describes a payload in plain words', () => {
    expect(describePayload('admin_bulk_set_role', { role: 'Admin', user_ids: [U2] })).toBe('Set role Admin for 1 user')
    expect(describePayload('admin_data_cleanup_run', { key: 'system_logs', before: '2025-01-01' }))
      .toBe('Delete system_logs older than 2025-01-01')
  })
  it('parseUserIds splits out invalid tokens', () => {
    const r = parseUserIds(`${U1}, not-an-id`)
    expect(r.ids).toEqual([U1.toLowerCase()])
    expect(r.invalid).toEqual(['not-an-id'])
  })
})

describe('error handling', () => {
  it('recognises the approval-needed refusal by hint, cause or text', () => {
    expect(isApprovalRequiredError({ code: 'P0001', hint: 'dual_control_required', message: 'x' })).toBe(true)
    expect(isApprovalRequiredError({ cause: { hint: 'dual_control_required' } })).toBe(true)
    expect(isApprovalRequiredError(new Error(APPROVAL_REQUIRED_MESSAGE))).toBe(true)
    expect(isApprovalRequiredError({ code: '42501', message: 'permission denied' })).toBe(false)
  })
  it('passes through only the sentences the RPCs were written to raise', () => {
    expect(readableServerMessage({ code: '42501', message: 'You cannot decide your own request. A second super admin must do it.' }))
      .toMatch(/own request/)
    expect(readableServerMessage({ code: '22023', message: 'This request has already been approved.' })).toMatch(/approved/)
    expect(readableServerMessage({ code: '42P01', message: 'relation "x" does not exist' })).toBeNull()
  })
})

describe('service', () => {
  beforeEach(() => rpc.mockReset())

  it('sends the canonical payload and surfaces the four-eyes refusal verbatim', async () => {
    const { requestApproval, decideApproval } = await import('../lib/api/dualControl')
    rpc.mockResolvedValueOnce({ data: 'id-1', error: null })
    await requestApproval('admin_bulk_set_role', { role: 'Admin', user_ids: [U1] }, 'because')
    expect(rpc).toHaveBeenCalledWith('admin_request_approval', {
      p_action: 'admin_bulk_set_role', p_payload: { role: 'Admin', user_ids: [U1.toLowerCase()] }, p_reason: 'because',
    })
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'You cannot decide your own request. A second super admin must do it.' } })
    await expect(decideApproval('id-1', true)).rejects.toThrow(/own request/)
  })

  it('never leaks a raw database message', async () => {
    const { listApprovals } = await import('../lib/api/dualControl')
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42P01', message: 'relation "console_approval_requests" does not exist' } })
    await expect(listApprovals()).rejects.toThrow(/^(?!.*relation)/)
  })

  it('a gated action reports the approval-needed message', async () => {
    const { bulkSetRole } = await import('../lib/api/adminAccess')
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', hint: 'dual_control_required', message: 'x' } })
    await expect(bulkSetRole([U1], 'Admin')).rejects.toThrow(APPROVAL_REQUIRED_MESSAGE)
  })

  it('shapes the list response', async () => {
    const { listApprovals } = await import('../lib/api/dualControl')
    rpc.mockResolvedValueOnce({ data: { enabled: false, active_super_admins: 2, me: U2, rows: [{ id: 1 }] }, error: null })
    expect(await listApprovals('open')).toEqual({ enabled: false, activeSuperAdmins: 2, me: U2, rows: [{ id: 1 }] })
  })
})
