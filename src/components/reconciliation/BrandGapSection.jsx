import { useCallback, useEffect, useMemo, useState } from 'react'
import { Tag, Save, AlertTriangle, RefreshCw, Search } from 'lucide-react'
import {
  listBrandGapSummary,
  listBrandGapTyres,
  setTyreBrand,
} from '../../lib/api/reconBrand'
import { toUserMessage } from '../../lib/safeError'
import { formatDate } from '../../lib/formatters'
import { APPROVED_BRANDS, CHINESE_BRANDS } from '../../lib/tyreSpecCatalog'

// Maximum rows rendered in the table (the query already caps at this).
const TABLE_CAP = 500

// Deduplicated brand suggestions for the datalist (approved + Chinese, no parallel list).
const BRAND_SUGGESTIONS = Array.from(new Set([...APPROVED_BRANDS, ...CHINESE_BRANDS]))

// Percentage label with a divide-by-zero guard.
function pctMissing(missing, total) {
  if (!total || total <= 0) return 'N/A'
  return `${Math.round((missing / total) * 100)}%`
}

/**
 * Tyres missing a brand - a self-contained data-quality section for the Data
 * Reconciliation page. Renders its own card (matching the page section shell),
 * a per-country summary, a country + search filter, and an editable table where
 * each affected tyre's brand can be saved inline via the existing elevated
 * tyre_records write policy.
 *
 * @param {object} [props]
 * @param {string} [props.activeCountry]  optional initial country filter
 */
export default function BrandGapSection({ activeCountry } = {}) {
  const [summary, setSummary] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const initialCountry =
    activeCountry && activeCountry !== 'All' ? activeCountry : 'All'
  const [country, setCountry] = useState(initialCountry)
  const [search, setSearch] = useState('')

  // Per-row brand draft + inline row state.
  const [drafts, setDrafts] = useState({}) // { id: brand }
  const [rowBusy, setRowBusy] = useState({}) // { id: true }
  const [rowError, setRowError] = useState({}) // { id: message }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sum, tyres] = await Promise.all([
        listBrandGapSummary(),
        listBrandGapTyres({
          country: country === 'All' ? undefined : country,
          limit: TABLE_CAP,
        }),
      ])
      setSummary(Array.isArray(sum) ? sum : [])
      setRows(Array.isArray(tyres) ? tyres : [])
    } catch (e) {
      setError(toUserMessage(e))
      setSummary([])
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [country])

  useEffect(() => {
    load()
  }, [load])

  // Total missing across countries (from the summary, independent of the filter).
  const totalMissing = useMemo(
    () => summary.reduce((acc, s) => acc + (Number(s.missing) || 0), 0),
    [summary],
  )

  // Countries offered in the filter: those with any tyres in the summary.
  const countryOptions = useMemo(
    () => summary.filter((s) => (Number(s.total) || 0) > 0).map((s) => s.country),
    [summary],
  )

  // Client-side search over serial + asset (the table is already country-scoped).
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const serial = String(r.serial_no || '').toLowerCase()
      const asset = String(r.asset_no || '').toLowerCase()
      return serial.includes(q) || asset.includes(q)
    })
  }, [rows, search])

  function updateDraft(id, value) {
    setDrafts((d) => ({ ...d, [id]: value }))
  }

  async function saveBrand(row) {
    const id = row.id
    const brand = (drafts[id] || '').trim()
    setRowError((e) => ({ ...e, [id]: null }))
    if (!brand) {
      setRowError((e) => ({ ...e, [id]: 'Brand is required.' }))
      return
    }
    setRowBusy((b) => ({ ...b, [id]: true }))
    try {
      await setTyreBrand(id, brand)
      // Remove the fixed row from local state and decrement the summary.
      setRows((rs) => rs.filter((r) => r.id !== id))
      setDrafts((d) => {
        const next = { ...d }
        delete next[id]
        return next
      })
      setSummary((sum) =>
        sum.map((s) =>
          s.country === row.country
            ? { ...s, missing: Math.max(0, (Number(s.missing) || 0) - 1) }
            : s,
        ),
      )
    } catch (e) {
      setRowError((err) => ({ ...err, [id]: toUserMessage(e) }))
    } finally {
      setRowBusy((b) => ({ ...b, [id]: false }))
    }
  }

  const truncated = rows.length >= TABLE_CAP

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--card-border)]">
        <div className="w-9 h-9 rounded-lg bg-gray-800/60 border border-gray-700/40 flex items-center justify-center shrink-0">
          <Tag className="w-4.5 h-4.5 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">Tyres missing a brand</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800/70 border border-gray-700/50 text-[var(--text-secondary)]">{totalMissing}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Brand drives CPK, warranty and vendor analysis. Fill it in below, or bulk-load via the stg_tyre_brand staging import for UAE and Egypt.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="btn-secondary text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
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
                <div className="col-span-full text-xs text-[var(--text-muted)]">No country data.</div>
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
                        {(Number(s.missing) || 0).toLocaleString()} <span className="text-sm font-normal text-[var(--text-muted)]">/ {(Number(s.total) || 0).toLocaleString()}</span>
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{pctMissing(Number(s.missing) || 0, Number(s.total) || 0)} missing</p>
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

            {/* Brand suggestions */}
            <datalist id="brand-gap-suggestions">
              {BRAND_SUGGESTIONS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>

            {/* Table / empty state */}
            {filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-10 h-10 rounded-xl bg-gray-800/60 border border-gray-700/40 flex items-center justify-center mb-3">
                  <Tag className="w-5 h-5 text-[var(--text-muted)]" />
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {search.trim() || country !== 'All' ? 'No matching tyres' : 'Every tyre has a brand'}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {search.trim() || country !== 'All'
                    ? 'No affected tyre matches the current filter.'
                    : 'No tyre record is missing a brand in the current scope.'}
                </p>
              </div>
            ) : (
              <>
                {truncated && (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Showing first {TABLE_CAP.toLocaleString()} of more than {TABLE_CAP.toLocaleString()} affected tyres. Narrow by country or use the staging import for a bulk fill.
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--card-border)]">
                        <th className="px-3 py-3 font-medium">Serial</th>
                        <th className="px-3 py-3 font-medium">Asset</th>
                        <th className="px-3 py-3 font-medium">Size</th>
                        <th className="px-3 py-3 font-medium">Site</th>
                        <th className="px-3 py-3 font-medium">Date</th>
                        <th className="px-3 py-3 font-medium">Brand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((r) => {
                        const busy = !!rowBusy[r.id]
                        const rErr = rowError[r.id]
                        return (
                          <tr key={r.id} className="border-b border-[var(--card-border)]/60 hover:bg-white/[0.02] align-top">
                            <td className="px-3 py-3 font-medium text-[var(--text-primary)]">{r.serial_no || 'N/A'}</td>
                            <td className="px-3 py-3 text-[var(--text-secondary)]">{r.asset_no || 'N/A'}</td>
                            <td className="px-3 py-3 text-[var(--text-secondary)]">{r.size || 'N/A'}</td>
                            <td className="px-3 py-3 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                            <td className="px-3 py-3 text-[var(--text-muted)] tabular-nums">
                              {r.issue_date ? formatDate(r.issue_date, r.country || 'All') : 'N/A'}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <input
                                  list="brand-gap-suggestions"
                                  value={drafts[r.id] || ''}
                                  onChange={(e) => updateDraft(r.id, e.target.value)}
                                  disabled={busy}
                                  placeholder="Brand"
                                  className="w-36 bg-[var(--surface-2)] border border-gray-700/40 rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] disabled:opacity-40"
                                />
                                <button
                                  type="button"
                                  onClick={() => saveBrand(r)}
                                  disabled={busy}
                                  className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
                                >
                                  {busy ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                                  {busy ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                              {rErr && (
                                <p className="text-[11px] text-red-300 mt-1 flex items-center gap-1">
                                  <AlertTriangle size={11} /> {rErr}
                                </p>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}
