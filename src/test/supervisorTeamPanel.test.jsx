import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SupervisorTeamPanel from '../components/driver/SupervisorTeamPanel'
import { handoverPartyReason, handoverPartyNotice, PARTY_CREATED, PARTY_COLLECTED_SIGNATURE, PARTY_IS_DRIVER } from '../lib/handoverParty'

const api = vi.hoisted(() => ({
  listTeam: vi.fn(), driverFilters: vi.fn(), assignmentHistory: vi.fn(), teamCommand: vi.fn(), searchTeamVehicles: vi.fn(),
  isTeamDenied: (err) => err?.code === '42501',
  SUGGESTED_CATEGORIES: ['Transit mixer driver', 'Pump driver'],
}))
vi.mock('../lib/api/fleetSupervisor', () => api)

const adil = { id: 'd-adil', driver_id: '10012816', driver_name: 'ADIL ABBAS SYED', country: 'KSA', site: 'NHC', region: 'Central', driver_category: 'Transit mixer driver', responsible_name: 'Firozuddin Kayal', login_linked: true, asset_no: 'TM655', vehicle_id: 'v1', open_charges: 1, open_fines: 2, last_km: 127702, last_km_date: '2026-11-25' }
const sarfaraj = { id: 'd-sar', driver_id: '10014021', driver_name: 'SARFARAJ TASLIM', country: 'KSA', login_linked: false, open_charges: 0, open_fines: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  api.listTeam.mockImplementation(async (view, _s, _o, f = {}) => {
    let rows = [adil, sarfaraj]
    if (view === 'with_vehicle') rows = rows.filter(r => r.asset_no)
    if (view === 'without_vehicle') rows = rows.filter(r => !r.asset_no)
    if (f.category) rows = rows.filter(r => r.driver_category === f.category)
    return { rows, hasMore: false }
  })
  api.driverFilters.mockResolvedValue({ categories: ['Transit mixer driver'], regions: ['Central'], sites: ['NHC'] })
  api.searchTeamVehicles.mockResolvedValue([{ id: 'v1', asset_no: 'TM655', registration_no: '8448 G X A', site: 'NHC' }])
  api.teamCommand.mockResolvedValue({ ok: true })
  api.assignmentHistory.mockResolvedValue([{ id: 'a1', starts_at: '2026-11-27T06:00:00Z', asset_no: 'TM655', reason: 'Daily mixer', supervisor_name: 'Firozuddin Kayal' }])
})

describe('SupervisorTeamPanel', () => {
  it('lists the team with vehicle, open counts and last km', async () => {
    render(<SupervisorTeamPanel />)
    expect(await screen.findByText('ADIL ABBAS SYED')).toBeInTheDocument()
    expect(screen.getByText(/Open charges: 1 · Open fines: 2/)).toBeInTheDocument()
    expect(screen.getByText(/Last km 127,702 on 2026-11-25/)).toBeInTheDocument()
  })

  it('shows the whole pool with type, region and responsible label; nobody owns a driver', async () => {
    render(<SupervisorTeamPanel />)
    expect(await screen.findByText('ADIL ABBAS SYED')).toBeInTheDocument()
    expect(screen.getByText('SARFARAJ TASLIM')).toBeInTheDocument()
    expect(screen.getByText('Responsible: Firozuddin Kayal')).toBeInTheDocument()
    expect(screen.queryByText('Add to my team')).toBeNull()
    expect(screen.queryByText('Remove from my team')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'No vehicle' }))
    await waitFor(() => expect(screen.queryByText('ADIL ABBAS SYED')).toBeNull())
    expect(screen.getByText('SARFARAJ TASLIM')).toBeInTheDocument()
  })

  it('filters by driver type on the server', async () => {
    render(<SupervisorTeamPanel />)
    await screen.findByText('SARFARAJ TASLIM')
    fireEvent.change(await screen.findByLabelText('Driver type'), { target: { value: 'Transit mixer driver' } })
    await waitFor(() => expect(api.listTeam).toHaveBeenLastCalledWith('all', '', 0, { category: 'Transit mixer driver', region: '' }))
    await waitFor(() => expect(screen.queryByText('SARFARAJ TASLIM')).toBeNull())
  })

  it('saves a driver type and region with a reason', async () => {
    render(<SupervisorTeamPanel />)
    await screen.findByText('SARFARAJ TASLIM')
    fireEvent.click(screen.getAllByText('Driver type and region')[1])
    fireEvent.change(screen.getByLabelText('Driver type value'), { target: { value: 'Pump driver' } })
    fireEvent.change(screen.getByLabelText('Region value'), { target: { value: 'Western' } })
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Moved to pumps' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.teamCommand).toHaveBeenCalledWith('set_driver_profile', { driver_id: 'd-sar', reason: 'Moved to pumps', driver_category: 'Pump driver', region: 'Western' }, expect.any(String)))
  })

  it('refuses a short reason locally', async () => {
    render(<SupervisorTeamPanel />)
    fireEvent.click(await screen.findByText('Take vehicle back'))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Write a reason of at least 3 characters.')).toBeInTheDocument()
    expect(api.teamCommand).not.toHaveBeenCalled()
  })

  it('asks before moving a vehicle held by another driver', async () => {
    api.teamCommand.mockResolvedValueOnce({ ok: false, conflict: { driver_id: 'd-other', driver_name: 'OTHER DRIVER', asset_no: 'TM655' } })
    render(<SupervisorTeamPanel />)
    fireEvent.click(await screen.findByText('Change vehicle'))
    fireEvent.click(await screen.findByRole('option', { name: /TM655/ }))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Swap for the pour' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/TM655 is with OTHER DRIVER/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Move vehicle' }))
    await waitFor(() => expect(api.teamCommand).toHaveBeenLastCalledWith('assign_vehicle', expect.objectContaining({ move_from_driver: 'd-other', vehicle_id: 'v1' }), expect.any(String)))
  })

  it('renders nothing for an account that is not a supervisor here', async () => {
    api.listTeam.mockRejectedValue({ code: '42501' })
    const { container } = render(<SupervisorTeamPanel />)
    await waitFor(() => expect(container.querySelector('[data-testid="supervisor-team-panel"]')).toBeNull())
  })

  it('shows an error with Retry when the list fails', async () => {
    api.listTeam.mockRejectedValueOnce(new Error('boom'))
    render(<SupervisorTeamPanel />)
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows the history of a driver', async () => {
    render(<SupervisorTeamPanel />)
    fireEvent.click((await screen.findAllByText('Assignment history'))[0])
    expect(await screen.findByText('Daily mixer')).toBeInTheDocument()
  })
})

describe('handoverPartyReason', () => {
  const h = { created_by: 'u-c', from_signed_by: 'u-f', to_signed_by: 'u-t', from_driver_id: 'd1', to_driver_id: 'd2' }
  it('names the creator, the signature collector and either driver', () => {
    expect(handoverPartyReason(h, { userId: 'u-c' })).toBe(PARTY_CREATED)
    expect(handoverPartyReason(h, { userId: 'u-t' })).toBe(PARTY_COLLECTED_SIGNATURE)
    expect(handoverPartyReason(h, { userId: 'u-x', linkedDriverId: 'd1' })).toBe(PARTY_IS_DRIVER)
    expect(handoverPartyReason(h, { userId: 'u-x' })).toBeNull()
    expect(handoverPartyReason(null, { userId: 'u-x' })).toBeNull()
    expect(handoverPartyNotice(PARTY_CREATED)).toMatch(/another supervisor/)
  })
})
