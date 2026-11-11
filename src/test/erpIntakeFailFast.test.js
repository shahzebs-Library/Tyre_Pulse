import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * F-B-02: the merge loaders read the set of keys already stored to tell a
 * brand-new row from a re-import. If that read quietly returned an empty set on
 * a transient failure, EVERY row would look new and be re-inserted - a 23505 on
 * a global unique (work_orders.work_order_no, vehicle_fleet (org,country,asset_no))
 * aborts the whole non-grid batch at zero rows. So a failed existence read must
 * THROW (after a few retries) BEFORE any insert; the only degrade allowed is a
 * genuinely undeployed table (then every row is new, which is correct).
 */
const h = vi.hoisted(() => {
  const state = { readError: null, readData: [], inserted: [], attempts: 0 }
  function from() {
    const b = {
      select() { return b },
      not() { return b },
      eq() { return b },
      in() { return b },
      order() { return b },
      range() {
        state.attempts += 1
        return Promise.resolve({ data: state.readError ? null : state.readData, error: state.readError })
      },
      insert(rows) { state.inserted.push(...rows); return Promise.resolve({ error: null, data: null }) },
      update() { return { eq() { return Promise.resolve({ error: null, data: null }) } } },
      then(onF, onR) { return Promise.resolve({ data: state.readData, error: null }).then(onF, onR) },
    }
    return b
  }
  // Replacement check reports every wheel as empty (no held rows).
  const rpc = async (_n, args) => ({ data: { ok: true, counts: { no_previous: (args?.p_rows || []).length }, review: [] }, error: null })
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const intake = await import('../lib/api/erpIntake')

beforeEach(() => {
  h.state.readError = null
  h.state.readData = []
  h.state.inserted = []
  h.state.attempts = 0
})
afterEach(() => { vi.useRealTimers() })

/** Drive a rejecting promise to completion while the backoff sleeps are on fake timers. */
async function settle(promise) {
  const caught = promise.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))
  await vi.runAllTimersAsync()
  return caught
}

describe('insertWorkOrders - existence read fails fast', () => {
  it('throws and inserts nothing when the read keeps failing', async () => {
    vi.useFakeTimers()
    h.state.readError = { code: '08006', message: 'connection reset' }
    const outcome = await settle(intake.insertWorkOrders([{ work_order_no: 'WO1' }], { country: 'KSA' }))
    expect(outcome.ok).toBe(false)
    expect(outcome.e).toBeInstanceOf(Error)
    expect(h.state.inserted).toHaveLength(0) // never re-inserted on a swallowed empty set
    expect(h.state.attempts).toBe(3)         // retried 3 times before giving up
  })

  it('degrades to all-new (no retry) when the table is genuinely not provisioned', async () => {
    h.state.readError = { code: '42P01', message: 'relation "work_orders" does not exist' }
    const res = await intake.insertWorkOrders([{ work_order_no: 'WO1' }], { country: 'KSA' })
    expect(res.inserted).toBe(1)
    expect(h.state.inserted.map((r) => r.work_order_no)).toEqual(['WO1'])
    expect(h.state.attempts).toBe(1) // a missing relation is never retried
  })
})

describe('insertTyreRecords / insertVehicleFleet - existence read fails fast', () => {
  it('insertTyreRecords throws and inserts nothing', async () => {
    vi.useFakeTimers()
    h.state.readError = { code: '08006', message: 'timeout' }
    const outcome = await settle(intake.insertTyreRecords(
      [{ serial_no: 'S1', asset_no: 'A1', position: 'RHF1', issue_date: '2026-07-02' }],
      { country: 'KSA' },
    ))
    expect(outcome.ok).toBe(false)
    expect(h.state.inserted).toHaveLength(0)
  })

  it('insertVehicleFleet throws and inserts nothing', async () => {
    vi.useFakeTimers()
    h.state.readError = { code: '08006', message: 'timeout' }
    const outcome = await settle(intake.insertVehicleFleet([{ asset_no: 'A1' }], { country: 'KSA' }))
    expect(outcome.ok).toBe(false)
    expect(h.state.inserted).toHaveLength(0)
  })
})

describe('countExistingRows - preview surfaces "could not check"', () => {
  it('propagates the read failure (the page then records dup: null)', async () => {
    vi.useFakeTimers()
    h.state.readError = { code: '08006', message: 'timeout' }
    const outcome = await settle(intake.countExistingRows('work_orders', [{ work_order_no: 'WO1' }], { country: 'KSA' }))
    expect(outcome.ok).toBe(false)
    expect(outcome.e).toBeInstanceOf(Error)
  })

  it('treats a missing table as all-new without an error', async () => {
    h.state.readError = { code: '42P01', message: 'relation does not exist' }
    const res = await intake.countExistingRows('work_orders', [{ work_order_no: 'WO1' }], { country: 'KSA' })
    expect(res).toMatchObject({ total: 1, existing: 0, fresh: 1, keyed: true })
  })
})
