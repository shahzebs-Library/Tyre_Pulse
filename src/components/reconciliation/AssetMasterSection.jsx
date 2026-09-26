import { useState, useEffect, useMemo, useCallback } from 'react'
import { Boxes, RefreshCw, Search, Download, AlertTriangle } from 'lucide-react'
import { getAssetMaster, COUNTRY_CURRENCY } from '../../lib/api/assetMaster'
import { getAssetOwnership } from '../../lib/api/assetOwnership'
import { BASIS_KEYS, basisMeta, UNKNOWN_OWNER } from '../../lib/assetOwnership'
import { formatCurrencyCompact } from '../../lib/formatters'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import EnterpriseTable from '../ui/EnterpriseTable'

/**
 * Asset Master - one row per physical vehicle across all countries. This is the
 * single place to check an asset: its identity, the countries it operated in,
 * its activity + expense PER COUNTRY (each in its own currency), and WHICH
 * country owns it versus which merely bore the cost (V376).
 *
 * A shared asset number is NOT proof of a transfer. Measured on the live data,
 * 57 of the 221 cross-country codes bill in two countries in the same month, so
 * they are two different machines sharing a number. Those read "N/A" with a
 * Contested badge rather than being assigned to a country.
 */
export default function AssetMasterSection() {
  const [rows, setRows] = useState([])
  const [ownership, setOwnership] = useState({ byAsset: new Map(), summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [basisFilter, setBasisFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // ownership degrades to an empty payload on its own, so a missing V376 RPC
      // leaves the master table fully usable without an ownership column
      const [master, own] = await Promise.all([
        // No hand-picked limit: the service pages the set-returning RPC to its
        // own ceiling, so the count rendered beside the table is the real one.
        getAssetMaster(),
        getAssetOwnership({ limit: 5000 }),
      ])
      setRows(master)
      setOwnership({
        byAsset: new Map(own.assets.map((a) => [a.assetNo.toUpperCase(), a])),
        summary: own.ok ? own.summary : null,
      })
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the asset master.'))
      setRows([])
      setOwnership({ byAsset: new Map(), summary: null })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  /** Ownership row for a master row, or null when the asset has no expense history. */
  const ownFor = useCallback(
    (assetNo) => ownership.byAsset.get(String(assetNo || '').toUpperCase()) || null,
    [ownership],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (basisFilter !== 'all') {
        const o = ownFor(r.asset_no)
        if (basisFilter === 'cross') {
          if ((r.country_count || 0) <= 1 && !(o && o.isCrossCountry)) return false
        } else if (!o || o.basis !== basisFilter) return false
      }
      if (!q) return true
      const o = ownFor(r.asset_no)
      return (
        String(r.asset_no || '').toLowerCase().includes(q) ||
        String(r.model || '').toLowerCase().includes(q) ||
        String(r.vehicle_type || '').toLowerCase().includes(q) ||
        String(r.countries || '').toLowerCase().includes(q) ||
        String(o?.owningCountryLabel || '').toLowerCase().includes(q)
      )
    })
  }, [rows, search, basisFilter, ownFor])

  const multiCountry = useMemo(() => rows.filter((r) => (r.country_count || 0) > 1).length, [rows])

  const expenseText = (byCountry) => (Array.isArray(byCountry) ? byCountry : [])
    .filter((c) => Number(c.tyre_expense) > 0)
    .map((c) => `${formatCurrencyCompact(Number(c.tyre_expense), COUNTRY_CURRENCY[c.country] || 'SAR')} ${c.country}`)
    .join('  |  ') || 'N/A'

  const columns = useMemo(() => [
    { id: 'asset', header: 'Asset No', accessorFn: (r) => r.asset_no, size: 120,
      cell: ({ row }) => <span className="font-mono text-[var(--text-primary)]">{row.original.asset_no}</span> },
    { id: 'owner', header: 'Owned by', accessorFn: (r) => ownFor(r.asset_no)?.owningCountryLabel || 'N/A', size: 200,
      meta: { exportValue: (r) => { const o = ownFor(r.asset_no); return o ? `${o.owningCountryLabel || UNKNOWN_OWNER} (${o.basisLabel})` : 'N/A' } },
      cell: ({ row }) => {
        // an asset the evidence cannot assign reads N/A with the reason on its
        // badge, never a guessed country
        const o = ownFor(row.original.asset_no)
        if (!o) return <span className="text-xs text-[var(--text-muted)]">N/A</span>
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className={`text-xs ${o.owningCountry ? 'text-[var(--text-primary)]' : 'text-amber-500'}`}>
              {o.owningCountryLabel || UNKNOWN_OWNER}
            </span>
            {o.isCrossCountry && (
              <span
                title={basisMeta(o.basis).explain}
                className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                  basisMeta(o.basis).tone === 'warn'
                    ? 'bg-amber-900/20 text-amber-500 border-amber-700/50'
                    : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
                }`}
              >{o.basisLabel}</span>
            )}
          </span>
        )
      } },
    { id: 'countries', header: 'Countries', accessorFn: (r) => r.countries, size: 140,
      cell: ({ row }) => (
        <span className={`text-xs px-2 py-0.5 rounded-full border ${
          (row.original.country_count || 0) > 1
            ? 'bg-blue-900/20 text-blue-500 border-blue-700/50'
            : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
        }`}>{row.original.countries}{(row.original.country_count || 0) > 1 ? ' (multi)' : ''}</span>
      ) },
    { id: 'type', header: 'Type', accessorFn: (r) => r.vehicle_type || 'N/A', size: 140, meta: { filterVariant: 'select' } },
    { id: 'tyres', header: 'Tyres', accessorFn: (r) => Number(r.tyres) || 0, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{Number(row.original.tyres).toLocaleString()}</span> },
    { id: 'wo', header: 'Work Orders', accessorFn: (r) => Number(r.work_orders) || 0, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{Number(row.original.work_orders).toLocaleString()}</span> },
    { id: 'expense', header: 'Tyre Expense (per country)', accessorFn: (r) => expenseText(r.by_country), size: 260, enableSorting: false,
      cell: ({ row }) => <span className="text-xs text-[var(--text-secondary)]">{expenseText(row.original.by_country)}</span> },
  ], [ownFor])

  function exportExcel() {
    try {
      const flat = filtered.map((r) => {
        const o = ownFor(r.asset_no)
        return {
          asset_no: r.asset_no,
          owning_country: o ? o.owningCountryLabel : 'N/A',
          ownership_basis: o ? o.basisLabel : 'N/A',
          countries: r.countries,
          vehicle_type: r.vehicle_type || 'N/A',
          model: r.model || 'N/A',
          tyres: r.tyres,
          work_orders: r.work_orders,
          expense_by_country: expenseText(r.by_country),
        }
      })
      exportToExcel(
        flat,
        ['asset_no', 'owning_country', 'ownership_basis', 'countries', 'vehicle_type', 'model', 'tyres', 'work_orders', 'expense_by_country'],
        ['Asset No', 'Owning Country', 'Ownership Basis', 'Countries', 'Type', 'Model', 'Tyres', 'Work Orders', 'Tyre Expense (per country)'],
        reportFileName('TyrePulse Asset Master'),
      )
    } catch (e) {
      setError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border-dim)]">
        <div className="w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center justify-center shrink-0">
          <Boxes className="w-4 h-4 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">Asset master (one row per vehicle)</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border-dim)] text-[var(--text-secondary)]">{rows.length}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Each vehicle once, across all countries. {multiCountry} carry the same asset number in more than one
            country; expenses show per country in each currency and are never added together.
            {ownership.summary
              ? ` ${ownership.summary.contested} of them bill in two countries at the same time, so ownership is reported as unknown rather than guessed.`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input text-sm px-2 min-h-[44px]"
            value={basisFilter}
            onChange={(e) => setBasisFilter(e.target.value)}
            aria-label="Filter by ownership"
          >
            <option value="all">All ownership</option>
            <option value="cross">Cross-country only</option>
            {BASIS_KEYS.map((k) => (
              <option key={k} value={k}>{basisMeta(k).label}</option>
            ))}
          </select>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              className="input text-sm pl-7 pr-3 min-h-[44px] w-48 max-w-full"
              placeholder="Search asset / type / country..."
              aria-label="Search asset master by asset, type or country"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button type="button" onClick={exportExcel} disabled={loading || filtered.length === 0}
            className="btn-secondary min-h-[44px] flex items-center gap-1.5 text-sm px-3 disabled:opacity-50">
            <Download size={14} /> Export
          </button>
          <button type="button" onClick={load} disabled={loading}
            className="btn-secondary min-h-[44px] flex items-center gap-1.5 text-sm px-3 disabled:opacity-50">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mx-5 my-5 rounded-lg border border-red-800/50 bg-red-950/20 px-4 py-3 flex flex-wrap items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--text-primary)] flex-1">{error}</p>
          <button type="button" onClick={load} className="btn-secondary min-h-[44px] text-xs px-3 inline-flex items-center gap-1.5"><RefreshCw size={13} /> Retry</button>
        </div>
      ) : loading ? (
        <div className="px-5 py-10 text-center text-sm text-[var(--text-muted)]">Loading asset master...</div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-[var(--text-muted)]">
          {rows.length === 0 ? 'No assets found.' : 'No asset matches the current search and filter.'}
        </div>
      ) : (
        <div className="px-4 py-4">
          <EnterpriseTable
            columns={columns}
            data={filtered}
            getRowId={(r) => String(r.asset_no)}
            enableKeyboard={false}
            enableGlobalFilter={false}
            emptyMessage="No asset matches the current search and filter."
            exportFileName={reportFileName('TyrePulse Asset Master')}
            reportMeta={{ title: 'Asset master' }}
          />
        </div>
      )}
    </section>
  )
}
