import { describe, it, expect } from 'vitest'
import {
  deductionRows, deductionTotal, reconcileSanyLines, reconcileMessage,
  grossToNetRows, toSar, lineExportRows,
} from '../lib/sanyInvoiceLines'

/**
 * The two documents actually loaded. SANY Automobile: 27 machine lines,
 * 324 machines, USD 512,864.19 gross. Sany International (generators): 4 lines,
 * 34 generators, USD 51,000. In both, the machine lines add up to the stated
 * gross exactly - which is the fact this panel exists to let the owner check.
 */
const automobile = {
  gross_amount: '512864.19',
  net_amount: '360515.52',
  fx_rate: '3.75',
  deductions: [
    { label: 'Penalty', amount_usd: 51286.41 },
    { label: 'Green Concrete purchased items', amount_usd: 66412.26 },
    { label: 'SANY 11 labor food and accommodation', amount_usd: 13200 },
    { label: 'Non-operational machines', amount_usd: 21450 },
  ],
}

const generators = {
  gross_amount: '51000.00',
  net_amount: '50754.62',
  fx_rate: '3.75',
  // The local contract writes the amount under a DIFFERENT key.
  deductions: [{ label: 'Discount spare parts', amount: 245.38 }],
}

describe('SANY machine-line reconciliation', () => {
  it('confirms a match when the lines add up to the stated gross', () => {
    const lines = [
      { amount_usd: '161916.31', units: 232 },
      { amount_usd: '350947.88', units: 92 },
    ]
    const rec = reconcileSanyLines(lines, automobile)
    expect(rec.status).toBe('match')
    expect(rec.linesTotal).toBe(512864.19)
    expect(rec.units).toBe(324)
    expect(rec.difference).toBe(0)
    expect(reconcileMessage(rec)).toContain('exactly the gross')
  })

  it('NAMES the difference when they disagree - a silent mismatch is the failure', () => {
    const rec = reconcileSanyLines([{ amount_usd: 500000, units: 300 }], automobile)
    expect(rec.status).toBe('mismatch')
    expect(rec.difference).toBe(-12864.19)
    const msg = reconcileMessage(rec)
    expect(msg).toContain('12,864.19')
    expect(msg).toContain('less than')
  })

  it('says the PDF was never supplied rather than showing an empty machine table', () => {
    const rec = reconcileSanyLines([], { gross_amount: 57000 })
    expect(rec.status).toBe('no_lines')
    expect(rec.linesTotal).toBeNull()
    expect(rec.units).toBeNull()
    expect(reconcileMessage(rec)).toBe(
      'No machine detail loaded for this invoice - the PDF has not been supplied.',
    )
  })

  it('does not claim a match when the invoice states no gross to check against', () => {
    const rec = reconcileSanyLines([{ amount_usd: 100, units: 1 }], { gross_amount: null })
    expect(rec.status).toBe('no_gross')
    expect(rec.difference).toBeNull()
  })
})

describe('gross to net', () => {
  it('reads BOTH deduction amount keys the loaded documents use', () => {
    expect(deductionRows(automobile)[0]).toEqual({ label: 'Penalty', amountUsd: 51286.41 })
    expect(deductionRows(generators)[0]).toEqual({ label: 'Discount spare parts', amountUsd: 245.38 })
    expect(deductionTotal(automobile)).toBe(152348.67)
    expect(deductionTotal(generators)).toBe(245.38)
  })

  it('walks gross, each deduction, then the stated net', () => {
    const rows = grossToNetRows(automobile)
    expect(rows[0]).toMatchObject({ kind: 'gross', amountUsd: 512864.19 })
    expect(rows.filter((r) => r.kind === 'deduction')).toHaveLength(4)
    // Deductions are shown as negatives so the column adds up on the page.
    expect(rows[1].amountUsd).toBe(-51286.41)
    const net = rows[rows.length - 1]
    expect(net).toMatchObject({ kind: 'net', amountUsd: 360515.52 })
    expect(net.derived).toBe(false)
    // 512864.19 - 152348.67 = 360515.52, so the stated net is the honest one.
    expect(net.amountUsd).toBe(512864.19 - 152348.67)
  })

  it('flags a net it had to derive, so it is never mistaken for a stated one', () => {
    const rows = grossToNetRows({ gross_amount: 1000, net_amount: null, deductions: [{ label: 'Penalty', amount_usd: 100 }] })
    const net = rows[rows.length - 1]
    expect(net.amountUsd).toBe(900)
    expect(net.derived).toBe(true)
    expect(net.label).toContain('derived')
  })

  it('records no net at all when there is nothing to derive one from', () => {
    const rows = grossToNetRows({ gross_amount: 57000, net_amount: null, deductions: [] })
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('gross')
  })

  it('returns nothing for an invoice carrying no amounts', () => {
    expect(grossToNetRows({})).toEqual([])
    expect(deductionTotal({})).toBeNull()
  })
})

describe('SAR conversion', () => {
  it('uses the rate on the invoice itself', () => {
    expect(toSar(360515.52, '3.75')).toBe(1351933.2)
  })

  it('withholds a figure rather than inventing a rate', () => {
    expect(toSar(1000, null)).toBeNull()
    expect(toSar(null, 3.75)).toBeNull()
  })
})

describe('export rows', () => {
  it('carries USD and the invoice-rate SAR, with nulls left null', () => {
    const [row] = lineExportRows(
      [{ line_no: 1, machinery: 'SANY Concrete Mixer', units: '232', usage_detail: '2,758,370 KM', amount_usd: '161916.31', contract_year: null }],
      automobile,
    )
    expect(row.units).toBe(232)
    expect(row.amount_usd).toBe(161916.31)
    expect(row.amount_sar).toBe(607186.16)
    expect(row.usage_detail).toBe('2,758,370 KM')
    expect(row.contract_year).toBe('')
  })

  it('gives no SAR column value when the invoice has no rate', () => {
    const [row] = lineExportRows([{ amount_usd: 100 }], { fx_rate: null })
    expect(row.amount_sar).toBeNull()
  })
})
