import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel }
  return { supabase: { channel: () => channel, removeChannel: vi.fn() } }
})
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../components/workshop/WorkshopTvShareButton', () => ({ default: () => null }))
vi.mock('../lib/api/workshopConfig', () => ({ loadWorkshopConfig: vi.fn(async () => null) }))
vi.mock('../lib/api/workshopLive', () => ({
  loadLiveBoard: vi.fn(),
  listTechnicianSkills: vi.fn(async () => ({})),
}))
vi.mock('../lib/api/workshopAnalytics', () => ({ loadRangeActivity: vi.fn() }))

import * as live from '../lib/api/workshopLive'
import * as hist from '../lib/api/workshopAnalytics'
import { rangePreset, rangeLabel } from '../lib/workshopAnalytics'
import WorkshopLive from '../pages/WorkshopLive'

const liveBoard = () => ({
  technicians: [{ id: 'u1', name: 'Omar Haddad', site: 'NHC' }],
  eventsByUser: {},
  jobs: [],
  jobsById: {},
  assignments: [],
  shiftByUser: {},
  presentByUser: {},
})

const mount = () => render(<MemoryRouter><WorkshopLive /></MemoryRouter>)

describe('WorkshopLive date range', () => {
  it('defaults to today, reads nothing extra, and says when nothing was recorded', async () => {
    live.loadLiveBoard.mockResolvedValueOnce(liveBoard())
    mount()
    await waitFor(() => expect(screen.getByText('Omar Haddad')).toBeTruthy())
    expect(hist.loadRangeActivity).not.toHaveBeenCalled()
    const today = rangePreset('today')
    expect(screen.getAllByText(rangeLabel(today.from, today.to)).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Now').length).toBeGreaterThan(0)
    // No activity today: utilisation is N/A, not 0%.
    expect(screen.getAllByText(/No technician activity recorded in/).length).toBeGreaterThan(0)
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('reads the past days when a quick pick reaches back, and labels the strip', async () => {
    live.loadLiveBoard.mockResolvedValueOnce(liveBoard())
    const y = rangePreset('yesterday')
    hist.loadRangeActivity.mockResolvedValueOnce({
      events: [
        { id: 'e1', user_id: 'u1', event_type: 'check_in', at: `${y.from}T08:00:00` },
        { id: 'e2', user_id: 'u1', event_type: 'start_job', job_id: 'J1', at: `${y.from}T08:00:00` },
        { id: 'e3', user_id: 'u1', event_type: 'check_out', at: `${y.from}T11:00:00` },
      ],
      completedJobs: [{ id: 'J1', status: 'Completed', completed_at: `${y.from}T11:00:00`, site: 'NHC' }],
      shifts: [],
      eventsTruncated: false,
      jobsTruncated: false,
    })
    mount()
    await waitFor(() => expect(screen.getByText('Omar Haddad')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Quick date range'), { target: { value: 'yesterday' } })
    await waitFor(() => expect(hist.loadRangeActivity).toHaveBeenCalledWith({ from: y.from, to: y.to, country: 'KSA' }))
    await waitFor(() => expect(screen.getByText('3h')).toBeTruthy())
    expect(screen.getAllByText(rangeLabel(y.from, y.to)).length).toBeGreaterThan(0)
  })

  it('shows a retry when the range read fails', async () => {
    live.loadLiveBoard.mockResolvedValueOnce(liveBoard())
    hist.loadRangeActivity.mockRejectedValueOnce(new Error('relation "x" does not exist'))
    mount()
    await waitFor(() => expect(screen.getByText('Omar Haddad')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Quick date range'), { target: { value: 'last7' } })
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0))
    expect(screen.queryByText(/relation/)).toBeNull()
  })
})
