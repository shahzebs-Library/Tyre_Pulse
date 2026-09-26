import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Mounts the REAL Safety & Compliance page over mocked reads: KPIs render,
 * unmeasured checks read N/A, the tables are EnterpriseTable, the site filter
 * narrows the scope, and a failed read is stated with Retry.
 */
vi.mock('chart.js', () => ({ Chart: { register: () => {} }, CategoryScale: {}, LinearScale: {}, BarElement: {}, LineElement: {}, PointElement: {}, ArcElement: {}, RadialLinearScale: {}, Title: {}, Tooltip: {}, Legend: {}, Filler: {} }))
vi.mock('react-chartjs-2', () => ({ Bar: () => <div data-testid="bar" />, Doughnut: () => <div data-testid="doughnut" />, Radar: () => <div data-testid="radar" /> }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA', appSettings: { company_name: 'Acme' } }) }))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: null }) }))

const h = vi.hoisted(() => ({ tyres: vi.fn(), insp: vi.fn(), acc: vi.fn() }))
vi.mock('../lib/api/analyticsReads', () => ({
  listTyreRecordsSince: h.tyres,
  listInspectionsSince: h.insp,
  listAccidentsSince: h.acc,
}))

import SafetyCompliance from '../pages/SafetyCompliance'

const renderPage = () => render(<MemoryRouter><SafetyCompliance /></MemoryRouter>)

beforeEach(() => {
  cleanup()
  h.tyres.mockReset(); h.insp.mockReset(); h.acc.mockReset()
  h.insp.mockResolvedValue({ data: [{ id: 'i1', asset_no: 'TM1', site: 'NHC', inspection_date: '2026-09-01' }], error: null })
  h.acc.mockResolvedValue({ data: [], error: null })
})

describe('SafetyCompliance page', () => {
  it('renders scores, N/A for unmeasured checks and the tread register', async () => {
    h.tyres.mockResolvedValue({ data: [
      { id: 't1', asset_no: 'TM1', site: 'NHC', tread_depth: 1.5, position: 'Steer', serial_no: 'SER-LOW' },
      { id: 't2', asset_no: 'TM2', site: 'JED', tread_depth: 8, position: 'Steer' },
    ], error: null })
    renderPage()
    await waitFor(() => expect(screen.getByText('Overall score')).toBeTruthy())
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Tread depth' }))
    await waitFor(() => expect(screen.getByText('SER-LOW')).toBeTruthy())
    // Site filter narrows the scope to JED, where every tyre is legal.
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'JED' } })
    await waitFor(() => expect(screen.queryByText('SER-LOW')).toBeNull())
  })

  it('states a failed read with Retry instead of an empty page', async () => {
    h.tyres.mockResolvedValue({ data: [], error: { message: 'boom' } })
    renderPage()
    await waitFor(() => expect(screen.getByText('Compliance data could not be loaded.')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy()
  })
})
