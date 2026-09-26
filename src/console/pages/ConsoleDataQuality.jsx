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
  ShieldCheck, RefreshCw, Play, AlertTriangle, CheckCircle2, ExternalLink, Download, FileText,
  ListChecks, Users,
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
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import { useTableSort } from '../../lib/useTableSort'
import { ShareChart, STATUS, useChartTheme } from '../components/ui/charts'

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
const STATUS_RANK = { fail: 0, warn: 1, pass: 2 }
const SEVERITY_RANK = { critical: 0, error: 1, warning: 2, warn: 2, info: 3 }
const EXPORT_COLS = [
  ['check', 'Check'], ['dimension', 'Dimension'], ['severity', 'Severity'], ['status', 'Status'],
  ['affected', 'Affected records'], ['message', 'Message'], ['checked_at', 'Checked at'],
]
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
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const theme = useChartTheme()
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
      // One re-read of what the run stored, so the flash and the table agree.
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
    return state.results.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (severityFilter && String(r.severity || 'info').toLowerCase() !== severityFilter) return false
      if (!q) return true
      const name = ruleByKey.get(r.ruleKey)?.name || r.ruleKey
      return `${name} ${r.message}`.toLowerCase().includes(q)
    })
  }, [state.results, search, statusFilter, severityFilter, ruleByKey])

  const accessors = useMemo(() => ({
    name: (r) => ruleByKey.get(r.ruleKey)?.name || r.ruleKey,
    severity: (r) => SEVERITY_RANK[String(r.severity || 'info').toLowerCase()] ?? 4,
    status: (r) => STATUS_RANK[r.status] ?? 3,
  }), [ruleByKey])
  // Worst-first by default (status rank ascending), the order a triage starts in.
  const { sort, onSort, sorted } = useTableSort(rows, { key: 'status', dir: 'asc' }, accessors)

  const severityOptions = useMemo(() => {
    const set = new Set(state.results.map((r) => String(r.severity || 'info').toLowerCase()))
    return [...set].sort().map((v) => ({ value: v, label: v }))
  }, [state.results])

  const toggleStatus = (v) => setStatusFilter((cur) => (cur === v ? '' : v))

  function exportRows(kind) {
    const out = sorted.map((r) => {
      const rule = ruleByKey.get(r.ruleKey)
      return {
        check: rule?.name || r.ruleKey,
        dimension: rule?.dimension || 'N/A',
        severity: r.severity || 'info',
        status: statusLabel(r.status),
        affected: r.failureCount,
        message: r.message || 'N/A',
        checked_at: r.checkedAt ? String(r.checkedAt).slice(0, 16).replace('T', ' ') : 'N/A',
      }
    })
    const file = reportFileName('TyrePulse Data Quality', country)
    if (kind === 'pdf') exportToPdf(out, EXPORT_COLS.map(([key, header]) => ({ key, header })), 'Data Quality Checks', file, 'landscape')
    else exportToExcel(out, EXPORT_COLS.map(([k]) => k), EXPORT_COLS.map(([, h]) => h), file)
  }

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          <ShieldCheck size={18} className="text-orange-400" aria-hidden="true" /> Data Quality Center
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Governed checks over the fleet data: required fields, dates, integrity, freshness and business rules.
        </p>
      </div>
      <Toolbar>
        <Select ariaLabel="Country" value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-32" />
        <Btn variant="primary" icon={Play} busy={running} disabled={state.loading} onClick={runNow}>Run checks now</Btn>
        <Btn icon={RefreshCw} onClick={load} busy={state.loading}>Refresh</Btn>
      </Toolbar>
    </div>
  )

  if (state.loading) return <div className="space-y-4">{header}<LoadingState label="Reading data-quality results" rows={5} /></div>
  if (state.error) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState message={state.error} onRetry={load} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {header}
      <Panel>
        <PanelHeader icon={ListChecks} title="Summary" subtitle="Click a tile to filter the results to that status." />

        {flash && (
          <div className="mb-3" role="status">
            <Note icon={flash.tone === 'accent' ? CheckCircle2 : AlertTriangle} tone={flash.tone}>
              {flash.text}
            </Note>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 grid grid-cols-2 gap-3 content-start">
            <StatTile label="Checks" value={num(summary.total)} icon={ListChecks}
              onClick={() => setStatusFilter('')} active={!statusFilter} />
            <StatTile label="Failing" value={num(summary.fail)} icon={AlertTriangle} tone={summary.fail ? 'danger' : 'good'}
              onClick={() => toggleStatus('fail')} active={statusFilter === 'fail'} />
            <StatTile label="Warnings" value={num(summary.warn)} tone={summary.warn ? 'warning' : 'default'}
              onClick={() => toggleStatus('warn')} active={statusFilter === 'warn'} />
            <StatTile label="Affected records" value={num(summary.affected)} icon={Users} tone={summary.affected ? 'warning' : 'default'}
              sub={`${num(summary.pass)} checks passing`} />
          </div>
          <ShareChart
            height={150}
            parts={[
              { label: 'Failing', value: summary.fail, color: STATUS[theme].critical },
              { label: 'Warning', value: summary.warn, color: STATUS[theme].medium },
              { label: 'Pass', value: summary.pass, color: STATUS[theme].good },
            ]}
            center={{ value: num(summary.total), label: 'checks' }}
            summary={`${summary.fail} failing, ${summary.warn} warning and ${summary.pass} passing checks.`}
            emptyText="No checks have been run yet."
          />
        </div>
      </Panel>

      {/* ── results ────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={ShieldCheck}
          title="Check results"
          subtitle={`Worst-first. ${num(rows.length)} of ${num(state.results.length)} shown. A failing check names the rows it points at; open the drilldown to investigate.`}
          actions={<>
            <Btn icon={Download} onClick={() => exportRows('xlsx')} disabled={!sorted.length}>Excel</Btn>
            <Btn icon={FileText} onClick={() => exportRows('pdf')} disabled={!sorted.length}>PDF</Btn>
          </>}
        />
        <Toolbar className="mb-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search checks" className="w-full sm:w-64" />
          <Select ariaLabel="Filter by status" value={statusFilter} onChange={setStatusFilter} placeholder="All statuses" className="w-36"
            options={[{ value: 'fail', label: 'Failing' }, { value: 'warn', label: 'Warning' }, { value: 'pass', label: 'Pass' }]} />
          <Select ariaLabel="Filter by severity" value={severityFilter} onChange={setSeverityFilter} placeholder="All severities" className="w-36"
            options={severityOptions} />
          {(search || statusFilter || severityFilter) && (
            <Btn variant="quiet" onClick={() => { setSearch(''); setStatusFilter(''); setSeverityFilter('') }}>Clear filters</Btn>
          )}
        </Toolbar>
        {state.results.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No checks have been run yet"
            reason="Press Run checks now to compute and store the current data-quality results."
            action={<Btn variant="primary" icon={Play} busy={running} onClick={runNow}>Run checks now</Btn>}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No checks match these filters" reason="Clear the search and filters to see every check." />
        ) : (
          <Table>
            <THead>
              <Th sortKey="name" sort={sort} onSort={onSort}>Check</Th>
              <Th sortKey="severity" sort={sort} onSort={onSort}>Severity</Th>
              <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
              <Th sortKey="failureCount" sort={sort} onSort={onSort} align="right">Affected</Th>
              <Th>Message</Th>
              <Th align="right">Investigate</Th>
            </THead>
            <tbody>
              {sorted.map((r) => {
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
                          target={href.startsWith('/console') ? undefined : '_blank'}
                          rel={href.startsWith('/console') ? undefined : 'noopener noreferrer'}
                          aria-label={`Open the rows behind ${rule?.name || r.ruleKey}`}
                          className="inline-flex items-center gap-1 text-orange-300 hover:text-orange-200 text-xs rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                        >
                          <ExternalLink size={12} aria-hidden="true" /> Open
                        </a>
                      ) : (
                        <span className="text-gray-400 text-xs">N/A</span>
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
            <Btn onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>
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
