import { describe, it, expect } from 'vitest'
import { mapWithConcurrency, mapSettled, settledValue, chunkArray } from '../lib/concurrency'

const defer = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b }); return { p, resolve, reject } }
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('mapWithConcurrency', () => {
  it('keeps input order even when later items finish first', async () => {
    const delays = [30, 5, 20, 1, 10]
    const out = await mapWithConcurrency(delays, 3, (ms, i) => new Promise((r) => setTimeout(() => r(`r${i}`), ms)))
    expect(out).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
  })

  it('never has more than `limit` calls in flight', async () => {
    let live = 0; let peak = 0
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      live += 1; peak = Math.max(peak, live)
      await tick()
      live -= 1
    })
    expect(peak).toBe(4)
  })

  it('20 sequential calls become 5 waves at width 4', async () => {
    let waves = 0; let live = 0
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      if (live === 0) waves += 1
      live += 1
      await tick()
      live -= 1
    })
    expect(waves).toBeLessThanOrEqual(5)
  })

  it('rejects with the earliest failing index and starts nothing after a failure', async () => {
    const gates = [defer(), defer(), defer()]
    const started = []
    const run = mapWithConcurrency([0, 1, 2, 3, 4], 3, (i) => { started.push(i); return i < 3 ? gates[i].p : Promise.resolve(i) })
    gates[2].reject(new Error('two'))
    await tick()
    gates[1].reject(new Error('one'))
    gates[0].resolve('ok')
    await expect(run).rejects.toThrow('one')
    expect(started).toEqual([0, 1, 2])
  })

  it('handles empty input and a bad limit', async () => {
    expect(await mapWithConcurrency([], 4, () => 1)).toEqual([])
    expect(await mapWithConcurrency([1, 2], 0, (x) => x * 2)).toEqual([2, 4])
  })
})

describe('mapSettled', () => {
  it('runs everything, keeps order, and replays errors in order', async () => {
    const out = await mapSettled([1, 2, 3], 2, (x) => (x === 2 ? Promise.reject(new Error('bad')) : x))
    expect(out[0]).toEqual({ ok: true, value: 1 })
    expect(out[1].ok).toBe(false)
    expect(out[2]).toEqual({ ok: true, value: 3 })
    expect(() => settledValue(out[1])).toThrow('bad')
    expect(settledValue(out[2])).toBe(3)
  })
})

describe('chunkArray', () => {
  it('splits into ordered slices', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkArray(null, 2)).toEqual([])
  })
})
