import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseWorkshopSheet } from '../lib/workshopStatus/excelParser.js'
import { compareWorkshopUpload } from '../lib/workshopStatus/compareUpload.js'

// Hoisted supabase mock: rpc() returns a per-function result; from() is a
// thenable query builder that records the chain.
const h = vi.hoisted(() => {
  const state = { results: {}, calls: [], query: null, chain: [] }
  const builder = () => {
    const b = {}
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
      b[m] = (...args) => { state.chain.push([m, ...args]); return b }
    }
    b.range = (from, to) => { state.chain.push(['range', from, to]); return Promise.resolve(state.query(from, to)) }
    b.then = (res, rej) => Promise.resolve(state.query(0, 0)).then(res, rej)
    return b
  }
  return {
    state,
    supabase: {
      rpc(fn, args) {
        state.calls.push([fn, args])
        return Promise.resolve(fn in state.results ? state.results[fn] : { data: null, error: null })
      },
      from(table) { state.chain.push(['from', table]); return builder() },
    },
  }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const api = await import('../lib/api/workshopStatus.js')

beforeEach(() => {
  h.state.results = {}
  h.state.calls = []
  h.state.chain = []
  h.state.query = () => ({ data: [], error: null })
})

const header = ['SR.NO', 'ASSET NO.', 'REG. NO.', 'JOB CARD NO.', 'LOCATION', 'PRODUCTION / FLEET COMPLIANT',
  'DIAGNOSTICS', 'BREAKDOWN DATE', 'DOWN DAYS', 'REMARKS']
const aoa = [
  ['GREEN CONCRETE COMPANY CJSC'],
  ['2026-10-07'],
  ['TRANSIT MIXER'],
  header,
  [1, 'TM1', 'R1', 'JC1', 'NHC', 'Gearbox noise', 'Check', '2026-10-01', 6, ''],
  [2, 'TM2', 'R2', 'JC2', 'NHC', 'Brakes', 'Check', '2026-10-02', 5, ''],
  [3, 'TM3', 'R3', 'JC3', 'NHC', 'New one', 'Check', '2026-10-03', 4, ''],
  [4, 'TM3', 'R3', 'JC3', 'NHC', 'New one', 'Check', '2026-10-03', 4, ''],
  [5, '', 'R9', 'JC9', 'NHC', 'No asset', 'Check', '2026-10-03', 4, ''],
  ['JOB CARD CLOSED DETAILS'],
  header,
  [1, 'TM9', 'R9', 'JC9', 'NHC', 'Done', 'Done', '2026-09-01', 30, ''],
]

describe('buildStagedRows', () => {
  it('maps every preview row to an outcome and adds one row per removed record', () => {
    const preview = parseWorkshopSheet(aoa, { sheetName: 'Oct' })
    const current = [
      { id: 'r1', asset_no: 'TM1', country: 'KSA', current_active: true, reg_no: 'R1', job_card_ref: 'JC1', site: 'NHC',
        complaint: 'Gearbox noise', diagnostics: 'Check', ooc_since: '2026-10-01', excel_down_days: 5,
        vehicle_category: 'TRANSIT MIXER', source_remarks: null },
      { id: 'r2', asset_no: 'TM2', country: 'KSA', current_active: true, reg_no: 'R2', job_card_ref: 'JC2', site: 'NHC',
        complaint: 'Old complaint', diagnostics: 'Check', ooc_since: '2026-10-02', vehicle_category: 'TRANSIT MIXER' },
      { id: 'r8', asset_no: 'TM8', country: 'KSA', current_active: true, site: 'NHC' },
    ]
    const cmp = compareWorkshopUpload(preview, current, { country: 'KSA' })
    const rows = api.buildStagedRows(cmp, preview)
    const by = (a, o) => rows.filter((r) => r.asset_no === a && r.outcome === o)

    expect(by('TM1', 'unchanged')).toHaveLength(1)
    expect(by('TM1', 'unchanged')[0].record_id).toBe('r1')
    const tm2 = by('TM2', 'changed')[0]
    expect(tm2.record_id).toBe('r2')
    expect(tm2.changes.complaint).toEqual({ from: 'Old complaint', to: 'Brakes' })
    expect(by('TM3', 'new')).toHaveLength(1)
    expect(by('TM3', 'duplicate')).toHaveLength(1)
    expect(rows.filter((r) => r.outcome === 'invalid')).toHaveLength(1)
    expect(by('TM9', 'closed')).toHaveLength(1)
    const removed = by('TM8', 'removed')[0]
    expect(removed).toMatchObject({ record_id: 'r8', data: {}, changes: {}, row_number: null, raw: { removal_reason: 'missing_from_upload' } })

    const tm3 = by('TM3', 'new')[0]
    expect(tm3.data.complaint).toBe('New one')
    expect(tm3.data.ooc_since).toBe('2026-10-03')
    expect(tm3.row_number).toBeGreaterThan(0)
    expect(tm3.section).toBe('TRANSIT MIXER')
    expect(Array.isArray(tm3.errors)).toBe(true)
    // One staged row per preview row, plus the removed record.
    expect(rows).toHaveLength(preview.rows.length + 1)
    for (const r of rows) {
      expect(['new', 'changed', 'unchanged', 'removed', 'closed', 'invalid', 'duplicate']).toContain(r.outcome)
    }
  })

  it('tolerates empty input', () => {
    expect(api.buildStagedRows(null, null)).toEqual([])
  })
})

describe('stageUpload / confirmUpload / cancelUpload', () => {
  it('stageUpload maps to the SQL parameters and returns ids', async () => {
    h.state.results.workshop_status_stage_upload = {
      data: { upload_id: 'u1', upload_no: 7, duplicate_of: { id: 'u0', upload_no: 6 } }, error: null,
    }
    const res = await api.stageUpload({
      country: ' KSA ', fileName: 'daily.xlsx', fileHash: 'abc', fileSize: 10.4, sheetName: 'Oct',
      reportDate: '2026-10-07', headerMap: { a: 'b' }, unmappedHeaders: ['X'], rows: [{ outcome: 'new' }],
    })
    expect(res).toEqual({ uploadId: 'u1', uploadNo: 7, duplicateOf: { id: 'u0', upload_no: 6 } })
    expect(h.state.calls[0]).toEqual(['workshop_status_stage_upload', {
      p_country: 'KSA', p_file_name: 'daily.xlsx', p_file_hash: 'abc', p_file_size: 10, p_sheet_name: 'Oct',
      p_report_date: '2026-10-07', p_header_map: { a: 'b' }, p_unmapped: ['X'], p_rows: [{ outcome: 'new' }],
    }])
  })

  it('stageUpload requires a country', async () => {
    await expect(api.stageUpload({ fileName: 'x.xlsx' })).rejects.toMatchObject({ code: 'country_required' })
    expect(h.state.calls).toHaveLength(0)
  })

  it('confirmUpload returns the summary and passes the acknowledgement', async () => {
    h.state.results.workshop_status_confirm_upload = { data: { upload_id: 'u1', new: 2 }, error: null }
    expect(await api.confirmUpload('u1', { acknowledgeDuplicate: true })).toEqual({ upload_id: 'u1', new: 2 })
    expect(h.state.calls[0]).toEqual(['workshop_status_confirm_upload', { p_upload_id: 'u1', p_acknowledge_duplicate: true }])
  })

  it('maps duplicate_file and stale_preview to coded plain-English errors', async () => {
    h.state.results.workshop_status_confirm_upload = {
      data: null, error: { code: 'P0001', message: 'duplicate_file: this file was already uploaded' },
    }
    const dup = await api.confirmUpload('u1').catch((e) => e)
    expect(dup.code).toBe('duplicate_file')
    expect(dup.message).toMatch(/already uploaded/i)
    expect(dup.message).not.toMatch(/duplicate_file/)

    h.state.results.workshop_status_confirm_upload = {
      data: null, error: { code: 'P0001', message: 'stale_preview: another upload for this country was confirmed' },
    }
    const stale = await api.confirmUpload('u1').catch((e) => e)
    expect(stale.code).toBe('stale_preview')
    expect(stale.message).toMatch(/upload the file again/i)
  })

  it('other errors are sanitised and keep their code', async () => {
    h.state.results.workshop_status_confirm_upload = {
      data: null, error: { code: '42501', message: 'permission denied for function workshop_status_confirm_upload' },
    }
    const err = await api.confirmUpload('u1').catch((e) => e)
    expect(err.name).toBe('ServiceError')
    expect(err.code).toBe('42501')
    expect(err.message).not.toMatch(/workshop_status_confirm_upload/)
  })

  it('cancelUpload calls the cancel function', async () => {
    h.state.results.workshop_status_cancel_upload = { data: { upload_id: 'u1', status: 'cancelled' }, error: null }
    expect(await api.cancelUpload('u1')).toEqual({ upload_id: 'u1', status: 'cancelled' })
    await expect(api.cancelUpload('')).rejects.toMatchObject({ code: 'upload_required' })
  })
})

describe('reads', () => {
  it('listActiveRecords filters active, not deleted, ordered, paged', async () => {
    h.state.query = () => ({ data: [{ id: 'a' }], error: null })
    expect(await api.listActiveRecords({ country: 'KSA' })).toEqual([{ id: 'a' }])
    const chain = h.state.chain.map((c) => c[0])
    expect(chain).toContain('range')
    expect(h.state.chain).toContainEqual(['from', 'workshop_status_records'])
    expect(h.state.chain).toContainEqual(['eq', 'country', 'KSA'])
    expect(h.state.chain).toContainEqual(['eq', 'current_active', true])
    expect(h.state.chain).toContainEqual(['is', 'deleted_at', null])
    expect(h.state.chain).toContainEqual(['order', 'asset_no', { ascending: true }])
    expect(h.state.chain).toContainEqual(['order', 'id', { ascending: true }])
  })

  it('listActiveRecords throws a ServiceError on failure', async () => {
    h.state.query = () => ({ data: null, error: { code: '42501', message: 'permission denied for table workshop_status_records' } })
    await expect(api.listActiveRecords({ country: 'KSA' })).rejects.toMatchObject({ name: 'ServiceError', code: '42501' })
  })

  it('findPreviousUploadByHash prefers a confirmed upload and returns null without a hash', async () => {
    expect(await api.findPreviousUploadByHash({ fileHash: '' })).toBeNull()
    h.state.query = () => ({
      data: [
        { id: 'p', upload_no: 9, uploaded_at: 't2', uploaded_by_name: 'A', status: 'previewed' },
        { id: 'c', upload_no: 8, uploaded_at: 't1', uploaded_by_name: 'B', status: 'confirmed' },
      ], error: null,
    })
    expect(await api.findPreviousUploadByHash({ fileHash: 'abc', country: 'KSA' }))
      .toEqual({ id: 'c', upload_no: 8, uploaded_at: 't1', uploaded_by_name: 'B', status: 'confirmed' })
  })
})
