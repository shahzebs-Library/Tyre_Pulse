import { describe, it, expect } from 'vitest'
import {
  ISSUE_CODE_LABELS,
  issueCodeLabel,
  summarizeValidation,
  summarizeCommitResult,
  diagnoseBatchHealth,
  formatDiagnosticsReport,
} from '../lib/import/diagnostics.js'

/* Helpers to build the annotated-row shape the wizard produces. */
const row = (over = {}) => ({
  sourceRowNo: 1,
  validationStatus: 'ready',
  issues: [],
  dupStatus: 'none',
  liveDuplicate: false,
  countryConflict: false,
  ...over,
})
const err = (field, code) => ({ field, severity: 'error', code, message: `${code} on ${field}` })
const warn = (field, code) => ({ field, severity: 'warning', code, message: `${code} on ${field}` })

describe('diagnostics - ISSUE_CODE_LABELS', () => {
  it('provides a label + hint for every core code', () => {
    for (const code of [
      'REQUIRED_MISSING', 'DATE_INVALID', 'DATE_AMBIGUOUS', 'NEGATIVE_VALUE', 'ENUM_INVALID',
      'REMOVAL_BEFORE_FITMENT', 'CURRENCY_MISSING', 'RECOVERY_GT_CLAIM', 'TOTAL_LT_COMPONENTS',
      'COUNTRY_MISMATCH', 'COMMIT_FAILED', 'DUPLICATE', 'CONFLICT',
    ]) {
      expect(ISSUE_CODE_LABELS[code]).toBeTruthy()
      expect(typeof ISSUE_CODE_LABELS[code].label).toBe('string')
      expect(ISSUE_CODE_LABELS[code].hint.length).toBeGreaterThan(0)
    }
  })

  it('falls back gracefully for an unknown code', () => {
    const meta = issueCodeLabel('SOME_WEIRD_CODE')
    expect(meta.label).toBe('Some Weird Code')
    expect(meta.hint.length).toBeGreaterThan(0)
    // null/empty never throws
    expect(issueCodeLabel(null).label.length).toBeGreaterThan(0)
  })
})

describe('diagnostics - summarizeValidation', () => {
  const rows = [
    row({ sourceRowNo: 1, validationStatus: 'ready' }),
    row({ sourceRowNo: 2, validationStatus: 'warning', issues: [warn('cost_per_tyre', 'CURRENCY_MISSING')] }),
    row({ sourceRowNo: 3, validationStatus: 'error', issues: [err('serial_no', 'REQUIRED_MISSING')] }),
    row({ sourceRowNo: 4, validationStatus: 'error', issues: [err('asset_no', 'REQUIRED_MISSING'), warn('issue_date', 'DATE_AMBIGUOUS')] }),
    row({ sourceRowNo: 5, validationStatus: 'warning', dupStatus: 'duplicate', liveDuplicate: true, issues: [warn('site', 'ENUM_INVALID')] }),
    row({ sourceRowNo: 6, validationStatus: 'warning', dupStatus: 'conflict', countryConflict: true }),
  ]
  const s = summarizeValidation(rows, { module: 'tyre' })

  it('counts rows by status and annotation', () => {
    expect(s.total).toBe(6)
    expect(s.counts.ready).toBe(1)
    expect(s.counts.warning).toBe(3)
    expect(s.counts.error).toBe(2)
    expect(s.counts.duplicate).toBe(1)
    expect(s.counts.conflict).toBe(1)
    expect(s.counts.liveDuplicate).toBe(1)
    expect(s.counts.countryConflict).toBe(1)
  })

  it('derives a default action plan that sums to total', () => {
    expect(s.plan.total).toBe(6)
    // rows 3,4 error → reject; row 5 liveDuplicate → skip; row 6 conflict → review; rows 1,2 → insert
    expect(s.plan.reject).toBe(2)
    expect(s.plan.skip).toBe(1)
    expect(s.plan.review).toBe(1)
    expect(s.plan.insert).toBe(2)
    const sum = s.plan.insert + s.plan.update + s.plan.skip + s.plan.reject + s.plan.review
    expect(sum).toBe(s.plan.total)
  })

  it('groups blocking errors by code, ranked, with sample rows', () => {
    expect(s.blocking[0].code).toBe('REQUIRED_MISSING')
    expect(s.blocking[0].count).toBe(2)
    expect(s.blocking[0].label).toBe(ISSUE_CODE_LABELS.REQUIRED_MISSING.label)
    expect(s.blocking[0].sampleRows).toEqual([3, 4])
    // warnings grouped separately
    const warnCodes = s.warnings.map((w) => w.code).sort()
    expect(warnCodes).toContain('CURRENCY_MISSING')
    expect(warnCodes).toContain('ENUM_INVALID')
  })

  it('counts forcedThrough when an error row is forced to insert/update', () => {
    const forced = summarizeValidation(
      [row({ sourceRowNo: 9, validationStatus: 'error', issues: [err('serial_no', 'REQUIRED_MISSING')] })],
      { actionOf: () => 'insert' }
    )
    expect(forced.forcedThrough).toBe(1)
    expect(forced.health.some((h) => h.id === 'forced-through')).toBe(true)
    // default resolver rejects errors → no forcing
    expect(s.forcedThrough).toBe(0)
  })

  it('rolls up issues per field sorted by volume', () => {
    const top = s.byField[0]
    expect(top.errors + top.warnings).toBeGreaterThanOrEqual(1)
    // serial_no and asset_no each have 1 error
    const byName = Object.fromEntries(s.byField.map((f) => [f.field, f]))
    expect(byName.serial_no.errors).toBe(1)
    expect(byName.asset_no.errors).toBe(1)
  })

  it('emits an error-level health check when errors exist and ok when clean', () => {
    expect(s.health.some((h) => h.level === 'error')).toBe(true)
    const clean = summarizeValidation([row(), row({ sourceRowNo: 2 })])
    expect(clean.health.some((h) => h.level === 'ok')).toBe(true)
  })

  it('handles null / empty input without throwing', () => {
    const empty = summarizeValidation(null)
    expect(empty.total).toBe(0)
    expect(empty.plan.total).toBe(0)
    expect(empty.health[0].level).toBe('error')
  })
})

describe('diagnostics - summarizeCommitResult', () => {
  it('builds headline, successRate and grouped errors', () => {
    const res = summarizeCommitResult({
      status: 'committed',
      inserted: 1240,
      skipped: 8,
      failed: 12,
      merged: 0,
      remaining: 0,
      errors: [
        { row: 4, message: 'null value in column "serial_no" violates not-null constraint' },
        { row: 7, message: 'null value in column "serial_no" violates not-null constraint' },
        { row: 9, message: 'duplicate key value violates unique constraint' },
      ],
      target: 'tyres',
    })
    expect(res.headline).toContain('1,240 inserted')
    expect(res.headline).toContain('12 failed')
    expect(res.successRate).toBe(99) // 1240 / (1240+12) → 99
    expect(res.level).toBe('error') // failures present
    expect(res.errorGroups[0].count).toBe(2) // the not-null message groups two rows
    expect(res.errorGroups[0].rows).toEqual([4, 7])
    expect(res.hints.some((h) => h.includes('failed to commit'))).toBe(true)
    expect(res.totalProcessed).toBe(1240 + 8 + 12 + 0)
  })

  it('flags stalled and partial commits with a retry hint', () => {
    const res = summarizeCommitResult({ status: 'partial', inserted: 500, remaining: 200, failed: 0 })
    expect(res.partial).toBe(true)
    expect(res.stalled).toBe(true)
    expect(res.level).toBe('warn')
    expect(res.hints.some((h) => h.toLowerCase().includes('retry') || h.includes('pending'))).toBe(true)
  })

  it('reports a clean commit as ok with 100% success', () => {
    const res = summarizeCommitResult({ status: 'committed', inserted: 50, failed: 0, remaining: 0 })
    expect(res.level).toBe('ok')
    expect(res.successRate).toBe(100)
    expect(res.stalled).toBe(false)
  })

  it('surfaces enrichment errors and already_committed', () => {
    const res = summarizeCommitResult({ status: 'already_committed', inserted: 0, enrichError: 'timeout' })
    expect(res.headline.toLowerCase()).toContain('already committed')
    expect(res.hints.some((h) => h.includes('already committed'))).toBe(true)
    expect(res.hints.some((h) => h.includes('enrichment'))).toBe(true)
  })

  it('handles null input without throwing', () => {
    const res = summarizeCommitResult(null)
    expect(res.inserted).toBe(0)
    expect(res.successRate).toBe(0)
    expect(Array.isArray(res.errorGroups)).toBe(true)
  })
})

describe('diagnostics - diagnoseBatchHealth', () => {
  it('detects a staging stall when no rows were staged', () => {
    const checks = diagnoseBatchHealth({ batch: { import_status: 'staged', total_rows: 0 } })
    const stall = checks.find((c) => c.id === 'staging-stall')
    expect(stall).toBeTruthy()
    expect(stall.level).toBe('error')
  })

  it('detects a failed import', () => {
    const checks = diagnoseBatchHealth({ batch: { import_status: 'failed', total_rows: 10 } })
    expect(checks.some((c) => c.id === 'import-failed' && c.level === 'error')).toBe(true)
  })

  it('detects dropped rows after a committed batch', () => {
    const checks = diagnoseBatchHealth({
      batch: { import_status: 'committed', total_rows: 100, ready_rows: 90, warning_rows: 10, error_rows: 0, imported_rows: 80 },
    })
    const dropped = checks.find((c) => c.id === 'dropped-rows')
    expect(dropped).toBeTruthy()
    expect(dropped.level).toBe('warn')
  })

  it('detects COMMIT_FAILED issues and conflicts', () => {
    const checks = diagnoseBatchHealth({
      batch: { import_status: 'committed', total_rows: 10, ready_rows: 10, imported_rows: 10, conflict_rows: 3 },
      issues: [{ issue_code: 'COMMIT_FAILED', severity: 'error', message: 'boom' }],
    })
    expect(checks.some((c) => c.id === 'commit-failures' && c.level === 'error')).toBe(true)
    expect(checks.some((c) => c.id === 'conflicts')).toBe(true)
  })

  it('reports a clean import when everything is healthy', () => {
    const checks = diagnoseBatchHealth({
      batch: { import_status: 'committed', total_rows: 100, ready_rows: 100, warning_rows: 0, error_rows: 0, conflict_rows: 0, imported_rows: 100 },
    })
    expect(checks).toHaveLength(1)
    expect(checks[0].id).toBe('clean')
    expect(checks[0].level).toBe('ok')
  })

  it('handles null input without throwing', () => {
    const checks = diagnoseBatchHealth(null)
    // total_rows defaults to 0 → staging stall
    expect(checks.some((c) => c.id === 'staging-stall')).toBe(true)
  })
})

describe('diagnostics - formatDiagnosticsReport', () => {
  it('renders a non-empty multi-line report on full input', () => {
    const validation = summarizeValidation(
      [
        row({ sourceRowNo: 1, validationStatus: 'error', issues: [err('serial_no', 'REQUIRED_MISSING')] }),
        row({ sourceRowNo: 2, validationStatus: 'warning', issues: [warn('site', 'ENUM_INVALID')] }),
      ],
      { module: 'tyre' }
    )
    const commit = summarizeCommitResult({ status: 'committed', inserted: 10, failed: 1, errors: [{ row: 3, message: 'bad' }] })
    const batchHealth = diagnoseBatchHealth({ batch: { import_status: 'committed', total_rows: 2, ready_rows: 2, imported_rows: 2 } })
    const text = formatDiagnosticsReport({
      meta: { module: 'tyre', country: 'KSA', batchId: 'b-1', createdAt: '2026-07-11' },
      validation,
      commit,
      batchHealth,
    })
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(200)
    expect(text.split('\n').length).toBeGreaterThan(15)
    expect(text).toContain('DATA INTAKE DIAGNOSTICS REPORT')
    expect(text).toContain('REQUIRED_MISSING')
    expect(text).toContain('ACTION PLAN')
    expect(text).toContain('COMMIT OUTCOME')
  })

  it('never throws on empty / partial input and still returns a string', () => {
    expect(typeof formatDiagnosticsReport(null)).toBe('string')
    expect(formatDiagnosticsReport({}).length).toBeGreaterThan(0)
    const partial = formatDiagnosticsReport({ meta: { module: 'stock' } })
    expect(partial).toContain('stock')
  })
})
