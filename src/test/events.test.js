import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The bus lazily imports the webhook dispatcher (which imports supabase);
// stub both so the built-in wildcard consumers stay inert in tests.
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getUser: vi.fn(async () => ({ data: { user: null } })) }, from: vi.fn(), rpc: vi.fn() },
}))
vi.mock('../lib/webhooks', () => ({ dispatchEvent: vi.fn(async () => []) }))

import { EVENT_TYPES, publish, subscribe } from '../lib/events'

/** Microtask dispatch means a macrotask tick guarantees delivery. */
const flush = () => new Promise((r) => setTimeout(r, 0))

let unsubs = []
const on = (type, fn) => { const u = subscribe(type, fn); unsubs.push(u); return u }

beforeEach(() => { unsubs = [] })
afterEach(() => { unsubs.forEach((u) => u()); vi.restoreAllMocks() })

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────
describe('EVENT_TYPES registry', () => {
  it('documents every event with a label and payload fields', () => {
    const expected = [
      'inspection.completed', 'workorder.created', 'workorder.status_changed',
      'workorder.deleted', 'gatepass.issued', 'gatepass.denied',
      'accident.reported', 'import.committed', 'import.reversed',
      'tyre.created', 'tyre.updated',
    ]
    for (const type of expected) {
      expect(EVENT_TYPES[type], type).toBeTruthy()
      expect(EVENT_TYPES[type].label).toBeTruthy()
      expect(EVENT_TYPES[type].fields).toBeTruthy()
    }
  })

  it('is frozen (no runtime mutation of the contract)', () => {
    expect(Object.isFrozen(EVENT_TYPES)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Payload stamping
// ─────────────────────────────────────────────────────────────────────────────
describe('publish stamping', () => {
  it('stamps id, type, payload and ISO occurred_at', async () => {
    const seen = []
    on('workorder.created', (e) => seen.push(e))
    const returned = publish('workorder.created', { work_order_no: 'WO-1' })
    await flush()

    expect(seen).toHaveLength(1)
    const evt = seen[0]
    expect(evt).toBe(returned) // same stamped envelope
    expect(evt.id).toBeTruthy()
    expect(evt.type).toBe('workorder.created')
    expect(evt.payload).toEqual({ work_order_no: 'WO-1' })
    expect(new Date(evt.occurred_at).toISOString()).toBe(evt.occurred_at)
    expect(evt.actor).toBeUndefined()
  })

  it('attaches actor only when provided', async () => {
    const seen = []
    on('gatepass.issued', (e) => seen.push(e))
    publish('gatepass.issued', { asset_no: 'A1' }, { actor: { id: 'u1', role: 'Admin' } })
    await flush()
    expect(seen[0].actor).toEqual({ id: 'u1', role: 'Admin' })
  })

  it('gives every event a unique id', () => {
    const a = publish('tyre.created', {})
    const b = publish('tyre.created', {})
    expect(a.id).not.toBe(b.id)
  })

  it('wraps non-object payloads instead of throwing', async () => {
    const seen = []
    on('tyre.updated', (e) => seen.push(e))
    expect(() => publish('tyre.updated', 'S123')).not.toThrow()
    await flush()
    expect(seen[0].payload).toEqual({ value: 'S123' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Unknown types
// ─────────────────────────────────────────────────────────────────────────────
describe('unknown event types', () => {
  it('publish warns and no-ops (returns null, nothing dispatched)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wildcard = vi.fn()
    on('*', wildcard)

    expect(publish('workorder.exploded', { boom: true })).toBeNull()
    await flush()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('workorder.exploded'))
    expect(wildcard).not.toHaveBeenCalled()
  })

  it('never throws even for absurd input', () => {
    expect(() => publish(undefined)).not.toThrow()
    expect(() => publish(null, null)).not.toThrow()
    expect(() => publish(42, [])).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Subscription mechanics
// ─────────────────────────────────────────────────────────────────────────────
describe('subscribe / unsubscribe', () => {
  it('dispatch is always async — publisher returns before consumers run', async () => {
    const handler = vi.fn()
    on('import.committed', handler)
    publish('import.committed', { batch_id: 'b1' })
    expect(handler).not.toHaveBeenCalled() // not synchronous
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops delivery', async () => {
    const handler = vi.fn()
    const unsub = subscribe('workorder.deleted', handler)
    publish('workorder.deleted', { id: 1 })
    await flush()
    unsub()
    publish('workorder.deleted', { id: 2 })
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("wildcard '*' receives every registered event type", async () => {
    const all = []
    on('*', (e) => all.push(e.type))
    publish('workorder.created', {})
    publish('gatepass.denied', {})
    publish('import.reversed', {})
    await flush()
    expect(all).toEqual(['workorder.created', 'gatepass.denied', 'import.reversed'])
  })

  it('exact subscribers only get their own type', async () => {
    const handler = vi.fn()
    on('accident.reported', handler)
    publish('workorder.created', {})
    await flush()
    expect(handler).not.toHaveBeenCalled()
  })

  it('subscribe with a non-function handler returns a safe no-op unsubscriber', () => {
    expect(() => subscribe('workorder.created', null)()).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Consumer isolation
// ─────────────────────────────────────────────────────────────────────────────
describe('subscriber isolation', () => {
  it('one throwing consumer cannot break the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = vi.fn(() => { throw new Error('consumer exploded') })
    const good = vi.fn()
    on('workorder.status_changed', bad)
    on('workorder.status_changed', good)
    on('*', good)

    expect(() => publish('workorder.status_changed', { to_status: 'Completed' })).not.toThrow()
    await flush()

    expect(bad).toHaveBeenCalledTimes(1)
    expect(good).toHaveBeenCalledTimes(2) // exact + wildcard both still ran
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('subscriber failed'), 'consumer exploded',
    )
  })
})
