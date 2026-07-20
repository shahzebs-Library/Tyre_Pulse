/**
 * Pure-logic tests for lib/schedule.ts (day-grouped agenda helpers).
 * Deterministic: every call passes an explicit `now`, never Date.now().
 */
import {
  daysUntil,
  bucketFor,
  isOverdue,
  dayLabel,
  groupSchedule,
  summarize,
  parseScheduleDate,
  ScheduleItem,
} from '../lib/schedule'

// Fixed local reference day: Monday 20 Jul 2026, midday.
const NOW = new Date(2026, 6, 20, 12, 0, 0)

const item = (id: string, date: string): ScheduleItem => ({
  id,
  kind: 'inspection',
  title: id,
  date,
})

describe('parseScheduleDate', () => {
  it('parses a bare YYYY-MM-DD as a local calendar day', () => {
    const d = parseScheduleDate('2026-07-20')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(6)
    expect(d!.getDate()).toBe(20)
  })

  it('returns null for empty or unparseable input', () => {
    expect(parseScheduleDate(null)).toBeNull()
    expect(parseScheduleDate(undefined)).toBeNull()
    expect(parseScheduleDate('not-a-date')).toBeNull()
  })
})

describe('daysUntil', () => {
  it('is 0 for today, negative for past, positive for future', () => {
    expect(daysUntil('2026-07-20', NOW)).toBe(0)
    expect(daysUntil('2026-07-18', NOW)).toBe(-2)
    expect(daysUntil('2026-07-25', NOW)).toBe(5)
  })

  it('returns null when the date cannot be parsed', () => {
    expect(daysUntil(null, NOW)).toBeNull()
    expect(daysUntil('garbage', NOW)).toBeNull()
  })
})

describe('bucketFor', () => {
  it('buckets by distance from now', () => {
    expect(bucketFor('2026-07-19', NOW)).toBe('overdue')
    expect(bucketFor('2026-07-20', NOW)).toBe('today')
    expect(bucketFor('2026-07-24', NOW)).toBe('week') // within 7 days
    expect(bucketFor('2026-07-27', NOW)).toBe('week') // exactly 7 days
    expect(bucketFor('2026-07-28', NOW)).toBe('later') // 8 days
  })

  it('returns null for an unparseable date', () => {
    expect(bucketFor(undefined, NOW)).toBeNull()
  })
})

describe('isOverdue', () => {
  it('is true only for a past due date', () => {
    expect(isOverdue(item('a', '2026-07-10'), NOW)).toBe(true)
    expect(isOverdue(item('b', '2026-07-20'), NOW)).toBe(false)
    expect(isOverdue(item('c', '2026-08-01'), NOW)).toBe(false)
  })
})

describe('dayLabel', () => {
  it('renders relative labels in plain ASCII', () => {
    expect(dayLabel('2026-07-20', NOW)).toBe('Today')
    expect(dayLabel('2026-07-21', NOW)).toBe('Tomorrow')
    expect(dayLabel('2026-07-19', NOW)).toBe('Yesterday')
    expect(dayLabel('2026-07-17', NOW)).toBe('3 days ago')
    expect(dayLabel(null, NOW)).toBe('No date')
  })
})

describe('groupSchedule', () => {
  it('orders buckets, sorts within them, and drops empty buckets', () => {
    const items = [
      item('later', '2026-08-15'),
      item('overdue-1', '2026-07-10'),
      item('today', '2026-07-20'),
      item('overdue-2', '2026-07-05'),
      item('bad', 'nope'), // ignored, no guessing
    ]
    const groups = groupSchedule(items, NOW)
    // No "week" bucket present -> dropped.
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'today', 'later'])
    // Overdue sorted soonest-first (07-05 before 07-10).
    expect(groups[0].items.map((i) => i.id)).toEqual(['overdue-2', 'overdue-1'])
    // Unparseable row excluded everywhere.
    const allIds = groups.flatMap((g) => g.items.map((i) => i.id))
    expect(allIds).not.toContain('bad')
  })

  it('returns an empty array when nothing is schedulable', () => {
    expect(groupSchedule([], NOW)).toEqual([])
  })
})

describe('summarize', () => {
  it('counts overdue / today / week and total', () => {
    const items = [
      item('a', '2026-07-10'), // overdue
      item('b', '2026-07-20'), // today
      item('c', '2026-07-22'), // week
      item('d', '2026-09-01'), // later
      item('e', 'bad'),        // still counted in total
    ]
    expect(summarize(items, NOW)).toEqual({
      overdue: 1,
      today: 1,
      week: 1,
      total: 5,
    })
  })
})
