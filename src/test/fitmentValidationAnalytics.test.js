import { describe, it, expect } from 'vitest'
import {
  vehicleLabel, auditSiteOptions, filterAuditRows, mismatchBySite, auditSummary,
  auditExportRows, historyRows, filterHistory, historySummary, rulesSummary, filterRules,
} from '../lib/fitmentValidationAnalytics'

const rows = [
  { asset_no: 'TM1', make: 'Sany', model: 'X', site: 'NHC', spec: '315/80R22.5', fittedSizes: ['385/65R22.5'], mismatchSizes: ['385/65R22.5'], band: 'mismatch', fittedCount: 2, status: 'Active' },
  { asset_no: 'TM2', vehicle_type: 'TR-MIXER', site: 'NHC', spec: '315/80R22.5', fittedSizes: ['315/80R22.5'], mismatchSizes: [], band: 'match', fittedCount: 10 },
  { asset_no: 'TM3', site: '', spec: null, fittedSizes: [], mismatchSizes: [], band: 'unknown', fittedCount: 0 },
  { asset_no: 'TM4', site: 'JED', fittedSizes: ['1'], mismatchSizes: ['1'], band: 'mismatch' },
]

describe('audit', () => {
  it('labels, lists sites and filters', () => {
    expect(vehicleLabel(rows[0])).toBe('Sany X')
    expect(vehicleLabel(rows[1])).toBe('TR-MIXER')
    expect(auditSiteOptions(rows)).toEqual(['JED', 'NHC'])
    expect(filterAuditRows(rows, { band: 'mismatch' })).toHaveLength(2)
    expect(filterAuditRows(rows, { site: 'NHC' })).toHaveLength(2)
    expect(filterAuditRows(rows, { search: '385/65' })).toHaveLength(1)
    expect(filterAuditRows(rows, {})).toHaveLength(4)
  })
  it('ranks mismatches by site', () => {
    expect(mismatchBySite(rows)).toEqual([{ site: 'JED', count: 1 }, { site: 'NHC', count: 1 }])
    expect(mismatchBySite([{ band: 'mismatch' }])[0].site).toBe('Unassigned')
  })
  it('never reports a compliance rate over nothing checkable', () => {
    expect(auditSummary({ total: 2, match: 0, mismatch: 0, unknown: 2 }).compliancePct).toBeNull()
    expect(auditSummary({}).coveragePct).toBeNull()
    const s = auditSummary({ total: 4, match: 1, mismatch: 2, unknown: 1 })
    expect(s.compliancePct).toBe(33.3)
    expect(s.coveragePct).toBe(75)
  })
  it('exports every row with readable labels', () => {
    const out = auditExportRows(rows)
    expect(out).toHaveLength(4)
    expect(out[0]).toMatchObject({ asset_no: 'TM1', mismatch: 'Wrong size', fitted: '385/65R22.5' })
    expect(out[2].mismatch).toBe('No data')
  })
})

describe('history', () => {
  const now = new Date('2026-09-26T12:00:00Z')
  const ledger = [
    { id: 1, is_valid: true, tyre_serial: 'A1', validated_at: '2026-09-25T10:00:00Z', warnings: [{ rule: 'tread' }], violations: [] },
    { id: 2, is_valid: false, tyre_serial: 'B2', asset_no: 'TM9', validated_at: '2026-08-01T10:00:00Z', violations: [{ rule: 'size' }, { rule: 'size' }] },
    { id: 3, is_valid: false, tyre_serial: 'C3', validated_at: null, violations: [{ rule: 'lifecycle' }] },
  ]
  it('summarises the ledger', () => {
    const s = historySummary(ledger, { now, limit: 100 })
    expect(s).toMatchObject({ total: 3, approved: 1, rejected: 2, withWarnings: 1, last7Days: 1, capped: false })
    expect(s.approvalRatePct).toBe(33.3)
    expect(s.topViolation).toEqual({ rule: 'size', count: 2 })
  })
  it('returns null rates for an empty ledger and flags a capped read', () => {
    expect(historySummary([], { now }).approvalRatePct).toBeNull()
    expect(historySummary(ledger, { now, limit: 3 }).capped).toBe(true)
  })
  it('enriches and filters rows', () => {
    const h = historyRows(ledger)
    expect(h[0].issueLabel).toBe('1 warning')
    expect(h[1].issueLabel).toBe('2 violations')
    expect(filterHistory(h, { result: 'approved' })).toHaveLength(1)
    expect(filterHistory(h, { result: 'rejected', search: 'tm9' })).toHaveLength(1)
  })
})

describe('rules', () => {
  const rules = [
    { rule_name: 'Steer', is_active: true, applies_to_vehicle_types: ['tractor'], approved_sizes: ['315/80R22.5'] },
    { rule_name: 'Legacy', is_active: false, applies_to_vehicle_types: [] },
    { rule_name: 'Default', notes: 'gcc policy' },
  ]
  it('summarises and filters the rule set', () => {
    expect(rulesSummary(rules)).toEqual({ total: 3, active: 2, inactive: 1, vehicleTypes: 1, fleetWide: 2 })
    expect(filterRules(rules, { state: 'inactive' })).toHaveLength(1)
    expect(filterRules(rules, { search: 'gcc' })).toHaveLength(1)
    expect(filterRules(rules, { search: '315/80' })).toHaveLength(1)
    expect(rulesSummary(null).total).toBe(0)
  })
})
