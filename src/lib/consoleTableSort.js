// Pure sorting engine for console data tables.
// Rules: blank values (null, undefined, '', NaN) always sort LAST in either
// direction, so "no data" never masquerades as the smallest or largest value.
// Numbers (and numeric strings) compare numerically, everything else with a
// case-insensitive, numeric-aware locale compare. The sort is stable: rows that
// compare equal keep their incoming order.

export function isBlank(v) {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))
}

function asNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  return null
}

export function compareValues(a, b) {
  const ab = isBlank(a)
  const bb = isBlank(b)
  if (ab && bb) return 0
  if (ab) return 1
  if (bb) return -1
  const na = asNumber(a)
  const nb = asNumber(b)
  if (na !== null && nb !== null) return na === nb ? 0 : na < nb ? -1 : 1
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Sort rows by sort.key in sort.dir. `accessors` may map a key to a function
 * (row) => value for derived columns. Returns a new array; input untouched.
 */
export function sortRows(rows = [], sort, accessors = {}) {
  const list = Array.isArray(rows) ? rows : []
  if (!sort || !sort.key) return [...list]
  const get = typeof accessors[sort.key] === 'function' ? accessors[sort.key] : (r) => (r == null ? undefined : r[sort.key])
  const dir = sort.dir === 'asc' ? 1 : -1
  return list
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((x, y) => {
      const xb = isBlank(x.v)
      const yb = isBlank(y.v)
      if (xb || yb) {
        if (xb && yb) return x.i - y.i
        return xb ? 1 : -1
      }
      const c = compareValues(x.v, y.v) * dir
      return c !== 0 ? c : x.i - y.i
    })
    .map((e) => e.row)
}

/** Next sort state after clicking a column. A new column starts at defaultDir. */
export function nextSort(prev, key, defaultDir = 'desc') {
  if (!prev || prev.key !== key) return { key, dir: defaultDir }
  return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
}
