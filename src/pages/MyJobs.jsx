/**
 * My Jobs: the work orders assigned to the signed-in person.
 *
 * Owner decision 2026-11-15 (round 2): technicians (Tyre Man and the workshop
 * trades) work on their ASSIGNED jobs through web and mobile. They move the job's
 * status, update their own tasks and send a note of the work done or a problem.
 * They do not create, edit, assign, cost or close work orders.
 *
 * This screen is not the boundary. Every write goes through the same tables the
 * foreman's screens use, and the database decides (work_order_can, wo_write_guard,
 * the task and activity policies). A refusal comes back as a plain sentence.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Wrench, RefreshCw, Search, AlertTriangle, CheckCircle2, Send } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import PageHeader from '../components/ui/PageHeader'
import { useWorkOrderAccess } from '../hooks/useWorkOrderAccess'
import { listMyJobs } from '../lib/api/workOrderAccess'
import * as workshop from '../lib/api/workshopLive'
import { normalizeWoStatus } from '../lib/workOrderStatus'
import { workOrderRefusalFromError } from '../lib/workOrderAccess'
import { toUserMessage } from '../lib/safeError'

/** Statuses a technician may move an assigned job to (never a closing status). */
const MY_JOB_STATUS_MOVES = Object.freeze([
  'In Progress', 'Waiting for Parts', 'Waiting for Approval', 'On Hold', 'Quality Inspection',
])
const TASK_STATUSES = workshop.TASK_STATUS

const fmtDate = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function MyJobs() {
  const { profile } = useAuth() || {}
  const { t } = useLanguage()
  const userId = profile?.id || null
  const rights = useWorkOrderAccess()
  const [jobs, setJobs] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [notes, setNotes] = useState({})
  const [flash, setFlash] = useState({})   // jobId -> { ok, msg }

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!userId) { setLoading(false); return }
    if (!quiet) setLoading(true)
    try {
      const res = await listMyJobs(userId)
      setJobs(res.jobs); setTasks(res.tasks); setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [userId])
  useEffect(() => { load() }, [load])

  const tasksByJob = useMemo(() => {
    const m = new Map()
    for (const x of tasks) { if (!m.has(x.job_id)) m.set(x.job_id, []); m.get(x.job_id).push(x) }
    return m
  }, [tasks])

  const statuses = useMemo(
    () => [...new Set(jobs.map((j) => normalizeWoStatus(j.status)).filter(Boolean))].sort(),
    [jobs],
  )
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jobs.filter((j) => {
      if (statusFilter && normalizeWoStatus(j.status) !== statusFilter) return false
      if (!q) return true
      return [j.work_order_no, j.asset_no, j.description, j.site].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [jobs, search, statusFilter])

  const run = async (jobId, promise, okMsg) => {
    setBusyId(jobId)
    try {
      await promise
      setFlash((f) => ({ ...f, [jobId]: { ok: true, msg: okMsg } }))
      await load({ quiet: true })
      return true
    } catch (e) {
      const msg = workOrderRefusalFromError(e) || toUserMessage(e)
      setFlash((f) => ({ ...f, [jobId]: { ok: false, msg: t('workorders.myJobs.saveFailed', { msg }) } }))
      return false
    } finally {
      setBusyId(null)
    }
  }

  const moveStatus = (job, status) => run(job.id, workshop.setJobStatus(job.id, status), t('workorders.myJobs.statusSaved'))
  const moveTask = (job, task, status) => run(job.id, workshop.setTaskStatus(task.id, status), t('workorders.myJobs.taskSaved'))
  const sendNote = async (job, eventType) => {
    const note = String(notes[job.id] || '').trim()
    if (!note) {
      setFlash((f) => ({ ...f, [job.id]: { ok: false, msg: t('workorders.myJobs.noteNeeded') } }))
      return
    }
    const ok = await run(
      job.id,
      workshop.recordEvent({
        user_id: userId, job_id: job.id, asset_no: job.asset_no || undefined, event_type: eventType,
        reason_code: eventType === 'report_problem' ? 'support' : undefined, note, device: 'web',
      }),
      t(eventType === 'report_problem' ? 'workorders.myJobs.problemSent' : 'workorders.myJobs.workSent'),
    )
    if (ok) setNotes((n) => ({ ...n, [job.id]: '' }))
    // "Work completed" is submitted for review: the job moves to Quality Inspection. It is not
    // final closure; a supervisor, manager or tyre engineer approves and closes it.
    if (ok && eventType === 'complete_task' && normalizeWoStatus(job.status) !== 'Quality Inspection') {
      await moveStatus(job, 'Quality Inspection')
    }
  }

  const label = { color: 'var(--text-secondary)' }
  const field = { background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--text-primary)' }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('workorders.myJobs.title')}
        subtitle={t('workorders.myJobs.subtitle')}
        icon={Wrench}
        actions={(
          <button type="button" onClick={() => load()} disabled={loading}
            className="btn-secondary flex items-center gap-2 text-sm px-3 min-h-[40px] disabled:opacity-50">
            <RefreshCw size={15} aria-hidden="true" className={loading ? 'animate-spin' : ''} />
            {t('workorders.myJobs.retry')}
          </button>
        )}
      />

      {!loading && !loadError && jobs.length > 0 && (
        <div className="card p-3 flex flex-col sm:flex-row gap-2 sm:items-center">
          <label className="relative flex-1">
            <span className="sr-only">{t('workorders.myJobs.search')}</span>
            <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2" style={label} />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t('workorders.myJobs.search')}
              className="w-full rounded-lg border pl-9 pr-3 min-h-[40px] text-sm" style={field} />
          </label>
          <select aria-label={t('workorders.myJobs.allStatuses')} value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border px-3 min-h-[40px] text-sm" style={field}>
            <option value="">{t('workorders.myJobs.allStatuses')}</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-xs" style={label}>
            {t('workorders.myJobs.count', { shown: shown.length, total: jobs.length })}
          </span>
        </div>
      )}

      {loading && <div className="card p-8 text-center text-sm" style={label} role="status">{t('workorders.myJobs.loading')}</div>}

      {!loading && loadError && (
        <div className="card p-8 text-center space-y-3" role="alert">
          <AlertTriangle size={22} aria-hidden="true" className="mx-auto text-amber-500" />
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{t('workorders.myJobs.loadFailed')}</p>
          <button type="button" onClick={() => load()} className="btn-primary text-sm px-4 min-h-[40px]">{t('workorders.myJobs.retry')}</button>
        </div>
      )}

      {!loading && !loadError && jobs.length === 0 && (
        <div className="card p-8 text-center space-y-1">
          <Wrench size={22} aria-hidden="true" className="mx-auto" style={label} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('workorders.myJobs.empty')}</p>
          <p className="text-xs" style={label}>{t('workorders.myJobs.emptyHint')}</p>
        </div>
      )}

      {!loading && !loadError && jobs.length > 0 && shown.length === 0 && (
        <div className="card p-6 text-center text-sm" style={label}>{t('workorders.myJobs.noMatch')}</div>
      )}

      {!loading && !loadError && shown.length > 0 && (
        <ul className="space-y-3">
          {shown.map((job) => {
            const status = normalizeWoStatus(job.status)
            const mine = tasksByJob.get(job.id) || []
            const busy = busyId === job.id
            const msg = flash[job.id]
            const progressWhy = rights.reason('progress', job)
            return (
              <li key={job.id} className="card p-4 space-y-3" data-testid={`my-job-${job.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm break-words" style={{ color: 'var(--text-primary)' }}>
                      {job.work_order_no || 'N/A'}
                    </p>
                    <p className="text-xs break-words" style={label}>{job.description || 'N/A'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {job.vor && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-red-500/40 text-red-500">
                        {t('workorders.myJobs.offRoad')}
                      </span>
                    )}
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border" style={field}>{status || 'N/A'}</span>
                  </div>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {[
                    [t('workorders.myJobs.asset'), job.asset_no],
                    [t('workorders.myJobs.type'), job.work_type],
                    [t('workorders.myJobs.site'), job.site],
                    [t('workorders.myJobs.opened'), fmtDate(job.opened_at)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt style={label}>{k}</dt>
                      <dd className="font-medium break-words" style={{ color: 'var(--text-primary)' }}>{v || 'N/A'}</dd>
                    </div>
                  ))}
                </dl>

                <div>
                  <p className="text-xs mb-1.5" style={label}>{t('workorders.myJobs.moveTo')}</p>
                  <div className="flex flex-wrap gap-2">
                    {MY_JOB_STATUS_MOVES.filter((s) => s !== status).map((s) => {
                      const why = rights.statusReason(s, job)
                      return (
                        <button key={s} type="button" disabled={busy || !!why} title={why || undefined}
                          onClick={() => moveStatus(job, s)}
                          className="px-3 min-h-[40px] rounded-lg text-sm font-medium border disabled:opacity-40 disabled:cursor-not-allowed"
                          style={field}>
                          {s}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[11px] mt-1.5" style={label}>{progressWhy || t('workorders.myJobs.closeHint')}</p>
                </div>

                {mine.length > 0 && (
                  <div>
                    <p className="text-xs mb-1.5" style={label}>{t('workorders.myJobs.tasks')}</p>
                    <ul className="space-y-1.5">
                      {mine.map((task) => (
                        <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="break-words min-w-0" style={{ color: 'var(--text-primary)' }}>{task.title || 'N/A'}</span>
                          <select aria-label={`${t('workorders.myJobs.taskStatus')}: ${task.title || ''}`}
                            value={TASK_STATUSES.includes(task.status) ? task.status : ''} disabled={busy}
                            onChange={(e) => e.target.value && moveTask(job, task, e.target.value)}
                            className="rounded-lg border px-2 min-h-[40px] text-sm" style={field}>
                            {!TASK_STATUSES.includes(task.status) && <option value="">{task.status || 'N/A'}</option>}
                            {TASK_STATUSES.map((s) => (
                              <option key={s} value={s}>{t(`workorders.myJobs.taskStatuses.${s}`)}</option>
                            ))}
                          </select>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <label className="text-xs block mb-1.5" style={label} htmlFor={`note-${job.id}`}>{t('workorders.myJobs.note')}</label>
                  <textarea id={`note-${job.id}`} rows={2} maxLength={2000} value={notes[job.id] || ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [job.id]: e.target.value }))}
                    placeholder={t('workorders.myJobs.notePlaceholder')} disabled={busy || !!progressWhy}
                    className="w-full rounded-lg border px-3 py-2 text-sm" style={field} />
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button type="button" disabled={busy || !!progressWhy} title={progressWhy || undefined}
                      onClick={() => sendNote(job, 'complete_task')}
                      className="btn-primary flex items-center gap-2 text-sm px-4 min-h-[40px] disabled:opacity-50">
                      <Send size={14} aria-hidden="true" />{t('workorders.myJobs.submitWork')}
                    </button>
                    <button type="button" disabled={busy || !!progressWhy} title={progressWhy || undefined}
                      onClick={() => sendNote(job, 'report_problem')}
                      className="btn-secondary flex items-center gap-2 text-sm px-4 min-h-[40px] disabled:opacity-50">
                      <AlertTriangle size={14} aria-hidden="true" />{t('workorders.myJobs.reportProblem')}
                    </button>
                  </div>
                  <p className="text-[11px] mt-1.5" style={label}>{t('workorders.myJobs.photosHint')}</p>
                </div>

                {msg && (
                  <p role={msg.ok ? 'status' : 'alert'} className={`text-sm flex items-center gap-1.5 ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>
                    {msg.ok ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
                    {msg.msg}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
