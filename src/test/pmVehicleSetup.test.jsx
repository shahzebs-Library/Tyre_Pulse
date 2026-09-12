import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import PmVehicleLookup from '../components/PmVehicleLookup'
import { pmVehicleProfile, pmNextDueFromService } from '../lib/pmVehicleSetup'
import { getAssetMatches } from '../lib/api/assets'

vi.mock('../lib/api/assets', () => ({ getAssetMatches: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('vehicle-specific maintenance setup', () => {
  it('uses fleet meter applicability without inventing an interval', () => {
    expect(pmVehicleProfile({ vehicle_type: 'GENERATOR' })).toEqual({ category: 'generator', sources: ['none', 'engine_hours'] })
    expect(pmVehicleProfile({ vehicle_type: 'TR-MIXER' })).toEqual({ category: 'vehicle', sources: ['none', 'odometer', 'engine_hours'] })
    expect(pmVehicleProfile({ vehicle_type: '' })).toEqual({ category: '', sources: ['none'] })
  })
  it('calculates due values from last service, never from current fleet readings', () => {
    expect(pmNextDueFromService({ last_done: '2026-09-01', interval_type: 'days', interval_value: 30,
      meter_source: 'engine_hours', last_done_meter: 1000, meter_interval: 250, current_hours: 1400 })).toEqual({ next_due: '2026-10-01', next_due_meter: 1250 })
    expect(pmNextDueFromService({ meter_source: 'odometer', last_done_meter: '', meter_interval: 10000 })).toEqual({})
    expect(pmNextDueFromService({ meter_source: 'odometer', last_done_meter: 0, meter_interval: 10000 })).toEqual({ next_due_meter: 10000 })
  })
  it('rejects ambiguous fleet numbers instead of selecting the first country', async () => {
    getAssetMatches.mockResolvedValue({ rows: [{ asset_no: 'TM1', country: 'KSA' }, { asset_no: 'TM1', country: 'UAE' }] })
    const onSelect = vi.fn()
    render(<PmVehicleLookup value="TM1" country="All" onChange={() => {}} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Find vehicle'))
    expect(await screen.findByRole('alert')).toHaveTextContent('multiple matches')
    expect(onSelect).not.toHaveBeenCalled()
  })
  it('selects only the exact match in the active country', async () => {
    const vehicle = { asset_no: 'TM1', country: 'KSA' }
    getAssetMatches.mockResolvedValue({ rows: [vehicle, { asset_no: 'TM1', country: 'UAE' }] })
    const onSelect = vi.fn()
    render(<PmVehicleLookup value="TM1" country="KSA" onChange={() => {}} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Find vehicle'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(vehicle))
  })
  it('ignores a lookup after the country changes', async () => {
    let resolve
    getAssetMatches.mockReturnValue(new Promise(r => { resolve = r }))
    const onSelect = vi.fn()
    const view = render(<PmVehicleLookup value="TM1" country="KSA" onChange={() => {}} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Find vehicle'))
    view.rerender(<PmVehicleLookup value="TM1" country="UAE" onChange={() => {}} onSelect={onSelect} />)
    resolve({ rows: [{ asset_no: 'TM1', country: 'KSA' }] })
    await waitFor(() => expect(screen.getByText('Find vehicle')).not.toBeDisabled())
    expect(onSelect).not.toHaveBeenCalled()
  })
})
