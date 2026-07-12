/**
 * Onboarding Wizard — pure helper tests (V199). Exercises the real, I/O-free
 * roll-up logic consumed by the Onboarding Wizard page and service: completion
 * percentages, per-phase progress (order + pct), go-live readiness, the header
 * summary, and the "what's next" queue.
 */
import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  completionPct,
  requiredCompletionPct,
  phaseProgress,
  isReadyForGoLive,
  summariseOnboarding,
  nextTasks,
  PHASE_ORDER,
} from '../lib/onboarding'

const rows = [
  { id: 't1', phase: 'setup', title: 'Create account', sort_order: 1, required: true, status: 'completed' },
  { id: 't2', phase: 'setup', title: 'Verify email', sort_order: 2, required: true, status: 'completed' },
  { id: 't3', phase: 'data_import', title: 'Import vehicles', sort_order: 3, required: true, status: 'in_progress' },
  { id: 't4', phase: 'data_import', title: 'Import tyres', sort_order: 4, required: true, status: 'not_started' },
  { id: 't5', phase: 'configuration', title: 'Set thresholds', sort_order: 5, required: false, status: 'not_started' },
  { id: 't6', phase: 'team', title: 'Invite users', sort_order: 6, required: true, status: 'blocked' },
  { id: 't7', phase: 'integration', title: 'Connect ERP', sort_order: 7, required: false, status: 'skipped' },
  { id: 't8', phase: 'go_live', title: 'Go live', sort_order: 8, required: true, status: 'not_started' },
]

describe('toFiniteNumber', () => {
  it('coerces numeric strings and passes through numbers', () => {
    expect(toFiniteNumber('12')).toBe(12)
    expect(toFiniteNumber(7)).toBe(7)
    expect(toFiniteNumber('3.5')).toBe(3.5)
  })
  it('returns null for empty / non-numeric input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('completionPct', () => {
  it('returns the percentage of ALL tasks completed, rounded', () => {
    // 2 completed of 8 => 25%
    expect(completionPct(rows)).toBe(25)
  })
  it('is 0 for an empty checklist', () => {
    expect(completionPct([])).toBe(0)
    expect(completionPct(null)).toBe(0)
  })
  it('is 100 when every task is completed', () => {
    expect(completionPct([{ status: 'completed' }, { status: 'completed' }])).toBe(100)
  })
})

describe('requiredCompletionPct', () => {
  it('measures only required tasks', () => {
    // required tasks: t1,t2,t3,t4,t6,t8 (6); completed among them: t1,t2 (2) => 33%
    expect(requiredCompletionPct(rows)).toBe(33)
  })
  it('ignores optional tasks entirely', () => {
    const data = [
      { required: true, status: 'completed' },
      { required: false, status: 'not_started' },
    ]
    expect(requiredCompletionPct(data)).toBe(100)
  })
  it('is 100 when there are no required tasks', () => {
    expect(requiredCompletionPct([{ required: false, status: 'not_started' }])).toBe(100)
    expect(requiredCompletionPct([])).toBe(100)
  })
})

describe('phaseProgress', () => {
  it('returns entries in canonical phase order', () => {
    const prog = phaseProgress(rows)
    expect(prog.map((p) => p.phase)).toEqual(PHASE_ORDER)
  })
  it('computes totals, completed counts and pct per phase', () => {
    const byPhase = Object.fromEntries(phaseProgress(rows).map((p) => [p.phase, p]))
    expect(byPhase.setup).toMatchObject({ total: 2, completed: 2, pct: 100 })
    expect(byPhase.data_import).toMatchObject({ total: 2, completed: 0, pct: 0 })
    expect(byPhase.configuration).toMatchObject({ total: 1, completed: 0, pct: 0 })
    expect(byPhase.go_live).toMatchObject({ total: 1, completed: 0, pct: 0 })
  })
  it('includes empty phases with total 0 and pct 0', () => {
    const prog = phaseProgress([{ phase: 'setup', status: 'completed', required: true }])
    const go = prog.find((p) => p.phase === 'go_live')
    expect(go).toMatchObject({ total: 0, completed: 0, pct: 0 })
  })
})

describe('isReadyForGoLive', () => {
  it('is false while any required task is incomplete', () => {
    expect(isReadyForGoLive(rows)).toBe(false)
  })
  it('is true when every required task is completed', () => {
    const data = [
      { required: true, status: 'completed' },
      { required: true, status: 'completed' },
      { required: false, status: 'not_started' }, // optional, ignored
    ]
    expect(isReadyForGoLive(data)).toBe(true)
  })
  it('is false for an empty checklist or one with no required tasks', () => {
    expect(isReadyForGoLive([])).toBe(false)
    expect(isReadyForGoLive([{ required: false, status: 'completed' }])).toBe(false)
  })
})

describe('summariseOnboarding', () => {
  it('rolls the checklist into a header summary', () => {
    const s = summariseOnboarding(rows)
    expect(s.totalTasks).toBe(8)
    expect(s.completedCount).toBe(2)
    expect(s.blockedCount).toBe(1)
    expect(s.requiredRemaining).toBe(4) // t3,t4,t6,t8
    expect(s.completionPct).toBe(25)
    expect(s.readyForGoLive).toBe(false)
  })
  it('reports readiness when all required tasks are done', () => {
    const data = [
      { required: true, status: 'completed' },
      { required: false, status: 'skipped' },
    ]
    const s = summariseOnboarding(data)
    expect(s.requiredRemaining).toBe(0)
    expect(s.readyForGoLive).toBe(true)
    expect(s.blockedCount).toBe(0)
  })
  it('handles an empty checklist safely', () => {
    const s = summariseOnboarding([])
    expect(s).toMatchObject({
      totalTasks: 0, completedCount: 0, blockedCount: 0,
      requiredRemaining: 0, completionPct: 0, readyForGoLive: false,
    })
  })
})

describe('nextTasks', () => {
  it('returns only not_started / in_progress tasks', () => {
    const next = nextTasks(rows)
    const ids = next.map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining(['t3', 't4', 't5', 't8']))
    expect(ids).not.toContain('t1') // completed
    expect(ids).not.toContain('t6') // blocked
    expect(ids).not.toContain('t7') // skipped
  })
  it('sorts by sort_order ascending', () => {
    const orders = nextTasks(rows).map((t) => t.sort_order)
    const sorted = [...orders].sort((a, b) => a - b)
    expect(orders).toEqual(sorted)
  })
  it('surfaces in_progress ahead of not_started at the same sort_order', () => {
    const data = [
      { id: 'a', sort_order: 1, phase: 'setup', status: 'not_started', title: 'A' },
      { id: 'b', sort_order: 1, phase: 'setup', status: 'in_progress', title: 'B' },
    ]
    expect(nextTasks(data).map((t) => t.id)).toEqual(['b', 'a'])
  })
  it('returns an empty array when nothing is open', () => {
    expect(nextTasks([{ status: 'completed' }, { status: 'skipped' }])).toEqual([])
    expect(nextTasks([])).toEqual([])
  })
})
