import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-chartjs-2', () => ({ Bar: () => null }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'm1', role: 'Manager' } }),
}))
const api = vi.hoisted(() => ({
  getMyDailyReport: vi.fn(),
  listWorkforceAssignments: vi.fn(),
  listAssignableEmployees: vi.fn(),
  listReviewQueue: vi.fn(),
  listWorkDependencies: vi.fn(),
  listWorkStandards: vi.fn(),
}))
vi.mock('../lib/api/workforceDaily', () => ({
  getMyDailyReport: api.getMyDailyReport, listReviewQueue: api.listReviewQueue,
  addDailyEntry: vi.fn(), getDailyReportForReview: vi.fn(), ensureDailyReport: vi.fn(),
  submitDailyReport: vi.fn(), reviewDailyReport: vi.fn(),
}))
vi.mock('../lib/api/workforceEvidence', () => ({
  listWorkEvidence: vi.fn(() => Promise.resolve([])), uploadWorkEvidence: vi.fn(), openWorkEvidence: vi.fn(),
}))
vi.mock('../lib/api/workforceAssignments', () => ({
  listWorkforceAssignments: api.listWorkforceAssignments, listAssignableEmployees: api.listAssignableEmployees,
  listWorkDependencies: api.listWorkDependencies, listWorkStandards: api.listWorkStandards,
  assignWork: vi.fn(), setWorkStatus: vi.fn(), transitionAssignment: vi.fn(), addWorkDependency: vi.fn(), addWorkStandard: vi.fn(),
}))

import WorkforceDailyWork from '../pages/WorkforceDailyWork'
import { LanguageProvider } from '../contexts/LanguageContext'

const rows = [
  { id: 'a1', title: 'Replace tyre', site: 'NHC', status: 'assigned', priority: 'high', assigned_to: 'u1' },
  { id: 'a2', title: 'Wash fleet', site: 'RIY', status: 'blocked', priority: 'low', assigned_to: 'u2' },
]

beforeEach(() => {
  cleanup()
  api.getMyDailyReport.mockResolvedValue({ report: null, entries: [] })
  api.listReviewQueue.mockResolvedValue([])
  api.listWorkDependencies.mockResolvedValue([])
  api.listWorkStandards.mockResolvedValue([])
  api.listAssignableEmployees.mockResolvedValue([
    { id: 'u1', full_name: 'Zainab', role: 'Driver', approved: true, locked: false },
    { id: 'u2', full_name: 'Ahmad', role: 'Technician', approved: true, locked: false },
  ])
  api.listWorkforceAssignments.mockResolvedValue(rows)
})

async function openAssignments() {
  render(<LanguageProvider><MemoryRouter><WorkforceDailyWork /></MemoryRouter></LanguageProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Team Assignments' }))
}

describe('WorkforceDailyWork states', () => {
  it('shows an error with Retry and recovers on retry', async () => {
    api.getMyDailyReport.mockRejectedValueOnce(new Error('Network down'))
    render(<LanguageProvider><MemoryRouter><WorkforceDailyWork /></MemoryRouter></LanguageProvider>)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Network down')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(api.getMyDailyReport).toHaveBeenCalledTimes(2)
  })

  it('shows the empty message when there are no assignments', async () => {
    api.listWorkforceAssignments.mockResolvedValue([])
    await openAssignments()
    expect(await screen.findByText('No assignments in this view.')).toBeTruthy()
    expect(screen.getByText(/Showing 0 of 0 assignments/)).toBeTruthy()
  })

  it('search and status filter narrow the board and a no-match shows the filtered empty state', async () => {
    await openAssignments()
    await screen.findByText(/Showing 2 of 2 assignments/)
    fireEvent.change(screen.getByPlaceholderText(/Title, site, employee/), { target: { value: 'ahmad' } })
    expect(screen.getByText(/Showing 1 of 2 assignments/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/Title, site, employee/), { target: { value: 'nothing-here' } })
    expect(await screen.findByText('No assignments match the current search or filters.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText(/Showing 2 of 2 assignments/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'blocked' } })
    expect(screen.getByText(/Showing 1 of 2 assignments/)).toBeTruthy()
  })
})
