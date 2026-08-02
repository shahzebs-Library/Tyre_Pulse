/**
 * ConsoleControlCenter - the Data Trust & Control Center (super-admin).
 *
 * ONE screen that unifies the three data-integrity surfaces that used to live
 * apart: the per-KPI confidence scores (Data Trust Centre), the live
 * data-quality diagnostics feed, and the figure-to-source lineage explorer.
 * It REUSES the existing engines verbatim and never re-derives any score:
 *   - trust:      getDataTrustOverview -> buildTrustReport / topActions (dataTrust)
 *   - diagnostics: getControlCenterSummary + rankIssues / openIssueCount
 *   - lineage:    getFigureLineage over LINEAGE_DOMAINS
 *
 * A country selector at the top (All / KSA / UAE / Egypt) drives every section.
 * Money never crosses currencies: each country's figures stay in its own
 * currency and the "All" trust view averages the unitless SCORES only. Every
 * section carries an honest loading / empty (with a reason) / error+Retry state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, RefreshCw, GitBranch, Activity, Database, FileClock,
  ArrowRight, ChevronRight,
} from 'lucide-react'
import {
  Panel, PanelHeader, StatTile, Badge, Note, Btn, Segmented, Select,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Code,
} from '../components/ui'
import TrustBadge from '../../components/trust/TrustBadge'
import { getDataTrustOverview } from '../../lib/api/dataTrust'
import { buildTrustReport, topActions, trustBand, DOMAIN_KEYS, DOMAINS } from '../../lib/dataTrust'
import {
  getFigureLineage, getControlCenterSummary,
  LINEAGE_DOMAINS, DOMAIN_LABELS, ISSUE_SEVERITY_TONE, ISSUE_ROUTE,
  rankIssues, openIssueCount,
} from '../../lib/api/controlCenter'
import { toUserMessage } from '../../lib/safeError'

const COUNTRIES = ['All', 'KSA', 'UAE', 'Egypt']

// dataTrust band tone (good|warn|bad|muted) -> console Badge tone.
const BAND_BADGE_TONE = { good: 'good', warn: 'warning', bad: 'danger', muted: 'quiet' }
// dataTrust band tone -> big score text colour (gray/orange families + status hues).
const BAND_TEXT = {
  good: 'text-emerald-300', warn: 'text-amber-300', bad: 'text-red-300', muted: 'text-gray-400',
}

/** Thousands-separated integer, or N/A. Never a dash. */
function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  return Math.round(Number(v)).toLocaleString('en-US')
}
/** Number rendered as a percent, or N/A. */
function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  const n = Number(v)
  return `${(Math.round(n * 10) / 10).toLocaleString('en-US')}%`
}
function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-US')
}

/** Turn a "%_pct" or "%_share" numeric key into human words, else the key. */
function labelizeKey(k) {
  return String(k).replace(/_/g, ' ')
}

export default function ConsoleControlCenter() {
  const navigate = useNavigate()
  const [country, setCountry] = useState('All')

  // ── Trust + diagnostics (driven by country) ──
  const [report, setReport] = useState(null)     // buildTrustReport output
  const [summary, setSummary] = useState(null)   // getControlCenterSummary output
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [trustError, setTrustError] = useState(null)
  const [diagError, setDiagError] = useState(null)

  // ── Lineage (driven by country + domain) ──
  const [domain, setDomain] = useState(LINEAGE_DOMAINS[0])
  const [lineage, setLineage] = useState(null)
  const [lineageLoading, setLineageLoading] = useState(true)
  const [lineageError, setLineageError] = useState(null)

  const loadTrustAndDiag = useCallback(async () => {
    setTrustError(null)
    setDiagError(null)
    const [trustRes, diagRes] = await Promise.allSettled([
      getDataTrustOverview({ country }),
      getControlCenterSummary({ country }),
    ])

    if (trustRes.status === 'fulfilled') {
      const rep = buildTrustReport(trustRes.value)
      setReport(rep)
      if (!rep.ok) setTrustError('Trust scores are not available for this selection yet.')
    } else {
      setReport(null)
      setTrustError(toUserMessage(trustRes.reason, 'Could not load trust scores'))
    }

    if (diagRes.status === 'fulfilled') {
      const s = diagRes.value
      setSummary(s && s.ok !== false ? s : null)
      if (!s || s.ok === false) setDiagError('Diagnostics are not available for this selection yet.')
    } else {
      setSummary(null)
      setDiagError(toUserMessage(diagRes.reason, 'Could not load diagnostics'))
    }
  }, [country])

  const loadLineage = useCallback(async () => {
    setLineageError(null)
    setLineageLoading(true)
    try {
      const data = await getFigureLineage({ domain, country })
      if (data && data.ok !== false) setLineage(data)
      else { setLineage(null); setLineageError('Lineage is not available for this figure yet.') }
    } catch (err) {
      setLineage(null)
      setLineageError(toUserMessage(err, 'Could not trace this figure'))
    } finally {
      setLineageLoading(false)
    }
  }, [domain, country])

  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([loadTrustAndDiag(), loadLineage()])
    setRefreshing(false)
    setLoading(false)
  }, [loadTrustAndDiag, loadLineage])

  // Country change reloads trust + diagnostics.
  useEffect(() => {
    setLoading(true)
    loadTrustAndDiag().finally(() => setLoading(false))
  }, [loadTrustAndDiag])

  // Country or domain change reloads lineage.
  useEffect(() => { loadLineage() }, [loadLineage])

  // ── Trust presentation ──
  // For one country use its full domain objects (score + band + reasons); for
  // "All" use the averaged overall scores (no per-reason drilldown at that
  // level, so the Top actions worklist below carries the reasons).
  const domainCards = useMemo(() => {
    if (!report?.ok) return []
    const single = country !== 'All'
      ? report.countries.find((c) => c.country === country) || report.countries[0]
      : null
    return DOMAIN_KEYS.map((k) => {
      const label = DOMAINS[k]?.label || k
      if (single) {
        const d = single.domains?.[k]
        if (d) return { key: k, label: d.label || label, score: d.score, band: d.band, reasons: d.reasons || [], note: d.note }
        return { key: k, label, score: null, band: trustBand(null), reasons: [], note: null }
      }
      const o = report.overall?.[k]
      const score = o?.score ?? null
      return {
        key: k, label, score, band: o?.band || trustBand(score), reasons: [],
        note: score == null
          ? 'No data behind this figure yet, so its confidence cannot be judged.'
          : 'Averaged across countries. Pick one country to see the specific gaps.',
      }
    })
  }, [report, country])

  const actions = useMemo(() => (report?.ok ? topActions(report, 8) : []), [report])
  const openIssues = summary ? openIssueCount(summary.issues) : 0
  const rankedIssues = useMemo(() => (summary ? rankIssues(summary.issues) : []), [summary])

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header + country selector */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck size={18} className="text-orange-400" /> Data Trust &amp; Control Center
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            How much to trust every KPI, what is wrong with the data, and where each figure comes from | one place
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            options={COUNTRIES.map((c) => ({ key: c, label: c }))}
            value={country}
            onChange={setCountry}
          />
          <button onClick={refreshAll} disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* ── 1. Trust scores ── */}
      <Panel>
        <PanelHeader icon={ShieldCheck} title="KPI confidence"
          subtitle="A 0 to 100 grade for each headline figure, with the specific gaps behind it" />
        {loading ? (
          <LoadingState label="Scoring the data" rows={3} />
        ) : trustError ? (
          <ErrorState message={trustError} onRetry={loadTrustAndDiag} />
        ) : domainCards.length === 0 ? (
          <EmptyState title="No trust scores" reason="There is no data behind these figures yet, so their confidence cannot be judged." />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {domainCards.map((card) => {
                const tone = card.band?.tone || 'muted'
                return (
                  <div key={card.key} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-gray-300 leading-snug">{card.label}</p>
                      <TrustBadge
                        score={card.score}
                        label={card.label}
                        reasons={card.reasons}
                        note={card.note}
                        align="right"
                      />
                    </div>
                    <div className="flex items-baseline gap-2 mt-2">
                      <span className={`text-3xl font-black tabular-nums ${BAND_TEXT[tone]}`}>
                        {card.score == null ? 'N/A' : card.score}
                      </span>
                      {card.score != null && <span className="text-[11px] text-gray-600">out of 100</span>}
                      <Badge tone={BAND_BADGE_TONE[tone] || 'quiet'}>{card.band?.label || 'Not measurable'}</Badge>
                    </div>
                    {card.reasons.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {card.reasons.slice(0, 2).map((r) => (
                          <li key={r.key} className="text-[11px] text-gray-500 flex items-start gap-1">
                            <ChevronRight size={11} className="text-gray-700 mt-0.5 shrink-0" />
                            <span className="min-w-0"><span className="text-gray-400">{r.label}</span> | costs {r.impact} pts</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      card.note && <p className="text-[11px] text-gray-600 mt-2">{card.note}</p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Top actions worklist */}
            <div className="mt-4">
              <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
                Top actions | fix these to raise confidence fastest
              </p>
              {actions.length === 0 ? (
                <Note>Nothing is holding these figures down that can be actioned right now.</Note>
              ) : (
                <div className="space-y-1.5">
                  {actions.map((a) => (
                    <div key={`${a.country}:${a.key}`}
                      className="flex items-start gap-3 bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-2">
                      <Badge tone="accent" title="Confidence points this gap costs">+{a.impact}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-300">
                          <span className="font-semibold">{a.label}</span>
                          <span className="text-gray-600"> | {a.country}</span>
                          <span className="text-gray-600"> | affects {a.affects.join(', ')}</span>
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{a.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Panel>

      {/* ── 2. Diagnostics feed ── */}
      <Panel>
        <PanelHeader icon={Activity} title="Data-quality diagnostics"
          subtitle={`${openIssues} open ${openIssues === 1 ? 'issue' : 'issues'} across the current selection`} />
        {loading ? (
          <LoadingState label="Scanning for issues" rows={3} />
        ) : diagError ? (
          <ErrorState message={diagError} onRetry={loadTrustAndDiag} />
        ) : !summary ? (
          <EmptyState title="No diagnostics" reason="The diagnostics scan returned nothing for this selection." />
        ) : (
          <>
            {/* Volumes */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile label="Expense rows" value={fmtInt(summary.volumes?.expense_rows)} icon={Database} />
              <StatTile label="Tyre rows" value={fmtInt(summary.volumes?.tyre_rows)} icon={Database} />
              <StatTile label="Fleet rows" value={fmtInt(summary.volumes?.fleet_rows)} icon={Database} />
              <StatTile label="Work orders" value={fmtInt(summary.volumes?.work_orders)} icon={Database} />
            </div>

            {/* Ranked issues */}
            <div className="mt-4">
              {rankedIssues.length === 0 ? (
                <EmptyState title="No issues detected" reason="Every diagnostic returned a clean result for this selection." />
              ) : (
                <div className="space-y-1.5">
                  {rankedIssues.map((issue) => {
                    const route = ISSUE_ROUTE[issue.action]
                    return (
                      <div key={issue.key}
                        className="flex items-center gap-3 bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          issue.severity === 'critical' ? 'bg-red-500'
                            : issue.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-300 font-medium truncate">{issue.label}</p>
                        </div>
                        <Badge tone={ISSUE_SEVERITY_TONE[issue.severity] || 'info'}>{issue.severity}</Badge>
                        <span className="text-sm font-semibold tabular-nums text-gray-200 min-w-[3rem] text-right">
                          {fmtInt(issue.count)}
                        </span>
                        {route && (
                          <Btn size="xs" icon={ArrowRight} onClick={() => navigate(route)} title={`Open ${route}`}>
                            View
                          </Btn>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </Panel>

      {/* ── 3. Lineage explorer ── */}
      <Panel>
        <PanelHeader icon={GitBranch} title="Figure lineage"
          subtitle="Trace a headline figure back to its source tables, their provenance, and the imports behind it"
          actions={
            <Select
              value={domain}
              onChange={setDomain}
              options={LINEAGE_DOMAINS.map((d) => ({ value: d, label: DOMAIN_LABELS[d] || d }))}
              className="w-44"
            />
          } />

        {lineageLoading ? (
          <LoadingState label="Tracing the figure" rows={3} />
        ) : lineageError ? (
          <ErrorState message={lineageError} onRetry={loadLineage} />
        ) : !lineage ? (
          <EmptyState title="No lineage" reason="This figure has no traced sources for the current selection." />
        ) : (
          <>
            {/* Source tables */}
            {Array.isArray(lineage.sources) && lineage.sources.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {lineage.sources.map((src, i) => (
                  <SourceCard key={`${src.table}-${i}`} src={src} />
                ))}
              </div>
            ) : (
              <EmptyState title="No source tables" reason="No source tables were reported for this figure." />
            )}

            {/* Recent imports */}
            <div className="mt-5">
              <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2 flex items-center gap-1.5">
                <FileClock size={12} className="text-gray-600" /> Recent imports behind this figure
              </p>
              {Array.isArray(lineage.recent_imports) && lineage.recent_imports.length > 0 ? (
                <Table>
                  <THead>
                    <Th>Module</Th>
                    <Th>File</Th>
                    <Th align="right">Rows</Th>
                    <Th align="right">Imported</Th>
                    <Th align="right">Duplicates</Th>
                    <Th>Status</Th>
                    <Th>When</Th>
                  </THead>
                  <tbody>
                    {lineage.recent_imports.map((imp, i) => (
                      <Tr key={i} tone={imp.repeat_file ? 'warning' : undefined}>
                        <Td nowrap>{imp.module || 'N/A'}</Td>
                        <Td>
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <span className="truncate max-w-[16rem]" title={imp.file || ''}>{imp.file || 'N/A'}</span>
                            {imp.repeat_file && <Badge tone="warning" title="This file content was seen before">repeat</Badge>}
                          </span>
                        </Td>
                        <Td align="right" nowrap>{fmtInt(imp.rows)}</Td>
                        <Td align="right" nowrap>{fmtInt(imp.imported)}</Td>
                        <Td align="right" nowrap>{fmtInt(imp.duplicates)}</Td>
                        <Td nowrap><Badge tone={statusTone(imp.status)}>{imp.status || 'N/A'}</Badge></Td>
                        <Td nowrap title={fmtDateTime(imp.at)}>{fmtDateTime(imp.at)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <Note>No import activity is recorded behind this figure. It may have been loaded directly rather than through the import pipeline.</Note>
              )}
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}

/** Import status word -> Badge tone. */
function statusTone(status) {
  const s = String(status || '').toLowerCase()
  if (/(commit|success|done|imported|ok)/.test(s)) return 'good'
  if (/(fail|error|reject)/.test(s)) return 'danger'
  if (/(partial|warn|skip|duplicate)/.test(s)) return 'warning'
  if (/(draft|stage|pending|nothing)/.test(s)) return 'quiet'
  return 'default'
}

/**
 * One source table card. The provenance stats vary by table, so render every
 * key generically: nested objects (currencies / classification / data_source)
 * become compact lists, "%_pct" keys render as percents, everything else as a
 * thousands-separated count. table / role / rows are pulled out to the header.
 */
function SourceCard({ src }) {
  const SKIP = new Set(['table', 'role', 'rows'])
  const entries = Object.entries(src).filter(([k]) => !SKIP.has(k))
  const scalars = entries.filter(([, v]) => v == null || typeof v !== 'object')
  const objects = entries.filter(([, v]) => v && typeof v === 'object')

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Code title="Source table">{src.table || 'N/A'}</Code>
          {src.role && <p className="text-[11px] text-gray-500 mt-1">{src.role}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold tabular-nums text-gray-100">{fmtInt(src.rows)}</p>
          <p className="text-[10px] uppercase tracking-wide text-gray-600">rows</p>
        </div>
      </div>

      {scalars.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {scalars.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-800/70 text-[10px]">
              <span className="text-gray-500 capitalize">{labelizeKey(k)}</span>
              <span className="text-gray-200 font-medium">
                {/_pct$/.test(k) ? fmtPct(v)
                  : /_(date|min|max)$/.test(k) ? fmtDate(v)
                    : typeof v === 'number' ? fmtInt(v)
                      : (v == null || v === '' ? 'N/A' : String(v))}
              </span>
            </span>
          ))}
        </div>
      )}

      {objects.map(([k, obj]) => {
        const rows = Object.entries(obj || {})
        return (
          <div key={k} className="mt-3">
            <p className="text-[10px] uppercase tracking-wide text-gray-600 mb-1 capitalize">{labelizeKey(k)}</p>
            {rows.length === 0 ? (
              <p className="text-[11px] text-gray-600">N/A</p>
            ) : (
              <div className="space-y-0.5">
                {rows.map(([rk, rv]) => (
                  <div key={rk} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-gray-500 truncate">{rk}</span>
                    <span className="text-gray-300 font-medium tabular-nums shrink-0">
                      {typeof rv === 'number' ? fmtInt(rv) : (rv == null ? 'N/A' : String(rv))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
