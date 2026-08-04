/**
 * Expense Report - the "All countries" scope must never present one blended
 * figure. ONE tenant, three currencies (KSA=SAR, UAE=AED, Egypt=EGP): summing
 * them is meaningless, so on the All scope the page shows per-country totals,
 * per-country site tables and a per-currency export, and hides the charts that
 * can only be drawn from a cross-country sum. A single-country scope is
 * unchanged (charts render, one site table, legacy export columns).
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
    // Blended snapshot the RPC returns when p_country is NULL (SAR + AED + EGP).
    snapshot: {
      ok: true,
      kpis: {
        total_expense: 156_150_000, tyre_expense: 49_000_000, spare_expense: 88_000_000,
        oil_expense: 19_150_000, lines: 224_540, tyres_issued: 7498, reassigned_tyres: 0,
      },
      by_category: [{ label: 'Tyres', spend: 49_000_000 }],
      by_store: [{ label: 'NHC-ST', spend: 5000 }],
      by_asset: [{ label: 'A-1', spend: 4000 }],
      top_items: [{ label: 'TYRE 315/80 R22.5', spend: 4000, n: 12 }],
      monthly: [{ m: '2026-01', tyre: 100, spare: 200, oil: 50, total: 350 }],
    },
    byCountry: [
      { country: 'KSA', tyre: 13_000_000, spare: 22_000_000, oil: 5_550_000, total: 40_550_000, lines: 106_398 },
      { country: 'UAE', tyre: 6_000_000, spare: 11_000_000, oil: 2_240_000, total: 19_240_000, lines: 70_696 },
      { country: 'Egypt', tyre: 30_000_000, spare: 55_000_000, oil: 11_360_000, total: 96_360_000, lines: 47_446 },
    ],
    calls: { bySite: [], excel: [], setMap: [] },
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
vi.mock('../contexts/SettingsContext', () => ({
  COUNTRY_CURRENCY: { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' },
  useSettings: () => ({
    activeCountry: h.scope.activeCountry,
    activeCurrency: h.scope.activeCurrency,
    appSettings: { company_name: 'Green Concrete', currency: 'SAR' },
  }),
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { role: 'Admin' }, isSuperAdmin: false }),
}))
vi.mock('../lib/api/partsConsumption', () => ({
  getPartsExpenseSnapshot: () => Promise.resolve(h.snapshot),
  getExpenseByCountry: () => Promise.resolve(h.byCountry),
  // The comparison / cost-per-km panels load from their own RPC. These tests
  // cover the legacy snapshot behaviour, so it returns not-provisioned and those
  // sections stay unrendered - which is also the real degrade path.
  getCostCpkOverview: () => Promise.resolve(h.overview ?? { ok: false }),
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
  h.scope = { activeCountry: 'All', activeCurrency: 'SAR' }
})

describe('ExpenseReport - All countries scope', () => {
  it('shows each country in its own currency and never the blended total', async () => {
    render(<ExpenseReport />)
    await screen.findByText('By country (own currency)')
    // The blended snapshot total (SAR 156,150,000) must appear nowhere.
    expect(document.body.textContent).not.toContain('156,150,000')
    expect(screen.getByText('SAR 40,550,000')).toBeTruthy()
    expect(screen.getByText('AED 19,240,000')).toBeTruthy()
    expect(screen.getByText('EGP 96,360,000')).toBeTruthy()
  })

  it('hides the cross-currency charts and says why', async () => {
    render(<ExpenseReport />)
    await screen.findByText('Charts, Chart Builder and Tyre Forecast show per country')
    expect(screen.queryByText('Top stores by spend')).toBeNull()
    expect(screen.queryByText('Top assets by spend')).toBeNull()
    expect(screen.queryByText('Top items by spend')).toBeNull()
    expect(screen.queryByText('Tyres, spare parts and oil by month')).toBeNull()
    expect(screen.queryByText('Tyres vs Spare Parts vs Oil')).toBeNull()
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
  beforeEach(() => { h.scope = { activeCountry: 'KSA', activeCurrency: 'SAR' } })

  it('renders the charts and the blended-scope note is absent', async () => {
    render(<ExpenseReport />)
    await screen.findByText('Top stores by spend')
    expect(screen.getByText('Top assets by spend')).toBeTruthy()
    expect(screen.getByText('Tyres, spare parts and oil by month')).toBeTruthy()
    expect(screen.queryByText('Charts, Chart Builder and Tyre Forecast show per country')).toBeNull()
    expect(screen.queryByText('By country (own currency)')).toBeNull()
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
