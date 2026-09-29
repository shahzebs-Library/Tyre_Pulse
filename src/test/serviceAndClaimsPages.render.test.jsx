import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Doughnut: () => null, Line: () => null }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR' }) }))
vi.mock('../lib/api/tyreServiceEvents', () => ({ listServiceEvents: async () => [{ id: 1, event_type: 'repair', event_date: '2026-09-01', tyre_serial: 'S1', asset_no: 'A1', cost: 10 }], createServiceEvent: vi.fn(), updateServiceEvent: vi.fn(), deleteServiceEvent: vi.fn() }))
vi.mock('../lib/api/engineHours', () => ({ ENGINE_HOURS_SOURCES: ['manual'], listEngineHours: async () => [{ id: 1, asset_no: 'G1', engine_hours: 100, reading_date: '2026-08-01' }, { id: 2, asset_no: 'G1', engine_hours: 90, reading_date: '2026-09-01' }], createEngineHours: vi.fn(), updateEngineHours: vi.fn(), deleteEngineHours: vi.fn() }))
vi.mock('../lib/api/insuranceClaims', () => ({ listClaims: async () => { throw Object.assign(new Error('boom'), { code: 'XX000' }) }, createClaim: vi.fn(), updateClaim: vi.fn(), deleteClaim: vi.fn() }))
vi.mock('../lib/api/retreadClaims', () => ({ listRetreadClaims: async () => [{ id: 1, claim_no: 'RTC-9', vendor: 'V', status: 'open', claim_date: '2026-09-01', cost: 100 }], createRetreadClaim: vi.fn(), updateRetreadClaim: vi.fn(), deleteRetreadClaim: vi.fn() }))
import TyreServiceEvents from '../pages/TyreServiceEvents'
import EngineHours from '../pages/EngineHours'
import InsuranceClaims from '../pages/InsuranceClaims'
import RetreadClaims from '../pages/RetreadClaims'
const wrap = (el, url = '/') => render(<MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>)
describe('service and claims pages render every tab', () => {
  it('tse register', async () => { wrap(<TyreServiceEvents />, '/?tab=register'); await waitFor(() => expect(screen.getAllByText('S1').length).toBeGreaterThan(0)) })
  it('tse overview', async () => { wrap(<TyreServiceEvents />); await waitFor(() => expect(screen.getByText('Most-serviced assets')).toBeTruthy()) })
  it('eh anomalies', async () => { wrap(<EngineHours />, '/?tab=anomalies'); await waitFor(() => expect(screen.getAllByText(/10 h/).length).toBeGreaterThan(0)) })
  it('eh register+overview', async () => { wrap(<EngineHours />, '/?tab=register'); await waitFor(() => expect(screen.getAllByText('G1').length).toBeGreaterThan(0)); fireEvent.click(screen.getByRole('tab', { name: /Overview/ })) })
  it('ic error', async () => { wrap(<InsuranceClaims />, '/?tab=register'); await waitFor(() => expect(screen.getAllByText(/Could not load insurance claims/).length).toBeGreaterThan(0)); fireEvent.click(screen.getByRole('tab', { name: /Insurers/ })); fireEvent.click(screen.getByRole('tab', { name: /Overview/ })) })
  it('rc', async () => { wrap(<RetreadClaims />); await waitFor(() => expect(screen.getAllByText('RTC-9').length).toBeGreaterThan(0)); fireEvent.click(screen.getByRole('tab', { name: /Analytics/ })); await waitFor(() => expect(screen.getByText('Vendor performance')).toBeTruthy()); fireEvent.click(screen.getByRole('button', { name: /New claim/ })); expect(screen.getByText('New retread claim')).toBeTruthy() })
})
