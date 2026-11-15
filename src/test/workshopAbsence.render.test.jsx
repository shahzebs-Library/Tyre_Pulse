import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Render test for /workshop-absence (never browser-tested in the PR #517 run).
// The real engine and table kit are used; only the data loader, auth and
// settings are mocked. The clock is pinned to 2026-07-14 13:00 Riyadh
// (10:00 UTC) so the classification is deterministic.

const h = vi.hoisted(() => ({ role: 'Manager', load: null }))

vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR', appSettings: {} }),
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u0', role: h.role }, isSuperAdmin: false }),
}))
vi.mock('react-chartjs-2', () => ({ Bar: () => null }))
vi.mock('../lib/exportUtils', () => ({
  exportToExcel: vi.fn(), exportToPdf: vi.fn(), reportFileName: () => 'x', reportDateLabel: () => 'x',
}))
vi.mock('../lib/api/workshopAbsence', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, loadAbsenceData: vi.fn((...a) => h.load(...a)) }
})

import WorkshopAbsence from '../pages/WorkshopAbsence'
import { loadAbsenceData } from '../lib/api/workshopAbsence'

const SHIFT = (id, person, date, extra = {}) => ({
  id, person_name: person, shift_date: date, start_time: '08:00', end_time: '17:00',
  site: 'NHC', status: 'Scheduled', country: 'KSA', ...extra,
})
const DATA = {
  shifts: [
    SHIFT('s1', 'Ahmed Khan', '2026-07-10'),
    SHIFT('s2', 'Ahmed Khan', '2026-07-12'),
    // 05:35 UTC = 08:35 Riyadh: late. Under the old UTC reading this was "present".
    SHIFT('s3', 'Bilal Aziz', '2026-07-14'),
    // 04:55 UTC = 07:55 Riyadh: on time.
    SHIFT('s4', 'Carla Diaz', '2026-07-14', { site: 'JED' }),
    SHIFT('s5', 'Dana Omar', '2026-07-14', { start_time: '15:00' }), // later today: scheduled
    SHIFT('s6', 'Eve Saleh', '2026-07-11', { status: 'Leave' }),
  ],
  attendance: [
    { id: 'a1', user_id: 'u1', shift_id: 's3', check_in: '2026-07-14T05:35:00Z', site: 'NHC', country: 'KSA' },
    { id: 'a2', user_id: 'u2', shift_id: 's4', check_in: '2026-07-14T04:55:00Z', site: 'JED', country: 'KSA' },
  ],
  staff: [{ id: 'u1', full_name: 'Bilal Aziz' }, { id: 'u2', full_name: 'Carla Diaz' }],
}

const wrap = () => render(<MemoryRouter><WorkshopAbsence /></MemoryRouter>)
const tile = (label) => screen.getByText(label, { selector: 'p' }).closest('div').parentElement

beforeEach(() => {
  cleanup()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-14T10:00:00Z'))
  h.role = 'Manager'
  h.load = () => Promise.resolve(DATA)
  loadAbsenceData.mockClear()
})
afterEach(() => vi.useRealTimers())

describe('WorkshopAbsence page', () => {
  it('loads the roster and classifies present / late / absent / scheduled / leave on the site clock', async () => {
    wrap()
    await waitFor(() => expect(within(tile('Absent')).getByText('2')).toBeTruthy())
    expect(within(tile('Present')).getByText('2')).toBeTruthy() // Bilal (late) + Carla
    expect(within(tile('Late')).getByText('1')).toBeTruthy()
    expect(within(tile('Attendance rate')).getByText('50%')).toBeTruthy()
    expect(within(tile('On leave')).getByText('1')).toBeTruthy()
    expect(within(tile('Repeat absentees')).getByText('1')).toBeTruthy()
    // Loader asked for the active country and the default site.
    expect(loadAbsenceData).toHaveBeenCalledWith(expect.objectContaining({ country: 'KSA', site: 'All' }))
    // The register prints the LOCAL check-in time, not the UTC one.
    expect(screen.getAllByText('08:35').length).toBeGreaterThan(0)
    expect(screen.queryByText('05:35')).toBeNull()
  })

  it('status and search filters narrow the register', async () => {
    wrap()
    await waitFor(() => expect(within(tile('Absent')).getByText('2')).toBeTruthy())
    const status = screen.getByText('Status', { selector: 'span' }).parentElement.querySelector('select')
    fireEvent.change(status, { target: { value: 'absent' } })
    expect(screen.getByText(/Register shows 2 of 6 rostered shifts/)).toBeTruthy()
    fireEvent.change(status, { target: { value: 'scheduled' } })
    expect(screen.getByText(/Register shows 1 of 6 rostered shifts/)).toBeTruthy()
    fireEvent.change(status, { target: { value: '' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. Ahmed or NHC'), { target: { value: 'JED' } })
    expect(screen.getByText(/Register shows 1 of 6 rostered shifts/)).toBeTruthy()
    fireEvent.click(screen.getByText('Reset filters'))
    expect(screen.queryByText(/Register shows/)).toBeNull()
  })

  it('site filter is offered from the data and refetches with that site', async () => {
    wrap()
    await waitFor(() => expect(within(tile('Absent')).getByText('2')).toBeTruthy())
    const site = screen.getByText('Site', { selector: 'span' }).parentElement.querySelector('select')
    expect([...site.options].map((o) => o.value)).toEqual(['All', 'JED', 'NHC'])
    fireEvent.change(site, { target: { value: 'JED' } })
    await waitFor(() => expect(loadAbsenceData).toHaveBeenLastCalledWith(expect.objectContaining({ site: 'JED' })))
  })

  it('an empty roster says so instead of showing zeros as a measurement', async () => {
    h.load = () => Promise.resolve({ shifts: [], attendance: [], staff: [] })
    wrap()
    await waitFor(() => expect(screen.getByText('No roster or attendance in this range.')).toBeTruthy())
    expect(within(tile('Attendance rate')).getByText('N/A')).toBeTruthy()
  })

  it('a failed read shows N/A and Retry, and Retry reloads', async () => {
    let calls = 0
    h.load = () => { calls += 1; return calls === 1 ? Promise.reject(Object.assign(new Error('permission denied for table workshop_attendance'), { code: '42501' })) : Promise.resolve(DATA) }
    wrap()
    await waitFor(() => expect(screen.getByText('Retry')).toBeTruthy())
    expect(within(tile('Absent')).getByText('N/A')).toBeTruthy()
    expect(screen.queryByText(/workshop_attendance/)).toBeNull() // raw database text never shown
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(within(tile('Absent')).getByText('2')).toBeTruthy())
  })

  it('a role without access sees the refusal and never reads the roster', async () => {
    h.role = 'Tyre Man'
    wrap()
    expect(screen.getByText('You do not have access to attendance reporting.')).toBeTruthy()
    expect(loadAbsenceData).not.toHaveBeenCalled()
  })
})
