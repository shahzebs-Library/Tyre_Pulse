import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseWorkbookRaw } from '../lib/import/parseWorkbook.js'
import {
  parseWorkshopSheet,
  parseWorkshopWorkbook,
  parseWorkshopFile,
  parseWorkshopDate,
  fieldForHeader,
  normaliseAssetNo,
} from '../lib/workshopStatus/excelParser.js'

const FIXTURE = path.resolve(__dirname, 'fixtures/workshopStatus/daily_morning_update.xlsx')

const HEADER = ['SR.NO', 'ASSET NO.', 'REG. NO.', 'JOB CARD NO.', 'LOCATION', 'PRODUCTION / FLEET COMPLIANT',
  'DIAGNOSTICS', 'BREAKDOWN DATE', 'DOWN DAYS', 'Workshop/Fleet  Production Account', 'REMARKS']
const row = (sr, asset, date = '01-10-2026', days = '6', extra = {}) =>
  [String(sr), asset, '1234 ABC', `JC/${sr}`, extra.site ?? 'NHC-ST', extra.complaint ?? 'TYRE PUNCTURE', '', date, days, 'WORKSHOP', extra.remarks ?? '']
const book = (rows, title = 'TRANSIT MIXER') => [
  ['GREEN CONCRETE COMPANY CJSC'], ['JOB CARD ENTRY'], ['07-Oct-26'], [title], HEADER, ...rows,
]

describe('workshop Excel parser - the real daily file', () => {
  let p
  beforeAll(async () => {
    const buf = fs.readFileSync(FIXTURE)
    const parsed = await parseWorkbookRaw(new Uint8Array(buf).buffer, { fileName: 'daily_morning_update.xlsx' })
    p = parseWorkshopWorkbook(parsed)
  })

  it('reads the report date and section structure', () => {
    expect(p.sheetName).toBe('October CR (7)')
    expect(p.reportDate).toBe('2026-10-07')
    expect(p.sections.filter((s) => !s.closed)).toHaveLength(4)
    expect(p.sections.filter((s) => s.closed).map((s) => s.title)).toEqual(['JOB CARD CLOSED DETAILS'])
    expect(p.sections.map((s) => s.rowCount)).toEqual([24, 6, 1, 5, 39])
  })

  it('counts 36 active, 39 closed, nothing invalid or duplicated', () => {
    expect(p.summary).toMatchObject({ active: 36, closed: 39, invalid: 0, duplicate: 0, sections: 5 })
  })

  it('active beats closed for TM411 and MP121', () => {
    for (const a of ['TM411', 'MP121']) {
      expect(p.active.some((r) => r.asset_no === a)).toBe(true)
      const c = p.closed.filter((r) => r.asset_no === a)
      expect(c.length).toBeGreaterThan(0)
      c.forEach((r) => expect(r.warnings).toContain('Also listed as active'))
    }
  })

  it('maps TM599 exactly as the file has it', () => {
    const r = p.active.find((x) => x.asset_no === 'TM599')
    expect(r.data).toMatchObject({
      site: 'QIDDIYA-ST', complaint: 'ABNORMAL SOUND FROM GEAR', diagnostics: 'REAR DIFF. PRODUCES SOUND',
      ooc_since: '2026-09-29', excel_down_days: 8, days_down: 8, department: 'WORKSHOP',
      source_remarks: 'WAITING FOR PARTS', vehicle_category: 'TRANSIT MIXER', job_card_ref: 'GCKR/JC/2987/0926',
    })
    expect(r.raw['ASSET NO.']).toBe('TM599')
  })

  it('maps every real header, the blank K/L headers are not reported', () => {
    expect(p.unmappedHeaders).toEqual([])
    expect(p.headerMap['Workshop /Fleet Production Account']).toBe('department')
    expect(p.headerMap['expected time to reelase']).toBe('excel_expected_release')
  })
})

describe('workshop Excel parser - synthetic files', () => {
  it('parses a valid file', () => {
    const p = parseWorkshopSheet(book([row(1, 'TM100'), row(2, 'tm 200')]), { sheetName: 'S' })
    expect(p.summary.active).toBe(2)
    expect(p.active[1].asset_no).toBe('TM200')
    expect(p.active[0].data.days_down).toBe(6)
  })

  it('rejects an empty workbook', () => {
    expect(() => parseWorkshopWorkbook({ sheets: [] })).toThrow(/No workshop vehicle rows found/)
    expect(() => parseWorkshopWorkbook({ sheets: [{ name: 'A', aoa: [[], ['']] }] })).toThrow(/No workshop vehicle rows found/)
  })

  it('rejects a file with no vehicle number column', () => {
    const aoa = [['SR.NO', 'LOCATION', 'DIAGNOSTICS', 'REMARKS'], ['1', 'NHC', 'x', 'y']]
    expect(() => parseWorkshopWorkbook({ sheets: [{ name: 'A', aoa }] })).toThrow(/no vehicle number column/)
  })

  it('flags a missing vehicle number as invalid', () => {
    const p = parseWorkshopSheet(book([row(1, ''), row(2, 'TM2')]))
    expect(p.invalid).toHaveLength(1)
    expect(p.invalid[0].errors).toContain('Missing vehicle number')
  })

  it('flags a duplicate vehicle among active rows only', () => {
    const p = parseWorkshopSheet([
      ...book([row(1, 'TM421'), row(2, 'TM421')]),
      ['JOB CARD CLOSED DETAILS'], HEADER, row(1, 'TM9'), row(2, 'TM9'),
    ])
    expect(p.duplicates).toHaveLength(1)
    expect(p.duplicates[0].errors).toContain('TM421 appeared more than once')
    expect(p.active).toHaveLength(1)
    expect(p.closed).toHaveLength(2)
  })

  it('folds extra spaces and NBSP in headers and values', () => {
    const header = HEADER.map((h) => `  ${h.replace(/ /g, '  ')} `)
    const p = parseWorkshopSheet([['07-Oct-26'], ['TRANSIT MIXER'], header,
      ['1', ' TM 300 ', '', '', '  NHC   ST ', 'A   B', '', '01-10-2026', '6', 'WORKSHOP', '']])
    expect(p.summary.active).toBe(1)
    expect(p.active[0].asset_no).toBe('TM300')
    expect(p.active[0].data.site).toBe('NHC ST')
    expect(p.active[0].data.complaint).toBe('A B')
  })

  it('flags an unreadable breakdown date', () => {
    const p = parseWorkshopSheet(book([row(1, 'TM1', '31/02/2026'), row(2, 'TM2', 'soon')]))
    expect(p.invalid).toHaveLength(2)
    expect(p.invalid[1].errors).toContain('Invalid breakdown date: soon')
  })

  it('reads ambiguous dd/mm day-first, never month-first', () => {
    expect(parseWorkshopDate('07/09/2026').value).toBe('2026-09-07')
    expect(parseWorkshopDate('07-09-26').value).toBe('2026-09-07')
    expect(parseWorkshopDate('2026-09-07').value).toBe('2026-09-07')
    expect(parseWorkshopDate('07-Oct-26').value).toBe('2026-10-07')
    expect(parseWorkshopDate('12/13/2026').value).toBeNull()
    expect(parseWorkshopDate(new Date(2026, 8, 7)).value).toBe('2026-09-07')
  })

  it('reads Excel serial dates', () => {
    expect(parseWorkshopDate(46302).value).toBe('2026-10-07')
    expect(parseWorkshopDate('46302').value).toBe('2026-10-07')
    const p = parseWorkshopSheet(book([row(1, 'TM1', 46295, '7')]))
    expect(p.active[0].data.ooc_since).toBe('2026-09-30')
    expect(p.active[0].data.days_down).toBe(7)
  })

  it('flags down days that disagree with the breakdown date', () => {
    const p = parseWorkshopSheet(book([row(1, 'TM1', '01-10-2026', '20')]))
    expect(p.active[0].data.down_days_mismatch).toBe(true)
  })

  it('reports unknown columns', () => {
    const p = parseWorkshopSheet([['TRANSIT MIXER'], [...HEADER, 'Driver Mobile'], [...row(1, 'TM1'), '0500']])
    expect(p.unmappedHeaders).toEqual(['Driver Mobile'])
    expect(p.active[0].raw['Driver Mobile']).toBe('0500')
  })

  it('skips blank rows', () => {
    const p = parseWorkshopSheet(book([row(1, 'TM1'), [], ['', '', ''], row(2, 'TM2')]))
    expect(p.summary.totalRows).toBe(2)
  })

  it('parses 500+ rows quickly', () => {
    const many = Array.from({ length: 600 }, (_, i) => row(i + 1, `TM${1000 + i}`))
    const t0 = performance.now()
    const p = parseWorkshopSheet(book(many))
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(p.summary.active).toBe(600)
  })

  it('maps shuffled column order', () => {
    const order = [4, 1, 7, 0, 10, 2, 5, 3, 9, 8, 6]
    const shuffle = (r) => order.map((i) => r[i])
    const p = parseWorkshopSheet([['TRANSIT MIXER'], shuffle(HEADER), shuffle(row(1, 'TM77', '29-09-2026', '8', { site: 'QIDDIYA-ST' }))],
      { today: '2026-10-07' })
    expect(p.active[0].asset_no).toBe('TM77')
    expect(p.active[0].data).toMatchObject({ site: 'QIDDIYA-ST', ooc_since: '2026-09-29', days_down: 8, department: 'WORKSHOP' })
  })

  it('resolves header aliases', () => {
    expect(fieldForHeader('Vehicle Number')).toBe('asset_no')
    expect(fieldForHeader('Workshop /Fleet  Production  Account')).toBe('department')
    expect(fieldForHeader('OOC Since')).toBe('ooc_since')
    expect(normaliseAssetNo(' tm 42 1 ')).toBe('TM421')
  })

  it('validates the file type and parses a real File', async () => {
    await expect(parseWorkshopFile({ name: 'x.pdf', size: 10 })).rejects.toThrow(/Only Excel/)
    const buf = fs.readFileSync(FIXTURE)
    const file = { name: 'daily.xlsx', size: buf.length, arrayBuffer: async () => new Uint8Array(buf).buffer }
    const out = await parseWorkshopFile(file)
    expect(out.preview.summary.active).toBe(36)
    expect(out.fileHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('workshop Excel parser - real cell values for dates', () => {
  const asFile = (buf, name = 'daily.xlsx') => {
    const u8 = new Uint8Array(buf)
    return { name, size: u8.length, arrayBuffer: async () => u8.slice().buffer }
  }

  it('a date cell formatted m/d/yy is read from its value, not as day-first text', async () => {
    const XLSX = await import('xlsx')
    const aoa = [['TRANSIT MIXER'], HEADER, ['1', 'TM700', '1234 ABC', 'JC/1', 'NHC', 'NO START', '', new Date(2026, 6, 5), '', 'WORKSHOP', '']]
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })
    ws.H3.z = 'm/d/yy'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    // The text reader would see "7/5/26" and read 7 May; the value is 5 July.
    const text = await parseWorkbookRaw(out, { fileName: 'x.xlsx' })
    expect(text.sheets[0].aoa[2][7]).toBe('7/5/26')
    const { preview } = await parseWorkshopFile(asFile(out), { today: '2026-07-10' })
    expect(preview.active[0].data.ooc_since).toBe('2026-07-05')
    expect(preview.active[0].data.days_down).toBe(5)
  })

  it('a date-time serial keeps its own day (no rounding into tomorrow)', () => {
    // 46208 = 2026-07-05; .75 = 18:00.
    expect(parseWorkshopDate(46208.75).value).toBe('2026-07-05')
    expect(parseWorkshopDate('46208.75').value).toBe('2026-07-05')
  })

  it('text dates still parse day-first through the binary reader', async () => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([['TRANSIT MIXER'], HEADER, row(1, 'TM701', '07/09/2026')])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const { preview } = await parseWorkshopFile(asFile(out), { today: '2026-09-10' })
    expect(preview.active[0].data.ooc_since).toBe('2026-09-07')
  })

  it('the real fixture through parseWorkshopFile keeps its counts and dates', async () => {
    const buf = fs.readFileSync(FIXTURE)
    const { preview } = await parseWorkshopFile(asFile(buf))
    expect(preview.reportDate).toBe('2026-10-07')
    expect(preview.summary).toMatchObject({ active: 36, closed: 39, invalid: 0, duplicate: 0 })
    const r = preview.active.find((x) => x.asset_no === 'TM599')
    expect(r.data).toMatchObject({ ooc_since: '2026-09-29', excel_down_days: 8, days_down: 8 })
  })
})
