import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const setDays = vi.fn(async () => ({ days: 14, previous: 7 }))
const purge = vi.fn(async () => ({ queued: true, due: 1 }))
vi.mock('../lib/api/tenantExport', () => ({
  getRetentionStatus: vi.fn(async () => ({ days: 7, dueCount: 1, due: [{ jobId: 'j1' }], storedJobs: 2, expiredJobs: 0, lastPurgeAt: null, nextRun: 'daily 02:40 UTC' })),
  setRetentionDays: (...a) => setDays(...a),
  purgeExpiredNow: (...a) => purge(...a),
}))

import RetentionPanel from '../console/pages/tenantExport/RetentionPanel'

describe('RetentionPanel', () => {
  it('shows the window, refuses out-of-range values, saves and purges', async () => {
    render(<RetentionPanel />)
    expect(await screen.findByText('7 day(s)')).toBeTruthy()
    const input = screen.getByLabelText('Retention in days')
    const save = screen.getByRole('button', { name: /Save/ })
    expect(save.disabled).toBe(true)

    fireEvent.change(input, { target: { value: '120' } })
    expect(screen.getByText(/between 1 and 90 days/)).toBeTruthy()
    expect(save.disabled).toBe(true)

    fireEvent.change(input, { target: { value: '14' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(setDays).toHaveBeenCalledWith(14))

    // Deleting files cannot be undone, so the button asks first.
    fireEvent.click(screen.getByRole('button', { name: /Delete expired now/ }))
    expect(purge).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /Delete 1 expired/ }))
    await waitFor(() => expect(purge).toHaveBeenCalled())
    expect(await screen.findByText(/Deleting 1 expired export/)).toBeTruthy()
  })
})
