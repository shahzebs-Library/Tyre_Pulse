import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-chartjs-2', () => ({ Bar: () => null }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'm1', role: 'Manager', organisation_id: 'org1' } }) }))
const api = vi.hoisted(() => ({
  listWorkforceAssignments: vi.fn(), listWorkforceAssignmentsPage: vi.fn(), getBoardSummary: vi.fn(),
  recommendAssignees: vi.fn(), listAssignmentEvents: vi.fn(), assignWork: vi.fn(),
}))
vi.mock('../lib/api/workforceDaily', () => ({
  DAILY_ENTRY_CATEGORIES: ['productive','coordination','reporting','training','break','blocked','unassigned'], DAILY_REASON_CATEGORIES: ['blocked'], correctDailyEntry: vi.fn(),
  getMyDailyReport: vi.fn(() => Promise.resolve({ report: null, entries: [] })), listReviewQueue: vi.fn(() => Promise.resolve([])),
  addDailyEntry: vi.fn(), getDailyReportForReview: vi.fn(), ensureDailyReport: vi.fn(), submitDailyReport: vi.fn(), reviewDailyReport: vi.fn(),
}))
vi.mock('../lib/api/workforceEvidence', () => ({ listWorkEvidence: vi.fn(() => Promise.resolve([])), uploadWorkEvidence: vi.fn(), openWorkEvidence: vi.fn() }))
vi.mock('../lib/api/workforceEmployees', () => ({ listAssignmentEvidence: vi.fn(() => Promise.resolve([])), uploadAssignmentEvidence: vi.fn() }))
vi.mock('../lib/api/workforceAssignments', () => ({
  ...api,
  listAssignableEmployees: vi.fn(() => Promise.resolve([
    { id: 'u1', full_name: 'Zainab', employee_id: 'E1', role: 'Tyre Man', approved: true, locked: false },
    { id: 'u2', full_name: 'Ahmad', employee_id: 'E2', role: 'Tyre Man', approved: true, locked: false },
  ])),
  listWorkDependencies: vi.fn(() => Promise.resolve([])), listWorkStandards: vi.fn(() => Promise.resolve([])),
  transitionAssignment: vi.fn(), addWorkDependency: vi.fn(), addWorkStandard: vi.fn(), reassignAssignment: vi.fn(), linkOperationalRecord: vi.fn(),
  qualificationReasonText: c => ({ site_not_assigned: 'not assigned to this site', skill_missing: 'required skill level not recorded' }[c] || c),
  OPERATIONAL_TABLES: { tyre_records: 'Tyre fitment / removal' },
}))

import WorkforceDailyWork from '../pages/WorkforceDailyWork'
import { LanguageProvider } from '../contexts/LanguageContext'

const rows = Object.assign([
  { id: 'a1', title: 'Replace steer tyre', site: 'NHC', status: 'blocked', priority: 'high', assigned_to: 'u1', assigned_by: 'm1', asset_no: 'TM514', tyre_serial: 'YMA1', tyre_position: 'LHF1', operational_record_table: 'tyre_records', created_at: '2026-11-09T06:00:00Z' },
], { total: 250 })

beforeEach(() => {
  cleanup()
  Object.values(api).forEach(f => f.mockReset())
  api.listWorkforceAssignments.mockResolvedValue(rows)
  api.getBoardSummary.mockResolvedValue({ total: 250, by_status: { assigned: 120, in_progress: 40, blocked: 9, submitted: 7, verified: 70 }, overdue: 12, blocked_by_reason: { waiting_stock: 6, not_recorded: 3 }, generated_at: '2026-11-09T10:00:00Z' })
  api.listWorkforceAssignmentsPage.mockResolvedValue({ rows: [{ id: 'a2', title: 'Rotation', status: 'assigned', priority: 'normal', assigned_to: 'u2' }], total: 250 })
  api.listAssignmentEvents.mockResolvedValue([{ id: 'e1', action: 'block', actor_id: 'u1', effective_at: '2026-11-09T07:00:00Z', reason_code: 'waiting_stock', note: 'No 315/80 in stores' }])
  api.recommendAssignees.mockResolvedValue([
    { profile_id: 'u1', full_name: 'Zainab', employee_id: 'E1', designation: 'Tyre Technician', qualified: true, safety_blocked: false, reasons: [], open_assignments: 2, due_same_day: 0 },
    { profile_id: 'u2', full_name: 'Ahmad', employee_id: 'E2', designation: null, qualified: false, safety_blocked: true, reasons: ['skill_missing'], open_assignments: 0, due_same_day: 0 },
  ])
})

async function openBoard () {
  render(<LanguageProvider><MemoryRouter><WorkforceDailyWork /></MemoryRouter></LanguageProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Team Assignments' }))
}

describe('team assignments board', () => {
  it('tiles come from the server totals, not from the loaded page, and say so', async () => {
    await openBoard()
    expect(await screen.findByText(/every assignment visible to you \(250\)/)).toBeTruthy()
    expect(screen.getByText('120')).toBeTruthy() // assigned, though only 1 row is loaded
    expect(screen.getByText(/Waiting for stock \/ tyres 6 \| Cause not recorded 3/)).toBeTruthy()
  })

  it('states truncation and loads more without duplicates', async () => {
    await openBoard()
    const banner = await screen.findByText(/Loaded the newest 1 of 250 assignments/)
    fireEvent.click(within(banner).getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.getByText(/Loaded the newest 2 of 250/)).toBeTruthy())
    expect(api.listWorkforceAssignmentsPage).toHaveBeenCalledWith({ mine: false, page: 1, pageSize: 200 })
  })

  it('a failed total is reported, never silently replaced', async () => {
    api.getBoardSummary.mockRejectedValue(new Error('Team work tracking needs the latest database update'))
    await openBoard()
    expect(await screen.findByText(/Team totals unavailable: Team work tracking needs/)).toBeTruthy()
    expect(screen.getByText(/Counts from the loaded assignments only/)).toBeTruthy()
  })

  it('details drawer shows the audited timeline with the blocker cause and the required record', async () => {
    await openBoard()
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    expect(await screen.findByText(/Cause: Waiting for stock \/ tyres/)).toBeTruthy()
    expect(screen.getByText(/Required before verification: Tyre fitment \/ removal/)).toBeTruthy()
    expect(screen.getByText('TM514')).toBeTruthy()
  })

  it('recommendations explain each person and a safety-blocked person cannot be chosen', async () => {
    await openBoard()
    await waitFor(() => expect(api.recommendAssignees).toHaveBeenCalled(), { timeout: 2000 })
    const list = await screen.findByText(/Suggested people/)
    const panel = list.closest('div').parentElement
    expect(within(panel).getByText(/required skill level not recorded/)).toBeTruthy()
    const buttons = within(panel).getAllByRole('button', { name: 'Choose' })
    expect(buttons[1]).toBeDisabled()
    fireEvent.click(buttons[0])
    expect(within(panel).getByRole('button', { name: 'Selected' })).toBeTruthy()
  })
})
