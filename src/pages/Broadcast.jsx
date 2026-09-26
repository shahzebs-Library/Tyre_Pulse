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

/** Multi-select rendered as toggle chips - a native multi-select is unusable on a phone. */
function ChipPicker({ label, options, value, onChange, allLabel }) {
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : value.concat(v))
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelCls}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onChange([])}
          className={`rounded-full px-3 py-1 text-xs border transition ${
            value.length === 0
              ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
              : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
          {allLabel}
        </button>
        {options.map((o) => (
          <button key={o} type="button" onClick={() => toggle(o)}
            className={`rounded-full px-3 py-1 text-xs border transition ${
              value.includes(o)
                ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
            {o}
          </button>
        ))}
      </div>
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
      setSiteOptions([...new Set((si || []).map((s) => s.name || s.site_name).filter(Boolean))].sort())
      setHistory(Array.isArray(hi) ? hi : [])
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the message centre.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Re-count whenever the audience changes, so the number on screen always
  // describes the audience currently selected rather than a previous one.
  useEffect(() => {
    let alive = true
    previewAudience({ roles, countries, sites })
      .then((a) => { if (alive) setAudience(a) })
      .catch(() => { if (alive) setAudience(null) })
    return () => { alive = false }
  }, [roles, countries, sites])

  const problem = useMemo(() => validateBroadcast(form), [form])
  const canSend = !problem && !sending && (audience?.total ?? 0) > 0

  async function send() {
    setSending(true); setError(''); setResult(null)
    try {
      const r = await sendBroadcast({ ...form, roles, countries, sites })
      if (!r.ok) {
        setError(r.reason === 'empty'
          ? 'The message needs a title and a body.'
          : 'The message could not be sent.')
        return
      }
      setResult(r)
      setForm({ title: '', body: '', titleAr: '', bodyAr: '', sendPush: true })
      setHistory(await listBroadcasts().catch(() => history))
    } catch (e) {
      setError(toUserMessage(e, 'The message could not be sent.'))
    } finally { setSending(false) }
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

        <div className="grid gap-4 md:grid-cols-3">
          <ChipPicker label="Job title" allLabel="Everyone"
            options={roleOptions} value={roles} onChange={setRoles} />
          <ChipPicker label="Country" allLabel="All countries"
            options={COUNTRIES} value={countries} onChange={setCountries} />
          <ChipPicker label="Site" allLabel="All sites"
            options={siteOptions} value={sites} onChange={setSites} />
        </div>

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
