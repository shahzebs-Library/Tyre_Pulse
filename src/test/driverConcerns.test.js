import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  CATEGORIES, isValidSubtype, isSensitiveCategory, nextLevel, levelRank, slaHours,
  deadlineState, canReopen, allowedActions, sortInbox, filterConcerns, summarize,
  translationFor, photoPath,
} from '../lib/driverConcerns'
import { buildConcernDocument, needsScriptImage, isRtlText } from '../lib/driverConcernPdf'
import en from '../locales/en/driverConcerns.json'
import ar from '../locales/ar/driverConcerns.json'
import ur from '../locales/ur/driverConcerns.json'

const NOW = new Date('2026-11-27T12:00:00Z')
const h = n => new Date(NOW.getTime() + n * 3600000).toISOString()
const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort()

describe('driver concern vocabulary mirrors the SQL', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/20261127191000_driver_concerns.sql'), 'utf8')
  it('every category and subtype appears in private.dc_valid_subtype', () => {
    for (const c of CATEGORIES) {
      expect(sql).toContain(`when '${c.key}'`)
      for (const s of c.subtypes) expect(sql).toContain(`'${s}'`)
    }
  })
  it('validates subtypes against their own category only', () => {
    expect(isValidSubtype('pay', 'salary_late')).toBe(true)
    expect(isValidSubtype('pay', 'harassment')).toBe(false)
    expect(isValidSubtype('nope', 'other')).toBe(false)
  })
  it('treatment is the sensitive category', () => {
    expect(isSensitiveCategory('treatment')).toBe(true)
    expect(isSensitiveCategory('pay')).toBe(false)
  })
})

describe('ladder', () => {
  it('non-sensitive: supervisor -> incharge -> manager -> top', () => {
    expect(nextLevel('supervisor', false)).toBe('incharge')
    expect(nextLevel('incharge', false)).toBe('manager')
    expect(nextLevel('manager', false)).toBeNull()
  })
  it('sensitive never passes through the pool', () => {
    expect(nextLevel('hr', true)).toBe('manager')
    expect(nextLevel('supervisor', true)).toBeNull()
    expect(nextLevel('manager', true)).toBeNull()
  })
  it('ranks', () => {
    expect(levelRank('supervisor')).toBe(1)
    expect(levelRank('hr')).toBe(2)
    expect(levelRank('manager')).toBe(3)
  })
  it('pay and safety are shorter', () => {
    expect(slaHours('manager', 'pay')).toBe(48)
    expect(slaHours('supervisor', 'safety')).toBe(48)
    expect(slaHours('supervisor', 'housing')).toBe(72)
  })
})

describe('deadlines', () => {
  it('unacknowledged past the ack deadline is overdue', () => {
    expect(deadlineState({ status: 'open', ack_due_at: h(-1), due_at: h(40) }, NOW)).toBe('overdue')
  })
  it('due soon inside 12 hours, ok otherwise', () => {
    expect(deadlineState({ status: 'in_review', acknowledged_at: h(-5), due_at: h(5) }, NOW)).toBe('due_soon')
    expect(deadlineState({ status: 'in_review', acknowledged_at: h(-5), due_at: h(30) }, NOW)).toBe('ok')
  })
  it('closed or no deadline is null, never on time', () => {
    expect(deadlineState({ status: 'accepted', due_at: h(-10) }, NOW)).toBeNull()
    expect(deadlineState({ status: 'outcome_shared', acknowledged_at: h(-1), due_at: null }, NOW)).toBeNull()
  })
  it('reopen only inside the window and only after a decision', () => {
    expect(canReopen({ status: 'accepted', reopen_deadline: h(24) }, NOW)).toBe(true)
    expect(canReopen({ status: 'accepted', reopen_deadline: h(-1) }, NOW)).toBe(false)
    expect(canReopen({ status: 'withdrawn', reopen_deadline: h(24) }, NOW)).toBe(false)
  })
})

describe('allowed actions mirror driver_concern_command', () => {
  const base = { status: 'open', level: 'supervisor', sensitive: false }
  it('driver: sign only after seeing the outcome', () => {
    const r = { ...base, status: 'outcome_shared' }
    expect(allowedActions(r, { isDriver: true }).has('sign')).toBe(false)
    expect(allowedActions({ ...r, outcome_seen_at: h(-1) }, { isDriver: true }).has('sign')).toBe(true)
  })
  it('supervisor cannot approve; manager can approve a proposal', () => {
    const r = { ...base, status: 'proposed', acknowledged_at: h(-1) }
    expect(allowedActions(r, { rank: 1 }).has('approve')).toBe(false)
    expect(allowedActions(r, { rank: 3 }).has('approve')).toBe(true)
  })
  it('a supervisor cannot act once the case is with the incharge', () => {
    const r = { ...base, level: 'incharge' }
    expect(allowedActions(r, { rank: 1 }).has('propose')).toBe(false)
    expect(allowedActions(r, { rank: 2 }).has('propose')).toBe(true)
  })
  it('the proposer never approves their own proposal', () => {
    const r = { ...base, status: 'proposed', acknowledged_at: h(-1), proposed_by: 'u1' }
    expect(allowedActions(r, { rank: 3, userId: 'u1' }).has('approve')).toBe(false)
    expect(allowedActions(r, { rank: 3, userId: 'u2' }).has('approve')).toBe(true)
  })
  it('the approver cannot take a proxy signature', () => {
    const r = { ...base, status: 'outcome_shared', entered_verbally: true, outcome_seen_at: h(-1), approved_by: 'u1', level: 'manager' }
    expect(allowedActions(r, { rank: 3, userId: 'u1' }).has('sign')).toBe(false)
    expect(allowedActions(r, { rank: 3, userId: 'u2' }).has('sign')).toBe(true)
    expect(allowedActions(r, { rank: 1, userId: 'u3' }).has('sign')).toBe(false)
  })
  it('no reclassify on an already sensitive case; nothing for rank 0', () => {
    expect(allowedActions({ ...base, sensitive: true, level: 'hr' }, { rank: 2 }).has('reclassify')).toBe(false)
    expect(allowedActions(base, { rank: 0 }).size).toBe(0)
  })
})

describe('inbox', () => {
  const rows = [
    { id: 'a', case_no: 'DC-2026-0001', status: 'in_review', acknowledged_at: h(-1), due_at: h(30), category: 'pay', level: 'supervisor', created_at: h(-50) },
    { id: 'b', case_no: 'DC-2026-0002', status: 'open', ack_due_at: h(-2), due_at: h(20), category: 'housing', level: 'supervisor', created_at: h(-10), sensitive: false },
    { id: 'c', case_no: 'DC-2026-0003', status: 'accepted', category: 'pay', level: 'manager', created_at: h(-100) },
    { id: 'd', case_no: 'DC-2026-0004', status: 'proposed', acknowledged_at: h(-1), due_at: h(100), category: 'treatment', sensitive: true, level: 'hr', created_at: h(-5) },
  ]
  it('overdue first', () => {
    expect(sortInbox(rows, NOW)[0].id).toBe('b')
  })
  it('filters', () => {
    expect(filterConcerns(rows, { status: 'open' }, NOW).map(r => r.id).sort()).toEqual(['a', 'b', 'd'])
    expect(filterConcerns(rows, { status: 'all', category: 'pay' }, NOW).map(r => r.id).sort()).toEqual(['a', 'c'])
    expect(filterConcerns(rows, { status: 'all', deadline: 'overdue' }, NOW).map(r => r.id)).toEqual(['b'])
    expect(filterConcerns(rows, { status: 'all', search: '0004' }, NOW).map(r => r.id)).toEqual(['d'])
    expect(filterConcerns(rows, { status: 'all', sensitive: 'yes' }, NOW).map(r => r.id)).toEqual(['d'])
  })
  it('summary', () => {
    expect(summarize(rows, NOW)).toEqual({ total: 4, open: 3, overdue: 1, awaitingApproval: 1, awaitingDriver: 0, sensitive: 1 })
  })
  it('translations are picked by source and language, and the path is scoped', () => {
    const tr = [{ source: 'concern', source_id: '', target_lang: 'ar', text: 'x' }]
    expect(translationFor(tr, 'concern', '', 'ar').text).toBe('x')
    expect(translationFor(tr, 'concern', '', 'ur')).toBeNull()
    expect(photoPath('org', 'uid', 'cu', 0)).toBe('org/uid/cu/0.jpg')
  })
})

describe('outcome PDF model', () => {
  const detail = {
    driver_name: 'Ali',
    chain_ok: true,
    concern: { case_no: 'DC-2026-0001', category: 'pay', subtype: 'salary_late', original_text: 'راتبي متأخر', original_lang: 'ar', outcome_text: 'Paid on 30 Nov', driver_decision: 'accepted', signed_at: h(-1), outcome_seen_at: h(-2), status: 'accepted', sensitive: false },
    translations: [{ source: 'concern', source_id: '', target_lang: 'en', text: 'My salary is late', model: 'claude-haiku-4-5', generated_at: h(-3) }],
    events: [{ created_at: h(-4), event_type: 'raised', actor_role: 'Driver', note: null }],
  }
  it('keeps the original, labels the machine translation and states the labour-office right', () => {
    const m = buildConcernDocument(detail, { readerLang: 'en' })
    expect(m.original.text).toBe('راتبي متأخر')
    expect(m.translation).toMatchObject({ text: 'My salary is late', model: 'claude-haiku-4-5' })
    expect(m.decision.decision).toBe('Accepted')
    expect(m.labourOffice).toMatch(/labour office/)
    expect(m.timeline).toHaveLength(1)
  })
  it('non-Latin text is drawn as an image, Arabic right to left', () => {
    expect(needsScriptImage('راتبي')).toBe(true)
    expect(isRtlText('راتبي')).toBe(true)
    expect(needsScriptImage('नमस्ते')).toBe(true)
    expect(isRtlText('नमस्ते')).toBe(false)
    expect(needsScriptImage('hello')).toBe(false)
  })
})

describe('locales', () => {
  it('ar and ur have every en key', () => {
    expect(keys(ar)).toEqual(keys(en))
    expect(keys(ur)).toEqual(keys(en))
  })
  it('every category, subtype and status has a label', () => {
    for (const c of CATEGORIES) {
      expect(en.categories[c.key]).toBeTruthy()
      for (const s of c.subtypes) expect(en.subtypes[s]).toBeTruthy()
    }
  })
})
