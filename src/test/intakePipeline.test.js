import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  parseWorkbook, suggestMapping, transformRow, validateRow, classifyDuplicates,
} from '../lib/import'

// Build a realistic work-order workbook (Gulf JC export headers) as an ArrayBuffer.
function makeWorkbook() {
  const aoa = [
    ['JC No.', 'Veh No.', 'Location', 'Complaints', 'Manpow Hrs', 'Total Spare Cost', 'Vehicle In Date', 'Tracking Category'],
    ['GCKR/JC/0001', 'BH009', 'KSP-TP', 'Tyre pressure', '2', '131', '2026-02-01', 'Active'],
    ['GCKR/JC/0002', 'BH010', 'KSP-TP', 'Puncture', '1.5', '90', '2026-02-02', 'Active'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

// Mirror the wizard's runValidation strip: an out-of-domain enum value is moved
// to custom_data and dropped from the committed column.
function stageRow(raw, mapping) {
  const { mapped, transformed, custom } = transformRow(raw, mapping, { module: 'workorder' })
  const v = validateRow(transformed, 'workorder')
  const cleanCustom = { ...custom }
  for (const iss of v.issues || []) {
    if (iss.code === 'ENUM_INVALID' && transformed[iss.field] != null) {
      cleanCustom[`${iss.field}__unmapped`] = transformed[iss.field]
      delete transformed[iss.field]
    }
  }
  return { transformed, custom: cleanCustom, status: v.status, issues: v.issues }
}

describe('intake pipeline - end-to-end parse→map→validate (workorder)', () => {
  it('parses an Excel upload and auto-maps the Gulf JC headers', async () => {
    const wb = await parseWorkbook(makeWorkbook())
    expect(wb.sheets[0].rows.length).toBe(2)
    const m = suggestMapping({ columns: wb.sheets[0].columns, module: 'workorder' })
    const t = Object.fromEntries(m.map((x) => [x.sourceHeader, x.target]))
    expect(t['JC No.']).toBe('work_order_no')
    expect(t['Veh No.']).toBe('asset_no')
    expect(t['Location']).toBe('site')
    expect(t['Total Spare Cost']).toBe('parts_cost')
    expect(t['Vehicle In Date']).toBe('opened_at')
  })

  it('a foreign status value does NOT error the row - it warns, is stageable, and is preserved in custom', async () => {
    const wb = await parseWorkbook(makeWorkbook())
    const sheet = wb.sheets[0]
    const mapping = suggestMapping({ columns: sheet.columns, module: 'workorder' })
    const staged = sheet.rows.map((r) => stageRow(r, mapping))

    // Every row is committable (warning, not error) - this is the fix.
    expect(staged.every((s) => s.status !== 'error')).toBe(true)
    // The out-of-domain status was dropped from the committed data...
    expect(staged[0].transformed.status).toBeUndefined()
    // ...and preserved verbatim in custom_data.
    expect(staged[0].custom.status__unmapped).toBe('Active')
    // ...with a visible warning carrying the allowed values.
    expect(staged[0].issues.some((i) => i.code === 'ENUM_INVALID' && i.severity === 'warning')).toBe(true)
    // real mapped fields survive
    expect(staged[0].transformed.work_order_no).toBe('GCKR/JC/0001')
    expect(staged[0].transformed.parts_cost).toBe(131)
  })

  it('classifyDuplicates does not collapse distinct work orders', async () => {
    const wb = await parseWorkbook(makeWorkbook())
    const mapping = suggestMapping({ columns: wb.sheets[0].columns, module: 'workorder' })
    const rows = wb.sheets[0].rows.map((r) => stageRow(r, mapping).transformed)
    const dup = classifyDuplicates(rows, 'workorder')
    expect(dup.every((r) => r.dup_status === 'none')).toBe(true)
  })
})
