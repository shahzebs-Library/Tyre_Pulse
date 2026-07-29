import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import CaseWorkstreamsPanel from '../components/accidents/CaseWorkstreamsPanel'
import { WORKSTREAMS } from '../lib/accidentCase'

// The accident CASE service (V417) is mocked: the panel is UI over listWorkstreams
// / setWorkstreamStatus + the accident_ws_mark_na RPC. The pure engine
// (../lib/accidentCase: WORKSTREAMS / status tokens / NON_WAIVABLE) is exercised for
// real so the ten canonical workstreams and the mandatory-workstream gate are true.

const setWorkstreamStatus = vi.fn(() => Promise.resolve({}))
const listWorkstreams = vi.fn()

vi.mock('../lib/api/accidentCase', () => ({
  listWorkstreams: (...a) => listWorkstreams(...a),
  setWorkstreamStatus: (...a) => setWorkstreamStatus(...a),
}))

vi.mock('../lib/api/users', () => ({
  listProfiles: () =>
    Promise.resolve([
      { id: 'u1', full_name: 'Sara Khan', username: 'sara', role: 'Manager' },
      { id: 'u2', full_name: 'Omar Ali', username: 'omar', role: 'Fleet Supervisor' },
    ]),
}))

const rpc = vi.fn(() => Promise.resolve({ data: { ok: true }, error: null }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))

// Two stored rows; the remaining eight workstreams have no row yet and must still
// render as "Not started / unassigned".
const twoRows = [
  {
    accident_id: 'a1', workstream_key: 'insurance', workstream: 'insurance',
    status: 'in_progress', owner_id: 'u1', owner_role: 'Insurance Officer', team: 'Insurance',
  },
  {
    accident_id: 'a1', workstream_key: 'repair', workstream: 'repair',
    status: 'assigned', owner_id: 'u2', team: 'Workshop',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  listWorkstreams.mockResolvedValue(twoRows)
})

describe('CaseWorkstreamsPanel', () => {
  it('renders all ten canonical workstreams (rows present and absent alike)', async () => {
    render(<CaseWorkstreamsPanel accidentId="a1" country="KSA" elevated />)
    // Every one of the ten engine workstreams shows, even those with no stored row.
    for (const ws of WORKSTREAMS) {
      expect(await screen.findByText(ws.name)).toBeInTheDocument()
    }
    expect(WORKSTREAMS).toHaveLength(10)
    // The stored insurance row surfaces its status and its resolved owner name.
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText(/Sara Khan/)).toBeInTheDocument()
  })

  it('exposes assign + status controls for an elevated user', async () => {
    render(<CaseWorkstreamsPanel accidentId="a1" country="KSA" elevated />)
    // Expand a workstream row to reveal its controls.
    fireEvent.click(await screen.findByText('Incident & Evidence'))
    expect(screen.getByText('Assign an owner')).toBeInTheDocument()
    expect(screen.getByText('Set status')).toBeInTheDocument()
    expect(screen.getByLabelText('Owner for Incident & Evidence')).toBeInTheDocument()
    expect(screen.getByLabelText('Status for Incident & Evidence')).toBeInTheDocument()
  })

  it('is read-only for a non-elevated user (no assign/status controls)', async () => {
    render(<CaseWorkstreamsPanel accidentId="a1" country="KSA" elevated={false} />)
    fireEvent.click(await screen.findByText('Incident & Evidence'))
    expect(screen.queryByText('Assign an owner')).not.toBeInTheDocument()
    expect(screen.queryByText('Set status')).not.toBeInTheDocument()
    expect(screen.getByText(/read-only access to this case/i)).toBeInTheDocument()
  })

  it('hides mark-not-applicable for a mandatory (non-waivable) workstream', async () => {
    render(<CaseWorkstreamsPanel accidentId="a1" country="KSA" elevated />)
    // liability is in NON_WAIVABLE — the mark-NA control must not appear.
    const heading = await screen.findByText('Safety & Liability')
    fireEvent.click(heading)
    const row = heading.closest('div.border')
    expect(within(row).getByText(/cannot be marked not applicable/i)).toBeInTheDocument()
    expect(within(row).queryByText('Mark not applicable')).not.toBeInTheDocument()
  })
})
