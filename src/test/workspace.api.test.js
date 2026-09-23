import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ from: vi.fn(), country: vi.fn(), select: vi.fn(), abort: vi.fn() }))
vi.mock('../lib/api/_client', () => ({ supabase: { from: h.from }, applyCountry: h.country }))
import { loadWorkspaceCount } from '../lib/api/workspace'
beforeEach(() => {
  h.from.mockReset().mockReturnValue({ select: h.select })
  h.select.mockReset().mockReturnValue({ abortSignal: h.abort })
  h.country.mockReset().mockImplementation(query => query)
  h.abort.mockReset().mockResolvedValue({ count: 4, error: null })
})
it('requests only an exact count without downloading rows and passes scope/cancellation', async () => {
  const signal = new AbortController().signal
  expect(await loadWorkspaceCount('vehicle_washing', { country: 'KSA', profile: { id: 'u1' }, signal })).toBe(4)
  expect(h.from).toHaveBeenCalledWith('wash_records')
  expect(h.select).toHaveBeenCalledWith('id', { head: true, count: 'exact' })
  expect(h.country).toHaveBeenCalledWith(expect.anything(), 'KSA')
  expect(h.abort).toHaveBeenCalledWith(signal)
})
it('does not treat unavailable counts as zero or query unsupported modules', async () => {
  await expect(loadWorkspaceCount('budgets', { profile: { id: 'u1' } })).rejects.toThrow('unavailable')
  expect(h.from).not.toHaveBeenCalled()
  h.abort.mockResolvedValue({ count: null, error: { message: 'Access denied' } })
  await expect(loadWorkspaceCount('fleet_master', { profile: { id: 'u1' } })).rejects.toEqual({ message: 'Access denied' })
})
