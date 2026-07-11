import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  ChevronsUpDown, Columns, RotateCcw, Search, X,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import Skeleton from './Skeleton'
import ExportMenu from './ExportMenu'

/**
 * EnterpriseTable - reusable data table built on @tanstack/react-table v8.
 *
 * Features: debounced global search, per-column filters (text/select via
 * column `meta.filterVariant`), multi-sort (shift-click), pagination with a
 * page-size selector OR row virtualization (`virtual` prop), sticky header,
 * optional sticky first column, column show/hide dropdown, row selection with
 * a bulk-actions slot, client-side CSV export, and loading/error/empty states.
 *
 * Column def extensions (TanStack `meta`):
 *   meta.filterVariant  'text' | 'select'  - renders a filter input under the header
 *   meta.filterOptions  string[]           - options for 'select' (else faceted values)
 *   meta.export         false              - exclude column from CSV export
 *   meta.exportHeader   string             - CSV header override
 *   meta.exportValue    (original) => any  - CSV cell override
 *   meta.align          'right'|'center'   - cell text alignment
 *
 * Server-driven tables: pass `manualPagination` with `pageIndex`, `pageCount`,
 * `totalRows`, `onPageChange` (and optional `pageSize`/`onPageSizeChange`);
 * filtering/sorting then applies only to the rows currently loaded.
 */
export default function EnterpriseTable({
  columns,
  data = [],
  getRowId,
  className,

  // states
  loading = false,
  error = null,
  onRetry,
  emptyMessage = 'No records found',
  emptyIcon = null,
  skeletonRows = 8,

  // search / filters
  enableGlobalFilter = true,
  searchPlaceholder = 'Search…',
  searchDebounceMs = 250,
  enableColumnFilters = true,

  // sorting
  enableSorting = true,

  // pagination
  pageSizeOptions = [25, 50, 100],
  initialPageSize = 25,
  manualPagination = false,
  pageIndex,
  pageCount,
  totalRows,
  onPageChange,
  pageSize,
  onPageSizeChange,
  paginationLabel,

  // virtualization (client-side rows only; replaces pagination)
  virtual = false,
  rowHeight = 44,
  maxHeight = 560,

  // layout
  stickyHeader = true,
  stickyFirstColumn = false,

  // column visibility
  enableColumnVisibility = true,

  // selection
  enableRowSelection = false,
  rowSelection: controlledSelection,
  onRowSelectionChange,
  bulkActions,

  // export
  enableExport = true,
  exportFileName = 'table_export',
  // report metadata for state-faithful PDF/Excel/CSV exports:
  // { title, company, currency, branding, dateRange }
  reportMeta = null,

  // extras
  toolbarExtras = null,
  onRowClick,
}) {
  // ── table state ────────────────────────────────────────────────────────────
  const [sorting, setSorting] = useState([])
  const [columnFilters, setColumnFilters] = useState([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [searchText, setSearchText] = useState('')
  const [columnVisibility, setColumnVisibility] = useState({})
  const [internalSelection, setInternalSelection] = useState({})
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: initialPageSize })

  const selectionState = controlledSelection ?? internalSelection
  const handleSelectionChange = useCallback(
    updater => {
      const apply = prev => (typeof updater === 'function' ? updater(prev) : updater)
      if (onRowSelectionChange) onRowSelectionChange(apply(selectionState))
      else setInternalSelection(apply)
    },
    [onRowSelectionChange, selectionState]
  )

  // Debounced global search - avoids re-filtering large datasets per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setGlobalFilter(searchText), searchDebounceMs)
    return () => clearTimeout(handle)
  }, [searchText, searchDebounceMs])

  // ── selection column (injected when selection is enabled) ─────────────────
  const allColumns = useMemo(() => {
    if (!enableRowSelection) return columns
    const selectColumn = {
      id: '__select',
      size: 36,
      enableSorting: false,
      enableHiding: false,
      meta: { export: false },
      header: ({ table }) => (
        <IndeterminateCheckbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          ariaLabel="Select all rows on this page"
        />
      ),
      cell: ({ row }) => (
        <span onClick={e => e.stopPropagation()}>
          <IndeterminateCheckbox
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onChange={row.getToggleSelectedHandler()}
            ariaLabel="Select row"
          />
        </span>
      ),
    }
    return [selectColumn, ...columns]
  }, [columns, enableRowSelection])

  // ── table instance ─────────────────────────────────────────────────────────
  const usePaginationModel = !virtual && !manualPagination
  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      columnVisibility,
      rowSelection: selectionState,
      ...(usePaginationModel ? { pagination } : {}),
    },
    enableSorting,
    enableMultiSort: true,
    enableRowSelection,
    enableColumnFilters,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: handleSelectionChange,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    ...(usePaginationModel ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    autoResetPageIndex: false,
    manualPagination: manualPagination || virtual,
  })

  const rows = table.getRowModel().rows
  const visibleLeafColumns = table.getVisibleLeafColumns()
  const colCount = visibleLeafColumns.length
  const selectedRows = table.getSelectedRowModel().rows
  const hasFilterRow =
    enableColumnFilters &&
    visibleLeafColumns.some(col => col.getCanFilter() && col.columnDef.meta?.filterVariant)

  // ── virtualization ─────────────────────────────────────────────────────────
  const scrollRef = useRef(null)
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  })
  const virtualItems = virtual ? virtualizer.getVirtualItems() : []
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0

  // ── pagination footer values ───────────────────────────────────────────────
  const effectivePageIndex = manualPagination ? (pageIndex ?? 0) : table.getState().pagination?.pageIndex ?? 0
  const effectivePageCount = manualPagination ? (pageCount ?? 1) : table.getPageCount()
  const effectivePageSize = manualPagination
    ? (pageSize ?? initialPageSize)
    : table.getState().pagination?.pageSize ?? initialPageSize
  const filteredTotal = manualPagination
    ? (totalRows ?? data.length)
    : table.getPrePaginationRowModel().rows.length
  const fromRow = filteredTotal === 0 ? 0 : effectivePageIndex * effectivePageSize + 1
  const toRow = Math.min((effectivePageIndex + 1) * effectivePageSize, filteredTotal)

  function goToPage(next) {
    const clamped = Math.max(0, Math.min(next, effectivePageCount - 1))
    if (manualPagination) onPageChange?.(clamped)
    else table.setPageIndex(clamped)
  }

  function changePageSize(size) {
    if (manualPagination) onPageSizeChange?.(size)
    else table.setPageSize(size)
  }

  const showPageSizeSelector = !virtual && (!manualPagination || typeof onPageSizeChange === 'function')
  const showToolbar =
    enableGlobalFilter || enableColumnVisibility || (enableExport && !error) ||
    toolbarExtras || (enableRowSelection && bulkActions && selectedRows.length > 0)

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className={cn('card p-0 overflow-hidden', className)}>
      {/* Toolbar */}
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border-dim)]">
          {enableGlobalFilter && (
            <div className="relative flex-1 min-w-48 max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                className="input pl-9 pr-8 py-2"
                placeholder={searchPlaceholder}
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                aria-label={searchPlaceholder}
              />
              {searchText && (
                <button
                  type="button"
                  onClick={() => { setSearchText(''); setGlobalFilter('') }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-[var(--text-primary)] transition-colors"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {/* Bulk actions slot */}
          {enableRowSelection && bulkActions && selectedRows.length > 0 && (
            <div className="flex items-center gap-2">
              {bulkActions(selectedRows.map(r => r.original), () => table.resetRowSelection())}
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {toolbarExtras}
            {enableColumnVisibility && <ColumnVisibilityMenu table={table} />}
            {enableExport && !error && (
              <ExportMenu
                table={table}
                fileName={exportFileName}
                meta={reportMeta || {}}
                hasSelection={selectedRows.length > 0}
                disabled={loading}
              />
            )}
          </div>
        </div>
      )}

      {/* Error state */}
      {error ? (
        <div className="flex flex-col items-center gap-3 py-14 px-6 text-center">
          <AlertTriangle size={26} className="text-red-400" />
          <p className="text-sm text-[var(--text-secondary)] max-w-md">
            {typeof error === 'string' ? error : error?.message || 'Failed to load data'}
          </p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5">
              <RotateCcw size={13} /> Retry
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="overflow-x-auto"
            style={virtual ? { maxHeight, overflowY: 'auto' } : undefined}
          >
            <table className="w-full">
              <thead>
                <tr>
                  {table.getHeaderGroups().map(headerGroup =>
                    headerGroup.headers.map((header, colIdx) => {
                      const canSort = enableSorting && header.column.getCanSort()
                      const sortDir = header.column.getIsSorted()
                      const sortIndex = header.column.getSortIndex()
                      return (
                        <th
                          key={header.id}
                          colSpan={header.colSpan}
                          style={header.column.columnDef.size ? { width: header.column.columnDef.size } : undefined}
                          className={cn(
                            'table-header bg-surface-2 whitespace-nowrap',
                            stickyHeader && 'sticky top-0 z-10',
                            stickyFirstColumn && colIdx === 0 && 'sticky left-0 z-20',
                            canSort && 'cursor-pointer select-none',
                          )}
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          aria-sort={sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : undefined}
                          title={canSort ? 'Click to sort · Shift+Click for multi-sort' : undefined}
                        >
                          <span className="inline-flex items-center gap-1">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                            {canSort && (
                              sortDir === 'asc' ? <ChevronUp size={12} className="text-[var(--accent)]" />
                              : sortDir === 'desc' ? <ChevronDown size={12} className="text-[var(--accent)]" />
                              : <ChevronsUpDown size={12} className="opacity-40" />
                            )}
                            {sortDir && sorting.length > 1 && sortIndex > -1 && (
                              <span className="text-[9px] font-bold text-[var(--accent)]">{sortIndex + 1}</span>
                            )}
                          </span>
                        </th>
                      )
                    })
                  )}
                </tr>

                {/* Per-column filter row */}
                {hasFilterRow && (
                  <tr>
                    {visibleLeafColumns.map((col, colIdx) => (
                      <th
                        key={col.id}
                        className={cn(
                          'px-2 py-1.5 bg-surface-1 border-b border-[var(--border-dim)]',
                          stickyHeader && 'sticky z-10',
                          stickyFirstColumn && colIdx === 0 && 'sticky left-0 z-20',
                        )}
                        style={stickyHeader ? { top: 'var(--et-header-h, 37px)' } : undefined}
                      >
                        {col.getCanFilter() && col.columnDef.meta?.filterVariant ? (
                          <ColumnFilter column={col} />
                        ) : null}
                      </th>
                    ))}
                  </tr>
                )}
              </thead>

              <tbody>
                {loading ? (
                  Array.from({ length: skeletonRows }).map((_, i) => (
                    <tr key={`skeleton-${i}`}>
                      <td colSpan={colCount} className="px-3.5 py-3">
                        <Skeleton className="h-4 w-full" style={{ opacity: 1 - i * 0.08 }} />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="text-center py-14">
                      <div className="flex flex-col items-center gap-2.5 text-muted">
                        {emptyIcon || <span className="text-3xl opacity-30" aria-hidden="true">◎</span>}
                        <span className="text-sm">{emptyMessage}</span>
                      </div>
                    </td>
                  </tr>
                ) : virtual ? (
                  <>
                    {paddingTop > 0 && (
                      <tr aria-hidden="true"><td colSpan={colCount} style={{ height: paddingTop, padding: 0, border: 0 }} /></tr>
                    )}
                    {virtualItems.map(vRow => {
                      const row = rows[vRow.index]
                      return (
                        <TableRow
                          key={row.id}
                          row={row}
                          onRowClick={onRowClick}
                          stickyFirstColumn={stickyFirstColumn}
                          measureRef={virtualizer.measureElement}
                          dataIndex={vRow.index}
                        />
                      )
                    })}
                    {paddingBottom > 0 && (
                      <tr aria-hidden="true"><td colSpan={colCount} style={{ height: paddingBottom, padding: 0, border: 0 }} /></tr>
                    )}
                  </>
                ) : (
                  rows.map(row => (
                    <TableRow
                      key={row.id}
                      row={row}
                      onRowClick={onRowClick}
                      stickyFirstColumn={stickyFirstColumn}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          {!virtual && !loading && filteredTotal > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border-dim)]">
              <p className="text-sm text-muted">
                {paginationLabel
                  ? paginationLabel({ from: fromRow, to: toRow, total: filteredTotal, page: effectivePageIndex + 1, pageCount: effectivePageCount })
                  : `${fromRow.toLocaleString()} to ${toRow.toLocaleString()} of ${filteredTotal.toLocaleString()}`}
              </p>
              <div className="flex items-center gap-2">
                {showPageSizeSelector && (
                  <select
                    className="input w-auto py-1.5 px-2 text-xs"
                    value={effectivePageSize}
                    onChange={e => changePageSize(Number(e.target.value))}
                    aria-label="Rows per page"
                  >
                    {pageSizeOptions.map(size => (
                      <option key={size} value={size}>{size} / page</option>
                    ))}
                  </select>
                )}
                {effectivePageCount > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => goToPage(effectivePageIndex - 1)}
                      disabled={effectivePageIndex === 0}
                      className="btn-secondary py-1.5 px-3 disabled:opacity-40"
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm text-muted whitespace-nowrap">
                      {effectivePageIndex + 1} / {effectivePageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => goToPage(effectivePageIndex + 1)}
                      disabled={effectivePageIndex >= effectivePageCount - 1}
                      className="btn-secondary py-1.5 px-3 disabled:opacity-40"
                      aria-label="Next page"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Row ────────────────────────────────────────────────────────────────────────
function TableRow({ row, onRowClick, stickyFirstColumn, measureRef, dataIndex }) {
  return (
    <tr
      ref={measureRef}
      data-index={dataIndex}
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      className={cn(
        'transition-colors',
        onRowClick && 'cursor-pointer',
        row.getIsSelected() && 'bg-[var(--brand-subtle)]',
      )}
    >
      {row.getVisibleCells().map((cell, colIdx) => {
        const align = cell.column.columnDef.meta?.align
        return (
          <td
            key={cell.id}
            className={cn(
              'table-cell',
              align === 'right' && 'text-right',
              align === 'center' && 'text-center',
              stickyFirstColumn && colIdx === 0 && 'sticky left-0 z-[1] bg-surface-1',
            )}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        )
      })}
    </tr>
  )
}

// ── Per-column filter input ────────────────────────────────────────────────────
function ColumnFilter({ column }) {
  const { filterVariant, filterOptions, filterPlaceholder } = column.columnDef.meta ?? {}
  const value = column.getFilterValue() ?? ''

  if (filterVariant === 'select') {
    const options =
      filterOptions ??
      Array.from(column.getFacetedUniqueValues().keys())
        .filter(v => v !== null && v !== undefined && v !== '')
        .sort()
    return (
      <select
        className="input w-full py-1 px-2 text-xs"
        value={value}
        onChange={e => column.setFilterValue(e.target.value || undefined)}
        aria-label={`Filter ${column.id}`}
      >
        <option value="">All</option>
        {options.map(opt => (
          <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
        ))}
      </select>
    )
  }

  return (
    <input
      className="input w-full py-1 px-2 text-xs"
      value={value}
      onChange={e => column.setFilterValue(e.target.value || undefined)}
      placeholder={filterPlaceholder ?? 'Filter…'}
      aria-label={`Filter ${column.id}`}
    />
  )
}

// ── Column visibility dropdown ─────────────────────────────────────────────────
function ColumnVisibilityMenu({ table }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const hideableColumns = table.getAllLeafColumns().filter(col => col.getCanHide())
  if (hideableColumns.length === 0) return null

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5"
        aria-haspopup="true"
        aria-expanded={open}
        title="Show / hide columns"
      >
        <Columns size={13} /> Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-30 min-w-44 max-h-72 overflow-y-auto rounded-xl border border-[var(--border-dim)] bg-surface-2 shadow-float p-1.5">
          {hideableColumns.map(col => {
            const header = col.columnDef.meta?.exportHeader
              ?? (typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id)
            return (
              <label
                key={col.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-surface-3 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={col.getIsVisible()}
                  onChange={col.getToggleVisibilityHandler()}
                  className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
                />
                <span className="truncate">{header || col.id}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Checkbox with indeterminate support ────────────────────────────────────────
function IndeterminateCheckbox({ indeterminate = false, ariaLabel, ...rest }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !rest.checked && indeterminate
  }, [indeterminate, rest.checked])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={ariaLabel}
      className="w-4 h-4 rounded accent-[var(--accent)] cursor-pointer align-middle"
      {...rest}
    />
  )
}
