import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'

// Real lucide-react + the REAL cpkScenarioStudio engine render fine in jsdom.
// Only the heavy export libs are stubbed to no-ops.
vi.mock('../lib/exportUtils', () => ({
  exportToExcel: () => {},
  exportToPdf: () => {},
  reportFileName: (...p) => p.filter(Boolean).join(' '),
  reportDateLabel: () => '01 Jan 2026',
}))

// The panel fetches the branch/area map on mount; keep it inert in jsdom.
vi.mock('../lib/api/fleetCpk', () => ({
  getFleetAreaMap: () => Promise.resolve([]),
}))

import CpkScenarioStudioPanel from '../components/cpk/CpkScenarioStudioPanel'

const PV = [
  {
    asset_no: 'TM634', vehicle_type: 'TR-MIXER', unit: 'km',
    distance_or_hours: 187080, km: 187080, hours: 0, tyre_cost: 1000, maintenance_cost: 500,
    total_cost: 1500, cpk_tyre: 0.0053, cpk_total: 0.0080,
  },
  {
    asset_no: 'GN103', vehicle_type: 'GENERATOR', unit: 'engine_hours',
    distance_or_hours: 1200, km: 15672, hours: 1200, tyre_cost: 0, maintenance_cost: 600,
    total_cost: 600, cpk_tyre: null, cpk_total: 0.5,
  },
]
const BT = [
  { vehicle_type: 'TR-MIXER', unit: 'km', distance_or_hours: 187080, tyre_cost: 1000, maintenance_cost: 500, total_cost: 1500, cpk_tyre: 0.0053, cpk_total: 0.0080 },
]
const FLEET = [{ country: 'KSA', currency: 'SAR', cpk_tyre: 0.0053, cpk_total: 0.0080 }]

const PROPS = { country: 'KSA', currency: 'SAR' }

beforeEach(() => {
  cleanup()
  try { window.localStorage.clear() } catch { /* ignore */ }
})

describe('CpkScenarioStudioPanel renders and recomputes live', () => {
  it('mounts with populated perVehicle/fleet without throwing', () => {
    expect(() =>
      render(<CpkScenarioStudioPanel {...PROPS} perVehicle={PV} byType={BT} fleet={FLEET} />),
    ).not.toThrow()
  })

  it('mounts with empty data without throwing', () => {
    expect(() =>
      render(<CpkScenarioStudioPanel {...PROPS} perVehicle={[]} byType={[]} fleet={[]} />),
    ).not.toThrow()
  })

  it('recomputes the displayed CPK when a manual km total is typed', () => {
    const { getByLabelText, container } = render(
      <CpkScenarioStudioPanel {...PROPS} perVehicle={PV} byType={BT} fleet={FLEET} />,
    )

    // Baseline km cost/km = 1500 / 187080 = 0.0080
    expect(container.textContent).toContain('0.0080')
    expect(container.textContent).not.toContain('0.0300')

    // Override km total to 50000 -> 1500 / 50000 = 0.0300
    const kmInput = getByLabelText('Manual km total override')
    fireEvent.change(kmInput, { target: { value: '50000' } })

    expect(container.textContent).toContain('0.0300')
  })

  it('renders the fleet km + hours totals tiles', () => {
    const { container } = render(
      <CpkScenarioStudioPanel {...PROPS} perVehicle={PV} byType={BT} fleet={FLEET} />,
    )
    // total km = road 187080 + plant 15672 = 202752
    expect(container.textContent).toContain('Total km (all assets)')
    expect(container.textContent).toContain((187080 + 15672).toLocaleString())
    // km-measured (road) = 187080 ; total engine hours = 1200
    expect(container.textContent).toContain('Km-measured (road)')
    expect(container.textContent).toContain('Hours-measured plant km')
    expect(container.textContent).toContain('Total engine hours')
    expect(container.textContent).toContain((15672).toLocaleString())
  })

  it('shows the km-only cost line when Remove hours is toggled on', () => {
    const { getByLabelText, container } = render(
      <CpkScenarioStudioPanel {...PROPS} perVehicle={PV} byType={BT} fleet={FLEET} />,
    )
    const toggle = getByLabelText('Remove hours cost and hours (km-only view)')
    fireEvent.click(toggle)
    // total cost 2100 over 202752 km = 0.0104
    expect(container.textContent).toContain('If hours are removed')
    expect(container.textContent).toContain('0.0104')
  })
})
