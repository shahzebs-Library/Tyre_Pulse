/**
 * AccessGrantsManager - the "Per-User Grants" surface inside Master Access Control.
 *
 * This is the single place where a Super Admin gives ONE specific user MORE or LESS
 * access than their role baseline. A role defines the default module map; a grant is
 * an additive per-user override on top of that:
 *   - effect 'grant'  -> the user CAN open the module even if their role cannot
 *   - effect 'revoke' -> the user CANNOT open the module even if their role can
 *
 * Only the 'view' capability is enforced by the app today (AuthContext.grantOverrides
 * -> hasPermission). The capability selector is surfaced honestly: other capabilities
 * are STORED for progressive enforcement, not yet enforced, and the UI says so.
 *
 * Reads/writes go exclusively through src/lib/api/accessGrants.js (listUserGrants /
 * setUserAccessGrant / revokeUserAccessGrant). Writes are super-admin only and enforced
 * server-side; a non-super caller gets a 42501 which is mapped to a clean message via
 * toUserMessage. The user list reuses the existing users service (listProfiles) - no new
 * users API is introduced.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Search, ShieldCheck, Crown, UserPlus, Plus, Trash2, X, Check, Ban,
  AlertTriangle, Loader2, Info, Calendar, KeyRound, RefreshCw, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { MODULE_GROUPS, MODULE_LABEL } from '../lib/moduleCatalog'
import { CAPABILITIES } from '../lib/permissionMatrix'
import { listProfiles } from '../lib/api/users'
import {
  listUserGrants, setUserAccessGrant, revokeUserAccessGrant,
} from '../lib/api/accessGrants'
import { toUserMessage } from '../lib/safeError'

const ROLE_TINT = {
  Admin: 'text-purple-300', Manager: 'text-blue-300', Director: 'text-indigo-300',
  Reporter: 'text-cyan-300', Inspector: 'text-green-300', 'Tyre Man': 'text-amber-300',
  Driver: 'text-secondary',
}

function fmtDate(value) {
  if (!value) return 'N/A'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function displayName(u) {
  return u?.full_name || u?.username || u?.email || 'Unnamed user'
}

// ── Toasts (self-contained, no external lib) ─────────────────────────────────
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

// ── Searchable, grouped single-select module picker (inline, not a dropdown) ──
// Rendered inline inside the form so it is never clipped by the card overflow.
function ModulePicker({ value, onPick }) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const groups = useMemo(() => (
    MODULE_GROUPS
      .map((g) => ({
        ...g,
        modules: g.modules.filter(
          (m) => !query || m.label.toLowerCase().includes(query) || m.key.includes(query),
        ),
      }))
      .filter((g) => g.modules.length)
  ), [query])

  return (
    <div>
      <div className="relative mb-2">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          className="input pl-8 py-1.5 text-sm w-full"
          placeholder="Search modules..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="max-h-64 overflow-y-auto pr-1 space-y-3 rounded-lg border border-[var(--input-border)] p-2">
        {groups.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">No modules match "{q}".</p>
        ) : groups.map((g) => (
          <div key={g.group}>
            <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">{g.group}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {g.modules.map((m) => {
                const on = value === m.key
                return (
                  <button
                    type="button"
                    key={m.key}
                    onClick={() => onPick(m.key)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left text-sm transition-colors ${
                      on
                        ? 'border-indigo-500/50 bg-indigo-500/10 text-[var(--text-primary)]'
                        : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-full border shrink-0 ${on ? 'border-indigo-400 bg-indigo-500' : 'border-[var(--input-border)]'}`}>
                      {on && <Check size={11} className="text-white" />}
                    </span>
                    <span className="truncate">{m.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const EMPTY_FORM = { moduleKey: '', effect: 'grant', capability: 'view', expiry: '', note: '' }

export default function AccessGrantsManager() {
  const { profile, isSuperAdmin } = useAuth()

  // Users
  const [users, setUsers] = useState(null)          // null = loading
  const [usersError, setUsersError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)

  // Grants for the selected user
  const [grants, setGrants] = useState(null)        // null = loading
  const [grantsError, setGrantsError] = useState('')

  // Add-grant form
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Remove confirm
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [removing, setRemoving] = useState(false)

  // Toasts
  const [toasts, setToasts] = useState([])
  const timers = useRef({})
  const pushToast = useCallback((kind, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setToasts((t) => [...t, { id, kind, message }])
    timers.current[id] = setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
      delete timers.current[id]
    }, 5000)
  }, [])
  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id] }
  }, [])
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout) }, [])

  // ── Load users ─────────────────────────────────────────────────────────────
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

  const selectedUser = useMemo(
    () => (users || []).find((u) => u.id === selectedId) || null,
    [users, selectedId],
  )

  // ── Load grants for the selected user ────────────────────────────────────────
  const loadGrants = useCallback(async (userId) => {
    if (!userId) { setGrants(null); return }
    setGrants(null); setGrantsError('')
    try {
      const rows = await listUserGrants(userId)
      setGrants(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setGrantsError(toUserMessage(err, 'Could not load grants for this user.'))
      setGrants([])
    }
  }, [])

  useEffect(() => { loadGrants(selectedId) }, [selectedId, loadGrants])

  function selectUser(id) {
    setSelectedId(id)
    setForm(EMPTY_FORM)
    setFormError('')
  }

  // ── Role filter options (built from real data) ───────────────────────────────
  const roleOptions = useMemo(() => {
    const set = new Set()
    for (const u of users || []) if (u.role) set.add(u.role)
    return Array.from(set).sort()
  }, [users])

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

  // ── Save a grant ─────────────────────────────────────────────────────────────
  const save = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!selectedUser) return
    if (!form.moduleKey) { setFormError('Pick a module first.'); return }
    setSaving(true)
    try {
      await setUserAccessGrant({
        userId: selectedUser.id,
        moduleKey: form.moduleKey,
        capability: form.capability || 'view',
        effect: form.effect,
        note: form.note.trim() || null,
        expiresAt: form.expiry ? new Date(`${form.expiry}T23:59:59`).toISOString() : null,
      })
      const label = MODULE_LABEL[form.moduleKey] || form.moduleKey
      pushToast('success', `${form.effect === 'revoke' ? 'Revoke' : 'Grant'} saved: ${label} for ${displayName(selectedUser)}.`)
      setForm(EMPTY_FORM)
      await loadGrants(selectedUser.id)
    } catch (err) {
      const msg = toUserMessage(err, 'Could not save the grant.')
      setFormError(msg)
      pushToast('error', msg)
    } finally {
      setSaving(false)
    }
  }, [selectedUser, form, loadGrants, pushToast])

  // ── Remove a grant ───────────────────────────────────────────────────────────
  const doRemove = useCallback(async () => {
    if (!confirmRemove) return
    setRemoving(true)
    try {
      await revokeUserAccessGrant(confirmRemove.id)
      const label = MODULE_LABEL[confirmRemove.module_key] || confirmRemove.module_key
      pushToast('success', `Removed grant: ${label}.`)
      setConfirmRemove(null)
      await loadGrants(selectedId)
    } catch (err) {
      pushToast('error', toUserMessage(err, 'Could not remove the grant.'))
    } finally {
      setRemoving(false)
    }
  }, [confirmRemove, selectedId, loadGrants, pushToast])

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
          <p className="text-xs text-[var(--text-muted)] max-w-2xl">
            Give one specific person more or less access than their role. A <span className="text-green-300">Grant</span> opens a
            module the role cannot reach; a <span className="text-red-300">Revoke</span> closes a module the role normally can.
            Grants are additive overrides on top of the role baseline and only the View capability is enforced today.
          </p>
        </div>
        {!isSuperAdmin && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-900/20 border border-amber-800/50 rounded-full px-2.5 py-1">
            <AlertTriangle size={12} /> Read only: saving grants is Super Admin only.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-4">
        {/* ── Left: user directory ── */}
        <div className="card !p-0 overflow-hidden flex flex-col max-h-[76vh]">
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
            <select
              className="input py-1.5 text-sm w-full"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="all">All roles</option>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="overflow-y-auto flex-1">
            {users === null ? (
              <div className="p-3 space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 rounded-lg bg-[var(--input-bg)] animate-pulse" />
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
                <p className="text-sm">{(users.length === 0) ? 'No users found.' : 'No users match your filters.'}</p>
              </div>
            ) : (
              <ul>
                {filteredUsers.map((u) => {
                  const on = u.id === selectedId
                  return (
                    <li key={u.id}>
                      <button
                        onClick={() => selectUser(u.id)}
                        className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--input-border)]/50 transition-colors ${
                          on ? 'bg-indigo-500/10' : 'hover:bg-[var(--input-bg)]/50'
                        }`}
                      >
                        <div className="w-8 h-8 rounded-full bg-[var(--input-bg)] flex items-center justify-center shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                          {displayName(u).slice(0, 2).toUpperCase()}
                        </div>
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
                        <ChevronRight size={14} className={`shrink-0 ${on ? 'text-indigo-300' : 'text-[var(--text-muted)]'}`} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ── Right: selected-user grant manager ── */}
        <div className="min-w-0">
          {!selectedUser ? (
            <div className="card flex flex-col items-center justify-center text-center py-16">
              <UserPlus size={30} className="text-[var(--text-muted)] opacity-70 mb-3" />
              <p className="text-[var(--text-primary)] font-medium">Select a user</p>
              <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">
                Choose someone from the directory to review their role baseline and add or remove per-user access grants.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Selected user header */}
              <div className="card">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-[var(--input-bg)] flex items-center justify-center shrink-0 text-sm font-semibold text-[var(--text-secondary)]">
                    {displayName(selectedUser).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                      {displayName(selectedUser)}
                      {selectedUser.is_super_admin && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-300 bg-amber-900/20 border border-amber-800/50 rounded-full px-2 py-0.5">
                          <Crown size={11} /> Super Admin
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{selectedUser.email || selectedUser.username || 'No email'}</p>
                  </div>
                  <span className={`ml-auto inline-flex items-center gap-1.5 text-xs font-medium ${ROLE_TINT[selectedUser.role] || 'text-[var(--text-secondary)]'}`}>
                    <ShieldCheck size={13} /> {selectedUser.role || 'No role'}
                  </span>
                </div>
                <div className="mt-3 flex items-start gap-2 text-xs text-[var(--text-muted)] bg-[var(--input-bg)]/50 rounded-lg px-3 py-2">
                  <Info size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Role <span className="text-[var(--text-secondary)] font-medium">{selectedUser.role || 'None'}</span> baseline
                    applies; the grants below are additive overrides on top of it.
                  </span>
                </div>
              </div>

              {/* Add grant */}
              <form onSubmit={save} className="card space-y-4">
                <div className="flex items-center gap-2">
                  <Plus size={15} className="text-[var(--brand-bright)]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Add a grant</h3>
                </div>

                <div>
                  <label className="label">Module</label>
                  <ModulePicker value={form.moduleKey} onPick={(k) => { setForm((f) => ({ ...f, moduleKey: k })); setFormError('') }} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Effect toggle */}
                  <div>
                    <label className="label">Effect</label>
                    <div className="inline-flex rounded-lg border border-[var(--input-border)] overflow-hidden w-full">
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, effect: 'grant' }))}
                        className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                          form.effect === 'grant' ? 'bg-green-500/15 text-green-300' : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'
                        }`}
                      ><Check size={14} /> Grant</button>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, effect: 'revoke' }))}
                        className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-l border-[var(--input-border)] ${
                          form.effect === 'revoke' ? 'bg-red-500/15 text-red-300' : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'
                        }`}
                      ><Ban size={14} /> Revoke</button>
                    </div>
                  </div>

                  {/* Capability */}
                  <div>
                    <label className="label">Capability</label>
                    <select
                      className="input py-2 text-sm w-full"
                      value={form.capability}
                      onChange={(e) => setForm((f) => ({ ...f, capability: e.target.value }))}
                    >
                      {CAPABILITIES.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}{c.enforced ? ' (enforced)' : ' (stored only)'}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">Only View is enforced today.</p>
                  </div>

                  {/* Expiry */}
                  <div>
                    <label className="label">Expiry (optional)</label>
                    <div className="relative">
                      <Calendar size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                      <input
                        type="date"
                        className="input pl-8 py-2 text-sm w-full"
                        value={form.expiry}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))}
                      />
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank for no expiry.</p>
                  </div>
                </div>

                <div>
                  <label className="label">Note (optional)</label>
                  <input
                    className="input py-2 text-sm w-full"
                    placeholder="Why this override is being applied"
                    maxLength={500}
                    value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  />
                </div>

                {formError && (
                  <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[var(--text-muted)]">
                    {form.moduleKey
                      ? <>Saving <span className={form.effect === 'revoke' ? 'text-red-300' : 'text-green-300'}>{form.effect}</span> for <span className="text-[var(--text-secondary)]">{MODULE_LABEL[form.moduleKey] || form.moduleKey}</span>.</>
                      : 'Pick a module to continue.'}
                  </p>
                  <button
                    type="submit"
                    disabled={saving || !form.moduleKey || !isSuperAdmin}
                    className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : <><Check size={14} /> Save grant</>}
                  </button>
                </div>
              </form>

              {/* Current grants */}
              <div className="card !p-0 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--input-border)]">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                    <KeyRound size={15} className="text-indigo-300" /> Current grants
                    {Array.isArray(grants) && <span className="text-[var(--text-muted)] font-normal">({grants.length})</span>}
                  </h3>
                  <button
                    onClick={() => loadGrants(selectedId)}
                    className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    aria-label="Refresh grants"
                  ><RefreshCw size={13} /></button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                        {['Effect', 'Module', 'Capability', 'Expires', 'Granted', ''].map((h, i) => (
                          <th key={i} className="px-4 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grants === null ? (
                        [0, 1, 2].map((i) => (
                          <tr key={i} className="border-b border-[var(--input-border)]/50">
                            <td colSpan={6} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td>
                          </tr>
                        ))
                      ) : grantsError ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center">
                            <AlertTriangle size={22} className="mx-auto mb-2 text-red-400" />
                            <p className="text-sm text-red-300 font-medium">Could not load grants</p>
                            <p className="text-xs text-[var(--text-muted)] mt-1">{grantsError}</p>
                          </td>
                        </tr>
                      ) : grants.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center text-[var(--text-muted)]">
                            <KeyRound size={24} className="mx-auto mb-2 opacity-60" />
                            No per-user grants yet. This user gets exactly their role baseline.
                          </td>
                        </tr>
                      ) : grants.map((g) => {
                        const revoke = g.effect === 'revoke'
                        return (
                          <tr key={g.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border ${
                                revoke
                                  ? 'text-red-300 bg-red-900/20 border-red-800/50'
                                  : 'text-green-300 bg-green-900/20 border-green-800/50'
                              }`}>
                                {revoke ? <Ban size={11} /> : <Check size={11} />}
                                {revoke ? 'Revoke' : 'Grant'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium whitespace-nowrap">
                              {MODULE_LABEL[g.module_key] || g.module_key}
                            </td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)] capitalize">{g.capability || 'view'}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(g.expires_at)}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(g.created_at)}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                onClick={() => setConfirmRemove(g)}
                                disabled={!isSuperAdmin}
                                className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 disabled:opacity-40"
                                aria-label="Remove grant"
                              ><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Remove confirm */}
      {confirmRemove && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !removing && setConfirmRemove(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Remove this grant?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  The <span className={confirmRemove.effect === 'revoke' ? 'text-red-300' : 'text-green-300'}>{confirmRemove.effect}</span> on
                  {' '}<span className="text-[var(--text-secondary)]">{MODULE_LABEL[confirmRemove.module_key] || confirmRemove.module_key}</span> will
                  be deleted and this user reverts to their role baseline for it.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmRemove(null)} className="btn-secondary text-sm" disabled={removing}>Cancel</button>
              <button onClick={doRemove} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={removing}>
                {removing ? <><Loader2 size={14} className="animate-spin" /> Removing...</> : <><Trash2 size={14} /> Remove</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  )
}
