import { useEffect, useState, useCallback } from 'react'
import {
  Users, Search, Filter, Lock, Unlock, CheckCircle, XCircle,
  RefreshCw, Edit2, Key, AlertTriangle, ChevronDown, ChevronUp,
  Mail, Shield, Building2, Calendar, MoreVertical, UserCheck, UserX,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { sanitizeSearchTerm } from '../../lib/searchFilter'
import { useConsoleAuth } from '../ConsoleAuthContext'

const ROLES = ['Admin', 'Manager', 'Director', 'Inspector', 'Tyre Man', 'Reporter', 'Driver']

export default function ConsoleUsers() {
  const { logAction, activeOrg } = useConsoleAuth()
  const [users, setUsers]     = useState([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [filterRole, setFilterRole]     = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterOrg, setFilterOrg]       = useState('')
  const [orgs, setOrgs]       = useState([])
  const [page, setPage]       = useState(0)
  const [expanded, setExpanded] = useState(null)
  const [actionMenu, setActionMenu] = useState(null)
  const [editModal, setEditModal] = useState(null)
  const [resetModal, setResetModal] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [resetSent, setResetSent] = useState(false)
  const PAGE_SIZE = 20

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('profiles')
      .select('id, full_name, email, role, site, approved, locked, created_at, organisation_id, is_super_admin', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (activeOrg) q = q.eq('organisation_id', activeOrg.id)
    else if (filterOrg) q = q.eq('organisation_id', filterOrg)

    if (filterRole)   q = q.eq('role', filterRole)
    if (filterStatus === 'pending')  q = q.eq('approved', false).eq('locked', false)
    if (filterStatus === 'locked')   q = q.eq('locked', true)
    if (filterStatus === 'approved') q = q.eq('approved', true).eq('locked', false)
    if (search) { const s = sanitizeSearchTerm(search); q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,site.ilike.%${s}%`) }

    const { data, count } = await q
    setUsers(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [activeOrg, filterOrg, filterRole, filterStatus, search, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('organisations').select('id, name').order('name')
      .then(({ data }) => setOrgs(data ?? []))
  }, [])

  async function toggleApprove(user) {
    const approved = !user.approved
    await supabase.from('profiles').update({ approved }).eq('id', user.id)
    await logAction(approved ? 'approve_user' : 'unapprove_user', user.id, 'user', { email: user.email })
    load()
  }

  async function toggleLock(user) {
    const locked = !user.locked
    await supabase.from('profiles').update({ locked }).eq('id', user.id)
    await logAction(locked ? 'lock_user' : 'unlock_user', user.id, 'user', { email: user.email })
    load()
  }

  async function handleEditSave() {
    setSaving(true); setError(null)
    const { error: err } = await supabase.from('profiles')
      .update({ role: editForm.role, site: editForm.site, full_name: editForm.full_name })
      .eq('id', editModal.id)
    if (err) { setError(err.message); setSaving(false); return }
    await logAction('update_user', editModal.id, 'user', { role: editForm.role, email: editModal.email })
    setSaving(false); setEditModal(null); load()
  }

  async function sendPasswordReset(user) {
    setResetSent(false)
    const { error: err } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (!err) {
      await logAction('reset_password', user.id, 'user', { email: user.email })
      setResetSent(true)
    }
  }

  const pendingCount  = users.filter(u => !u.approved && !u.locked).length
  const lockedCount   = users.filter(u => u.locked).length

  return (
    <div className="space-y-5 max-w-7xl" onClick={() => setActionMenu(null)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Users</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} users · {pendingCount} pending · {lockedCount} locked
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Quick filters */}
      {(pendingCount > 0 || lockedCount > 0) && (
        <div className="flex gap-2 flex-wrap">
          {pendingCount > 0 && (
            <button onClick={() => { setFilterStatus('pending'); setPage(0) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-900/30 border border-yellow-700/40 text-yellow-300 text-xs hover:bg-yellow-900/50 transition-colors">
              <AlertTriangle size={11} /> {pendingCount} Pending Approval
            </button>
          )}
          {lockedCount > 0 && (
            <button onClick={() => { setFilterStatus('locked'); setPage(0) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-xs hover:bg-red-900/50 transition-colors">
              <Lock size={11} /> {lockedCount} Locked Accounts
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Search name, email, site..."
            className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500" />
        </div>
        <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setPage(0) }}
          className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
          <option value="">All Roles</option>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0) }}
          className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
          <option value="">All Status</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="locked">Locked</option>
        </select>
        {!activeOrg && (
          <select value={filterOrg} onChange={e => { setFilterOrg(e.target.value); setPage(0) }}
            className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
            <option value="">All Orgs</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {(filterRole || filterStatus || filterOrg || search) && (
          <button onClick={() => { setFilterRole(''); setFilterStatus(''); setFilterOrg(''); setSearch(''); setPage(0) }}
            className="h-9 px-3 rounded-lg text-xs text-gray-500 hover:text-white bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors">
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-600">
          <Users size={32} className="mb-2 opacity-30" />
          <p className="text-sm">No users found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">User</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Site</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <>
                  <tr key={user.id}
                    className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors ${
                      !user.approved && !user.locked ? 'bg-yellow-950/10' :
                      user.locked ? 'bg-red-950/10' : ''
                    }`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 flex-shrink-0">
                          {(user.full_name ?? user.email ?? '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold text-white truncate">{user.full_name ?? '-'}</p>
                            {user.is_super_admin && <Shield size={10} className="text-orange-400 flex-shrink-0" />}
                          </div>
                          <p className="text-gray-500 truncate">{user.email ?? '-'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-4 py-3 text-gray-400">{user.site ?? '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {user.locked
                          ? <span className="flex items-center gap-1 text-red-400"><Lock size={10} /> Locked</span>
                          : user.approved
                            ? <span className="flex items-center gap-1 text-green-400"><CheckCircle size={10} /> Approved</span>
                            : <span className="flex items-center gap-1 text-yellow-400"><AlertTriangle size={10} /> Pending</span>
                        }
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                        {/* Quick actions */}
                        {!user.approved && !user.locked && (
                          <button onClick={() => toggleApprove(user)}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-green-900/40 text-green-400 hover:bg-green-900/60 text-[10px] font-semibold transition-colors border border-green-700/40">
                            <UserCheck size={10} /> Approve
                          </button>
                        )}
                        <button onClick={() => {
                          setActionMenu(actionMenu === user.id ? null : user.id)
                        }}
                          className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors">
                          <MoreVertical size={14} />
                        </button>
                        {actionMenu === user.id && (
                          <div className="absolute right-0 top-full mt-1 w-44 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-20 py-1">
                            <MenuItem icon={Edit2} label="Edit User" onClick={() => {
                              setEditForm({ full_name: user.full_name ?? '', role: user.role ?? '', site: user.site ?? '' })
                              setEditModal(user); setActionMenu(null)
                            }} />
                            <MenuItem icon={user.approved ? UserX : UserCheck}
                              label={user.approved ? 'Revoke Approval' : 'Approve User'}
                              onClick={() => { toggleApprove(user); setActionMenu(null) }} />
                            <MenuItem icon={user.locked ? Unlock : Lock}
                              label={user.locked ? 'Unlock Account' : 'Lock Account'}
                              onClick={() => { toggleLock(user); setActionMenu(null) }}
                              danger={!user.locked} />
                            <MenuItem icon={Key} label="Reset Password"
                              onClick={() => { setResetModal(user); setResetSent(false); setActionMenu(null) }} />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                </>
              ))}
            </tbody>
          </table>
          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 bg-gray-900/30">
              <p className="text-xs text-gray-500">
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-3 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 transition-colors border border-gray-700">
                  ← Prev
                </button>
                <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}
                  className="px-3 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 transition-colors border border-gray-700">
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit user modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-sm font-bold text-white">Edit User</h2>
              <button onClick={() => setEditModal(null)} className="text-gray-500 hover:text-gray-300"><XIcon /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {error && <ErrBox msg={error} />}
              <Field label="Full Name">
                <input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                  className="input-dark" />
              </Field>
              <Field label="Role">
                <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  className="input-dark">
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Site / Location">
                <input value={editForm.site} onChange={e => setEditForm(f => ({ ...f, site: e.target.value }))}
                  className="input-dark" placeholder="e.g. Depot A" />
              </Field>
            </div>
            <div className="flex gap-2 px-6 pb-5">
              <button onClick={() => setEditModal(null)}
                className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">Cancel</button>
              <button onClick={handleEditSave} disabled={saving}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password reset modal */}
      {resetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-900/40 flex items-center justify-center">
                <Key size={16} className="text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Reset Password</p>
                <p className="text-xs text-gray-500">{resetModal.email}</p>
              </div>
            </div>
            {resetSent ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-900/30 border border-green-700/40 mb-4">
                <CheckCircle size={14} className="text-green-400" />
                <p className="text-xs text-green-300">Password reset email sent successfully.</p>
              </div>
            ) : (
              <p className="text-xs text-gray-400 mb-5">
                Send a password reset link to <strong className="text-white">{resetModal.full_name ?? resetModal.email}</strong>.
                The user will receive an email with a secure link to set a new password.
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={() => setResetModal(null)}
                className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">
                {resetSent ? 'Close' : 'Cancel'}
              </button>
              {!resetSent && (
                <button onClick={() => sendPasswordReset(resetModal)}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold text-white bg-blue-700 hover:bg-blue-600 transition-colors">
                  Send Reset Email
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-700 transition-colors ${danger ? 'text-red-400' : 'text-gray-300'}`}>
      <Icon size={12} />
      {label}
    </button>
  )
}

function RoleBadge({ role }) {
  const c = {
    Admin: 'text-red-300 bg-red-900/30',
    Manager: 'text-orange-300 bg-orange-900/30',
    Director: 'text-blue-300 bg-blue-900/30',
    Inspector: 'text-purple-300 bg-purple-900/30',
    'Tyre Man': 'text-teal-300 bg-teal-900/30',
    Reporter: 'text-green-300 bg-green-900/30',
    Driver: 'text-yellow-300 bg-yellow-900/30',
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${c[role] ?? 'text-gray-400 bg-gray-800'}`}>{role ?? '-'}</span>
  )
}

function XIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
function Field({ label, children }) {
  return <div><label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</label>{children}</div>
}
function ErrBox({ msg }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800/50">
      <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
      <p className="text-xs text-red-300">{msg}</p>
    </div>
  )
}
