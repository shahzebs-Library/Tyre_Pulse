import { describe, it, expect } from 'vitest'
import {
  normalizeCell, coerceNum, coerceInt, coerceDate,
  mapSheetToRows, deriveTyreActivity, validateExpense, isEmptyMappedRow,
  DATASETS,
} from '../lib/erpImport'

describe('normalizeCell', () => {
  it('treats the ERP literal NULL as null (case-insensitive)', () => {
    expect(normalizeCell('NULL')).toBeNull()
    expect(normalizeCell('null')).toBeNull()
    expect(normalizeCell(' Null ')).toBeNull()
  })
  it('treats blank / undefined / N/A as null', () => {
    expect(normalizeCell('')).toBeNull()
    expect(normalizeCell('   ')).toBeNull()
    expect(normalizeCell(undefined)).toBeNull()
    expect(normalizeCell(null)).toBeNull()
    expect(normalizeCell('N/A')).toBeNull()
    expect(normalizeCell('#N/A')).toBeNull()
  })
  it('trims real text and keeps numbers/dates', () => {
    expect(normalizeCell('  TM556  ')).toBe('TM556')
    expect(normalizeCell(42)).toBe(42)
    const d = new Date('2026-01-02')
    expect(normalizeCell(d)).toBe(d)
  })
})

describe('coerceNum / coerceInt', () => {
  it('parses numbers, strips separators + currency, else null', () => {
    expect(coerceNum('1,234.5')).toBe(1234.5)
    expect(coerceNum('SAR 900')).toBe(900)
    expect(coerceNum('NULL')).toBeNull()
    expect(coerceNum('abc')).toBeNull()
    expect(coerceNum('')).toBeNull()
  })
  it('coerceInt truncates', () => {
    expect(coerceInt('2019')).toBe(2019)
    expect(coerceInt('2019.9')).toBe(2019)
    expect(coerceInt('NULL')).toBeNull()
  })
})

describe('coerceDate', () => {
  it('accepts ISO, period YYYY-MM, and day/month-first exports', () => {
    expect(coerceDate('2026-07-14')).toBe('2026-07-14')
    expect(coerceDate('2026-07')).toBe('2026-07-01')
    expect(coerceDate('14/07/2026')).toBe('2026-07-14') // day-first (14 > 12)
    expect(coerceDate('07/09/2026')).toBe('2026-07-09') // ambiguous -> month-first
    expect(coerceDate(new Date('2026-03-05T00:00:00Z'))).toMatch(/^2026-03-0[45]$/)
  })
  it('returns null for NULL / junk', () => {
    expect(coerceDate('NULL')).toBeNull()
    expect(coerceDate('not a date')).toBeNull()
    expect(coerceDate('')).toBeNull()
  })
})

describe('mapSheetToRows', () => {
  it('maps header labels case/space/punctuation-insensitively and types them', () => {
    const sheet = [
      { 'Asset No': ' TM100 ', 'Asset Type': 'TR-MIXER', 'Model Year': '2019', 'Current KM': '1,200', 'Purchase Value': 'SAR 50000', Remarks: 'NULL' },
    ]
    const rows = mapSheetToRows('asset', sheet)
    expect(rows).toHaveLength(1)
    expect(rows[0].asset_no).toBe('TM100')
    expect(rows[0].asset_type).toBe('TR-MIXER')
    expect(rows[0].model_year).toBe(2019)
    expect(rows[0].current_km).toBe(1200)
    expect(rows[0].purchase_value).toBe(50000)
    expect(rows[0].remarks).toBeNull()
    expect(rows[0].source_row).toBe(1)
  })

  it('maps the raw ERP change-log header spellings (srno, fix_KM, old_serialno, Job Card No)', () => {
    const sheet = [
      { asset_no: 'A1', tire_pos: 'LHF1', srno: 'S-100', tire_size: '12R22.5', tyre_brand: 'Double Coin', fix_date: '2026-01-05', fix_KM: '1000', remove_date: 'NULL', old_serialno: 'NULL', 'Job Card No': 'JC-1', site: 'NHC' },
    ]
    const rows = mapSheetToRows('change', sheet)
    expect(rows[0].serial_no).toBe('S-100')
    expect(rows[0].tyre_size).toBe('12R22.5')
    expect(rows[0].fix_km).toBe(1000)
    expect(rows[0].fix_date).toBe('2026-01-05')
    expect(rows[0].remove_date).toBeNull()
    expect(rows[0].old_serial_no).toBeNull()
    expect(rows[0].job_card).toBe('JC-1')
  })

  it('ignores unmatched headers and produces one row per source row', () => {
    const sheet = [
      { serial_no: 'S1', 'Unknown Column': 'x', unit_cost: '100' },
      { serial_no: 'S2', unit_cost: 'NULL' },
    ]
    const rows = mapSheetToRows('expense', sheet)
    expect(rows).toHaveLength(2)
    expect(rows[0].unit_cost).toBe(100)
    expect(rows[1].serial_no).toBe('S2')
    expect(rows[1].unit_cost).toBeNull()
    expect(Object.keys(rows[0])).not.toContain('Unknown Column')
  })

  it('returns [] for a bad dataset or non-array', () => {
    expect(mapSheetToRows('nope', [])).toEqual([])
    expect(mapSheetToRows('asset', null)).toEqual([])
  })
})

describe('isEmptyMappedRow', () => {
  it('detects an all-blank mapped row', () => {
    const [row] = mapSheetToRows('expense', [{ 'Unknown Column': 'x' }])
    expect(isEmptyMappedRow('expense', row)).toBe(true)
    const [row2] = mapSheetToRows('expense', [{ serial_no: 'S1' }])
    expect(isEmptyMappedRow('expense', row2)).toBe(false)
  })
})

describe('deriveTyreActivity - current vs old', () => {
  it('marks the latest fix_date per (asset,position) active regardless of remove_date', () => {
    const rows = [
      { asset_no: 'A1', tire_pos: 'P1', serial_no: 'S1', fix_date: '2025-01-01', remove_date: null, old_serial_no: null },
      { asset_no: 'A1', tire_pos: 'P1', serial_no: 'S2', fix_date: '2026-06-01', remove_date: null, old_serial_no: 'S1' },
      { asset_no: 'A1', tire_pos: 'P2', serial_no: 'S3', fix_date: '2026-03-01', remove_date: null, old_serial_no: null },
    ]
    const out = deriveTyreActivity(rows)
    // preserves input order
    expect(out.map((r) => r.serial_no)).toEqual(['S1', 'S2', 'S3'])
    const bySerial = Object.fromEntries(out.map((r) => [r.serial_no, r]))
    expect(bySerial.S1.is_active).toBe(false)
    expect(bySerial.S2.is_active).toBe(true) // latest on A1/P1
    expect(bySerial.S3.is_active).toBe(true) // only one on A1/P2
    expect(bySerial.S2.chain_ok).toBe(true)  // old_serial S1 matches previous
  })

  it('flags a broken chain when old_serial_no does not match the previous fitment', () => {
    const rows = [
      { asset_no: 'A1', tire_pos: 'P1', serial_no: 'S1', fix_date: '2025-01-01', old_serial_no: null },
      { asset_no: 'A1', tire_pos: 'P1', serial_no: 'S2', fix_date: '2026-06-01', old_serial_no: 'WRONG' },
    ]
    const out = deriveTyreActivity(rows)
    const s2 = out.find((r) => r.serial_no === 'S2')
    expect(s2.chain_ok).toBe(false)
    expect(s2.warnings.some((w) => /old serial/i.test(w))).toBe(true)
  })

  it('warns on missing fix_date and serial_no', () => {
    const rows = [{ asset_no: 'A1', tire_pos: 'P1', serial_no: null, fix_date: null, old_serial_no: null }]
    const out = deriveTyreActivity(rows)
    expect(out[0].is_active).toBe(true) // only row in the group
    expect(out[0].warnings.some((w) => /fix date/i.test(w))).toBe(true)
    expect(out[0].warnings.some((w) => /serial/i.test(w))).toBe(true)
  })

  it('returns [] for non-array', () => {
    expect(deriveTyreActivity(null)).toEqual([])
  })
})

describe('validateExpense - cross-check with the change set', () => {
  it('flags orphan expense serials and change serials missing a cost', () => {
    const expense = [
      { serial_no: 'S1', unit_cost: 100 },
      { serial_no: 'S9', unit_cost: 200 }, // not in change set
      { serial_no: null, unit_cost: 50 },  // missing serial
    ]
    const changeSerials = ['S1', 'S2'] // S2 has no expense
    const out = validateExpense(expense, changeSerials)
    const bySerial = Object.fromEntries(out.rows.map((r) => [String(r.serial_no), r]))
    expect(bySerial.S1.serial_in_change).toBe(true)
    expect(bySerial.S9.serial_in_change).toBe(false)
    expect(bySerial.S9.warnings.some((w) => /not found/i.test(w))).toBe(true)
    expect(out.orphanSerials).toContain('S9')
    expect(out.missingExpenseSerials).toContain('s2') // normalised lower
  })

  it('accepts a Set of change serials and is case-insensitive', () => {
    const out = validateExpense([{ serial_no: 's1' }], new Set(['S1']))
    expect(out.rows[0].serial_in_change).toBe(true)
    expect(out.orphanSerials).toHaveLength(0)
  })

  it('returns empty structures for non-array input', () => {
    const out = validateExpense(null, null)
    expect(out.rows).toEqual([])
    expect(out.orphanSerials).toEqual([])
    expect(out.missingExpenseSerials).toEqual([])
  })
})

describe('DATASETS registry', () => {
  it('exposes the four datasets with destination tables', () => {
    expect(DATASETS.asset.table).toBe('erp_asset_import')
    expect(DATASETS.change.table).toBe('erp_tyre_change_import')
    expect(DATASETS.expense.table).toBe('erp_tyre_expense_import')
    expect(DATASETS.production.table).toBe('production_logs')
  })
})
