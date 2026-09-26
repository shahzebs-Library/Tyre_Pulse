/**
 * Request temporary access (just-in-time elevation), requester side.
 *
 * Any approved user can ask for ONE module capability for 5 to 480 minutes with
 * a reason. A super admin approves or denies it in /console/jit-elevation. An
 * approval writes an expiring row into user_access_grants, so the access stops
 * on its own at expiry - there is no second permission system.
 *
 * The server is the boundary (request_elevation / cancel_elevation /
 * my_elevation_requests, all SECURITY DEFINER, own rows only). The checks here
 * only explain a refusal before the round trip.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, Send, RefreshCcw, XCircle, Search, AlertTriangle, Check, Timer } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../contexts/AuthContext'
import { requestElevation, cancelElevation, listMyElevations } from '../lib/api/jitElevation'
import {
  JIT_CAPABILITIES, DURATION_PRESETS, MIN_MINUTES, MAX_MINUTES, MIN_REASON,
  validateRequest, formatMinutes, formatRemaining, remainingMs,
} from '../lib/jitElevation'
import {
  moduleOptions, requesterStatus, REQUESTER_STATUS_META, canCancel, summarizeMine, ineligibleReason,
} from '../lib/requestAccess'
import { REGISTRY_LABEL } from '../lib/moduleCatalog'
import { toUserMessage } from '../lib/safeError'
import EnterpriseTable from '../components/ui/EnterpriseTable'

const inputCls = 'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]'
const labelCls = 'text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]'

const TONE_CLS = {
  good: 'border-emerald-500/40 text-emerald-400',
  warning: 'border-amber-500/40 text-amber-400',
  danger: 'border-red-500/40 text-red-400',
  quiet: 'border-[var(--border-subtle)] text-[var(--text-tertiary)]',
}

const fmtDate = (d) => {
  if (!d) return 'N/A'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? String(d)
    : dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const capLabel = (c) => JIT_CAPABILITIES.find((x) => x.key === c)?.label || c
const moduleLabel = (k) => REGISTRY_LABEL[k] || k

const STATUS_FILTERS = [
  { key: '', label: 'All' },
  { key: 'pending', label: 'Waiting' },
  { key: 'active', label: 'Active' },
  { key: 'denied', label: 'Denied' },
  { key: 'expired', label: 'Expired' },
  { key: 'revoked', label: 'Revoked' },
]

function StatusPill({ status }) {
  const meta = REQUESTER_STATUS_META[status] || { label: status || 'Unknown', tone: 'quiet' }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLS[meta.tone] || TONE_CLS.quiet}`}>
      {meta.label}
    </span>
  )
}

export default function RequestAccess() {
  const { profile, isSuperAdmin } = useAuth()
  const blocked = ineligibleReason(profile, isSuperAdmin)
  const groups = useMemo(() => moduleOptions(), [])

  const [form, setForm] = useState({ moduleKey: '', capability: 'view', minutes: 60, reason: '' })
  const [touched, setTouched] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sent, setSent] = useState('')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      setRows(await listMyElevations())
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not load your requests.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  // Countdown on active access, refreshed every 30 seconds.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const errors = useMemo(() => validateRequest(form, { requireUser: false }), [form])
  const canSend = !blocked && !sending && Object.keys(errors).length === 0

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))

  async function submit(e) {
    e?.preventDefault?.()
    setTouched(true); setSent(''); setSendError('')
    if (!canSend) return
    setSending(true)
    try {
      await requestElevation({
        moduleKey: form.moduleKey, capability: form.capability,
        minutes: Number(form.minutes), reason: form.reason,
      })
      setSent(`Request sent: ${capLabel(form.capability)} on ${moduleLabel(form.moduleKey)} for ${formatMinutes(form.minutes)}. A super admin has been notified.`)
      setForm((f) => ({ ...f, reason: '' }))
      setTouched(false)
      await load()
    } catch (err) {
      setSendError(toUserMessage(err, 'Could not send the request.'))
    } finally {
      setSending(false)
    }
  }

  async function cancel(id) {
    setBusyId(id); setLoadError('')
    try {
      const res = await cancelElevation(id)
      if (res && res.ok === false) setLoadError('This request was already decided and can no longer be withdrawn.')
      await load()
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not withdraw the request.'))
    } finally {
      setBusyId(null)
    }
  }

  const summary = useMemo(() => summarizeMine(rows, now), [rows, now])
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter && requesterStatus(r, now) !== statusFilter) return false
      if (!q) return true
      return [r.module_key, moduleLabel(r.module_key), r.capability, r.reason, r.decision_note]
        .some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [rows, search, statusFilter, now])

  const fieldErr = (k) => (touched && errors[k] ? <span className="text-[11px] text-amber-400">{errors[k]}</span> : null)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Request temporary access"
        subtitle="Ask for one extra capability for a limited time. A super admin approves it, and it ends on its own."
        icon={KeyRound}
        actions={(
          <button onClick={load} className="btn-ghost" type="button" disabled={loading}>
            <RefreshCcw size={14} /> Refresh
          </button>
        )}
      />

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['Waiting', summary.pending],
          ['Active now', summary.active],
          ['Denied', summary.denied],
          ['Ended', summary.ended],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <div className={labelCls}>{label}</div>
            <div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{loading ? 'N/A' : value}</div>
          </div>
        ))}
      </div>

      <form className="card space-y-4" onSubmit={submit} noValidate>
        <div className="mb-1 text-sm font-semibold text-[var(--text-primary)]">New request</div>
        {blocked ? (
          <div className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" /> {blocked}
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Module</span>
                <select className={inputCls} value={form.moduleKey} onChange={set('moduleKey')}>
                  <option value="">Choose a module</option>
                  {groups.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.modules.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </optgroup>
                  ))}
                </select>
                {fieldErr('moduleKey')}
              </label>
              <div className="flex flex-col gap-1">
                <span className={labelCls}>Capability</span>
                <div className="flex flex-wrap gap-1.5">
                  {JIT_CAPABILITIES.map((c) => (
                    <button key={c.key} type="button" onClick={() => setForm((f) => ({ ...f, capability: c.key }))}
                      aria-pressed={form.capability === c.key}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${form.capability === c.key
                        ? 'border-[var(--brand-bright,#22c55e)] text-[var(--text-primary)] bg-[var(--surface-raised)]'
                        : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
                      {c.label}
                    </button>
                  ))}
                </div>
                {fieldErr('capability')}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className={labelCls}>Duration (minutes, {MIN_MINUTES} to {MAX_MINUTES})</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {DURATION_PRESETS.map((m) => (
                  <button key={m} type="button" onClick={() => setForm((f) => ({ ...f, minutes: m }))}
                    aria-pressed={Number(form.minutes) === m}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${Number(form.minutes) === m
                      ? 'border-[var(--brand-bright,#22c55e)] text-[var(--text-primary)] bg-[var(--surface-raised)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
                    {formatMinutes(m)}
                  </button>
                ))}
                <input type="number" min={MIN_MINUTES} max={MAX_MINUTES} step={1}
                  className={`${inputCls} w-28`} value={form.minutes} onChange={set('minutes')}
                  aria-label="Duration in minutes" />
              </div>
              {fieldErr('minutes')}
            </div>

            <label className="flex flex-col gap-1">
              <span className={labelCls}>Reason (required, at least {MIN_REASON} characters)</span>
              <textarea rows={3} maxLength={1000} className={inputCls} value={form.reason} onChange={set('reason')}
                placeholder="What do you need to do, and why can it not wait for a permanent change?" />
              {fieldErr('reason')}
            </label>

            {sendError && <div className="text-sm text-red-400">{sendError}</div>}
            {sent && (
              <div className="flex items-start gap-2 text-sm text-emerald-400">
                <Check size={16} className="mt-0.5 shrink-0" /> {sent}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
              <span className="text-[11px] text-[var(--text-tertiary)]">
                Delete is never offered: it stays with administrators.
              </span>
              <button type="submit" disabled={!canSend && touched} className="btn-primary disabled:opacity-40">
                <Send size={14} /> {sending ? 'Sending' : 'Send request'}
              </button>
            </div>
          </>
        )}
      </form>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-[var(--text-primary)]">My requests</div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-[var(--text-tertiary)]" />
              <input className={`${inputCls} pl-8 w-56`} placeholder="Search module or reason"
                value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search requests" />
            </div>
            <select className={`${inputCls} w-36`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status">
              {STATUS_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">Loading your requests</div>
        ) : loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/40 p-3 text-sm text-red-400">
            <span>{loadError}</span>
            <button type="button" className="btn-ghost" onClick={load}><RefreshCcw size={14} /> Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
            You have not requested temporary access yet.
          </div>
        ) : visible.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">No requests match these filters.</div>
        ) : (
          <EnterpriseTable
            data={visible}
            getRowId={(r) => r.id}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            columns={[
              { id: 'module', header: 'Module', accessorFn: (r) => moduleLabel(r.module_key),
                cell: ({ getValue }) => <span className="text-[var(--text-primary)]">{getValue()}</span> },
              { id: 'capability', header: 'Capability', accessorFn: (r) => capLabel(r.capability) },
              { id: 'duration', header: 'Duration', accessorFn: (r) => r.granted_minutes ?? r.requested_minutes,
                cell: ({ row }) => {
                  const r = row.original
                  return (
                    <>
                      {formatMinutes(r.granted_minutes ?? r.requested_minutes)}
                      {requesterStatus(r, now) === 'active' && (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-400">
                          <Timer size={12} /> {formatRemaining(remainingMs(r, now))} left
                        </div>
                      )}
                    </>
                  )
                } },
              { id: 'status', header: 'Status', accessorFn: (r) => requesterStatus(r, now),
                cell: ({ getValue }) => <StatusPill status={getValue()} /> },
              { id: 'requested', header: 'Requested', accessorFn: (r) => r.created_at,
                cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDate(getValue())}</span> },
              { id: 'reason', header: 'Reason / decision', accessorFn: (r) => r.reason, enableSorting: false,
                cell: ({ row }) => {
                  const r = row.original
                  return (
                    <div className="max-w-md">
                      <div>{r.reason}</div>
                      {(r.decision_note || r.revoke_reason) && (
                        <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                          {r.revoke_reason ? `Revoked: ${r.revoke_reason}` : `Note: ${r.decision_note}`}
                        </div>
                      )}
                    </div>
                  )
                } },
              { id: 'actions', header: '', enableSorting: false, meta: { export: false, align: 'right' },
                cell: ({ row }) => {
                  const r = row.original
                  return canCancel(r, now) ? (
                    <button type="button" className="btn-ghost" disabled={busyId === r.id} onClick={() => cancel(r.id)}>
                      <XCircle size={14} /> {busyId === r.id ? 'Withdrawing' : 'Withdraw'}
                    </button>
                  ) : null
                } },
            ]}
          />
        )}
      </div>
    </div>
  )
}
