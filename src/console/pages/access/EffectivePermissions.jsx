/**
 * EffectivePermissions.jsx - the headline "what can this user actually do, and
 * why" viewer inside the console Access Control host.
 *
 * A user's real reach is not just their role: a per-user grant can open a module
 * the role cannot reach, a revoke can close one it normally can, and a super
 * admin bypasses everything. This screen resolves all of that server-side via
 * adminAccess.getEffectiveAccess(userId) and renders the resolution per module:
 * Role allows | Override | Capabilities | Final | Why.
 *
 * All data is read-only here (this is an explainer, not an editor - use the
 * Per-User Grants tab to change anything). The console guard already guarantees
 * a super-admin operator, so getEffectiveAccess never 42501s in practice; we
 * still surface a clean error state if the RPC fails for any reason.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, Search, RefreshCw, AlertTriangle, Crown, ChevronRight, Eye,
  CheckCircle2, XCircle, Info, Globe, ShieldCheck, Filter, Loader2,
} from 'lucide-react'
import { MODULE_LABEL } from '../../../lib/moduleCatalog'
import { CAPABILITIES } from '../../../lib/permissionMatrix'
import { listProfiles } from '../../../lib/api/users'
import { getEffectiveAccess } from '../../../lib/api/adminAccess'
import { toUserMessage } from '../../../lib/safeError'

// Capability columns rendered in the matrix (view is the only one enforced today).
const CAP_COLS = CAPABILITIES.filter((c) =>
  ['view', 'create', 'edit', 'delete', 'export'].includes(c.key),
)

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

function capEffect(caps, key) {
  const v = caps && typeof caps === 'object' ? caps[key] : null
  return v === 'grant' || v === 'revoke' ? v : null
}

export default function EffectivePermissions() {
  const [users, setUsers] = useState(null) // null = loading
  const [usersError, setUsersError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)

  const [access, setAccess] = useState(null) // null = loading (when a user is selected)
  const [accessError, setAccessError] = useState('')
  const [moduleFilter, setModuleFilter] = useState('all')

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

  const loadAccess = useCallback(async (userId) => {
    if (!userId) { setAccess(null); return }
    setAccess(null); setAccessError('')
    try {
      const data = await getEffectiveAccess(userId)
      setAccess(data && typeof data === 'object' ? data : { modules: [] })
    } catch (err) {
      setAccessError(toUserMessage(err, 'Could not resolve effective access for this user.'))
      setAccess({ modules: [] })
    }
  }, [])

  useEffect(() => { loadAccess(selectedId) }, [selectedId, loadAccess])

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

  const modules = access?.modules || []
  const isSuper = !!access?.is_super

  const counts = useMemo(() => {
    let allowed = 0, denied = 0, overridden = 0
    for (const m of modules) {
      if (m.final) allowed += 1; else denied += 1
      if (m.override) overridden += 1
    }
    return { allowed, denied, overridden, total: modules.length }
  }, [modules])

  const visibleModules = useMemo(() => {
    return modules.filter((m) => {
      if (moduleFilter === 'allowed') return !!m.final
      if (moduleFilter === 'denied') return !m.final
      if (moduleFilter === 'overridden') return !!m.override
      return true
    })
  }, [modules, moduleFilter])

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
        <p className="text-xs text-[var(--text-muted)] max-w-3xl">
          The definitive answer to "what can this person actually do, and why". Access is resolved
          server side from the role baseline plus per-user grants and revokes. A super admin bypasses
          all gates. Only the View capability is enforced today; the other capability columns are
          stored for progressive enforcement.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-4">
        {/* Left: user directory */}
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
                <p className="text-sm">{users.length === 0 ? 'No users found.' : 'No users match your filters.'}</p>
              </div>
            ) : (
              <ul>
                {filteredUsers.map((u) => {
                  const on = u.id === selectedId
                  return (
                    <li key={u.id}>
                      <button
                        onClick={() => setSelectedId(u.id)}
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
        </div>

        {/* Right: resolved access */}
        <div className="min-w-0">
          {!selectedUser ? (
            <div className="card flex flex-col items-center justify-center text-center py-16">
              <Eye size={30} className="text-[var(--text-muted)] opacity-70 mb-3" />
              <p className="text-[var(--text-primary)] font-medium">Select a user</p>
              <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">
                Choose someone from the directory to see exactly which modules they can reach and
                the reason behind every decision.
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
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      {displayName(selectedUser)}
                      {(selectedUser.is_super_admin || isSuper) && <Crown size={14} className="text-amber-400" />}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{selectedUser.email || selectedUser.username}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge inline-flex items-center gap-1.5 bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]">
                      <ShieldCheck size={12} /> {access?.role || selectedUser.role || 'No role'}
                    </span>
                    <span className="badge inline-flex items-center gap-1.5 bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]">
                      <Globe size={12} /> {countryLabel(access?.country ?? selectedUser.country)}
                    </span>
                    {(selectedUser.is_super_admin || isSuper) && (
                      <span className="badge inline-flex items-center gap-1.5 bg-amber-900/20 text-amber-300 border border-amber-800/50">
                        <Crown size={12} /> Super admin
                      </span>
                    )}
                  </div>
                </div>

                {access && !accessError && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                    <Stat label="Modules" value={counts.total} tint="text-[var(--text-primary)]" />
                    <Stat label="Allowed" value={counts.allowed} tint="text-green-300" />
                    <Stat label="Denied" value={counts.denied} tint="text-red-300" />
                    <Stat label="Overridden" value={counts.overridden} tint="text-amber-300" />
                  </div>
                )}
              </div>

              {/* Super-admin banner */}
              {isSuper && (
                <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-900/15 border border-amber-800/40">
                  <Crown size={15} className="text-amber-300 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-200">
                    This user is a super admin and bypasses all module and capability gates. Every
                    module below resolves to allowed regardless of role or grants.
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

              {/* Resolution table */}
              <div className="card !p-0 overflow-hidden">
                {access === null ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 size={22} className="animate-spin text-[var(--brand-bright)]" />
                    <span className="ml-2 text-sm text-[var(--text-muted)]">Resolving access...</span>
                  </div>
                ) : accessError ? (
                  <div className="p-8 text-center">
                    <AlertTriangle size={22} className="mx-auto mb-2 text-red-400" />
                    <p className="text-sm text-red-300 font-medium">Could not resolve access</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{accessError}</p>
                    <button onClick={() => loadAccess(selectedId)} className="btn-secondary text-xs mt-3 inline-flex items-center gap-1.5">
                      <RefreshCw size={12} /> Retry
                    </button>
                  </div>
                ) : visibleModules.length === 0 ? (
                  <div className="p-10 text-center text-[var(--text-muted)]">
                    <Eye size={24} className="mx-auto mb-2 opacity-60" />
                    <p className="text-sm">No modules match this filter.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[860px]">
                      <thead>
                        <tr className="border-b border-[var(--input-border)] bg-[var(--surface-1)]">
                          <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold sticky left-0 bg-[var(--surface-1)] z-10">Module</th>
                          <th className="px-3 py-2.5 text-center text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Role</th>
                          <th className="px-3 py-2.5 text-center text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Override</th>
                          {CAP_COLS.map((c) => (
                            <th key={c.key} className="px-2 py-2.5 text-center text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold" title={c.enforced ? 'Enforced today' : 'Stored only'}>
                              {c.label}
                            </th>
                          ))}
                          <th className="px-3 py-2.5 text-center text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Final</th>
                          <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleModules.map((m) => (
                          <tr key={m.key} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                            <td className="px-4 py-2.5 sticky left-0 bg-[var(--card-bg,var(--surface-2))] z-10">
                              <span className="text-[var(--text-primary)] font-medium">{MODULE_LABEL[m.key] || m.key}</span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {m.role_allows
                                ? <CheckCircle2 size={15} className="inline text-green-400" />
                                : <XCircle size={15} className="inline text-[var(--text-muted)]" />}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {m.override === 'grant' ? (
                                <span className="badge bg-green-900/25 text-green-300 border border-green-800/50">Grant</span>
                              ) : m.override === 'revoke' ? (
                                <span className="badge bg-red-900/25 text-red-300 border border-red-800/50">Revoke</span>
                              ) : (
                                <span className="text-[var(--text-muted)] text-xs">None</span>
                              )}
                            </td>
                            {CAP_COLS.map((c) => {
                              const eff = capEffect(m.caps, c.key)
                              return (
                                <td key={c.key} className="px-2 py-2.5 text-center">
                                  {eff === 'grant' ? (
                                    <CheckCircle2 size={13} className="inline text-green-400" title="Granted" />
                                  ) : eff === 'revoke' ? (
                                    <XCircle size={13} className="inline text-red-400" title="Revoked" />
                                  ) : (
                                    <span className="text-[var(--text-muted)] text-xs" title="Inherited from role">-</span>
                                  )}
                                </td>
                              )
                            })}
                            <td className="px-3 py-2.5 text-center">
                              {m.final ? (
                                <span className="badge bg-green-900/25 text-green-300 border border-green-800/50 inline-flex items-center gap-1">
                                  <CheckCircle2 size={11} /> Allowed
                                </span>
                              ) : (
                                <span className="badge bg-red-900/25 text-red-300 border border-red-800/50 inline-flex items-center gap-1">
                                  <XCircle size={11} /> Denied
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] max-w-[280px]">
                              {m.reason || 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-[var(--text-muted)]">
                A check in a capability column means an explicit per-user grant or revoke on that
                capability. A dash means it is inherited from the role. Only View is enforced by the
                app today; the rest are stored for progressive enforcement.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
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
