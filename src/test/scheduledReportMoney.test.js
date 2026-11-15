// MODC-05: the scheduled executive e-mail must never add SAR + AED + EGP into
// one total, and must take tyre spend from the expense grid. These tests pin
// the pure money helpers the edge function uses (money.ts) and the wiring in
// the edge function source.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildCurrencyMap, currencyFor, fmtMoney, sumByCurrency, singleCurrencyTotal, isMixedCurrency,
  fmtMoneyParts, sumRowsByCurrency, rowCurrency, normaliseExecMoney, execMoneyFromLegacy,
  partsFor, fmtField, fieldKnown, budgetOutlook, isMissingRpc,
} from '../../supabase/functions/send-scheduled-reports/money.ts'

const MAP = buildCurrencyMap([
  { country: 'KSA', currency: 'SAR' },
  { country: 'UAE', currency: 'AED' },
  { country: ' Egypt ', currency: 'egp' },
  { country: '', currency: 'XXX' },
  { country: 'Nowhere', currency: '' },
])

// The real figures measured on 2026-11-12 (expense grid tyre cost per country).
const RPC = {
  basis: 'expense_grid', period_days: 30, win_from: '2026-10-13', win_to: '2026-11-12',
  countries: [
    { country: 'KSA', currency: 'SAR', tyre_spend_all: 12367362, tyre_spend_cur: 283919, tyre_spend_prev: 254463, tyre_spend_12m: 3162696, wo_cost: 35060742, accident_cost: 38920, monthly_budget: null, monthly_trend: [{ label: '2026-10', value: 100, count: 2 }], top_sites: [{ label: 'NHC', value: 5 }], top_assets: [] },
    { country: 'UAE', currency: 'AED', tyre_spend_all: 4006505, tyre_spend_cur: 0, tyre_spend_prev: 0, tyre_spend_12m: 1638292, wo_cost: 0, accident_cost: 0, monthly_budget: null },
    { country: 'Egypt', currency: 'EGP', tyre_spend_all: 16517335, tyre_spend_cur: 0, tyre_spend_prev: 0, tyre_spend_12m: 5310606, wo_cost: 0, accident_cost: 0, monthly_budget: null },
  ],
}

describe('currency lookup', () => {
  it('maps a country to its own currency, case and space insensitive', () => {
    expect(currencyFor('ksa', MAP)).toBe('SAR')
    expect(currencyFor(' UAE ', MAP)).toBe('AED')
    expect(currencyFor('Egypt', MAP)).toBe('EGP')
  })
  it('never guesses: an unmapped country has no currency, even with a fallback', () => {
    expect(currencyFor('Oman', MAP, 'SAR')).toBe('')
    expect(currencyFor('Nowhere', MAP, 'SAR')).toBe('')
  })
  it('uses the fallback only for a blank country', () => {
    expect(currencyFor(null, MAP, 'sar')).toBe('SAR')
    expect(currencyFor('', MAP)).toBe('')
  })
})

describe('sums never cross a currency', () => {
  const parts = sumByCurrency([
    { currency: 'SAR', amount: 100 }, { currency: 'AED', amount: 10 },
    { currency: 'sar', amount: 5 }, { currency: 'EGP', amount: null }, { currency: 'EGP', amount: 0 },
  ])
  it('keeps one part per currency', () => {
    expect(parts).toEqual([{ currency: 'AED', amount: 10 }, { currency: 'SAR', amount: 105 }])
  })
  it('refuses a single total when currencies differ', () => {
    expect(isMixedCurrency(parts)).toBe(true)
    expect(singleCurrencyTotal(parts)).toBeNull()
  })
  it('gives a single total for one currency and a real zero for none', () => {
    expect(singleCurrencyTotal([{ currency: 'SAR', amount: 7 }])).toEqual({ currency: 'SAR', amount: 7 })
    expect(singleCurrencyTotal([])).toEqual({ currency: '', amount: 0 })
  })
  it('prints each currency on its own, never one added number', () => {
    expect(fmtMoneyParts(parts)).toBe('AED 10 | SAR 105')
    expect(fmtMoneyParts([], 'N/A')).toBe('N/A')
  })
  it('formats missing money as N/A and unknown currency with no code', () => {
    expect(fmtMoney(null, 'SAR')).toBe('N/A')
    expect(fmtMoney('abc', 'SAR')).toBe('N/A')
    expect(fmtMoney(1234.6, '')).toBe('1,235')
    expect(fmtMoney(0, 'AED')).toBe('AED 0')
  })
})

describe('raw table rows take their currency from their own country', () => {
  const rows = [
    { country: 'KSA', cost: 100 }, { country: 'UAE', cost: 40 }, { country: 'Egypt', cost: 9000 },
    { country: null, cost: 3 }, { country: 'Oman', cost: 2 },
  ]
  it('splits a mixed set per currency and keeps unknown countries apart', () => {
    expect(sumRowsByCurrency(rows, 'cost', 'country', MAP, 'SAR')).toEqual([
      { currency: '', amount: 5 }, { currency: 'AED', amount: 40 }, { currency: 'EGP', amount: 9000 }, { currency: 'SAR', amount: 100 },
    ])
  })
  it('uses the tenant default only when NO row carries a country', () => {
    expect(sumRowsByCurrency([{ country: null, cost: 3 }, { cost: 4 }], 'cost', 'country', MAP, 'SAR'))
      .toEqual([{ currency: 'SAR', amount: 7 }])
  })
  it('rowCurrency follows the same rule', () => {
    expect(rowCurrency({ country: 'UAE' }, 'country', MAP, 'SAR', true)).toBe('AED')
    expect(rowCurrency({ country: '' }, 'country', MAP, 'SAR', true)).toBe('')
    expect(rowCurrency({ country: '' }, 'country', MAP, 'SAR', false)).toBe('SAR')
  })
})

describe('executive money from the expense grid aggregate', () => {
  const m = normaliseExecMoney(RPC)
  it('keeps the three countries apart with their own currencies', () => {
    expect(m.basis).toBe('expense_grid')
    expect(m.countries.map((c) => `${c.country}:${c.currency}`)).toEqual(['Egypt:EGP', 'KSA:SAR', 'UAE:AED'])
  })
  it('never produces the blended figure', () => {
    const blended = 12367362 + 4006505 + 16517335
    const txt = fmtField(m, 'tyre_spend_all')
    expect(txt).toBe('AED 4,006,505 | EGP 16,517,335 | SAR 12,367,362')
    expect(txt).not.toContain(blended.toLocaleString('en-US'))
    expect(singleCurrencyTotal(partsFor(m, 'tyre_spend_all'))).toBeNull()
  })
  it('shows one plain figure when only one currency has money', () => {
    expect(fmtField(m, 'wo_cost')).toBe('SAR 35,060,742')
    expect(fmtField(m, 'accident_cost')).toBe('SAR 38,920')
  })
  it('says N/A for a field nobody reported, never zero', () => {
    expect(fieldKnown(m, 'monthly_budget')).toBe(false)
    expect(fmtField(m, 'monthly_budget')).toBe('N/A')
  })
  it('turns a broken payload into no figures instead of a wrong one', () => {
    expect(normaliseExecMoney(null).countries).toEqual([])
    expect(normaliseExecMoney({ countries: 'x' }).countries).toEqual([])
    expect(fmtField(normaliseExecMoney(undefined), 'tyre_spend_all')).toBe('N/A')
  })
  it('a single-country organisation still gets one clean total', () => {
    const one = normaliseExecMoney({ countries: [{ country: 'UAE', currency: 'AED', tyre_spend_all: 500 }] })
    expect(fmtField(one, 'tyre_spend_all')).toBe('AED 500')
    expect(singleCurrencyTotal(partsFor(one, 'tyre_spend_all'))).toEqual({ currency: 'AED', amount: 500 })
  })
})

describe('fallback while the aggregate is not installed', () => {
  const legacy = { period_days: 30, by_country: [{ label: 'Egypt', value: 5949557 }, { label: 'KSA', value: 4270910 }, { label: 'UAE', value: 425868 }] }
  const m = execMoneyFromLegacy(legacy, MAP, 'SAR')
  it('is still per country and labelled as the weaker source', () => {
    expect(m.basis).toBe('tyre_records')
    expect(fmtField(m, 'tyre_spend_all')).toBe('AED 425,868 | EGP 5,949,557 | SAR 4,270,910')
    expect(fmtField(m, 'tyre_spend_all')).not.toContain('10,646,335')
  })
  it('leaves every other money figure N/A rather than inventing it', () => {
    expect(fmtField(m, 'wo_cost')).toBe('N/A')
    expect(fmtField(m, 'tyre_spend_cur')).toBe('N/A')
  })
  it('keeps a no-country bucket apart when other rows have a country', () => {
    const x = execMoneyFromLegacy({ by_country: [{ label: 'KSA', value: 10 }, { label: '(none)', value: 4 }] }, MAP, 'SAR')
    expect(fmtField(x, 'tyre_spend_all')).toBe('4 | SAR 10')
  })
  it('uses the tenant default for an organisation that records no country at all', () => {
    const x = execMoneyFromLegacy({ by_country: [{ label: '(none)', value: 4 }] }, MAP, 'SAR')
    expect(fmtField(x, 'tyre_spend_all')).toBe('SAR 4')
  })
})

describe('budget outlook is per country', () => {
  it('compares 12 month spend with 12 times the monthly budget', () => {
    expect(budgetOutlook({ tyre_spend_12m: 1500, monthly_budget: 100 })).toEqual({ over: true, pct: 25, annual_budget: 1200, run_rate: 1500 })
    expect(budgetOutlook({ tyre_spend_12m: 600, monthly_budget: 100 }).over).toBe(false)
  })
  it('is null when either side is missing', () => {
    expect(budgetOutlook({ tyre_spend_12m: 1500, monthly_budget: null })).toBeNull()
    expect(budgetOutlook({ tyre_spend_12m: null, monthly_budget: 100 })).toBeNull()
    expect(budgetOutlook({ tyre_spend_12m: 5, monthly_budget: 0 })).toBeNull()
  })
})

describe('missing function detection', () => {
  it('recognises PostgREST and Postgres signals', () => {
    expect(isMissingRpc({ code: 'PGRST202' })).toBe(true)
    expect(isMissingRpc({ code: '42883' })).toBe(true)
    expect(isMissingRpc({ message: 'Could not find the function public.report_exec_money_by_country' })).toBe(true)
  })
  it('does not swallow a real failure', () => {
    expect(isMissingRpc({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false)
    expect(isMissingRpc(null)).toBe(false)
  })
})

describe('edge function wiring (source scan)', () => {
  const dir = path.resolve(process.cwd(), 'supabase/functions/send-scheduled-reports')
  const index = readFileSync(path.join(dir, 'index.ts'), 'utf8').replace(/\r\n/g, '\n')
  const money = readFileSync(path.join(dir, 'money.ts'), 'utf8').replace(/\r\n/g, '\n')

  it('reads money from the per-country aggregate', () => {
    expect(index).toContain("svc.rpc('report_exec_money_by_country'")
    expect(index).toContain("from './money.ts'")
  })
  it('no renderer takes one global currency any more', () => {
    expect(index).not.toMatch(/function render\w+\([^)]*currency: string/)
    expect(index).not.toContain('money(d.all.spend, currency)')
    expect(index).not.toContain('money(d.moneySum, currency)')
    expect(index).not.toContain('money(d.claim_total, currency)')
  })
  it('the legacy blended lists are not rendered as money', () => {
    expect(index).not.toContain("topList('Spend by country'")
    expect(index).not.toContain("topList('Top brands by spend'")
    expect(index).not.toContain('d.projected_annual_spend')
  })
  it('both files stay free of backslash-u escapes', () => {
    const esc = String.fromCharCode(92) + 'u'
    expect(index.includes(esc)).toBe(false)
    expect(money.includes(esc)).toBe(false)
  })
})
