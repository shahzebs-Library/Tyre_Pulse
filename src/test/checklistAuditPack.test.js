import { describe, it, expect } from 'vitest'
import {
  buildAuditPack, reviewStatus, recordFaults, filterRecords, addMonths, auditType, summaryRows,
} from '../lib/checklistAuditPack'

const NOW = new Date('2026-11-08T12:00:00Z')

const tpl = (over = {}) => ({
  id: 't1', name: 'Workshop Daily Checklist', status: 'published', version: 3,
  form_ref: 'TP-WDC', form_revision: 'v3', form_owner: 'Maintenance', form_effective_date: '2026-10-26',
  form_approved_name: 'Shahzeb', form_approved_at: '2026-10-26T08:00:00Z',
  last_reviewed_at: '2026-10-26T08:00:00Z', review_interval_months: 12,
  doc_prefix: 'WDC', require_signature: true, require_approval: true, require_area_manager: true,
  assignee_roles: ['Mechanic', 'Electrician'],
  option_sets: { legend: { blocking: ['Not OK'] } },
  fields: [{ id: 'f1', label: 'Brakes' }, { id: 'f2', label: 'Lights' }],
  ...over,
})
const sub = (over = {}) => ({
  id: 's1', template_id: 't1', template_name: 'Workshop Daily Checklist', template_version: 3,
  template_snapshot_status: 'exact', document_no: 'WDC-TM514-2026-0001', asset_no: 'TM514', site: 'NHC',
  submitted_at: '2026-11-01T08:00:00Z', printed_name: 'Hasan', approval_status: 'approved',
  approver_name: 'Vinay', approved_at: '2026-11-01T10:00:00Z', answers: { f1: 'OK', f2: 'OK' }, locked: true,
  ...over,
})

describe('reviewStatus', () => {
  it('reads in date, due soon, overdue and never', () => {
    expect(reviewStatus(tpl(), NOW).status).toBe('ok')
    expect(reviewStatus(tpl({ last_reviewed_at: '2025-11-20T00:00:00Z' }), NOW).status).toBe('due_soon')
    expect(reviewStatus(tpl({ last_reviewed_at: '2025-01-01T00:00:00Z' }), NOW).status).toBe('overdue')
    expect(reviewStatus(tpl({ last_reviewed_at: null, form_approved_at: null }), NOW).status).toBe('never')
  })
  it('adds months without rolling past the month end', () => {
    expect(addMonths('2026-01-31T00:00:00Z', 1).toISOString().slice(0, 10)).toBe('2026-02-28')
  })
})

describe('recordFaults', () => {
  it('finds only blocking marks and labels them from the form', () => {
    expect(recordFaults(sub({ answers: { f1: 'Not OK', f2: 'OK' } }), tpl())).toEqual([{ key: 'f1', label: 'Brakes', mark: 'Not OK' }])
  })
  it('a form with no blocking legend has no faults', () => {
    expect(recordFaults(sub({ answers: { f1: 'Not OK' } }), tpl({ option_sets: {} }))).toEqual([])
  })
})

describe('filterRecords', () => {
  it('keeps the period, form and site', () => {
    const rows = [sub(), sub({ id: 's2', submitted_at: '2025-01-01T00:00:00Z' }), sub({ id: 's3', site: 'DIRIYAH' })]
    expect(filterRecords(rows, { from: '2026-01-01', to: '2026-12-31', site: 'nhc' }).map((r) => r.id)).toEqual(['s1'])
  })
})

describe('buildAuditPack', () => {
  it('a clean scope produces no major or minor findings', () => {
    const pack = buildAuditPack({ templates: [tpl()], submissions: [sub()], now: NOW })
    expect(pack.summary.majors).toBe(0)
    expect(pack.summary.minors).toBe(0)
    expect(pack.summary.approval_rate).toBe(100)
    expect(pack.forms[0].records).toBe(1)
  })

  it('a fault with no corrective action is a major finding; one with an action is covered', () => {
    const faulty = sub({ approval_status: 'pending', answers: { f1: 'Not OK', f2: 'Not OK' } })
    const actions = [{ source_id: 's1', source_detail: 'Brakes', status: 'Open', due_date: '2026-11-01T00:00:00Z' }]
    const pack = buildAuditPack({ templates: [tpl()], submissions: [faulty], actions, now: NOW })
    expect(pack.faults).toHaveLength(2)
    expect(pack.faults.filter((f) => !f.has_action).map((f) => f.item)).toEqual(['Lights'])
    expect(pack.findings[0]).toMatchObject({ severity: 'major', clause: '10.2', count: 1 })
    expect(pack.faults.find((f) => f.item === 'Brakes').overdue).toBe(true)
    expect(pack.summary.action_coverage).toBe(50)
  })

  it('flags missing form number, missing approver, overdue review and unnumbered records', () => {
    const t = tpl({ form_ref: null, form_approved_name: null, last_reviewed_at: '2024-01-01T00:00:00Z', doc_prefix: null })
    const pack = buildAuditPack({ templates: [t], submissions: [sub({ document_no: null })], now: NOW })
    const titles = pack.findings.map((f) => f.title)
    expect(titles).toEqual(expect.arrayContaining([
      'Forms without a control number', 'Form approval not recorded by name', 'Form review overdue',
      'Forms that do not number their records', 'Records without a document number',
    ]))
  })

  it('approval waiting past the policy time is a finding', () => {
    const pending = sub({ approval_status: 'pending', submitted_at: '2026-11-05T00:00:00Z' })
    const pack = buildAuditPack({ templates: [tpl()], submissions: [pending], policy: { supervisor_approval_sla_hours: 24 }, now: NOW })
    expect(pack.records[0].overdue_approval).toBe(true)
    expect(pack.findings.some((f) => f.clause === '8.5.1' && f.severity === 'minor')).toBe(true)
  })

  it('a wide role list is an observation, never a non-conformity', () => {
    const roles = Array.from({ length: 23 }, (_, i) => `Role ${i}`)
    const pack = buildAuditPack({ templates: [tpl({ assignee_roles: roles })], submissions: [sub()], now: NOW })
    expect(pack.findings.find((f) => f.clause === '7.2')).toMatchObject({ severity: 'observation' })
  })

  it('a customer audit hides names by default; figures are identical across audit types', () => {
    const internal = buildAuditPack({ templates: [tpl()], submissions: [sub()], type: 'internal', now: NOW })
    const customer = buildAuditPack({ templates: [tpl()], submissions: [sub()], type: 'customer', now: NOW })
    expect(customer.records[0].submitted_by).toBe('Recorded')
    expect(internal.records[0].submitted_by).toBe('Hasan')
    expect(customer.summary.records).toBe(internal.summary.records)
    expect(customer.findings.length).toBe(internal.findings.length)
    expect(auditType('nope').key).toBe('internal')
  })

  it('no records reads N/A, not 0%', () => {
    const pack = buildAuditPack({ templates: [tpl()], submissions: [], now: NOW })
    expect(pack.summary.approval_rate).toBeNull()
    expect(pack.summary.action_coverage).toBeNull()
    expect(summaryRows(pack.summary).find(([k]) => k === 'Sign-off rate')[1]).toBe('N/A')
  })
})

describe('review fixes', () => {
  it('uses the legend saved on the record, not the current form', () => {
    const t = tpl({ option_sets: { legend: { blocking: ['FAIL'] } } })
    const s = sub({ answers: { f1: 'Not OK' }, template_snapshot: { option_sets: { legend: { blocking: ['Not OK'] } }, fields: [{ id: 'f1', label: 'Brakes' }] } })
    expect(recordFaults(s, t)).toEqual([{ key: 'f1', label: 'Brakes', mark: 'Not OK' }])
  })
  it('times the area-manager rung from the supervisor signature, against its own limit', () => {
    const s = sub({ approval_status: 'pending_area_manager', submitted_at: '2026-11-01T00:00:00Z', supervisor_at: '2026-11-08T10:00:00Z' })
    const pack = buildAuditPack({ templates: [tpl()], submissions: [s], policy: { supervisor_approval_sla_hours: 24, area_manager_approval_sla_hours: 48 }, now: NOW })
    expect(pack.records[0].waiting_hours).toBe(2)
    expect(pack.records[0].overdue_approval).toBe(false)
  })
  it('an unreadable policy withholds approval-time findings and the retention period', () => {
    const s = sub({ approval_status: 'pending', submitted_at: '2026-10-01T00:00:00Z' })
    const pack = buildAuditPack({ templates: [tpl()], submissions: [s], policy: null, now: NOW })
    expect(pack.records[0].overdue_approval).toBe(false)
    expect(pack.findings.some((f) => f.title.startsWith('Approvals waiting'))).toBe(false)
    expect(pack.summary.retention).toMatch(/Not available/)
  })
})
