import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Smoke render of the seven upgraded pages with the REAL engines and table kit.
// A module-load or render ReferenceError (the class a clean build cannot see)
// fails here. Services are mocked; nothing touches the network.
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR', appSettings: {} }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, language: 'en', dir: 'ltr' }) }))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: null }) }))
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Line: () => null, Doughnut: () => null }))
vi.mock('../components/EmailPdfButton', () => ({ default: () => null }))
vi.mock('../lib/api/_client', async (orig) => ({ ...(await orig()), probeRelation: vi.fn(() => Promise.resolve({ exists: true, checked: true })) }))

vi.mock('../lib/api/tollTransactions', () => ({
  listTollTransactions: vi.fn(() => Promise.resolve([
    { id: 1, asset_no: 'TM1', plaza_name: 'North', amount: 25, currency: 'SAR', status: 'disputed', payment_method: 'tag', transaction_at: '2026-09-20T08:00:00Z' },
    { id: 2, asset_no: 'TM2', plaza_name: 'South', amount: 40, currency: 'AED', status: 'posted', payment_method: 'card', transaction_at: '2026-09-21T08:00:00Z' },
  ])),
  createTollTransaction: vi.fn(), updateTollTransaction: vi.fn(), deleteTollTransaction: vi.fn(),
}))
vi.mock('../lib/api/trips', () => ({
  listTrips: vi.fn(() => Promise.resolve([
    { id: 1, asset_no: 'TM1', driver_name: 'Ali', origin: 'Riyadh', destination: 'Dammam', started_at: '2026-09-25T06:00:00Z', distance_km: 400, duration_min: 300, status: 'completed' },
  ])),
  createTrip: vi.fn(), updateTrip: vi.fn(), deleteTrip: vi.fn(),
}))
vi.mock('../lib/api/tripReplay', () => ({
  listTripRefs: vi.fn(() => Promise.resolve([{ trip_ref: 'TRIP-1', segments: 2, asset_no: 'TM1', firstAt: '2026-09-01T08:00:00Z', lastAt: '2026-09-01T09:00:00Z' }])),
  listTripSegments: vi.fn(() => Promise.resolve([
    { id: 'a', trip_ref: 'TRIP-1', sequence: 1, latitude: 24.7, longitude: 46.6, speed_kmh: 60, event_type: 'move', recorded_at: '2026-09-01T08:00:00Z' },
    { id: 'b', trip_ref: 'TRIP-1', sequence: 2, latitude: 24.8, longitude: 46.7, speed_kmh: 110, event_type: 'harsh_brake', recorded_at: '2026-09-01T09:00:00Z' },
  ])),
  createTripSegment: vi.fn(), updateTripSegment: vi.fn(), deleteTripSegment: vi.fn(),
}))
vi.mock('../lib/api/tyreAgeCompliance', () => ({
  listTyresForAgeScan: vi.fn(() => Promise.resolve([
    { id: 1, serial_no: 'OLD1', asset_no: 'TM1', brand: 'Michelin', site: 'NHC', manufacture_date: '2017-01-01' },
    { id: 2, serial_no: 'NEW1', asset_no: 'TM2', brand: 'Pirelli', site: 'JED' },
  ])),
}))
vi.mock('../lib/api/tyreRecords', () => ({
  listAllRecords: vi.fn(() => Promise.resolve({ data: [
    { id: 1, serial_no: 'S1', asset_no: 'TM1', brand: 'Michelin', site: 'NHC', status: 'Removed', km_at_fitment: 1000, km_at_removal: 51000, cost_per_tyre: 1000, removal_reason: 'Puncture' },
    { id: 2, serial_no: 'S2', asset_no: 'TM2', brand: 'Pirelli', site: 'JED', status: 'Active' },
  ], error: null, truncated: false })),
}))
vi.mock('../lib/api/costSummary', () => ({ loadGridTyreByAsset: vi.fn(() => Promise.resolve({ map: new Map() })) }))
vi.mock('../lib/api/tyrePool', () => ({
  listPoolCandidates: vi.fn(() => Promise.resolve([{ id: 9, serial_no: 'SP1', brand: 'Michelin', size: '315/80R22.5', site: 'NHC', status: 'In stock', cost_per_tyre: 900 }])),
  listPoolEntries: vi.fn(() => Promise.resolve([
    { id: 'p1', tyre_serial: 'POOL-1', status: 'available', pool_location: 'Dubai', reason: 'hot_spare' },
    { id: 'p2', tyre_serial: 'POOL-2', status: 'deployed', pool_location: 'Dubai', reason: 'hot_spare', assigned_to: 'TM517' },
  ])),
  countActiveVehicles: vi.fn(() => Promise.resolve(0)),
  isMissingRelation: () => false,
  addToPool: vi.fn(), assignFromPool: vi.fn(), returnToPool: vi.fn(),
}))
vi.mock('../lib/api/assets', () => ({ listAssets: vi.fn(() => Promise.resolve([{ id: 'f1', asset_no: 'TRK-2', make: 'Volvo', model: 'FH', current_km: 400 }])) }))
vi.mock('../lib/api/vehicleCheckInOut', () => ({
  listCheckInOut: vi.fn(() => Promise.resolve([
    { id: 1, asset_no: 'TRK-2', driver_name: 'Omar', direction: 'out', status: 'open', odometer_km: 500, checked_at: '2026-09-25T08:00:00Z' },
  ])),
  createEntry: vi.fn(), updateEntry: vi.fn(), deleteEntry: vi.fn(),
}))

import TollTransactions from '../pages/TollTransactions'
import Trips from '../pages/Trips'
import TripReplay from '../pages/TripReplay'
import TyreAgeCompliance from '../pages/TyreAgeCompliance'
import TyreFailureCpkBoard from '../pages/TyreFailureCpkBoard'
import TyrePool from '../pages/TyrePool'
import VehicleCheckInOut from '../pages/VehicleCheckInOut'

const wrap = (el) => render(<MemoryRouter>{el}</MemoryRouter>)
beforeEach(() => cleanup())

describe('upgraded toll, trip, tyre and handover pages render', () => {
  it('TollTransactions splits money per currency instead of blending', async () => {
    wrap(<TollTransactions />)
    await waitFor(() => expect(screen.getByText('Spend by currency')).toBeTruthy())
    expect(screen.getAllByText('Mixed currencies: see the per-currency split').length).toBeGreaterThan(0)
  })

  it('Trips renders KPIs and the register', async () => {
    wrap(<Trips />)
    await waitFor(() => expect(screen.getAllByText('Ali').length).toBeGreaterThan(0))
    expect(screen.getByText('Trips logged')).toBeTruthy()
  })

  it('TripReplay loads the first trip and its segments', async () => {
    wrap(<TripReplay />)
    await waitFor(() => expect(screen.getAllByText('TRIP-1').length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.getAllByText('Harsh brake').length).toBeGreaterThan(0))
  })

  it('TyreAgeCompliance shows the removal worklist', async () => {
    wrap(<TyreAgeCompliance />)
    await waitFor(() => expect(screen.getAllByText('OLD1').length).toBeGreaterThan(0))
    expect(screen.getByText(/Removal worklist/)).toBeTruthy()
  })

  it('TyreFailureCpkBoard renders the asset ranking and removed register', async () => {
    wrap(<TyreFailureCpkBoard />)
    await waitFor(() => expect(screen.getByText('Asset CPK ranking')).toBeTruthy())
    expect(screen.getByText('Removed tyre register')).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('Puncture').length).toBeGreaterThan(0))
  })

  it('TyrePool does not recommend against an uncounted fleet', async () => {
    wrap(<TyrePool />)
    await waitFor(() => expect(screen.getAllByText('POOL-1').length).toBeGreaterThan(0))
    expect(screen.getByText(/Replenishment cannot be recommended/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Pool analytics/i }))
    await waitFor(() => expect(screen.getAllByText('SP1').length).toBeGreaterThan(0))
  })

  it('VehicleCheckInOut shows the live board and lists vehicles still out', async () => {
    wrap(<VehicleCheckInOut />)
    await waitFor(() => expect(screen.getByText('Live status', { selector: 'h2' })).toBeTruthy())
    await waitFor(() => expect(screen.getAllByText('Omar').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: /Check in/ }))
    await waitFor(() => expect(screen.getByText('Vehicles still out')).toBeTruthy())
  })
})
