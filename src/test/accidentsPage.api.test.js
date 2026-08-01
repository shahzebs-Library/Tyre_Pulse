import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: a chainable, thenable query builder that
// records the table queried and the eq/or/range filters + insert/update/delete
// payloads applied, and resolves to a configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], range: null }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      order(col) { (calls.order = calls.order || []).push(col); return b },
      limit() { return b },
      range(from, to) { calls.range = [from, to]; return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      // A test may set `state.result` to a FUNCTION to answer per request - that
      // is what makes multi-page fetching testable rather than assumed.
      then(onF, onR) {
        const r = typeof state.result === 'function' ? state.result(calls) : state.result
        return Promise.resolve(r).then(onF, onR)
      },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

// Direct import (not the barrel) - mirrors how the page consumes the service.
const accidents = await import('../lib/api/accidents')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('accidents owner page - service layer', () => {
  it('lists a page from accidents ordered by incident_date, ranged, with PII columns', () => {
    const b = accidents.listAccidentsForPage({ country: 'KSA', from: 0, to: 999 })
    expect(b._table).toBe('accidents')
    // Strict country eq (no null-inclusive or()) and the exact range window.
    expect(b._calls.eq).toContainEqual(['country', 'KSA'])
    expect(b._calls.or).toHaveLength(0)
    expect(b._calls.range).toEqual([0, 999])
    // PAGE_COLS baked into the select MUST carry claim/insurer/police PII
    // (owner screen); RLS governs access, not the column list.
    expect(b._calls.select).toContain('insurer')
    expect(b._calls.select).toContain('police_report_no')
    expect(b._calls.select).toContain('policy_no')
    expect(b._calls.select).toContain('claim_amount')
    // ...but never leaks organisation_id (RLS-managed).
    expect(b._calls.select).not.toContain('organisation_id')
  })

  it('does NOT filter country for "All" on the page list', () => {
    const b = accidents.listAccidentsForPage({ country: 'All', from: 0, to: 999 })
    expect(b._calls.eq).toHaveLength(0)
    expect(b._calls.range).toEqual([0, 999])
  })

  it('reads the fleet vehicle picker from vehicle_fleet ordered by asset_no', async () => {
    h.state.result = { data: [{ asset_no: 'V-1', vehicle_type: 'Truck' }], error: null }
    const rows = await accidents.listAccidentFleet()
    // vehicle_fleet is the real asset registry (fleet_master is empty)
    expect(h.state.last._table).toBe('vehicle_fleet')
    expect(rows).toEqual([{ asset_no: 'V-1', vehicle_type: 'Truck' }])
  })

  it('createAccidentForPage inserts (single or bulk array) and deleteAccident deletes by id', async () => {
    await accidents.createAccidentForPage([{ asset_no: 'V-1' }, { asset_no: 'V-2' }])
    expect(h.state.last._table).toBe('accidents')
    expect(h.state.last._calls.insert).toEqual([{ asset_no: 'V-1' }, { asset_no: 'V-2' }])

    await accidents.deleteAccident('acc1')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'acc1'])
  })

  it('updateAccidentForPage patches by id without direct closure fields', async () => {
    await accidents.updateAccidentForPage('acc1', {
      status: 'Closed',
      workflow_stage: 'closed',
      closure_status: 'closed',
      notes: 'checked',
    })
    expect(h.state.last._calls.update).toEqual({ notes: 'checked' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'acc1'])
  })

  it('listAllAccidentsForPage pages the full result set (mirrors fetchAllPages)', async () => {
    h.state.result = { data: [{ id: 'acc1', insurer: 'ACME' }], error: null }
    const { data, error } = await accidents.listAllAccidentsForPage({ country: 'KSA' })
    expect(error).toBeNull()
    expect(data).toEqual([{ id: 'acc1', insurer: 'ACME' }])
    expect(h.state.last._table).toBe('accidents')
  })

  it('listAccidentFleet throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(accidents.listAccidentFleet()).rejects.toBeInstanceOf(ServiceError)
    await expect(accidents.listAccidentFleet()).rejects.toMatchObject({ code: '42501' })
  })

  // ── The asset picker must offer the WHOLE fleet ────────────────────────────
  // PostgREST caps a bare select at 1000 rows. The live fleet holds 1,523, so
  // the unpaged version cut the list at asset TM372 and made 523 assets
  // unfindable - including 19 of the 28 vehicles that have actually had an
  // accident. Nothing in the UI indicated a cap; the search just came back empty.
  it('listAccidentFleet pages past the 1000-row cap', async () => {
    const page = (n, size) => Array.from({ length: size }, (_, i) => ({
      asset_no: `A${String(n * 1000 + i).padStart(5, '0')}`,
    }))
    h.state.result = (calls) => {
      const [from] = calls.range || [0]
      // Two full pages then a short one, exactly like 1,523 real rows.
      if (from === 0) return { data: page(0, 1000), error: null }
      if (from === 1000) return { data: page(1, 523), error: null }
      return { data: [], error: null }
    }
    const rows = await accidents.listAccidentFleet()
    expect(rows).toHaveLength(1523)
    // The row that used to fall off the end is present.
    expect(rows[1522].asset_no).toBe('A01522')
  })

  it('listAccidentFleet orders by a UNIQUE key so paging cannot drop rows', async () => {
    // asset_no is unique per COUNTRY, not globally (V348). Ordering on it alone
    // leaves rows that share a value in an arbitrary order between requests, and
    // a page boundary inside such a group silently drops or repeats them.
    const seen = []
    h.state.result = (calls) => { seen.push(calls); return { data: [], error: null } }
    await accidents.listAccidentFleet()
    expect(h.state.last._table).toBe('vehicle_fleet')
    expect(h.state.last._calls.order).toEqual(['asset_no', 'id'])
  })

  it('listAccidentFleet scopes to a country when one is active', async () => {
    // The same asset code in two countries is usually a DIFFERENT machine (V376),
    // so offering both in one form invites attaching the wrong vehicle.
    h.state.result = { data: [], error: null }
    await accidents.listAccidentFleet({ country: 'KSA' })
    expect(h.state.last._calls.or.length + h.state.last._calls.eq.length).toBeGreaterThan(0)
  })

  it('listAccidentFleet applies no country filter on the All scope', async () => {
    h.state.result = { data: [], error: null }
    await accidents.listAccidentFleet({ country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
  })
})
