/**
 * ConsoleAutomation - super-admin "Automation Health" console page.
 *
 * One operating picture for everything that runs on a schedule, split into
 * tabs so the page is never a long wall (the active tab lives in ?tab=):
 *   Overview   - what needs attention (failing / overdue schedules, failing
 *                jobs), the schedule-health share, job outcomes and the runs
 *                due in the next 7 days.
 *   Schedules  - report_schedules: cadence, next run, last sent, state, with
 *                PAUSED / OVERDUE / FAILING badges. Sortable, searchable, paged,
 *                exportable; a row opens its detail in a side drawer.
 *   Jobs       - pg_cron jobs (console_cron_jobs RPC, V274) and their most
 *                recent run. Sortable, searchable, paged, exportable.
 *   Functions  - an HONEST static checklist of the edge functions that power
 *                automation (versions are not fabricated here).
 *
 * Controls (super admin, each states what it changes before it runs):
 *   - pause / resume a scheduled report (report_schedules.active, RLS allows a
 *     super admin) and "Send now" through the send-scheduled-reports function;
 *     both need a reason and are written to the console audit log;
 *   - pause / resume / run now a background job and read its recent runs,
 *     through the existing super-admin RPCs admin_cron_set_active,
 *     admin_cron_run_now and admin_cron_job_runs (they audit server side).
 * Pausing a job is red and needs the job name typed. Refresh re-pulls both reads.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Timer, ShieldAlert, PauseCircle, Clock, CheckCircle2, XCircle,
  Zap, Mail, Bell, Info, CalendarClock, BarChart3, ExternalLink, Play, Pause, Send, History, AlertTriangle,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listSchedules, listCronJobs, summarizeSchedules, summarizeCron, scheduleFlags,
  setScheduleActive, sendScheduleNow, schedulePauseImpact,
} from '../../lib/api/automationHealth'
import { getCronJobRuns, setCronJobActive, runCronJobNow } from '../../lib/api/engineeringCenter'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Code, Segmented, SearchInput, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, ConfirmImpactDialog,
} from '../components/ui'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { ShareChart, BarsChart, STATUS, useChartTheme } from '../components/ui/charts'
import {
  PageHeader, fmtDateTime, fmtRelative, TabBar, useUrlTab, usePaged, Pager, SideDrawer, Field, AttentionList,
} from './shared/pageKit'

const STATE_RANK = { failing: 0, overdue: 1, paused: 2, healthy: 3 }
const SCHEDULE_EXPORT_COLUMNS = [
  { key: 'name', header: 'Name', value: (s) => s.row.name },
  { key: 'type', header: 'Type', value: (s) => s.row.report_type },
  { key: 'frequency', header: 'Frequency', value: (s) => s.row.frequency },
  { key: 'next', header: 'Next run', value: (s) => (s.row.active ? s.row.next_run_at : 'Paused') },
  { key: 'last', header: 'Last sent', value: (s) => s.row.last_sent_at },
  { key: 'state', header: 'State', value: (s) => s.state },
  { key: 'error', header: 'Last error', value: (s) => s.row.last_error },
]
const JOB_EXPORT_COLUMNS = [
  { key: 'jobname', header: 'Job' },
  { key: 'schedule', header: 'Schedule' },
  { key: 'active', header: 'Active', value: (j) => (j.active ? 'Yes' : 'No') },
  { key: 'lastStatus', header: 'Last run', value: (j) => j.lastStatus || 'No runs yet' },
  { key: 'lastEnd', header: 'When' },
]

const RUN_TONE = { green: 'good', amber: 'warning', red: 'danger', gray: 'quiet' }
const RUN_BUCKET = { green: 'Succeeded', amber: 'Running', red: 'Failed', gray: 'No runs yet' }
const RUN_RANK = { red: 0, amber: 1, gray: 2, green: 3 }

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
  { name: 'workflow-notify', purpose: 'Delivers queued workflow and approval push notifications: Flutter app devices through Firebase Cloud Messaging (FCM); the retired Expo app (read only) still gets Expo pushes until uninstalled.' },
  { name: 'sentry-crash-alert', purpose: 'Checks Sentry every 15 minutes and raises a console alert for each new fatal crash.' },
  { name: 'chat-ai', purpose: 'Backs the in-app AI copilot; logs token usage and failures.' },
  { name: 'ai-orchestrator', purpose: 'Runs multi-step AI jobs; logs job runs and failures.' },
]

const TABS = ['overview', 'schedules', 'jobs', 'functions']
const WEEK_MS = 7 * 86_400_000

function recipientCount(r) {
  const v = r?.recipients
  if (Array.isArray(v)) return v.length
  if (typeof v === 'string' && v.trim()) return v.split(/[,;\s]+/).filter(Boolean).length
  return 0
}

function StateBadges({ f }) {
  return (
    <div className="flex flex-wrap gap-1">
      {f.paused && <Badge tone={STATE_META.paused.tone} icon={PauseCircle}>Paused</Badge>}
      {f.overdue && <Badge tone={STATE_META.overdue.tone} icon={Clock}>Overdue</Badge>}
      {f.failing && <Badge tone={STATE_META.failing.tone} icon={XCircle}>Failing</Badge>}
      {!f.paused && !f.overdue && !f.failing && <Badge tone={STATE_META.healthy.tone} icon={CheckCircle2}>Healthy</Badge>}
    </div>
  )
}

function cronTone(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'succeeded' || s === 'success') return 'green'
  if (s === 'running' || s === 'starting') return 'amber'
  if (s === 'failed' || s === 'error') return 'red'
  return 'gray'
}

function actionTitle(a) {
  if (!a) return ''
  const name = a.s?.row?.name || a.j?.jobname || ''
  return {
    'pause-schedule': `Pause ${name || 'this schedule'}?`,
    'resume-schedule': `Resume ${name || 'this schedule'}?`,
    send: `Send ${name || 'this report'} now?`,
    'run-job': `Run ${name || 'this job'} now?`,
    'pause-job': `Pause ${name || 'this job'}?`,
    'resume-job': `Resume ${name || 'this job'}?`,
  }[a.kind] || 'Confirm'
}

function actionConfirm(a) {
  return {
    'pause-schedule': 'Pause schedule', 'resume-schedule': 'Resume schedule', send: 'Send now',
    'run-job': 'Run now', 'pause-job': 'Pause job', 'resume-job': 'Resume job',
  }[a?.kind] || 'Confirm'
}

function actionImpact(a) {
  if (!a) return null
  if (a.kind === 'pause-schedule' || a.kind === 'resume-schedule') {
    const imp = schedulePauseImpact(a.s.row, recipientCount(a.s.row))
    return { what: actionTitle(a), tone: a.kind === 'pause-schedule' ? 'warning' : 'info', ...imp }
  }
  if (a.kind === 'send') {
    const n = recipientCount(a.s.row)
    return {
      what: 'Email this report once, right now.', tone: 'info',
      change: 'The report is built from current data and emailed. Its regular next run is not moved.',
      who: n ? `${n} recipient${n === 1 ? '' : 's'} on this schedule get an extra email.` : 'No recipients are recorded, so nothing may be delivered.',
      undo: 'No. A sent email cannot be recalled.',
    }
  }
  if (a.kind === 'run-job') {
    return {
      what: 'Run this background job once, within the next minute.', tone: 'warning',
      change: 'The job runs one extra time with its normal command. Its schedule does not change.',
      who: 'Whatever this job touches (reports, backups, notifications, data clean-up) runs early for everyone.',
      undo: 'No. The run cannot be cancelled once it starts.',
    }
  }
  const pausing = a.kind === 'pause-job'
  return {
    what: pausing ? 'Stop this background job running on its schedule.' : 'Start this background job running on its schedule again.',
    tone: pausing ? 'danger' : 'info',
    change: pausing ? 'The job stops running until someone resumes it. Work it does (backups, alerts, deliveries) stops too.' : 'The job runs again at its next scheduled time.',
    who: 'Everyone who depends on what this job produces, across every organisation.',
    undo: pausing ? 'Yes. Resume it here. Runs missed while paused are not made up.' : 'Yes. Pause it again here.',
  }
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ConsoleAutomation({ tabParam = 'tab' } = {}) {
  const { admin, logAction } = useConsoleAuth()
  // { kind: 'pause-schedule'|'resume-schedule'|'send'|'pause-job'|'resume-job'|'run-job', s?, j? }
  const [action, setAction] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [flash, setFlash] = useState(null)
  const [jobRuns, setJobRuns] = useState({ loading: false, error: '', list: [] })
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
  const [tab, setTab] = useUrlTab(TABS, 'overview', tabParam)
  const [stateFilter, setStateFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [jobFilter, setJobFilter] = useState('all')
  const [jobSearch, setJobSearch] = useState('')
  const [openSchedule, setOpenSchedule] = useState(null)
  const [openJob, setOpenJob] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    setCronError(null)
    const [sRes, cRes] = await Promise.allSettled([listSchedules(), listCronJobs()])
    if (sRes.status === 'fulfilled') setSchedules(sRes.value)
    else { setSchedules([]); setError(toUserMessage(sRes.reason, 'Could not read the scheduled reports.')) }
    if (cRes.status === 'fulfilled') setCron(cRes.value)
    // listCronJobs maps only "pg_cron / RPC not deployed" to []. A permission
    // denial or network failure throws and is stated here rather than shown as
    // an empty job list.
    else { setCron([]); setCronError(toUserMessage(cRes.reason, 'Could not read the background jobs.')) }
    setNow(Date.now())
    setRefreshing(false)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Recent runs for the job open in the drawer (admin_cron_job_runs, last 8).
  useEffect(() => {
    if (!openJob?.jobid && openJob?.jobid !== 0) { setJobRuns({ loading: false, error: '', list: [] }); return undefined }
    let live = true
    setJobRuns({ loading: true, error: '', list: [] })
    getCronJobRuns(openJob.jobid, 8)
      .then((list) => { if (live) setJobRuns({ loading: false, error: '', list }) })
      .catch((e) => { if (live) setJobRuns({ loading: false, error: toUserMessage(e, 'Recent runs could not be read.'), list: [] }) })
    return () => { live = false }
  }, [openJob])

  async function runAction({ reason }) {
    const a = action
    if (!a) return
    setActionBusy(true); setActionError('')
    try {
      if (a.kind === 'pause-schedule' || a.kind === 'resume-schedule') {
        const next = a.kind === 'resume-schedule'
        await setScheduleActive(a.s.row.id, next)
        await logAction?.(next ? 'schedule_resume' : 'schedule_pause', a.s.row.id, 'report_schedule', { name: a.s.row.name, reason })
        setFlash({ tone: 'ok', text: `${a.s.row.name || 'The schedule'} is ${next ? 'running again' : 'paused'}.` })
      } else if (a.kind === 'send') {
        const r = await sendScheduleNow(a.s.row.id)
        await logAction?.('schedule_send_now', a.s.row.id, 'report_schedule', { name: a.s.row.name, reason, recipients: r.recipients })
        setFlash({ tone: 'ok', text: r.recipients == null ? `${a.s.row.name || 'The report'} was sent.` : `${a.s.row.name || 'The report'} was emailed to ${r.recipients} recipient${r.recipients === 1 ? '' : 's'}.` })
      } else if (a.kind === 'run-job') {
        await runCronJobNow(a.j.jobid, reason)
        setFlash({ tone: 'ok', text: `${a.j.jobname} is queued to run within a minute. Refresh to see the result.` })
      } else {
        const next = a.kind === 'resume-job'
        await setCronJobActive(a.j.jobid, next, reason)
        setFlash({ tone: 'ok', text: `${a.j.jobname} is ${next ? 'active again' : 'paused'}.` })
      }
      setAction(null); setOpenSchedule(null); setOpenJob(null)
      await load()
    } catch (e) {
      setActionError(toUserMessage(e, 'That could not be done. Nothing was changed.'))
    } finally {
      setActionBusy(false)
    }
  }

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

  const { sort, onSort } = useTableSort(null)
  const { sort: jobSort, onSort: onJobSort } = useTableSort(null)
  const visibleSchedules = useMemo(() => {
    const byState = scheduleRows.filter((s) => stateFilter === 'all' || s.state === stateFilter)
    const found = searchRows(byState, search, [(s) => s.row.name, (s) => s.row.report_type, (s) => s.row.frequency])
    return sortRows(found, sort, {
      name: (s) => s.row.name, type: (s) => s.row.report_type, frequency: (s) => s.row.frequency,
      next: (s) => (s.row.active ? s.row.next_run_at : null), last: (s) => s.row.last_sent_at,
      state: (s) => STATE_RANK[s.state],
    })
  }, [scheduleRows, stateFilter, search, sort])
  const schedPaged = usePaged(visibleSchedules)

  const jobCounts = useMemo(() => {
    const c = { green: 0, red: 0, amber: 0, gray: 0, inactive: 0 }
    for (const j of cronSummary.jobs) { c[j.tone] = (c[j.tone] || 0) + 1; if (!j.active) c.inactive += 1 }
    return c
  }, [cronSummary])
  const visibleJobs = useMemo(() => {
    const byRun = cronSummary.jobs.filter((j) => {
      if (jobFilter === 'all') return true
      if (jobFilter === 'inactive') return !j.active
      return j.tone === jobFilter
    })
    const found = searchRows(byRun, jobSearch, ['jobname', 'schedule', 'lastStatus'])
    return sortRows(found, jobSort, { run: (j) => RUN_RANK[j.tone], active: (j) => (j.active ? 1 : 0) })
  }, [cronSummary, jobFilter, jobSearch, jobSort])
  const jobPaged = usePaged(visibleJobs)

  const colors = STATUS[theme]
  const scheduleShare = useMemo(() => ([
    { label: 'Healthy', value: stateCounts.healthy, color: colors.good },
    { label: 'Overdue', value: stateCounts.overdue, color: colors.medium },
    { label: 'Failing', value: stateCounts.failing, color: colors.critical },
    { label: 'Paused', value: stateCounts.paused, color: colors.low },
  ].filter((p) => p.value > 0)), [stateCounts, colors])

  const runBars = useMemo(() => ([
    { label: RUN_BUCKET.green, value: jobCounts.green, color: colors.good },
    { label: RUN_BUCKET.red, value: jobCounts.red, color: colors.critical },
    { label: RUN_BUCKET.amber, value: jobCounts.amber, color: colors.medium },
    { label: RUN_BUCKET.gray, value: jobCounts.gray, color: colors.low },
  ]), [jobCounts, colors])

  // Runs due in the next 7 days, soonest first: "what is about to go out".
  const upcoming = useMemo(() => scheduleRows
    .filter((s) => s.row.active && s.row.next_run_at)
    .filter((s) => {
      const t = new Date(s.row.next_run_at).getTime()
      return Number.isFinite(t) && t >= now && t - now <= WEEK_MS
    })
    .sort((a, b) => String(a.row.next_run_at).localeCompare(String(b.row.next_run_at)))
    .slice(0, 8), [scheduleRows, now])

  const openScheduleTab = useCallback((state) => { setStateFilter(state); setSearch(''); setTab('schedules') }, [setTab])
  const openJobsTab = useCallback((f) => { setJobFilter(f); setJobSearch(''); setTab('jobs') }, [setTab])

  const attention = useMemo(() => {
    const items = []
    for (const s of scheduleRows.filter((x) => x.state === 'failing')) {
      items.push({ key: `f-${s.row.id}`, tone: 'danger', title: s.row.name || 'Unnamed schedule',
        detail: `Failing: ${s.row.last_error || s.row.last_status || 'the last run ended in error'}`,
        action: { label: 'Open', onClick: () => setOpenSchedule(s) } })
    }
    for (const s of scheduleRows.filter((x) => x.state === 'overdue')) {
      items.push({ key: `o-${s.row.id}`, tone: 'warning', title: s.row.name || 'Unnamed schedule',
        detail: `Overdue: the next run was due ${fmtRelative(s.row.next_run_at, now)}. The cron loop may not have fired.`,
        action: { label: 'Open', onClick: () => setOpenSchedule(s) } })
    }
    for (const j of cronSummary.jobs.filter((x) => x.tone === 'red')) {
      items.push({ key: `j-${j.jobid ?? j.jobname}`, tone: 'danger', title: j.jobname,
        detail: `Background job: last run failed ${fmtRelative(j.lastEnd, now)}.`,
        action: { label: 'Open', onClick: () => setOpenJob(j) } })
    }
    return items.slice(0, 12)
  }, [scheduleRows, cronSummary, now])

  if (!admin) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <Panel tone="danger">
          <EmptyState icon={ShieldAlert} title="Restricted" reason="Automation Health is reserved for system administrators." />
        </Panel>
      </div>
    )
  }

  const na = (err) => loading || err
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'schedules', label: 'Scheduled reports', count: error ? undefined : scheduleRows.length },
    { key: 'jobs', label: 'Background jobs', count: cronError ? undefined : cronSummary.total },
    { key: 'functions', label: 'Edge functions', count: EDGE_FUNCTIONS.length },
  ]

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={Timer} title="Automation Health"
        purpose="Scheduled reports, background jobs and the functions that run them. Pause, resume or run any of them now; every control says what it changes first and is written to the audit log."
        refreshedAt={loading ? null : now} onRefresh={load} refreshing={refreshing}
        actions={<a href="/console/delivery" className="text-xs text-gray-400 hover:text-gray-200 inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
          Delivery history <ExternalLink size={12} aria-hidden="true" /></a>} />

      {flash && <Note icon={flash.tone === 'ok' ? CheckCircle2 : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>{flash.text}</Note>}

      {/* KPI tiles: each one opens the tab filtered to what it counts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Active schedules" value={na(error) ? 'N/A' : schedSummary.active} tone="good" icon={CalendarClock}
          sub={na(error) ? undefined : `of ${schedSummary.total}`} onClick={() => openScheduleTab('all')} />
        <StatTile label="Paused" value={na(error) ? 'N/A' : schedSummary.paused} tone="muted" icon={PauseCircle}
          onClick={() => openScheduleTab('paused')} active={tab === 'schedules' && stateFilter === 'paused'} />
        <StatTile label="Overdue" value={na(error) ? 'N/A' : schedSummary.overdue}
          tone={schedSummary.overdue > 0 ? 'warning' : 'default'} icon={Clock} sub="Next run already past"
          onClick={() => openScheduleTab('overdue')} active={tab === 'schedules' && stateFilter === 'overdue'} />
        <StatTile label="Failing" value={na(error) ? 'N/A' : schedSummary.failing}
          tone={schedSummary.failing > 0 ? 'danger' : 'default'} icon={XCircle} sub="Last run errored"
          onClick={() => openScheduleTab('failing')} active={tab === 'schedules' && stateFilter === 'failing'} />
        <StatTile label="Background jobs" value={na(cronError) ? 'N/A' : cronSummary.total} icon={Zap}
          sub={na(cronError) ? undefined : `${cronSummary.active} active`} onClick={() => openJobsTab('all')} />
        <StatTile label="Jobs failing" value={na(cronError) ? 'N/A' : cronSummary.failing}
          tone={cronSummary.failing > 0 ? 'danger' : 'default'} icon={XCircle} sub="Last run failed"
          onClick={() => openJobsTab('red')} active={tab === 'jobs' && jobFilter === 'red'} />
      </div>

      <TabBar tabs={tabs} value={tab} onChange={setTab} label="Automation sections" />

      {tab === 'overview' && (
        <div className="space-y-4">
          {loading ? <LoadingState label="Loading automation" rows={3} /> : (
            <>
              {error && <ErrorState message={error} onRetry={load} />}
              <AttentionList items={attention}
                subtitle="Failing and overdue schedules, then failing background jobs."
                unknown={error && cronError ? 'Neither schedules nor jobs could be read, so it is not known whether anything needs attention.' : undefined}
                clearText={error || cronError
                  ? 'Nothing flagged in what could be read. One source failed to load, so this is not a full all clear.'
                  : 'Every schedule and background job is healthy.'} />
            </>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader icon={Mail} title="Schedule health"
                subtitle="Each schedule counted once, by its worst state: failing, then overdue, then paused." />
              {loading ? <LoadingState label="Loading schedules" rows={2} /> : error ? (
                <EmptyState icon={XCircle} title="Schedules could not be read" reason={error} />
              ) : (
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
          <Panel>
            <PanelHeader icon={CalendarClock} title="Due in the next 7 days"
              subtitle="Active schedules whose next run falls within a week, soonest first." />
            {loading ? <LoadingState label="Loading schedules" rows={2} /> : error ? (
              <EmptyState icon={XCircle} title="Upcoming runs are unknown" reason="The scheduled reports could not be read." />
            ) : upcoming.length === 0 ? (
              <EmptyState icon={CalendarClock} title="Nothing due this week" reason="No active schedule runs in the next 7 days." />
            ) : (
              <ul className="divide-y divide-gray-800/70">
                {upcoming.map((s) => (
                  <li key={s.row.id}>
                    <button type="button" onClick={() => setOpenSchedule(s)}
                      className="w-full flex items-center gap-3 py-2 text-left text-xs rounded hover:bg-gray-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                      <span className="flex-1 min-w-0 text-gray-200 truncate">{s.row.name || 'Unnamed schedule'}</span>
                      <span className="text-gray-500 capitalize">{s.row.frequency || 'N/A'}</span>
                      <span className="text-gray-400 tabular-nums w-24 text-right" title={fmtDateTime(s.row.next_run_at)}>{fmtRelative(s.row.next_run_at, now)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {tab === 'schedules' && (
        <Panel>
          <PanelHeader icon={Mail} title="Scheduled reports"
            subtitle="Reports that email themselves on a cadence (report_schedules). Select a row for its detail." />
          <Toolbar className="mb-3">
            <Segmented
              value={stateFilter}
              onChange={setStateFilter}
              ariaLabel="Filter schedules by state"
              role="group"
              options={[
                { key: 'all', label: 'All', count: scheduleRows.length },
                { key: 'failing', label: 'Failing', count: stateCounts.failing },
                { key: 'overdue', label: 'Overdue', count: stateCounts.overdue },
                { key: 'paused', label: 'Paused', count: stateCounts.paused },
                { key: 'healthy', label: 'Healthy', count: stateCounts.healthy },
              ]}
            />
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, type or frequency" className="w-full sm:w-64" />
            <div className="ml-auto flex gap-2">
              <ExportButtons rows={visibleSchedules} columns={SCHEDULE_EXPORT_COLUMNS} title="Scheduled Reports Health" />
            </div>
          </Toolbar>
          {loading ? (
            <LoadingState label="Loading schedules" />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : schedules.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No scheduled reports"
              reason="Create one from Scheduled Reports. If the report_schedules table is not deployed yet, none will appear until it is." />
          ) : visibleSchedules.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No schedules match" reason="Nothing matches this state and search. Clear the filters to see every schedule." />
          ) : (
            <>
              <Table>
                <THead>
                  <Th sortKey="name" sort={sort} onSort={onSort}>Name</Th>
                  <Th sortKey="type" sort={sort} onSort={onSort}>Type</Th>
                  <Th sortKey="frequency" sort={sort} onSort={onSort}>Frequency</Th>
                  <Th sortKey="next" sort={sort} onSort={onSort}>Next run</Th>
                  <Th sortKey="last" sort={sort} onSort={onSort}>Last sent</Th>
                  <Th sortKey="state" sort={sort} onSort={onSort}>State</Th>
                  <Th align="right">Actions</Th>
                </THead>
                <tbody>
                  {schedPaged.rows.map((s) => {
                    const { row: r, flags: f } = s
                    return (
                      <Tr key={r.id} tone={f.failing ? 'warning' : undefined} onClick={() => setOpenSchedule(s)}
                        ariaLabel={`Open schedule ${r.name || 'Unnamed schedule'}`}>
                        <Td className="max-w-[260px]">
                          <span className="line-clamp-2 text-gray-200 font-medium" title={r.name || ''}>{r.name || 'Unnamed schedule'}</span>
                          {f.failing && r.last_error && (
                            <span className="block text-[10px] text-red-400 mt-0.5 line-clamp-2 break-words" title={r.last_error}>
                              {r.last_error}
                            </span>
                          )}
                        </Td>
                        <Td nowrap><span className="text-gray-400">{r.report_type || 'N/A'}</span></Td>
                        <Td nowrap><span className="text-gray-400 capitalize">{r.frequency || 'N/A'}</span></Td>
                        <Td nowrap><span className="text-gray-400" title={fmtDateTime(r.next_run_at)}>{r.active ? fmtRelative(r.next_run_at, now) : 'Paused'}</span></Td>
                        <Td nowrap><span className="text-gray-500" title={fmtDateTime(r.last_sent_at)}>{fmtRelative(r.last_sent_at, now)}</span></Td>
                        <Td><StateBadges f={f} /></Td>
                        <Td align="right" nowrap>
                          <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()} role="presentation">
                            <Btn size="xs" icon={r.active ? Pause : Play} onClick={() => setAction({ kind: r.active ? 'pause-schedule' : 'resume-schedule', s })}
                              title={r.active ? 'Stop this report emailing until resumed' : 'Start this report emailing again'}>
                              {r.active ? 'Pause' : 'Resume'}
                            </Btn>
                            <Btn size="xs" icon={Send} onClick={() => setAction({ kind: 'send', s })} title="Email this report to its recipients now">Send now</Btn>
                          </span>
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
              <Pager paged={schedPaged} label="schedules" />
            </>
          )}
        </Panel>
      )}

      {tab === 'jobs' && (
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
          <Toolbar className="mb-3">
            <Segmented value={jobFilter} onChange={setJobFilter} ariaLabel="Filter jobs by last run" role="group"
              options={[
                { key: 'all', label: 'All', count: cronSummary.total },
                { key: 'red', label: 'Failed', count: jobCounts.red },
                { key: 'amber', label: 'Running', count: jobCounts.amber },
                { key: 'green', label: 'Succeeded', count: jobCounts.green },
                { key: 'gray', label: 'No runs', count: jobCounts.gray },
                { key: 'inactive', label: 'Inactive', count: jobCounts.inactive },
              ]} />
            <SearchInput value={jobSearch} onChange={setJobSearch} placeholder="Search job, schedule or status" className="w-full sm:w-64" />
            <div className="ml-auto flex gap-2">
              <ExportButtons rows={visibleJobs} columns={JOB_EXPORT_COLUMNS} title="Background Jobs Health" />
            </div>
          </Toolbar>
          {loading ? (
            <LoadingState label="Loading jobs" />
          ) : cronError ? (
            <ErrorState message={cronError} onRetry={load} />
          ) : cron.length === 0 ? (
            <EmptyState icon={Clock} title="No background jobs are visible"
              reason="pg_cron may not be installed, or the console_cron_jobs function (V274) is not deployed yet." />
          ) : visibleJobs.length === 0 ? (
            <EmptyState icon={Clock} title="No jobs match" reason="Nothing matches this filter and search. Clear them to see every job." />
          ) : (
            <>
              <Table>
                <THead>
                  <Th sortKey="jobname" sort={jobSort} onSort={onJobSort}>Job</Th>
                  <Th sortKey="schedule" sort={jobSort} onSort={onJobSort}>Schedule</Th>
                  <Th sortKey="active" sort={jobSort} onSort={onJobSort}>Active</Th>
                  <Th sortKey="run" sort={jobSort} onSort={onJobSort}>Last run</Th>
                  <Th sortKey="lastEnd" sort={jobSort} onSort={onJobSort}>When</Th>
                  <Th align="right">Actions</Th>
                </THead>
                <tbody>
                  {jobPaged.rows.map((j) => (
                    <Tr key={j.jobid ?? j.jobname} tone={j.tone === 'red' ? 'warning' : undefined}
                      onClick={() => setOpenJob(j)} ariaLabel={`Open job ${j.jobname}`}>
                      <Td><span className="text-gray-200 font-medium truncate max-w-[260px] inline-block align-bottom" title={j.jobname}>{j.jobname}</span></Td>
                      <Td nowrap>{j.schedule ? <Code>{j.schedule}</Code> : <span className="text-gray-500">N/A</span>}</Td>
                      <Td>{j.active ? <Badge tone="good">Yes</Badge> : <Badge tone="quiet">No</Badge>}</Td>
                      <Td nowrap>
                        <Badge tone={RUN_TONE[j.tone] || 'quiet'}>
                          <span className="capitalize">{j.lastStatus || 'No runs yet'}</span>
                        </Badge>
                      </Td>
                      <Td nowrap><span className="text-gray-500" title={fmtDateTime(j.lastEnd)}>{fmtRelative(j.lastEnd, now)}</span></Td>
                      <Td align="right" nowrap>
                        {j.jobid != null && (
                          <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()} role="presentation">
                            <Btn size="xs" icon={Play} onClick={() => setAction({ kind: 'run-job', j })} title="Run this job once within the next minute">Run now</Btn>
                            <Btn size="xs" variant={j.active ? 'danger' : 'ghost'} icon={j.active ? Pause : Play}
                              onClick={() => setAction({ kind: j.active ? 'pause-job' : 'resume-job', j })}
                              title={j.active ? 'Stop this job running on its schedule' : 'Start this job running on its schedule again'}>
                              {j.active ? 'Pause' : 'Resume'}
                            </Btn>
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pager paged={jobPaged} label="jobs" />
            </>
          )}
        </Panel>
      )}

      {tab === 'functions' && (
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
                <Zap size={14} className="text-gray-500 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0">
                  <Code>{fn.name}</Code>
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{fn.purpose}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
        <Bell size={12} aria-hidden="true" /> This board reads live from the database each time you refresh. It only sends a report or runs a job when you press a control and confirm it.
      </p>

      <SideDrawer open={!!openSchedule} onClose={() => setOpenSchedule(null)}
        title={openSchedule?.row.name || 'Unnamed schedule'} subtitle="Scheduled report"
        footer={openSchedule && (
          <>
            <Btn icon={openSchedule.row.active ? Pause : Play} onClick={() => setAction({ kind: openSchedule.row.active ? 'pause-schedule' : 'resume-schedule', s: openSchedule })}>
              {openSchedule.row.active ? 'Pause' : 'Resume'}
            </Btn>
            <Btn variant="primary" icon={Send} onClick={() => setAction({ kind: 'send', s: openSchedule })}>Send now</Btn>
          </>
        )}>
        {openSchedule && (
          <>
            <StateBadges f={openSchedule.flags} />
            {openSchedule.row.last_error && (
              <Note icon={XCircle} tone="danger">
                <p className="font-medium">Last error</p>
                <p className="mt-0.5 break-words">{openSchedule.row.last_error}</p>
              </Note>
            )}
            <dl>
              <Field label="Report type">{openSchedule.row.report_type}</Field>
              <Field label="Frequency"><span className="capitalize">{openSchedule.row.frequency || 'N/A'}</span></Field>
              <Field label="Time of day">{openSchedule.row.time_of_day || 'N/A'}</Field>
              <Field label="Active">{openSchedule.row.active ? 'Yes' : 'No, paused'}</Field>
              <Field label="Next run">{openSchedule.row.active ? `${fmtDateTime(openSchedule.row.next_run_at)} (${fmtRelative(openSchedule.row.next_run_at, now)})` : 'Paused'}</Field>
              <Field label="Last sent">{`${fmtDateTime(openSchedule.row.last_sent_at)} (${fmtRelative(openSchedule.row.last_sent_at, now)})`}</Field>
              <Field label="Last status">{openSchedule.row.last_status || 'N/A'}</Field>
              <Field label="Recipients">{recipientCount(openSchedule.row) || 'None recorded'}</Field>
              <Field label="Formats">{Array.isArray(openSchedule.row.output_formats) ? openSchedule.row.output_formats.join(', ') || 'N/A' : (openSchedule.row.output_formats || 'N/A')}</Field>
              <Field label="Created">{fmtDateTime(openSchedule.row.created_at)}</Field>
            </dl>
            <a href="/console/delivery" className="inline-flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
              See its delivery history <ExternalLink size={12} aria-hidden="true" />
            </a>
          </>
        )}
      </SideDrawer>

      <SideDrawer open={!!openJob} onClose={() => setOpenJob(null)} title={openJob?.jobname || 'Job'} subtitle="Background job (pg_cron)"
        footer={openJob && openJob.jobid != null && (
          <>
            <Btn icon={Play} onClick={() => setAction({ kind: 'run-job', j: openJob })}>Run now</Btn>
            <Btn variant={openJob.active ? 'danger' : 'primary'} icon={openJob.active ? Pause : Play}
              onClick={() => setAction({ kind: openJob.active ? 'pause-job' : 'resume-job', j: openJob })}>
              {openJob.active ? 'Pause job' : 'Resume job'}
            </Btn>
          </>
        )}>
        {openJob && (
          <>
          <dl>
            <Field label="Job id">{openJob.jobid ?? 'N/A'}</Field>
            <Field label="Schedule">{openJob.schedule ? <Code>{openJob.schedule}</Code> : 'N/A'}</Field>
            <Field label="Active">{openJob.active ? 'Yes' : 'No'}</Field>
            <Field label="Last run"><Badge tone={RUN_TONE[openJob.tone] || 'quiet'}><span className="capitalize">{openJob.lastStatus || 'No runs yet'}</span></Badge></Field>
            <Field label="Finished">{`${fmtDateTime(openJob.lastEnd)} (${fmtRelative(openJob.lastEnd, now)})`}</Field>
          </dl>
          <div className="mt-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 mb-1.5"><History size={12} aria-hidden="true" /> Recent runs</p>
            {jobRuns.loading ? <LoadingState label="Reading runs" rows={2} /> : jobRuns.error ? (
              <p className="text-xs text-red-300" role="alert">{jobRuns.error}</p>
            ) : jobRuns.list.length === 0 ? (
              <p className="text-xs text-gray-500">No run is recorded for this job yet.</p>
            ) : (
              <ul className="divide-y divide-gray-800/70">
                {jobRuns.list.map((r, i) => (
                  <li key={`${r.started}-${i}`} className="py-1.5 text-xs flex items-start gap-2">
                    <Badge tone={RUN_TONE[cronTone(r.status)] || 'quiet'}><span className="capitalize">{r.status || 'unknown'}</span></Badge>
                    <span className="flex-1 min-w-0">
                      <span className="block text-gray-300">{fmtDateTime(r.started)}{Number.isFinite(Number(r.ms)) ? `, ${Number(r.ms).toLocaleString('en-US')} ms` : ''}</span>
                      {r.output && <span className="block text-gray-500 break-words">{r.output}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </>
        )}
      </SideDrawer>

      <ConfirmImpactDialog
        open={!!action}
        title={actionTitle(action)}
        impact={actionImpact(action)}
        confirmLabel={actionConfirm(action)}
        danger={action?.kind === 'pause-job'}
        requireReason
        typedWord={action?.kind === 'pause-job' ? action.j?.jobname : undefined}
        busy={actionBusy}
        error={actionError}
        onCancel={() => { if (!actionBusy) { setAction(null); setActionError('') } }}
        onConfirm={runAction}
      />
    </div>
  )
}
