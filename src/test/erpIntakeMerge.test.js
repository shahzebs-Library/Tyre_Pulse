import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Merge semantics of the ERP tyre intake.
 *
 * A tyre is NOT one row. The same serial is fitted, removed and refitted, so it
 * legitimately appears many times across assets and positions over its life -
 * the reconciliation RPCs treat "serial on multiple assets" as normal tyre
 * movement, not duplication. The loader therefore has to merge on the full
 * fitment key (serial + asset + position + fix date), not on the serial alone;
 * deduping on serial discarded every lifecycle row after the first for any
 * serial already stored, so incremental re-imports silently lost history.
 *
 * Chainable/thenable Supabase mock mirrors src/test/engineeringKpi.api.test.js.
 */
const h = vi.hoisted(() => {
  const state = { existing: [], inserted: [], insertError: null }
  function from(table) {
    const b = {
      _table: table,
      select() { return b },
      eq() { return b },
      range(f) {
        // Serve the existing-rows page once, then signal end-of-data.
        const page = f === 0 ? state.existing : []
        return Promise.resolve({ data: page, error: null })
      },
      insert(rows) {
        if (!state.insertError) state.inserted.push(...rows)
        return Promise.resolve({ error: state.insertError, data: null })
      },
      then(onF, onR) { return Promise.resolve({ data: [], error: null }).then(onF, onR) },
    }
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const intake = await import('../lib/api/erpIntake')

beforeEach(() => {
  h.state.existing = []
  h.state.inserted = []
  h.state.insertError = null
})

const row = (over = {}) => ({
  serial_no: 'K507B403553',
  asset_no: 'TM556',
  position: 'RHF1',
  issue_date: '2026-07-02',
  ...over,
})

describe('insertTyreRecords - merge on the full fitment key', () => {
  it('keeps a later fitment of a serial already stored (a tyre that moved)', async () => {
    // Same serial already in the table on a different asset/position/date.
    h.state.existing = [row()]
    const res = await intake.insertTyreRecords([
      row({ asset_no: 'TM901', position: 'LHR2', issue_date: '2026-09-15' }),
    ], { country: 'KSA' })

    expect(res.inserted).toBe(1)
    expect(res.skipped).toBe(0)
    expect(h.state.inserted[0].asset_no).toBe('TM901')
  })

  it('still skips a genuine re-upload of the exact same fitment event', async () => {
    h.state.existing = [row()]
    const res = await intake.insertTyreRecords([row()], { country: 'KSA' })

    expect(res.inserted).toBe(0)
    expect(res.skipped).toBe(1)
    expect(h.state.inserted).toHaveLength(0)
  })

  it('matches the stored key case/whitespace-insensitively and ignores a date time part', async () => {
    h.state.existing = [row({ issue_date: '2026-07-02T00:00:00+00:00' })]
    const res = await intake.insertTyreRecords([
      row({ serial_no: ' k507b403553 ', asset_no: ' tm556 ', position: ' rhf1 ' }),
    ], { country: 'KSA' })

    expect(res.inserted).toBe(0)
    expect(res.skipped).toBe(1)
  })

  it('de-duplicates repeated rows inside a single file', async () => {
    const res = await intake.insertTyreRecords([row(), row(), row()], { country: 'KSA' })

    expect(res.inserted).toBe(1)
    expect(res.skipped).toBe(2)
  })

  it('imports a row that carries an asset but no serial instead of dropping it', async () => {
    // mapMonthlyTyres deliberately emits these (it only skips when BOTH are
    // absent); the old serial-only filter discarded them silently.
    const res = await intake.insertTyreRecords([
      row({ serial_no: '' }),
    ], { country: 'KSA' })

    expect(res.inserted).toBe(1)
    expect(h.state.inserted[0].asset_no).toBe('TM556')
  })

  it('still rejects a row with neither serial nor asset', async () => {
    const res = await intake.insertTyreRecords([
      row({ serial_no: '', asset_no: '' }),
    ], { country: 'KSA' })

    expect(res.inserted).toBe(0)
    expect(res.skipped).toBe(1)
  })
})
