import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Smoke render of the three rebuilt pages with the REAL engines and table kit.
// A module-load or render ReferenceError (the class a clean build cannot see)
// fails here. Services are mocked; nothing touches the network.
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR', appSettings: {} }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'en', dir: 'ltr' }),
}))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: null }) }))
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Line: () => null, Doughnut: () => null, Radar: () => null }))
vi.mock('../components/EmailPdfButton', () => ({ default: () => null }))
vi.mock('../components/EmailReportModal', () => ({ default: () => null }))

const TYRES = [
  { id: 1, asset_no: 'TM1', site: 'NHC', brand: 'TRIANGLE', size: '315/80 R 22.5', position: 'LHF1', km_at_fitment: 0, km_at_removal: 50000, cost_per_tyre: 1200, risk_level: 'Low', country: 'KSA', issue_date: '2026-05-01' },
  { id: 2, asset_no: 'TM2', site: 'NHC', brand: 'TRIANGLE', size: '315/80R22.5', position: 'LHRO', km_at_fitment: 0, km_at_removal: 40000, cost_per_tyre: 1100, risk_level: null, country: 'KSA', issue_date: '2026-06-01' },
  { id: 3, asset_no: 'TM3', site: 'JED', brand: 'PIRELLI', size: '385/65R22.5', position: 'RHF1', km_at_fitment: null, km_at_removal: null, cost_per_tyre: null, risk_level: 'High', country: 'KSA', issue_date: '2026-07-01' },
]

vi.mock('../lib/fetchAll', () => ({
  fetchAllPages: vi.fn((pageFn) => {
    const tableRef = String(pageFn).includes('corrective_actions') ? 'actions' : 'tyres'
    return Promise.resolve({ data: tableRef === 'actions' ? [{ id: 1, site: 'NHC', status: 'Open' }] : TYRES, error: null, truncated: false })
  }),
}))
vi.mock('../lib/api/governedCost', () => ({
  loadGovernedCostSplit: vi.fn(() => Promise.resolve({ tyre: 123456, blended: false, window: { from: '2025-10-01', to: '2026-09-30' } })),
}))
vi.mock('../lib/api/driverSafety', () => ({
  listDriverSafetyEvents: vi.fn(() => Promise.resolve([
    { id: 'e1', driver_name: 'Ahmed', asset_no: 'TM1', event_type: 'speeding', severity: 'high', event_at: '2026-09-01T10:00:00Z', penalty_points: 5, country: 'KSA' },
    { id: 'e2', driver_name: 'Bilal', asset_no: 'TM2', event_type: 'harsh_brake', severity: 'low', event_at: '2026-09-08T10:00:00Z', penalty_points: 1, country: 'KSA' },
  ])),
  listDriverTyreRecords: vi.fn(() => Promise.reject(new Error('boom'))),
  listDriverTrips: vi.fn(() => Promise.resolve([{ driver_name: 'Ahmed', distance_km: 300 }])),
  createDriverSafetyEvent: vi.fn(), updateDriverSafetyEvent: vi.fn(), deleteDriverSafetyEvent: vi.fn(),
}))

import TyreSizeAnalysis from '../pages/TyreSizeAnalysis'
import VendorIntelligence from '../pages/VendorIntelligence'
import DriverSafety from '../pages/DriverSafety'

const wrap = (el) => render(<MemoryRouter>{el}</MemoryRouter>)
beforeEach(() => cleanup())

describe('rebuilt analysis pages render', () => {
  it('TyreSizeAnalysis folds size spacing variants and shows grid spend', async () => {
    wrap(<TyreSizeAnalysis />)
    await waitFor(() => expect(screen.getByText('Fleet tyre spend')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('SAR 123,456')).toBeTruthy())
    // 315/80 R 22.5 and 315/80R22.5 are one size, so two unique sizes remain.
    expect(screen.getAllByText('2 sizes', { exact: false }).length).toBeGreaterThan(0)
  })

  it('VendorIntelligence renders the KPI strip with the expense grid total', async () => {
    wrap(<VendorIntelligence />)
    await waitFor(() => expect(screen.getByText('Fleet tyre spend')).toBeTruthy())
    await waitFor(() => expect(screen.getAllByText('SAR 123,456').length).toBeGreaterThan(0))
  })

  it('DriverSafety renders, and a failed side read is reported rather than shown as none', async () => {
    wrap(<DriverSafety />)
    await waitFor(() => expect(screen.getAllByText('Ahmed').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: /Tyre correlation/i }))
    await waitFor(() => expect(screen.queryByText(/No tyre records carry a driver name yet/)).toBeNull())
    fireEvent.click(screen.getByRole('tab', { name: /Scorecards/i }))
    await waitFor(() => expect(screen.getByText('Weighted driver scorecard')).toBeTruthy())
  })
})
