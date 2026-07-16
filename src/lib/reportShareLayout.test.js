import { describe, it, expect } from 'vitest'
import {
  MAX_BOARDS,
  BOARD_COLS_MAX,
  BOARD_ROWS_MAX,
  BLOCK_PRESETS,
  newId,
  vizOptionsFor,
  defaultViz,
  blockFromPreset,
  normalizeBlock,
  normalizeBoard,
  normalizeLayout,
  hasCustomLayout,
  ratioPct,
  resolveBlock,
  STARTER_LAYOUTS,
  emptyLayout,
} from './reportShareLayout'

// A fake snapshot mirroring get_report_snapshot's shape.
const snapshot = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr'],
  kpis: {
    fleet: 604,
    tyres: 1419,
    tyre_spend: 250000,
    accidents: 25,
    open_accidents: 4,
    claims_claimed: 90000,
    claims_recovered: 45000,
    inspections: 300,
    work_orders_open: 12,
  },
  ops: {
    job_cards_today: 7,
    tyre_changes_today: 3,
    pm_overdue: 5,
    alerts_critical: 2,
    open_job_cards: [{ wo_no: 'WO1', asset_no: 'A1' }, { wo_no: 'WO2', asset_no: 'A2' }],
    pm_due_list: [{ name: 'Oil', asset_no: 'A9' }],
  },
  trends: {
    tyre_spend: [1000, 2000, 3000, 4000],
    accidents: [1, 2, 0, 1],
    claims_claimed: [500, 600, 700, 800],
    claims_recovered: [100, 200, 300, 400],
    inspections: [10, 20, 30, 40],
  },
  breakdowns: {
    severity: [{ label: 'Minor', value: 10 }, { label: 'Major', value: 5 }],
    accidents_by_site: [{ label: 'NHC', value: 8 }],
    tyres_by_site: [{ label: 'NHC', value: 700 }],
    claim_status: [],
  },
  heatmap: [{ site: 'NHC', severity: 'Minor', value: 3 }],
}

describe('newId', () => {
  it('prefixes the id and returns unique values', () => {
    const a = newId('blk')
    const b = newId('blk')
    expect(a.startsWith('blk_')).toBe(true)
    expect(b.startsWith('blk_')).toBe(true)
    expect(a).not.toBe(b)
  })
  it('defaults to the "b" prefix', () => {
    expect(newId().startsWith('b_')).toBe(true)
  })
})

describe('vizOptionsFor / defaultViz', () => {
  it('returns the kpi viz list (tile) for a kpi source', () => {
    const opts = vizOptionsFor('kpi.accidents')
    expect(opts.map((o) => o.key)).toEqual(['tile'])
    expect(defaultViz('kpi.accidents')).toBe('tile')
  })
  it('returns the series viz list with area first', () => {
    const opts = vizOptionsFor('trend.tyre_spend')
    expect(opts.map((o) => o.key)).toEqual(['area', 'line', 'bar'])
    expect(defaultViz('trend.tyre_spend')).toBe('area')
  })
  it('returns the breakdown viz list with doughnut first', () => {
    expect(defaultViz('bd.severity')).toBe('doughnut')
  })
  it('returns empty list and tile default for an unknown source', () => {
    expect(vizOptionsFor('nope.nope')).toEqual([])
    expect(defaultViz('nope.nope')).toBe('tile')
  })
})

describe('blockFromPreset', () => {
  it('builds a normalized block from a known preset', () => {
    const blk = blockFromPreset('trend')
    expect(blk.source).toBe('trend.tyre_spend')
    expect(vizOptionsFor(blk.source).map((v) => v.key)).toContain(blk.viz)
    expect(blk.w).toBeLessThanOrEqual(BOARD_COLS_MAX)
    expect(blk.h).toBeLessThanOrEqual(BOARD_ROWS_MAX)
    expect(blk.w).toBeGreaterThanOrEqual(1)
  })
  it('builds a text block from the text preset', () => {
    const blk = blockFromPreset('text')
    expect(blk.type).toBe('text')
    expect(blk.source).toBeNull()
  })
  it('falls back to the first preset for an unknown id', () => {
    const blk = blockFromPreset('does-not-exist')
    const first = BLOCK_PRESETS[0]
    expect(blk.source).toBe(first.source)
  })
})

describe('normalizeBlock', () => {
  it('clamps oversized w/h into range', () => {
    const blk = normalizeBlock({ source: 'trend.tyre_spend', w: 99, h: 99 })
    expect(blk.w).toBe(BOARD_COLS_MAX)
    expect(blk.h).toBe(BOARD_ROWS_MAX)
  })
  it('keeps a text block as text and drops source/viz', () => {
    const blk = normalizeBlock({ type: 'text', text: 'Hello', source: 'kpi.fleet', viz: 'tile' })
    expect(blk.type).toBe('text')
    expect(blk.source).toBeNull()
    expect(blk.viz).toBeNull()
    expect(blk.text).toBe('Hello')
  })
  it('coerces an unknown source to the kpi fallback', () => {
    const blk = normalizeBlock({ source: 'garbage.key' })
    expect(blk.source).toBe('kpi.accidents')
    expect(blk.type).toBe('kpi')
  })
  it('falls back to default viz when the viz is invalid for the source', () => {
    const blk = normalizeBlock({ source: 'trend.tyre_spend', viz: 'doughnut' })
    expect(blk.viz).toBe('area')
  })
  it('defaults showTitle to true; false only when explicitly false', () => {
    expect(normalizeBlock({ source: 'kpi.fleet' }).showTitle).toBe(true)
    expect(normalizeBlock({ source: 'kpi.fleet', showTitle: false }).showTitle).toBe(false)
    expect(normalizeBlock({ source: 'kpi.fleet', showTitle: 0 }).showTitle).toBe(true)
  })
})

describe('normalizeBoard', () => {
  it('clamps cols and rows into range', () => {
    const board = normalizeBoard({ cols: 99, rows: 99, blocks: [] })
    expect(board.cols).toBe(BOARD_COLS_MAX)
    expect(board.rows).toBe(BOARD_ROWS_MAX)
  })
  it('caps blocks and forces each block w <= cols', () => {
    const blocks = Array.from({ length: 40 }, () => ({ source: 'trend.tyre_spend', w: 6, h: 2 }))
    const board = normalizeBoard({ cols: 2, blocks })
    expect(board.blocks.length).toBeLessThanOrEqual(24)
    expect(board.blocks.every((b) => b.w <= 2)).toBe(true)
  })
})

describe('normalizeLayout', () => {
  it('returns null for null, garbage, and empty-boards input', () => {
    expect(normalizeLayout(null)).toBeNull()
    expect(normalizeLayout('nope')).toBeNull()
    expect(normalizeLayout(42)).toBeNull()
    expect(normalizeLayout({ boards: [] })).toBeNull()
    expect(normalizeLayout({})).toBeNull()
  })
  it('returns a versioned layout for a valid input', () => {
    const out = normalizeLayout({ boards: [{ title: 'B', cols: 4, blocks: [] }] })
    expect(out.version).toBe(1)
    expect(out.boards.length).toBe(1)
  })
  it('caps boards at MAX_BOARDS', () => {
    const boards = Array.from({ length: MAX_BOARDS + 5 }, (_, i) => ({ title: `B${i}`, blocks: [] }))
    const out = normalizeLayout({ boards })
    expect(out.boards.length).toBe(MAX_BOARDS)
  })
})

describe('hasCustomLayout', () => {
  it('is false for null and for boards with no blocks', () => {
    expect(hasCustomLayout(null)).toBe(false)
    expect(hasCustomLayout({ boards: [{ title: 'B', blocks: [] }] })).toBe(false)
  })
  it('is true when at least one board has a block', () => {
    expect(hasCustomLayout({ boards: [{ title: 'B', blocks: [{ source: 'kpi.fleet' }] }] })).toBe(true)
  })
})

describe('ratioPct', () => {
  it('returns null when the denominator is not positive', () => {
    expect(ratioPct(5, 0)).toBeNull()
    expect(ratioPct(5, -1)).toBeNull()
  })
  it('computes the correct percentage', () => {
    expect(ratioPct(45000, 90000)).toBe(50)
    expect(ratioPct(1, 4)).toBe(25)
  })
})

describe('resolveBlock', () => {
  it('resolves a text block, empty when blank', () => {
    expect(resolveBlock({ type: 'text', text: 'Hi' }, snapshot)).toMatchObject({ kind: 'text', empty: false })
    expect(resolveBlock({ type: 'text', text: '   ' }, snapshot).empty).toBe(true)
  })
  it('resolves a kpi source from snapshot.kpis', () => {
    const r = resolveBlock({ source: 'kpi.accidents' }, snapshot)
    expect(r.kind).toBe('kpi')
    expect(r.value).toBe(25)
    expect(r.empty).toBe(false)
  })
  it('resolves an ops kpi source from snapshot.ops', () => {
    const r = resolveBlock({ source: 'ops.job_cards_today' }, snapshot)
    expect(r.kind).toBe('kpi')
    expect(r.value).toBe(7)
  })
  it('resolves a series source with labels and data', () => {
    const r = resolveBlock({ source: 'trend.tyre_spend' }, snapshot)
    expect(r.kind).toBe('series')
    expect(r.labels).toEqual(snapshot.labels)
    expect(r.data).toEqual([1000, 2000, 3000, 4000])
    expect(r.empty).toBe(false)
  })
  it('marks a series empty when all values are zero', () => {
    const r = resolveBlock({ source: 'trend.accidents' }, { labels: ['a', 'b'], trends: { accidents: [0, 0] } })
    expect(r.empty).toBe(true)
  })
  it('resolves a breakdown source with items', () => {
    const r = resolveBlock({ source: 'bd.severity' }, snapshot)
    expect(r.kind).toBe('breakdown')
    expect(r.items).toHaveLength(2)
    expect(r.empty).toBe(false)
  })
  it('marks a breakdown empty when the list is empty', () => {
    const r = resolveBlock({ source: 'bd.claim_status' }, snapshot)
    expect(r.empty).toBe(true)
  })
  it('resolves a combo source', () => {
    const r = resolveBlock({ source: 'combo.spend_accidents' }, snapshot)
    expect(r.kind).toBe('combo')
    expect(r.empty).toBe(false)
  })
  it('resolves a claims source', () => {
    const r = resolveBlock({ source: 'claims.claimed_recovered' }, snapshot)
    expect(r.kind).toBe('claims')
    expect(r.empty).toBe(false)
  })
  it('resolves a heatmap source', () => {
    const r = resolveBlock({ source: 'heatmap.site_severity' }, snapshot)
    expect(r.kind).toBe('heatmap')
    expect(r.empty).toBe(false)
  })
  it('resolves a ratio source; null value + empty false when denominator is 0', () => {
    const ok = resolveBlock({ source: 'ratio.recovery' }, snapshot)
    expect(ok.kind).toBe('gauge')
    expect(ok.value).toBe(50)
    const zero = resolveBlock({ source: 'ratio.recovery' }, { kpis: { claims_recovered: 5, claims_claimed: 0 } })
    expect(zero.value).toBeNull()
    expect(zero.empty).toBe(false)
  })
  it('resolves table sources with the right which flag', () => {
    expect(resolveBlock({ source: 'table.pm_due' }, snapshot).which).toBe('pm')
    expect(resolveBlock({ source: 'table.open_job_cards' }, snapshot).which).toBe('jobcards')
  })
  it('never throws on null / empty snapshot', () => {
    expect(() => resolveBlock({ source: 'kpi.accidents' }, null)).not.toThrow()
    expect(resolveBlock({ source: 'kpi.accidents' }, null).value).toBe(0)
    expect(resolveBlock({ source: 'trend.tyre_spend' }, {}).empty).toBe(true)
    expect(resolveBlock({ source: 'bd.severity' }, {}).empty).toBe(true)
  })
})

describe('STARTER_LAYOUTS / emptyLayout', () => {
  it('every starter build() returns a normalized layout with a board that has blocks', () => {
    for (const starter of STARTER_LAYOUTS) {
      const layout = starter.build()
      expect(layout).not.toBeNull()
      expect(layout.boards.length).toBeGreaterThanOrEqual(1)
      expect(layout.boards.some((b) => b.blocks.length > 0)).toBe(true)
    }
  })
  it('emptyLayout returns one empty board', () => {
    const layout = emptyLayout()
    expect(layout.boards).toHaveLength(1)
    expect(layout.boards[0].blocks).toHaveLength(0)
  })
})
