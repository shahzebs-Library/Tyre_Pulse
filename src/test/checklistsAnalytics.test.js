import { describe, it, expect } from 'vitest'
import {
  statusBucket, prettyStatus, evidenceLabel, fieldCount, filterTemplates, summarizeTemplates,
  filterSubmissions, summarizeSubmissions, submissionDay, submissionExportRows, SUBMISSION_EXPORT_COLUMNS,
} from '../lib/checklistsAnalytics'

const TEMPLATES = [
  { id: 't1', name: 'Workshop sheet', category: 'Workshop', require_approval: true, fields: [{ id: 'd', type: 'date' }, { id: 's', type: 'section' }, { id: 'a', type: 'asset' }], assignee_roles: ['Mechanic'] },
  { id: 't2', name: 'Daily check', category: 'Vehicle', require_signature: true, fields: [] },
]
const NOW = Date.parse('2026-09-15T00:00:00Z')
const SUBS = [
  { id: 's1', template_id: 't1', template_name: 'Workshop sheet', status: 'approved', template_snapshot_status: 'exact', answers: { d: '2026-08-23', a: 'TM9' }, submitted_at: '2026-09-12T10:00:00Z', asset_no: '' },
  { id: 's2', template_id: 't2', template_name: 'Daily check', status: 'submitted', template_snapshot_status: 'legacy_unavailable', asset_no: 'TM1', site: 'NHC', submitted_at: '2026-07-01T10:00:00Z' },
  { id: 's3', template_id: 't2', template_name: 'Daily check', status: 'rejected', template_snapshot_status: 'missing_revision', submitted_at: '2026-09-14T10:00:00Z' },
]

describe('checklistsAnalytics', () => {
  it('buckets statuses and labels evidence honestly', () => {
    expect(statusBucket('in_review')).toBe('pending')
    expect(statusBucket(null)).toBe('pending')
    expect(statusBucket('weird')).toBe('other')
    expect(prettyStatus('in_review')).toBe('In Review')
    expect(evidenceLabel('exact')).toBe('Exact template evidence')
    expect(evidenceLabel(undefined)).toBe('Legacy evidence unavailable')
  })

  it('counts only answerable fields and summarises templates', () => {
    expect(fieldCount(TEMPLATES[0])).toBe(2)
    expect(summarizeTemplates(TEMPLATES)).toMatchObject({ total: 2, requireApproval: 1, requireSignature: 1, targeted: 1, categories: 2 })
    expect(filterTemplates(TEMPLATES, { category: 'Vehicle' })).toHaveLength(1)
    expect(filterTemplates(TEMPLATES, { query: 'workshop' })).toHaveLength(1)
  })

  it('uses the sheet date over the received date', () => {
    expect(submissionDay(SUBS[0], TEMPLATES)).toBe('2026-08-23')
    expect(submissionDay(SUBS[1], TEMPLATES)).toBe('2026-07-01')
  })

  it('filters by template link, evidence, status, dates and resolved target', () => {
    expect(filterSubmissions(SUBS, TEMPLATES, { templateId: 't2' }).map((s) => s.id)).toEqual(['s2', 's3'])
    expect(filterSubmissions(SUBS, TEMPLATES, { evidence: 'gap' }).map((s) => s.id)).toEqual(['s2', 's3'])
    expect(filterSubmissions(SUBS, TEMPLATES, { evidence: 'exact' }).map((s) => s.id)).toEqual(['s1'])
    expect(filterSubmissions(SUBS, TEMPLATES, { bucket: 'rejected' }).map((s) => s.id)).toEqual(['s3'])
    expect(filterSubmissions(SUBS, TEMPLATES, { from: '2026-08-01', to: '2026-08-31' }).map((s) => s.id)).toEqual(['s1'])
    // TM9 lives only in the answers; the search still finds it
    expect(filterSubmissions(SUBS, TEMPLATES, { query: 'tm9' }).map((s) => s.id)).toEqual(['s1'])
  })

  it('summarises with a null approval rate when nothing is decided', () => {
    const s = summarizeSubmissions(SUBS, NOW)
    expect(s).toMatchObject({ total: 3, approved: 1, pending: 1, rejected: 1, evidenceGaps: 2, last30Days: 2 })
    expect(s.approvalRatePct).toBe(50)
    expect(summarizeSubmissions([SUBS[1]], NOW).approvalRatePct).toBeNull()
    expect(summarizeSubmissions([], NOW).exactEvidencePct).toBeNull()
  })

  it('exports every column', () => {
    const out = submissionExportRows(SUBS, TEMPLATES)
    expect(Object.keys(out[0])).toEqual(SUBMISSION_EXPORT_COLUMNS.map((c) => c.key))
    expect(out[0]).toMatchObject({ asset: 'TM9', checklist_date: '2026-08-23', received: '2026-09-12' })
  })
})
