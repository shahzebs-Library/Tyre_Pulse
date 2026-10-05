import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-chartjs-2', () => ({ Bar: () => <div />, Line: () => <div />, Doughnut: () => <div /> }))
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR', appSettings: {} }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
  COUNTRY_CURRENCY: { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' },
}))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: null }) }))
vi.mock('../components/workflow/EntityApprovalPanel', () => ({ default: () => <div>approval panel</div> }))
vi.mock('../components/EmailPdfButton', () => ({ default: () => <button type="button">Email</button> }))
vi.mock('../components/ui/NotInUseNotice', () => ({ default: () => null }))
vi.mock('../lib/fetchAll', () => ({
  fetchAllPages: () => Promise.resolve({
    data: [
      { id: 'r1', serial_number: 'S1', brand: 'B', site: 'NHC', country: 'KSA', category: 'Retread', km_at_fitment: 0, km_at_removal: 40000, cost_per_tyre: 400, removal_date: '2026-05-01' },
      { id: 'r2', serial_number: 'S2', brand: 'B', site: 'NHC', country: 'KSA', category: 'New', km_at_fitment: 0, km_at_removal: 80000, cost_per_tyre: 1600, removal_date: '2026-05-01' },
    ],
    error: null, truncated: false,
  }),
}))
const jobs = vi.fn()
vi.mock('../lib/api/retreadJobs', () => ({
  listRetreadJobs: (...a) => jobs(...a),
  createRetreadJob: vi.fn(), updateRetreadJob: vi.fn(), deleteRetreadJob: vi.fn(),
  setRetreadJobStatus: vi.fn((id, patch) => Promise.resolve({ ...JOB, ...patch })),
  RETREAD_JOB_STATUS_VALUES: ['eligible', 'at_vendor', 'qa', 'returned', 'rejected', 'cancelled'],
  RETREAD_GRADES: ['A', 'B', 'C', 'Reject'],
}))

const JOB = {
  id: 'j1', casing_serial: 'CS-240018', brand: 'Michelin', size: '315/80R22.5', last_asset_no: 'PM-001',
  vendor_name: 'RetreadCo', grade: 'A', cycle: 1, status: 'at_vendor', outcome: 'pending',
  sent_at: '2026-09-01', cost: 460, currency: 'SAR', site: 'NHC', country: 'KSA',
}

import RetreadManagement from '../pages/RetreadManagement'

beforeEach(() => { cleanup(); jobs.mockReset() })

describe('RetreadManagement', () => {
  it('says the register is not set up when the table is missing', async () => {
    jobs.mockResolvedValue({ rows: [], missing: true, truncated: false })
    render(<MemoryRouter><RetreadManagement /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText(/not set up on this database yet/).length).toBeGreaterThan(0))
    expect(screen.getByText('Retread casings')).toBeTruthy()
  })

  it('a failed register read shows an error with Try again, not an empty list', async () => {
    jobs.mockRejectedValue(new Error('boom'))
    render(<MemoryRouter><RetreadManagement /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('Try again').length).toBeGreaterThan(0))
  })

  it('lists casings and opens the lifecycle detail on click', async () => {
    jobs.mockResolvedValue({ rows: [JOB], missing: false, truncated: false })
    render(<MemoryRouter><RetreadManagement /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('CS-240018')).toBeTruthy())
    fireEvent.click(screen.getByText('CS-240018').closest('tr'))
    await waitFor(() => expect(screen.getByText('Lifecycle detail: CS-240018')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Approve return/ }))
    await waitFor(() => expect(screen.getByText(/approved and returned to service/)).toBeTruthy())
  })

  it('every tab renders', async () => {
    jobs.mockResolvedValue({ rows: [], missing: false, truncated: false })
    render(<MemoryRouter><RetreadManagement /></MemoryRouter>)
    for (const tab of ['Vendor Analysis', 'Lifecycle', 'ROI Calculator', 'Overview']) {
      fireEvent.click(await screen.findByRole('tab', { name: tab }))
      await waitFor(() => expect(screen.getByRole('tab', { name: tab }).getAttribute('aria-selected')).toBe('true'))
    }
  })
})
