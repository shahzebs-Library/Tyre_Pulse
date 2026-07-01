import { describe, it, expect } from 'vitest'
import {
  suggestMapping,
  transformRow,
  validateRow,
  classifyDuplicates,
  countryConflict,
  exactAlias,
  parseDelimitedText,
  detectHeaderRow,
  rowFingerprint,
  NATURAL_KEY,
  MODULE_FIELDS,
} from '../lib/import'

describe('import engine — synonyms & mapping', () => {
  it('maps known English headers to canonical targets with high confidence', () => {
    const cols = ['Asset No', 'Tyre Serial', 'Site', 'Pressure (PSI)']
    const out = suggestMapping({ columns: cols, module: 'tyre' })
    const byHeader = Object.fromEntries(out.map((m) => [m.sourceHeader, m]))
    expect(byHeader['Asset No'].target).toBe('asset_no')
    expect(byHeader['Tyre Serial'].target).toBe('serial_no')
    expect(byHeader['Site'].target).toBe('site')
    // strong matches auto-map
    expect(byHeader['Asset No'].confidence).toBeGreaterThanOrEqual(90)
    expect(byHeader['Asset No'].action).toBe('auto')
  })

  it('recognises Arabic headers', () => {
    // رقم الإطار = tyre serial, الموقع = site
    expect(exactAlias('رقم الإطار', 'tyre')).toBe('serial_no')
    expect(exactAlias('الموقع', 'tyre')).toBe('site')
  })

  it('never discards an unmatched column — preserves it as custom', () => {
    const out = suggestMapping({ columns: ['Totally Unknown Column'], module: 'tyre' })
    expect(out[0].target).toBeNull()
    expect(out[0].action).toBe('preserve_custom')
  })

  it('scopes synonyms by module (stock vs tyre)', () => {
    // a stock description header should not map to a tyre field
    const stock = suggestMapping({ columns: ['Description'], module: 'stock' })
    expect(stock[0].target).toBe('description')
  })
})

describe('import engine — transform', () => {
  it('renames to targets, keeps custom, trims values', () => {
    const mapping = [
      { sourceHeader: 'Asset No', target: 'asset_no' },
      { sourceHeader: 'Tyre Serial', target: 'serial_no' },
      { sourceHeader: 'Notes', target: null },
    ]
    const raw = { 'Asset No': '  V-100 ', 'Tyre Serial': 'SN-1', 'Notes': 'keep me' }
    const { mapped, transformed, custom } = transformRow(raw, mapping, { module: 'tyre' })
    expect(mapped.asset_no).toBe('  V-100 ')              // mapped keeps the raw value
    expect(String(transformed.asset_no ?? '').trim()).toBe('V-100') // transformed is cleaned
    expect(transformed.serial_no).toBe('SN-1')
    expect(custom['Notes']).toBe('keep me')               // unmapped preserved
  })
})

describe('import engine — work order mapping (real Gulf JC export)', () => {
  it('maps the key work-order columns to the right target columns', () => {
    const cols = [
      'Veh No.', 'Driver Name', 'Tracking Category', 'Location', 'Workshop Location',
      'JC No.', 'Complaints', 'QC Remarks', 'Job Done Description', 'Manpow Hrs',
      'Vehicle In Date', 'Vehicle Out Date', 'Reason Of Repair', 'Spare Parts', 'Total Spare Cost',
    ]
    const rows = [{
      'Veh No.': 'BH009', 'Location': 'KSP-TP', 'Workshop Location': 'KSP_TP-ST',
      'JC No.': 'GCKR/JC/0053/0226', 'Vehicle In Date': '2026-02-01', 'Vehicle Out Date': '2026-02-02',
      'Manpow Hrs': '2.0', 'Total Spare Cost': '131.0',
    }]
    const out = suggestMapping({ columns: cols, module: 'workorder', sampleRows: rows })
    const t = Object.fromEntries(out.map((m) => [m.sourceHeader, m.target]))
    expect(t['Veh No.']).toBe('asset_no')
    expect(t['JC No.']).toBe('work_order_no')
    expect(t['Location']).toBe('site')
    expect(t['Workshop Location']).toBe('workshop_name')
    expect(t['Vehicle In Date']).toBe('opened_at')
    expect(t['Vehicle Out Date']).toBe('completed_at')
    expect(t['Reason Of Repair']).toBe('work_type')
    expect(t['Total Spare Cost']).toBe('parts_cost')
    // dates must NOT be mis-mapped onto an id column, hours must NOT hit a cost column
    expect(t['Vehicle In Date']).not.toBe('asset_no')
    expect(['work_order_no', 'asset_no', 'total_cost']).not.toContain(t['Manpow Hrs'])
  })

  it('maps the cost buckets (lubricants, tyres, outside repair) to real columns', () => {
    const cols = ['Lubricants', 'Tyres', 'Outside Rep Cost', 'Total BD Hrs', 'Std Hrs', 'KM/HR']
    const out = suggestMapping({ columns: cols, module: 'workorder' })
    const t = Object.fromEntries(out.map((m) => [m.sourceHeader, m.target]))
    expect(t['Lubricants']).toBe('lubricant_cost')
    expect(t['Tyres']).toBe('tyre_cost')
    expect(t['Outside Rep Cost']).toBe('outside_repair_cost')
    expect(t['Total BD Hrs']).toBe('breakdown_hours')
    expect(t['Std Hrs']).toBe('standard_hours')
    expect(t['KM/HR']).toBe('odometer')
  })

  it('sums the cost buckets into total_cost when no explicit total is provided', () => {
    const mapping = [
      { sourceHeader: 'Labour', target: 'labour_cost' },
      { sourceHeader: 'Spare', target: 'parts_cost' },
      { sourceHeader: 'Lub', target: 'lubricant_cost' },
      { sourceHeader: 'Tyres', target: 'tyre_cost' },
    ]
    const raw = { Labour: '100', Spare: '131', Lub: '69.5', Tyres: '840' }
    const { transformed } = transformRow(raw, mapping, { module: 'workorder' })
    expect(transformed.total_cost).toBe(1140.5)
  })
})

describe('import engine — tyre spend derivation', () => {
  it('maps quantity and derives the per-line total from qty × unit cost', () => {
    const mapping = [
      { sourceHeader: 'Serial', target: 'serial_no' },
      { sourceHeader: 'Asset', target: 'asset_no' },
      { sourceHeader: 'Qty', target: 'qty' },
      { sourceHeader: 'Unit Price', target: 'cost_per_tyre' },
    ]
    const raw = { Serial: 'SN1', Asset: 'A1', Qty: '4', 'Unit Price': '1,200.00' }
    const { transformed } = transformRow(raw, mapping, { module: 'tyre' })
    expect(transformed.qty).toBe(4)
    expect(transformed.cost_per_tyre).toBe(1200)
    expect(transformed.line_total).toBe(4800)
  })

  it('back-calculates unit cost when only quantity and total are provided', () => {
    const mapping = [
      { sourceHeader: 'Serial', target: 'serial_no' },
      { sourceHeader: 'Qty', target: 'qty' },
      { sourceHeader: 'Total', target: 'total_amount' },
    ]
    const raw = { Serial: 'SN2', Qty: '2', Total: '900' }
    const { transformed } = transformRow(raw, mapping, { module: 'tyre' })
    expect(transformed.cost_per_tyre).toBe(450)
    expect(transformed.line_total).toBe(900)
    expect(transformed.total_amount).toBeUndefined() // display-only alias dropped
  })
})

describe('import engine — country-scope guard', () => {
  it('flags a row whose country differs from the selected import country', () => {
    expect(countryConflict({ country: 'UAE' }, 'KSA')).toBe(true)
    expect(countryConflict({ country: 'United Arab Emirates' }, 'KSA')).toBe(true)
  })
  it('treats country aliases as the same country (no false conflict)', () => {
    expect(countryConflict({ country: 'Saudi Arabia' }, 'KSA')).toBe(false)
    expect(countryConflict({ country: 'SA' }, 'ksa')).toBe(false)
  })
  it('does not flag rows with no country value', () => {
    expect(countryConflict({ asset_no: 'A1' }, 'KSA')).toBe(false)
    expect(countryConflict({ country: '' }, 'KSA')).toBe(false)
  })
})

describe('import engine — validation', () => {
  it('flags a missing required field as an error', () => {
    const res = validateRow({ brand: 'X' }, 'tyre') // no serial_no/asset_no
    expect(res.status).toBe('error')
    expect(res.issues.some((i) => i.severity === 'error')).toBe(true)
  })

  it('passes a row with the required identifier', () => {
    const required = (MODULE_FIELDS.tyre || []).filter((f) => f.required).map((f) => f.key)
    const row = {}
    required.forEach((k) => { row[k] = 'X' })
    const res = validateRow(row, 'tyre')
    expect(res.status).not.toBe('error')
  })
})

describe('import engine — duplicate classification', () => {
  it('flags two rows sharing the natural key as duplicate', () => {
    expect(NATURAL_KEY.tyre).toBeTruthy()
    const rows = [
      { country: 'KSA', serial_no: 'DUP1', asset_no: 'A' },
      { country: 'KSA', serial_no: 'DUP1', asset_no: 'B' },
      { country: 'KSA', serial_no: 'UNIQUE', asset_no: 'C' },
    ]
    const out = classifyDuplicates(rows, 'tyre')
    const dupStatuses = out.map((r) => r.dup_status)
    expect(dupStatuses.filter((s) => s && s !== 'none').length).toBeGreaterThanOrEqual(1)
    // the unique row is not a duplicate
    expect(out[2].dup_status === 'none' || out[2].dup_status == null).toBe(true)
  })
})

describe('import engine — parsing helpers', () => {
  it('parses delimited CSV text into rows of arrays', () => {
    const aoa = parseDelimitedText('Asset No,Serial\nV-1,SN1\nV-2,SN2')
    expect(Array.isArray(aoa)).toBe(true)
    expect(aoa[0]).toContain('Asset No')
    expect(aoa.length).toBe(3)
  })

  it('detects the header row of an array-of-arrays', () => {
    const aoa = [[''], ['Asset No', 'Serial', 'Site'], ['V-1', 'SN1', 'Riyadh']]
    expect(detectHeaderRow(aoa)).toBe(1)
  })

  it('rowFingerprint is stable for equal content', () => {
    const a = rowFingerprint({ a: '1', b: 'x' })
    const b = rowFingerprint({ a: '1', b: 'x' })
    expect(a).toBe(b)
  })
})
