import { describe, it, expect } from 'vitest'
import { percentile, queueDepth, timeToResult, failureBreakdown, providerMix, monthSpend, parseBudget, fmtDuration, shapeOps } from '../lib/aiTyreOps'

const j = (o) => ({ status: 'completed', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:01:00Z', ...o })
describe('aiTyreOps', () => {
  it('percentile nearest rank, null when empty', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([1, 2, 3, 4, 100], 50)).toBe(3)
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100)
  })
  it('queue depth counts statuses and unknown', () => {
    expect(queueDepth([{ status: 'pending' }, { status: 'failed' }, { status: 'x' }])).toMatchObject({ pending: 1, failed: 1, other: 1, total: 3 })
  })
  it('time to result ignores non-completed and negative spans', () => {
    const r = timeToResult([j({}), j({ updated_at: '2026-10-01T00:03:00Z' }), j({ status: 'failed' }), j({ updated_at: '2026-09-30T00:00:00Z' })])
    expect(r.count).toBe(2); expect(r.medianSec).toBe(60); expect(r.p95Sec).toBe(180)
    expect(timeToResult([]).medianSec).toBeNull()
  })
  it('failure rate is N/A with no finished jobs', () => {
    expect(failureBreakdown([{ status: 'pending' }]).ratePct).toBeNull()
    const f = failureBreakdown([j({}), { status: 'failed', failure_kind: 'stalled' }, { status: 'failed' }])
    expect(f.ratePct).toBe(66.7); expect(f.byKind.map(k => k.kind).sort()).toEqual(['stalled', 'unknown'])
    expect(f.byKind[0].count).toBe(1)
  })
  it('provider mix keeps unpriced separate from zero', () => {
    const m = providerMix([{ provider: 'a', model_version: 'm', cost_usd: '0.5' }, { provider: 'a', model_version: 'm', cost_usd: null }])
    expect(m[0]).toMatchObject({ jobs: 2, costUsd: 0.5, unpriced: 1 })
  })
  it('budget parsing and spend', () => {
    expect(parseBudget('')).toBeNull(); expect(parseBudget('"50"')).toBe(50); expect(parseBudget('abc')).toBeNull()
    const s = monthSpend([{ cost_usd: 1, provider_called_at: 'x' }, { cost_usd: null, provider_called_at: 'x' }, { cost_usd: null }],
      [{ feature: 'chat', cost_usd: 2 }, { feature: 'ai_tyre_inspection', cost_usd: 9 }], '10')
    expect(s).toMatchObject({ spentUsd: 3, unpricedCalls: 1, limitUsd: 10, usedPct: 30 })
    expect(monthSpend([], [], '').usedPct).toBeNull()
  })
  it('fmtDuration', () => {
    expect(fmtDuration(null)).toBe('N/A'); expect(fmtDuration(30)).toBe('30 s'); expect(fmtDuration(600)).toBe('10 min')
  })
  it('shapeOps wires everything', () => {
    expect(shapeOps({ jobs: [j({})], monthLogs: [], budgetRaw: '' }).latency.count).toBe(1)
  })
})
