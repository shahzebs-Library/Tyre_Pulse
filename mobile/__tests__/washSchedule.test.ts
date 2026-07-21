/**
 * Pure-logic tests for lib/washSchedule.ts (rolling wash-due derivation).
 * Deterministic: every call passes an explicit `now`.
 */
import {
  WASH_INTERVAL_DAYS,
  nextWashDue,
  washDueList,
  WashHistoryRecord,
} from '../lib/washSchedule'

const NOW = '2026-07-20'

describe('nextWashDue', () => {
  it('adds the default interval to the last wash date', () => {
    expect(nextWashDue('2026-07-10')).toBe('2026-07-17')
    expect(WASH_INTERVAL_DAYS).toBe(7)
  })

  it('honours an explicit positive interval', () => {
    expect(nextWashDue('2026-07-10', 14)).toBe('2026-07-24')
  })

  it('falls back to the default for a non-positive interval', () => {
    expect(nextWashDue('2026-07-10', 0)).toBe('2026-07-17')
    expect(nextWashDue('2026-07-10', -3)).toBe('2026-07-17')
  })

  it('returns null for an invalid date', () => {
    expect(nextWashDue(null)).toBeNull()
    expect(nextWashDue('nope')).toBeNull()
  })
})

describe('washDueList', () => {
  const records: WashHistoryRecord[] = [
    { asset_no: 'A', wash_date: '2026-07-05', site: 'NHC' }, // superseded by later A wash
    { asset_no: 'A', wash_date: '2026-07-13', site: 'NHC' }, // latest for A -> due 07-20, overdue 0
    { asset_no: 'B', wash_date: '2026-07-01', site: 'RED SEA' }, // due 07-08, overdue 12
    { asset_no: 'C', wash_date: '2026-07-19', site: 'NHC' }, // due 07-26, NOT yet due
    { asset_no: '', wash_date: '2026-07-01' }, // no asset -> skipped
    { asset_no: 'D', wash_date: 'bad-date' }, // unparseable -> skipped
  ]

  it('returns one entry per asset, latest wash wins, most overdue first', () => {
    const due = washDueList(records, { now: NOW })
    expect(due.map((d) => d.asset_no)).toEqual(['B', 'A'])

    const b = due[0]
    expect(b.last_wash_date).toBe('2026-07-01')
    expect(b.next_due_date).toBe('2026-07-08')
    expect(b.days_overdue).toBe(12)
    expect(b.site).toBe('RED SEA')

    const a = due[1]
    expect(a.last_wash_date).toBe('2026-07-13')
    expect(a.next_due_date).toBe('2026-07-20')
    expect(a.days_overdue).toBe(0) // due exactly today is included
  })

  it('excludes assets not yet due, and skips no-asset / bad-date rows', () => {
    const ids = washDueList(records, { now: NOW }).map((d) => d.asset_no)
    expect(ids).not.toContain('C') // future due date
    expect(ids).not.toContain('D') // unparseable date
    expect(ids).not.toContain('') // no asset
  })

  it('returns an empty array for empty or nullish input', () => {
    expect(washDueList([], { now: NOW })).toEqual([])
    expect(washDueList(null, { now: NOW })).toEqual([])
    expect(washDueList(undefined, { now: NOW })).toEqual([])
  })
})
