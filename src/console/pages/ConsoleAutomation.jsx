/**
 * ConsoleAutomation - super-admin "Automation Health" console page.
 *
 * A pure console page (useConsoleAuth for the admin gate). One operating
 * picture for everything that runs on a schedule:
 *   1. Scheduled reports (report_schedules): cadence, active, next run, last
 *      sent, last status/error, with PAUSED / OVERDUE / FAILING badges.
 *   2. pg_cron jobs (console_cron_jobs RPC, V274): job name, schedule, active,
 *      and its most recent run status + time.
 *   3. Edge functions: an HONEST static checklist of the deployed functions that
 *      power automation, with a note to verify the running version in the
 *      Supabase dashboard (versions are NOT fabricated here).
 *
 * Read-only. Refresh re-pulls both reads. Super-admin only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Timer, RefreshCw, ShieldAlert, PauseCircle, Clock, CheckCircle2, XCircle,
  Zap, Mail, Bell, Info, CalendarClock, BarChart3,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listSchedules, listCronJobs, summarizeSchedules, summarizeCron, scheduleFlags,
} from '../../lib/api/automationHealth'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Code, Segmented, SearchInput, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { ShareChart, BarsChart, STATUS, useChartTheme } from '../components/ui/charts'

// ── Small helpers ───────────────────────────────────────────────────────────

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString()
}

function fmtRelative(v, now = Date.now()) {
  if (!v) return 'N/A'
  const t = new Date(v).getTime()
  if (Number.isNaN(t)) return 'N/A'
  const diff = now - t
  const past = diff >= 0
  const mins = Math.floor(Math.abs(diff) / 60000)
  if (mins < 1) return 'just now'
  const shape = (n, unit) => (past ? `${n} ${unit} ago` : `in ${n} ${unit}`)
  if (mins < 60) return shape(mins, 'min')
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return shape(hrs, 'h')
  const days = Math.floor(hrs / 24)
  return shape(days, 'd')
}

// cron run tone (automationHealth.cronRunTone) -> kit badge tone + label.
const RUN_TONE = { green: 'good', amber: 'warning', red: 'danger', gray: 'quiet' }
const RUN_BUCKET = { green: 'Succeeded', amber: 'Running', red: 'Failed', gray: 'No runs yet' }

/** One exclusive state per schedule, worst first, so the share chart adds up. */
function scheduleState(f) {
  if (f.failing) return 'failing'
  if (f.overdue) return 'overdue'
  if (f.paused) return 'paused'
  return 'healthy'
}
const STATE_META = {
  healthy: { label: 'Healthy', tone: 'good' },
  paused: { label: 'Paused', tone: 'quiet' },
  overdue: { label: 'Overdue', tone: 'warning' },
  failing: { label: 'Failing', tone: 'danger' },
}

// Deployed edge functions that power automation. Honest static list: purpose is
// described; the RUNNING version must be confirmed in the Supabase dashboard.
const EDGE_FUNCTIONS = [
  { name: 'send-scheduled-reports', purpose: 'Renders and emails scheduled + builder reports (cron + on-demand Send Now).' },
  { name: 'workflow-notify', purpose: 'Delivers queued workflow / approval push notifications to devices via Expo.' },
  { name: 'chat-ai', purpose: 'Backs the in-app AI copilot; logs token usage and failures.' },
  { name: 'ai-orchestrator', purpose: 'Runs multi-step AI jobs; logs job runs and failures.' },
]

// ── Page ────────────────────────────────────────────────────────────────────

export default function ConsoleAutomation() {
  const { admin } = useConsoleAuth()
  const theme = useChartTheme()
  const [schedules, setSchedules] = useState([])
  const [cron, setCron] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [cronError, setCronError] = useState(null)
  // The reference time is fixed at each load, so "overdue" is judged against
  // the moment the data was read and the memos below stay stable between renders.
  const [now, setNow] = useState(() => Date.now())
  const [stateFilter, setStateFilter] = useState('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    setCronError(null)
    const [sRes, cRes] = await Promise.allSettled([listSchedules(), listCronJobs()])
    if (sRes.status === 'fulfilled') setSchedules(sRes.value)
    else setError(toUserMessage(sRes.reason))
    if (cRes.status === 'fulfilled') setCron(cRes.value)
    // listCronJobs already maps "pg_cron absent / not deployed / not authorised"
    // to []. Anything it still throws is a real failure and is now stated rather
    // than shown as an empty job list.
    else setCronError(toUserMessage(cRes.reason, 'Could not read the background jobs.'))
    setNow(Date.now())
    setRefreshing(false)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const schedSummary = useMemo(() => summarizeSchedules(schedules, now), [schedules, now])
  const cronSummary = useMemo(() => summarizeCron(cron), [cron])

  const scheduleRows = useMemo(
    () => schedules.map((r) => {
      const flags = scheduleFlags(r, now)
      return { row: r, flags, state: scheduleState(flags) }
    }),
    [schedules, now],
  )

  const stateCounts = useMemo(() => {
    const c = { healthy: 0, paused: 0, overdue: 0, failing: 0 }
    for (const s of scheduleRows) c[s.state] += 1
    return c
  }, [scheduleRows])

  const visibleSchedules = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scheduleRows.filter((s) => {
      if (stateFilter !== 'all' && s.state !== stateFilter) return false
      if (!q) return true
      return [s.row.name, s.row.report_type, s.row.frequency].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [scheduleRows, stateFilter, search])

  const colors = STATUS[theme]
  const scheduleShare = useMemo(() => ([
    { label: 'Healthy', value: stateCounts.healthy, color: colors.good },
    { label: 'Overdue', value: stateCounts.overdue, color: colors.medium },
    { label: 'Failing', value: stateCounts.failing, color: colors.critical },
    { label: 'Paused', value: stateCounts.paused, color: colors.low },
  ].filter((p) => p.value > 0)), [stateCounts, colors])

  const runBars = useMemo(() => {
    const c = { green: 0, red: 0, amber: 0, gray: 0 }
    for (const j of cronSummary.jobs) c[j.tone] = (c[j.tone] || 0) + 1
    return [
      { label: RUN_BUCKET.green, value: c.green, color: colors.good },
      { label: RUN_BUCKET.red, value: c.red, color: colors.critical },
      { label: RUN_BUCKET.amber, value: c.amber, color: colors.medium },
      { label: RUN_BUCKET.gray, value: c.gray, color: colors.low },
    ]
  }, [cronSummary, colors])

  if (!admin) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <Panel tone="danger">
          <EmptyState icon={ShieldAlert} title="Restricted" reason="Automation Health is reserved for system administrators." />
        </Panel>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2">
            <Timer size={18} className="text-orange-400" /> Automation Health
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Scheduled reports, background jobs and the functions that run them.
            {!loading && <span> | read {fmtRelative(now, Date.now())}</span>}
          </p>
        </div>
        <Btn icon={RefreshCw} onClick={load} busy={refreshing}>Refresh</Btn>
      </header>

      <ErrorState message={error} onRetry={load} />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Active schedules" value={loading ? 'N/A' : schedSummary.active} tone="good" icon={CalendarClock}
          sub={loading ? undefined : `of ${schedSummary.total}`} />
        <StatTile label="Paused" value={loading ? 'N/A' : schedSummary.paused} tone="muted" icon={PauseCircle} />
        <div title="Active, but the next run time is already in the past. The cron loop may not have fired yet.">
          <StatTile label="Overdue" value={loading ? 'N/A' : schedSummary.overdue}
            tone={schedSummary.overdue > 0 ? 'warning' : 'default'} icon={Clock} />
        </div>
        <div title="The last run ended in error or recorded an error message.">
          <StatTile label="Failing" value={loading ? 'N/A' : schedSummary.failing}
            tone={schedSummary.failing > 0 ? 'danger' : 'default'} icon={XCircle} />
        </div>
        <StatTile label="Background jobs" value={loading || cronError ? 'N/A' : cronSummary.total} icon={Zap}
          sub={loading || cronError ? undefined : `${cronSummary.active} active`} />
        <StatTile label="Jobs failing" value={loading || cronError ? 'N/A' : cronSummary.failing}
          tone={cronSummary.failing > 0 ? 'danger' : 'default'} icon={XCircle} sub="Last run failed" />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader icon={Mail} title="Schedule health"
            subtitle="Each schedule counted once, by its worst state: failing, then overdue, then paused." />
          {loading ? <LoadingState label="Loading schedules" rows={2} /> : (
            <ShareChart
              parts={scheduleShare}
              center={{ value: schedSummary.total, label: 'schedules' }}
              summary={scheduleShare.map((p) => `${p.label} ${p.value}`).join(', ')}
              emptyText="No scheduled reports yet."
            />
          )}
        </Panel>
        <Panel>
          <PanelHeader icon={BarChart3} title="Background job outcomes"
            subtitle="The most recent run of each pg_cron job. Run history beyond the last run is not read here." />
          {loading ? <LoadingState label="Loading jobs" rows={2} /> : cronError ? (
            <EmptyState icon={XCircle} title="Jobs could not be read" reason={cronError} />
          ) : (
            <BarsChart
              bars={runBars}
              summary={runBars.map((b) => `${b.label} ${b.value}`).join(', ')}
              emptyText="No background jobs are visible."
            />
          )}
        </Panel>
      </div>

      {/* ── Scheduled reports table ── */}
      <Panel>
        <PanelHeader
          icon={Mail}
          title="Scheduled reports"
          subtitle="Reports that email themselves on a cadence (report_schedules)."
        />
        <Toolbar className="mb-3">
          <Segmented
            value={stateFilter}
            onChange={setStateFilter}
            options={[
              { key: 'all', label: 'All', count: scheduleRows.length },
              { key: 'failing', label: 'Failing', count: stateCounts.failing },
              { key: 'overdue', label: 'Overdue', count: stateCounts.overdue },
              { key: 'paused', label: 'Paused', count: stateCounts.paused },
              { key: 'healthy', label: 'Healthy', count: stateCounts.healthy },
            ]}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, type or frequency" className="w-64" />
        </Toolbar>
        {loading ? (
          <LoadingState label="Loading schedules" />
        ) : schedules.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No scheduled reports"
            reason="Create one from Scheduled Reports. If you expected some, the report_schedules table may not be readable yet." />
        ) : visibleSchedules.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No schedules match" reason="Nothing matches this state and search. Clear the filters to see every schedule." />
        ) : (
          <Table>
            <THead>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Frequency</Th>
              <Th>Next run</Th>
              <Th>Last sent</Th>
              <Th>State</Th>
            </THead>
            <tbody>
              {visibleSchedules.map(({ row: r, flags: f }) => (
                <Tr key={r.id} tone={f.failing ? 'warning' : undefined}>
                  <Td className="max-w-[260px]">
                    <span className="line-clamp-2 text-gray-200 font-medium" title={r.name || ''}>{r.name || 'Unnamed schedule'}</span>
                    {f.failing && r.last_error && (
                      <span className="block text-[10px] text-red-400/80 mt-0.5 line-clamp-2" title={r.last_error}>
                        {r.last_error}
                      </span>
                    )}
                  </Td>
                  <Td nowrap><span className="text-gray-400">{r.report_type || 'N/A'}</span></Td>
                  <Td nowrap><span className="text-gray-400 capitalize">{r.frequency || 'N/A'}</span></Td>
                  <Td nowrap><span className="text-gray-400" title={fmtDateTime(r.next_run_at)}>{r.active ? fmtRelative(r.next_run_at, now) : 'Paused'}</span></Td>
                  <Td nowrap><span className="text-gray-500" title={fmtDateTime(r.last_sent_at)}>{fmtRelative(r.last_sent_at, now)}</span></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {f.paused && <Badge tone={STATE_META.paused.tone} icon={PauseCircle}>Paused</Badge>}
                      {f.overdue && <Badge tone={STATE_META.overdue.tone} icon={Clock}>Overdue</Badge>}
                      {f.failing && <Badge tone={STATE_META.failing.tone} icon={XCircle}>Failing</Badge>}
                      {!f.paused && !f.overdue && !f.failing && <Badge tone={STATE_META.healthy.tone} icon={CheckCircle2}>Healthy</Badge>}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {/* ── pg_cron jobs table ── */}
      <Panel>
        <PanelHeader
          icon={Clock}
          title="Background jobs"
          subtitle="pg_cron jobs that run inside the database on a schedule (cron loop, backups, notification delivery)."
          actions={!cronError && (
            <span className="text-[11px] text-gray-500 tabular-nums">
              {cronSummary.total} jobs | {cronSummary.active} active | {cronSummary.failing} failing
            </span>
          )}
        />
        {loading ? (
          <LoadingState label="Loading jobs" />
        ) : cronError ? (
          <ErrorState message={cronError} onRetry={load} />
        ) : cron.length === 0 ? (
          <EmptyState icon={Clock} title="No background jobs are visible"
            reason="pg_cron may not be installed, or the console_cron_jobs function (V274) is not deployed yet." />
        ) : (
          <Table>
            <THead>
              <Th>Job</Th>
              <Th>Schedule</Th>
              <Th>Active</Th>
              <Th>Last run</Th>
              <Th>When</Th>
            </THead>
            <tbody>
              {cronSummary.jobs.map((j) => (
                <Tr key={j.jobid ?? j.jobname} tone={j.tone === 'red' ? 'warning' : undefined}>
                  <Td><span className="text-gray-200 font-medium truncate max-w-[260px] inline-block align-bottom" title={j.jobname}>{j.jobname}</span></Td>
                  <Td nowrap>{j.schedule ? <Code>{j.schedule}</Code> : <span className="text-gray-500">N/A</span>}</Td>
                  <Td>{j.active ? <Badge tone="good">Yes</Badge> : <Badge tone="quiet">No</Badge>}</Td>
                  <Td nowrap>
                    <Badge tone={RUN_TONE[j.tone] || 'quiet'}>
                      <span className="capitalize">{j.lastStatus || 'No runs yet'}</span>
                    </Badge>
                  </Td>
                  <Td nowrap><span className="text-gray-500" title={fmtDateTime(j.lastEnd)}>{fmtRelative(j.lastEnd, now)}</span></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {/* ── Edge functions checklist ── */}
      <Panel>
        <PanelHeader
          icon={Zap}
          title="Edge functions"
          subtitle="Server functions that carry out automation. A fixed checklist of what should be deployed."
        />
        <Note icon={Info} tone="accent">
          Verify each function's current version and last deploy time in the Supabase dashboard
          (Edge Functions). Versions are not shown here to avoid reporting a stale number.
        </Note>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {EDGE_FUNCTIONS.map((fn) => (
            <li key={fn.name} className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
              <Zap size={14} className="text-gray-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <Code>{fn.name}</Code>
                <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{fn.purpose}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <p className="text-[11px] text-gray-600 flex items-center gap-1.5">
        <Bell size={12} /> This board reads live from the database each time you refresh. It never triggers a report or a job.
      </p>
    </div>
  )
}
