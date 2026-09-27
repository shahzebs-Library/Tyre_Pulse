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
 *
 * Layout: header, four clickable KPI tiles, "what needs attention", then three
 * tabs (?tab=results|insights|rules). Row detail opens in a modal instead of
 * expanding the table.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck, Play, AlertTriangle, CheckCircle2, ExternalLink, ListChecks, Users,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, SearchInput, Toolbar, Segmented,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import {
  runQualityChecks, listQualityRules, listQualityResults,
} from '../../lib/api/dataTrustOps'
import { shapeQualityResults, qualitySummary } from '../../lib/dataTrustOps'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { ShareChart, BarsChart, TrendChart, STATUS, useChartTheme } from '../components/ui/charts'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList, DetailGrid } from './shared/pageKit'

const nf = new Intl.NumberFormat('en-US')
const num = (v) => (v === null || v === undefined ? 'N/A' : nf.format(Number(v)))

const COUNTRY_OPTS = ['All', ...COUNTRIES].map((c) => ({ value: c, label: c }))
const TABS = ['results', 'insights', 'rules']

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
const fmtTs = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : 'N/A')

/** A drilldown is only a link when it is a usable string path. */
function drilldownHref(d) {
  if (typeof d !== 'string' || !d) return null
  if (d.startsWith('/') || d.startsWith('http://') || d.startsWith('https://')) return d
  return null
}

function DrillLink({ href, name }) {
  if (!href) return <span className="text-gray-400 text-xs">N/A</span>
  const internal = href.startsWith('/console')
  return (
    <a
      href={href}
      target={internal ? undefined : '_blank'}
      rel={internal ? undefined : 'noopener noreferrer'}
      aria-label={`Open the rows behind ${name}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-orange-300 hover:text-orange-200 text-xs rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      <ExternalLink size={12} aria-hidden="true" /> Open
    </a>
  )
}

export default function ConsoleDataQuality() {
  const [country, setCountry] = useState('All')
  const [state, setState] = useState({ loading: true, error: null, results: [], raw: [], rules: [], at: null })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [tab, setTab] = useUrlTab(TABS, 'results')
  const [detail, setDetail] = useState(null)
  const [ruleSearch, setRuleSearch] = useState('')
  const theme = useChartTheme()
  const [running, setRunning] = useState(false)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const [rawResults, rules] = await Promise.all([
        listQualityResults({ country: country === 'All' ? null : country }),
        listQualityRules(),
      ])
      setState({ loading: false, error: null, results: shapeQualityResults(rawResults), raw: rawResults || [], rules: rules || [], at: new Date() })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), results: [], raw: [], rules: [], at: null })
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const runNow = async () => {
    setRunning(true)
    setFlash(null)
    try {
      await runQualityChecks(country === 'All' ? null : country)
      // One re-read of what the run stored, so the flash and the table agree.
      const raw = await listQualityResults({ country: country === 'All' ? null : country })
      const fresh = shapeQualityResults(raw)
      const sum = qualitySummary(fresh)
      setState((s) => ({ ...s, results: fresh, raw: raw || [], at: new Date() }))
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
  const nameOf = useCallback((r) => ruleByKey.get(r.ruleKey)?.name || r.ruleKey, [ruleByKey])

  const rows = useMemo(() => {
    const filtered = state.results.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (severityFilter && String(r.severity || 'info').toLowerCase() !== severityFilter) return false
      return true
    })
    return searchRows(filtered, search, [nameOf, 'message', (r) => ruleByKey.get(r.ruleKey)?.dimension])
  }, [state.results, search, statusFilter, severityFilter, ruleByKey, nameOf])

  const accessors = useMemo(() => ({
    name: nameOf,
    severity: (r) => SEVERITY_RANK[String(r.severity || 'info').toLowerCase()] ?? 4,
    status: (r) => STATUS_RANK[r.status] ?? 3,
  }), [nameOf])
  // Worst-first by default (status rank ascending), the order a triage starts in.
  const { sort, onSort } = useTableSort({ key: 'status', dir: 'asc' })
  const sorted = useMemo(() => sortRows(rows, sort, accessors), [rows, sort, accessors])
  const paged = usePaged(sorted, 25)

  const severityOptions = useMemo(() => {
    const set = new Set(state.results.map((r) => String(r.severity || 'info').toLowerCase()))
    return [...set].sort().map((v) => ({ value: v, label: v }))
  }, [state.results])

  const toggleStatus = (v) => { setStatusFilter((cur) => (cur === v ? '' : v)); setTab('results') }

  const exportColumns = useMemo(() => [
    { key: 'check', header: 'Check', value: nameOf },
    { key: 'dimension', header: 'Dimension', value: (r) => ruleByKey.get(r.ruleKey)?.dimension || 'N/A' },
    { key: 'severity', header: 'Severity', value: (r) => r.severity || 'info' },
    { key: 'status', header: 'Status', value: (r) => statusLabel(r.status) },
    { key: 'affected', header: 'Affected records', value: (r) => r.failureCount },
    { key: 'message', header: 'Message', value: (r) => r.message || 'N/A' },
    { key: 'checked_at', header: 'Checked at', value: (r) => fmtTs(r.checkedAt) },
  ], [nameOf, ruleByKey])

  // ── insights ────────────────────────────────────────────────────────────
  const attention = useMemo(() => state.results
    .filter((r) => r.status === 'fail' || r.status === 'warn')
    .sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || (b.failureCount - a.failureCount))
    .slice(0, 4)
    .map((r) => ({
      key: r.ruleKey,
      tone: r.status === 'fail' ? 'danger' : 'warning',
      title: `${nameOf(r)}: ${num(r.failureCount)} affected`,
      detail: r.message || undefined,
      action: { label: 'Details', onClick: () => setDetail(r) },
    })), [state.results, nameOf])

  const byDimension = useMemo(() => {
    const m = new Map()
    for (const r of state.results) {
      if (r.status !== 'fail' && r.status !== 'warn') continue
      const d = ruleByKey.get(r.ruleKey)?.dimension || 'Unassigned'
      m.set(d, (m.get(d) || 0) + (r.failureCount || 0))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))
  }, [state.results, ruleByKey])

  // Failing checks per run day, from the stored history (newest 400 results).
  const trend = useMemo(() => {
    const m = new Map()
    for (const r of state.raw) {
      const day = String(r.checked_at || '').slice(0, 10)
      if (!day) continue
      const cur = m.get(day) || { fail: 0, warn: 0 }
      if (r.status === 'fail') cur.fail += 1
      else if (r.status === 'warn') cur.warn += 1
      m.set(day, cur)
    }
    const days = [...m.keys()].sort()
    return {
      labels: days,
      series: [
        { label: 'Failing', values: days.map((d) => m.get(d).fail), color: STATUS[theme].critical },
        { label: 'Warning', values: days.map((d) => m.get(d).warn), color: STATUS[theme].medium },
      ],
    }
  }, [state.raw, theme])

  const rules = useMemo(() => searchRows(state.rules, ruleSearch, ['name', 'rule_key', 'dimension', 'scope_table', 'owner']), [state.rules, ruleSearch])
  const rulesPaged = usePaged(rules, 25)

  const header = (
    <PageHeader
      icon={ShieldCheck}
      title="Data Quality Center"
      purpose="Governed checks over the fleet data: required fields, dates, integrity, freshness and business rules."
      refreshedAt={state.at}
      onRefresh={load}
      refreshing={state.loading}
      actions={<>
        <Select ariaLabel="Country" value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-32" />
        <Btn variant="primary" icon={Play} busy={running} disabled={state.loading} onClick={runNow}>Run checks now</Btn>
      </>}
    />
  )

  if (state.loading && !state.at) return <div className="space-y-4">{header}<LoadingState label="Reading data-quality results" rows={5} /></div>
  if (state.error) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState message={state.error} onRetry={load} />
      </div>
    )
  }

  const detailRule = detail ? ruleByKey.get(detail.ruleKey) : null

  return (
    <div className="space-y-4">
      {header}

      {flash && (
        <div role="status">
          <Note icon={flash.tone === 'accent' ? CheckCircle2 : AlertTriangle} tone={flash.tone}>{flash.text}</Note>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Checks" value={num(summary.total)} icon={ListChecks}
          onClick={() => { setStatusFilter(''); setTab('results') }} active={!statusFilter && tab === 'results'} />
        <StatTile label="Failing" value={num(summary.fail)} icon={AlertTriangle} tone={summary.fail ? 'danger' : 'good'}
          onClick={() => toggleStatus('fail')} active={statusFilter === 'fail'} />
        <StatTile label="Warnings" value={num(summary.warn)} tone={summary.warn ? 'warning' : 'default'}
          onClick={() => toggleStatus('warn')} active={statusFilter === 'warn'} />
        <StatTile label="Affected records" value={num(summary.affected)} icon={Users} tone={summary.affected ? 'warning' : 'default'}
          sub={`${num(summary.pass)} checks passing`} />
      </div>

      {state.results.length > 0 && (
        <AttentionList items={attention} clearText="Every check passed on the latest run." />
      )}

      <Segmented ariaLabel="Data quality views" value={tab} onChange={setTab} options={[
        { key: 'results', label: 'Check results', count: state.results.length },
        { key: 'insights', label: 'Insights' },
        { key: 'rules', label: 'Registered rules', count: state.rules.length },
      ]} />

      {tab === 'results' && (
        <Panel>
          <PanelHeader
            icon={ShieldCheck}
            title="Check results"
            subtitle={`Worst-first. ${num(rows.length)} of ${num(state.results.length)} shown. Open a row for its rule, owner and drilldown.`}
            actions={<ExportButtons rows={sorted} columns={exportColumns} title={`TyrePulse Data Quality ${country}`} />}
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
            <>
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
                  {paged.pageRows.map((r) => {
                    const rule = ruleByKey.get(r.ruleKey)
                    return (
                      <Tr key={r.ruleKey} tone={r.status === 'fail' ? 'warning' : undefined}
                        onClick={() => setDetail(r)} ariaLabel={`Details for ${nameOf(r)}`}>
                        <Td>
                          <span className="font-medium text-gray-100">{nameOf(r)}</span>
                          {rule?.dimension && <div className="text-[11px] text-gray-500 mt-0.5">{rule.dimension}</div>}
                        </Td>
                        <Td><Badge tone={severityTone(r.severity)}>{r.severity || 'info'}</Badge></Td>
                        <Td><Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge></Td>
                        <Td align="right" nowrap>{num(r.failureCount)}</Td>
                        <Td><span className="text-gray-400 line-clamp-2">{r.message || 'N/A'}</span></Td>
                        <Td align="right"><DrillLink href={drilldownHref(r.drilldown)} name={nameOf(r)} /></Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
              <Pager {...paged} label="checks" />
            </>
          )}
        </Panel>
      )}

      {tab === 'insights' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel>
            <PanelHeader icon={ListChecks} title="Status split" subtitle="Latest result of every registered check." />
            <ShareChart
              height={170}
              parts={[
                { label: 'Failing', value: summary.fail, color: STATUS[theme].critical },
                { label: 'Warning', value: summary.warn, color: STATUS[theme].medium },
                { label: 'Pass', value: summary.pass, color: STATUS[theme].good },
              ]}
              center={{ value: num(summary.total), label: 'checks' }}
              summary={`${summary.fail} failing, ${summary.warn} warning and ${summary.pass} passing checks.`}
              emptyText="No checks have been run yet."
            />
          </Panel>
          <Panel>
            <PanelHeader icon={AlertTriangle} title="Affected records by dimension" subtitle="Failing and warning checks only, so it shows where the problems sit." />
            <BarsChart bars={byDimension} valueFormat={(v) => num(v)}
              summary={byDimension.length ? `${byDimension[0].label} carries the most affected records (${num(byDimension[0].value)}).` : undefined}
              emptyText="No failing or warning checks." />
          </Panel>
          <Panel className="lg:col-span-2">
            <PanelHeader icon={ShieldCheck} title="Failing checks per run day"
              subtitle="From the stored result history (newest 400 results). A falling line means fixes are landing." />
            <TrendChart labels={trend.labels} series={trend.series} height={200} area={false}
              summary={trend.labels.length ? `${trend.labels.length} run days on record.` : undefined}
              emptyText="No run history yet. Run the checks to start one." />
          </Panel>
        </div>
      )}

      {tab === 'rules' && (
        <Panel>
          <PanelHeader
            icon={ShieldCheck}
            title="Registered rules"
            subtitle="Every governed check, its dimension, the table it scopes and who owns it."
            actions={<ExportButtons rows={rules} title="TyrePulse Data Quality Rules" columns={[
              { key: 'name', header: 'Rule', value: (r) => r.name || r.rule_key },
              { key: 'dimension', header: 'Dimension' },
              { key: 'scope_table', header: 'Scope table' },
              { key: 'severity', header: 'Severity' },
              { key: 'owner', header: 'Owner', value: (r) => r.owner || r.source_ref },
            ]} />}
          />
          <Toolbar className="mb-3">
            <SearchInput value={ruleSearch} onChange={setRuleSearch} placeholder="Search rules" className="w-full sm:w-64" />
          </Toolbar>
          {state.rules.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No rules registered" reason="No active quality rules were returned for this workspace." />
          ) : rules.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No rules match this search" reason="Clear the search to see every rule." />
          ) : (
            <>
              <Table>
                <THead>
                  <Th>Rule</Th>
                  <Th>Dimension</Th>
                  <Th>Scope table</Th>
                  <Th>Severity</Th>
                  <Th>Owner</Th>
                </THead>
                <tbody>
                  {rulesPaged.pageRows.map((r) => (
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
              <Pager {...rulesPaged} label="rules" />
            </>
          )}
        </Panel>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? nameOf(detail) : ''}
        subtitle={detailRule?.dimension || undefined}
        footer={<Btn onClick={() => setDetail(null)}>Close</Btn>}>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={statusTone(detail.status)}>{statusLabel(detail.status)}</Badge>
              <Badge tone={severityTone(detail.severity)}>{detail.severity || 'info'}</Badge>
            </div>
            <DetailGrid items={[
              ['Affected records', num(detail.failureCount)],
              ['Measured value', num(detail.measured)],
              ['Checked at', fmtTs(detail.checkedAt)],
              ['Rule key', detail.ruleKey],
              ['Scope table', detailRule?.scope_table],
              ['Owner', detailRule?.owner || detailRule?.source_ref],
            ]} />
            {detailRule?.description && <p className="text-xs text-gray-400">{detailRule.description}</p>}
            <div>
              <p className="text-[11px] text-gray-500 mb-1">Message</p>
              <p className="text-xs text-gray-300">{detail.message || 'N/A'}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              Rows behind this check: <DrillLink href={drilldownHref(detail.drilldown)} name={nameOf(detail)} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
