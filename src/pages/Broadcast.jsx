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
import { Megaphone, Send, RefreshCcw, Users, Smartphone, AlertTriangle, Check } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
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
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [ro, si, hi] = await Promise.all([
        listAssignableRoles().catch(() => ASSIGNABLE_BUILTIN_ROLES),
        listSites().catch(() => []),
        listBroadcasts().catch(() => []),
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

      <div className="card">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Sent messages</h3>
        {loading ? (
          <p className="text-sm text-[var(--text-tertiary)]">Loading</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">
            Nothing sent yet. Messages you send appear here with who received them.
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((m) => (
              <div key={m.id} className="rounded-lg border border-[var(--border-subtle)] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{m.title}</span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">{fmtDate(m.sent_at || m.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-line text-xs text-[var(--text-secondary)]">{m.body}</p>
                <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">
                  {audienceLabel(m)} · {m.recipient_count} in the app
                  {m.push_count > 0 ? ` · ${m.push_count} phone` : ' · no phone push'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
