import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  ChevronsUpDown, Columns, Pin, PinOff, RotateCcw, Rows, Search, X,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import Skeleton from './Skeleton'
import ExportMenu from './ExportMenu'
import useAnchoredPopover from './useAnchoredPopover'
import useRegisterView from './useRegisterView'

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

  // ── Level 2: operator-grade layout, all OPT-IN via `viewKey` ──────────────
  // Passing `viewKey` (a stable module key, e.g. 'work-orders') turns on column
  // pinning, resizing and density, and REMEMBERS them per person per register.
  // Every caller that omits it behaves exactly as before — that backward
  // compatibility is deliberate: this component is shared by many pages and a
  // change in default behaviour would land on all of them at once.
  viewKey = null,
  enableColumnPinning = true,
  enableColumnResize = true,
  enableDensity = true,
  enableKeyboard = true,

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

  // ── saved view (Level 2) ───────────────────────────────────────────────────
  // The catalog is DERIVED from the column defs rather than declared separately,
  // so a column added to a page is automatically offered in the picker and
  // automatically appended to every existing saved view. A hand-maintained
  // second list is exactly how a newly shipped column stays invisible to the
  // operators who already have a saved layout.
  const columnCatalog = useMemo(
    () =>
      columns
        .map((c) => {
          const key = c.id || c.accessorKey
          if (!key) return null
          return {
            key: String(key),
            label: typeof c.header === 'string' ? c.header : String(key),
            defaultHidden: c.meta?.defaultHidden === true,
            pinnable: c.meta?.pinnable !== false,
            width: typeof c.size === 'number' ? c.size : undefined,
          }
        })
        .filter(Boolean),
    [columns]
  )

  const rv = useRegisterView(viewKey, columnCatalog, { enabled: !!viewKey })
  const viewActive = rv.active
  const density = viewActive && enableDensity ? rv.tableState.density : 'comfortable'
  const pinningOn = viewActive && enableColumnPinning
  const resizingOn = viewActive && enableColumnResize

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
      // A saved view OWNS visibility/order/pinning/sizing when one is active;
      // the local state is the fallback for every caller without a `viewKey`.
      columnVisibility: viewActive ? rv.tableState.columnVisibility : columnVisibility,
      ...(viewActive
        ? {
            columnOrder: rv.tableState.columnOrder,
            columnSizing: rv.tableState.columnSizing,
            ...(enableColumnPinning ? { columnPinning: rv.tableState.columnPinning } : {}),
          }
        : {}),
      rowSelection: selectionState,
      ...(usePaginationModel ? { pagination } : {}),
    },
    enableSorting,
    enableMultiSort: true,
    enableRowSelection,
    enableColumnFilters,
    columnResizeMode: 'onChange',
    enableColumnResizing: viewActive && enableColumnResize,
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

  // PERSIST A RESIZE ONLY WHEN THE DRAG ENDS. `columnResizeMode: 'onChange'`
  // fires on every mouse move, so writing from the change handler would post a
  // preference row per pixel. The engine clamps the value; this only decides
  // WHEN to hand it over.
  const resizingCol = table.getState().columnSizingInfo?.isResizingColumn || null
  const wasResizing = useRef(null)
  useEffect(() => {
    if (resizingCol) { wasResizing.current = resizingCol; return }
    const finished = wasResizing.current
    wasResizing.current = null
    if (!finished || !resizingOn) return
    const size = table.getState().columnSizing?.[finished]
    if (typeof size === 'number') rv.onWidthChange(finished, size)
  }, [resizingCol, resizingOn, table, rv])

  const rows = table.getRowModel().rows
  const visibleLeafColumns = table.getVisibleLeafColumns()

  // ── keyboard path ─────────────────────────────────────────────────────────
  // `/` search · j/k or arrows move · Enter opens · Esc clears. An operator
  // working a queue all day should not have to reach for the mouse.
  const searchRef = useRef(null)
  const [cursor, setCursor] = useState(-1)
  const rowCount = rows.length
  useEffect(() => { if (cursor >= rowCount) setCursor(rowCount - 1) }, [rowCount, cursor])
  useEffect(() => {
    if (!enableKeyboard) return
    function onKey(e) {
      // Never hijack a key the person is typing into a field, and never fight a
      // browser/OS shortcut.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      const typing =
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (e.key === 'Escape') {
        if (typing) return            // let the field or a dialog own Escape
        setCursor(-1)
        return
      }
      if (typing) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return }
      if (rowCount === 0) return
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault(); setCursor((c) => Math.min(rowCount - 1, c + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault(); setCursor((c) => Math.max(0, c - 1))
      } else if (e.key === 'Enter' && cursor >= 0 && onRowClick) {
        e.preventDefault(); onRowClick(rows[cursor]?.original)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enableKeyboard, rowCount, cursor, onRowClick, rows])
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
                ref={searchRef}
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
            {viewActive && enableDensity && (
              <button
                type="button"
                onClick={() => rv.onDensityChange(density === 'compact' ? 'comfortable' : 'compact')}
                className="btn-ghost text-xs inline-flex items-center gap-1.5"
                aria-pressed={density === 'compact'}
                title={density === 'compact' ? 'Switch to comfortable rows' : 'Switch to compact rows'}
              >
                <Rows size={13} /> {density === 'compact' ? 'Compact' : 'Comfortable'}
              </button>
            )}
            {viewActive && rv.customised && (
              /* Only offered once the layout actually differs from the default,
                 so the control cannot imply a customisation that is not there. */
              <button
                type="button"
                onClick={rv.reset}
                className="btn-ghost text-xs inline-flex items-center gap-1.5"
                title="Reset columns, widths and density to the page default"
              >
                <RotateCcw size={13} /> Reset view
              </button>
            )}
            {enableColumnVisibility && (
              <ColumnVisibilityMenu
                table={table}
                pinningOn={pinningOn}
                onTogglePin={rv.onPinChange}
                onToggleVisibility={viewActive ? rv.onVisibilityChange : undefined}
                maxPinned={rv.limits.maxPinned}
              />
            )}
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
                      const pinned = pinningOn ? header.column.getIsPinned() : false
                      const canResize = resizingOn && header.column.getCanResize()
                      return (
                        <th
                          key={header.id}
                          colSpan={header.colSpan}
                          style={{
                            ...(header.column.columnDef.size || (viewActive && header.getSize())
                              ? { width: viewActive ? header.getSize() : header.column.columnDef.size }
                              : null),
                            ...pinnedStyle(header.column, pinned),
                          }}
                          className={cn(
                            'table-header bg-surface-2 whitespace-nowrap',
                            stickyHeader && 'sticky top-0 z-10',
                            // A pinned column outranks the legacy stickyFirstColumn
                            // flag; honouring both would give two columns the same
                            // left offset and overlap them.
                            pinned === 'left' ? 'sticky z-20'
                              : stickyFirstColumn && colIdx === 0 && 'sticky left-0 z-20',
                            canSort && 'cursor-pointer select-none',
                            canResize && 'relative',
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
                            {pinned === 'left' && <Pin size={10} className="text-[var(--accent)] opacity-70" />}
                          </span>
                          {canResize && (
                            /* stopPropagation, or every drag also toggles the sort. */
                            <span
                              role="separator"
                              aria-orientation="vertical"
                              aria-label={`Resize column`}
                              onMouseDown={(e) => { e.stopPropagation(); header.getResizeHandler()(e) }}
                              onTouchStart={(e) => { e.stopPropagation(); header.getResizeHandler()(e) }}
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => { e.stopPropagation(); header.column.resetSize() }}
                              className={cn(
                                'absolute top-0 right-0 h-full w-1 cursor-col-resize select-none touch-none',
                                'hover:bg-[var(--accent)] opacity-0 hover:opacity-60',
                                header.column.getIsResizing() && 'bg-[var(--accent)] opacity-100',
                              )}
                            />
                          )}
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
                          pinningOn={pinningOn}
                          density={density}
                          focused={enableKeyboard && cursor === vRow.index}
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
                  rows.map((row, i) => (
                    <TableRow
                      key={row.id}
                      row={row}
                      onRowClick={onRowClick}
                      stickyFirstColumn={stickyFirstColumn}
                      pinningOn={pinningOn}
                      density={density}
                      focused={enableKeyboard && cursor === i}
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

/**
 * Left offset for a pinned column. TanStack knows each column's measured start,
 * so a run of pinned columns stacks correctly instead of every one sitting at
 * left:0 on top of the others.
 */
function pinnedStyle(column, pinned) {
  if (pinned !== 'left') return null
  return { left: column.getStart('left') }
}

// ── Row ────────────────────────────────────────────────────────────────────────
function TableRow({ row, onRowClick, stickyFirstColumn, measureRef, dataIndex, pinningOn, density, focused = false }) {
  return (
    <tr
      ref={measureRef}
      data-index={dataIndex}
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      className={cn(
        'transition-colors',
        onRowClick && 'cursor-pointer',
        row.getIsSelected() && 'bg-[var(--brand-subtle)]',
        // Keyboard cursor. Distinct from SELECTION on purpose: "where I am" and
        // "what I ticked" are different facts and must not look the same.
        focused && 'outline outline-2 -outline-offset-2 outline-[var(--accent)]',
      )}
    >
      {row.getVisibleCells().map((cell, colIdx) => {
        const align = cell.column.columnDef.meta?.align
        const pinned = pinningOn ? cell.column.getIsPinned() : false
        return (
          <td
            key={cell.id}
            style={pinnedStyle(cell.column, pinned)}
            className={cn(
              'table-cell',
              // Compact retightens the row without changing the type scale, so
              // the table gets denser without becoming less readable.
              density === 'compact' && '!py-1',
              align === 'right' && 'text-right',
              align === 'center' && 'text-center',
              // A pinned cell MUST carry an opaque background or the scrolled
              // columns show through it.
              pinned === 'left' ? 'sticky z-[1] bg-surface-1'
                : stickyFirstColumn && colIdx === 0 && 'sticky left-0 z-[1] bg-surface-1',
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
function ColumnVisibilityMenu({ table, pinningOn = false, onTogglePin, onToggleVisibility, maxPinned = 4 }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const popRef = useRef(null)
  // Portalled: the table often lives inside `.card`, which clips absolutes.
  const { triggerRef, coords } = useAnchoredPopover(open, { width: 220, height: 300, align: 'right' })

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      const inside = menuRef.current?.contains(e.target) || popRef.current?.contains(e.target)
      if (!inside) setOpen(false)
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
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5"
        aria-haspopup="true"
        aria-expanded={open}
        title="Show / hide columns"
      >
        <Columns size={13} /> Columns
      </button>
      {open && coords && createPortal(
        <div
          ref={popRef}
          className="tp-popover min-w-44 p-1.5"
          style={{ top: coords.top, left: coords.left, maxHeight: coords.maxHeight }}
        >
          {pinningOn && (
            <p className="px-2.5 pt-1 pb-1.5 text-[10px] text-[var(--text-dim)]">
              Tick to show. Use the pin to keep a column in view while scrolling.
            </p>
          )}
          {hideableColumns.map(col => {
            const header = col.columnDef.meta?.exportHeader
              ?? (typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id)
            const isPinned = pinningOn && col.getIsPinned() === 'left'
            const pinnedCount = pinningOn ? (table.getState().columnPinning?.left?.length || 0) : 0
            const pinBlocked = pinningOn && !isPinned && pinnedCount >= maxPinned
            return (
              <div
                key={col.id}
                className="flex items-center gap-1 pr-1 rounded-lg hover:bg-surface-3"
              >
                <label className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] cursor-pointer flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={col.getIsVisible()}
                    // With a saved view active the ENGINE owns visibility: it is
                    // what refuses to hide the last remaining column and what
                    // unpins a column on hide. Writing TanStack's own local state
                    // here would be overwritten on the next render, so the tick
                    // would appear to do nothing.
                    onChange={
                      onToggleVisibility
                        ? () => onToggleVisibility(col.id)
                        : col.getToggleVisibilityHandler()
                    }
                    className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
                  />
                  <span className="truncate">{header || col.id}</span>
                </label>
                {pinningOn && col.getIsVisible() && (
                  <button
                    type="button"
                    onClick={() => onTogglePin?.(col.id)}
                    disabled={pinBlocked}
                    className={cn(
                      'p-1 rounded transition-colors',
                      isPinned ? 'text-[var(--accent)]' : 'text-[var(--text-dim)] hover:text-[var(--text-secondary)]',
                      pinBlocked && 'opacity-30 cursor-not-allowed',
                    )}
                    aria-pressed={isPinned}
                    title={
                      pinBlocked
                        ? `At most ${maxPinned} columns can be pinned`
                        : isPinned ? 'Unpin this column' : 'Pin this column'
                    }
                  >
                    {isPinned ? <Pin size={12} /> : <PinOff size={12} />}
                  </button>
                )}
              </div>
            )
          })}
        </div>,
        document.body
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
