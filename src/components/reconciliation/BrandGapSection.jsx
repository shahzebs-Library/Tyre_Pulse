import { useCallback, useEffect, useMemo, useState } from 'react'
import { Tag, Save, AlertTriangle, RefreshCw, Search, Download } from 'lucide-react'
import {
  listBrandGapSummary,
  listBrandGapTyres,
  listBrandGapTyresAll,
  setTyreBrand,
} from '../../lib/api/reconBrand'
import { toUserMessage } from '../../lib/safeError'
import { formatDate } from '../../lib/formatters'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import EnterpriseTable from '../ui/EnterpriseTable'
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

  // Download fill list state.
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(null)

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

  async function downloadFillList() {
    setDownloadError(null)
    setDownloading(true)
    try {
      const all = await listBrandGapTyresAll({
        country: country === 'All' ? undefined : country,
      })
      const exportRows = all.map((r) => ({
        country: r.country || '',
        serial: r.serial_no || '',
        asset_no: r.asset_no || '',
        size: r.size || '',
        site: r.site || '',
        issue_date: r.issue_date || '',
        brand: '',
      }))
      const colKeys = ['country', 'serial', 'asset_no', 'size', 'site', 'issue_date', 'brand']
      const headers = ['Country', 'Serial', 'Asset No', 'Size', 'Site', 'Issue Date', 'Brand']
      const filename = reportFileName(
        'TyrePulse Brand Fill List',
        country === 'All' ? '' : country,
      )
      await exportToExcel(exportRows, colKeys, headers, filename, 'Brand Fill List')
    } catch (e) {
      setDownloadError(toUserMessage(e))
    } finally {
      setDownloading(false)
    }
  }

  const columns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial_no || 'N/A', size: 150,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.serial_no || 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 120 },
    { id: 'size', header: 'Size', accessorFn: (r) => r.size || 'N/A', size: 130, meta: { filterVariant: 'select' } },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 130, meta: { filterVariant: 'select' } },
    { id: 'date', header: 'Date', accessorFn: (r) => r.issue_date || '', size: 120,
      meta: { exportValue: (r) => r.issue_date || 'N/A' },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-muted)]">{row.original.issue_date ? formatDate(row.original.issue_date, row.original.country || 'All') : 'N/A'}</span> },
    {
      id: 'brand', header: 'Brand', size: 280, enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const busy = !!rowBusy[r.id]
        const rErr = rowError[r.id]
        return (
          <div>
            <div className="flex items-center gap-2">
              <input
                list="brand-gap-suggestions"
                value={drafts[r.id] || ''}
                onChange={(e) => updateDraft(r.id, e.target.value)}
                disabled={busy}
                placeholder="Brand"
                aria-label={`Brand for tyre ${r.serial_no || r.id}`}
                aria-invalid={rErr ? true : undefined}
                className="w-36 min-h-[44px] bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg px-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40"
              />
              <button
                type="button"
                onClick={() => saveBrand(r)}
                disabled={busy}
                className="btn-secondary min-h-[44px] text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
              >
                {busy ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                {busy ? 'Saving...' : 'Save'}
              </button>
            </div>
            {rErr && (
              <p role="alert" className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle size={11} /> {rErr}
              </p>
            )}
          </div>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [drafts, rowBusy, rowError])

  const truncated = rows.length >= TABLE_CAP

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border-dim)]">
        <div className="w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center justify-center shrink-0">
          <Tag className="w-4 h-4 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">Tyres missing a brand</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border-dim)] text-[var(--text-secondary)]">{totalMissing}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Brand drives CPK, warranty and vendor analysis. Fill it in below, or bulk-load via the stg_tyre_brand staging import for UAE and Egypt.</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Download the fill list, add each brand, then import country + serial + brand into the stg_tyre_brand table to backfill automatically.</p>
        </div>
        <button
          onClick={downloadFillList}
          disabled={loading || downloading}
          className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          {downloading ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
          {downloading ? 'Preparing...' : 'Download fill list'}
        </button>
        <button
          onClick={load}
          disabled={loading}
          className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Download error */}
        {downloadError && (
          <div role="alert" className="rounded-lg border border-red-800/50 bg-red-950/20 px-4 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-[var(--text-secondary)] break-words flex-1">Could not build the fill list: {downloadError}</p>
          </div>
        )}

        {/* Error + Retry */}
        {error ? (
          <div role="alert" className="rounded-lg border border-red-800/50 bg-red-950/20 px-4 py-3 flex flex-wrap items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">Could not load this section</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 break-words">{error}</p>
            </div>
            <button onClick={load} className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5 shrink-0">
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
                      aria-pressed={isActive}
                      className={`text-left rounded-xl border px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        isActive
                          ? 'bg-[var(--surface-2)] border-[var(--text-muted)]'
                          : 'bg-[var(--surface-2)] border-[var(--border-dim)] hover:border-[var(--text-muted)]'
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
                  aria-label="Search tyres missing a brand by serial or asset"
                  className="w-full bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg pl-9 pr-3 min-h-[44px] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)]"
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
                <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center justify-center mb-3">
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
                <EnterpriseTable
                  columns={columns}
                  data={filteredRows}
                  getRowId={(r) => r.id}
                  enableKeyboard={false}
                  enableGlobalFilter={false}
                  emptyMessage="No matching tyres"
                  exportFileName={reportFileName('Tyres missing a brand', country === 'All' ? '' : country)}
                  reportMeta={{ title: 'Tyres missing a brand' }}
                />
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}
