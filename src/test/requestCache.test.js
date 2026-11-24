import { describe, it, expect, vi } from 'vitest'
import { createRequestCache } from '../lib/requestCache'

describe('createRequestCache', () => {
  it('shares one request between concurrent callers', async () => {
    const cache = createRequestCache({ ttlMs: 1000 })
    const loader = vi.fn(() => new Promise((r) => setTimeout(() => r('v'), 5)))
    const [a, b] = await Promise.all([cache.get('k', loader), cache.get('k', loader)])
    expect(a).toBe('v'); expect(b).toBe('v')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('reuses a settled value within the TTL and asks again after it', async () => {
    let t = 0
    const cache = createRequestCache({ ttlMs: 100, now: () => t })
    const loader = vi.fn(async () => t)
    expect(await cache.get('k', loader)).toBe(0)
    t = 50
    expect(await cache.get('k', loader)).toBe(0)
    t = 150
    expect(await cache.get('k', loader)).toBe(150)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('never caches a failure or a value rejected by cacheIf', async () => {
    const cache = createRequestCache()
    const bad = vi.fn(async () => { throw new Error('x') })
    await expect(cache.get('k', bad)).rejects.toThrow('x')
    await expect(cache.get('k', bad)).rejects.toThrow('x')
    expect(bad).toHaveBeenCalledTimes(2)
    const errResult = vi.fn(async () => ({ error: { code: '42501' } }))
    await cache.get('e', errResult, { cacheIf: (r) => !r.error })
    await cache.get('e', errResult, { cacheIf: (r) => !r.error })
    expect(errResult).toHaveBeenCalledTimes(2)
  })

  it('does not keep an answer that was in flight when the cache was cleared', async () => {
    const cache = createRequestCache()
    let release
    const first = cache.get('k', () => new Promise((r) => { release = r }))
    await new Promise((r) => setTimeout(r, 0))
    cache.clear()
    release('old')
    expect(await first).toBe('old')
    const loader = vi.fn(async () => 'new')
    expect(await cache.get('k', loader)).toBe('new')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('force bypasses and invalidate(prefix) drops matching keys only', async () => {
    const cache = createRequestCache()
    const l = vi.fn(async () => 1)
    await cache.get('a|1', l); await cache.get('b|1', l)
    await cache.get('a|1', l, { force: true })
    expect(l).toHaveBeenCalledTimes(3)
    cache.invalidate('a|')
    await cache.get('a|1', l); await cache.get('b|1', l)
    expect(l).toHaveBeenCalledTimes(4)
  })
})
