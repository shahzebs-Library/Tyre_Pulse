/**
 * ConsolePipelineMonitor.jsx - the operational trace of every load.
 *
 * Two questions a data team asks when a number looks wrong:
 *   1. Did the pipeline that feeds it actually run, and did it run clean?
 *   2. Did the integrations behind it (AI, email) succeed or quietly fail?
 *
 * The Jobs tab answers the first from get_pipeline_runs (imports + reports);
 * the Integrations tab answers the second from get_integration_events. Nothing
 * here is computed - it is the honest run history, with rows/timing/errors
 * shown as recorded and N/A where the source carried nothing.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, Plug, RefreshCw, AlertTriangle, CheckCircle2, Clock,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, SearchInput,
  Table, THead, Th, Tr, Td, Toolbar, Segmented,
  LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { sortRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { getPipelineRuns, getIntegrationEvents } from '../../lib/api/dataTrustOps'
import { pipelineSummary } from '../../lib/dataTrustOps'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'

const nf = new Intl.NumberFormat('en-US')
const num = (v) => (v === null || v === undefined || v === '' ? 'N/A' : nf.format(Number(v)))

function when(ts) {
  if (!ts) return 'N/A'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 19).replace('T', ' ')
  return d.toLocaleString()
}

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

export default function ConsolePipelineMonitor() {
  const [country, setCountry] = useState('All')
  const [tab, setTab] = useState('jobs')
  const [search, setSearch] = useState('')
  const [state, setState] = useState({ loading: true, error: null, runs: [], events: [] })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const [runs, events] = await Promise.all([
        getPipelineRuns({ country, limit: 200 }),
        getIntegrationEvents({ country, limit: 200 }),
      ])
      setState({ loading: false, error: null, runs, events })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), runs: [], events: [] })
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => pipelineSummary(state.runs), [state.runs])

  const { sort: runSort, onSort: onRunSort } = useTableSort(null)
  const { sort: evtSort, onSort: onEvtSort } = useTableSort(null)
  const runs = useMemo(() => {
    const q = search.trim().toLowerCase()
    const found = !q ? state.runs : state.runs.filter((r) =>
      String(r.job_key || '').toLowerCase().includes(q)
      || String(r.status || '').toLowerCase().includes(q)
      || String(r.trigger || '').toLowerCase().includes(q))
    return sortRows(found, runSort)
  }, [state.runs, search, runSort])

  const events = useMemo(() => {
    const q = search.trim().toLowerCase()
    const found = !q ? state.events : state.events.filter((e) =>
      String(e.event_type || '').toLowerCase().includes(q)
      || String(e.integration || '').toLowerCase().includes(q)
      || String(e.status || '').toLowerCase().includes(q))
    return sortRows(found, evtSort)
  }, [state.events, search, evtSort])

  const tabs = [
    { key: 'jobs', label: 'Jobs', count: state.runs.length },
    { key: 'integrations', label: 'Integrations', count: state.events.length },
  ]

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          icon={Activity}
          title="Pipeline & Integration Monitor"
          subtitle="Every import, report and integration run: status, rows, timing and errors."
          actions={(
            <Toolbar>
              <Select ariaLabel="Country" value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-40" />
              <Btn icon={RefreshCw} onClick={load} busy={state.loading}>Refresh</Btn>
            </Toolbar>
          )}
        />

        <div className="px-4 pb-3 flex flex-wrap items-center gap-3 justify-between">
          <Segmented options={tabs} value={tab} onChange={setTab} ariaLabel="Monitor view" />
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={tab === 'jobs' ? 'Search job or status' : 'Search event or status'}
            className="w-full sm:w-56"
          />
        </div>

        {tab === 'jobs' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-4 pb-4">
            <StatTile label="Runs" value={state.error ? 'N/A' : nf.format(summary.total)} icon={Activity} />
            <StatTile label="OK" value={state.error ? 'N/A' : nf.format(summary.ok)} tone="good" icon={CheckCircle2} />
            <StatTile label="Failed" value={state.error ? 'N/A' : nf.format(summary.failed)} tone={summary.failed ? 'danger' : 'default'} icon={AlertTriangle} />
            <StatTile label="Other" value={state.error ? 'N/A' : nf.format(summary.other)} tone="muted" icon={Clock} />
          </div>
        )}
      </Panel>

      {state.error && (
        <Panel><ErrorState message={state.error} onRetry={load} /></Panel>
      )}

      {state.loading ? (
        <Panel><LoadingState label="Reading run history" rows={6} /></Panel>
      ) : state.error ? null : tab === 'jobs' ? (
        <Panel>
          <PanelHeader icon={Activity} title="Pipeline runs" subtitle="Imports and report generation, newest first."
            actions={<ExportButtons rows={runs} columns={RUN_EXPORT_COLUMNS} title="Pipeline Runs" />} />
          {runs.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No runs to show"
              reason={search ? 'No run matches your search.' : 'No import or report run has been recorded for this scope yet.'}
            />
          ) : (
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
                {runs.map((r, i) => (
                  <Tr key={`${r.job_key || 'job'}:${r.started_at || i}:${i}`} tone={isFail(r.status) ? 'warning' : undefined}>
                    <Td><Badge tone={r.source === 'report' ? 'info' : 'accent'}>{r.source || 'run'}</Badge></Td>
                    <Td><span className="text-gray-200">{r.job_key || 'N/A'}</span></Td>
                    <Td>{r.trigger || 'N/A'}</Td>
                    <Td><Badge tone={statusTone(r.status)}>{r.status || 'N/A'}</Badge></Td>
                    <Td align="right">{num(r.rows_in)}</Td>
                    <Td align="right">{num(r.rows_out)}</Td>
                    <Td align="right">{num(r.skipped)}</Td>
                    <Td align="right">{num(r.duplicates)}</Td>
                    <Td nowrap>{when(r.started_at)}</Td>
                    <Td>{r.error_reason ? <span className="text-red-300 break-words">{r.error_reason}</span> : <span className="text-gray-400">None</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      ) : (
        <Panel>
          <PanelHeader icon={Plug} title="Integration events" subtitle="AI and email calls behind the numbers, newest first."
            actions={<ExportButtons rows={events} columns={EVENT_EXPORT_COLUMNS} title="Integration Events" />} />
          {events.length === 0 ? (
            <EmptyState
              icon={Plug}
              title="No integration events"
              reason={search ? 'No event matches your search.' : 'No AI or email event has been recorded for this scope yet.'}
            />
          ) : (
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
                {events.map((e, i) => (
                  <Tr key={`${e.integration || 'evt'}:${e.occurred_at || i}:${i}`} tone={isFail(e.status) ? 'warning' : undefined}>
                    <Td><Badge tone={e.integration === 'email' ? 'info' : 'accent'}>{e.integration || 'N/A'}</Badge></Td>
                    <Td><span className="text-gray-200">{e.event_type || 'N/A'}</span></Td>
                    <Td><Badge tone={statusTone(e.status)}>{e.status || 'N/A'}</Badge></Td>
                    <Td align="right">{num(e.http_status)}</Td>
                    <Td align="right">{num(e.latency_ms)}</Td>
                    <Td>{e.error_reason ? <span className="text-red-300 break-words">{e.error_reason}</span> : <span className="text-gray-400">None</span>}</Td>
                    <Td nowrap>{when(e.occurred_at)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      <Note icon={Clock}>
        This is the recorded run history for the selected country. A blank rows or timing column means the source did
        not carry that figure, not that the value was zero.
      </Note>
    </div>
  )
}
