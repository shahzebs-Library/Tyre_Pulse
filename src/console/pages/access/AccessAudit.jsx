/**
 * AccessAudit.jsx - the immutable trail of every access change, inside the
 * console Access Control host.
 *
 * Reads adminAccess.listAccessAudit({ limit, target }) (a super-admin-only,
 * newest-first RPC over the access_audit table). Each row is
 * { id, actor, actor_email, action, target_user, entity, before, after, at }.
 * The screen renders a readable table with a compact before -> after diff and
 * lets the operator filter by entity and by target user, and change how many
 * rows to pull. This is a read-only forensic view; nothing here mutates state.
 *
 * The target-user filter and the "target" column resolve uuids to names via the
 * existing users directory (listProfiles), so an auditor sees a person, not a
 * bare id. Per the house style, the diff separator is the ASCII word "to" and
 * empty values render "N/A" (no dashes or arrows).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ScrollText, RefreshCw, AlertTriangle, Filter, User, Clock, Info,
  Crown, ChevronDown, ChevronRight, Search, Layers,
} from 'lucide-react'
import { listProfiles } from '../../../lib/api/users'
import { listAccessAudit } from '../../../lib/api/adminAccess'
import { toUserMessage } from '../../../lib/safeError'

const LIMIT_OPTIONS = [50, 100, 200, 500]

const ACTION_TINT = {
  grant: 'bg-green-900/25 text-green-300 border-green-800/50',
  revoke: 'bg-red-900/25 text-red-300 border-red-800/50',
  delete: 'bg-red-900/25 text-red-300 border-red-800/50',
  remove: 'bg-red-900/25 text-red-300 border-red-800/50',
  role: 'bg-purple-900/25 text-purple-300 border-purple-800/50',
  country: 'bg-blue-900/25 text-blue-300 border-blue-800/50',
  update: 'bg-amber-900/25 text-amber-300 border-amber-800/50',
  create: 'bg-green-900/25 text-green-300 border-green-800/50',
}

function displayName(u) {
  return u?.full_name || u?.username || u?.email || 'Unnamed user'
}

function fmtWhen(value) {
  if (!value) return 'N/A'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function actionTint(action) {
  const key = String(action || '').toLowerCase()
  const hit = Object.keys(ACTION_TINT).find((k) => key.includes(k))
  return hit ? ACTION_TINT[hit] : 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]'
}

function toScalar(v) {
  if (v === null || v === undefined || v === '') return 'N/A'
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'N/A'
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

// Build a compact list of changed fields between two JSON-ish payloads.
function diffFields(before, after) {
  const b = before && typeof before === 'object' ? before : {}
  const a = after && typeof after === 'object' ? after : {}
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]))
  const rows = []
  for (const k of keys) {
    const from = toScalar(b[k])
    const to = toScalar(a[k])
    if (from !== to) rows.push({ key: k, from, to })
  }
  return rows
}

export default function AccessAudit() {
  const [rows, setRows] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(100)
  const [entityFilter, setEntityFilter] = useState('all')
  const [targetFilter, setTargetFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())

  const [users, setUsers] = useState([])

  useEffect(() => {
    listProfiles()
      .then((r) => setUsers(Array.isArray(r) ? r : []))
      .catch(() => setUsers([]))
  }, [])

  const userById = useMemo(() => {
    const m = new Map()
    for (const u of users) m.set(u.id, u)
    return m
  }, [users])

  const load = useCallback(async () => {
    setRows(null); setError('')
    try {
      const target = targetFilter === 'all' ? null : targetFilter
      const data = await listAccessAudit({ limit, target })
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the access audit trail.'))
      setRows([])
    }
  }, [limit, targetFilter])

  useEffect(() => { load() }, [load])

  const entityOptions = useMemo(() => {
    const set = new Set()
    for (const r of rows || []) if (r.entity) set.add(r.entity)
    return Array.from(set).sort()
  }, [rows])

  // Target-user picker options: prefer real target ids present in the trail,
  // falling back to the full directory so a filter is always possible.
  const targetOptions = useMemo(() => {
    const ids = new Set()
    for (const r of rows || []) if (r.target_user) ids.add(r.target_user)
    const list = Array.from(ids).map((id) => ({ id, name: displayName(userById.get(id)) || id }))
    // If the trail was already server-filtered to one target, still expose the
    // whole directory so the operator can switch targets.
    if (list.length <= 1) {
      return users.map((u) => ({ id: u.id, name: displayName(u) })).sort((x, y) => x.name.localeCompare(y.name))
    }
    return list.sort((x, y) => x.name.localeCompare(y.name))
  }, [rows, users, userById])

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (entityFilter !== 'all' && r.entity !== entityFilter) return false
      if (q) {
        const hay = [
          r.action, r.entity, r.actor_email,
          displayName(userById.get(r.target_user)),
        ].map((x) => String(x || '').toLowerCase()).join(' ')
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, entityFilter, search, userById])

  function toggleRow(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
        <p className="text-xs text-[var(--text-muted)] max-w-3xl">
          Every access change is recorded here: who did it, what changed, and when. This is a read-only,
          newest-first forensic trail. Filter by entity or target user, or search actor and action.
        </p>
      </div>

      {/* Controls */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold block mb-1.5">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                className="input pl-8 py-1.5 text-sm w-full"
                placeholder="Actor, action, entity or target..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold block mb-1.5 inline-flex items-center gap-1.5">
              <Layers size={12} /> Entity
            </label>
            <select className="input py-1.5 text-sm" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
              <option value="all">All entities</option>
              {entityOptions.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold block mb-1.5 inline-flex items-center gap-1.5">
              <User size={12} /> Target user
            </label>
            <select className="input py-1.5 text-sm max-w-[200px]" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
              <option value="all">All users</option>
              {targetOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold block mb-1.5">Rows</label>
            <select className="input py-1.5 text-sm" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button onClick={load} disabled={rows === null} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={14} className={rows === null ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card !p-0 overflow-hidden">
        {rows === null ? (
          <div className="p-3 space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-[var(--input-bg)] animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <AlertTriangle size={22} className="mx-auto mb-2 text-red-400" />
            <p className="text-sm text-red-300 font-medium">Could not load the audit trail</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
            <button onClick={load} className="btn-secondary text-xs mt-3 inline-flex items-center gap-1.5">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-12 text-center text-[var(--text-muted)]">
            <ScrollText size={26} className="mx-auto mb-2 opacity-60" />
            <p className="text-sm font-medium text-[var(--text-primary)]">No access changes recorded</p>
            <p className="text-xs mt-1">
              {(rows.length === 0)
                ? 'The trail is empty for the selected filters.'
                : 'No entries match your current search or entity filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-[var(--input-border)] bg-[var(--surface-1)]">
                  <th className="w-8" />
                  <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">When</th>
                  <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Actor</th>
                  <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Action</th>
                  <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Entity</th>
                  <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Target user</th>
                  <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Change</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const fields = diffFields(r.before, r.after)
                  const open = expanded.has(r.id)
                  const target = userById.get(r.target_user)
                  const preview = fields.slice(0, open ? fields.length : 2)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 align-top">
                      <td className="pl-3 py-2.5">
                        {fields.length > 2 && (
                          <button onClick={() => toggleRow(r.id)} className="p-1 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)]" aria-label={open ? 'Collapse' : 'Expand'}>
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-[var(--text-secondary)]">
                        <span className="inline-flex items-center gap-1.5"><Clock size={12} className="text-[var(--text-muted)]" /> {fmtWhen(r.at)}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-[var(--text-primary)] text-xs">{r.actor_email || 'N/A'}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`badge border ${actionTint(r.action)}`}>{r.action || 'N/A'}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-[var(--text-secondary)]">{r.entity || 'N/A'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {r.target_user ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-primary)]">
                            {target?.is_super_admin && <Crown size={11} className="text-amber-400" />}
                            {target ? displayName(target) : `${String(r.target_user).slice(0, 8)}...`}
                          </span>
                        ) : <span className="text-xs text-[var(--text-muted)]">N/A</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {fields.length === 0 ? (
                          <span className="text-xs text-[var(--text-muted)]">No field changes recorded</span>
                        ) : (
                          <div className="space-y-1">
                            {preview.map((f) => (
                              <div key={f.key} className="text-xs leading-relaxed">
                                <span className="text-[var(--text-muted)]">{f.key}: </span>
                                <span className="text-red-300/90">{f.from}</span>
                                <span className="text-[var(--text-muted)]"> to </span>
                                <span className="text-green-300/90">{f.to}</span>
                              </div>
                            ))}
                            {!open && fields.length > 2 && (
                              <button onClick={() => toggleRow(r.id)} className="text-[11px] text-[var(--brand-bright)] hover:underline">
                                +{fields.length - 2} more
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rows && !error && visibleRows.length > 0 && (
        <p className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1.5">
          <Filter size={12} /> Showing {visibleRows.length} of {rows.length} loaded entr{rows.length === 1 ? 'y' : 'ies'} (newest first, up to {limit}).
        </p>
      )}
    </div>
  )
}
