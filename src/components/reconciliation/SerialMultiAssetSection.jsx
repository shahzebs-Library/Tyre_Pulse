import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, RefreshCw, Download, Search, AlertTriangle } from 'lucide-react'
import { listSerialMultiAsset } from '../../lib/api/reconSerialConflict'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import EnterpriseTable from '../ui/EnterpriseTable'

/**
 * Serial on multiple assets - a READ-ONLY data-reconciliation section for the
 * Data Reconciliation page. Lists tyre serials that appear against more than
 * one asset: usually a tyre that MOVED between vehicles over its life,
 * occasionally a data-entry error.
 *
 * This is INFORMATIONAL ONLY. The section never mutates, merges or deletes any
 * tyre record; it surfaces the groups for manual review.
 *
 * Renders its own card matching the page section shell, a per-country summary,
 * a country + serial filter, an Excel export, and honest
 * loading / empty / error states.
 *
 * @param {object}  [props]
 * @param {string}  [props.activeCountry]  optional initial country filter
 */
export default function SerialMultiAssetSection({ activeCountry } = {}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const initialCountry =
    activeCountry && activeCountry !== 'All' ? activeCountry : 'All'
  const [country, setCountry] = useState(initialCountry)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listSerialMultiAsset()
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(toUserMessage(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Total number of multi-asset serial groups across all countries.
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

  // Country scope then client-side search over serial + assets.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (country !== 'All' && (r.country || 'Unknown') !== country) return false
      if (!q) return true
      const serial = String(r.serial_no || '').toLowerCase()
      const assets = String(r.assets || '').toLowerCase()
      return serial.includes(q) || assets.includes(q)
    })
  }, [rows, country, search])

  const columns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial_no || 'N/A', size: 160,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.serial_no || 'N/A'}</span> },
    { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 100 },
    { id: 'count', header: 'Asset count', accessorFn: (r) => Number(r.asset_count) || 0, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{(Number(row.original.asset_count) || 0).toLocaleString()}</span> },
    { id: 'assets', header: 'Assets', accessorFn: (r) => r.assets || 'N/A', size: 320,
      cell: ({ row }) => <span className="break-words whitespace-normal text-[var(--text-secondary)]">{row.original.assets || 'N/A'}</span> },
  ], [])

  function exportRows() {
    const out = filteredRows.map((r) => ({
      serial_no: r.serial_no || 'N/A',
      country: r.country || 'N/A',
      asset_count: Number(r.asset_count) || 0,
      assets: r.assets || 'N/A',
    }))
    exportToExcel(
      out,
      ['serial_no', 'country', 'asset_count', 'assets'],
      ['Serial', 'Country', 'Asset count', 'Assets'],
      reportFileName('TyrePulse Serial On Multiple Assets'),
    )
  }

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border-dim)]">
        <div className="w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center justify-center shrink-0">
          <ArrowLeftRight className="w-4 h-4 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">Serial on multiple assets</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border-dim)] text-[var(--text-secondary)]">{total}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">The same serial appears on more than one asset. Usually a tyre that moved between vehicles; review for possible data errors. Nothing is changed.</p>
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
                <div className="col-span-full text-xs text-[var(--text-muted)]">No multi-asset serials.</div>
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
                        {s.count.toLocaleString()} <span className="text-sm font-normal text-[var(--text-muted)]">serial{s.count === 1 ? '' : 's'}</span>
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
                  aria-label="Search serials on multiple assets"
                  className="w-full bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg pl-9 pr-3 min-h-[44px] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)]"
                />
              </div>
            </div>

            {/* Table / empty state */}
            {filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center justify-center mb-3">
                  <ArrowLeftRight className="w-5 h-5 text-[var(--text-muted)]" />
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {search.trim() || country !== 'All' ? 'No matching serials' : 'No serial appears on multiple assets'}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {search.trim() || country !== 'All'
                    ? 'No multi-asset serial matches the current filter.'
                    : 'Every tyre serial is recorded against a single asset in the current scope.'}
                </p>
              </div>
            ) : (
              <EnterpriseTable
                columns={columns}
                data={filteredRows}
                getRowId={(r, i) => `${r.serial_no || 'x'}|${r.country || 'x'}|${i}`}
                enableKeyboard={false}
                enableGlobalFilter={false}
                emptyMessage="No matching serials"
                exportFileName={reportFileName('TyrePulse Serial On Multiple Assets')}
                reportMeta={{ title: 'Serial on multiple assets' }}
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}
