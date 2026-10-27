import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const listActionsForSource = vi.fn()
vi.mock('../lib/api/correctiveActions', () => ({
  listActionsForSource: (...a) => listActionsForSource(...a),
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
})
