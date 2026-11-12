import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ auth: { profile: { id: 'u1', role: 'Manager' }, isSuperAdmin: false }, rpc: vi.fn() }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...a) => h.rpc(...a) } }))

const { useWriteAccess } = await import('../hooks/useWriteAccess')

beforeEach(() => {
  h.auth = { profile: { id: 'u1', role: 'Manager' }, isSuperAdmin: false }
  h.rpc.mockReset()
})

describe('useWriteAccess asks the server what the database will accept', () => {
  it('a Manager the server refuses gets the work order controls disabled, with the reason', async () => {
    h.rpc.mockResolvedValue({ data: false, error: null })
    const { result } = renderHook(() => useWriteAccess('work_orders'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(h.rpc).toHaveBeenCalledWith('app_user_can', { p_key: 'work_orders', p_cap: 'create' })
    expect(h.rpc).toHaveBeenCalledWith('app_user_can', { p_key: 'work_orders', p_cap: 'edit' })
    expect(result.current).toMatchObject({ create: false, edit: false, delete: false, known: true })
    expect(result.current.reason('create')).toMatch(/Access Control/)
  })

  it('once the server allows it (the pending migration, or an Access Control change) the controls open', async () => {
    h.rpc.mockResolvedValue({ data: true, error: null })
    const { result } = renderHook(() => useWriteAccess('work_orders'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ create: true, edit: true, delete: false })
  })

  it('budgets: a Manager is read-only when the server says no', async () => {
    h.rpc.mockResolvedValue({ data: false, error: null })
    const { result } = renderHook(() => useWriteAccess('budgets'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ create: false, edit: false })
  })

  it('a failed check never hides a control: it stays enabled and is marked unknown', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'network' } })
    const { result } = renderHook(() => useWriteAccess('vehicle_fleet'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ create: true, edit: true, known: false })
  })

  it('a thrown request is treated the same way', async () => {
    h.rpc.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useWriteAccess('vehicle_fleet'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.known).toBe(false)
  })

  it('a role policy table needs no server call', async () => {
    const { result } = renderHook(() => useWriteAccess('sites'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(h.rpc).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ create: true, edit: true, delete: false, known: true })
  })

  it('an Admin is allowed everything including delete', async () => {
    h.auth = { profile: { id: 'a1', role: 'Admin' }, isSuperAdmin: true }
    h.rpc.mockResolvedValue({ data: true, error: null })
    const { result } = renderHook(() => useWriteAccess('vehicle_fleet'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ create: true, edit: true, delete: true })
  })
})
