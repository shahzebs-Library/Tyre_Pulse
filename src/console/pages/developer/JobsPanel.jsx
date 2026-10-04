/**
 * Scheduled jobs (pg_cron) for the Developer Center: runs, failures, MISSED
 * runs and longest time per job over 7 days, the job alert policy (Sentry
 * Crons pattern: grace, failures in a row, stuck, auto-close), bulk run /
 * pause / resume and a drawer with the last runs of one job.
 *
 * Every write goes through a super-admin RPC that needs a reason and writes
 * the console audit log. Pausing is reversible; the impact line says so.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Play, Pause, PlayCircle, AlertTriangle, ArrowRight, Pencil } from 'lucide-react'
import {
  Panel, PanelHeader, Badge, Btn, SearchInput, Segmented, Table, THead, Th, Tr, Td,
  LoadingState, ErrorState, EmptyState, Note, ConfirmImpactDialog, ImpactBox,
} from '../../components/ui'
import { Drawer, ConsoleLink } from '../shared/pageKit'
import ExportButtons from '../shared/ExportButtons'
import {
  getCronJobRuns, setCronJobActive, runCronJobNow, CRON_POLICY_KEYS, validateCronPolicy,
} from '../../../lib/api/engineeringCenter'
import { saveSystemConfigValues } from '../../../lib/api/systemConfig'
import {
  scheduleLabel, scheduleBucket, nextRunLabel, jobState, jobDescription, jobTotals, fmtInt, fmtMs, riyadhTime,
} from '../../../lib/engineeringCenter'
import { toUserMessage } from '../../../lib/safeError'
import { useConsoleAuth } from '../../ConsoleAuthContext'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'minute', label: 'Every few minutes' },
  { key: 'hourly', label: 'Hourly or faster' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'failed', label: 'Failed' },
]

const EXPORT_COLUMNS = [
  { key: 'jobname', header: 'Job' },
  { key: 'scheduleText', header: 'Schedule (Riyadh)' },
  { key: 'runs_24h', header: 'Runs 24h' },
  { key: 'failed_24h', header: 'Failed 24h' },
  { key: 'missedText', header: 'Missed 7d' },
  { key: 'avgText', header: 'Avg time' },
  { key: 'maxText', header: 'Longest 7d' },
  { key: 'stateText', header: 'State' },
]

export default function JobsPanel({ health, loading, error, onRetry, onChanged, emailSummary }) {
  const { logAction } = useConsoleAuth() || {}
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [picked, setPicked] = useState(() => new Set())
  const [action, setAction] = useState(null) // { kind: 'run'|'pause'|'resume'|'pause_all', jobs }
  const [busy, setBusy] = useState(false)
  const [actionErr, setActionErr] = useState('')
  const [flash, setFlash] = useState('')
  const [drawerJob, setDrawerJob] = useState(null)
  const [policyEdit, setPolicyEdit] = useState(null)

  const jobs = useMemo(() => health?.jobs || [], [health])
  const policy = health?.policy || {}
  const totals = useMemo(() => jobTotals(jobs), [jobs])

  const counts = useMemo(() => {
    const c = { all: jobs.length, failed: 0 }
    for (const j of jobs) {
      const b = scheduleBucket(j.schedule)
      c[b] = (c[b] || 0) + 1
      if ((Number(j.failed_nd) || 0) > 0) c.failed += 1
    }
    return c
  }, [jobs])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jobs.filter((j) => {
      if (filter === 'failed' && !(Number(j.failed_nd) > 0)) return false
      if (filter !== 'all' && filter !== 'failed' && scheduleBucket(j.schedule) !== filter) return false
      if (q && !`${j.jobname} ${jobDescription(j.jobname)}`.toLowerCase().includes(q)) return false
      return true
    }).map((j) => {
      const st = jobState(j, policy)
      return {
        ...j,
        st,
        scheduleText: scheduleLabel(j.schedule),
        missedText: j.missed_nd === null || j.missed_nd === undefined ? 'N/A' : String(j.missed_nd),
        avgText: fmtMs(j.avg_ms),
        maxText: fmtMs(j.max_ms),
        stateText: st.label,
      }
    })
  }, [jobs, search, filter, policy])

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allOn = rows.length > 0 && rows.every((r) => picked.has(r.jobid))
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(rows.map((r) => r.jobid)))
  const pickedJobs = jobs.filter((j) => picked.has(j.jobid))

  async function runAction({ reason }) {
    if (!action) return
    setBusy(true); setActionErr('')
    try {
      for (const j of action.jobs) {
        if (action.kind === 'run') await runCronJobNow(j.jobid, reason)
        else await setCronJobActive(j.jobid, action.kind === 'resume', reason)
      }
      const verb = action.kind === 'run' ? 'queued to run within a minute' : action.kind === 'resume' ? 'resumed' : 'paused'
      setFlash(`${action.jobs.length} job${action.jobs.length === 1 ? '' : 's'} ${verb}.`)
      setAction(null); setPicked(new Set())
      onChanged?.()
    } catch (e) {
      setActionErr(toUserMessage(e, 'The change could not be saved. Nothing else was changed.'))
    } finally { setBusy(false) }
  }

  const impactFor = (a) => {
    if (!a) return null
    const n = a.jobs.length
    const names = a.jobs.slice(0, 3).map((j) => j.jobname).join(', ') + (n > 3 ? ` and ${n - 3} more` : '')
    if (a.kind === 'run') return { tone: 'info', what: `Run ${n === 1 ? names : `${n} jobs`} once now.`, change: 'A one-off copy of each job runs within about a minute; the regular schedule is untouched.', who: `Whatever the job does: ${names}.`, undo: 'A run cannot be undone once it starts, but it changes nothing a normal scheduled run would not.' }
    if (a.kind === 'resume') return { tone: 'info', what: `Resume ${names}.`, change: 'The job runs on its schedule again from the next planned time.', who: 'Everyone who depends on what the job does.', undo: 'Yes. Pause it again at any time.' }
    const everyone = a.kind === 'pause_all'
    return {
      tone: 'danger',
      what: everyone ? `Pause all ${n} scheduled jobs.` : `Pause ${names}.`,
      change: everyone
        ? 'Backups, report emails, approval notifications, alert checks and every other timed job stop until resumed.'
        : 'The job stops running until you resume it. Work it would have done waits.',
      who: 'Everyone who depends on what these jobs do, including report recipients and approvers.',
      undo: 'Yes. Resume each job; anything missed while paused is not re-run automatically.',
      stats: [{ label: 'Jobs', value: n }, { label: 'Runs in 24h', value: fmtInt(a.jobs.reduce((s, j) => s + (Number(j.runs_24h) || 0), 0)) }, { label: 'Failed 24h', value: fmtInt(a.jobs.reduce((s, j) => s + (Number(j.failed_24h) || 0), 0)) }],
    }
  }

  if (loading) return <Panel><LoadingState label="Loading scheduled jobs" rows={8} /></Panel>
  if (error) return <Panel><PanelHeader icon={Clock} title="Scheduled jobs" /><ErrorState message={error} onRetry={onRetry} /></Panel>

  return (
    <Panel flush>
      <div className="p-4 pb-3">
        <PanelHeader icon={Clock} title={<span className="inline-flex flex-wrap items-center gap-2">Scheduled jobs <Badge tone={totals.active === totals.total ? 'good' : 'warning'}>{totals.active} of {totals.total} on</Badge></span>}
          subtitle={`${fmtInt(totals.runs24h)} runs in 24h, ${fmtInt(totals.failed24h)} failed. Riyadh time. ${health?.generated_at ? `Runs read ${riyadhTime(health.generated_at)}.` : ''}`}
          actions={(<>
            <Btn variant="danger" icon={Pause} disabled={!jobs.some((j) => j.active)}
              title="Pause every scheduled job" onClick={() => setAction({ kind: 'pause_all', jobs: jobs.filter((j) => j.active) })}>Pause all</Btn>
            <ExportButtons rows={rows} columns={EXPORT_COLUMNS} title="Scheduled jobs" />
          </>)} />
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Find a job" className="md:w-64" />
          <Segmented role="group" ariaLabel="Filter jobs" value={filter} onChange={setFilter}
            options={FILTERS.map((f) => ({ ...f, count: counts[f.key] || 0 }))} />
        </div>
      </div>

      {flash && <div className="px-4 pb-2"><Note tone="accent">{flash}</Note></div>}

      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-orange-950/20 border-y border-orange-800/40 text-xs">
          <span className="font-semibold text-orange-300">{picked.size} selected</span>
          <Btn size="xs" icon={Play} onClick={() => setAction({ kind: 'run', jobs: pickedJobs })}>Run now</Btn>
          <Btn size="xs" icon={Pause} onClick={() => setAction({ kind: 'pause', jobs: pickedJobs.filter((j) => j.active) })} disabled={!pickedJobs.some((j) => j.active)}>Pause</Btn>
          <Btn size="xs" icon={PlayCircle} onClick={() => setAction({ kind: 'resume', jobs: pickedJobs.filter((j) => !j.active) })} disabled={!pickedJobs.some((j) => !j.active)}>Resume</Btn>
          <span className="ml-auto text-orange-300/80">Pausing stops the job until resumed. Every pause asks for a reason and is logged.</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-4"><EmptyState title="No jobs match" reason={jobs.length ? 'Change the filter or the search.' : 'pg_cron reported no scheduled jobs.'} /></div>
      ) : (
        <Table>
          <THead>
            <Th className="w-8"><input type="checkbox" aria-label="Select all jobs" checked={allOn} onChange={toggleAll} className="accent-orange-500" /></Th>
            <Th>Job</Th><Th>Schedule</Th><Th>Next run</Th><Th>Last run</Th>
            <Th align="right">Runs 24h</Th><Th align="right">Failed</Th><Th align="right">Missed 7d</Th>
            <Th align="right">Avg time</Th><Th align="right">Longest 7d</Th><Th>State</Th><Th><span className="sr-only">Actions</span></Th>
          </THead>
          <tbody>
            {rows.map((j) => (
              <Tr key={j.jobid} onClick={() => setDrawerJob(j)} ariaLabel={`Open ${j.jobname}`}>
                <Td><input type="checkbox" aria-label={`Select ${j.jobname}`} checked={picked.has(j.jobid)}
                  onClick={(e) => e.stopPropagation()} onChange={() => toggle(j.jobid)} className="accent-orange-500" /></Td>
                <Td><p className="font-mono text-[11px] text-gray-200">{j.jobname}</p><p className="text-[10px] text-gray-500">{jobDescription(j.jobname)}</p></Td>
                <Td nowrap>{j.scheduleText}</Td>
                <Td nowrap>{j.active ? nextRunLabel(j.schedule) : 'Paused'}</Td>
                <Td nowrap>{j.last_start ? riyadhTime(j.last_start) : 'Not run'}</Td>
                <Td align="right">{fmtInt(j.runs_24h)}</Td>
                <Td align="right">{fmtInt(j.failed_24h)}</Td>
                <Td align="right" className={Number(j.missed_nd) > 0 ? 'text-red-300' : ''}>{j.missedText}</Td>
                <Td align="right">{j.avgText}</Td>
                <Td align="right">{j.maxText}</Td>
                <Td><Badge tone={j.st.tone}>{j.st.label}</Badge></Td>
                <Td>
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Btn size="xs" variant="quiet" icon={Play} title={`Run ${j.jobname} now`} onClick={() => setAction({ kind: 'run', jobs: [j] })} />
                    {j.active
                      ? <Btn size="xs" variant="quiet" icon={Pause} title={`Pause ${j.jobname}`} onClick={() => setAction({ kind: 'pause', jobs: [j] })} />
                      : <Btn size="xs" variant="quiet" icon={PlayCircle} title={`Resume ${j.jobname}`} onClick={() => setAction({ kind: 'resume', jobs: [j] })} />}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      <PolicyRows policy={policy} longest={totals.longest} onEdit={() => setPolicyEdit({ ...policy })} />

      <p className="px-4 py-3 text-[11px] text-gray-500 border-t border-gray-800">
        Automation Health and Pipeline Monitor are merged here (tabs above).
        {emailSummary ? ` Report emails: ${fmtInt(emailSummary.sent)} sent, ${fmtInt(emailSummary.failed)} failed in 30 days.` : ' Report email totals could not be read.'}
        {' '}Missed runs are counted from the gaps between starts against each job&apos;s own schedule; a job created this week is counted from its first run.
      </p>

      <ConfirmImpactDialog
        open={Boolean(action)}
        title={action?.kind === 'run' ? 'Run now?' : action?.kind === 'resume' ? 'Resume jobs?' : action?.kind === 'pause_all' ? 'Pause ALL scheduled jobs?' : 'Pause jobs?'}
        impact={impactFor(action)}
        requireReason
        typedWord={action?.kind === 'pause_all' ? 'PAUSE ALL' : undefined}
        danger={action?.kind === 'pause' || action?.kind === 'pause_all'}
        confirmLabel={action?.kind === 'run' ? 'Run now' : action?.kind === 'resume' ? 'Resume' : `Pause ${action?.jobs?.length || 0}`}
        busy={busy} error={actionErr}
        onCancel={() => { setAction(null); setActionErr('') }}
        onConfirm={runAction}
      />

      <PolicyDialog value={policyEdit} onClose={() => setPolicyEdit(null)} onSaved={() => { setPolicyEdit(null); setFlash('Job alert policy saved. The watcher uses it on its next check (every 5 minutes).'); onChanged?.() }} logAction={logAction} />

      <JobDrawer job={drawerJob} policy={policy} emailSummary={emailSummary}
        onClose={() => setDrawerJob(null)}
        onAction={(kind) => { const j = drawerJob; setDrawerJob(null); setAction({ kind, jobs: [j] }) }} />
    </Panel>
  )
}

function PolicyRows({ policy, longest, onEdit }) {
  const known = policy && policy.grace_min !== undefined
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 border-t border-gray-800 text-xs">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:border-r border-gray-800">
        <div><p className="font-medium text-gray-200">Alert me when a job misses its time</p>
          <p className="text-[11px] text-gray-500">{known ? `Grace period ${policy.grace_min} min after the planned start. ${policy.enabled ? 'On.' : 'Off.'}` : 'Policy could not be read.'}</p></div>
        <Badge tone={policy?.enabled ? 'good' : 'quiet'}>{policy?.enabled ? 'On' : 'Off'}</Badge>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div><p className="font-medium text-gray-200">Alert after failures in a row</p>
          <p className="text-[11px] text-gray-500">One-off blips do not page; {known ? `${policy.fail_streak} in a row does` : 'N/A'}.</p></div>
        <Badge>{known ? policy.fail_streak : 'N/A'}</Badge>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t md:border-r border-gray-800">
        <div><p className="font-medium text-gray-200">Treat as stuck after</p>
          <p className="text-[11px] text-gray-500">{longest ? `Longest normal run is ${fmtMs(longest.ms)} (${longest.name}).` : 'Longest run not measured yet.'}</p></div>
        <Badge>{known ? `${policy.stuck_min} min` : 'N/A'}</Badge>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-gray-800">
        <div><p className="font-medium text-gray-200">Close the alert after good runs</p>
          <p className="text-[11px] text-gray-500">Auto-resolves so old alerts do not pile up.</p></div>
        <div className="flex items-center gap-2"><Badge>{known ? policy.recover_ok : 'N/A'}</Badge>
          <Btn size="xs" icon={Pencil} onClick={onEdit} disabled={!known}>Edit policy</Btn></div>
      </div>
    </div>
  )
}

function PolicyDialog({ value, onClose, onSaved, logAction }) {
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setDraft(value); setErr('') }, [value])
  if (!value) return null
  const problem = draft ? validateCronPolicy(draft) : null
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: k === 'enabled' ? e.target.checked : e.target.value }))
  async function save({ reason }) {
    if (problem) { setErr(problem); return }
    setBusy(true); setErr('')
    try {
      const values = {}
      for (const [k, key] of Object.entries(CRON_POLICY_KEYS)) values[key] = k === 'enabled' ? Boolean(draft.enabled) : String(Number(draft[k]))
      await saveSystemConfigValues(values)
      try { await logAction?.('update_config', null, 'system_config', { keys: Object.values(CRON_POLICY_KEYS), reason }) } catch { /* audit best effort */ }
      onSaved?.()
    } catch (e) { setErr(toUserMessage(e, 'The policy could not be saved.')) } finally { setBusy(false) }
  }
  const input = 'w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'
  return (
    <ConfirmImpactDialog open title="Job alert policy" requireReason busy={busy} error={err || problem}
      readyExtra={!problem} confirmLabel="Save policy" onCancel={onClose} onConfirm={save}
      impact={{ tone: 'info', what: 'How the watcher decides a job needs attention.', change: 'The watcher (every 5 minutes) opens one alert per job and notifies super admins once; it closes the alert by itself after the good runs you set.', who: 'Super admins receive the alerts. No job is changed.', undo: 'Yes. Save the old numbers again.' }}>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <label className="col-span-2 flex items-center gap-2 text-gray-300"><input type="checkbox" checked={Boolean(draft?.enabled)} onChange={set('enabled')} className="accent-orange-500" /> Alert when a job misses its time, gets stuck or keeps failing</label>
        <label className="block"><span className="block text-[11px] text-gray-400 mb-1">Grace period (minutes)</span><input type="number" min={1} max={120} value={draft?.grace_min ?? ''} onChange={set('grace_min')} className={input} /></label>
        <label className="block"><span className="block text-[11px] text-gray-400 mb-1">Failures in a row before alerting</span><input type="number" min={1} max={10} value={draft?.fail_streak ?? ''} onChange={set('fail_streak')} className={input} /></label>
        <label className="block"><span className="block text-[11px] text-gray-400 mb-1">Stuck after (minutes)</span><input type="number" min={1} max={240} value={draft?.stuck_min ?? ''} onChange={set('stuck_min')} className={input} /></label>
        <label className="block"><span className="block text-[11px] text-gray-400 mb-1">Good runs to close an alert</span><input type="number" min={1} max={10} value={draft?.recover_ok ?? ''} onChange={set('recover_ok')} className={input} /></label>
      </div>
    </ConfirmImpactDialog>
  )
}

function JobDrawer({ job, policy, onClose, onAction, emailSummary }) {
  const [runs, setRuns] = useState({ loading: false, error: '', list: [] })
  const load = useCallback(async () => {
    if (!job) return
    setRuns({ loading: true, error: '', list: [] })
    try { setRuns({ loading: false, error: '', list: await getCronJobRuns(job.jobid, 8) }) }
    catch (e) { setRuns({ loading: false, error: toUserMessage(e, 'The runs could not be read.'), list: [] }) }
  }, [job])
  useEffect(() => { load() }, [load])
  if (!job) return null
  const st = jobState(job, policy)
  const isReports = job.jobname === 'send-scheduled-reports'
  return (
    <Drawer open title={job.jobname} width="max-w-2xl"
      subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone={st.tone}>{st.label}</Badge>{scheduleLabel(job.schedule)} - {jobDescription(job.jobname)}</span>}
      onClose={onClose}
      footer={(<>
        {isReports && <ConsoleLink to="/console/developer?tab=automation" icon={ArrowRight}>Open report schedules</ConsoleLink>}
        <Btn icon={Play} variant="primary" onClick={() => onAction('run')}>Run now</Btn>
        {job.active
          ? <Btn icon={Pause} onClick={() => onAction('pause')}>Pause</Btn>
          : <Btn icon={PlayCircle} onClick={() => onAction('resume')}>Resume</Btn>}
      </>)}>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Runs 24h" value={fmtInt(job.runs_24h)} sub={scheduleLabel(job.schedule)} />
        <Stat label="Failed 24h" value={fmtInt(job.failed_24h)} sub={`${fmtInt(job.failed_nd)} in 7 days`} />
        <Stat label="Avg time" value={fmtMs(job.avg_ms)} sub={`longest ${fmtMs(job.max_ms)}`} />
      </div>
      <section>
        <h3 className="text-xs font-semibold text-gray-300 mb-1">What it does</h3>
        <p className="text-xs text-gray-400">{jobDescription(job.jobname)}.{isReports && emailSummary ? ` ${fmtInt(emailSummary.sent)} reports sent, ${fmtInt(emailSummary.failed)} failed in 30 days.` : ''}</p>
      </section>
      <section>
        <h3 className="text-xs font-semibold text-gray-300 mb-1">Last 8 runs</h3>
        {runs.loading ? <LoadingState rows={4} /> : runs.error ? <ErrorState message={runs.error} onRetry={load} /> : runs.list.length === 0
          ? <EmptyState title="No runs recorded" reason="pg_cron has no run history for this job yet." />
          : (
            <Table>
              <THead><Th>Started</Th><Th>Result</Th><Th align="right">Took</Th><Th>Output</Th></THead>
              <tbody>
                {runs.list.map((r) => (
                  <Tr key={r.started}>
                    <Td nowrap>{riyadhTime(r.started)}</Td>
                    <Td><Badge tone={r.status === 'succeeded' ? 'good' : r.status === 'failed' ? 'danger' : 'warning'}>{r.status === 'succeeded' ? 'Succeeded' : r.status === 'failed' ? 'Failed' : r.status}</Badge></Td>
                    <Td align="right">{fmtMs(r.ms)}</Td>
                    <Td className="max-w-[16rem] truncate">{r.output || 'N/A'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
      </section>
      <section>
        <h3 className="text-xs font-semibold text-gray-300 mb-1">Alerting</h3>
        <ul className="text-xs text-gray-400 space-y-0.5">
          <li>Missed if not started by <b className="text-gray-200">{policy.grace_min ?? 'N/A'} min after its time</b></li>
          <li>Stuck after <b className="text-gray-200">{policy.stuck_min ?? 'N/A'} min</b> (longest run 7 days: {fmtMs(job.max_ms)})</li>
          <li>Alert after <b className="text-gray-200">{policy.fail_streak ?? 'N/A'} failures in a row</b>; auto-close after <b className="text-gray-200">{policy.recover_ok ?? 'N/A'} good runs</b></li>
          <li>Missed runs 7 days: <b className="text-gray-200">{job.missed_nd ?? 'N/A'} of {job.expected_nd ?? 'N/A'} expected</b></li>
        </ul>
      </section>
      <section>
        <h3 className="text-xs font-semibold text-gray-300 mb-1">If you pause it</h3>
        <ImpactBox tone="warning" what={`It has run ${fmtInt(job.runs_24h)} times in 24 hours with ${fmtInt(job.failed_24h)} failures.`}
          change={`No ${jobDescription(job.jobname).toLowerCase()} until you resume.`}
          who="Everyone who depends on what this job does." undo="Yes. Resume and it continues from its next planned time." />
      </section>
      {Number(job.fail_streak) > 0 && <Note icon={AlertTriangle} tone="warning">The last {job.fail_streak} run{Number(job.fail_streak) === 1 ? '' : 's'} failed.</Note>}
    </Drawer>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="border border-gray-800 rounded-lg p-2.5">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-100 tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 truncate">{sub}</p>}
    </div>
  )
}

