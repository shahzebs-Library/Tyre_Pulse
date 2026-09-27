/**
 * CustomRolesManager — self-service role builder (Master Access Control → Custom
 * Roles tab). An Admin creates a named role, ticks the modules it may access,
 * and it immediately becomes assignable to users (User Management) and enforced
 * by the existing permission engine. Renaming is intentionally unavailable —
 * module grants and users' role are keyed by the name string.
 *
 * Lifecycle hardening: assigned-user counts per role, delete blocked while
 * users are still assigned, clone/start-from prefill, activate/deactivate,
 * success feedback and Escape-to-close modals.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  UserCog, Plus, Pencil, Trash2, X, Check, AlertTriangle, Search, Loader2,
  KeyRound, Info, Copy, Users, Power, CheckCircle2, FileSpreadsheet, FileText, RotateCcw, Layers,
} from 'lucide-react'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import {
  enrichRoles, filterRoles, roleKpis, coveragePct, roleExport, ROLE_SORTS,
} from '../lib/customRolesManagerAnalytics'
import { useAuth } from '../contexts/AuthContext'
import { buildNavModuleCatalog, ACCESS_ROLES } from '../lib/moduleCatalog'
import { NAV_CATALOG } from '../components/Layout'
import { toUserMessage } from '../lib/safeError'
import {
  listCustomRoles, createCustomRole, updateCustomRole, deleteCustomRole,
  getRoleModules, setRoleModules, isBuiltInRole, countUsersByRole, duplicateName,
  cloneRoleCapabilities,
} from '../lib/api/customRoles'
import { probeRelation } from '../lib/api/_client'

const EMPTY = { name: '', description: '', moduleKeys: [] }

// The FULL navigable module catalog (all ~163 modules), grouped by nav group for
// the picker, so a custom role can be granted access to ANY page - not only the
// curated 37 base modules. Keys are the exact NAV_MODULE_KEY / route-slug values
// the sidebar gates on (see navAccess.navItemAllowedForCustomRole), so a ticked
// module actually reveals its page for the role. Computed once at module load.
const CUSTOM_ROLE_GROUPS = (() => {
  const order = []
  const byCat = new Map()
  for (const m of buildNavModuleCatalog(NAV_CATALOG)) {
    const cat = m.category || 'Other'
    if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat) }
    byCat.get(cat).push({ key: m.module_id, label: m.name })
  }
  return order.map((cat) => ({ group: cat, modules: byCat.get(cat) }))
})()
const CATALOG_SIZE = CUSTOM_ROLE_GROUPS.reduce((n, g) => n + g.modules.length, 0)

function ModulePicker({ selected, onToggle, search, groups = CUSTOM_ROLE_GROUPS }) {
  const q = search.trim().toLowerCase()
  return (
    <div className="max-h-[46vh] overflow-y-auto pr-1 space-y-4">
      {groups.map((g) => {
        const mods = g.modules.filter((m) => !q || m.label.toLowerCase().includes(q) || m.key.includes(q))
        if (!mods.length) return null
        const allOn = mods.every((m) => selected.includes(m.key))
        return (
          <div key={g.group}>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{g.group}</p>
              <button
                type="button"
                onClick={() => onToggle(mods.map((m) => m.key), !allOn)}
                className="text-xs text-[var(--brand-bright)] hover:underline min-h-[32px] px-1"
              >{allOn ? 'Clear group' : 'Select group'}</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {mods.map((m) => {
                const on = selected.includes(m.key)
                return (
                  <label key={m.key} className={`flex items-center gap-2 px-2.5 py-2 min-h-[40px] rounded-lg border cursor-pointer text-sm ${on ? 'border-indigo-500/40 bg-indigo-500/10 text-[var(--text-primary)]' : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'}`}>
                    <input type="checkbox" className="accent-indigo-500 w-4 h-4" checked={on} onChange={() => onToggle([m.key], !on)} />
                    <span className="truncate">{m.label}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function CustomRolesManager() {
  const { profile, isSuperAdmin } = useAuth()
  const isAdmin = profile?.role === 'Admin' || isSuperAdmin === true

  const [roles, setRoles] = useState(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [modSearch, setModSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [togglingId, setTogglingId] = useState(null)

  // Register controls.
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [assignFilter, setAssignFilter] = useState('')
  const [sortKey, setSortKey] = useState('name')

  // Clone / "Start from" state (create modal only).
  const [startFrom, setStartFrom] = useState('')
  const [prefillLoading, setPrefillLoading] = useState(false)
  const prefillToken = useRef(0)

  // Assigned users per role name; a missing key means the count is unknown.
  const [userCounts, setUserCounts] = useState({})
  // Live count for the role in the delete confirm: number | 'loading' | null (unknown).
  const [deleteCount, setDeleteCount] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setLoadError(''); setNotProvisioned(false)
    try {
      const data = await listCustomRoles()
      const list = Array.isArray(data) ? data : []
      setRoles(list)
      // `listCustomRoles` DEGRADES a missing table to [] rather than throwing,
      // so the catch below could NEVER see one, and the inline message-text test
      // that used to live there was doubly dead (unwrap sanitises err.message).
      // Probe only when the list is empty, and believe only a DEFINITE answer:
      // an unknown result must not render "apply the migration".
      if (list.length === 0) {
        const { exists, checked } = await probeRelation('custom_roles')
        setNotProvisioned(checked && !exists)
      } else {
        setNotProvisioned(false)
      }
    } catch (err) {
      // A real failure only. The missing-table case is handled above by the
      // probe, because the service never lets it reach here. The list stays
      // null (unknown) so a failed read is never shown as "no roles".
      setLoadError(toUserMessage(err, 'Could not load custom roles.'))
      setRoles(null)
    } finally { setRefreshing(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const [moduleCounts, setModuleCounts] = useState({})
  // Lazily load each role's module count (from the permission engine) for display.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!roles?.length) return
      const entries = await Promise.all(roles.map(async (r) => {
        try { return [r.name, (await getRoleModules(r.name)).length] } catch { return [r.name, null] }
      }))
      if (!cancelled) setModuleCounts(Object.fromEntries(entries))
    })()
    return () => { cancelled = true }
  }, [roles])

  // Assigned-user counts (RLS-scoped; {} on failure means every count is unknown).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!roles?.length) { setUserCounts({}); return }
      const counts = await countUsersByRole(roles.map((r) => r.name))
      if (!cancelled) setUserCounts(counts)
    })()
    return () => { cancelled = true }
  }, [roles])

  // Fresh live count each time the delete confirm opens (never trust a stale list).
  useEffect(() => {
    if (!confirmDelete) { setDeleteCount(null); return undefined }
    let cancelled = false
    setDeleteCount('loading')
    ;(async () => {
      const counts = await countUsersByRole([confirmDelete.name])
      if (!cancelled) {
        setDeleteCount(typeof counts[confirmDelete.name] === 'number' ? counts[confirmDelete.name] : null)
      }
    })()
    return () => { cancelled = true }
  }, [confirmDelete])

  // Success notice auto-dismisses.
  useEffect(() => {
    if (!notice) return undefined
    const t = setTimeout(() => setNotice(''), 8000)
    return () => clearTimeout(t)
  }, [notice])

  const openCreate = () => {
    setEditing(null); setForm(EMPTY); setModSearch(''); setFormError('')
    setStartFrom(''); setPrefillLoading(false); setShowModal(true)
  }
  const openEdit = async (r) => {
    setEditing(r)
    setForm({ name: r.name, description: r.description || '', moduleKeys: [] })
    setModSearch(''); setFormError(''); setStartFrom(''); setShowModal(true)
    try {
      const mods = await getRoleModules(r.name)
      setForm((f) => ({ ...f, moduleKeys: mods }))
    } catch { /* keep empty */ }
  }
  const closeModal = useCallback(() => {
    if (!saving) { setShowModal(false); setEditing(null); setStartFrom(''); setPrefillLoading(false) }
  }, [saving])

  // Prefill the create form's modules from another role (built-in or custom).
  const prefillFrom = useCallback(async (sourceRole) => {
    const token = ++prefillToken.current
    setPrefillLoading(true)
    try {
      const mods = await getRoleModules(sourceRole)
      if (prefillToken.current === token) setForm((f) => ({ ...f, moduleKeys: mods }))
    } catch {
      if (prefillToken.current === token) {
        setFormError(`Could not load the modules of "${sourceRole}". Pick the modules manually.`)
      }
    } finally {
      if (prefillToken.current === token) setPrefillLoading(false)
    }
  }, [])

  const onStartFromChange = (value) => {
    setStartFrom(value); setFormError('')
    if (value) prefillFrom(value)
    else setForm((f) => ({ ...f, moduleKeys: [] }))
  }

  // Per-row Duplicate: create modal prefilled with that role's modules + "<name> copy".
  const openDuplicate = (r) => {
    setEditing(null)
    setForm({
      name: duplicateName(r.name, (roles || []).map((x) => x.name)),
      description: r.description || '',
      moduleKeys: [],
    })
    setModSearch(''); setFormError(''); setStartFrom(r.name); setShowModal(true)
    prefillFrom(r.name)
  }

  const toggleModules = (keys, on) => setForm((f) => {
    const set = new Set(f.moduleKeys)
    keys.forEach((k) => (on ? set.add(k) : set.delete(k)))
    return { ...f, moduleKeys: [...set] }
  })

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    const name = form.name.trim()
    if (!name) { setFormError('A role name is required.'); return }
    if (!editing && isBuiltInRole(name)) { setFormError(`"${name}" is a built-in role. Choose another name.`); return }
    setSaving(true)
    try {
      if (editing) {
        await updateCustomRole(editing.id, { description: form.description })
        await setRoleModules(editing.name, form.moduleKeys)
      } else {
        await createCustomRole({ name, description: form.description, moduleKeys: form.moduleKeys })
        if (startFrom) await cloneRoleCapabilities(startFrom, name)
      }
      setShowModal(false); setEditing(null); setStartFrom('')
      setNotice(`Role "${name}" is ready. Access applies to signed-in users immediately, no re-login needed.`)
      await load()
    } catch (err) {
      const msg = String(err?.message || '')
      setFormError(/duplicate|unique/i.test(msg) ? 'A role with that name already exists.' : toUserMessage(err, 'Could not save the role.'))
    } finally { setSaving(false) }
  }, [form, editing, startFrom, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    if (typeof deleteCount === 'number' && deleteCount > 0) return // guarded in UI too
    setDeleting(true)
    try {
      await deleteCustomRole(confirmDelete.id, confirmDelete.name)
      setNotice(`Role "${confirmDelete.name}" was deleted and its module grants revoked.`)
      setConfirmDelete(null)
      await load()
    } catch (err) { setError(toUserMessage(err, 'Could not delete the role.')) }
    finally { setDeleting(false) }
  }, [confirmDelete, deleteCount, load])

  const toggleActive = useCallback(async (r) => {
    setTogglingId(r.id); setError('')
    try {
      await updateCustomRole(r.id, { active: r.active === false })
      await load()
    } catch (err) { setError(toUserMessage(err, 'Could not update the role.')) }
    finally { setTogglingId(null) }
  }, [load])

  // Escape closes the open modal (create/edit first, then delete confirm).
  useEffect(() => {
    if (!showModal && !confirmDelete) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (showModal && !saving) closeModal()
      else if (confirmDelete && !deleting) setConfirmDelete(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showModal, confirmDelete, saving, deleting, closeModal])

  const totalModulesSelected = form.moduleKeys.length
  const customRoleNames = (roles || []).map((r) => r.name)
  const enriched = useMemo(() => enrichRoles(roles || [], moduleCounts, userCounts), [roles, moduleCounts, userCounts])
  const kpi = useMemo(() => roleKpis(enriched, CATALOG_SIZE), [enriched])
  const visibleRoles = useMemo(
    () => filterRoles(enriched, { search, status: statusFilter, assignment: assignFilter, sort: sortKey }),
    [enriched, search, statusFilter, assignFilter, sortKey],
  )
  // Sorted across the WHOLE filtered set (consoleTable rules) and then paged.
  const rolesPager = usePagedRows(visibleRoles)
  const deleteBlocked = typeof deleteCount === 'number' && deleteCount > 0
  const hasFilters = !!(search || statusFilter || assignFilter)
  const clearFilters = () => { setSearch(''); setStatusFilter(''); setAssignFilter('') }

  const doExport = async (format) => {
    const shaped = roleExport(visibleRoles)
    const file = reportFileName('Custom Roles')
    try {
      if (format === 'pdf') await exportToPdf(shaped.rows, shaped.keys.map((k, i) => ({ key: k, header: shaped.headers[i] })), 'Custom Roles', file, 'landscape')
      else await exportToExcel(shaped.rows, shaped.keys, shaped.headers, file)
    } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const iconBtn = 'min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)]'
  const columns = [
    {
      id: 'role', header: 'Role', accessorFn: (r) => r.name, size: 220,
      cell: ({ row }) => {
        const r = row.original
        return (
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)] flex-wrap">
            <KeyRound size={13} className="text-indigo-300" aria-hidden="true" /> {r.name}
            {!r._active && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-[var(--input-border)] text-[var(--text-muted)]">Inactive</span>}
          </span>
        )
      },
    },
    { id: 'description', header: 'Description', accessorFn: (r) => r.description || '', size: 260, cell: ({ row }) => <span className="block max-w-md truncate text-[var(--text-secondary)]" title={row.original.description || ''}>{row.original.description || <span className="text-[var(--text-muted)]">N/A</span>}</span> },
    {
      id: 'modules', header: 'Modules', accessorFn: (r) => r._modules, size: 150,
      cell: ({ row }) => {
        const m = row.original._modules
        if (m == null) return <span className="text-[var(--text-muted)]">N/A</span>
        const pct = coveragePct(m, CATALOG_SIZE)
        return (
          <span className="text-[var(--text-secondary)]">
            <span className="text-[var(--text-primary)] font-semibold">{m}</span> module{m === 1 ? '' : 's'}
            {pct != null && <span className="block text-[11px] text-[var(--text-muted)]">{pct}% of the catalog</span>}
          </span>
        )
      },
    },
    {
      id: 'users', header: 'Assigned users', accessorFn: (r) => r._users, size: 140,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
          <Users size={13} className="text-[var(--text-muted)]" aria-hidden="true" />
          {row.original._users != null
            ? <span><span className="text-[var(--text-primary)] font-semibold">{row.original._users}</span> user{row.original._users === 1 ? '' : 's'}</span>
            : 'N/A'}
        </span>
      ),
    },
    {
      id: 'actions', header: '', size: 200,
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => openEdit(r)} className={`${iconBtn} text-[var(--text-muted)] hover:text-[var(--text-primary)]`} aria-label={`Edit ${r.name}`} title="Edit"><Pencil size={15} /></button>
            <button onClick={() => openDuplicate(r)} className={`${iconBtn} text-[var(--text-muted)] hover:text-[var(--text-primary)]`} aria-label={`Duplicate ${r.name}`} title="Duplicate"><Copy size={15} /></button>
            <button
              onClick={() => toggleActive(r)}
              disabled={togglingId === r.id}
              className={`${iconBtn} disabled:opacity-50 ${!r._active ? 'text-[var(--text-muted)] hover:text-emerald-400' : 'text-emerald-400 hover:text-amber-400'}`}
              aria-label={!r._active ? `Activate ${r.name}` : `Deactivate ${r.name}`}
              aria-pressed={r._active}
              title={!r._active ? 'Activate' : 'Deactivate'}
            >
              {togglingId === r.id ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
            </button>
            <button onClick={() => setConfirmDelete(r)} className={`${iconBtn} hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400`} aria-label={`Delete ${r.name}`} title="Delete"><Trash2 size={15} /></button>
          </div>
        )
      },
    },
  ]

  const kpis = [
    { label: 'Custom roles', value: kpi.total, icon: KeyRound, sub: `${kpi.active} active, ${kpi.inactive} inactive`, onClick: () => setStatusFilter(''), active: false },
    { label: 'Inactive roles', value: kpi.inactive, icon: Power, sub: 'Kept but not assignable', onClick: () => setStatusFilter('inactive'), active: statusFilter === 'inactive' },
    { label: 'Assigned users', value: kpi.assignedUsers ?? 'N/A', icon: Users, sub: kpi.usersKnownFor < kpi.total ? `Counted for ${kpi.usersKnownFor} of ${kpi.total} roles` : 'Across all custom roles' },
    { label: 'Unassigned roles', value: kpi.unassignedRoles, icon: UserCog, sub: 'No user holds these yet', onClick: () => setAssignFilter('unassigned'), active: assignFilter === 'unassigned' },
    { label: 'Avg modules per role', value: kpi.avgModules ?? 'N/A', icon: Layers, sub: `Catalog has ${CATALOG_SIZE} modules${kpi.emptyRoles ? `, ${kpi.emptyRoles} role${kpi.emptyRoles === 1 ? '' : 's'} with none` : ''}` },
  ]

  if (!isAdmin) {
    return (
      <div className="card flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-[var(--text-primary)] font-medium">Admin only</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">Custom roles can only be created and managed by an Admin.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
          <p className="text-xs text-[var(--text-muted)] max-w-2xl">
            Create your own roles and tick which modules each can access. New roles appear in User
            Management so you can assign them to people. Access is enforced immediately by the same
            engine as the built-in roles. Built-in roles are edited in the <span className="text-[var(--text-secondary)]">Role Permissions</span> tab.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!visibleRoles.length}><FileSpreadsheet size={14} /> Excel</button>
          <button onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!visibleRoles.length}><FileText size={14} /> PDF</button>
          <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
            <Plus size={14} /> New role
          </button>
        </div>
      </div>

      {notice && (
        <div role="status" className="card border border-emerald-800/50 flex items-start gap-3">
          <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[var(--text-secondary)] text-sm flex-1">{notice}</p>
          <button onClick={() => setNotice('')} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss"><X size={15} /></button>
        </div>
      )}
      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Custom roles are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V211_CUSTOM_ROLES.sql</span>, then reload.</p>
          </div>
        </div>
      )}
      {loadError && (
        <div role="alert" className="card border border-red-800/50 flex flex-wrap items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]"><p className="text-red-300 font-medium">Custom roles could not be loaded.</p><p className="text-[var(--text-muted)] text-sm mt-1">{loadError}</p></div>
          <button onClick={load} disabled={refreshing} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RotateCcw size={14} /> Retry</button>
        </div>
      )}
      {error && (
        <div role="alert" className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1"><p className="text-red-300 font-medium">That action did not complete.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button onClick={() => setError('')} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {roles !== null && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {kpis.map((k) => {
            const Icon = k.icon
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                  <Icon size={15} className="text-indigo-300" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold mt-1 tabular-nums text-[var(--text-primary)]">{k.value}</p>
                {k.sub && <p className="text-[11px] text-[var(--text-muted)] mt-1">{k.sub}</p>}
              </>
            )
            return k.onClick ? (
              <button key={k.label} type="button" onClick={k.onClick} aria-pressed={!!k.active}
                className={`card text-left min-h-[44px] transition-colors hover:border-[var(--accent)] ${k.active ? 'ring-2 ring-[var(--accent)]' : ''}`}>{body}</button>
            ) : <div key={k.label} className="card">{body}</div>
          })}
        </div>
      )}

      {roles !== null && roles.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" aria-label="Search roles" placeholder="Search role name or description" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="input min-h-[44px]" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select className="input min-h-[44px]" aria-label="Assignment" value={assignFilter} onChange={(e) => setAssignFilter(e.target.value)}>
              <option value="">Any assignment</option>
              <option value="assigned">Has users</option>
              <option value="unassigned">No users</option>
              <option value="unknown">Count unavailable</option>
            </select>
            <select className="input min-h-[44px]" aria-label="Sort by" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              {Object.entries(ROLE_SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear</button>}
            <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{visibleRoles.length} of {kpi.total}</span>
          </div>
        </div>
      )}

      {!loadError && (
        <div className="space-y-2">
          <EnterpriseTable
            columns={columns}
            data={rolesPager.pageRows}
            getRowId={(r) => String(r.id)}
            loading={roles === null}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableSorting={false}
            enableExport={false}
            virtual
            maxHeight={620}
            emptyMessage={hasFilters ? 'No roles match these filters.' : notProvisioned ? 'Apply the custom roles migration to start building roles.' : 'No custom roles yet. Create your first one with New role.'}
          />
          <TablePagination {...rolesPager} />
        </div>
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? `Edit role: ${editing.name}` : 'New custom role'}</h3>
              <button onClick={closeModal} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cr-f1" className="label">Role name</label>
                  <input id="cr-f1" className="input w-full disabled:opacity-60" placeholder="e.g. Data Monitor Officer" value={form.name} maxLength={60} disabled={!!editing} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                  {editing && <p className="text-[11px] text-[var(--text-muted)] mt-1">Name cannot change (users and grants reference it).</p>}
                </div>
                <div>
                  <label htmlFor="cr-f2" className="label">Description (optional)</label>
                  <input id="cr-f2" className="input w-full" placeholder="What this role is for" value={form.description} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </div>
              </div>

              {!editing && (
                <div>
                  <label className="label">Start from <span className="text-[var(--text-muted)] font-normal">(optional, copies that role's module access)</span></label>
                  <div className="flex items-center gap-2">
                    <select aria-label="Start from role" className="input w-full sm:max-w-xs min-h-[44px]" value={startFrom} onChange={(e) => onStartFromChange(e.target.value)} disabled={prefillLoading}>
                      <option value="">Blank (pick modules below)</option>
                      <optgroup label="Built-in roles">
                        {ACCESS_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </optgroup>
                      {customRoleNames.length > 0 && (
                        <optgroup label="Custom roles">
                          {customRoleNames.map((n) => <option key={n} value={n}>{n}</option>)}
                        </optgroup>
                      )}
                    </select>
                    {prefillLoading && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] shrink-0">
                        <Loader2 size={13} className="animate-spin" /> Loading modules
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Module access <span className="text-[var(--text-muted)] font-normal">({totalModulesSelected} selected)</span></label>
                  <div className="relative w-48">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input className="input pl-8 py-1 text-xs w-full" aria-label="Filter modules" placeholder="Filter modules" value={modSearch} onChange={(e) => setModSearch(e.target.value)} />
                  </div>
                </div>
                <ModulePicker selected={form.moduleKeys} onToggle={toggleModules} search={modSearch} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving || prefillLoading}>
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving</> : <><Check size={14} /> {editing ? 'Save role' : 'Create role'}</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div className="flex-1">
                <h3 className="text-[var(--text-primary)] font-semibold">Delete {confirmDelete.name}?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">Its module grants are revoked so no stale access lingers. This cannot be undone.</p>
                <div className="mt-3 text-sm text-[var(--text-secondary)] inline-flex items-center gap-1.5">
                  <Users size={14} className="text-[var(--text-muted)]" />
                  {deleteCount === 'loading' ? (
                    <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Checking assigned users</span>
                  ) : typeof deleteCount === 'number' ? (
                    <span>Assigned users: <span className="text-[var(--text-primary)] font-semibold">{deleteCount}</span></span>
                  ) : (
                    <span>Assigned users could not be verified right now.</span>
                  )}
                </div>
                {deleteBlocked && (
                  <div className="mt-3 flex items-start gap-2 text-sm text-amber-300 bg-amber-900/20 border border-amber-800/50 rounded-lg px-3 py-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <span>{deleteCount} user{deleteCount === 1 ? ' is' : 's are'} still assigned this role. Reassign these users to another role first (User Management), then delete.</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button
                onClick={doDelete}
                className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60"
                disabled={deleting || deleteBlocked || deleteCount === 'loading'}
              >
                <Trash2 size={14} /> {deleting ? 'Deleting' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
