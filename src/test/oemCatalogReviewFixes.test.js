import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable PostgREST stand-in: every call is recorded; a builder resolves with the next queued
// response for its table (or { data: null, error: null }).
const state = vi.hoisted(() => ({ calls: [], queue: {} }))
vi.mock('../lib/api/_client', () => {
  const builder = (table) => {
    const call = { table, ops: [] }
    state.calls.push(call)
    const b = {}
    for (const op of ['select', 'insert', 'upsert', 'update', 'eq', 'in', 'order', 'range', 'limit', 'single']) {
      b[op] = (...args) => { call.ops.push([op, ...args]); return b }
    }
    b.then = (res, rej) => Promise.resolve((state.queue[table] || []).shift() || { data: null, error: null }).then(res, rej)
    return b
  }
  return {
    supabase: { from: builder, rpc: async (name) => (name === 'oem_catalog_admin' ? { data: true, error: null } : { data: null, error: null }) },
    isMissingRelation: () => false,
  }
})

import { isMissingSourceRowKey, publishApproved, REVIEW_PARTIAL, saveReviewItems } from '../lib/api/oemCatalogAdmin'
import { listOemManualEntries } from '../lib/api/oemPartsCatalog'

const writes = (table, op) => state.calls.filter((c) => c.table === table).flatMap((c) => c.ops.filter((o) => o[0] === op))
const rec = (row_order, part_no = 'B230101000123') => ({ figure_id: 'F2-14', source_pdf_page: 5, row_order, part_no, issues: [{ message: 'check' }], confidence: 0.4 })

beforeEach(() => { state.calls.length = 0; state.queue = {} })

describe('saveReviewItems keeps every source row', () => {
  it('keys the upsert on the source row so the same part twice on one page is two rows', async () => {
    expect(await saveReviewItems('m1', [rec(3), rec(7)])).toBe(2)
    const [[, rows, opts]] = writes('oem_review_items', 'upsert')
    expect(opts.onConflict).toBe('manual_id,pdf_page,row_order')
    expect(rows.map((r) => r.row_order)).toEqual([3, 7])
    expect(rows.map((r) => r.part_no)).toEqual(['B230101000123', 'B230101000123'])
  })

  it('falls back to plain inserts when the follow-up migration is not applied yet', async () => {
    state.queue.oem_review_items = [{ error: { code: 'PGRST204', message: "Could not find the 'row_order' column" } }, { error: null }]
    expect(await saveReviewItems('m1', [rec(3), rec(7, 'OTHER')])).toBe(2)
    const [[, rows]] = writes('oem_review_items', 'insert')
    expect(rows).toHaveLength(2)
    expect(rows[0]).not.toHaveProperty('row_order')
  })

  it('on the old key it saves what it can and reports the rows it could not queue', async () => {
    state.queue.oem_review_items = [
      { error: { code: '42P10', message: 'no unique or exclusion constraint matching the ON CONFLICT specification' } },
      { error: { code: '23505', message: 'duplicate key' } }, // batch insert
      { error: null }, // row 1
      { error: { code: '23505', message: 'duplicate key' } }, // row 2 repeats the part on its page
    ]
    const err = await saveReviewItems('m1', [rec(3), rec(7)]).catch((e) => e)
    expect(err.code).toBe(REVIEW_PARTIAL)
    expect(err.saved).toBe(1)
    expect(err.notQueued).toBe(1)
    expect(err.message).not.toMatch(/duplicate key|constraint/)
  })

  it('does not swallow unrelated errors', async () => {
    state.queue.oem_review_items = [{ error: { code: '42501', message: 'permission denied' } }]
    await expect(saveReviewItems('m1', [rec(1)])).rejects.toMatchObject({ code: '42501' })
  })

  it('recognises only the missing-key shapes as a fallback signal', () => {
    expect(isMissingSourceRowKey({ code: '42703', message: 'column row_order does not exist' })).toBe(true)
    expect(isMissingSourceRowKey({ code: '23505', message: 'duplicate key' })).toBe(false)
  })
})

describe('publishApproved', () => {
  it('copies the manual company, country and figure link onto every entry', async () => {
    state.queue.oem_parts_manuals = [{ data: { organisation_id: 'org-a', country: 'KSA' }, error: null }]
    state.queue.oem_review_items = [{ data: [{ id: 'r1', payload: { ...rec(3), description: 'Bolt' } }], error: null }]
    expect(await publishApproved('m1')).toBe(1)
    const [[, rows, opts]] = writes('oem_parts_entries', 'upsert')
    expect(opts.onConflict).toBe('manual_id,source_pdf_page,row_order')
    expect(rows[0]).toMatchObject({ organisation_id: 'org-a', country: 'KSA', figure_id: 'F2-14', row_order: 3 })
  })
})

describe('listOemManualEntries', () => {
  it('selects the saved figure link', async () => {
    state.queue.oem_parts_entries = [{ data: [{ id: 'e1', figure_id: 'F2-14' }], error: null }]
    const rows = await listOemManualEntries('m1')
    expect(rows[0].figure_id).toBe('F2-14')
    expect(writes('oem_parts_entries', 'select')[0][1]).toMatch(/figure_id/)
  })
  it('falls back to the base columns when figure_id is not installed', async () => {
    state.queue.oem_parts_entries = [{ data: null, error: { code: '42703', message: 'column oem_parts_entries.figure_id does not exist' } }, { data: [{ id: 'e1' }], error: null }]
    expect(await listOemManualEntries('m1')).toEqual([{ id: 'e1' }])
    expect(writes('oem_parts_entries', 'select')[1][1]).not.toMatch(/figure_id/)
  })
})
