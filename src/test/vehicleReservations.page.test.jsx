import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VehicleReservations from '../pages/VehicleReservations'

const state = vi.hoisted(() => ({ country: 'KSA', list: vi.fn() }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: state.country }) }))
vi.mock('../lib/api/vehicleReservations', () => ({
  listVehicleReservations: (...args) => state.list(...args),
  createVehicleReservation: vi.fn(), updateVehicleReservation: vi.fn(), deleteVehicleReservation: vi.fn(),
}))
vi.mock('../lib/api/_client', () => ({ isMissingRelation: (err) => err.code === '42P01' }))
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn(), reportFileName: (...p) => p.filter(Boolean).join(' '), reportDateLabel: () => 'today' }))
vi.mock('../lib/api/assets', () => ({ listAssets: () => Promise.resolve([]) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))

beforeEach(() => { state.country = 'KSA'; state.list.mockReset() })
afterEach(cleanup)

describe('reservation load states', () => {
  it.each([{ code: '42P01' }, new Error('Network unavailable')])('does not turn an unavailable register into zero KPIs or a create-first prompt', async (error) => {
    state.list.mockRejectedValue(error)
    render(<VehicleReservations />)
    expect((await screen.findAllByText('Vehicle reservations are unavailable.')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/No reservations yet/)).not.toBeInTheDocument()
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(5)
    expect(screen.getByRole('button', { name: 'Excel' })).toBeDisabled()
  })

  it('discards responses from the previous country', async () => {
    let resolveOld
    state.list.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce([{ id: 'new', asset_no: 'Current country plan', status: 'approved', start_at: '2099-01-01T08:00:00Z' }])
    const view = render(<VehicleReservations />)
    state.country = 'UAE'
    view.rerender(<VehicleReservations />)
    await screen.findAllByText('Current country plan')
    await act(async () => resolveOld([{ id: 'old', asset_no: 'Previous country plan', status: 'approved', start_at: '2099-01-01T08:00:00Z' }]))
    await waitFor(() => expect(screen.queryByText('Previous country plan')).not.toBeInTheDocument())
    expect(screen.getAllByText('Current country plan').length).toBeGreaterThan(0)
  })
})
