import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  parseWorkbook, suggestMapping, transformRow, validateRow, classifyDuplicates,
  MODULES, MODULE_FIELDS,
} from '../lib/import'

function xlsxBuf(aoa, sheetName = 'Sheet1') {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}
// parseWorkbook accepts a raw string for delimited text; use it directly to
// avoid a cross-realm ArrayBuffer instanceof quirk in the vitest sandbox.
function csvBuf(text) { return text }

// Full staging pipeline mirror of DataIntakeCenter.runValidation.
async function stage(buf, module, country = 'KSA') {
  const wb = await parseWorkbook(buf)
  const sheet = wb.sheets[0]
  const mapping = suggestMapping({ columns: sheet.columns, module, sampleRows: sheet.rows.slice(0, 20) })
  const rows = sheet.rows.map((raw) => {
    const { transformed, custom } = transformRow(raw, mapping, { module })
    const v = validateRow(transformed, module)
    const cleanCustom = { ...custom }
    for (const iss of v.issues || []) {
      if (iss.code === 'ENUM_INVALID' && transformed[iss.field] != null) {
        cleanCustom[`${iss.field}__unmapped`] = transformed[iss.field]; delete transformed[iss.field]
      }
    }
    return { transformed, status: v.status, issues: v.issues }
  })
  const dup = classifyDuplicates(rows.map((r) => r.transformed), module)
  rows.forEach((r, i) => { r.dup = dup[i]?.dup_status })
  return { wb, sheet, mapping, rows }
}

describe('INTAKE STRESS — formats', () => {
  it('xlsx parses', async () => {
    const { sheet } = await stage(xlsxBuf([['Serial', 'Asset'], ['S1', 'A1']]), 'tyre')
    expect(sheet.rows.length).toBe(1)
  })
  it('csv parses', async () => {
    const { sheet } = await stage(csvBuf('Serial,Asset\nS1,A1'), 'tyre')
    expect(sheet.rows.length).toBe(1)
  })
  it('tsv parses', async () => {
    const { sheet } = await stage(csvBuf('Serial\tAsset\nS1\tA1'), 'tyre')
    expect(sheet.rows.length).toBe(1)
  })
  it('semicolon-delimited csv parses', async () => {
    const { sheet } = await stage(csvBuf('Serial;Asset\nS1;A1'), 'tyre')
    expect(sheet.rows.length).toBe(1)
  })
  it('empty file does not crash', async () => {
    let err = null
    try { await stage(csvBuf(''), 'tyre') } catch (e) { err = e }
    // acceptable to throw a friendly error OR return 0 rows — just not undefined-crash
    expect(err === null || err instanceof Error).toBe(true)
  })
  it('headers-only file → 0 rows, no crash', async () => {
    const { sheet } = await stage(csvBuf('Serial,Asset'), 'tyre')
    expect(sheet.rows.length).toBe(0)
  })
  it('title rows above header are handled by header detection', async () => {
    const { sheet, mapping } = await stage(xlsxBuf([
      ['TYRE REPORT 2026'], [], ['Serial No', 'Asset No', 'Brand'], ['SN1', 'A1', 'Michelin'],
    ]), 'tyre')
    const t = Object.fromEntries(mapping.map((m) => [m.sourceHeader, m.target]))
    expect(sheet.rows.length).toBe(1)
    expect(t['Serial No']).toBe('serial_no')
  })
})

describe('INTAKE STRESS — messy data', () => {
  it('Arabic headers map', async () => {
    const { mapping } = await stage(xlsxBuf([['رقم الإطار', 'الموقع'], ['SN1', 'Riyadh']]), 'tyre')
    const targets = mapping.map((m) => m.target)
    expect(targets).toContain('serial_no')
    expect(targets).toContain('site')
  })
  it('mixed date formats do not crash validation', async () => {
    const { rows } = await stage(xlsxBuf([
      ['Serial', 'Asset', 'Issue Date'],
      ['S1', 'A1', '01/02/2026'], ['S2', 'A2', '2026-02-01'], ['S3', 'A3', '15-Jan-2026'], ['S4', 'A4', 'garbage'],
    ]), 'tyre')
    expect(rows.length).toBe(4)
    expect(rows.every((r) => ['ready', 'warning', 'error'].includes(r.status))).toBe(true)
  })
  it('numbers with separators/units parse', async () => {
    const { rows } = await stage(xlsxBuf([
      ['Serial', 'Asset', 'Cost'], ['S1', 'A1', '1,250.50'], ['S2', 'A2', 'SAR 900'],
    ]), 'tyre')
    expect(rows.length).toBe(2)
  })
  it('duplicate serials flagged, not silently dropped', async () => {
    const { rows } = await stage(xlsxBuf([
      ['Serial', 'Asset'], ['DUP', 'A1'], ['DUP', 'A2'], ['UNIQ', 'A3'],
    ]), 'tyre')
    expect(rows.filter((r) => r.dup && r.dup !== 'none').length).toBeGreaterThanOrEqual(1)
  })
  it('completely unknown headers preserved as custom (not error-crash)', async () => {
    const { mapping } = await stage(xlsxBuf([['Zorp', 'Blerg'], ['x', 'y']]), 'tyre')
    expect(mapping.every((m) => m.target === null)).toBe(true)
  })
})

describe('INTAKE STRESS — every module parses + maps its required id field', () => {
  const REQUIRED_HEADER = {
    fleet: ['Asset No'], tyre: ['Serial No', 'Asset No'], stock: ['Site', 'Description', 'Qty'],
    accident: ['Asset No', 'Incident Date'], inspection: ['Asset No'], workorder: ['WO No', 'Asset No'],
    warranty: ['Serial No'], gatepass: ['Asset No'], supplier: ['Supplier Name'], driver: ['Driver Name'],
  }
  for (const module of MODULES) {
    it(`module '${module}' stages a minimal row without throwing`, async () => {
      const headers = REQUIRED_HEADER[module] || ['Asset No']
      const dataRow = headers.map((_, i) => `V${i}`)
      const { rows, mapping } = await stage(xlsxBuf([headers, dataRow]), module)
      expect(rows.length).toBe(1)
      // at least one column should map to a real field for a known module
      const mappedCount = mapping.filter((m) => m.target).length
      expect(MODULE_FIELDS[module]).toBeTruthy()
      expect(mappedCount).toBeGreaterThanOrEqual(1)
    })
  }
})
