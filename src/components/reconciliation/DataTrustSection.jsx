/**
 * Data Trust Centre - the "how much should I trust this number" panel for the
 * Data Reconciliation page.
 *
 * Everything a KPI surface needs is already computed here: a confidence per KPI
 * domain per country, the specific gaps behind each score, and a ranked work
 * list of what to fix first. The same `<TrustBadge>` used here can be dropped
 * beside any figure anywhere in the app.
 *
 * Money is shown per country and never summed: KSA reports in SAR, UAE in AED
 * and Egypt in EGP. The all-countries column averages the unitless SCORES,
 * which is legitimate where averaging their money would not be.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck, RefreshCw, AlertTriangle, Download, ChevronDown, ChevronRight, Info,
} from 'lucide-react'
import { getDataTrustOverview } from '../../lib/api/dataTrust'
import {
  buildTrustReport, topActions, trustExportRows, DOMAIN_KEYS, DOMAINS, DIMENSIONS,
} from '../../lib/dataTrust'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import TrustBadge from '../trust/TrustBadge'
import EmptyState from '../EmptyState'
import EnterpriseTable from '../ui/EnterpriseTable'

const TONE_TEXT = {
  good: 'text-green-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
  muted: 'text-[var(--text-muted)]',
}
const TONE_BAR = {
  good: 'bg-green-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  muted: 'bg-[var(--text-muted)]',
}

/** A confidence number with its band, or an honest N/A. */
function ScoreCell({ domain }) {
  if (!domain || domain.score == null) {
    return <span className="text-sm text-[var(--text-muted)]">N/A</span>
  }
  const tone = TONE_TEXT[domain.band.tone] || TONE_TEXT.muted
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={`text-sm font-bold tabular-nums ${tone}`}>{domain.score}</span>
      <span className="text-[10px] text-[var(--text-muted)]">{domain.band.label}</span>
    </span>
  )
}

export default function DataTrustSection() {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState({}) // `${country}:${domain}` -> bool

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getDataTrustOverview()
      setPayload(data)
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const report = useMemo(() => buildTrustReport(payload), [payload])
  const actions = useMemo(() => topActions(report, 8), [report])

  const toggle = (k) => setOpen((m) => ({ ...m, [k]: !m[k] }))

  const matrixRows = useMemo(() => DOMAIN_KEYS.map((k) => ({ key: k, domain: DOMAINS[k] })), [])
  const matrixColumns = useMemo(() => {
    const countryCol = (c) => ({
      id: `c-${c.country}`,
      header: `${c.country} (${c.currency || 'N/A'})`,
      accessorFn: (r) => c.domains[r.key]?.score ?? null,
      size: 190,
      meta: { exportValue: (r) => c.domains[r.key]?.score ?? 'N/A' },
      cell: ({ row }) => {
        const k = row.original.key
        const d = c.domains[k]
        const id = `${c.country}:${k}`
        return (
          <div>
            <div className="flex items-center gap-2">
              <ScoreCell domain={d} />
              {d && d.score != null && (
                <TrustBadge domain={{ ...d, label: `${DOMAINS[k].label} (${c.country})` }} size="xs" />
              )}
            </div>
            {d && d.score != null && (
              <>
                <div className="mt-1.5 h-1 w-24 rounded-full bg-[var(--surface-3)] overflow-hidden" aria-hidden="true">
                  <div className={`h-full ${TONE_BAR[d.band.tone] || TONE_BAR.muted}`} style={{ width: `${d.score}%` }} />
                </div>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-expanded={!!open[id]}
                  aria-label={`${open[id] ? 'Hide' : 'Show'} reasons for ${DOMAINS[k].label} in ${c.country}`}
                  className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
                >
                  {open[id] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  {d.reasons.length === 0 ? 'All checks passed' : `${d.reasons.length} reason${d.reasons.length === 1 ? '' : 's'}`}
                </button>
                {open[id] && (
                  <ul className="mt-1 space-y-2 max-w-xs whitespace-normal">
                    {d.reasons.length === 0 && (
                      <li className="text-[11px] text-[var(--text-secondary)]">Nothing is holding this figure's confidence down.</li>
                    )}
                    {d.reasons.map((r) => (
                      <li key={r.key} className="text-[11px] leading-relaxed">
                        <span className="font-semibold text-[var(--text-primary)]">{r.label}</span>
                        <span className="text-[var(--text-muted)]"> ({DIMENSIONS[r.dimension]}, costs {r.impact} pts)</span>
                        <p className="text-[var(--text-secondary)] mt-0.5">{r.detail}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {d && d.score == null && (
              <p className="text-[11px] text-[var(--text-muted)] mt-1 max-w-xs whitespace-normal">{d.note}</p>
            )}
          </div>
        )
      },
    })
    return [
      { id: 'kpi', header: 'KPI', accessorFn: (r) => r.domain.label, size: 220,
        cell: ({ row }) => (
          <div className="whitespace-normal">
            <p className="font-medium text-[var(--text-primary)]">{row.original.domain.label}</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{row.original.domain.question}</p>
          </div>
        ) },
      ...report.countries.map(countryCol),
      { id: 'all', header: 'All countries', accessorFn: (r) => report.overall[r.key]?.score ?? null, size: 170,
        meta: { exportValue: (r) => report.overall[r.key]?.score ?? 'N/A' },
        cell: ({ row }) => (
          <div className="whitespace-normal">
            <ScoreCell domain={report.overall[row.original.key]} />
            <p className="text-[10px] text-[var(--text-muted)] mt-1 max-w-[10rem]">Average of the country scores. Currencies are never added.</p>
          </div>
        ) },
    ]
  }, [report, open])

  async function exportExcel() {
    const { rows, columns, headers } = trustExportRows(report)
    if (!rows.length) return
    try {
      await exportToExcel(rows, columns, headers, reportFileName('TyrePulse Data Trust'))
    } catch (e) {
      setError(toUserMessage(e))
    }
  }

  const hasData = report.ok && report.countries.length > 0

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border-dim)]">
        <div className="w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Data Trust Centre
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            How much of the data behind each KPI actually supports it. Confidence is 0 to 100 per country, with the reasons behind every score.
          </p>
        </div>
        {hasData && (
          <button type="button" onClick={exportExcel} className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5 shrink-0">
            <Download size={13} /> Export
          </button>
        )}
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="mx-5 my-5 rounded-lg border border-red-800/50 bg-red-950/20 px-4 py-3 flex flex-wrap items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">Could not measure data confidence</p>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5 break-words">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5 shrink-0">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {!error && loading && (
        <div className="px-5 py-8 space-y-3" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 rounded bg-[var(--surface-2)] animate-pulse" />
          ))}
        </div>
      )}

      {!error && !loading && !hasData && (
        <EmptyState
          icon={Info}
          title="Nothing to measure yet"
          description="No expense, tyre or fleet data has been loaded for this organisation, so KPI confidence cannot be judged."
          compact
        />
      )}

      {!error && !loading && hasData && (
        <>
          {/* Confidence matrix: one row per KPI, one column per country. */}
          <EnterpriseTable
            columns={matrixColumns}
            data={matrixRows}
            getRowId={(r) => r.key}
            enableKeyboard={false}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            initialPageSize={25}
            exportFileName={reportFileName('TyrePulse Data Trust matrix')}
            reportMeta={{ title: 'Data Trust confidence matrix' }}
          />

          {/* Ranked work list: what actually buys back the most confidence. */}
          <div className="border-t border-[var(--border-dim)] px-5 py-4">
            <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">
              Fix these first
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Ranked by how many confidence points each gap is costing across every KPI it touches.
            </p>
            {actions.length === 0 ? (
              <p className="text-[11px] text-[var(--text-secondary)] mt-3">
                No outstanding gaps. Every measurable check is passing.
              </p>
            ) : (
              <ol className="mt-3 space-y-2">
                {actions.map((a) => (
                  <li
                    key={`${a.country}:${a.key}`}
                    className="flex items-start gap-3 rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] px-3 py-2.5"
                  >
                    <span className="text-[11px] font-bold tabular-nums text-amber-400 shrink-0 w-12 text-right pt-0.5">
                      {a.impact}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-[var(--text-primary)]">
                        {a.label}
                        <span className="text-[var(--text-muted)] font-normal"> in {a.country}</span>
                      </p>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">{a.detail}</p>
                      <p className="text-[10px] text-[var(--text-muted)] mt-1">
                        Affects: {a.affects.join(', ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {report.window && (
            <div className="border-t border-[var(--border-dim)] px-5 py-3">
              <p className="text-[10px] text-[var(--text-muted)]">
                Expense measures cover {report.window.from} to {report.window.to}. Tyre and fleet
                register measures are all time, because the completeness of a register is not a
                property of a date range.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}
