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
 *
 * Presentation (filtering, grant state, KPI summary, export rows) lives in the pure
 * src/lib/accessGrantsAnalytics.js engine; it describes grants only and never decides
 * access. The grants register is the shared EnterpriseTable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Search, ShieldCheck, Crown, UserPlus, Plus, Trash2, X, Check, Ban,
  AlertTriangle, Loader2, Info, Calendar, KeyRound, RefreshCw, ChevronRight,
  Hourglass, FileSpreadsheet, FileText,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { MODULE_GROUPS, MODULE_LABEL } from '../lib/moduleCatalog'
import { CAPABILITIES } from '../lib/permissionMatrix'
import { listProfiles } from '../lib/api/users'
import {
  listUserGrants, setUserAccessGrant, revokeUserAccessGrant,
} from '../lib/api/accessGrants'
import { toUserMessage } from '../lib/safeError'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import {
  displayName, initials, filterUsers, roleOptions as buildRoleOptions, grantState, grantSummary,
  directorySummary, grantExportRows, GRANT_STATE_LABEL, GRANT_EXPORT_COLS, GRANT_EXPORT_HEADERS,
} from '../lib/accessGrantsAnalytics'

const ROLE_TINT = {
  Admin: 'text-purple-500', Manager: 'text-blue-500', Director: 'text-indigo-500',
  Reporter: 'text-cyan-500', Inspector: 'text-green-500', 'Tyre Man': 'text-amber-500',
  Driver: 'text-[var(--text-secondary)]',
}
const STATE_CLS = {
  permanent: 'text-[var(--text-secondary)]',
  active: 'text-[var(--text-secondary)]',
  expiring: 'text-amber-500',
  expired: 'text-[var(--text-muted)]',
}
const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] disabled:opacity-40'

function fmtDate(value) {
  if (!value) return 'N/A'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
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
            t.kind === 'error' ? 'border-red-500/50' : 'border-green-500/50'
          }`}
        >
          {t.kind === 'error'
            ? <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
            : <Check size={16} className="text-green-500 mt-0.5 shrink-0" aria-hidden="true" />}
          <p className="text-sm text-[var(--text-primary)] flex-1">{t.message}</p>
          <button
            onClick={() => onDismiss(t.id)}
            className="inline-flex items-center justify-center min-w-[32px] min-h-[32px] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
            aria-label="Dismiss notification"
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
          aria-label="Search modules"
          className="input pl-8 py-1.5 text-sm w-full min-h-[44px]"
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
                    aria-pressed={on}
                    className={`flex items-center gap-2 px-2.5 py-1.5 min-h-[44px] rounded-lg border text-left text-sm transition-colors ${
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
  const [nowMs, setNowMs] = useState(() => Date.now())

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
      setNowMs(Date.now())
    } catch (err) {
      // A failed read is not "no grants": the register shows the error with
      // Retry instead of an empty role baseline.
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

  // ── Role filter options + filtered directory (engine, real data only) ───────
  const roleOptions = useMemo(() => buildRoleOptions(users || []), [users])
  const filteredUsers = useMemo(() => filterUsers(users || [], { search, role: roleFilter }), [users, search, roleFilter])
  const dirSummary = useMemo(() => directorySummary(users || []), [users])
  const gSummary = useMemo(
    () => (Array.isArray(grants) && !grantsError ? grantSummary(grants, nowMs) : null),
    [grants, grantsError, nowMs],
  )

  const exportGrants = useCallback(async (kind) => {
    if (!selectedUser || !Array.isArray(grants) || !grants.length) return
    const rows = grantExportRows(grants, { user: selectedUser, moduleLabel: MODULE_LABEL, now: nowMs, fmt: fmtDate })
    const base = reportFileName('TyrePulse Access Grants', displayName(selectedUser), reportDateLabel())
    try {
      if (kind === 'xlsx') await exportToExcel(rows, GRANT_EXPORT_COLS, GRANT_EXPORT_HEADERS, base, 'Grants', { title: 'Per-User Access Grants' })
      else await exportToPdf(rows, GRANT_EXPORT_COLS.map((key, i) => ({ key, header: GRANT_EXPORT_HEADERS[i] })), `Access Grants: ${displayName(selectedUser)}`, base, 'landscape')
    } catch (err) {
      pushToast('error', toUserMessage(err, 'Could not export. Try again.'))
    }
  }, [selectedUser, grants, nowMs, pushToast])

  const grantColumns = useMemo(() => [
    {
      id: 'effect', header: 'Effect', accessorFn: (g) => (g.effect === 'revoke' ? 'Revoke' : 'Grant'), size: 110, meta: { filterVariant: 'select' },
      cell: ({ row }) => {
        const revoke = row.original.effect === 'revoke'
        return (
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border ${
            revoke ? 'text-red-500 bg-red-500/10 border-red-500/40' : 'text-green-500 bg-green-500/10 border-green-500/40'
          }`}>
            {revoke ? <Ban size={11} aria-hidden="true" /> : <Check size={11} aria-hidden="true" />}
            {revoke ? 'Revoke' : 'Grant'}
          </span>
        )
      },
    },
    {
      id: 'module', header: 'Module', accessorFn: (g) => MODULE_LABEL[g.module_key] || g.module_key, size: 200,
      cell: ({ getValue }) => <span className="text-[var(--text-primary)] font-medium">{getValue()}</span>,
    },
    {
      id: 'capability', header: 'Capability', accessorFn: (g) => g.capability || 'view', size: 110, meta: { filterVariant: 'select' },
      cell: ({ getValue }) => <span className="capitalize">{getValue()}</span>,
    },
    {
      id: 'expires', header: 'Expires', accessorFn: (g) => g.expires_at || '9999', size: 150,
      cell: ({ row }) => {
        const st = grantState(row.original, nowMs)
        return (
          <span className={`whitespace-nowrap ${STATE_CLS[st]}`}>
            {row.original.expires_at ? fmtDate(row.original.expires_at) : 'No expiry'}
            {(st === 'expired' || st === 'expiring') && <span className="block text-[11px] font-medium">{GRANT_STATE_LABEL[st]}</span>}
          </span>
        )
      },
    },
    {
      id: 'granted', header: 'Granted', accessorFn: (g) => g.created_at || '', size: 120,
      cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.created_at)}</span>,
    },
    {
      id: 'note', header: 'Note', accessorFn: (g) => g.note || '', size: 200,
      cell: ({ getValue }) => <span className="text-[var(--text-muted)] line-clamp-2">{getValue() || 'N/A'}</span>,
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 70, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => setConfirmRemove(row.original)}
          disabled={!isSuperAdmin}
          className={`${ICON_BTN} hover:text-red-500`}
          aria-label={`Remove ${row.original.effect || 'grant'} on ${MODULE_LABEL[row.original.module_key] || row.original.module_key}`}
        ><Trash2 size={15} /></button>
      ),
    },
  ], [nowMs, isSuperAdmin])

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
          <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs text-[var(--text-muted)] max-w-2xl">
            Give one specific person more or less access than their role. A <span className="text-green-500 font-medium">Grant</span> opens a
            module the role cannot reach; a <span className="text-red-500 font-medium">Revoke</span> closes a module the role normally can.
            Grants are additive overrides on top of the role baseline and only the View capability is enforced today.
          </p>
        </div>
        {!isSuperAdmin && (
          <span role="status" className="inline-flex items-center gap-1.5 text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/40 rounded-full px-2.5 py-1">
            <AlertTriangle size={12} aria-hidden="true" /> Read only: saving grants is Super Admin only.
          </span>
        )}
      </div>

      {/* Directory KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Users', value: Array.isArray(users) && !usersError ? dirSummary.users : 'N/A', icon: Users, tone: 'text-[var(--text-primary)]' },
          { label: 'Super Admins', value: Array.isArray(users) && !usersError ? dirSummary.superAdmins : 'N/A', icon: Crown, tone: 'text-amber-500' },
          { label: 'Roles in use', value: Array.isArray(users) && !usersError ? dirSummary.roles : 'N/A', icon: ShieldCheck, tone: 'text-indigo-500' },
          { label: 'Selected user overrides', value: selectedUser ? (gSummary ? gSummary.liveGrants + gSummary.liveRevokes : 'N/A') : 'None selected', icon: KeyRound, tone: 'text-sky-500' },
        ].map((k) => (
          <div key={k.label} className="card min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
              <k.icon size={16} className={k.tone} aria-hidden="true" />
            </div>
            <p className={`text-xl sm:text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-4">
        {/* ── Left: user directory ── */}
        <div className="card !p-0 overflow-hidden flex flex-col max-h-[76vh]">
          <div className="p-3 border-b border-[var(--input-border)] space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                <Users size={15} className="text-[var(--brand-bright)]" aria-hidden="true" /> Users
                {Array.isArray(users) && <span className="text-[var(--text-muted)] font-normal">({filteredUsers.length})</span>}
              </h3>
              <button
                onClick={loadUsers}
                disabled={refreshing}
                className={ICON_BTN}
                aria-label="Refresh users"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                aria-label="Search users by name or email"
                className="input pl-8 py-1.5 text-sm w-full min-h-[44px]"
                placeholder="Search name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label="Filter users by role"
              className="input py-1.5 text-sm w-full min-h-[44px]"
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
                <AlertTriangle size={22} className="mx-auto mb-2 text-red-500" aria-hidden="true" />
                <p role="alert" className="text-sm text-red-500 font-medium">Could not load users</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{usersError}</p>
                <button type="button" onClick={loadUsers} className="btn-secondary text-xs mt-3 inline-flex items-center gap-1.5 min-h-[44px]">
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
                        type="button"
                        onClick={() => selectUser(u.id)}
                        aria-pressed={on}
                        className={`w-full text-left px-3 py-2.5 min-h-[44px] flex items-center gap-2.5 border-b border-[var(--input-border)]/50 transition-colors ${
                          on ? 'bg-indigo-500/10' : 'hover:bg-[var(--input-bg)]/50'
                        }`}
                      >
                        <div className="w-8 h-8 rounded-full bg-[var(--input-bg)] flex items-center justify-center shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                          {initials(u)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--text-primary)] truncate flex items-center gap-1.5">
                            {displayName(u)}
                            {u.is_super_admin && <Crown size={12} className="text-amber-500 shrink-0" aria-label="Super Admin" />}
                          </p>
                          <p className="text-xs text-[var(--text-muted)] truncate">{u.email || u.username || 'No email'}</p>
                        </div>
                        <span className={`text-[11px] font-medium shrink-0 ${ROLE_TINT[u.role] || 'text-[var(--text-secondary)]'}`}>
                          {u.role || 'No role'}
                        </span>
                        <ChevronRight size={14} aria-hidden="true" className={`shrink-0 ${on ? 'text-indigo-500' : 'text-[var(--text-muted)]'}`} />
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
                    {initials(selectedUser)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                      {displayName(selectedUser)}
                      {selectedUser.is_super_admin && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/40 rounded-full px-2 py-0.5">
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
                {gSummary && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { label: 'Live grants', value: gSummary.liveGrants, tone: 'text-green-500', icon: Check },
                      { label: 'Live revokes', value: gSummary.liveRevokes, tone: 'text-red-500', icon: Ban },
                      { label: `Expiring in ${gSummary.soonDays}d`, value: gSummary.expiring, tone: 'text-amber-500', icon: Hourglass },
                      { label: 'Expired (no effect)', value: gSummary.expired, tone: 'text-[var(--text-muted)]', icon: Calendar },
                    ].map((k) => (
                      <div key={k.label} className="rounded-lg border border-[var(--input-border)] px-3 py-2">
                        <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1"><k.icon size={11} aria-hidden="true" /> {k.label}</p>
                        <p className={`text-lg font-bold tabular-nums ${k.tone}`}>{k.value}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-start gap-2 text-xs text-[var(--text-muted)] bg-[var(--input-bg)] rounded-lg px-3 py-2">
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
                        aria-pressed={form.effect === 'grant'} className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] text-sm font-medium transition-colors ${
                          form.effect === 'grant' ? 'bg-green-500/15 text-green-500' : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'
                        }`}
                      ><Check size={14} /> Grant</button>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, effect: 'revoke' }))}
                        aria-pressed={form.effect === 'revoke'} className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] text-sm font-medium transition-colors border-l border-[var(--input-border)] ${
                          form.effect === 'revoke' ? 'bg-red-500/15 text-red-500' : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'
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
                      {CAPABILITIES.filter((c) => c.key !== 'delete').map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}{c.enforced ? ' (enforced)' : ' (stored only)'}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">View is enforced; Delete is fixed to Admin/Super Admin and cannot be delegated.</p>
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
                  <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[var(--text-muted)]">
                    {form.moduleKey
                      ? <>Saving <span className={form.effect === 'revoke' ? 'text-red-500 font-medium' : 'text-green-500 font-medium'}>{form.effect}</span> for <span className="text-[var(--text-secondary)]">{MODULE_LABEL[form.moduleKey] || form.moduleKey}</span>.</>
                      : 'Pick a module to continue.'}
                  </p>
                  <button
                    type="submit"
                    disabled={saving || !form.moduleKey || !isSuperAdmin}
                    className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60"
                  >
                    {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : <><Check size={14} /> Save grant</>}
                  </button>
                </div>
              </form>

              {/* Current grants */}
              <section className="space-y-2" aria-labelledby="agm-current">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="agm-current" className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                    <KeyRound size={15} className="text-indigo-500" aria-hidden="true" /> Current grants
                    {Array.isArray(grants) && !grantsError && <span className="text-[var(--text-muted)] font-normal">({grants.length})</span>}
                  </h3>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => exportGrants('xlsx')} disabled={!Array.isArray(grants) || !grants.length || Boolean(grantsError)} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px]">
                      <FileSpreadsheet size={13} aria-hidden="true" /> Excel
                    </button>
                    <button type="button" onClick={() => exportGrants('pdf')} disabled={!Array.isArray(grants) || !grants.length || Boolean(grantsError)} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px]">
                      <FileText size={13} aria-hidden="true" /> PDF
                    </button>
                    <button type="button" onClick={() => loadGrants(selectedId)} className={ICON_BTN} aria-label="Refresh grants"><RefreshCw size={14} /></button>
                  </div>
                </div>
                <EnterpriseTable
                  columns={grantColumns}
                  data={Array.isArray(grants) && !grantsError ? grants : []}
                  getRowId={(g) => String(g.id)}
                  loading={grants === null}
                  error={grantsError || null}
                  onRetry={() => loadGrants(selectedId)}
                  enableExport={false}
                  enableColumnVisibility={false}
                  searchPlaceholder="Search this user's grants"
                  initialPageSize={25}
                  emptyMessage="No per-user grants yet. This user gets exactly their role baseline."
                />
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Remove confirm */}
      <Modal
        open={Boolean(confirmRemove)}
        onClose={() => { if (!removing) setConfirmRemove(null) }}
        size="sm"
        closeOnBackdrop={!removing}
        title="Remove this grant?"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmRemove(null)} className="btn-secondary text-sm min-h-[44px]" disabled={removing}>Cancel</button>
            <button type="button" onClick={doRemove} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={removing}>
              {removing ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Removing...</> : <><Trash2 size={14} aria-hidden="true" /> Remove</>}
            </button>
          </div>
        }
      >
        {confirmRemove && (
          <p className="text-sm text-[var(--text-secondary)]">
            The <span className={confirmRemove.effect === 'revoke' ? 'text-red-500 font-medium' : 'text-green-500 font-medium'}>{confirmRemove.effect}</span> on
            {' '}<span className="text-[var(--text-primary)] font-medium">{MODULE_LABEL[confirmRemove.module_key] || confirmRemove.module_key}</span> will
            be deleted and this user reverts to their role baseline for it.
          </p>
        )}
      </Modal>

      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  )
}
