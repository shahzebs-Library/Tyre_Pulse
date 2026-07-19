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
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  UserCog, Plus, Pencil, Trash2, X, Check, AlertTriangle, Search, Loader2,
  KeyRound, Info, Copy, Users, Power, CheckCircle2,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { buildNavModuleCatalog, ACCESS_ROLES } from '../lib/moduleCatalog'
import { NAV_CATALOG } from '../components/Layout'
import { toUserMessage } from '../lib/safeError'
import {
  listCustomRoles, createCustomRole, updateCustomRole, deleteCustomRole,
  getRoleModules, setRoleModules, isBuiltInRole, countUsersByRole, duplicateName,
} from '../lib/api/customRoles'

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
                className="text-[11px] text-[var(--brand-bright)] hover:underline"
              >{allOn ? 'Clear group' : 'Select group'}</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {mods.map((m) => {
                const on = selected.includes(m.key)
                return (
                  <label key={m.key} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-sm ${on ? 'border-indigo-500/40 bg-indigo-500/10 text-[var(--text-primary)]' : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'}`}>
                    <input type="checkbox" className="accent-indigo-500" checked={on} onChange={() => onToggle([m.key], !on)} />
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

  // Clone / "Start from" state (create modal only).
  const [startFrom, setStartFrom] = useState('')
  const [prefillLoading, setPrefillLoading] = useState(false)
  const prefillToken = useRef(0)

  // Assigned users per role name; a missing key means the count is unknown.
  const [userCounts, setUserCounts] = useState({})
  // Live count for the role in the delete confirm: number | 'loading' | null (unknown).
  const [deleteCount, setDeleteCount] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listCustomRoles()
      setRoles(Array.isArray(data) ? data : [])
    } catch (err) {
      const msg = String(err?.message || '')
      if (/does not exist|schema cache|could not find the table/i.test(msg)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load custom roles.'))
      setRoles([])
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
    if (!editing && isBuiltInRole(name)) { setFormError(`"${name}" is a built-in role — choose another name.`); return }
    setSaving(true)
    try {
      if (editing) {
        await updateCustomRole(editing.id, { description: form.description })
        await setRoleModules(editing.name, form.moduleKeys)
      } else {
        await createCustomRole({ name, description: form.description, moduleKeys: form.moduleKeys })
      }
      setShowModal(false); setEditing(null); setStartFrom('')
      setNotice(`Role "${name}" is ready. Access applies to signed-in users immediately, no re-login needed.`)
      await load()
    } catch (err) {
      const msg = String(err?.message || '')
      setFormError(/duplicate|unique/i.test(msg) ? 'A role with that name already exists.' : toUserMessage(err, 'Could not save the role.'))
    } finally { setSaving(false) }
  }, [form, editing, load])

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
  const deleteBlocked = typeof deleteCount === 'number' && deleteCount > 0

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
            Management so you can assign them to people — access is enforced immediately by the same
            engine as the built-in roles. Built-in roles are edited in the <span className="text-[var(--text-secondary)]">Role Permissions</span> tab.
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 shrink-0" disabled={notProvisioned}>
          <Plus size={14} /> New role
        </button>
      </div>

      {notice && (
        <div className="card border border-emerald-800/50 flex items-start gap-3">
          <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" />
          <p className="text-emerald-300 text-sm flex-1">{notice}</p>
          <button onClick={() => setNotice('')} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss"><X size={15} /></button>
        </div>
      )}
      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Custom roles aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V211_CUSTOM_ROLES.sql</span>, then reload.</p>
          </div>
        </div>
      )}
      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Something went wrong.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Role', 'Description', 'Modules', 'Assigned users', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {roles === null ? (
                [0, 1, 2].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : roles.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <UserCog size={26} className="mx-auto mb-2 opacity-60" />
                  {notProvisioned ? 'Enable the module to start building roles.' : 'No custom roles yet — create your first one.'}
                </td></tr>
              ) : roles.map((r) => (
                <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                      <KeyRound size={13} className="text-indigo-300" /> {r.name}
                    </span>
                    {r.active === false && <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">inactive</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-md truncate">{r.description || <span className="text-[var(--text-muted)]">N/A</span>}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                    {moduleCounts[r.name] == null ? 'N/A' : <span><span className="text-[var(--text-primary)] font-semibold">{moduleCounts[r.name]}</span> module{moduleCounts[r.name] === 1 ? '' : 's'}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                    <span className="inline-flex items-center gap-1.5">
                      <Users size={13} className="text-[var(--text-muted)]" />
                      {typeof userCounts[r.name] === 'number'
                        ? <span><span className="text-[var(--text-primary)] font-semibold">{userCounts[r.name]}</span> user{userCounts[r.name] === 1 ? '' : 's'}</span>
                        : 'N/A'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit" title="Edit"><Pencil size={14} /></button>
                      <button onClick={() => openDuplicate(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Duplicate" title="Duplicate"><Copy size={14} /></button>
                      <button
                        onClick={() => toggleActive(r)}
                        disabled={togglingId === r.id}
                        className={`p-1.5 rounded hover:bg-[var(--input-bg)] disabled:opacity-50 ${r.active === false ? 'text-[var(--text-muted)] hover:text-emerald-400' : 'text-emerald-400 hover:text-amber-400'}`}
                        aria-label={r.active === false ? 'Activate' : 'Deactivate'}
                        title={r.active === false ? 'Activate' : 'Deactivate'}
                      >
                        {togglingId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                      </button>
                      <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete" title="Delete"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? `Edit role — ${editing.name}` : 'New custom role'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Role name</label>
                  <input className="input w-full disabled:opacity-60" placeholder="e.g. Data Monitor Officer" value={form.name} maxLength={60} disabled={!!editing} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                  {editing && <p className="text-[11px] text-[var(--text-muted)] mt-1">Name can’t change (users and grants reference it).</p>}
                </div>
                <div>
                  <label className="label">Description (optional)</label>
                  <input className="input w-full" placeholder="What this role is for" value={form.description} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </div>
              </div>

              {!editing && (
                <div>
                  <label className="label">Start from <span className="text-[var(--text-muted)] font-normal">(optional, copies that role's module access)</span></label>
                  <div className="flex items-center gap-2">
                    <select className="input w-full sm:max-w-xs" value={startFrom} onChange={(e) => onStartFromChange(e.target.value)} disabled={prefillLoading}>
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
                        <Loader2 size={13} className="animate-spin" /> Loading modules…
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
                    <input className="input pl-8 py-1 text-xs w-full" placeholder="Filter modules…" value={modSearch} onChange={(e) => setModSearch(e.target.value)} />
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
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Check size={14} /> {editing ? 'Save role' : 'Create role'}</>}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete “{confirmDelete.name}”?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">Its module grants are revoked so no stale access lingers. This can’t be undone.</p>
                <div className="mt-3 text-sm text-[var(--text-secondary)] inline-flex items-center gap-1.5">
                  <Users size={14} className="text-[var(--text-muted)]" />
                  {deleteCount === 'loading' ? (
                    <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Checking assigned users…</span>
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
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
