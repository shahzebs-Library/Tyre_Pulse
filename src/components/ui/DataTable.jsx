import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * DataTable — premium animated data table with loading/empty states and pagination.
 *
 * @param {Array}    columns   — [{ key, label, render?, width?, align? }]
 * @param {Array}    rows      — data rows
 * @param {boolean}  loading
 * @param {string}   emptyMsg
 * @param {ReactNode} emptyIcon
 * @param {number}   page      — 0-indexed current page
 * @param {number}   totalPages
 * @param {function} onPage    — (page) => void
 * @param {number}   total     — total record count
 * @param {string}   rowKey    — key field for row identity (default 'id')
 * @param {function} onRowClick
 * @param {Set}      selected  — Set of selected row ids
 * @param {function} onSelect  — (id) => void
 * @param {boolean}  selectable
 */
export default function DataTable({
  columns = [],
  rows = [],
  loading = false,
  emptyMsg = 'No records found',
  emptyIcon,
  page = 0,
  totalPages = 1,
  onPage,
  total,
  rowKey = 'id',
  onRowClick,
  selected,
  onSelect,
  selectable = false,
  className,
}) {
  return (
    <div className={cn('flex flex-col gap-0 rounded-2xl border border-[var(--border-dim)] overflow-hidden', className)}>
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-dim)] bg-surface-2">
              {selectable && (
                <th className="w-10 px-4 py-3">
                  <span className="sr-only">Select</span>
                </th>
              )}
              {columns.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.width && `w-[${col.width}]`
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            <AnimatePresence mode="wait">
              {loading ? (
                <motion.tr
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <td colSpan={columns.length + (selectable ? 1 : 0)} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted">
                      <Loader2 className="w-6 h-6 animate-spin text-brand" />
                      <span className="text-sm">Loading…</span>
                    </div>
                  </td>
                </motion.tr>
              ) : rows.length === 0 ? (
                <motion.tr
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <td colSpan={columns.length + (selectable ? 1 : 0)} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted">
                      {emptyIcon || <div className="text-3xl opacity-30">◎</div>}
                      <span className="text-sm">{emptyMsg}</span>
                    </div>
                  </td>
                </motion.tr>
              ) : (
                rows.map((row, i) => {
                  const id = row[rowKey]
                  const isSelected = selected?.has(id)
                  return (
                    <motion.tr
                      key={id ?? i}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.018, duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(
                        'border-b border-[var(--border-subtle)] transition-colors',
                        'bg-surface-0',
                        onRowClick && 'cursor-pointer',
                        isSelected ? 'bg-[rgba(22,163,74,0.06)]' : 'hover:bg-surface-1',
                      )}
                    >
                      {selectable && (
                        <td className="px-4 py-3 w-10" onClick={e => { e.stopPropagation(); onSelect?.(id) }}>
                          <div className={cn(
                            'w-4 h-4 rounded border transition-all flex items-center justify-center',
                            isSelected
                              ? 'bg-brand border-brand'
                              : 'border-[var(--border-dim)] hover:border-brand/40'
                          )}>
                            {isSelected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                          </div>
                        </td>
                      )}
                      {columns.map(col => (
                        <td
                          key={col.key}
                          className={cn(
                            'px-4 py-3 text-sm',
                            col.align === 'right' && 'text-right',
                            col.align === 'center' && 'text-center',
                          )}
                        >
                          {col.render ? col.render(row[col.key], row) : (
                            <span className="text-gray-300">{row[col.key] ?? '—'}</span>
                          )}
                        </td>
                      ))}
                    </motion.tr>
                  )
                })
              )}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 bg-surface-1 border-t border-[var(--border-dim)]">
          <span className="text-xs text-muted">
            {total != null ? `${total.toLocaleString()} records` : `Page ${page + 1} of ${totalPages}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPage?.(page - 1)}
              disabled={page === 0}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-white hover:bg-surface-3 disabled:opacity-30 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-muted px-2">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => onPage?.(page + 1)}
              disabled={page >= totalPages - 1}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-white hover:bg-surface-3 disabled:opacity-30 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
