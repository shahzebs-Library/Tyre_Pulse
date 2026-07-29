import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Truck, ShieldAlert, FileCheck, Wrench, Wallet, Users, UserPlus, Loader2,
  RefreshCw, AlertCircle, Share2, CheckCircle2, Circle, Paperclip, ExternalLink,
} from 'lucide-react'
import { buildTeamDistribution } from '../../lib/accidentTeams'
import { listWorkstreams, setWorkstreamStatus } from '../../lib/api/accidentCase'
import { listProfiles } from '../../lib/api/users'
import { isMissingRelation } from '../../lib/api/_client'
import { resolveStorageUrls } from '../../lib/storageRefs'
import { safeHref, safeImageSrc } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'

/**
 * CaseTeamDistributionPanel — distributes ONE case's work AND its input files to
 * the five teams (Fleet, HSE/Safety, Insurance, Workshop, Finance).
 *
 * For each team it shows, in one place: the workstreams that team owns for THIS
 * case (with whether the route requires them, their live status, and the assigned
 * owner), the structured inputs that team is responsible for (present vs still
 * needed), and the uploaded files routed to it. An elevated user can assign an
 * owner to any workstream inline. All grouping/coverage comes from the pure
 * accidentTeams engine; assignment writes go through the validated
 * setWorkstreamStatus service. Honest states: loading, not-provisioned, error.
 */

const TEAM_ICON = { Truck, ShieldAlert, FileCheck, Wrench, Wallet }

const STATUS_META = {
  not_required: { label: 'Not required', tone: 'quiet' },
  not_started: { label: 'Not started', tone: 'quiet' },
  assigned: { label: 'Assigned', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'info' },
  waiting_info: { label: 'Waiting on info', tone: 'warning' },
  waiting_approval: { label: 'Waiting approval', tone: 'warning' },
  waiting_external: { label: 'Waiting external', tone: 'warning' },
  on_hold: { label: 'On hold', tone: 'warning' },
  completed: { label: 'Completed', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'danger' },
  reopened: { label: 'Reopened', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'quiet' },
}
const PILL = {
  good: 'border-emerald-700/50 bg-emerald-950/25 text-emerald-200',
  info: 'border-sky-700/50 bg-sky-950/25 text-sky-200',
  warning: 'border-amber-700/50 bg-amber-950/25 text-amber-200',
  danger: 'border-red-700/50 bg-red-950/25 text-red-200',
  quiet: 'border-[var(--input-border)] bg-[var(--input-bg)]/40 text-[var(--text-dim)]',
}
const INPUT =
  'bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)]'

function statusMeta(status) {
  const key = String(status || 'not_started').toLowerCase().trim()
  return STATUS_META[key] ? { ...STATUS_META[key], token: key } : { label: String(status), tone: 'quiet', token: key }
}
function userName(u) {
  if (!u) return ''
  return u.full_name || u.username || u.email || u.id
}

function StatusPill({ status }) {
  const m = statusMeta(status)
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${PILL[m.tone] || PILL.quiet}`}>
      {m.label}
    </span>
  )
}

/** A small labelled bar for work / input coverage. Null pct renders "N/A". */
function CoverageBar({ label, pct, done, total }) {
  const known = pct != null
  return (
    <div className="flex-1 min-w-[120px]">
      <div className="flex items-center justify-between text-[10px] text-[var(--text-dim)] mb-0.5">
        <span>{label}</span>
        <span>{known ? `${done}/${total}` : 'N/A'}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
        <div
          className={`h-full rounded-full ${known && pct >= 100 ? 'bg-emerald-500' : 'bg-orange-400'}`}
          style={{ width: `${known ? pct : 0}%` }}
        />
      </div>
    </div>
  )
}

/** One workstream line inside a team card, with inline owner assignment. */
function WorkRow({ ws, users, usersById, canEdit, onAssign }) {
  const [ownerId, setOwnerId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const owner = ws.ownerId ? usersById.get(ws.ownerId) : null
  const ownerLabel = owner ? userName(owner) : (ws.ownerRole || '')

  const assign = async () => {
    if (!ownerId) return
    setBusy(true); setMsg(null)
    try {
      await onAssign(ws.key, ownerId, ws.status)
      setOwnerId(''); setMsg({ ok: true })
    } catch (e) {
      setMsg({ ok: false, text: toUserMessage(e, 'Could not assign.') })
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/20 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-medium text-[var(--text-primary)]">{ws.name}</span>
        {ws.required
          ? <span className="text-[9px] uppercase tracking-wide text-orange-300 border border-orange-700/40 rounded px-1 py-px">Required</span>
          : <span className="text-[9px] uppercase tracking-wide text-[var(--text-dim)] border border-[var(--input-border)] rounded px-1 py-px">Optional</span>}
        <StatusPill status={ws.status} />
        <span className="ml-auto text-[11px] text-[var(--text-muted)] flex items-center gap-1">
          <UserPlus size={11} className="shrink-0" />
          {ownerLabel || <span className="text-[var(--text-dim)]">Unassigned</span>}
        </span>
      </div>
      {canEdit && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <select
            className={`${INPUT} flex-1 min-w-0`} value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)} disabled={busy}
            aria-label={`Assign owner for ${ws.name}`}
          >
            <option value="">Assign to...</option>
            {(Array.isArray(users) ? users : []).slice(0, 200).map((u) => (
              <option key={u.id} value={u.id}>{userName(u)}{u.role ? ` (${u.role})` : ''}</option>
            ))}
          </select>
          <button
            type="button" onClick={assign} disabled={busy || !ownerId}
            className="btn-primary text-[11px] px-2 py-1 flex items-center gap-1 disabled:opacity-50"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <UserPlus size={11} />} Assign
          </button>
        </div>
      )}
      {msg && !msg.ok && <p className="mt-1 text-[11px] text-red-300">{msg.text}</p>}
      {msg && msg.ok && <p className="mt-1 text-[11px] text-emerald-300 flex items-center gap-1"><CheckCircle2 size={11} /> Owner assigned.</p>}
    </div>
  )
}

/** One team card: coverage, workstreams, input checklist, and routed files. */
function TeamCard({ team, users, usersById, canEdit, fileUrls, onAssign }) {
  const Icon = TEAM_ICON[team.icon] || Users
  return (
    <div className="card p-3.5 space-y-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 h-8 w-8 rounded-lg bg-orange-500/10 border border-orange-700/30 flex items-center justify-center shrink-0">
          <Icon size={16} className="text-orange-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{team.label}</p>
          <p className="text-[11px] text-[var(--text-muted)] leading-snug">{team.blurb}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <CoverageBar label="Work done" pct={team.workPct} done={team.doneCount} total={team.requiredCount} />
        <CoverageBar label="Inputs received" pct={team.inputPct} done={team.inputsPresent} total={team.inputsTotal} />
      </div>

      {/* Work (workstreams) */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium text-[var(--text-dim)] uppercase tracking-wide flex items-center gap-1">
          <Users size={11} /> Work assigned to this team
        </p>
        {team.workstreams.length === 0
          ? <p className="text-[11px] text-[var(--text-dim)]">No workstreams for this team.</p>
          : team.workstreams.map((ws) => (
            <WorkRow key={ws.key} ws={ws} users={users} usersById={usersById} canEdit={canEdit} onAssign={onAssign} />
          ))}
      </div>

      {/* Inputs (structured "files of input") */}
      {team.inputs.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-[var(--text-dim)] uppercase tracking-wide">
            Inputs this team owns
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {team.inputs.map((f) => (
              <div key={f.key} className="flex items-center gap-1.5 text-[11px]">
                {f.present
                  ? <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                  : <Circle size={12} className="text-[var(--text-dim)] shrink-0" />}
                <span className={f.present ? 'text-[var(--text-secondary)]' : 'text-[var(--text-dim)]'}>{f.label}</span>
                {f.present && f.value && (
                  <span className="text-[var(--text-muted)] truncate">· {f.value}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Uploaded files routed to this team */}
      {team.files.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-[var(--text-dim)] uppercase tracking-wide flex items-center gap-1">
            <Paperclip size={11} /> Files
          </p>
          <div className="flex flex-wrap gap-1.5">
            {team.files.map((f, i) => {
              const url = fileUrls[f.ref] || f.ref || null
              const img = url ? safeImageSrc(url) : undefined
              const href = url ? safeHref(url) : undefined
              if (img) {
                // Image (incl. inline data URLs): show a thumbnail. Links to a
                // remote image when the URL is a real http(s) address.
                const thumb = <img src={img} alt={f.name} className="h-12 w-12 object-cover rounded border border-[var(--input-border)]" />
                return href
                  ? <a key={i} href={href} target="_blank" rel="noreferrer" title={f.name}>{thumb}</a>
                  : <span key={i} title={f.name}>{thumb}</span>
              }
              return href
                ? <a key={i} href={href} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 text-[11px] text-sky-300 border border-sky-800/40 rounded px-1.5 py-0.5 hover:bg-sky-950/30">
                    <ExternalLink size={10} /> {f.name}
                  </a>
                : <span key={i} className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] border border-[var(--input-border)] rounded px-1.5 py-0.5">
                    <Paperclip size={10} /> {f.name}
                  </span>
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CaseTeamDistributionPanel({ record, canEdit = false, onChanged }) {
  const accidentId = record?.id
  const [rows, setRows] = useState(null) // null = loading
  const [users, setUsers] = useState([])
  const [fileUrls, setFileUrls] = useState({})
  const [error, setError] = useState(null)
  const [degraded, setDegraded] = useState(false)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!accidentId) { setRows([]); return }
    let alive = true
    setRows(null); setError(null); setDegraded(false)
    listWorkstreams(accidentId, { country: record?.country })
      .then((data) => { if (alive) setRows(Array.isArray(data) ? data : []) })
      .catch((e) => {
        if (!alive) return
        if (isMissingRelation(e)) { setDegraded(true); setRows([]) }
        else setError(toUserMessage(e, 'Could not load the team distribution for this case.'))
      })
    return () => { alive = false }
  }, [accidentId, record?.country, tick])

  useEffect(() => {
    let alive = true
    listProfiles().then((d) => { if (alive) setUsers(Array.isArray(d) ? d : []) }).catch(() => { if (alive) setUsers([]) })
    return () => { alive = false }
  }, [])

  const usersById = useMemo(() => {
    const m = new Map()
    for (const u of users) if (u?.id) m.set(u.id, u)
    return m
  }, [users])

  const teams = useMemo(
    () => buildTeamDistribution(record || {}, rows || []),
    [record, rows],
  )

  // Resolve every routed file ref to a real URL (best-effort).
  const allRefs = useMemo(() => {
    const s = new Set()
    for (const t of teams) for (const f of t.files) if (f.ref) s.add(f.ref)
    return Array.from(s)
  }, [teams])
  useEffect(() => {
    if (!allRefs.length) { setFileUrls({}); return }
    let alive = true
    resolveStorageUrls(allRefs)
      .then((urls) => {
        if (!alive) return
        const map = {}
        allRefs.forEach((ref, i) => { map[ref] = Array.isArray(urls) ? urls[i] : (urls?.[ref] || null) })
        setFileUrls(map)
      })
      .catch(() => { if (alive) setFileUrls({}) })
    return () => { alive = false }
  }, [JSON.stringify(allRefs)])

  const handleAssign = useCallback(async (key, ownerId, currentStatus) => {
    const patch = { owner_id: ownerId }
    if (!currentStatus || currentStatus === 'not_started') patch.status = 'assigned'
    await setWorkstreamStatus(accidentId, key, patch)
    reload(); onChanged?.()
  }, [accidentId, reload, onChanged])

  if (error) {
    return (
      <div className="card p-4 space-y-2">
        <p className="text-sm text-red-300 flex items-center gap-2"><AlertCircle size={15} className="shrink-0" /> {error}</p>
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
          <Share2 size={16} className="text-[var(--text-muted)] shrink-0" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Team distribution</p>
        </div>
        <p className="text-sm text-[var(--text-muted)]">The case workflow is not yet activated for this incident.</p>
        <p className="text-xs text-[var(--text-dim)]">Once provisioned, each team's work and files appear here for distribution.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <Share2 size={16} className="text-orange-400 shrink-0" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Distribute work &amp; files to teams</p>
        </div>
        <span className="text-xs text-[var(--text-dim)] ml-auto">
          {canEdit ? 'Assign each team an owner. Inputs and files are routed automatically.' : 'Read-only view of who owns what.'}
        </span>
      </div>

      {rows == null ? (
        <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
          <Loader2 size={13} className="animate-spin" /> Loading team distribution...
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {teams.map((team) => (
            <TeamCard
              key={team.key} team={team} users={users} usersById={usersById}
              canEdit={canEdit} fileUrls={fileUrls} onAssign={handleAssign}
            />
          ))}
        </div>
      )}
    </div>
  )
}
