import { describe, it, expect } from 'vitest'
import {
  conditionSummary, actionSummary, hasNeverFired, executionsByRule, executionStatusBreakdown,
  ruleActivity, filterRules, ruleEventTypes, automationKpis, ruleTableRows, ruleExportRows,
} from '../lib/automationRulesAnalytics'

const NOW = new Date('2026-09-26T12:00:00Z')
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString()

const RULES = [
  { id: 'a', name: 'Low tread alert', active: true, event_types: ['inspection.done'], triggered_count: 4, last_triggered_at: daysAgo(2),
    conditions: [{ field: 'tread', operator: 'lte', value: 3 }], actions: [{ type: 'notify_role', role: 'manager' }] },
  { id: 'b', name: 'Old rule', active: true, event_types: ['tyre.installed'], triggered_count: 1, last_triggered_at: daysAgo(60), conditions: [], actions: [] },
  { id: 'c', name: 'Paused never', active: false, event_types: ['workorder.created'], triggered_count: 0, last_triggered_at: null,
    conditions: [], actions: [{ type: 'emit_event', event_type: 'followup' }] },
  { id: 'd', name: 'Unknown count', active: true, event_types: [], triggered_count: null, last_triggered_at: null },
]

const EXEC = [
  { id: 1, rule_id: 'a', status: 'actioned', created_at: daysAgo(2) },
  { id: 2, rule_id: 'a', status: 'error', created_at: daysAgo(3) },
  { id: 3, rule_id: 'b', status: 'conditions_not_met', created_at: daysAgo(60) },
  { id: 4, rule_id: 'a', status: 'skipped_cooldown', created_at: daysAgo(4) },
]

describe('automationRulesAnalytics', () => {
  it('summarises conditions and actions in ASCII', () => {
    expect(conditionSummary(RULES[0].conditions)).toBe('tread <= 3')
    expect(conditionSummary([])).toBe('Always (no conditions)')
    expect(actionSummary(RULES[0].actions)).toBe('Notify Manager')
    expect(actionSummary(RULES[2].actions)).toBe('Emit rule.followup')
    expect(actionSummary(null)).toBe('N/A')
  })

  it('detects never-fired and activity buckets', () => {
    expect(hasNeverFired(RULES[2])).toBe(true)
    expect(hasNeverFired(RULES[3])).toBe(true)
    expect(hasNeverFired(RULES[0])).toBe(false)
    expect(ruleActivity(RULES[0], { now: NOW })).toBe('recent')
    expect(ruleActivity(RULES[1], { now: NOW })).toBe('dormant')
    expect(ruleActivity({ ...RULES[1], active: false }, { now: NOW })).toBe('fired')
    expect(ruleActivity(RULES[2], { now: NOW })).toBe('never')
  })

  it('aggregates executions per rule with rates', () => {
    const s = executionsByRule(EXEC)
    expect(s.a).toMatchObject({ total: 3, actioned: 1, error: 1, skipped_cooldown: 1 })
    expect(s.a.successRate).toBeCloseTo(2 / 3)
    expect(executionsByRule([])).toEqual({})
    const b = executionStatusBreakdown(EXEC)
    expect(b.find((x) => x.status === 'error').count).toBe(1)
    expect(executionStatusBreakdown([])[0].share).toBeNull()
  })

  it('filters by search, status, activity and event type', () => {
    expect(filterRules(RULES, { search: 'tread' }).map((r) => r.id)).toEqual(['a'])
    expect(filterRules(RULES, { status: 'paused' }).map((r) => r.id)).toEqual(['c'])
    expect(filterRules(RULES, { activity: 'never', now: NOW }).map((r) => r.id)).toEqual(['c', 'd'])
    expect(filterRules(RULES, { eventType: 'tyre.installed' }).map((r) => r.id)).toEqual(['b'])
    expect(ruleEventTypes(RULES)).toEqual(['inspection.done', 'tyre.installed', 'workorder.created'])
  })

  it('KPIs: success rate is null with no runs, never a fabricated 0', () => {
    const k = automationKpis({ rules: RULES, executions: EXEC, now: NOW })
    expect(k).toMatchObject({ total: 4, active: 3, paused: 1, triggeredTotal: 5, neverFired: 2, dormant: 1, runs: 4, errors: 1 })
    expect(k.successRate).toBeCloseTo(0.75)
    expect(k.failureRate).toBeCloseTo(0.25)
    const none = automationKpis({ rules: RULES, executions: [], now: NOW })
    expect(none.successRate).toBeNull()
    expect(none.failureRate).toBeNull()
    const unread = automationKpis({ rules: RULES, executions: null, now: NOW })
    expect(unread.runs).toBeNull()
    expect(automationKpis({ rules: [], executions: [] }).triggeredTotal).toBeNull()
  })

  it('builds table and export rows', () => {
    const rows = ruleTableRows(RULES, EXEC, { now: NOW })
    expect(rows[0]).toMatchObject({ sampleRuns: 3, sampleErrors: 1, activity: 'recent' })
    expect(rows[2].sampleFailureRate).toBeNull()
    const out = ruleExportRows(rows)
    expect(out[2]).toMatchObject({ status: 'Paused', last_triggered: 'Never', activity: 'Never fired' })
    expect(out[3].triggered).toBe('N/A')
    expect(JSON.stringify(out)).not.toMatch(/[–—]/)
  })
})
