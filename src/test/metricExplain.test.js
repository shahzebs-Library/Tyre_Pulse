import { describe, it, expect } from 'vitest'
import {
  shapeExplain,
  freshnessAge,
  fmtList,
  num,
  EXPLAIN_SECTIONS,
  STALE_HOURS,
} from '../lib/metricExplain'

const FIXED_NOW = Date.parse('2026-08-03T12:00:00Z')

function fullJson(overrides = {}) {
  return {
    ok: true,
    metric: {
      metric_id: 'cost_per_m3',
      name: 'Cost per M3',
      description: 'Total cost divided by approved production.',
      business_owner: 'Finance',
      source_module: 'Cost/M3',
      source_table: 'production_logs',
      source_columns: ['approved_m3', 'amount'],
      date_field: 'period_date',
      date_logic: 'batching month',
      unit: 'SAR/m3',
      currency_handling: 'per-country, never blended',
      null_handling: 'excluded',
      duplicate_handling: 'import_uid idempotent',
      included_statuses: ['approved'],
      excluded_statuses: ['rejected', 'pending'],
      joins: 'sites on site',
      transformations: 'sum(amount)/sum(approved_m3)',
      refresh_sla: 'daily',
      calc_ref: 'get_cost_per_m3',
      dashboards: ['/cost-per-m3', '/board-overview'],
    },
    version: {
      version: 2,
      formula: 'total_cost / approved_m3',
      formula_ref: 'V450b',
      numerator: 'sum(amount)',
      denominator: 'sum(approved_m3)',
      rounding: '2dp',
      effective_from: '2026-08-01',
      owner: 'Finance',
      approver: 'CFO',
      approved_at: '2026-08-02T09:00:00Z',
      change_note: 'Switched to gross',
    },
    freshness: {
      source_table: 'production_logs',
      source_row_count: 5699,
      last_source_update: '2026-08-03T06:00:00Z',
      last_calculation: '2026-08-03T07:00:00Z',
      refresh_sla: 'daily',
    },
    lineage: { domain: 'cost' },
    ...overrides,
  }
}

describe('shapeExplain', () => {
  it('maps snake_case DB fields to camelCase display fields', () => {
    const out = shapeExplain(fullJson(), FIXED_NOW)
    expect(out.metric.id).toBe('cost_per_m3')
    expect(out.metric.owner).toBe('Finance')
    expect(out.metric.sourceModule).toBe('Cost/M3')
    expect(out.metric.sourceTable).toBe('production_logs')
    expect(out.metric.sourceColumns).toEqual(['approved_m3', 'amount'])
    expect(out.metric.dateField).toBe('period_date')
    expect(out.metric.currencyHandling).toBe('per-country, never blended')
    expect(out.metric.nullHandling).toBe('excluded')
    expect(out.metric.duplicateHandling).toBe('import_uid idempotent')
    expect(out.metric.included).toEqual(['approved'])
    expect(out.metric.excluded).toEqual(['rejected', 'pending'])
    expect(out.metric.calcRef).toBe('get_cost_per_m3')
    expect(out.metric.dashboards).toEqual(['/cost-per-m3', '/board-overview'])
  })

  it('maps the version block', () => {
    const out = shapeExplain(fullJson(), FIXED_NOW)
    expect(out.version.version).toBe(2)
    expect(out.version.formula).toBe('total_cost / approved_m3')
    expect(out.version.formulaRef).toBe('V450b')
    expect(out.version.numerator).toBe('sum(amount)')
    expect(out.version.denominator).toBe('sum(approved_m3)')
    expect(out.version.approver).toBe('CFO')
    expect(out.version.changeNote).toBe('Switched to gross')
  })

  it('computes freshness age + stale flag', () => {
    const out = shapeExplain(fullJson(), FIXED_NOW)
    // last_source_update = 06:00, now = 12:00 -> 6 hours, not stale
    expect(out.freshness.ageHours).toBeCloseTo(6, 5)
    expect(out.freshness.stale).toBe(false)
    expect(out.freshness.rowCount).toBe(5699)
    expect(out.freshness.sourceTable).toBe('production_logs')
  })

  it('flags stale when source update is older than STALE_HOURS', () => {
    const j = fullJson({
      freshness: {
        source_table: 'production_logs',
        source_row_count: 10,
        last_source_update: '2026-07-30T06:00:00Z', // ~102h before FIXED_NOW
        last_calculation: null,
        refresh_sla: 'daily',
      },
    })
    const out = shapeExplain(j, FIXED_NOW)
    expect(out.freshness.ageHours).toBeGreaterThan(STALE_HOURS)
    expect(out.freshness.stale).toBe(true)
  })

  it('is honest (null) when the payload is missing or reports failure', () => {
    expect(shapeExplain(null)).toBeNull()
    expect(shapeExplain(undefined)).toBeNull()
    expect(shapeExplain({ ok: false, reason: 'not_found' })).toBeNull()
    expect(shapeExplain({})).toBeNull()
  })

  it('uses safe defaults for a sparse registry row (no undefined, version null)', () => {
    const out = shapeExplain({ ok: true, metric: { metric_id: 'x' } }, FIXED_NOW)
    expect(out.metric.id).toBe('x')
    expect(out.metric.name).toBeNull()
    expect(out.metric.sourceColumns).toEqual([])
    expect(out.metric.included).toEqual([])
    expect(out.metric.dashboards).toEqual([])
    expect(out.version).toBeNull()
    expect(out.freshness.ageHours).toBeNull()
    expect(out.freshness.stale).toBeNull()
    expect(out.freshness.rowCount).toBeNull()
    expect(out.lineage).toBeNull()
    // no field is ever undefined
    for (const k of Object.keys(out.metric)) {
      expect(out.metric[k]).not.toBeUndefined()
    }
  })

  it('passes lineage through untouched', () => {
    const out = shapeExplain(fullJson(), FIXED_NOW)
    expect(out.lineage).toEqual({ domain: 'cost' })
  })
})

describe('freshnessAge', () => {
  it('computes whole and fractional hours since the source update', () => {
    expect(freshnessAge('2026-08-03T06:00:00Z', FIXED_NOW)).toBeCloseTo(6, 5)
    expect(freshnessAge('2026-08-03T11:30:00Z', FIXED_NOW)).toBeCloseTo(0.5, 5)
  })

  it('returns null for missing or unparseable input', () => {
    expect(freshnessAge(null, FIXED_NOW)).toBeNull()
    expect(freshnessAge(undefined, FIXED_NOW)).toBeNull()
    expect(freshnessAge('', FIXED_NOW)).toBeNull()
    expect(freshnessAge('not-a-date', FIXED_NOW)).toBeNull()
  })

  it('STALE_HOURS threshold is 48', () => {
    expect(STALE_HOURS).toBe(48)
    const justUnder = freshnessAge('2026-08-01T13:00:00Z', FIXED_NOW) // 47h
    const justOver = freshnessAge('2026-08-01T11:00:00Z', FIXED_NOW) // 49h
    expect(justUnder).toBeLessThan(STALE_HOURS)
    expect(justOver).toBeGreaterThan(STALE_HOURS)
  })
})

describe('fmtList', () => {
  it('joins non-empty entries', () => {
    expect(fmtList(['a', 'b', 'c'])).toBe('a, b, c')
  })
  it('drops blank tokens and trims', () => {
    expect(fmtList([' a ', '', '  ', 'b'])).toBe('a, b')
  })
  it('returns N/A for empty/absent lists', () => {
    expect(fmtList([])).toBe('N/A')
    expect(fmtList(null)).toBe('N/A')
    expect(fmtList(undefined)).toBe('N/A')
    expect(fmtList([' ', ''])).toBe('N/A')
  })
})

describe('num', () => {
  it('preserves finite numbers including 0', () => {
    expect(num(0)).toBe(0)
    expect(num('42')).toBe(42)
    expect(num(3.5)).toBe(3.5)
  })
  it('returns null for empty/non-numeric', () => {
    expect(num(null)).toBeNull()
    expect(num(undefined)).toBeNull()
    expect(num('')).toBeNull()
    expect(num('abc')).toBeNull()
  })
})

describe('EXPLAIN_SECTIONS', () => {
  it('is an ordered array of { key, label } panel groups', () => {
    expect(Array.isArray(EXPLAIN_SECTIONS)).toBe(true)
    expect(EXPLAIN_SECTIONS.map((s) => s.key)).toEqual([
      'definition',
      'formula',
      'source',
      'filters',
      'freshness',
      'provenance',
    ])
    for (const s of EXPLAIN_SECTIONS) {
      expect(typeof s.key).toBe('string')
      expect(typeof s.label).toBe('string')
      expect(s.label.length).toBeGreaterThan(0)
    }
  })
})
