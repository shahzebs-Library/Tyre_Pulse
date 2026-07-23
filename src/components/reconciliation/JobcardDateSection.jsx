import { useEffect, useState, useCallback, useMemo } from 'react'
import { CalendarClock, AlertTriangle, RefreshCw, Search, Download, CheckCircle2 } from 'lucide-react'
import { listJobcardMismatches, getJobcardMismatchSummary } from '../../lib/api/reconJobcard'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { formatDate } from '../../lib/formatters'

// Read-only review section for job card date mismatches. The Ramco work order
// number encodes a month/year; when that disagrees with the actual opened_at,
// the row is flagged here for MANUAL correction. Nothing is ever changed
// automatically. Mounted on the Data Reconciliation page by the parent.
const ROW_LIMIT = 1000

// Robust accessors: the RPC returns snake_case, but stay tolerant.
const pick = (obj, keys, fallback = 'N/A') => {
  for (const k of keys) {
    if (obj != null && obj[k] != null && obj[k] !== '') return obj[k]
  }
  return fallback
}
const numOr = (obj, keys, fallback = null) => {
  for (const k of keys) {
    if (obj != null && obj[k] != null && obj[k] !== '') {
      const n = Number(obj[k])
      if (Number.isFinite(n)) return n
    }
  }
  return fallback
}

// Format a month/year pair as MM/YYYY. Returns "N/A" when either is missing.
function monthYear(month, year) {
  if (month == null || year == null) return 'N/A'
  return `${String(month).padStart(2, '0')}/${year}`
}

export default function JobcardDateSection({ activeCountry }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState([])

  const [country, setCountry] = useState('All')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, sum] = await Promise.all([
        listJobcardMismatches({ limit: ROW_LIMIT }),
        getJobcardMismatchSummary(),
      ])
      setRows(Array.isArray(list) ? list : [])
      setSummary(Array.isArray(sum) ? sum : [])
    } catch (e) {
      setError(toUserMessage(e, 'Could not load job card date mismatches.'))
      setRows([])
      setSummary([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // When the page's active country changes, preselect it as the local filter.
  useEffect(() => {
    if (activeCountry && activeCountry !== 'All') setCountry(activeCountry)
  }, [activeCountry])

  const total = rows.length
  const summaryTotal = useMemo(
    () => summary.reduce((s, r) => s + (numOr(r, ['mismatches', 'count'], 0) || 0), 0),
    [summary],
  )
  const hitLimit = total >= ROW_LIMIT && summaryTotal > total

  // Countries offered by the filter: the summary is authoritative; fall back to
  // the countries present in the loaded rows.
  const countries = useMemo(() => {
    const set = new Set()
    summary.forEach((r) => { const c = pick(r, ['country'], ''); if (c && c !== 'N/A') set.add(c) })
    rows.forEach((r) => { const c = pick(r, ['country'], ''); if (c && c !== 'N/A') set.add(c) })
    return [...set].sort()
  }, [summary, rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (country !== 'All' && pick(r, ['country'], '') !== country) return false
      if (q && !String(pick(r, ['work_order_no'], '')).toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, country, query])

  function exportRows() {
    const out = filtered.map((r) => ({
      work_order_no: pick(r, ['work_order_no']),
      country: pick(r, ['country']),
      site: pick(r, ['site']),
      encoded: monthYear(numOr(r, ['jobcard_month']), numOr(r, ['jobcard_year'])),
      opened_at: formatDate(pick(r, ['opened_at'], null), activeCountry || 'All'),
      opened: monthYear(numOr(r, ['opened_month']), numOr(r, ['opened_year'])),
    }))
    exportToExcel(
      out,
      ['work_order_no', 'country', 'site', 'encoded', 'opened_at', 'opened'],
      ['Work Order', 'Country', 'Site', 'Encoded (MM/YYYY)', 'Actual Opened', 'Opened (MM/YYYY)'],
      reportFileName('TyrePulse Job Card Date Mismatches'),
    )
  }

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--card-border)]">
        <div className="w-9 h-9 rounded-lg bg-gray-800/60 border border-gray-700/40 flex items-center justify-center shrink-0">
          <CalendarClock className="w-4.5 h-4.5 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">Job card date mismatches</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800/70 border border-gray-700/50 text-[var(--text-secondary)]">
              {loading ? '...' : total}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            The month and year encoded in the job card number disagree with the actual opened date. These are likely data-entry typos to review; nothing is changed automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {!loading && !error && filtered.length > 0 && (
            <button
              onClick={exportRows}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <Download size={13} /> Export
            </button>
          )}
        </div>
      </div>

      <div className="px-5 py-4">
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
          <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
            <RefreshCw size={18} className="animate-spin mr-2" />
            <span className="text-sm">Loading job card date mismatches...</span>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-11 h-11 rounded-xl bg-green-900/30 border border-green-700/40 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
            </div>
            <p className="text-sm font-medium text-[var(--text-primary)]">No job card date mismatches</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Every job card number agrees with its opened date.</p>
          </div>
        ) : (
          <>
            {/* Per-country summary tiles (click to filter) */}
            {summary.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => setCountry('All')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    country === 'All'
                      ? 'bg-[var(--surface-3)] text-[var(--text-primary)] border-gray-500'
                      : 'bg-gray-800/50 text-[var(--text-secondary)] border-gray-700/50 hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span className="text-base font-bold text-[var(--text-primary)]">{summaryTotal.toLocaleString()}</span>
                  <span>All</span>
                </button>
                {summary.map((r) => {
                  const c = pick(r, ['country'], 'N/A')
                  const n = numOr(r, ['mismatches', 'count'], 0) || 0
                  const active = country === c
                  return (
                    <button
                      key={c}
                      onClick={() => setCountry(active ? 'All' : c)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                        active
                          ? 'bg-[var(--surface-3)] text-[var(--text-primary)] border-gray-500'
                          : 'bg-gray-800/50 text-[var(--text-secondary)] border-gray-700/50 hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="text-base font-bold text-amber-400">{n.toLocaleString()}</span>
                      <span>{c}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  className="input text-sm pl-7 pr-3 py-1.5 w-56"
                  placeholder="Filter by work order..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {countries.length > 1 && (
                <select
                  className="input text-sm py-1.5"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  <option value="All">All countries</option>
                  {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              <span className="text-xs text-[var(--text-muted)]">
                Showing {filtered.length.toLocaleString()} of {total.toLocaleString()}
              </span>
            </div>

            {hitLimit && (
              <p className="text-[11px] text-amber-400/90 mb-3 flex items-center gap-1.5">
                <AlertTriangle size={12} /> Showing the first {ROW_LIMIT.toLocaleString()} of {summaryTotal.toLocaleString()} mismatches. Filter by country to narrow the list.
              </p>
            )}

            {filtered.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-sm text-[var(--text-secondary)]">No mismatches match the current filter.</p>
                <button
                  onClick={() => { setCountry('All'); setQuery('') }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline mt-1"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[var(--card-border)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--card-border)] bg-white/[0.02]">
                      <th className="px-4 py-3 font-medium">Work Order</th>
                      <th className="px-4 py-3 font-medium">Country</th>
                      <th className="px-4 py-3 font-medium">Site</th>
                      <th className="px-4 py-3 font-medium">Encoded</th>
                      <th className="px-4 py-3 font-medium">Actual opened</th>
                      <th className="px-4 py-3 font-medium text-right">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => {
                      const wo = pick(r, ['work_order_no'])
                      const c = pick(r, ['country'])
                      const site = pick(r, ['site'])
                      const jm = numOr(r, ['jobcard_month'])
                      const jy = numOr(r, ['jobcard_year'])
                      const om = numOr(r, ['opened_month'])
                      const oy = numOr(r, ['opened_year'])
                      const encoded = monthYear(jm, jy)
                      const opened = pick(r, ['opened_at'], null)
                      const openedLabel = opened && opened !== 'N/A'
                        ? formatDate(opened, activeCountry || 'All')
                        : 'N/A'
                      // Delta hint: months between the encoded and actual period.
                      let delta = 'N/A'
                      if (jm != null && jy != null && om != null && oy != null) {
                        const d = (jy * 12 + jm) - (oy * 12 + om)
                        delta = d === 0 ? '0' : `${d > 0 ? '+' : ''}${d} mo`
                      }
                      return (
                        <tr
                          key={pick(r, ['id'], `r${i}`)}
                          className="border-b border-[var(--card-border)]/60 hover:bg-white/[0.02]"
                        >
                          <td className="px-4 py-3 font-medium text-[var(--text-primary)] font-mono">{wo}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">{c}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">{site}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums">{encoded}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums">{openedLabel}</td>
                          <td className="px-4 py-3 text-right text-amber-400 tabular-nums">{delta}</td>
                        </tr>
                      )
                    })}
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
