import { describe, it, expect } from 'vitest'
import { latestManualUpdateByRecord, latestUpdateText } from '../lib/workshopStatus/latestUpdate'

describe('latest update for reports', () => {
  const events = [
    { id: 'a', record_id: 'r1', event_type: 'manual_update', created_at: '2026-10-06T08:00:00Z', actor_name: 'Old', details: { changed_fields: ['remarks'] } },
    { id: 'b', record_id: 'r1', event_type: 'manual_update', created_at: '2026-10-07T09:30:00Z', actor_name: 'Sajid', details: { changed_fields: ['current_stage', 'work_done', 'responsible_user_id', 'expected_release_date', 'blocker'] } },
    { id: 'c', record_id: 'r1', event_type: 'field_change', created_at: '2026-10-08T09:30:00Z' },
    { id: 'd', record_id: 'r2', event_type: 'manual_update', created_at: '2026-10-07T07:00:00Z', actor_name: null, details: {} },
  ]
  it('keeps only the newest manual update per record', () => {
    const m = latestManualUpdateByRecord(events)
    expect(m.get('r1').id).toBe('b')
    expect(m.get('r2').id).toBe('d')
    expect(m.size).toBe(2)
  })
  it('prints who, when and the values that save left', () => {
    const rec = { id: 'r1', current_stage: 'Waiting for Parts', work_done: ' Removed\n cover ', responsible_user_id: 'u1', expected_release_date: '2026-10-20', blocker: null }
    const text = latestUpdateText(rec, latestManualUpdateByRecord(events).get('r1'), {
      label: (f) => f, personName: (id) => (id === 'u1' ? 'Ahmed' : null), day: (v) => `D${v}`, stamp: () => 'T', cleared: '(cleared)',
    })
    expect(text).toBe('Sajid, T - current_stage: Waiting for Parts; work_done: Removed cover; responsible_user_id: Ahmed; expected_release_date: D2026-10-20; blocker: (cleared)')
  })
  it('null when never updated by hand; system actor fallback', () => {
    expect(latestUpdateText({ id: 'x' }, null, {})).toBeNull()
    expect(latestUpdateText({ id: 'r2' }, events[3], { system: 'System', stamp: () => 'T' })).toBe('System, T')
  })
})
