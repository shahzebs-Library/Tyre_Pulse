import { describe, it, expect } from 'vitest'
import {
  shapeDataActivity, activityCounts, scanAllSummary, groupLearnBatches, shapeCleanupRuns,
  readRetention, filterByDateWindow, pushRecent, reasonOk, DATA_ACTIONS,
} from '../lib/dataOpsCenter'

describe('shapeDataActivity', () => {
  it('keeps only data actions, newest first, with names and reasons', () => {
    const out = shapeDataActivity([
      { id: 1, admin_id: 'a', action: 'login', created_at: '2026-10-01T00:00:00Z' },
      { id: 2, admin_id: 'a', action: 'data_cleanup', created_at: '2026-10-02T00:00:00Z', details: { deleted: 12, before: '2024-01-01', reason: '  old logs ' } },
      { id: 3, admin_id: 'b', action: 'duplicate_resolve', created_at: '2026-10-03T00:00:00Z', details: { deleted: 5, country: 'KSA' } },
    ], { a: 'Anum' })
    expect(out.map((x) => x.id)).toEqual([3, 2])
    expect(out[1].who).toBe('Anum')
    expect(out[0].who).toBe('A super admin')
    expect(out[1].reason).toBe('old logs')
    expect(out[1].detail).toContain('12 rows deleted')
    expect(out[1].tone).toBe(DATA_ACTIONS.data_cleanup.tone)
  })
  it('counts risky changes inside a window', () => {
    const items = shapeDataActivity([
      { id: 1, action: 'data_cleanup', created_at: '2026-10-03T00:00:00Z' },
      { id: 2, action: 'material_confirm', created_at: '2026-10-03T00:00:00Z' },
      { id: 3, action: 'duplicate_resolve', created_at: '2020-01-01T00:00:00Z' },
    ])
    const c = activityCounts(items, Date.parse('2026-09-01T00:00:00Z'))
    expect(c).toEqual({ total: 2, danger: 1, warning: 0 })
  })
})

describe('scanAllSummary', () => {
  const t = (key, kind) => ({ key, label: key, tbl: key, kind })
  it('adds rows across tables and keeps money in one currency only when one country is scanned', () => {
    const r = scanAllSummary([
      { target: t('parts', 'money'), preview: { extra_deletable: 10, extra_protected: 2, money_deletable: 500 } },
      { target: t('tyres', 'rows'), preview: { extra_deletable: 0, extra_protected: 4 } },
      { target: t('wo', 'money'), error: 'failed' },
    ], 'UAE')
    expect(r.deletable).toBe(10)
    expect(r.protectedRows).toBe(6)
    expect(r.tablesScanned).toBe(2)
    expect(r.tablesFailed).toBe(1)
    expect(r.tablesWithDuplicates).toBe(1)
    expect(r.money).toBe(500)
    expect(r.currency).toBe('AED')
    expect(r.rows[0].key).toBe('parts')
    expect(r.rows.find((x) => x.key === 'wo').deletable).toBeNull()
  })
  it('never reports money across all countries', () => {
    const r = scanAllSummary([{ target: t('parts', 'money'), preview: { extra_deletable: 3, money_deletable: 99 } }], null)
    expect(r.money).toBeNull()
    expect(r.currency).toBeNull()
    expect(r.rows[0].money).toBeNull()
  })
})

describe('groupLearnBatches', () => {
  it('groups log rows per batch and names the rule', () => {
    const out = groupLearnBatches([
      { batch_id: 'b1', fact_id: 'f1', target_field: 'brand', old_value: null, new_value: 'TRIANGLE', created_at: '2026-10-01T10:00:00Z' },
      { batch_id: 'b1', fact_id: 'f1', target_field: 'brand', created_at: '2026-10-01T10:00:01Z' },
      { batch_id: 'b2', fact_id: 'f2', target_field: 'size', created_at: '2026-10-02T10:00:00Z' },
      { batch_id: null, created_at: '2026-10-03T00:00:00Z' },
    ], { f1: { match_value: 'TRAINGLE', target_value: 'TRIANGLE' } })
    expect(out.map((b) => b.batchId)).toEqual(['b2', 'b1'])
    expect(out[1].rows).toBe(2)
    expect(out[1].rule).toBe('TRAINGLE -> TRIANGLE')
    expect(out[0].rule).toBeNull()
    expect(out[1].sample).toEqual({ from: null, to: 'TRIANGLE' })
  })
})

describe('cleanup history and retention', () => {
  it('shapes run rows and keeps an unknown count as null', () => {
    const out = shapeCleanupRuns([
      { id: 1, created_at: '2026-01-01', detail: { key: 'system_logs', deleted: 4, snapshot: 's' } },
      { id: 2, created_at: '2026-02-01', detail: {} },
    ])
    expect(out[0].id).toBe(2)
    expect(out[0].deleted).toBeNull()
    expect(out[1].deleted).toBe(4)
  })
  it('reads retention values honestly', () => {
    expect(readRetention([
      { key: 'audit_retention_days', value: '365' },
      { key: 'data_retention_months', value: '"24"' },
      { key: 'dual_control_enabled', value: 'false' },
    ])).toEqual({ auditRetentionDays: 365, dataRetentionMonths: 24, dualControl: false })
    expect(readRetention([{ key: 'audit_retention_days', value: 'junk' }])).toEqual({ auditRetentionDays: null, dataRetentionMonths: null, dualControl: null })
  })
})

describe('small helpers', () => {
  it('filters by an inclusive date window and drops undated rows', () => {
    const rows = [{ uploaded_at: '2026-09-01T10:00:00Z' }, { uploaded_at: '2026-09-10T10:00:00Z' }, { uploaded_at: null }]
    expect(filterByDateWindow(rows, '2026-09-01', '2026-09-05')).toHaveLength(1)
    expect(filterByDateWindow(rows, '', '')).toHaveLength(3)
    expect(filterByDateWindow(rows, '2026-09-02', '')).toHaveLength(1)
  })
  it('keeps recents unique and capped', () => {
    expect(pushRecent(['/a', '/b', '/c'], '/b', 3)).toEqual(['/b', '/a', '/c'])
    expect(pushRecent(['/a', '/b', '/c'], '/d', 3)).toEqual(['/d', '/a', '/b'])
    expect(pushRecent(['/a'], null)).toEqual(['/a'])
  })
  it('requires a real reason', () => {
    expect(reasonOk('  ab ')).toBe(false)
    expect(reasonOk('old data')).toBe(true)
    expect(reasonOk(null)).toBe(false)
  })
})
