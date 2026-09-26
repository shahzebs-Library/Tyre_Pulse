import { describe, it, expect } from 'vitest'
import {
  filterSubmissions, siteOptions, computeMetrics, rateTone, weeklySeries, bySite, byTemplate,
  boolPassRates, complianceSummary, approvalAgeSummary, sortRows, statusOf, boolIsYes,
  templateExportRows, passRateExportRows,
} from '../lib/checklistInsightsAnalytics'

const NOW = new Date(2026, 8, 26, 12, 0, 0) // Sat 26 Sep 2026, local
const day = (d) => new Date(2026, 8, d, 9).toISOString()

const templates = [
  { id: 't1', name: 'Workshop Daily', status: 'published', require_approval: true,
    fields: [{ id: 'f1', type: 'boolean', label: 'Brakes OK' }, { id: 'f2', type: 'text', label: 'Notes' }] },
  { id: 't2', name: 'Mixer check', status: 'draft', require_approval: false, fields: [] },
]
const subs = [
  { id: 1, template_id: 't1', status: 'approved', site: 'NHC', created_at: day(25), answers: { f1: 'Yes' } },
  { id: 2, template_id: 't1', status: 'rejected', site: 'NHC', created_at: day(20), answers: { f1: false } },
  { id: 3, template_id: 't1', status: 'submitted', site: '  ', created_at: day(2), answers: { f1: '' } },
  { id: 4, template_id: 't2', status: 'draft', site: 'JED', created_at: null, asset_no: 'TM514' },
  { id: 5, template_id: 't2', status: 'weird', site: 'JED', created_at: new Date(2026, 5, 1).toISOString() },
]

describe('checklistInsightsAnalytics', () => {
  it('folds unknown statuses to submitted', () => {
    expect(statusOf({ status: 'weird' })).toBe('submitted')
    expect(statusOf({})).toBe('submitted')
    expect(boolIsYes('ok')).toBe(true)
    expect(boolIsYes(false)).toBe(false)
  })

  it('filters by template, status, site, period and search', () => {
    expect(filterSubmissions(subs, { template: 't1' }, NOW)).toHaveLength(3)
    expect(filterSubmissions(subs, { status: 'draft' }, NOW).map((s) => s.id)).toEqual([4])
    expect(filterSubmissions(subs, { site: 'Unassigned' }, NOW).map((s) => s.id)).toEqual([3])
    // undated rows cannot be proven to fall inside a period
    expect(filterSubmissions(subs, { period: '30' }, NOW).map((s) => s.id)).toEqual([1, 2, 3])
    expect(filterSubmissions(subs, { search: 'tm514' }, NOW).map((s) => s.id)).toEqual([4])
    expect(siteOptions(subs)).toEqual(['JED', 'NHC', 'Unassigned'])
  })

  it('computes honest KPIs with null rates when there is no denominator', () => {
    const m = computeMetrics(templates, subs, NOW)
    expect(m.total).toBe(5)
    expect(m.publishedTemplates).toBe(1)
    expect(m.thisMonth).toBe(3)
    expect(m.undated).toBe(1)
    expect(m.approvalRate).toBe(50)
    expect(m.requiresApproval).toBe(3)
    expect(m.approvalPassRate).toBeCloseTo(33.33, 1)
    expect(m.activeSites).toBe(2)
    const empty = computeMetrics(templates, [], NOW)
    expect(empty.approvalRate).toBeNull()
    expect(empty.approvalPassRate).toBeNull()
    expect(rateTone(null)).toBeNull()
    expect(rateTone(90)).toBe('good')
    expect(rateTone(70)).toBe('warn')
    expect(rateTone(10)).toBe('bad')
  })

  it('buckets weeks only for dated rows inside the window', () => {
    const w = weeklySeries(subs, NOW, 10)
    expect(w.weeks).toHaveLength(10)
    expect(w.counts.reduce((a, b) => a + b, 0)).toBe(3)
    expect(w.inWindow).toBe(3)
  })

  it('ranks sites, templates and pass rates', () => {
    const s = bySite(subs, 2)
    expect(s.total).toBe(3)
    expect(s.rows[0].count).toBe(2)
    const t = byTemplate(subs, templates)
    expect(t[0]).toMatchObject({ id: 't1', count: 3, approved: 1, rejected: 1, submitted: 1, approvalRate: 50 })
    expect(t[1].approvalRate).toBeNull()
    const p = boolPassRates(templates, subs)
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ question: 'Brakes OK', yes: 1, no: 1, responses: 2, yesPct: 50 })
    expect(boolPassRates(templates, subs, { template: 't2' })).toEqual([])
  })

  it('summarises the monitors without inventing numbers', () => {
    const c = complianceSummary([
      { template_id: 't1', template_name: 'W', site: 'NHC', due_count: 10, completed_count: 6, skipped_count: 2, completed_on_time_count: 3, overdue_count: 2, evidence_gap_count: 1, compliance_pct: null },
      { template_id: 't2', due_count: 4, completed_count: 4 },
    ], 't1')
    expect(c.rows).toHaveLength(1)
    expect(c.rows[0].compliancePct).toBeNull()
    expect(c.compliancePct).toBe(75)
    expect(c.onTimePct).toBe(50)
    const a = approvalAgeSummary([
      { template_id: 't1', approval_stage: 'area_manager', pending_count: 2, oldest_age_hours: '30', average_age_hours: null, target_hours: 24, breached_count: 1 },
      { template_id: 't1', approval_stage: 'supervisor', pending_count: 1, oldest_age_hours: null, breached_count: 0 },
    ])
    expect(a.pending).toBe(3)
    expect(a.breached).toBe(1)
    expect(a.oldestHours).toBe(30)
    expect(a.rows[0].stage).toBe('Area Manager')
    expect(a.rows[1].averageHours).toBeNull()
  })

  it('sorts the full set with nulls last in either direction', () => {
    const rows = [{ v: 2 }, { v: null }, { v: 5 }, { v: 1 }]
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual([1, 2, 5, null])
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.v)).toEqual([5, 2, 1, null])
    expect(sortRows([{ n: 'b' }, { n: 'a' }], (r) => r.n, 'asc').map((r) => r.n)).toEqual(['a', 'b'])
  })

  it('exports N/A for unmeasured rates and ASCII dates', () => {
    const t = templateExportRows(byTemplate(subs, templates))
    expect(t[1].approvalRate).toBe('N/A')
    expect(t[0].last).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(passRateExportRows(boolPassRates(templates, subs))[0].yesPct).toBe('50.0%')
  })
})
