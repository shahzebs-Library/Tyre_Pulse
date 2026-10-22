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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Megaphone, Send, RefreshCcw, Users, Smartphone, AlertTriangle, Check,
  Download, FileText, Search, Languages, Inbox, Clock, ChevronDown, X, CheckCheck,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Illustration from '../components/illustrations/Illustration'
import MessageEngagement from '../components/team/MessageEngagement'
import { ensureActionItem, listActionItems } from '../lib/api/actionCenter'
import { supabase, fetchAllPages } from '../lib/api/_client'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  BROADCAST_PERIODS, filterBroadcasts, broadcastKpis, targetBreakdown,
  monthlyVolume, broadcastExportRows, hasArabic, broadcastTime,
} from '../lib/broadcastAnalytics'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import {
  previewAudience, sendBroadcast, listBroadcasts,
  audienceLabel, validateBroadcast, reachNote,
} from '../lib/api/broadcast'
import { listAssignableRoles, ASSIGNABLE_BUILTIN_ROLES } from '../lib/api/customRoles'
import { listSites } from '../lib/api/sites'
import { toUserMessage } from '../lib/safeError'

const inputCls = 'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]'
const labelCls = 'text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]'

const fmtDate = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? String(d)
    : dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Searchable, compact multi-select. Empty selection explicitly means the full audience. */
function AudienceSelect({ label, options, value, onChange, allLabel, hint }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef(null)
  const searchRef = useRef(null)
  const visible = useMemo(() => options.filter((item) =>
    String(item).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [options, query])
  const toggle = (item) => onChange(value.includes(item)
    ? value.filter((selected) => selected !== item) : [...value, item])

  useEffect(() => {
    if (!open) return undefined
    const outside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    searchRef.current?.focus()
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={root} className="relative min-w-0">
      <label className={labelCls}>{label}</label>
      <button type="button" aria-label={`Select ${label.toLowerCase()}`}
        aria-expanded={open} aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
        className={`${inputCls} mt-1 flex min-h-10 items-center justify-between gap-2 text-left hover:border-[var(--accent)]`}>
        <span className="min-w-0 truncate">{value.length === 0
          ? allLabel : value.length === 1 ? value[0] : `${value.length} selected`}</span>
        <ChevronDown size={16} className="shrink-0 text-[var(--text-muted)]" />
      </button>
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p>
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {value.slice(0, 3).map((item) => (
            <button key={item} type="button" onClick={() => toggle(item)}
              title={`Remove ${item}`}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--input-bg)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
              <span className="truncate">{item}</span><X size={12} />
            </button>
          ))}
          {value.length > 3 && <span className="px-2 py-1 text-xs text-[var(--text-muted)]">+{value.length - 3} more</span>}
        </div>
      )}
      {open && (
        <div role="group" aria-label={`${label} options`}
          className="absolute left-0 right-0 top-full z-40 mt-2 min-w-[240px] rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg)] p-3 shadow-xl">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-[var(--text-muted)]" />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
              aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`}
              className={`${inputCls} pl-9`} />
          </div>
          <div className="my-2 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
            <button type="button" onClick={() => onChange([])}
              className="text-xs font-medium text-[var(--accent)]">{allLabel}</button>
            <button type="button" disabled={visible.length === 0}
              onClick={() => onChange([...new Set([...value, ...visible])])}
              className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] disabled:opacity-40">
              <CheckCheck size={13} /> Select matches
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto" role="group" aria-label={label}>
            {visible.length === 0 ? (
              <p className="px-2 py-3 text-xs text-[var(--text-muted)]">No matching options.</p>
            ) : visible.map((item) => (
              <label key={item} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--hover-bg)]">
                <input type="checkbox" checked={value.includes(item)}
                  onChange={() => toggle(item)} className="accent-[var(--accent)]" />
                <span className="break-words">{item}</span>
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 text-xs text-[var(--text-muted)]">
            <span>{value.length ? `${value.length} selected` : allLabel}</span>
            <button type="button" onClick={() => { setOpen(false); setQuery('') }}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 font-semibold text-white">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Broadcast() {
  const { activeCountry } = useSettings()
  const [form, setForm] = useState({
    title: '', body: '', titleAr: '', bodyAr: '', sendPush: true,
  })
  const [roles, setRoles] = useState([])
  const [countries, setCountries] = useState(
    activeCountry && activeCountry !== 'All' ? [activeCountry] : [])
  const [sites, setSites] = useState([])

  const [roleOptions, setRoleOptions] = useState(ASSIGNABLE_BUILTIN_ROLES)
  const [siteOptions, setSiteOptions] = useState([])
  const [siteRecords, setSiteRecords] = useState([])
  const [audience, setAudience] = useState(null)
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
  const [followUp, setFollowUp] = useState({ title: '', assigneeId: '', due: '', site: '' })
  const [taskSaving, setTaskSaving] = useState(false)
  const [taskResult, setTaskResult] = useState(null)
  const [taskError, setTaskError] = useState('')
  const [assignees, setAssignees] = useState([])
  const [assigneeError, setAssigneeError] = useState('')
  const [followUps, setFollowUps] = useState([])
  const [followUpsError, setFollowUpsError] = useState('')
  const [followUpsLoading, setFollowUpsLoading] = useState(false)

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const load = useCallback(async () => {
    setLoading(true); setError(''); setHistoryError('')
    try {
      const [ro, si, hi] = await Promise.all([
        listAssignableRoles().catch(() => ASSIGNABLE_BUILTIN_ROLES),
        listSites().catch(() => []),
        // A failed history read must not render as "nothing sent yet".
        listBroadcasts().catch((e) => {
          setHistoryError(toUserMessage(e, 'Sent messages could not be loaded.'))
          return []
        }),
      ])
      setRoleOptions(Array.isArray(ro) && ro.length ? ro : ASSIGNABLE_BUILTIN_ROLES)
      setSiteRecords(si || [])
      setSiteOptions([...new Set((si || []).map((s) => s.name || s.site_name).filter(Boolean))].sort())
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

  useEffect(() => {
    let mounted = true
    async function loadAssignees() {
      const result = await fetchAllPages((from, to) => supabase.from('profiles')
        .select('id,full_name,username,site,country,approved,locked')
        .eq('approved', true).eq('locked', false)
        .order('id', { ascending: true }).range(from, to), { max: 20000 })
      if (!mounted) return
      if (result.error || result.truncated) { setAssigneeError('Could not load a complete employee list.'); setAssignees([]) }
      else { setAssignees(result.data || []); setAssigneeError('') }
    }
    loadAssignees().catch(() => { if (mounted) setAssigneeError('Could not load employee accounts.') })
    return () => { mounted = false }
  }, [])

  // Re-count whenever the audience changes, so the number on screen always
  // describes the audience currently selected rather than a previous one.
  useEffect(() => {
    let alive = true
    previewAudience({ roles, countries, sites })
      .then((a) => { if (alive) setAudience(a) })
      .catch(() => { if (alive) setAudience(null) })
    return () => { alive = false }
  }, [roles, countries, sites])

  const visibleSiteOptions = useMemo(() => {
    if (!countries.length) return siteOptions
    const available = siteRecords.filter((site) => !site.country || countries.includes(site.country))
    return [...new Set([...available.map((site) => site.name || site.site_name).filter(Boolean), ...sites])].sort()
  }, [siteOptions, siteRecords, countries, sites])

  const problem = useMemo(() => validateBroadcast(form), [form])
  const canSend = !problem && !sending && (audience?.total ?? 0) > 0

  async function send() {
    setSending(true); setError(''); setResult(null); setTaskResult(null); setTaskError('')
    try {
      const r = await sendBroadcast({ ...form, roles, countries, sites })
      if (!r.ok) {
        setError(r.reason === 'empty'
          ? 'The message needs a title and a body.'
          : 'The message could not be sent.')
        return
      }
      setResult(r)
      setFollowUp({ title: form.title, assigneeId: '', due: '', site: sites.length === 1 ? sites[0] : '' })
      setForm({ title: '', body: '', titleAr: '', bodyAr: '', sendPush: true })
      setHistory(await listBroadcasts().catch(() => history))
    } catch (e) {
      setError(toUserMessage(e, 'The message could not be sent.'))
    } finally { setSending(false) }
  }

  // A task is deliberately a separate, explicit action after sending. A message
  // can reach several people, whereas an Action Center item has one owner.
  // Retrying this operation uses a stable source key to avoid duplicate actions.
  async function createFollowUp() {
    if (!result?.ok || !result.id || taskSaving || taskResult) return
    if (!followUp.title.trim() || !followUp.assigneeId || !followUp.due) {
      setTaskError('Enter a task title, responsible person and due date.')
      return
    }
    const employee = assignees.find((person) => person.id === followUp.assigneeId)
    if (!employee) { setTaskError('Choose a valid active employee account.'); return }
    setTaskSaving(true); setTaskError('')
    try {
      const { item } = await ensureActionItem({
        title: followUp.title.trim(),
        source: `broadcast:${result.id}`,
        category: 'other',
        severity: 'medium',
        assigned_to: employee.full_name || employee.username || employee.id,
        assigned_user_id: employee.id,
        due_date: followUp.due,
        site: followUp.site.trim() || null,
        country: countries.length === 1 ? countries[0] : null,
        recommended_action: 'Follow up on the team communication and record completion evidence.',
        notes: `Follow-up to team message ${result.id}. Created by Message the Team.`,
      })
      if (!item?.id) throw new Error('Task was not confirmed by Action Center.')
      setTaskResult(item)
      await loadFollowUps()
    } catch (e) { setTaskError(toUserMessage(e, 'Could not create the follow-up task.')) }
    finally { setTaskSaving(false) }
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
          {taskResult ? (
            <div role="status" className="rounded-lg border border-emerald-500/40 p-3 text-sm text-[var(--text-primary)]">
              <Check size={15} className="inline mr-2 text-emerald-500" />Task created in Action Center: {taskResult.title}. Status: {taskResult.status || 'open'}.
              <a href="/action-center" className="ml-2 underline text-[var(--accent)]">Open Action Center</a>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-4">
              <label className="flex flex-col gap-1 md:col-span-2"><span className={labelCls}>Task title</span>
                <input className={inputCls} maxLength={300} value={followUp.title} onChange={(e) => setFollowUp((f) => ({ ...f, title: e.target.value }))} /></label>
              <label className="flex flex-col gap-1"><span className={labelCls}>Responsible person</span>
                <select className={inputCls} value={followUp.assigneeId} onChange={(e) => setFollowUp((f) => ({ ...f, assigneeId: e.target.value }))}>
                  <option value="">Select employee account</option>
                  {assignees.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.username || person.id}{person.site ? ` · ${person.site}` : ''}</option>)}
                </select>
                {assigneeError && <span className="text-xs text-red-400">{assigneeError}</span>}</label>
              <label className="flex flex-col gap-1"><span className={labelCls}>Due date</span>
                <input className={inputCls} type="date" value={followUp.due} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFollowUp((f) => ({ ...f, due: e.target.value }))} /></label>
              <label className="flex flex-col gap-1"><span className={labelCls}>Site (optional)</span>
                <input className={inputCls} value={followUp.site} onChange={(e) => setFollowUp((f) => ({ ...f, site: e.target.value }))} /></label>
              <div className="md:col-span-3 flex flex-wrap items-center gap-3 justify-end">
                {taskError && <p role="alert" className="text-xs text-red-400">{taskError}</p>}
                <button type="button" onClick={createFollowUp} disabled={taskSaving || !result.id} className="btn-primary disabled:opacity-40">{taskSaving ? 'Creating task…' : 'Create Action Center task'}</button>
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
          <div className="grid gap-3 md:grid-cols-3">
            <AudienceSelect label="Job role" allLabel="All job roles"
              hint="Select specific employee roles or leave everyone."
              options={roleOptions} value={roles} onChange={setRoles} />
            <AudienceSelect label="Country" allLabel="All countries"
              hint="Restrict by operating country."
              options={COUNTRIES} value={countries} onChange={setCountries} />
            <AudienceSelect label="Site" allLabel="All sites"
              hint="Find sites by name without scrolling through the entire register."
              options={visibleSiteOptions} value={sites} onChange={setSites} />
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Audience: {roles.length ? roles.join(', ') : 'All roles'} · {countries.length ? countries.join(', ') : 'All countries'} · {sites.length ? `${sites.length} selected site(s)` : 'All sites'}
          </p>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Users size={14} /> {audience ? audience.total : '-'} in the app
            </span>
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Smartphone size={14} /> {audience ? audience.with_app : '-'} with a phone
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={form.sendPush}
              onChange={(e) => set({ sendPush: e.target.checked })} />
            Also send a phone notification
          </label>
        </div>

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
        {followUpsLoading && <p role="status" className="text-xs text-[var(--text-muted)]">Loading tasks…</p>}
        {!followUpsLoading && !followUpsError && !followUps.length && <p className="text-xs text-[var(--text-muted)]">No follow-up tasks found in the current country scope.</p>}
        {followUps.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs text-left">
              <thead><tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                <th className="px-2 py-2">Task</th><th className="px-2 py-2">Assigned to</th><th className="px-2 py-2">Due</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Action</th>
              </tr></thead>
              <tbody>{followUps.slice(0, 50).map((task) => (
                <tr key={task.id} className="border-b border-[var(--border-subtle)]">
                  <td className="px-2 py-3 font-medium text-[var(--text-primary)]">{task.title}</td>
                  <td className="px-2 py-3 text-[var(--text-secondary)]">{task.assigned_to || 'Unassigned'}</td>
                  <td className="px-2 py-3 text-[var(--text-secondary)]">{task.due_date || 'Not set'}</td>
                  <td className="px-2 py-3 text-[var(--text-secondary)]">{String(task.status || 'open').replaceAll('_', ' ')}</td>
                  <td className="px-2 py-3"><a className="text-[var(--accent)] underline" href="/action-center">Open</a></td>
                </tr>
              ))}</tbody>
            </table>
            {followUps.length > 50 && <p className="text-xs text-[var(--text-muted)] p-2">Showing the latest 50 tasks. Open Action Center for the complete register.</p>}
          </div>
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
