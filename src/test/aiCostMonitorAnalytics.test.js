import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

const {
  buildAiCostReport, filterLogs, filterOptions, formatUSD, formatTokens,
  rowCost, logExportRows,
} = await import('../lib/aiCostMonitorAnalytics')

const NOW = new Date('2026-09-27T00:00:00Z').getTime()
const pricing = { 'claude-haiku-4-5': { input: 1, output: 5 } }
const rows = [
  { id: 1, model: 'claude-haiku-4-5', feature: 'chat', prompt_tokens: 1000000, completion_tokens: 0, cost_usd: null, site: 'NHC', status: 'success', created_at: '2026-09-25T10:00:00Z' },
  { id: 2, model: 'claude-haiku-4-5', feature: 'report', prompt_tokens: 0, completion_tokens: 0, cost_usd: 2, site: 'JED', status: 'success', created_at: '2026-09-05T10:00:00Z' },
  { id: 3, model: 'claude-haiku-4-5', feature: 'chat', prompt_tokens: 500, completion_tokens: 0, cost_usd: 9, site: 'NHC', status: 'error', error: 'upstream 500', created_at: '2026-09-26T10:00:00Z' },
]

describe('aiCostMonitorAnalytics', () => {
  it('prices successful calls; a failed call is billed only when its cost was recorded', () => {
    expect(rowCost(rows[0], pricing)).toBe(1)
    expect(rowCost(rows[1], pricing)).toBe(2)
    expect(rowCost(rows[2], pricing)).toBe(9) // failed but charged (recorded cost_usd)
    expect(rowCost({ ...rows[2], cost_usd: null }, pricing)).toBe(0) // failed, usage unknown: not guessed
  })

  it('aggregates known failed charges into spend and counts unknown-cost failures separately', () => {
    const unknownFailure = { id: 4, model: 'claude-haiku-5-5', feature: 'ai_tyre_inspection', prompt_tokens: 0, completion_tokens: 0, cost_usd: null, status: 'error', error: 'timeout (usage unknown)', created_at: '2026-09-26T11:00:00Z' }
    const chargedFailure = { id: 5, model: 'claude-haiku-5-5', feature: 'ai_tyre_inspection', prompt_tokens: 1000, completion_tokens: 200, cost_usd: 0.0002, status: 'error', error: 'Unusable model response (JSON validation)', created_at: '2026-09-26T12:00:00Z' }
    const r = buildAiCostReport([...rows, unknownFailure, chargedFailure], { pricing, days: 30, now: NOW })
    expect(r.failedChargedCost).toBeCloseTo(9.0002, 6)
    expect(r.failedChargedTokens).toBe(500 + 1200)
    expect(r.failedUnknownCostCalls).toBe(1)
    expect(r.totalCost).toBeCloseTo(12.0002, 6) // 3 successful + 9.0002 charged failures; unknown failure NOT counted as free or guessed
    expect(logExportRows([unknownFailure], pricing)[0].cost).toBe('Unknown')
  })

  it('builds the headline report with failures and trend', () => {
    const r = buildAiCostReport(rows, { pricing, days: 30, now: NOW })
    expect(r.totalCost).toBe(12) // 3 from successes + 9 recorded charge on the failed call
    expect(r.failedUnknownCostCalls).toBe(0)
    expect(r.successCalls).toBe(2)
    expect(r.failedCalls).toBe(1)
    expect(r.failureRate).toBeCloseTo(33.33, 1)
    expect(r.avgCostPerCall).toBe(1.5)
    expect(r.costPerMillionTokens).toBeCloseTo(3)
    // first half (before Sep 12) = 2, second half = 1 -> -50%
    expect(r.spendTrendPct).toBe(-50)
    expect(r.bySite[0]).toMatchObject({ site: 'NHC', cost: 10 }) // 1 success + 9 recorded failure charge
    expect(r.byModel[0].share).toBe(100)
    expect(r.failureBreakdown).toEqual([{ status: 'error', count: 1 }])
  })

  it('returns N/A shaped values for an empty set', () => {
    const r = buildAiCostReport([], { pricing, now: NOW })
    expect(r.totalCost).toBeNull()
    expect(r.avgCostPerCall).toBeNull()
    expect(r.failureRate).toBeNull()
    expect(r.spendTrendPct).toBeNull()
    expect(formatUSD(r.totalCost)).toBe('N/A')
  })

  it('option lists come from all rows so filters never self-lock', () => {
    const o = filterOptions(rows)
    expect(o.features).toEqual(['chat', 'report'])
    expect(o.statuses).toEqual(['error', 'success'])
    expect(filterLogs(rows, { feature: 'chat' })).toHaveLength(2)
    expect(filterLogs(rows, { status: 'error' }).map((r) => r.id)).toEqual([3])
    expect(filterLogs(rows, { search: 'upstream' }).map((r) => r.id)).toEqual([3])
    expect(filterLogs(rows, { site: 'JED' }).map((r) => r.id)).toEqual([2])
  })

  it('formats and exports', () => {
    expect(formatTokens(1500)).toBe('1.5K')
    expect(formatTokens(2_000_000)).toBe('2.0M')
    expect(formatUSD(0.001)).toBe('$0.0010')
    const out = logExportRows(rows, pricing)
    expect(out[2].cost).toBe(9)
    expect(out[0].cost).toBe(1)
    expect(out[0].created_at).toBe('2026-09-25 10:00')
  })
})
