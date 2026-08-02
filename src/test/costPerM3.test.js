import { describe, it, expect } from 'vitest'
import {
  fmtMoney, fmtM3, fmtCostPerM3, toMonthStart, mapImportRows, IMPORT_TEMPLATES,
} from '../lib/costPerM3'

describe('formatters', () => {
  it('fmtMoney rounds, separates, prefixes currency; N/A on null', () => {
    expect(fmtMoney(1374855, 'SAR')).toBe('SAR 1,374,855')
    expect(fmtMoney(null)).toBe('N/A')
    expect(fmtMoney('597,688', 'SAR')).toBe('SAR 597,688')
  })
  it('fmtM3', () => {
    expect(fmtM3(299784)).toBe('299,784 M3')
    expect(fmtM3(null)).toBe('N/A')
  })
  it('fmtCostPerM3 uses 2 dp; N/A when no denominator', () => {
    expect(fmtCostPerM3(4.5862, 'SAR')).toBe('SAR 4.59/M3')
    expect(fmtCostPerM3(null, 'SAR')).toBe('N/A')
  })
})

describe('toMonthStart', () => {
  it('accepts YYYY-MM', () => { expect(toMonthStart('2026-07')).toBe('2026-07-01') })
  it('accepts YYYY-MM-DD (snaps to 1st)', () => { expect(toMonthStart('2026-07-22')).toBe('2026-07-01') })
  it('accepts DD-MM-YYYY (snaps to 1st)', () => { expect(toMonthStart('22-07-2026')).toBe('2026-07-01') })
  it('null on junk', () => { expect(toMonthStart('later')).toBeNull(); expect(toMonthStart('')).toBeNull() })
})

describe('mapImportRows', () => {
  it('maps SCO headers (with synonyms) to fields and coerces amount', () => {
    const rows = mapImportRows('sco', [
      { Country: 'KSA', Region: 'Central', Site: 'NHC', Month: '2026-07', Amount: '252,981', Currency: 'SAR', 'Ref No': 'X1' },
    ])
    expect(rows[0]).toMatchObject({
      country: 'KSA', region: 'Central', site: 'NHC', period_date: '2026-07-01',
      amount: 252981, currency: 'SAR', ref_no: 'X1', source: 'import',
    })
  })

  it('maps SANY invoice with alternate headers (Cost -> amount, Location -> site)', () => {
    const rows = mapImportRows('sany', [
      { country: 'KSA', location: 'RED SEA', 'Invoice No': 'INV-9', 'Invoice Date': '2026-07-05', Cost: '524186' },
    ])
    expect(rows[0]).toMatchObject({
      country: 'KSA', site: 'RED SEA', invoice_no: 'INV-9', invoice_date: '2026-07-01', amount: 524186,
    })
  })

  it('maps production with approved qty', () => {
    const rows = mapImportRows('production', [
      { Country: 'KSA', Site: 'NHC', Month: '2026-07', M3: '61045', 'Approved M3': '60000' },
    ])
    expect(rows[0]).toMatchObject({ country: 'KSA', site: 'NHC', m3: 61045, approved_m3: 60000 })
  })

  it('ignores unknown headers and drops empty rows', () => {
    const rows = mapImportRows('sco', [{ Nonsense: 'x' }, {}])
    // source is always added, so a row with no mapped field yields only {source}; those are dropped
    expect(rows).toEqual([])
  })

  it('every template lists matching headers and fields', () => {
    for (const t of Object.values(IMPORT_TEMPLATES)) {
      expect(t.headers.length).toBe(t.fields.length)
    }
  })
})
