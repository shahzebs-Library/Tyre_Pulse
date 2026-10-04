import { describe, it, expect } from 'vitest'
import {
  deviceSummary, filterDevices, deleteOrgRefusal, canOfferOrgDelete, deletionAgeing, severityChangeError, daysSince, deviceTail,
} from '../lib/consolePeopleControls'

const NOW = Date.parse('2026-10-04T12:00:00Z')
const ago = (d) => new Date(NOW - d * 86400000).toISOString()

describe('consolePeopleControls', () => {
  const rows = [
    { id: 'a', user_id: 'u1', app: 'flutter', revoked: false, app_version: '0.1.1', last_seen_at: ago(1) },
    { id: 'b', user_id: 'u1', app: 'retired_expo', revoked: false, last_seen_at: ago(40) },
    { id: 'c', user_id: 'u2', app: 'retired_expo', revoked: true, last_seen_at: ago(2) },
    { id: 'd', user_id: 'u3', app: 'flutter', revoked: false, app_version: null, last_seen_at: null, full_name: 'Sara' },
  ]
  it('summarises Flutter vs retired phones honestly', () => {
    const s = deviceSummary(rows, NOW)
    expect(s.total).toBe(4)
    expect(s.flutterActive).toBe(2)
    expect(s.flutterPeople).toBe(2)
    expect(s.retiredActive).toBe(1)
    expect(s.stopped).toBe(1)
    expect(s.idle).toBe(1)
    expect(s.versions).toEqual({ '0.1.1': 1, 'Not reported': 1 })
  })
  it('filters by app, state and search', () => {
    expect(filterDevices(rows, { app: 'flutter' }, NOW).map((r) => r.id)).toEqual(['a', 'd'])
    expect(filterDevices(rows, { state: 'stopped' }, NOW).map((r) => r.id)).toEqual(['c'])
    expect(filterDevices(rows, { state: 'idle' }, NOW).map((r) => r.id)).toEqual(['b'])
    expect(filterDevices(rows, { search: 'sara' }, NOW).map((r) => r.id)).toEqual(['d'])
  })
  it('only offers org delete when every count is known and zero', () => {
    const empty = { members: 0, vehicles: 0, tyre_records: 0, job_cards: 0, expense_lines: 0, inspections: 0 }
    expect(canOfferOrgDelete(empty).ok).toBe(true)
    expect(canOfferOrgDelete(null).ok).toBe(false)
    expect(canOfferOrgDelete({ ...empty, members: 2 }).ok).toBe(false)
    expect(canOfferOrgDelete({ ...empty, tyre_records: 5 }).reason).toMatch(/5 records/)
    expect(canOfferOrgDelete({ ...empty, inspections: undefined }).ok).toBe(false)
  })
  it('explains delete refusals in plain English', () => {
    expect(deleteOrgRefusal({ reason: 'has_members' })).toMatch(/members/)
    expect(deleteOrgRefusal({ reason: 'has_records', table: 'tyre_records' })).toMatch(/tyre records/)
    expect(deleteOrgRefusal({})).toMatch(/could not/)
  })
  it('ages deletion requests and returns null when nothing is measurable', () => {
    expect(deletionAgeing([], 30, NOW)).toEqual({ open: 0, oldest: null, breaching: 0, medianTurnaround: null })
    const a = deletionAgeing([
      { status: 'pending', requested_at: ago(40) },
      { status: 'processing', requested_at: ago(5) },
      { status: 'completed', requested_at: ago(10), processed_at: ago(8) },
      { status: 'rejected', requested_at: ago(10), processed_at: ago(6) },
    ], 30, NOW)
    expect(a).toEqual({ open: 2, oldest: 40, breaching: 1, medianTurnaround: 3 })
  })
  it('validates a severity re-grade like the server', () => {
    expect(severityChangeError({ from: 'sev3', to: 'sev1', reason: 'customers down', status: 'identified' })).toBeNull()
    expect(severityChangeError({ from: 'sev3', to: 'sev3', reason: 'customers down' })).toMatch(/different/)
    expect(severityChangeError({ from: 'sev3', to: 'sev1', reason: 'no' })).toMatch(/5 characters/)
    expect(severityChangeError({ from: 'sev3', to: 'sev1', reason: 'long enough', status: 'resolved' })).toMatch(/resolved/)
  })
  it('handles missing dates and device ids', () => {
    expect(daysSince(null, NOW)).toBeNull()
    expect(deviceTail('')).toBeNull()
    expect(deviceTail('ab12')).toBe('...ab12')
  })
})
