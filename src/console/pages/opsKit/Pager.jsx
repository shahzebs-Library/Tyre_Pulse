/**
 * Pager + usePaged - client paging for console tables so a long list reads
 * as pages, not an endless wall. The page resets to 1 whenever the list it
 * pages (search, filter, sort) changes identity length, and clamps if rows
 * disappear under it (a resolve, a rescan).
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Btn } from '../../components/ui'

export const PAGE_SIZE = 25

export function usePaged(rows, size = PAGE_SIZE, resetKey = '') {
  const list = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(list.length / size))
  useEffect(() => { setPage(1) }, [resetKey])
  useEffect(() => { if (page > pages) setPage(pages) }, [page, pages])
  const slice = useMemo(() => list.slice((page - 1) * size, page * size), [list, page, size])
  return { page: Math.min(page, pages), pages, setPage, slice, total: list.length, size }
}

export default function Pager({ page, pages, total, size = PAGE_SIZE, setPage, label = 'rows' }) {
  if (!total) return null
  const from = (page - 1) * size + 1
  const to = Math.min(total, page * size)
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 mt-3 text-[11px] text-gray-500">
      <span className="tabular-nums">{from} to {to} of {total} {label}</span>
      {pages > 1 && (
        <span className="flex items-center gap-1.5">
          <Btn size="xs" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage(page - 1)} ariaLabel="Previous page" title="Previous page" />
          <span className="tabular-nums">Page {page} of {pages}</span>
          <Btn size="xs" icon={ChevronRight} disabled={page >= pages} onClick={() => setPage(page + 1)} ariaLabel="Next page" title="Next page" />
        </span>
      )}
    </nav>
  )
}
