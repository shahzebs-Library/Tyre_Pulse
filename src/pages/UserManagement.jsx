import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Users, Search, X, Save, ShieldAlert, AlertTriangle } from 'lucide-react'

const ROLES = ['Admin', 'Manager', 'Director', 'Reporter']

const ROLE_BADGE = {
  Admin:    'bg-red-900/50 text-red-300 border border-red-700/40',
  Manager:  'bg-orange-900/50 text-orange-300 border border-orange-700/40',
  Director: 'bg-blue-900/50 text-blue-300 border border-blue-700/40',
  Reporter: 'bg-gray-800 text-gray-400 border border-gray-700/40',
}

const ROLE_DESCRIPTIONS = {
  Admin:    'Full access — can delete records, manage all settings, promote users',
  Manager:  'Can edit records, close corrective actions, manage stock and budgets',
  Director: 'Read-only access to all analytics and reports',
  Reporter: 'Can upload data and log actions, cannot delete or change settings',
}

// ── Shared modal shell ─────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function UserManagement() {
  const { profile: currentProfile } = useAuth()

  // ── state ────────────────────────────────────────────────────────────────────
  const [users, setUsers]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState(null)
  const [rlsBlocked, setRlsBlocked]     = useState(false)

  // filters
  const [search, setSearch]             = useState('')
  const [roleFilter, setRoleFilter]     = useState('')

  // modal
  const [changeTarget, setChangeTarget] = useState(null)   // the user being edited
  const [newRole, setNewRole]           = useState('')
  const [saving, setSaving]             = useState(false)
  const [saveMsg, setSaveMsg]           = useState('')      // success / error msg
  const [saveMsgType, setSaveMsgType]   = useState('ok')   // 'ok' | 'err'

  // ── access guard ─────────────────────────────────────────────────────────────
  const isAdmin = currentProfile?.role === 'Admin'

  // ── load users ───────────────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setRlsBlocked(false)

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      if (
        error.message?.toLowerCase().includes('permission') ||
        error.message?.toLowerCase().includes('policy') ||
        error.code === '42501' ||
        error.code === 'PGRST301'
      ) {
        setRlsBlocked(true)
      } else {
        setLoadError(error.message)
      }
      setUsers([])
    } else if (!data || data.length === 0) {
      // Could be RLS silently returning empty
      setRlsBlocked(true)
      setUsers([])
    } else {
      setUsers(data)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    if (isAdmin) loadUsers()
    else setLoading(false)
  }, [isAdmin, loadUsers])

  // ── derived stats ─────────────────────────────────────────────────────────────
  const stats = {
    total:    users.length,
    admin:    users.filter(u => u.role === 'Admin').length,
    manager:  users.filter(u => u.role === 'Manager').length,
    other:    users.filter(u => u.role === 'Director' || u.role === 'Reporter').length,
  }

  // ── filtered list ─────────────────────────────────────────────────────────────
  const filtered = users.filter(u => {
    const term = search.toLowerCase()
    const matchSearch = !search ||
      (u.full_name ?? '').toLowerCase().includes(term) ||
      (u.username ?? '').toLowerCase().includes(term)
    const matchRole = !roleFilter || u.role === roleFilter
    return matchSearch && matchRole
  })

  // ── change role modal ─────────────────────────────────────────────────────────
  function openChangeRole(user) {
    setChangeTarget(user)
    setNewRole(user.role ?? 'Reporter')
    setSaveMsg('')
  }

  function closeModal() {
    setChangeTarget(null)
    setNewRole('')
    setSaveMsg('')
    setSaving(false)
  }

  async function handleSaveRole() {
    if (!changeTarget) return
    if (changeTarget.id === currentProfile?.id) return

    setSaving(true)
    setSaveMsg('')

    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', changeTarget.id)

    if (error) {
      setSaveMsg(error.message)
      setSaveMsgType('err')
      setSaving(false)
      return
    }

    setSaveMsgType('ok')
    setSaveMsg(`Role updated to ${newRole}`)
    setSaving(false)

    // refresh list and close after brief delay
    await loadUsers()
    setTimeout(() => { closeModal() }, 1200)
  }

  const isDowngradingAdmin =
    changeTarget?.role === 'Admin' && newRole !== 'Admin'

  const isSelf = changeTarget?.id === currentProfile?.id

  // ── access denied ─────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 space-y-4">
        <ShieldAlert size={48} className="text-red-400" />
        <h1 className="text-xl font-bold text-white">Access Denied</h1>
        <p className="text-gray-400 text-sm text-center max-w-sm">
          This page is restricted to Admin users only. Contact your administrator if you need access.
        </p>
      </div>
    )
  }

  // ── main render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users size={22} className="text-green-400" />
            User Management
          </h1>
          <p className="text-gray-400 text-sm mt-1">Manage user roles and access levels</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Users',           value: stats.total,   color: 'text-white' },
          { label: 'Admins',                value: stats.admin,   color: 'text-red-300' },
          { label: 'Managers',              value: stats.manager, color: 'text-orange-300' },
          { label: 'Directors / Reporters', value: stats.other,   color: 'text-blue-300' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      {/* RLS blocked notice */}
      {rlsBlocked && (
        <div className="card border border-yellow-700/40 bg-yellow-900/10">
          <div className="flex gap-3">
            <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-yellow-300 font-medium mb-1">Unable to load users.</p>
              <p className="text-gray-400">
                Ask your Supabase admin to add a policy allowing Admins to read all profiles.
                See <span className="font-mono text-yellow-400">HANDOFF.md</span> for instructions.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Generic error */}
      {loadError && (
        <div className="card border border-red-700/40 bg-red-900/10">
          <p className="text-red-300 text-sm">{loadError}</p>
        </div>
      )}

      {/* Search + filter bar */}
      <div className="card">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Search by name or username…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="input w-auto min-w-36"
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
          >
            <option value="">All Roles</option>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {/* Users table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Full Name', 'Username', 'Email', 'Role', 'Region', 'Joined', ''].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-500">Loading…</td>
                </tr>
              ) : rlsBlocked ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-600">
                    User list unavailable — see warning above.
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-500">No users found</td>
                </tr>
              ) : filtered.map(u => {
                const isSelfRow = u.id === currentProfile?.id
                const displayName = u.full_name || u.username || '—'
                return (
                  <tr key={u.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="table-cell font-medium text-white">
                      <span className="flex items-center gap-2">
                        {displayName}
                        {isSelfRow && (
                          <span className="text-[10px] font-semibold bg-green-900/40 text-green-400 border border-green-700/40 rounded px-1.5 py-0.5">
                            You
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="table-cell text-gray-400">{u.username ?? '—'}</td>
                    <td className="table-cell text-gray-400">{u.email ?? '—'}</td>
                    <td className="table-cell">
                      <span className={`badge ${ROLE_BADGE[u.role] ?? 'bg-gray-800 text-gray-400'}`}>
                        {u.role ?? '—'}
                      </span>
                    </td>
                    <td className="table-cell text-gray-400">{u.region ?? '—'}</td>
                    <td className="table-cell text-gray-400 text-xs">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="table-cell">
                      <button
                        disabled={isSelfRow}
                        onClick={() => openChangeRole(u)}
                        className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                          isSelfRow
                            ? 'opacity-30 cursor-not-allowed text-gray-500 border border-gray-700'
                            : 'text-green-400 border border-green-700/50 hover:bg-green-900/30'
                        }`}
                        title={isSelfRow ? 'You cannot change your own role' : 'Change role'}
                      >
                        Change Role
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Change Role modal */}
      {changeTarget && (
        <Modal title="Change User Role" onClose={closeModal}>
          <div className="space-y-4">

            {/* User info */}
            <div className="flex items-center gap-3 bg-gray-800/50 rounded-lg p-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                style={{ backgroundColor: '#15803d' }}
              >
                {(changeTarget.full_name ?? changeTarget.username ?? 'U')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-white font-semibold truncate">
                  {changeTarget.full_name || changeTarget.username || 'Unknown'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400">Current role:</span>
                  <span className={`badge text-[11px] ${ROLE_BADGE[changeTarget.role] ?? 'bg-gray-800 text-gray-400'}`}>
                    {changeTarget.role ?? '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Self-change guard */}
            {isSelf && (
              <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2 text-sm text-red-300">
                You cannot change your own role.
              </div>
            )}

            {/* Role selector + actions */}
            {!isSelf && (
              <>
                <div>
                  <label className="label">New Role</label>
                  <select
                    className="input"
                    value={newRole}
                    onChange={e => setNewRole(e.target.value)}
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                {/* Role description */}
                {newRole && (
                  <p className="text-xs text-gray-400 bg-gray-800/40 rounded-lg px-3 py-2 leading-relaxed">
                    <span className="text-gray-300 font-medium">{newRole}:</span>{' '}
                    {ROLE_DESCRIPTIONS[newRole]}
                  </p>
                )}

                {/* Demotion warning */}
                {isDowngradingAdmin && (
                  <div className="flex gap-2 bg-orange-900/20 border border-orange-700/40 rounded-lg px-3 py-2">
                    <AlertTriangle size={16} className="text-orange-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-orange-300">
                      Warning: You are about to remove Admin access from this user.
                    </p>
                  </div>
                )}

                {/* Save message */}
                {saveMsg && (
                  <p className={`text-sm ${saveMsgType === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                    {saveMsg}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={handleSaveRole}
                    disabled={saving || newRole === changeTarget.role}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50"
                  >
                    <Save size={15} />
                    {saving ? 'Saving…' : 'Save Role'}
                  </button>
                  <button onClick={closeModal} className="btn-secondary">Cancel</button>
                </div>
              </>
            )}

            {isSelf && (
              <button onClick={closeModal} className="btn-secondary w-full">Close</button>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
