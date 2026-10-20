import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  historyState, historyRow, dayRangeBounds, historyExportRows, HISTORY_EXPORT_KEYS, changeLines,
  appliedConflicts, uploadRowView, summariseRows, detailExportRows, DETAIL_EXPORT_KEYS,
} from '../lib/workshopStatus/uploadHistory.js'

// Loop 15 - daily upload history (register + read-only row detail).

const h = vi.hoisted(() => {
  const state = { chain: [], result: { data: [], error: null, count: 0 }, results: null }
  const builder = () => {
    const b = {}
    for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'limit']) {
      b[m] = (...args) => { state.chain.push([m, ...args]); return b }
    }
    b.range = (from, to) => {
      state.chain.push(['range', from, to])
      const r = state.results ? state.results.shift() : state.result
      return Promise.resolve(r)
    }
    b.then = (res, rej) => Promise.resolve(state.results ? state.results.shift() : state.result).then(res, rej)
    return b
  }
  return { state, supabase: { from(t) { state.chain.push(['from', t]); return builder() } } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))
const api = await import('../lib/api/workshopStatusUploads.js')

beforeEach(() => {
  h.state.chain = []
  h.state.results = null
  h.state.result = { data: [], error: null, count: 0 }
})

const upload = (over = {}) => ({
  id: 'u1', upload_no: 12, country: 'KSA', file_name: 'daily.xlsx', sheet_name: 'Oct', report_date: '2026-10-07',
  status: 'confirmed', uploaded_by_name: 'Super Visor', uploaded_at: '2026-10-07T06:00:00Z',
  confirmed_by_name: 'Super Visor', confirmed_at: '2026-10-07T06:05:00Z', total_rows: 40, new_count: 2,
  updated_count: 3, unchanged_count: 30, removed_count: 4, invalid_count: 1, duplicate_count: 0,
  conflict_count: 2, kept_manual_count: 1, ...over,
})

describe('pure helpers', () => {
  it('historyState: confirmed / abandoned (cancelled or never confirmed) / failed', () => {
    expect(historyState({ status: 'confirmed' })).toBe('confirmed')
    expect(historyState({ status: 'cancelled' })).toBe('abandoned')
    expect(historyState({ status: 'previewed' })).toBe('abandoned')
    expect(historyState({ status: 'failed' })).toBe('failed')
    expect(historyState(null)).toBe('abandoned')
  })

  it('historyRow maps counts; released = removed_count (DB token kept)', () => {
    const r = historyRow(upload())
    expect(r).toMatchObject({ uploadNo: 12, newCount: 2, unchangedCount: 30, releasedCount: 4, changedCount: 3,
      conflictCount: 2, keptManualCount: 1, state: 'confirmed', uploadedBy: 'Super Visor', reportDate: '2026-10-07' })
    const missing = historyRow({ id: 'x', status: 'previewed' })
    expect(missing.rows).toBe(null)
    expect(missing.conflictCount).toBe(null)
  })

  it('dayRangeBounds: inclusive local days, swapped when backwards, blank -> null', () => {
    const b = dayRangeBounds('2026-10-01', '2026-10-07')
    expect(new Date(b.gte).getDate()).toBe(1)
    expect(new Date(b.lt).getDate()).toBe(8)
    const swapped = dayRangeBounds('2026-10-07', '2026-10-01')
    expect(swapped.gte).toBe(b.gte)
    expect(swapped.lt).toBe(b.lt)
    expect(dayRangeBounds('', 'bad')).toEqual({ gte: null, lt: null })
  })

  it('exports every column, blanks as empty strings', () => {
    const out = historyExportRows([upload(), { id: 'u2', status: 'cancelled' }], (s) => `S:${s}`)
    expect(Object.keys(out[0])).toEqual([...HISTORY_EXPORT_KEYS])
    expect(out[0].state).toBe('S:confirmed')
    expect(out[1].state).toBe('S:abandoned')
    expect(out[1].fileName).toBe('')
  })

  it('row detail: change lines, release reason, requested vs applied conflict choice', () => {
    expect(changeLines({ complaint: { from: 'A', to: 'B' }, site: { from: null, to: 'NHC' } }, { complaint: 'Complaint' }))
      .toEqual(['Complaint: A -> B', 'site: (blank) -> NHC'])
    expect(changeLines(null)).toEqual([])
    const applied = appliedConflicts({ conflict_rows: [{ asset_no: 'TM2', kind: 'removed', resolution: 'keep_manual',
      last_updated_by_name: 'Super Visor', last_manual_update_at: '2026-10-07T08:00:00Z' }] })
    const views = [
      { id: 'a', row_number: 1, asset_no: 'TM1', outcome: 'changed', changes: { complaint: { from: 'A', to: 'B' } },
        conflict: 'manual_newer', resolution: 'take_file', conflict_details: { last_updated_by_name: 'Ali' }, data: {} },
      { id: 'b', row_number: null, asset_no: 'TM2', outcome: 'removed', raw: { removal_reason: 'missing_from_upload' } },
      { id: 'c', row_number: 3, asset_no: null, outcome: 'invalid', errors: ['Missing vehicle number'] },
    ].map((r) => uploadRowView(r, { applied }))
    expect(views[0]).toMatchObject({ conflict: 'manual_newer', requested: 'take_file', applied: null, manualBy: 'Ali' })
    expect(views[1]).toMatchObject({ conflict: 'manual_newer', applied: 'keep_manual', releaseReason: 'missing_from_upload' })
    expect(views[2].errors).toEqual(['Missing vehicle number'])
    expect(summariseRows(views)).toMatchObject({ changed: 1, removed: 1, invalid: 1, conflict: 2, new: 0 })
    const out = detailExportRows(views, (o) => o.toUpperCase())
    expect(Object.keys(out[0])).toEqual([...DETAIL_EXPORT_KEYS])
    expect(out[0].outcome).toBe('CHANGED')
    expect(out[0].changes).toBe('complaint: A -> B')
  })
})

describe('service', () => {
  it('listUploadHistory pages newest first with an id tiebreak and applies filters', async () => {
    h.state.result = { data: [upload()], error: null, count: 31 }
    const res = await api.listUploadHistory({ country: 'KSA', from: '2026-10-01', to: '2026-10-07', state: 'abandoned', page: 1, pageSize: 10 })
    expect(res).toEqual({ rows: [upload()], total: 31 })
    const c = h.state.chain
    expect(c[0]).toEqual(['from', 'workshop_status_uploads'])
    expect(c).toContainEqual(['eq', 'country', 'KSA'])
    expect(c).toContainEqual(['in', 'status', ['cancelled', 'previewed']])
    expect(c.find((x) => x[0] === 'gte')[1]).toBe('uploaded_at')
    expect(c.find((x) => x[0] === 'lt')[1]).toBe('uploaded_at')
    expect(c.filter((x) => x[0] === 'order').map((x) => x[1])).toEqual(['uploaded_at', 'id'])
    expect(c).toContainEqual(['range', 10, 19])
    expect(c[1][1]).toContain('conflict_count')
  })

  it('falls back to the base columns before the Loop 16 migration', async () => {
    h.state.results = [
      { data: null, error: { code: '42703', message: 'column workshop_status_uploads.conflict_count does not exist' }, count: null },
      { data: [upload({ conflict_count: undefined })], error: null, count: 1 },
    ]
    const res = await api.listUploadHistory({ country: 'all' })
    expect(res.total).toBe(1)
    const selects = h.state.chain.filter((x) => x[0] === 'select').map((x) => x[1])
    expect(selects[1]).not.toContain('conflict_count')
    expect(h.state.chain.some((x) => x[0] === 'eq' && x[1] === 'country')).toBe(false)
  })

  it('a read error throws a user message', async () => {
    h.state.result = { data: null, error: { code: '42501', message: 'permission denied for table workshop_status_uploads' } }
    await expect(api.listUploadHistory({})).rejects.toThrow()
  })

  it('listUploadRows orders by row then id and requires an upload', async () => {
    h.state.result = { data: [{ id: 'r1' }], error: null }
    const res = await api.listUploadRows('u1')
    expect(res.rows).toEqual([{ id: 'r1' }])
    expect(h.state.chain).toContainEqual(['eq', 'upload_id', 'u1'])
    expect(h.state.chain.filter((x) => x[0] === 'order').map((x) => x[1])).toEqual(['row_number', 'id'])
    await expect(api.listUploadRows('')).rejects.toMatchObject({ code: 'upload_required' })
  })

  it('getUploadConfirmDetails never throws', async () => {
    h.state.result = { data: null, error: { message: 'denied' } }
    expect(await api.getUploadConfirmDetails('u1')).toBe(null)
    h.state.result = { data: [{ details: { kept_manual: 1 } }], error: null }
    expect(await api.getUploadConfirmDetails('u1')).toEqual({ kept_manual: 1 })
    expect(await api.getUploadConfirmDetails(null)).toBe(null)
  })
})
