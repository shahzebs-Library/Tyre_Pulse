import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import * as usersApi from '../lib/api/users'
import { useAuth } from '../contexts/AuthContext'
import {
  Users, Search, Edit2, Trash2, CheckCircle, XCircle, Shield,
  Activity, LayoutGrid, ChevronDown, UserCheck, UserX,
  AlertTriangle, Globe, Calendar, Hash, X, Copy, Terminal, Info,
  Phone, MapPin, FileText, Lock, Mail, LogIn, Clock
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES = ['Admin', 'Manager', 'Inspector', 'Director', 'Reporter', 'Tyre Man']

const ROLE_BADGE = {
  Admin:      'bg-red-900/50 text-red-300 border border-red-700/40',
  Manager:    'bg-orange-900/50 text-orange-300 border border-orange-700/40',
  Inspector:  'bg-purple-900/50 text-purple-300 border border-purple-700/40',
  Director:   'bg-blue-900/50 text-blue-300 border border-blue-700/40',
  Reporter:   'bg-gray-800 text-gray-400 border border-gray-700/40',
  'Tyre Man': 'bg-teal-900/50 text-teal-300 border border-teal-700/40',
}

const COUNTRIES = ['KSA', 'UAE', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Jordan', 'Iraq', 'Egypt']

// ─── Access Matrix data ───────────────────────────────────────────────────────

const MATRIX_FEATURES = [
  'Dashboard',
  'Tyre Records',
  'Analytics',
  'Fleet Analytics',
  'KPI Scorecard',
  'Stock Management',
  'Corrective Actions',
  'Inspections',
  'Smart Analytics',
  'Anomaly Scan',
  'Data Cleaning',
  'Upload Data',
  'Audit Trail',
  'User Management',
]

// Values: 'Full' | 'Read' | 'Write' | 'Checklist' | null
const MATRIX_DATA = {
  'Dashboard':          { Admin: 'Full', Manager: 'Full', Inspector: null,   Director: 'Full', Reporter: 'Read',  'Tyre Man': null        },
  'Tyre Records':       { Admin: 'Full', Manager: 'Full', Inspector: null,   Director: 'Read', Reporter: 'Full',  'Tyre Man': null        },
  'Analytics':          { Admin: 'Full', Manager: 'Full', Inspector: null,   Director: 'Full', Reporter: 'Read',  'Tyre Man': null        },
  'Fleet Analytics':    { Admin: 'Full', Manager: 'Full', Inspector: null,   Director: 'Full', Reporter: null,    'Tyre Man': null        },
  'KPI Scorecard':      { Admin: 'Full', Manager: 'Full', Inspector: null,   Director: 'Full', Reporter: null,    'Tyre Man': null        },
  'Stock Management':   { Admin: 'Full', Manager: 'Full', Inspector: null,   Director: 'Read', Reporter: 'Read',  'Tyre Man': null        },
  'Corrective Actions': { Admin: 'Full', Manager: 'Full', Inspector: null,   Director: 'Read', Reporter: 'Write', 'Tyre Man': null        },
  'Inspections':        { Admin: 'Full', Manager: 'Full', Inspector: 'Full', Director: 'Read', Reporter: 'Write', 'Tyre Man': 'Checklist' },
  'Smart Analytics':    { Admin: 'Full', Manager: null,   Inspector: null,   Director: 'Full', Reporter: null,    'Tyre Man': null        },
  'Anomaly Scan':       { Admin: 'Full', Manager: 'Read', Inspector: null,   Director: null,   Reporter: null,    'Tyre Man': null        },
  'Data Cleaning':      { Admin: 'Full', Manager: null,   Inspector: null,   Director: null,   Reporter: null,    'Tyre Man': null        },
  'Upload Data':        { Admin: 'Full', Manager: 'Full', Inspector: null,   Director: null,   Reporter: 'Full',  'Tyre Man': null        },
  'Audit Trail':        { Admin: 'Full', Manager: 'Read', Inspector: null,   Director: null,   Reporter: null,    'Tyre Man': null        },
  'User Management':    { Admin: 'Full', Manager: null,   Inspector: null,   Director: null,   Reporter: null,    'Tyre Man': null        },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarColor(name) {
  const colors = [
    '#15803d', '#b45309', '#7c3aed', '#0369a1', '#be185d',
    '#0f766e', '#92400e', '#1e40af', '#6b21a8', '#065f46',
  ]
  let sum = 0
  for (let i = 0; i < (name || '').length; i++) sum += name.charCodeAt(i)
  return colors[sum % colors.length]
}

function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function formatDate(iso) {
  if (!iso) return 'n/a'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function formatDateTime(iso) {
  if (!iso) return 'n/a'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function PermCell({ value }) {
  if (!value) return <span className="text-gray-600 text-sm">-</span>
  const map = {
    Full:      'bg-green-900/40 text-green-400',
    Read:      'bg-blue-900/40 text-blue-400',
    Write:     'bg-yellow-900/40 text-yellow-400',
    Checklist: 'bg-purple-900/40 text-purple-400',
  }
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${map[value] ?? ''}`}>
      {value}
    </span>
  )
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {[...Array(6)].map((_, i) => (
        <td key={i} className="table-cell">
          <div className="h-4 bg-gray-700/50 rounded animate-pulse" style={{ width: `${60 + (i * 13) % 40}%` }} />
        </td>
      ))}
    </tr>
  )
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, maxWidth = 'max-w-lg' }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className={`bg-gray-900 border border-gray-700 rounded-xl w-full ${maxWidth} p-6 max-h-[90vh] overflow-y-auto`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
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

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-green-600' : 'bg-gray-700'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

// ─── Migration SQL snippet ────────────────────────────────────────────────────

const MIGRATION_SQL = `-- Run MIGRATIONS_V22.sql in the Supabase SQL Editor.
-- That file adds the locked column, hardens get_my_role(), and updates
-- admin_update_profile to accept p_locked. Paste the full V22 file content.

-- Quick inline version (if you need it without the full file):
alter table public.profiles add column if not exists locked boolean not null default false;

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
  on public.profiles for update
  using (public.get_my_role() = 'Admin');

create or replace function public.admin_update_profile(
  p_user_id     uuid,
  p_full_name   text    default null,
  p_username    text    default null,
  p_employee_id text    default null,
  p_role        text    default null,
  p_country     text[]  default null,
  p_region      text    default null,
  p_site        text    default null,
  p_phone       text    default null,
  p_notes       text    default null,
  p_approved    boolean default null,
  p_locked      boolean default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  v_role := (select role from public.profiles where id = auth.uid() limit 1);
  if v_role is distinct from 'Admin' then
    return jsonb_build_object('success', false, 'error', 'Permission denied');
  end if;
  if p_user_id = auth.uid() and p_locked = true then
    return jsonb_build_object('success', false, 'error', 'Cannot lock your own account');
  end if;
  update public.profiles set
    full_name   = coalesce(p_full_name,   full_name),
    username    = coalesce(p_username,    username),
    employee_id = coalesce(p_employee_id, employee_id),
    role        = coalesce(p_role,        role),
    country     = case when p_country is not null then p_country else country end,
    region      = coalesce(p_region,      region),
    site        = coalesce(p_site,        site),
    phone       = coalesce(p_phone,       phone),
    notes       = coalesce(p_notes,       notes),
    approved    = coalesce(p_approved,    approved),
    locked      = coalesce(p_locked,      locked),
    updated_at  = now()
  where id = p_user_id;
  return jsonb_build_object('success', true);
end;
$$;

-- Also harden get_my_role() to block locked / unapproved users
create or replace function public.get_my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles
   where id = auth.uid()
     and locked = false
     and (approved is null or approved = true)
   limit 1;
$$;

grant execute on function public.admin_update_profile to authenticated;`

function RlsBlockedCard() {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(MIGRATION_SQL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select the textarea content
    }
  }

  return (
    <div className="card border border-yellow-700/40 bg-yellow-900/10 space-y-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-yellow-300 font-semibold text-sm">Admin Policy Missing</p>
          <p className="text-gray-400 text-sm mt-1">
            The <code className="bg-gray-800 text-yellow-200 px-1.5 py-0.5 rounded text-xs">profiles_admin_update</code> RLS
            policy has not been applied yet. Admin profile edits will silently fail until this migration is run
            in the Supabase SQL Editor.
          </p>
        </div>
      </div>

      <div className="rounded-lg overflow-hidden border border-gray-700/60">
        <div className="flex items-center justify-between bg-gray-800/70 px-4 py-2 border-b border-gray-700/60">
          <span className="flex items-center gap-2 text-xs text-gray-400">
            <Terminal size={13} />
            MIGRATION_ADMIN_PROFILES.sql
          </span>
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded transition-colors ${
              copied
                ? 'bg-green-800/60 text-green-300 border border-green-700/40'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white border border-gray-600/40'
            }`}
          >
            {copied ? <CheckCircle size={12} /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy SQL'}
          </button>
        </div>
        <pre className="text-[11px] leading-relaxed text-gray-300 bg-gray-900/60 p-4 overflow-x-auto whitespace-pre-wrap max-h-56 font-mono">
          {MIGRATION_SQL}
        </pre>
      </div>

      <p className="text-xs text-gray-500 flex items-center gap-1.5">
        <Info size={12} className="text-gray-600 flex-shrink-0" />
        After running the SQL, refresh this page. The user list and edit functionality will restore automatically.
      </p>
    </div>
  )
}

// ─── Toast component ──────────────────────────────────────────────────────────

function Toast({ toast }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key="toast"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className={`fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium border backdrop-blur-sm ${
            toast.type === 'ok'
              ? 'bg-green-900/90 text-green-200 border-green-700/50'
              : 'bg-red-900/90 text-red-200 border-red-700/50'
          }`}
        >
          {toast.type === 'ok'
            ? <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
            : <XCircle size={16} className="text-red-400 flex-shrink-0" />
          }
          {toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function UserManagement() {
  const { profile: currentProfile } = useAuth()

  // Data
  const [users, setUsers]               = useState([])
  const [auditLog, setAuditLog]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [auditLoading, setAuditLoading] = useState(false)
  const [loadError, setLoadError]       = useState(null)
  const [rlsBlocked, setRlsBlocked]     = useState(false)

  // Tabs
  const [activeTab, setActiveTab] = useState('users')

  // Filters
  const [search, setSearch]             = useState('')
  const [roleFilter, setRoleFilter]     = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Inline role save state per user id: 'saving' | 'saved' | null
  const [roleSaveState, setRoleSaveState] = useState({})

  // Toast notification
  const [toast, setToast]           = useState(null) // { text, type: 'ok'|'err' }
  const toastTimerRef               = useRef(null)

  // Edit modal
  const [editTarget, setEditTarget] = useState(null)
  const [editForm, setEditForm]     = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [editMsg, setEditMsg]       = useState({ text: '', type: '' })

  // Delete modal
  const [deleteTarget, setDeleteTarget]   = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError]     = useState('')

  // Activity expanded row
  const [expandedRow, setExpandedRow] = useState(null)

  const isAdmin = currentProfile?.role === 'Admin'

  // ── Toast helper ──────────────────────────────────────────────────────────

  function showToast(text, type = 'ok', duration = 3500) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ text, type })
    toastTimerRef.current = setTimeout(() => setToast(null), duration)
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setRlsBlocked(false)

    try {
      const data = await usersApi.listProfiles()
      if (!data || data.length === 0) {
        setRlsBlocked(true)
        setUsers([])
      } else {
        setUsers(data)
      }
    } catch (error) {
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
    }

    setLoading(false)
  }, [])

  const loadAuditLog = useCallback(async () => {
    setAuditLoading(true)
    try {
      const data = await usersApi.listAuditLog({ limit: 100 })
      if (data) {
        setAuditLog(data)
      }
    } catch {
      // audit_log table may not exist yet
    }
    setAuditLoading(false)
  }, [])

  useEffect(() => {
    if (isAdmin) loadUsers()
    else setLoading(false)
  }, [isAdmin, loadUsers])

  useEffect(() => {
    if (isAdmin && activeTab === 'activity') loadAuditLog()
  }, [isAdmin, activeTab, loadAuditLog])

  // ── Computed stats ────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total:   users.length,
    active:  users.filter(u => u.approved !== false).length,
    pending: users.filter(u => u.approved === false).length,
    admins:  users.filter(u => u.role === 'Admin').length,
  }), [users])

  // ── Filtered users ────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const term = search.toLowerCase()
    return users.filter(u => {
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
  }, [users, search, roleFilter, statusFilter])

  // ── Inline role change ────────────────────────────────────────────────────

  async function handleInlineRoleChange(userId, newRole) {
    setRoleSaveState(s => ({ ...s, [userId]: 'saving' }))
    let data = null
    let error = null
    try {
      data = await usersApi.adminUpdateProfile({
        p_user_id: userId,
        p_role: newRole,
      })
    } catch (e) {
      error = e
    }

    const success = !error && data?.success !== false
    if (success) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
      setRoleSaveState(s => ({ ...s, [userId]: 'saved' }))
      setTimeout(() => setRoleSaveState(s => ({ ...s, [userId]: null })), 1500)
    } else {
      setRoleSaveState(s => ({ ...s, [userId]: null }))
      showToast(error?.message ?? data?.error ?? 'Role update failed.', 'err')
    }
  }

  // ── Approve quick action ──────────────────────────────────────────────────

  async function handleApproveQuick(user) {
    let data = null
    let error = null
    try {
      data = await usersApi.adminUpdateProfile({
        p_user_id: user.id,
        p_approved: true,
      })
    } catch (e) {
      error = e
    }
    if (!error && data?.success !== false) {
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, approved: true } : u))
      showToast(`${user.full_name || user.username || 'User'} approved.`, 'ok')
    } else {
      showToast(error?.message ?? data?.error ?? 'Approval failed.', 'err')
    }
  }

  // ── Edit modal ────────────────────────────────────────────────────────────

  function openEdit(user) {
    setEditTarget(user)
    const c = user.country
    setEditForm({
      full_name:   user.full_name   ?? '',
      username:    user.username    ?? '',
      employee_id: user.employee_id ?? '',
      role:        user.role        ?? 'Reporter',
      country:     Array.isArray(c) ? [...c] : (c ? [c] : []),
      region:      user.region ?? '',
      site:        user.site   ?? '',
      phone:       user.phone  ?? '',
      notes:       user.notes  ?? '',
      approved:    user.approved !== false,
      locked:      user.locked  ?? false,
    })
    setEditMsg({ text: '', type: '' })
  }

  function closeEdit() {
    setEditTarget(null)
    setEditForm({})
    setEditMsg({ text: '', type: '' })
    setEditSaving(false)
  }

  function toggleEditCountry(c) {
    setEditForm(f => ({
      ...f,
      country: f.country.includes(c)
        ? f.country.filter(x => x !== c)
        : [...f.country, c],
    }))
  }

  async function handleEditSave() {
    if (!editTarget) return

    // Validate required fields
    if (!editForm.full_name?.trim()) {
      setEditMsg({ text: 'Full name cannot be empty.', type: 'err' })
      return
    }

    setEditSaving(true)
    setEditMsg({ text: '', type: '' })

    const trimmedName = editForm.full_name.trim()

    // ── RPC (security-definer, bypasses RLS reliably) ────────────────────
    let rpcData = null
    let rpcError = null
    try {
      rpcData = await usersApi.adminUpdateProfile({
        p_user_id:    editTarget.id,
        p_full_name:  trimmedName                              || null,
        p_username:   editForm.username?.trim()                || null,
        p_employee_id: editForm.employee_id?.trim()            || null,
        p_role:       editForm.role                            || null,
        p_country:    editForm.country.length > 0 ? editForm.country : null,
        p_region:     editForm.region?.trim()                  || null,
        p_site:       editForm.site?.trim()                    || null,
        p_phone:      editForm.phone?.trim()                   || null,
        p_notes:      editForm.notes?.trim()                   || null,
        p_approved:   editForm.approved,
        p_locked:     editForm.locked,
      })
    } catch (e) {
      rpcError = e
    }

    // RPC transport error (function missing) → fallback
    if (rpcError) {
      const isFnMissing =
        rpcError.code === 'PGRST202' ||
        rpcError.message?.toLowerCase().includes('does not exist')

      if (!isFnMissing) {
        setEditMsg({ text: rpcError.message, type: 'err' })
        setEditSaving(false)
        return
      }

      // Fallback: direct table update
      let directError = null
      try {
        await usersApi.updateProfileById(editTarget.id, {
          full_name:   trimmedName                              || null,
          username:    editForm.username?.trim()                || null,
          employee_id: editForm.employee_id?.trim()            || null,
          role:        editForm.role,
          country:     editForm.country.length > 0 ? editForm.country : null,
          region:      editForm.region?.trim()                  || null,
          site:        editForm.site?.trim()                    || null,
          phone:       editForm.phone?.trim()                   || null,
          notes:       editForm.notes?.trim()                   || null,
          approved:    editForm.approved,
          locked:      editForm.locked,
        })
      } catch (e) {
        directError = e
      }

      if (directError) {
        setEditMsg({
          text: directError.code === '42501' || directError.code === 'PGRST301'
            ? 'Permission denied. Ensure the admin_update_profile RPC function is deployed in Supabase.'
            : directError.message,
          type: 'err',
        })
        setEditSaving(false)
        return
      }
    } else if (rpcData?.success === false) {
      setEditMsg({ text: rpcData.error ?? 'Update failed.', type: 'err' })
      setEditSaving(false)
      return
    }

    setEditSaving(false)
    showToast(`${trimmedName || 'User'} updated successfully.`, 'ok')
    await loadUsers()
    closeEdit()
  }

  // ── Delete modal ──────────────────────────────────────────────────────────

  function openDelete(user) {
    setDeleteTarget(user)
    setDeleteConfirm('')
    setDeleteError('')
  }

  function closeDelete() {
    setDeleteTarget(null)
    setDeleteConfirm('')
    setDeleteError('')
    setDeleteLoading(false)
  }

  async function handleDelete() {
    if (!deleteTarget || deleteConfirm !== 'DELETE') return
    setDeleteLoading(true)
    setDeleteError('')

    try {
      await usersApi.deleteProfileById(deleteTarget.id)
    } catch (error) {
      setDeleteError(error.message)
      setDeleteLoading(false)
      return
    }

    setUsers(prev => prev.filter(u => u.id !== deleteTarget.id))
    closeDelete()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Access guard
  // ─────────────────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 space-y-4 py-20">
        <Shield size={52} className="text-red-400" />
        <h1 className="text-xl font-bold text-white">Access Denied</h1>
        <p className="text-gray-400 text-sm text-center max-w-sm">
          This page is restricted to Admin users only. Contact your administrator to request access.
        </p>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      <PageHeader
        title="User Management"
        subtitle="Manage roles, country access, and account approvals"
        icon={Users}
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Users',      value: stats.total,   color: 'text-green-400' },
          { label: 'Active',           value: stats.active,  color: 'text-green-400' },
          { label: 'Pending Approval', value: stats.pending, color: stats.pending > 0 ? 'text-yellow-300' : 'text-green-400' },
          { label: 'Admins',           value: stats.admins,  color: 'text-green-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            {loading
              ? <div className="h-8 w-10 bg-gray-700 rounded animate-pulse mt-1" />
              : <p className={`text-2xl font-bold ${color}`}>{value}</p>
            }
          </div>
        ))}
      </div>

      {/* RLS / error notices */}
      {rlsBlocked && <RlsBlockedCard />}

      {loadError && (
        <div className="card border border-red-700/40 bg-red-900/10">
          <p className="text-red-300 text-sm font-medium">Error: {loadError}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-700/60">
        {[
          { id: 'users',    label: 'Users',        icon: Users    },
          { id: 'matrix',   label: 'Access Matrix', icon: LayoutGrid  },
          { id: 'activity', label: 'Activity',      icon: Activity },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t transition-colors ${
              activeTab === id
                ? 'text-green-400 border-b-2 border-green-400 bg-gray-800/30'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/20'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* ── USERS TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div className="space-y-4">

          {/* Filter row */}
          <div className="card space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-52">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-9 w-full"
                  placeholder="Search by name, username or employee ID"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-gray-500 mr-1">Role:</span>
              {['', ...ROLES].map(r => (
                <button
                  key={r || '__all__'}
                  onClick={() => setRoleFilter(r)}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                    roleFilter === r
                      ? 'bg-green-700 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  {r || 'All'}
                </button>
              ))}
              <span className="text-xs text-gray-500 ml-3 mr-1">Status:</span>
              {[
                { value: '',        label: 'All'     },
                { value: 'active',  label: 'Active'  },
                { value: 'pending', label: 'Pending' },
              ].map(({ value, label }) => (
                <button
                  key={value || '__all_status__'}
                  onClick={() => setStatusFilter(value)}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                    statusFilter === value
                      ? 'bg-green-700 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    {['User', 'Role', 'Access', 'Status', 'Joined', 'Actions'].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <>
                      <SkeletonRow />
                      <SkeletonRow />
                      <SkeletonRow />
                    </>
                  ) : rlsBlocked ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-gray-600">
                        User list unavailable. See warning above.
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-14">
                        <div className="flex flex-col items-center gap-3 text-gray-500">
                          <UserX size={32} className="text-gray-700" />
                          <p className="text-sm">No users match the current filters.</p>
                          {(search || roleFilter || statusFilter) && (
                            <button
                              onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter('') }}
                              className="text-xs text-green-400 hover:text-green-300 underline"
                            >
                              Clear all filters
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : filtered.map(u => {
                    const isSelf      = u.id === currentProfile?.id
                    const isPending   = u.approved === false
                    const displayName = u.full_name || u.username || 'Unknown'
                    const saveState   = roleSaveState[u.id]

                    return (
                      <tr key={u.id} className="hover:bg-gray-800/50 transition-colors">

                        {/* User column */}
                        <td className="table-cell">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                              style={{ backgroundColor: avatarColor(displayName) }}
                            >
                              {initials(displayName)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-white font-semibold text-sm truncate">{displayName}</span>
                                {isSelf && (
                                  <span className="text-[10px] font-semibold bg-green-900/40 text-green-400 border border-green-700/40 rounded px-1.5 py-0.5">
                                    You
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 truncate">{u.username ?? 'n/a'}</p>
                              {u.employee_id && (
                                <span className="inline-flex items-center gap-1 text-[10px] bg-gray-800 text-gray-500 border border-gray-700/40 rounded px-1.5 py-0.5 mt-0.5">
                                  <Hash size={9} />
                                  {u.employee_id}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Role column: inline dropdown for others, badge for self */}
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            {isSelf ? (
                              <span className={`badge text-xs ${ROLE_BADGE[u.role] ?? 'bg-gray-800 text-gray-400'}`}>
                                {u.role ?? 'n/a'}
                              </span>
                            ) : (
                              <div className="relative">
                                <select
                                  value={u.role ?? ''}
                                  onChange={e => handleInlineRoleChange(u.id, e.target.value)}
                                  disabled={saveState === 'saving'}
                                  className="input text-xs py-1 pr-7 pl-2 w-32 appearance-none cursor-pointer"
                                >
                                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                              </div>
                            )}
                            {saveState === 'saving' && (
                              <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                            )}
                            {saveState === 'saved' && (
                              <CheckCircle size={15} className="text-green-400" />
                            )}
                          </div>
                        </td>

                        {/* Access column */}
                        <td className="table-cell">
                          {Array.isArray(u.country) && u.country.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {u.country.map(c => (
                                <span key={c} className="text-[10px] bg-gray-800 text-gray-400 border border-gray-700/40 rounded px-1.5 py-0.5">
                                  {c}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <Globe size={11} /> All
                            </span>
                          )}
                        </td>

                        {/* Status column */}
                        <td className="table-cell">
                          <div className="flex flex-col gap-1">
                            {isPending ? (
                              <span className="badge bg-yellow-900/40 text-yellow-300 border border-yellow-700/40">
                                Pending
                              </span>
                            ) : (
                              <span className="badge bg-green-900/30 text-green-400 border border-green-700/40">
                                Active
                              </span>
                            )}
                            {u.locked && (
                              <span className="badge bg-red-900/40 text-red-300 border border-red-700/40 flex items-center gap-1">
                                <Lock size={9} />Locked
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Joined column */}
                        <td className="table-cell text-gray-400 text-xs">
                          <span className="flex items-center gap-1">
                            <Calendar size={11} />
                            {formatDate(u.created_at)}
                          </span>
                        </td>

                        {/* Actions column */}
                        <td className="table-cell">
                          <div className="flex items-center gap-1">
                            {isPending && (
                              <button
                                onClick={() => handleApproveQuick(u)}
                                title="Approve account"
                                className="p-1.5 rounded text-green-400 hover:bg-green-900/30 transition-colors"
                              >
                                <UserCheck size={15} />
                              </button>
                            )}
                            <button
                              onClick={() => openEdit(u)}
                              title="Edit user"
                              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                            >
                              <Edit2 size={15} />
                            </button>
                            {!isSelf && (
                              <button
                                onClick={() => openDelete(u)}
                                title="Delete user"
                                className="p-1.5 rounded text-red-400 hover:bg-red-900/30 transition-colors"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
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

      {/* ── ACCESS MATRIX TAB ────────────────────────────────────────────────── */}
      {activeTab === 'matrix' && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-700/60">
            <h2 className="text-base font-semibold text-white">Feature Permission Matrix</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Read-only reference. Shows what each role can access across the platform.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700/60">
                  <th className="table-header sticky left-0 bg-gray-900 z-10 min-w-44 text-left">
                    Feature
                  </th>
                  {ROLES.map(r => (
                    <th key={r} className="table-header text-center min-w-28">
                      <span className={`badge text-xs ${ROLE_BADGE[r] ?? 'bg-gray-800 text-gray-400'}`}>
                        {r}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX_FEATURES.map((feature, idx) => (
                  <tr
                    key={feature}
                    className={`border-b border-gray-800/60 ${idx % 2 !== 0 ? 'bg-gray-800/20' : ''}`}
                  >
                    <td className="table-cell sticky left-0 bg-gray-900 font-medium text-gray-300 text-sm">
                      {feature}
                    </td>
                    {ROLES.map(r => (
                      <td key={r} className="table-cell text-center">
                        <PermCell value={MATRIX_DATA[feature]?.[r] ?? null} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-gray-700/60 flex flex-wrap gap-5 text-xs">
            {[
              { label: 'Full access', cls: 'bg-green-900/40 text-green-400'   },
              { label: 'Read only',   cls: 'bg-blue-900/40 text-blue-400'     },
              { label: 'Write',       cls: 'bg-yellow-900/40 text-yellow-400' },
              { label: 'Checklist',   cls: 'bg-purple-900/40 text-purple-400' },
            ].map(({ label, cls }) => (
              <span key={label} className="flex items-center gap-2">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
                  {label.split(' ')[0]}
                </span>
                <span className="text-gray-400">{label}</span>
              </span>
            ))}
            <span className="flex items-center gap-2">
              <span className="text-gray-600 text-sm font-medium">-</span>
              <span className="text-gray-400">No access</span>
            </span>
          </div>
        </div>
      )}

      {/* ── ACTIVITY TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'activity' && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-700/60 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Recent Activity</h2>
              <p className="text-xs text-gray-500 mt-0.5">Last 100 audit log entries</p>
            </div>
            <button
              onClick={loadAuditLog}
              className="text-xs text-green-400 hover:text-green-300 transition-colors"
            >
              Refresh
            </button>
          </div>
          {auditLoading ? (
            <div className="px-5 py-12 text-center text-gray-500 text-sm">Loading activity...</div>
          ) : auditLog.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <Activity size={36} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No activity data available.</p>
              <p className="text-gray-600 text-xs mt-1">
                The audit_log table may not have data yet. Run MIGRATIONS_V6_AUDIT.sql to create it.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    {['Timestamp', 'User', 'Action', 'Table', 'Records', 'Details'].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map(entry => {
                    const isExpanded = expandedRow === entry.id
                    const actor = users.find(u => u.id === entry.user_id)
                    const actorName = actor?.full_name || actor?.username || (entry.user_id ? entry.user_id.slice(0, 8) : 'n/a')
                    const actionLower = (entry.action ?? '').toLowerCase()

                    return (
                      <tr key={entry.id} className="hover:bg-gray-800/50 transition-colors">
                        <td className="table-cell text-xs text-gray-400 whitespace-nowrap">
                          {formatDateTime(entry.created_at)}
                        </td>
                        <td className="table-cell">
                          <span className="text-sm text-white">{actorName}</span>
                        </td>
                        <td className="table-cell">
                          <span className={`badge text-xs ${
                            actionLower.includes('delete')
                              ? 'bg-red-900/40 text-red-300 border-red-700/40'
                              : actionLower.includes('insert')
                                ? 'bg-green-900/40 text-green-300 border-green-700/40'
                                : 'bg-blue-900/40 text-blue-300 border-blue-700/40'
                          }`}>
                            {entry.action ?? 'n/a'}
                          </span>
                        </td>
                        <td className="table-cell text-gray-400 text-xs">
                          {entry.table_name ?? 'n/a'}
                        </td>
                        <td className="table-cell text-gray-400 text-xs text-center">
                          {entry.record_count ?? entry.rows_affected ?? 'n/a'}
                        </td>
                        <td className="table-cell">
                          {entry.details ? (
                            <button
                              onClick={() => setExpandedRow(isExpanded ? null : entry.id)}
                              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
                            >
                              <ChevronDown
                                size={13}
                                className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              />
                              {isExpanded ? 'Hide' : 'Show'}
                            </button>
                          ) : (
                            <span className="text-gray-700 text-xs">n/a</span>
                          )}
                          {isExpanded && entry.details && (
                            <pre className="mt-2 text-[10px] text-gray-400 bg-gray-800 rounded p-2 max-w-xs overflow-x-auto whitespace-pre-wrap break-all">
                              {typeof entry.details === 'string'
                                ? entry.details
                                : JSON.stringify(entry.details, null, 2)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── EDIT MODAL ────────────────────────────────────────────────────────── */}
      {editTarget && (
        <Modal title="Edit User" onClose={closeEdit} maxWidth="max-w-2xl">
          <div className="space-y-4">

            {/* Banners */}
            {editTarget.id === currentProfile?.id && (
              <div className="flex items-center gap-2.5 bg-blue-900/20 border border-blue-700/40 rounded-lg px-4 py-2.5">
                <Info size={15} className="text-blue-400 flex-shrink-0" />
                <p className="text-blue-300 text-xs font-medium">You are editing your own profile.</p>
              </div>
            )}
            {editTarget.locked && (
              <div className="flex items-center gap-2.5 bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-2.5">
                <Lock size={15} className="text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-xs font-medium">This account is currently locked and cannot log in.</p>
              </div>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap gap-4 text-xs text-gray-500 pb-1 border-b border-gray-800">
              {editTarget.email && (
                <span className="flex items-center gap-1.5">
                  <Mail size={11} className="text-gray-600" />
                  {editTarget.email}
                </span>
              )}
              {editTarget.updated_at && (
                <span className="flex items-center gap-1.5">
                  <Clock size={11} className="text-gray-600" />
                  Updated: {formatDateTime(editTarget.updated_at)}
                </span>
              )}
              {editTarget.last_login_at && (
                <span className="flex items-center gap-1.5">
                  <LogIn size={11} className="text-gray-600" />
                  Last login: {formatDateTime(editTarget.last_login_at)}
                </span>
              )}
              {editTarget.login_count > 0 && (
                <span className="flex items-center gap-1.5">
                  <Activity size={11} className="text-gray-600" />
                  {editTarget.login_count} login{editTarget.login_count !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Identity */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Full Name <span className="text-red-500 ml-0.5">*</span></label>
                <input
                  className={`input ${!editForm.full_name?.trim() && editMsg.type === 'err' ? 'border-red-600 focus:ring-red-500/30' : ''}`}
                  value={editForm.full_name ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="label">Username</label>
                <input
                  className="input"
                  value={editForm.username ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="Username"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Employee ID</label>
                <input
                  className="input"
                  value={editForm.employee_id ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, employee_id: e.target.value }))}
                  placeholder="EMP-001"
                />
              </div>
              <div>
                <label className="label">
                  <Phone size={11} className="inline mr-1 text-gray-500" />Phone
                </label>
                <input
                  className="input"
                  value={editForm.phone ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+966 5x xxx xxxx"
                />
              </div>
              <div>
                <label className="label">
                  <MapPin size={11} className="inline mr-1 text-gray-500" />Site
                </label>
                <input
                  className="input"
                  value={editForm.site ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, site: e.target.value }))}
                  placeholder="e.g. Riyadh Hub"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Region</label>
                <input
                  className="input"
                  value={editForm.region ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, region: e.target.value }))}
                  placeholder="e.g. Gulf"
                />
              </div>
              <div>
                <label className="label">Role</label>
                <select
                  className="input"
                  value={editForm.role ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  disabled={editTarget.id === currentProfile?.id}
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                {editTarget.id === currentProfile?.id && (
                  <p className="text-xs text-gray-500 mt-1">You cannot change your own role.</p>
                )}
              </div>
            </div>

            {/* Country access */}
            <div>
              <label className="label">Country Access</label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mt-1">
                {COUNTRIES.map(c => (
                  <label
                    key={c}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-xs font-medium transition-colors ${
                      (editForm.country ?? []).includes(c)
                        ? 'bg-green-900/40 text-green-300 border border-green-700/50'
                        : 'bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:border-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={(editForm.country ?? []).includes(c)}
                      onChange={() => toggleEditCountry(c)}
                      className="accent-green-500 w-3 h-3"
                    />
                    {c}
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {(editForm.country ?? []).length === 0
                  ? 'No restriction - user can see all countries.'
                  : `Restricted to: ${editForm.country.join(', ')}`}
              </p>
            </div>

            {/* Notes */}
            <div>
              <label className="label">
                <FileText size={11} className="inline mr-1 text-gray-500" />Admin Notes
              </label>
              <textarea
                className="input min-h-[72px] resize-y text-sm"
                value={editForm.notes ?? ''}
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Internal notes (only visible to admins)"
              />
            </div>

            {/* Toggles */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between bg-gray-800/40 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm text-white font-medium">Account Approved</p>
                  <p className="text-xs text-gray-500 mt-0.5">Unapproved accounts cannot log in.</p>
                </div>
                <Toggle
                  checked={editForm.approved ?? true}
                  onChange={val => setEditForm(f => ({ ...f, approved: val }))}
                />
              </div>
              <div className={`flex items-center justify-between rounded-lg px-4 py-3 ${editForm.locked ? 'bg-red-900/20 border border-red-700/30' : 'bg-gray-800/40'}`}>
                <div>
                  <p className="text-sm text-white font-medium flex items-center gap-1.5">
                    <Lock size={13} className={editForm.locked ? 'text-red-400' : 'text-gray-500'} />
                    Account Locked
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">Locked accounts are blocked from login.</p>
                </div>
                <Toggle
                  checked={editForm.locked ?? false}
                  onChange={val => setEditForm(f => ({ ...f, locked: val }))}
                />
              </div>
            </div>

            {editMsg.text && (
              <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                editMsg.type === 'ok'
                  ? 'bg-green-900/20 text-green-400 border border-green-700/30'
                  : 'bg-red-900/20 text-red-400 border border-red-700/30'
              }`}>
                {editMsg.type === 'ok'
                  ? <CheckCircle size={14} />
                  : <XCircle size={14} />}
                {editMsg.text}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleEditSave}
                disabled={editSaving}
                className="btn-primary flex items-center justify-center gap-2 disabled:opacity-50 flex-1"
              >
                {editSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle size={15} />
                    Save Changes
                  </>
                )}
              </button>
              <button onClick={closeEdit} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── GLOBAL TOAST ─────────────────────────────────────────────────────── */}
      <Toast toast={toast} />

      {/* ── DELETE MODAL ─────────────────────────────────────────────────────── */}
      {deleteTarget && (
        <Modal title="Delete User Account" onClose={closeDelete} maxWidth="max-w-md">
          <div className="space-y-4">

            <div className="flex gap-3 bg-red-900/20 border border-red-700/40 rounded-lg p-4">
              <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300 leading-relaxed">
                This will permanently delete{' '}
                <strong>{deleteTarget.full_name || deleteTarget.username || 'this user'}&apos;s</strong>{' '}
                account and all associated data. This cannot be undone.
              </p>
            </div>

            <div>
              <label className="label">
                Type <span className="text-red-400 font-mono font-bold">DELETE</span> to confirm
              </label>
              <input
                className="input"
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>

            {deleteError && (
              <p className="text-sm text-red-400">{deleteError}</p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleDelete}
                disabled={deleteConfirm !== 'DELETE' || deleteLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {deleteLoading ? (
                  <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                ) : (
                  <Trash2 size={15} />
                )}
                {deleteLoading ? 'Deleting...' : 'Delete Account'}
              </button>
              <button onClick={closeDelete} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  )
}
