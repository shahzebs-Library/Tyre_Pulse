import { useCallback, useEffect, useMemo, useState } from 'react'
import { Gauge, RefreshCw, Download, Search, AlertTriangle } from 'lucide-react'
import { listLifeOverCap } from '../../lib/api/tyreFreetext'
import { toUserMessage } from '../../lib/safeError'
import { formatDate } from '../../lib/formatters'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import EnterpriseTable from '../ui/EnterpriseTable'

/**
 * Tyre lives above the ceiling the owner set for that class of machine:
 * transit mixer 80,000 km, pump 56,000, wheel loader 15,000, everything else
 * 100,000. Above those a life is not a measurement, it is a data error.
 *
 * READ-ONLY BY DESIGN. Nothing is corrected here, because the cause is almost
 * never a fake tyre - it is usually a placeholder fitment km (a tyre recorded as
 * fitted at 0 or 1 km takes the whole odometer as its life) or a meter that was
 * reset. Overwriting the number would hide that instead of fixing it, so each row
 * carries the most likely cause and goes to a person.
 */
export default function TyreLifeCapSection({ activeCountry } = {}) {
  const [rows, setRows] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  const country = activeCountry && activeCountry !== 'All' ? activeCountry : 'All'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listLifeOverCap({ country })
      setRows(res.rows)
      setTruncated(res.truncated)
    } catch (e) {
      setError(toUserMessage(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase()
    if (!q) return rows
    return rows.filter(
      (r) => (r.asset_no || '').includes(q) || (r.serial_no || '').toUpperCase().includes(q),
    )
  }, [rows, search])

  const byCause = useMemo(() => {
    const m = new Map()
    rows.forEach((r) => m.set(r.likely_cause, (m.get(r.likely_cause) || 0) + 1))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  const columns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 110,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'type', header: 'Type', accessorFn: (r) => r.vehicle_type || 'Not recorded', size: 130, meta: { filterVariant: 'select' } },
    { id: 'position', header: 'Position', accessorFn: (r) => r.tyre_position || 'Not recorded', size: 100 },
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial_no || 'Not recorded', size: 140 },
    { id: 'life', header: 'Recorded life', accessorFn: (r) => Number(r.total_km), size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-primary)]">{Number(row.original.total_km).toLocaleString()} km</span> },
    { id: 'cap', header: 'Limit', accessorFn: (r) => Number(r.life_cap_km), size: 100, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-muted)]">{Number(row.original.life_cap_km).toLocaleString()}</span> },
    { id: 'over', header: 'Over by', accessorFn: (r) => Number(r.over_by_km), size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums font-medium text-amber-500">+{Number(row.original.over_by_km).toLocaleString()}</span> },
    { id: 'cause', header: 'Most likely cause', accessorFn: (r) => r.likely_cause || 'N/A', size: 240, meta: { filterVariant: 'select' },
      cell: ({ row }) => (
        <span className="text-[var(--text-secondary)]">
          {row.original.likely_cause || 'N/A'}
          {row.original.issue_date && (
            <span className="ml-2 text-xs text-[var(--text-muted)]">fitted {formatDate(row.original.issue_date)}</span>
          )}
        </span>
      ) },
  ], [])

  const download = () =>
    exportToExcel(
      filtered,
      ['asset_no', 'vehicle_type', 'tyre_position', 'serial_no', 'brand',
       'issue_date', 'removal_date', 'km_at_fitment', 'km_at_removal',
       'total_km', 'life_cap_km', 'over_by_km', 'likely_cause'],
      ['Asset', 'Type', 'Position', 'Serial', 'Brand', 'Fitted', 'Removed',
       'Km at fitment', 'Km at removal', 'Recorded life (km)', 'Limit for this type',
       'Over by (km)', 'Most likely cause'],
      reportFileName('Tyre lives above the limit'),
    )

  return (
    <div className="card p-5 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div className="flex items-start gap-3">
          <Gauge className="w-5 h-5 mt-0.5" style={{ color: 'var(--accent)' }} />
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Tyre lives above the limit for their machine
            </h3>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Transit mixer over 80,000 km, pump over 56,000, wheel loader over 15,000,
              anything else over 100,000. Flagged for correction, never changed automatically.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button type="button" onClick={download} disabled={!filtered.length}
                  className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-2">
            <Download className="w-4 h-4" />
            Excel
          </button>
        </div>
      </div>

      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap gap-2 my-4">
          {byCause.map(([cause, n]) => (
            <span key={cause} className="text-xs rounded-full px-3 py-1"
                  style={{ background: 'var(--panel-2)', color: 'var(--text-secondary)' }}>
              {cause}: {n}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-dim)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
                 placeholder="Asset or serial" aria-label="Search tyre lives by asset or serial"
                 className="input pl-8 text-sm min-h-[44px]" />
        </div>
        {truncated && (
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
            Showing the worst 1,000. Download the Excel for the rest.
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="text-sm rounded-lg px-3 py-2 mb-3 flex flex-wrap items-center gap-2 border border-red-800/50 bg-red-950/20 text-red-400">
          <AlertTriangle className="w-4 h-4" />
          <span className="flex-1 min-w-0 text-[var(--text-primary)]">{error}</span>
          <button type="button" onClick={load} className="btn-secondary min-h-[44px] text-xs inline-flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          Checking tyre lives...
        </div>
      ) : error ? null : !rows.length ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          Every recorded tyre life is within the limit for its machine.
        </div>
      ) : (
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(r) => r.id}
          enableKeyboard={false}
          enableGlobalFilter={false}
          emptyMessage="No tyre matches that search."
          exportFileName={reportFileName('Tyre lives above the limit')}
          reportMeta={{ title: 'Tyre lives above the limit' }}
        />
      )}
    </div>
  )
}
