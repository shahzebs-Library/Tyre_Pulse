import { describe, it, expect } from 'vitest'
import {
  pmDueStatus, daysToDue, summarizePmPrograms, DUE_SOON_DAYS,
} from '../lib/pmPrograms'

// Fixed reference clock so tests are deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()

describe('pmPrograms — daysToDue', () => {
  it('returns whole days until next_due, negative when past, null when absent', () => {
    expect(daysToDue({ next_due: '2026-07-22' }, NOW)).toBe(10)
    expect(daysToDue({ next_due: '2026-07-02' }, NOW)).toBe(-10)
    expect(daysToDue({ next_due: '2026-07-12' }, NOW)).toBe(0)
    expect(daysToDue({ next_due: null }, NOW)).toBeNull()
    expect(daysToDue({}, NOW)).toBeNull()
  })

  it('accepts a Date instance for now', () => {
    expect(daysToDue({ next_due: '2026-07-22' }, new Date(NOW))).toBe(10)
  })
})

describe('pmPrograms — pmDueStatus', () => {
  it('marks a program with no next_due as none', () => {
    expect(pmDueStatus({ next_due: null }, NOW)).toBe('none')
    expect(pmDueStatus({}, NOW)).toBe('none')
  })

  it('marks a next_due in the past as overdue', () => {
    expect(pmDueStatus({ next_due: '2026-07-11' }, NOW)).toBe('overdue')
    expect(pmDueStatus({ next_due: '2020-01-01' }, NOW)).toBe('overdue')
  })

  it('marks next_due within the due-soon window (0..14d inclusive) as due_soon', () => {
    expect(pmDueStatus({ next_due: '2026-07-12' }, NOW)).toBe('due_soon') // today (0d)
    expect(pmDueStatus({ next_due: '2026-07-20' }, NOW)).toBe('due_soon') // 8d
    expect(pmDueStatus({ next_due: '2026-07-26' }, NOW)).toBe('due_soon') // 14d boundary
  })

  it('marks next_due beyond the due-soon window as scheduled', () => {
    expect(pmDueStatus({ next_due: '2026-07-27' }, NOW)).toBe('scheduled') // 15d
    expect(pmDueStatus({ next_due: '2027-01-01' }, NOW)).toBe('scheduled')
  })

  it('uses a 14-day due-soon window', () => {
    expect(DUE_SOON_DAYS).toBe(14)
  })
})

describe('pmPrograms — summarizePmPrograms', () => {
  const rows = [
    { id: '1', status: 'active', next_due: '2026-07-01' },   // active, overdue (-11d)
    { id: '2', status: 'active', next_due: '2026-07-20' },   // active, due_soon (8d)
    { id: '3', status: 'active', next_due: '2027-01-01' },   // active, scheduled
    { id: '4', status: 'active', next_due: null },           // active, none
    { id: '5', status: 'paused', next_due: '2026-07-01' },   // paused (ignored for due signals)
    { id: '6', status: 'completed', next_due: '2026-07-05' },// completed (ignored)
    { id: '7', status: 'active', next_due: '2026-07-13' },   // active, due_soon (1d)
  ]

  it('counts by lifecycle status', () => {
    const s = summarizePmPrograms(rows, NOW)
    expect(s.total).toBe(7)
    expect(s.byStatus).toEqual({ active: 5, paused: 1, completed: 1 })
  })

  it('counts overdue + due-soon only among ACTIVE programs', () => {
    const s = summarizePmPrograms(rows, NOW)
    expect(s.overdue).toBe(1)   // id 1 only — paused id5 does not count
    expect(s.dueSoon).toBe(2)   // id 2 and id 7
  })

  it('lists overdue + due-soon active programs sorted soonest-first', () => {
    const s = summarizePmPrograms(rows, NOW)
    // overdue id1 (-11d), due_soon id7 (1d), due_soon id2 (8d)
    expect(s.dueList.map((r) => r.id)).toEqual(['1', '7', '2'])
    expect(s.dueList.every((r) => r.dueStatus === 'overdue' || r.dueStatus === 'due_soon')).toBe(true)
    expect(s.dueList[0].daysToDue).toBeLessThan(0)
  })

  it('excludes non-active programs from the due list even when their date is overdue', () => {
    const s = summarizePmPrograms(rows, NOW)
    expect(s.dueList.some((r) => r.id === '5' || r.id === '6')).toBe(false)
  })

  it('handles empty / non-array input safely', () => {
    const s = summarizePmPrograms([], NOW)
    expect(s.total).toBe(0)
    expect(s.overdue).toBe(0)
    expect(s.dueSoon).toBe(0)
    expect(s.dueList).toEqual([])
    const s2 = summarizePmPrograms(null, NOW)
    expect(s2.total).toBe(0)
  })
})
