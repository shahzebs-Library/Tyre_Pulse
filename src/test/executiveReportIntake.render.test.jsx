import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Smoke render of ExecutiveReport and DataIntakeCenter with the REAL engines
// and table kit. Services are mocked; nothing touches the network.
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR', appSettings: { company_name: 'Test Co' } }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'en', dir: 'ltr' }),
}))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: null }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'Admin' } }) }))
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Line: () => null, Doughnut: () => null }))
vi.mock('../components/EmailReportModal', () => ({ default: () => null }))
vi.mock('../components/expense/YearlyTrendPanel', () => ({ default: () => null }))

const RECORDS = [
  { id: 1, asset_no: 'TM1', site: 'NHC', brand: 'TRIANGLE', risk_level: 'Critical', findings: 'low pressure', km_at_fitment: 0, km_at_removal: 50000, cost_per_tyre: 1200, qty: 1, issue_date: '2026-05-01', country: 'KSA' },
  { id: 2, asset_no: 'TM2', site: 'JED', brand: 'PIRELLI', risk_level: null, findings: '', km_at_fitment: 0, km_at_removal: 40000, cost_per_tyre: 1100, qty: 1, issue_date: '2026-06-01', country: 'KSA' },
]
const loadExecutiveData = vi.fn(() => Promise.resolve({
  records: RECORDS, inspections: [], actions: [], fleet: [{ asset_no: 'TM1', site: 'NHC' }, { asset_no: 'TM2', site: 'JED' }],
  truncated: { records: false, inspections: false, actions: false },
}))
vi.mock('../lib/api', () => ({ executiveReport: { loadExecutiveData: (...a) => loadExecutiveData(...a) } }))
vi.mock('../lib/api/governedCost', () => ({
  COST_SPLIT_TTL_MS: 0,
  loadGovernedCostSplit: vi.fn(() => Promise.resolve({ tyre: 5000, maintenance: 100, byMonth: [], blended: false, source: 'governed' })),
}))

// DataIntakeCenter dependencies
const listBatches = vi.fn(() => Promise.reject(new Error('boom')))
vi.mock('../lib/api/imports', () => ({
  listBatches: (...a) => listBatches(...a),
  listFiles: vi.fn(() => Promise.resolve([{ id: 'f1', original_filename: 'old.xlsx', size_bytes: 2048, created_at: '2026-09-01T00:00:00Z', orphan: true }])),
  listProfiles: vi.fn(() => Promise.resolve([])),
}))
vi.mock('../components/intake/MappingProfilesManager', () => ({ default: () => null }))
vi.mock('../components/intake/DataLinkPanel', () => ({ default: () => null }))
vi.mock('../components/intake/CostControlPanel', () => ({ default: () => null }))
vi.mock('../components/intake/DataCompletenessPanel', () => ({ default: () => null }))
vi.mock('../components/intake/ImportTemplatePanel', () => ({ default: () => null }))
vi.mock('../components/intake/HeaderChangeDialog', () => ({ default: () => null }))
vi.mock('../components/intake/IntakeDiagnosticsPanel', () => ({ default: () => null }))
vi.mock('../pages/ProductionM3', () => ({ default: () => null }))
vi.mock('../pages/ScoCosts', () => ({ default: () => null }))
vi.mock('../pages/SanyInvoices', () => ({ default: () => null }))
vi.mock('../pages/SitesIntake', () => ({ default: () => null }))

import ExecutiveReport from '../pages/ExecutiveReport'
import DataIntakeCenter from '../pages/DataIntakeCenter'

const wrap = (el) => render(<MemoryRouter>{el}</MemoryRouter>)
beforeEach(() => { cleanup(); try { localStorage.clear() } catch { /* ignore */ } })

describe('ExecutiveReport', () => {
  it('renders the scope strip, KPI status labels and risk tables from real engines', async () => {
    wrap(<ExecutiveReport />)
    await waitFor(() => expect(screen.getByLabelText('Report scope')).toBeTruthy())
    // The governed grid spend is the headline spend.
    await waitFor(() => expect(screen.getAllByText('SAR 5,000').length).toBeGreaterThan(0))
    // Status is spelt out, never colour only.
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0)
    // One of two records is rated, so the risk score is computed over it.
    expect(screen.getByText('Risk Matrix: Sites × Risk Level')).toBeTruthy()
    expect(screen.getAllByText('NHC').length).toBeGreaterThan(0)
  })

  it('site filter narrows the report without leaving the page', async () => {
    wrap(<ExecutiveReport />)
    const select = await screen.findByLabelText('Filter the report by site')
    fireEvent.change(select, { target: { value: 'JED' } })
    await waitFor(() => expect(screen.getAllByText('JED').length).toBeGreaterThan(0))
    // JED has no rated tyre: the risk score reads Not rated, not 0.
    await waitFor(() => expect(screen.getAllByText('Not rated').length).toBeGreaterThan(0))
  })
})

describe('DataIntakeCenter', () => {
  it('shows a failed recent-imports read as an error with Retry, not as "no imports"', async () => {
    wrap(<DataIntakeCenter />)
    await waitFor(() => expect(screen.getByText('Data Intake Center')).toBeTruthy())
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy())
    expect(screen.queryByText('No imports yet for KSA.')).toBeNull()
    // Orphan files still list (their read succeeded).
    await waitFor(() => expect(screen.getByText('old.xlsx')).toBeTruthy())
  })
})
