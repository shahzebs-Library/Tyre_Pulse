import { describe, it, expect, vi } from 'vitest'

// audit.js imports ./supabase at module scope — mock it so the pure helpers
// can be tested without a client. logAudit/insert paths are not exercised here
// (they are fire-and-forget network calls); only the pure builders are.
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getUser: vi.fn(async () => ({ data: { user: null } })) }, from: vi.fn(), rpc: vi.fn() },
}))

import { diffRecords, buildAuditPayload } from '../lib/audit'

const ACTOR = { id: 'u-1', email: 'a@b.c', role: 'Admin', site: 'RUH' }

describe('diffRecords', () => {
  it('returns only changed fields with from/to', () => {
    const d = diffRecords(
      { status: 'Open', priority: 'Low', site: 'RUH' },
      { status: 'Closed', priority: 'Low', site: 'RUH' },
    )
    expect(d).toEqual({ status: { from: 'Open', to: 'Closed' } })
  })

  it('ignores fields the patch does not mention (undefined in after)', () => {
    const d = diffRecords({ a: 1, b: 2 }, { a: 5 })
    expect(d).toEqual({ a: { from: 1, to: 5 } })
  })

  it('treats new fields as from: null', () => {
    expect(diffRecords({}, { notes: 'hi' })).toEqual({ notes: { from: null, to: 'hi' } })
  })

  it('does not report undefined→null as a change', () => {
    expect(diffRecords({}, { notes: null })).toEqual({})
  })

  it('compares objects/arrays structurally', () => {
    expect(diffRecords({ parts: [{ p: 1 }] }, { parts: [{ p: 1 }] })).toEqual({})
    expect(diffRecords({ parts: [{ p: 1 }] }, { parts: [{ p: 2 }] }))
      .toEqual({ parts: { from: [{ p: 1 }], to: [{ p: 2 }] } })
  })

  it('tolerates number/string representation drift from form inputs', () => {
    expect(diffRecords({ cost: 5000 }, { cost: '5000' })).toEqual({})
  })

  it('handles null/undefined inputs', () => {
    expect(diffRecords(null, undefined)).toEqual({})
    expect(diffRecords(undefined, { a: 1 })).toEqual({ a: { from: null, to: 1 } })
  })
})

describe('buildAuditPayload', () => {
  it('UPDATE records only changed fields in old/new_values', () => {
    const p = buildAuditPayload({
      action: 'UPDATE', entity: 'work_orders', entityId: 42,
      before: { status: 'Open', site: 'RUH' }, after: { status: 'Closed', site: 'RUH' },
    }, ACTOR)
    expect(p).toMatchObject({
      action: 'UPDATE', table_name: 'work_orders', record_id: '42',
      old_values: { status: 'Open' }, new_values: { status: 'Closed' },
      user_id: 'u-1', user_email: 'a@b.c', user_role: 'Admin', site: 'RUH',
    })
    expect(typeof p.session_id).toBe('string')
  })

  it('returns null for a no-op update (nothing to record)', () => {
    const rec = { status: 'Open' }
    expect(buildAuditPayload(
      { action: 'UPDATE', entity: 't', entityId: 1, before: rec, after: { ...rec } }, ACTOR,
    )).toBeNull()
  })

  it('CREATE stores the full record in new_values', () => {
    const after = { asset_no: 'A-1', status: 'Open' }
    const p = buildAuditPayload({ action: 'CREATE', entity: 'gate_passes', entityId: 'A-1|2026-07-07', after }, ACTOR)
    expect(p.old_values).toBeNull()
    expect(p.new_values).toEqual(after)
  })

  it('DELETE stores the full record in old_values', () => {
    const before = { id: 9, asset_no: 'A-1' }
    const p = buildAuditPayload({ action: 'DELETE', entity: 'work_orders', entityId: 9, before }, ACTOR)
    expect(p.old_values).toEqual(before)
    expect(p.new_values).toBeNull()
  })

  it('rides meta inside new_values._meta', () => {
    const p = buildAuditPayload(
      { action: 'DELETE', entity: 'work_orders', meta: { bulk: true, ids: [1, 2] } }, ACTOR,
    )
    expect(p.new_values._meta).toEqual({ bulk: true, ids: [1, 2] })
  })

  it('UPDATE without a before snapshot records the patch itself', () => {
    const p = buildAuditPayload(
      { action: 'UPDATE', entity: 'work_orders', entityId: 1, after: { status: 'Done' } }, ACTOR,
    )
    expect(p.new_values).toEqual({ status: 'Done' })
  })

  it('stringifies record ids and nulls missing actor fields', () => {
    const p = buildAuditPayload(
      { action: 'CREATE', entity: 't', entityId: 7, after: { a: 1 } }, { id: 'u-2' },
    )
    expect(p.record_id).toBe('7')
    expect(p.user_email).toBeNull()
    expect(p.user_role).toBeNull()
    expect(p.site).toBeNull()
  })
})
