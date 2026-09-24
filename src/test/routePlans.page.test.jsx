import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RouteOptimization from '../pages/RouteOptimization'
import { exportToExcel } from '../lib/exportUtils'

const state = vi.hoisted(() => ({ country: 'KSA', list: vi.fn() }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: state.country }) }))
vi.mock('../lib/api/routePlans', () => ({
  listRoutePlans: (...args) => state.list(...args),
  createRoutePlan: vi.fn(), updateRoutePlan: vi.fn(), deleteRoutePlan: vi.fn(),
}))
vi.mock('../lib/api/_client', () => ({ isMissingRelation: (err) => err.code === '42P01' }))
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn() }))
vi.mock('../components/ui/PageHeader', () => ({ default: ({ title, actions }) => <header><h1>{title}</h1>{actions}</header> }))

beforeEach(() => { state.country = 'KSA'; state.list.mockReset() })
afterEach(cleanup)

describe('route planning load states', () => {
  it('uses source distances consistently in the register and export even when stored savings are stale', async () => {
    state.list.mockResolvedValue([{
      id: 'plan', plan_name: 'Measured plan', total_distance_km: 100,
      optimized_distance_km: 60, savings_km: 999,
    }])
    render(<RouteOptimization />)
    const row = (await screen.findByText('Measured plan')).closest('tr')
    expect(within(row).getByText('40 km')).toBeInTheDocument()
    expect(within(row).queryByText('999 km')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Excel' }))
    expect(exportToExcel).toHaveBeenLastCalledWith(
      [expect.objectContaining({ savings_km: 40, savings_pct: 40 })],
      expect.any(Array), expect.any(Array), 'route_plans',
    )
  })
  it.each([{ code: '42P01' }, new Error('Network unavailable')])('does not turn an unavailable register into zero KPIs or a create-first prompt', async (error) => {
    state.list.mockRejectedValue(error)
    render(<RouteOptimization />)
    await screen.findByText('Route plans are unavailable.')
    expect(screen.queryByText('No route plans yet. Create your first plan.')).not.toBeInTheDocument()
    expect(screen.getAllByText('N/A')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Excel' })).toBeDisabled()
  })

  it('discards responses from the previous country', async () => {
    let resolveOld
    state.list.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce([{ id: 'new', plan_name: 'Current country plan' }])
    const view = render(<RouteOptimization />)
    state.country = 'UAE'
    view.rerender(<RouteOptimization />)
    await screen.findByText('Current country plan')
    await act(async () => resolveOld([{ id: 'old', plan_name: 'Previous country plan' }]))
    await waitFor(() => expect(screen.queryByText('Previous country plan')).not.toBeInTheDocument())
    expect(screen.getByText('Current country plan')).toBeInTheDocument()
  })
})
