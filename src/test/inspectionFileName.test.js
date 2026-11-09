import { describe, it, expect } from 'vitest'
import { inspectionReportFileName, inspectionReportFileNameForRow, inspectionDateShort, ordinal } from '../lib/inspectionFileName'
import { checklistReportFileName } from '../lib/inspectionChecklistReport'

describe('inspection report file name', () => {
  it('is short: asset, site, inspection date and which inspection it is', () => {
    expect(inspectionReportFileName({ asset: 'tm514', site: 'NHC', date: '2026-11-09', number: 5 }))
      .toBe('Tyre Insp TM514 NHC 09Nov26 No5.pdf')
  })
  it('drops missing parts and strips dashes', () => {
    expect(inspectionReportFileName({ asset: 'MP-031', date: '2026-01-05T08:00:00Z' })).toBe('Tyre Insp MP 031 05Jan26.pdf')
    expect(inspectionReportFileName({ number: 0 })).toBe('Tyre Insp.pdf')
    expect(inspectionDateShort('nope')).toBe('')
  })
  it('reads row fields for the register and the checklist report', () => {
    expect(inspectionReportFileNameForRow({ asset_no: 'TM400', site: 'Diriyah-G1', inspection_date: '2026-07-30' }, 12))
      .toBe('Tyre Insp TM400 DIRIYAH G1 30Jul26 No12.pdf')
    expect(checklistReportFileName('TM400', 'NHC', '2026-07-30', 3)).toBe('Tyre Insp TM400 NHC 30Jul26 No3.pdf')
  })
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st'])
    expect(ordinal(null)).toBe('')
  })
})
