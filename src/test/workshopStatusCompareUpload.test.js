import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseWorkbookRaw } from '../lib/import/parseWorkbook.js'
import { parseWorkshopSheet, parseWorkshopWorkbook, parseWorkshopFile } from '../lib/workshopStatus/excelParser.js'
import {
  EXCEL_OWNED_FIELDS,
  TYREPULSE_OWNED_FIELDS,
  FIELD_LABELS,
  compareWorkshopUpload,
  DEFAULT_IGNORED_FIELDS,
  normaliseForCompare,
  normaliseSite,
  describeChange,
} from '../lib/workshopStatus/compareUpload.js'

const FIXTURE = path.resolve(__dirname, 'fixtures/workshopStatus/daily_morning_update.xlsx')
const HEADER = ['SR.NO', 'ASSET NO.', 'REG. NO.', 'JOB CARD NO.', 'LOCATION', 'PRODUCTION / FLEET COMPLIANT',
  'DIAGNOSTICS', 'BREAKDOWN DATE', 'DOWN DAYS', 'Workshop/Fleet  Production Account', 'REMARKS']
const row = (sr, asset, extra = {}) =>
  [String(sr), asset, '1234 ABC', extra.jc ?? `JC/${asset}`, extra.site ?? 'NHC-ST', extra.complaint ?? 'TYRE PUNCTURE', '',
    extra.date ?? '01-10-2026', '6', 'WORKSHOP', extra.remarks ?? '']
const sheet = (active, closed = []) => {
  const aoa = [['GREEN CONCRETE COMPANY CJSC'], ['JOB CARD ENTRY'], ['07-Oct-26'], ['TRANSIT MIXER'], HEADER, ...active]
  if (closed.length) aoa.push(['JOB CARD CLOSED DETAILS'], HEADER, ...closed)
  return parseWorkshopSheet(aoa, { sheetName: 'S' })
}

let seq = 0
/** A workshop_status_records row as the DB would hold it, built from a preview row. */
const recordFrom = (r, over = {}) => ({
  id: over.id ?? `rec-${String(++seq).padStart(4, '0')}`,
  country: 'KSA',
  asset_no: r.asset_no,
  current_active: true,
  ...Object.fromEntries(EXCEL_OWNED_FIELDS.map((f) => [f, r.data[f] ?? null])),
  site: normaliseSite(r.data.site), // what normalize_site stores
  current_stage: 'Diagnosis',
  delay_reason: 'Waiting parts',
  responsible_user_id: 'user-1',
  ...over,
})
const yesterdayFrom = (preview) => preview.active.map((r) => recordFrom(r))

describe('field ownership', () => {
  it('Excel-owned and TyrePulse-owned lists are disjoint', () => {
    const t = new Set(TYREPULSE_OWNED_FIELDS)
    expect(EXCEL_OWNED_FIELDS.filter((f) => t.has(f))).toEqual([])
    EXCEL_OWNED_FIELDS.forEach((f) => expect(FIELD_LABELS[f]).toBeTruthy())
  })

  it('every Excel-owned field is produced by the parser row.data', () => {
    const p = sheet([row(1, 'TM100')])
    for (const f of EXCEL_OWNED_FIELDS) expect(Object.prototype.hasOwnProperty.call(p.active[0].data, f)).toBe(true)
  })
})

describe('normaliseForCompare', () => {
  it('folds case, spacing, blanks, dates and numbers', () => {
    expect(normaliseForCompare('complaint', '  Tyre   puncture ')).toBe(normaliseForCompare('complaint', 'TYRE PUNCTURE'))
    expect(normaliseForCompare('complaint', '   ')).toBeNull()
    expect(normaliseForCompare('complaint', undefined)).toBeNull()
    expect(normaliseForCompare('ooc_since', '01-10-2026')).toBe('2026-10-01')
    expect(normaliseForCompare('ooc_since', '2026-10-01')).toBe('2026-10-01')
    expect(normaliseForCompare('excel_down_days', '6')).toBe(6)
    expect(normaliseForCompare('excel_down_days', 6)).toBe(6)
  })

  it('mirrors the site rule', () => {
    expect(normaliseSite(' nhc-st ')).toBe('NHC')
    expect(normaliseSite('QIDDIYA_ST')).toBe('QIDDIYA')
    expect(normaliseSite('DIRIYAH-ST2')).toBe('DIRIYAH-ST2')
    expect(normaliseSite('riy  sal')).toBe('RIY SAL')
    expect(normaliseSite('')).toBeNull()
  })

  it('describes a change in plain text', () => {
    expect(describeChange('complaint', 'X', 'Y')).toBe('Complaint: X -> Y')
    expect(describeChange('diagnostics', null, 'Gear')).toBe('Diagnostics: (blank) -> Gear')
  })
})

describe('compareWorkshopUpload - synthetic', () => {
  it('same list -> all unchanged', () => {
    const p = sheet([row(1, 'TM100'), row(2, 'TM200')])
    const c = compareWorkshopUpload(p, yesterdayFrom(p), { country: 'KSA' })
    expect(c.summary).toMatchObject({ previousActive: 2, new: 0, changed: 0, unchanged: 2, removed: 0 })
  })

  it('first upload -> all new, with Excel-owned data only', () => {
    const p = sheet([row(1, 'TM200'), row(2, 'TM100')])
    const c = compareWorkshopUpload(p, [], { country: 'KSA' })
    expect(c.newRecords.map((r) => r.asset_no)).toEqual(['TM100', 'TM200'])
    expect(Object.keys(c.newRecords[0].data).sort()).toEqual([...EXCEL_OWNED_FIELDS].sort())
    expect(c.summary).toMatchObject({ previousActive: 0, new: 2, rowsInFile: 2 })
  })

  it('a new vehicle', () => {
    const y = sheet([row(1, 'TM100')])
    const p = sheet([row(1, 'TM100'), row(2, 'TM300')])
    const c = compareWorkshopUpload(p, yesterdayFrom(y), { country: 'KSA' })
    expect(c.newRecords.map((r) => r.asset_no)).toEqual(['TM300'])
    expect(c.unchangedRecords).toHaveLength(1)
  })

  it('a removed vehicle, and several removed', () => {
    const y = sheet([row(1, 'TM100'), row(2, 'TM200'), row(3, 'TM300'), row(4, 'TM400')])
    const one = compareWorkshopUpload(sheet([row(1, 'TM100'), row(2, 'TM200'), row(3, 'TM300')]), yesterdayFrom(y))
    expect(one.removedRecords.map((r) => r.asset_no)).toEqual(['TM400'])
    expect(one.removedRecords[0].reason).toBe('missing_from_upload')
    const many = compareWorkshopUpload(sheet([row(1, 'TM300')]), yesterdayFrom(y))
    expect(many.removedRecords.map((r) => r.asset_no)).toEqual(['TM100', 'TM200', 'TM400'])
    expect(many.removedRecords[0].record).toMatchObject({ current_stage: 'Diagnosis', delay_reason: 'Waiting parts', responsible_user_id: 'user-1' })
  })

  it('a changed complaint reports only that field', () => {
    const y = sheet([row(1, 'TM100')])
    const p = sheet([row(1, 'TM100', { complaint: 'ENGINE NOT STARTING' })])
    const c = compareWorkshopUpload(p, yesterdayFrom(y))
    expect(c.changedRecords).toHaveLength(1)
    expect(c.changedRecords[0].changes).toEqual({ complaint: { from: 'TYRE PUNCTURE', to: 'ENGINE NOT STARTING' } })
    expect(c.changedRecords[0].recordId).toMatch(/^rec-/)
  })

  it('TyrePulse-owned fields never appear in changes, even when the row carries them', () => {
    const y = sheet([row(1, 'TM100')])
    const p = sheet([row(1, 'TM100')])
    p.active[0].data.current_stage = 'Released'
    p.active[0].data.responsible_user_id = 'someone-else'
    const records = yesterdayFrom(y).map((r) => ({ ...r, current_stage: 'Waiting parts', remarks: 'manual note' }))
    const c = compareWorkshopUpload(p, records)
    expect(c.unchangedRecords).toHaveLength(1)
    expect(c.changedRecords).toHaveLength(0)
    const p2 = sheet([row(1, 'TM100', { complaint: 'NEW' })])
    p2.active[0].data.current_stage = 'Released'
    const c2 = compareWorkshopUpload(p2, records)
    expect(Object.keys(c2.changedRecords[0].changes)).toEqual(['complaint'])
    for (const f of TYREPULSE_OWNED_FIELDS) expect(c2.changedRecords[0].changes[f]).toBeUndefined()
  })

  it('vehicle order changed in the Excel -> no spurious changes', () => {
    const y = sheet([row(1, 'TM100'), row(2, 'TM200'), row(3, 'TM300')])
    const p = sheet([row(1, 'TM300'), row(2, 'TM100'), row(3, 'TM200')])
    const c = compareWorkshopUpload(p, yesterdayFrom(y))
    expect(c.summary).toMatchObject({ new: 0, changed: 0, unchanged: 3, removed: 0 })
  })

  it('asset spacing/case differences still match', () => {
    const y = sheet([row(1, 'TM100')])
    const records = yesterdayFrom(y).map((r) => ({ ...r, asset_no: ' tm 100' }))
    const c = compareWorkshopUpload(sheet([row(1, 'Tm 1 00', { jc: 'JC/TM100' })]), records)
    expect(c.summary).toMatchObject({ new: 0, unchanged: 1, removed: 0 })
  })

  it('site -ST normalisation does not create a false change', () => {
    const y = sheet([row(1, 'TM100', { site: 'NHC-ST' })])
    const records = yesterdayFrom(y)
    expect(records[0].site).toBe('NHC')
    const c = compareWorkshopUpload(sheet([row(1, 'TM100', { site: 'nhc-st' })]), records)
    expect(c.changedRecords).toHaveLength(0)
    const moved = compareWorkshopUpload(sheet([row(1, 'TM100', { site: 'JED-ST' })]), records)
    expect(moved.changedRecords[0].changes.site).toEqual({ from: 'NHC', to: 'JED-ST' })
  })

  it('removed reason: listed_as_closed vs missing_from_upload', () => {
    const y = sheet([row(1, 'TM100'), row(2, 'TM200'), row(3, 'TM300')])
    const p = sheet([row(1, 'TM300')], [row(1, 'TM100'), row(2, 'TM100'), row(3, 'TM900')])
    const c = compareWorkshopUpload(p, yesterdayFrom(y))
    const byAsset = Object.fromEntries(c.removedRecords.map((r) => [r.asset_no, r]))
    expect(byAsset.TM100.reason).toBe('listed_as_closed')
    expect(byAsset.TM100.closedRow.asset_no).toBe('TM100')
    expect(byAsset.TM200.reason).toBe('missing_from_upload')
    expect(byAsset.TM200.closedRow).toBeUndefined()
    expect(c.removedAlsoListedClosed.map((r) => r.asset_no)).toEqual(['TM100'])
    // Closed rows only matter when the vehicle was not active: TM900 is informational.
    expect(c.closedRecords.map((r) => r.asset_no)).toEqual(['TM900'])
    expect(c.summary.rowsInFile).toBe(4)
  })

  it('empty preview against current records -> all removed', () => {
    const y = sheet([row(1, 'TM100'), row(2, 'TM200')])
    const c = compareWorkshopUpload({ active: [], closed: [], invalid: [], duplicates: [] }, yesterdayFrom(y))
    expect(c.summary).toMatchObject({ previousActive: 2, removed: 2, new: 0, rowsInFile: 0 })
    expect(compareWorkshopUpload(null, yesterdayFrom(y)).summary.removed).toBe(2)
  })

  it('duplicates and invalid rows pass through, the first occurrence still compares', () => {
    const p = sheet([row(1, 'TM100'), row(2, 'TM100'), row(3, ''), row(4, 'TM200', { date: '99-99-2026' })])
    const c = compareWorkshopUpload(p, [])
    expect(c.duplicateRecords.map((r) => r.asset_no)).toEqual(['TM100'])
    expect(c.invalidRecords).toHaveLength(2)
    expect(c.newRecords.map((r) => r.asset_no)).toEqual(['TM100'])
    expect(c.summary).toMatchObject({ new: 1, duplicate: 1, invalid: 2, rowsInFile: 4 })
  })

  it('records of another country are ignored', () => {
    const y = sheet([row(1, 'TM100')])
    const records = [...yesterdayFrom(y), recordFrom({ asset_no: 'TM555', data: {} }, { country: 'UAE' })]
    const c = compareWorkshopUpload(sheet([row(1, 'TM100')]), records, { country: 'ksa' })
    expect(c.summary).toMatchObject({ previousActive: 1, removed: 0 })
    const inactive = [...yesterdayFrom(y), recordFrom({ asset_no: 'TM777', data: {} }, { current_active: false })]
    expect(compareWorkshopUpload(sheet([row(1, 'TM100')]), inactive).summary.removed).toBe(0)
  })

  it('ignores the daily down-days counter by default, and can compare it when asked', () => {
    const y = sheet([row(1, 'TM100')])
    const records = yesterdayFrom(y).map((r) => ({ ...r, excel_down_days: 5 }))
    expect(DEFAULT_IGNORED_FIELDS).toEqual(['excel_down_days'])
    expect(compareWorkshopUpload(sheet([row(1, 'TM100')]), records).changedRecords).toHaveLength(0)
    expect(compareWorkshopUpload(sheet([row(1, 'TM100')]), records, { ignoreFields: [] }).changedRecords).toHaveLength(1)
  })
})

describe('compareWorkshopUpload - the real daily file', () => {
  let p
  beforeAll(async () => {
    const buf = fs.readFileSync(FIXTURE)
    const parsed = await parseWorkbookRaw(new Uint8Array(buf).buffer, { fileName: 'daily_morning_update.xlsx' })
    p = parseWorkshopWorkbook(parsed)
  })

  it('against a synthetic yesterday list', () => {
    expect(p.active.some((r) => r.asset_no === 'TM627')).toBe(false)
    expect(p.closed.some((r) => r.asset_no === 'TM627')).toBe(true)
    expect(p.active.some((r) => r.asset_no === 'TM595')).toBe(true)
    // One vehicle is new today: the last active row (not TM595) was not active yesterday.
    const dropped = [...p.active].reverse().find((r) => r.asset_no !== 'TM595')
    const yesterday = p.active
      .filter((r) => r !== dropped)
      .map((r) => (r.asset_no === 'TM595' ? recordFrom(r, { complaint: 'OLD COMPLAINT' }) : recordFrom(r)))
    yesterday.push(recordFrom({ asset_no: 'TM999', data: {} }))
    yesterday.push(recordFrom({ asset_no: 'TM627', data: {} }))
    const c = compareWorkshopUpload(p, yesterday, { country: 'KSA' })
    expect(c.summary).toMatchObject({ previousActive: 37, new: 1, changed: 1, unchanged: 34, removed: 2, invalid: 0, duplicate: 0 })
    expect(c.newRecords[0].asset_no).toBe(dropped.asset_no)
    expect(c.changedRecords[0].asset_no).toBe('TM595')
    expect(Object.keys(c.changedRecords[0].changes)).toEqual(['complaint'])
    const reasons = Object.fromEntries(c.removedRecords.map((r) => [r.asset_no, r.reason]))
    expect(reasons).toEqual({ TM627: 'listed_as_closed', TM999: 'missing_from_upload' })
    expect(c.removedAlsoListedClosed).toHaveLength(1)
    expect(c.summary.rowsInFile).toBe(36 + 39)
    // TM411 / MP121 are active and also closed: they are not "closed" outcomes.
    expect(c.closedRecords.some((r) => r.asset_no === 'TM411' || r.asset_no === 'MP121')).toBe(false)
  })

  it('the binary file reader gives the same comparison as the text reader', async () => {
    const buf = fs.readFileSync(FIXTURE)
    const u8 = new Uint8Array(buf)
    const { preview } = await parseWorkshopFile({ name: 'd.xlsx', size: u8.length, arrayBuffer: async () => u8.slice().buffer })
    const c = compareWorkshopUpload(preview, yesterdayFrom(p), { country: 'KSA' })
    expect(c.summary).toMatchObject({ new: 0, changed: 0, unchanged: 36, removed: 0 })
  })
})

describe('site alias mirror (normalize_site)', () => {
  it('applies the alias table before the store suffix rule', async () => {
    const { normaliseSite, normaliseForCompare } = await import('../lib/workshopStatus/compareUpload')
    const aliases = new Map([['RIYADH - METRO', 'RIY-MET'], ['DIRIYAH-G1-ST', 'DIRIYAH-G1']])
    expect(normaliseSite('  riyadh  -  metro ', aliases)).toBe('RIY-MET')
    expect(normaliseSite('diriyah-g1-st', aliases)).toBe('DIRIYAH-G1')
    expect(normaliseSite('JED-ST', aliases)).toBe('JED')
    expect(normaliseSite('JED-ST')).toBe('JED')
    expect(normaliseForCompare('site', 'Riyadh - Metro', { siteAliases: aliases })).toBe('RIY-MET')
  })
})
