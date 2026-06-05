import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Users, Search, X, Save, ShieldAlert, AlertTriangle, CheckCircle } from 'lucide-react'

const ROLES = ['Admin', 'Manager', 'Director', 'Reporter']

const COUNTRIES = ['KSA', 'UAE', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Jordan', 'Iraq', 'Egypt']

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

  const [users, setUsers]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState(null)
  const [rlsBlocked, setRlsBlocked]     = useState(false)

  const [search, setSearch]             = useState('')
  const [roleFilter, setRoleFilter]     = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [changeTarget, setChangeTarget] = useState(null)
  const [newRole, setNewRole]           = useState('')
  const [newCountries, setNewCountries] = useState([])
  const [saving, setSaving]             = useState(false)
  const [saveMsg, setSaveMsg]           = useState('')
  const [saveMsgType, setSaveMsgType]   = useState('ok')

  const isAdmin = currentProfile?.role === 'Admin'

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

  const stats = {
    total:   users.length,
    admin:   users.filter(u => u.role === 'Admin').length,
    manager: users.filter(u => u.role === 'Manager').length,
    pending: users.filter(u => u.approved === false).length,
  }

  const filtered = users.filter(u => {
    const term = search.toLowerCase()
    const matchSearch = !search ||
      (u.full_name ?? '').toLowerCase().includes(term) ||
      (u.username ?? '').toLowerCase().includes(term) ||
      (u.employee_id ?? '').toLowerCase().includes(term)
    const matchRole   = !roleFilter   || u.role === roleFilter
    const matchStatus = !statusFilter ||
      (statusFilter === 'pending' && u.approved === false) ||
      (statusFilter === 'active'  && u.approved !== false)
    return matchSearch && matchRole && matchStatus
  })

  function openManage(user) {
    setChangeTarget(user)
    setNewRole(user.role ?? 'Reporter')
    // country stored as text[] in DB; handle legacy string or null
    const c = user.country
    setNewCountries(Array.isArray(c) ? c : (c ? [c] : []))
    setSaveMsg('')
  }

  function closeModal() {
    setChangeTarget(null)
    setNewRole('')
    setNewCountries([])
    setSaveMsg('')
    setSaving(false)
  }

  function toggleCountry(c) {
    setNewCountries(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    )
  }

  async function handleSave() {
    if (!changeTarget) return
    if (changeTarget.id === currentProfile?.id) return

    setSaving(true)
    setSaveMsg('')

    const updates = {
      role:    newRole,
      country: newCountries.length > 0 ? newCountries : null,
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', changeTarget.id)

    if (error) {
      setSaveMsg(error.message)
      setSaveMsgType('err')
      setSaving(false)
      return
    }

    setSaveMsgType('ok')
    setSaveMsg('Changes saved')
    setSaving(false)
    await loadUsers()
    setTimeout(() => closeModal(), 1200)
  }

  async function handleApprove() {
    if (!changeTarget) return
    setSaving(true)
    setSaveMsg('')

    const updates = {
      approved: true,
      role:     newRole,
      country:  newCountries.length > 0 ? newCountries : null,
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', changeTarget.id)

    if (error) {
      setSaveMsg(error.message)
      setSaveMsgType('err')
      setSaving(false)
      return
    }

    setSaveMsgType('ok')
    setSaveMsg('Account approved and activated')
    setSaving(false)
    await loadUsers()
    setTimeout(() => closeModal(), 1400)
  }

  const isDowngradingAdmin = changeTarget?.role === 'Admin' && newRole !== 'Admin'
  const isSelf = changeTarget?.id === currentProfile?.id
  const isPending = changeTarget?.approved === false

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 space-y-4">
        <ShieldAlert size={48} className="text-red-400" />
        <h1 className="text-xl font-bold text-white">Access Denied</h1>
        <p className="text-gray-400 text-sm text-center max-w-sm">
          This page is restricted to Admin users only.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users size={22} className="text-green-400" />
            User Management
          </h1>
          <p className="text-gray-400 text-sm mt-1">Manage roles, country access, and account approvals</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Users',  value: stats.total,   color: 'text-white' },
          { label: 'Admins',       value: stats.admin,   color: 'text-red-300' },
          { label: 'Managers',     value: stats.manager, color: 'text-orange-300' },
          { label: 'Pending',      value: stats.pending, color: stats.pending > 0 ? 'text-yellow-300' : 'text-gray-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      {/* RLS notice */}
      {rlsBlocked && (
        <div className="card border border-yellow-700/40 bg-yellow-900/10">
          <div className="flex gap-3">
            <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-yellow-300 font-medium mb-1">Unable to load users.</p>
              <p className="text-gray-400">
                Add a Supabase policy allowing Admins to read all profiles. See HANDOFF.md for instructions.
              </p>
            </div>
          </div>
        </div>
      )}

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
              placeholder="Search by name, username or employee ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="input w-auto min-w-36" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
            <option value="">All Roles</option>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="input w-auto min-w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="pending">Pending Approval</option>
          </select>
        </div>
      </div>

      {/* Users table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Name', 'Username', 'Emp ID', 'Role', 'Country', 'Status', 'Joined', ''].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-500">Loading…</td></tr>
              ) : rlsBlocked ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-600">User list unavailable — see warning above.</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-500">No users found</td></tr>
              ) : filtered.map(u => {
                const isSelfRow = u.id === currentProfile?.id
                const isPendingRow = u.approved === false
                const displayName = u.full_name || u.username || '—'
                return (
                  <tr key={u.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="table-cell font-medium text-white">
                      <span className="flex items-center gap-2 flex-wrap">
                        {displayName}
                        {isSelfRow && (
                          <span className="text-[10px] font-semibold bg-green-900/40 text-green-400 border border-green-700/40 rounded px-1.5 py-0.5">You</span>
                        )}
                      </span>
                    </td>
                    <td className="table-cell text-gray-400">{u.username ?? '—'}</td>
                    <td className="table-cell text-gray-400 text-xs">{u.employee_id ?? '—'}</td>
                    <td className="table-cell">
                      <span className={`badge ${ROLE_BADGE[u.role] ?? 'bg-gray-800 text-gray-400'}`}>
                        {u.role ?? '—'}
                      </span>
                    </td>
                    <td className="table-cell text-gray-400 text-xs">
                      {Array.isArray(u.country) && u.country.length > 0
                        ? u.country.join(', ')
                        : u.country || 'All'}
                    </td>
                    <td className="table-cell">
                      {isPendingRow ? (
                        <span className="badge bg-yellow-900/40 text-yellow-300 border border-yellow-700/40">Pending</span>
                      ) : (
                        <span className="badge bg-green-900/30 text-green-400 border border-green-700/40">Active</span>
                      )}
                    </td>
                    <td className="table-cell text-gray-400 text-xs">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="table-cell">
                      <button
                        disabled={isSelfRow}
                        onClick={() => openManage(u)}
                        className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                          isSelfRow
                            ? 'opacity-30 cursor-not-allowed text-gray-500 border border-gray-700'
                            : isPendingRow
                              ? 'text-yellow-400 border border-yellow-700/50 hover:bg-yellow-900/30'
                              : 'text-green-400 border border-green-700/50 hover:bg-green-900/30'
                        }`}
                      >
                        {isPendingRow ? 'Approve' : 'Manage'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manage User modal */}
      {changeTarget && (
        <Modal title={isPending ? 'Approve Account' : 'Manage User'} onClose={closeModal}>
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
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {changeTarget.employee_id && (
                    <span className="text-xs text-gray-500">ID: {changeTarget.employee_id}</span>
                  )}
                  <span className={`badge text-[11px] ${ROLE_BADGE[changeTarget.role] ?? 'bg-gray-800 text-gray-400'}`}>
                    {changeTarget.role ?? '—'}
                  </span>
                  {isPending && (
                    <span className="badge text-[11px] bg-yellow-900/40 text-yellow-300 border border-yellow-700/40">Pending</span>
                  )}
                </div>
              </div>
            </div>

            {isSelf ? (
              <>
                <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2 text-sm text-red-300">
                  You cannot change your own role or country.
                </div>
                <button onClick={closeModal} className="btn-secondary w-full">Close</button>
              </>
            ) : (
              <>
                {isPending && (
                  <div className="flex gap-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-3 py-2">
                    <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-300">
                      This account is pending. Set the role and country below, then click Approve to activate it.
                    </p>
                  </div>
                )}

                <div>
                  <label className="label">Role</label>
                  <select className="input" value={newRole} onChange={e => setNewRole(e.target.value)}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {newRole && (
                    <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                      {ROLE_DESCRIPTIONS[newRole]}
                    </p>
                  )}
                </div>

                <div>
                  <label className="label">Country Access</label>
                  <div className="grid grid-cols-3 gap-1.5 mt-1">
                    {COUNTRIES.map(c => (
                      <label key={c}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-xs font-medium transition-colors ${
                          newCountries.includes(c)
                            ? 'bg-green-900/40 text-green-300 border border-green-700/50'
                            : 'bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:border-gray-600'
                        }`}>
                        <input
                          type="checkbox"
                          checked={newCountries.includes(c)}
                          onChange={() => toggleCountry(c)}
                          className="accent-green-500 w-3 h-3"
                        />
                        {c}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {newCountries.length === 0
                      ? 'No restriction — user can see all countries.'
                      : `Restricted to: ${newCountries.join(', ')}`}
                  </p>
                </div>

                {isDowngradingAdmin && (
                  <div className="flex gap-2 bg-orange-900/20 border border-orange-700/40 rounded-lg px-3 py-2">
                    <AlertTriangle size={16} className="text-orange-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-orange-300">
                      Warning: You are removing Admin access from this user.
                    </p>
                  </div>
                )}

                {saveMsg && (
                  <p className={`text-sm ${saveMsgType === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                    {saveMsg}
                  </p>
                )}

                <div className="flex gap-3 pt-1">
                  {isPending ? (
                    <button
                      onClick={handleApprove}
                      disabled={saving}
                      className="btn-primary flex items-center gap-2 disabled:opacity-50 flex-1"
                      style={{ background: 'linear-gradient(135deg, #15803d, #166534)' }}
                    >
                      <CheckCircle size={15} />
                      {saving ? 'Approving…' : 'Approve Account'}
                    </button>
                  ) : (
                    <button
                      onClick={handleSave}
                      disabled={saving || (
                        newRole === changeTarget.role &&
                        JSON.stringify([...(newCountries)].sort()) ===
                        JSON.stringify([...(Array.isArray(changeTarget.country) ? changeTarget.country : (changeTarget.country ? [changeTarget.country] : []))].sort())
                      )}
                      className="btn-primary flex items-center gap-2 disabled:opacity-50"
                    >
                      <Save size={15} />
                      {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                  )}
                  <button onClick={closeModal} className="btn-secondary">Cancel</button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
