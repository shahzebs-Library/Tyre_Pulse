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

import * as api from '../lib/api/workshopLive'
import WorkshopLive from '../pages/WorkshopLive'

const NOW = Date.now()
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()

function board() {
  const jobs = [
    { id: 'j1', work_order_no: 'WO-1', asset_no: 'TM514', status: 'In Progress', site: 'NHC', assigned_owner_id: 'u1' },
    { id: 'j2', work_order_no: 'WO-2', asset_no: 'TM600', status: 'New', site: 'NHC', vor: true },
  ]
  return {
    technicians: [
      { id: 'u1', name: 'Omar Haddad', site: 'NHC' },
      { id: 'u2', name: 'Layla Kareem', site: 'NHC' },
    ],
    eventsByUser: {
      u1: [{ id: 'e1', user_id: 'u1', event_type: 'start_job', job_id: 'j1', at: iso(60 * 60_000) }],
      u2: [{ id: 'e2', user_id: 'u2', event_type: 'check_in', at: iso(30 * 60_000) }],
    },
    jobs,
    jobsById: Object.fromEntries(jobs.map((j) => [j.id, j])),
    assignments: [],
    shiftByUser: {},
    presentByUser: { u1: true, u2: true },
  }
}

const mount = () => render(<MemoryRouter><WorkshopLive /></MemoryRouter>)

describe('WorkshopLive page', () => {
  it('renders tiles, technicians, alerts and job flow from the engine', async () => {
    api.loadLiveBoard.mockResolvedValueOnce(board())
    mount()
    expect(await screen.findByText('Omar Haddad')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Workshop Live Control' })).toBeTruthy()
    expect(screen.getByText('Technician Board')).toBeTruthy()
    expect(screen.getByText('Job Flow')).toBeTruthy()
    expect(screen.getByText('WO-1 | TM514')).toBeTruthy()
    // WO-2 has no owner -> engine raises a job_no_owner alert.
    expect(screen.getByText('Job card has no owner')).toBeTruthy()
    // Opening the job board renders the kanban card.
    fireEvent.click(screen.getByRole('button', { name: /Show job board/ }))
    await waitFor(() => expect(screen.getByText('WO-2')).toBeTruthy())
  })

  it('shows an error with retry instead of an empty board', async () => {
    api.loadLiveBoard.mockRejectedValueOnce(new Error('network down'))
    mount()
    expect(await screen.findByText('Could not load the workshop board')).toBeTruthy()
    api.loadLiveBoard.mockResolvedValueOnce(board())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Omar Haddad')).toBeTruthy()
  })
})
