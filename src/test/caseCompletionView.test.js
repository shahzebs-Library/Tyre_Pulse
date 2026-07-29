import { describe, it, expect } from 'vitest'
import {
  completionRows, completionState, closureBadge, blockerList, readyToClose,
  COMPLETION_DIMENSIONS, TONE,
} from '../lib/caseCompletionView'
import { requiredWorkstreams } from '../lib/accidentCase'

const NOW = new Date('2026-07-28T00:00:00Z').getTime()

// explicit accident_case_workstreams rows from a { ws: status } map
const wsRows = (map) => Object.entries(map).map(([workstream, status]) => ({ workstream, status }))

// every required workstream of a route set to `completed`
const allCompleted = (route, record = {}) =>
  wsRows(Object.fromEntries([...requiredWorkstreams(route, record)].map((ws) => [ws, 'completed'])))

// a fully-closable standard case: all required workstreams done + closure approved
const closableStandard = () => ({
  record: { closure_review_approved: true },
  route: 'standard',
  workstreams: allCompleted('standard'),
  now: NOW,
})

describe('completionState', () => {
  it('maps a null percentage to an honest out-of-scope state, never 0 or 100', () => {
    const s = completionState(null)
    expect(s.status).toBe('Not in scope')
    expect(s.tone).toBe(TONE.QUIET)
    expect(s.inScope).toBe(false)
  })

  it('distinguishes 0% (in scope, not started) from null (not in scope)', () => {
    const zero = completionState(0)
    expect(zero.status).toBe('Not started')
    expect(zero.tone).toBe(TONE.DANGER)
    expect(zero.inScope).toBe(true)
  })

  it('grades partial and complete percentages', () => {
    expect(completionState(100).tone).toBe(TONE.GOOD)
    expect(completionState(100).status).toBe('Complete')
    expect(completionState(60).tone).toBe(TONE.INFO)
    expect(completionState(20).tone).toBe(TONE.WARNING)
  })

  it('treats a non-finite value as not in scope', () => {
    expect(completionState(undefined).inScope).toBe(false)
    expect(completionState(NaN).inScope).toBe(false)
  })
})

describe('completionRows', () => {
  it('returns exactly the five dimensions in order, overall marked as the summary', () => {
    const rows = completionRows({ record: {}, route: 'standard', workstreams: [] })
    expect(rows.map((r) => r.key)).toEqual(COMPLETION_DIMENSIONS.map((d) => d.key))
    expect(rows.find((r) => r.key === 'overall').summary).toBe(true)
  })

  it('carries the engine null through as a "Not in scope" row (standard route has no insurance)', () => {
    // The standard route requires no insurance workstream, so the engine returns
    // null for that dimension and the row must render it as out of scope.
    const rows = completionRows({ record: {}, route: 'standard', workstreams: [] })
    const insurance = rows.find((r) => r.key === 'insurance')
    expect(insurance.pct).toBeNull()
    expect(insurance.inScope).toBe(false)
    expect(insurance.status).toBe('Not in scope')
  })

  it('reports 100% complete dimensions when every required workstream is done', () => {
    const rows = completionRows(closableStandard())
    const overall = rows.find((r) => r.key === 'overall')
    expect(overall.pct).toBe(100)
    expect(overall.tone).toBe(TONE.GOOD)
    // repair + incident + financial are in scope for standard and fully done
    expect(rows.find((r) => r.key === 'repair').pct).toBe(100)
  })

  it('tolerates a bare accidents row passed directly as caseData', () => {
    const rows = completionRows({ incident_date: '2026-07-01', asset_no: 'TM9' })
    expect(rows).toHaveLength(5)
    // a mostly-empty record leaves required dimensions in scope but low
    expect(rows.find((r) => r.key === 'incident').inScope).toBe(true)
  })
})

describe('closureBadge', () => {
  it('reads fully_closed for a closed case', () => {
    const badge = closureBadge({ record: { case_status: 'closed' }, route: 'standard' })
    expect(badge.level).toBe('fully_closed')
    expect(badge.label).toBe('Fully closed')
    expect(badge.tone).toBe(TONE.GOOD)
  })

  it('renders an explicit "open" level (not null) while the case is operationally open', () => {
    const badge = closureBadge({ record: {}, route: 'standard', workstreams: [] })
    expect(badge.level).toBe('open')
    expect(badge.label).toBe('Open')
  })

  it('reads operationally_completed when operational work is done but review is not approved', () => {
    const badge = closureBadge({
      record: {}, route: 'standard', workstreams: allCompleted('standard'),
    })
    expect(badge.level).toBe('operationally_completed')
    expect(badge.tone).toBe(TONE.INFO)
  })

  it('reads financially_open when the vehicle is back but money is outstanding', () => {
    // Complete the operational chain but leave finance open.
    const ws = allCompleted('standard').filter((r) => r.workstream !== 'finance')
    ws.push({ workstream: 'finance', status: 'in_progress' })
    const badge = closureBadge({ record: {}, route: 'standard', workstreams: ws })
    expect(badge.level).toBe('financially_open')
    expect(badge.tone).toBe(TONE.WARNING)
  })
})

describe('blockerList + readyToClose', () => {
  it('lists a labelled blocker for each unfinished workstream plus the closure-review gate', () => {
    const blockers = blockerList({ record: {}, route: 'standard', workstreams: [], now: NOW })
    expect(blockers.length).toBeGreaterThan(0)
    // every blocker carries a key, kind, label and a plain-English reason
    for (const b of blockers) {
      expect(b.key).toBeTruthy()
      expect(['workstream', 'check']).toContain(b.kind)
      expect(b.label).toBeTruthy()
      expect(typeof b.reason).toBe('string')
    }
    // the closure-review meta gate is present and nicely labelled
    const review = blockers.find((b) => b.key === 'closure_review')
    expect(review).toBeTruthy()
    expect(review.kind).toBe('check')
    expect(review.label).toBe('Closure review')
  })

  it('labels an incomplete workstream with its human name', () => {
    const blockers = blockerList({ record: {}, route: 'standard', workstreams: [], now: NOW })
    const incident = blockers.find((b) => b.key === 'incident_evidence')
    expect(incident).toBeTruthy()
    expect(incident.kind).toBe('workstream')
    expect(incident.label).toBe('Incident & Evidence')
  })

  it('is empty and ready-to-close when every required step and the review are done', () => {
    const cd = closableStandard()
    expect(blockerList(cd)).toEqual([])
    expect(readyToClose(cd)).toBe(true)
  })

  it('is not ready when only the closure review is outstanding', () => {
    const cd = { record: {}, route: 'standard', workstreams: allCompleted('standard'), now: NOW }
    const blockers = blockerList(cd)
    expect(readyToClose(cd)).toBe(false)
    // the only thing left is the review gate
    expect(blockers.map((b) => b.key)).toContain('closure_review')
  })
})
