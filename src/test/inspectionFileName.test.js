import { describe, it, expect } from 'vitest'
import { inspectionReportFileName, inspectionReportFileNameForRow, inspectionDateLabel } from '../lib/inspectionFileName'
import { checklistReportFileName } from '../lib/inspectionChecklistReport'

describe('inspection report file name', () => {
  it('names the report by asset, site and inspection date', () => {
    expect(inspectionReportFileName({ asset: 'tm514', site: 'NHC', date: '2026-11-09' }))
      .toBe('Tyre Inspection Report TM514 NHC 09 Nov 2026.pdf')
  })
  it('drops missing parts and strips dashes and odd characters', () => {
    expect(inspectionReportFileName({ asset: 'MP-031', date: '2026-01-05T08:00:00Z' }))
      .toBe('Tyre Inspection Report MP 031 05 Jan 2026.pdf')
    expect(inspectionReportFileName({})).toBe('Tyre Inspection Report.pdf')
    expect(inspectionDateLabel('not a date')).toBe('')
  })
  it('reads the row fields used by the register and the checklist report', () => {
    expect(inspectionReportFileNameForRow({ asset_no: 'TM400', site: 'Diriyah-G1', inspection_date: '2026-07-30' }))
      .toBe('Tyre Inspection Report TM400 DIRIYAH G1 30 Jul 2026.pdf')
    expect(checklistReportFileName('TM400', 'NHC', '2026-07-30')).toBe('Tyre Inspection Report TM400 NHC 30 Jul 2026.pdf')
  })
})
