/**
 * useFilterState - syncs filter state bidirectionally with URL search params.
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
 * Writing: setFilter('status', 'Active')  - updates URL + state atomically
 * Batch:   setFilters({ status: 'Active', country: 'KSA' })
 * Reset:   resetFilters()  - clears all back to defaults
 *
 * URL example: /tyres?status=Active&country=KSA&brand=Bridgestone
 *
 * Notes:
 *  - Uses { replace: true } so back/forward skips individual keystrokes.
 *  - Cleans the URL by omitting params whose value matches the default.
 *  - Safe to nest inside any component wrapped by a <Router>.
 *
 * Why a local mirror: the router applies a URL change a moment after it is
 * requested. A text box bound straight to the URL therefore re-rendered with
 * the PREVIOUS value between keystrokes, and fast typing - or a barcode scanner
 * typing like a keyboard - kept only the last character. The mirror updates
 * synchronously; the URL follows. A URL change we did not write (Back/Forward,
 * a link) still replaces the mirror.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

function readFilters(defaults, searchParams) {
  const result = { ...defaults }
  for (const key of Object.keys(defaults)) {
    const val = searchParams.get(key)
    if (val !== null) result[key] = val
  }
  return result
}

function isDefault(defaults, key, value) {
  return value === '' || value === null || value === undefined || value === defaults[key]
}

export function useFilterState(defaults = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults

  const urlFilters = useMemo(() => readFilters(defaultsRef.current, searchParams), [searchParams])
  const [local, setLocal] = useState(urlFilters)
  // Query strings this hook asked the router for and has not seen land yet.
  const pendingRef = useRef(new Set())

  useEffect(() => {
    const qs = searchParams.toString()
    if (pendingRef.current.has(qs)) {
      // Our own write arrived; anything older is superseded.
      pendingRef.current.delete(qs)
      return
    }
    pendingRef.current.clear()
    setLocal(urlFilters)
  }, [searchParams, urlFilters])

  const write = useCallback(
    (updates, clearAll = false) => {
      const d = defaultsRef.current
      setLocal(prev => {
        const next = clearAll ? { ...d } : { ...prev }
        for (const [key, value] of Object.entries(updates)) {
          next[key] = isDefault(d, key, value) ? d[key] : String(value)
        }
        return next
      })
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev)
          if (clearAll) for (const key of Object.keys(d)) next.delete(key)
          for (const [key, value] of Object.entries(updates)) {
            if (isDefault(d, key, value)) next.delete(key)
            else next.set(key, String(value))
          }
          pendingRef.current.add(next.toString())
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const setFilter = useCallback((key, value) => write({ [key]: value }), [write])
  const setFilters = useCallback(updates => write(updates), [write])
  const resetFilters = useCallback(() => write({}, true), [write])

  const filters = local

  const hasActiveFilters = useMemo(
    () =>
      Object.entries(filters).some(
        ([key, val]) => val !== '' && val !== (defaultsRef.current[key] ?? ''),
      ),
    [filters],
  )

  return [filters, setFilter, resetFilters, hasActiveFilters, setFilters]
}
