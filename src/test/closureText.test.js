// The two closure panels must read in English and Arabic. A missing key renders its raw path,
// so every sentence the panels can show is checked against both dictionaries here.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import en from '../locales/en/closure.json'
import ar from '../locales/ar/closure.json'
import { MESSAGE_KEYS, closureText } from '../lib/closureText'
import * as rules from '../lib/closureWorkflow'

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]))
const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8')
const tFor = (dict) => (key, vars) => {
  const v = key.split('.').slice(1).reduce((o, k) => (o == null ? undefined : o[k]), dict)
  if (typeof v !== 'string') return key
  return vars ? v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : v
}

describe('closure dictionaries', () => {
  it('English and Arabic carry exactly the same keys, all non-empty strings', () => {
    const e = flat(en); const a = flat(ar)
    expect(a.map(([k]) => k).sort()).toEqual(e.map(([k]) => k).sort())
    for (const [, v] of [...e, ...a]) expect(typeof v === 'string' && v.trim().length > 0).toBe(true)
  })
  it('Arabic values are Arabic, and keep the same placeholders as English', () => {
    const a = Object.fromEntries(flat(ar))
    for (const [k, v] of flat(en)) {
      expect(a[k], k).toMatch(/[\u0600-\u06FF]/)
      expect((a[k].match(/\{\w+\}/g) || []).sort(), k).toEqual((v.match(/\{\w+\}/g) || []).sort())
    }
  })
  it('no long dash in either language', () => {
    expect(JSON.stringify(en) + JSON.stringify(ar)).not.toMatch(/[\u2013\u2014]/)
  })
  it('every mapped sentence has its key in both languages', () => {
    for (const [text, key] of Object.entries(MESSAGE_KEYS)) {
      expect(en.msg[key], text).toBe(text)
      expect(typeof ar.msg[key], text).toBe('string')
    }
  })
})

describe('closureText', () => {
  it('translates a known sentence and passes an unknown one through unchanged', () => {
    expect(closureText(tFor(ar), 'Waiting for review')).toBe(ar.msg.waitingReview)
    expect(closureText(tFor(ar), 'Acknowledged, Action Required')).toBe(ar.msg.ackActionRequired)
    expect(closureText(tFor(en), 'Acknowledged, Action Required')).toBe('Acknowledged, Action Required')
    expect(closureText(tFor(ar), 'Attach at least 3 photographs as completion evidence.')).toBe(ar.msg.somePhotos)
    expect(closureText(tFor(ar), 'Something nobody mapped.')).toBe('Something nobody mapped.')
    expect(closureText(null, 'Waiting for review')).toBe('Waiting for review')
  })
  it('every sentence the rules can produce is mapped', () => {
    const produced = [
      rules.reviewLabel({ status: 'In Progress', review_status: 'submitted' }).text,
      rules.reviewLabel({ status: 'In Progress', review_status: 'returned' }).text,
      rules.reviewLabel({ status: 'In Progress', review_status: 'exception_requested' }).text,
      rules.reviewLabel({ status: 'Closed', review_status: 'exception' }).text,
      rules.reviewLabel({ status: 'Closed', review_status: 'approved' }).text,
      rules.reviewLabel({ status: 'Closed' }).text,
      rules.completionProblem({ note: '' }),
      rules.completionProblem({ note: 'Tyre replaced', photos: new Array(7).fill('x') }),
      rules.completionProblem({ note: 'Tyre replaced', photos: [] }, { minPhotos: 1 }),
      rules.completionProblem({ note: 'Tyre replaced', photos: [] }, { minPhotos: 2 }),
      rules.reviewProblem('return', ''),
      rules.exceptionProblem(''),
      rules.exceptionDecisionProblem('refuse', ''),
      rules.acknowledgedLabel({ approval_status: 'acknowledged' }).text,
      rules.acknowledgedLabel({ approval_status: 'acknowledged', ack_fault_state: 'exception' }).text,
      rules.acknowledgedLabel({ approval_status: 'acknowledged', ack_fault_state: 'fault_resolved' }).text,
      ...['approved', 'pending', 'pending_area_manager'].flatMap((st) => [
        rules.acknowledgeCheck({ submission: { approval_status: st }, twoStage: true, faultCount: 1, role: 'Tyre Man' }).reason,
        rules.acknowledgeCheck({ submission: { approval_status: st }, twoStage: true, faultCount: 1, role: 'Workshop Supervisor' }).reason,
        rules.acknowledgeCheck({ submission: { approval_status: st }, twoStage: false, faultCount: 1, role: 'Driver' }).reason,
        rules.acknowledgeCheck({ submission: { approval_status: st }, twoStage: false, faultCount: 0, role: 'Admin' }).reason,
        rules.acknowledgeCheck({ submission: { approval_status: st, submitted_by: 'u' }, userId: 'u', twoStage: false, faultCount: 1, role: 'Admin' }).reason,
        rules.acknowledgeCheck({ submission: { approval_status: st, approval_policy_required: true }, twoStage: false, faultCount: 1, role: 'Admin' }).reason,
      ]),
    ].filter(Boolean)
    for (const text of produced) expect(closureText(tFor(ar), text), text).toMatch(/[\u0600-\u06FF]/)
  })
})

describe('the panels carry no hard-coded English', () => {
  const files = ['components/correctiveActions/ClosureReviewPanel.jsx', 'components/checklist/ChecklistFaultPanel.jsx',
    'components/correctiveActions/ClosureReviewSettings.jsx']
  it('every visible string goes through t()', () => {
    for (const f of files) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
      // JSX text between tags: two or more English words in a row that are not inside braces.
      const text = [...src.matchAll(/>\s*([A-Z][a-z]+(?: [A-Za-z(),.']+){1,})\s*</g)].map((m) => m[1])
      expect(text, f).toEqual([])
      const attrs = [...src.matchAll(/(?:placeholder|aria-label|title|label|alt)="([^"]*[a-z] [a-z][^"]*)"/g)].map((m) => m[1])
      expect(attrs, f).toEqual([])
    }
  })
  it('both panels use the dictionary', () => {
    for (const f of files) expect(read(f)).toMatch(/useLanguage\(\)/)
  })
})
