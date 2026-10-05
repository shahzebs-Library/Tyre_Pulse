import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Contexts + services mocked; the REAL page, engines (cpkModule/fleetCpkView) and
// all lazy panels render so a render crash on ANY tab surfaces here.
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA' }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k, d) => d || k, language: 'en', dir: 'ltr' }),
}))
const renderPage = () => render(<MemoryRouter><CpkIntelligence /></MemoryRouter>)

const FLEET = [{
  country: 'KSA', currency: 'SAR',
  km: { total_cost_matched: 500000, total_km: 34800000, tyre_cost_matched: 300000, cpk_tyre: 0.0086, cpk_total: 0.0144, coverage_pct: 68, unregistered_cost: 1000 },
  hours: { total_cost_matched: 80000, total_hours: 12000, tyre_cost_matched: 0, cpk_tyre: null, cpk_total: 6.67, coverage_pct: 40, unregistered_cost: 0 },
}]
const PV = [
  { asset_no: 'TM634', vehicle_type: 'TR-MIXER', unit: 'km', distance_or_hours: 187080, tyre_cost: 1000, maintenance_cost: 500, total_cost: 1500, cpk_tyre: 0.005, cpk_total: 0.008 },
  { asset_no: 'GN103', vehicle_type: 'GENERATOR', unit: 'engine_hours', distance_or_hours: 1200, tyre_cost: 0, maintenance_cost: 200, total_cost: 200, cpk_tyre: null, cpk_total: 0.167 },
]
const BT = [
  { vehicle_type: 'TR-MIXER', unit: 'km', distance_or_hours: 187080, tyre_cost: 1000, maintenance_cost: 500, total_cost: 1500, cpk_tyre: 0.005, cpk_total: 0.008 },
  { vehicle_type: 'GENERATOR', unit: 'engine_hours', distance_or_hours: 1200, tyre_cost: 0, maintenance_cost: 200, total_cost: 200, cpk_tyre: null, cpk_total: 0.167 },
]

vi.mock('../lib/api/fleetCpk', () => ({
  getFleetCpk: () => Promise.resolve({ perVehicle: PV, byType: BT, fleet: FLEET }),
  getCpkKmSource: () => Promise.resolve({ ok: true, source: 'monthly_tyre_consumption', basis: 'x', by_asset: [{ asset_no: 'TM634', tyres: 2, km: 187080 }] }),
  getCpkHoursSource: () => Promise.resolve({ ok: true, by_asset: [{ asset_no: 'GN103', readings: 5, hours: 1200 }] }),
  getCpkUnitAudit: () => Promise.resolve({ ok: true, note: 'x', summary: { assets: 2, movable: 1, non_movable: 1, both_present: 1, off_unit_only: 0, used_unit_no_data: 0 }, assets: [
    { asset_no: 'TM634', vehicle_type: 'TR-MIXER', unit: 'km', side: 'movable', km: 187080, hours: 1200, has_km: true, has_hours: true, status: 'both_present' },
  ] }),
  getCpkKmIntelligence: () => Promise.resolve({ ok: false }),
  getFleetAreaMap: () => Promise.resolve([]),
}))
vi.mock('../lib/api/cpkDrivers', () => ({ getCpkDrivers: () => Promise.resolve({ ok: false, windows: null, segments: [] }) }))
vi.mock('../lib/api/brandSizeCpk', () => ({ getBrandSizeCpk: () => Promise.resolve([]) }))

import CpkIntelligence from '../pages/CpkIntelligence'

beforeEach(() => cleanup())

describe('CpkIntelligence renders every tab without crashing', () => {
  it('overview shows the mockup KPIs, both rate charts and the asset-type table from real rows', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('TR-MIXER').length).toBeGreaterThan(0))
    expect(screen.getByText(/Fleet CPK, tyre/)).toBeTruthy()
    expect(screen.getByText(/Non-movable CPH/)).toBeTruthy()
    expect(screen.getByText('Movable assets: cost per km')).toBeTruthy()
    expect(screen.getAllByText('GENERATOR').length).toBeGreaterThan(0)
    expect(screen.getByText('68%')).toBeTruthy()
    // the drivers mock is empty, so the card says so instead of inventing drivers
    expect(screen.getByText(/no change to explain/)).toBeTruthy()
  })

  it('lineage buttons switch to Scenario Studio', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Scenario Studio')).toBeTruthy())
    fireEvent.click(screen.getByText('Scenario Studio'))
    await waitFor(() => expect(screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent).toBe('Scenario studio'))
  })

  it('mounts the default fleet tab', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/CPK Intelligence/i)).toBeTruthy())
  })

  it('clicking through every tab never throws', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/CPK Intelligence/i)).toBeTruthy())
    const tabLabels = ['Per vehicle', 'KM source', 'Units & why different', 'KM intelligence', 'Custom report', 'Scenario studio', 'Brand value', 'Why it changed']
    for (const label of tabLabels) {
      const btn = screen.getAllByRole('tab').find((b) => b.textContent?.trim() === label)
      expect(btn).toBeTruthy()
      fireEvent.click(btn)
      // let the lazy chunk + effects settle; a render throw rejects this.
      await waitFor(() => expect(screen.getByText(/CPK Intelligence/i)).toBeTruthy())
    }
  })
})
