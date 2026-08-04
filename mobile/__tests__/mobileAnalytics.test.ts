/**
 * The rule these tests exist to protect: a number the phone cannot honestly
 * compute must render as 'N/A', never as 0 and never as a blended total.
 * Costs in SAR, AED and EGP are not addable, so the All-countries view has no
 * spend figure at all - and 0 would read as "we spent nothing".
 */

// The module under test talks to Supabase, which pulls in React Native. This
// suite is a plain Node + ts-jest runner with no native mocking, so the client
// is replaced wholesale rather than loaded.
jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }))

import {
  shapeAnalytics, avgCostPerTyre,
  compactNumber, currencyFor, formatSpend,
} from '../lib/mobileAnalytics'

const raw = {
  country: 'KSA',
  site: null,
  tyres_total: 944,
  tyres_critical: 12,
  tyres_high: 30,
  tyre_spend: 42110.02,
  vehicles_total: 1019,
  inspections_30d: 131,
  open_actions: 1,
  by_risk: [{ risk: 'Unknown', count: 944 }],
  by_site: [{ site: 'NHC', count: 25, cost: 17902 }],
  by_brand: [{ brand: 'TECHKING', count: 410, cost: 11929 }],
  sites: ['NHC', 'JEDDAH'],
  generated_at: '2026-08-04T20:05:00Z',
}

describe('shapeAnalytics', () => {
  it('reads a full payload', () => {
    const a = shapeAnalytics(raw)!
    expect(a.tyres_total).toBe(944)
    expect(a.tyre_spend).toBe(42110.02)
    expect(a.by_site[0]).toEqual({ site: 'NHC', count: 25, cost: 17902 })
    expect(a.sites).toEqual(['NHC', 'JEDDAH'])
  })

  it('keeps a null cost null instead of turning it into zero', () => {
    const a = shapeAnalytics({
      ...raw, country: null, tyre_spend: null,
      by_site: [{ site: 'NHC', count: 25, cost: null }],
    })!
    expect(a.tyre_spend).toBeNull()
    expect(a.by_site[0].cost).toBeNull()
    // Counts are currency-free, so they survive the All-countries view.
    expect(a.by_site[0].count).toBe(25)
  })

  it('survives missing and malformed collections', () => {
    const a = shapeAnalytics({ tyres_total: '7' })!
    expect(a.tyres_total).toBe(7)
    expect(a.by_risk).toEqual([])
    expect(a.sites).toEqual([])
    expect(a.tyre_spend).toBeNull()
  })

  it('drops non-string entries from the site list', () => {
    expect(shapeAnalytics({ sites: ['NHC', null, 3, ''] })!.sites).toEqual(['NHC'])
  })

  it('returns null rather than a hollow object for rubbish input', () => {
    expect(shapeAnalytics(null)).toBeNull()
    expect(shapeAnalytics('nope')).toBeNull()
  })
})

describe('derived figures', () => {
  it('has no average when spend is not comparable or nothing was counted', () => {
    expect(avgCostPerTyre({ tyre_spend: 1000, tyres_total: 4 })).toBe(250)
    expect(avgCostPerTyre({ tyre_spend: null, tyres_total: 4 })).toBeNull()
    expect(avgCostPerTyre({ tyre_spend: 1000, tyres_total: 0 })).toBeNull()
  })
})

describe('display helpers', () => {
  it('compacts large numbers and admits when there is none', () => {
    expect(compactNumber(940)).toBe('940')
    expect(compactNumber(1240)).toBe('1.2k')
    expect(compactNumber(12400)).toBe('12k')
    expect(compactNumber(2_400_000)).toBe('2.4M')
    expect(compactNumber(null)).toBe('N/A')
    expect(compactNumber(NaN)).toBe('N/A')
  })

  it('maps each country to its own currency', () => {
    expect(currencyFor('KSA')).toBe('SAR')
    expect(currencyFor('uae')).toBe('AED')
    expect(currencyFor('Egypt')).toBe('EGP')
    expect(currencyFor(null)).toBeNull()
  })

  it('refuses to print money without a single country', () => {
    expect(formatSpend(42110, 'KSA')).toBe('SAR 42k')
    expect(formatSpend(42110, null)).toBe('N/A')   // All-countries view
    expect(formatSpend(null, 'KSA')).toBe('N/A')
  })
})
