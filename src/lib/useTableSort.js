import { useCallback, useMemo, useState } from 'react'
import { nextSort, sortRows } from './consoleTableSort'

/**
 * Sort state + sorted rows for a console Table. Pass the result's `sort` and
 * `onSort` straight to <Th sortKey=... sort={sort} onSort={onSort}>.
 */
export function useTableSort(rows, initial = { key: null, dir: 'desc' }, accessors) {
  const [sort, setSort] = useState(initial)
  const onSort = useCallback((key) => setSort((s) => nextSort(s, key)), [])
  // accessors are expected to be stable (module level); rows drive recompute.
  const sorted = useMemo(() => sortRows(rows, sort, accessors), [rows, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  return { sort, onSort, sorted, setSort }
}
