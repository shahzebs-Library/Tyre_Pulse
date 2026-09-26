import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, RefreshCw, Download, Search, AlertTriangle, Trash2, Check } from 'lucide-react'
import { listDuplicateKeyTyres, resolveDuplicateKey } from '../../lib/api/reconDupKeys'
import { toUserMessage } from '../../lib/safeError'
import { formatDate } from '../../lib/formatters'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import EnterpriseTable from '../ui/EnterpriseTable'

/**
 * Possible duplicate tyres - a READ-ONLY data-reconciliation section for the
 * Data Reconciliation page. Lists groups of tyre_records that share the same
 * (serial_no, asset_no, issue_date, country) fitment key on more than one
 * record but may differ in other columns.
 *
 * This is DISTINCT from the "Exact duplicates" section (which merges
 * byte-identical rows). These groups are FLAGGED for manual review only; the
 * section never mutates or deletes any tyre.
 *
 * Renders its own card matching the page section shell, a per-country summary,
 * a country + serial filter, an Excel export, and honest
 * loading / empty / error states.
 *
 * @param {object}  [props]
 * @param {string}  [props.activeCountry]  optional initial country filter
 */
export default function DupKeyTyresSection({ activeCountry } = {}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const initialCountry =
    activeCountry && activeCountry !== 'All' ? activeCountry : 'All'
  const [country, setCountry] = useState(initialCountry)
  const [search, setSearch] = useState('')

  // Per-row resolve state. busyKey = the row being resolved; rowNotes maps a
  // row key to an inline note left in place when the group could not be
  // auto-removed. resultNote is a dismissable success line for the section.
  const [busyKey, setBusyKey] = useState(null)
  const [rowNotes, setRowNotes] = useState({})
  const [resultNote, setResultNote] = useState(null)

  const rowKey = useCallback(
    (r) =>
      `${r.serial_no || 'x'}|${r.asset_no || 'x'}|${r.issue_date || 'x'}|${r.country || 'x'}`,
    [],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setRowNotes({})
    setResultNote(null)
    try {
      const data = await listDuplicateKeyTyres()
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(toUserMessage(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Resolve ONE group. Confirms first (this deletes rows), then calls the
  // byte-identical-only server RPC. resolved:true removes the row locally and
  // shows a success line; resolved:false leaves the row with an inline note.
  const handleResolve = useCallback(
    async (r) => {
      const key = rowKey(r)
      const label = `${r.serial_no || 'N/A'} / ${r.asset_no || 'N/A'}`
      const ok = window.confirm(
        `Resolve possible duplicate for ${label}?\n\n` +
          'Byte-identical copies will be removed and the newest record kept. ' +
          'If the records differ, nothing is deleted and the group is kept for manual review.',
      )
      if (!ok) return
      setBusyKey(key)
      setResultNote(null)
      setRowNotes((n) => {
        const next = { ...n }
        delete next[key]
        return next
      })
      try {
        const res = await resolveDuplicateKey(r.serial_no, r.asset_no, r.issue_date)
        if (res && res.resolved) {
          const deleted = Number(res.deleted) || 0
          setRows((prev) => prev.filter((x) => rowKey(x) !== key))
          setResultNote(
            `Resolved ${label}: removed ${deleted} duplicate copy${deleted === 1 ? '' : 'ies'}, kept the newest record.`,
          )
        } else if (res && res.reason === 'differs') {
          setRowNotes((n) => ({
            ...n,
            [key]: { kind: 'differs', text: 'Rows differ - review manually' },
          }))
        } else {
          setRowNotes((n) => ({
            ...n,
            [key]: { kind: 'differs', text: 'Group no longer present - refresh' },
          }))
        }
      } catch (e) {
        setRowNotes((n) => ({
          ...n,
          [key]: { kind: 'error', text: toUserMessage(e) },
        }))
      } finally {
        setBusyKey(null)
      }
    },
    [rowKey],
  )

  useEffect(() => {
    load()
  }, [load])

  // Total number of duplicate-key groups across all countries.
  const total = rows.length

  // Per-country group counts, derived from the rows (independent of the filter).
  const summary = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const c = r.country || 'Unknown'
      map.set(c, (map.get(c) || 0) + 1)
    }
    return Array.from(map.entries())
      .map(([c, count]) => ({ country: c, count }))
      .sort((a, b) => b.count - a.count)
  }, [rows])

  const countryOptions = useMemo(() => summary.map((s) => s.country), [summary])

  // Country scope then client-side search over serial + asset.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (country !== 'All' && (r.country || 'Unknown') !== country) return false
      if (!q) return true
      const serial = String(r.serial_no || '').toLowerCase()
      const asset = String(r.asset_no || '').toLowerCase()
      return serial.includes(q) || asset.includes(q)
    })
  }, [rows, country, search])

  const columns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial_no || 'N/A', size: 150,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.serial_no || 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 120 },
    { id: 'date', header: 'Fitment date', accessorFn: (r) => r.issue_date || '', size: 130,
      meta: { exportValue: (r) => (r.issue_date ? formatDate(r.issue_date, r.country || 'All') : 'N/A') },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-muted)]">{row.original.issue_date ? formatDate(row.original.issue_date, row.original.country || 'All') : 'N/A'}</span> },
    { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 100 },
    { id: 'copies', header: 'Copies', accessorFn: (r) => Number(r.copies) || 0, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{(Number(row.original.copies) || 0).toLocaleString()}</span> },
    {
      id: 'action', header: 'Action', size: 220, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        const key = rowKey(r)
        const note = rowNotes[key]
        const busy = busyKey === key
        return (
          <div className="flex flex-col items-end gap-1">
            <button type="button" onClick={() => handleResolve(r)} disabled={busy}
              aria-label={`Resolve possible duplicate for serial ${r.serial_no || 'N/A'}`}
              className="btn-secondary min-h-[44px] text-xs inline-flex items-center gap-1.5 disabled:opacity-40">
              {busy ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Resolve
            </button>
            {note ? (
              <span role={note.kind === 'error' ? 'alert' : undefined}
                className={`text-[11px] ${note.kind === 'error' ? 'text-red-400' : 'text-amber-500'} max-w-[220px] text-right break-words`}>
                {note.text}
              </span>
            ) : null}
          </div>
        )
      },
    },
  ], [rowKey, rowNotes, busyKey, handleResolve])

  function exportRows() {
    const out = filteredRows.map((r) => ({
      serial_no: r.serial_no || 'N/A',
      asset_no: r.asset_no || 'N/A',
      issue_date: r.issue_date
        ? formatDate(r.issue_date, r.country || 'All')
        : 'N/A',
      country: r.country || 'N/A',
      copies: Number(r.copies) || 0,
    }))
    exportToExcel(
      out,
      ['serial_no', 'asset_no', 'issue_date', 'country', 'copies'],
      ['Serial', 'Asset', 'Fitment date', 'Country', 'Copies'],
      reportFileName('TyrePulse Possible Duplicate Tyres'),
    )
  }

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border-dim)]">
        <div className="w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center justify-center shrink-0">
          <Copy className="w-4 h-4 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">Possible duplicate tyres</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border-dim)] text-[var(--text-secondary)]">{total}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Same serial, asset and fitment date on more than one record. Review these; they are flagged only, never changed automatically.</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button
          type="button"
          onClick={exportRows}
          disabled={loading || filteredRows.length === 0}
          className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <Download size={13} /> Export
        </button>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Error + Retry */}
        {error ? (
          <div role="alert" className="rounded-lg border border-red-800/50 bg-red-950/20 px-4 py-3 flex flex-wrap items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">Could not load this section</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 break-words">{error}</p>
            </div>
            <button type="button" onClick={load} className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5 shrink-0">
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-10 text-[var(--text-muted)]">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : (
          <>
            {/* Per-country summary tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {summary.length === 0 ? (
                <div className="col-span-full text-xs text-[var(--text-muted)]">No duplicate-key groups.</div>
              ) : (
                summary.map((s) => {
                  const isActive = country === s.country
                  return (
                    <button
                      key={s.country}
                      type="button"
                      onClick={() => setCountry(isActive ? 'All' : s.country)}
                      className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                        isActive
                          ? 'bg-[var(--surface-2)] border-[var(--text-muted)]'
                          : 'bg-[var(--surface-2)] border-[var(--border-dim)] hover:border-[var(--text-muted)]'
                      }`}
                    >
                      <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">{s.country}</p>
                      <p className="text-lg font-bold mt-1 text-[var(--text-primary)] tabular-nums">
                        {s.count.toLocaleString()} <span className="text-sm font-normal text-[var(--text-muted)]">group{s.count === 1 ? '' : 's'}</span>
                      </p>
                    </button>
                  )
                })
              )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setCountry('All')}
                  className={`text-xs px-3 min-h-[44px] rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    country === 'All'
                      ? 'bg-[var(--surface-2)] border-[var(--text-muted)] text-[var(--text-primary)]'
                      : 'bg-[var(--surface-1)] border-[var(--border-dim)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
                  }`}
                >
                  All
                </button>
                {countryOptions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCountry(c)}
                    className={`text-xs px-3 min-h-[44px] rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                      country === c
                        ? 'bg-[var(--surface-2)] border-[var(--text-muted)] text-[var(--text-primary)]'
                        : 'bg-[var(--surface-1)] border-[var(--border-dim)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search serial or asset"
                  aria-label="Search possible duplicate tyres by serial or asset"
                  className="w-full bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg pl-9 pr-3 min-h-[44px] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)]"
                />
              </div>
            </div>

            {/* Success note after a resolve */}
            {resultNote ? (
              <div className="rounded-lg border border-green-800/50 bg-green-950/20 px-4 py-3 flex items-start gap-3">
                <Check className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                <p className="text-sm text-[var(--text-primary)] flex-1 min-w-0 break-words">{resultNote}</p>
                <button
                  type="button"
                  onClick={() => setResultNote(null)}
                  className="text-xs text-green-300/80 hover:text-[var(--text-primary)] shrink-0"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {/* Table / empty state */}
            {filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center justify-center mb-3">
                  <Copy className="w-5 h-5 text-[var(--text-muted)]" />
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {search.trim() || country !== 'All' ? 'No matching tyres' : 'No duplicate-key tyres'}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {search.trim() || country !== 'All'
                    ? 'No duplicate-key group matches the current filter.'
                    : 'No tyre records share the same serial, asset and fitment date in the current scope.'}
                </p>
              </div>
            ) : (
              <EnterpriseTable
                columns={columns}
                data={filteredRows}
                getRowId={(r, i) => `${rowKey(r)}|${i}`}
                enableKeyboard={false}
                enableGlobalFilter={false}
                emptyMessage="No matching tyres"
                exportFileName={reportFileName('TyrePulse Possible Duplicate Tyres')}
                reportMeta={{ title: 'Possible duplicate tyres' }}
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}
