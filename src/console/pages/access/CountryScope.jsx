/**
 * CountryScope.jsx - the console editor for a user's country scope
 * (profiles.country, a text[]) inside the Access Control host.
 *
 * The country array is the data-visibility boundary: RESTRICTIVE RLS
 * (app_can_see_country) limits a member to rows tagged with one of their
 * countries. An EMPTY array means "no country restriction" (the user sees all
 * countries), and Admin / super-admin roles see every country regardless of
 * this field. This screen surfaces that honestly and lets a super admin add or
 * remove country chips, then persist via adminAccess.setUserCountry (a
 * security-definer, super-admin-only RPC).
 *
 * Writes are optimistic-free: we save, then re-read the directory so the list
 * reflects the authoritative stored value. A toast reports success or a clean,
 * mapped error (no raw Postgres text ever reaches the user).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Search, RefreshCw, AlertTriangle, Crown, ChevronRight, Globe,
  Info, X, Plus, Check, Save, Loader2, MapPin, ShieldCheck,
} from 'lucide-react'
import { listProfiles } from '../../../lib/api/users'
import { setUserCountry } from '../../../lib/api/adminAccess'
import { toUserMessage } from '../../../lib/safeError'

// GCC baseline scope list; the real set is unioned with whatever countries the
// directory already uses so no stored value is ever hidden from the editor.
const BASE_COUNTRIES = ['KSA', 'UAE', 'Egypt', 'Oman', 'Qatar', 'Bahrain', 'Kuwait']

const ROLE_TINT = {
  Admin: 'text-purple-300', Manager: 'text-blue-300', Director: 'text-indigo-300',
  Reporter: 'text-cyan-300', Inspector: 'text-green-300', 'Tyre Man': 'text-amber-300',
  Driver: 'text-[var(--text-secondary)]',
}

const SEES_ALL_ROLES = new Set(['Admin', 'Director'])

function displayName(u) {
  return u?.full_name || u?.username || u?.email || 'Unnamed user'
}

function normaliseCountry(country) {
  if (!country) return []
  const arr = Array.isArray(country) ? country : [country]
  return Array.from(new Set(arr.map((c) => String(c).trim()).filter(Boolean)))
}

export default function CountryScope() {
  const [users, setUsers] = useState(null)
  const [usersError, setUsersError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)

  const [draft, setDraft] = useState([]) // string[]
  const [baseline, setBaseline] = useState([]) // stored value, for dirty check
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)

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

  // Hydrate the editor whenever the selected user (or the fresh directory) changes.
  useEffect(() => {
    if (!selectedUser) { setDraft([]); setBaseline([]); return }
    const stored = normaliseCountry(selectedUser.country)
    setDraft(stored)
    setBaseline(stored)
    setCustom('')
  }, [selectedUser])

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

  // Country palette = base list + every value already used in the directory.
  const countryPalette = useMemo(() => {
    const set = new Set(BASE_COUNTRIES)
    for (const u of users || []) for (const c of normaliseCountry(u.country)) set.add(c)
    return Array.from(set).sort()
  }, [users])

  const dirty = useMemo(() => {
    if (draft.length !== baseline.length) return true
    const b = new Set(baseline)
    return draft.some((c) => !b.has(c))
  }, [draft, baseline])

  function addCountry(c) {
    const v = String(c).trim()
    if (!v) return
    setDraft((prev) => (prev.includes(v) ? prev : [...prev, v]))
  }
  function removeCountry(c) {
    setDraft((prev) => prev.filter((x) => x !== c))
  }
  function addCustom() {
    if (!custom.trim()) return
    addCountry(custom)
    setCustom('')
  }

  const save = useCallback(async () => {
    if (!selectedUser) return
    setSaving(true)
    try {
      await setUserCountry(selectedUser.id, draft)
      pushToast('success', draft.length
        ? `Saved: ${displayName(selectedUser)} now scoped to ${draft.join(', ')}.`
        : `Saved: ${displayName(selectedUser)} now sees all countries.`)
      setBaseline(draft)
      // Re-read so the directory reflects the authoritative stored value.
      await loadUsers()
    } catch (err) {
      pushToast('error', toUserMessage(err, 'Could not update the country scope.'))
    } finally {
      setSaving(false)
    }
  }, [selectedUser, draft, pushToast, loadUsers])

  const seesAll = selectedUser && (selectedUser.is_super_admin || SEES_ALL_ROLES.has(selectedUser.role))

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
        <p className="text-xs text-[var(--text-muted)] max-w-3xl">
          The country scope limits which records a user can see. An empty scope means no restriction
          (the user sees all countries). Admin, Director and super admin roles see every country
          regardless of this field, so a scope on them has no effect. The database RLS
          (app_can_see_country) is the real boundary; this editor sets the stored value it reads.
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
                  const scope = normaliseCountry(u.country)
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
                          <p className="text-xs text-[var(--text-muted)] truncate">
                            {scope.length ? scope.join(', ') : 'All countries'}
                          </p>
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

        {/* Right: country editor */}
        <div className="min-w-0">
          {!selectedUser ? (
            <div className="card flex flex-col items-center justify-center text-center py-16">
              <Globe size={30} className="text-[var(--text-muted)] opacity-70 mb-3" />
              <p className="text-[var(--text-primary)] font-medium">Select a user</p>
              <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">
                Choose someone from the directory to review and edit which countries they can see.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="card">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-[var(--input-bg)] flex items-center justify-center shrink-0 text-sm font-semibold text-[var(--text-secondary)]">
                    {displayName(selectedUser).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      {displayName(selectedUser)}
                      {selectedUser.is_super_admin && <Crown size={14} className="text-amber-400" />}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{selectedUser.email || selectedUser.username}</p>
                  </div>
                  <span className="badge inline-flex items-center gap-1.5 bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]">
                    <ShieldCheck size={12} /> {selectedUser.role || 'No role'}
                  </span>
                </div>

                {seesAll && (
                  <div className="flex items-start gap-2 mt-3 px-3 py-2.5 rounded-lg bg-amber-900/15 border border-amber-800/40">
                    <Crown size={14} className="text-amber-300 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-200">
                      This role sees every country regardless of the scope below. Any value here is
                      stored but does not restrict what they can see.
                    </p>
                  </div>
                )}
              </div>

              {/* Editor */}
              <div className="card space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                      <MapPin size={14} className="text-[var(--brand-bright)]" /> Assigned countries
                    </h4>
                    <span className="text-xs text-[var(--text-muted)]">
                      {draft.length ? `${draft.length} selected` : 'Empty = sees all countries'}
                    </span>
                  </div>
                  {draft.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--input-border)] px-3 py-4 text-center">
                      <p className="text-sm text-[var(--text-muted)]">
                        No countries assigned. This user is <span className="text-[var(--text-primary)] font-medium">not restricted</span> and can see all countries.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {draft.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full bg-[var(--brand-subtle,rgba(34,197,94,0.12))] text-[var(--brand-bright)] border border-[var(--border-bright)] text-sm">
                          <Globe size={12} /> {c}
                          <button
                            onClick={() => removeCountry(c)}
                            className="ml-0.5 p-0.5 rounded-full hover:bg-black/20 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            aria-label={`Remove ${c}`}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">Add from list</p>
                  <div className="flex flex-wrap gap-1.5">
                    {countryPalette.map((c) => {
                      const on = draft.includes(c)
                      return (
                        <button
                          key={c}
                          onClick={() => (on ? removeCountry(c) : addCountry(c))}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm border transition-colors ${
                            on
                              ? 'bg-[var(--brand-subtle,rgba(34,197,94,0.12))] text-[var(--brand-bright)] border-[var(--border-bright)]'
                              : 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {on ? <Check size={12} /> : <Plus size={12} />} {c}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">Add another country</p>
                  <div className="flex gap-2">
                    <input
                      className="input py-1.5 text-sm flex-1"
                      placeholder="Type a country code or name..."
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
                    />
                    <button onClick={addCustom} disabled={!custom.trim()} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-40">
                      <Plus size={14} /> Add
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1 border-t border-[var(--input-border)]">
                  <div className="text-xs text-[var(--text-muted)]">
                    {dirty ? 'You have unsaved changes.' : 'No changes since last save.'}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setDraft(baseline); setCustom('') }}
                      disabled={!dirty || saving}
                      className="btn-ghost text-sm disabled:opacity-40"
                    >
                      Reset
                    </button>
                    <button
                      onClick={save}
                      disabled={!dirty || saving}
                      className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-40"
                    >
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {saving ? 'Saving...' : 'Save scope'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

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
