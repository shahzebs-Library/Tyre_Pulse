/**
 * OrgHierarchy (route /org-hierarchy) — Organization Hierarchy (Enterprise §3,
 * Phase 1). Models an organisation's internal structure as a governed tree:
 * company → country → region → branch → project → site → workshop →
 * department → team. Purely additive — this module owns the new `org_units` and
 * `user_org_assignments` tables (V206) and does not touch any operational data.
 *
 * Real data, KPI tiles, an indented collapsible tree, create/edit modal with
 * cycle-guarded re-parenting, delete confirm, search + type filter, Excel/PDF
 * export, and loading/empty/error/not-provisioned states throughout. The tree,
 * descendant sets, depth, and KPI summary live in the pure `src/lib/orgUnits.js`
 * helpers so the hierarchy logic exists in exactly one place.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Network, Building2, Layers, Boxes, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, AlertTriangle,
  ChevronRight, ChevronDown, MapPin,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import {
  listUnits, createUnit, updateUnit, deleteUnit, UNIT_TYPES,
} from '../lib/api/orgUnits'
import { buildTree, descendantsOf, depthOf, summariseUnits } from '../lib/orgUnits'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  name: '', unit_type: '', parent_id: '', code: '',
  country: '', site_ref: '', sort_order: '', active: true, notes: '',
}

const TYPE_META = {
  company:    { label: 'Company',    cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  country:    { label: 'Country',    cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  region:     { label: 'Region',     cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  branch:     { label: 'Branch',     cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  project:    { label: 'Project',    cls: 'bg-teal-500/15 text-teal-300 border-teal-500/30' },
  site:       { label: 'Site',       cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  workshop:   { label: 'Workshop',   cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  department: { label: 'Department', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  team:       { label: 'Team',       cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

function TypeBadge({ type }) {
  const meta = TYPE_META[type]
  if (!meta) return <span className="text-[var(--text-muted)]">—</span>
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

/** Recursive tree row. Shows type badge + child count and supports collapse. */
function TreeNode({ node, depth, onEdit }) {
  const [open, setOpen] = useState(true)
  const u = node.unit
  const hasKids = node.children.length > 0

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 pr-2 rounded-lg hover:bg-[var(--input-bg)]/50 group"
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
      >
        {hasKids ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : (
          <span className="w-[19px] shrink-0" />
        )}
        <Network size={14} className="text-[var(--text-muted)] shrink-0" />
        <span className="font-medium text-[var(--text-primary)] truncate">{u.name}</span>
        {u.code && <span className="text-[11px] text-[var(--text-muted)] font-mono shrink-0">#{u.code}</span>}
        <TypeBadge type={u.unit_type} />
        {u.country && (
          <span className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1 shrink-0">
            <MapPin size={11} className="opacity-60" />{u.country}
          </span>
        )}
        {u.active === false && (
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] border border-[var(--input-border)] rounded px-1.5 py-0.5 shrink-0">Inactive</span>
        )}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {hasKids && (
            <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
              <span className="text-[var(--text-secondary)] font-semibold">{node.children.length}</span> child{node.children.length === 1 ? '' : 'ren'}
            </span>
          )}
          <button
            onClick={() => onEdit(u)}
            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Edit unit"
          >
            <Pencil size={13} />
          </button>
        </div>
      </div>
      {hasKids && open && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.unit.id} node={child} depth={depth + 1} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function OrgHierarchy() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [typeFilter, setTypeFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listUnits({})
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load organisation units.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseUnits(rows || []), [rows])
  const tree = useMemo(() => buildTree(rows || []), [rows])

  const nameById = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) m.set(String(r.id), r.name)
    return m
  }, [rows])

  // Valid parent options for the edit modal: exclude the unit itself and all of
  // its descendants (re-parenting under a descendant would create a cycle).
  const parentOptions = useMemo(() => {
    const all = (rows || []).map((r) => ({ id: String(r.id), name: r.name, type: r.unit_type }))
    if (!editing) return all
    const banned = new Set([String(editing.id), ...descendantsOf(rows || [], editing.id)])
    return all.filter((o) => !banned.has(o.id))
  }, [rows, editing])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (typeFilter && r.unit_type !== typeFilter) return false
      if (activeFilter === 'active' && r.active === false) return false
      if (activeFilter === 'inactive' && r.active !== false) return false
      if (q) {
        const hay = `${r.name || ''} ${r.code || ''} ${r.country || ''} ${r.site_ref || ''} ${r.unit_type || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, typeFilter, activeFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total units', value: summary.total, icon: Boxes, tone: 'text-[var(--text-primary)]' },
    { label: 'Active units', value: summary.active, icon: Building2, tone: 'text-emerald-400' },
    { label: 'Root units', value: summary.rootCount, icon: Network, tone: 'text-sky-400' },
    { label: 'Max depth', value: summary.maxDepth, icon: Layers, tone: 'text-violet-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['name', 'unit_type', 'parent', 'depth', 'code', 'country', 'site_ref', 'active', 'sort_order']
  const EXPORT_HEADERS = ['Unit', 'Type', 'Parent', 'Depth', 'Code', 'Country', 'Site ref', 'Active', 'Sort']
  const exportRows = filtered.map((r) => ({
    name: r.name || '',
    unit_type: TYPE_META[r.unit_type]?.label || r.unit_type || '',
    parent: r.parent_id ? (nameById.get(String(r.parent_id)) || '') : '',
    depth: depthOf(rows || [], r.id) ?? '',
    code: r.code || '',
    country: r.country || '',
    site_ref: r.site_ref || '',
    active: r.active === false ? 'No' : 'Yes',
    sort_order: r.sort_order ?? '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      name: r.name || '', unit_type: r.unit_type || '',
      parent_id: r.parent_id ? String(r.parent_id) : '',
      code: r.code || '', country: r.country || '', site_ref: r.site_ref || '',
      sort_order: r.sort_order ?? '', active: r.active !== false, notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.name.trim()) { setFormError('A unit name is required.'); return }
    if (!form.unit_type) { setFormError('A unit type is required.'); return }
    if (editing && form.parent_id && String(form.parent_id) === String(editing.id)) {
      setFormError('A unit cannot be its own parent.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        parent_id: form.parent_id || null,
        sort_order: form.sort_order === '' ? null : form.sort_order,
      }
      if (editing) await updateUnit(editing.id, payload, rows || [])
      else await createUnit(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the unit.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, rows, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteUnit(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the unit.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setTypeFilter(''); setActiveFilter(''); setSearch('') }
  const hasFilters = typeFilter || activeFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Hierarchy"
        subtitle="Model your internal structure — company, country, region, branch, project, site, workshop, department, and team — as a governed tree, and assign users to any level."
        icon={Network}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'org_hierarchy')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Organization Hierarchy', 'org_hierarchy', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New unit
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Organization Hierarchy isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V206_ORG_HIERARCHY.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load organisation units.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Hierarchy tree */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Network size={15} /> Organisation tree
          </h3>
          {rows !== null && rows.length > 0 && (
            <span className="text-xs text-[var(--text-muted)]">Depth {summary.maxDepth} · {summary.rootCount} root{summary.rootCount === 1 ? '' : 's'}</span>
          )}
        </div>
        {rows === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-8 bg-[var(--input-bg)] rounded animate-pulse" />)}
          </div>
        ) : tree.length === 0 ? (
          <div className="py-10 text-center text-[var(--text-muted)]">
            <Network size={26} className="mx-auto mb-2 opacity-60" />
            <p className="text-sm">{notProvisioned ? 'Enable the module to start building your hierarchy.' : 'No units yet — create a company or country to begin.'}</p>
          </div>
        ) : (
          <div className="-mx-1">
            {tree.map((node) => (
              <TreeNode key={node.unit.id} node={node} depth={0} onEdit={openEdit} />
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search unit, code, country, site ref…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Unit type">
            <option value="">All types</option>
            {UNIT_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t]?.label || t}</option>)}
          </select>
          <select className="input" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Unit', 'Type', 'Parent', 'Country', 'Site ref', 'Depth', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No units yet — create your first unit.' : 'No units match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[var(--text-primary)]">{r.name || '—'}</span>
                        {r.code && <span className="text-[11px] text-[var(--text-muted)] font-mono">#{r.code}</span>}
                        {r.active === false && <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">inactive</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><TypeBadge type={r.unit_type} /></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.parent_id ? (nameById.get(String(r.parent_id)) || <span className="text-[var(--text-muted)]">—</span>) : <span className="text-[var(--text-muted)]">root</span>}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.country ? <span className="inline-flex items-center gap-1"><MapPin size={12} className="opacity-60" />{r.country}</span> : '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] font-mono text-xs">{r.site_ref || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{depthOf(rows, r.id) ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit unit' : 'New organisation unit'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Unit name</label>
                  <input className="input w-full" placeholder="e.g. Eastern Region" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Type</label>
                  <select className="input w-full" value={form.unit_type} onChange={(e) => set('unit_type', e.target.value)}>
                    <option value="">— Select type —</option>
                    {UNIT_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t]?.label || t}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Parent unit (optional)</label>
                  <select className="input w-full" value={form.parent_id} onChange={(e) => set('parent_id', e.target.value)}>
                    <option value="">— None (top level) —</option>
                    {parentOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}{o.type ? ` · ${TYPE_META[o.type]?.label || o.type}` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Code (optional)</label>
                  <input className="input w-full" placeholder="e.g. ER-01" value={form.code} maxLength={60} onChange={(e) => set('code', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Country (optional)</label>
                  <input className="input w-full" placeholder="e.g. Saudi Arabia" value={form.country} maxLength={120} onChange={(e) => set('country', e.target.value)} />
                </div>
                <div>
                  <label className="label">Site ref (optional)</label>
                  <input className="input w-full" placeholder="e.g. SITE-204" value={form.site_ref} maxLength={200} onChange={(e) => set('site_ref', e.target.value)} />
                </div>
                <div>
                  <label className="label">Sort order (optional)</label>
                  <input className="input w-full" type="number" step="1" placeholder="0" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. covers all eastern-province depots" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" className="accent-indigo-500" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
                Active unit
              </label>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create unit'}
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
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this unit?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.name || 'Unit'}{confirmDelete.code ? ` · #${confirmDelete.code}` : ''}. Child units become root-level; their user assignments are removed. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
