/**
 * AccessPreviewOverride.jsx - the super-admin self-service "Preview and Override"
 * screen inside the console Access Control host.
 *
 * The operator picks a subject - either a ROLE or an individual USER - and sees
 * exactly which modules that subject can reach today (a preview of their sidebar)
 * grouped by product workspace, with the reason behind every allow/deny. From the
 * same rows the operator can force ALLOW or DENY on any module in one click, with
 * no dependency on anyone else:
 *
 *   - USER subject  -> per-user grant/revoke via accessGrants
 *     (set_user_access_grant / revoke_user_access_grant). Allow = grant,
 *     Deny = revoke, Clear = remove the override (falls back to the role).
 *   - ROLE subject  -> the role x module baseline via saveModulePermissions
 *     (set_module_permissions). Allow/Deny flips module_permissions.enabled.
 *
 * Admin and Super Admin subjects always resolve to full access and cannot be
 * reduced, so their override controls are disabled with an honest note.
 *
 * Every mutation re-reads the authoritative source (getEffectiveAccess for a
 * user, listGlobalPermissions for a role) so the preview updates live. All data
 * is real - honest loading, empty and error states, no fabrication.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SlidersHorizontal, Users, KeyRound, Search, RefreshCw, AlertTriangle, Crown,
  CheckCircle2, XCircle, Info, ShieldCheck, Globe, Loader2, ChevronRight,
  Check, X, Ban, RotateCcw, Filter,
} from 'lucide-react'

import { MODULE_GROUPS, ALL_MODULES, MODULE_LABEL, ACCESS_ROLES } from '../../../lib/moduleCatalog'
import { listProfiles } from '../../../lib/api/users'
import { getEffectiveAccess } from '../../../lib/api/adminAccess'
import { listUserGrants, setUserAccessGrant, revokeUserAccessGrant } from '../../../lib/api/accessGrants'
import { listGlobalPermissions, saveModulePermissions } from '../../../lib/api/modulePermissions'
import { toUserMessage } from '../../../lib/safeError'

const FULL_ACCESS_ROLES = new Set(['Admin'])

const ROLE_TINT = {
  Admin: 'text-purple-300', Manager: 'text-blue-300', Director: 'text-indigo-300',
  Reporter: 'text-cyan-300', Inspector: 'text-green-300', 'Tyre Man': 'text-amber-300',
  Driver: 'text-[var(--text-secondary)]',
}

const MODULE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'allowed', label: 'Allowed' },
  { key: 'denied', label: 'Denied' },
  { key: 'overridden', label: 'Overridden' },
]

function displayName(u) {
  return u?.full_name || u?.username || u?.email || 'Unnamed user'
}

function countryLabel(country) {
  if (!country) return 'All countries'
  const arr = Array.isArray(country) ? country.filter(Boolean) : [country].filter(Boolean)
  return arr.length ? arr.join(', ') : 'All countries'
}

export default function AccessPreviewOverride() {
  const [mode, setMode] = useState('user') // 'user' | 'role'

  // Shared toast plumbing (mirrors the sibling access pages).
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

  // ----- Users (for the "By User" subject picker) -----
  const [users, setUsers] = useState(null) // null = loading
  const [usersError, setUsersError] = useState('')
  const [usersRefreshing, setUsersRefreshing] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('all')
  const [selectedUserId, setSelectedUserId] = useState(null)

  const loadUsers = useCallback(async () => {
    setUsersRefreshing(true); setUsersError('')
    try {
      const rows = await listProfiles()
      setUsers(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setUsersError(toUserMessage(err, 'Could not load the user directory.'))
      setUsers([])
    } finally {
      setUsersRefreshing(false)
    }
  }, [])

  // ----- Role permission baseline (for the "By Role" subject + its preview) -----
  const [permMap, setPermMap] = useState(null) // null = loading
  const [permError, setPermError] = useState('')
  const [permRefreshing, setPermRefreshing] = useState(false)
  const [selectedRole, setSelectedRole] = useState(null)

  const loadPerms = useCallback(async () => {
    setPermRefreshing(true); setPermError('')
    try {
      const map = await listGlobalPermissions()
      setPermMap(map && typeof map === 'object' ? map : {})
    } catch (err) {
      setPermError(toUserMessage(err, 'Could not load the role permission matrix.'))
      setPermMap({})
    } finally {
      setPermRefreshing(false)
    }
  }, [])

  // Load the source that the active mode needs, once.
  useEffect(() => {
    if (mode === 'user' && users === null && !usersError) loadUsers()
    if (mode === 'role' && permMap === null && !permError) loadPerms()
  }, [mode, users, usersError, permMap, permError, loadUsers, loadPerms])

  // ----- User effective access + that user's grants (for override Clear ids) -----
  const [access, setAccess] = useState(null) // null = loading (when a user is selected)
  const [accessError, setAccessError] = useState('')
  const [grants, setGrants] = useState([])
  const [moduleFilter, setModuleFilter] = useState('all')
  const [busyKey, setBusyKey] = useState('') // module currently being mutated

  const selectedUser = useMemo(
    () => (users || []).find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId],
  )

  const loadAccess = useCallback(async (userId) => {
    if (!userId) { setAccess(null); setGrants([]); return }
    setAccess(null); setAccessError('')
    try {
      const [data, grantRows] = await Promise.all([
        getEffectiveAccess(userId),
        listUserGrants(userId).catch(() => []),
      ])
      setAccess(data && typeof data === 'object' ? data : { modules: [] })
      setGrants(Array.isArray(grantRows) ? grantRows : [])
    } catch (err) {
      setAccessError(toUserMessage(err, 'Could not resolve effective access for this user.'))
      setAccess({ modules: [] })
      setGrants([])
    }
  }, [])

  useEffect(() => {
    if (mode === 'user') loadAccess(selectedUserId)
  }, [mode, selectedUserId, loadAccess])

  // Role list = catalog roles plus any live/custom roles present in the matrix.
  const roleOptions = useMemo(() => {
    const set = new Set(ACCESS_ROLES)
    for (const r of Object.keys(permMap || {})) if (r) set.add(r)
    return Array.from(set)
  }, [permMap])

  const userRoleOptions = useMemo(() => {
    const set = new Set()
    for (const u of users || []) if (u.role) set.add(u.role)
    return Array.from(set).sort()
  }, [users])

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    return (users || []).filter((u) => {
      if (userRoleFilter !== 'all' && u.role !== userRoleFilter) return false
      if (!q) return true
      return (
        displayName(u).toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q) ||
        String(u.username || '').toLowerCase().includes(q)
      )
    })
  }, [users, userSearch, userRoleFilter])

  // ---- Normalised preview rows (uniform shape for both modes) ----
  const isSuperSubject = mode === 'user'
    ? (!!access?.is_super || !!selectedUser?.is_super_admin)
    : false
  const isFullRole = mode === 'role' && selectedRole && FULL_ACCESS_ROLES.has(selectedRole)
  const overridesLocked = isSuperSubject || isFullRole

  const previewRows = useMemo(() => {
    if (mode === 'user') {
      if (!access) return null
      const byKey = new Map((access.modules || []).map((m) => [m.key, m]))
      return ALL_MODULES.map((mod) => {
        const m = byKey.get(mod.key)
        const final = m ? !!m.final : false
        return {
          key: mod.key,
          group: mod.group,
          label: MODULE_LABEL[mod.key] || mod.key,
          allowed: isSuperSubject ? true : final,
          override: m?.override || null, // 'grant' | 'revoke' | null
          reason: isSuperSubject
            ? 'Super admin bypasses all gates'
            : (m?.reason || (final ? 'Allowed' : 'Denied by default')),
        }
      })
    }
    // role mode
    if (!permMap || !selectedRole) return null
    const roleMap = permMap[selectedRole] || {}
    return ALL_MODULES.map((mod) => {
      const enabled = isFullRole ? true : roleMap[mod.key] === true
      return {
        key: mod.key,
        group: mod.group,
        label: MODULE_LABEL[mod.key] || mod.key,
        allowed: enabled,
        override: null,
        reason: isFullRole
          ? 'Admin always has full access'
          : (enabled ? 'Role allows this module' : 'Denied by default (role has no access)'),
      }
    })
  }, [mode, access, permMap, selectedRole, isSuperSubject, isFullRole])

  const counts = useMemo(() => {
    const rows = previewRows || []
    let allowed = 0, denied = 0, overridden = 0
    for (const r of rows) {
      if (r.allowed) allowed += 1; else denied += 1
      if (r.override) overridden += 1
    }
    return { allowed, denied, overridden, total: rows.length }
  }, [previewRows])

  const visibleGroups = useMemo(() => {
    if (!previewRows) return []
    const filtered = previewRows.filter((r) => {
      if (moduleFilter === 'allowed') return r.allowed
      if (moduleFilter === 'denied') return !r.allowed
      if (moduleFilter === 'overridden') return !!r.override
      return true
    })
    return MODULE_GROUPS
      .map((g) => ({ group: g.group, rows: filtered.filter((r) => r.group === g.group) }))
      .filter((g) => g.rows.length > 0)
  }, [previewRows, moduleFilter])

  // ---- Override actions ----
  const applyUserOverride = useCallback(async (row, action) => {
    if (!selectedUserId || overridesLocked) return
    setBusyKey(row.key)
    try {
      if (action === 'clear') {
        const g = grants.find((x) => x.module_key === row.key && (x.capability || 'view') === 'view')
        if (g?.id) await revokeUserAccessGrant(g.id)
        pushToast('success', `Cleared the override on ${row.label}. It now follows the role.`)
      } else {
        await setUserAccessGrant({ userId: selectedUserId, moduleKey: row.key, capability: 'view', effect: action })
        pushToast('success', `${action === 'grant' ? 'Allowed' : 'Denied'} ${row.label} for ${displayName(selectedUser)}.`)
      }
      await loadAccess(selectedUserId)
    } catch (err) {
      pushToast('error', toUserMessage(err, 'Could not apply the override.'))
    } finally {
      setBusyKey('')
    }
  }, [selectedUserId, overridesLocked, grants, pushToast, selectedUser, loadAccess])

  const applyRoleOverride = useCallback(async (row, enabled) => {
    if (!selectedRole || overridesLocked) return
    setBusyKey(row.key)
    try {
      await saveModulePermissions([{ role: selectedRole, module_key: row.key, enabled }])
      pushToast('success', `${enabled ? 'Allowed' : 'Denied'} ${row.label} for the ${selectedRole} role.`)
      await loadPerms()
    } catch (err) {
      pushToast('error', toUserMessage(err, 'Could not update the role permission.'))
    } finally {
      setBusyKey('')
    }
  }, [selectedRole, overridesLocked, pushToast, loadPerms])

  const subjectChosen = mode === 'user' ? !!selectedUser : !!selectedRole

  return (
    <div className="space-y-4">
      {/* Intro */}
      <div className="flex items-start gap-2">
        <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
        <p className="text-xs text-[var(--text-muted)] max-w-3xl">
          Pick a role or a single user, preview exactly which modules they can reach (their sidebar),
          and force allow or deny on any module in one click. User changes are per-user grants; role
          changes update the role baseline for everyone with that role. Only the View capability is
          enforced today.
        </p>
      </div>

      {/* Subject mode switch */}
      <div
        className="flex gap-1.5 p-1 rounded-xl bg-[var(--surface-1)] w-fit"
        style={{ border: '1px solid var(--border-dim)' }}
        role="tablist"
        aria-label="Subject type"
      >
        {[
          { key: 'user', label: 'By User', icon: Users },
          { key: 'role', label: 'By Role', icon: KeyRound },
        ].map((m) => {
          const Icon = m.icon
          const on = mode === m.key
          return (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setMode(m.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                on
                  ? 'bg-[var(--surface-3)] text-[var(--brand-bright)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--brand-bright)]'
              }`}
              style={on ? { border: '1px solid var(--border-bright)' } : { border: '1px solid transparent' }}
            >
              <Icon size={15} /> {m.label}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-4">
        {/* Left: subject picker */}
        <div className="card !p-0 overflow-hidden flex flex-col max-h-[76vh]">
          {mode === 'user' ? (
            <UserPicker
              users={users}
              error={usersError}
              refreshing={usersRefreshing}
              onRefresh={loadUsers}
              search={userSearch}
              onSearch={setUserSearch}
              roleFilter={userRoleFilter}
              onRoleFilter={setUserRoleFilter}
              roleOptions={userRoleOptions}
              filteredUsers={filteredUsers}
              selectedId={selectedUserId}
              onSelect={setSelectedUserId}
            />
          ) : (
            <RolePicker
              permMap={permMap}
              error={permError}
              refreshing={permRefreshing}
              onRefresh={loadPerms}
              roleOptions={roleOptions}
              selectedRole={selectedRole}
              onSelect={setSelectedRole}
            />
          )}
        </div>

        {/* Right: preview + override */}
        <div className="min-w-0">
          {!subjectChosen ? (
            <div className="card flex flex-col items-center justify-center text-center py-16">
              <SlidersHorizontal size={30} className="text-[var(--text-muted)] opacity-70 mb-3" />
              <p className="text-[var(--text-primary)] font-medium">
                Pick a {mode === 'user' ? 'user' : 'role'} to preview
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">
                Choose a {mode === 'user' ? 'user from the directory' : 'role from the list'} to see
                which modules they can reach, then allow or deny any module in one click.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Subject header */}
              <div className="card">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-[var(--input-bg)] flex items-center justify-center shrink-0 text-sm font-semibold text-[var(--text-secondary)]">
                    {mode === 'user'
                      ? displayName(selectedUser).slice(0, 2).toUpperCase()
                      : <KeyRound size={18} className="text-[var(--brand-bright)]" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      {mode === 'user' ? displayName(selectedUser) : `${selectedRole} role`}
                      {overridesLocked && <Crown size={14} className="text-amber-400" />}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {mode === 'user'
                        ? (selectedUser.email || selectedUser.username || 'No email')
                        : 'Baseline access for every user with this role'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {mode === 'user' && (
                      <>
                        <span className="badge inline-flex items-center gap-1.5 bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]">
                          <ShieldCheck size={12} /> {access?.role || selectedUser.role || 'No role'}
                        </span>
                        <span className="badge inline-flex items-center gap-1.5 bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]">
                          <Globe size={12} /> {countryLabel(access?.country ?? selectedUser.country)}
                        </span>
                      </>
                    )}
                    {overridesLocked && (
                      <span className="badge inline-flex items-center gap-1.5 bg-amber-900/20 text-amber-300 border border-amber-800/50">
                        <Crown size={12} /> Full access
                      </span>
                    )}
                  </div>
                </div>

                {previewRows && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                    <Stat label="Modules" value={counts.total} tint="text-[var(--text-primary)]" />
                    <Stat label="Allowed" value={counts.allowed} tint="text-green-300" />
                    <Stat label="Denied" value={counts.denied} tint="text-red-300" />
                    <Stat
                      label={mode === 'user' ? 'Overridden' : 'Role level'}
                      value={mode === 'user' ? counts.overridden : counts.allowed}
                      tint="text-amber-300"
                    />
                  </div>
                )}
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  {counts.allowed} of {counts.total} modules allowed.
                </p>
              </div>

              {/* Full-access note */}
              {overridesLocked && (
                <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-900/15 border border-amber-800/40">
                  <Crown size={15} className="text-amber-300 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-200">
                    Admin and Super Admin always have full access and cannot be reduced. Overrides are
                    disabled for this subject.
                  </p>
                </div>
              )}

              {/* Module filter */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold inline-flex items-center gap-1.5">
                  <Filter size={12} /> Show
                </span>
                {MODULE_FILTERS.map((f) => {
                  const on = moduleFilter === f.key
                  return (
                    <button
                      key={f.key}
                      onClick={() => setModuleFilter(f.key)}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                        on
                          ? 'bg-[var(--surface-3)] text-[var(--brand-bright)] border-[var(--border-bright)]'
                          : 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {f.label}
                    </button>
                  )
                })}
              </div>

              {/* Preview + override body */}
              {previewRows === null ? (
                <div className="card flex items-center justify-center py-16">
                  <Loader2 size={22} className="animate-spin text-[var(--brand-bright)]" />
                  <span className="ml-2 text-sm text-[var(--text-muted)]">Resolving access...</span>
                </div>
              ) : (mode === 'user' && accessError) ? (
                <div className="card p-8 text-center">
                  <AlertTriangle size={22} className="mx-auto mb-2 text-red-400" />
                  <p className="text-sm text-red-300 font-medium">Could not resolve access</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{accessError}</p>
                  <button onClick={() => loadAccess(selectedUserId)} className="btn-secondary text-xs mt-3 inline-flex items-center gap-1.5">
                    <RefreshCw size={12} /> Retry
                  </button>
                </div>
              ) : (mode === 'role' && permError) ? (
                <div className="card p-8 text-center">
                  <AlertTriangle size={22} className="mx-auto mb-2 text-red-400" />
                  <p className="text-sm text-red-300 font-medium">Could not load role permissions</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{permError}</p>
                  <button onClick={loadPerms} className="btn-secondary text-xs mt-3 inline-flex items-center gap-1.5">
                    <RefreshCw size={12} /> Retry
                  </button>
                </div>
              ) : visibleGroups.length === 0 ? (
                <div className="card p-10 text-center text-[var(--text-muted)]">
                  <SlidersHorizontal size={24} className="mx-auto mb-2 opacity-60" />
                  <p className="text-sm">No modules match this filter.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleGroups.map((g) => (
                    <div key={g.group} className="card !p-0 overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-[var(--input-border)] bg-[var(--surface-1)]">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                          {g.group}
                        </h3>
                      </div>
                      <ul>
                        {g.rows.map((row) => (
                          <ModuleRow
                            key={row.key}
                            row={row}
                            mode={mode}
                            locked={overridesLocked}
                            busy={busyKey === row.key}
                            onUserOverride={applyUserOverride}
                            onRoleOverride={applyRoleOverride}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[11px] text-[var(--text-muted)]">
                Changes reach an affected user on their next refresh or re-login. Only the View
                capability is enforced today; other capabilities are stored for progressive enforcement.
              </p>
            </div>
          )}
        </div>
      </div>

      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  )
}

/* ---------------- Subpanels ---------------- */

function UserPicker({
  users, error, refreshing, onRefresh, search, onSearch, roleFilter, onRoleFilter,
  roleOptions, filteredUsers, selectedId, onSelect,
}) {
  return (
    <>
      <div className="p-3 border-b border-[var(--input-border)] space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
            <Users size={15} className="text-[var(--brand-bright)]" /> Users
            {Array.isArray(users) && <span className="text-[var(--text-muted)] font-normal">({filteredUsers.length})</span>}
          </h3>
          <button
            onClick={onRefresh}
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
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <select
          className="input py-1.5 text-sm w-full"
          value={roleFilter}
          onChange={(e) => onRoleFilter(e.target.value)}
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
        ) : error ? (
          <div className="p-6 text-center">
            <AlertTriangle size={22} className="mx-auto mb-2 text-red-400" />
            <p className="text-sm text-red-300 font-medium">Could not load users</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
            <button onClick={onRefresh} className="btn-secondary text-xs mt-3 inline-flex items-center gap-1.5">
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
              const on = u.id === selectedId
              return (
                <li key={u.id}>
                  <button
                    onClick={() => onSelect(u.id)}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--input-border)]/50 transition-colors ${
                      on ? 'bg-[var(--brand-subtle,rgba(34,197,94,0.12))]' : 'hover:bg-[var(--input-bg)]/50'
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
                    <ChevronRight size={14} className={`shrink-0 ${on ? 'text-[var(--brand-bright)]' : 'text-[var(--text-muted)]'}`} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

function RolePicker({ permMap, error, refreshing, onRefresh, roleOptions, selectedRole, onSelect }) {
  return (
    <>
      <div className="p-3 border-b border-[var(--input-border)] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
          <KeyRound size={15} className="text-[var(--brand-bright)]" /> Roles
          {Array.isArray(roleOptions) && <span className="text-[var(--text-muted)] font-normal">({roleOptions.length})</span>}
        </h3>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
          aria-label="Refresh roles"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {permMap === null ? (
          <div className="p-3 space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-11 rounded-lg bg-[var(--input-bg)] animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <AlertTriangle size={22} className="mx-auto mb-2 text-red-400" />
            <p className="text-sm text-red-300 font-medium">Could not load roles</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
            <button onClick={onRefresh} className="btn-secondary text-xs mt-3 inline-flex items-center gap-1.5">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        ) : (
          <ul>
            {roleOptions.map((r) => {
              const on = r === selectedRole
              const isFull = FULL_ACCESS_ROLES.has(r)
              return (
                <li key={r}>
                  <button
                    onClick={() => onSelect(r)}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--input-border)]/50 transition-colors ${
                      on ? 'bg-[var(--brand-subtle,rgba(34,197,94,0.12))]' : 'hover:bg-[var(--input-bg)]/50'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-[var(--input-bg)] flex items-center justify-center shrink-0">
                      <KeyRound size={14} className={ROLE_TINT[r] || 'text-[var(--text-secondary)]'} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium truncate flex items-center gap-1.5 ${ROLE_TINT[r] || 'text-[var(--text-primary)]'}`}>
                        {r}
                        {isFull && <Crown size={12} className="text-amber-400 shrink-0" />}
                      </p>
                    </div>
                    <ChevronRight size={14} className={`shrink-0 ${on ? 'text-[var(--brand-bright)]' : 'text-[var(--text-muted)]'}`} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

function ModuleRow({ row, mode, locked, busy, onUserOverride, onRoleOverride }) {
  return (
    <li className="px-4 py-3 flex items-center gap-3 border-b border-[var(--input-border)]/50 last:border-b-0 hover:bg-[var(--input-bg)]/40">
      {/* State */}
      <div className="shrink-0">
        {row.allowed
          ? <CheckCircle2 size={17} className="text-green-400" />
          : <XCircle size={17} className="text-red-400" />}
      </div>

      {/* Label + reason */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate flex items-center gap-2">
          {row.label}
          {mode === 'user' && row.override === 'grant' && (
            <span className="badge bg-green-900/25 text-green-300 border border-green-800/50 text-[10px]">Grant</span>
          )}
          {mode === 'user' && row.override === 'revoke' && (
            <span className="badge bg-red-900/25 text-red-300 border border-red-800/50 text-[10px]">Revoke</span>
          )}
        </p>
        <p className="text-[11px] text-[var(--text-muted)] truncate">{row.reason || 'N/A'}</p>
      </div>

      {/* Override control */}
      <div className="shrink-0 flex items-center gap-1">
        {busy ? (
          <Loader2 size={16} className="animate-spin text-[var(--brand-bright)] mx-3" />
        ) : locked ? (
          <span className="text-[11px] text-[var(--text-muted)] italic px-2">Locked</span>
        ) : mode === 'user' ? (
          <div className="flex items-center gap-1 rounded-lg bg-[var(--input-bg)] p-0.5 border border-[var(--input-border)]">
            <SegBtn
              active={row.override === 'grant'}
              tone="green"
              title="Allow (per-user grant)"
              onClick={() => onUserOverride(row, 'grant')}
            >
              <Check size={13} /> Allow
            </SegBtn>
            <SegBtn
              active={row.override === 'revoke'}
              tone="red"
              title="Deny (per-user revoke)"
              onClick={() => onUserOverride(row, 'revoke')}
            >
              <Ban size={13} /> Deny
            </SegBtn>
            <SegBtn
              active={false}
              tone="muted"
              title="Clear the override (follow the role)"
              disabled={!row.override}
              onClick={() => onUserOverride(row, 'clear')}
            >
              <RotateCcw size={13} /> Clear
            </SegBtn>
          </div>
        ) : (
          <div className="flex items-center gap-1 rounded-lg bg-[var(--input-bg)] p-0.5 border border-[var(--input-border)]">
            <SegBtn
              active={row.allowed}
              tone="green"
              title="Allow this module for the role"
              onClick={() => onRoleOverride(row, true)}
            >
              <Check size={13} /> Allow
            </SegBtn>
            <SegBtn
              active={!row.allowed}
              tone="red"
              title="Deny this module for the role"
              onClick={() => onRoleOverride(row, false)}
            >
              <Ban size={13} /> Deny
            </SegBtn>
          </div>
        )}
      </div>
    </li>
  )
}

function SegBtn({ active, tone, title, onClick, disabled, children }) {
  const toneOn = tone === 'green'
    ? 'bg-green-900/40 text-green-200 border-green-700/60'
    : tone === 'red'
      ? 'bg-red-900/40 text-red-200 border-red-700/60'
      : 'bg-[var(--surface-3)] text-[var(--text-primary)] border-[var(--border-bright)]'
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? toneOn
          : 'bg-transparent text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  )
}

function Stat({ label, value, tint }) {
  return (
    <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className={`text-lg font-bold ${tint}`}>{value}</p>
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
