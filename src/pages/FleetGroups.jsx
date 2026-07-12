/**
 * FleetGroups (route /fleet-groups) — Fleet Groups / Holding-Company Hierarchy.
 * Organises fleet assets into a governed corporate/operational tree: holding
 * companies, subsidiaries, divisions, depots, cost centres, and custom groups.
 * Assets roll up through the hierarchy, so cost, budget, and utilisation can be
 * reported at any node — a single depot, a division, or the whole holding.
 *
 * Runs on the new `fleet_groups` table (V189). Real data, KPI tiles, an indented
 * roll-up tree, create/edit modal, filters, search, delete confirm, Excel/PDF
 * export, and loading/empty/error/not-provisioned states throughout. The tree,
 * roll-up counts, depth, and KPI summary live in the pure `src/lib/fleetGroups.js`
 * helpers so the hierarchy logic exists in exactly one place.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Building2, Network, Layers, Boxes, Wallet, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, AlertTriangle,
  ChevronRight, ChevronDown, MapPin, User,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listFleetGroups, createFleetGroup, updateFleetGroup, deleteFleetGroup, GROUP_TYPES,
} from '../lib/api/fleetGroups'
import {
  buildHierarchy, rollupAssetCount, depthOf, summariseGroups,
} from '../lib/fleetGroups'
import { formatCurrencyCompact } from '../lib/formatters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  group_name: '', group_code: '', group_type: '', parent_group: '',
  manager: '', region: '', asset_count: '', budget: '', currency: '', active: true, notes: '',
}

const TYPE_META = {
  holding:     { label: 'Holding',     cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  subsidiary:  { label: 'Subsidiary',  cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  division:    { label: 'Division',    cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  depot:       { label: 'Depot',       cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  cost_center: { label: 'Cost Center', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  custom:      { label: 'Custom',      cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
}

const fmtInt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString())

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

/** Recursive tree row. Shows own + rolled-up asset counts and supports collapse. */
function TreeNode({ node, rows, depth, currency, onEdit }) {
  const [open, setOpen] = useState(true)
  const g = node.group
  const hasKids = node.children.length > 0
  const own = g.asset_count == null ? 0 : Number(g.asset_count) || 0
  const rolled = rollupAssetCount(rows, g.group_name)
  const budget = g.budget == null ? null : Number(g.budget) || 0

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
        <span className="font-medium text-[var(--text-primary)] truncate">{g.group_name}</span>
        {g.group_code && <span className="text-[11px] text-[var(--text-muted)] font-mono shrink-0">#{g.group_code}</span>}
        <TypeBadge type={g.group_type} />
        {g.active === false && (
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] border border-[var(--input-border)] rounded px-1.5 py-0.5 shrink-0">Inactive</span>
        )}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
            <span className="text-[var(--text-secondary)] font-semibold">{rolled.toLocaleString()}</span> assets
            {hasKids && own !== rolled && <span className="opacity-70"> ({own.toLocaleString()} own)</span>}
          </span>
          {budget != null && (
            <span className="text-xs text-amber-300/90 whitespace-nowrap hidden sm:inline">
              {formatCurrencyCompact(budget, g.currency || currency)}
            </span>
          )}
          <button
            onClick={() => onEdit(g)}
            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Edit group"
          >
            <Pencil size={13} />
          </button>
        </div>
      </div>
      {hasKids && open && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.group.id} node={child} rows={rows} depth={depth + 1} currency={currency} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FleetGroups() {
  const { activeCountry, activeCurrency } = useSettings()
  const currency = activeCurrency || 'SAR'
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
      const data = await listFleetGroups({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load fleet groups.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseGroups(rows || []), [rows])
  const tree = useMemo(() => buildHierarchy(rows || []), [rows])

  const parentOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.group_name).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (typeFilter && r.group_type !== typeFilter) return false
      if (activeFilter === 'active' && r.active === false) return false
      if (activeFilter === 'inactive' && r.active !== false) return false
      if (q) {
        const hay = `${r.group_name || ''} ${r.group_code || ''} ${r.manager || ''} ${r.region || ''} ${r.parent_group || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, typeFilter, activeFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total groups', value: summary.totalGroups, icon: Boxes, tone: 'text-[var(--text-primary)]' },
    { label: 'Active groups', value: summary.activeGroups, icon: Building2, tone: 'text-emerald-400' },
    { label: 'Root entities', value: summary.rootGroups, icon: Network, tone: 'text-sky-400' },
    { label: 'Assets grouped', value: summary.totalAssets.toLocaleString(), icon: Layers, tone: 'text-violet-400' },
    { label: 'Total budget', value: summary.totalBudget > 0 ? formatCurrencyCompact(summary.totalBudget, currency) : '—', icon: Wallet, tone: 'text-amber-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['group_name', 'group_code', 'group_type', 'parent_group', 'depth', 'manager', 'region', 'own_assets', 'rolled_assets', 'active', 'budget', 'currency']
  const EXPORT_HEADERS = ['Group', 'Code', 'Type', 'Parent', 'Depth', 'Manager', 'Region', 'Own assets', 'Rolled-up assets', 'Active', 'Budget', 'Currency']
  const exportRows = filtered.map((r) => ({
    group_name: r.group_name || '',
    group_code: r.group_code || '',
    group_type: TYPE_META[r.group_type]?.label || r.group_type || '',
    parent_group: r.parent_group || '',
    depth: depthOf(rows || [], r.group_name) ?? '',
    manager: r.manager || '',
    region: r.region || '',
    own_assets: r.asset_count ?? '',
    rolled_assets: rollupAssetCount(rows || [], r.group_name),
    active: r.active === false ? 'No' : 'Yes',
    budget: r.budget ?? '',
    currency: r.currency || currency,
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      group_name: r.group_name || '', group_code: r.group_code || '',
      group_type: r.group_type || '', parent_group: r.parent_group || '',
      manager: r.manager || '', region: r.region || '',
      asset_count: r.asset_count ?? '', budget: r.budget ?? '',
      currency: r.currency || '', active: r.active !== false, notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.group_name.trim()) { setFormError('A group name is required.'); return }
    if (form.parent_group && form.parent_group.trim() === form.group_name.trim()) {
      setFormError('A group cannot be its own parent.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        asset_count: form.asset_count === '' ? null : form.asset_count,
        budget: form.budget === '' ? null : form.budget,
        parent_group: form.parent_group || null,
        group_type: form.group_type || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateFleetGroup(editing.id, payload)
      else await createFleetGroup(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the group.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteFleetGroup(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the group.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setTypeFilter(''); setActiveFilter(''); setSearch('') }
  const hasFilters = typeFilter || activeFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Groups"
        subtitle="Model your holding-company hierarchy — subsidiaries, divisions, depots, and cost centres — and roll up assets, budget, and utilisation across every level."
        icon={Network}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'fleet_groups')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Fleet Groups Hierarchy', 'fleet_groups', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New group
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Fleet Groups isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V189_FLEET_GROUPS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load fleet groups.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
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
            <Network size={15} /> Organisation hierarchy
          </h3>
          {rows !== null && rows.length > 0 && (
            <span className="text-xs text-[var(--text-muted)]">Depth {summary.maxDepth} · {summary.rootGroups} root{summary.rootGroups === 1 ? '' : 's'}</span>
          )}
        </div>
        {rows === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-8 bg-[var(--input-bg)] rounded animate-pulse" />)}
          </div>
        ) : tree.length === 0 ? (
          <div className="py-10 text-center text-[var(--text-muted)]">
            <Network size={26} className="mx-auto mb-2 opacity-60" />
            <p className="text-sm">{notProvisioned ? 'Enable the module to start building your hierarchy.' : 'No groups yet — create a holding company or division to begin.'}</p>
          </div>
        ) : (
          <div className="-mx-1">
            {tree.map((node) => (
              <TreeNode key={node.group.id} node={node} rows={rows} depth={0} currency={currency} onEdit={openEdit} />
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search group, code, manager, region…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Group type">
            <option value="">All types</option>
            {GROUP_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t]?.label || t}</option>)}
          </select>
          <select className="input" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalGroups}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Group', 'Type', 'Parent', 'Manager', 'Region', 'Assets (rolled)', 'Budget', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No groups yet — create your first group.' : 'No groups match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const rolled = rollupAssetCount(rows, r.group_name)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--text-primary)]">{r.group_name || '—'}</span>
                          {r.group_code && <span className="text-[11px] text-[var(--text-muted)] font-mono">#{r.group_code}</span>}
                          {r.active === false && <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">inactive</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5"><TypeBadge type={r.group_type} /></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.parent_group || <span className="text-[var(--text-muted)]">root</span>}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.manager ? <span className="inline-flex items-center gap-1"><User size={12} className="opacity-60" />{r.manager}</span> : '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.region ? <span className="inline-flex items-center gap-1"><MapPin size={12} className="opacity-60" />{r.region}</span> : '—'}</td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">
                        {rolled.toLocaleString()}
                        {r.asset_count != null && Number(r.asset_count) !== rolled && <span className="text-xs text-[var(--text-muted)] font-normal"> / {fmtInt(r.asset_count)} own</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.budget == null ? '—' : formatCurrencyCompact(Number(r.budget) || 0, r.currency || currency)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit group' : 'New fleet group'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Group name</label>
                  <input className="input w-full" placeholder="e.g. Gulf Logistics Holding" value={form.group_name} maxLength={200} onChange={(e) => set('group_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Group code (optional)</label>
                  <input className="input w-full" placeholder="e.g. GLH-001" value={form.group_code} maxLength={60} onChange={(e) => set('group_code', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Type</label>
                  <select className="input w-full" value={form.group_type} onChange={(e) => set('group_type', e.target.value)}>
                    <option value="">— Select type —</option>
                    {GROUP_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t]?.label || t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Parent group (optional)</label>
                  <select className="input w-full" value={form.parent_group} onChange={(e) => set('parent_group', e.target.value)}>
                    <option value="">— None (top level) —</option>
                    {parentOptions
                      .filter((name) => !editing || name !== editing.group_name)
                      .map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Manager (optional)</label>
                  <input className="input w-full" placeholder="e.g. A. Rahman" value={form.manager} maxLength={200} onChange={(e) => set('manager', e.target.value)} />
                </div>
                <div>
                  <label className="label">Region (optional)</label>
                  <input className="input w-full" placeholder="e.g. Eastern Province" value={form.region} maxLength={200} onChange={(e) => set('region', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Own asset count</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.asset_count} onChange={(e) => set('asset_count', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Descendants roll up automatically.</p>
                </div>
                <div>
                  <label className="label">Budget (optional)</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="0" value={form.budget} onChange={(e) => set('budget', e.target.value)} />
                </div>
                <div>
                  <label className="label">Currency</label>
                  <input className="input w-full" placeholder={currency} value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. consolidated cost centre for northern depots" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" className="accent-indigo-500" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
                Active group
              </label>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create group'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this group?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.group_name || 'Group'}{confirmDelete.group_code ? ` · #${confirmDelete.group_code}` : ''}. Child groups will become root-level. This can’t be undone.
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
