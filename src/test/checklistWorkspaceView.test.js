import { describe, it, expect } from 'vitest'
import {
  workspaceBucket, classifyRow, templateForSubmission, workspaceSections, submissionFindings,
  workspaceKpis, listTabCounts, filterWorkspaceList, recentFindings, findingsBySection,
  submissionTrend, submissionPhotos, submissionHistory, localDayKey,
} from '../lib/checklistWorkspaceView'

const LEGEND = {
  options: ['OK', 'Not OK', 'Topped up', 'N/A'],
  meta: [
    { value: 'OK', icon: 'ok', tone: 'good' },
    { value: 'Not OK', icon: 'fault', tone: 'bad' },
    { value: 'Topped up', icon: 'topup', tone: 'fixed' },
    { value: 'N/A', icon: 'na', tone: 'muted' },
  ],
  blocking: ['Not OK'],
}

const TEMPLATE = {
  id: 't1',
  name: 'Workshop Daily',
  option_sets: { legend: LEGEND },
  fields: [
    { id: 's1', type: 'section', label: 'Engine' },
    { id: 'oil', type: 'select', label: 'Engine oil', options_ref: 'legend' },
    { id: 'belt', type: 'select', label: 'Fan belt', options_ref: 'legend' },
    { id: 's2', type: 'section', label: 'Brakes' },
    { id: 'pads', type: 'select', label: 'Brake pads', options_ref: 'legend' },
    { id: 'km', type: 'number', label: 'Odometer' },
    { id: 'sig', type: 'signature', label: 'Mechanic signature' },
  ],
}

const NOW = new Date(2026, 9, 6, 15, 0, 0).getTime()
const at = (daysAgo, hour = 9) => new Date(2026, 9, 6 - daysAgo, hour, 0, 0).toISOString()

const sub = (over = {}) => ({
  id: 's-1', template_id: 't1', template_name: 'Workshop Daily', asset_no: 'TM514', site: 'NHC',
  status: 'submitted', approval_status: 'approved', submitted_at: at(0),
  answers: { oil: 'OK', belt: 'Topped up', pads: 'Not OK', km: 1200 },
  notes: { pads: 'Worn to 2mm' }, photos: { pads: ['tp-storage://tyre-photos/a.jpg'] },
  ...over,
})

describe('workspaceBucket', () => {
  it('reads approval_status before the never-moving status column', () => {
    expect(workspaceBucket({ status: 'submitted', approval_status: 'approved' })).toBe('approved')
    expect(workspaceBucket({ status: 'submitted', approval_status: 'pending_area_manager' })).toBe('pending')
    expect(workspaceBucket({ status: 'submitted', approval_status: 'rejected' })).toBe('rejected')
    expect(workspaceBucket({ status: 'submitted', approval_status: 'not_required' })).toBe('completed')
  })
  it('falls back to the shared status buckets, and never guesses', () => {
    expect(workspaceBucket({ status: 'draft' })).toBe('draft')
    expect(workspaceBucket({ status: 'submitted' })).toBe('pending')
    expect(workspaceBucket({ status: 'mystery' })).toBe('other')
  })
})

describe('classifyRow', () => {
  it('maps legend tones and blocking marks', () => {
    expect(classifyRow({ answered: true, marks: [{ tone: 'good' }] })).toBe('ok')
    expect(classifyRow({ answered: true, marks: [{ tone: 'fixed' }] })).toBe('minor')
    expect(classifyRow({ answered: true, marks: [{ tone: 'muted' }] })).toBe('na')
    expect(classifyRow({ answered: true, marks: [{ tone: 'good', blocking: true }] })).toBe('issue')
  })
  it('only reads plain answers when the word is unambiguous', () => {
    expect(classifyRow({ answered: true, marks: [], value: 'Fail' })).toBe('issue')
    expect(classifyRow({ answered: true, marks: [], value: 'pass' })).toBe('ok')
    expect(classifyRow({ answered: true, marks: [], value: 'N/A' })).toBe('na')
    expect(classifyRow({ answered: true, marks: [], value: 1200 })).toBe('recorded')
    expect(classifyRow({ answered: true, marks: [], value: false })).toBe('recorded')
  })
  it('an unanswered line is never a verdict', () => {
    expect(classifyRow({ answered: false, marks: [], value: 'Fail' })).toBe('unanswered')
    expect(classifyRow(null)).toBe('unanswered')
  })
})

describe('templateForSubmission', () => {
  it('prefers the frozen snapshot, then the live template', () => {
    const snap = { fields: [{ id: 'x', type: 'text', label: 'Snap' }] }
    expect(templateForSubmission(sub({ template_snapshot: snap }), [TEMPLATE]).fields[0].label).toBe('Snap')
    expect(templateForSubmission(sub(), [TEMPLATE])).toBe(TEMPLATE)
    expect(templateForSubmission(sub({ template_id: 'gone' }), [TEMPLATE])).toBeNull()
  })
})

describe('workspaceSections + findings', () => {
  it('keeps every line, classifies it, and counts answered/total per section', () => {
    const secs = workspaceSections(sub({ answers: { oil: 'OK', pads: 'Not OK' } }), TEMPLATE)
    expect(secs.map((s) => s.label)).toEqual(['Engine', 'Brakes'])
    expect(secs[0]).toMatchObject({ answered: 1, total: 2, complete: false, issues: 0 })
    expect(secs[0].rows.map((r) => r.status)).toEqual(['ok', 'unanswered'])
    expect(secs[1]).toMatchObject({ answered: 1, total: 2, issues: 1 })
    expect(secs.flatMap((s) => s.rows).some((r) => r.id === 'sig')).toBe(false)
  })
  it('a corrected-on-site mark is Minor, not a finding', () => {
    const f = submissionFindings(sub(), TEMPLATE)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ id: 'pads', section: 'Brakes', note: 'Worn to 2mm' })
  })
  it('a missing submission yields nothing, not a zero-filled sheet', () => {
    expect(workspaceSections(null, TEMPLATE)).toEqual([])
  })
})

describe('KPIs, tabs and list', () => {
  const subs = [
    sub({ id: 'a', approval_status: 'approved', submitted_at: at(0) }),
    sub({ id: 'b', approval_status: 'not_required', submitted_at: at(1) }),
    sub({ id: 'c', approval_status: 'pending', submitted_at: at(0, 11), asset_no: 'MP093' }),
    sub({ id: 'd', approval_status: 'rejected', submitted_at: at(3) }),
  ]
  const findings = new Map([['a', [{ id: 'pads', label: 'Brake pads', section: 'Brakes' }]], ['d', [
    { id: 'pads', label: 'Brake pads', section: 'Brakes' }, { id: 'oil', label: 'Engine oil', section: 'Engine' },
  ]]])

  it('headline figures', () => {
    const k = workspaceKpis(subs, findings)
    expect(k).toMatchObject({ total: 4, done: 2, donePct: 50, pending: 1, rejected: 1, failedItems: 3, withFindings: 2 })
  })
  it('an empty set reports N/A, not 0%', () => {
    expect(workspaceKpis([], new Map()).donePct).toBeNull()
  })
  it('tab counts and filtering, newest first', () => {
    expect(listTabCounts(subs, NOW)).toEqual({ all: 4, today: 2, pending: 1, rejected: 1 })
    expect(filterWorkspaceList(subs, { tab: 'today', now: NOW }).map((s) => s.id)).toEqual(['c', 'a'])
    expect(filterWorkspaceList(subs, { query: 'mp093', now: NOW }).map((s) => s.id)).toEqual(['c'])
    expect(filterWorkspaceList(subs, { tab: 'rejected', now: NOW }).map((s) => s.id)).toEqual(['d'])
  })
  it('recent findings and by-section grouping', () => {
    const rf = recentFindings(subs, findings)
    expect(rf.map((r) => r.submissionId)).toEqual(['a', 'd', 'd'])
    expect(findingsBySection(subs, findings)).toEqual([{ label: 'Brakes', count: 2 }, { label: 'Engine', count: 1 }])
  })
  it('folds the tail of sections into Other', () => {
    const many = new Map([['a', ['A', 'B', 'C', 'D', 'E', 'F', 'F'].map((s, i) => ({ id: i, section: s }))]])
    const out = findingsBySection([subs[0]], many, 3)
    expect(out[0]).toEqual({ label: 'F', count: 2 })
    expect(out[3]).toEqual({ label: 'Other sections', count: 3 })
  })
  it('30 day trend buckets by local day', () => {
    const tr = submissionTrend(subs, NOW, 30)
    expect(tr).toHaveLength(30)
    expect(tr[29]).toMatchObject({ day: localDayKey(NOW), done: 1, pending: 1, rejected: 0 })
    expect(tr[26].rejected).toBe(1)
  })
})

describe('photos and history', () => {
  it('flattens photos with their line label', () => {
    const s = sub()
    const ph = submissionPhotos(s, workspaceSections(s, TEMPLATE))
    expect(ph).toEqual([{ key: 'pads:0', src: 'tp-storage://tyre-photos/a.jpg', fieldId: 'pads', label: 'Brake pads' }])
    expect(submissionPhotos({ photos: null }, [])).toEqual([])
  })
  it('a sheet that needed no approval says so', () => {
    const h = submissionHistory(sub({ approval_status: 'not_required', printed_name: 'Ali' }), TEMPLATE)
    expect(h.map((e) => e.label)).toEqual(['Submitted', 'No approval required'])
    expect(h[0].name).toBe('Ali')
  })
  it('a rejected sheet carries the reason', () => {
    const h = submissionHistory(sub({ approval_status: 'rejected', review_note: 'Redo pads', approver_name: 'Vinay' }), TEMPLATE)
    expect(h[h.length - 1]).toMatchObject({ label: 'Rejected', name: 'Vinay', note: 'Redo pads' })
  })
})
