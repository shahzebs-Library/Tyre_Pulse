import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AUDIT_SOURCES, sourceLabel, sealsBySource, volumeTrend, summarizeVerify, mismatchReason,
  pageOffsets, flattenExportRow, exportColumns, exportWarning, EXPORT_PAGE_SIZE,
} from '../lib/auditSeals'

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: (...a) => rpc(...a) },
  unwrap: (r) => { if (r?.error) throw new Error(r.error.message); return r?.data },
  fetchAllPages: vi.fn(),
}))

const seals = [
  { source: 'audit_log_v2', day: '2026-09-21', row_count: 10, sealed_at: '2026-09-22T00:45:00Z' },
  { source: 'audit_log_v2', day: '2026-09-22', row_count: 30000, sealed_at: '2026-09-23T00:45:00Z' },
  { source: 'access_audit', day: '2026-09-22', row_count: 0, sealed_at: '2026-09-23T00:45:00Z' },
  { source: 'bogus', day: '2026-09-22', row_count: 5 },
]

describe('auditSeals helpers', () => {
  it('rolls seals up per source and ignores unknown sources', () => {
    const s = sealsBySource(seals)
    expect(Object.keys(s)).toEqual(AUDIT_SOURCES.map((x) => x.value))
    expect(s.audit_log_v2).toMatchObject({ days: 2, rows: 30010, firstDay: '2026-09-21', lastDay: '2026-09-22' })
    expect(s.audit_log_v2.lastSealedAt).toBe('2026-09-23T00:45:00Z')
    expect(s.console_sessions.days).toBe(0)
  })

  it('builds an ordered volume series', () => {
    const t = volumeTrend([...seals].reverse(), 'audit_log_v2')
    expect(t.labels).toEqual(['09-21', '09-22'])
    expect(t.values).toEqual([10, 30000])
  })

  it('passes only when no day mismatched; retention is not tampering', () => {
    const ok = summarizeVerify([
      { day: 'a', status: 'match', match: true },
      { day: 'b', status: 'purged_by_retention', match: true },
    ])
    expect(ok.passed).toBe(true)
    expect(ok.purged).toBe(1)
    const bad = summarizeVerify([{ day: 'a', status: 'mismatch', match: false }, { day: 'b', status: 'match', match: true }])
    expect(bad.passed).toBe(false)
    expect(bad.mismatched).toHaveLength(1)
    expect(summarizeVerify([]).passed).toBe(false)
    expect(summarizeVerify([]).empty).toBe(true)
  })

  it('explains a mismatch', () => {
    expect(mismatchReason({ chain_ok: false })).toMatch(/seal record/)
    expect(mismatchReason({ chain_ok: true, row_count_then: 5, row_count_now: 3 })).toMatch(/2 row\(s\) were deleted/)
    expect(mismatchReason({ chain_ok: true, row_count_then: 5, row_count_now: 6 })).toMatch(/added/)
    expect(mismatchReason({ chain_ok: true, row_count_then: 5, row_count_now: 5 })).toMatch(/changed/)
  })

  it('pages exactly', () => {
    expect(pageOffsets(0)).toEqual([])
    expect(pageOffsets(5000)).toEqual([0])
    expect(pageOffsets(5001)).toEqual([0, 5000])
    expect(pageOffsets(12, 5)).toEqual([0, 5, 10])
  })

  it('flattens rows for Excel and unions columns', () => {
    const f = flattenExportRow({ data: { id: 1, action: 'x', after: { a: 1 }, before: null } })
    expect(f).toEqual({ id: 1, action: 'x', after: '{"a":1}', before: null })
    expect(exportColumns([{ a: 1 }, { b: 2, a: 3 }])).toEqual(['a', 'b'])
    expect(flattenExportRow(null)).toEqual({})
  })

  it('warns above 100,000 rows and labels sources', () => {
    expect(exportWarning(100000)).toBeNull()
    expect(exportWarning(100001)).toMatch(/100,001/)
    expect(sourceLabel('access_audit')).toBe('Access changes')
    expect(sourceLabel('zzz')).toBe('zzz')
  })
})

describe('auditSeals service', () => {
  beforeEach(() => rpc.mockReset())

  it('pulls every page until a short page', async () => {
    const { exportAuditAll } = await import('../lib/api/auditSeals')
    const full = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({ id: i }))
    rpc.mockResolvedValueOnce({ data: full }).mockResolvedValueOnce({ data: [{ id: 'last' }] })
    const progress = vi.fn()
    const rows = await exportAuditAll('access_audit', '2026-09-01', null, EXPORT_PAGE_SIZE + 1, progress)
    expect(rows).toHaveLength(EXPORT_PAGE_SIZE + 1)
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_export_audit', expect.objectContaining({
      p_source: 'access_audit', p_from: '2026-09-01', p_to: null, p_offset: EXPORT_PAGE_SIZE,
    }))
    expect(progress).toHaveBeenLastCalledWith(EXPORT_PAGE_SIZE + 1, EXPORT_PAGE_SIZE + 1)
  })

  it('surfaces a refusal from the verify RPC', async () => {
    const { verifyAuditSeals } = await import('../lib/api/auditSeals')
    rpc.mockResolvedValueOnce({ error: { message: 'denied', code: '42501' } })
    await expect(verifyAuditSeals('audit_log_v2')).rejects.toThrow()
  })
})
