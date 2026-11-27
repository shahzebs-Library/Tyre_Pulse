import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  INTAKE_ACTION_KEYS, JOB_OUTCOMES, PRIORITIES, INTAKE_SOURCES, CONFIRM_STATUSES, RELEASE_DISPOSITIONS, ANOMALY_KINDS,
  resolveIntakePermissions, parsePastedTable, headerKey, validateRow, toPayload, batches, mergeIngestResults,
  mergePolled, cursorOf, isWaitingFor, canConfirm, inShift, reasonOk, groupIntake, assetKey, isSendable,
} from '../lib/workshopStatus/intake'

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261128090000_workshop_intake.sql'), 'utf8')
const ERP = readFileSync(join(process.cwd(), 'supabase/migrations/20261128091000_workshop_intake_erp.sql'), 'utf8')
const quoted = (s) => [...s.matchAll(/'([a-z_A-Z ]+)'/g)].map((m) => m[1])
const sqlList = (re) => { const m = SQL.match(re); if (!m) throw new Error(`not found: ${re}`); return quoted(m[1]) }

describe('mirror of the migration', () => {
  it('intake actions are in workshop_status_can and my_permissions', () => {
    for (const a of INTAKE_ACTION_KEYS) expect(SQL.match(new RegExp(`'${a}'`, 'g')).length).toBeGreaterThanOrEqual(2)
  })
  it('vocabularies equal the CHECK constraints', () => {
    expect(sqlList(/intake_source in \(([^)]*)\)/)).toEqual([...INTAKE_SOURCES])
    expect(sqlList(/confirm_status in \(([^)]*)\)/)).toEqual([...CONFIRM_STATUSES])
    expect(sqlList(/job_outcome in\s*\(([^)]*)\)/)).toEqual([...JOB_OUTCOMES])
    expect(sqlList(/priority in \(([^)]*)\)\)/)).toEqual([...PRIORITIES])
  })
  it('release dispositions equal the release RPC list', () => {
    expect(sqlList(/v_d not in \(([^)]*)\)/)).toEqual([...RELEASE_DISPOSITIONS])
  })
  it('every anomaly kind is produced by workshop_intake_anomalies', () => {
    for (const k of ANOMALY_KINDS) expect(SQL).toContain(`'${k}'`)
  })
  it('has STATUS, VERIFY and ROLLBACK headers and no top-level DROP TABLE / DELETE', () => {
    for (const s of [SQL, ERP]) {
      expect(s).toMatch(/STATUS: AUTHORED, NOT APPLIED/)
      expect(s).toMatch(/ROLLBACK/)
      expect(s).not.toMatch(/^\s*(drop table|delete from)/im)
    }
    expect(SQL).toMatch(/VERIFY/)
  })
  it('self-confirm is refused in the database trigger, not only the UI', () => {
    expect(SQL).toMatch(/v_uid = coalesce\(OLD\.submitted_by, OLD\.first_seen_by\)/)
  })
  it('only Excel rows are released by a missing file', () => {
    expect(SQL).toMatch(/coalesce\(intake_source, ''excel_upload''\) = ''excel_upload''/)
  })
  it('the ERP patch never renames a number and keeps the web status unless final', () => {
    expect(ERP).not.toMatch(/set work_order_no/i)
    expect(ERP).toMatch(/not in \(''Completed'', ''Closed'', ''Cancelled''\)/)
  })
})

describe('permissions', () => {
  it('fails closed', () => {
    expect(resolveIntakePermissions(null)).toEqual({ intake: false, intake_confirm: false, roster: false })
    expect(resolveIntakePermissions({ intake: true, intake_confirm: 'true', other: true })).toEqual({ intake: true, intake_confirm: false, roster: false })
  })
})

describe('paste and validation', () => {
  it('maps a header row by name, in any language', () => {
    const r = parsePastedTable('Asset code\tComplaint\tPriority\nTM 701\tBrake noise\thigh\n\n')
    expect(r.header).toBe(true)
    expect(r.rows).toEqual([{ asset_no: 'TM 701', complaint: 'Brake noise', priority: 'high' }])
    expect(headerKey('رقم الأصل')).toBe('asset_no')
  })
  it('without a header fills columns from the pasted cell', () => {
    const r = parsePastedTable('TM1\tNHC\nTM2\tJED', { startKey: 'asset_no' })
    expect(r.rows).toEqual([{ asset_no: 'TM1', site: 'NHC' }, { asset_no: 'TM2', site: 'JED' }])
  })
  it('flags unknown, listed and future rows', () => {
    const fleet = { has: (k) => k === 'TM1' || k === 'TM2' }
    const listed = new Map([['TM2', { id: 'x' }]])
    const now = new Date('2026-11-28T10:00:00Z')
    expect(validateRow({ asset_no: 'tm 1' }, { fleet, listed, now })).toEqual({})
    expect(validateRow({ asset_no: 'TM9' }, { fleet, listed, now }).asset_no).toBe('assetUnknown')
    expect(validateRow({ asset_no: 'TM2' }, { fleet, listed, now }).asset_no).toBe('alreadyListed')
    expect(validateRow({ asset_no: 'TM1', production_out_at: '2026-11-29T10:00:00Z' }, { fleet, now }).production_out_at).toBe('futureDate')
    expect(validateRow({ asset_no: 'TM1', priority: 'urgent' }, { fleet, now }).priority).toBe('badPriority')
    expect(isSendable({ asset_no: '' }, {})).toBe(false)
    expect(assetKey(' tm 70 1')).toBe('TM701')
  })
  it('builds the payload with ISO times and a client time', () => {
    const now = new Date('2026-11-28T10:00:00Z')
    const [p] = toPayload([{ source_key: 'a', asset_no: 'TM1', priority: 'high', production_out_at: '2026-11-28T08:00:00Z', site: '' }], { now })
    expect(p).toEqual({ source_key: 'a', asset_no: 'TM1', priority: 'High', production_out_at: '2026-11-28T08:00:00.000Z', client_entered_at: now.toISOString() })
  })
  it('batches at 200 and merges results', () => {
    expect(batches(Array.from({ length: 450 }, (_, i) => i)).map((b) => b.length)).toEqual([200, 200, 50])
    const m = mergeIngestResults([{ new: 1, unchanged: 2, rows: [{ a: 1 }] }, { new: 2, invalid: 1, rows: [{ b: 2 }] }])
    expect(m.new).toBe(3); expect(m.unchanged).toBe(2); expect(m.invalid).toBe(1); expect(m.rows).toHaveLength(2)
  })
})

describe('polling, routing and confirm rules', () => {
  it('merges a poll page by id and drops released rows', () => {
    const cur = [{ id: 1, updated_at: 'a', current_active: true }, { id: 2, updated_at: 'a', current_active: true }]
    const next = mergePolled(cur, [{ id: 1, updated_at: 'b', current_active: false }, { id: 3, updated_at: 'c', current_active: true }])
    expect(next.map((r) => r.id).sort()).toEqual([2, 3])
    expect(cursorOf(next, 'a')).toBe('c')
  })
  it('night shift crosses midnight, like the SQL', () => {
    expect(inShift('23:00', '18:00', '06:00')).toBe(true)
    expect(inShift('05:59', '18:00', '06:00')).toBe(true)
    expect(inShift('06:00', '18:00', '06:00')).toBe(false)
    expect(inShift('10:00', '06:00', '18:00')).toBe(true)
    expect(inShift('10:00', '', '')).toBe(true)
  })
  it('nobody confirms their own entry', () => {
    const r = { current_active: true, confirm_status: 'pending_confirm', routed_to: ['me'], submitted_by: 'me' }
    expect(isWaitingFor(r, 'me')).toBe(true)
    expect(canConfirm(r, 'me')).toBe(false)
    expect(canConfirm({ ...r, submitted_by: 'other' }, 'me')).toBe(true)
    expect(canConfirm({ ...r, routed_to: ['x'], submitted_by: 'other' }, 'me')).toBe(false)
    expect(canConfirm({ ...r, routed_to: ['x'], submitted_by: 'other' }, 'me', { override: true })).toBe(true)
  })
  it('groups the list and checks reasons', () => {
    const g = groupIntake([
      { id: 1, current_active: true, confirm_status: 'pending_confirm', routed_to: ['me'] },
      { id: 2, current_active: true, confirm_status: 'pending_confirm', routed_to: ['x'] },
      { id: 3, current_active: true, confirm_status: 'returned' },
      { id: 4, current_active: true, confirm_status: 'confirmed', intake_source: 'sheet' },
      { id: 5, current_active: true, confirm_status: 'confirmed', intake_source: 'excel_upload' },
      { id: 6, current_active: false, confirm_status: 'pending_confirm' },
    ], 'me')
    expect([g.waiting, g.pending, g.returned, g.confirmed].map((x) => x.map((r) => r.id))).toEqual([[1], [2], [3], [4]])
    expect(reasonOk('abcd')).toBe(false); expect(reasonOk('abcde')).toBe(true)
  })
})
