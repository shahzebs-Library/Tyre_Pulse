import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Contexts, services and charts are mocked; the REAL pages, EnterpriseTable
// and pure engines render, so a crash on any tab surfaces here.
vi.mock('react-chartjs-2', () => ({ Bar: () => <div data-testid="chart" />, Line: () => <div data-testid="chart" />, Doughnut: () => <div data-testid="chart" /> }))
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'All', activeCurrency: 'SAR', appSettings: {} }),
}))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: null }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k, d) => d || k, language: 'en', dir: 'ltr' }) }))
vi.mock('../components/workflow/EntityApprovalPanel', () => ({ default: () => <div>approval panel</div> }))

const TYRES = [
  { id: 't1', serial_no: 'SN1', brand: 'A', site: 'S1', risk_level: 'Critical', removal_date: '2026-08-01', km_at_fitment: 0, km_at_removal: 1000, cost_per_tyre: 500, qty: 1, removal_reason: 'Wear', position: 'LHF1' },
  { id: 't2', serial_no: 'SN2', brand: 'B', site: 'S2', category: 'Scrap', removal_date: '2026-07-01', km_at_fitment: 0, km_at_removal: 60000 },
  { id: 't3', serial_no: 'SN3', brand: 'A', site: 'S1', issue_date: '2026-06-01', km_at_fitment: 0, km_at_removal: 50000 },
]
const disposalRead = vi.fn(() => Promise.resolve({ data: [{ tyre_record_id: 't1', status: 'Disposed' }], error: null }))
vi.mock('../lib/api/tyreScrap', () => ({
  listTyreDisposals: () => disposalRead(),
  listTyreDisposalsFull: () => disposalRead().then(({ data, error }) => { if (error) throw error; return { rows: data || [], governanceReady: false } }),
  saveTyreDisposal: () => Promise.resolve({}),
  listScrapTyreRecords: () => ({ order: () => ({}) }),
  upsertTyreDisposal: () => Promise.resolve({ error: null }),
}))
const fetchMock = vi.fn(() => Promise.resolve({ data: TYRES, error: null, truncated: false }))
vi.mock('../lib/fetchAll', () => ({ fetchAllPages: (...a) => fetchMock(...a) }))
vi.mock('../lib/api/tyreExchange', () => ({
  listScrappedTyres: () => Promise.resolve({ rows: [{ serial: 'SN9', marked: true, scrapped_by_name: 'Ali', scrapped_at: '2026-09-01', km_run: null, cost_per_tyre: null }], total: 1, marked_total: 1, unattributed_total: 0, linked: { with_job_card: 1, with_cost: 0, with_km: 0, with_disposal: 0 } }),
  getScrapPermissions: () => Promise.resolve({ canScrap: true, canUndo: true }),
  scrapTyreBySerial: vi.fn(), unscrapTyreBySerial: vi.fn(), updateScrapReason: vi.fn(), findTyreBySerial: vi.fn(),
}))
vi.mock('../lib/api/tyrePassport', () => ({
  searchSerials: () => Promise.resolve([]),
  getPassportBundle: () => Promise.resolve({
    records: [{ id: 'r1', serial_no: 'SN1', asset_no: 'TM1', tyre_position: 'LHF1', issue_date: '2026-01-01', km_at_fitment: 0, km_at_removal: 5000, cost_per_tyre: 800, status: 'Removed', removal_date: '2026-05-01' }],
    serviceEvents: [], warrantyClaims: [], statusMarks: [], retreadClaims: [],
  }),
}))

vi.mock('../lib/api/tyrePassportInspections', () => ({ listTyreInspections: () => Promise.resolve({ rows: [], truncated: false }) }))
vi.mock('../lib/api/assets', () => ({ getAssetByNo: () => Promise.resolve(null) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'Admin' }, isSuperAdmin: false }) }))
vi.mock('qrcode', () => ({ default: { toDataURL: () => Promise.resolve('data:image/png;base64,AA') } }))

import TyreScrapManagement from '../pages/TyreScrapManagement'
import TyrePassport from '../pages/TyrePassport'

beforeEach(() => { cleanup(); fetchMock.mockClear() })

describe('TyreScrapManagement', () => {
  it('renders every tab without crashing', async () => {
    render(<MemoryRouter><TyreScrapManagement /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Flagged as scrap')).toBeTruthy())
    for (const tab of ['Scrapped Register', 'By Brand', 'By Site', 'Disposal Log', 'Overview']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      await waitFor(() => expect(screen.getByRole('tab', { name: tab }).getAttribute('aria-selected')).toBe('true'))
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Disposal Log' }))
    // The log table virtualises its rows (none render in jsdom), so assert the
    // panel's own count and status summary instead.
    await waitFor(() => expect(screen.getByText('Disposal log (2 records)')).toBeTruthy())
    expect(screen.getByText('1 disposed, 0 retreaded, 1 pending')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Scrapped Register' }))
    await waitFor(() => expect(screen.getByText('SN9')).toBeTruthy())
  })

  it('selecting a scrapped tyre opens the selected tyre card', async () => {
    render(<MemoryRouter><TyreScrapManagement /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('SN9')).toBeTruthy())
    fireEvent.click(screen.getByText('SN9').closest('tr'))
    await waitFor(() => expect(screen.getByText('Selected tyre')).toBeTruthy())
    expect(screen.getByText(/Scrapped by Ali/)).toBeTruthy()
    // the register row carries no tyre record id, so no disposal can be attached
    expect(screen.getByText(/cannot be attached/)).toBeTruthy()
  })

  it('shows a failed read as a failure with Retry, never as "no scrap"', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ data: null, error: new Error('boom') }))
    render(<MemoryRouter><TyreScrapManagement /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('The scrap analysis could not be loaded.')).toBeTruthy())
    expect(screen.queryByText('No tyres flagged as scrap')).toBeNull()
    expect(screen.queryByText('Flagged as scrap')).toBeNull()
  })

  it('a failed disposal-status read shows Unknown, not Pending', async () => {
    disposalRead.mockImplementationOnce(() => Promise.resolve({ data: null, error: new Error('denied') }))
    render(<MemoryRouter><TyreScrapManagement /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Flagged as scrap')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: 'Disposal Log' }))
    await waitFor(() => expect(screen.getByText('Statuses unavailable')).toBeTruthy())
    expect(screen.getByText(/Statuses show as Unknown and cannot be changed/)).toBeTruthy()
  })
})

describe('TyrePassport', () => {
  it('renders every tab for a serial', async () => {
    render(
      <MemoryRouter initialEntries={['/tyre-passport/SN1']}>
        <Routes><Route path="/tyre-passport/:serial" element={<TyrePassport />} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByRole('tab', { name: /Fitment & Movement/ })).toBeTruthy())
    for (const name of [/Lifecycle Timeline/, /Inspection History/, /Service & Repair/, /Fitment & Movement/, /Warranty/, /Documents/, /Data quality/, /Overview/]) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'))
    }
    fireEvent.click(screen.getByRole('tab', { name: /Fitment & Movement/ }))
    await waitFor(() => expect(screen.getAllByText('TM1').length).toBeGreaterThan(0))
  })
})
