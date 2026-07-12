import { describe, it, expect } from 'vitest'
import {
  turnaroundDays, summarizeTechnicians, computeTotals, completionRating,
} from '../lib/technicianScorecard'

// Small deterministic fixture: 3 technicians, mixed statuses & dates.
const ORDERS = [
  // Alice — 3 jobs, 2 completed (2d and 4d turnaround), 1 open
  { id: 1, technician_name: 'Alice', status: 'Completed', total_cost: 100, created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-03T00:00:00Z' },
  { id: 2, technician_name: 'Alice', status: 'Completed', total_cost: 300, created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-05T00:00:00Z' },
  { id: 3, technician_name: 'Alice', status: 'In Progress', total_cost: 50 },
  // Bob — 2 jobs, 1 completed (10d), 1 cancelled
  { id: 4, technician_name: 'Bob', status: 'Completed', total_cost: 500, created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-11T00:00:00Z' },
  { id: 5, technician_name: 'Bob', status: 'Cancelled', total_cost: 0 },
  // Carol — 1 job, open, no dates
  { id: 6, technician_name: 'Carol', status: 'Open', total_cost: 20 },
  // Unassigned falls back to a bucket
  { id: 7, technician_name: '', status: 'Completed', total_cost: 80, created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-02T00:00:00Z' },
]

describe('turnaroundDays', () => {
  it('computes whole-day turnaround for completed jobs', () => {
    expect(turnaroundDays({ created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-03T00:00:00Z' })).toBe(2)
  })
  it('returns null when a date is missing or invalid', () => {
    expect(turnaroundDays({ created_at: '2026-01-01T00:00:00Z' })).toBeNull()
    expect(turnaroundDays({})).toBeNull()
    expect(turnaroundDays({ created_at: 'nope', completed_at: '2026-01-03T00:00:00Z' })).toBeNull()
  })
  it('returns null for negative (completed before created)', () => {
    expect(turnaroundDays({ created_at: '2026-01-05T00:00:00Z', completed_at: '2026-01-01T00:00:00Z' })).toBeNull()
  })
})

describe('summarizeTechnicians', () => {
  const { rows, totals } = summarizeTechnicians(ORDERS)
  const byName = Object.fromEntries(rows.map((r) => [r.technician, r]))

  it('groups by technician and counts status buckets', () => {
    expect(rows).toHaveLength(4) // Alice, Bob, Carol, Unassigned
    expect(byName.Alice).toMatchObject({ jobs: 3, completed: 2, open: 1, cancelled: 0 })
    expect(byName.Bob).toMatchObject({ jobs: 2, completed: 1, open: 0, cancelled: 1 })
    expect(byName.Carol).toMatchObject({ jobs: 1, completed: 0, open: 1 })
  })

  it('buckets blank technician names under "Unassigned"', () => {
    expect(byName.Unassigned).toBeDefined()
    expect(byName.Unassigned.jobs).toBe(1)
  })

  it('computes completion rate, avg turnaround (days) and cost metrics', () => {
    expect(byName.Alice.completionRate).toBe(66.7) // 2/3
    expect(byName.Alice.avgTurnaround).toBe(3)      // mean(2,4)
    expect(byName.Alice.totalCost).toBe(450)
    expect(byName.Alice.avgCostPerJob).toBe(150)    // 450/3
    expect(byName.Bob.avgTurnaround).toBe(10)
    expect(byName.Carol.avgTurnaround).toBeNull()   // no completed jobs
  })

  it('assigns a composite score and a contiguous 1-based rank ordered by score', () => {
    const ranks = rows.map((r) => r.rank)
    expect(ranks).toEqual([1, 2, 3, 4])
    for (const r of rows) expect(r.score).toBeGreaterThanOrEqual(0)
    // rows are returned pre-sorted by rank ascending
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score)
    }
  })

  it('rolls up fleet totals', () => {
    expect(totals.technicians).toBe(4)
    expect(totals.totalJobs).toBe(7)
    expect(totals.totalCompleted).toBe(4)
    expect(totals.totalOpen).toBe(2)
    expect(totals.totalCost).toBe(1050)
    expect(totals.avgCompletionRate).toBe(57.1) // 4/7
  })

  it('handles empty / non-array input safely', () => {
    expect(summarizeTechnicians([]).rows).toEqual([])
    expect(summarizeTechnicians(null).rows).toEqual([])
    expect(summarizeTechnicians(undefined).totals.technicians).toBe(0)
  })

  it('accepts the assigned_to alias as the technician key', () => {
    const { rows: r2 } = summarizeTechnicians([{ id: 1, assigned_to: 'Dave', status: 'Completed', total_cost: 10, created_at: '2026-01-01', completed_at: '2026-01-02' }])
    expect(r2[0].technician).toBe('Dave')
  })
})

describe('computeTotals', () => {
  it('returns zeros for empty input', () => {
    expect(computeTotals([])).toMatchObject({ technicians: 0, totalJobs: 0, avgCompletionRate: 0, avgTurnaround: null })
  })
})

describe('completionRating', () => {
  it('maps completion rate to a rating label', () => {
    expect(completionRating(96)).toBe('Excellent')
    expect(completionRating(88)).toBe('Good')
    expect(completionRating(72)).toBe('Average')
    expect(completionRating(50)).toBe('Needs Improvement')
  })
})
