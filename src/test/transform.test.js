import { describe, it, expect } from 'vitest'
import { transformRow, convertAmount } from '../lib/import'

const MAP = [{ sourceHeader: 'Cost', target: 'cost_per_tyre' }]

describe('import engine - currency conversion trail (§12)', () => {
  it('marks same-currency rows without converting', () => {
    const { transformed } = transformRow({ Cost: '100' }, MAP, { module: 'tyre', unitSettings: { currency: 'SAR' }, baseCurrency: 'SAR' })
    expect(transformed.currency_conversion_status).toBe('same_currency')
    expect(transformed.amount_base_currency).toBeUndefined()
    expect(transformed.exchange_rate).toBeUndefined()
  })

  it('converts ONLY with an approved rate, preserving the original amount + currency', () => {
    const { transformed } = transformRow({ Cost: '100' }, MAP, {
      module: 'tyre', unitSettings: { currency: 'SAR' }, baseCurrency: 'USD',
      fxRates: { SAR: { rate: 0.2667, rate_date: '2026-06-30', source: 'manual' } },
    })
    expect(transformed.currency_conversion_status).toBe('converted')
    expect(transformed.exchange_rate).toBe(0.2667)
    expect(transformed.exchange_rate_date).toBe('2026-06-30')
    expect(transformed.conversion_source).toBe('manual')
    expect(transformed.base_currency).toBe('USD')
    expect(transformed.amount_base_currency).toBe(26.67)
    expect(transformed.amount_original).toBe(100)
    expect(transformed.currency_original).toBe('SAR')
  })

  it('NEVER converts silently when no approved rate exists', () => {
    const { transformed } = transformRow({ Cost: '100' }, MAP, { module: 'tyre', unitSettings: { currency: 'SAR' }, baseCurrency: 'USD', fxRates: {} })
    expect(transformed.currency_conversion_status).toBe('unconverted_no_rate')
    expect(transformed.amount_base_currency).toBeUndefined()
    expect(transformed.amount_original).toBe(100) // original preserved, never zeroed
    expect(transformed.currency_original).toBe('SAR')
  })

  it('does not add a trail at all when no baseCurrency is requested', () => {
    const { transformed } = transformRow({ Cost: '100' }, MAP, { module: 'tyre', unitSettings: { currency: 'SAR' } })
    expect(transformed.currency_conversion_status).toBeUndefined()
  })

  it('convertAmount rounds to 2dp and guards non-finite input', () => {
    expect(convertAmount(100, 0.2667)).toBe(26.67)
    expect(convertAmount(null, 0.5)).toBeNull()
    expect(convertAmount(100, undefined)).toBeNull()
  })

  it('transformRow stays synchronous (returns an object, not a Promise)', () => {
    const out = transformRow({ Cost: '100' }, MAP, { module: 'tyre', baseCurrency: 'USD', fxRates: {} })
    expect(out).not.toBeInstanceOf(Promise)
    expect(typeof out).toBe('object')
  })
})
