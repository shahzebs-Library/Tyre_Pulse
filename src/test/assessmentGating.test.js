import { describe, it, expect } from 'vitest'
import {
  attachmentStatus, attachmentKeyFor, recommendedRoute, canSubmit, totals, partsAvailabilityLabel, isTileRoute,
} from '../lib/assessmentGating'
import { ASSESSMENT_ATTACHMENTS } from '../lib/accidentCaseVocab'

const ev = (requirement_key, extra = {}) => ({ id: Math.random().toString(36), requirement_key, kind: 'document', verification_status: 'unverified', ...extra })

describe('attachmentStatus', () => {
  it('returns one row per ASSESSMENT_ATTACHMENTS entry, all missing on empty input', () => {
    const rows = attachmentStatus([])
    expect(rows.map((r) => r.key)).toEqual(ASSESSMENT_ATTACHMENTS.map((a) => a.key))
    expect(rows.every((r) => r.status === 'missing' && r.count === 0)).toBe(true)
  })

  it('counts stamped rows per key and treats a rejected file as not attached', () => {
    const rows = attachmentStatus([
      ev('vendor_quotation'),
      ev('damage_photos', { kind: 'photo' }), ev('damage_photos', { kind: 'photo' }),
      ev('assessment_report_pdf', { verification_status: 'rejected' }),
    ])
    const by = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(by.vendor_quotation.status).toBe('attached')
    expect(by.damage_photos.count).toBe(2)
    expect(by.assessment_report_pdf.status).toBe('missing')
    expect(by.recovery_request.required).toBe(false)
  })

  it('matches an unstamped photo to damage_photos but never calls a bare document a quotation', () => {
    expect(attachmentKeyFor({ kind: 'photo' })).toBe('damage_photos')
    expect(attachmentKeyFor({ kind: 'document' })).toBeNull()
    expect(attachmentKeyFor({ requirement_key: 'something_else', kind: 'document' })).toBeNull()
  })

  it('tolerates a non-array', () => {
    expect(attachmentStatus(null)).toHaveLength(ASSESSMENT_ATTACHMENTS.length)
  })
})

describe('recommendedRoute', () => {
  it('suggests external when any mark is severe', () => {
    expect(recommendedRoute([{ severity: 'minor' }, { severity: 'severe' }], {})).toBe('external')
  })
  it('suggests external when total loss is possible even with light marks', () => {
    expect(recommendedRoute([{ severity: 'minor' }], { total_loss_possible: true })).toBe('external')
  })
  it('suggests internal otherwise, including with no marks at all', () => {
    expect(recommendedRoute([{ severity: 'moderate' }], {})).toBe('internal')
    expect(recommendedRoute([], null)).toBe('internal')
  })
  it('never suggests on_site by itself', () => {
    expect(['internal', 'external']).toContain(recommendedRoute([{ severity: 'severe' }], {}))
  })
})

describe('canSubmit', () => {
  const draftRow = { id: 'a1', assessment_status: 'draft' }
  it('refuses with no saved assessment', () => {
    const r = canSubmit({ route: 'internal', evidenceRows: [], assessment: {} })
    expect(r.ok).toBe(false)
    expect(r.reasons).toContain('Save the assessment first.')
  })
  it('refuses without a route', () => {
    const r = canSubmit({ route: '', evidenceRows: [], assessment: draftRow })
    expect(r.ok).toBe(false)
    expect(r.reasons).toContain('Choose a repair route.')
  })
  it('requires the vendor quotation for the external route', () => {
    const r = canSubmit({ route: 'external', evidenceRows: [], assessment: draftRow })
    expect(r.ok).toBe(false)
    expect(r.reasons).toContain('Attach vendor quotation to enable submission to External Workshop.')
    const ok = canSubmit({ route: 'external', evidenceRows: [ev('vendor_quotation')], assessment: draftRow })
    expect(ok.ok).toBe(true)
  })
  it('does not require a quotation for internal or on-site', () => {
    expect(canSubmit({ route: 'internal', evidenceRows: [], assessment: draftRow }).ok).toBe(true)
    expect(canSubmit({ route: 'on_site', evidenceRows: [], assessment: draftRow }).ok).toBe(true)
  })
  it('refuses an already submitted assessment', () => {
    const r = canSubmit({ route: 'internal', evidenceRows: [], assessment: { id: 'a1', assessment_status: 'submitted' } })
    expect(r.ok).toBe(false)
  })
})

describe('totals', () => {
  it('derives total = labour cost + parts cost and passes hours through', () => {
    expect(totals({ labourHours: 6, labourCost: 1200, partsCost: 3400 })).toEqual({ labourHours: 6, labourCost: 1200, partsCost: 3400, total: 4600 })
  })
  it('returns null total when neither cost is known (never 0)', () => {
    expect(totals({ labourHours: 4 }).total).toBeNull()
    expect(totals({}).total).toBeNull()
  })
  it('treats one known side as the total', () => {
    expect(totals({ partsCost: '250' }).total).toBe(250)
  })
  it('ignores junk', () => {
    expect(totals({ labourCost: 'abc', partsCost: 10 }).total).toBe(10)
  })
})

describe('partsAvailabilityLabel + isTileRoute', () => {
  it('prints "2 available · 1 special order"', () => {
    expect(partsAvailabilityLabel(2, 1)).toBe('2 available · 1 special order')
  })
  it('prints one side when only one counter exists and Not set when none', () => {
    expect(partsAvailabilityLabel(null, 3)).toBe('3 special order')
    expect(partsAvailabilityLabel(undefined, '')).toBe('Not set')
  })
  it('knows the three mock tiles from the legacy routes', () => {
    expect(isTileRoute('on_site')).toBe(true)
    expect(isTileRoute('dealer')).toBe(false)
  })
})
