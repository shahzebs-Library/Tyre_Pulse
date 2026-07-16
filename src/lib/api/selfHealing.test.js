import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mocks for every dependency of the self-healing service.
const h = vi.hoisted(() => {
  const recon = {
    listOrphanAssets: vi.fn(),
    listDuplicateTyres: vi.fn(),
    listSerialConflicts: vi.fn(),
    backfillAsset: vi.fn(),
    backfillAllOrphanAssets: vi.fn(),
    mergeDuplicate: vi.fn(),
  }
  const logs = { logSystemEvent: vi.fn() }
  const anomaly = { detectAnomalies: vi.fn(() => []) }
  const supabase = { from: vi.fn() }
  return { recon, logs, anomaly, supabase }
})

vi.mock('./dataReconciliation', () => h.recon)
vi.mock('./systemLogs', () => h.logs)
vi.mock('../anomalyEngine', () => h.anomaly)
vi.mock('./_client', () => ({
  supabase: h.supabase,
  applyCountry: (q) => q, // identity in tests (no country scope applied)
}))

const svc = await import('./selfHealing')

// A terminal-resolving query builder whose final .limit() yields { data, error }.
function builder(result) {
  const b = {
    select: () => b,
    order: () => b,
    limit: () => Promise.resolve(result),
  }
  return b
}

beforeEach(() => {
  vi.clearAllMocks()
  h.anomaly.detectAnomalies.mockReturnValue([])
})

describe('selfHealing service - runScans', () => {
  it('degrades to [] per source on error', async () => {
    h.recon.listOrphanAssets.mockRejectedValue(new Error('rpc down'))
    h.recon.listDuplicateTyres.mockRejectedValue(new Error('rpc down'))
    h.recon.listSerialConflicts.mockRejectedValue(new Error('rpc down'))
    h.supabase.from.mockImplementation(() => { throw new Error('no table') })

    const res = await svc.runScans()
    expect(res).toEqual({ orphans: [], duplicates: [], serialConflicts: [], staleRows: [] })
  })

  it('degrades staleRows to [] when the stale query returns an error', async () => {
    h.recon.listOrphanAssets.mockResolvedValue([])
    h.recon.listDuplicateTyres.mockResolvedValue([])
    h.recon.listSerialConflicts.mockResolvedValue([])
    h.supabase.from.mockReturnValue(builder({ data: null, error: { message: 'boom' } }))

    const res = await svc.runScans()
    expect(res.staleRows).toEqual([])
  })

  it('passes through recon arrays and builds latest-per-site staleRows', async () => {
    h.recon.listOrphanAssets.mockResolvedValue([{ asset_no: 'A1' }])
    h.recon.listDuplicateTyres.mockResolvedValue([])
    h.recon.listSerialConflicts.mockResolvedValue([{ serial_no: 'S1' }])
    // Every scanned table returns the same site twice with different dates.
    h.supabase.from.mockReturnValue(builder({
      data: [
        { site: 'NHC', created_at: '2026-01-01T00:00:00Z' },
        { site: 'NHC', created_at: '2026-05-01T00:00:00Z' },
      ],
      error: null,
    }))

    const res = await svc.runScans()
    expect(res.orphans).toEqual([{ asset_no: 'A1' }])
    expect(res.serialConflicts).toEqual([{ serial_no: 'S1' }])
    // Deduped to one row per site, keeping the most recent timestamp.
    expect(res.staleRows).toEqual([{ site: 'NHC', created_at: '2026-05-01T00:00:00Z' }])
  })
})

describe('selfHealing service - scanAnomalies', () => {
  it('returns [] on a query error', async () => {
    h.supabase.from.mockReturnValue(builder({ data: null, error: { message: 'x' } }))
    expect(await svc.scanAnomalies()).toEqual([])
    expect(h.anomaly.detectAnomalies).not.toHaveBeenCalled()
  })

  it('runs the anomaly engine on returned rows', async () => {
    const rows = [{ id: 'r1', asset_no: 'A1', issue_date: '2026-01-01' }]
    h.supabase.from.mockReturnValue(builder({ data: rows, error: null }))
    h.anomaly.detectAnomalies.mockReturnValue([{ id: 'anom-1' }])
    const out = await svc.scanAnomalies()
    expect(h.anomaly.detectAnomalies).toHaveBeenCalledWith(rows)
    expect(out).toEqual([{ id: 'anom-1' }])
  })

  it('never throws when supabase.from itself throws', async () => {
    h.supabase.from.mockImplementation(() => { throw new Error('boom') })
    await expect(svc.scanAnomalies()).resolves.toEqual([])
  })
})

describe('selfHealing service - safe fix pass-throughs', () => {
  it('applyBackfillOrphan calls backfillAsset with the asset no', async () => {
    h.recon.backfillAsset.mockResolvedValue('new-id')
    const id = await svc.applyBackfillOrphan('A9')
    expect(h.recon.backfillAsset).toHaveBeenCalledWith('A9')
    expect(id).toBe('new-id')
  })

  it('applyBackfillAllOrphans calls backfillAllOrphanAssets', async () => {
    h.recon.backfillAllOrphanAssets.mockResolvedValue(7)
    const n = await svc.applyBackfillAllOrphans()
    expect(h.recon.backfillAllOrphanAssets).toHaveBeenCalled()
    expect(n).toBe(7)
  })

  it('applyMergeDuplicate forwards keep/remove ids to mergeDuplicate', async () => {
    h.recon.mergeDuplicate.mockResolvedValue(2)
    const n = await svc.applyMergeDuplicate('keep-1', ['rm-1', 'rm-2'])
    expect(h.recon.mergeDuplicate).toHaveBeenCalledWith('keep-1', ['rm-1', 'rm-2'])
    expect(n).toBe(2)
  })
})

describe('selfHealing service - logHealFinding', () => {
  it('logs a warning when there are findings', async () => {
    h.logs.logSystemEvent.mockResolvedValue({ ok: true })
    const res = await svc.logHealFinding({ total: 3, bySeverity: { warning: 2, info: 1 } })
    expect(res).toEqual({ ok: true })
    expect(h.logs.logSystemEvent).toHaveBeenCalledTimes(1)
    const arg = h.logs.logSystemEvent.mock.calls[0][0]
    expect(arg.module_id).toBe('self-healing')
    expect(arg.severity).toBe('warning')
  })

  it('does not log when there is nothing to report', async () => {
    const res = await svc.logHealFinding({ total: 0, bySeverity: { warning: 0, info: 0 } })
    expect(res).toEqual({ ok: false })
    expect(h.logs.logSystemEvent).not.toHaveBeenCalled()
  })

  it('never throws even when logSystemEvent rejects', async () => {
    h.logs.logSystemEvent.mockRejectedValue(new Error('logging down'))
    await expect(svc.logHealFinding({ total: 5, bySeverity: { warning: 5, info: 0 } }))
      .resolves.toEqual({ ok: false })
  })
})
