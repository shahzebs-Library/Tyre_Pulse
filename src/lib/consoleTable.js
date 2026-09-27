/**
 * consoleTable - pure helpers every console list uses for sorting, text
 * search and file export, so the ~25 console pages share ONE definition of
 * "how a column sorts" and "what a row exports as" instead of each page
 * re-deriving it.
 *
 *   nextSort(sort, key, defaultDir)   click on a sortable header
 *   compareValues(a, b)               null-last, number/date/text aware
 *   sortRows(rows, sort, accessors)   stable sort, never mutates the input
 *   searchRows(rows, query, fields)   case-insensitive contains on any field
 *   buildExport(rows, columns)        -> { rows, keys, headers } for exportUtils
 *   useTableSort(initial)             React state wrapper around nextSort
 *
 * Blank values always sort LAST whatever the direction: a row with no date is
 * not "the oldest", and putting it first in a descending list would push the
 * real records off the first screen.
 */
import { useCallback, useState } from 'react'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+)?(Z|[+-]\d{2}:?\d{2})?$/

export function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
    || (typeof v === 'number' && Number.isNaN(v))
}

function toComparable(v) {
  if (v instanceof Date) return { kind: 'num', v: v.getTime() }
  if (typeof v === 'number') return { kind: 'num', v }
  if (typeof v === 'boolean') return { kind: 'num', v: v ? 1 : 0 }
  const s = String(v).trim()
  if (ISO_DATE.test(s)) {
    const t = Date.parse(s)
    if (Number.isFinite(t)) return { kind: 'num', v: t }
  }
  // Plain numeric strings ("12", "3.5") compare as numbers, so "9" sorts below "100".
  if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: 'num', v: Number(s) }
  return { kind: 'str', v: s.toLowerCase() }
}

/** Ascending comparison. Blanks are handled by sortRows, not here. */
export function compareValues(a, b) {
  const x = toComparable(a)
  const y = toComparable(b)
  if (x.kind === 'num' && y.kind === 'num') return x.v - y.v
  if (x.kind === 'num') return -1
  if (y.kind === 'num') return 1
  return x.v.localeCompare(y.v, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * The next sort state after a header click. Clicking the active column flips
 * its direction; clicking a new column starts at `defaultDir`.
 */
export function nextSort(sort, key, defaultDir = 'asc') {
  if (!key) return sort
  if (sort && sort.key === key) return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: defaultDir === 'desc' ? 'desc' : 'asc' }
}

function read(row, key, accessors) {
  const fn = accessors && typeof accessors[key] === 'function' ? accessors[key] : null
  if (fn) return fn(row)
  return row == null ? undefined : row[key]
}

/**
 * Stable sort by `sort.key` in `sort.dir`. `accessors` maps a sort key to a
 * function returning the value to compare (for derived columns). Returns a
 * new array; the input is never mutated. Blanks always sort last.
 */
export function sortRows(rows, sort, accessors = {}) {
  const list = Array.isArray(rows) ? rows : []
  if (!sort || !sort.key) return list.slice()
  const dir = sort.dir === 'desc' ? -1 : 1
  return list
    .map((row, i) => ({ row, i, v: read(row, sort.key, accessors) }))
    .sort((a, b) => {
      const ab = isBlank(a.v)
      const bb = isBlank(b.v)
      if (ab && bb) return a.i - b.i
      if (ab) return 1
      if (bb) return -1
      const c = compareValues(a.v, b.v) * dir
      return c !== 0 ? c : a.i - b.i
    })
    .map(x => x.row)
}

/**
 * Case-insensitive "contains" search across `fields` (keys or accessor
 * functions). An empty query returns the rows unchanged.
 */
export function searchRows(rows, query, fields = []) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return list
  return list.filter(row => fields.some(f => {
    const v = typeof f === 'function' ? f(row) : row?.[f]
    return !isBlank(v) && String(v).toLowerCase().includes(q)
  }))
}

/**
 * Shape rows for exportUtils. `columns` is [{ key, header, value? }]; `value`
 * derives the cell (a label instead of a raw token). Blank cells become ''.
 */
export function buildExport(rows, columns = []) {
  const cols = (columns || []).filter(c => c && c.key)
  const out = (Array.isArray(rows) ? rows : []).map(row => {
    const o = {}
    for (const c of cols) {
      const v = typeof c.value === 'function' ? c.value(row) : row?.[c.key]
      o[c.key] = isBlank(v) ? '' : v
    }
    return o
  })
  return { rows: out, keys: cols.map(c => c.key), headers: cols.map(c => c.header || c.key) }
}

/**
 * Write rows to Excel or PDF through exportUtils (lazy-loaded so a console
 * page never pays for the export libraries until someone presses Export).
 */
export async function exportConsoleRows({ rows, columns, title, format = 'excel' }) {
  const { exportToExcel, exportToPdf, reportFileName } = await import('./exportUtils')
  const shaped = buildExport(rows, columns)
  const file = reportFileName(title || 'Console export')
  if (format === 'pdf') {
    await exportToPdf(shaped.rows, shaped.keys.map((k, i) => ({ key: k, header: shaped.headers[i] })),
      title || 'Console export', file, 'landscape')
  } else {
    await exportToExcel(shaped.rows, shaped.keys, shaped.headers, file)
  }
  return shaped.rows.length
}

/** React state wrapper: `const { sort, onSort } = useTableSort({ key, dir })`. */
export function useTableSort(initial = null) {
  const [sort, setSort] = useState(initial)
  const onSort = useCallback((key) => setSort(s => nextSort(s, key)), [])
  return { sort, setSort, onSort }
}
