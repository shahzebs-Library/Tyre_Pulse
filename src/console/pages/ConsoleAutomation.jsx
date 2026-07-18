/**
 * ConsoleAutomation - super-admin "Automation Health" console page.
 *
 * A pure console page (navy + orange theme, useConsoleAuth for the admin gate).
 * One operating picture for everything that runs on a schedule:
 *   1. Scheduled reports (report_schedules): cadence, active, next run, last
 *      sent, last status/error, with PAUSED / OVERDUE / FAILING badges.
 *   2. pg_cron jobs (console_cron_jobs RPC, V274): job name, schedule, active,
 *      and its most recent run status + time as a green / amber / red dot.
 *   3. Edge functions: an HONEST static checklist of the deployed functions that
 *      power automation, with a note to verify the running version in the
 *      Supabase dashboard (versions are NOT fabricated here).
 *
 * Read-only. Refresh re-pulls all three. Super-admin only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Timer, RefreshCw, AlertTriangle, ShieldAlert, PauseCircle, Clock,
  CheckCircle2, XCircle, Zap, Mail, Bell, Info, CalendarClock,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listSchedules, listCronJobs, summarizeSchedules, summarizeCron, scheduleFlags,
} from '../../lib/api/automationHealth'
import { toUserMessage } from '../../lib/safeError'

// ── Small helpers ───────────────────────────────────────────────────────────

function InfoDot({ text }) {
  return (
    <span className="inline-flex align-middle ml-1 text-gray-600 hover:text-gray-300 cursor-help" title={text}>
      <Info size={11} />
    </span>
  )
}

const DOT = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', gray: 'bg-gray-500' }
const TEXT = { green: 'text-emerald-400', amber: 'text-amber-400', red: 'text-red-400', gray: 'text-gray-400' }

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString()
}

function fmtRelative(v) {
  if (!v) return 'N/A'
  const t = new Date(v).getTime()
  if (Number.isNaN(t)) return 'N/A'
  const diff = Date.now() - t
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
  const [schedules, setSchedules] = useState([])
  const [cron, setCron] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const now = Date.now()

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    const [sRes, cRes] = await Promise.allSettled([listSchedules(), listCronJobs()])
    if (sRes.status === 'fulfilled') setSchedules(sRes.value)
    else setError(toUserMessage(sRes.reason))
    if (cRes.status === 'fulfilled') setCron(cRes.value)
    // cron failure is non-fatal (pg_cron may be absent); leave list empty.
    setRefreshing(false)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const schedSummary = useMemo(() => summarizeSchedules(schedules, now), [schedules, now])
  const cronSummary = useMemo(() => summarizeCron(cron), [cron])

  if (!admin) {
    return (
      <div className="max-w-md mx-auto mt-16 rounded-xl border border-red-800/40 bg-red-950/20 p-8 text-center">
        <ShieldAlert size={22} className="text-red-400 mx-auto mb-3" />
        <h1 className="text-lg font-bold text-white">Restricted</h1>
        <p className="text-sm text-gray-400 mt-1">Automation Health is reserved for system administrators.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Timer size={20} className="text-orange-400" /> Automation Health
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Scheduled reports, background jobs and the functions that run them.
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-800/40 bg-red-900/15 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-300" />
            <p className="text-xs text-red-200">{error}</p>
          </div>
          <button onClick={load} className="text-xs text-red-300 hover:text-white underline">Retry</button>
        </div>
      )}

      {/* Schedule KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Active schedules" value={schedSummary.active} tone="green" icon={CalendarClock} />
        <Tile label="Paused" value={schedSummary.paused} tone="gray" icon={PauseCircle} />
        <Tile label="Overdue" value={schedSummary.overdue} tone="amber" icon={Clock}
          hint="Active, but the next run time is already in the past. The cron loop may not have fired yet." />
        <Tile label="Failing" value={schedSummary.failing} tone="red" icon={XCircle}
          hint="The last run ended in error or recorded an error message." />
      </div>

      {/* ── Scheduled reports table ── */}
      <Panel
        title="Scheduled reports"
        icon={Mail}
        hint="Reports that email themselves on a cadence (report_schedules). Badges flag paused, overdue and failing schedules."
      >
        {loading ? (
          <p className="p-6 text-xs text-gray-600 text-center">Loading schedules...</p>
        ) : schedules.length === 0 ? (
          <EmptyRow text="No scheduled reports found. Create one from Scheduled Reports, or apply the report_schedules migration." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="px-4 py-2 font-semibold">Name</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">Frequency</th>
                  <th className="px-4 py-2 font-semibold">Next run</th>
                  <th className="px-4 py-2 font-semibold">Last sent</th>
                  <th className="px-4 py-2 font-semibold">State</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((r) => {
                  const f = scheduleFlags(r, now)
                  return (
                    <tr key={r.id} className="border-b border-gray-800/60 hover:bg-gray-800/30 align-top">
                      <td className="px-4 py-2.5 text-xs text-gray-200 font-medium max-w-[220px]">
                        <span className="line-clamp-2" title={r.name || ''}>{r.name || '(unnamed)'}</span>
                        {!f.paused && f.failing && r.last_error && (
                          <span className="block text-[10px] text-red-400/80 mt-0.5 line-clamp-2" title={r.last_error}>
                            {r.last_error}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">{r.report_type || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap capitalize">{r.frequency || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[11px] text-gray-400 whitespace-nowrap" title={fmtDateTime(r.next_run_at)}>
                        {r.active ? fmtRelative(r.next_run_at) : 'Paused'}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-gray-500 whitespace-nowrap" title={fmtDateTime(r.last_sent_at)}>
                        {fmtRelative(r.last_sent_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {f.paused && <Badge tone="gray">Paused</Badge>}
                          {f.overdue && <Badge tone="amber">Overdue</Badge>}
                          {f.failing && <Badge tone="red">Failing</Badge>}
                          {!f.paused && !f.overdue && !f.failing && <Badge tone="green">Healthy</Badge>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ── pg_cron jobs table ── */}
      <Panel
        title="Background jobs"
        icon={Clock}
        hint="pg_cron jobs that run inside the database on a schedule (cron loop, backups, notification delivery). The dot shows the most recent run."
        right={
          <span className="text-[10px] text-gray-600">
            {cronSummary.total} jobs | {cronSummary.active} active | {cronSummary.failing} failing
          </span>
        }
      >
        {loading ? (
          <p className="p-6 text-xs text-gray-600 text-center">Loading jobs...</p>
        ) : cron.length === 0 ? (
          <EmptyRow text="No background jobs are visible. pg_cron may not be installed, or the console_cron_jobs function (V274) is not deployed yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="px-4 py-2 font-semibold">Job</th>
                  <th className="px-4 py-2 font-semibold">Schedule</th>
                  <th className="px-4 py-2 font-semibold">Active</th>
                  <th className="px-4 py-2 font-semibold">Last run</th>
                  <th className="px-4 py-2 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {cronSummary.jobs.map((j) => (
                  <tr key={j.jobid ?? j.jobname} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                    <td className="px-4 py-2.5 text-xs text-gray-200 font-medium">
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT[j.tone]} ${j.tone === 'amber' ? 'animate-pulse' : ''}`} />
                        <span className="truncate max-w-[220px]" title={j.jobname}>{j.jobname}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[11px] font-mono text-gray-500 whitespace-nowrap">{j.schedule || 'N/A'}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {j.active
                        ? <span className="text-emerald-400">Yes</span>
                        : <span className="text-gray-500">No</span>}
                    </td>
                    <td className={`px-4 py-2.5 text-xs whitespace-nowrap capitalize ${TEXT[j.tone]}`}>
                      {j.lastStatus || 'No runs yet'}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-gray-500 whitespace-nowrap" title={fmtDateTime(j.lastEnd)}>
                      {fmtRelative(j.lastEnd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ── Edge functions checklist ── */}
      <Panel
        title="Edge functions"
        icon={Zap}
        hint="Server functions that carry out automation. This is a fixed checklist of what should be deployed."
      >
        <div className="flex items-start gap-2 px-4 pt-3">
          <Info size={13} className="text-blue-300 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-blue-200/80 leading-relaxed">
            Verify each function's current version and last deploy time in the Supabase dashboard
            (Edge Functions). Versions are not shown here to avoid reporting a stale number.
          </p>
        </div>
        <ul className="p-4 pt-3 space-y-2">
          {EDGE_FUNCTIONS.map((fn) => (
            <li key={fn.name} className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-900/50 p-3">
              <CheckCircle2 size={15} className="text-gray-500 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-mono text-gray-200">{fn.name}</p>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{fn.purpose}</p>
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

// ── Sub-components ────────────────────────────────────────────────────────────

function Tile({ label, value, tone, icon: Icon, hint }) {
  const ring = {
    green: 'border-emerald-800/40 bg-emerald-900/10 text-emerald-300',
    amber: 'border-amber-800/40 bg-amber-900/10 text-amber-300',
    red: 'border-red-800/40 bg-red-900/10 text-red-300',
    gray: 'border-gray-800 bg-gray-900/40 text-gray-300',
  }[tone] || 'border-gray-800 bg-gray-900/40 text-gray-300'
  return (
    <div className={`rounded-xl border p-3 ${ring}`}>
      <Icon size={16} className="mb-1.5 opacity-80" />
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-[11px] font-semibold mt-0.5 flex items-center">
        {label}{hint && <InfoDot text={hint} />}
      </p>
    </div>
  )
}

function Panel({ title, icon: Icon, hint, right, children }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50">
      <div className="flex items-center gap-3 p-4 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          {Icon && <Icon size={15} className="text-orange-400" />}
          {title}
          {hint && <InfoDot text={hint} />}
        </h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </div>
  )
}

function Badge({ tone, children }) {
  const style = {
    green: 'text-emerald-300 bg-emerald-900/30 border-emerald-700/40',
    amber: 'text-amber-300 bg-amber-900/30 border-amber-700/40',
    red: 'text-red-300 bg-red-900/30 border-red-700/40',
    gray: 'text-gray-400 bg-gray-800 border-gray-700',
  }[tone] || 'text-gray-400 bg-gray-800 border-gray-700'
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${style}`}>{children}</span>
  )
}

function EmptyRow({ text }) {
  return <p className="p-8 text-sm text-gray-500 text-center">{text}</p>
}
