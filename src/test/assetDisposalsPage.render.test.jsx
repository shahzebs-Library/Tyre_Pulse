import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Mounts the REAL AssetDisposals page over mocked services and proves the
 * EnterpriseTable conversion: the register renders every machine, a machine
 * with no breakdown row reads "Not recorded" (never 0 days), the candidates
 * panel lists a long-down machine missing from the register, a row opens the
 * detail, and a failed register read is stated with Retry rather than shown
 * as an empty list.
 */

vi.mock('chart.js', () => ({ Chart: { register: () => {} }, CategoryScale: {}, LinearScale: {}, BarElement: {}, ArcElement: {}, Tooltip: {}, Legend: {} }))
vi.mock('react-chartjs-2', () => ({ Bar: () => <div data-testid="bar" />, Doughnut: () => <div data-testid="doughnut" /> }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA', appSettings: { company_name: 'Acme' } }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'Admin' }, isSuperAdmin: false }) }))

const h = vi.hoisted(() => ({ register: vi.fn() }))
const DAY = 86400000
vi.mock('../lib/api/assetDisposals', () => ({
  getDisposalRegister: h.register,
  getDisposalReliability: () => Promise.resolve({ ok: false, reason: 'not_provisioned' }),
  getDisposalFleetBaseline: () => Promise.resolve(null),
  listReplacementBenchmarks: () => Promise.resolve({ rows: [] }),
  updateDisposal: vi.fn(), setDisposalDecision: vi.fn(),
  importDisposalRows: vi.fn(), mapDisposalSheetRows: vi.fn(() => []),
}))
vi.mock('../lib/api/assetBreakdowns', () => ({
  listAssetBreakdowns: () => Promise.resolve({
    rows: [
      { asset_no: 'TM1', reported_on: new Date(Date.now() - 45 * DAY).toISOString().slice(0, 10), returned_to_service: false, details: 'Gearbox' },
      { asset_no: 'IP065', reported_on: new Date(Date.now() - 218 * DAY).toISOString().slice(0, 10), returned_to_service: false, details: 'Evaporator coil' },
    ],
  }),
}))

import AssetDisposals from '../pages/AssetDisposals'

const REG = { ok: true, rows: [
  { id: 'r1', asset_no: 'TM1', asset_type: 'MIXER', region: 'central', site: 'NHC', disposition: 'scrap', status: 'proposed', fleet_status: 'Active', in_register: true },
  { id: 'r2', asset_no: 'TM2', asset_type: 'PUMP', region: 'western', site: 'JED', disposition: 'sell', status: 'approved' },
] }

const renderPage = () => render(<MemoryRouter><AssetDisposals /></MemoryRouter>)

beforeEach(() => { cleanup(); h.register.mockReset() })

describe('AssetDisposals page', () => {
  it('renders the register through EnterpriseTable with honest downtime', async () => {
    h.register.mockResolvedValue(REG)
    renderPage()
    await waitFor(() => expect(screen.getAllByText('TM2').length).toBeGreaterThan(0))
    expect(screen.getAllByText('TM1').length).toBeGreaterThan(0)
    // TM2 has no breakdown row: stated, never a zero.
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0)
    // Down 218 days and not on the list: proposed as a candidate.
    expect(screen.getByText(/Down long enough to consider/)).toBeTruthy()
    expect(screen.getAllByText('IP065').length).toBeGreaterThan(0)
    // The tab switcher is a real tablist.
    expect(screen.getByRole('tab', { name: /Register/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('opens the detail when a register row is clicked', async () => {
    h.register.mockResolvedValue(REG)
    renderPage()
    await waitFor(() => expect(screen.getAllByText('TM2').length).toBeGreaterThan(0))
    const cell = screen.getAllByText('TM2').find(el => el.closest('tr'))
    fireEvent.click(cell.closest('tr'))
    await waitFor(() => expect(screen.getByText('Committee record')).toBeTruthy())
  })

  it('states a failed register read with Retry rather than an empty list', async () => {
    h.register.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(screen.getByText('The disposal register could not be loaded.')).toBeTruthy())
    expect(screen.queryByText('No machines are on the disposal list.')).toBeNull()
    const card = screen.getByText('The disposal register could not be loaded.').closest('div').parentElement
    expect(within(card).getByRole('button', { name: /Retry/ })).toBeTruthy()
  })
})
