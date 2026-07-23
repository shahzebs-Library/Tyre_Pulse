import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, RefreshCw, Download, Search, AlertTriangle } from 'lucide-react'
import { listDuplicateKeyTyres } from '../../lib/api/reconDupKeys'
import { toUserMessage } from '../../lib/safeError'
import { formatDate } from '../../lib/formatters'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'

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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
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
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--card-border)]">
        <div className="w-9 h-9 rounded-lg bg-gray-800/60 border border-gray-700/40 flex items-center justify-center shrink-0">
          <Copy className="w-4.5 h-4.5 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">Possible duplicate tyres</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800/70 border border-gray-700/50 text-[var(--text-secondary)]">{total}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Same serial, asset and fitment date on more than one record. Review these; they are flagged only, never changed automatically.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="btn-secondary text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button
          onClick={exportRows}
          disabled={loading || filteredRows.length === 0}
          className="btn-secondary text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <Download size={13} /> Export
        </button>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Error + Retry */}
        {error ? (
          <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-200">Could not load this section</p>
              <p className="text-xs text-red-300/80 mt-0.5 break-words">{error}</p>
            </div>
            <button onClick={load} className="btn-secondary text-xs flex items-center gap-1.5 shrink-0">
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
                          : 'bg-[var(--surface-2)] border-gray-700/40 hover:border-gray-600/60'
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
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    country === 'All'
                      ? 'bg-[var(--surface-2)] border-[var(--text-muted)] text-[var(--text-primary)]'
                      : 'bg-gray-800/40 border-gray-700/40 text-[var(--text-secondary)] hover:border-gray-600/60'
                  }`}
                >
                  All
                </button>
                {countryOptions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCountry(c)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${
                      country === c
                        ? 'bg-[var(--surface-2)] border-[var(--text-muted)] text-[var(--text-primary)]'
                        : 'bg-gray-800/40 border-gray-700/40 text-[var(--text-secondary)] hover:border-gray-600/60'
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
                  className="w-full bg-[var(--surface-2)] border border-gray-700/40 rounded-lg pl-9 pr-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)]"
                />
              </div>
            </div>

            {/* Table / empty state */}
            {filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-10 h-10 rounded-xl bg-gray-800/60 border border-gray-700/40 flex items-center justify-center mb-3">
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--card-border)]">
                      <th className="px-3 py-3 font-medium">Serial</th>
                      <th className="px-3 py-3 font-medium">Asset</th>
                      <th className="px-3 py-3 font-medium">Fitment date</th>
                      <th className="px-3 py-3 font-medium">Country</th>
                      <th className="px-3 py-3 font-medium text-right">Copies</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r, i) => (
                      <tr
                        key={`${r.serial_no || 'x'}|${r.asset_no || 'x'}|${r.issue_date || 'x'}|${r.country || 'x'}|${i}`}
                        className="border-b border-[var(--card-border)]/60 hover:bg-white/[0.02]"
                      >
                        <td className="px-3 py-3 font-medium text-[var(--text-primary)]">{r.serial_no || 'N/A'}</td>
                        <td className="px-3 py-3 text-[var(--text-secondary)]">{r.asset_no || 'N/A'}</td>
                        <td className="px-3 py-3 text-[var(--text-muted)] tabular-nums">
                          {r.issue_date ? formatDate(r.issue_date, r.country || 'All') : 'N/A'}
                        </td>
                        <td className="px-3 py-3 text-[var(--text-secondary)]">{r.country || 'N/A'}</td>
                        <td className="px-3 py-3 text-right text-[var(--text-secondary)] tabular-nums">{(Number(r.copies) || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
