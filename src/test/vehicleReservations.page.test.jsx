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
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn() }))
vi.mock('../components/ui/PageHeader', () => ({ default: ({ title, actions }) => <header><h1>{title}</h1>{actions}</header> }))

beforeEach(() => { state.country = 'KSA'; state.list.mockReset() })
afterEach(cleanup)

describe('reservation load states', () => {
  it.each([{ code: '42P01' }, new Error('Network unavailable')])('does not turn an unavailable register into zero KPIs or a create-first prompt', async (error) => {
    state.list.mockRejectedValue(error)
    render(<VehicleReservations />)
    await screen.findByText('Vehicle reservations are unavailable.')
    expect(screen.queryByText('No reservations yet. Create your first booking.')).not.toBeInTheDocument()
    expect(screen.getAllByText('N/A')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Excel' })).toBeDisabled()
  })

  it('discards responses from the previous country', async () => {
    let resolveOld
    state.list.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce([{ id: 'new', asset_no: 'Current country plan' }])
    const view = render(<VehicleReservations />)
    state.country = 'UAE'
    view.rerender(<VehicleReservations />)
    await screen.findAllByText('Current country plan')
    await act(async () => resolveOld([{ id: 'old', asset_no: 'Previous country plan' }]))
    await waitFor(() => expect(screen.queryByText('Previous country plan')).not.toBeInTheDocument())
    expect(screen.getAllByText('Current country plan').length).toBeGreaterThan(0)
  })
})
