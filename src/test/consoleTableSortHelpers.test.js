import { describe, it, expect } from 'vitest'
import { compareValues, sortRows, nextSort, isBlank } from '../lib/consoleTable'

describe('consoleTable sort helpers', () => {
  it('treats null, undefined, empty and NaN as blank', () => {
    expect([null, undefined, '', NaN].every(isBlank)).toBe(true)
    expect(isBlank(0)).toBe(false)
  })
  it('compares numbers and numeric strings numerically', () => {
    expect(compareValues(9, 100)).toBeLessThan(0)
    expect(compareValues('9', '100')).toBeLessThan(0)
  })
  it('compares text case-insensitively with numeric awareness', () => {
    expect(compareValues('tm9', 'TM10')).toBeLessThan(0)
  })
  it('keeps blanks last in both directions', () => {
    const rows = [{ v: 2 }, { v: null }, { v: 1 }, { v: '' }]
    expect(sortRows(rows, { key: 'v', dir: 'asc' }).map((r) => r.v)).toEqual([1, 2, null, ''])
    expect(sortRows(rows, { key: 'v', dir: 'desc' }).map((r) => r.v)).toEqual([2, 1, null, ''])
  })
  it('is stable and uses accessors', () => {
    const rows = [{ a: 1, n: 'x' }, { a: 1, n: 'y' }, { a: 0, n: 'z' }]
    expect(sortRows(rows, { key: 'a', dir: 'desc' }).map((r) => r.n)).toEqual(['x', 'y', 'z'])
    expect(sortRows(rows, { key: 'len', dir: 'asc' }, { len: (r) => r.n.charCodeAt(0) }).map((r) => r.n)).toEqual(['x', 'y', 'z'])
  })
  it('does not mutate input and handles no sort key', () => {
    const rows = [{ v: 2 }, { v: 1 }]
    const out = sortRows(rows, { key: null })
    expect(out).toEqual(rows)
    expect(out).not.toBe(rows)
    expect(sortRows(null, { key: 'v' })).toEqual([])
  })
  it('nextSort toggles on the same key and resets on a new key', () => {
    expect(nextSort(null, 'a', 'desc')).toEqual({ key: 'a', dir: 'desc' })
    expect(nextSort({ key: 'a', dir: 'desc' }, 'a')).toEqual({ key: 'a', dir: 'asc' })
    expect(nextSort({ key: 'a', dir: 'asc' }, 'b', 'asc')).toEqual({ key: 'b', dir: 'asc' })
  })
})
