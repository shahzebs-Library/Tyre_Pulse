/**
 * What a downloaded checklist is called.
 *
 * Every sheet used to land as `Checklist <asset> English.pdf`, so a folder of
 * them was an indistinguishable pile. The document number V594 mints is what the
 * workshop files the paper copy under, so it has to survive into the filename -
 * which is exactly what the app-wide `reportFileName` would destroy, since it
 * strips every non-alphanumeric and would turn WDC-TM514-2026-0001 into four
 * loose fragments.
 */

import { describe, it, expect } from 'vitest'
import { checklistFileName } from '../lib/checklistPdf'

describe('checklistFileName', () => {
  it('keeps a document number intact, hyphens and all', () => {
    const n = checklistFileName(['Workshop Daily Checklist', 'WDC-TM514-2026-0001', '2026-08-18'])
    expect(n).toBe('Workshop Daily Checklist WDC-TM514-2026-0001 2026-08-18')
    // The number as printed on the sheet must be findable in the filename.
    expect(n).toContain('WDC-TM514-2026-0001')
  })

  it('falls back to the asset code when a sheet carries no document number', () => {
    expect(checklistFileName(['Fleet Transit Mixer', 'TM514', '2026-08-18']))
      .toBe('Fleet Transit Mixer TM514 2026-08-18')
  })

  it('does not append English - a suffix true of nearly every file distinguishes nothing', () => {
    expect(checklistFileName(['Workshop Daily Checklist', 'WDC-1'], { lang: 'en' }))
      .toBe('Workshop Daily Checklist WDC-1')
  })

  it('does name a non-English sheet, because that one is worth telling apart', () => {
    expect(checklistFileName(['Workshop Daily Checklist', 'WDC-1'], { lang: 'ar' }))
      .toMatch(/Arabic$/)
  })

  it('drops characters a filesystem should not carry, without collapsing the name', () => {
    expect(checklistFileName(['Brake / Tyre "check"', 'TM:514']))
      .toBe('Brake Tyre check TM 514')
  })

  it('skips blanks rather than leaving double spaces', () => {
    expect(checklistFileName(['Checklist', '', null, undefined, '2026-08-18']))
      .toBe('Checklist 2026-08-18')
  })

  it('never returns an empty name', () => {
    expect(checklistFileName([])).toBe('Checklist')
    expect(checklistFileName(['///'])).toBe('Checklist')
  })
})
