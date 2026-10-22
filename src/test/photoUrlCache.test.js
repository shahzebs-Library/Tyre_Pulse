import { describe, it, expect, vi } from 'vitest'

const sb = vi.hoisted(() => ({ createSignedUrl: vi.fn(), createSignedUrls: vi.fn(), from: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { storage: { from: (b) => { sb.from(b); return { createSignedUrl: sb.createSignedUrl, createSignedUrls: sb.createSignedUrls } } } } }))

import { createUrlResolver } from '../lib/photoUrlCache'
import { resolveStorageUrlMap } from '../lib/storageRefs'

const deferred = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }

describe('photo URL resolver', () => {
  it('de-duplicates identical refs in flight and after completion', async () => {
    const resolve = vi.fn(async ref => 'https://u/' + ref)
    const r = createUrlResolver({ resolve })
    const [a, b] = await Promise.all([r.get('x'), r.get('x')])
    expect(a).toBe('https://u/x'); expect(b).toBe(a)
    expect(await r.get('x')).toBe(a)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(r.stats.hits).toBe(1)
  })
  it('never runs more than the concurrency limit at once, and serves in request order', async () => {
    const gates = Array.from({ length: 6 }, deferred)
    let running = 0, peak = 0
    const order = []
    const resolve = vi.fn(async ref => {
      order.push(ref); running++; peak = Math.max(peak, running)
      await gates[Number(ref)].p
      running--; return 'u' + ref
    })
    const r = createUrlResolver({ resolve, concurrency: 2 })
    const all = [0, 1, 2, 3, 4, 5].map(i => r.get(String(i)))
    await Promise.resolve(); await Promise.resolve()
    expect(r.pending()).toBe(6)
    gates.forEach(g => g.res())
    await Promise.all(all)
    expect(peak).toBe(2)
    expect(order).toEqual(['0', '1', '2', '3', '4', '5'])
  })
  it('expires cached URLs before the signing lifetime and retries failures soon', async () => {
    let t = 0
    const resolve = vi.fn(async () => (resolve.mock.calls.length === 1 ? null : 'ok'))
    const r = createUrlResolver({ resolve, now: () => t, ttlMs: 1000, failureTtlMs: 100 })
    expect(await r.get('a')).toBeNull()
    expect(await r.get('a')).toBeNull(); expect(resolve).toHaveBeenCalledTimes(1) // failure cached briefly
    t = 150
    expect(await r.get('a')).toBe('ok'); expect(resolve).toHaveBeenCalledTimes(2)
    t = 1200
    await r.get('a'); expect(resolve).toHaveBeenCalledTimes(3) // success expired
  })
  it('turns a thrown lookup into null and keeps the queue moving', async () => {
    const resolve = vi.fn(async ref => { if (ref === 'bad') throw new Error('x'); return 'ok' })
    const r = createUrlResolver({ resolve, concurrency: 1 })
    expect(await Promise.all([r.get('bad'), r.get('good')])).toEqual([null, 'ok'])
  })
  it('ignores empty or non-string refs without a lookup', async () => {
    const resolve = vi.fn()
    const r = createUrlResolver({ resolve })
    expect(await Promise.all([r.get(''), r.get(null), r.get(5)])).toEqual([null, null, null])
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('resolveStorageUrlMap (batch signing)', () => {
  it('signs a bucket in ONE request and passes direct URLs through', async () => {
    sb.createSignedUrls.mockReset(); sb.createSignedUrl.mockReset()
    sb.createSignedUrls.mockResolvedValue({ data: [
      { path: 'a/1.jpg', signedUrl: 'https://s/1', error: null },
      { path: 'a/2.jpg', signedUrl: null, error: 'not found' },
    ], error: null })
    const map = await resolveStorageUrlMap(['tp-storage://tyre-photos/a/1.jpg', 'tp-storage://tyre-photos/a/2.jpg', 'tp-storage://tyre-photos/a/1.jpg', 'https://cdn/x.jpg', '', null])
    expect(sb.createSignedUrls).toHaveBeenCalledTimes(1)
    expect(sb.createSignedUrls.mock.calls[0][0]).toEqual(['a/1.jpg', 'a/2.jpg'])
    expect(sb.createSignedUrl).not.toHaveBeenCalled()
    expect(map['tp-storage://tyre-photos/a/1.jpg']).toBe('https://s/1')
    expect(map['tp-storage://tyre-photos/a/2.jpg']).toBeNull()
    expect(map['https://cdn/x.jpg']).toBe('https://cdn/x.jpg')
  })
  it('splits more than 100 paths and survives a failed batch', async () => {
    sb.createSignedUrls.mockReset()
    sb.createSignedUrls.mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce({ data: [{ path: 'p/100', signedUrl: 'ok' }], error: null })
    const refs = Array.from({ length: 101 }, (_, i) => `tp-storage://b/p/${i}`)
    const map = await resolveStorageUrlMap(refs)
    expect(sb.createSignedUrls).toHaveBeenCalledTimes(2)
    expect(sb.createSignedUrls.mock.calls[0][0]).toHaveLength(100)
    expect(map['tp-storage://b/p/0']).toBeNull()
    expect(map['tp-storage://b/p/100']).toBe('ok')
  })
})
