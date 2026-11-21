// A failed investigator lookup must be shown with a retry, never as
// "no engineer exists" configuration advice.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  getConflictCase: vi.fn(),
  listAssignablePeople: vi.fn(),
}))
vi.mock('../lib/api/inventory', async (orig) => ({
  ...(await orig()),
  getConflictCase: api.getConflictCase,
  listAssignablePeople: api.listAssignablePeople,
}))

import TyreInvestigationPanel from '../components/inventory/TyreInvestigationPanel'
import { LanguageProvider } from '../contexts/LanguageContext'

const CASE = { id: 'c1', serial: 'S1', status: 'open', investigation_status: 'open', investigation_notes: [] }
const WHO = { userId: 'u-admin', role: 'Admin', isSuperAdmin: false }
const ui = () => render(<LanguageProvider><TyreInvestigationPanel conflictId="c1" who={WHO} /></LanguageProvider>)

describe('TyreInvestigationPanel investigator lookup', () => {
  beforeEach(() => { api.getConflictCase.mockReset(); api.listAssignablePeople.mockReset() })

  it('shows the lookup error with a retry instead of the no-candidates advice', async () => {
    api.getConflictCase.mockResolvedValue(CASE)
    api.listAssignablePeople.mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([{ id: 'e1', full_name: 'Eng One', role: 'Tire Planning Engineer' }])
    ui()
    const retry = await screen.findByRole('button', { name: /retry/i })
    expect(document.body.textContent).not.toMatch(/No approved user holds a Tyre or PMV Engineering role/)
    fireEvent.click(retry)
    await waitFor(() => expect(api.listAssignablePeople).toHaveBeenCalledTimes(2))
    await screen.findByText('Eng One (Tire Planning Engineer)')
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })

  it('an empty successful lookup still gives the configuration advice', async () => {
    api.getConflictCase.mockResolvedValue(CASE)
    api.listAssignablePeople.mockResolvedValue([])
    ui()
    await screen.findByText(/No approved user holds a Tyre or PMV Engineering role/)
  })
})
