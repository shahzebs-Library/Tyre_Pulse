import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import VehicleMasterCard from '../components/accidents/VehicleMasterCard'

const FULL_ASSET = {
  asset_no: 'TM514', fleet_number: 'F-42', vehicle_type: 'TR-MIXER', make: 'Mercedes', model: 'Actros',
  year: 2021, current_km: 128450, operator_name: 'A. Khan', department: 'Fleet Ops', site: 'GCC Plant',
  country: 'KSA', tyre_size: '315/80R22.5', registration_no: 'REG-99', serial_no: 'SN-1', engine_no: 'EN-1',
  capacity: '10m3', ops_status: 'running',
}

describe('VehicleMasterCard', () => {
  it('renders nothing for a null asset', () => {
    const { container } = render(<VehicleMasterCard asset={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders every "always" row, showing N/A for a missing value', () => {
    render(<VehicleMasterCard asset={{ asset_no: 'TM514' }} />)
    for (const label of [
      'Fleet number', 'Type', 'Make and model', 'Year', 'Current odometer',
      'Operator', 'Department', 'Site', 'Country', 'Tyre size', 'Registration',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0)
  })

  it('hides conditional rows (serial/engine/capacity/ops status) when blank', () => {
    render(<VehicleMasterCard asset={{ asset_no: 'TM514' }} />)
    for (const label of ['Equipment serial', 'Engine number', 'Capacity', 'Operational status']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('shows conditional rows once they carry a value', () => {
    render(<VehicleMasterCard asset={FULL_ASSET} />)
    expect(screen.getByText('Equipment serial')).toBeInTheDocument()
    expect(screen.getByText('SN-1')).toBeInTheDocument()
    expect(screen.getByText('Engine number')).toBeInTheDocument()
    expect(screen.getByText('Capacity')).toBeInTheDocument()
    expect(screen.getByText('Operational status')).toBeInTheDocument()
  })

  it('joins make + model into one row and formats the odometer with a unit', () => {
    render(<VehicleMasterCard asset={FULL_ASSET} />)
    expect(screen.getByText('Mercedes Actros')).toBeInTheDocument()
    expect(screen.getByText('128,450 km')).toBeInTheDocument()
  })

  it('never renders a Region row - vehicle_fleet has no region column (see the component header)', () => {
    render(<VehicleMasterCard asset={{ ...FULL_ASSET, region: 'Central' }} />)
    expect(screen.queryByText('Region')).not.toBeInTheDocument()
    expect(screen.queryByText('Central')).not.toBeInTheDocument()
  })
})
