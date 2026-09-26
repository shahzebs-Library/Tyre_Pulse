import { describe, it, expect } from 'vitest'
import { nextSort, compareValues, sortRows, searchRows, buildExport } from '../lib/consoleTable'

describe('consoleTable', () => {
  it('nextSort flips the active column and starts a new one at the default', () => {
    expect(nextSort(null, 'a')).toEqual({ key: 'a', dir: 'asc' })
    expect(nextSort({ key: 'a', dir: 'asc' }, 'a')).toEqual({ key: 'a', dir: 'desc' })
    expect(nextSort({ key: 'a', dir: 'desc' }, 'a')).toEqual({ key: 'a', dir: 'asc' })
    expect(nextSort({ key: 'a', dir: 'desc' }, 'b', 'desc')).toEqual({ key: 'b', dir: 'desc' })
    expect(nextSort({ key: 'a', dir: 'asc' }, '')).toEqual({ key: 'a', dir: 'asc' })
  })

  it('compares numeric strings as numbers and ISO dates as time', () => {
    expect(compareValues('9', '100')).toBeLessThan(0)
    expect(compareValues('2026-01-02', '2025-12-31')).toBeGreaterThan(0)
    expect(compareValues('beta', 'Alpha')).toBeGreaterThan(0)
    expect(compareValues(true, false)).toBeGreaterThan(0)
  })

  it('sorts stably, never mutates, and keeps blanks last in both directions', () => {
    const rows = [{ n: 2 }, { n: null }, { n: 10 }, { n: '' }, { n: 1 }]
    const asc = sortRows(rows, { key: 'n', dir: 'asc' }).map(r => r.n)
    const desc = sortRows(rows, { key: 'n', dir: 'desc' }).map(r => r.n)
    expect(asc).toEqual([1, 2, 10, null, ''])
    expect(desc).toEqual([10, 2, 1, null, ''])
    expect(rows[0].n).toBe(2)
    expect(sortRows(rows, null)).not.toBe(rows)
  })

  it('uses accessors for derived columns', () => {
    const rows = [{ a: { b: 3 } }, { a: { b: 1 } }]
    expect(sortRows(rows, { key: 'x', dir: 'asc' }, { x: r => r.a.b }).map(r => r.a.b)).toEqual([1, 3])
  })

  it('searches case-insensitively across keys and accessors', () => {
    const rows = [{ name: 'Alpha', tag: 'x' }, { name: 'Beta', tag: null }]
    expect(searchRows(rows, 'alp', ['name'])).toHaveLength(1)
    expect(searchRows(rows, 'ETA', [r => r.name])).toHaveLength(1)
    expect(searchRows(rows, '  ', ['name'])).toHaveLength(2)
    expect(searchRows(null, 'a', ['name'])).toEqual([])
  })

  it('builds export rows with derived values and blank cells as empty text', () => {
    const out = buildExport([{ a: 1, b: null }], [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }, { key: 'c', header: 'C', value: r => r.a * 2 }])
    expect(out.keys).toEqual(['a', 'b', 'c'])
    expect(out.headers).toEqual(['A', 'B', 'C'])
    expect(out.rows).toEqual([{ a: 1, b: '', c: 2 }])
  })
})
