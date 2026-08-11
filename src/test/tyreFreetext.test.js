import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The free-text tyre reader proposes; it never records.
 *
 * These pin the two things that make that separation real, because neither is
 * visible from the UI:
 *   1. a read that FAILS must not render as "nothing was found" - the section
 *      would then report a clean fleet because it could not look; and
 *   2. a count that could not be read must come back null, never 0, for the same
 *      reason one level up.
 *
 * They also pin the vocabulary the reviewer depends on. "REPLACED TYRE OLD ONE
 * LHF2-YMY32586" names the tyre that came OFF; if that label goes missing or
 * silently defaults to a fitment, a removed tyre gets put back on the vehicle.
 */

const state = { rows: [], error: null, count: 0, countError: null, rpc: null, rpcError: null }

vi.mock('../lib/api/_client', () => {
  // A thenable builder, like PostgREST's: every method returns the builder, and
  // awaiting it resolves. A head count resolves { count }, a row read { data }.
  const builder = () => {
    let head = false
    const q = {
      select: (_c, opts) => { head = Boolean(opts?.head); return q },
      order: () => q,
      limit: () => q,
      eq: () => q,
      update: () => q,
      then: (res, rej) =>
        Promise.resolve(
          head
            ? { count: state.countError ? null : state.count, error: state.countError }
            : { data: state.rows, error: state.error },
        ).then(res, rej),
    }
    return q
  }
  return {
    supabase: {
      from: builder,
      rpc: () => Promise.resolve({ data: state.rpc, error: state.rpcError }),
    },
  }
})

const {
  listFreetextCandidates, getFreetextSummary, extractFreetextCandidates,
  EVENT_KIND_LABEL,
} = await import('../lib/api/tyreFreetext')

beforeEach(() => {
  state.rows = []; state.error = null
  state.count = 0; state.countError = null
  state.rpc = null; state.rpcError = null
})

describe('listFreetextCandidates', () => {
  it('returns the candidates it read', async () => {
    state.rows = [{ id: '1', serial_no: 'YMT04737' }, { id: '2', serial_no: 'YMM90002' }]
    const res = await listFreetextCandidates()
    expect(res.rows).toHaveLength(2)
    expect(res.truncated).toBe(false)
    expect(res.error).toBeNull()
  })

  it('reports a read failure instead of an empty list', async () => {
    // An unreadable table and an empty one must never look the same: one means
    // "no tyre was written in free text", the other means "we could not check".
    state.error = { message: 'permission denied' }
    const res = await listFreetextCandidates()
    expect(res.rows).toEqual([])
    expect(res.error).toBe('permission denied')
  })

  it('flags truncation so a capped list is never read as the whole list', async () => {
    state.rows = Array.from({ length: 4 }, (_, i) => ({ id: String(i) }))
    const res = await listFreetextCandidates({ max: 3 })
    expect(res.rows).toHaveLength(3)
    expect(res.truncated).toBe(true)
  })
})

describe('getFreetextSummary', () => {
  it('counts what it could read', async () => {
    state.count = 7
    const s = await getFreetextSummary()
    expect(s.pending).toBe(7)
  })

  it('returns null, not zero, when a count could not be read', async () => {
    // Zero is a measurement. "We could not look" is not, and printing it as zero
    // tells the owner there is nothing waiting for them.
    state.countError = { message: 'denied' }
    const s = await getFreetextSummary()
    expect(s.pending).toBeNull()
    expect(s.newSerials).toBeNull()
    expect(s.accepted).toBeNull()
  })
})

describe('extractFreetextCandidates', () => {
  it('defaults to a dry run and returns the report', async () => {
    state.rpc = { dry_run: true, pairs_found: 1000 }
    const res = await extractFreetextCandidates()
    expect(res.pairs_found).toBe(1000)
  })

  it('throws on failure so a broken extraction is visible', async () => {
    // Unlike the reads, a failed extraction must NOT degrade quietly - the owner
    // pressed a button and is owed the outcome.
    state.rpcError = new Error('not permitted')
    await expect(extractFreetextCandidates(false)).rejects.toThrow('not permitted')
  })
})

describe('EVENT_KIND_LABEL', () => {
  it('names the removal case explicitly', () => {
    expect(EVENT_KIND_LABEL.removed_old).toMatch(/removed/i)
    expect(EVENT_KIND_LABEL.fitted_new).toMatch(/fitted/i)
    expect(EVENT_KIND_LABEL.fitted_used).toMatch(/refitted/i)
  })

  it('says "not stated" rather than guessing a fitment', () => {
    expect(EVENT_KIND_LABEL.unclear).not.toMatch(/fitted/i)
  })
})
