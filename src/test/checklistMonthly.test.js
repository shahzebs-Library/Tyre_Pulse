import { describe, it, expect } from 'vitest'
import {
  daysInMonth, elapsedDays, submissionDay, gridFields,
  monthlyGrid, monthlySummary, monthlyExportRows, isNotOk, cellText,
} from '../lib/checklistMonthly'
import { renderChecklistPdf, renderMonthlyGridPdf, canRenderText } from '../lib/checklistPdf'
import { submissionSignatures, submissionSections } from '../lib/checklistView'

// A cut-down copy of the seeded Fleet Transit Mixer template: two checks that
// share the status legend, plus the identification and sign-off furniture.
const TEMPLATE = {
  id: 'tpl-1',
  name: 'Fleet Transit Mixer Checklist',
  name_i18n: { ar: 'قائمة فحص الخلاطة', hi: 'फ्लीट ट्रांजिट मिक्सर चेकलिस्ट', ur: 'فليٹ ٹرانزٹ مکسر چيک لسٹ' },
  option_sets: {
    legend: {
      options: ['OK', 'Not OK', 'Not applicable', 'Changed', 'Repaired', 'Added / Top-Up'],
      i18n: {
        ar: ['سليم', 'غير سليم', 'لا ينطبق', 'تم التغيير', 'تم الإصلاح', 'تمت الإضافة'],
        hi: ['ठीक', 'ठीक नहीं', 'लागू नहीं', 'बदला गया', 'मरम्मत की गई', 'भरा गया'],
        ur: ['ٹھيک', 'ٹھيک نہيں', 'لاگو نہيں', 'تبديل کيا', 'مرمت کی', 'شامل کيا'],
      },
    },
  },
  fields: [
    { id: 's1', type: 'section', label: 'Identification', labels: { ar: 'بيانات التعريف' } },
    { id: 'f_date', type: 'date', label: 'Date' },
    { id: 'f_asset', type: 'asset', label: 'Transit mixer' },
    { id: 's2', type: 'section', label: 'Daily checks' },
    {
      id: 'c1', type: 'select', label: 'Check tyre pressure and wheel nuts',
      labels: { ar: 'تحقق من ضغط الإطارات', hi: 'टायर का प्रेशर जाँचें', ur: 'ٹائروں کا پريشر چيک کريں' },
      options_ref: 'legend', allow_note: true, allow_photo: true,
      options: ['OK', 'Not OK', 'Not applicable', 'Changed', 'Repaired', 'Added / Top-Up'],
    },
    {
      id: 'c2', type: 'select', label: 'Check engine oil level',
      options_ref: 'legend', allow_note: true, allow_photo: true,
      options: ['OK', 'Not OK', 'Not applicable', 'Changed', 'Repaired', 'Added / Top-Up'],
    },
    { id: 's3', type: 'section', label: 'Sign off' },
    { id: 'f_drv_name', type: 'text', label: 'Driver name' },
    { id: 'f_drv_sign', type: 'signature', label: 'Driver signature' },
    { id: 'f_fm_name', type: 'text', label: 'Fleet foreman name' },
    { id: 'f_fm_sign', type: 'signature', label: 'Fleet foreman signature' },
  ],
}

// A 1x1 transparent PNG - a real data URL, so jsPDF genuinely embeds it.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function day(d, { c1 = 'OK', c2 = 'OK', notes = null, at = null } = {}) {
  return {
    id: `sub-${d}`,
    template_id: 'tpl-1',
    answers: { f_date: `2026-06-${String(d).padStart(2, '0')}`, f_asset: 'TM514', c1, c2, f_drv_name: 'A. Khan' },
    photos: {},
    notes: notes || {},
    signatures: { f_drv_sign: PNG },
    submitted_at: at || `2026-06-${String(d).padStart(2, '0')}T06:00:00Z`,
  }
}

describe('checklistMonthly', () => {
  it('counts the days of a month', () => {
    expect(daysInMonth(2026, 6)).toBe(30)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 13)).toBe(0)
  })

  it('reads the day from the sheet date, not the upload time', () => {
    const sub = { answers: { f_date: '2026-06-03' }, submitted_at: '2026-06-04T05:00:00Z' }
    const got = submissionDay(sub, TEMPLATE.fields, { year: 2026, month: 6 })
    expect(got).toEqual({ day: 3, basis: 'sheet_date' })
  })

  it('falls back to the submission time when no date was captured', () => {
    const sub = { answers: {}, submitted_at: '2026-06-09T05:00:00Z' }
    expect(submissionDay(sub, TEMPLATE.fields, { year: 2026, month: 6 })).toEqual({ day: 9, basis: 'submitted' })
  })

  it('treats only the shared-legend lines as grid checks', () => {
    expect(gridFields(TEMPLATE.fields).map((f) => f.id)).toEqual(['c1', 'c2'])
  })

  // The point of the whole report: a day nobody checked the machine.
  it('reports a gap as missing, never as blank and never as OK', () => {
    const grid = monthlyGrid([day(1), day(2), day(5)], TEMPLATE, { year: 2026, month: 6, today: '2026-06-06' })
    expect(grid.submittedDays).toEqual([1, 2, 5])
    expect(grid.missingDays).toEqual([3, 4, 6])
    expect(grid.rows[0].byDay[3]).toBeUndefined()
    expect(cellText(grid.rows[0].byDay[3])).toBe('')
    expect(cellText(grid.rows[0].byDay[1])).toBe('OK')

    const s = monthlySummary(grid, { today: '2026-06-06' })
    expect(s.submitted).toBe(3)
    expect(s.missed).toBe(3)
    expect(s.coveragePct).toBe(50)
  })

  // A month in progress must not report the days that have not happened as missed.
  it('does not call a day that has not happened yet a missed day', () => {
    const grid = monthlyGrid([day(1), day(2)], TEMPLATE, { year: 2026, month: 6, today: '2026-06-02' })
    expect(grid.missingDays).toEqual([])
    expect(grid.pendingDays).toHaveLength(28)
    expect(monthlySummary(grid, { today: '2026-06-02' }).coveragePct).toBe(100)
  })

  it('withholds coverage for a month that has not started', () => {
    const grid = monthlyGrid([], TEMPLATE, { year: 2026, month: 9, today: '2026-06-02' })
    const s = monthlySummary(grid, { today: '2026-06-02' })
    expect(elapsedDays(2026, 9, '2026-06-02')).toBe(0)
    expect(s.coveragePct).toBeNull()
    expect(s.missed).toBe(0)
  })

  it('an empty month is every day missing, not a clean sheet', () => {
    const grid = monthlyGrid([], TEMPLATE, { year: 2026, month: 5, today: '2026-06-10' })
    expect(grid.submittedDays).toEqual([])
    expect(grid.missingDays).toHaveLength(31)
    const s = monthlySummary(grid, { today: '2026-06-10' })
    expect(s.coveragePct).toBe(0)
    expect(s.notOk).toBe(0)
    expect(s.checksRecorded).toBe(0)
  })

  it('counts a reported fault and carries its remark', () => {
    const grid = monthlyGrid(
      [day(1), day(2, { c1: 'Not OK', notes: { c1: 'Left rear nut loose' } })],
      TEMPLATE, { year: 2026, month: 6, today: '2026-06-02' },
    )
    expect(cellText(grid.rows[0].byDay[2])).toBe('X')
    const s = monthlySummary(grid, { today: '2026-06-02' })
    expect(s.notOk).toBe(1)
    expect(s.checksRecorded).toBe(4)
    expect(grid.remarks).toEqual([
      { day: 2, id: 'c1', label: 'Check tyre pressure and wheel nuts', note: 'Left rear nut loose' },
    ])
  })

  it('flags a fault on the English answer, whatever language is displayed', () => {
    const grid = monthlyGrid([day(1, { c1: 'Not OK' })], TEMPLATE, { year: 2026, month: 6, today: '2026-06-01', lang: 'ar' })
    expect(monthlySummary(grid, { today: '2026-06-01' }).notOk).toBe(1)
    expect(isNotOk('Not OK')).toBe(true)
    expect(isNotOk('OK')).toBe(false)
    expect(isNotOk(false)).toBe(true)
    expect(isNotOk('')).toBe(false)
  })

  // Two sheets for one day is a correction, not two days of work.
  it('keeps one day when a day was filled in twice, and says so', () => {
    const grid = monthlyGrid([
      day(4, { c1: 'OK', at: '2026-06-04T06:00:00Z' }),
      day(4, { c1: 'Not OK', at: '2026-06-04T18:00:00Z' }),
    ], TEMPLATE, { year: 2026, month: 6, today: '2026-06-05' })
    expect(grid.submittedDays).toEqual([4])
    expect(grid.duplicateDays).toEqual([4])
    expect(cellText(grid.rows[0].byDay[4])).toBe('X')
    expect(monthlySummary(grid, { today: '2026-06-05' }).duplicateDays).toBe(1)
  })

  it('ignores a submission from another month', () => {
    const other = { answers: { f_date: '2026-07-01' }, submitted_at: '2026-07-01T05:00:00Z' }
    const grid = monthlyGrid([day(1), other], TEMPLATE, { year: 2026, month: 6, today: '2026-06-02' })
    expect(grid.submittedDays).toEqual([1])
  })

  it('exports one row per line with a column per day', () => {
    const grid = monthlyGrid([day(1)], TEMPLATE, { year: 2026, month: 6, today: '2026-06-02' })
    const rows = monthlyExportRows(grid)
    expect(rows).toHaveLength(2)
    expect(rows[0].line).toBe('Check tyre pressure and wheel nuts')
    expect(rows[0].d1).toBe('OK')
    expect(rows[0].d2).toBe('')
    expect(Object.keys(rows[0])).toHaveLength(31)
  })
})

describe('checklistView sheet readers', () => {
  it('keeps every signature, not just the primary one', () => {
    const sub = {
      answers: { f_drv_name: 'A. Khan', f_fm_name: 'S. Omar' },
      signatures: { f_drv_sign: PNG, f_fm_sign: PNG },
    }
    const sigs = submissionSignatures(sub, { template: TEMPLATE })
    expect(sigs.map((s) => s.label)).toEqual(['Driver signature', 'Fleet foreman signature'])
    expect(sigs.map((s) => s.printedName)).toEqual(['A. Khan', 'S. Omar'])
    expect(sigs.every((s) => s.signed)).toBe(true)
  })

  it('shows an unsigned signature line as unsigned rather than hiding it', () => {
    const sigs = submissionSignatures({ answers: {}, signatures: { f_drv_sign: PNG } }, { template: TEMPLATE })
    expect(sigs).toHaveLength(2)
    expect(sigs[1].signed).toBe(false)
    expect(sigs[1].printedName).toBeNull()
  })

  it('keeps a No and a zero as answers', () => {
    const tpl = { fields: [{ id: 'b', type: 'boolean', label: 'Brakes OK' }, { id: 'n', type: 'number', label: 'Bar' }] }
    const rows = submissionSections({ answers: { b: false, n: 0 } }, { template: tpl })[0].rows
    expect(rows.map((r) => r.text)).toEqual(['No', '0'])
  })

  it('carries the per-line remark onto the row', () => {
    const rows = submissionSections(
      { answers: { c1: 'Not OK' }, notes: { c1: 'Nut loose' } },
      { template: TEMPLATE },
    ).flatMap((s) => s.rows)
    expect(rows.find((r) => r.id === 'c1').note).toBe('Nut loose')
  })
})

describe('checklistPdf (real jsPDF)', () => {
  const submission = {
    id: 'sub-real',
    template_id: 'tpl-1',
    template_name: 'Fleet Transit Mixer Checklist',
    asset_no: 'TM514',
    site: 'DIRIYAH-G1',
    country: 'KSA',
    submitted_at: '2026-06-02T06:00:00Z',
    answers: { f_date: '2026-06-02', f_asset: 'TM514', c1: 'Not OK', c2: 'OK', f_drv_name: 'A. Khan' },
    photos: { c1: [PNG] },
    notes: { c1: 'Left rear nut loose, retorqued' },
    signatures: { f_drv_sign: PNG },
    printed_name: 'A. Khan',
  }

  it('refuses text the standard PDF fonts cannot draw', () => {
    expect(canRenderText('Check engine oil level')).toBe(true)
    expect(canRenderText('Cafe latte 12.5 C')).toBe(true)
    expect(canRenderText('سليم')).toBe(false)
    expect(canRenderText('ठीक')).toBe(false)
  })

  it('produces real PDF bytes in English', async () => {
    const { doc, fellBack } = await renderChecklistPdf({
      submission, template: TEMPLATE, lang: 'en', save: false, company: 'Green Concrete',
    })
    const out = doc.output('arraybuffer')
    expect(out.byteLength).toBeGreaterThan(2000)
    expect(new TextDecoder('latin1').decode(new Uint8Array(out.slice(0, 5)))).toBe('%PDF-')
    expect(fellBack).toBe(false)
  })

  it('reports the fallback rather than printing broken glyphs for Arabic', async () => {
    const { doc, fellBack } = await renderChecklistPdf({
      submission, template: TEMPLATE, lang: 'ar', save: false,
    })
    expect(fellBack).toBe(true)
    const text = doc.output()
    // The English wording is what was drawn; no Arabic bytes were emitted.
    expect(text).toContain('%PDF-')
    expect(text.length).toBeGreaterThan(2000)
  })

  it('renders the month grid to real bytes, empty month included', async () => {
    const grid = monthlyGrid([day(1), day(3, { c1: 'Not OK' })], TEMPLATE, {
      year: 2026, month: 6, today: '2026-06-05',
    })
    const { doc } = await renderMonthlyGridPdf({
      grid, template: TEMPLATE, assetNo: 'TM514', today: '2026-06-05', save: false,
    })
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(2000)

    const empty = monthlyGrid([], TEMPLATE, { year: 2026, month: 5, today: '2026-06-05' })
    const res = await renderMonthlyGridPdf({ grid: empty, template: TEMPLATE, today: '2026-06-05', save: false })
    expect(res.doc.output('arraybuffer').byteLength).toBeGreaterThan(1000)
  })
})
