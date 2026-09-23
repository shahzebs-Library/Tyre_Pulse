import { describe, it, expect } from 'vitest'
import {
  normalizeView, resolveColumns, toggleColumn, moveColumn, togglePin,
  setWidth, cycleSort, isCustomised, describeView, emptyView, LIMITS,
} from '../lib/registerViews'

const CATALOG = [
  { key: 'asset', label: 'Asset' },
  { key: 'site', label: 'Site' },
  { key: 'status', label: 'Status' },
  { key: 'cost', label: 'Cost' },
  { key: 'notes', label: 'Notes', defaultHidden: true },
  { key: 'actions', label: 'Actions', pinnable: false },
]

describe('savedViews - catalog reconciliation', () => {
  it('APPENDS a newly shipped column and shows it', () => {
    // The silent failure this prevents: a release adds a column, every operator
    // with a saved view never sees it, and months later it is reported missing.
    const stored = { columns: ['asset', 'site'], hidden: [] }
    const v = normalizeView(stored, CATALOG)
    expect(v.columns).toContain('cost')
    expect(v.hidden).not.toContain('cost')
  })

  it('a brand new column marked defaultHidden starts hidden', () => {
    const v = normalizeView({ columns: ['asset'] }, CATALOG)
    expect(v.columns).toContain('notes')
    expect(v.hidden).toContain('notes')
  })

  it('but a defaultHidden column the view ALREADY showed stays shown', () => {
    // The operator deliberately turned it on; a later normalise must not undo that.
    const v = normalizeView({ columns: ['asset', 'notes'] }, CATALOG)
    expect(v.hidden).not.toContain('notes')
  })

  it('DROPS a column that no longer exists rather than rendering a ghost header', () => {
    const v = normalizeView({ columns: ['asset', 'retired_col', 'site'] }, CATALOG)
    expect(v.columns).not.toContain('retired_col')
    expect(v.columns[0]).toBe('asset')
  })

  it('drops a sort that names a vanished column instead of ordering by nothing', () => {
    expect(normalizeView({ sort: { key: 'retired_col', dir: 'asc' } }, CATALOG).sort).toBeNull()
    expect(normalizeView({ sort: { key: 'cost', dir: 'desc' } }, CATALOG).sort).toEqual({ key: 'cost', dir: 'desc' })
  })

  it('de-duplicates a repeated column key', () => {
    const v = normalizeView({ columns: ['asset', 'asset', 'site'] }, CATALOG)
    expect(v.columns.filter((k) => k === 'asset')).toHaveLength(1)
  })

  it('never throws on a corrupt or hostile stored blob', () => {
    for (const bad of [null, undefined, 0, 'x', [], { columns: 'nope', hidden: 7, widths: 'no', pinned: {}, filters: [] }]) {
      const v = normalizeView(bad, CATALOG)
      expect(Array.isArray(v.columns)).toBe(true)
      expect(v.columns.length).toBe(CATALOG.length)
    }
  })

  it('survives an empty catalog', () => {
    const v = normalizeView({ columns: ['asset'] }, [])
    expect(v.columns).toEqual([])
    expect(v.sort).toBeNull()
  })
})

describe('savedViews - widths and pinning', () => {
  it('clamps widths into the legible range', () => {
    const v = normalizeView({ widths: { asset: 5, site: 9999, cost: 200 } }, CATALOG)
    expect(v.widths.asset).toBe(LIMITS.minWidth)
    expect(v.widths.site).toBe(LIMITS.maxWidth)
    expect(v.widths.cost).toBe(200)
  })

  it('ignores a non-numeric width and coerces a numeric string', () => {
    const v = normalizeView({ widths: { asset: 'wide', site: '180' } }, CATALOG)
    expect(v.widths.asset).toBeUndefined()
    expect(v.widths.site).toBe(180)
  })

  it('caps the number of pinned columns', () => {
    const v = normalizeView({ pinned: ['asset', 'site', 'status', 'cost', 'notes'] }, CATALOG)
    expect(v.pinned.length).toBeLessThanOrEqual(LIMITS.maxPinned)
  })

  it('refuses to pin a column the catalog marks unpinnable', () => {
    expect(normalizeView({ pinned: ['actions'] }, CATALOG).pinned).toEqual([])
  })

  it('refuses to pin a hidden column', () => {
    const v = normalizeView({ columns: ['asset', 'site'], hidden: ['site'], pinned: ['site'] }, CATALOG)
    expect(v.pinned).not.toContain('site')
  })
})

describe('savedViews - operations', () => {
  it('hiding a column removes it from the rendered set', () => {
    const v = toggleColumn(emptyView('wo'), CATALOG, 'site')
    expect(v.hidden).toContain('site')
    expect(resolveColumns(v, CATALOG).map((c) => c.key)).not.toContain('site')
  })

  it('will not let the operator hide the LAST visible column', () => {
    // A blank table is unrecoverable unless you know the reset control exists.
    let v = emptyView('wo')
    for (const c of CATALOG) v = toggleColumn(v, CATALOG, c.key)
    expect(resolveColumns(v, CATALOG).length).toBe(1)
  })

  it('hiding a pinned column unpins it so the pin rail has no empty slot', () => {
    let v = togglePin(emptyView('wo'), CATALOG, 'asset')
    expect(v.pinned).toEqual(['asset'])
    v = toggleColumn(v, CATALOG, 'asset')
    expect(v.pinned).toEqual([])
  })

  it('renders pinned columns first, in pin order', () => {
    let v = togglePin(emptyView('wo'), CATALOG, 'cost')
    v = togglePin(v, CATALOG, 'asset')
    expect(resolveColumns(v, CATALOG).slice(0, 2).map((c) => c.key)).toEqual(['cost', 'asset'])
  })

  it('moves a column and clamps an out-of-range index', () => {
    const v = moveColumn(emptyView('wo'), CATALOG, 'asset', 99)
    expect(v.columns[v.columns.length - 1]).toBe('asset')
    const back = moveColumn(v, CATALOG, 'asset', -5)
    expect(back.columns[0]).toBe('asset')
  })

  it('cycles sort none -> asc -> desc -> none', () => {
    let v = emptyView('wo')
    v = cycleSort(v, CATALOG, 'cost'); expect(v.sort).toEqual({ key: 'cost', dir: 'asc' })
    v = cycleSort(v, CATALOG, 'cost'); expect(v.sort).toEqual({ key: 'cost', dir: 'desc' })
    v = cycleSort(v, CATALOG, 'cost'); expect(v.sort).toBeNull()
  })

  it('sorting a different column restarts at asc', () => {
    let v = cycleSort(emptyView('wo'), CATALOG, 'cost')
    v = cycleSort(v, CATALOG, 'site')
    expect(v.sort).toEqual({ key: 'site', dir: 'asc' })
  })

  it('setWidth cannot bypass the clamp', () => {
    expect(setWidth(emptyView('wo'), CATALOG, 'asset', 99999).widths.asset).toBe(LIMITS.maxWidth)
  })
})

describe('savedViews - reporting', () => {
  it('a fresh view is not customised, a changed one is', () => {
    expect(isCustomised(emptyView('wo'), CATALOG)).toBe(false)
    expect(isCustomised(toggleColumn(emptyView('wo'), CATALOG, 'site'), CATALOG)).toBe(true)
    expect(isCustomised(cycleSort(emptyView('wo'), CATALOG, 'cost'), CATALOG)).toBe(true)
  })

  it('describes the view in plain words using catalog labels', () => {
    let v = cycleSort(emptyView('wo'), CATALOG, 'cost')
    v = togglePin(v, CATALOG, 'asset')
    const s = describeView(v, CATALOG)
    expect(s).toContain('of 6 columns')   // notes is defaultHidden
    expect(s).toContain('1 pinned')
    expect(s).toContain('sorted by Cost') // the LABEL, not the key
  })

  it('truncates an over-long view name rather than letting it break the chip', () => {
    expect(normalizeView({ name: 'x'.repeat(200) }, CATALOG).name).toHaveLength(LIMITS.nameMax)
  })
})
