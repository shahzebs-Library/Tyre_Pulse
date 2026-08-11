import { useCallback, useEffect, useMemo, useState } from 'react'
import { Gauge, RefreshCw, Download, Search, AlertTriangle } from 'lucide-react'
import { listLifeOverCap } from '../../lib/api/tyreFreetext'
import { toUserMessage } from '../../lib/safeError'
import { formatDate } from '../../lib/formatters'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'

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
          <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button onClick={download} disabled={!filtered.length}
                  className="btn-secondary text-sm inline-flex items-center gap-2">
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
                 placeholder="Asset or serial" className="input pl-8 text-sm" />
        </div>
        {truncated && (
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
            Showing the worst 1,000. Download the Excel for the rest.
          </span>
        )}
      </div>

      {error && (
        <div className="text-sm rounded-lg px-3 py-2 mb-3 flex items-center gap-2"
             style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          Checking tyre lives...
        </div>
      ) : !filtered.length ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          {rows.length
            ? 'No tyre matches that search.'
            : 'Every recorded tyre life is within the limit for its machine.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className="text-left py-2 pr-3">Asset</th>
                <th className="text-left py-2 pr-3">Type</th>
                <th className="text-left py-2 pr-3">Position</th>
                <th className="text-left py-2 pr-3">Serial</th>
                <th className="text-right py-2 pr-3">Recorded life</th>
                <th className="text-right py-2 pr-3">Limit</th>
                <th className="text-right py-2 pr-3">Over by</th>
                <th className="text-left py-2">Most likely cause</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className="py-2 pr-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {r.asset_no}
                  </td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>
                    {r.vehicle_type}
                  </td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>
                    {r.tyre_position || 'Not recorded'}
                  </td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>
                    {r.serial_no || 'Not recorded'}
                  </td>
                  <td className="py-2 pr-3 text-right" style={{ color: 'var(--text-primary)' }}>
                    {Number(r.total_km).toLocaleString()} km
                  </td>
                  <td className="py-2 pr-3 text-right" style={{ color: 'var(--text-dim)' }}>
                    {Number(r.life_cap_km).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium" style={{ color: '#f59e0b' }}>
                    +{Number(r.over_by_km).toLocaleString()}
                  </td>
                  <td className="py-2" style={{ color: 'var(--text-secondary)' }}>
                    {r.likely_cause}
                    {r.issue_date && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--text-dim)' }}>
                        fitted {formatDate(r.issue_date)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
