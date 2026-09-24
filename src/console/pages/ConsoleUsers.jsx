/**
 * ConsoleUsers - the super-admin user register: approve, lock, edit role /
 * country / site scope, block web login, reset passwords, bulk role and grant.
 *
 * Fixes carried with the kit conversion:
 * - The header and the "N pending / N locked" quick filters counted only the
 *   20 rows on the CURRENT PAGE, so an admin on page 1 could read "0 pending"
 *   while approvals waited on page 3. Every headline figure and chart now comes
 *   from one paged read of the whole user base in the same org scope.
 * - The list read, approve and lock ignored their errors, so an RLS denial
 *   rendered as "No users found" and a failed lock looked like it had worked.
 *   All three now surface a sanitized message.
 * - The row action menu was absolutely positioned inside a scrolling table and
 *   was clipped on the last rows. It now opens as a fixed-position menu.
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Lock, Unlock, CheckCircle, RefreshCw, Edit2, Key, AlertTriangle,
  Shield, MoreVertical, UserCheck, UserX, Globe, CheckSquare, Square, UserCog,
  ShieldCheck, MapPin, Plus, Smartphone, Monitor, UserPlus, PieChart,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, ProportionBar, Badge, Code, Btn, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { TrendChart, ShareChart } from '../components/ui/charts'
import { dailySeries, topShare } from '../../lib/consoleCharts'
import { supabase } from '../../lib/supabase'
import { fetchAllPages } from '../../lib/fetchAll'
import { sanitizeSearchTerm } from '../../lib/searchFilter'
import { toUserMessage } from '../../lib/safeError'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { ACCESS_ROLES, ALL_MODULES } from '../../lib/moduleCatalog'
import { listCustomRoles } from '../../lib/api/customRoles'
import {
  setUserCountry, bulkSetRole, bulkSetGrant, adminSetUserSites, adminSetWebAccess,
  canEmailReset, adminSetUserPassword,
} from '../../lib/api/adminAccess'
import { listDataSiteOptions } from '../../lib/api/sites'
// Site scope semantics (V309): no sites = NO site-scoped access; an explicit
// 'ALL' / '*' sentinel = org-wide. Admins/super always see everything.
// Single source: src/lib/scopeSentinel.js (shared with the invariant tests).
import { isOrgWideSites, withoutOrgWide } from '../../lib/scopeSentinel'

// Site options are capped so a runaway fleet register can never flood the
// editor; anything already stored on a user still renders as a chip.
const SITE_OPTIONS_CAP = 100

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

const TREND_DAYS = 30
const STATS_MAX = 20000

/** approved | pending | locked, the same buckets the status filter uses. */
export function userStatus(u) {
  if (u?.locked) return 'locked'
  return u?.approved ? 'approved' : 'pending'
}

/** Headline counts over the whole user base, never one page of it. */
export function summarizeUsers(rows = []) {
  const c = { total: 0, approved: 0, pending: 0, locked: 0, mobileOnly: 0, superAdmins: 0 }
  for (const u of rows || []) {
    c.total += 1
    c[userStatus(u)] += 1
    if (u?.web_access === false) c.mobileOnly += 1
    if (u?.is_super_admin) c.superAdmins += 1
  }
  return c
}

const ROLE_TONE = { Admin: 'danger', Manager: 'accent', Director: 'info' }

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
  // Web-access deny confirmation (blocking web login on an account).
  const [webModal, setWebModal] = useState(null)
  const [webBusy, setWebBusy]   = useState(false)
  const [webError, setWebError] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [newPassword, setNewPassword] = useState('')

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
  const [loadError, setLoadError]   = useState(null)
  const [menuPos, setMenuPos]       = useState(null)   // { top, right } for the row action menu

  // Whole-base stats for the tiles and charts (paged, never capped at 1000).
  const [statRows, setStatRows]       = useState([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError]     = useState(null)
  const [statsTruncated, setStatsTruncated] = useState(false)

  // Distinct operational site options for the per-user Sites editor.
  const [siteOpts, setSiteOpts]         = useState([])
  const [siteOptsLoading, setSiteOptsLoading] = useState(true)
  const [siteOptsError, setSiteOptsError]     = useState(false)
  const [siteAdd, setSiteAdd]           = useState('')

  const PAGE_SIZE = 20

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('profiles')
      .select('id, full_name, email, role, site, sites, country, approved, locked, web_access, created_at, organisation_id, is_super_admin', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (activeOrg) q = q.eq('organisation_id', activeOrg.id)
    else if (filterOrg) q = q.eq('organisation_id', filterOrg)

    if (filterRole)   q = q.eq('role', filterRole)
    if (filterStatus === 'pending')  q = q.eq('approved', false).eq('locked', false)
    if (filterStatus === 'locked')   q = q.eq('locked', true)
    if (filterStatus === 'approved') q = q.eq('approved', true).eq('locked', false)
    if (search) { const s = sanitizeSearchTerm(search); q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,site.ilike.%${s}%`) }

    const { data, count, error: err } = await q
    if (err) {
      setLoadError(toUserMessage(err, 'Could not load users.'))
      setUsers([]); setTotal(0)
    } else {
      setLoadError(null)
      setUsers(data ?? [])
      setTotal(count ?? 0)
    }
    setSelected(new Set())
    setLoading(false)
  }, [activeOrg, filterOrg, filterRole, filterStatus, search, page])

  useEffect(() => { load() }, [load])

  // One lean paged read of every user in the current org scope (not the role /
  // status / search filters: the tiles describe the whole base, and clicking one
  // applies its filter). Ordered by id so paging never drops or repeats a row.
  const scopeOrgId = activeOrg ? activeOrg.id : (filterOrg || null)
  const loadStats = useCallback(async () => {
    setStatsLoading(true); setStatsError(null)
    const { data, error: err, truncated } = await fetchAllPages(
      (from, to) => {
        let q = supabase
          .from('profiles')
          .select('id, role, approved, locked, web_access, is_super_admin, created_at')
          .order('id')
          .range(from, to)
        if (scopeOrgId) q = q.eq('organisation_id', scopeOrgId)
        return q
      },
      { max: STATS_MAX },
    )
    if (err) {
      setStatsError(toUserMessage(err, 'Could not load user statistics.'))
      setStatRows([])
    } else {
      setStatRows(data ?? [])
    }
    setStatsTruncated(!!truncated)
    setStatsLoading(false)
  }, [scopeOrgId])

  useEffect(() => { loadStats() }, [loadStats])

  const refreshAll = useCallback(() => { load(); loadStats() }, [load, loadStats])

  // The row menu is fixed-positioned, so close it on scroll / resize rather than
  // let it float away from its row.
  useEffect(() => {
    if (!actionMenu) return undefined
    const close = () => { setActionMenu(null); setMenuPos(null) }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [actionMenu])

  function openMenu(e, userId) {
    e.stopPropagation()
    if (actionMenu === userId) { setActionMenu(null); setMenuPos(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    const menuH = 230
    const top = r.bottom + menuH > window.innerHeight ? Math.max(8, r.top - menuH) : r.bottom + 4
    setMenuPos({ top, right: Math.max(8, window.innerWidth - r.right) })
    setActionMenu(userId)
  }

  useEffect(() => {
    supabase.from('organisations').select('id, name').order('name')
      .then(({ data }) => setOrgs(data ?? []))
  }, [])

  // Merge built-in roles with any custom roles so every assignable role appears.
  // Re-fetched on mount AND whenever the tab regains focus / becomes visible, so
  // a custom role created elsewhere (Access Control -> Custom Roles) shows up in
  // the role pickers without a full page reload.
  const loadRoles = useCallback(() => {
    listCustomRoles()
      .then(rows => {
        const names = (rows ?? []).map(r => r.name).filter(Boolean)
        setRoles([...ACCESS_ROLES, ...names.filter(n => !ACCESS_ROLES.includes(n))])
      })
      .catch(() => setRoles(ACCESS_ROLES))
  }, [])
  useEffect(() => {
    loadRoles()
    const onFocus = () => loadRoles()
    const onVis = () => { if (!document.hidden) loadRoles() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [loadRoles])

  // Distinct site list for the Sites editor. Prefer the org-scoped reference
  // RPC (aggregates every operational table); fall back to a direct distinct
  // read over vehicle_fleet.site if the RPC is unavailable.
  useEffect(() => {
    let cancelled = false
    async function loadSiteOptions() {
      setSiteOptsLoading(true); setSiteOptsError(false)
      try {
        let names = []
        try {
          names = await listDataSiteOptions(null)
        } catch {
          // Paged: `.limit(2000)` returned 1000 of the 1,617 fleet rows, and
          // because this read is ordered by site the fallback picker lost every
          // site late in the alphabet. `id` is the paging tiebreak.
          const { data, error: err } = await fetchAllPages(
            (from, to) => supabase
              .from('vehicle_fleet')
              .select('site')
              .not('site', 'is', null)
              .order('site').order('id')
              .range(from, to),
            { max: 20000 },
          )
          if (err) throw err
          names = [...new Set((data ?? []).map(r => String(r.site ?? '').trim()).filter(Boolean))]
        }
        if (cancelled) return
        setSiteOpts([...new Set(names)].sort((a, b) => a.localeCompare(b)).slice(0, SITE_OPTIONS_CAP))
      } catch {
        if (!cancelled) { setSiteOpts([]); setSiteOptsError(true) }
      } finally {
        if (!cancelled) setSiteOptsLoading(false)
      }
    }
    loadSiteOptions()
    return () => { cancelled = true }
  }, [])

  function flashToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  async function toggleApprove(user) {
    const approved = !user.approved
    const { error: err } = await supabase.from('profiles').update({ approved }).eq('id', user.id)
    if (err) { setLoadError(toUserMessage(err, 'Could not change approval.')); return }
    await logAction(approved ? 'approve_user' : 'unapprove_user', user.id, 'user', { email: user.email })
    flashToast(approved ? 'User approved' : 'Approval revoked')
    refreshAll()
  }

  async function toggleLock(user) {
    const locked = !user.locked
    const { error: err } = await supabase.from('profiles').update({ locked }).eq('id', user.id)
    if (err) { setLoadError(toUserMessage(err, 'Could not change the lock.')); return }
    await logAction(locked ? 'lock_user' : 'unlock_user', user.id, 'user', { email: user.email })
    flashToast(locked ? 'Account locked' : 'Account unlocked')
    refreshAll()
  }

  // Web-app access (V278). Enabling is applied directly; disabling (mobile-only)
  // asks for confirmation first. Admins / super-admins are never blocked (the
  // server RPC and the client gate both exempt them), so this only affects
  // regular accounts.
  async function applyWeb(user, web) {
    setWebBusy(true); setWebError(null)
    try {
      await adminSetWebAccess(user.id, web)
      await logAction(web ? 'allow_web_access' : 'block_web_access', user.id, 'user', { email: user.email })
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, web_access: web } : u)))
      setStatRows(prev => prev.map(u => (u.id === user.id ? { ...u, web_access: web } : u)))
      setWebModal(null)
      flashToast(web ? 'Web login allowed' : 'Web login blocked (mobile app only)')
    } catch (e) {
      setWebError(toUserMessage(e, 'Could not change web access.'))
    } finally {
      setWebBusy(false)
    }
  }

  function toggleWeb(user) {
    setActionMenu(null); setMenuPos(null)
    if (user.web_access === false) applyWeb(user, true)
    else { setWebError(null); setWebModal(user) }
  }

  function openEdit(user) {
    setError(null)
    setSiteAdd('')
    setEditForm({
      full_name: user.full_name ?? '',
      role: user.role ?? '',
      site: user.site ?? '',
      countries: Array.isArray(user.country) ? [...user.country] : (user.country ? [user.country] : []),
      sites: Array.isArray(user.sites) ? [...user.sites] : [],
    })
    setEditModal(user)
    setActionMenu(null); setMenuPos(null)
  }

  function toggleEditCountry(c) {
    setEditForm(f => {
      const has = f.countries.includes(c)
      return { ...f, countries: has ? f.countries.filter(x => x !== c) : [...f.countries, c] }
    })
  }

  function toggleEditSite(s) {
    setEditForm(f => {
      // Picking a specific site drops the org-wide sentinel (they are exclusive).
      const base = withoutOrgWide(f.sites)
      const has = base.includes(s)
      return { ...f, sites: has ? base.filter(x => x !== s) : [...base, s] }
    })
  }

  function addFreeTextSite() {
    const s = siteAdd.trim().toUpperCase()
    if (!s) return
    setEditForm(f => {
      const base = withoutOrgWide(f.sites)
      return base.includes(s) ? f : { ...f, sites: [...base, s] }
    })
    setSiteAdd('')
  }

  async function handleEditSave() {
    setSaving(true); setError(null)
    try {
      const { error: err } = await supabase.from('profiles')
        .update({ role: editForm.role, site: editForm.site, full_name: editForm.full_name })
        .eq('id', editModal.id)
      if (err) throw err

      // Country scope is a text[] behind super-admin RLS -> dedicated RPC.
      await setUserCountry(editModal.id, editForm.countries)

      // Site scope (profiles.sites text[], V269) -> dedicated RPC. Only call
      // when the selection actually changed.
      const prevSites = Array.isArray(editModal.sites) ? editModal.sites : []
      const nextSites = editForm.sites
      const sitesChanged =
        prevSites.length !== nextSites.length || nextSites.some(s => !prevSites.includes(s))
      if (sitesChanged) {
        await adminSetUserSites(editModal.id, nextSites)
        await logAction('set_user_sites', editModal.id, 'user', {
          email: editModal.email, sites: nextSites,
        })
      }

      await logAction('update_user', editModal.id, 'user', {
        role: editForm.role, email: editModal.email, countries: editForm.countries,
        sites: nextSites,
      })
      // Optimistic update so the row reflects the new scope immediately.
      setUsers(prev => prev.map(u => (u.id === editModal.id
        ? {
            ...u,
            full_name: editForm.full_name,
            role: editForm.role,
            site: editForm.site,
            country: editForm.countries,
            sites: nextSites.length > 0 ? nextSites : null,
          }
        : u)))
      setSaving(false); setEditModal(null); refreshAll()
    } catch (e) {
      setError(toUserMessage(e, 'Could not save user.'))
      setSaving(false)
    }
  }

  async function sendPasswordReset(user) {
    setResetSent(false); setResetError('')
    const { error: err } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (err) { setResetError(toUserMessage(err, 'Could not send the reset email.')); return }
    await logAction('reset_password', user.id, 'user', { email: user.email })
    setResetSent(true)
  }

  /**
   * Set the password directly. The only thing that works for an account whose
   * email cannot receive mail - which is most of the field staff. The password
   * is shown once so it can be passed on in person or by phone; it is never
   * emailed, because there is no mailbox to email.
   */
  async function setPasswordDirect(user) {
    setResetSent(false); setResetError(''); setResetBusy(true)
    try {
      const r = await adminSetUserPassword(user.id, newPassword, 'admin reset - user could not sign in')
      if (!r.ok) {
        setResetError(
          r.reason === 'too_short' ? `Use at least ${r.min_length} characters.`
            : r.reason === 'use_change_password' ? 'Change your own password from Settings instead.'
              : r.reason === 'no_such_user' ? 'That user no longer exists.'
                : 'Could not set the password.')
        return
      }
      await logAction('set_password', user.id, 'user', { username: r.username })
      setResetSent(true)
    } catch (e) {
      setResetError(toUserMessage(e, 'Could not set the password.'))
    } finally { setResetBusy(false) }
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
      refreshAll()
    } catch (e) {
      setBulkError(toUserMessage(e, 'Bulk role change failed.')); setBulkBusy(false)
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
      setBulkError(toUserMessage(e, 'Bulk grant failed.')); setBulkBusy(false)
    }
  }

  const stats = useMemo(() => summarizeUsers(statRows), [statRows])
  const roleShare = useMemo(() => topShare(statRows, (u) => u.role, 5), [statRows])
  const joins = useMemo(() => dailySeries(statRows, (u) => u.created_at, TREND_DAYS), [statRows])
  const moduleLabel = (k) => ALL_MODULES.find(m => m.key === k)?.label ?? k
  const hasFilters = !!(filterRole || filterStatus || filterOrg || search)
  const clearFilters = () => { setFilterRole(''); setFilterStatus(''); setFilterOrg(''); setSearch(''); setPage(0) }
  const pickStatus = (st) => { setFilterStatus(filterStatus === st ? '' : st); setPage(0) }
  const tileVal = (n) => (statsLoading || statsError ? 'N/A' : n.toLocaleString())
  const menuUser = actionMenu ? users.find(u => u.id === actionMenu) : null
  const closeMenu = () => { setActionMenu(null); setMenuPos(null) }
  const scopeLabel = activeOrg ? activeOrg.name : (filterOrg ? (orgs.find(o => o.id === filterOrg)?.name ?? 'Selected organisation') : 'All organisations')

  return (
    <div className="space-y-5 max-w-7xl" onClick={closeMenu}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2"><Users size={18} className="text-orange-400" /> Users</h1>
          <p className="text-xs text-gray-500 mt-1">
            Approve, lock and scope every account in {scopeLabel}. Figures cover the whole user base, not just the page shown.
          </p>
        </div>
        <Btn icon={RefreshCw} onClick={refreshAll} busy={loading || statsLoading}>Refresh</Btn>
      </header>

      <ErrorState message={loadError} onRetry={refreshAll} />
      {statsError && !loadError && <ErrorState message={statsError} onRetry={loadStats} />}
      {statsTruncated && (
        <Note icon={AlertTriangle} tone="warning">
          The statistics cover the first {STATS_MAX.toLocaleString()} users only. The table below still pages through everyone.
        </Note>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="Users" value={tileVal(stats.total)} icon={Users}
          sub={statsLoading || statsError ? undefined : `${stats.superAdmins} super admin${stats.superAdmins === 1 ? '' : 's'}`} />
        <StatTile label="Approved" value={tileVal(stats.approved)} tone="good" icon={UserCheck}
          onClick={() => pickStatus('approved')} active={filterStatus === 'approved'} />
        <StatTile label="Pending approval" value={tileVal(stats.pending)} tone={stats.pending ? 'warning' : 'default'} icon={AlertTriangle}
          onClick={() => pickStatus('pending')} active={filterStatus === 'pending'} sub="Cannot use the app yet" />
        <StatTile label="Locked" value={tileVal(stats.locked)} tone={stats.locked ? 'danger' : 'default'} icon={Lock}
          onClick={() => pickStatus('locked')} active={filterStatus === 'locked'} />
        <StatTile label="Mobile only" value={tileVal(stats.mobileOnly)} icon={Smartphone} sub="Web login blocked" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-2">
          <PanelHeader icon={PieChart} title="Users by role" subtitle="Top five roles, the rest grouped as Other" />
          {statsLoading ? <LoadingState rows={3} /> : statsError ? (
            <EmptyState title="Not available" reason="The user base could not be read, so no breakdown is shown." />
          ) : (
            <>
              <ShareChart parts={roleShare} height={150} center={{ value: stats.total, label: 'Users' }}
                summary={roleShare.map((p) => `${p.label} ${p.value}`).join(', ')}
                emptyText="No users in this scope." />
              {stats.total > 0 && (
                <div className="mt-4 space-y-1.5">
                  <p className="text-[11px] text-gray-500">Account status</p>
                  <ProportionBar total={stats.total} segments={[
                    { label: 'Approved', value: stats.approved, tone: 'good' },
                    { label: 'Pending', value: stats.pending, tone: 'warning' },
                    { label: 'Locked', value: stats.locked, tone: 'danger' },
                  ]} />
                </div>
              )}
            </>
          )}
        </Panel>
        <Panel className="lg:col-span-3">
          <PanelHeader icon={UserPlus} title="New accounts per day"
            subtitle={`Last ${TREND_DAYS} days, ${statsLoading || statsError ? 'N/A' : joins.total} new account${joins.total === 1 ? '' : 's'}`} />
          {statsLoading ? <LoadingState rows={3} /> : statsError ? (
            <EmptyState title="Not available" reason="The user base could not be read, so no trend is shown." />
          ) : (
            <TrendChart labels={joins.labels} series={[{ label: 'New accounts', values: joins.values }]} height={200}
              summary={`${joins.total} accounts created in the last ${TREND_DAYS} days`}
              emptyText="No accounts were created in the last 30 days." />
          )}
        </Panel>
      </div>

      <Panel flush>
        <div className="p-4 pb-3 space-y-3">
          <PanelHeader icon={Users} title="User register"
            subtitle={loading ? 'Loading' : `${total.toLocaleString()} user${total === 1 ? '' : 's'} match the current filters`} />
          <Toolbar>
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(0) }}
              placeholder="Search name, email, site" className="flex-1 min-w-48" />
            <Select value={filterRole} onChange={(v) => { setFilterRole(v); setPage(0) }} placeholder="All roles" className="w-40"
              options={roles.map(r => ({ value: r, label: r }))} />
            <Select value={filterStatus} onChange={(v) => { setFilterStatus(v); setPage(0) }} placeholder="All status" className="w-36"
              options={[
                { value: 'approved', label: 'Approved' },
                { value: 'pending', label: 'Pending' },
                { value: 'locked', label: 'Locked' },
              ]} />
            {!activeOrg && (
              <Select value={filterOrg} onChange={(v) => { setFilterOrg(v); setPage(0) }} placeholder="All organisations" className="w-48"
                options={orgs.map(o => ({ value: o.id, label: o.name }))} />
            )}
            {hasFilters && <Btn variant="quiet" onClick={clearFilters}>Clear filters</Btn>}
          </Toolbar>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-lg bg-orange-950/20 border border-orange-800/40">
              <Badge tone="accent">{selected.size} selected</Badge>
              <Btn size="xs" icon={UserCog} onClick={() => openBulk('role')}>Set role</Btn>
              <Btn size="xs" icon={ShieldCheck} onClick={() => openBulk('grant')}>Grant or revoke module</Btn>
              <span className="ml-auto"><Btn size="xs" variant="quiet" onClick={() => setSelected(new Set())}>Clear selection</Btn></span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="px-4"><LoadingState label="Loading users" rows={6} /></div>
        ) : users.length === 0 ? (
          <EmptyState icon={Users} title={loadError ? 'Users could not be loaded' : 'No users found'}
            reason={loadError
              ? 'The list could not be read, so nothing is shown. Use Retry above.'
              : hasFilters ? 'No user matches the current search and filters.' : 'There are no users in this scope yet.'}
            action={hasFilters && !loadError ? <Btn onClick={clearFilters}>Clear filters</Btn> : null} />
        ) : (
          <>
            <Table className="border-0 rounded-none">
              <THead>
                <Th className="w-10">
                  <button onClick={toggleSelectAll} className="text-gray-500 hover:text-orange-400 transition-colors"
                    title={allOnPageSelected ? 'Clear page' : 'Select page'} aria-label={allOnPageSelected ? 'Clear page' : 'Select page'}>
                    {allOnPageSelected ? <CheckSquare size={15} className="text-orange-400" /> : <Square size={15} />}
                  </button>
                </Th>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Countries</Th>
                <Th>Sites</Th>
                <Th>Site</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
                <Th align="right">Actions</Th>
              </THead>
              <tbody>
                {users.map(user => {
                  const isSel = selected.has(user.id)
                  const countries = Array.isArray(user.country) ? user.country : (user.country ? [user.country] : [])
                  const userSites = Array.isArray(user.sites) ? user.sites.filter(Boolean) : []
                  const st = userStatus(user)
                  return (
                    <Tr key={user.id} tone={!isSel && st === 'pending' ? 'warning' : undefined}
                      className={isSel ? 'bg-orange-950/20' : ''}>
                      <Td>
                        <button onClick={() => toggleSelect(user.id)} aria-label={isSel ? 'Deselect user' : 'Select user'}
                          className="text-gray-500 hover:text-orange-400 transition-colors">
                          {isSel ? <CheckSquare size={15} className="text-orange-400" /> : <Square size={15} />}
                        </button>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs font-semibold text-gray-300 shrink-0">
                            {(user.full_name ?? user.email ?? '?')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-gray-100 truncate">{user.full_name ?? 'N/A'}</p>
                              {user.is_super_admin && <Badge tone="accent" icon={Shield} title="Super admin">Super</Badge>}
                              {user.web_access === false && (
                                <Badge tone="info" icon={Smartphone} title="Mobile app only (web login blocked)">Mobile only</Badge>
                              )}
                            </div>
                            <p className="text-gray-500 truncate">{user.email ?? 'N/A'}</p>
                          </div>
                        </div>
                      </Td>
                      <Td><Badge tone={ROLE_TONE[user.role] || 'default'}>{user.role ?? 'N/A'}</Badge></Td>
                      <Td>
                        {countries.length === 0
                          ? <span className="text-gray-500">All</span>
                          : <div className="flex flex-wrap gap-1">{countries.map(c => <Badge key={c}>{c}</Badge>)}</div>}
                      </Td>
                      <Td>
                        <button type="button" onClick={e => { e.stopPropagation(); openEdit(user) }}
                          title="Edit site access" className="text-left">
                          {userSites.length === 0
                            ? <Badge tone="danger" icon={MapPin}>No access</Badge>
                            : isOrgWideSites(userSites)
                              ? <Badge tone="accent" icon={MapPin}>All sites</Badge>
                              : (
                                <span className="flex flex-wrap gap-1">
                                  {userSites.slice(0, 3).map(s => <Badge key={s}>{s}</Badge>)}
                                  {userSites.length > 3 && <Badge tone="quiet">+{userSites.length - 3}</Badge>}
                                </span>
                              )}
                        </button>
                      </Td>
                      <Td className="text-gray-400">{user.site ?? 'N/A'}</Td>
                      <Td>
                        {st === 'locked'
                          ? <Badge tone="danger" icon={Lock}>Locked</Badge>
                          : st === 'approved'
                            ? <Badge tone="good" icon={CheckCircle}>Approved</Badge>
                            : <Badge tone="warning" icon={AlertTriangle}>Pending</Badge>}
                      </Td>
                      <Td nowrap className="text-gray-500">
                        {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                      </Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          {st === 'pending' && (
                            <Btn size="xs" variant="good" icon={UserCheck} onClick={() => toggleApprove(user)}>Approve</Btn>
                          )}
                          <button onClick={e => openMenu(e, user.id)} aria-label="More actions" aria-haspopup="menu"
                            aria-expanded={actionMenu === user.id}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors">
                            <MoreVertical size={14} />
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                <p className="text-xs text-gray-500">
                  Showing {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <Btn size="xs" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Prev</Btn>
                  <Btn size="xs" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>Next</Btn>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      {/* Row action menu: fixed so the scrolling table cannot clip it. */}
      {menuUser && menuPos && (
        <div role="menu" onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
          className="w-56 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl z-40 py-1">
          <MenuItem icon={Edit2} label="Edit user" onClick={() => openEdit(menuUser)} />
          <MenuItem icon={menuUser.approved ? UserX : UserCheck}
            label={menuUser.approved ? 'Revoke approval' : 'Approve user'}
            onClick={() => { toggleApprove(menuUser); closeMenu() }} />
          <MenuItem icon={menuUser.locked ? Unlock : Lock}
            label={menuUser.locked ? 'Unlock account' : 'Lock account'}
            onClick={() => { toggleLock(menuUser); closeMenu() }}
            danger={!menuUser.locked} />
          <MenuItem icon={menuUser.web_access === false ? Monitor : Smartphone}
            label={menuUser.web_access === false ? 'Allow web login' : 'Block web login (mobile only)'}
            onClick={() => toggleWeb(menuUser)}
            danger={menuUser.web_access !== false} />
          <MenuItem icon={Key} label="Reset password"
            onClick={() => { setResetModal(menuUser); setResetSent(false); closeMenu() }} />
          <MenuItem icon={ShieldCheck} label="Manage grants"
            onClick={() => { closeMenu(); navigate('/console/access?tab=grants') }} />
        </div>
      )}

      {/* Edit user modal */}
      <Modal open={!!editModal} width="max-w-lg" title="Edit user" subtitle={editModal?.email}
        onClose={() => setEditModal(null)}
        footer={(
          <>
            <Btn onClick={() => setEditModal(null)} disabled={saving}>Cancel</Btn>
            <Btn variant="primary" onClick={handleEditSave} busy={saving}>{saving ? 'Saving...' : 'Save changes'}</Btn>
          </>
        )}>
        {editModal && (
          <div className="space-y-4">
            <ErrorState message={error} />
            <Field label="Full name">
              <input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                className={INPUT} />
            </Field>
            <Field label="Role">
              <Select value={editForm.role} onChange={(v) => setEditForm(f => ({ ...f, role: v }))} placeholder="N/A"
                options={roles.map(r => ({ value: r, label: r }))} />
            </Field>
            <Field label="Site / location">
              <input value={editForm.site} onChange={e => setEditForm(f => ({ ...f, site: e.target.value }))}
                className={INPUT} placeholder="e.g. Depot A" />
            </Field>
            <Field label={<span className="flex items-center gap-1.5"><Globe size={11} /> Country scope</span>}>
              <div className="flex flex-wrap gap-1.5">
                {[...new Set([...COUNTRIES, ...editForm.countries])].map(c => {
                  const on = editForm.countries.includes(c)
                  return (
                    <button key={c} type="button" onClick={() => toggleEditCountry(c)} aria-pressed={on}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                        on ? 'bg-orange-500/20 border-orange-600/50 text-orange-200'
                           : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-gray-200'
                      }`}>
                      {c}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">Admins and super-admins see all countries. Other roles see only the countries listed here.</p>
            </Field>
            <Field label={<span className="flex items-center gap-1.5"><MapPin size={11} /> Site access</span>}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                {isOrgWideSites(editForm.sites)
                  ? <Badge tone="accent" icon={MapPin}>All sites (org-wide)</Badge>
                  : editForm.sites?.length > 0
                    ? (
                      <div className="flex flex-wrap gap-1">
                        {editForm.sites.map(s => (
                          <button key={s} type="button" onClick={() => toggleEditSite(s)} title={`Remove ${s}`}>
                            <Badge tone="accent">{s} x</Badge>
                          </button>
                        ))}
                      </div>
                    )
                    : <Badge tone="danger" icon={MapPin}>No site access</Badge>}
                {isOrgWideSites(editForm.sites)
                  ? <Btn size="xs" onClick={() => setEditForm(f => ({ ...f, sites: [] }))}>Restrict to specific sites</Btn>
                  : <Btn size="xs" onClick={() => setEditForm(f => ({ ...f, sites: ['ALL'] }))}>Grant all sites (org-wide)</Btn>}
              </div>
              {siteOptsLoading ? (
                <LoadingState label="Loading site list" rows={2} />
              ) : siteOptsError ? (
                <p className="text-[11px] text-red-400 py-1">Could not load the site list. You can still add sites by name below.</p>
              ) : siteOpts.length === 0 && (editForm.sites?.length ?? 0) === 0 ? (
                <p className="text-[11px] text-gray-500 py-1">No operational sites found yet. Add a site by name below.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900 divide-y divide-gray-800">
                  {[...new Set([...siteOpts, ...withoutOrgWide(editForm.sites)])].sort((a, b) => a.localeCompare(b)).map(s => {
                    const on = withoutOrgWide(editForm.sites).includes(s)
                    return (
                      <label key={s} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800/60 cursor-pointer">
                        <input type="checkbox" checked={!!on} onChange={() => toggleEditSite(s)}
                          className="accent-orange-500 w-3 h-3" />
                        <span className={on ? 'text-orange-200' : ''}>{s}</span>
                      </label>
                    )
                  })}
                </div>
              )}
              <div className="flex gap-1.5 mt-1.5">
                <input value={siteAdd} onChange={e => setSiteAdd(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFreeTextSite() } }}
                  placeholder="Add site by name"
                  className={`${INPUT} flex-1`} />
                <Btn icon={Plus} onClick={addFreeTextSite} disabled={!siteAdd.trim()}>Add</Btn>
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">No sites assigned means no site-scoped access. Use All sites for org-wide, or list specific sites. Enforced by the database.</p>
            </Field>
          </div>
        )}
      </Modal>

      {/* Bulk role modal */}
      <Modal open={bulkModal === 'role'} width="max-w-md" title={`Set role for ${selected.size} users`}
        onClose={() => { if (!bulkBusy) setBulkModal(null) }}
        footer={(
          <>
            <Btn onClick={() => setBulkModal(null)} disabled={bulkBusy}>Cancel</Btn>
            <Btn variant="primary" icon={UserCog} onClick={runBulkRole} busy={bulkBusy}>{bulkBusy ? 'Applying...' : 'Apply'}</Btn>
          </>
        )}>
        <div className="space-y-3">
          <ErrorState message={bulkError} />
          <Field label="New role">
            <Select value={bulkRole} onChange={setBulkRole} options={roles.map(r => ({ value: r, label: r }))} />
          </Field>
          <p className="text-[11px] text-gray-500">Super admins are never demoted and the last admin is protected, so the applied count may be lower than selected.</p>
        </div>
      </Modal>

      {/* Bulk grant modal */}
      <Modal open={bulkModal === 'grant'} width="max-w-md" title={`Grant or revoke for ${selected.size} users`}
        onClose={() => { if (!bulkBusy) setBulkModal(null) }}
        footer={(
          <>
            <Btn onClick={() => setBulkModal(null)} disabled={bulkBusy}>Cancel</Btn>
            <Btn variant="primary" icon={ShieldCheck} onClick={runBulkGrant} busy={bulkBusy}>{bulkBusy ? 'Applying...' : 'Apply'}</Btn>
          </>
        )}>
        <div className="space-y-3">
          <ErrorState message={bulkError} />
          <Field label="Module">
            <Select value={bulkModule} onChange={setBulkModule} options={ALL_MODULES.map(m => ({ value: m.key, label: m.label }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Capability">
              <Select value={bulkCapability} onChange={setBulkCapability}
                options={CAPABILITIES.filter(c => c.key !== 'delete').map(c => ({ value: c.key, label: c.label }))} />
            </Field>
            <Field label="Effect">
              <Select value={bulkEffect} onChange={setBulkEffect}
                options={[{ value: 'grant', label: 'Grant' }, { value: 'revoke', label: 'Revoke' }]} />
            </Field>
          </div>
          <Field label="Expiry (optional)">
            <input type="date" value={bulkExpiry} onChange={e => setBulkExpiry(e.target.value)} className={INPUT} />
          </Field>
          <Note>
            {bulkEffect === 'grant' ? 'Grant' : 'Revoke'} <Code>{bulkCapability}</Code> on <Code>{moduleLabel(bulkModule)}</Code> for {selected.size} users. Only view is enforced today; other capabilities are stored.
          </Note>
        </div>
      </Modal>

      {/* Password reset modal */}
      <Modal open={!!resetModal} width="max-w-md" title="Reset password" subtitle={resetModal?.email}
        onClose={() => { setResetModal(null); setNewPassword(''); setResetError(''); setResetSent(false) }}
        footer={resetModal && (
          <>
            <Btn onClick={() => { setResetModal(null); setNewPassword(''); setResetError(''); setResetSent(false) }}>
              {resetSent ? 'Close' : 'Cancel'}
            </Btn>
            {!resetSent && (canEmailReset(resetModal.email) ? (
              <Btn variant="primary" icon={Key} onClick={() => sendPasswordReset(resetModal)}>Send reset email</Btn>
            ) : (
              <Btn variant="primary" icon={Key} onClick={() => setPasswordDirect(resetModal)}
                busy={resetBusy} disabled={newPassword.trim().length < 8}>
                {resetBusy ? 'Setting' : 'Set password'}
              </Btn>
            ))}
          </>
        )}>
        {resetModal && (
          <div className="space-y-3">
            {/* A field worker's address is synthetic and receives no mail, so a
                reset link is a guaranteed dead end. Setting the password is the
                only thing that restores access for them. */}
            {resetSent ? (
              <Note icon={CheckCircle} tone="accent">
                {canEmailReset(resetModal.email)
                  ? 'Password reset email sent.'
                  : <>Password set. Give it to {resetModal.full_name ?? 'them'} in person or by phone.
                      They can sign in with it straight away. Their other devices have been
                      signed out.</>}
              </Note>
            ) : canEmailReset(resetModal.email) ? (
              <p className="text-xs text-gray-400">
                Send a password reset link to <strong className="text-gray-100">{resetModal.full_name ?? resetModal.email}</strong>.
                The user will receive an email with a secure link to set a new password.
              </p>
            ) : (
              <>
                <Note icon={AlertTriangle} tone="warning">
                  This account signs in with a username, and its address
                  (<span className="font-medium">{resetModal.email}</span>) cannot receive
                  email. A reset link would never arrive, so set the password here instead.
                </Note>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">New password</span>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setResetError('') }}
                    autoComplete="off"
                    placeholder="At least 8 characters"
                    className={`${INPUT} mt-1`}
                  />
                  {/* Shown, not hidden: the admin has to read it out to the person. */}
                  <span className="mt-1 block text-[11px] text-gray-500">
                    Shown so you can pass it on. Ask them to change it once they are back in.
                  </span>
                </label>
              </>
            )}
            {resetError && <p className="text-[11px] text-amber-400">{resetError}</p>}
          </div>
        )}
      </Modal>

      {/* Block web login confirm modal */}
      <Modal open={!!webModal} width="max-w-md" title="Block web login" subtitle={webModal?.email}
        onClose={() => { if (!webBusy) setWebModal(null) }}
        footer={webModal && (
          <>
            <Btn onClick={() => setWebModal(null)} disabled={webBusy}>Cancel</Btn>
            <Btn variant="primary" icon={Smartphone} onClick={() => applyWeb(webModal, false)} busy={webBusy}>
              {webBusy ? 'Applying...' : 'Block web login'}
            </Btn>
          </>
        )}>
        <div className="space-y-3">
          <ErrorState message={webError} />
          <p className="text-xs text-gray-400">
            This account will be set to mobile app only. The user will not be able to sign in to the web
            app and will be asked to use the mobile app instead. Mobile access is not affected. You can
            re-enable web login at any time.
          </p>
        </div>
      </Modal>

      {/* Success toast */}
      {toast && (
        <div role="status" className="fixed bottom-6 right-6 z-[60] shadow-2xl">
          <Note icon={CheckCircle} tone="accent">{toast}</Note>
        </div>
      )}
    </div>
  )
}

const INPUT = 'w-full h-9 bg-gray-900 border border-gray-800 rounded-lg px-3 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-700'

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button role="menuitem" onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-800 transition-colors ${danger ? 'text-red-400' : 'text-gray-300'}`}>
      <Icon size={12} />
      {label}
    </button>
  )
}

function Field({ label, children }) {
  return <div><label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</label>{children}</div>
}
