import { describe, it, expect } from 'vitest'
import {
  hasExpandable, changeDiff, actionMix, pageRangeLabel, pageCountFor, actorName, fmtVal,
  auditExportRows, uploadExportRows, auditFileName, AUDIT_EXPORT_COLS, UPLOAD_EXPORT_COLS,
} from '../lib/auditTrailAnalytics'

describe('audit change diff', () => {
  it('detects expandable rows', () => {
    expect(hasExpandable({})).toBe(false)
    expect(hasExpandable({ details: { a: 1 } })).toBe(true)
    expect(hasExpandable({ old_data: { a: 1 } })).toBe(true)
  })
  it('diffs old and new values and lifts meta', () => {
    const d = changeDiff({ old_values: { status: 'Open', km: 5 }, new_values: { status: 'Closed', km: 5, _meta: { src: 'ui' } } })
    expect(d.fields).toEqual([
      { field: 'status', oldValue: 'Open', newValue: 'Closed', changed: true },
      { field: 'km', oldValue: '5', newValue: '5', changed: false },
    ])
    expect(d.meta).toEqual({ src: 'ui' })
    expect(d.details).toBeNull()
  })
  it('renders missing values as N/A', () => {
    expect(fmtVal(null)).toBe('N/A')
    expect(fmtVal('')).toBe('N/A')
    expect(fmtVal({ a: 1 })).toBe('{"a":1}')
    const d = changeDiff({ new_data: { x: 1 } })
    expect(d.fields[0].oldValue).toBe('N/A')
  })
})

describe('helpers', () => {
  it('mixes actions', () => {
    expect(actionMix([{ action: 'UPLOAD' }, { action: 'UPLOAD' }, { action: 'DELETE' }, {}])).toEqual([
      { action: 'UPLOAD', count: 2 }, { action: 'DELETE', count: 1 }, { action: 'OTHER', count: 1 },
    ])
  })
  it('labels page ranges honestly', () => {
    expect(pageRangeLabel(0, 50, 120)).toBe('Showing 1 to 50 of 120')
    expect(pageRangeLabel(2, 50, 120)).toBe('Showing 101 to 120 of 120')
    expect(pageRangeLabel(0, 50, 0)).toBe('No entries')
    expect(pageRangeLabel(0, 50, NaN)).toBe('N/A')
    expect(pageCountFor(120, 50)).toBe(3)
    expect(pageCountFor(0, 50)).toBe(1)
  })
  it('resolves actors', () => {
    expect(actorName({ profiles: { full_name: 'Ali' } })).toBe('Ali')
    expect(actorName({ user_id: 'x' })).toBe('Unknown')
    expect(actorName({})).toBe('System')
  })
  it('builds export rows', () => {
    const a = auditExportRows([{ created_at: 't', action: 'UPLOAD', record_count: 3, profiles: { username: 'u' } }], () => 'T')
    expect(Object.keys(a[0])).toEqual(AUDIT_EXPORT_COLS)
    expect(a[0].timestamp).toBe('T')
    expect(a[0].user).toBe('u')
    const u = uploadExportRows([{ file_names: ['a.csv', 'b.csv'], records_added: 4 }], () => 'T')
    expect(Object.keys(u[0])).toEqual(UPLOAD_EXPORT_COLS)
    expect(u[0].file_names).toBe('a.csv, b.csv')
    expect(u[0].records_skipped).toBe(0)
  })
  it('names files', () => {
    expect(auditFileName('audit', new Date('2026-09-27T00:00:00Z'))).toBe('TyrePulse Audit Log 2026-09-27')
    expect(auditFileName('upload', new Date('2026-09-27T00:00:00Z'))).toBe('TyrePulse Upload History 2026-09-27')
  })
})
