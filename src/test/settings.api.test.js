import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: chainable, thenable query builder recording table,
// select cols, order/eq/limit filters, and insert/update/delete/upsert payloads,
// resolving to a configurable { data, error }. Also mocks the auth surface the
// Settings account-security section uses (updateUser + mfa.listFactors/unenroll).
const h = vi.hoisted(() => {
  const state = {
    result: { data: [], error: null }, last: null,
    auth: { updateUser: { data: {}, error: null }, listFactors: { data: {}, error: null }, unenroll: { data: {}, error: null } },
    authCalls: {},
  }
  function from(table) {
    const calls = { eq: [], order: [] }
    const b = {
      _table: table, _calls: calls,
      select(cols, opts) { calls.select = cols; calls.selectOpts = opts; return b },
      order(c, o) { calls.order.push([c, o]); return b },
      limit(n) { calls.limit = n; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      upsert(v, opts) { calls.upsert = v; calls.upsertOpts = opts; return b },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  const supabase = {
    from,
    auth: {
      updateUser(args) { state.authCalls.updateUser = args; return Promise.resolve(state.auth.updateUser) },
      mfa: {
        listFactors() { state.authCalls.listFactors = true; return Promise.resolve(state.auth.listFactors) },
        unenroll(args) { state.authCalls.unenroll = args; return Promise.resolve(state.auth.unenroll) },
      },
    },
  }
  return { state, supabase }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const settings = await import('../lib/api/settings')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.authCalls = {}
  h.state.auth = { updateUser: { data: {}, error: null }, listFactors: { data: {}, error: null }, unenroll: { data: {}, error: null } }
})

describe('service layer - settings', () => {
  it('listSettings reads key/value from settings', async () => {
    h.state.result = { data: [{ key: 'currency', value: '"USD"' }], error: null }
    const res = await settings.listSettings()
    expect(h.state.last._table).toBe('settings')
    expect(h.state.last._calls.select).toBe('key, value')
    expect(res.data).toEqual([{ key: 'currency', value: '"USD"' }])
  })

  it('listUploadHistory reads recent 3, newest first', async () => {
    await settings.listUploadHistory()
    expect(h.state.last._table).toBe('upload_history')
    expect(h.state.last._calls.order).toContainEqual(['uploaded_at', { ascending: false }])
    expect(h.state.last._calls.limit).toBe(3)
  })

  it('listKpiTargetsByYear filters by year', async () => {
    await settings.listKpiTargetsByYear(2026)
    expect(h.state.last._table).toBe('kpi_targets')
    expect(h.state.last._calls.eq).toContainEqual(['year', 2026])
  })

  it('getAlertThresholds reads the single alert_thresholds app_settings row', async () => {
    await settings.getAlertThresholds()
    expect(h.state.last._table).toBe('app_settings')
    expect(h.state.last._calls.eq).toContainEqual(['key', 'alert_thresholds'])
  })

  it('upsertSetting upserts into settings on key', async () => {
    const row = { key: 'currency', value: '"USD"', updated_by: 'u1' }
    await settings.upsertSetting(row)
    expect(h.state.last._table).toBe('settings')
    expect(h.state.last._calls.upsert).toEqual(row)
    expect(h.state.last._calls.upsertOpts).toEqual({ onConflict: 'key' })
  })

  it('upsertAppSetting upserts into app_settings on key', async () => {
    const row = { key: 'alert_thresholds', value: '{}', updated_by: 'u1' }
    await settings.upsertAppSetting(row)
    expect(h.state.last._table).toBe('app_settings')
    expect(h.state.last._calls.upsertOpts).toEqual({ onConflict: 'key' })
  })

  it('updateProfile updates profiles by id', async () => {
    await settings.updateProfile('u1', { full_name: 'X' })
    expect(h.state.last._table).toBe('profiles')
    expect(h.state.last._calls.update).toEqual({ full_name: 'X' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'u1'])
  })

  it('upsertKpiTargets upserts with the composite conflict target', async () => {
    await settings.upsertKpiTargets([{ metric: 'cpk' }])
    expect(h.state.last._table).toBe('kpi_targets')
    expect(h.state.last._calls.upsertOpts).toEqual({ onConflict: 'metric,year,month,site' })
  })

  it('listReportSchedules selects the section columns, oldest first', async () => {
    await settings.listReportSchedules()
    expect(h.state.last._table).toBe('report_schedules')
    expect(h.state.last._calls.select).toContain('report_type')
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: true }])
  })

  it('insertReportSchedule inserts a row', async () => {
    await settings.insertReportSchedule({ name: 'Fleet Summary' })
    expect(h.state.last._table).toBe('report_schedules')
    expect(h.state.last._calls.insert).toEqual({ name: 'Fleet Summary' })
  })

  it('deleteReportSchedule deletes by id and returns id', async () => {
    await settings.deleteReportSchedule('s1')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 's1'])
    expect(h.state.last._calls.select).toBe('id')
  })

  it('updateReportSchedule updates by id', async () => {
    await settings.updateReportSchedule('s1', { active: false, next_run_at: null })
    expect(h.state.last._calls.update).toEqual({ active: false, next_run_at: null })
    expect(h.state.last._calls.eq).toContainEqual(['id', 's1'])
  })

  it('updatePassword calls auth.updateUser with the password', async () => {
    await settings.updatePassword('newpass')
    expect(h.state.authCalls.updateUser).toEqual({ password: 'newpass' })
  })

  it('listMfaFactors and unenrollMfaFactor hit the auth.mfa surface', async () => {
    await settings.listMfaFactors()
    expect(h.state.authCalls.listFactors).toBe(true)
    await settings.unenrollMfaFactor('f1')
    expect(h.state.authCalls.unenroll).toEqual({ factorId: 'f1' })
  })
})
