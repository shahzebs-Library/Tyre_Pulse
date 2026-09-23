import { describe, it, expect } from 'vitest'
import {
  summarizeResponsibilityDocs, docVerificationFor, uploaderNameFor, taqdeerDocMissing,
  showTaqdeerWarning, TAQDEER_WARNING,
} from '../lib/responsibilityDocs'
import { RESPONSIBILITY_DOCS } from '../lib/accidentCaseVocab'

const ev = (over) => ({
  id: 'e1', accident_id: 'a1', workstream_key: 'liability', requirement_key: 'najm_report',
  verification_status: 'unverified', uploaded_by: 'u1', uploaded_at: '2026-09-16T08:00:00Z',
  created_at: '2026-09-16T08:00:00Z', storage_ref: 'https://x/y.pdf', ...over,
})
const profiles = new Map([['u1', { id: 'u1', full_name: 'Sara Khan' }], ['u2', { id: 'u2', username: 'omar' }]])

describe('summarizeResponsibilityDocs', () => {
  it('emits one row per RESPONSIBILITY_DOCS entry, in vocabulary order, all missing when nothing is attached', () => {
    const s = summarizeResponsibilityDocs([])
    expect(s.rows.map((r) => r.key)).toEqual(RESPONSIBILITY_DOCS.map((d) => d.key))
    expect(s.rows.every((r) => r.status === 'missing' && r.uploader === 'Not set' && r.verification === 'missing')).toBe(true)
    expect(s.requiredTotal).toBe(6)
    expect(s.requiredDone).toBe(0)
    expect(s.counterLabel).toBe('0 of 6 required documents')
    expect(s.allRequiredAttached).toBe(false)
    expect(s.missingRequired).toHaveLength(6)
    expect(s.missingRequired).not.toContain('Company Letter / Undertaking')
  })

  it('counts only REQUIRED docs and resolves uploader + verification from the newest row', () => {
    const rows = [
      ev({ id: 'old', requirement_key: 'najm_report', uploaded_at: '2026-09-15T08:00:00Z', uploaded_by: 'u2', verification_status: 'rejected' }),
      ev({ id: 'new', requirement_key: 'najm_report', uploaded_at: '2026-09-16T09:00:00Z', uploaded_by: 'u1', verification_status: 'verified' }),
      ev({ id: 'opt', requirement_key: 'company_letter_undertaking' }),
      ev({ id: 'unrelated', requirement_key: 'vendor_quotation' }),
      ev({ id: 'nokey', requirement_key: null }),
    ]
    const s = summarizeResponsibilityDocs(rows, { profilesById: profiles })
    const najm = s.rows.find((r) => r.key === 'najm_report')
    expect(najm.status).toBe('attached')
    expect(najm.count).toBe(2)
    expect(najm.evidence.id).toBe('new')
    expect(najm.uploader).toBe('Sara Khan')
    expect(najm.verification).toBe('verified')
    expect(najm.time).toBe('2026-09-16T09:00:00Z')
    // The optional letter is attached but does not move the required counter.
    expect(s.rows.find((r) => r.key === 'company_letter_undertaking').status).toBe('attached')
    expect(s.requiredDone).toBe(1)
    expect(s.counterLabel).toBe('1 of 6 required documents')
    expect(s.missingRequired).toEqual([
      'Police Accident Report', 'Taqdeer Assessment', 'Third-party Registration Card',
      'Third-party Insurance Policy', 'Driver Licence',
    ])
  })

  it('reports all required attached at 6 of 6', () => {
    const rows = RESPONSIBILITY_DOCS.filter((d) => d.required).map((d, i) => ev({ id: `e${i}`, requirement_key: d.key }))
    const s = summarizeResponsibilityDocs(rows)
    expect(s.requiredDone).toBe(6)
    expect(s.allRequiredAttached).toBe(true)
    expect(s.missingRequired).toEqual([])
  })

  it('tolerates junk input', () => {
    expect(summarizeResponsibilityDocs(null).rows).toHaveLength(7)
    expect(summarizeResponsibilityDocs([null, undefined, {}]).requiredDone).toBe(0)
  })
})

describe('docVerificationFor / uploaderNameFor', () => {
  it('maps verification tokens to the 3-state label vocabulary', () => {
    expect(docVerificationFor(null)).toBe('missing')
    expect(docVerificationFor({ verification_status: 'verified' })).toBe('verified')
    expect(docVerificationFor({ verification_status: 'rejected' })).toBe('rejected')
    expect(docVerificationFor({ verification_status: 'unverified' })).toBe('pending')
    expect(docVerificationFor({})).toBe('pending')
  })
  it('never invents an uploader name', () => {
    expect(uploaderNameFor(ev({ uploaded_by: 'unknown' }), profiles)).toBe('Not set')
    expect(uploaderNameFor(ev({ uploaded_by: 'u2' }), profiles)).toBe('omar')
    expect(uploaderNameFor(ev({ uploaded_by: 'u1' }), { u1: { full_name: 'Plain Obj' } })).toBe('Plain Obj')
    expect(uploaderNameFor(ev({ uploaded_by: null, uploaded_by_name: 'From Row' }))).toBe('From Row')
    expect(uploaderNameFor(null)).toBe('Not set')
  })
})

describe('Taqdeer gate', () => {
  it('warns only when Taqdeer is required AND its document is missing', () => {
    const none = summarizeResponsibilityDocs([])
    const withTaqdeer = summarizeResponsibilityDocs([ev({ requirement_key: 'taqdeer_assessment' })])
    expect(taqdeerDocMissing(none)).toBe(true)
    expect(taqdeerDocMissing(withTaqdeer)).toBe(false)
    expect(showTaqdeerWarning(true, none)).toBe(true)
    expect(showTaqdeerWarning(true, withTaqdeer)).toBe(false)
    expect(showTaqdeerWarning(false, none)).toBe(false)
    expect(showTaqdeerWarning(null, none)).toBe(false)
    expect(TAQDEER_WARNING).toBe('Insurance claim can be drafted, but payer confirmation waits for Taqdeer assessment.')
    expect(TAQDEER_WARNING).not.toMatch(/[–—]/)
  })
})
