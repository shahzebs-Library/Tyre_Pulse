import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  update: vi.fn(),
  rows: [],
}))

vi.mock('../lib/api/_client', async importOriginal => {
  const real = await importOriginal()
  return {
    ...real,
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      rpc: (...a) => h.rpc(...a),
      from: () => {
        const q = {
          update: () => q,
          eq: () => q,
          in: () => q,
          select: () => Promise.resolve(h.update()),
        }
        return q
      },
    },
  }
})

import AssignmentActions from '../components/workforce/AssignmentActions'
import EstimatePanel from '../components/workforce/EstimatePanel'
import { transitionAssignment, getDurationEstimate } from '../lib/api/workforceAssignments'

const item = (status, assigned_to = 'u1') => ({ id: 'a1', status, assigned_to })

describe('AssignmentActions', () => {
  it('sends a plain action straight away', () => {
    const onAct = vi.fn()
    render(<AssignmentActions item={item('assigned')} currentUserId="u1" isManager={false} onAct={onAct} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), 'start', null)
  })

  it('will not block without a reason', () => {
    const onAct = vi.fn()
    render(<AssignmentActions item={item('in_progress')} currentUserId="u1" isManager={false} onAct={onAct} />)
    fireEvent.click(screen.getByRole('button', { name: 'Block' }))
    expect(onAct).not.toHaveBeenCalled()
    const submit = screen.getByRole('button', { name: 'Block' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Block: reason'), { target: { value: 'no valve' } })
    fireEvent.click(screen.getByRole('button', { name: 'Block' }))
    expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), 'block', 'no valve')
  })

  it('shows no action to someone who is not the assignee or a manager', () => {
    render(<AssignmentActions item={item('assigned', 'other')} currentUserId="u1" isManager={false} onAct={vi.fn()} />)
    expect(screen.getByText('No action available')).toBeInTheDocument()
  })
})

describe('transitionAssignment', () => {
  beforeEach(() => { h.rpc.mockReset(); h.update.mockReset() })

  it('requires a note to block before calling the database', async () => {
    await expect(transitionAssignment('a1', 'block')).rejects.toThrow(/note is required/i)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('treats a replay as success and a refusal as an error with a plain sentence', async () => {
    h.rpc.mockResolvedValueOnce({ data: { ok: true, result: 'replayed', status: 'in_progress' }, error: null })
    await expect(transitionAssignment('a1', 'start', { key: 'k-12345678' })).resolves.toMatchObject({ result: 'replayed' })
    h.rpc.mockResolvedValueOnce({ data: { ok: false, result: 'rejected', reason: 'invalid_transition', current_status: 'cancelled' }, error: null })
    await expect(transitionAssignment('a1', 'start')).rejects.toThrow(/moved on/)
  })

  it('falls back to a guarded update when the function is not installed', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    h.update.mockReturnValueOnce({ data: [{ id: 'a1' }], error: null })
    await expect(transitionAssignment('a1', 'start')).resolves.toMatchObject({ legacy: true, status: 'in_progress' })
  })

  it('cannot record a note on the legacy path, so it refuses instead of dropping it', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    await expect(transitionAssignment('a1', 'block', { note: 'x' })).rejects.toThrow(/latest database update/)
  })
})

describe('estimates', () => {
  beforeEach(() => { h.rpc.mockReset() })

  it('says so when the estimate function is not installed', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    const e = await getDurationEstimate({ task_type: 'tyre change' })
    expect(e.status).toBe('unavailable')
  })

  it('does not call the database without a task type', async () => {
    const e = await getDurationEstimate({ task_type: ' ' })
    expect(h.rpc).not.toHaveBeenCalled()
    expect(e.status).not.toBe('estimated')
  })

  it('panel invites a task type first, then shows the result', async () => {
    h.rpc.mockResolvedValue({ data: { n: 0 }, error: null })
    const { rerender } = render(<EstimatePanel taskType="" />)
    expect(screen.getByText(/Enter a task type/)).toBeInTheDocument()
    rerender(<EstimatePanel taskType="tyre change" />)
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    await waitFor(() => expect(h.rpc).toHaveBeenCalled(), { timeout: 2000 })
  })
})
