import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Mounts the real Cost Center page over mocked services and proves: the KPI
 * strip's spend comes from the governed split (never a cost_per_tyre sum),
 * the dimension tables render through EnterpriseTable, a failed record read is
 * stated with Retry, and a mixed-currency scope is disclosed and withholds CPK.
 */

vi.mock('chart.js', () => ({
  Chart: { register: () => {} }, CategoryScale: {}, LinearScale: {}, BarElement: {}, LineElement: {},
  PointElement: {}, ArcElement: {}, Title: {}, Tooltip: {}, Legend: {}, Filler: {},
}))
vi.mock('react-chartjs-2', () => ({ Bar: () => <div data-testid="bar" />, Line: () => <div />, Doughnut: () => <div /> }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, language: 'en', dir: 'ltr' }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'Admin' }, isSuperAdmin: false }) }))
const s = vi.hoisted(() => ({ country: 'KSA', currency: 'SAR' }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: s.country, activeCurrency: s.currency }) }))
vi.mock('../components/budgets/BudgetTabs', () => ({ default: () => null }))
vi.mock('../components/expense/YearlyTrendPanel', () => ({ default: () => null }))
vi.mock('../components/EmailPdfButton', () => ({ default: () => null }))

const h = vi.hoisted(() => ({ records: vi.fn(), split: vi.fn() }))
vi.mock('../lib/api', () => ({
  costCenter: { fetchCostCenterRecords: h.records, getMeterDeltas: () => Promise.resolve({ odometer: 0, engineHours: 0 }) },
}))
vi.mock('../lib/api/governedCost', () => ({ loadGovernedCostSplit: h.split, COST_SPLIT_TTL_MS: 60000 }))
vi.mock('../lib/api/production', () => ({
  listProduction: () => Promise.resolve([{ id: 'p1', site: 'NHC', period_date: '2026-05-01', m3: 1200 }]),
  createProduction: vi.fn(), updateProduction: vi.fn(), deleteProduction: vi.fn(),
  sumProductionM3: () => Promise.resolve(1200),
}))

import CostCenter from '../pages/CostCenter'

const SPLIT = { tyre: 24000, maintenance: 6000, blended: false, currency: 'SAR', byCountry: [], byMonth: [{ month: '2026-01', tyre: 24000, maintenance: 6000 }], window: { from: '2025-09-01', to: '2026-09-01' } }
const RECORDS = [
  { id: 1, asset_no: 'TM1', site: 'NHC', brand: 'TRIANGLE', country: 'KSA', cost_per_tyre: 999999, km_at_fitment: 0, km_at_removal: 100000, created_at: '2026-02-01' },
  { id: 2, asset_no: 'TM2', site: 'JED', brand: 'PIRELLI', country: 'KSA', cost_per_tyre: null, created_at: '2026-03-01' },
]

const renderPage = () => render(<MemoryRouter><CostCenter /></MemoryRouter>)

beforeEach(() => {
  cleanup()
  s.country = 'KSA'
  h.records.mockReset().mockResolvedValue({ data: RECORDS, truncated: false })
  h.split.mockReset().mockResolvedValue(SPLIT)
})

describe('CostCenter page', () => {
  it('reads headline spend from the governed split and lists sites in a table', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Tyre spend (expense grid)')).toBeTruthy())
    await waitFor(() => expect(screen.getAllByText(/24,000/).length).toBeGreaterThan(0))
    // The record-level 999,999 is a priced tyre value, never the headline spend.
    expect(screen.getByText('Priced records')).toBeTruthy()
    expect(screen.getAllByText('NHC').length).toBeGreaterThan(0)
    expect(screen.getAllByText('JED').length).toBeGreaterThan(0)
    expect(h.split).toHaveBeenCalledWith(expect.objectContaining({ country: 'KSA', maxAgeMs: 60000 }))
  })

  it('switches the dimension table', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('NHC').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: 'costcenter.tabs.byBrand' }))
    await waitFor(() => expect(screen.getAllByText('TRIANGLE').length).toBeGreaterThan(0))
  })

  it('states a failed record read with Retry', async () => {
    h.records.mockReset().mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getAllByRole('button', { name: /Retry/ }).length).toBeGreaterThan(0)
  })

  it('discloses a mixed-currency scope and withholds CPK', async () => {
    s.country = 'All'
    h.records.mockReset().mockResolvedValue({ data: [...RECORDS, { id: 3, asset_no: 'U1', site: 'DXB', country: 'UAE', cost_per_tyre: 500, km_at_removal: 10000 }], truncated: false })
    h.split.mockReset().mockResolvedValue({ ...SPLIT, blended: true, currency: 'MIXED', byCountry: [] })
    renderPage()
    await waitFor(() => expect(screen.getByText(/spans more than one currency/)).toBeTruthy())
    expect(screen.getByText('Mixed currencies')).toBeTruthy()
  })
})
