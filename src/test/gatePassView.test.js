import { describe, it, expect } from 'vitest'
import {
  direction, viewStatus, gateKpis, tabCounts, filterGatePasses, timeline, passRef, initials,
  newPassCustomData, validateNewPass, gateExportRows, shiftRange, isOverstay,
} from '../lib/gatePassView'

const NOW = Date.parse('2026-09-29T12:00:00Z')
const legacyCleared = { id: 'aaaaaaaa-1111-2222-3333-444444444444', status: 'Cleared', pass_date: '2026-09-29', created_at: '2026-09-29T08:00:00Z', cleared_at: '2026-09-29T08:05:00Z', cleared_by: 'u1', asset_no: 'TM1' }
const legacyDenied = { id: 'b2', status: 'Denied', pass_date: '2026-09-29', created_at: '2026-09-29T09:00:00Z', denial_reason: 'No inspection' }
const inYard = { id: 'c3', status: 'Checked in', created_at: '2026-09-29T07:00:00Z', custom_data: { direction: 'inward', checked_in_at: '2026-09-29T07:00:00Z', expected_out_at: '2026-09-29T18:00:00Z', driver_name: 'Ali Khan' } }
const overstay = { id: 'd4', status: 'Checked in', created_at: '2026-09-29T06:00:00Z', custom_data: { direction: 'inward', checked_in_at: '2026-09-29T06:00:00Z', expected_out_at: '2026-09-29T10:00:00Z' } }
const noExpected = { id: 'e5', status: 'Checked in', custom_data: { direction: 'inward', checked_in_at: '2026-09-28T06:00:00Z' } }
const pendingIn = { id: 'f6', status: 'Pending', custom_data: { direction: 'inward', pre_approval: true } }
const outIn = { id: 'g7', status: 'Checked out', custom_data: { direction: 'inward', checked_in_at: '2026-09-29T05:00:00Z', checked_out_at: '2026-09-29T09:00:00Z' } }
const all = [legacyCleared, legacyDenied, inYard, overstay, noExpected, pendingIn, outIn]

describe('gatePassView', () => {
  it('reads legacy rows as outward and maps statuses', () => {
    expect(direction(legacyCleared)).toBe('outward')
    expect(viewStatus(legacyCleared, NOW)).toBe('checked_out')
    expect(viewStatus(legacyDenied, NOW)).toBe('rejected')
    expect(viewStatus(inYard, NOW)).toBe('in_yard')
    expect(viewStatus(overstay, NOW)).toBe('overstay')
    expect(viewStatus(pendingIn, NOW)).toBe('pending')
    expect(viewStatus(outIn, NOW)).toBe('checked_out')
  })

  it('never counts a pass with no expected out time as overstay', () => {
    expect(isOverstay(noExpected, NOW)).toBe(false)
    expect(viewStatus(noExpected, NOW)).toBe('in_yard')
  })

  it('tallies KPIs and tab counts', () => {
    expect(gateKpis(all, NOW)).toEqual({ total: 7, checkedIn: 4, checkedOut: 2, inYard: 3, overstay: 1, rejected: 1, pending: 1 })
    const c = tabCounts(all, NOW)
    expect(c).toMatchObject({ all: 7, inward: 5, outward: 2, in_yard: 3, overstay: 1, rejected: 1 })
  })

  it('filters by tab, search and pending-only', () => {
    expect(filterGatePasses(all, { tab: 'overstay' }, NOW).map((p) => p.id)).toEqual(['d4'])
    expect(filterGatePasses(all, { search: 'ali' }, NOW).map((p) => p.id)).toEqual(['c3'])
    expect(filterGatePasses(all, { pendingOnly: true }, NOW).map((p) => p.id)).toEqual(['f6'])
  })

  it('builds timelines only from recorded times', () => {
    const t = timeline(legacyCleared, { u1: 'Gate Officer' })
    expect(t.map((s) => s.state)).toEqual(['done', 'done', 'skipped', 'skipped', 'done'])
    expect(t[1].by).toBe('Gate Officer')
    const y = timeline(inYard)
    expect(y.find((s) => s.key === 'approved').state).toBe('skipped')
    expect(y.find((s) => s.key === 'checked_out').state).toBe('todo')
    const d = timeline(legacyDenied)
    expect(d[1].label).toBe('Rejected')
    expect(d.slice(2).every((s) => s.state === 'skipped')).toBe(true)
  })

  it('derives refs, initials and export rows', () => {
    expect(passRef(legacyCleared)).toBe('GP-2026-AAAAAAAA')
    expect(initials('Ali Khan')).toBe('AK')
    expect(initials('')).toBe('?')
    expect(gateExportRows([inYard], NOW)[0]).toMatchObject({ type: 'Inward', status: 'In yard', driver: 'Ali Khan' })
  })

  it('stamps a check-in only for an inward pass without pre-approval, and validates', () => {
    expect(newPassCustomData({ direction: 'inward' }, { userId: 'u', nowIso: 'T' }).checked_in_at).toBe('T')
    expect(newPassCustomData({ direction: 'inward', preApproval: true }, { nowIso: 'T' }).checked_in_at).toBeUndefined()
    expect(validateNewPass({ direction: 'inward', assetNo: 'A' })).toMatch(/driver/)
    expect(validateNewPass({ direction: 'outward', assetNo: 'A', expectedIn: '2026-09-29T10:00', expectedOut: '2026-09-29T09:00' })).toMatch(/after/)
    expect(validateNewPass({ direction: 'outward', assetNo: 'A' })).toBe('')
  })

  it('shifts a date range by its own length', () => {
    expect(shiftRange('2026-09-23', '2026-09-29', -1)).toEqual({ from: '2026-09-16', to: '2026-09-22' })
    expect(shiftRange('2026-09-29', '2026-09-29', 1)).toEqual({ from: '2026-09-30', to: '2026-09-30' })
  })
})
