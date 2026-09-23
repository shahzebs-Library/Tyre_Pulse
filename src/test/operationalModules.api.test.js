import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ rows: {}, errors: {}, queries: [] }))
vi.mock('../lib/supabase', () => ({ supabase: { from(table) {
  const query = { table, filters: [], start: 0, end: Infinity }
  state.queries.push(query)
  const b = {
    select() { return b }, order() { return b },
    eq(...args) { query.filters.push(['eq', ...args]); return b },
    ilike(...args) { query.filters.push(['ilike', ...args]); return b },
    or(...args) { query.filters.push(['or', ...args]); return b },
    in(...args) { query.filters.push(['in', ...args]); return b },
    range(start, end) { query.start = start; query.end = end; return b },
    limit(n) { query.end = n - 1; return b },
    then(resolve, reject) { return Promise.resolve({ data: (state.rows[table] || []).slice(query.start, query.end + 1), error: state.errors[table] || null }).then(resolve, reject) },
  }
  return b
} } }))
import { getPassportBundle, getPassportRecords } from '../lib/api/tyrePassport'
import { findSerialRecords } from '../lib/api/serialTracker'
import { listShifts } from '../lib/api/shifts'
import { listPmPrograms, listPmServiceRecords, loadPmDashboard } from '../lib/api/pmPrograms'
beforeEach(() => { state.rows = {}; state.errors = {}; state.queries = [] })
describe('operational history completeness', () => {
  it('returns passport records as an array across database pages', async () => {
    state.rows.tyre_records = Array.from({ length: 1105 }, (_, id) => ({ id }))
    expect(await getPassportRecords('ABC', { country: 'KSA' })).toEqual(state.rows.tyre_records)
    expect(state.queries[0].filters).toContainEqual(['or', 'country.eq.KSA,country.is.null'])
  })
  it('keeps the tyre visible but marks failed auxiliary sources incomplete', async () => {
    state.rows.tyre_records = [{ id: 1, serial_no: 'ABC' }]
    state.errors.warranty_claims = { message: 'permission denied', code: '42501' }
    const bundle = await getPassportBundle('ABC')
    expect(bundle.records).toHaveLength(1)
    expect(bundle.unavailableSources).toEqual(['Warranty claims'])
    expect(bundle.warrantyClaims).toEqual([])
  })
  it('propagates authoritative history failure', async () => {
    state.errors.tyre_records = { message: 'request failed' }
    await expect(getPassportBundle('ABC')).rejects.toThrow()
  })
  it('does not treat wildcard characters in serials as a broad search', async () => {
    await findSerialRecords('ABC_1%', { country: 'UAE' })
    expect(state.queries[0].filters).toContainEqual(['ilike', 'serial_no', 'ABC\\_1\\%'])
    expect(state.queries[0].filters).toContainEqual(['or', 'country.eq.UAE,country.is.null'])
  })
  it.each([['shifts', listShifts], ['pm_programs', listPmPrograms], ['pm_service_records', listPmServiceRecords]])('pages %s beyond the first 1000 rows', async (table, read) => {
    state.rows[table] = Array.from({ length: 1020 }, (_, id) => ({ id }))
    expect(await read({ country: 'KSA' })).toHaveLength(1020)
  })
  it('does not turn a failed meter source into a compliant PM dashboard', async () => {
    state.rows.pm_programs = [{ asset_no: 'TM1' }]
    state.errors.vehicle_fleet = { message: 'request failed' }
    await expect(loadPmDashboard({ country: 'KSA' })).rejects.toThrow()
  })
  it('keeps unknown kilometre readings unknown', async () => {
    state.rows.pm_programs = [{ asset_no: 'TM1' }]
    state.rows.vehicle_fleet = [{ asset_no: 'TM1', current_km: null }]
    expect((await loadPmDashboard({ country: 'KSA' })).kmByAsset).toEqual({})
  })
})
