import { describe, it, expect } from 'vitest'
import { groupBatches, previewSummary } from '../lib/api/duplicateControl'
import { IMPORT_TARGETS, importTargetFor, importTargetRows, SAFE_TO_REIMPORT } from '../lib/importTargets'

describe('groupBatches', () => {
  it('collapses archive rows into one entry per batch and counts rows', () => {
    const out = groupBatches([
      { batch_id: 'b1', target_key: 'parts_expense', tbl: 'parts_consumption', country: 'Egypt', created_at: '2026-07-26T10:00:00Z', restored_at: null },
      { batch_id: 'b1', target_key: 'parts_expense', tbl: 'parts_consumption', country: 'Egypt', created_at: '2026-07-26T10:00:00Z', restored_at: null },
      { batch_id: 'b2', target_key: 'tyre_records', tbl: 'tyre_records', country: 'KSA', created_at: '2026-07-25T10:00:00Z', restored_at: '2026-07-25T11:00:00Z' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ batch_id: 'b1', rows: 2, restored: false })
    expect(out[1]).toMatchObject({ batch_id: 'b2', rows: 1, restored: true })
  })

  it('a batch is restored only when EVERY archived row went back', () => {
    // A half-restored batch must not advertise itself as done, or the operator
    // loses the Undo button while rows are still missing.
    const out = groupBatches([
      { batch_id: 'b1', tbl: 't', created_at: 'x', restored_at: '2026-07-26T10:00:00Z' },
      { batch_id: 'b1', tbl: 't', created_at: 'x', restored_at: null },
    ])
    expect(out[0].restored).toBe(false)
  })

  it('ignores junk rows and empty input', () => {
    expect(groupBatches(null)).toEqual([])
    expect(groupBatches([null, {}, { batch_id: null }])).toEqual([])
  })
})

describe('previewSummary', () => {
  it('reports nothing found when there are no groups', () => {
    expect(previewSummary(null)).toBe('No repeated rows found.')
    expect(previewSummary({ groups_total: 0 })).toBe('No repeated rows found.')
  })

  it('never lets a protected-only result read as "nothing found"', () => {
    const s = previewSummary({ groups_total: 4604, extra_deletable: 0, extra_protected: 44696 })
    expect(s).toMatch(/44,696/)
    expect(s).toMatch(/genuine repeats and are protected/)
    expect(s).not.toBe('No repeated rows found.')
  })

  it('states both sides when a target has deletable and protected rows', () => {
    const s = previewSummary({ groups_total: 10, extra_deletable: 7, extra_protected: 3 })
    expect(s).toMatch(/7 extra row\(s\) can be removed/)
    expect(s).toMatch(/3 row\(s\) are genuine repeats/)
  })
})

describe('importTargets reference', () => {
  it('every target names a staging table, the live table it feeds, and columns', () => {
    expect(IMPORT_TARGETS.length).toBeGreaterThan(0)
    for (const t of IMPORT_TARGETS) {
      expect(t.table).toBeTruthy()
      expect(t.feeds).toBeTruthy()
      expect(t.label).toBeTruthy()
      expect(Array.isArray(t.columns)).toBe(true)
      expect(t.columns.length).toBeGreaterThan(0)
      expect(typeof t.notes).toBe('string')
      expect(t.notes.length).toBeGreaterThan(0)
    }
  })

  it('the expense tables are the only ones that do not need a country column', () => {
    const noCountry = IMPORT_TARGETS.filter((t) => !t.needsCountry).map((t) => t.table)
    expect(noCountry).toEqual(['expenses_ksa / expenses_uae / expenses_egypt'])
  })

  it('the expense grid keeps the ERP header spelling verbatim, including "Trye"', () => {
    const grid = importTargetFor('expenses_ksa')
    expect(grid).toBeTruthy()
    expect(grid.verbatimHeaders).toBe(true)
    expect(grid.columns).toContain('Trye')
    expect(grid.columns).toContain('Values')
  })

  it('importTargetFor resolves a single table out of a combined entry, case-insensitively', () => {
    expect(importTargetFor('EXPENSES_EGYPT')?.feeds).toBe('parts_consumption')
    expect(importTargetFor('daily_km')?.feeds).toMatch(/odometer_logs/)
    expect(importTargetFor('nope')).toBeNull()
    expect(importTargetFor('')).toBeNull()
  })

  it('flags open job cards as the one target where re-importing is safe', () => {
    expect(SAFE_TO_REIMPORT).toContain('stg_open_wo')
    expect(SAFE_TO_REIMPORT).not.toContain('expenses_ksa / expenses_uae / expenses_egypt')
  })

  it('the wo-lines target tells the user to map source_row', () => {
    // Without source_row the server cannot tell a genuine repeated task line from
    // an accidental double import, so the reference has to call it out.
    expect(importTargetFor('stg_wo_lines').notes).toMatch(/source_row/)
  })

  it('exports flat rows with a stable header set', () => {
    const rows = importTargetRows()
    expect(rows).toHaveLength(IMPORT_TARGETS.length)
    expect(Object.keys(rows[0])).toEqual([
      'import_into_table', 'what_it_is', 'ends_up_in', 'source_file',
      'add_country_column', 'headers_must_match_exactly', 'safe_to_upload_twice',
      'columns', 'notes',
    ])
  })
})
