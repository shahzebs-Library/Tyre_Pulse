import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  costPerCall,
  summariseModels,
  budgetStatus,
} from '../lib/aiAdmin'

describe('aiAdmin.toFiniteNumber', () => {
  it('parses numbers and numeric strings', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('3.5')).toBe(3.5)
    expect(toFiniteNumber('$1,200.50')).toBe(1200.5)
    expect(toFiniteNumber('-7')).toBe(-7)
  })

  it('returns null for blank / non-numeric / nullish', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('aiAdmin.costPerCall', () => {
  const model = { input_price: 1.0, output_price: 5.0 } // USD per 1M tokens

  it('prices prompt + completion tokens per 1M', () => {
    // 1,000,000 in @ $1 + 1,000,000 out @ $5 = $6
    expect(costPerCall(model, 1_000_000, 1_000_000)).toBeCloseTo(6, 9)
  })

  it('scales linearly for partial token counts', () => {
    // 500k in @ $1 = $0.5 ; 200k out @ $5 = $1.0 => $1.5
    expect(costPerCall(model, 500_000, 200_000)).toBeCloseTo(1.5, 9)
  })

  it('accepts numeric strings for prices and tokens', () => {
    expect(costPerCall({ input_price: '2', output_price: '0' }, '1000000', '0')).toBeCloseTo(2, 9)
  })

  it('treats missing prices/tokens as zero (never NaN)', () => {
    expect(costPerCall({}, 1_000_000, 1_000_000)).toBe(0)
    expect(costPerCall(null, 1_000_000, 1_000_000)).toBe(0)
    expect(costPerCall(model, null, undefined)).toBe(0)
  })

  it('clamps negative token counts to zero', () => {
    expect(costPerCall(model, -1_000_000, -1_000_000)).toBe(0)
  })
})

describe('aiAdmin.summariseModels', () => {
  it('counts total and active rows', () => {
    const rows = [
      { active: true }, { active: false }, { active: true },
    ]
    const s = summariseModels(rows)
    expect(s.total).toBe(3)
    expect(s.activeCount).toBe(2)
  })

  it('prefers an active default model', () => {
    const rows = [
      { key: 'a', is_default: true, active: false },
      { key: 'b', is_default: true, active: true },
    ]
    expect(summariseModels(rows).defaultModel.key).toBe('b')
  })

  it('falls back to an inactive default when no active default exists', () => {
    const rows = [
      { key: 'a', is_default: true, active: false },
      { key: 'b', is_default: false, active: true },
    ]
    expect(summariseModels(rows).defaultModel.key).toBe('a')
  })

  it('returns null default and zero counts for empty / invalid input', () => {
    expect(summariseModels([])).toEqual({ total: 0, activeCount: 0, defaultModel: null })
    expect(summariseModels(null)).toEqual({ total: 0, activeCount: 0, defaultModel: null })
  })
})

describe('aiAdmin.budgetStatus', () => {
  it('computes pct / remaining against a cost cap', () => {
    const s = budgetStatus({ cost_cap_usd: 100 }, 25)
    expect(s.pct).toBeCloseTo(25, 9)
    expect(s.remaining).toBeCloseTo(75, 9)
    expect(s.over).toBe(false)
    expect(s.cap).toBe(100)
  })

  it('flags over-budget spend', () => {
    const s = budgetStatus({ cost_cap_usd: 100 }, 150)
    expect(s.over).toBe(true)
    expect(s.pct).toBeCloseTo(150, 9)
    expect(s.remaining).toBeCloseTo(-50, 9)
  })

  it('falls back to token cap when no cost cap is set', () => {
    const s = budgetStatus({ token_cap: 1000 }, 250)
    expect(s.cap).toBe(1000)
    expect(s.pct).toBeCloseTo(25, 9)
  })

  it('guards a zero / missing cap (no Infinity or NaN)', () => {
    const zero = budgetStatus({ cost_cap_usd: 0 }, 50)
    expect(zero).toEqual({ pct: 0, over: false, remaining: 0, cap: 0 })
    const none = budgetStatus({}, 50)
    expect(none).toEqual({ pct: 0, over: false, remaining: 0, cap: 0 })
    expect(Number.isFinite(zero.pct)).toBe(true)
  })

  it('clamps negative spend to zero', () => {
    const s = budgetStatus({ cost_cap_usd: 100 }, -20)
    expect(s.pct).toBe(0)
    expect(s.remaining).toBeCloseTo(100, 9)
  })
})
