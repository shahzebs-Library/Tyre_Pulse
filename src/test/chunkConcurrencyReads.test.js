import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (fn, args) => rpc(fn, args) } }))

const { fetchDirectoryByIds, getSignerProfiles } = await import('../lib/api/profileDirectory')

const ids = Array.from({ length: 650 }, (_, i) => `u${String(i).padStart(4, '0')}`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const idsOf = (args) => (args && Array.isArray(args.p_ids) ? args.p_ids : [])

beforeEach(() => { rpc.mockReset() })

describe('chunked directory reads run concurrently but keep the old result', () => {
  it('returns rows in chunk order even when later chunks answer first', async () => {
    rpc.mockImplementation(async (_fn, args) => {
      const part = idsOf(args)
      await wait(part[0] === 'u0000' ? 25 : 1) // first chunk is the slowest
      return { data: part.map((id) => ({ id })), error: null }
    })
    const rows = await fetchDirectoryByIds(ids)
    expect(rows.map((r) => r.id)).toEqual(ids)
    expect(rpc).toHaveBeenCalledTimes(4) // 650 ids / 200 per chunk
  })

  it('throws the FIRST failing chunk error, as the sequential loop did', async () => {
    rpc.mockImplementation(async (_fn, args) => {
      const first = idsOf(args)[0]
      if (first === 'u0200') { await wait(20); return { data: null, error: { message: 'chunk 2' } } }
      if (first === 'u0400') return { data: null, error: { message: 'chunk 3' } }
      return { data: idsOf(args).map((id) => ({ id })), error: null }
    })
    await expect(fetchDirectoryByIds(ids)).rejects.toMatchObject({ message: 'chunk 2' })
  })

  it('signer lookup stays best-effort per chunk', async () => {
    rpc.mockImplementation(async (_fn, args) => {
      const part = idsOf(args)
      if (part[0] === 'u0000') throw new Error('down')
      return { data: part.map((id) => ({ id, full_name: id })), error: null }
    })
    const map = await getSignerProfiles(ids)
    expect(map.has('u0000')).toBe(false)
    expect(map.get('u0649').full_name).toBe('u0649')
    expect(map.size).toBe(450)
  })
})
