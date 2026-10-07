import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ws from '../locales/en/workshopStatus.json'
import wsa from '../locales/en/workshopStatusActivity.json'
import common from '../locales/en/common.json'

// Workshop Status -> Activity log + Team workload (Loop 10). The real view
// engine and kit render; only the workshop API, settings and the permission
// RPC are mocked.

const DICT = { workshopStatus: ws, workshopStatusActivity: wsa, common }
function tr(key, vars) {
  let cur = DICT
  for (const part of key.split('.')) cur = cur && typeof cur === 'object' ? cur[part] : undefined
  if (typeof cur !== 'string') return key
  return vars ? cur.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : cur
}
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: tr, language: 'en', dir: 'ltr' }) }))
const settings = vi.hoisted(() => ({ country: 'KSA' }))
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: settings.country }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))

const perms = vi.hoisted(() => ({ value: {} }))
vi.mock('../lib/api/workshopStatusPermissions', () => ({
  loadMyWorkshopPermissions: vi.fn(async () => ({ permissions: perms.value, error: null })),
}))
vi.mock('../lib/api/workshopStatusActivity', () => ({
  listActivity: vi.fn(),
  listRecentUploads: vi.fn(async () => [{ id: 'up1', upload_no: 126, file_name: 'morning.xlsx', report_date: '2026-10-07' }]),
  loadWorkloadRecords: vi.fn(),
  ACTIVITY_PAGE_SIZE: 100,
}))
vi.mock('../lib/api/workshopStatusActive', () => ({ loadActiveVehicles: vi.fn(async () => ({ rows: [], truncated: false })) }))
vi.mock('../lib/api/workshopStatus', () => ({
  listActiveRecords: vi.fn(async () => []),
  findPreviousUploadByHash: vi.fn(),
  stageUpload: vi.fn(),
  confirmUpload: vi.fn(),
  cancelUpload: vi.fn(async () => ({})),
  buildStagedRows: vi.fn(() => []),
}))

import ActivityLogPanel from '../components/workshopStatus/ActivityLogPanel'
import TeamWorkloadPanel from '../components/workshopStatus/TeamWorkloadPanel'
import WorkshopStatus from '../pages/WorkshopStatus'
import { listActivity, loadWorkloadRecords } from '../lib/api/workshopStatusActivity'
import { shapeActivity } from '../lib/workshopStatus/activityView'

const nowIso = new Date().toISOString()
const EVENTS = [
  { id: 'e1', event_type: 'field_change', field_name: 'current_stage', old_value: 'Waiting for Diagnosis', new_value: 'Waiting for Parts', record_id: 'r1', asset_no: 'TM599', site: 'NHC', actor_id: 'a1', actor_name: 'Sajid', created_at: nowIso },
  { id: 'e2', event_type: 'field_change', field_name: 'responsible_user_id', old_value: null, new_value: 'u2', record_id: 'r2', asset_no: 'TM421', site: 'JED', actor_id: 'a1', actor_name: 'Sajid', created_at: nowIso },
  { id: 'e3', event_type: 'upload_confirmed', upload_id: 'up1', actor_id: 'a3', actor_name: 'Vinay', created_at: nowIso, details: { new: 2, updated: 5, removed: 1 } },
]
const people = new Map([['a1', 'Sajid'], ['a3', 'Vinay'], ['u2', 'Ahmed Khan']])
const ROWS = shapeActivity(EVENTS, {
  people,
  records: new Map([
    ['r1', { current_stage: 'Waiting for Parts', delay_reason: 'MR Pending' }],
    ['r2', { current_stage: 'Repair in Progress' }],
  ]),
  uploads: new Map([['up1', { upload_no: 126, file_name: 'morning.xlsx' }]]),
})

const FULL = { view: true, view_activity: true, export: true }

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  settings.country = 'KSA'
  perms.value = FULL
  listActivity.mockResolvedValue({ rows: ROWS, people, hasMore: false, truncated: false, nextCursor: null })
  loadWorkloadRecords.mockResolvedValue({
    rows: [
      { id: 'r1', responsible_user_id: 'u1', responsible_name: 'Ahmed Khan', current_stage: 'Repair in Progress', last_manual_update_at: nowIso },
      { id: 'r2', responsible_user_id: 'u1', responsible_name: 'Ahmed Khan', current_stage: 'Waiting for Parts' },
      { id: 'r3', responsible_user_id: null, current_stage: 'Waiting for Approval' },
    ],
    truncated: false,
  })
})

describe('Activity log panel', () => {
  it('renders who, vehicle, what changed, action and upload', async () => {
    render(<ActivityLogPanel permissions={FULL} permState="ready" />)
    const table = await screen.findByRole('table')
    const t = within(table)
    expect(t.getAllByText('Sajid').length).toBe(2)
    expect(t.getByText('TM599')).toBeTruthy()
    expect(t.getByText('Current stage')).toBeTruthy()
    expect(t.getByText('Waiting for Diagnosis')).toBeTruthy()
    expect(t.getByText('Waiting for Parts')).toBeTruthy()
    expect(t.getByText('Responsible person')).toBeTruthy()
    expect(t.getByText('Ahmed Khan')).toBeTruthy()
    expect(t.getByText('Assignment')).toBeTruthy()
    expect(t.getByText('Excel confirmed')).toBeTruthy()
    expect(t.getByText('Upload #126, morning.xlsx')).toBeTruthy()
    expect(t.getByText('2 added, 5 updated, 1 released')).toBeTruthy()
    expect(listActivity).toHaveBeenCalledWith(expect.objectContaining({ country: 'KSA', limit: 100 }))
  })

  it('sends the action and user filters to the server', async () => {
    render(<ActivityLogPanel permissions={FULL} permState="ready" />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Action type'), { target: { value: 'eta_change' } })
    await waitFor(() => expect(listActivity).toHaveBeenLastCalledWith(expect.objectContaining({ eventType: 'eta_change' })))
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'a3' } })
    await waitFor(() => expect(listActivity).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'a3' })))
  })

  it('filters by current stage on the client', async () => {
    render(<ActivityLogPanel permissions={FULL} permState="ready" />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Current stage'), { target: { value: 'Waiting for Parts' } })
    const t = within(screen.getByRole('table'))
    expect(t.getByText('TM599')).toBeTruthy()
    expect(t.queryByText('TM421')).toBeNull()
    expect(screen.getByText('Showing 1 of 3 loaded events.')).toBeTruthy()
  })

  it('shows an empty state', async () => {
    listActivity.mockResolvedValue({ rows: [], people: new Map(), hasMore: false, nextCursor: null })
    render(<ActivityLogPanel permissions={FULL} permState="ready" />)
    expect(await screen.findByText('No activity in this period')).toBeTruthy()
  })

  it('shows an error with Retry', async () => {
    listActivity.mockRejectedValueOnce(new Error('relation "x" does not exist'))
    render(<ActivityLogPanel permissions={FULL} permState="ready" />)
    expect(await screen.findByText('The activity log could not be loaded')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(await screen.findByRole('table')).toBeTruthy()
  })

  it('loads more with the keyset cursor', async () => {
    listActivity.mockResolvedValueOnce({ rows: ROWS.slice(0, 1), people, hasMore: true, nextCursor: { at: nowIso, id: 'e1' } })
    listActivity.mockResolvedValueOnce({ rows: ROWS.slice(1), people, hasMore: false, nextCursor: null })
    render(<ActivityLogPanel permissions={FULL} permState="ready" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('TM421')).toBeTruthy())
    expect(listActivity).toHaveBeenLastCalledWith(expect.objectContaining({ before: { at: nowIso, id: 'e1' } }))
  })

  it('denies without view_activity and hides export without export', async () => {
    const { unmount } = render(<ActivityLogPanel permissions={{ view: true }} permState="ready" />)
    expect(screen.getByText('Activity log is not available')).toBeTruthy()
    expect(listActivity).not.toHaveBeenCalled()
    unmount()
    render(<ActivityLogPanel permissions={{ view: true, view_activity: true }} permState="ready" />)
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: /Export Excel/ })).toBeNull()
  })
})

describe('Team workload panel', () => {
  it('renders per-person counts, the Unassigned row and totals', async () => {
    render(<TeamWorkloadPanel permissions={FULL} permState="ready" />)
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    const ahmed = rows.find((r) => within(r).queryByText('Ahmed Khan'))
    expect(within(ahmed).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2', '1', '1', '0', '1'])
    const un = rows.find((r) => within(r).queryByText('Unassigned'))
    expect(within(un).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', '0', '0', '1', '1'])
    const total = rows.find((r) => within(r).queryByText('Total'))
    expect(within(total).getAllByRole('cell').map((c) => c.textContent)).toEqual(['3', '1', '1', '1', '2'])
    expect(screen.getByRole('button', { name: /Export Excel/ })).toBeTruthy()
  })

  it('shows empty and error states', async () => {
    loadWorkloadRecords.mockResolvedValueOnce({ rows: [], truncated: false })
    const { unmount } = render(<TeamWorkloadPanel permissions={FULL} permState="ready" />)
    expect(await screen.findByText('No active vehicles')).toBeTruthy()
    unmount()
    loadWorkloadRecords.mockRejectedValueOnce(new Error('boom'))
    render(<TeamWorkloadPanel permissions={FULL} permState="ready" />)
    expect(await screen.findByText('Team workload could not be loaded')).toBeTruthy()
  })

  it('is available with view_reports alone', async () => {
    render(<TeamWorkloadPanel permissions={{ view: true, view_reports: true }} permState="ready" />)
    expect(await screen.findByRole('table')).toBeTruthy()
  })
})

describe('Workshop Status tabs', () => {
  it('hides Activity log and Team workload without view_activity / view_reports', async () => {
    perms.value = { view: true, update: true }
    render(<MemoryRouter><WorkshopStatus /></MemoryRouter>)
    await screen.findByRole('tab', { name: 'Active vehicles' })
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Activity log' })).toBeNull())
    expect(screen.queryByRole('tab', { name: 'Team workload' })).toBeNull()
  })

  it('shows both tabs with view_activity, in order after Active vehicles', async () => {
    perms.value = FULL
    render(<MemoryRouter><WorkshopStatus /></MemoryRouter>)
    await screen.findByRole('tab', { name: 'Activity log' })
    const names = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(names.indexOf('Activity log')).toBe(names.indexOf('Active vehicles') + 1)
    expect(names.indexOf('Team workload')).toBeLessThan(names.indexOf('Daily upload'))
  })

  it('opens the Activity log from ?tab=activity', async () => {
    perms.value = FULL
    render(<MemoryRouter initialEntries={['/daily-ops/workshop?tab=activity']}><WorkshopStatus /></MemoryRouter>)
    expect(await screen.findByText('Who worked on what')).toBeTruthy()
  })

  it('falls back to Active vehicles when ?tab=activity is not allowed', async () => {
    perms.value = { view: true }
    render(<MemoryRouter initialEntries={['/daily-ops/workshop?tab=activity']}><WorkshopStatus /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Active vehicles' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.queryByText('Who worked on what')).toBeNull()
  })
})
