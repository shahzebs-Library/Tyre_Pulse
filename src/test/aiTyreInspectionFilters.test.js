/**
 * Combined register filters: site + date + condition + AI status + review status (client side),
 * and the server-side query builder that applies date/site/status/text/country in the database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const calls = []
  const chain = {}
  for (const m of ['select', 'order', 'range', 'eq', 'gte', 'lt', 'or']) {
    chain[m] = (...args) => { calls.push([m, ...args]); return chain }
  }
  return { calls, chain, from: vi.fn(() => chain) }
})
vi.mock('../lib/api/_client', async (orig) => ({
  ...(await orig()),
  supabase: { from: h.from },
}))

import { listInspectionsForAiRegister } from '../lib/api/inspections'
import { applyRegisterFilters, matchesRegisterFilters, conditionOptions, DEFAULT_REGISTER_FILTERS } from '../lib/aiTyreInspectionFilters'

const rec = (id, o = {}) => ({
  id, asset_no: 'TM' + id, site: 'NHC', status: 'Done', inspection_date: '2026-10-10',
  tyre_conditions: { F1L: { condition: 'Good' }, R1Lo: { condition: 'Damaged' } },
  photosForReview: 1, measuredCount: 0, needsMeasurement: 2, ...o,
})
const J = (status, review) => ({ status, review_status: review })

describe('combined register filters', () => {
  const records = [
    rec('1'),
    rec('2', { site: 'DIRIYAH' }),
    rec('3', { inspection_date: '2026-09-01' }),
    rec('4', { tyre_conditions: { F1L: { condition: 'Good' } } }),
    rec('5', { status: 'In Progress' }),
    rec('6', { photosForReview: 0, measuredCount: 3, needsMeasurement: 0 }),
  ]
  const jobs = {
    1: [J('completed', 'accepted')], 2: [J('completed', 'accepted')], 3: [J('completed', 'accepted')],
    4: [J('completed', 'accepted')], 5: [J('pending', null)], 6: [J('failed', 'rejected'), J('completed', null)],
  }
  const ids = f => applyRegisterFilters(records, jobs, f).map(r => r.id)

  it('no filters returns everything', () => { expect(ids({})).toEqual(['1', '2', '3', '4', '5', '6']) })

  it('site + date + condition + AI status + review status all have to match', () => {
    const f = { site: 'NHC', dateFrom: '2026-10-01', dateTo: '2026-10-31', condition: 'Damaged', aiStatus: 'completed', review: 'accepted' }
    expect(ids(f)).toEqual(['1']) // 2 wrong site, 3 too old, 4 no damaged tyre, 5 pending, 6 not accepted
  })

  it('each filter alone excludes exactly what it should', () => {
    expect(ids({ site: 'DIRIYAH' })).toEqual(['2'])
    expect(ids({ dateFrom: '2026-10-01' })).not.toContain('3')
    expect(ids({ dateTo: '2026-09-30' })).toEqual(['3'])
    expect(ids({ condition: 'Damaged' })).not.toContain('4')
    expect(ids({ status: 'In Progress' })).toEqual(['5'])
    expect(ids({ aiStatus: 'pending' })).toEqual(['5'])
    expect(ids({ aiStatus: 'failed' })).toEqual(['6'])
    expect(ids({ review: 'rejected' })).toEqual(['6'])
  })

  it('date range is inclusive on both days and uses the calendar day of a timestamp', () => {
    const r = [rec('a', { inspection_date: '2026-10-10T23:59:59+03:00' })]
    expect(applyRegisterFilters(r, {}, { dateFrom: '2026-10-10', dateTo: '2026-10-10' })).toHaveLength(1)
    expect(applyRegisterFilters(r, {}, { dateFrom: '2026-10-11' })).toHaveLength(0)
    expect(applyRegisterFilters([rec('b', { inspection_date: null })], {}, { dateFrom: '2026-01-01' })).toHaveLength(0)
  })

  it('AI status "none" means no job at all; a missing review counts as unreviewed', () => {
    expect(applyRegisterFilters(records, { 1: [J('completed', 'accepted')] }, { aiStatus: 'none' }).map(r => r.id)).toEqual(['2', '3', '4', '5', '6'])
    expect(ids({ review: 'unreviewed' }).sort()).toEqual(['5', '6'])
    // an inspection with no jobs can never match a review-status filter
    expect(applyRegisterFilters([rec('x')], {}, { review: 'unreviewed' })).toEqual([])
    expect(applyRegisterFilters([rec('x')], {}, { aiStatus: 'none', review: 'unreviewed' })).toEqual([])
  })

  it('a job filter matches when ANY job of the inspection matches', () => {
    expect(ids({ aiStatus: 'completed', review: 'unreviewed' })).toEqual(['6'])
  })

  it('quick chips: defect photos, measured, missing measurements', () => {
    expect(ids({ quick: 'photos' })).not.toContain('6')
    expect(ids({ quick: 'measurements' })).toEqual(['6'])
    expect(ids({ quick: 'missing' })).not.toContain('6')
    expect(ids({ quick: 'photos', site: 'NHC', aiStatus: 'completed', review: 'accepted', condition: 'Damaged', dateFrom: '2026-10-01' })).toEqual(['1'])
  })

  it('handles string-encoded tyre_conditions and builds the condition list', () => {
    const r = rec('s', { tyre_conditions: JSON.stringify({ A: { condition: 'Flat' } }) })
    expect(matchesRegisterFilters(r, [], { condition: 'Flat' })).toBe(true)
    expect(conditionOptions([r, rec('t')])).toEqual(['Damaged', 'Flat', 'Good'])
    expect(DEFAULT_REGISTER_FILTERS.site).toBe('all')
  })
})

describe('server-side filter builder (listInspectionsForAiRegister)', () => {
  beforeEach(() => { h.calls.length = 0; h.from.mockClear() })
  const has = (...call) => h.calls.some(c => JSON.stringify(c) === JSON.stringify(call))

  it('applies every database filter together, with an exact count and a stable order', () => {
    listInspectionsForAiRegister({ page: 2, pageSize: 50, country: 'KSA', dateFrom: '2026-10-01', dateTo: '2026-10-31', site: 'NHC', status: 'Done', search: 'TM5' })
    expect(h.from).toHaveBeenCalledWith('inspections')
    expect(h.calls[0][2]).toEqual({ count: 'exact' })
    expect(has('eq', 'country', 'KSA')).toBe(true)
    expect(has('gte', 'inspection_date', '2026-10-01')).toBe(true)
    expect(has('lt', 'inspection_date', '2026-11-01')).toBe(true) // through-day is inclusive
    expect(has('eq', 'site', 'NHC')).toBe(true)
    expect(has('eq', 'status', 'Done')).toBe(true)
    expect(has('or', 'asset_no.ilike.%TM5%,site.ilike.%TM5%')).toBe(true)
    expect(has('range', 100, 149)).toBe(true)
    expect(has('order', 'inspection_date', { ascending: false, nullsFirst: false })).toBe(true)
    expect(has('order', 'id', { ascending: true })).toBe(true)
  })

  it('"all" and empty values add no filter', () => {
    listInspectionsForAiRegister({ country: 'All', site: 'all', status: 'all', search: '   ' })
    for (const m of ['eq', 'gte', 'lt', 'or']) expect(h.calls.filter(c => c[0] === m)).toHaveLength(0)
    expect(has('range', 0, 49)).toBe(true)
  })

  it('ignores malformed dates instead of sending them to the database', () => {
    listInspectionsForAiRegister({ dateFrom: '10/01/2026', dateTo: 'tomorrow' })
    expect(h.calls.filter(c => c[0] === 'gte' || c[0] === 'lt')).toHaveLength(0)
  })

  it('strips PostgREST filter syntax from the search text (no filter injection)', () => {
    listInspectionsForAiRegister({ search: 'a,site.eq.X)(*%_\\' })
    const or = h.calls.find(c => c[0] === 'or')[1]
    expect(or).toBe('asset_no.ilike.%asite.eq.X%,site.ilike.%asite.eq.X%')
    expect(or).not.toMatch(/[()*\\]/)
  })

  it('clamps page size and negative pages', () => {
    listInspectionsForAiRegister({ page: -3, pageSize: 100000 })
    expect(has('range', 0, 199)).toBe(true)
    h.calls.length = 0
    listInspectionsForAiRegister({ page: 1, pageSize: 0 })
    expect(has('range', 50, 99)).toBe(true)
  })

  it('through-date rolls over month and year ends', () => {
    listInspectionsForAiRegister({ dateTo: '2026-12-31' })
    expect(has('lt', 'inspection_date', '2027-01-01')).toBe(true)
    h.calls.length = 0
    listInspectionsForAiRegister({ dateTo: '2028-02-28' })
    expect(has('lt', 'inspection_date', '2028-02-29')).toBe(true)
  })
})
