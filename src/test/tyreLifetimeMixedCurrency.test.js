import { describe, it, expect } from 'vitest'
import {
  weightedCpk, lifetimeSummary, spansMultipleCurrencies, cpkByCountry,
} from '../lib/tyreLifetime'

/**
 * Rule T10: currency is never blended. A weighted fleet CPK, or a lifetime
 * summary, is null when the measurable tyres span more than one country, with
 * the per-country rows available instead (F-E-03). A single-country set is
 * unchanged.
 *
 * These exercise the lifetime layer directly with lifetime-shaped tyres
 * (the objects toLifetimeTyres returns): _cost, _life_km, _qty, country.
 */
const tyre = (over = {}) => ({
  _key: `t${Math.random()}`,
  _cost: 1000,
  _life_km: 50000,
  _qty: 1,
  _km_coverage: 'complete',
  _cost_status: 'ACTUAL',
  country: 'KSA',
  ...over,
})

describe('tyreLifetime mixed-currency honesty (T10)', () => {
  it('spansMultipleCurrencies is true only across >1 country WITH cost', () => {
    expect(spansMultipleCurrencies([tyre({ country: 'KSA' }), tyre({ country: 'KSA' })])).toBe(false)
    expect(spansMultipleCurrencies([tyre({ country: 'KSA' }), tyre({ country: 'UAE' })])).toBe(true)
    // a tyre with no price/km does not count towards the currency span
    expect(spansMultipleCurrencies([tyre({ country: 'KSA' }), tyre({ country: 'UAE', _cost: null })])).toBe(false)
  })

  it('weightedCpk returns null across currencies, a number within one', () => {
    expect(weightedCpk([tyre({ country: 'KSA' }), tyre({ country: 'KSA' })])).toBeCloseTo(0.02, 6)
    expect(weightedCpk([tyre({ country: 'KSA' }), tyre({ country: 'UAE' })])).toBeNull()
  })

  it('cpkByCountry gives one weighted row per country', () => {
    const rows = cpkByCountry([
      tyre({ country: 'KSA', _cost: 1000, _life_km: 50000 }),
      tyre({ country: 'KSA', _cost: 2000, _life_km: 50000 }),
      tyre({ country: 'UAE', _cost: 1000, _life_km: 40000 }),
    ])
    const byC = Object.fromEntries(rows.map(r => [r.country, r.cpk]))
    expect(byC.KSA).toBeCloseTo(3000 / 100000, 6)
    expect(byC.UAE).toBeCloseTo(1000 / 40000, 6)
  })

  it('lifetimeSummary nulls the scalar CPK and carries per-country rows when mixed', () => {
    const single = lifetimeSummary([tyre({ country: 'KSA' }), tyre({ country: 'KSA' })])
    expect(single.mixedCurrency).toBe(false)
    expect(single.cpkPurchase).toBeCloseTo(0.02, 6)
    expect(single.byCountry).toEqual([])

    const mixed = lifetimeSummary([tyre({ country: 'KSA' }), tyre({ country: 'UAE' })])
    expect(mixed.mixedCurrency).toBe(true)
    expect(mixed.cpkPurchase).toBeNull()
    expect(mixed.cpkFull).toBeNull()
    expect(mixed.byCountry.map(r => r.country).sort()).toEqual(['KSA', 'UAE'])
    // coverage and counts stay honest (they are currency-agnostic)
    expect(mixed.measurable).toBe(2)
  })
})
