import { describe, it, expect } from 'vitest'
import {
  flagSuspiciousClusters, importRowSummary, CLUSTER_WINDOW_SECONDS,
} from '../lib/api/importHistory'
import { isEditableColumn, LOCKED_COLUMNS } from '../lib/api/dataBrowser'
import {
  IMPORT_TARGETS, SAFE_TO_REIMPORT, REIMPORT_NEEDS_KEY, importTargetFor, importTargetRows,
} from '../lib/importTargets'

describe('flagSuspiciousClusters', () => {
  it('flags two loads of the same size, same country, close in time', () => {
    // This is the live signature of a resent upload chunk: KSA 136 rows at 12:26:35
    // and 136 again at 12:27:45.
    const out = flagSuspiciousClusters([
      { country: 'KSA', inserted_at: '2026-07-25T12:26:35Z', rows: 136 },
      { country: 'KSA', inserted_at: '2026-07-25T12:27:45Z', rows: 136 },
      { country: 'KSA', inserted_at: '2026-07-26T05:10:02Z', rows: 111 },
    ])
    expect(out[0].suspicious).toBe(true)
    expect(out[1].suspicious).toBe(true)
    expect(out[0].pairedWith).toBe('2026-07-25T12:27:45Z')
    expect(out[2].suspicious).toBe(false)
    expect(out[2].pairedWith).toBeNull()
  })

  it('does not flag same-size loads for DIFFERENT countries', () => {
    // Two countries legitimately loading the same number of rows is a coincidence,
    // not a resend - each country is a separate file.
    const out = flagSuspiciousClusters([
      { country: 'KSA', inserted_at: '2026-07-25T12:26:35Z', rows: 100 },
      { country: 'UAE', inserted_at: '2026-07-25T12:26:40Z', rows: 100 },
    ])
    expect(out.every((c) => !c.suspicious)).toBe(true)
  })

  it('does not flag same-size loads far apart in time', () => {
    const out = flagSuspiciousClusters([
      { country: 'KSA', inserted_at: '2026-07-01T10:00:00Z', rows: 500 },
      { country: 'KSA', inserted_at: '2026-07-20T10:00:00Z', rows: 500 },
    ])
    expect(out[0].suspicious).toBe(false)
    expect(out[1].suspicious).toBe(false)
  })

  it('ignores zero-row clusters and bad input', () => {
    const out = flagSuspiciousClusters([
      { country: 'KSA', inserted_at: '2026-07-25T12:00:00Z', rows: 0 },
      { country: 'KSA', inserted_at: '2026-07-25T12:00:05Z', rows: 0 },
      null,
      { country: 'KSA', rows: 5 },
    ])
    expect(out).toHaveLength(2)
    expect(out.every((c) => !c.suspicious)).toBe(true)
    expect(flagSuspiciousClusters(null)).toEqual([])
  })

  it('honours a custom window', () => {
    const rows = [
      { country: 'KSA', inserted_at: '2026-07-25T12:00:00Z', rows: 10 },
      { country: 'KSA', inserted_at: '2026-07-25T12:05:00Z', rows: 10 },
    ]
    expect(flagSuspiciousClusters(rows, 60)[0].suspicious).toBe(false)
    expect(flagSuspiciousClusters(rows, 600)[0].suspicious).toBe(true)
    expect(CLUSTER_WINDOW_SECONDS).toBe(600)
  })

  it('does not leak the internal timestamp field', () => {
    const out = flagSuspiciousClusters([{ country: 'KSA', inserted_at: '2026-07-25T12:00:00Z', rows: 5 }])
    expect(out[0]).not.toHaveProperty('_t')
  })
})

describe('importRowSummary', () => {
  it('describes a partial import honestly', () => {
    expect(importRowSummary({ total_rows: 602, imported_rows: 100 }))
      .toBe('100 of 602 rows imported')
  })

  it('calls out a file that was read but imported nothing', () => {
    // The live re-upload of fleet_import_template.csv read 602 rows and imported 0.
    expect(importRowSummary({ total_rows: 602, imported_rows: 0 }))
      .toBe('602 rows read, none imported')
  })

  it('handles a clean full import and empty input', () => {
    expect(importRowSummary({ total_rows: 11, imported_rows: 11 })).toBe('11 rows imported')
    expect(importRowSummary({ total_rows: 0, imported_rows: 0 })).toBe('No rows recorded')
    expect(importRowSummary(null)).toBe('')
  })
})

describe('isEditableColumn', () => {
  it('locks identity and tenancy columns so a row cannot be re-keyed or moved', () => {
    for (const c of LOCKED_COLUMNS) expect(isEditableColumn(c)).toBe(false)
    expect(LOCKED_COLUMNS).toContain('organisation_id')
    expect(LOCKED_COLUMNS).toContain('id')
  })

  it('locks generated columns, which the database computes itself', () => {
    const cols = [{ column_name: 'fitment_date', is_generated: 'ALWAYS' }]
    expect(isEditableColumn('fitment_date', cols)).toBe(false)
  })

  it('allows an ordinary column', () => {
    const cols = [{ column_name: 'remarks', is_generated: 'NEVER' }]
    expect(isEditableColumn('remarks', cols)).toBe(true)
    expect(isEditableColumn('remarks')).toBe(true)
  })

  it('rejects an empty column name', () => {
    expect(isEditableColumn('')).toBe(false)
    expect(isEditableColumn(null)).toBe(false)
  })
})

describe('importTargets re-import safety', () => {
  it('every target declares what happens if you upload it twice', () => {
    for (const t of IMPORT_TARGETS) {
      expect(['safe', 'needs-key']).toContain(t.reimportSafe)
    }
  })

  it('the expense grid is the one path that needs the line number mapped', () => {
    // Verified against the live trigger: process_expenses_country is idempotent only
    // via the ERP line number, and it is the path that produced the duplicates.
    expect(REIMPORT_NEEDS_KEY).toEqual(['expenses_ksa / expenses_uae / expenses_egypt'])
    expect(importTargetFor('expenses_ksa').reimportSafe).toBe('needs-key')
    expect(importTargetFor('expenses_ksa').columns).toContain('#')
    expect(importTargetFor('expenses_ksa').notes).toMatch(/ALWAYS MAP THE "#" COLUMN/)
  })

  it('open job cards are now safe to re-upload, and say why', () => {
    // This entry previously claimed the snapshot was replaced wholesale, which was
    // wrong: the trigger did a bare INSERT. V363 made it refresh per job card.
    const t = importTargetFor('stg_open_wo')
    expect(t.reimportSafe).toBe('safe')
    expect(t.notes).toMatch(/REFRESHED in place/)
    expect(t.notes).not.toMatch(/REPLACES the whole snapshot/)
    expect(SAFE_TO_REIMPORT).toContain('stg_open_wo')
  })

  it('SAFE_TO_REIMPORT is derived from the flag, not from prose', () => {
    const expected = IMPORT_TARGETS.filter((t) => t.reimportSafe === 'safe').map((t) => t.table)
    expect([...SAFE_TO_REIMPORT]).toEqual(expected)
    expect(SAFE_TO_REIMPORT).not.toContain('expenses_ksa / expenses_uae / expenses_egypt')
  })

  it('the export carries the re-upload answer', () => {
    const rows = importTargetRows()
    expect(Object.keys(rows[0])).toContain('safe_to_upload_twice')
    const grid = rows.find((r) => r.import_into_table.startsWith('expenses_'))
    expect(grid.safe_to_upload_twice).toMatch(/Only if the ERP line number/)
  })
})
