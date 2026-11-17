import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const listActionsForSource = vi.fn()
const canCreateCorrectiveAction = vi.fn().mockResolvedValue(true)
vi.mock('../lib/api/correctiveActions', () => ({
  listActionsForSource: (...a) => listActionsForSource(...a),
  canCreateCorrectiveAction: (...a) => canCreateCorrectiveAction(...a),
  isActionClosed: (s) => ['closed', 'resolved', 'cancelled'].includes(String(s || '').toLowerCase()),
  listAssignablePeople: vi.fn().mockResolvedValue([]),
  raiseActionsForInspection: vi.fn(),
}))

import TyreDueBanner from '../components/inspections/TyreDueBanner'

const inspection = {
  id: 'insp-1', asset_no: 'TM101', site: 'NHC',
  tyre_conditions: { LHF1: { position: 'LHF1', condition: 'Puncture' }, LHR1: { position: 'LHR1', condition: 'Damage' } },
}
const damaged = [{ position: 'LHF1', condition: 'Puncture' }, { position: 'LHR1', condition: 'Damage' }]

describe('TyreDueBanner raised-action status', () => {
  it('shows the status instead of the button once every defect has an action', async () => {
    listActionsForSource.mockResolvedValue([
      { source_detail: 'damage:LHF1', status: 'In Progress', assigned_to: 'Ali', due_date: '2099-01-01' },
      { source_detail: 'damage:LHR1', status: 'Closed', closed_at: '2026-10-20T00:00:00Z' },
    ])
    render(<TyreDueBanner entry={null} damaged={damaged} inspection={inspection} />)
    await waitFor(() => expect(screen.getByText('Assigned to Ali')).toBeTruthy())
    expect(screen.getByText('Fixed')).toBeTruthy()
    expect(screen.queryByText(/Raise corrective action/)).toBeNull()
  })

  it('still offers the button for a defect with no action yet', async () => {
    listActionsForSource.mockResolvedValue([{ source_detail: 'damage:LHF1', status: 'Open' }])
    render(<TyreDueBanner entry={null} damaged={damaged} inspection={inspection} />)
    await waitFor(() => expect(screen.getByText('Raise corrective action (1)')).toBeTruthy())
  })

  it('says the defect is open when an older closed action sits beside a newer open one', async () => {
    // listed newest first, as the service returns them
    listActionsForSource.mockResolvedValue([
      { source_detail: 'damage:LHF1', status: 'Open', assigned_to: 'Ali' },
      { source_detail: 'damage:LHF1', status: 'Closed', closed_at: '2026-10-01T00:00:00Z' },
      { source_detail: 'damage:LHR1', status: 'Open' },
    ])
    render(<TyreDueBanner entry={null} damaged={damaged} inspection={inspection} />)
    await waitFor(() => expect(screen.getByText('Assigned to Ali')).toBeTruthy())
    expect(screen.queryByText('Fixed')).toBeNull()
  })

  it('hides the button and explains when the database says the role cannot create actions', async () => {
    listActionsForSource.mockResolvedValue([])
    canCreateCorrectiveAction.mockResolvedValueOnce(false)
    render(<TyreDueBanner entry={null} damaged={damaged} inspection={inspection} />)
    await waitFor(() => expect(screen.getByText(/Your role cannot raise corrective actions/)).toBeTruthy())
    expect(screen.queryByText(/Raise corrective action/)).toBeNull()
  })

  it('keeps the button when the permission check cannot run (the server still decides)', async () => {
    listActionsForSource.mockResolvedValue([])
    canCreateCorrectiveAction.mockResolvedValueOnce(null)
    render(<TyreDueBanner entry={null} damaged={damaged} inspection={inspection} />)
    await waitFor(() => expect(screen.getByText(/Raise corrective action \(2\)/)).toBeTruthy())
  })
})
