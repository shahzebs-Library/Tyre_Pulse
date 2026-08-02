import { describe, it, expect } from 'vitest'
import {
  trustExportRows,
  diagnosticsExportRows,
  lineageExportRows,
} from '../lib/controlCenterExport.js'
import { buildTrustReport } from '../lib/dataTrust.js'

// A hand-built trust report so reason joining and mapping are deterministic
// (trustExportRows only reads .ok / .overall / .countries).
const fakeTrust = {
  ok: true,
  overall: {
    tyre_cost: { key: 'tyre_cost', label: 'Tyre spend', score: 62, band: { label: 'Moderate' } },
    tyre_life: { key: 'tyre_life', label: 'Tyre life', score: null, band: { label: 'Not measurable' } },
  },
  countries: [
    {
      country: 'KSA',
      domains: {
        tyre_cost: { reasons: [{ label: 'Items identified' }, { label: 'Protected against re-import' }] },
        tyre_life: { reasons: [] },
      },
    },
    {
      country: 'UAE',
      domains: {
        tyre_cost: { reasons: [{ label: 'Items identified' }, { label: 'Confirmed by a person' }] },
        tyre_life: { reasons: [] },
      },
    },
  ],
}

describe('trustExportRows', () => {
  it('returns [] for a null / not-ok report', () => {
    expect(trustExportRows(null)).toEqual([])
    expect(trustExportRows({ ok: false })).toEqual([])
    expect(trustExportRows(undefined)).toEqual([])
  })

  it('maps each overall domain to domain/score/band/reasons', () => {
    const rows = trustExportRows(fakeTrust)
    expect(rows).toHaveLength(2)
    const spend = rows.find((r) => r.domain === 'Tyre spend')
    expect(spend.score).toBe(62)
    expect(spend.band).toBe('Moderate')
  })

  it('joins distinct reason labels across countries with " | "', () => {
    const spend = trustExportRows(fakeTrust).find((r) => r.domain === 'Tyre spend')
    // Deduped union of KSA + UAE reasons.
    expect(spend.reasons).toBe('Items identified | Protected against re-import | Confirmed by a person')
    expect(spend.reasons).not.toContain(';')
  })

  it('renders a null score as N/A and no reasons as "None"', () => {
    const life = trustExportRows(fakeTrust).find((r) => r.domain === 'Tyre life')
    expect(life.score).toBe('N/A')
    expect(life.reasons).toBe('None')
  })

  it('works on real buildTrustReport output', () => {
    const report = buildTrustReport({
      ok: true,
      countries: [
        {
          country: 'KSA',
          currency: 'SAR',
          measures: {
            expense_spend: 1000, expense_spend_default: 400, expense_spend_reviewed: 500,
            expense_lines: 100, expense_lines_total: 100, expense_lines_no_date: 5,
            expense_lines_no_currency: 0, expense_lines_no_item: 0, expense_lines_no_uid: 90,
            expense_days_since: 3, expense_spend_linked: 900, expense_assets: 20,
            expense_assets_linked: 18, km_assets_measured: 10, odometer_rows: 0, engine_hours_rows: 0,
            tyre_rows: 200, tyre_no_unit_cost: 20, tyre_no_brand: 10, tyre_no_fitment_date: 0,
            tyre_km_span_both: 120, tyre_future_dated: 0, tyre_removal_before_fitment: 0, tyre_km_backwards: 0,
            fleet_rows: 50, fleet_no_vehicle_type: 5, fleet_no_make: 2,
          },
        },
      ],
    })
    const rows = trustExportRows(report)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r).toHaveProperty('domain')
      expect(r).toHaveProperty('score')
      expect(r).toHaveProperty('band')
      expect(typeof r.reasons).toBe('string')
    }
  })
})

describe('diagnosticsExportRows', () => {
  const summary = {
    ok: true,
    issues: [
      { key: 'a', label: 'Info small', severity: 'info', count: 3 },
      { key: 'b', label: 'Critical one', severity: 'critical', count: 2 },
      { key: 'c', label: 'Warning big', severity: 'warning', count: 50 },
      { key: 'd', label: 'Critical big', severity: 'critical', count: 99 },
    ],
  }

  it('returns [] for a null / not-ok / issue-less summary', () => {
    expect(diagnosticsExportRows(null)).toEqual([])
    expect(diagnosticsExportRows({ ok: false })).toEqual([])
    expect(diagnosticsExportRows({ ok: true })).toEqual([])
  })

  it('ranks most-severe first, then count desc within a severity', () => {
    const rows = diagnosticsExportRows(summary)
    expect(rows.map((r) => r.issue)).toEqual([
      'Critical big',   // critical, 99
      'Critical one',   // critical, 2
      'Warning big',    // warning, 50
      'Info small',     // info, 3
    ])
  })

  it('emits issue/severity/count with a numeric count', () => {
    const rows = diagnosticsExportRows(summary)
    expect(rows[0]).toEqual({ issue: 'Critical big', severity: 'critical', count: 99 })
    for (const r of rows) expect(typeof r.count).toBe('number')
  })
})

describe('lineageExportRows', () => {
  const lineage = {
    ok: true,
    recent_imports: [
      { module: 'Expenses', file: 'ksa.xlsx', rows: 500, imported: 480, duplicates: 20, status: 'committed', at: '2026-08-01', repeat_file: true },
      { module: 'Tyres', file: 'tyres.csv', rows: 100, imported: 100, duplicates: 0, status: 'committed', at: '2026-07-30' },
    ],
  }

  it('returns [] for a null / not-ok / empty lineage', () => {
    expect(lineageExportRows(null)).toEqual([])
    expect(lineageExportRows({ ok: false })).toEqual([])
    expect(lineageExportRows({ ok: true })).toEqual([])
    expect(lineageExportRows({ ok: true, recent_imports: [] })).toEqual([])
  })

  it('flattens recent imports incl date and repeat flag', () => {
    const rows = lineageExportRows(lineage)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      module: 'Expenses', file: 'ksa.xlsx', rows: 500, imported: 480,
      duplicates: 20, status: 'committed', date: '2026-08-01', repeat: 'Yes',
    })
    expect(rows[1].repeat).toBe('No')
  })

  it('falls back to N/A for missing fields and 0 for non-numeric counts', () => {
    const rows = lineageExportRows({ ok: true, recent_imports: [{}] })
    expect(rows[0]).toEqual({
      module: 'N/A', file: 'N/A', rows: 0, imported: 0,
      duplicates: 0, status: 'N/A', date: 'N/A', repeat: 'No',
    })
  })
})
