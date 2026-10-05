import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Smoke render of the rebuilt Brand Performance page with the real engines
// and kit. Services are mocked; nothing touches the network.
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR', appSettings: {} }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, language: 'en', dir: 'ltr' }) }))
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Line: () => null }))
vi.mock('../components/ChartModal', () => ({ ChartModal: () => null }))
vi.mock('../lib/fetchAll', () => ({
  fetchAllPages: vi.fn(() => Promise.resolve({ data: [
    { id: 1, brand: 'Alpha', site: 'NHC', size: '315/80R22.5', vehicle_type: 'TR-MIXER', risk_level: 'Low', cost_per_tyre: 1000, km_at_fitment: 1000, km_at_removal: 101000 },
    { id: 2, brand: 'Alpha', site: 'NHC', size: '315/80R22.5', vehicle_type: 'TR-MIXER', risk_level: 'High', cost_per_tyre: 1000, km_at_fitment: 1000, km_at_removal: 81000 },
    { id: 3, brand: 'Beta', site: 'JED', size: '315/80R22.5', vehicle_type: 'PUMPS', risk_level: 'Critical', cost_per_tyre: 1200, km_at_fitment: 500, km_at_removal: 40500 },
    { id: 4, brand: 'Beta', site: 'JED', size: '385/65R22.5', vehicle_type: 'PUMPS', risk_level: 'High', cost_per_tyre: 1200, km_at_fitment: 500, km_at_removal: 60500 },
  ], error: null, truncated: false })),
}))
vi.mock('../lib/api/governedCost', () => ({
  loadGovernedCostSplit: vi.fn(() => Promise.resolve({ tyre: 2500000, blended: false })),
  COST_SPLIT_TTL_MS: 1000,
}))
vi.mock('../lib/api/warranty', () => ({ listWarrantyClaims: vi.fn(() => Promise.resolve([{ brand: 'Alpha', claim_status: 'Credit Issued', credit_amount: 400 }])) }))
vi.mock('../lib/api/brandSizeCpk', () => ({ getBrandSizeCpk: vi.fn(() => Promise.resolve([])) }))

import BrandPerformance from '../pages/BrandPerformance'

beforeEach(() => cleanup())

describe('BrandPerformance page', () => {
  it('renders KPIs, the scoreboard and the insight from real rows', async () => {
    render(<MemoryRouter><BrandPerformance /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0))
    expect(screen.getByText('Brand scoreboard', { selector: 'h2' })).toBeTruthy()
    expect(screen.getByText(/Alpha has the best composite score/)).toBeTruthy()
    expect(screen.getByText('SAR 2.50M')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Volume and detail/ }))
    await waitFor(() => expect(screen.getByText('Brand detail')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /Value by size/ }))
    await waitFor(() => expect(screen.getByText(/Brand and price by size/)).toBeTruthy())
  })
})
