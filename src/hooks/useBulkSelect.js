/**
 * useBulkSelect - manages multi-row selection state for table bulk operations.
 *
 * Usage:
 *   const { selected, toggle, toggleAll, clear, isSelected, isAllSelected, count } =
 *     useBulkSelect(rows, 'id')
 */
import { useState, useCallback, useMemo } from 'react'

export function useBulkSelect(rows = [], idKey = 'id') {
  const [selected, setSelected] = useState(new Set())

  const toggle = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected(prev => {
      const allIds = rows.map(r => r[idKey])
      const allSelected = allIds.every(id => prev.has(id))
      return allSelected ? new Set() : new Set(allIds)
    })
  }, [rows, idKey])

  const clear = useCallback(() => setSelected(new Set()), [])

  const isSelected = useCallback((id) => selected.has(id), [selected])

  const isAllSelected = useMemo(() =>
    rows.length > 0 && rows.every(r => selected.has(r[idKey])),
    [rows, selected, idKey]
  )

  const isSomeSelected = useMemo(() =>
    rows.some(r => selected.has(r[idKey])) && !isAllSelected,
    [rows, selected, idKey, isAllSelected]
  )

  const selectedRows = useMemo(() =>
    rows.filter(r => selected.has(r[idKey])),
    [rows, selected, idKey]
  )

  return {
    selected,         // Set<id>
    selectedRows,     // full row objects for selected items
    toggle,
    toggleAll,
    clear,
    isSelected,
    isAllSelected,
    isSomeSelected,
    count: selected.size,
  }
}
