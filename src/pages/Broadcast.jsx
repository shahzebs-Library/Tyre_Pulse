/**
 * Send a message to the team - phones and in-app inbox.
 *
 * Everything else that notifies is event driven. This is the one place a person
 * can simply say something to their people.
 *
 * The audience count comes from the SERVER before sending, and separates "will
 * see it in the app" from "has a phone signed in", because a message to 35
 * people of whom 2 carry the app is not a message to 35 phones. Presenting one
 * number would let someone believe the fleet had been reached.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Megaphone, Send, RefreshCcw, Users, Smartphone, AlertTriangle, Check,
  Download, FileText, Search, Languages, Inbox, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Illustration from '../components/illustrations/Illustration'
import MessageEngagement from '../components/team/MessageEngagement'
import { ensureActionItem, listActionItems } from '../lib/api/actionCenter'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  BROADCAST_PERIODS, filterBroadcasts, broadcastKpis, targetBreakdown,
  monthlyVolume, broadcastExportRows, hasArabic, broadcastTime,
} from '../lib/broadcastAnalytics'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import MultiCombobox from '../components/ui/MultiCombobox'
import {
  previewAudience, sendBroadcast, listBroadcasts, loadAudienceDirectory,
  audienceLabel, validateBroadcast, reachNote,
} from '../lib/api/broadcast'
import {
  buildRoleOptions, buildCountryOptions, buildSiteDirectory, buildEmployeeOptions,
  pruneSelection, isEveryone, audienceSummary,
} from '../lib/broadcastAudience'
import { toUserMessage } from '../lib/safeError'

const inputCls = 'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]'
const labelCls = 'text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]'

const fmtDate = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? String(d)
    : dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function Broadcast() {
  const { activeCountry } = useSettings()
  const { profile } = useAuth()
  const orgId = profile?.organisation_id || profile?.org_id || null
  const [form, setForm] = useState({
    title: '', body: '', titleAr: '', bodyAr: '', sendPush: true,
  })
  const [roles, setRoles] = useState([])
  const [countries, setCountries] = useState(
    activeCountry && activeCountry !== 'All' ? [activeCountry] : [])
  const [sites, setSites] = useState([])

  // The audience directory is read from the organisation's real people, custom
  // roles and registered sites. Nothing selectable here is a static list.
  const [directory, setDirectory] = useState(null)
  const [directoryErrors, setDirectoryErrors] = useState([])
  const [audience, setAudience] = useState(null)
  const [audienceLoading, setAudienceLoading] = useState(true)
  const [audienceError, setAudienceError] = useState('')
  const [history, setHistory] = useState([])
  const [historyError, setHistoryError] = useState('')
  const [loading, setLoading] = useState(true)
  const [hSearch, setHSearch] = useState('')
  const [hPeriod, setHPeriod] = useState('all')
  const [hAudience, setHAudience] = useState('all')
  const [hPush, setHPush] = useState('all')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [followUp, setFollowUp] = useState({ title: '', assigneeIds: [], due: '', site: '' })
  const [taskSaving, setTaskSaving] = useState(false)
  const [taskResults, setTaskResults] = useState([])
  const [taskError, setTaskError] = useState('')
  const [everyoneConfirmed, setEveryoneConfirmed] = useState(false)
  const [followUps, setFollowUps] = useState([])
  const [followUpsError, setFollowUpsError] = useState('')
  const [followUpsLoading, setFollowUpsLoading] = useState(false)

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const load = useCallback(async () => {
    setLoading(true); setError(''); setHistoryError('')
    try {
      const [dir, hi] = await Promise.all([
        loadAudienceDirectory(),
        // A failed history read must not render as "nothing sent yet".
        listBroadcasts().catch((e) => {
          setHistoryError(toUserMessage(e, 'Sent messages could not be loaded.'))
          return []
        }),
      ])
      setDirectory(dir)
      setDirectoryErrors(dir.errors || [])
      setHistory(Array.isArray(hi) ? hi : [])
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the message centre.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const loadFollowUps = useCallback(async () => {
    setFollowUpsLoading(true); setFollowUpsError('')
    try {
      const rows = await listActionItems({ country: activeCountry, limit: 2000 })
      setFollowUps(rows.filter((row) => String(row.source || '').startsWith('broadcast:')))
    } catch (e) { setFollowUpsError(toUserMessage(e, 'Could not load follow-up tasks.')) }
    finally { setFollowUpsLoading(false) }
  }, [activeCountry])
  useEffect(() => { loadFollowUps() }, [loadFollowUps])

  const roleOptions = useMemo(() => (directory ? buildRoleOptions({ ...directory, orgId }) : []), [directory, orgId])
  const countryOptions = useMemo(() => (directory ? buildCountryOptions({ ...directory, orgId }) : []), [directory, orgId])
  const allSiteOptions = useMemo(() => (directory
    ? buildSiteDirectory({ sites: directory.sites, aliases: directory.aliases, orgId }) : []), [directory, orgId])
  // The country filter only narrows what is OFFERED. A site already chosen stays
  // on offer (and as a chip) instead of being silently dropped.
  const siteOptions = useMemo(() => (directory
    ? buildSiteDirectory({ sites: directory.sites, aliases: directory.aliases, orgId, countries, keep: sites })
    : []), [directory, orgId, countries, sites])
  const employeeOptions = useMemo(() => (directory ? buildEmployeeOptions({ profiles: directory.profiles, orgId }) : []), [directory, orgId])

  // Once the directory is known, a selection that is not in it (a country the
  // organisation does not have, a role nobody holds) can only produce an empty
  // or wrong audience, so it is removed.
  useEffect(() => {
    if (!directory) return
    setRoles((r) => pruneSelection(r, roleOptions))
    setCountries((c) => pruneSelection(c, countryOptions))
    setSites((x) => pruneSelection(x, allSiteOptions))
  }, [directory, roleOptions, countryOptions, allSiteOptions])

  // A selection invalidates the previous audience immediately. A stale count
  // must never authorize sending to a different set of recipients. Nothing is
  // previewed until the directory has loaded and been reconciled.
  const directoryReady = Boolean(directory)
  useEffect(() => {
    if (!directoryReady) return undefined
    let alive = true
    setEveryoneConfirmed(false)
    setAudience(null)
    setAudienceError('')
    setAudienceLoading(true)
    previewAudience({ roles, countries, sites })
      .then((response) => {
        if (!alive) return
        if (!response?.ok) {
          setAudienceError('Recipient preview is unavailable. Check audience permissions or retry.')
        } else setAudience(response)
      })
      .catch((e) => {
        if (alive) setAudienceError(toUserMessage(e, 'Could not verify the selected recipients.'))
      })
      .finally(() => { if (alive) setAudienceLoading(false) })
    return () => { alive = false }
  }, [roles, countries, sites, directoryReady])

  const problem = useMemo(() => validateBroadcast(form), [form])
  const everyone = isEveryone({ roles, countries, sites })
  const canSend = !problem && !sending && directoryReady && !audienceLoading && !audienceError
    && audience?.ok && (audience?.total ?? 0) > 0 && (!everyone || everyoneConfirmed)

  async function send() {
    setSending(true); setError(''); setResult(null); setTaskResults([]); setTaskError('')
    try {
      const r = await sendBroadcast({ ...form, roles, countries, sites })
      if (!r.ok) {
        setError(r.reason === 'empty'
          ? 'The message needs a title and a body.'
          : 'The message could not be sent.')
        return
      }
      setResult(r)
      setFollowUp({ title: form.title, assigneeIds: [], due: '', site: sites.length === 1 ? sites[0] : '' })
      setEveryoneConfirmed(false)
      setForm({ title: '', body: '', titleAr: '', bodyAr: '', sendPush: true })
      setHistory(await listBroadcasts().catch(() => history))
    } catch (e) {
      setError(toUserMessage(e, 'The message could not be sent.'))
    } finally { setSending(false) }
  }

  // A task is deliberately a separate, explicit action after sending. An Action
  // Center item has ONE owner, so choosing several people creates one task each.
  // The source key carries the person, so a retry (or a partial failure followed
  // by a retry) never duplicates a task that already exists.
  const profileById = useMemo(
    () => new Map((directory?.profiles || []).map((person) => [String(person.id), person])), [directory])

  async function createFollowUp() {
    if (!result?.ok || !result.id || taskSaving) return
    if (!followUp.title.trim() || !followUp.assigneeIds.length || !followUp.due) {
      setTaskError('Enter a task title, at least one responsible person and a due date.')
      return
    }
    const done = new Set(taskResults.filter((r) => r.ok).map((r) => r.userId))
    const pending = followUp.assigneeIds.filter((id) => !done.has(id))
    setTaskSaving(true); setTaskError('')
    const next = taskResults.filter((r) => r.ok)
    for (const userId of pending) {
      const employee = profileById.get(String(userId))
      const name = employee ? (employee.full_name || employee.username || employee.id) : String(userId)
      if (!employee) { next.push({ userId, name, ok: false, error: 'Not an active employee account.' }); continue }
      try {
        const { item } = await ensureActionItem({
          title: followUp.title.trim(),
          source: `broadcast:${result.id}:${employee.id}`,
          category: 'other',
          severity: 'medium',
          assigned_to: name,
          assigned_user_id: employee.id,
          due_date: followUp.due,
          site: followUp.site || null,
          country: countries.length === 1 ? countries[0] : null,
          recommended_action: 'Follow up on the team communication and record completion evidence.',
          notes: `Follow-up to team message ${result.id}. Created by Message the Team.`,
        })
        if (!item?.id) throw new Error('Task was not confirmed by Action Center.')
        next.push({ userId, name, ok: true, item })
      } catch (e) {
        next.push({ userId, name, ok: false, error: toUserMessage(e, 'Could not create the task.') })
      }
    }
    setTaskResults(next)
    const failed = next.filter((r) => !r.ok).length
    if (failed) setTaskError(`${failed} task${failed === 1 ? '' : 's'} could not be created. Retry to create only the missing ones.`)
    await loadFollowUps()
    setTaskSaving(false)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Megaphone}
        title="Message the team"
        subtitle="Goes to their in-app inbox, and to their phone if they have the app signed in."
        actions={(
          <button onClick={load} className="btn-ghost" type="button">
            <RefreshCcw size={14} /> Refresh
          </button>
        )}
      />

      <section className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)] px-5 py-4 sm:px-7" aria-label="Team communication">
        <div className="flex items-center justify-between gap-5">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">Connected communication</p>
            <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">Reach the right team. Follow through on every action.</h2>
            <p className="text-sm text-[var(--text-secondary)]">Publish targeted instructions to the in-app inbox, queue optional phone alerts, then assign accountable follow-up work through Action Center.</p>
          </div>
          <div className="hidden sm:block shrink-0" aria-hidden="true"><Illustration name="module/notifications" size={166} animate={false} /></div>
        </div>
      </section>

      {error && (
        <div className="card border-amber-500/40 flex items-start gap-2 text-sm text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {result?.ok && (
        <div className="card border-emerald-500/40 flex items-start gap-2 text-sm text-emerald-300">
          <Check size={16} className="mt-0.5 shrink-0" />
          Sent to {result.recipients} {result.recipients === 1 ? 'person' : 'people'}
          {result.pushes_queued > 0
            ? `, and ${result.pushes_queued} phone ${result.pushes_queued === 1 ? 'push was' : 'pushes were'} queued.`
            : '. Nobody in that audience has the phone app signed in yet, so no push was sent.'}
        </div>
      )}

      {result?.ok && (
        <section className="card space-y-3" aria-label="Create a follow-up task">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-semibold text-[var(--text-primary)]">Assign follow-up work</h3>
              <p className="text-xs text-[var(--text-secondary)]">Optional: create a real Action Center task linked to this sent message. This does not send a second broadcast.</p></div>
            <span className="text-xs text-[var(--text-muted)]">Message ID: {result.id || 'Unavailable'}</span>
          </div>
          {taskResults.length > 0 && (
            <div role="status" className="rounded-lg border border-emerald-500/40 p-3 text-sm text-[var(--text-primary)]">
              <Check size={15} className="inline mr-2 text-emerald-500" />
              {taskResults.filter((r) => r.ok).length} of {taskResults.length} task{taskResults.length === 1 ? '' : 's'} created in Action Center.
              <a href="/action-center" className="ml-2 underline text-[var(--accent)]">Open Action Center</a>
              <ul className="mt-2 space-y-0.5 text-xs text-[var(--text-secondary)]">
                {taskResults.map((r) => (
                  <li key={r.userId}>{r.ok ? 'Created' : 'Failed'}: {r.name}{r.ok ? '' : ` (${r.error})`}</li>
                ))}
              </ul>
            </div>
          )}
          {!(taskResults.length > 0 && taskResults.every((r) => r.ok)
            && followUp.assigneeIds.every((id) => taskResults.some((r) => r.userId === id && r.ok))) && (
            <div className="grid gap-3 md:grid-cols-4">
              <label className="flex flex-col gap-1 md:col-span-2"><span className={labelCls}>Task title</span>
                <input className={inputCls} maxLength={300} value={followUp.title} onChange={(e) => setFollowUp((f) => ({ ...f, title: e.target.value }))} /></label>
              <label className="flex flex-col gap-1"><span className={labelCls}>Due date</span>
                <input className={inputCls} type="date" value={followUp.due} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFollowUp((f) => ({ ...f, due: e.target.value }))} /></label>
              <label className="flex flex-col gap-1"><span className={labelCls}>Site (optional)</span>
                <select className={inputCls} value={followUp.site} onChange={(e) => setFollowUp((f) => ({ ...f, site: e.target.value }))}>
                  <option value="">No specific site</option>
                  {allSiteOptions.map((o) => <option key={o.value} value={o.value}>{o.value}{o.hint ? ` (${o.hint})` : ''}</option>)}
                </select></label>
              <div className="md:col-span-4">
                <MultiCombobox label="Responsible people" pluralLabel="people" allLabel="Nobody chosen"
                  hint="Search by name, username, employee ID, role, site or an Arabic name. One task is created per person."
                  placeholder="Search employees"
                  options={employeeOptions} value={followUp.assigneeIds}
                  onChange={(ids) => setFollowUp((f) => ({ ...f, assigneeIds: ids }))} />
                {directoryErrors.includes('people') && <p role="alert" className="mt-1 text-xs text-red-400">Could not load a complete employee list.</p>}
              </div>
              <div className="md:col-span-4 flex flex-wrap items-center gap-3 justify-end">
                {taskError && <p role="alert" className="text-xs text-red-400">{taskError}</p>}
                <button type="button" onClick={createFollowUp} disabled={taskSaving || !result.id} className="btn-primary disabled:opacity-40">
                  {taskSaving ? 'Creating tasks...' : `Create ${followUp.assigneeIds.length > 1 ? `${followUp.assigneeIds.length} Action Center tasks` : 'Action Center task'}`}
                </button>
              </div>
            </div>
          )}
          <p className="text-[11px] text-[var(--text-tertiary)]">Assignment is linked to an employee account and stored as an Action Center item. Automatic task-assignment phone push and recipient read receipts are not yet enabled by this change.</p>
        </section>
      )}

      <div className="card space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Title</span>
            <input className={inputCls} value={form.title} maxLength={120}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Site meeting tomorrow" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Title in Arabic (optional)</span>
            <input className={inputCls} dir="rtl" value={form.titleAr}
              onChange={(e) => set({ titleAr: e.target.value })} />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Message</span>
            <textarea className={inputCls} rows={4} value={form.body}
              onChange={(e) => set({ body: e.target.value })}
              placeholder="All supervisors report to NHC at 07:00." />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Message in Arabic (optional)</span>
            <textarea className={inputCls} rows={4} dir="rtl" value={form.bodyAr}
              onChange={(e) => set({ bodyAr: e.target.value })} />
          </label>
        </div>

        {/* Deliberately not auto-translated. A machine translation of an
            operational instruction that nobody checked is worse than none. */}
        <p className="text-[11px] text-[var(--text-tertiary)]">
          Arabic is optional and is never translated for you. If you write it, anyone whose app is
          set to Arabic reads the Arabic version, and anyone whose language is not known yet
          receives both rather than losing half the message.
        </p>

        <section aria-label="Message audience" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--input-bg)]/30 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Who should receive this?</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Choose job roles, countries and sites. Filters work together to narrow the audience.</p>
            </div>
            <button type="button" onClick={() => { setRoles([]); setCountries([]); setSites([]) }}
              className="text-xs text-[var(--accent)] underline underline-offset-2">Reset audience</button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MultiCombobox label="Job role" pluralLabel="job roles" allLabel="All job roles"
              hint="Roles actually held by active people in your organisation, plus your custom roles. Leave empty for all."
              options={roleOptions} value={roles} onChange={setRoles} />
            <MultiCombobox label="Country" pluralLabel="countries" allLabel="All countries"
              hint="Countries your organisation operates in."
              options={countryOptions} value={countries} onChange={setCountries} />
            <MultiCombobox label="Site" pluralLabel="sites" allLabel="All sites"
              hint="Active registered sites. Choosing a country narrows this list; sites you already picked stay selected."
              options={siteOptions} value={sites} onChange={setSites} />
          </div>
          {directoryErrors.length > 0 && (
            <p role="alert" className="text-xs text-amber-400">
              Could not load the complete list of {directoryErrors.join(', ')}. Some choices may be missing; refresh to retry.
            </p>
          )}
          <p className="text-xs text-[var(--text-secondary)]">
            Audience: {audienceSummary({ roles, countries, sites })}
          </p>
          {everyone && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 p-3 text-sm text-amber-300">
              <input type="checkbox" className="mt-0.5" checked={everyoneConfirmed}
                onChange={(e) => setEveryoneConfirmed(e.target.checked)} />
              <span>No filter is selected, so this message goes to everyone in your organisation
                {audience?.ok ? ` (${audience.total} ${audience.total === 1 ? 'person' : 'people'})` : ''}. Tick to confirm.</span>
            </label>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Users size={14} /> {audienceLoading ? 'Checking...' : audience ? audience.total : 'N/A'} recipients in the app
            </span>
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Smartphone size={14} /> {audienceLoading ? 'Checking...' : audience ? audience.with_app : 'N/A'} signed-in phones
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={form.sendPush}
              onChange={(e) => set({ sendPush: e.target.checked })} />
            Also send a phone notification
          </label>
        </div>

        {audienceError && <p role="alert" className="text-xs text-red-400">{audienceError}</p>}
        {!audienceLoading && audience?.total === 0 && <p role="status" className="text-xs text-amber-400">No active recipients match these filters. Adjust the audience before sending.</p>}
        {audience && (
          <p className="text-[11px] text-[var(--text-tertiary)]">{reachNote(audience)}</p>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-amber-400">{problem}</span>
          <button type="button" onClick={send} disabled={!canSend}
            className="btn-primary disabled:opacity-40">
            <Send size={14} /> {sending ? 'Sending' : 'Send'}
          </button>
        </div>
      </div>

      <section className="card space-y-3" aria-label="Message follow-up tasks">
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="text-sm font-semibold text-[var(--text-primary)]">Message follow-up tasks</h3>
            <p className="text-xs text-[var(--text-secondary)]">Actions created from sent communications. Progress and completion are managed in Action Center.</p></div>
          <button type="button" className="btn-ghost text-xs" onClick={loadFollowUps} disabled={followUpsLoading}><RefreshCcw size={13} /> Refresh</button>
        </div>
        {followUpsError && <p role="alert" className="text-sm text-red-400">{followUpsError}</p>}
        {followUpsLoading && <p role="status" className="text-xs text-[var(--text-muted)]">Loading tasks...</p>}
        {!followUpsLoading && !followUpsError && !followUps.length && <p className="text-xs text-[var(--text-muted)]">No follow-up tasks found in the current country scope.</p>}
        {followUps.length > 0 && (
          <EnterpriseTable
            columns={followUpColumns}
            data={followUps}
            getRowId={(task) => String(task.id)}
            enableGlobalFilter
            enableExport={false}
            initialPageSize={10}
            emptyMessage="No follow-up tasks match"
          />
        )}
      </section>

      <MessageEngagement history={history} />

      <HistorySection
        history={history}
        loading={loading}
        error={historyError}
        onRetry={load}
        search={hSearch} setSearch={setHSearch}
        period={hPeriod} setPeriod={setHPeriod}
        audienceFilter={hAudience} setAudienceFilter={setHAudience}
        push={hPush} setPush={setHPush}
      />
    </div>
  )
}

const followUpColumns = [
  { id: 'title', header: 'Task', accessorFn: (t) => t.title || '', size: 280,
    cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.title}</span> },
  { id: 'assigned', header: 'Assigned to', accessorFn: (t) => t.assigned_to || 'Unassigned', size: 160 },
  { id: 'due', header: 'Due', accessorFn: (t) => t.due_date || 'Not set', size: 110 },
  { id: 'status', header: 'Status', accessorFn: (t) => String(t.status || 'open').replaceAll('_', ' '), size: 110 },
  { id: 'open', header: 'Action', enableSorting: false, accessorFn: () => '', size: 80,
    cell: () => <a className="text-[var(--accent)] underline" href="/action-center">Open</a> },
]

const selectCls = 'rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-sm text-[var(--text-primary)]'
const EXPORT_COLS = ['sent', 'title', 'body', 'audience', 'recipients', 'pushes', 'arabic', 'status']
const EXPORT_HEADERS = ['Sent', 'Title', 'Message', 'Audience', 'In the app', 'Phone pushes', 'Arabic', 'Status']

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-3 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]"><Icon size={12} /> {label}</div>
      <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--text-primary)]">{value}</p>
      {hint && <p className="text-[11px] text-[var(--text-tertiary)] truncate" title={hint}>{hint}</p>}
    </div>
  )
}

/** Sent-message register: KPIs, filters, table, export. */
function HistorySection({
  history, loading, error, onRetry,
  search, setSearch, period, setPeriod, audienceFilter, setAudienceFilter, push, setPush,
}) {
  const [now] = useState(() => Date.now())
  const filtered = useMemo(
    () => filterBroadcasts(history, { search, period, audience: audienceFilter, push, now, labelFn: audienceLabel }),
    [history, search, period, audienceFilter, push, now],
  )
  const k = useMemo(() => broadcastKpis(filtered, now), [filtered, now])
  const topRoles = useMemo(() => targetBreakdown(filtered, 'target_roles').slice(0, 5), [filtered])
  const months = useMemo(() => monthlyVolume(filtered, now, 6), [filtered, now])
  const maxMonth = Math.max(1, ...months.map((m) => m.messages))
  const filtersActive = search.trim() !== '' || period !== 'all' || audienceFilter !== 'all' || push !== 'all'

  const columns = useMemo(() => [
    {
      id: 'sent', header: 'Sent', accessorFn: (m) => broadcastTime(m) ?? 0, size: 130,
      cell: ({ row }) => <span className="whitespace-nowrap text-xs">{fmtDate(row.original.sent_at || row.original.created_at) || 'N/A'}</span>,
    },
    {
      id: 'title', header: 'Message', accessorFn: (m) => m.title || '', size: 320,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{row.original.title || 'N/A'}</p>
          <p className="text-xs text-[var(--text-secondary)] line-clamp-2 whitespace-pre-line">{row.original.body}</p>
        </div>
      ),
    },
    { id: 'audience', header: 'Audience', accessorFn: (m) => audienceLabel(m), size: 200 },
    { id: 'recipients', header: 'In the app', accessorFn: (m) => Number(m.recipient_count) || 0, size: 90, meta: { align: 'right' } },
    {
      id: 'pushes', header: 'Phone', accessorFn: (m) => Number(m.push_count) || 0, size: 80, meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() > 0 ? getValue() : <span className="text-[var(--text-tertiary)]">none</span>),
    },
    { id: 'arabic', header: 'Arabic', accessorFn: (m) => (hasArabic(m) ? 'Yes' : 'No'), size: 70 },
    { id: 'status', header: 'Status', accessorFn: (m) => m.status || 'N/A', size: 90 },
  ], [])

  const exportRows = broadcastExportRows(filtered, audienceLabel)
  const doExcel = () => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'team_messages')
  const doPdf = () => exportToPdf(exportRows, EXPORT_COLS.map((c, i) => ({ key: c, header: EXPORT_HEADERS[i] })), 'Team Messages', 'team_messages', 'landscape')

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Sent messages</h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={doExcel} disabled={!exportRows.length} className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-40">
            <Download size={13} /> Excel
          </button>
          <button type="button" onClick={doPdf} disabled={!exportRows.length} className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-40">
            <FileText size={13} /> PDF
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 p-3 text-sm text-amber-300">
          <span className="flex items-center gap-2"><AlertTriangle size={14} /> {error}</span>
          <button type="button" onClick={onRetry} className="btn-secondary text-xs">Retry</button>
        </div>
      ) : loading ? (
        <p className="text-sm text-[var(--text-tertiary)]">Loading</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">
          Nothing sent yet. Messages you send appear here with who received them.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            <Stat icon={Megaphone} label="Messages" value={k.messages} hint={`${k.last30Days} in the last 30 days`} />
            <Stat icon={Inbox} label="Addressed in the app" value={k.recipients}
              hint={k.avgRecipients == null ? 'N/A' : `${k.avgRecipients} per message on average`} />
            <Stat icon={Smartphone} label="Phone pushes queued" value={k.pushes}
              hint={k.phoneReachPct == null ? 'No recipients' : `${k.phoneReachPct}% of recipients`} />
            <Stat icon={Users} label="Targeted" value={k.targeted} hint={`${k.everyone} went to everyone`} />
            <Stat icon={Languages} label="With Arabic" value={k.arabicPct == null ? 'N/A' : `${k.arabicPct}%`} hint={`${k.arabic} messages`} />
            <Stat icon={Clock} label="Last sent" value={k.daysSinceLast == null ? 'N/A' : `${k.daysSinceLast} d ago`}
              hint={k.lastSentAt ? fmtDate(k.lastSentAt) : undefined} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-[var(--border-subtle)] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Messages per month</p>
              <div className="flex items-end gap-2 h-20" role="img" aria-label="Messages per month for the last six months">
                {months.map((m) => (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div className="w-full rounded-t bg-[var(--accent)]/60" style={{ height: `${(m.messages / maxMonth) * 100}%`, minHeight: m.messages ? 4 : 0 }} title={`${m.key}: ${m.messages} messages, ${m.recipients} recipients`} />
                    <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">{m.key.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Most messaged job titles</p>
              {topRoles.length === 0 ? (
                <p className="text-xs text-[var(--text-tertiary)]">No message in this view was narrowed by job title.</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {topRoles.map((r) => (
                    <li key={r.value} className="flex justify-between gap-2">
                      <span className="truncate text-[var(--text-secondary)]">{r.value}</span>
                      <span className="tabular-nums text-[var(--text-primary)]">{r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input className={`${inputCls} pl-8`} value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, message or audience" aria-label="Search sent messages" />
            </div>
            <select className={selectCls} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
              {BROADCAST_PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select className={selectCls} value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value)} aria-label="Audience">
              <option value="all">Any audience</option>
              <option value="everyone">Everyone</option>
              <option value="targeted">Targeted</option>
            </select>
            <select className={selectCls} value={push} onChange={(e) => setPush(e.target.value)} aria-label="Phone push">
              <option value="all">Push or not</option>
              <option value="push">With phone push</option>
              <option value="nopush">No phone push</option>
            </select>
            {filtersActive && (
              <button type="button" className="btn-ghost text-xs"
                onClick={() => { setSearch(''); setPeriod('all'); setAudienceFilter('all'); setPush('all') }}>Clear</button>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {filtered.length} of {history.length} messages shown. Counts are people addressed and pushes queued;
            the system records no read receipts, so nothing here confirms a message was read.
          </p>

          <EnterpriseTable
            columns={columns}
            data={filtered}
            getRowId={(m) => String(m.id)}
            enableGlobalFilter={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No sent messages match the current filters"
          />
        </>
      )}
    </div>
  )
}
