import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../console/components/ui/charts', () => ({
  TrendChart: () => <div data-testid="trend" />, BarsChart: () => <div data-testid="bars" />,
}))
const future = new Date(Date.now() + 45 * 60000).toISOString()
const decide = vi.fn(async () => ({ ok: true }))
const revoke = vi.fn(async () => ({ ok: true }))
vi.mock('../lib/api/jitElevation', () => ({
  listElevations: vi.fn(async () => ({
    rows: [
      { id: 'p1', status: 'pending', target_name: 'Adnan', target_role: 'Manager', module_key: 'stock', capability: 'edit', requested_minutes: 60, reason: 'month end stock count', created_at: new Date().toISOString(), requested_by: 'm' },
      { id: 'a1', status: 'approved', target_name: 'Omar', target_role: 'Inspector', module_key: 'inspections', capability: 'export', requested_minutes: 60, granted_minutes: 60, reason: 'audit pack', created_at: new Date().toISOString(), requested_by: 'o', decided_by: 's', decided_by_name: 'Anum', starts_at: new Date().toISOString(), expires_at: future },
      { id: 'd1', status: 'denied', target_name: 'Sami', module_key: 'budgets', capability: 'approve', requested_minutes: 30, reason: 'approve budgets please', created_at: new Date().toISOString(), decision_note: 'not your remit', requested_by: 'x', decided_by: 's' },
    ],
    total: 3, truncated: false, generatedAt: new Date().toISOString(),
  })),
  decideElevation: (...a) => decide(...a),
  revokeElevation: (...a) => revoke(...a),
  grantElevation: vi.fn(),
  listElevationCandidates: vi.fn(async () => ({ users: [], truncated: false })),
}))

import ConsoleJitElevation from '../console/pages/ConsoleJitElevation'

describe('ConsoleJitElevation', () => {
  it('shows the queue, active grants and history, and requires a reason to end early', async () => {
    render(<ConsoleJitElevation />)
    expect(await screen.findByText('Adnan')).toBeTruthy()
    expect(screen.getByText('Omar')).toBeTruthy()
    expect(screen.getByText(/not your remit/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }))
    const approveBtn = (await screen.findAllByRole('button', { name: /^Approve$/ })).at(-1)
    fireEvent.click(approveBtn)
    await waitFor(() => expect(decide).toHaveBeenCalledWith('p1', { approve: true, note: null, minutes: 60 }))
  })
  it('blocks ending an elevation without a reason', async () => {
    render(<ConsoleJitElevation />)
    fireEvent.click(await screen.findByRole('button', { name: /End now/ }))
    const btns = await screen.findAllByRole('button', { name: /End now/ })
    const confirm = btns.at(-1)
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(/finished early/), { target: { value: 'task complete' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('a1', 'task complete'))
  })
})
