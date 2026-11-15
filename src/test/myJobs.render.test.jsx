// My Jobs: a technician's own assigned work orders (owner decision 2026-11-15, round 2).
// The screen offers status moves, the person's own tasks and a note of work done or a problem.
// It never offers a closing status, and a refusal from the database is shown as a plain sentence.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { WO_REFUSAL, serverWorkOrderAccess, statusMoveRefusalReason, workOrderRefusalReason } from '../lib/workOrderAccess'

const api = vi.hoisted(() => ({
  listMyJobs: vi.fn(),
  setJobStatus: vi.fn(),
  setTaskStatus: vi.fn(),
  recordEvent: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me', role: 'Tyre Man' } }) }))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k), language: 'en' }),
}))
vi.mock('../lib/api/workOrderAccess', () => ({ listMyJobs: api.listMyJobs }))
vi.mock('../lib/api/workshopLive', () => ({
  TASK_STATUS: ['pending', 'in_progress', 'blocked', 'done', 'qc'],
  setJobStatus: api.setJobStatus, setTaskStatus: api.setTaskStatus, recordEvent: api.recordEvent,
}))
const access = serverWorkOrderAccess({ progress: 'assigned' })
const ctx = { userId: 'me', assignedJobIds: new Set(['j1']) }
vi.mock('../hooks/useWorkOrderAccess', () => ({
  useWorkOrderAccess: () => ({
    access, loading: false, assignedOnly: true,
    reason: (action, row) => workOrderRefusalReason(action, access, row, ctx),
    statusReason: (s, row) => statusMoveRefusalReason(s, access, row, ctx),
  }),
}))

import MyJobs from '../pages/MyJobs'

const job = { id: 'j1', work_order_no: 'SYN/JC/0001', asset_no: 'TST1', description: 'Synthetic job', status: 'Assigned', work_type: 'Repair', site: 'NORTH' }
const task = { id: 't1', job_id: 'j1', title: 'Synthetic task', status: 'pending' }
const show = () => render(<MemoryRouter><MyJobs /></MemoryRouter>)

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  api.listMyJobs.mockResolvedValue({ jobs: [job], tasks: [task] })
})

describe('My Jobs', () => {
  it('says so when nothing is assigned', async () => {
    api.listMyJobs.mockResolvedValue({ jobs: [], tasks: [] })
    show()
    expect(await screen.findByText('workorders.myJobs.empty')).toBeTruthy()
  })

  it('a failed read is an error with a retry, never an empty list', async () => {
    api.listMyJobs.mockRejectedValueOnce(new Error('relation "work_orders" does not exist'))
    show()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('workorders.myJobs.loadFailed')).toBeTruthy()
    expect(screen.queryByText('workorders.myJobs.empty')).toBeNull()
    expect(document.body.textContent).not.toMatch(/relation|does not exist/)
  })

  it('offers progress statuses only, never a closing status', async () => {
    show()
    await screen.findByText('SYN/JC/0001')
    for (const s of ['In Progress', 'Waiting for Parts', 'Quality Inspection']) {
      expect(screen.getByRole('button', { name: s }).disabled).toBe(false)
    }
    for (const s of ['Completed', 'Closed', 'Cancelled']) expect(screen.queryByRole('button', { name: s })).toBeNull()
  })

  it('moves the status of an assigned job and reloads', async () => {
    api.setJobStatus.mockResolvedValue({})
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'In Progress' }))
    await waitFor(() => expect(api.setJobStatus).toHaveBeenCalledWith('j1', 'In Progress'))
    expect(await screen.findByText('workorders.myJobs.statusSaved')).toBeTruthy()
    expect(api.listMyJobs).toHaveBeenCalledTimes(2)
  })

  it('updates the status of the person\'s own task', async () => {
    api.setTaskStatus.mockResolvedValue({})
    show()
    const select = await screen.findByLabelText(/taskStatus: Synthetic task/)
    fireEvent.change(select, { target: { value: 'done' } })
    await waitFor(() => expect(api.setTaskStatus).toHaveBeenCalledWith('t1', 'done'))
  })

  it('sends a note of the work done as an activity on that job; an empty note is not sent', async () => {
    api.recordEvent.mockResolvedValue({})
    show()
    const send = await screen.findByRole('button', { name: /submitWork/ })
    fireEvent.click(send)
    expect(await screen.findByText('workorders.myJobs.noteNeeded')).toBeTruthy()
    expect(api.recordEvent).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('workorders.myJobs.note'), { target: { value: 'Changed the hose' } })
    fireEvent.click(send)
    await waitFor(() => expect(api.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'me', job_id: 'j1', event_type: 'complete_task', note: 'Changed the hose',
    })))
  })

  it('a database refusal is shown as its plain sentence, with no raw database text', async () => {
    api.setJobStatus.mockRejectedValueOnce(Object.assign(new Error('x'), {
      cause: { code: '42501', message: WO_REFUSAL.close },
    }))
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Quality Inspection' }))
    expect((await screen.findByRole('alert')).textContent).toContain(WO_REFUSAL.close)
  })

  it('a job that is not theirs has every control disabled with the reason', async () => {
    api.listMyJobs.mockResolvedValue({ jobs: [{ ...job, id: 'other' }], tasks: [] })
    show()
    const btn = await screen.findByRole('button', { name: 'In Progress' })
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('title')).toBe(WO_REFUSAL.assignedOnly)
    expect(screen.getByRole('button', { name: /submitWork/ }).disabled).toBe(true)
  })
})
