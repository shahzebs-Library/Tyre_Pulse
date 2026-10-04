import { describe, it, expect } from 'vitest'
import {
  fmtBytes, fmtInt, fmtPct, freshnessStatus, shapeFreshness, shapeSnapshot, recoveryWindow, cronToRiyadh,
  queryLabel, shapeQueryTime, shapeTables, connectionSummary, trustTone,
} from '../lib/databaseCenter'

const NOW = new Date('2026-09-30T08:00:00Z')

describe('databaseCenter formatting', () => {
  it('never turns an unknown into a zero', () => {
    expect(fmtBytes(null)).toBe('N/A')
    expect(fmtBytes(undefined)).toBe('N/A')
    expect(fmtInt(null)).toBe('N/A')
    expect(fmtPct(null)).toBe('N/A')
    expect(fmtBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})

describe('data freshness', () => {
  it('reads today as good, a few days as a warning and a long gap as silent', () => {
    expect(freshnessStatus('inspections', '2026-09-30T06:00:00Z', NOW)).toMatchObject({ tone: 'good', label: 'Today' })
    expect(freshnessStatus('inspections', '2026-09-28T06:00:00Z', NOW)).toMatchObject({ tone: 'warning', days: 2 })
    expect(freshnessStatus('production_logs', '2026-08-10T06:00:00Z', NOW)).toMatchObject({ tone: 'danger', label: '51 days silent' })
  })
  it('does not alarm on tables that change rarely, and admits no rows', () => {
    expect(freshnessStatus('vehicle_fleet', '2026-08-01T00:00:00Z', NOW).tone).toBe('default')
    expect(freshnessStatus('accidents', null, NOW)).toMatchObject({ label: 'No rows', days: null })
  })
  it('shapes a payload without inventing rows', () => {
    expect(Array.isArray(shapeFreshness(null, NOW)?.rows ?? shapeFreshness(null, NOW))).toBe(true)
  })
})

describe('backups', () => {
  it('marks the table that did not fit the stored total as skipped', () => {
    const s = shapeSnapshot({ id: 'a', taken_at: '2026-09-30T00:30:00Z', total_rows: 100, tables: [
      { table_name: 'tyre_records', row_count: 60 }, { table_name: 'inspections', row_count: 40 }, { table_name: 'work_orders', row_count: 90000 },
    ] })
    expect(s.skipped).toEqual([{ table: 'work_orders', rows: 90000 }])
    expect(s.tableCount).toBe(2)
  })
  it('recovery window counts only snapshots with a time', () => {
    expect(recoveryWindow([])).toEqual({ count: 0, first: null, last: null })
    const w = recoveryWindow([{ taken_at: '2026-09-29T00:30:00Z' }, { taken_at: '2026-09-30T00:30:00Z' }, {}])
    expect(w.count).toBe(2)
    expect(w.last).toBe('2026-09-30T00:30:00.000Z')
  })
  it('converts the nightly cron to Riyadh time and refuses shapes it cannot read', () => {
    expect(cronToRiyadh('30 0 * * *')).toBe('03:30 Riyadh')
    expect(cronToRiyadh('*/5 * * * *')).toBeNull()
  })
})

describe('where database time goes', () => {
  it('labels shapes in plain English', () => {
    expect(queryLabel('update tyre_records set status = $1 where id = $2')).toBe('tyre records update')
    expect(queryLabel('')).toBe('Other database work')
  })
  it('counts a hot spot when one shape takes a quarter of the time', () => {
    const q = shapeQueryTime({ since: '2026-09-30T10:34:38Z', rows: [
      { id: 1, shape: 'select * from inspections', calls: 10, total_ms: 750, mean_ms: 75, share_pct: 75 },
      { id: 2, shape: 'select * from sites', calls: 10, total_ms: 250, mean_ms: 25, share_pct: 25 },
    ] })
    expect(q.ok).toBe(true)
    expect(q.hotSpots).toBe(2)
    expect(shapeQueryTime({ ok: false })).toMatchObject({ ok: false, rows: [] })
  })
})

describe('tables and connections', () => {
  it('shapes tables and survives missing input', () => {
    expect(Array.isArray(shapeTables(null, null))).toBe(true)
    expect(connectionSummary(null)).toBeNull()
  })
  it('trust tone bands', () => {
    expect(trustTone(70).tone).toBe('good')
    expect(trustTone(55).tone).not.toBe('good')
  })
})
