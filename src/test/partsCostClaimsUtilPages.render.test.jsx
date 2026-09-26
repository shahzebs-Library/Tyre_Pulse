/**
 * Render smoke for Parts Catalog, Cost per M3, Claims Summary and Fleet
 * Utilization: each page mounts with data, shows its EnterpriseTable rows, and
 * renders a failed read as an error with Retry, never as an empty result.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// jsdom has no layout, so the virtualizer would render zero rows; list them all.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({ index: i, start: i * 44, end: i * 44 + 44, key: i })),
    getTotalSize: () => count * 44, measureElement: () => {}, scrollToIndex: () => {},
  }),
}))
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Doughnut: () => null, Line: () => null }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR', appSettings: {} }), COUNTRIES: ['KSA', 'UAE', 'Egypt'] }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }))
vi.mock('../components/EmailPdfButton', () => ({ default: () => null }))
vi.mock('../components/trust/ExplainThisNumber', () => ({ default: () => null }))
vi.mock('../components/present/PresentationStudio', () => ({ default: () => null }))
vi.mock('../lib/api/partsCatalog', () => ({
  PART_STATUSES: ['active', 'discontinued'],
  listParts: vi.fn(async () => [
    { id: 1, part_no: 'FLT-1', name: 'Oil filter', category: 'filters', unit_cost: 20, on_hand_qty: 0, reorder_level: 5, supplier: 'Acme', status: 'active' },
    { id: 2, part_no: 'BRK-2', name: 'Pad', category: 'brakes', unit_cost: 100, on_hand_qty: 50, reorder_level: 10, supplier: 'Beta', status: 'active' },
  ]),
  createPart: vi.fn(), updatePart: vi.fn(), deletePart: vi.fn(),
}))
vi.mock('../lib/api/costPerM3', () => ({
  getCostPerM3: vi.fn(async () => ({
    ok: true, currency: 'SAR',
    total: { internal_cost: 90000, tyre_cost: 1, sco_cost: 5000, sany_cost: 5000, grand_total: 100000, production_m3: 8524, cost_per_m3: 11.73 },
    regions: [
      { region: 'Central', internal_cost: 60000, sco_cost: 0, sany_cost: 0, grand_total: 60000, production_m3: 8000, cost_per_m3: 7.5 },
      { region: 'Western', grand_total: 40000, production_m3: 524, cost_per_m3: 76 },
    ],
  })),
  getCostPerM3Trend: vi.fn(async () => ({ ok: true, months: [{ month: '2026-08', grand_total: 5, production_m3: 2000, cost_per_m3: 0.0025 }] })),
  getProductionRejections: vi.fn(async () => ({ ok: true, total: 10, by_site: [], by_reason: [] })),
  countCostM3Rows: vi.fn(async () => ({ sco: 1, sany: 2, production: 3 })),
}))
vi.mock('../lib/api/accidents', () => ({
  listAllAccidentsForPage: vi.fn(async () => ({ data: [
    { id: 1, incident_date: '2026-08-01', asset_no: 'TM1', insurer: 'Walaa', claim_amount: 1000, expected_release_date: '2026-08-10' },
    { id: 2, incident_date: '2026-08-02', asset_no: 'TM2', insurer: 'GGCI', claim_amount: 500, release_date: '2026-08-05' },
  ], error: null })),
}))
vi.mock('../lib/api/assetUtilization', () => ({
  listAssetUtilization: vi.fn(async () => [{ id: 'a', asset_no: 'TM1', country: 'KSA', utilization_pct: 60, linked_to_fleet: true, idle_seconds: 7200, working_seconds: 3600 }]),
}))
vi.mock('../lib/api/assetHistory', () => ({
  listAssetOptions: vi.fn(async () => ({ ok: true, rows: [{ asset_no: 'TM1', country: 'KSA', site: 'NHC', status: 'Active' }, { asset_no: 'TM9', country: 'KSA', site: 'JED', status: 'Active' }] })),
}))

import PartsCatalog from '../pages/PartsCatalog'
import CostPerM3 from '../pages/CostPerM3'
import ClaimsSummary from '../pages/ClaimsSummary'
import FleetUtilization from '../pages/FleetUtilization'
import { listParts } from '../lib/api/partsCatalog'
import { listAllAccidentsForPage } from '../lib/api/accidents'
import { listAssetUtilization } from '../lib/api/assetUtilization'

const wrap = (C) => render(<MemoryRouter><C /></MemoryRouter>)

describe('pages render their registers', () => {
  it('Parts Catalog lists parts', async () => {
    wrap(PartsCatalog)
    expect(await screen.findByText('Parts register')).toBeTruthy()
    expect((await screen.findAllByText('FLT-1')).length).toBeGreaterThan(0)
  })
  it('Cost per M3 withholds a thin region rate', async () => {
    wrap(CostPerM3)
    expect((await screen.findAllByText(/Too little production to measure/)).length).toBeGreaterThan(0)
  })
  it('Claims Summary lists claims', async () => {
    wrap(ClaimsSummary)
    expect(await screen.findByText('Claim detail')).toBeTruthy()
    expect((await screen.findAllByText('TM1')).length).toBeGreaterThan(0)
  })
  it('Fleet Utilization lists assets', async () => {
    wrap(FleetUtilization)
    expect(await screen.findByText('Utilization register')).toBeTruthy()
    expect((await screen.findAllByText('TM1')).length).toBeGreaterThan(0)
  })
})

describe('a failed read is an error, never an empty result', () => {
  it('Parts Catalog', async () => {
    listParts.mockRejectedValueOnce(new Error('boom'))
    wrap(PartsCatalog)
    expect(await screen.findByText('The parts catalog could not be loaded.')).toBeTruthy()
    expect(screen.queryByText(/No parts in the catalog yet/)).toBeNull()
  })
  it('Claims Summary', async () => {
    listAllAccidentsForPage.mockResolvedValueOnce({ data: null, error: new Error('x') })
    wrap(ClaimsSummary)
    expect(await screen.findByText('Claims could not be loaded.')).toBeTruthy()
    expect(screen.queryByText('No insurance claims in range.')).toBeNull()
  })
  it('Fleet Utilization', async () => {
    listAssetUtilization.mockRejectedValueOnce(new Error('x'))
    wrap(FleetUtilization)
    expect((await screen.findAllByText(/Figures read N\/A until it loads/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/No telematics utilization has been loaded/)).toBeNull()
  })
})
