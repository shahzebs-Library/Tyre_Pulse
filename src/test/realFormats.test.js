/**
 * Real-format regression tests - the user's actual ERP report files committed
 * under docs/imports/. These are the formats the business uploads daily; every
 * one must parse (incl. XML Spreadsheet 2003 and HTML-grid .xls), auto-detect
 * its header row, strip report footers, and auto-map its headers.
 *
 * Skipped gracefully if the folder is removed.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { parseWorkbook, headerFingerprint } from '../lib/import/parseWorkbook'
import { suggestMapping } from '../lib/import/mapping'
import { aggregateStagedRows } from '../lib/import/aggregate'

const DIR = join(process.cwd(), 'docs', 'imports')
const has = (f) => existsSync(join(DIR, f))
const load = async (f) => {
  const buf = readFileSync(join(DIR, f))
  return parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}
const targets = (sheet, module) =>
  Object.fromEntries(
    suggestMapping({ columns: sheet.columns, module, sampleRows: sheet.rows.slice(0, 20) })
      .filter((m) => m.action === 'auto' || m.action === 'suggest')
      .map((m) => [m.sourceHeader, m.target]),
  )
const noFooters = (sheet) => {
  for (const r of sheet.rows) {
    const joined = Object.values(r).join(' ')
    expect(joined).not.toMatch(/printed by|printed date|grand total|applied filters/i)
  }
}

describe('real ERP formats (docs/imports)', () => {
  it.skipIf(!has('MONTHLY TYRES CONSUMPTION REPORT.xls'))('Monthly Tyres Consumption (.xls) - header row 3, footers stripped, tyre mapping', async () => {
    const wb = await load('MONTHLY TYRES CONSUMPTION REPORT.xls')
    const s = wb.sheets[0]
    expect(s.headerRow).toBe(2)
    expect(s.rows.length).toBeGreaterThan(0)
    noFooters(s)
    const t = targets(s, 'tyre')
    expect(t['VEH.NO']).toBe('asset_no')
    expect(t['TYRE No.']).toBe('serial_no')
    expect(t['ITEM/TYRE']).toBe('size')
    expect(t['TYRE FIX DATE']).toBe('issue_date')
    expect(t['TYRE REMOVED DATE']).toBe('removal_date')
    expect(t['FIXED HRS']).toBe('hrs_at_fitment')
    expect(t['TOTAL KM']).toBe('total_km')
    expect(t['Job Card No.']).toBe('job_card')
    // padded ERP cells must arrive trimmed
    for (const r of s.rows) expect(r['VEH.NO']).toBe(String(r['VEH.NO']).trim())
  })

  it.skipIf(!has('VEHICLE COMPLAINTS HISTORY.xls'))('Vehicle Complaints History (.xls) - GRAND TOTAL + printed-by footers stripped', async () => {
    const wb = await load('VEHICLE COMPLAINTS HISTORY.xls')
    const s = wb.sheets[0]
    expect(s.headerRow).toBe(2)
    expect(s.rows.length).toBeGreaterThan(5)
    noFooters(s)
    const t = targets(s, 'workorder')
    expect(t['JC No.']).toBe('work_order_no')
    expect(t['Vehicle In Date']).toBe('opened_at')
    expect(t['Total BD Hrs']).toBe('breakdown_hours')
  })

  it.skipIf(!has('Work Order Details.xls'))('Work Order Details (XML Spreadsheet 2003) - parses via SheetJS, Trye → tyre_cost', async () => {
    const wb = await load('Work Order Details.xls')
    const s = wb.sheets[0]
    expect(s.columns.map((c) => c.header)).toContain('Work Order Number')
    expect(s.columns.map((c) => c.header)).toContain('Trye')
    expect(s.rows.length).toBeGreaterThan(10)
    const t = targets(s, 'workorder')
    expect(t['Work Order Number']).toBe('work_order_no')
    expect(t['Trye']).toBe('tyre_cost')
  })

  it.skipIf(!has('aeqp_grid1 - 663654556509.xls'))('Ramco assets list (HTML-grid .xls) - real headers detected on a wide sparse grid', async () => {
    const wb = await load('aeqp_grid1 - 663654556509.xls')
    const s = wb.sheets[0]
    expect(s.headerRow).toBe(0)
    const headers = s.columns.map((c) => c.header)
    expect(headers).toContain('Asset No.')
    expect(headers).toContain('Plate No.')
    expect(s.rows.length).toBeGreaterThan(500)
    const t = targets(s, 'fleet')
    expect(t['Asset No.']).toBe('asset_no')
    expect(t['Asset Desc.']).toBe('model')
    expect(t['Plate No.']).toBe('registration_no')
    expect(t['Asset Location']).toBe('site')
    // date-headed columns must never suggest a non-date target
    expect(t['Driver Issue Date']).toBeUndefined()
  })

  it.skipIf(!has('data.xlsx'))('Open Job Cards follow-up (.xlsx) - "Applied filters" trailer stripped', async () => {
    const wb = await load('data.xlsx')
    const s = wb.sheets[0]
    noFooters(s)
    const t = targets(s, 'workorder')
    expect(t['Job Card No']).toBe('work_order_no')
    expect(t['Asset No']).toBe('asset_no')
  })

  it.skipIf(!has('Work Order Details.xls'))('header fingerprints are stable and distinct per format', async () => {
    const wb1 = await load('Work Order Details.xls')
    const wb2 = await load('Work Order Details.xls')
    const fp1 = headerFingerprint(wb1.sheets[0].columns)
    expect(fp1).toBe(headerFingerprint(wb2.sheets[0].columns))
    if (has('data.xlsx')) {
      const other = await load('data.xlsx')
      expect(fp1).not.toBe(headerFingerprint(other.sheets[0].columns))
    }
  })
})

describe('aggregateStagedRows - line-item files collapse to one row per record', () => {
  const row = (wo, tyre, extra = {}) => ({
    sourceRowNo: 1, raw: { wo, tyre }, mapped: {}, custom: {},
    transformed: { work_order_no: wo, tyre_cost: tyre, ...extra },
    validationStatus: 'ready', issues: [],
  })

  it('sums the declared cost field and keeps every source line', () => {
    const out = aggregateStagedRows(
      [row('JC-1', 766), row('JC-1', 900, { asset_no: 'TM1' }), row('JC-2', 714.4)],
      { by: 'work_order_no', sum: ['tyre_cost'] },
    )
    expect(out).toHaveLength(2)
    const jc1 = out.find((r) => r.transformed.work_order_no === 'JC-1')
    expect(jc1.transformed.tyre_cost).toBe(1666)
    expect(jc1.transformed.asset_no).toBe('TM1')      // first non-empty wins
    expect(jc1.custom.line_items).toHaveLength(2)     // audit trail preserved
    expect(jc1.custom.line_count).toBe(2)
  })

  it('rows without the key pass through; worst validation status wins', () => {
    const bad = { ...row('JC-3', 10), validationStatus: 'error' }
    const out = aggregateStagedRows(
      [row('', 5), row('JC-3', 20), bad],
      { by: 'work_order_no', sum: ['tyre_cost'] },
    )
    expect(out).toHaveLength(2)
    const jc3 = out.find((r) => r.transformed.work_order_no === 'JC-3')
    expect(jc3.transformed.tyre_cost).toBe(30)
    expect(jc3.validationStatus).toBe('error')
  })
})
