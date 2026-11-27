import { describe, it, expect, vi, beforeEach } from 'vitest'

const createSignedUrls = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { storage: { from: () => ({ createSignedUrls }) } } }))
const mod = await import('../lib/useVehicleImageUrl')

beforeEach(() => { createSignedUrls.mockReset(); mod._clearVehicleImageCache() })

describe('signedVehicleImageUrl', () => {
  it('signs paths requested together in one call and reuses them', async () => {
    createSignedUrls.mockResolvedValue({ data: [{ path: 'a.jpg', signedUrl: 'u-a' }, { path: 'b.jpg', signedUrl: 'u-b' }], error: null })
    const [a, b] = await Promise.all([mod.signedVehicleImageUrl('a.jpg'), mod.signedVehicleImageUrl('b.jpg')])
    expect([a, b]).toEqual(['u-a', 'u-b'])
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(await mod.signedVehicleImageUrl('a.jpg')).toBe('u-a')
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
  })
  it('remembers a failure as null for 30 s only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    createSignedUrls.mockResolvedValueOnce({ data: null, error: { message: 'down' } })
    expect(await mod.signedVehicleImageUrl('c.jpg')).toBeNull()
    expect(await mod.signedVehicleImageUrl('c.jpg')).toBeNull()
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 31000)
    createSignedUrls.mockResolvedValueOnce({ data: [{ path: 'c.jpg', signedUrl: 'u-c' }], error: null })
    expect(await mod.signedVehicleImageUrl('c.jpg')).toBe('u-c')
    vi.useRealTimers()
  })
  it('readImagePath ignores blanks', () => {
    expect(mod.readImagePath({ image_path: '  ' })).toBeNull()
    expect(mod.readImagePath(null)).toBeNull()
  })
})
