/**
 * TablePagination + usePagedRows - one pagination behaviour for every table.
 *
 * WHY THIS EXISTS
 * ---------------
 * Around a hundred pages rendered a long list as `rows.slice(0, N)` - a hard
 * cap, usually 200 or 500, with no way to reach row N+1 and, on most of them,
 * nothing on screen saying rows had been dropped. `EngineHours` capped at 500
 * against 4,379 stored readings, so 3,879 were simply unreachable and the table
 * looked complete. A silent cap is worse than a slow page: the reader draws a
 * conclusion from data they cannot see is missing.
 *
 * So: page the rows, default 50 per page, and always state the totals.
 *
 * TWO PIECES, DELIBERATELY SEPARATE
 * ---------------------------------
 * `usePagedRows` owns the arithmetic and holds no opinion about markup, so it
 * suits any layout - a table, a card grid, a list. `TablePagination` is the bar.
 * A page can use the hook with its own controls, but should not reimplement the
 * arithmetic: the clamping and the reset rule below are where this gets fiddly.
 *
 * THE RESET RULE IS THE SUBTLE PART
 * ---------------------------------
 * When a filter narrows 4,000 rows to 12, a reader sitting on page 40 must not
 * be left staring at an empty table - which reads as "the filter found nothing"
 * rather than "you are past the end". The hook therefore returns to page 1
 * whenever the SIZE of the row set changes, and separately clamps the page into
 * range on every render so an out-of-bounds page can never render blank.
 *
 * Size is the right trigger rather than identity: most pages rebuild the array
 * in a `useMemo` on each render, so keying on the array reference would reset
 * the page on every keystroke and the reader could never leave page 1. Keying
 * on size does mean a filter that happens to match exactly as many rows keeps
 * the page - harmless, and the clamp still guarantees a populated page.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'

/** Default rows per page across the app. */
export const DEFAULT_PAGE_SIZE = 50

/** Offered sizes. 200 is the ceiling - beyond that the browser, not the server, is the limit. */
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

/**
 * Slice `rows` into pages.
 *
 * @param {Array} rows        the FULL filtered+sorted set, never a pre-capped slice
 * @param {object} [opts]
 * @param {number} [opts.pageSize]  initial size (default 50)
 * @returns {{pageRows:Array, page:number, setPage:Function, pageSize:number,
 *            setPageSize:Function, total:number, totalPages:number,
 *            from:number, to:number}}
 *            `from`/`to` are 1-indexed for display and are 0 when empty.
 */
export function usePagedRows(rows, opts = {}) {
  // Memoised: a bare `Array.isArray(rows) ? rows : []` mints a new empty array
  // on every render when rows is null, which would defeat the slice memo below
  // and re-slice on each keystroke.
  const list = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const [pageSize, setPageSizeRaw] = useState(opts.pageSize || DEFAULT_PAGE_SIZE)
  const [page, setPage] = useState(0)

  const total = list.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Return to the first page when the result set changes size - see the note
  // above on why size and not identity.
  const lastSize = useRef(total)
  useEffect(() => {
    if (lastSize.current !== total) {
      lastSize.current = total
      setPage(0)
    }
  }, [total])

  // Clamp on every render. The effect above cannot cover a page-size change in
  // the same commit, and an out-of-range page must never render an empty table.
  const safePage = Math.min(Math.max(0, page), totalPages - 1)

  const pageRows = useMemo(
    () => list.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [list, safePage, pageSize],
  )

  function setPageSize(size) {
    // Keep the first visible row visible, so changing the size does not throw
    // the reader to an unrelated part of a long list.
    const firstVisible = safePage * pageSize
    setPageSizeRaw(size)
    setPage(Math.floor(firstVisible / size))
  }

  return {
    pageRows,
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    total,
    totalPages,
    from: total === 0 ? 0 : safePage * pageSize + 1,
    to: Math.min(total, safePage * pageSize + pageSize),
  }
}

/**
 * The bar. Renders nothing when a single page holds everything AND the reader
 * has not changed the size - there is no navigating to do, and an inert control
 * is just noise on a short list.
 */
export function TablePagination({
  page, setPage, pageSize, setPageSize, total, totalPages, from, to,
  showSizeSelector = true,
  className = '',
}) {
  const { t } = useLanguage()
  if (total <= PAGE_SIZE_OPTIONS[0] && totalPages <= 1) return null

  const label = t('ui.table.showingRange', { from, to, total: total.toLocaleString() })

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[var(--input-border)] ${className}`}
    >
      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
        <span>
          {label === 'ui.table.showingRange'
            ? `Showing ${from} to ${to} of ${total.toLocaleString()}`
            : label}
        </span>
        {showSizeSelector && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">{t('ui.table.rowsPerPage')}</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)]"
              aria-label={t('ui.table.rowsPerPage')}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex items-center gap-1">
        <PageBtn onClick={() => setPage(0)} disabled={page === 0} label={t('ui.table.first')}>
          <ChevronsLeft size={15} />
        </PageBtn>
        <PageBtn onClick={() => setPage(page - 1)} disabled={page === 0} label={t('ui.table.previous')}>
          <ChevronLeft size={15} />
        </PageBtn>
        <span className="px-2 text-xs font-semibold text-[var(--text-secondary)] tabular-nums">
          {page + 1} / {totalPages}
        </span>
        <PageBtn
          onClick={() => setPage(page + 1)}
          disabled={page >= totalPages - 1}
          label={t('ui.table.next')}
        >
          <ChevronRight size={15} />
        </PageBtn>
        <PageBtn
          onClick={() => setPage(totalPages - 1)}
          disabled={page >= totalPages - 1}
          label={t('ui.table.last')}
        >
          <ChevronsRight size={15} />
        </PageBtn>
      </div>
    </div>
  )
}

function PageBtn({ onClick, disabled, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="p-1.5 rounded-lg border border-[var(--input-border)] text-[var(--text-secondary)] hover:bg-[var(--input-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  )
}

export default TablePagination
