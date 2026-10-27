import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, language: 'en', dir: 'ltr' }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCurrency: 'SAR', activeCountry: 'KSA' }) }))
vi.mock('react-chartjs-2', () => ({ Bar: () => <div data-testid="bar" /> }))
vi.mock('../components/VehicleTyreDiagram', () => ({ default: () => <div data-testid="diagram" /> }))
vi.mock('../components/ai/CopilotCard', () => ({ default: () => <div>copilot</div> }))
vi.mock('../components/ui/VehicleMap', () => ({ default: () => <div>map</div> }))

const v360 = vi.hoisted(() => ({
  getVehicle: vi.fn(), getVehicleTyres: vi.fn(), vehiclePhotoUrl: vi.fn(), resolveVehiclePhotoPath: vi.fn(),
  uploadVehiclePhoto: vi.fn(), saveVehicleGps: vi.fn(),
}))
vi.mock('../lib/api/vehicle360', () => v360)
vi.mock('../lib/api/assetHistory', () => ({ loadAssetHistory: vi.fn() }))
vi.mock('../lib/api/vehicleInsurance', () => ({ listVehicleInsuranceLines: vi.fn() }))
vi.mock('../lib/api/vehicle360Extra', () => ({ getVehicleDocumentDates: vi.fn() }))
vi.mock('../lib/api/vehicleMeters', () => ({ saveVehicleMeters: vi.fn() }))

import Vehicle360 from '../pages/Vehicle360'
import { loadAssetHistory } from '../lib/api/assetHistory'
import { listVehicleInsuranceLines } from '../lib/api/vehicleInsurance'
import { getVehicleDocumentDates } from '../lib/api/vehicle360Extra'
import { saveVehicleMeters } from '../lib/api/vehicleMeters'

const vehicle = { id: 7, asset_no: 'BH006', make: 'Toyota', model: 'Hiace', vehicle_type: 'Pickup', site: 'NHC', region: 'Central', country: 'KSA', status: 'Inactive' }
const year = new Date().getFullYear()
const history = {
  fleet: { id: 7, registration_no: '1234 ABC', chassis_no: 'CH123', model_year: 2020 },
  sources: {
    job_card: { ok: true, rows: [{ id: 1, work_order_no: 'WO-1', status: 'Open', opened_at: `${year}-01-05`, description: 'Brake check' }] },
    parts_line: { ok: true, rows: [{ id: 1, currency: 'SAR', event_date: `${year}-01-10`, tyre_cost: 300, spare_cost: 100, oil_cost: 50, line_cost: 450 }] },
    accident: { ok: true, rows: [] }, inspection: { ok: true, rows: [] },
    odometer: { ok: true, rows: [] }, engine_hours: { ok: true, rows: [] },
  },
}

function renderPage(path = '/vehicle/BH006') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/vehicle/:assetNo" element={<Vehicle360 />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  v360.getVehicle.mockResolvedValue(vehicle)
  v360.getVehicleTyres.mockResolvedValue([{ id: 1, serial_no: 'S1', position: 'LHF1', brand: 'X', size: '315', risk_level: 'High', issue_date: '2026-01-01' }])
  v360.vehiclePhotoUrl.mockResolvedValue(null)
  v360.resolveVehiclePhotoPath.mockReturnValue(null)
  loadAssetHistory.mockResolvedValue(history)
  listVehicleInsuranceLines.mockResolvedValue([])
  getVehicleDocumentDates.mockResolvedValue({ insurance_expiry: null })
  saveVehicleMeters.mockReset()
})

describe('Vehicle 360 page', () => {
  it('renders header, breadcrumb, tabs and the six KPI tiles with honest N/A', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'BH006' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0)
    for (const name of ['Overview', 'Tyre Layout', 'Tyre Records', 'Inspections', 'Maintenance', 'Costs & CPK', 'History', 'Documents', 'Compliance']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
    expect(screen.getByText('Total Tyres')).toBeInTheDocument()
    expect(screen.getByText('1 critical')).toBeInTheDocument()
    // no tread / pressure data on the tyre row: N/A with a reason, never 0
    expect(screen.getByText('No tread depth recorded')).toBeInTheDocument()
    expect(screen.getByText('No pressure recorded')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('1234 ABC')).toBeInTheDocument())
    expect(screen.getAllByText('Brake check').length).toBeGreaterThan(0)
    expect(screen.getByText('No inspection is recorded for this vehicle.')).toBeInTheDocument()
  })

  it('shows the cost donut for the single currency without blending', async () => {
    renderPage()
    const card = (await screen.findByRole('region', { name: 'Cost Summary' }))
    await waitFor(() => expect(within(card).getByText('Tyres')).toBeInTheDocument())
    expect(within(card).getByText('Oil & lubricants')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'AED' })).not.toBeInTheDocument()
  })

  it('opens a tab from the URL and switches tabs', async () => {
    renderPage('/vehicle/BH006?tab=history')
    expect(await screen.findByLabelText('Search activity')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Tyre Records' }))
    expect(await screen.findByPlaceholderText('Search serial, brand, position')).toBeInTheDocument()
  })

  it('shows retry when the vehicle cannot be loaded', async () => {
    v360.getVehicle.mockRejectedValueOnce(new Error('boom'))
    renderPage()
    expect(await screen.findByText('Vehicle unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'BH006' })).toBeInTheDocument()
  })

  it('validates and saves inline meter readings', async () => {
    saveVehicleMeters.mockResolvedValue({})
    renderPage()
    await screen.findByRole('heading', { name: 'BH006' })
    fireEvent.click(screen.getByRole('button', { name: /Update meters/ }))
    fireEvent.change(screen.getByLabelText('Odometer km'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: /Save readings/ }))
    expect(await screen.findByText('Readings must be numbers of zero or more.')).toBeInTheDocument()
    expect(saveVehicleMeters).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Odometer km'), { target: { value: '1200' } })
    fireEvent.click(screen.getByRole('button', { name: /Save readings/ }))
    await waitFor(() => expect(saveVehicleMeters).toHaveBeenCalled())
    expect(saveVehicleMeters.mock.calls[0][0].id).toBe(7)
    expect(saveVehicleMeters.mock.calls[0][1].km).toBe('1200')
  })

  it('states when the equipment has no tyres instead of drawing a layout', async () => {
    v360.getVehicle.mockResolvedValue({ ...vehicle, asset_no: 'GN001', vehicle_type: 'GENERATOR' })
    v360.getVehicleTyres.mockResolvedValue([])
    renderPage('/vehicle/GN001')
    expect(await screen.findByText(/carries no tyres/)).toBeInTheDocument()
    expect(screen.queryByTestId('diagram')).not.toBeInTheDocument()
  })
})
