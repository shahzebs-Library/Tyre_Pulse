import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Search, Lock, Unlock, CheckCircle,
  RefreshCw, Edit2, Key, AlertTriangle,
  Shield, MoreVertical, UserCheck, UserX,
  Globe, CheckSquare, Square, UserCog, ShieldCheck, X as XClose,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { sanitizeSearchTerm } from '../../lib/searchFilter'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { ACCESS_ROLES, ALL_MODULES } from '../../lib/moduleCatalog'
import { listCustomRoles } from '../../lib/api/customRoles'
import { setUserCountry, bulkSetRole, bulkSetGrant } from '../../lib/api/adminAccess'

// Country scope vocabulary (GCC + Egypt). Any country already stored on a user
// that is not in this list is still shown and preserved as an existing chip.
const COUNTRIES = ['KSA', 'UAE', 'Egypt', 'Oman', 'Qatar', 'Bahrain', 'Kuwait']

// Capability dimensions honoured by admin_bulk_set_grant. Only "view" is
// enforced today; the rest are stored (labelled below).
const CAPABILITIES = [
  { key: 'view',    label: 'View (enforced)' },
  { key: 'create',  label: 'Create (stored)' },
  { key: 'edit',    label: 'Edit (stored)' },
  { key: 'delete',  label: 'Delete (stored)' },
  { key: 'export',  label: 'Export (stored)' },
  { key: 'approve', label: 'Approve (stored)' },
]

export default function ConsoleUsers() {
  const { logAction, activeOrg } = useConsoleAuth()
  const navigate = useNavigate()
  const [users, setUsers]     = useState([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [filterRole, setFilterRole]     = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterOrg, setFilterOrg]       = useState('')
  const [orgs, setOrgs]       = useState([])
  const [roles, setRoles]     = useState(ACCESS_ROLES)
  const [page, setPage]       = useState(0)
  const [actionMenu, setActionMenu] = useState(null)
  const [editModal, setEditModal] = useState(null)
  const [resetModal, setResetModal] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [resetSent, setResetSent] = useState(false)

  // Bulk selection + actions
  const [selected, setSelected]   = useState(() => new Set())
  const [bulkModal, setBulkModal] = useState(null)   // 'role' | 'grant' | null
  const [bulkRole, setBulkRole]   = useState('')
  const [bulkModule, setBulkModule] = useState(ALL_MODULES[0]?.key ?? '')
  const [bulkCapability, setBulkCapability] = useState('view')
  const [bulkEffect, setBulkEffect] = useState('grant')
  const [bulkExpiry, setBulkExpiry] = useState('')
  const [bulkBusy, setBulkBusy]     = useState(false)
  const [bulkError, setBulkError]   = useState(null)
  const [toast, setToast]           = useState(null)

  const PAGE_SIZE = 20

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('profiles')
      .select('id, full_name, email, role, site, country, approved, locked, created_at, organisation_id, is_super_admin', { count: 'exact' })
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
    setSelected(new Set())
    setLoading(false)
  }, [activeOrg, filterOrg, filterRole, filterStatus, search, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('organisations').select('id, name').order('name')
      .then(({ data }) => setOrgs(data ?? []))
  }, [])

  // Merge built-in roles with any custom roles so every assignable role appears.
  useEffect(() => {
    listCustomRoles()
      .then(rows => {
        const names = (rows ?? []).map(r => r.name).filter(Boolean)
        setRoles([...ACCESS_ROLES, ...names.filter(n => !ACCESS_ROLES.includes(n))])
      })
      .catch(() => setRoles(ACCESS_ROLES))
  }, [])

  function flashToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

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

  function openEdit(user) {
    setError(null)
    setEditForm({
      full_name: user.full_name ?? '',
      role: user.role ?? '',
      site: user.site ?? '',
      countries: Array.isArray(user.country) ? [...user.country] : (user.country ? [user.country] : []),
    })
    setEditModal(user)
    setActionMenu(null)
  }

  function toggleEditCountry(c) {
    setEditForm(f => {
      const has = f.countries.includes(c)
      return { ...f, countries: has ? f.countries.filter(x => x !== c) : [...f.countries, c] }
    })
  }

  async function handleEditSave() {
    setSaving(true); setError(null)
    try {
      const { error: err } = await supabase.from('profiles')
        .update({ role: editForm.role, site: editForm.site, full_name: editForm.full_name })
        .eq('id', editModal.id)
      if (err) throw new Error(err.message)

      // Country scope is a text[] behind super-admin RLS -> dedicated RPC.
      await setUserCountry(editModal.id, editForm.countries)

      await logAction('update_user', editModal.id, 'user', {
        role: editForm.role, email: editModal.email, countries: editForm.countries,
      })
      setSaving(false); setEditModal(null); load()
    } catch (e) {
      setError(e?.message || 'Could not save user.')
      setSaving(false)
    }
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

  // ── Selection helpers ──────────────────────────────────────────────────────
  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const allOnPageSelected = users.length > 0 && users.every(u => selected.has(u.id))
  function toggleSelectAll() {
    setSelected(prev => {
      if (users.every(u => prev.has(u.id))) {
        const next = new Set(prev)
        users.forEach(u => next.delete(u.id))
        return next
      }
      const next = new Set(prev)
      users.forEach(u => next.add(u.id))
      return next
    })
  }

  function openBulk(type) {
    setBulkError(null)
    if (type === 'role') setBulkRole(roles[0] ?? '')
    setBulkModal(type)
  }

  async function runBulkRole() {
    if (!bulkRole) { setBulkError('Choose a role.'); return }
    setBulkBusy(true); setBulkError(null)
    try {
      const ids = [...selected]
      const n = await bulkSetRole(ids, bulkRole)
      await logAction('bulk_set_role', null, 'user', { role: bulkRole, requested: ids.length, updated: n })
      setBulkModal(null); setBulkBusy(false)
      flashToast(`${n} updated to role "${bulkRole}"`)
      load()
    } catch (e) {
      setBulkError(e?.message || 'Bulk role change failed.'); setBulkBusy(false)
    }
  }

  async function runBulkGrant() {
    if (!bulkModule) { setBulkError('Choose a module.'); return }
    setBulkBusy(true); setBulkError(null)
    try {
      const ids = [...selected]
      const n = await bulkSetGrant({
        userIds: ids,
        moduleKey: bulkModule,
        capability: bulkCapability,
        effect: bulkEffect,
        expiresAt: bulkExpiry ? new Date(bulkExpiry).toISOString() : null,
      })
      await logAction('bulk_set_grant', null, 'user', {
        module: bulkModule, capability: bulkCapability, effect: bulkEffect, updated: n,
      })
      setBulkModal(null); setBulkBusy(false)
      flashToast(`${n} updated : ${bulkEffect} ${bulkCapability} on ${bulkModule}`)
      load()
    } catch (e) {
      setBulkError(e?.message || 'Bulk grant failed.'); setBulkBusy(false)
    }
  }

  const pendingCount  = users.filter(u => !u.approved && !u.locked).length
  const lockedCount   = users.filter(u => u.locked).length
  const moduleLabel = (k) => ALL_MODULES.find(m => m.key === k)?.label ?? k

  return (
    <div className="space-y-5 max-w-7xl" onClick={() => setActionMenu(null)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Users</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} users : {pendingCount} pending : {lockedCount} locked
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
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
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

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-orange-950/30 border border-orange-700/40">
          <span className="text-xs text-orange-300 font-semibold">{selected.size} selected</span>
          <button onClick={() => openBulk('role')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-200 hover:text-white transition-colors">
            <UserCog size={12} /> Set Role
          </button>
          <button onClick={() => openBulk('grant')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-200 hover:text-white transition-colors">
            <ShieldCheck size={12} /> Grant / Revoke Module
          </button>
          <button onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-gray-400 hover:text-white transition-colors">Clear selection</button>
        </div>
      )}

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
                <th className="px-4 py-3 w-10">
                  <button onClick={toggleSelectAll} className="text-gray-500 hover:text-orange-400 transition-colors"
                    title={allOnPageSelected ? 'Clear page' : 'Select page'}>
                    {allOnPageSelected ? <CheckSquare size={15} className="text-orange-400" /> : <Square size={15} />}
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">User</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Countries</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Site</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const isSel = selected.has(user.id)
                const countries = Array.isArray(user.country) ? user.country : (user.country ? [user.country] : [])
                return (
                  <tr key={user.id}
                    className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors ${
                      isSel ? 'bg-orange-950/20' :
                      !user.approved && !user.locked ? 'bg-yellow-950/10' :
                      user.locked ? 'bg-red-950/10' : ''
                    }`}>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleSelect(user.id)}
                        className="text-gray-500 hover:text-orange-400 transition-colors">
                        {isSel ? <CheckSquare size={15} className="text-orange-400" /> : <Square size={15} />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 flex-shrink-0">
                          {(user.full_name ?? user.email ?? '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold text-white truncate">{user.full_name ?? 'N/A'}</p>
                            {user.is_super_admin && <Shield size={10} className="text-orange-400 flex-shrink-0" />}
                          </div>
                          <p className="text-gray-500 truncate">{user.email ?? 'N/A'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-4 py-3">
                      {countries.length === 0
                        ? <span className="text-gray-600">All</span>
                        : (
                          <div className="flex flex-wrap gap-1">
                            {countries.map(c => (
                              <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300">{c}</span>
                            ))}
                          </div>
                        )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{user.site ?? 'N/A'}</td>
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
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                        {!user.approved && !user.locked && (
                          <button onClick={() => toggleApprove(user)}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-green-900/40 text-green-400 hover:bg-green-900/60 text-[10px] font-semibold transition-colors border border-green-700/40">
                            <UserCheck size={10} /> Approve
                          </button>
                        )}
                        <button onClick={() => setActionMenu(actionMenu === user.id ? null : user.id)}
                          className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors">
                          <MoreVertical size={14} />
                        </button>
                        {actionMenu === user.id && (
                          <div className="absolute right-0 top-full mt-1 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-20 py-1">
                            <MenuItem icon={Edit2} label="Edit User" onClick={() => openEdit(user)} />
                            <MenuItem icon={user.approved ? UserX : UserCheck}
                              label={user.approved ? 'Revoke Approval' : 'Approve User'}
                              onClick={() => { toggleApprove(user); setActionMenu(null) }} />
                            <MenuItem icon={user.locked ? Unlock : Lock}
                              label={user.locked ? 'Unlock Account' : 'Lock Account'}
                              onClick={() => { toggleLock(user); setActionMenu(null) }}
                              danger={!user.locked} />
                            <MenuItem icon={Key} label="Reset Password"
                              onClick={() => { setResetModal(user); setResetSent(false); setActionMenu(null) }} />
                            <MenuItem icon={ShieldCheck} label="Manage grants"
                              onClick={() => { setActionMenu(null); navigate('/console/access?tab=grants') }} />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 bg-gray-900/30">
              <p className="text-xs text-gray-500">
                Showing {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-3 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 transition-colors border border-gray-700">
                  Prev
                </button>
                <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}
                  className="px-3 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 transition-colors border border-gray-700">
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit user modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 sticky top-0 bg-gray-900">
              <h2 className="text-sm font-bold text-white">Edit User</h2>
              <button onClick={() => setEditModal(null)} className="text-gray-500 hover:text-gray-300"><XClose size={16} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {error && <ErrBox msg={error} />}
              <Field label="Full Name">
                <input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                  className="input-dark w-full h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-orange-500" />
              </Field>
              <Field label="Role">
                <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  className="input-dark w-full h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-orange-500">
                  <option value="">N/A</option>
                  {roles.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Site / Location">
                <input value={editForm.site} onChange={e => setEditForm(f => ({ ...f, site: e.target.value }))}
                  className="input-dark w-full h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-orange-500" placeholder="e.g. Depot A" />
              </Field>
              <Field label={<span className="flex items-center gap-1.5"><Globe size={11} /> Country Scope</span>}>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set([...COUNTRIES, ...editForm.countries])].map(c => {
                    const on = editForm.countries.includes(c)
                    return (
                      <button key={c} type="button" onClick={() => toggleEditCountry(c)}
                        className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                          on ? 'bg-orange-500/20 border-orange-500/50 text-orange-200'
                             : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                        }`}>
                        {c}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-gray-600 mt-1.5">No selection = access to all countries.</p>
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

      {/* Bulk role modal */}
      {bulkModal === 'role' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <UserCog size={16} className="text-orange-400" />
              <h2 className="text-sm font-bold text-white">Set Role : {selected.size} users</h2>
            </div>
            {bulkError && <div className="mb-3"><ErrBox msg={bulkError} /></div>}
            <Field label="New Role">
              <select value={bulkRole} onChange={e => setBulkRole(e.target.value)}
                className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-orange-500">
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <p className="text-[10px] text-gray-600 mt-2">Super admins are never demoted and the last admin is protected, so the applied count may be lower than selected.</p>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setBulkModal(null)} disabled={bulkBusy}
                className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">Cancel</button>
              <button onClick={runBulkRole} disabled={bulkBusy}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}>
                {bulkBusy ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk grant modal */}
      {bulkModal === 'grant' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck size={16} className="text-orange-400" />
              <h2 className="text-sm font-bold text-white">Grant / Revoke : {selected.size} users</h2>
            </div>
            {bulkError && <div className="mb-3"><ErrBox msg={bulkError} /></div>}
            <div className="space-y-3">
              <Field label="Module">
                <select value={bulkModule} onChange={e => setBulkModule(e.target.value)}
                  className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-orange-500">
                  {ALL_MODULES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Capability">
                  <select value={bulkCapability} onChange={e => setBulkCapability(e.target.value)}
                    className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg px-2 text-xs text-white focus:outline-none focus:border-orange-500">
                    {CAPABILITIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Effect">
                  <select value={bulkEffect} onChange={e => setBulkEffect(e.target.value)}
                    className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg px-2 text-xs text-white focus:outline-none focus:border-orange-500">
                    <option value="grant">Grant</option>
                    <option value="revoke">Revoke</option>
                  </select>
                </Field>
              </div>
              <Field label="Expiry (optional)">
                <input type="date" value={bulkExpiry} onChange={e => setBulkExpiry(e.target.value)}
                  className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-orange-500" />
              </Field>
            </div>
            <p className="text-[10px] text-gray-600 mt-2">
              {bulkEffect === 'grant' ? 'Grant' : 'Revoke'} "{bulkCapability}" on "{moduleLabel(bulkModule)}" for {selected.size} users. Only "view" is enforced today; other capabilities are stored.
            </p>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setBulkModal(null)} disabled={bulkBusy}
                className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">Cancel</button>
              <button onClick={runBulkGrant} disabled={bulkBusy}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}>
                {bulkBusy ? 'Applying...' : 'Apply'}
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

      {/* Success toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-3 rounded-xl bg-green-900/90 border border-green-600/50 shadow-2xl">
          <CheckCircle size={15} className="text-green-300" />
          <p className="text-xs text-green-100 font-medium">{toast}</p>
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
    'Integration Admin': 'text-emerald-300 bg-emerald-900/30',
    'Data Engineer': 'text-cyan-300 bg-cyan-900/30',
    Automation: 'text-indigo-300 bg-indigo-900/30',
    'Data Monitor Officer': 'text-pink-300 bg-pink-900/30',
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${c[role] ?? 'text-gray-400 bg-gray-800'}`}>{role ?? 'N/A'}</span>
  )
}

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
