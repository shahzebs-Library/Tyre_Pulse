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
 * NOTHING GENUINELY NEW IS DROPPED: a new fitment is inserted, an already-stored
 * fitment that carries new details is UPDATED, and only an exact duplicate is left
 * alone. These tests pin all three outcomes.
 *
 * Chainable/thenable Supabase mock mirrors src/test/engineeringKpi.api.test.js.
 */
const h = vi.hoisted(() => {
  const state = { existing: [], inserted: [], updated: [], insertError: null }
  function from(table) {
    let usedIn = false
    const b = {
      _table: table,
      select() { return b },
      eq() { return b },
      in() { usedIn = true; return b },   // overlap rows fetched by .in(key, values)
      order() { return b },  // existing-key reads order by id before paging (V415)
      range(f) {
        // Serve the existing-rows page once, then signal end-of-data.
        const page = f === 0 ? state.existing : []
        return Promise.resolve({ data: page, error: null })
      },
      insert(rows) {
        if (!state.insertError) state.inserted.push(...rows)
        return Promise.resolve({ error: state.insertError, data: null })
      },
      update(patch) {
        // update(patch).eq('id', id) - record the applied patch.
        return { eq(_c, id) { state.updated.push({ id, patch }); return Promise.resolve({ error: null, data: null }) } }
      },
      then(onF, onR) {
        // A bare await (no .range()) resolves the .in() overlap fetch to the
        // existing rows; other awaited chains resolve empty.
        return Promise.resolve({ data: usedIn ? state.existing : [], error: null }).then(onF, onR)
      },
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
  h.state.updated = []
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

  it('leaves an exact re-upload of the same fitment event unchanged (no insert, no update)', async () => {
    h.state.existing = [row()]
    const res = await intake.insertTyreRecords([row()], { country: 'KSA' })

    expect(res.inserted).toBe(0)
    expect(res.updated).toBe(0)
    expect(res.skipped).toBe(1)
    expect(h.state.inserted).toHaveLength(0)
    expect(h.state.updated).toHaveLength(0)
  })

  it('REFRESHES a stored fitment when the re-import adds a new detail (removal date/km)', async () => {
    // The same fitment key, but the later export now carries a removal date/km
    // and a Removed status - this is new data and must land, not be dropped.
    h.state.existing = [{ id: 'tr-1', ...row(), removal_date: null, km_at_removal: null, status: 'Active' }]
    const res = await intake.insertTyreRecords([
      row({ removal_date: '2026-09-01', km_at_removal: 84000, status: 'Removed' }),
    ], { country: 'KSA' })

    expect(res.inserted).toBe(0)
    expect(res.updated).toBe(1)
    expect(res.skipped).toBe(0)
    expect(h.state.updated).toHaveLength(1)
    expect(h.state.updated[0].id).toBe('tr-1')
    // Only the changed/newly-provided fields are patched; blanks never overwrite.
    expect(h.state.updated[0].patch).toMatchObject({ removal_date: '2026-09-01', status: 'Removed' })
    expect(h.state.updated[0].patch.km_at_removal).toBe(84000)
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
