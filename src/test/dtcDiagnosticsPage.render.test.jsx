import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Mounts the REAL DTC Diagnostics page over a mocked service: KPIs follow the
 * filters, recurrence is shown, and a missing table renders the migration
 * banner rather than an empty register.
 */
vi.mock('chart.js', () => ({ Chart: { register: () => {} }, ArcElement: {}, Tooltip: {}, Legend: {}, BarElement: {}, CategoryScale: {}, LinearScale: {} }))
vi.mock('react-chartjs-2', () => ({ Bar: () => <div />, Doughnut: () => <div /> }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))

const h = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../lib/api/dtcCodes', () => ({
  listDtcCodes: h.list, createDtcCode: vi.fn(), updateDtcCode: vi.fn(), deleteDtcCode: vi.fn(),
  DTC_SEVERITIES: ['info', 'warning', 'critical'], DTC_STATUSES: ['active', 'acknowledged', 'cleared'],
}))
vi.mock('../lib/api/_client', () => ({ isMissingRelation: (e) => e?.code === '42P01' }))

import DtcDiagnostics from '../pages/DtcDiagnostics'

const renderPage = () => render(<MemoryRouter><DtcDiagnostics /></MemoryRouter>)
beforeEach(() => { cleanup(); h.list.mockReset() })

describe('DtcDiagnostics page', () => {
  it('renders the register with recurrence and narrows on a filter', async () => {
    h.list.mockResolvedValue([
      { id: 1, asset_no: 'TRK-1', code: 'P0301', system: 'Engine', severity: 'critical', status: 'active', detected_at: '2026-09-01' },
      { id: 2, asset_no: 'TRK-1', code: 'P0301', system: 'Engine', severity: 'warning', status: 'cleared', detected_at: '2026-08-01' },
      { id: 3, asset_no: 'TRK-9', code: 'C1234', system: 'ABS', severity: 'info', status: 'active', detected_at: '2026-09-02' },
    ])
    renderPage()
    await waitFor(() => expect(screen.getAllByText('TRK-9').length).toBeGreaterThan(0))
    expect(screen.getAllByText('2 times').length).toBeGreaterThan(0)
    expect(screen.getByText('Figures cover all 3 codes loaded.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('System'), { target: { value: 'ABS' } })
    await waitFor(() => expect(screen.getByText('Figures cover the 1 codes matching the filters.')).toBeTruthy())
  })

  it('renders the migration banner when the table is missing', async () => {
    h.list.mockRejectedValue({ code: '42P01' })
    renderPage()
    await waitFor(() => expect(screen.getByText(/not enabled on this database/)).toBeTruthy())
  })
})
