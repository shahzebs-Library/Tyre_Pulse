/**
 * ConsoleDataQuality.jsx - the Data Quality Center.
 *
 * Governed checks over the fleet data: required fields, dates, integrity,
 * freshness and business rules. Each check is a registered rule with an owner
 * and a source reference, so a failing number can be traced to the exact rule
 * that raised it and the rows it points at.
 *
 * Running the checks computes and stores results server-side; this page only
 * reads them back. Nothing runs on load - a person presses "Run checks now".
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck, RefreshCw, Play, AlertTriangle, CheckCircle2, ExternalLink,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, SearchInput, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import {
  runQualityChecks, listQualityRules, listQualityResults,
} from '../../lib/api/dataTrustOps'
import { shapeQualityResults, qualitySummary } from '../../lib/dataTrustOps'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'

const nf = new Intl.NumberFormat('en-US')
const num = (v) => (v === null || v === undefined ? 'N/A' : nf.format(Number(v)))

const COUNTRY_OPTS = ['All', ...COUNTRIES].map((c) => ({ value: c, label: c }))

function severityTone(sev) {
  const s = String(sev || '').toLowerCase()
  if (s === 'critical' || s === 'error') return 'danger'
  if (s === 'warning' || s === 'warn') return 'warning'
  return 'quiet'
}
function statusTone(status) {
  if (status === 'fail') return 'danger'
  if (status === 'warn') return 'warning'
  if (status === 'pass') return 'good'
  return 'default'
}
function statusLabel(status) {
  if (status === 'fail') return 'Failing'
  if (status === 'warn') return 'Warning'
  if (status === 'pass') return 'Pass'
  return status || 'Unknown'
}
/** A drilldown is only a link when it is a usable string path. */
function drilldownHref(d) {
  if (typeof d !== 'string' || !d) return null
  if (d.startsWith('/') || d.startsWith('http://') || d.startsWith('https://')) return d
  return null
}

export default function ConsoleDataQuality() {
  const [country, setCountry] = useState('All')
  const [state, setState] = useState({ loading: true, error: null, results: [], rules: [] })
  const [search, setSearch] = useState('')
  const [showRules, setShowRules] = useState(false)
  const [running, setRunning] = useState(false)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const [rawResults, rules] = await Promise.all([
        listQualityResults({ country: country === 'All' ? null : country }),
        listQualityRules(),
      ])
      setState({ loading: false, error: null, results: shapeQualityResults(rawResults), rules })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), results: [], rules: [] })
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const runNow = async () => {
    setRunning(true)
    setFlash(null)
    try {
      await runQualityChecks(country === 'All' ? null : country)
      await load()
      // load() has already refreshed results; summarise from the fresh state on
      // the next tick via a direct re-read so the flash reflects what stored.
      const fresh = shapeQualityResults(
        await listQualityResults({ country: country === 'All' ? null : country }),
      )
      const sum = qualitySummary(fresh)
      setState((s) => ({ ...s, results: fresh }))
      setFlash({
        tone: sum.fail > 0 ? 'danger' : sum.warn > 0 ? 'warning' : 'accent',
        text: sum.fail > 0
          ? `${sum.fail} check${sum.fail === 1 ? '' : 's'} failing, ${sum.warn} warning${sum.warn === 1 ? '' : 's'}.`
          : sum.warn > 0
            ? `No failures. ${sum.warn} warning${sum.warn === 1 ? '' : 's'} to review.`
            : 'All checks passed.',
      })
    } catch (e) {
      setFlash({ tone: 'danger', text: toUserMessage(e) })
    } finally {
      setRunning(false)
    }
  }

  const summary = useMemo(() => qualitySummary(state.results), [state.results])
  const ruleByKey = useMemo(() => {
    const m = new Map()
    for (const r of state.rules) m.set(r.rule_key, r)
    return m
  }, [state.rules])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return state.results
    return state.results.filter((r) => {
      const name = ruleByKey.get(r.ruleKey)?.name || r.ruleKey
      return `${name} ${r.message}`.toLowerCase().includes(q)
    })
  }, [state.results, search, ruleByKey])

  if (state.loading) return <LoadingState label="Reading data-quality results" rows={5} />
  if (state.error) return <ErrorState message={state.error} onRetry={load} />

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          icon={ShieldCheck}
          title="Data Quality Center"
          subtitle="Governed checks over the fleet data - required fields, dates, integrity, freshness and business rules."
          actions={(
            <Toolbar>
              <Select value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-32" />
              <Btn variant="primary" icon={Play} busy={running} onClick={runNow}>Run checks now</Btn>
              <Btn icon={RefreshCw} onClick={load}>Refresh</Btn>
            </Toolbar>
          )}
        />

        {flash && (
          <div className="px-4 pb-3">
            <Note icon={flash.tone === 'accent' ? CheckCircle2 : AlertTriangle} tone={flash.tone}>
              {flash.text}
            </Note>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 pt-0">
          <StatTile label="Checks" value={num(summary.total)} />
          <StatTile label="Failing" value={num(summary.fail)} tone={summary.fail ? 'danger' : 'good'} />
          <StatTile label="Warnings" value={num(summary.warn)} tone={summary.warn ? 'warning' : 'default'} />
          <StatTile label="Affected records" value={num(summary.affected)} tone={summary.affected ? 'warning' : 'default'} />
        </div>
      </Panel>

      {/* ── results ────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={ShieldCheck}
          title="Check results"
          subtitle="Worst-first. A failing check names the rows it points at - open the drilldown to investigate."
          actions={<SearchInput value={search} onChange={setSearch} placeholder="Search checks" className="w-56" />}
        />
        {state.results.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No checks have been run yet"
            reason="Press Run checks now to compute and store the current data-quality results."
            action={<Btn variant="primary" icon={Play} busy={running} onClick={runNow}>Run checks now</Btn>}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No checks match your search" reason="Clear the search to see every check." />
        ) : (
          <Table>
            <THead>
              <Th>Check</Th>
              <Th>Severity</Th>
              <Th>Status</Th>
              <Th align="right">Affected</Th>
              <Th>Message</Th>
              <Th align="right">Investigate</Th>
            </THead>
            <tbody>
              {rows.map((r) => {
                const rule = ruleByKey.get(r.ruleKey)
                const href = drilldownHref(r.drilldown)
                return (
                  <Tr key={r.ruleKey} tone={r.status === 'fail' ? 'warning' : undefined}>
                    <Td>
                      <span className="font-medium text-gray-100">{rule?.name || r.ruleKey}</span>
                      {rule?.dimension && <div className="text-[11px] text-gray-500 mt-0.5">{rule.dimension}</div>}
                    </Td>
                    <Td><Badge tone={severityTone(r.severity)}>{r.severity || 'info'}</Badge></Td>
                    <Td><Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge></Td>
                    <Td align="right" nowrap>{num(r.failureCount)}</Td>
                    <Td><span className="text-gray-400">{r.message || 'N/A'}</span></Td>
                    <Td align="right">
                      {href ? (
                        <a
                          href={href}
                          className="inline-flex items-center gap-1 text-orange-300 hover:text-orange-200 text-xs"
                        >
                          <ExternalLink size={12} /> Open
                        </a>
                      ) : (
                        <span className="text-gray-600 text-xs">N/A</span>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      {/* ── registered rules ───────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={ShieldCheck}
          title="Registered rules"
          subtitle="Every governed check, its dimension, the table it scopes and who owns it."
          actions={(
            <Btn onClick={() => setShowRules((v) => !v)}>
              {showRules ? 'Hide' : `Show ${state.rules.length}`}
            </Btn>
          )}
        />
        {showRules && (
          state.rules.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No rules registered" reason="No active quality rules were returned for this workspace." />
          ) : (
            <Table>
              <THead>
                <Th>Rule</Th>
                <Th>Dimension</Th>
                <Th>Scope table</Th>
                <Th>Severity</Th>
                <Th>Owner</Th>
              </THead>
              <tbody>
                {state.rules.map((r) => (
                  <Tr key={r.rule_key}>
                    <Td>
                      <span className="font-medium text-gray-100">{r.name || r.rule_key}</span>
                      {r.description && <div className="text-[11px] text-gray-500 mt-0.5 max-w-md">{r.description}</div>}
                    </Td>
                    <Td>{r.dimension || 'N/A'}</Td>
                    <Td><span className="text-gray-400">{r.scope_table || 'N/A'}</span></Td>
                    <Td><Badge tone={severityTone(r.severity)}>{r.severity || 'info'}</Badge></Td>
                    <Td><span className="text-gray-400">{r.owner || r.source_ref || 'N/A'}</span></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )
        )}
      </Panel>
    </div>
  )
}
