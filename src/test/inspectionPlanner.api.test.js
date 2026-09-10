import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { queries: [], reads: {}, write: { data: [{ id: 'saved' }], error: null } }
  const from = vi.fn(table => {
    const calls = { table, eq: [], or: [] }
    const query = {
      select(value) { calls.select = value; return query },
      order() { return query },
      range(start, end) { calls.range = [start, end]; return query },
      eq(key, value) { calls.eq.push([key, value]); return query },
      or(value) { calls.or.push(value); return query },
      abortSignal(signal) { calls.signal = signal; return query },
      insert(value) { calls.insert = value; return query },
      update(value) { calls.update = value; return query },
      delete() { calls.delete = true; return query },
      then(resolve, reject) { return Promise.resolve(calls.range ? state.reads[table] || { data: [], error: null } : state.write).then(resolve, reject) },
    }
    state.queries.push(calls)
    return query
  })
  return { state, from, fetchAllPages: vi.fn(factory => factory(0, 999)) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: h.from } }))
vi.mock('../lib/fetchAll', () => ({ fetchAllPages: h.fetchAllPages }))

import { loadPlannerData, savePlannerSchedules, updateScheduleStatus, deletePlannerSchedule } from '../lib/api/inspectionPlanner'

beforeEach(() => {
  h.state.queries = []
  h.state.reads = {}
  h.state.write = { data: [{ id: 'saved' }], error: null }
  vi.clearAllMocks()
})

describe('inspection planner loading', () => {
  it('refreshes all sources with country and abort handling, including legacy schedules', async () => {
    const signal = new AbortController().signal
    h.state.reads.inspections = { data: [{ id: 'i', inspector: 'Alex' }], error: null }
    h.state.reads.inspection_schedules = { data: [{ id: 's', scheduled_date: '2026-09-10', inspection_type: 'Follow-up' }], error: null }
    const result = await loadPlannerData({ country: 'KSA', signal })
    expect(h.state.queries.map(query => query.table)).toEqual(['inspections', 'tyre_records', 'inspection_schedules'])
    for (const query of h.state.queries) {
      expect(query.signal).toBe(signal)
      expect(query.range).toEqual([0, 999])
      if (query.table === 'inspection_schedules') expect(query.or).toEqual(['country.eq.KSA,country.is.null'])
      else expect(query.eq).toContainEqual(['country', 'KSA'])
    }
    expect(h.fetchAllPages).toHaveBeenCalledTimes(3)
    expect(result.inspections[0].inspector_name).toBe('Alex')
    expect(result.schedule[0]).toMatchObject({ inspection_date: '2026-09-10', type: 'Follow-up', status: 'Scheduled' })
    expect(result).toMatchObject({ dataError: null, scheduleError: null, truncated: false })
  })
  it('preserves successful history and explicitly flags unavailable schedules', async () => {
    h.state.reads.inspections = { data: [{ id: 'i' }], error: null, truncated: true }
    h.state.reads.inspection_schedules = { data: null, error: { message: 'secret table failure' } }
    const result = await loadPlannerData({ country: 'All' })
    expect(result.inspections).toHaveLength(1)
    expect(result.schedule).toEqual([])
    expect(result.scheduleError).toMatch(/Retry before scheduling/)
    expect(result.scheduleError).not.toContain('secret')
    expect(result.dataError).toBeNull()
    expect(result.truncated).toBe(true)
    expect(h.state.queries.every(query => !query.eq.length && !query.or.length)).toBe(true)
  })
  it('flags missing history independently and rejects an aborted refresh', async () => {
    h.state.reads.tyre_records = { data: null, error: { message: 'failed' } }
    expect((await loadPlannerData()).dataError).toMatch(/Could not load inspection/)
    const controller = new AbortController()
    controller.abort()
    await expect(loadPlannerData({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('inspection schedule writes', () => {
  const item = { asset_no: ' A ', site: ' Site ', inspection_date: '2026-09-10', inspection_time: '08:00', inspector_name: ' Alex ', notes: ' Note ', organisation_id: 'untrusted', created_by: 'untrusted', country: 'untrusted' }

  it('returns confirmed inserted IDs and whitelists payload ownership', async () => {
    await expect(savePlannerSchedules([item], { country: 'KSA', profileId: 'profile' })).resolves.toEqual([{ id: 'saved' }])
    const query = h.state.queries[0]
    expect(query.select).toBe('id')
    expect(query.insert[0]).toMatchObject({ asset_no: 'A', site: 'Site', inspector_name: 'Alex', scheduled_date: '2026-09-10', country: 'KSA', created_by: 'profile' })
    expect(query.insert[0]).not.toHaveProperty('organisation_id')
    expect(query.insert[0]).not.toHaveProperty('inspection_date')
  })
  it('requires a concrete country and nonempty list before creating appointments', async () => {
    await expect(savePlannerSchedules([item], { country: 'All' })).rejects.toThrow(/Select a country/)
    await expect(savePlannerSchedules([item])).rejects.toThrow(/Select a country/)
    await expect(savePlannerSchedules([], { country: 'KSA' })).rejects.toThrow(/at least one/)
    expect(h.from).not.toHaveBeenCalled()
  })
  it('rejects oversized batches before writing so response limits cannot cause an unsafe retry', async () => {
    await expect(savePlannerSchedules(Array.from({ length: 501 }, (_, index) => ({ ...item, asset_no: `A${index}` })), { country: 'KSA' }))
      .rejects.toThrow('Schedule up to 500 vehicles at a time.')
    expect(h.from).not.toHaveBeenCalled()
  })
  it('edits exactly one ID without overwriting country or creator', async () => {
    await savePlannerSchedules([{ ...item, id: 'existing' }], { country: 'All', profileId: 'other' })
    const query = h.state.queries[0]
    expect(query.eq).toEqual([['id', 'existing']])
    expect(query.select).toBe('id')
    expect(query.update).not.toHaveProperty('country')
    expect(query.update).not.toHaveProperty('created_by')
  })
  it('rejects impossible dates, blank assignment fields, and invalid clock times before writing', async () => {
    for (const invalid of [
      { inspection_date: '2026-02-30' }, { inspection_date: '' },
      { asset_no: ' ' }, { inspector_name: ' ' },
      { inspection_time: '24:00' }, { inspection_time: '12:60' },
    ]) {
      await expect(savePlannerSchedules([{ ...item, ...invalid }], { country: 'KSA' })).rejects.toThrow()
    }
    await expect(savePlannerSchedules([item], { country: ' ' })).rejects.toThrow(/Select a country/)
    expect(h.from).not.toHaveBeenCalled()
  })
  it('rejects zero updated rows and incomplete bulk acknowledgements', async () => {
    h.state.write = { data: [], error: null }
    await expect(savePlannerSchedules([{ ...item, id: 'missing' }])).rejects.toThrow(/could not be confirmed/)
    h.state.write = { data: [{ id: 'only-one' }], error: null }
    await expect(savePlannerSchedules([item, { ...item, asset_no: 'B' }], { country: 'KSA' })).rejects.toThrow(/could not be confirmed/)
  })
  it('requires confirmation for cancellations and deletes and forbids invented completion', async () => {
    await updateScheduleStatus('s', 'Cancelled')
    expect(h.state.queries[0]).toMatchObject({ update: { status: 'Cancelled' }, eq: [['id', 's']], select: 'id' })
    await deletePlannerSchedule('s')
    expect(h.state.queries[1]).toMatchObject({ delete: true, eq: [['id', 's']], select: 'id' })
    await expect(updateScheduleStatus('s', 'Completed')).rejects.toThrow(/not supported/)
    h.state.write = { data: [], error: null }
    await expect(updateScheduleStatus('s', 'Cancelled')).rejects.toThrow(/could not be confirmed/)
    await expect(deletePlannerSchedule('s')).rejects.toThrow(/could not be confirmed/)
  })
  it('sanitizes rejected writes rather than exposing backend error text', async () => {
    h.state.write = { data: null, error: { code: '42501', message: 'permission denied for table secret_table' } }
    await expect(savePlannerSchedules([item], { country: 'KSA' })).rejects.toThrow()
    try { await deletePlannerSchedule('s') } catch (error) { expect(error.message).not.toContain('secret_table') }
  })
})
