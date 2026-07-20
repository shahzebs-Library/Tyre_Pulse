import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted Supabase mock: a chainable, awaitable query builder plus rpc() and
// auth.getUser(). from(table) returns a builder whose methods record calls and
// return `this`; awaiting it resolves to state.tables[table] (or null/null).
// Mirrors the pmPrograms.test.js pattern, with the extra filter methods this
// service uses (gte/lte/is).
const h = vi.hoisted(() => {
  const state = { tables: {}, user: { data: { user: { id: 'me' } }, error: null }, calls: [] }
  const METHODS = [
    'select', 'eq', 'in', 'order', 'limit', 'or', 'range', 'neq',
    'gte', 'lte', 'is', 'not', 'maybeSingle', 'single', 'insert', 'update', 'delete',
  ]
  function makeBuilder(table) {
    const rec = { table, ops: [] }
    state.calls.push(rec)
    const builder = {}
    for (const m of METHODS) {
      builder[m] = (...args) => { rec.ops.push([m, args]); return builder }
    }
    builder.then = (resolve, reject) =>
      Promise.resolve(state.tables[table] || { data: null, error: null }).then(resolve, reject)
    return builder
  }
  return {
    state,
    supabase: {
      from: (t) => makeBuilder(t),
      auth: { getUser: () => Promise.resolve(state.user) },
    },
  }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const wl = await import('./workshopLive')

const lastCall = (table) => [...h.state.calls].reverse().find((c) => c.table === table)
const insertPayload = (rec) => rec?.ops.find((o) => o[0] === 'insert')?.[1]?.[0]

beforeEach(() => {
  h.state.tables = {}
  h.state.user = { data: { user: { id: 'me' } }, error: null }
  h.state.calls = []
})

describe('workshopLive.recordEvent', () => {
  it('maps params into the tech_activity_events insert (user_id explicit)', async () => {
    h.state.tables.tech_activity_events = { data: { id: 'e1' }, error: null }
    const out = await wl.recordEvent({
      user_id: 'u1',
      job_id: 'j1',
      task_id: 't1',
      asset_no: 'A1',
      event_type: 'start_job',
      reason_code: null,
      note: 'starting',
      device: 'tablet-1',
      gps_lat: '24.7',
      gps_lng: '46.6',
    })
    expect(out).toEqual({ id: 'e1' })
    const rec = lastCall('tech_activity_events')
    expect(insertPayload(rec)).toEqual({
      user_id: 'u1',
      job_id: 'j1',
      task_id: 't1',
      asset_no: 'A1',
      event_type: 'start_job',
      reason_code: null,
      note: 'starting',
      device: 'tablet-1',
      gps_lat: 24.7,
      gps_lng: 46.6,
    })
  })

  it('falls back to the signed-in user when user_id is omitted', async () => {
    h.state.tables.tech_activity_events = { data: { id: 'e2' }, error: null }
    await wl.recordEvent({ event_type: 'check_in' })
    const rec = lastCall('tech_activity_events')
    expect(insertPayload(rec).user_id).toBe('me')
  })

  it('rejects an invalid event_type (never touches the table)', async () => {
    await expect(wl.recordEvent({ event_type: 'not_a_real_event' })).rejects.toThrow()
    expect(lastCall('tech_activity_events')).toBeUndefined()
  })
})

describe('workshopLive.assignJob', () => {
  it('inserts the wo_assignments row and returns it', async () => {
    h.state.tables.wo_assignments = { data: { id: 'as1', job_id: 'j1', user_id: 'u1' }, error: null }
    h.state.tables.profiles = { data: { full_name: 'Sara Tech', username: 'sara' }, error: null }
    h.state.tables.work_orders = { data: { status: 'new' }, error: null }

    const out = await wl.assignJob({ job_id: 'j1', user_id: 'u1', role: 'primary' })
    expect(out).toEqual({ id: 'as1', job_id: 'j1', user_id: 'u1' })

    const rec = lastCall('wo_assignments')
    const payload = insertPayload(rec)
    expect(payload).toMatchObject({
      job_id: 'j1',
      task_id: null,
      user_id: 'u1',
      role: 'primary',
      active: true,
      assigned_by: 'me',
    })
  })

  it('requires a job and a technician', async () => {
    await expect(wl.assignJob({ user_id: 'u1' })).rejects.toThrow()
    await expect(wl.assignJob({ job_id: 'j1' })).rejects.toThrow()
  })
})

describe('workshopLive.loadLiveBoard', () => {
  it('returns the documented shape from real rows', async () => {
    h.state.tables.profiles = {
      data: [{ id: 'u1', full_name: 'Sara Tech', role: 'Technician', site: 'NHC' }],
      error: null,
    }
    h.state.tables.technician_skills = { data: [], error: null }
    h.state.tables.work_orders = {
      data: [{ id: 'j1', work_order_no: 'WO-1', status: 'in_progress' }],
      error: null,
    }
    h.state.tables.tech_activity_events = {
      data: [{ id: 'e1', user_id: 'u1', event_type: 'start_job', at: '2026-07-20T08:00:00Z' }],
      error: null,
    }
    h.state.tables.wo_assignments = {
      data: [{ id: 'as1', job_id: 'j1', user_id: 'u1', active: true }],
      error: null,
    }
    h.state.tables.shifts = { data: [], error: null }
    h.state.tables.workshop_attendance = {
      data: [{ user_id: 'u1', check_in: '2026-07-20T07:30:00Z', check_out: null }],
      error: null,
    }

    const board = await wl.loadLiveBoard({ site: 'NHC' })
    expect(Object.keys(board).sort()).toEqual([
      'assignments', 'eventsByUser', 'jobs', 'jobsById', 'presentByUser', 'shiftByUser', 'technicians',
    ])
    expect(board.technicians).toEqual([
      { id: 'u1', full_name: 'Sara Tech', employee_id: null, role: 'Technician', site: 'NHC', avatar_url: null, phone: null },
    ])
    expect(board.eventsByUser.u1).toHaveLength(1)
    expect(board.jobsById.j1).toMatchObject({ id: 'j1' })
    expect(board.jobs).toHaveLength(1)
    expect(board.assignments).toHaveLength(1)
    expect(board.presentByUser).toEqual({ u1: true })
    expect(board.shiftByUser).toEqual({})
  })

  it('survives a missing table (empty groups, no throw)', async () => {
    // Every table errors as "does not exist".
    const missing = { data: null, error: { message: 'relation "x" does not exist', code: '42P01' } }
    for (const t of ['profiles', 'technician_skills', 'work_orders', 'tech_activity_events', 'wo_assignments', 'shifts', 'workshop_attendance']) {
      h.state.tables[t] = missing
    }
    const board = await wl.loadLiveBoard({})
    expect(board).toEqual({
      technicians: [],
      eventsByUser: {},
      jobs: [],
      jobsById: {},
      assignments: [],
      shiftByUser: {},
      presentByUser: {},
    })
  })
})
