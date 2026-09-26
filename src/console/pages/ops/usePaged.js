/**
 * usePaged - client-side paging for a console table. The page resets to the
 * first one whenever the row set changes size (a new filter or search), so a
 * reader is never left on page 7 of a list that now has one page.
 */
import { useEffect, useMemo, useState } from 'react'

export const PAGE_SIZES = [10, 25, 50, 100]

export default function usePaged(rows, initialSize = 25) {
  const list = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(initialSize)
  const pages = Math.max(1, Math.ceil(list.length / size))
  useEffect(() => { setPage(0) }, [list.length, size])
  const current = Math.min(page, pages - 1)
  const slice = useMemo(() => list.slice(current * size, current * size + size), [list, current, size])
  return {
    rows: slice, page: current, pages, size, total: list.length,
    setPage, setSize,
    from: list.length ? current * size + 1 : 0,
    to: Math.min(list.length, current * size + size),
  }
}
