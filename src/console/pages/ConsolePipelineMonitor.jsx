/**
 * ConsolePipelineMonitor.jsx - the operational trace of every load.
 *
 * Two questions a data team asks when a number looks wrong:
 *   1. Did the pipeline that feeds it actually run, and did it run clean?
 *   2. Did the integrations behind it (AI, email) succeed or quietly fail?
 *
 * The Jobs tab answers the first from get_pipeline_runs (imports + reports);
 * the Integrations tab answers the second from get_integration_events; the
 * Trends tab puts both on a daily line. Nothing here is computed - it is the
 * honest run history, with rows/timing/errors shown as recorded and N/A where
 * the source carried nothing.
 *
 * The two reads are independent: a failure of one no longer blanks the other,
 * and each tab states its own failure instead of showing an empty table.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, Plug, AlertTriangle, CheckCircle2, Clock, TrendingUp, Timer,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, SearchInput,
  Table, THead, Th, Tr, Td, Toolbar, Segmented,
  LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { TrendChart, BarsChart } from '../components/ui/charts'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { dailySeries } from '../../lib/consoleCharts'
import ExportButtons from './shared/ExportButtons'
import { getPipelineRuns, getIntegrationEvents } from '../../lib/api/dataTrustOps'
import { pipelineSummary } from '../../lib/dataTrustOps'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList, ConsoleLink, TabPanel, whenText } from './shared/pageKit'

const nf = new Intl.NumberFormat('en-US')
const num = (v) => (v === null || v === undefined || v === '' ? 'N/A' : nf.format(Number(v)))
const READ_LIMIT = 200
const SLOW_MS = 10000
const PAGE_SIZE = 25

const isFail = (s) => /fail|error/i.test(String(s || ''))
const isOk = (s) => /commit|success|sent|done/i.test(String(s || ''))
function statusTone(s) {
  if (isFail(s)) return 'danger'
  if (isOk(s)) return 'good'
  return 'quiet'
}

const RUN_EXPORT_COLUMNS = [
  { key: 'source', header: 'Source' }, { key: 'job_key', header: 'Job' }, { key: 'trigger', header: 'Trigger' },
  { key: 'status', header: 'Status' }, { key: 'rows_in', header: 'Rows in' }, { key: 'rows_out', header: 'Rows out' },
  { key: 'skipped', header: 'Skipped' }, { key: 'duplicates', header: 'Duplicates' },
  { key: 'started_at', header: 'Started' }, { key: 'error_reason', header: 'Error' },
]
const EVENT_EXPORT_COLUMNS = [
  { key: 'integration', header: 'Integration' }, { key: 'event_type', header: 'Event type' },
  { key: 'status', header: 'Status' }, { key: 'http_status', header: 'HTTP' },
  { key: 'latency_ms', header: 'Latency ms' }, { key: 'error_reason', header: 'Error' },
  { key: 'occurred_at', header: 'When' },
]

const COUNTRY_OPTS = [{ value: 'All', label: 'All countries' }, ...COUNTRIES.map((x) => ({ value: x, label: x }))]
const OUTCOME_OPTS = [
  { value: 'all', label: 'Every outcome' },
  { value: 'failed', label: 'Failed only' },
  { value: 'ok', label: 'Succeeded only' },
  { value: 'other', label: 'Other states' },
]
const TABS = ['jobs', 'integrations', 'trends']

function outcomeOf(status) {
  if (isFail(status)) return 'failed'
  if (isOk(status)) return 'ok'
  return 'other'
}

export default function ConsolePipelineMonitor({ tabParam = 'tab' } = {}) {
  const [country, setCountry] = useState('All')
  const [tab, setTab] = useUrlTab(TABS, 'jobs', tabParam)
  const [search, setSearch] = useState('')
  const [outcome, setOutcome] = useState('all')
  const [detail, setDetail] = useState(null) // { kind: 'run'|'event', row }
  const [state, setState] = useState({
    loading: true, runs: [], events: [], runsError: null, eventsError: null, readAt: null,
  })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const [r, e] = await Promise.allSettled([
      getPipelineRuns({ country, limit: READ_LIMIT }),
      getIntegrationEvents({ country, limit: READ_LIMIT }),
    ])
    setState({
      loading: false,
      runs: r.status === 'fulfilled' ? r.value : [],
      events: e.status === 'fulfilled' ? e.value : [],
      runsError: r.status === 'rejected' ? toUserMessage(r.reason, 'The pipeline run history could not be read.') : null,
      eventsError: e.status === 'rejected' ? toUserMessage(e.reason, 'The integration events could not be read.') : null,
      readAt: Date.now(),
    })
  }, [country])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => pipelineSummary(state.runs), [state.runs])
  const eventStats = useMemo(() => {
    const ev = state.events
    const failed = ev.filter((x) => isFail(x.status)).length
    const lat = ev.map((x) => Number(x.latency_ms)).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b)
    const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : null
    return { total: ev.length, failed, rate: ev.length ? failed / ev.length : null, p95, slow: lat.filter((n) => n >= SLOW_MS).length }
  }, [state.events])

  const { sort: runSort, setSort: setRunSort, onSort: onRunSort } = useTableSort({ key: 'started_at', dir: 'desc' })
  const { sort: evtSort, setSort: setEvtSort, onSort: onEvtSort } = useTableSort({ key: 'occurred_at', dir: 'desc' })

  const runs = useMemo(() => {
    const byOutcome = outcome === 'all' ? state.runs : state.runs.filter((r) => outcomeOf(r.status) === outcome)
    return sortRows(searchRows(byOutcome, search, ['job_key', 'status', 'trigger', 'source', 'error_reason']), runSort)
  }, [state.runs, search, outcome, runSort])

  const events = useMemo(() => {
    const byOutcome = outcome === 'all' ? state.events : state.events.filter((x) => outcomeOf(x.status) === outcome)
    return sortRows(searchRows(byOutcome, search, ['event_type', 'integration', 'status', 'error_reason']), evtSort)
  }, [state.events, search, outcome, evtSort])

  const runPaged = usePaged(runs, PAGE_SIZE, `${search}|${outcome}|${country}|${runSort?.key}|${runSort?.dir}`)
  const evtPaged = usePaged(events, PAGE_SIZE, `${search}|${outcome}|${country}|${evtSort?.key}|${evtSort?.dir}`)

  // Daily lines for the trends tab.
  const runTrend = useMemo(() => {
    const ok = dailySeries(state.runs.filter((r) => !isFail(r.status)), (r) => r.started_at, 14)
    const bad = dailySeries(state.runs.filter((r) => isFail(r.status)), (r) => r.started_at, 14)
    return { labels: ok.labels, ok: ok.values, bad: bad.values, total: ok.total + bad.total }
  }, [state.runs])
  const eventTrend = useMemo(() => {
    const all = dailySeries(state.events, (x) => x.occurred_at, 14)
    const bad = dailySeries(state.events.filter((x) => isFail(x.status)), (x) => x.occurred_at, 14)
    return { labels: all.labels, all: all.values, bad: bad.values, total: all.total }
  }, [state.events])
  const failingJobs = useMemo(() => {
    const m = new Map()
    for (const r of state.runs) if (isFail(r.status)) m.set(r.job_key || 'Unnamed job', (m.get(r.job_key || 'Unnamed job') || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))
  }, [state.runs])

  const showFailures = (which) => { setOutcome('failed'); setSearch(''); setTab(which) }

  const attention = useMemo(() => {
    const out = []
    if (state.runsError || state.eventsError) return out
    if (summary.failed) {
      const newest = [...state.runs].filter((r) => isFail(r.status))
        .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))[0]
      out.push({
        key: 'runs', tone: 'danger',
        text: `${nf.format(summary.failed)} of the last ${nf.format(summary.total)} pipeline runs failed${newest?.job_key ? `, most recently ${newest.job_key}` : ''}.`,
        actionLabel: 'Show failed runs', onAction: () => showFailures('jobs'),
      })
    }
    if (eventStats.failed) {
      out.push({
        key: 'events', tone: eventStats.rate > 0.05 ? 'danger' : 'warning',
        text: `${nf.format(eventStats.failed)} integration calls failed (${(eventStats.rate * 100).toFixed(1)}% of ${nf.format(eventStats.total)}). Each one is an email or AI answer that did not arrive.`,
        actionLabel: 'Show failed calls', onAction: () => showFailures('integrations'),
      })
    }
    if (eventStats.slow) {
      out.push({
        key: 'slow', tone: 'info',
        text: `${nf.format(eventStats.slow)} integration calls took ${SLOW_MS / 1000} seconds or longer.`,
        actionLabel: 'Slowest first', onAction: () => { setOutcome('all'); setTab('integrations'); setEvtSort({ key: 'latency_ms', dir: 'desc' }) },
      })
    }
    const dupes = state.runs.reduce((a, r) => a + (Number(r.duplicates) || 0), 0)
    if (dupes) {
      out.push({ key: 'dupes', tone: 'info', text: `${nf.format(dupes)} duplicate rows were skipped across recent imports.`, to: '/console/duplicates', actionLabel: 'Duplicate Control' })
    }
    return out
    // showFailures only calls stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, eventStats, state.runs, state.runsError, state.eventsError, setEvtSort])

  const loadingFirst = state.loading && !state.readAt
  const tile = (n, err) => (err ? 'N/A' : loadingFirst ? '...' : nf.format(n))
  const bothFailed = state.runsError && state.eventsError

  return (
    <div className="space-y-4 max-w-7xl">
      <PageHeader
        icon={Activity}
        title="Pipeline & Integration Monitor"
        purpose="Every import, report and integration run: status, rows, timing and errors, newest first."
        refreshedAt={state.readAt}
        onRefresh={load}
        refreshing={state.loading}
        meta={<span>Last {READ_LIMIT} runs and {READ_LIMIT} integration events for the selected country.</span>}
        actions={<Select ariaLabel="Country" value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-40" />}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatTile label="Runs" icon={Activity} value={tile(summary.total, state.runsError)}
          onClick={() => { setOutcome('all'); setTab('jobs') }} active={tab === 'jobs' && outcome === 'all'} />
        <StatTile label="Runs OK" icon={CheckCircle2} value={tile(summary.ok, state.runsError)} tone="good"
          sub={summary.other ? `${nf.format(summary.other)} in another state` : undefined}
          onClick={() => { setOutcome('ok'); setTab('jobs') }} active={tab === 'jobs' && outcome === 'ok'} />
        <StatTile label="Runs failed" icon={AlertTriangle} value={tile(summary.failed, state.runsError)}
          tone={!state.runsError && summary.failed ? 'danger' : 'default'}
          onClick={() => showFailures('jobs')} active={tab === 'jobs' && outcome === 'failed'} />
        <StatTile label="Integration failures" icon={Plug} value={tile(eventStats.failed, state.eventsError)}
          tone={!state.eventsError && eventStats.failed ? 'warning' : 'default'}
          sub={state.eventsError || eventStats.rate == null ? undefined : `${(eventStats.rate * 100).toFixed(1)}% of ${nf.format(eventStats.total)} calls`}
          onClick={() => showFailures('integrations')} active={tab === 'integrations' && outcome === 'failed'} />
        <StatTile label="Slowest 5% of calls" icon={Timer}
          value={state.eventsError || eventStats.p95 == null ? 'N/A' : `${nf.format(eventStats.p95)} ms`}
          sub="95th percentile latency" tone="muted" />
      </div>

      {bothFailed ? (
        <ErrorState message={state.runsError} onRetry={load} />
      ) : (
        <AttentionList items={attention} clear={loadingFirst ? 'Checking...' : 'Every recent run and integration call succeeded.'} />
      )}

      <nav aria-label="Monitor views" className="flex flex-wrap items-center justify-between gap-2">
        <Segmented ariaLabel="Monitor views" value={tab} onChange={setTab} options={[
          { key: 'jobs', label: <><Activity size={13} aria-hidden="true" />Jobs</>, count: state.runsError ? null : runs.length },
          { key: 'integrations', label: <><Plug size={13} aria-hidden="true" />Integrations</>, count: state.eventsError ? null : events.length },
          { key: 'trends', label: <><TrendingUp size={13} aria-hidden="true" />Trends</> },
        ]} />
        {tab !== 'trends' && (
          <Toolbar>
            <SearchInput value={search} onChange={setSearch}
              placeholder={tab === 'jobs' ? 'Search job, status or error' : 'Search event, status or error'}
              className="w-full sm:w-60" ariaLabel="Search runs and events" />
            <Select ariaLabel="Outcome" value={outcome} onChange={setOutcome} options={OUTCOME_OPTS} className="w-36" />
          </Toolbar>
        )}
      </nav>

      {tab === 'jobs' && (
        <TabPanel label="Jobs">
          <Panel>
            <PanelHeader icon={Activity} title="Pipeline runs" subtitle="Imports and report generation. Click a run for its full error text."
              actions={<ExportButtons rows={runs} columns={RUN_EXPORT_COLUMNS} title="Pipeline Runs" disabled={!!state.runsError} />} />
            {loadingFirst ? (
              <LoadingState label="Reading run history" rows={6} />
            ) : state.runsError ? (
              <ErrorState message={state.runsError} onRetry={load} />
            ) : runs.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No runs to show"
                reason={search || outcome !== 'all' ? 'No run matches the search and outcome filter.' : 'No import or report run has been recorded for this scope yet.'}
                action={search || outcome !== 'all' ? <Btn onClick={() => { setSearch(''); setOutcome('all') }}>Clear filters</Btn> : <ConsoleLink plain to="/console/import-history">Open Import History</ConsoleLink>}
              />
            ) : (
              <>
                <Table>
                  <THead>
                    <Th sortKey="source" sort={runSort} onSort={onRunSort}>Source</Th>
                    <Th sortKey="job_key" sort={runSort} onSort={onRunSort}>Job</Th>
                    <Th sortKey="trigger" sort={runSort} onSort={onRunSort}>Trigger</Th>
                    <Th sortKey="status" sort={runSort} onSort={onRunSort}>Status</Th>
                    <Th align="right" sortKey="rows_in" sort={runSort} onSort={onRunSort}>Rows in</Th>
                    <Th align="right" sortKey="rows_out" sort={runSort} onSort={onRunSort}>Rows out</Th>
                    <Th align="right" sortKey="skipped" sort={runSort} onSort={onRunSort}>Skipped</Th>
                    <Th align="right" sortKey="duplicates" sort={runSort} onSort={onRunSort}>Duplicates</Th>
                    <Th sortKey="started_at" sort={runSort} onSort={onRunSort}>Started</Th>
                    <Th>Error</Th>
                  </THead>
                  <tbody>
                    {runPaged.rows.map((r, i) => (
                      <Tr key={`${r.job_key || 'job'}:${r.started_at || i}:${i}`} tone={isFail(r.status) ? 'warning' : undefined}
                        onClick={() => setDetail({ kind: 'run', row: r })} ariaLabel={`Run ${r.job_key || ''} ${r.status || ''}`.trim()}>
                        <Td><Badge tone={r.source === 'report' ? 'info' : 'accent'}>{r.source || 'run'}</Badge></Td>
                        <Td><span className="text-gray-200">{r.job_key || 'N/A'}</span></Td>
                        <Td>{r.trigger || 'N/A'}</Td>
                        <Td><Badge tone={statusTone(r.status)}>{r.status || 'N/A'}</Badge></Td>
                        <Td align="right">{num(r.rows_in)}</Td>
                        <Td align="right">{num(r.rows_out)}</Td>
                        <Td align="right">{num(r.skipped)}</Td>
                        <Td align="right">{num(r.duplicates)}</Td>
                        <Td nowrap>{whenText(r.started_at)}</Td>
                        <Td>{r.error_reason ? <span className="text-red-300 line-clamp-2 break-words">{r.error_reason}</span> : <span className="text-gray-400">None</span>}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Pager paged={runPaged} label="runs" />
              </>
            )}
          </Panel>
        </TabPanel>
      )}

      {tab === 'integrations' && (
        <TabPanel label="Integrations">
          <Panel>
            <PanelHeader icon={Plug} title="Integration events" subtitle="AI and email calls behind the numbers. Click an event for its full error text."
              actions={<ExportButtons rows={events} columns={EVENT_EXPORT_COLUMNS} title="Integration Events" disabled={!!state.eventsError} />} />
            {loadingFirst ? (
              <LoadingState label="Reading integration events" rows={6} />
            ) : state.eventsError ? (
              <ErrorState message={state.eventsError} onRetry={load} />
            ) : events.length === 0 ? (
              <EmptyState
                icon={Plug}
                title="No integration events"
                reason={search || outcome !== 'all' ? 'No event matches the search and outcome filter.' : 'No AI or email event has been recorded for this scope yet.'}
                action={search || outcome !== 'all' ? <Btn onClick={() => { setSearch(''); setOutcome('all') }}>Clear filters</Btn> : undefined}
              />
            ) : (
              <>
                <Table>
                  <THead>
                    <Th sortKey="integration" sort={evtSort} onSort={onEvtSort}>Integration</Th>
                    <Th sortKey="event_type" sort={evtSort} onSort={onEvtSort}>Event type</Th>
                    <Th sortKey="status" sort={evtSort} onSort={onEvtSort}>Status</Th>
                    <Th align="right" sortKey="http_status" sort={evtSort} onSort={onEvtSort}>HTTP</Th>
                    <Th align="right" sortKey="latency_ms" sort={evtSort} onSort={onEvtSort}>Latency ms</Th>
                    <Th>Error</Th>
                    <Th sortKey="occurred_at" sort={evtSort} onSort={onEvtSort}>When</Th>
                  </THead>
                  <tbody>
                    {evtPaged.rows.map((e, i) => (
                      <Tr key={`${e.integration || 'evt'}:${e.occurred_at || i}:${i}`} tone={isFail(e.status) ? 'warning' : undefined}
                        onClick={() => setDetail({ kind: 'event', row: e })} ariaLabel={`Event ${e.event_type || ''} ${e.status || ''}`.trim()}>
                        <Td><Badge tone={e.integration === 'email' ? 'info' : 'accent'}>{e.integration || 'N/A'}</Badge></Td>
                        <Td><span className="text-gray-200">{e.event_type || 'N/A'}</span></Td>
                        <Td><Badge tone={statusTone(e.status)}>{e.status || 'N/A'}</Badge></Td>
                        <Td align="right">{num(e.http_status)}</Td>
                        <Td align="right">{num(e.latency_ms)}</Td>
                        <Td>{e.error_reason ? <span className="text-red-300 line-clamp-2 break-words">{e.error_reason}</span> : <span className="text-gray-400">None</span>}</Td>
                        <Td nowrap>{whenText(e.occurred_at)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Pager paged={evtPaged} label="events" />
              </>
            )}
          </Panel>
        </TabPanel>
      )}

      {tab === 'trends' && (
        <TabPanel label="Trends">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader icon={Activity} title="Pipeline runs per day" subtitle="Last 14 days, from the loaded run history." />
              {state.runsError ? <ErrorState message={state.runsError} onRetry={load} /> : (
                <TrendChart labels={runTrend.labels}
                  series={[{ label: 'Succeeded or other', values: runTrend.ok }, { label: 'Failed', values: runTrend.bad }]}
                  summary={`${runTrend.total} runs in 14 days`} emptyText="No run in the last 14 days." />
              )}
            </Panel>
            <Panel>
              <PanelHeader icon={Plug} title="Integration calls per day" subtitle="Last 14 days, from the loaded events." />
              {state.eventsError ? <ErrorState message={state.eventsError} onRetry={load} /> : (
                <TrendChart labels={eventTrend.labels}
                  series={[{ label: 'All calls', values: eventTrend.all }, { label: 'Failed', values: eventTrend.bad }]}
                  summary={`${eventTrend.total} integration calls in 14 days`} emptyText="No integration call in the last 14 days." />
              )}
            </Panel>
          </div>
          <Panel>
            <PanelHeader icon={AlertTriangle} title="Jobs that fail most" subtitle="Failed runs per job in the loaded history." />
            {state.runsError ? <ErrorState message={state.runsError} onRetry={load} /> : (
              <BarsChart bars={failingJobs} valueFormat={(v) => nf.format(v)}
                summary={failingJobs.map((b) => `${b.label} ${b.value}`).join(', ')} emptyText="No job has failed in the loaded history." />
            )}
            {failingJobs.length > 0 && (
              <div className="mt-2"><Btn size="xs" onClick={() => { setRunSort({ key: 'started_at', dir: 'desc' }); showFailures('jobs') }}>Open the failed runs</Btn></div>
            )}
          </Panel>
        </TabPanel>
      )}

      <Note icon={Clock}>
        This is the recorded run history for the selected country. A blank rows or timing column means the source did
        not carry that figure, not that the value was zero.
      </Note>

      <Modal open={!!detail} onClose={() => setDetail(null)} width="max-w-lg"
        title={detail ? (detail.kind === 'run' ? `Run: ${detail.row.job_key || 'Unnamed job'}` : `Event: ${detail.row.event_type || 'Unnamed event'}`) : ''}
        subtitle={detail ? whenText(detail.kind === 'run' ? detail.row.started_at : detail.row.occurred_at) : ''}
        footer={<Btn onClick={() => setDetail(null)}>Close</Btn>}>
        {detail && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-2">
              <Badge tone={statusTone(detail.row.status)}>{detail.row.status || 'No status'}</Badge>
              <Badge>{detail.kind === 'run' ? (detail.row.source || 'run') : (detail.row.integration || 'integration')}</Badge>
            </div>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-gray-400">
              {(detail.kind === 'run'
                ? [['Trigger', detail.row.trigger], ['Rows in', num(detail.row.rows_in)], ['Rows out', num(detail.row.rows_out)], ['Skipped', num(detail.row.skipped)], ['Duplicates', num(detail.row.duplicates)], ['Started', whenText(detail.row.started_at)], ['Finished', whenText(detail.row.finished_at)]]
                : [['HTTP status', num(detail.row.http_status)], ['Latency', detail.row.latency_ms == null ? 'N/A' : `${num(detail.row.latency_ms)} ms`], ['When', whenText(detail.row.occurred_at)]]
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-gray-500">{k}</dt><dd className="col-span-2 break-words">{v || 'N/A'}</dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Error</p>
              {detail.row.error_reason
                ? <p className="text-red-300 whitespace-pre-wrap break-words">{detail.row.error_reason}</p>
                : <p className="text-gray-400">None recorded.</p>}
            </div>
            {detail.kind === 'run' && (
              <p>See the import itself in <ConsoleLink plain to="/console/import-history">Import History</ConsoleLink>.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
