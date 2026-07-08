import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Supabase mock that lets a test decide, per insert attempt, whether the request
// "fails". A returned string becomes a resolved { error:{ message } } (the shape
// PostgREST uses for a dropped/timed-out request); null means success. Every
// successful insert's row-count is accumulated so a test can assert that ALL
// input rows ultimately landed, however the chunk was split.
const h = vi.hoisted(() => {
  const state = { failFn: null, attempts: [], savedRows: 0 }
  function from() {
    return {
      insert(payload) {
        const n = Array.isArray(payload) ? payload.length : 1
        const attemptNo = state.attempts.push(n)
        const errMsg = state.failFn ? state.failFn(payload, attemptNo) : null
        if (!errMsg) state.savedRows += n
        return { then: (f, r) => Promise.resolve({ error: errMsg ? { message: errMsg, code: state.failCode ?? null } : null }).then(f, r) }
      },
    }
  }
  return { state, supabase: { from } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { stageRows } = await import('../lib/api/imports')

const makeRows = (count) =>
  Array.from({ length: count }, (_, i) => ({ sourceRowNo: i + 1, raw: { i }, mapped: {}, transformed: {}, custom: {} }))

beforeEach(() => {
  vi.useFakeTimers()
  h.state.failFn = null
  h.state.failCode = null
  h.state.attempts = []
  h.state.savedRows = 0
})
afterEach(() => { vi.useRealTimers() })

describe('stageRows — resilient chunk insert', () => {
  it('retries a transient failure and still stages every row', async () => {
    // First two attempts drop; the third succeeds.
    let fails = 0
    h.state.failFn = () => (fails++ < 2 ? 'Failed to fetch' : null)

    const p = stageRows('b1', makeRows(10))
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeUndefined()

    expect(h.state.attempts.length).toBe(3)   // 2 failed + 1 success
    expect(h.state.savedRows).toBe(10)         // no rows lost
  })

  it('bisects a persistently-dropping request down to rows that succeed', async () => {
    // Any multi-row request keeps dropping; single-row requests go through — this
    // is exactly the "large body dropped, small body fine" case the fix targets.
    h.state.failFn = (payload) => (payload.length > 1 ? 'Failed to fetch' : null)

    const p = stageRows('b1', makeRows(4))
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeUndefined()

    expect(h.state.savedRows).toBe(4)          // every row eventually saved
    // Ended by inserting one row at a time (the only size that succeeds).
    const singleInserts = h.state.attempts.filter((n) => n === 1).length
    expect(singleInserts).toBe(4)
  })

  it('surfaces a deterministic DB error immediately without retrying or bisecting', async () => {
    h.state.failFn = () => 'new row violates row-level security policy for table "import_rows"'
    h.state.failCode = '42501'

    await expect(stageRows('b1', makeRows(8))).rejects.toThrow(/row-level security/i)
    expect(h.state.attempts.length).toBe(1)    // no retry, no bisection
  })

  it('does nothing for an empty row set', async () => {
    await expect(stageRows('b1', [])).resolves.toBeUndefined()
    expect(h.state.attempts.length).toBe(0)
  })
})
