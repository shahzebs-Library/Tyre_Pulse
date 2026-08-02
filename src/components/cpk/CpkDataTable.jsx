/**
 * CpkDataTable - a production-grade, self-contained data table for the CPK module.
 *
 * Features: column-driven rendering, click-to-sort (numeric + text aware), a search
 * box, client-side pagination (so a large per-vehicle set never renders all at once),
 * a sticky header, honest "N/A" for null CPK cells, and loading / empty states.
 *
 * It is presentational only - the parent supplies already-fetched, already-bounded
 * rows (the module fetches one country + one period at a time).
 */
import { useMemo, useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * @param {{
 *   columns: Array<{ key:string, header:string, align?:'left'|'right',
 *                    kind?:'text'|'number'|'money'|'cpk'|'int',
 *                    render?:(row:object)=>string|number, sortValue?:(row:object)=>number|string }>,
 *   rows: Array<object>,
 *   loading?: boolean,
 *   searchKeys?: string[],       // row keys the search box matches on
 *   initialSort?: { key:string, dir:'asc'|'desc' },
 *   pageSize?: number,
 *   emptyText?: string,
 *   dense?: boolean,
 * }} props
 */
export default function CpkDataTable({
  columns = [],
  rows = [],
  loading = false,
  searchKeys = [],
  initialSort = null,
  pageSize = 25,
  emptyText = 'No rows for this country and period.',
  dense = false,
}) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initialSort)
  const [page, setPage] = useState(0)

  const colByKey = useMemo(() => {
    const m = {}
    for (const c of columns) m[c.key] = c
    return m
  }, [columns])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const base = Array.isArray(rows) ? rows : []
    if (!term || !searchKeys.length) return base
    return base.filter((r) =>
      searchKeys.some((k) => String(r?.[k] ?? '').toLowerCase().includes(term)),
    )
  }, [rows, q, searchKeys])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const col = colByKey[sort.key]
    const dir = sort.dir === 'asc' ? 1 : -1
    const valueOf = (r) => {
      if (col?.sortValue) return col.sortValue(r)
      const raw = r?.[sort.key]
      const n = num(raw)
      return n == null ? String(raw ?? '').toLowerCase() : n
    }
    return [...filtered].sort((a, b) => {
      const av = valueOf(a)
      const bv = valueOf(b)
      const aNull = av == null || av === ''
      const bNull = bv == null || bv === ''
      if (aNull && bNull) return 0
      if (aNull) return 1 // nulls always last
      if (bNull) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [filtered, sort, colByKey])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize)

  function toggleSort(key) {
    setPage(0)
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' }
      if (prev.dir === 'desc') return { key, dir: 'asc' }
      return null
    })
  }

  function fmtCell(col, row) {
    if (col.render) return col.render(row)
    const raw = row?.[col.key]
    if (col.kind === 'cpk') {
      const n = num(raw)
      return n == null ? 'N/A' : n.toFixed(4)
    }
    if (col.kind === 'money' || col.kind === 'int') {
      const n = num(raw)
      return n == null ? 'N/A' : Math.round(n).toLocaleString()
    }
    if (col.kind === 'number') {
      const n = num(raw)
      return n == null ? 'N/A' : n.toLocaleString()
    }
    return raw == null || raw === '' ? 'N/A' : String(raw)
  }

  const cellPad = dense ? 'px-3 py-1.5' : 'px-4 py-2.5'

  return (
    <div className="w-full">
      {searchKeys.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0) }}
              placeholder="Search asset or type"
              className="w-full rounded-md border border-[var(--border-subtle)] bg-transparent pl-8 pr-3 py-1.5 text-sm"
            />
          </div>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {sorted.length.toLocaleString()} row{sorted.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10" style={{ background: 'var(--surface-raised, var(--bg-elevated))' }}>
            <tr>
              {columns.map((col) => {
                const active = sort?.key === col.key
                const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                return (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`${cellPad} cursor-pointer select-none font-semibold whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                      {col.header}
                      <Icon size={12} className={active ? 'opacity-90' : 'opacity-30'} />
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length} className={`${cellPad} text-center`} style={{ color: 'var(--text-secondary)' }}>Loading...</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={columns.length} className={`${cellPad} text-center`} style={{ color: 'var(--text-secondary)' }}>{emptyText}</td></tr>
            ) : (
              pageRows.map((row, i) => (
                <tr key={row.asset_no || row.vehicle_type || i} className="border-t border-[var(--border-subtle)]">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`${cellPad} whitespace-nowrap ${col.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}
                    >
                      {fmtCell(col, row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>Page {safePage + 1} of {pageCount}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-[var(--border-subtle)] px-3 py-1 disabled:opacity-40"
            >Prev</button>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="rounded-md border border-[var(--border-subtle)] px-3 py-1 disabled:opacity-40"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
