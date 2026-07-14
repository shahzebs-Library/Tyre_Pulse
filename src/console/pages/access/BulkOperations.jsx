/**
 * BulkOperations.jsx - apply one access change to many users at once, inside the
 * console Access Control host.
 *
 * Two server-side batch actions, both super-admin-only RPCs surfaced through
 * src/lib/api/adminAccess.js:
 *   - Set role   -> adminAccess.bulkSetRole(ids, role). The DB honours a
 *     last-super-admin lockout guard and never demotes a super admin, so the
 *     returned count can be lower than the selection; we report the real count.
 *   - Grant / revoke a capability -> adminAccess.bulkSetGrant({ userIds,
 *     moduleKey, capability, effect, expiresAt }). Only View is enforced today;
 *     other capabilities are stored for progressive enforcement and labelled so.
 *
 * Nothing is applied without an explicit confirm modal that restates the exact
 * change and the number of users it touches. The role list unions the built-in
 * roles, any custom roles and every role already present in the directory so no
 * assignable role is ever missing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Search, RefreshCw, AlertTriangle, Crown, Check, X, Info, Loader2,
  Layers, ShieldCheck, UserCog, KeyRound, Calendar, Ban, CheckCircle2,
} from 'lucide-react'
import { ACCESS_ROLES, MODULE_GROUPS, MODULE_LABEL } from '../../../lib/moduleCatalog'
import { CAPABILITIES } from '../../../lib/permissionMatrix'
import { listProfiles } from '../../../lib/api/users'
import { listCustomRoles } from '../../../lib/api/customRoles'
import { bulkSetRole, bulkSetGrant } from '../../../lib/api/adminAccess'
import { toUserMessage } from '../../../lib/safeError'

const ROLE_TINT = {
  Admin: 'text-purple-300', Manager: 'text-blue-300', Director: 'text-indigo-300',
  Reporter: 'text-cyan-300', Inspector: 'text-green-300', 'Tyre Man': 'text-amber-300',
  Driver: 'text-[var(--text-secondary)]',
}

function displayName(u) {
  return u?.full_name || u?.username || u?.email || 'Unnamed user'
}

export default function BulkOperations() {
  const [users, setUsers] = useState(null)
  const [usersError, setUsersError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [selected, setSelected] = useState(() => new Set())

  const [customRoles, setCustomRoles] = useState([])

  // Action mode + form
  const [mode, setMode] = useState('role') // 'role' | 'capability'
  const [roleValue, setRoleValue] = useState('')
  const [moduleKey, setModuleKey] = useState('')
  const [capability, setCapability] = useState('view')
  const [effect, setEffect] = useState('grant')
  const [expiry, setExpiry] = useState('')

  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)

  const [toasts, setToasts] = useState([])
  const timers = useRef({})
  const pushToast = useCallback((kind, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setToasts((t) => [...t, { id, kind, message }])
    timers.current[id] = setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
      delete timers.current[id]
    }, 6000)
  }, [])
  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id] }
  }, [])
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout) }, [])

  const loadUsers = useCallback(async () => {
    setRefreshing(true); setUsersError('')
    try {
      const rows = await listProfiles()
      setUsers(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setUsersError(toUserMessage(err, 'Could not load the user directory.'))
      setUsers([])
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  useEffect(() => {
    listCustomRoles()
      .then((rows) => setCustomRoles(Array.isArray(rows) ? rows : []))
      .catch(() => setCustomRoles([]))
  }, [])

  const roleOptions = useMemo(() => {
    const set = new Set()
    for (const u of users || []) if (u.role) set.add(u.role)
    return Array.from(set).sort()
  }, [users])

  // Assignable roles = built-ins + custom roles + roles seen in the directory.
  const assignableRoles = useMemo(() => {
    const set = new Set(ACCESS_ROLES)
    for (const r of customRoles) if (r?.name) set.add(r.name)
    for (const r of roleOptions) set.add(r)
    return Array.from(set).sort()
  }, [customRoles, roleOptions])

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (users || []).filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (!q) return true
      return (
        displayName(u).toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q) ||
        String(u.username || '').toLowerCase().includes(q)
      )
    })
  }, [users, search, roleFilter])

  const allVisibleSelected = filteredUsers.length > 0 && filteredUsers.every((u) => selected.has(u.id))

  function toggleUser(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) filteredUsers.forEach((u) => next.delete(u.id))
      else filteredUsers.forEach((u) => next.add(u.id))
      return next
    })
  }
  function clearSelection() { setSelected(new Set()) }

  const selectedIds = useMemo(() => Array.from(selected), [selected])
  const selectedCount = selectedIds.length

  // Validation for enabling the "Review" action.
  const canReview = useMemo(() => {
    if (selectedCount === 0) return false
    if (mode === 'role') return !!roleValue
    return !!moduleKey
  }, [selectedCount, mode, roleValue, moduleKey])

  const capMeta = CAPABILITIES.find((c) => c.key === capability)

  const applyChange = useCallback(async () => {
    setApplying(true)
    try {
      let count
      if (mode === 'role') {
        count = await bulkSetRole(selectedIds, roleValue)
        pushToast('success', `${count} of ${selectedCount} user${selectedCount === 1 ? '' : 's'} set to ${roleValue}.`)
      } else {
        count = await bulkSetGrant({
          userIds: selectedIds,
          moduleKey,
          capability,
          effect,
          expiresAt: expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null,
        })
        const label = MODULE_LABEL[moduleKey] || moduleKey
        pushToast('success', `${effect === 'revoke' ? 'Revoke' : 'Grant'} applied to ${count} user${count === 1 ? '' : 's'}: ${capability} on ${label}.`)
      }
      setConfirming(false)
      if (mode === 'role') await loadUsers() // roles changed -> refresh directory
    } catch (err) {
      pushToast('error', toUserMessage(err, 'Could not apply the bulk change.'))
    } finally {
      setApplying(false)
    }
  }, [mode, selectedIds, selectedCount, roleValue, moduleKey, capability, effect, expiry, pushToast, loadUsers])

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
        <p className="text-xs text-[var(--text-muted)] max-w-3xl">
          Apply one change to many users at once. Set a role for the whole selection, or grant / revoke
          a capability on a module. Changes are never applied until you confirm. Role changes honour the
          server last-super-admin guard, so the confirmed count can be lower than the number selected.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_1fr] gap-4">
        {/* Left: multi-select user directory */}
        <div className="card !p-0 overflow-hidden flex flex-col max-h-[78vh]">
          <div className="p-3 border-b border-[var(--input-border)] space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                <Users size={15} className="text-[var(--brand-bright)]" /> Users
                {Array.isArray(users) && <span className="text-[var(--text-muted)] font-normal">({filteredUsers.length})</span>}
              </h3>
              <button
                onClick={loadUsers}
                disabled={refreshing}
                className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
                aria-label="Refresh users"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                className="input pl-8 py-1.5 text-sm w-full"
                placeholder="Search name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                className="input py-1.5 text-sm flex-1"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="all">All roles</option>
                {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <button
                onClick={toggleSelectAllVisible}
                disabled={filteredUsers.length === 0}
                className="text-xs inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--brand-bright)] disabled:opacity-40"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${allVisibleSelected ? 'bg-[var(--brand-bright)] border-[var(--brand-bright)]' : 'border-[var(--input-border)]'}`}>
                  {allVisibleSelected && <Check size={11} className="text-black" />}
                </span>
                Select all visible
              </button>
              {selectedCount > 0 && (
                <button onClick={clearSelection} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  Clear ({selectedCount})
                </button>
              )}
            </div>
          </div>

          <div className="overflow-y-auto flex-1">
            {users === null ? (
              <div className="p-3 space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-11 rounded-lg bg-[var(--input-bg)] animate-pulse" />
                ))}
              </div>
            ) : usersError ? (
              <div className="p-6 text-center">
                <AlertTriangle size={22} className="mx-auto mb-2 text-red-400" />
                <p className="text-sm text-red-300 font-medium">Could not load users</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{usersError}</p>
                <button onClick={loadUsers} className="btn-secondary text-xs mt-3 inline-flex items-center gap-1.5">
                  <RefreshCw size={12} /> Retry
                </button>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-8 text-center text-[var(--text-muted)]">
                <Users size={24} className="mx-auto mb-2 opacity-60" />
                <p className="text-sm">{users.length === 0 ? 'No users found.' : 'No users match your filters.'}</p>
              </div>
            ) : (
              <ul>
                {filteredUsers.map((u) => {
                  const on = selected.has(u.id)
                  return (
                    <li key={u.id}>
                      <button
                        onClick={() => toggleUser(u.id)}
                        className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--input-border)]/50 transition-colors ${
                          on ? 'bg-[var(--brand-subtle,rgba(34,197,94,0.12))]' : 'hover:bg-[var(--input-bg)]/50'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-[var(--brand-bright)] border-[var(--brand-bright)]' : 'border-[var(--input-border)]'}`}>
                          {on && <Check size={11} className="text-black" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--text-primary)] truncate flex items-center gap-1.5">
                            {displayName(u)}
                            {u.is_super_admin && <Crown size={12} className="text-amber-400 shrink-0" />}
                          </p>
                          <p className="text-xs text-[var(--text-muted)] truncate">{u.email || u.username || 'No email'}</p>
                        </div>
                        <span className={`text-[11px] font-medium shrink-0 ${ROLE_TINT[u.role] || 'text-[var(--text-secondary)]'}`}>
                          {u.role || 'No role'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Right: action builder */}
        <div className="min-w-0 space-y-4">
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Layers size={16} className="text-[var(--brand-bright)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Bulk action</h3>
              <span className="ml-auto text-xs text-[var(--text-muted)]">
                {selectedCount} user{selectedCount === 1 ? '' : 's'} selected
              </span>
            </div>

            {/* Mode switch */}
            <div className="flex gap-1.5 p-1 rounded-lg bg-[var(--surface-1)] w-fit mb-4" style={{ border: '1px solid var(--border-dim)' }}>
              {[
                { key: 'role', label: 'Set role', icon: UserCog },
                { key: 'capability', label: 'Grant / revoke', icon: KeyRound },
              ].map((m) => {
                const Icon = m.icon
                const on = mode === m.key
                return (
                  <button
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      on ? 'bg-[var(--surface-3)] text-[var(--brand-bright)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                    style={on ? { border: '1px solid var(--border-bright)' } : { border: '1px solid transparent' }}
                  >
                    <Icon size={14} /> {m.label}
                  </button>
                )
              })}
            </div>

            {mode === 'role' ? (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold block mb-1.5">New role</label>
                  <select className="input py-2 text-sm w-full" value={roleValue} onChange={(e) => setRoleValue(e.target.value)}>
                    <option value="">Select a role...</option>
                    {assignableRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <p className="text-xs text-[var(--text-muted)] inline-flex items-start gap-1.5">
                  <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                  Super admins in the selection are never demoted by this action; they are skipped server side.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold block mb-1.5">Module</label>
                  <select className="input py-2 text-sm w-full" value={moduleKey} onChange={(e) => setModuleKey(e.target.value)}>
                    <option value="">Select a module...</option>
                    {MODULE_GROUPS.map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.modules.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold block mb-1.5">Capability</label>
                    <select className="input py-2 text-sm w-full" value={capability} onChange={(e) => setCapability(e.target.value)}>
                      {CAPABILITIES.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}{c.enforced ? '' : ' (stored only)'}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold block mb-1.5">Effect</label>
                    <div className="flex gap-1.5">
                      {[
                        { key: 'grant', label: 'Grant', icon: CheckCircle2, tint: 'text-green-300 border-green-800/50 bg-green-900/20' },
                        { key: 'revoke', label: 'Revoke', icon: Ban, tint: 'text-red-300 border-red-800/50 bg-red-900/20' },
                      ].map((o) => {
                        const Icon = o.icon
                        const on = effect === o.key
                        return (
                          <button
                            key={o.key}
                            onClick={() => setEffect(o.key)}
                            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-sm border transition-colors ${
                              on ? o.tint : 'text-[var(--text-secondary)] border-[var(--input-border)] bg-[var(--input-bg)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            <Icon size={14} /> {o.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold block mb-1.5 inline-flex items-center gap-1.5">
                    <Calendar size={12} /> Expiry (optional)
                  </label>
                  <input type="date" className="input py-2 text-sm w-full" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank for a permanent override.</p>
                </div>
                {capMeta && !capMeta.enforced && (
                  <p className="text-xs text-amber-300/90 inline-flex items-start gap-1.5">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    The {capMeta.label} capability is stored for progressive enforcement and is not gated by the app yet.
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--input-border)]">
              <button
                onClick={() => setConfirming(true)}
                disabled={!canReview}
                className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-40"
              >
                Review and apply
              </button>
            </div>
          </div>

          {selectedCount === 0 && (
            <div className="card flex items-center gap-2.5 text-sm text-[var(--text-muted)]">
              <Info size={15} className="shrink-0" />
              Select one or more users on the left to enable a bulk action.
            </div>
          )}
        </div>
      </div>

      {/* Confirm modal */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true">
          <div className="card w-full max-w-md">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--brand-subtle,rgba(34,197,94,0.12))] flex items-center justify-center shrink-0">
                <Layers size={18} className="text-[var(--brand-bright)]" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-[var(--text-primary)]">Confirm bulk change</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {mode === 'role' ? (
                    <>Set role <span className="text-[var(--text-primary)] font-medium">{roleValue}</span> for{' '}
                      <span className="text-[var(--text-primary)] font-medium">{selectedCount}</span> user{selectedCount === 1 ? '' : 's'}.</>
                  ) : (
                    <><span className={effect === 'revoke' ? 'text-red-300 font-medium' : 'text-green-300 font-medium'}>{effect === 'revoke' ? 'Revoke' : 'Grant'}</span>{' '}
                      the <span className="text-[var(--text-primary)] font-medium">{capability}</span> capability on{' '}
                      <span className="text-[var(--text-primary)] font-medium">{MODULE_LABEL[moduleKey] || moduleKey}</span> for{' '}
                      <span className="text-[var(--text-primary)] font-medium">{selectedCount}</span> user{selectedCount === 1 ? '' : 's'}
                      {expiry ? <> until <span className="text-[var(--text-primary)] font-medium">{expiry}</span></> : ''}.</>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirming(false)} disabled={applying} className="btn-ghost text-sm disabled:opacity-40">
                Cancel
              </button>
              <button onClick={applyChange} disabled={applying} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {applying ? 'Applying...' : 'Apply change'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  )
}

function Toasts({ items, onDismiss }) {
  if (!items.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`card !p-3 flex items-start gap-2.5 shadow-lg border ${
            t.kind === 'error' ? 'border-red-800/60' : 'border-green-800/60'
          }`}
        >
          {t.kind === 'error'
            ? <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
            : <Check size={16} className="text-green-400 mt-0.5 shrink-0" />}
          <p className="text-sm text-[var(--text-primary)] flex-1">{t.message}</p>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
            aria-label="Dismiss"
          ><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
