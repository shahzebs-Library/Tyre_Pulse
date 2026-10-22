import { describe, it, expect } from 'vitest'
import {
  MIN_SAMPLES, percentile, summarize, computeActiveMinutes, tiersFromSamples, pickEstimate,
  confidenceFor, formatMinutes, normalizeTaskType, normalizeVehicleType,
} from '../lib/workforceEstimate'

const rows = (n, over = {}) => Array.from({ length: n }, (_, i) => ({
  task_type: 'tyre change', vehicle_type: 'TR-MIXER', assignee_role: 'Tyre Man', active_minutes: 50 + i * 5, ...over,
}))

describe('percentile / summarize', () => {
  it('interpolates like percentile_cont', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25)
    expect(percentile([10, 20, 30, 40], 0.25)).toBe(17.5)
    expect(percentile([5], 0.9)).toBe(5)
    expect(percentile([], 0.5)).toBeNull()
  })
  it('summarises, ignores junk, and is empty-safe', () => {
    expect(summarize([30, 10, 20, 'x', null, undefined])).toEqual({ n: 3, p25: 15, median: 20, p75: 25, p90: 28 })
    expect(summarize([])).toEqual({ n: 0, p25: null, median: null, p75: null, p90: null })
  })
})

describe('computeActiveMinutes', () => {
  const t = m => new Date(Date.UTC(2026, 9, 1, 8, m)).toISOString()
  const ev = (action, to_status, m) => ({ action, to_status, effective_at: t(m), occurred_at: t(m), id: `${m}` })
  it('excludes blocked and review-waiting time', () => {
    const events = [ev('accept', 'acknowledged', 0), ev('start', 'in_progress', 10), ev('block', 'blocked', 40),
      ev('resume', 'in_progress', 100), ev('complete', 'submitted', 130), ev('verify', 'verified', 400)]
    expect(computeActiveMinutes(events)).toBe(60) // 30 before the block + 30 after resume
  })
  it('counts rework after a manager return up to the last completion', () => {
    const events = [ev('start', 'in_progress', 0), ev('complete', 'submitted', 20), ev('return', 'in_progress', 60), ev('complete', 'submitted', 80)]
    expect(computeActiveMinutes(events)).toBe(40)
  })
  it('is null without a completion, so unfinished work never produces a sample', () => {
    expect(computeActiveMinutes([ev('start', 'in_progress', 0), ev('block', 'blocked', 5)])).toBeNull()
    expect(computeActiveMinutes([])).toBeNull()
  })
})

describe('tiersFromSamples', () => {
  it('builds nested tiers and excludes implausible durations', () => {
    const samples = [...rows(6), ...rows(3, { assignee_role: 'Mechanic' }), { ...rows(1)[0], active_minutes: 0.2 }, { ...rows(1)[0], active_minutes: 99999 }]
    const tiers = Object.fromEntries(tiersFromSamples(samples, { task_type: ' Tyre  Change', vehicle_type: 'tr-mixer', role: 'Tyre Man' }).map(x => [x.tier, x.n]))
    expect(tiers).toEqual({ task_vehicle_role: 6, task_vehicle: 9, task_role: 6, task: 9 })
  })
  it('tiers needing a missing input have no samples', () => {
    const t = tiersFromSamples(rows(6), { task_type: 'tyre change' })
    expect(t.find(x => x.tier === 'task_vehicle').n).toBe(0)
    expect(t.find(x => x.tier === 'task').n).toBe(6)
  })
})

describe('pickEstimate', () => {
  const q = { task_type: 'tyre change', vehicle_type: 'TR-MIXER', role: 'Tyre Man' }
  const result = samples => ({ ...q, tiers: tiersFromSamples(samples, q) })

  it('asks for a task type first', () => {
    expect(pickEstimate({ task_type: null, tiers: [] }).status).toBe('no_task_type')
    expect(pickEstimate(null).status).toBe('no_task_type')
  })
  it('refuses to estimate below the minimum sample size and carries no number', () => {
    const r = pickEstimate(result(rows(MIN_SAMPLES - 1)))
    expect(r.status).toBe('insufficient')
    expect(r.sampleSize).toBe(MIN_SAMPLES - 1)
    expect(r).not.toHaveProperty('medianMinutes')
    expect(r.message).toMatch(/Not enough history/)
  })
  it('reports zero history plainly', () => {
    const r = pickEstimate(result([]))
    expect(r.status).toBe('insufficient')
    expect(r.message).toMatch(/0 completed jobs/)
  })
  it('uses the most specific tier that has enough samples', () => {
    const r = pickEstimate(result(rows(MIN_SAMPLES)))
    expect(r).toMatchObject({ status: 'estimated', tier: 'task_vehicle_role', sampleSize: MIN_SAMPLES, medianMinutes: 60 })
  })
  it('falls back to a broader tier, labels it, and caps confidence at medium', () => {
    const samples = [...rows(4), ...rows(40, { assignee_role: 'Mechanic', active_minutes: 60 })]
    const r = pickEstimate(result(samples))
    expect(r.tier).toBe('task_vehicle')
    expect(r.basis).toMatch(/vehicle type/)
    expect(r.confidence).toBe('medium')
  })
  it('does not use tiers whose inputs the caller did not supply', () => {
    const only = { task_type: 'tyre change', vehicle_type: null, role: null }
    const r = pickEstimate({ ...only, tiers: tiersFromSamples(rows(8), only) })
    expect(r.tier).toBe('task')
    expect(r.confidence).toBe('low')
  })
  it('downgrades confidence for a wide spread and upgrades with volume', () => {
    expect(confidenceFor({ n: 40, p25: 50, median: 60, p75: 70 })).toBe('high')
    expect(confidenceFor({ n: 40, p25: 10, median: 60, p75: 200 })).toBe('medium')
    expect(confidenceFor({ n: 12, p25: 50, median: 60, p75: 70 })).toBe('medium')
    expect(confidenceFor({ n: 5, p25: 50, median: 60, p75: 70 })).toBe('low')
    expect(confidenceFor({ n: 5, p25: 1, median: 60, p75: 200 })).toBe('low')
  })
})

describe('formatting / normalisation', () => {
  it('formats minutes', () => {
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(60)).toBe('1 h')
    expect(formatMinutes(135)).toBe('2 h 15 min')
    expect(formatMinutes(null)).toBe('N/A')
  })
  it('matches the database canonical forms', () => {
    expect(normalizeTaskType('  Tyre   CHANGE ')).toBe('tyre change')
    expect(normalizeVehicleType(' tr-mixer ')).toBe('TR-MIXER')
    expect(normalizeTaskType('   ')).toBeNull()
  })
})
