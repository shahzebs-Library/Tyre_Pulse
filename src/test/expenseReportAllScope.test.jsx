/**
 * Expense Report - the "All countries" scope must never present one blended
 * figure. ONE tenant, three currencies (KSA=SAR, UAE=AED, Egypt=EGP): summing
 * them is meaningless.
 *
 * Since V544 the deep report is no longer withheld from a multi-country scope -
 * it is REPEATED, once per country, each block in its own currency. So these
 * tests pin two things at once: that the full report now appears for every
 * country in scope, and that nothing anywhere adds two currencies together. A
 * single-country scope is unchanged (one block, one site table, legacy export
 * columns).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => {
  const SITE_ROWS = {
    KSA: [{ site: 'NHC', tyre: 2, spare: 2, oil: 2, total: 6, lines: 4 }],
    UAE: [{ site: 'Unmapped: RM01', tyre: 10, spare: 1, oil: 2, total: 13, lines: 2 }],
    Egypt: [{ site: 'CAIRO', tyre: 5, spare: 1, oil: 1, total: 7, lines: 1 }],
  }
  return {
    SITE_ROWS,
    scope: { activeCountry: 'All', activeCurrency: 'SAR' },
    // One snapshot PER COUNTRY, which is what the *_multi aggregates return.
    // Totals are deliberately distinct per country so a figure on screen can
    // only have come from one country's block - a shared number would let a
    // blended render pass unnoticed.
    snapshotFor: (country) => ({
      ok: true,
      kpis: {
        total_expense: { KSA: 1000, UAE: 2000, Egypt: 3000 }[country] ?? 0,
        tyre_expense: 10, spare_expense: 20, oil_expense: 30,
        lines: 4, tyres_issued: 2, reassigned_tyres: 0,
      },
      by_category: [{ label: 'Tyres', spend: 10 }],
      by_store: [{ label: 'NHC-ST', spend: 5000 }],
      by_asset: [{ label: 'A-1', spend: 4000 }],
      top_items: [{ label: 'TYRE 315/80 R22.5', spend: 4000, n: 12 }],
      monthly: [{ m: '2026-01', tyre: 100, spare: 200, oil: 50, total: 350 }],
    }),
    // The number a blended read WOULD produce (SAR + AED + EGP). It must never
    // appear anywhere on the page or in an export.
    BLENDED: 156_150_000,
    byCountry: [
      { country: 'KSA', tyre: 13_000_000, spare: 22_000_000, oil: 5_550_000, total: 40_550_000, lines: 106_398 },
      { country: 'UAE', tyre: 6_000_000, spare: 11_000_000, oil: 2_240_000, total: 19_240_000, lines: 70_696 },
      { country: 'Egypt', tyre: 30_000_000, spare: 55_000_000, oil: 11_360_000, total: 96_360_000, lines: 47_446 },
    ],
    calls: { bySite: [], excel: [], setMap: [], snapshot: [], byCountry: [], overview: [] },
  }
})

vi.mock('react-router-dom', () => ({ Link: ({ children }) => <a href="#x">{children}</a> }))
vi.mock('../components/ui/PageHeader', () => ({ default: () => null }))
vi.mock('chart.js', () => ({
  Chart: { register: () => {} },
  CategoryScale: {}, LinearScale: {}, BarElement: {}, LineElement: {},
  PointElement: {}, ArcElement: {}, Filler: {}, Title: {}, Tooltip: {}, Legend: {},
}))
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Doughnut: () => null, Line: () => null }))
// The page reads the REPORTING SCOPE, not the working context: which countries
// an analytics surface covers is a different question from where you are
// operating, and this page answers the first one. `activeCountry` is
// deliberately NOT supplied here - if the page ever reads it again, every case
// below fails rather than silently following the wrong control.
vi.mock('../contexts/SettingsContext', () => ({
  COUNTRY_CURRENCY: { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' },
  useSettings: () => ({
    reportingScope: h.scope.reportingScope,
    allowedScopeCountries: h.scope.allowed,
    appSettings: { company_name: 'Green Concrete', currency: 'SAR' },
  }),
}))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, isRTL: false }),
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { role: 'Admin' }, isSuperAdmin: false }),
}))
/** Shape one *_multi answer: a block per requested country, never a total. */
const multiOf = (countries, make) => ({
  ok: true,
  refused: [],
  blocks: (countries || []).map((c) => ({
    country: c,
    currency: { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }[c] || null,
    result: make(c),
  })),
})

vi.mock('../lib/api/partsConsumption', () => ({
  getPartsExpenseSnapshotMulti: (args) => {
    h.calls.snapshot.push(args)
    return Promise.resolve(multiOf(args?.countries, h.snapshotFor))
  },
  getExpenseByCountry: (args) => { h.calls.byCountry.push(args); return Promise.resolve(h.byCountry) },
  // The comparison / cost-per-km panels load from their own RPC. These tests
  // cover the snapshot behaviour, so it returns not-provisioned and those
  // sections stay unrendered - which is also the real degrade path.
  getCostCpkOverviewMulti: (args) => {
    h.calls.overview.push(args)
    return Promise.resolve({ ok: false, blocks: [], refused: [] })
  },
  listExpenseRows: () => Promise.resolve({ rows: [], truncated: false }),
}))
vi.mock('../lib/api/costVariance', () => ({
  getCostVarianceMulti: () => Promise.resolve({ ok: false, blocks: [], refused: [] }),
}))
vi.mock('../lib/api/siteOperatingCost', () => ({
  getSiteOperatingCostMulti: () => Promise.resolve({ ok: false, blocks: [], refused: [] }),
  storeVsOperating: () => [],
}))
vi.mock('../lib/api/storeSiteExpense', () => ({
  getExpenseBySite: (args) => { h.calls.bySite.push(args); return Promise.resolve(h.SITE_ROWS[args?.country] || []) },
  listSites: () => Promise.resolve(['NHC', 'RED SEA']),
  setStoreSiteMap: (args) => { h.calls.setMap.push(args); return Promise.resolve(true) },
}))
vi.mock('../lib/exportUtils', () => ({
  exportToExcel: (...a) => { h.calls.excel.push(a); return Promise.resolve() },
  reportFileName: (...p) => p.join(' '),
  reportDateLabel: () => '26 Jul 2026',
}))

import ExpenseReport from '../pages/ExpenseReport'

beforeEach(() => {
  h.calls.bySite = []; h.calls.excel = []; h.calls.setMap = []
  h.calls.snapshot = []; h.calls.byCountry = []; h.calls.overview = []
  h.scope = { reportingScope: { countries: ['All'] }, allowed: ['KSA', 'UAE', 'Egypt'] }
})

describe('ExpenseReport - All countries scope', () => {
  it('shows each country in its own currency and never the blended total', async () => {
    render(<ExpenseReport />)
    await screen.findByText('By country (own currency)')
    // The blended total (SAR 156,150,000) must appear nowhere.
    expect(document.body.textContent).not.toContain('156,150,000')
    expect(screen.getByText('SAR 40,550,000')).toBeTruthy()
    expect(screen.getByText('AED 19,240,000')).toBeTruthy()
    expect(screen.getByText('EGP 96,360,000')).toBeTruthy()
  })

  /**
   * THE LIMIT THIS CLOSES. The deep report used to be withheld from a
   * multi-country scope because the aggregates behind it took one country. It
   * is now repeated per country instead, so every country in scope gets the
   * full breakdown - and each block is denominated in its own currency.
   */
  it('renders the deep report once per country in scope', async () => {
    render(<ExpenseReport />)
    await waitFor(() => expect(screen.getAllByText('Top stores by spend')).toHaveLength(3))
    expect(screen.getAllByText('Top assets by spend')).toHaveLength(3)
    expect(screen.getAllByText('Top items by spend')).toHaveLength(3)
    expect(screen.getAllByText('Tyres, spare parts and oil by month')).toHaveLength(3)
    expect(screen.getAllByText('Tyres vs Spare Parts vs Oil')).toHaveLength(3)
  })

  it('asks the server for every country in scope in ONE multi-country call', async () => {
    render(<ExpenseReport />)
    await waitFor(() => expect(h.calls.snapshot.length).toBe(1))
    expect(h.calls.snapshot[0].countries).toEqual(['KSA', 'UAE', 'Egypt'])
    expect(h.calls.overview[0].countries).toEqual(['KSA', 'UAE', 'Egypt'])
    // No un-scoped read: a call without countries would report on whatever RLS
    // allows rather than on what the reader selected.
    h.calls.snapshot.forEach((c) => expect(c.countries.length).toBeGreaterThan(0))
  })

  it('labels each country block with its own currency and never adds the totals', async () => {
    render(<ExpenseReport />)
    // Distinct per-country KPI totals prove each block formatted its own money.
    expect(await screen.findByText('SAR 1,000')).toBeTruthy()
    expect(screen.getByText('AED 2,000')).toBeTruthy()
    expect(screen.getByText('EGP 3,000')).toBeTruthy()
    // 1000 + 2000 + 3000 under ANY single currency label would be the blend.
    // Matched with the currency attached, and closed off with a lookahead: an
    // unanchored "6,000" also matches the first five characters of the genuine
    // "AED 6,000,000" on the per-country card, which would fail the test for a
    // page that is behaving correctly.
    expect(document.body.textContent).not.toMatch(/(SAR|AED|EGP)\s*6,000(?![\d,])/)
  })

  it('loads the per-site expense once per country, never un-scoped', async () => {
    render(<ExpenseReport />)
    await waitFor(() => expect(h.calls.bySite.length).toBe(3))
    expect(h.calls.bySite.map((c) => c.country)).toEqual(['KSA', 'UAE', 'Egypt'])
    h.calls.bySite.forEach((c) => expect(c.country).toBeTruthy())
  })

  it('formats each per-site table in that country own currency', async () => {
    render(<ExpenseReport />)
    await screen.findByText('Spend by site')
    // KSA site total 6 -> SAR, UAE site total 13 -> AED, Egypt total 7 -> EGP.
    await waitFor(() => expect(screen.getByText('SAR 6')).toBeTruthy())
    expect(screen.getByText('AED 13')).toBeTruthy()
    expect(screen.getByText('EGP 7')).toBeTruthy()
  })

  it('saves a store mapping against the country of the row it was edited on', async () => {
    render(<ExpenseReport />)
    const input = await screen.findByLabelText('Map RM01 to a site')
    fireEvent.change(input, { target: { value: 'RED SEA' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Save/i })[0])
    await waitFor(() => expect(h.calls.setMap.length).toBe(1))
    expect(h.calls.setMap[0]).toEqual({ country: 'UAE', store_code: 'RM01', site: 'RED SEA' })
  })

  it('exports a country column and one amount column per currency', async () => {
    render(<ExpenseReport />)
    await screen.findByText('By country (own currency)')
    fireEvent.click(screen.getByRole('button', { name: /Export Excel/i }))
    await waitFor(() => expect(h.calls.excel.length).toBe(1))
    const [rows, columns, headers] = h.calls.excel[0]
    expect(columns).toEqual(['country', 'section', 'name', 'SAR', 'AED', 'EGP', 'count'])
    expect(headers).toEqual(['Country', 'Section', 'Name', 'SAR', 'AED', 'EGP', 'Count'])
    expect(columns).not.toContain('spend')
    // No row carries more than one currency, so nothing can be summed across them.
    rows.forEach((r) => expect(['SAR', 'AED', 'EGP'].filter((c) => r[c] !== undefined).length).toBe(1))
    expect(rows.some((r) => r.country === 'Egypt' && r.section === 'Site' && r.EGP === 7)).toBe(true)
  })
})

describe('ExpenseReport - single country scope is unchanged', () => {
  beforeEach(() => { h.scope = { reportingScope: { countries: ['KSA'] }, allowed: ['KSA', 'UAE', 'Egypt'] } })

  it('renders one un-headed report block with the charts', async () => {
    render(<ExpenseReport />)
    await screen.findByText('Top stores by spend')
    expect(screen.getByText('Top assets by spend')).toBeTruthy()
    expect(screen.getByText('Tyres, spare parts and oil by month')).toBeTruthy()
    expect(screen.queryByText('By country (own currency)')).toBeNull()
    // Exactly one block, so the report reads as the page it has always been.
    expect(screen.getAllByText('Top stores by spend')).toHaveLength(1)
  })

  it('loads one country-scoped per-site table', async () => {
    render(<ExpenseReport />)
    await waitFor(() => expect(h.calls.bySite.length).toBe(1))
    expect(h.calls.bySite[0].country).toBe('KSA')
    expect(await screen.findByText('SAR 6')).toBeTruthy()
  })

  it('keeps the legacy export columns', async () => {
    render(<ExpenseReport />)
    await screen.findByText('Top stores by spend')
    fireEvent.click(screen.getByRole('button', { name: /Export Excel/i }))
    await waitFor(() => expect(h.calls.excel.length).toBe(1))
    const [rows, columns, headers] = h.calls.excel[0]
    expect(columns).toEqual(['section', 'name', 'spend', 'count'])
    expect(headers).toEqual(['Section', 'Name', 'Spend', 'Count'])
    expect(rows.map((r) => r.section)).toEqual(['Store', 'Top Item', 'Month'])
  })
})

/**
 * The reporting scope, not the working context, decides what this page covers.
 *
 * `get_expense_by_country` takes no country and returns every country RLS
 * allows, so without a scope bound the page reported on countries the reader had
 * not selected. These pin the three states the scope can be in.
 */
describe('ExpenseReport follows the reporting scope', () => {
  it('reports only the countries in scope, even though the source returns more', async () => {
    h.scope = { reportingScope: { countries: ['KSA', 'UAE'] }, allowed: ['KSA', 'UAE', 'Egypt'] }
    render(<ExpenseReport />)
    await screen.findByText('By country (own currency)')

    expect(screen.getByText('SAR 40,550,000')).toBeTruthy()
    expect(screen.getByText('AED 19,240,000')).toBeTruthy()
    // Egypt is in the RPC's answer and in this profile's allow-list, but it is
    // NOT in the scope, so it must not be reported on.
    expect(screen.queryByText('EGP 96,360,000')).toBeNull()
    await waitFor(() => expect(h.calls.bySite.map((c) => c.country)).toEqual(['KSA', 'UAE']))
  })

  it('never reports a country outside allowedScopeCountries', async () => {
    // A stored scope naming a country this profile may no longer aggregate over.
    h.scope = { reportingScope: { countries: ['KSA', 'Egypt'] }, allowed: ['KSA', 'UAE'] }
    render(<ExpenseReport />)
    await waitFor(() => expect(h.calls.bySite.length).toBeGreaterThan(0))

    expect(h.calls.bySite.map((c) => c.country)).toEqual(['KSA'])
    expect(document.body.textContent).not.toContain('96,360,000')
  })

  it('opens the full single-country report when the scope names exactly one country', async () => {
    h.scope = { reportingScope: { countries: ['UAE'] }, allowed: ['KSA', 'UAE', 'Egypt'] }
    render(<ExpenseReport />)
    await screen.findByText('Top stores by spend')
    // In UAE's OWN currency, taken from the scope - not from the working context.
    await waitFor(() => expect(h.calls.bySite[0].country).toBe('UAE'))
    expect(await screen.findByText('AED 13')).toBeTruthy()
  })

  it('asks for nothing, and says so, when the scope resolves to no country', async () => {
    h.scope = { reportingScope: { countries: ['Egypt'] }, allowed: ['KSA', 'UAE'] }
    render(<ExpenseReport />)

    await screen.findByText(/no countries are selected in the reporting scope/i)
    expect(h.calls.snapshot).toHaveLength(0)
    expect(h.calls.byCountry).toHaveLength(0)
    expect(h.calls.bySite).toHaveLength(0)
  })
})
