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
  muted: 'bg-gray-600',
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
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--card-border)]">
        <div className="w-9 h-9 rounded-lg bg-gray-800/60 border border-gray-700/40 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4.5 h-4.5 text-[var(--text-muted)]" />
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
          <button onClick={exportExcel} className="btn-secondary text-xs flex items-center gap-1.5 shrink-0">
            <Download size={13} /> Export
          </button>
        )}
        <button
          onClick={load}
          disabled={loading}
          className="btn-secondary text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mx-5 my-5 rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-200">Could not measure data confidence</p>
            <p className="text-xs text-red-300/80 mt-0.5 break-words">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary text-xs flex items-center gap-1.5 shrink-0">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {!error && loading && (
        <div className="px-5 py-8 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 rounded bg-gray-800/50 animate-pulse" />
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--card-border)]">
                  <th className="px-5 py-3 font-medium">KPI</th>
                  {report.countries.map((c) => (
                    <th key={c.country} className="px-5 py-3 font-medium">
                      {c.country}
                      <span className="ml-1.5 normal-case text-[10px] text-[var(--text-muted)]">
                        {c.currency || 'N/A'}
                      </span>
                    </th>
                  ))}
                  <th className="px-5 py-3 font-medium">All countries</th>
                </tr>
              </thead>
              <tbody>
                {DOMAIN_KEYS.map((k) => (
                  <tr key={k} className="border-b border-[var(--card-border)] last:border-0 align-top">
                    <td className="px-5 py-3">
                      <p className="font-medium text-[var(--text-primary)]">{DOMAINS[k].label}</p>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{DOMAINS[k].question}</p>
                    </td>
                    {report.countries.map((c) => {
                      const d = c.domains[k]
                      const id = `${c.country}:${k}`
                      return (
                        <td key={id} className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <ScoreCell domain={d} />
                            {d && d.score != null && (
                              <TrustBadge
                                domain={{ ...d, label: `${DOMAINS[k].label} (${c.country})` }}
                                size="xs"
                              />
                            )}
                          </div>
                          {d && d.score != null && (
                            <>
                              <div className="mt-1.5 h-1 w-24 rounded-full bg-gray-800 overflow-hidden">
                                <div
                                  className={`h-full ${TONE_BAR[d.band.tone] || TONE_BAR.muted}`}
                                  style={{ width: `${d.score}%` }}
                                />
                              </div>
                              <button
                                onClick={() => toggle(id)}
                                aria-expanded={!!open[id]}
                                className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                              >
                                {open[id] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                {d.reasons.length === 0
                                  ? 'All checks passed'
                                  : `${d.reasons.length} reason${d.reasons.length === 1 ? '' : 's'}`}
                              </button>
                              {open[id] && (
                                <ul className="mt-2 space-y-2 max-w-xs">
                                  {d.reasons.length === 0 && (
                                    <li className="text-[11px] text-[var(--text-secondary)]">
                                      Nothing is holding this figure's confidence down.
                                    </li>
                                  )}
                                  {d.reasons.map((r) => (
                                    <li key={r.key} className="text-[11px] leading-relaxed">
                                      <span className="font-semibold text-[var(--text-primary)]">
                                        {r.label}
                                      </span>
                                      <span className="text-[var(--text-muted)]"> ({DIMENSIONS[r.dimension]}, costs {r.impact} pts)</span>
                                      <p className="text-[var(--text-secondary)] mt-0.5">{r.detail}</p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </>
                          )}
                          {d && d.score == null && (
                            <p className="text-[11px] text-[var(--text-muted)] mt-1 max-w-xs">{d.note}</p>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-5 py-3">
                      <ScoreCell domain={report.overall[k]} />
                      <p className="text-[10px] text-[var(--text-muted)] mt-1 max-w-[10rem]">
                        Average of the country scores. Currencies are never added.
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ranked work list: what actually buys back the most confidence. */}
          <div className="border-t border-[var(--card-border)] px-5 py-4">
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
                    className="flex items-start gap-3 rounded-lg border border-[var(--card-border)] bg-[var(--surface-2)] px-3 py-2.5"
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
            <div className="border-t border-[var(--card-border)] px-5 py-3">
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
