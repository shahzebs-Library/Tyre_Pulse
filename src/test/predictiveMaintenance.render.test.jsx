import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Smoke render of the rebuilt Predictive Maintenance page with the REAL engines
// and table kit. Services are mocked; nothing touches the network.
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR', appSettings: {} }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, language: 'en', dir: 'ltr' }) }))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: null }) }))

const life = vi.hoisted(() => ({ fn: null }))
const bd = vi.hoisted(() => ({ fn: null }))
vi.mock('../lib/api/tyreRunningLife', () => ({ getTyreRunningLife: (...a) => life.fn(...a) }))
vi.mock('../lib/api/assetBreakdowns', () => ({ listAssetBreakdowns: (...a) => bd.fn(...a) }))
vi.mock('../lib/api/predictiveSignals', () => ({
  listRecentJobCards: vi.fn(() => Promise.resolve({
    rows: [1, 2, 3].map((n) => ({ id: n, asset_no: 'TM900', country: 'KSA', site: 'JED', opened_at: new Date(Date.now() - n * 86400000).toISOString() })),
    truncated: false,
  })),
  getSignalCoverage: vi.fn(() => Promise.resolve({ tyres: 11260, withTread: 0, withPressure: 0, withRisk: 0, fleet: 1622, withKm: 497, withBudget: 0 })),
  listFitmentHistory: vi.fn(() => Promise.resolve({ rows: [], truncated: false })),
}))

import PredictiveMaintenance from '../pages/PredictiveMaintenance'

const wrap = () => render(<MemoryRouter><PredictiveMaintenance /></MemoryRouter>)
beforeEach(() => {
  cleanup()
  life.fn = vi.fn(() => Promise.resolve({
    ok: true,
    rows: [
      { serial_no: 'OVER1', asset_no: 'TM514', position: 'LHF1', size: '315/80R22.5', site: 'NHC', unit: 'km', days_on: 300, km_run: 70000, expected_life_km: 60000, remaining_km: 0, life_used_pct: 117 },
      { serial_no: 'FINE1', asset_no: 'TM515', position: 'LHF1', size: '315/80R22.5', site: 'NHC', unit: 'km', days_on: 100, km_run: 10000, expected_life_km: 60000, remaining_km: 50000, life_used_pct: 17 },
    ],
  }))
  bd.fn = vi.fn(() => Promise.resolve({ ok: true, rows: [], truncated: false }))
})

describe('PredictiveMaintenance (real signals only)', () => {
  it('lists due tyres, the outlook, repeat job cards and the not-recorded note', async () => {
    wrap()
    await waitFor(() => expect(screen.getAllByText('OVER1').length).toBeGreaterThan(0))
    expect(screen.queryByText('FINE1')).toBeNull()
    await waitFor(() => expect(screen.getAllByText('TM900').length).toBeGreaterThan(0))
    expect(screen.getByText(/Not recorded yet: tread depth, tyre pressure, risk level and monthly tyre budget/)).toBeTruthy()
    expect(screen.getByText(/497 of 1,622 assets have a current odometer reading/)).toBeTruthy()
    expect(screen.getByText('Expected replacements, next 90 days')).toBeTruthy()
  })

  it('shows an error with a retry, not "nothing due", when running life cannot be read', async () => {
    life.fn = vi.fn(() => Promise.resolve({ ok: false, reason: 'Could not reach the server.' }))
    wrap()
    await waitFor(() => expect(screen.getAllByText(/Could not reach the server\./).length).toBeGreaterThan(0))
    expect(screen.queryByText(/is past or near its expected life/)).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0)
  })

  it('keeps repeat job cards on screen when the breakdown register fails', async () => {
    bd.fn = vi.fn(() => Promise.reject(new Error('denied')))
    wrap()
    await waitFor(() => expect(screen.getAllByText('TM900').length).toBeGreaterThan(0))
    expect(screen.getByText(/The breakdown register could not be read, so this list shows repeat job cards only/)).toBeTruthy()
  })
})
