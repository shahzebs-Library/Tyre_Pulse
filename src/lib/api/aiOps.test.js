import { describe, it, expect } from 'vitest'
import { estimateRowCost, summarizeUsage, summarizeJobs } from './aiOps'

/* ── Pricing fixture (USD per 1M tokens) ──────────────────────────────────── */
const PRICING = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
}

/* ── Token-log fixtures: 3 successful + 2 failed, 2 models, 2 days ────────── */
const usageRows = [
  // 2026-07-13 — haiku, success (no status → treated as success), priced from map
  {
    id: 'u1', model: 'claude-haiku-4-5', feature: 'chat',
    prompt_tokens: 1000, completion_tokens: 500, created_at: '2026-07-13T10:00:00Z',
  },
  // 2026-07-13 — sonnet, success, STORED cost_usd wins over pricing estimate
  {
    id: 'u2', model: 'claude-sonnet-4-5', feature: 'report', status: 'success',
    prompt_tokens: 2000, completion_tokens: 1000, cost_usd: 0.05,
    created_at: '2026-07-13T11:00:00Z',
  },
  // 2026-07-13 — haiku, FAILED (error) → excluded from cost/token/calls totals
  {
    id: 'u3', model: 'claude-haiku-4-5', feature: 'chat', status: 'error',
    prompt_tokens: 100, completion_tokens: 0, created_at: '2026-07-13T12:00:00Z',
  },
  // 2026-07-12 — sonnet, success, priced from map
  {
    id: 'u4', model: 'claude-sonnet-4-5', feature: 'chat',
    prompt_tokens: 500, completion_tokens: 200, created_at: '2026-07-12T09:00:00Z',
  },
  // 2026-07-12 — haiku, FAILED (rate_limited) → excluded from totals
  {
    id: 'u5', model: 'claude-haiku-4-5', feature: 'report', status: 'rate_limited',
    prompt_tokens: 300, completion_tokens: 50, created_at: '2026-07-12T08:00:00Z',
  },
]

describe('aiOps.estimateRowCost', () => {
  it('prefers the stored cost_usd when present (ignores tokens/pricing)', () => {
    const row = { model: 'claude-sonnet-4-5', prompt_tokens: 9999, completion_tokens: 9999, cost_usd: 0.42 }
    expect(estimateRowCost(row, PRICING)).toBe(0.42)
  })

  it('respects a stored cost of exactly 0', () => {
    const row = { model: 'claude-haiku-4-5', prompt_tokens: 1000, completion_tokens: 500, cost_usd: 0 }
    expect(estimateRowCost(row, PRICING)).toBe(0)
  })

  it('falls through to pricing when cost_usd is an empty string', () => {
    const row = { model: 'claude-haiku-4-5', prompt_tokens: 1000, completion_tokens: 500, cost_usd: '' }
    // (1000*1 + 500*5) / 1e6 = 3500 / 1e6
    expect(estimateRowCost(row, PRICING)).toBeCloseTo(0.0035, 10)
  })

  it('computes (prompt*input + completion*output)/1e6 from the pricing map', () => {
    const row = { model: 'claude-sonnet-4-5', prompt_tokens: 2000, completion_tokens: 1000 }
    // (2000*3 + 1000*15) / 1e6 = 21000 / 1e6
    expect(estimateRowCost(row, PRICING)).toBeCloseTo(0.021, 10)
  })

  it('returns 0 when the model has no pricing entry', () => {
    const row = { model: 'unknown-model', prompt_tokens: 1000, completion_tokens: 500 }
    expect(estimateRowCost(row, PRICING)).toBe(0)
  })

  it('returns 0 when the pricing map is missing entirely', () => {
    const row = { model: 'claude-haiku-4-5', prompt_tokens: 1000, completion_tokens: 500 }
    expect(estimateRowCost(row)).toBe(0)
  })

  it('returns 0 for a row with no model and no cost', () => {
    expect(estimateRowCost({ prompt_tokens: 100 }, PRICING)).toBe(0)
    expect(estimateRowCost(null, PRICING)).toBe(0)
  })
})

describe('aiOps.summarizeUsage', () => {
  const s = summarizeUsage(usageRows, PRICING)

  it('totals cost from successful rows only (stored + estimated)', () => {
    // u1 0.0035 + u2 0.05 (stored) + u4 0.0045 = 0.058
    expect(s.totalCost).toBeCloseTo(0.058, 10)
  })

  it('counts only successful calls and tracks failures separately', () => {
    expect(s.totalCalls).toBe(3)
    expect(s.failedCalls).toBe(2)
    expect(s.failureRate).toBeCloseTo(2 / 5, 10)
  })

  it('sums prompt/completion/total tokens from successful rows only', () => {
    // prompt: 1000 + 2000 + 500 = 3500 ; completion: 500 + 1000 + 200 = 1700
    expect(s.promptTokens).toBe(3500)
    expect(s.completionTokens).toBe(1700)
    expect(s.totalTokens).toBe(5200)
  })

  it('computes avgCostPerCall over successful calls', () => {
    expect(s.avgCostPerCall).toBeCloseTo(0.058 / 3, 10)
  })

  it('aggregates byModel and sorts descending by cost', () => {
    expect(s.byModel.map((m) => m.model)).toEqual(['claude-sonnet-4-5', 'claude-haiku-4-5'])
    const sonnet = s.byModel[0]
    // u2 (0.05) + u4 (0.0045) ; tokens 3000 + 700 ; 2 calls
    expect(sonnet.cost).toBeCloseTo(0.0545, 10)
    expect(sonnet.tokens).toBe(3700)
    expect(sonnet.calls).toBe(2)
    const haiku = s.byModel[1]
    // only u1 (failed u3 excluded)
    expect(haiku.cost).toBeCloseTo(0.0035, 10)
    expect(haiku.tokens).toBe(1500)
    expect(haiku.calls).toBe(1)
  })

  it('aggregates byFeature and sorts descending by cost', () => {
    expect(s.byFeature.map((f) => f.feature)).toEqual(['report', 'chat'])
    const report = s.byFeature[0]
    expect(report.cost).toBeCloseTo(0.05, 10)
    expect(report.calls).toBe(1)
    const chat = s.byFeature[1]
    // u1 (0.0035) + u4 (0.0045)
    expect(chat.cost).toBeCloseTo(0.008, 10)
    expect(chat.calls).toBe(2)
  })

  it('aggregates byDay sorted ascending, with per-day failures counted', () => {
    expect(s.byDay.map((d) => d.date)).toEqual(['2026-07-12', '2026-07-13'])
    const d12 = s.byDay[0]
    expect(d12.calls).toBe(1) // u4 success
    expect(d12.tokens).toBe(700)
    expect(d12.cost).toBeCloseTo(0.0045, 10)
    expect(d12.failures).toBe(1) // u5 rate_limited
    const d13 = s.byDay[1]
    expect(d13.calls).toBe(2) // u1 + u2
    expect(d13.tokens).toBe(4500)
    expect(d13.cost).toBeCloseTo(0.0535, 10)
    expect(d13.failures).toBe(1) // u3 error
  })

  it('breaks failures down by status', () => {
    expect(s.failureBreakdown).toEqual({ error: 1, rate_limited: 1 })
  })

  it('exposes recentFailures (the failed rows, excluded from totals)', () => {
    expect(s.recentFailures.map((r) => r.id)).toEqual(['u3', 'u5'])
  })

  it('treats a blocked status as a failure and buckets it', () => {
    const rows = [
      { id: 'a', model: 'claude-haiku-4-5', prompt_tokens: 100, completion_tokens: 10, created_at: '2026-07-13T00:00:00Z' },
      { id: 'b', model: 'claude-haiku-4-5', status: 'blocked', created_at: '2026-07-13T01:00:00Z' },
    ]
    const r = summarizeUsage(rows, PRICING)
    expect(r.totalCalls).toBe(1)
    expect(r.failedCalls).toBe(1)
    expect(r.failureBreakdown).toEqual({ blocked: 1 })
  })

  it('returns a zeroed, safe shape for no rows', () => {
    const empty = summarizeUsage([], PRICING)
    expect(empty.totalCost).toBe(0)
    expect(empty.totalCalls).toBe(0)
    expect(empty.failureRate).toBe(0)
    expect(empty.avgCostPerCall).toBe(0)
    expect(empty.byModel).toEqual([])
    expect(empty.byDay).toEqual([])
    expect(empty.failureBreakdown).toEqual({})
  })
})

/* ── Job-run fixtures: report_send_log delivery attempts ──────────────────── */
const jobRows = [
  { id: 'j1', schedule_id: 's1', schedule_name: 'Daily Digest', report_type: 'claims', status: 'sent', sent_at: '2026-07-13T08:00:00Z' },
  { id: 'j2', schedule_id: 's1', schedule_name: 'Daily Digest', report_type: 'claims', status: 'failed', error: 'SMTP timeout', sent_at: '2026-07-13T09:00:00Z' },
  { id: 'j3', schedule_id: 's2', schedule_name: 'Weekly Board', report_type: 'accidents', status: 'sent', sent_at: '2026-07-12T08:00:00Z' },
  { id: 'j4', schedule_id: 's2', schedule_name: 'Weekly Board', report_type: 'accidents', status: 'error', error: 'hard bounce', sent_at: '2026-07-11T08:00:00Z' },
]

describe('aiOps.summarizeJobs', () => {
  const s = summarizeJobs(jobRows)

  it('counts total / sent / failed and derives successRate', () => {
    expect(s.total).toBe(4)
    expect(s.sent).toBe(2)
    expect(s.failed).toBe(2) // failed + error (status set and !== 'sent')
    expect(s.successRate).toBeCloseTo(0.5, 10)
  })

  it('groups bySchedule with per-schedule totals', () => {
    const byId = Object.fromEntries(s.bySchedule.map((x) => [x.schedule_id, x]))
    expect(byId.s1.total).toBe(2)
    expect(byId.s1.sent).toBe(1)
    expect(byId.s1.failed).toBe(1)
    expect(byId.s2.total).toBe(2)
    expect(byId.s2.sent).toBe(1)
    expect(byId.s2.failed).toBe(1)
  })

  it('resolves lastRun/lastStatus/lastError from the newest sent_at per schedule', () => {
    const byId = Object.fromEntries(s.bySchedule.map((x) => [x.schedule_id, x]))
    // s1 newest = j2 (09:00 > 08:00) → failed
    expect(byId.s1.lastRun).toBe('2026-07-13T09:00:00Z')
    expect(byId.s1.lastStatus).toBe('failed')
    expect(byId.s1.lastError).toBe('SMTP timeout')
    // s2 newest = j3 (07-12 > 07-11) → sent, no error
    expect(byId.s2.lastRun).toBe('2026-07-12T08:00:00Z')
    expect(byId.s2.lastStatus).toBe('sent')
    expect(byId.s2.lastError).toBeNull()
  })

  it('sorts bySchedule descending by lastRun', () => {
    expect(s.bySchedule.map((x) => x.schedule_id)).toEqual(['s1', 's2'])
  })

  it('exposes recentFailures (failed rows only)', () => {
    expect(s.recentFailures.map((r) => r.id)).toEqual(['j2', 'j4'])
  })

  it('does not count a row with a missing status as sent or failed', () => {
    const r = summarizeJobs([
      { id: 'a', schedule_id: 's9', schedule_name: 'Pending', status: 'sent', sent_at: '2026-07-13T00:00:00Z' },
      { id: 'b', schedule_id: 's9', schedule_name: 'Pending', sent_at: '2026-07-13T01:00:00Z' }, // no status
    ])
    expect(r.total).toBe(2)
    expect(r.sent).toBe(1)
    expect(r.failed).toBe(0)
    expect(r.successRate).toBeCloseTo(0.5, 10)
  })

  it('returns a zeroed, safe shape for no rows', () => {
    const empty = summarizeJobs([])
    expect(empty.total).toBe(0)
    expect(empty.sent).toBe(0)
    expect(empty.failed).toBe(0)
    expect(empty.successRate).toBe(0)
    expect(empty.bySchedule).toEqual([])
    expect(empty.recentFailures).toEqual([])
  })
})
