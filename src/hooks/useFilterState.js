/**
 * useFilterState — syncs filter state bidirectionally with URL search params.
 *
 * Usage:
 *   const [filters, setFilter, resetFilters, hasActiveFilters, setFilters] = useFilterState({
 *     status: '',
 *     country: '',
 *     brand: '',
 *     site: '',
 *     search: '',
 *   })
 *
 * Reading: filters.status, filters.search, etc.
 * Writing: setFilter('status', 'Active')  — updates URL + state atomically
 * Batch:   setFilters({ status: 'Active', country: 'KSA' })
 * Reset:   resetFilters()  — clears all back to defaults
 *
 * URL example: /tyres?status=Active&country=KSA&brand=Bridgestone
 *
 * Notes:
 *  - Uses { replace: true } so back/forward skips individual keystrokes.
 *  - Cleans the URL by omitting params whose value matches the default.
 *  - Safe to nest inside any component wrapped by a <Router>.
 */
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export function useFilterState(defaults = {}) {
  const [searchParams, setSearchParams] = useSearchParams()

  // Read current values: URL params override defaults
  const filters = useMemo(() => {
    const result = { ...defaults }
    for (const key of Object.keys(defaults)) {
      const val = searchParams.get(key)
      if (val !== null) result[key] = val
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Set a single filter — removes param if value matches default (keeps URL clean)
  const setFilter = useCallback(
    (key, value) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev)
          if (
            value === '' ||
            value === null ||
            value === undefined ||
            value === defaults[key]
          ) {
            next.delete(key)
          } else {
            next.set(key, String(value))
          }
          return next
        },
        { replace: true },
      )
    },
    // defaults is a stable reference passed from outside; referencing it directly
    // avoids a stale-closure bug if the caller memoises the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setSearchParams],
  )

  // Set multiple filters atomically in a single history entry
  const setFilters = useCallback(
    updates => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(updates)) {
            if (
              value === '' ||
              value === null ||
              value === undefined ||
              value === defaults[key]
            ) {
              next.delete(key)
            } else {
              next.set(key, String(value))
            }
          }
          return next
        },
        { replace: true },
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setSearchParams],
  )

  // Reset all managed filter keys to defaults (leaves unrelated params untouched)
  const resetFilters = useCallback(() => {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev)
        for (const key of Object.keys(defaults)) {
          next.delete(key)
        }
        return next
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSearchParams])

  // True when at least one filter deviates from its default
  const hasActiveFilters = useMemo(
    () =>
      Object.entries(filters).some(
        ([key, val]) => val !== '' && val !== (defaults[key] ?? ''),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters],
  )

  return [filters, setFilter, resetFilters, hasActiveFilters, setFilters]
}
