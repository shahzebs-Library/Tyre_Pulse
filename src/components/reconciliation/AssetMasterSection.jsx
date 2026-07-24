import { useState, useEffect, useMemo, useCallback } from 'react'
import { Boxes, RefreshCw, Search, Download, AlertTriangle } from 'lucide-react'
import { getAssetMaster, COUNTRY_CURRENCY } from '../../lib/api/assetMaster'
import { formatCurrencyCompact } from '../../lib/formatters'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

/**
 * Asset Master - one row per physical vehicle across all countries. The same
 * vehicle transfers between countries, so this is the single place to check an
 * asset: its identity, the countries it operated in, and its activity + expense
 * PER COUNTRY (each in its own currency). Cross-country expense is normal.
 */
export default function AssetMasterSection() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await getAssetMaster({ limit: 2000 }))
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the asset master.'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      String(r.asset_no || '').toLowerCase().includes(q) ||
      String(r.model || '').toLowerCase().includes(q) ||
      String(r.vehicle_type || '').toLowerCase().includes(q) ||
      String(r.countries || '').toLowerCase().includes(q))
  }, [rows, search])

  const multiCountry = useMemo(() => rows.filter((r) => (r.country_count || 0) > 1).length, [rows])

  const expenseText = (byCountry) => (Array.isArray(byCountry) ? byCountry : [])
    .filter((c) => Number(c.tyre_expense) > 0)
    .map((c) => `${formatCurrencyCompact(Number(c.tyre_expense), COUNTRY_CURRENCY[c.country] || 'SAR')} ${c.country}`)
    .join('  |  ') || 'N/A'

  function exportExcel() {
    try {
      const flat = filtered.map((r) => ({
        asset_no: r.asset_no,
        countries: r.countries,
        vehicle_type: r.vehicle_type || 'N/A',
        model: r.model || 'N/A',
        tyres: r.tyres,
        work_orders: r.work_orders,
        expense_by_country: expenseText(r.by_country),
      }))
      exportToExcel(
        flat,
        ['asset_no', 'countries', 'vehicle_type', 'model', 'tyres', 'work_orders', 'expense_by_country'],
        ['Asset No', 'Countries', 'Type', 'Model', 'Tyres', 'Work Orders', 'Tyre Expense (per country)'],
        reportFileName('TyrePulse Asset Master'),
      )
    } catch (e) {
      setError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--card-border)]">
        <div className="w-9 h-9 rounded-lg bg-gray-800/60 border border-gray-700/40 flex items-center justify-center shrink-0">
          <Boxes className="w-4.5 h-4.5 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">Asset master (one row per vehicle)</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800/70 border border-gray-700/50 text-[var(--text-secondary)]">{rows.length}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Each vehicle once, across all countries. {multiCountry} operated in more than one country (transferred); their expenses show per country in each currency, which is normal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              className="input text-sm pl-7 pr-3 py-1.5 w-48"
              placeholder="Search asset / type / country..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button onClick={exportExcel} disabled={loading || filtered.length === 0}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50">
            <Download size={14} /> Export
          </button>
          <button onClick={load} disabled={loading}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="mx-5 my-5 rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200 flex-1">{error}</p>
          <button onClick={load} className="btn-secondary text-xs px-3 py-1.5">Retry</button>
        </div>
      ) : loading ? (
        <div className="px-5 py-10 text-center text-sm text-[var(--text-muted)]">Loading asset master...</div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-[var(--text-muted)]">
          {rows.length === 0 ? 'No assets found.' : `No asset matches "${search}".`}
        </div>
      ) : (
        <div className="px-5 py-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-secondary)] border-b border-[var(--border-dim)]">
                <th className="pb-2 pr-4">Asset No</th>
                <th className="pb-2 pr-4">Countries</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4 text-right">Tyres</th>
                <th className="pb-2 pr-4 text-right">Work Orders</th>
                <th className="pb-2">Tyre Expense (per country)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((r) => (
                <tr key={r.asset_no} className="border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)]">
                  <td className="py-2 pr-4 font-mono text-[var(--text-primary)]">{r.asset_no}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${
                      (r.country_count || 0) > 1
                        ? 'bg-blue-900/30 text-blue-300 border-blue-700/50'
                        : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
                    }`}>{r.countries}</span>
                  </td>
                  <td className="py-2 pr-4 text-[var(--text-secondary)] text-xs">{r.vehicle_type || 'N/A'}</td>
                  <td className="py-2 pr-4 text-[var(--text-secondary)] text-right">{Number(r.tyres).toLocaleString()}</td>
                  <td className="py-2 pr-4 text-[var(--text-secondary)] text-right">{Number(r.work_orders).toLocaleString()}</td>
                  <td className="py-2 text-[var(--text-secondary)] text-xs">{expenseText(r.by_country)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 500 && (
            <p className="text-xs text-[var(--text-muted)] mt-3">Showing first 500 of {filtered.length}. Use search or Export for the full list.</p>
          )}
        </div>
      )}
    </section>
  )
}
