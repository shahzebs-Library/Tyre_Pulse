/**
 * Pager - "Showing 26 to 50 of 180" with previous / next and a page size.
 * Renders nothing when everything already fits on one page at the smallest
 * size, so short lists do not carry dead controls.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Btn, Select } from '../../components/ui'
import { PAGE_SIZES } from './usePaged'

export default function Pager({ paged, label = 'rows' }) {
  if (!paged || paged.total <= PAGE_SIZES[0]) return null
  const { page, pages, size, total, from, to, setPage, setSize } = paged
  return (
    <nav aria-label={`Pages of ${label}`} className="flex flex-wrap items-center justify-between gap-2 mt-3 text-[11px] text-gray-500">
      <span className="tabular-nums" aria-live="polite">Showing {from} to {to} of {total} {label}</span>
      <div className="flex items-center gap-2">
        <Select value={String(size)} onChange={(v) => setSize(Number(v))} ariaLabel="Rows per page"
          options={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} per page` }))} className="w-28" />
        <Btn size="xs" icon={ChevronLeft} ariaLabel="Previous page" title="Previous page"
          disabled={page <= 0} onClick={() => setPage(page - 1)} />
        <span className="tabular-nums">Page {page + 1} of {pages}</span>
        <Btn size="xs" icon={ChevronRight} ariaLabel="Next page" title="Next page"
          disabled={page >= pages - 1} onClick={() => setPage(page + 1)} />
      </div>
    </nav>
  )
}
