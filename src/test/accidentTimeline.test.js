import { describe, it, expect } from 'vitest'
import {
  buildCaseTimeline, statusLabel, normalizeStatus, STATUS_LABELS,
} from '../lib/accidentTimeline'

const NOW = new Date('2026-07-14T12:00:00Z')

// Raw audit-row shape (full-row JSONB snapshots, as the trigger writes them).
const raw = (at, from, to) => ({
  changed_at: at, action: 'status_change',
  old_values: { status: from }, new_values: { status: to },
})
// Lean API projection shape (old_values->>status / new_values->>status).
const lean = (at, from, to) => ({
  changed_at: at, action: 'status_change', old_status: from, new_status: to,
})

describe('buildCaseTimeline', () => {
  it('with no audit rows returns a single honest current step from incident_date to now', () => {
    const steps = buildCaseTimeline(
      { status: 'under_review', incident_date: '2026-07-04' }, [], NOW,
    )
    expect(steps).toHaveLength(1)
    expect(steps[0].step).toBe('under_review')
    expect(steps[0].label).toBe('Under Investigation')
    expect(steps[0].current).toBe(true)
    expect(steps[0].days).toBe(10)
  })

  it('with no audit rows on a closed case ends at release_date and is not current', () => {
    const steps = buildCaseTimeline(
      { status: 'closed', incident_date: '2026-06-01', release_date: '2026-06-21' }, [], NOW,
    )
    expect(steps).toHaveLength(1)
    expect(steps[0].step).toBe('closed')
    expect(steps[0].current).toBe(false)
    expect(steps[0].days).toBe(20)
  })

  it('one transition splits the timeline into two steps (first from incident_date)', () => {
    const acc = { status: 'under_review', incident_date: '2026-07-01' }
    const steps = buildCaseTimeline(acc, [raw('2026-07-05T00:00:00Z', 'reported', 'under_review')], NOW)
    expect(steps.map(s => s.step)).toEqual(['reported', 'under_review'])
    expect(steps[0]).toMatchObject({ days: 4, current: false })
    expect(steps[1].current).toBe(true)
    expect(steps[1].days).toBe(9) // 5 Jul → 14 Jul
  })

  it('walks a full chain and terminates at the closing transition without a current step', () => {
    const acc = { status: 'closed', incident_date: '2026-06-01' }
    const steps = buildCaseTimeline(acc, [
      raw('2026-06-03T00:00:00Z', 'reported', 'under_review'),
      raw('2026-06-10T00:00:00Z', 'under_review', 'repair_in_progress'),
      raw('2026-06-20T00:00:00Z', 'repair_in_progress', 'closed'),
    ], NOW)
    expect(steps.map(s => s.step)).toEqual(['reported', 'under_review', 'repair_in_progress', 'closed'])
    expect(steps.map(s => s.days)).toEqual([2, 7, 10, 0])
    expect(steps.every(s => s.current === false)).toBe(true)
  })

  it('extends the closed terminal step to release_date when it falls after the closure', () => {
    const acc = { status: 'closed', incident_date: '2026-06-01', release_date: '2026-06-25' }
    const steps = buildCaseTimeline(acc, [raw('2026-06-20T00:00:00Z', 'reported', 'closed')], NOW)
    const closed = steps[steps.length - 1]
    expect(closed.step).toBe('closed')
    expect(closed.days).toBe(5)
    expect(closed.current).toBe(false)
  })

  it('never fabricates intermediate steps — only recorded transitions create boundaries', () => {
    const acc = { status: 'insurance_claim', incident_date: '2026-07-01' }
    // Jumped straight from reported to insurance_claim: exactly 2 steps.
    const steps = buildCaseTimeline(acc, [raw('2026-07-10T00:00:00Z', 'reported', 'insurance_claim')], NOW)
    expect(steps.map(s => s.step)).toEqual(['reported', 'insurance_claim'])
  })

  it('accepts the lean API projection shape (old_status/new_status aliases)', () => {
    const acc = { status: 'awaiting_parts', incident_date: '2026-07-02' }
    const steps = buildCaseTimeline(acc, [lean('2026-07-06T00:00:00Z', 'reported', 'awaiting_parts')], NOW)
    expect(steps.map(s => s.step)).toEqual(['reported', 'awaiting_parts'])
    expect(steps[1]).toMatchObject({ label: 'Awaiting Parts', current: true, days: 8 })
  })

  it('ignores non-status audit rows and no-op transitions', () => {
    const acc = { status: 'under_review', incident_date: '2026-07-01' }
    const steps = buildCaseTimeline(acc, [
      { changed_at: '2026-07-03T00:00:00Z', action: 'field_update', old_values: { status: 'reported' }, new_values: { status: 'reported' } },
      raw('2026-07-04T00:00:00Z', 'under_review', 'under_review'), // no-op
      raw('2026-07-05T00:00:00Z', 'reported', 'under_review'),
    ], NOW)
    expect(steps.map(s => s.step)).toEqual(['reported', 'under_review'])
  })

  it('sorts out-of-order rows by changed_at before building steps', () => {
    const acc = { status: 'closed', incident_date: '2026-06-01' }
    const steps = buildCaseTimeline(acc, [
      raw('2026-06-20T00:00:00Z', 'repair_in_progress', 'closed'),
      raw('2026-06-05T00:00:00Z', 'reported', 'repair_in_progress'),
    ], NOW)
    expect(steps.map(s => s.step)).toEqual(['reported', 'repair_in_progress', 'closed'])
    expect(steps.map(s => s.days)).toEqual([4, 15, 0])
  })

  it('clamps durations to >= 0 when the incident date post-dates the first transition', () => {
    const acc = { status: 'under_review', incident_date: '2026-07-10' }
    const steps = buildCaseTimeline(acc, [raw('2026-07-05T00:00:00Z', 'reported', 'under_review')], NOW)
    expect(steps[0].days).toBe(0)
    expect(steps.every(s => s.days >= 0)).toBe(true)
  })

  it('falls back to created_at when incident_date is missing, and to defaults on empty input', () => {
    const steps = buildCaseTimeline({ status: '', created_at: '2026-07-11T00:00:00Z' }, [], NOW)
    expect(steps).toHaveLength(1)
    expect(steps[0].step).toBe('reported') // honest default = DB column default
    expect(steps[0].days).toBe(3)
    expect(buildCaseTimeline(null, [], NOW)).toEqual([])
  })

  it('statusLabel maps every canonical token and passes unknown values through', () => {
    expect(statusLabel('under_review')).toBe('Under Investigation')
    expect(statusLabel('Repair In Progress')).toBe('Repair In Progress')
    expect(statusLabel('insurance_claim')).toBe('Insurance Claim')
    expect(statusLabel('bespoke_stage')).toBe('bespoke_stage')
    expect(statusLabel('')).toBe('')
    expect(normalizeStatus(' Awaiting Parts ')).toBe('awaiting_parts')
    for (const k of ['reported', 'under_review', 'repair_in_progress', 'awaiting_parts', 'awaiting_approval', 'insurance_claim', 'closed']) {
      expect(STATUS_LABELS[k]).toBeTruthy()
    }
  })
})
