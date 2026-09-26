/**
 * UserDirectory - the searchable, role-filterable user list shared by the
 * Access Control tabs that work on one person at a time (Effective Access,
 * Country Scope). One component so the list reads, filters and fails the same
 * way on every tab.
 *
 * The caller owns loading: pass `users` (null while loading), `error`, and
 * `onRetry`. A failed read renders an ErrorState with Retry, never an empty
 * list. `describe(user)` returns the second line under each name.
 */
import { useMemo, useState } from 'react'
import { Users, RefreshCw, Crown, ChevronRight } from 'lucide-react'
import {
  Badge, Btn, EmptyState, ErrorState, LoadingState, Panel, PanelHeader, SearchInput, Select,
} from '../../components/ui'

export function displayName(u) {
  return u?.full_name || u?.username || u?.email || 'Unnamed user'
}

export default function UserDirectory({ users, error, onRetry, refreshing, selectedId, onSelect, describe }) {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')

  const roleOptions = useMemo(() => {
    const set = new Set()
    for (const u of users || []) if (u.role) set.add(u.role)
    return Array.from(set).sort()
  }, [users])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (users || []).filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (!q) return true
      return [displayName(u), u.email, u.username].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [users, search, roleFilter])

  return (
    <Panel flush className="overflow-hidden flex flex-col max-h-[76vh]">
      <div className="p-3 border-b border-gray-800 space-y-2">
        <PanelHeader icon={Users} title="Users"
          subtitle={Array.isArray(users) && !error ? `${filtered.length} of ${users.length} shown` : undefined}
          actions={<Btn size="xs" variant="quiet" icon={RefreshCw} busy={refreshing} title="Refresh users" ariaLabel="Refresh users" onClick={onRetry} />} />
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or email" />
        <Select value={roleFilter} onChange={setRoleFilter} ariaLabel="Filter users by role"
          options={[{ value: 'all', label: 'All roles' }, ...roleOptions.map((r) => ({ value: r, label: r }))]} />
      </div>

      <div className="overflow-y-auto flex-1">
        {users === null ? (
          <div className="p-3"><LoadingState label="Loading users" rows={5} /></div>
        ) : error ? (
          <div className="p-3"><ErrorState message={error} onRetry={onRetry} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users}
            title={users.length === 0 ? 'No users found' : 'No users match'}
            reason={users.length === 0 ? 'The user directory returned no accounts.' : 'Nothing matches this search and role.'} />
        ) : (
          <ul aria-label="Users">
            {filtered.map((u) => {
              const on = u.id === selectedId
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(u.id)}
                    aria-pressed={on}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-gray-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500 ${
                      on ? 'bg-orange-950/30' : 'hover:bg-gray-900/60'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center shrink-0 text-xs font-semibold text-gray-300" aria-hidden="true">
                      {displayName(u).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-100 truncate flex items-center gap-1.5">
                        {displayName(u)}
                        {u.is_super_admin && <Crown size={12} className="text-amber-400 shrink-0" aria-label="Super admin" />}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{describe ? describe(u) : (u.email || u.username || 'No email')}</p>
                    </div>
                    <Badge tone={u.role === 'Admin' ? 'accent' : 'default'}>{u.role || 'No role'}</Badge>
                    <ChevronRight size={14} className={`shrink-0 ${on ? 'text-orange-400' : 'text-gray-500'}`} aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Panel>
  )
}
