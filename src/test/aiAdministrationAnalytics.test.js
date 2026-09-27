import { describe, it, expect } from 'vitest'
import {
  searchRecords, spendWindows, budgetUtilisation, modelKpis, promptKpis,
  budgetKpis, feedbackKpis, ratingDistribution,
} from '../lib/aiAdministrationAnalytics'

const NOW = Date.parse('2026-09-27T00:00:00Z')
const H = 3_600_000
const logs = [
  { created_at: new Date(NOW - 2 * H).toISOString(), cost_usd: 1, prompt_tokens: 100, completion_tokens: 50 },
  { created_at: new Date(NOW - 3 * 24 * H).toISOString(), cost_usd: 2, prompt_tokens: 10, completion_tokens: 0 },
  { created_at: new Date(NOW - 20 * 24 * H).toISOString(), cost_usd: 4 },
  { created_at: 'bad', cost_usd: 99 },
]

describe('aiAdministrationAnalytics', () => {
  it('searches listed fields case-insensitively', () => {
    const rows = [{ key: 'Haiku', notes: 'fast' }, { key: 'Opus' }]
    expect(searchRecords(rows, 'hai', ['key'])).toHaveLength(1)
    expect(searchRecords(rows, '', ['key'])).toHaveLength(2)
    expect(searchRecords(rows, 'FAST', ['key', 'notes'])).toHaveLength(1)
  })

  it('buckets spend into daily, weekly and monthly windows', () => {
    const w = spendWindows(logs, NOW)
    expect(w.daily).toEqual({ cost: 1, tokens: 150, calls: 1 })
    expect(w.weekly.cost).toBe(3)
    expect(w.monthly.cost).toBe(7)
    expect(w.monthly.calls).toBe(3)
  })

  it('utilisation is null without spend, cost-based when a cost cap exists', () => {
    const w = spendWindows(logs, NOW)
    expect(budgetUtilisation({ period: 'monthly', cost_cap_usd: 10 }, null)).toBeNull()
    const u = budgetUtilisation({ period: 'monthly', cost_cap_usd: 10 }, w)
    expect(u.basis).toBe('cost')
    expect(u.pct).toBeCloseTo(70)
    expect(u.over).toBe(false)
    const t = budgetUtilisation({ period: 'daily', token_cap: 100 }, w)
    expect(t.basis).toBe('tokens')
    expect(t.over).toBe(true)
    expect(budgetUtilisation({ period: 'daily' }, w)).toBeNull()
  })

  it('model, prompt and budget KPIs', () => {
    expect(modelKpis([{ active: true, is_default: true, key: 'a', input_price: 1, output_price: 2 }, { active: false }]))
      .toMatchObject({ total: 2, activeCount: 1, priced: 1 })
    const p = promptKpis([
      { agent: 'analyst', locale: 'en' }, { agent: 'analyst', locale: 'en' },
      { agent: 'analyst', locale: 'ar', active: false }, { agent: 'planner', locale: 'en' },
    ])
    expect(p).toMatchObject({ total: 4, active: 3, agents: 2, locales: 2, conflicts: 1 })
    const w = spendWindows(logs, NOW)
    expect(budgetKpis([{ period: 'daily', token_cap: 100, hard_stop: true }], w)).toMatchObject({ total: 1, hardStops: 1, overCap: 1, spend30d: 7 })
    expect(budgetKpis([{ period: 'daily', token_cap: 100 }], null)).toMatchObject({ overCap: null, spend30d: null })
  })

  it('feedback correct share is over judged entries only', () => {
    const k = feedbackKpis([{ rating: 5, correct: true }, { rating: 1, correct: false }, { rating: null, correct: null }])
    expect(k.avgRating).toBe(3)
    expect(k.correctPct).toBe(50)
    expect(k.judged).toBe(2)
    expect(feedbackKpis([{ correct: null }]).correctPct).toBeNull()
    expect(feedbackKpis([]).avgRating).toBeNull()
    expect(ratingDistribution([{ rating: 5 }, { rating: 5 }, { rating: null }]).find(d => d.rating === 5).count).toBe(2)
  })
})
