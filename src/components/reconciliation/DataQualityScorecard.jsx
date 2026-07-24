import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react'
import { getDataQualitySummary, gradeFor } from '../../lib/api/dataQuality'
import { toUserMessage } from '../../lib/safeError'

// Percentage label with a divide-by-zero guard (empty bucket reads N/A).
function pct(num, den) {
  if (!den || den <= 0) return 'N/A'
  return `${Math.round((Number(num) / Number(den)) * 100)}%`
}

// Grade letter -> colour classes (higher grade = greener).
const GRADE_TONE = {
  A: 'text-green-400 border-green-700/50 bg-green-900/30',
  B: 'text-emerald-400 border-emerald-700/50 bg-emerald-900/30',
  C: 'text-amber-400 border-amber-700/50 bg-amber-900/30',
  D: 'text-orange-400 border-orange-700/50 bg-orange-900/30',
  F: 'text-red-400 border-red-700/50 bg-red-900/30',
}

/**
 * Data quality by country - a compact, read-only grade panel for the top of the
 * Data Reconciliation page. Renders its own card (matching the page section
 * shell) with one tile per country: tyres, brand-complete %, tyres-linked %,
 * WO-linked % and a letter grade. All numbers come from the V354
 * recon_data_quality_summary RPC (no client computation of counts).
 */
export default function DataQualityScorecard() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getDataQualitySummary()
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--card-border)]">
        <div className="w-9 h-9 rounded-lg bg-gray-800/60 border border-gray-700/40 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4.5 h-4.5 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">Data quality by country</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Completeness and linkage grade per country (read-only)
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="btn-secondary flex items-center gap-2 disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 rounded-xl bg-gray-800/50 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <p className="text-sm text-[var(--text-secondary)]">{error}</p>
            <button onClick={load} className="btn-secondary flex items-center gap-2">
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <ShieldCheck className="w-6 h-6 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-secondary)]">No country data available.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map((r) => {
              const { score, grade } = gradeFor(r)
              const tone = GRADE_TONE[grade] || GRADE_TONE.F
              return (
                <div
                  key={r.country || 'unknown'}
                  className="rounded-xl border border-[var(--card-border)] bg-gray-900/30 p-4"
                >
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {r.country || 'Unspecified'}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {Number(r.tyres || 0).toLocaleString()} tyres | {Number(r.fleet || 0).toLocaleString()} fleet
                      </p>
                    </div>
                    <div className={`shrink-0 w-12 h-12 rounded-lg border flex flex-col items-center justify-center ${tone}`}>
                      <span className="text-lg font-bold leading-none">{grade}</span>
                      <span className="text-[10px] leading-none mt-0.5">{score}</span>
                    </div>
                  </div>

                  <dl className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <dt className="text-[var(--text-muted)]">Brand complete</dt>
                      <dd className="font-medium text-[var(--text-primary)]">
                        {pct((r.tyres || 0) - (r.tyres_no_brand || 0), r.tyres)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-[var(--text-muted)]">Tyres linked</dt>
                      <dd className="font-medium text-[var(--text-primary)]">
                        {pct(r.tyres_linked, r.tyres)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-[var(--text-muted)]">WO linked</dt>
                      <dd className="font-medium text-[var(--text-primary)]">
                        {pct(r.wo_linked, r.wo_total)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
