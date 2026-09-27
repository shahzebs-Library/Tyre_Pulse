import { describe, expect, it } from 'vitest'
import {
  renderTemplatePreview, tokensUsed, unknownTokens, ruleMatchSummary, ruleHasNoRecipients,
  ruleOrphanDepartments, departmentUsage, templateState, workflowOverview,
  filterDepartments, filterRules, filterTemplates, sortDepartments, sortRules,
} from '../lib/accidentWorkflowSettingsAnalytics'

const depts = [
  { id: 1, name: 'HSE', code: 'HSE', active: true, sort_order: 2 },
  { id: 2, name: 'Insurance', code: 'INS', active: true, sort_order: 1 },
  { id: 3, name: 'Legal', active: false, sort_order: 3 },
]
const rules = [
  { id: 'a', name: 'Major to HSE', active: true, priority: 10, event_key: 'accident.reported', departments: ['HSE'], to_roles: ['Manager'], match_severities: ['severe'] },
  { id: 'b', name: 'Silent', active: true, priority: 5, departments: [], to_roles: [] },
  { id: 'c', name: 'Old legal', active: true, priority: 20, departments: ['Legal', 'hse'], to_roles: [] },
  { id: 'd', name: 'Paused', active: false, priority: 1, departments: ['Insurance'], to_roles: [] },
]
const templates = [
  { id: 't1', key: 'reported', name: 'Reported', subject: 'New {{reference_no}}', body_html: '<p>{{site}} {{sitee}}</p>', active: true, approved: true },
  { id: 't2', key: 'stage', name: 'Stage', subject: 'Stage', body_html: '<p>{{stage_label}}</p>', active: true, approved: false },
  { id: 't3', key: 'vor', name: 'VOR', subject: 'VOR', body_html: '', active: false, approved: true },
]

describe('template tokens', () => {
  it('substitutes known tokens (whitespace tolerant) and leaves unknown ones visible', () => {
    expect(renderTemplatePreview('{{ site }}-{{nope}}')).toBe('DHAHBAN-{{nope}}')
    expect(renderTemplatePreview(null)).toBe('')
  })
  it('lists distinct tokens and flags unknown ones', () => {
    expect(tokensUsed('{{a}} {{ b }} {{a}}')).toEqual(['a', 'b'])
    expect(unknownTokens(templates[0].body_html)).toEqual(['sitee'])
    expect(unknownTokens('')).toEqual([])
  })
})

describe('rules', () => {
  it('summarises match conditions and defaults to any accident', () => {
    expect(ruleMatchSummary(rules[0])).toContain('Major')
    expect(ruleMatchSummary({ min_cost: 5000, require_vor: true })).toBe('cost >= 5000, VOR')
    expect(ruleMatchSummary({})).toBe('Any accident')
  })
  it('detects a rule that reaches nobody', () => {
    expect(ruleHasNoRecipients(rules[1])).toBe(true)
    expect(ruleHasNoRecipients(rules[0])).toBe(false)
  })
  it('finds departments that are inactive or missing, case-insensitively', () => {
    expect(ruleOrphanDepartments(rules[2], depts)).toEqual(['Legal'])
    expect(ruleOrphanDepartments(rules[0], depts)).toEqual([])
  })
  it('counts only ACTIVE rules per department', () => {
    const u = departmentUsage(depts, rules)
    expect(u.find((d) => d.name === 'HSE').rule_count).toBe(2)
    expect(u.find((d) => d.name === 'Insurance').rule_count).toBe(0)
  })
})

describe('workflowOverview', () => {
  it('reports KPIs and every readiness issue', () => {
    const o = workflowOverview({ departments: depts, rules, templates, emailsEnabled: true, recipientsConfigured: false })
    expect(o.departments).toEqual({ total: 3, active: 2 })
    expect(o.rules).toMatchObject({ total: 4, active: 3, silent: 1, orphan: 1 })
    expect(o.templates).toMatchObject({ total: 3, usable: 1, unapproved: 1, withUnknownTokens: 1 })
    expect(o.issues.map((i) => i.level)).toEqual(['warn', 'warn', 'info', 'warn', 'crit'])
    expect(o.ready).toBe(false)
  })
  it('treats unknown recipient config (null) as not a blocker and flags no rules as critical', () => {
    const o = workflowOverview({ departments: [], rules: [], templates: [], emailsEnabled: true })
    expect(o.issues).toHaveLength(1)
    expect(o.issues[0].level).toBe('crit')
  })
  it('is ready when rules reach people and a template is usable', () => {
    const o = workflowOverview({ departments: depts, rules: [rules[0]], templates: [{ ...templates[0], body_html: '{{site}}' }], emailsEnabled: false })
    expect(o.issues).toEqual([])
    expect(o.ready).toBe(true)
  })
  it('template state precedence: approval before active', () => {
    expect(templateState({ active: false, approved: false })).toBe('unapproved')
    expect(templateState({ active: false, approved: true })).toBe('inactive')
  })
})

describe('filters and sorts', () => {
  it('filters departments by status and query', () => {
    expect(filterDepartments(depts, { status: 'inactive' }).map((d) => d.id)).toEqual([3])
    expect(filterDepartments(depts, { q: 'ins' }).map((d) => d.id)).toEqual([2])
  })
  it('filters rules by event and role text', () => {
    expect(filterRules(rules, { event: 'accident.reported' }).map((r) => r.id)).toEqual(['a'])
    expect(filterRules(rules, { q: 'manager' }).map((r) => r.id)).toEqual(['a'])
    expect(filterRules(rules, { event: '' }).map((r) => r.id)).toEqual(['b', 'c', 'd'])
  })
  it('filters templates by readiness', () => {
    expect(filterTemplates(templates, { state: 'usable' }).map((t) => t.id)).toEqual(['t1'])
  })
  it('sorts departments by order then name, rules by priority', () => {
    expect([...depts].sort(sortDepartments).map((d) => d.id)).toEqual([2, 1, 3])
    expect([...rules].sort(sortRules).map((r) => r.id)).toEqual(['d', 'b', 'a', 'c'])
  })
})
