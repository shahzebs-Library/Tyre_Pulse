import { describe, it, expect } from 'vitest'
import { shapeServerJob, formatBytes, serverFileName, SERVER_STALL_MS } from '../lib/tenantExport'

const NOW = Date.parse('2026-09-25T12:00:00Z')

describe('shapeServerJob', () => {
  it('reports progress honestly for a running job', () => {
    const j = shapeServerJob({
      id: 'j1', status: 'running', mode: 'server', tables: ['sites', 'work_orders', 'budgets'],
      progress: { idx: 1, expected: { sites: 67, work_orders: 93727 }, errors: {} },
      row_counts: { sites: 67, work_orders: 25000 },
      files: [{ table: 'sites', path: 'o/j1/sites/part-0001.ndjson.gz', rows: 67, bytes: 3203 },
        { table: 'work_orders', path: 'o/j1/work_orders/part-0001.ndjson.gz', rows: 25000, bytes: 900000 }],
      updated_at: new Date(NOW - 5000).toISOString(),
    }, NOW)
    expect(j.running).toBe(true)
    expect(j.stalled).toBe(false)
    expect(j.tablesDone).toBe(1)
    expect(j.currentTable).toBe('work_orders')
    expect(j.currentLabel).toBe('Job cards')
    expect(j.exportedRows).toBe(25067)
    expect(j.expectedRows).toBe(93794)
    expect(j.pct).toBe(33)
    expect(j.files).toHaveLength(2)
    expect(j.bytes).toBe(903203)
  })

  it('never claims 100% for a running job and flags a stall', () => {
    const j = shapeServerJob({
      status: 'running', tables: ['sites'], progress: { idx: 1 }, updated_at: new Date(NOW - SERVER_STALL_MS - 1).toISOString(),
    }, NOW)
    expect(j.pct).toBe(99)
    expect(j.stalled).toBe(true)
  })

  it('has no expected total when nothing could be counted (null, not 0)', () => {
    const j = shapeServerJob({ status: 'running', tables: ['sites'], progress: { idx: 0, expected: { sites: null } } }, NOW)
    expect(j.expectedRows).toBeNull()
  })

  it('separates the manifest from data files and surfaces table errors', () => {
    const j = shapeServerJob({
      status: 'partial', tables: ['sites', 'alerts'],
      progress: { idx: 2, errors: { alerts: 'permission denied' } },
      row_counts: { sites: 5, alerts: 0 },
      files: [{ table: 'sites', path: 'a', rows: 5, bytes: 10 }, { table: '_manifest', path: 'm', rows: 0, bytes: 20 }],
    }, NOW)
    expect(j.pct).toBeNull()
    expect(j.files).toHaveLength(1)
    expect(j.manifest.path).toBe('m')
    expect(j.errors).toEqual([{ table: 'alerts', label: 'Alerts', message: 'permission denied' }])
    expect(j.stalled).toBe(false)
  })

  it('treats a completed job as 100% and tolerates junk input', () => {
    expect(shapeServerJob({ status: 'completed', tables: [] }, NOW).pct).toBe(100)
    const j = shapeServerJob(null, NOW)
    expect(j.status).toBe('failed')
    expect(j.tablesTotal).toBe(0)
    expect(j.files).toEqual([])
  })
})

describe('formatBytes / serverFileName', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(3203)).toBe('3 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(null)).toBe('N/A')
  })
  it('names files by table', () => {
    expect(serverFileName({ table: 'sites', path: 'o/j/sites/part-0001.ndjson.gz' })).toBe('sites-part-0001.ndjson.gz')
    expect(serverFileName({ table: '_manifest', path: 'o/j/manifest.json' })).toBe('manifest.json')
  })
})

import { SOURCE_TYPES, sourceLabel, isAutomatic, NEXT_STATUS } from '../lib/platformIncidents'
import { readFileSync } from 'node:fs'

describe('platform incident sources (mirror of the SQL CHECK)', () => {
  it('matches the source_type CHECK in the sentry signal migration', () => {
    const sql = readFileSync('supabase/migrations/20260924119000_sentry_incident_signal.sql', 'utf8').replace(/\r/g, '')
    const m = sql.match(/add constraint platform_incidents_source_type_check\s+check \(source_type is null or source_type in \(([^)]*)\)\)/)
    expect(m).toBeTruthy()
    const list = m[1].split(',').map((s) => s.trim().replace(/'/g, ''))
    expect(list).toEqual(SOURCE_TYPES)
  })
  it('labels sources and detects automatic sentry incidents', () => {
    expect(sourceLabel('sentry')).toBe('Sentry (automatic)')
    expect(sourceLabel(null)).toBe('Manual')
    expect(sourceLabel('odd_value')).toBe('odd value')
    expect(isAutomatic({ source_type: 'sentry', created_by: null })).toBe(true)
    expect(isAutomatic({ source_type: 'sentry', created_by: 'u1' })).toBe(false)
  })
  it('status machine unchanged', () => {
    expect(NEXT_STATUS.resolved).toEqual(['investigating'])
  })
})
