import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  clampRetentionDays, validateRetentionDays, shapeRetentionStatus,
  RETENTION_MIN, RETENTION_MAX, RETENTION_DEFAULT,
} from '../lib/tenantExport'

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: (...a) => rpc(...a) },
  unwrap: (r) => { if (r.error) throw r.error; return r.data },
}))

import { getRetentionStatus, setRetentionDays, purgeExpiredNow } from '../lib/api/tenantExport'

describe('retention helpers', () => {
  it('clamps like the SQL reader: junk -> default, else 1..90', () => {
    expect(RETENTION_MIN).toBe(1)
    expect(RETENTION_MAX).toBe(90)
    expect(clampRetentionDays('7')).toBe(7)
    expect(clampRetentionDays('"14"')).toBe(14)
    expect(clampRetentionDays('0')).toBe(1)
    expect(clampRetentionDays('500')).toBe(90)
    expect(clampRetentionDays('abc')).toBe(RETENTION_DEFAULT)
    expect(clampRetentionDays(null)).toBe(RETENTION_DEFAULT)
    expect(clampRetentionDays('-3')).toBe(RETENTION_DEFAULT)
  })

  it('validates a typed value the way the setter RPC does (refuse, never clamp)', () => {
    expect(validateRetentionDays('7')).toBe('')
    expect(validateRetentionDays('1')).toBe('')
    expect(validateRetentionDays('90')).toBe('')
    expect(validateRetentionDays('0')).toMatch(/between 1 and 90/)
    expect(validateRetentionDays('91')).toMatch(/between 1 and 90/)
    expect(validateRetentionDays('2.5')).toMatch(/whole number/)
    expect(validateRetentionDays('')).toMatch(/whole number/)
  })

  it('shapes the status payload honestly', () => {
    const s = shapeRetentionStatus({
      days: 7, due_count: 1, stored_jobs: 2, expired_jobs: 0, last_purge_at: null, next_run: 'daily 02:40 UTC',
      due: [{ job_id: 'j1', org_id: 'o1', status: 'completed', finished_at: '2026-09-01T00:00:00Z', files: 4 }, { nope: 1 }],
    })
    expect(s.days).toBe(7)
    expect(s.dueCount).toBe(1)
    expect(s.due).toEqual([{ jobId: 'j1', orgId: 'o1', status: 'completed', finishedAt: '2026-09-01T00:00:00Z', files: 4 }])
    expect(s.storedJobs).toBe(2)
    const empty = shapeRetentionStatus(null)
    expect(empty.days).toBeNull()
    expect(empty.due).toEqual([])
    expect(empty.dueCount).toBe(0)
  })
})

describe('retention service', () => {
  beforeEach(() => rpc.mockReset())

  it('reads status through the super-admin RPC', async () => {
    rpc.mockResolvedValueOnce({ data: { days: 30, due_count: 0, due: [] }, error: null })
    const s = await getRetentionStatus()
    expect(rpc).toHaveBeenCalledWith('admin_tenant_export_retention_status')
    expect(s.days).toBe(30)
  })

  it('sets retention with a numeric p_days', async () => {
    rpc.mockResolvedValueOnce({ data: { days: 14, previous: 7 }, error: null })
    await setRetentionDays('14')
    expect(rpc).toHaveBeenCalledWith('admin_tenant_export_set_retention', { p_days: 14 })
  })

  it('surfaces a refusal instead of swallowing it', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Only a super admin can manage tenant exports' } })
    await expect(setRetentionDays(5)).rejects.toBeTruthy()
  })

  it('purge now reports queued and due', async () => {
    rpc.mockResolvedValueOnce({ data: { queued: true, due: 2, request_id: 9 }, error: null })
    expect(await purgeExpiredNow()).toEqual({ queued: true, due: 2 })
    rpc.mockResolvedValueOnce({ data: { queued: false, due: 0 }, error: null })
    expect(await purgeExpiredNow()).toEqual({ queued: false, due: 0 })
  })
})
