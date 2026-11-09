import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../contexts/LanguageContext', async importOriginal => (await import('./workforceLanguageMock.js')).mockWorkforceLanguage(importOriginal))
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('react-chartjs-2', () => ({ Bar: () => <div data-testid="bar-chart" /> }))
vi.mock('../lib/api/workforceAnalyticsServer', () => ({ getTeamAnalytics: vi.fn() }))
vi.mock('../lib/api/workforceAssignments', () => ({ NOT_INSTALLED: 'Team work tracking needs the latest database update.' }))
vi.mock('../lib/exportUtils', () => ({ exportSheetsToExcel: vi.fn(async () => true), reportFileName: (...p) => p.join(' ') }))

import TeamAnalyticsPanel from '../components/workforce/TeamAnalyticsPanel'
import { getTeamAnalytics } from '../lib/api/workforceAnalyticsServer'
import { exportSheetsToExcel } from '../lib/exportUtils'

const EMP = '00000000-0000-0000-0000-000000000001'
const row = over => ({
  assigned: 3, awaiting_start: 0, active: 0, blocked: 0, submitted: 1, verified: 2, cancelled: 0, overdue_open: 0,
  rework_returns: 1, rework_rate: 0.3333, verified_with_record: 0, verified_missing_record: 0, override_count: 0, reassignments: 0,
  timed_verified: 2, verified_untimed: 0, avg_active_minutes: 52.5, median_active_minutes: 52.5,
  estimate_vs_actual: { n: 2, estimated_minutes: 90, actual_minutes: 105, actual_to_estimate: 1.167 }, blocked_minutes_closed: 30, ...over,
})
const DATA = {
  totals: row({}), rework_rate: 0.3333,
  per_employee: [{ ...row({}), profile_id: EMP }],
  per_site: [{ ...row({}), site: 'NHC' }],
  blocker_minutes_by_reason: [{ reason: 'waiting_stock', episodes: 1, closed_episodes: 1, closed_minutes: 30, open_episodes: 0, open_minutes: null, unmeasured_episodes: 0 }],
  verification_queue: { scope: 'current_all_dates', count: 1, oldest_age_hours: 41.5, aged_from_last_update: 0 },
  reassignments: 0, override_count: 0,
  coverage: { assignments: 3, verified: 2, verified_timed: 2, verified_untimed: 0, estimate_pairs: 2, events: 9 },
  data_freshness: { latest_change: '2026-11-08T10:00:00Z', latest_event: '2026-11-08T10:00:00Z', generated_at: '2026-11-09T08:00:00Z' },
}
const people = new Map([[EMP, { full_name: 'Emp One', employee_id: 'E-001' }]])

describe('TeamAnalyticsPanel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders server KPIs, tables and the workflow-facts disclaimer', async () => {
    getTeamAnalytics.mockResolvedValue(DATA)
    render(<TeamAnalyticsPanel employeeById={people} />)
    await waitFor(() => expect(screen.getAllByTestId('team-kpi').length).toBe(8))
    expect(getTeamAnalytics).toHaveBeenCalledWith(expect.objectContaining({ site: null }))
    expect(getTeamAnalytics.mock.calls[0][0].from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(screen.getByText(/not productivity scores/i)).toBeTruthy()
    expect(screen.getAllByText('Emp One').length).toBeGreaterThan(0)
    expect(screen.getAllByText('33.3%').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('bar-chart').length).toBe(2)
    expect(screen.getByText(/Waiting for stock: 1 block/)).toBeTruthy()
  })

  it('shows N/A rather than zero for unmeasured figures', async () => {
    getTeamAnalytics.mockResolvedValue({ ...DATA, rework_rate: null, totals: row({ rework_rate: null, median_active_minutes: null, timed_verified: 0, estimate_vs_actual: { n: 0, estimated_minutes: null, actual_minutes: null, actual_to_estimate: null } }) })
    render(<TeamAnalyticsPanel employeeById={people} />)
    await waitFor(() => expect(screen.getAllByTestId('team-kpi').length).toBe(8))
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(3)
  })

  it('error state offers Retry, which reloads', async () => {
    getTeamAnalytics.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(DATA)
    render(<TeamAnalyticsPanel employeeById={people} />)
    const retry = await screen.findByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getAllByTestId('team-kpi').length).toBe(8))
    expect(getTeamAnalytics).toHaveBeenCalledTimes(2)
  })

  it('not-installed state has no Retry', async () => {
    getTeamAnalytics.mockRejectedValue(new Error('Team work tracking needs the latest database update.'))
    render(<TeamAnalyticsPanel employeeById={people} />)
    expect(await screen.findByText(/latest database update/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('empty window says so', async () => {
    getTeamAnalytics.mockResolvedValue({ ...DATA, totals: { assigned: 0 }, per_employee: [], per_site: [], blocker_minutes_by_reason: [] })
    render(<TeamAnalyticsPanel employeeById={people} />)
    expect(await screen.findByText(/No assignments were created in this window/)).toBeTruthy()
  })

  it('applies the date range and site, refuses a reversed range, and exports', async () => {
    getTeamAnalytics.mockResolvedValue(DATA)
    render(<TeamAnalyticsPanel employeeById={people} />)
    await waitFor(() => expect(screen.getAllByTestId('team-kpi').length).toBe(8))
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-31' } })
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: ' NHC ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(getTeamAnalytics).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31', site: 'NHC' }))
    await waitFor(() => expect(screen.getAllByTestId('team-kpi').length).toBe(8))
    fireEvent.click(screen.getByRole('button', { name: /Excel/ }))
    await waitFor(() => expect(exportSheetsToExcel).toHaveBeenCalled())
    const [sheets] = exportSheetsToExcel.mock.calls[0]
    expect(sheets.map(s => s.name)).toEqual(['Employees', 'Sites', 'Blocked time', 'Definitions'])
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-12-01' } })
    expect(screen.getByText(/start date must be on or before/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Apply' }).disabled).toBe(true)
  })
})
