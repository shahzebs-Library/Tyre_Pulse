/**
 * Expense Report - multi-country currency safety.
 *
 * ONE tenant, three countries with DIFFERENT currencies (KSA=SAR, UAE=AED,
 * Egypt=EGP). Adding them together produces a meaningless figure, so on the
 * "All countries" scope nothing may present a single blended amount. These
 * tests lock the export shape: single-country is unchanged, All-countries
 * carries a Country column and one amount column PER CURRENCY.
 */
import { describe, it, expect } from 'vitest'
import { buildExpenseExport, currencyForCountry, moneyIn } from '../pages/ExpenseReport'

const SNAP = {
  ok: true,
  kpis: { total_expense: 40_550_000, tyre_expense: 13_000_000, spare_expense: 24_900_000, oil_expense: 5_330_000, lines: 106_398 },
  by_store: [{ label: 'NHC-ST', spend: 5000 }, { label: 'JED-ST', spend: 2500 }],
  top_items: [{ label: 'TYRE 315/80 R22.5', spend: 4000, n: 12 }],
  monthly: [{ m: '2026-01', tyre: 100, spare: 200, oil: 50, total: 350 }],
}

const BY_COUNTRY = [
  { country: 'KSA', tyre: 13_000_000, spare: 22_000_000, oil: 5_550_000, total: 40_550_000, lines: 106_398 },
  { country: 'UAE', tyre: 6_000_000, spare: 11_000_000, oil: 2_240_000, total: 19_240_000, lines: 70_696 },
  { country: 'Egypt', tyre: 30_000_000, spare: 55_000_000, oil: 11_360_000, total: 96_360_000, lines: 47_446 },
]

const SITE_GROUPS = [
  { country: 'KSA', currency: 'SAR', rows: [{ site: 'NHC', tyre: 1, spare: 2, oil: 3, total: 6, lines: 4 }] },
  { country: 'UAE', currency: 'AED', rows: [{ site: 'Unmapped: RM01', tyre: 10, spare: 0, oil: 0, total: 10, lines: 2 }] },
]

describe('currencyForCountry', () => {
  it('maps each country to its own currency', () => {
    expect(currencyForCountry('KSA')).toBe('SAR')
    expect(currencyForCountry('UAE')).toBe('AED')
    expect(currencyForCountry('Egypt')).toBe('EGP')
  })

  it('falls back to the app currency for an unknown country', () => {
    expect(currencyForCountry(null, 'SAR')).toBe('SAR')
    expect(currencyForCountry('Oman', 'AED')).toBe('AED')
  })
})

describe('moneyIn', () => {
  it('labels the amount with the currency it was given', () => {
    expect(moneyIn('AED')(1234)).toBe('AED 1,234')
    expect(moneyIn('EGP')(1234)).toBe('EGP 1,234')
  })

  it('renders N/A for a missing or non-numeric value', () => {
    expect(moneyIn('SAR')(null)).toBe('N/A')
    expect(moneyIn('SAR')('abc')).toBe('N/A')
  })
})

describe('buildExpenseExport - single country (unchanged)', () => {
  const out = buildExpenseExport({ isAll: false, currency: 'SAR', snap: SNAP })

  it('keeps the legacy Section / Name / Spend / Count columns', () => {
    expect(out.columns).toEqual(['section', 'name', 'spend', 'count'])
    expect(out.headers).toEqual(['Section', 'Name', 'Spend', 'Count'])
  })

  it('keeps the legacy Store / Top Item / Month rows in order', () => {
    expect(out.rows).toEqual([
      { section: 'Store', name: 'NHC-ST', spend: 5000, count: '' },
      { section: 'Store', name: 'JED-ST', spend: 2500, count: '' },
      { section: 'Top Item', name: 'TYRE 315/80 R22.5', spend: 4000, count: 12 },
      { section: 'Month', name: 'Jan 26', spend: 350, count: '' },
    ])
  })

  it('carries no country column, so nothing changes for a country-scoped user', () => {
    expect(out.columns).not.toContain('country')
    out.rows.forEach((r) => expect(r.country).toBeUndefined())
  })

  it('returns an empty row set when the snapshot is not available', () => {
    expect(buildExpenseExport({ isAll: false, snap: { ok: false } }).rows).toEqual([])
    expect(buildExpenseExport({ isAll: false, snap: null }).rows).toEqual([])
  })
})

describe('buildExpenseExport - All countries (never blended)', () => {
  const out = buildExpenseExport({
    isAll: true, currency: 'SAR', snap: SNAP, byCountry: BY_COUNTRY, siteGroups: SITE_GROUPS,
  })

  it('carries a country column and one amount column per currency', () => {
    expect(out.columns).toEqual(['country', 'section', 'name', 'SAR', 'AED', 'EGP', 'count'])
    expect(out.headers).toEqual(['Country', 'Section', 'Name', 'SAR', 'AED', 'EGP', 'Count'])
  })

  it('puts each amount in its own currency column only', () => {
    const ksa = out.rows.find((r) => r.section === 'Country total' && r.country === 'KSA')
    const uae = out.rows.find((r) => r.section === 'Country total' && r.country === 'UAE')
    const egy = out.rows.find((r) => r.section === 'Country total' && r.country === 'Egypt')
    expect(ksa.SAR).toBe(40_550_000)
    expect(ksa.AED).toBeUndefined()
    expect(ksa.EGP).toBeUndefined()
    expect(uae.AED).toBe(19_240_000)
    expect(uae.SAR).toBeUndefined()
    expect(egy.EGP).toBe(96_360_000)
    expect(egy.SAR).toBeUndefined()
  })

  it('never writes two currencies into the same column', () => {
    out.rows.forEach((r) => {
      const filled = ['SAR', 'AED', 'EGP'].filter((c) => r[c] !== undefined)
      expect(filled.length).toBe(1)
    })
  })

  it('splits each country into its tyre / spare / oil categories', () => {
    const cats = out.rows.filter((r) => r.section === 'Category' && r.country === 'UAE')
    expect(cats.map((r) => r.name)).toEqual(['Tyres', 'Spare parts', 'Oil'])
    expect(cats.map((r) => r.AED)).toEqual([6_000_000, 11_000_000, 2_240_000])
  })

  it('labels every per-site row with the country it came from', () => {
    const sites = out.rows.filter((r) => r.section === 'Site')
    expect(sites).toEqual([
      { country: 'KSA', section: 'Site', name: 'NHC', SAR: 6, count: 4 },
      { country: 'UAE', section: 'Site', name: 'Unmapped: RM01', AED: 10, count: 2 },
    ])
  })

  it('does not emit the blended snapshot store / item / month rows', () => {
    expect(out.rows.some((r) => ['Store', 'Top Item', 'Month'].includes(r.section))).toBe(false)
  })

  it('only lists the currencies that actually have data', () => {
    const oneCountry = buildExpenseExport({
      isAll: true, currency: 'SAR', byCountry: [BY_COUNTRY[2]], siteGroups: [],
    })
    expect(oneCountry.columns).toEqual(['country', 'section', 'name', 'EGP', 'count'])
  })

  it('degrades to an empty export when nothing loaded', () => {
    const empty = buildExpenseExport({ isAll: true, currency: 'SAR' })
    expect(empty.rows).toEqual([])
    expect(empty.columns).toEqual(['country', 'section', 'name', 'count'])
  })
})
