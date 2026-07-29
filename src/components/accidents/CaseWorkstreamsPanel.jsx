import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ListChecks, Users, UserCircle, UserPlus, Ban, Save, Loader2,
  ChevronRight, RefreshCw, AlertCircle, ShieldOff, Search, CheckCircle2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  WORKSTREAMS, WORKSTREAM_STATUS_TOKENS, NON_WAIVABLE,
} from '../../lib/accidentCase'
import { listWorkstreams, setWorkstreamStatus } from '../../lib/api/accidentCase'
import { listProfiles } from '../../lib/api/users'
import { isMissingRelation } from '../../lib/api/_client'
import { toUserMessage } from '../../lib/safeError'

/**
 * CaseWorkstreamsPanel — the interactive "who owns what" control for a case.
 *
 * Every accident case is a set of ten canonical workstreams, each owned by a real
 * team. This panel renders ALL TEN (from the engine's WORKSTREAMS list, so a
 * workstream with no stored row yet still shows honestly as "Not started /
 * unassigned"), shows the current status and assigned owner, and — for an elevated
 * user — lets a manager assign an owner, set a status, or mark a workstream Not
 * Applicable.
 *
 * Correctness lives on the server. Assign/status writes go through the validated
 * setWorkstreamStatus service (key + status token checked). Mark-NA is routed
 * through the RPC accident_ws_mark_na so the server enforces the NON_WAIVABLE spine
 * (incident_evidence / liability / finance can never be waived) and the mandatory
 * approver — this panel never fakes that guard client-side.
 *
 * Honest states: loading, not-provisioned (the V417 case tables are absent),
 * error + Retry. Non-elevated users see a read-only view.
 */

// Workstream status token -> label + tone. An unknown token still renders its raw
// value rather than being dropped.
const STATUS_META = {
  not_required:     { label: 'Not required',     tone: 'quiet' },
  not_started:      { label: 'Not started',      tone: 'quiet' },
  assigned:         { label: 'Assigned',         tone: 'info' },
  in_progress:      { label: 'In progress',      tone: 'info' },
  waiting_info:     { label: 'Waiting on info',  tone: 'warning' },
  waiting_approval: { label: 'Waiting approval', tone: 'warning' },
  waiting_external: { label: 'Waiting external', tone: 'warning' },
  on_hold:          { label: 'On hold',          tone: 'warning' },
  completed:        { label: 'Completed',        tone: 'good' },
  rejected:         { label: 'Rejected',         tone: 'danger' },
  reopened:         { label: 'Reopened',         tone: 'danger' },
  cancelled:        { label: 'Cancelled',        tone: 'quiet' },
}

const PILL = {
  good:    'border-emerald-700/50 bg-emerald-950/25 text-emerald-200',
  info:    'border-sky-700/50 bg-sky-950/25 text-sky-200',
  warning: 'border-amber-700/50 bg-amber-950/25 text-amber-200',
  danger:  'border-red-700/50 bg-red-950/25 text-red-200',
  quiet:   'border-[var(--input-border)] bg-[var(--input-bg)]/40 text-[var(--text-dim)]',
}

const INPUT =
  'w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-primary)]'

function statusMeta(status) {
  const key = String(status || 'not_started').toLowerCase().trim()
  if (STATUS_META[key]) return { ...STATUS_META[key], token: key }
  return { label: String(status), tone: 'quiet', token: key }
}

/** Display name for a resolved user, else a stable fallback. */
function userName(u) {
  if (!u) return ''
  return u.full_name || u.username || u.email || u.id
}

function StatusPill({ status }) {
  const meta = statusMeta(status)
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${
        PILL[meta.tone] || PILL.quiet
      }`}
    >
      {meta.label}
    </span>
  )
}

/**
 * One workstream row. Read-only unless `canEdit`. Editing expands to reveal the
 * assign / status / mark-NA controls.
 */
function WorkstreamRow({ ws, row, canEdit, users, usersById, waivable, onAssign, onSetStatus, onMarkNA }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  // assign form
  const [search, setSearch] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [ownerRole, setOwnerRole] = useState('')
  const [team, setTeam] = useState('')

  // mark-NA form
  const [naOpen, setNaOpen] = useState(false)
  const [naReason, setNaReason] = useState('')
  const [naApprover, setNaApprover] = useState('')

  const status = row?.status || 'not_started'
  const ownerUser = row?.owner_id ? usersById.get(row.owner_id) : null
  const assignedLabel = ownerUser
    ? userName(ownerUser)
    : (row?.owner_role || row?.team ? (row.owner_role || row.team) : '')
  const isNA = row?.not_applicable === true || status === 'not_required'

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = Array.isArray(users) ? users : []
    if (!q) return list.slice(0, 50)
    return list
      .filter((u) => `${userName(u)} ${u.username || ''} ${u.role || ''}`.toLowerCase().includes(q))
      .slice(0, 50)
  }, [users, search])

  async function run(fn, okText) {
    setBusy(true); setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, text: okText })
    } catch (e) {
      setMsg({ ok: false, text: toUserMessage(e, 'Could not save. Please try again.') })
    } finally { setBusy(false) }
  }

  return (
    <div className="border rounded-xl border-[var(--input-border)] bg-[var(--input-bg)]/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left"
      >
        <UserCircle size={16} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-[var(--text-primary)]">{ws.name}</span>
            <span className="text-xs text-[var(--text-dim)] flex items-center gap-1">
              <Users size={11} /> {ws.team}
            </span>
            <StatusPill status={status} />
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-muted)] flex items-center gap-1.5">
            <UserPlus size={11} className="shrink-0" />
            {assignedLabel
              ? <span>{assignedLabel}{row?.team && ownerUser ? ` · ${row.team}` : ''}</span>
              : <span className="text-[var(--text-dim)]">Unassigned</span>}
            {isNA && row?.na_reason && (
              <span className="text-amber-400">Not applicable: {row.na_reason}</span>
            )}
          </div>
        </div>
        <ChevronRight
          size={15}
          className={`text-[var(--text-muted)] mt-0.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--input-border)]/60 space-y-3">
          {!canEdit ? (
            <p className="text-xs text-[var(--text-muted)]">
              You have read-only access to this case. A manager can assign owners and change status.
            </p>
          ) : (
            <>
              {/* ── ASSIGN ─────────────────────────────────────────── */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wide">
                  Assign an owner
                </p>
                <div className="relative">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    className={`${INPUT} pl-7`}
                    placeholder="Search people by name or role"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label={`Search people for ${ws.name}`}
                  />
                </div>
                <select
                  className={INPUT}
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  aria-label={`Owner for ${ws.name}`}
                >
                  <option value="">Select a person</option>
                  {filteredUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {userName(u)}{u.role ? ` (${u.role})` : ''}
                    </option>
                  ))}
                </select>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    type="text" className={INPUT} placeholder="Owner role (optional)"
                    value={ownerRole} onChange={(e) => setOwnerRole(e.target.value)}
                    aria-label={`Owner role for ${ws.name}`}
                  />
                  <input
                    type="text" className={INPUT} placeholder="Team (optional)"
                    value={team} onChange={(e) => setTeam(e.target.value)}
                    aria-label={`Team for ${ws.name}`}
                  />
                </div>
                <button
                  type="button"
                  disabled={busy || (!ownerId && !ownerRole.trim() && !team.trim())}
                  onClick={() => run(async () => {
                    await onAssign(ws.key, {
                      owner_id: ownerId || null,
                      owner_role: ownerRole.trim() || null,
                      team: team.trim() || null,
                      currentStatus: status,
                    })
                    setSearch(''); setOwnerId(''); setOwnerRole(''); setTeam('')
                  }, 'Owner assigned.')}
                  className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                  Assign
                </button>
              </div>

              {/* ── SET STATUS ─────────────────────────────────────── */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wide">
                  Set status
                </p>
                <select
                  className={INPUT}
                  value={status}
                  disabled={busy}
                  onChange={(e) => run(() => onSetStatus(ws.key, e.target.value), 'Status updated.')}
                  aria-label={`Status for ${ws.name}`}
                >
                  {WORKSTREAM_STATUS_TOKENS.map((t) => (
                    <option key={t} value={t}>{statusMeta(t).label}</option>
                  ))}
                </select>
              </div>

              {/* ── MARK N/A ──────────────────────────────────────── */}
              <div className="space-y-1.5">
                {!waivable ? (
                  <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                    <ShieldOff size={12} className="shrink-0" />
                    This workstream is mandatory and cannot be marked not applicable.
                  </p>
                ) : !naOpen ? (
                  <button
                    type="button"
                    onClick={() => setNaOpen(true)}
                    className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <Ban size={13} /> Mark not applicable
                  </button>
                ) : (
                  <div className="space-y-2 border border-amber-700/40 bg-amber-950/15 rounded-lg p-2.5">
                    <p className="text-[11px] font-medium text-amber-200 uppercase tracking-wide">
                      Mark not applicable
                    </p>
                    <textarea
                      rows={2} className={INPUT} placeholder="Reason (required)"
                      value={naReason} onChange={(e) => setNaReason(e.target.value)}
                      aria-label={`Not-applicable reason for ${ws.name}`}
                    />
                    <select
                      className={INPUT} value={naApprover}
                      onChange={(e) => setNaApprover(e.target.value)}
                      aria-label={`Not-applicable approver for ${ws.name}`}
                    >
                      <option value="">Select an approver</option>
                      {(Array.isArray(users) ? users : []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {userName(u)}{u.role ? ` (${u.role})` : ''}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || !naReason.trim() || !naApprover}
                        onClick={() => run(async () => {
                          await onMarkNA(ws.key, naReason.trim(), naApprover)
                          setNaOpen(false); setNaReason(''); setNaApprover('')
                        }, 'Marked not applicable.')}
                        className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                        Confirm
                      </button>
                      <button
                        type="button" onClick={() => setNaOpen(false)}
                        className="btn-secondary text-xs px-3 py-1.5"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="text-[11px] text-amber-300/80">
                      A reason and an approver are required; the server rejects a waiver on a mandatory workstream.
                    </p>
                  </div>
                )}
              </div>

              {msg && (
                <p className={`text-xs flex items-center gap-1.5 ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                  {msg.ok && <CheckCircle2 size={12} className="shrink-0" />}
                  {msg.text}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function CaseWorkstreamsPanel({ accidentId, country, elevated = false, onChanged }) {
  const [rows, setRows] = useState(null)        // null = loading
  const [users, setUsers] = useState([])
  const [error, setError] = useState(null)
  const [degraded, setDegraded] = useState(false)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!accidentId) { setRows([]); return }
    let alive = true
    setRows(null); setError(null); setDegraded(false)
    listWorkstreams(accidentId, { country })
      .then((data) => { if (alive) setRows(Array.isArray(data) ? data : []) })
      .catch((e) => {
        if (!alive) return
        // A missing case table is "not provisioned yet", not a failure.
        if (isMissingRelation(e)) { setDegraded(true); setRows([]) }
        else setError(toUserMessage(e, 'Could not load the workstreams for this case.'))
      })
    return () => { alive = false }
  }, [accidentId, country, tick])

  // Assignable-user list. Best-effort: the panel still works read-only if it fails.
  useEffect(() => {
    let alive = true
    listProfiles()
      .then((data) => { if (alive) setUsers(Array.isArray(data) ? data : []) })
      .catch(() => { if (alive) setUsers([]) })
    return () => { alive = false }
  }, [])

  const usersById = useMemo(() => {
    const m = new Map()
    for (const u of users) if (u?.id) m.set(u.id, u)
    return m
  }, [users])

  // Merge the ten canonical workstreams with the stored rows (keyed by workstream).
  const rowByKey = useMemo(() => {
    const m = new Map()
    for (const r of (rows || [])) {
      const key = r.workstream || r.workstream_key || r.key
      if (key) m.set(key, r)
    }
    return m
  }, [rows])

  const afterChange = useCallback(() => { reload(); onChanged?.() }, [reload, onChanged])

  const handleAssign = useCallback(async (key, { owner_id, owner_role, team, currentStatus }) => {
    const patch = { owner_id, owner_role, team }
    // Only PROMOTE to 'assigned' from an untouched state; never overwrite work in
    // progress (in_progress / waiting_* / completed) just because an owner changed.
    if (!currentStatus || currentStatus === 'not_started') patch.status = 'assigned'
    await setWorkstreamStatus(accidentId, key, patch)
    afterChange()
  }, [accidentId, afterChange])

  const handleSetStatus = useCallback(async (key, status) => {
    await setWorkstreamStatus(accidentId, key, { status })
    afterChange()
  }, [accidentId, afterChange])

  // Mark-NA routes through the server RPC so the NON_WAIVABLE spine + mandatory
  // approver are enforced server-side, not faked here.
  const handleMarkNA = useCallback(async (key, reason, approverUserId) => {
    const { data, error: rpcErr } = await supabase.rpc('accident_ws_mark_na', {
      p_accident_id: accidentId,
      p_workstream_key: key,
      p_reason: reason,
      p_approved_by: approverUserId || null,
    })
    if (rpcErr) throw rpcErr
    // A structured refusal { ok:false, reason } is surfaced honestly too.
    if (data && typeof data === 'object' && data.ok === false) {
      throw new Error(data.message || data.error || data.reason || 'This workstream cannot be marked not applicable.')
    }
    afterChange()
  }, [accidentId, afterChange])

  // ── honest states ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="card p-4 space-y-2">
        <p className="text-sm text-red-300 flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0" /> {error}
        </p>
        <button type="button" onClick={reload} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    )
  }

  if (degraded) {
    return (
      <div className="card p-4 space-y-1.5">
        <div className="flex items-center gap-2">
          <ListChecks size={16} className="text-[var(--text-muted)] shrink-0" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Workstreams</p>
        </div>
        <p className="text-sm text-[var(--text-muted)]">
          The case workstream model is not yet activated for this incident.
        </p>
        <p className="text-xs text-[var(--text-dim)]">
          Assignments and per-team status appear once the case workflow is provisioned.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <ListChecks size={16} className="text-orange-400 shrink-0" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Workstreams &amp; ownership</p>
        </div>
        <span className="text-xs text-[var(--text-dim)] ml-auto">
          {elevated ? "Assign owners and set each team's status." : 'Read-only view of who owns what.'}
        </span>
      </div>

      {rows == null ? (
        <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
          <Loader2 size={13} className="animate-spin" /> Loading workstreams...
        </p>
      ) : (
        <div className="space-y-1.5">
          {WORKSTREAMS.map((ws) => (
            <WorkstreamRow
              key={ws.key}
              ws={ws}
              row={rowByKey.get(ws.key) || null}
              canEdit={!!elevated}
              users={users}
              usersById={usersById}
              waivable={!NON_WAIVABLE.has(ws.key)}
              onAssign={handleAssign}
              onSetStatus={handleSetStatus}
              onMarkNA={handleMarkNA}
            />
          ))}
        </div>
      )}
    </div>
  )
}
