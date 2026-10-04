/**
 * ConsoleOperations - /console/operations. Imports and data jobs.
 *
 * Replaces, and keeps whole as tabs: Data Operations, Import History, Smart
 * Import, Material Master, Teach the Classifier, Data Learning, Duplicate
 * Control, Data Cleanup and Self-Healing. Automation Health and Pipeline Monitor
 * live in the Developer Center; the job table below links there.
 *
 * The overview adds what those pages never said in one place: what each upload
 * changed (a plain-English outcome line per batch), which uploads look like
 * the same file sent twice, an undo for an import, and scheduled job health
 * with Riyadh times, reusing the Developer Center job RPCs (admin_cron_health,
 * admin_cron_run_now, admin_cron_set_active) rather than a second copy.
 *
 * "Rows read" is shown as Not recorded when the batch never staged rows: the
 * counter is derived by trigger from staged rows, so a file that failed before
 * staging genuinely has no read count to show.
 */
import { lazy, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Layers, FileClock, Wand2, Boxes, Brain, Sparkles, CopyX, Trash2, Activity, HeartPulse, Undo2, Play, Pause, CheckCircle2, Info, Clock,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, ConfirmImpactDialog,
} from '../components/ui'
import { PageHeader, TabBar, useUrlTab, useRefreshStamp, Pager, usePaged, ConsoleLink } from './shared/pageKit'
import ExportButtons from './shared/ExportButtons'
import Embedded, { MovedFrom } from './monitor/Embedded'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { listImportBatches, getCronHealth, getCronLastFailures, setCronActive, runCronNow } from '../../lib/api/monitorCenter'
import { reverseBatch } from '../../lib/api/imports'
import {
  fmtNum, riyadhDateTime, shortDate, BATCH_STATUS, batchStatus, batchStatusCounts, batchChangeLine, possibleRepeats, describeSchedule, jobState,
} from '../../lib/monitorCenter'
import { toUserMessage } from '../../lib/safeError'

const pages = {
  'data-ops': lazy(() => import('./ConsoleDataOps')),
  'import-history': lazy(() => import('./ConsoleImportHistory')),
  'smart-import': lazy(() => import('./ConsoleSmartImport')),
  'material-master': lazy(() => import('./ConsoleMaterialMaster')),
  'classifier': lazy(() => import('./ConsoleClassificationLearning')),
  'data-learning': lazy(() => import('./ConsoleDataLearning')),
  'duplicates': lazy(() => import('./ConsoleDuplicateControl')),
  'cleanup': lazy(() => import('./ConsoleDataCleanup')),
  'self-healing': lazy(() => import('./ConsoleSelfHealing')),
}
const TABS = [
  { key: 'overview', label: 'Overview', icon: Activity },
  { key: 'data-ops', label: 'Data operations', icon: Layers, from: 'Data Operations', help: 'Upload coverage and data health across modules.' },
  { key: 'import-history', label: 'Import history', icon: FileClock, from: 'Import History', help: 'Every upload, its file hash and load activity.' },
  { key: 'smart-import', label: 'Smart import', icon: Wand2, from: 'Smart Import', help: 'Upload any file; it maps its own columns.' },
  { key: 'material-master', label: 'Material master', icon: Boxes, from: 'Material Master', help: 'Review what each item code is.' },
  { key: 'classifier', label: 'Teach the classifier', icon: Brain, from: 'Teach the Classifier', help: 'Correct how expense lines are sorted.' },
  { key: 'data-learning', label: 'Data learning', icon: Sparkles, from: 'Data Learning', help: 'Fill blank tyre brand and size from known facts.' },
  { key: 'duplicates', label: 'Duplicates', icon: CopyX, from: 'Duplicate Control', help: 'Find and remove exact duplicate rows, restorable.' },
  { key: 'cleanup', label: 'Data cleanup', icon: Trash2, from: 'Data Cleanup', help: 'Remove old rows after a snapshot.' },
  { key: 'self-healing', label: 'Self-healing', icon: HeartPulse, from: 'Self-Healing', help: 'Stale and orphan data scans.' },
]
const TAB_KEYS = TABS.map((t) => t.key)
const COUNTRIES = ['KSA', 'UAE', 'Egypt']

const BATCH_COLUMNS = [
  { key: 'created_at', header: 'When', value: (b) => riyadhDateTime(b.created_at) || 'N/A' },
  { key: 'module', header: 'Module' },
  { key: 'country', header: 'Country' },
  { key: 'status', header: 'Result', value: (b) => BATCH_STATUS[batchStatus(b)]?.label || b.import_status || 'Not recorded' },
  { key: 'line', header: 'What changed', value: (b) => batchChangeLine(b) },
  { key: 'imported_rows', header: 'Imported' },
  { key: 'skipped_rows', header: 'Skipped' },
  { key: 'duplicate_rows', header: 'Duplicates' },
  { key: 'error_rows', header: 'Errors' },
  { key: 'total_rows', header: 'Rows read', value: (b) => (Number(b.total_rows) > 0 ? b.total_rows : 'Not recorded') },
]
const JOB_COLUMNS = [
  { key: 'jobname', header: 'Job' },
  { key: 'schedule', header: 'Schedule (Riyadh)', value: (j) => describeSchedule(j.schedule) },
  { key: 'runs_nd', header: 'Runs 7 days' },
  { key: 'failed_nd', header: 'Failed 7 days' },
  { key: 'last_failure', header: 'Last failure', value: (j) => riyadhDateTime(j.last_failure_at) || 'None kept' },
  { key: 'state', header: 'State', value: (j) => jobState(j).label },
]

export default function ConsoleOperations() {
  const [tab, setTab] = useUrlTab(TAB_KEYS, 'overview')
  const { logAction } = useConsoleAuth()
  const { refreshedAt, stamp } = useRefreshStamp()
  const [batches, setBatches] = useState(null)
  const [batchErr, setBatchErr] = useState('')
  const [jobs, setJobs] = useState(null)
  const [jobErr, setJobErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [country, setCountry] = useState('')
  const [q, setQ] = useState('')
  const [jobQ, setJobQ] = useState('')
  const [undoing, setUndoing] = useState(null)
  const [jobAction, setJobAction] = useState(null) // { job, kind: 'run'|'pause'|'resume' }
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setBatchErr(''); setJobErr('')
    const [b, h, f] = await Promise.allSettled([listImportBatches(200), getCronHealth(7), getCronLastFailures()])
    if (b.status === 'fulfilled') setBatches(b.value)
    else { setBatches(null); setBatchErr(toUserMessage(b.reason, 'Import batches could not be loaded.')) }
    if (h.status === 'fulfilled') {
      const fails = new Map((f.status === 'fulfilled' ? f.value?.items || [] : []).map((x) => [String(x.jobid), x]))
      setJobs((h.value?.jobs || []).map((j) => ({ ...j, last_failure_at: fails.get(String(j.jobid))?.last_failure_at || null })))
    } else { setJobs(null); setJobErr(toUserMessage(h.reason, 'Scheduled jobs could not be loaded.')) }
    stamp(); setLoading(false)
  }, [stamp])
  useEffect(() => { if (tab === 'overview') load() }, [tab, load])

  const repeats = useMemo(() => possibleRepeats(batches || []), [batches])
  const counts = useMemo(() => batchStatusCounts(batches || []), [batches])
  const rows = useMemo(() => (batches || []).filter((b) => {
    if (status === 'repeat' && !repeats.has(b.id)) return false
    if (status && status !== 'repeat' && batchStatus(b) !== status) return false
    if (country && b.country !== country) return false
    const needle = q.trim().toLowerCase()
    return !needle || `${b.module} ${b.country} ${b.site || ''} ${b.source_system || ''}`.toLowerCase().includes(needle)
  }), [batches, status, country, q, repeats])
  const paged = usePaged(rows, 20, `${status}|${country}|${q}`)
  const jobRows = useMemo(() => (jobs || []).filter((j) => !jobQ || String(j.jobname).toLowerCase().includes(jobQ.toLowerCase())), [jobs, jobQ])
  const jobsOk = (jobs || []).filter((j) => jobState(j).tone === 'good').length
  const jobsFailed7 = (jobs || []).reduce((a, j) => a + (Number(j.failed_nd) || 0), 0)
  const uploaderKnown = (batches || []).filter((b) => b.uploader || b.created_by).length
  const lastBatch = (batches || [])[0]

  async function doUndo({ reason }) {
    setBusy(true); setActionError('')
    try {
      await reverseBatch(undoing.id)
      await logAction('import_batch_reverse', undoing.id, 'import_batch', { module: undoing.module, country: undoing.country, rows: undoing.imported_rows, reason })
      setNotice(`Undone. ${fmtNum(undoing.imported_rows)} ${undoing.module} rows were removed again.`)
      setUndoing(null); await load()
    } catch (e) { setActionError(toUserMessage(e, 'The import could not be undone. Nothing was changed.')) }
    finally { setBusy(false) }
  }

  async function doJob({ reason }) {
    const { job, kind } = jobAction
    setBusy(true); setActionError('')
    try {
      if (kind === 'run') await runCronNow(job.jobid, reason)
      else await setCronActive(job.jobid, kind === 'resume', reason)
      setNotice(kind === 'run' ? `${job.jobname} will run within the next minute.` : `${job.jobname} is ${kind === 'resume' ? 'running on its schedule again' : 'paused'}.`)
      setJobAction(null); await load()
    } catch (e) { setActionError(toUserMessage(e, 'Nothing was changed.')) }
    finally { setBusy(false) }
  }

  const active = TABS.find((t) => t.key === tab)

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={Layers} title="Operations"
        purpose="Imports and data jobs: what each upload changed, undo it, clean duplicates and old data, and keep the classifier and scheduled jobs healthy."
        refreshedAt={tab === 'overview' ? refreshedAt : null} onRefresh={tab === 'overview' ? load : undefined} busy={loading}
        actions={tab === 'overview' && (<>
          <Btn icon={Layers} onClick={() => setTab('data-ops')}>Upload coverage</Btn>
          <Btn variant="primary" icon={Wand2} onClick={() => setTab('smart-import')}>New import</Btn>
        </>)} />
      <MovedFrom onPick={setTab} items={TABS.filter((t) => t.from).map((t) => ({ key: t.key, label: t.from }))} />
      <TabBar tabs={TABS.map(({ key, label, icon }) => ({ key, label, icon }))} value={tab} onChange={setTab} ariaLabel="Operations sections" />

      {tab !== 'overview' && active && <Embedded page={pages[tab]} label={active.label.toLowerCase()} />}

      {tab === 'overview' && (
        <div className="space-y-4">
          {notice && <Note icon={CheckCircle2} tone="accent">{notice}</Note>}
          {loading && batches === null && jobs === null && <Panel><LoadingState label="Reading imports and jobs" rows={5} /></Panel>}

          {!loading || batches || jobs ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatTile label="Import batches" icon={FileClock} value={batches ? fmtNum(counts.all) : 'N/A'} sub={batches ? `${fmtNum(uploaderKnown)} with uploader recorded` : 'could not be read'} />
              <StatTile label="Last in-app import" value={lastBatch ? shortDate(lastBatch.created_at) : 'N/A'}
                sub={lastBatch ? `${lastBatch.module}, ${BATCH_STATUS[batchStatus(lastBatch)]?.label || 'status not recorded'}` : 'none'} />
              <StatTile label="Failed imports" value={batches ? fmtNum(counts.failed) : 'N/A'} tone={counts.failed ? 'danger' : 'default'} sub="all time"
                onClick={() => setStatus('failed')} active={status === 'failed'} />
              <StatTile label="Possible repeat uploads" value={batches ? fmtNum(repeats.size) : 'N/A'} tone={repeats.size ? 'warning' : 'default'}
                sub="same size, same module, within 3 days" onClick={() => setStatus('repeat')} active={status === 'repeat'} />
              <StatTile label="Never approved" value={batches ? fmtNum(counts.staged) : 'N/A'} tone={counts.staged ? 'warning' : 'default'} sub="uploaded, nothing written"
                onClick={() => setStatus('staged')} active={status === 'staged'} />
              <StatTile label="Scheduled jobs OK" icon={Clock} value={jobs ? `${fmtNum(jobsOk)} of ${fmtNum(jobs.length)}` : 'N/A'}
                tone={jobs && jobsOk < jobs.length ? 'warning' : 'good'} sub={jobs ? `${fmtNum(jobsFailed7)} failed runs in 7 days` : 'could not be read'} />
            </div>
          ) : null}

          <Panel>
            <PanelHeader icon={FileClock} title="Import history" subtitle="In-app uploads, newest first. Each line says what the upload changed."
              actions={<ExportButtons rows={rows} columns={BATCH_COLUMNS} title="Import history" />} />
            {batchErr ? <ErrorState message={batchErr} onRetry={load} /> : batches === null ? <LoadingState rows={4} /> : (<>
              <Toolbar className="mb-3">
                <Segmented ariaLabel="Result" value={status} onChange={setStatus} options={[
                  { key: '', label: 'All', count: counts.all },
                  { key: 'committed', label: 'Imported', count: counts.committed },
                  { key: 'failed', label: 'Failed', count: counts.failed },
                  { key: 'staged', label: 'Never approved', count: counts.staged },
                  { key: 'reversed', label: 'Undone', count: counts.reversed },
                  { key: 'repeat', label: 'Possible repeats', count: repeats.size },
                ]} />
                <Select ariaLabel="Country" value={country} onChange={setCountry} placeholder="Every country"
                  options={COUNTRIES.map((c) => ({ value: c, label: c }))} />
                <SearchInput value={q} onChange={setQ} placeholder="Module, country or source" className="w-full sm:w-56" />
              </Toolbar>
              {rows.length === 0 ? <EmptyState title={batches.length ? 'No upload matches' : 'No in-app uploads yet'}
                reason={batches.length ? 'Clear a filter to see more.' : 'Uploads made in the app appear here. Loads made directly in the database are listed under Import history, Load activity.'} /> : (<>
                <ul className="divide-y divide-gray-800">
                  {paged.rows.map((b) => {
                    const st = batchStatus(b)
                    const meta = BATCH_STATUS[st]
                    const read = Number(b.total_rows) > 0
                    return (
                      <li key={b.id} className="py-3 grid gap-2 md:grid-cols-[8rem_1fr_auto] md:items-start">
                        <div className="text-[11px] text-gray-500 tabular-nums">{riyadhDateTime(b.created_at) || 'N/A'}</div>
                        <div className="min-w-0">
                          <p className="text-xs text-gray-200 flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{b.module || 'Unknown module'}</span>
                            <span className="text-gray-500">{b.country || 'No country'}</span>
                            <Badge tone={meta?.tone || 'quiet'}>{meta?.label || 'Status not recorded'}</Badge>
                            {repeats.has(b.id) && <Badge tone="warning">Possible repeat</Badge>}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">{batchChangeLine(b)}{repeats.has(b.id) ? ' Same row count as an upload shortly before, so this may be the same file sent twice.' : ''}</p>
                          <p className="text-[11px] text-gray-500 mt-1 flex flex-wrap gap-x-3">
                            <span>Imported {fmtNum(b.imported_rows)}</span><span>Skipped {fmtNum(b.skipped_rows)}</span>
                            <span>Duplicates {fmtNum(b.duplicate_rows)}</span><span>Errors {fmtNum(b.error_rows)}</span>
                            <span>Rows read: {read ? fmtNum(b.total_rows) : 'not recorded'}</span>
                          </p>
                        </div>
                        <div>
                          {st === 'committed' && Number(b.imported_rows) > 0
                            ? <Btn variant="danger" size="xs" icon={Undo2} onClick={() => setUndoing(b)}>Undo import</Btn>
                            : <span className="text-[11px] text-gray-500">Nothing to undo</span>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <Pager paged={paged} label="uploads" />
              </>)}
            </>)}
          </Panel>

          <Panel>
            <PanelHeader icon={Clock} title="Scheduled jobs" subtitle="Background jobs, last 7 days. Times are Riyadh."
              actions={(<>
                <ConsoleLink to="/console/developer?tab=automation">Automation health</ConsoleLink>
                <ExportButtons rows={jobRows} columns={JOB_COLUMNS} title="Scheduled jobs" />
              </>)} />
            {jobErr ? <ErrorState message={jobErr} onRetry={load} /> : jobs === null ? <LoadingState rows={4} /> : (<>
              <Toolbar className="mb-3"><SearchInput value={jobQ} onChange={setJobQ} placeholder="Search jobs" className="w-full sm:w-56" /></Toolbar>
              {jobRows.length === 0 ? <EmptyState title="No scheduled jobs" reason={jobs.length ? 'No job matches the search.' : 'The scheduler reports no jobs.'} /> : (
                <Table>
                  <THead><Th>Job</Th><Th>Schedule</Th><Th align="right">Runs 7d</Th><Th align="right">Failed</Th><Th>Last failure</Th><Th>State</Th><Th>Actions</Th></THead>
                  <tbody>
                    {jobRows.map((j) => {
                      const st = jobState(j)
                      return (
                        <Tr key={j.jobid}>
                          <Td className="font-mono text-[11px]">{j.jobname}</Td>
                          <Td nowrap>{describeSchedule(j.schedule)}</Td>
                          <Td align="right" className="tabular-nums">{fmtNum(j.runs_nd)}</Td>
                          <Td align="right" className="tabular-nums">{fmtNum(j.failed_nd)}</Td>
                          <Td nowrap>{riyadhDateTime(j.last_failure_at) || <span className="text-gray-500">None kept</span>}</Td>
                          <Td nowrap><Badge tone={st.tone}>{st.label}</Badge></Td>
                          <Td nowrap>
                            <span className="inline-flex gap-1">
                              <Btn size="xs" icon={Play} disabled={!j.active} onClick={() => setJobAction({ job: j, kind: 'run' })}>Run now</Btn>
                              {j.active
                                ? <Btn size="xs" variant="danger" icon={Pause} onClick={() => setJobAction({ job: j, kind: 'pause' })}>Pause</Btn>
                                : <Btn size="xs" icon={Play} onClick={() => setJobAction({ job: j, kind: 'resume' })}>Resume</Btn>}
                            </span>
                          </Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
              )}
            </>)}
          </Panel>

          <Panel>
            <PanelHeader icon={Layers} title="Data tools" subtitle="Each tool keeps all its features in its own tab." />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {TABS.filter((t) => t.help).map((t) => (
                <button key={t.key} type="button" onClick={() => setTab(t.key)}
                  className="text-left rounded-lg border border-gray-800 p-3 hover:bg-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                  <p className="text-xs text-gray-200 flex items-center gap-1.5"><t.icon size={13} className="text-orange-400" aria-hidden="true" />{t.label}</p>
                  <p className="text-[11px] text-gray-500 mt-1">{t.help}</p>
                </button>
              ))}
            </div>
            <div className="mt-3"><Note icon={Info}>Safety net: duplicate removals are archived and restorable, data cleanup takes a snapshot first, and nightly backups keep 30 days. An undone import removes only the rows that import added.</Note></div>
          </Panel>
        </div>
      )}

      <ConfirmImpactDialog open={!!undoing} danger requireReason typedWord="UNDO" title="Undo this import" confirmLabel="Undo import"
        busy={busy} error={actionError} onCancel={() => { setUndoing(null); setActionError('') }} onConfirm={doUndo}
        impact={{
          tone: 'danger', what: `Removes the ${fmtNum(undoing?.imported_rows)} ${undoing?.module || ''} rows this upload added.`,
          change: 'Those rows are deleted again. Reports that used them change back.',
          who: `Everyone who reads ${undoing?.module || 'this'} data in ${undoing?.country || 'that country'}.`,
          undo: 'Only by uploading the same file again.',
          stats: [{ label: 'Rows removed', value: fmtNum(undoing?.imported_rows) }, { label: 'Country', value: undoing?.country || 'N/A' }, { label: 'Uploaded', value: shortDate(undoing?.created_at) }],
        }} />

      <ConfirmImpactDialog open={!!jobAction} danger={jobAction?.kind === 'pause'} requireReason
        typedWord={jobAction?.kind === 'pause' ? 'PAUSE' : undefined}
        title={jobAction?.kind === 'run' ? `Run ${jobAction?.job.jobname} now` : jobAction?.kind === 'pause' ? `Pause ${jobAction?.job.jobname}` : `Resume ${jobAction?.job.jobname}`}
        confirmLabel={jobAction?.kind === 'run' ? 'Run now' : jobAction?.kind === 'pause' ? 'Pause job' : 'Resume job'}
        busy={busy} error={actionError} onCancel={() => { setJobAction(null); setActionError('') }} onConfirm={doJob}
        impact={jobAction?.kind === 'pause' ? {
          tone: 'danger', what: 'Stops this job from running on its schedule.',
          change: 'Whatever it does (reports, reminders, clean-up, checks) stops until resumed.', who: 'Everyone who relies on what this job produces.',
          undo: 'Yes, resume it here. Runs missed while paused are not made up.',
        } : jobAction?.kind === 'run' ? {
          tone: 'warning', what: 'Runs this job once, within the next minute, in addition to its schedule.',
          change: 'It does exactly what its scheduled run does.', who: 'Same people its scheduled run affects.', undo: 'No. A run cannot be taken back.',
        } : { tone: 'info', what: 'Puts this job back on its schedule.', change: 'It runs at its next scheduled time.', who: 'Same people its runs affect.', undo: 'Yes, pause it again.' }} />
    </div>
  )
}
