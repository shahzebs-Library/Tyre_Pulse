/**
 * FleetGroups (route /fleet-groups) - Fleet Groups / Holding-Company Hierarchy.
 * Organises fleet assets into a governed corporate/operational tree: holding
 * companies, subsidiaries, divisions, depots, cost centres, and custom groups.
 * Assets roll up through the hierarchy, so cost, budget, and utilisation can be
 * reported at any node: a single depot, a division, or the whole holding.
 *
 * Runs on the `fleet_groups` table (V189). Real data only: KPI strip, a
 * collapsible roll-up tree, a type breakdown, data-quality findings, a sortable
 * register (EnterpriseTable), search + filters, create/edit/delete, Excel/PDF
 * export, and loading / empty / error+Retry / not-provisioned states.
 *
 * Hierarchy maths lives in src/lib/fleetGroups.js; the KPI, register, budget and
 * export shaping lives in src/lib/fleetGroupsAnalytics.js. Budgets in different
 * currencies are never summed into one figure.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Building2, Network, Layers, Boxes, Wallet, Search, X, FileSpreadsheet,
  FileText, Plus, Pencil, Trash2, AlertTriangle, ChevronRight, ChevronDown,
  MapPin, User, RefreshCw, Lightbulb, PieChart, Loader2, Save,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listFleetGroups, createFleetGroup, updateFleetGroup, deleteFleetGroup, GROUP_TYPES,
} from '../lib/api/fleetGroups'
import { buildHierarchy, rollupAssetCount } from '../lib/fleetGroups'
import {
  filterGroups, groupRegisterRows, buildGroupKpis, buildGroupInsights, typeBreakdown,
  groupExportRows, GROUP_EXPORT_COLUMNS, groupTypeLabel,
} from '../lib/fleetGroupsAnalytics'
import { compareValues } from '../lib/consoleTable'
import { colorAt } from '../lib/reportColors'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_FORM = {
  group_name: '', group_code: '', group_type: '', parent_group: '',
  manager: '', region: '', asset_count: '', budget: '', currency: '', active: true, notes: '',
}

// Semantic type tint. Text label always accompanies the colour.
const TYPE_CLS = {
  holding: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  subsidiary: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  division: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  depot: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  cost_center: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  custom: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]',
}

const ICON_BTN = 'inline-flex items-center justify-center h-11 w-11 sm:h-9 sm:w-9 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (v === null || v === undefined || v === '' ? undefined : v)
const fmtInt = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())

function TypeBadge({ type }) {
  if (!type) return <span className="text-[var(--text-muted)]">N/A</span>
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TYPE_CLS[type] || TYPE_CLS.custom}`}>
      {groupTypeLabel(type)}
    </span>
  )
}

function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums break-words ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

/** Recursive tree row. Shows own + rolled-up asset counts and supports collapse. */
function TreeNode({ node, rows, depth, currency, onEdit }) {
  const [open, setOpen] = useState(true)
  const g = node.group
  const hasKids = node.children.length > 0
  const own = g.asset_count == null || g.asset_count === '' ? null : Number(g.asset_count) || 0
  const rolled = rollupAssetCount(rows, g.group_name)
  const budget = g.budget == null || g.budget === '' ? null : Number(g.budget) || 0

  return (
    <li>
      <div
        className="flex items-center gap-2 py-1.5 pr-1 rounded-lg hover:bg-[var(--input-bg)]/50 group min-w-0"
        style={{ paddingLeft: `${Math.min(depth, 8) * 16 + 4}px` }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={ICON_BTN}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${g.group_name}`}
          >
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : (
          <span className="w-11 sm:w-9 shrink-0" aria-hidden="true" />
        )}
        <Network size={14} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
        <span className="font-medium text-[var(--text-primary)] truncate">{g.group_name}</span>
        {g.group_code && <span className="hidden md:inline text-[11px] text-[var(--text-muted)] font-mono shrink-0">#{g.group_code}</span>}
        <span className="hidden sm:inline"><TypeBadge type={g.group_type} /></span>
        {g.active === false && (
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] border border-[var(--input-border)] rounded px-1.5 py-0.5 shrink-0">Inactive</span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-xs text-[var(--text-muted)] whitespace-nowrap tabular-nums">
            <span className="text-[var(--text-secondary)] font-semibold">{rolled.toLocaleString()}</span> assets
            {hasKids && own != null && own !== rolled && <span className="hidden sm:inline opacity-80"> ({own.toLocaleString()} own)</span>}
          </span>
          {budget != null && (
            <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap hidden md:inline">
              {formatCurrencyCompact(budget, g.currency || currency)}
            </span>
          )}
          <button
            type="button"
            onClick={() => onEdit(g)}
            className={`${ICON_BTN} sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100`}
            aria-label={`Edit ${g.group_name}`}
          >
            <Pencil size={13} />
          </button>
        </div>
      </div>
      {hasKids && open && (
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.group.id} node={child} rows={rows} depth={depth + 1} currency={currency} onEdit={onEdit} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function FleetGroups() {
  const { activeCountry, activeCurrency } = useSettings()
  const currency = activeCurrency || 'SAR'
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
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
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listFleetGroups({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load fleet groups.')); setRows((prev) => prev) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null && !error
  const all = useMemo(() => rows || [], [rows])
  const kpi = useMemo(() => buildGroupKpis(all, currency), [all, currency])
  const insights = useMemo(() => buildGroupInsights(all, currency), [all, currency])
  const tree = useMemo(() => buildHierarchy(all), [all])
  const types = useMemo(() => typeBreakdown(all), [all])

  const parentOptions = useMemo(
    () => [...new Set(all.map((r) => r.group_name).filter(Boolean))].sort(),
    [all],
  )

  const filtered = useMemo(
    () => filterGroups(all, { type: typeFilter, active: activeFilter, search }),
    [all, typeFilter, activeFilter, search],
  )
  const register = useMemo(() => groupRegisterRows(filtered, all), [filtered, all])

  const budgetLabel = kpi.budget.total != null
    ? formatCurrencyCompact(kpi.budget.total, kpi.budget.currency)
    : 'N/A'
  const budgetSub = kpi.budget.mixed
    ? `Mixed currencies: ${kpi.budget.totals.map((t) => formatCurrencyCompact(t.total, t.currency)).join(' + ')}`
    : kpi.budgetCoverage != null ? `${Math.round(kpi.budgetCoverage * 100)}% of groups budgeted` : null

  const kpis = [
    { label: 'Total groups', value: kpi.total.toLocaleString(), icon: Boxes, tone: 'text-[var(--text-primary)]', sub: `${kpi.inactive} inactive` },
    { label: 'Active groups', value: kpi.active.toLocaleString(), icon: Building2, tone: 'text-emerald-500' },
    { label: 'Root entities', value: kpi.roots.toLocaleString(), icon: Network, tone: 'text-sky-500', sub: kpi.maxDepth != null ? `Depth ${kpi.maxDepth}` : null },
    { label: 'Assets grouped', value: fmtInt(kpi.totalAssets), icon: Layers, tone: 'text-violet-500', sub: kpi.assetCoverage != null && kpi.assetCoverage < 1 ? `${Math.round(kpi.assetCoverage * 100)}% of groups report a count` : null },
    { label: 'Total budget', value: budgetLabel, icon: Wallet, tone: 'text-amber-500', sub: budgetSub },
  ]

  // Export walks the full filtered register, never just the visible page.
  const exportRows = useMemo(() => groupExportRows(filtered, all, currency), [filtered, all, currency])
  const scopeLabel = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
  const doExcel = async () => {
    setActionError('')
    try {
      await exportToExcel(exportRows, GROUP_EXPORT_COLUMNS.map((c) => c.key), GROUP_EXPORT_COLUMNS.map((c) => c.header), reportFileName('Fleet Groups', scopeLabel))
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    setActionError('')
    try {
      await exportToPdf(exportRows, GROUP_EXPORT_COLUMNS, `Fleet Groups Hierarchy (${scopeLabel})`, reportFileName('Fleet Groups', scopeLabel), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      group_name: r.group_name || '', group_code: r.group_code || '',
      group_type: r.group_type || '', parent_group: r.parent_group || '',
      manager: r.manager || '', region: r.region || '',
      asset_count: r.asset_count ?? '', budget: r.budget ?? '',
      currency: r.currency || '', active: r.active !== false, notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
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
      setFormError(toUserMessage(err, 'Could not save the group.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const closeDelete = () => { if (!deleting) { setConfirmDelete(null); setDeleteError('') } }
  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setDeleteError('')
    try {
      await deleteFleetGroup(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete the group.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setTypeFilter(''); setActiveFilter(''); setSearch('') }
  const hasFilters = typeFilter || activeFilter || search

  const columns = useMemo(() => [
    {
      id: 'group_name', header: 'Group', accessorFn: (r) => blank(r.group_name), sortingFn: valueSort, sortUndefined: 'last', size: 220,
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-[var(--text-primary)] truncate">{r.group_name || 'N/A'}</span>
            {r.group_code && <span className="text-[11px] text-[var(--text-muted)] font-mono">#{r.group_code}</span>}
            {!r.isActive && <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">inactive</span>}
          </div>
        )
      },
    },
    { id: 'type', header: 'Type', accessorFn: (r) => (r.group_type ? r.typeLabel : undefined), sortingFn: valueSort, sortUndefined: 'last', size: 120, cell: ({ row }) => <TypeBadge type={row.original.group_type} /> },
    {
      id: 'parent', header: 'Parent', accessorFn: (r) => blank(r.parent_group), sortingFn: valueSort, sortUndefined: 'last', size: 160,
      cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.parent_group || <span className="text-[var(--text-muted)]">Top level</span>}</span>,
    },
    { id: 'depth', header: 'Depth', accessorFn: (r) => r.depth ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 70, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{getValue() ?? 'N/A'}</span> },
    {
      id: 'manager', header: 'Manager', accessorFn: (r) => blank(r.manager), sortingFn: valueSort, sortUndefined: 'last', size: 150,
      cell: ({ row }) => row.original.manager ? <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]"><User size={12} className="opacity-60" aria-hidden="true" />{row.original.manager}</span> : <span className="text-[var(--text-muted)]">N/A</span>,
    },
    {
      id: 'region', header: 'Region', accessorFn: (r) => blank(r.region), sortingFn: valueSort, sortUndefined: 'last', size: 140,
      cell: ({ row }) => row.original.region ? <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]"><MapPin size={12} className="opacity-60" aria-hidden="true" />{row.original.region}</span> : <span className="text-[var(--text-muted)]">N/A</span>,
    },
    {
      id: 'rolled', header: 'Assets (rolled)', accessorFn: (r) => r.rolledAssets, sortingFn: valueSort, size: 130, meta: { align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        return (
          <span className="tabular-nums font-semibold text-[var(--text-primary)]">
            {r.rolledAssets.toLocaleString()}
            {r.ownAssets != null && r.ownAssets !== r.rolledAssets && <span className="text-xs text-[var(--text-muted)] font-normal"> / {fmtInt(r.ownAssets)} own</span>}
          </span>
        )
      },
    },
    {
      id: 'budget', header: 'Budget', accessorFn: (r) => r.budgetValue ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)] whitespace-nowrap">{row.original.budgetValue == null ? 'N/A' : formatCurrencyCompact(row.original.budgetValue, row.original.currency || currency)}</span>,
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 100, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit ${row.original.group_name}`}><Pencil size={14} /></button>
          <button type="button" onClick={() => { setDeleteError(''); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-500`} aria-label={`Delete ${row.original.group_name}`}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ], [currency, openEdit])

  const maxTypeCount = Math.max(1, ...types.map((t) => t.count))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Groups"
        subtitle="Model your holding-company hierarchy (subsidiaries, divisions, depots, and cost centres) and roll up assets, budget, and utilisation across every level."
        icon={Network}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> New group
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Fleet Groups is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V189_FLEET_GROUPS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[var(--text-primary)] font-medium">Could not load fleet groups.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-500/40 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)] flex-1">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      {/* KPI strip: covers every group in scope (filters only narrow the register). */}
      <section aria-label="Fleet group figures">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {kpis.map((k) => <Kpi key={k.label} {...k} value={loading || (rows === null) ? 'N/A' : k.value} sub={loading ? null : k.sub} />)}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-2">Figures cover all {kpi.total.toLocaleString()} group(s) in {scopeLabel}. Filters below narrow the register only.</p>
      </section>

      {!loading && insights.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2"><Lightbulb size={15} className="text-amber-500" aria-hidden="true" /> Findings</h2>
          <ul className="space-y-1.5">
            {insights.map((s) => (
              <li key={s} className="text-sm text-[var(--text-secondary)] flex items-start gap-2">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Hierarchy tree */}
        <div className="card xl:col-span-2 min-w-0">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Network size={15} aria-hidden="true" /> Organisation hierarchy
            </h2>
            {all.length > 0 && (
              <span className="text-xs text-[var(--text-muted)]">Depth {kpi.maxDepth ?? 0} | {kpi.roots} root{kpi.roots === 1 ? '' : 's'}</span>
            )}
          </div>
          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => <div key={i} className="h-8 bg-[var(--input-bg)] rounded animate-pulse" />)}
            </div>
          ) : error && rows === null ? (
            <p className="text-sm text-[var(--text-muted)] py-6 text-center">The hierarchy could not be loaded. Use Retry above.</p>
          ) : tree.length === 0 ? (
            <div className="py-10 text-center text-[var(--text-muted)]">
              <Network size={26} className="mx-auto mb-2 opacity-60" aria-hidden="true" />
              <p className="text-sm">{notProvisioned ? 'Enable the module to start building your hierarchy.' : 'No groups yet. Create a holding company or division to begin.'}</p>
            </div>
          ) : (
            <ul className="max-h-[480px] overflow-y-auto -mx-1" aria-label="Group hierarchy">
              {tree.map((node) => (
                <TreeNode key={node.group.id} node={node} rows={all} depth={0} currency={currency} onEdit={openEdit} />
              ))}
            </ul>
          )}
        </div>

        {/* Type breakdown */}
        <div className="card min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><PieChart size={15} aria-hidden="true" /> Groups by type</h2>
          {loading ? (
            <div className="h-32 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : types.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No groups to break down yet.</p>
          ) : (
            <ul className="space-y-3">
              {types.map((t, i) => (
                <li key={t.type || 'none'}>
                  <div className="flex items-center justify-between text-xs mb-1 gap-2">
                    <button type="button" onClick={() => setTypeFilter(t.type)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline truncate" disabled={!t.type} aria-label={`Filter register to ${t.label}`}>{t.label}</button>
                    <span className="tabular-nums text-[var(--text-primary)] font-semibold">{t.count} <span className="font-normal text-[var(--text-muted)]">| {t.assetsKnown ? `${t.assets.toLocaleString()} assets` : 'no asset count'}</span></span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.round((t.count / maxTypeCount) * 100))}%`, background: colorAt(i) }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="fg-search" className="sr-only">Search groups</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="fg-search" className="input pl-9 w-full" placeholder="Search group, code, manager, region..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input w-full sm:w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Group type">
            <option value="">All types</option>
            {GROUP_TYPES.map((t) => <option key={t} value={t}>{groupTypeLabel(t)}</option>)}
          </select>
          <select className="input w-full sm:w-auto" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {kpi.total}</span>
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={register}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={error && rows === null ? error : null}
        onRetry={load}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        viewKey="fleet-groups"
        initialPageSize={25}
        emptyMessage={all.length === 0 && !notProvisioned ? 'No groups yet. Create your first group.' : notProvisioned ? 'Fleet Groups is not enabled yet.' : 'No groups match these filters.'}
      />

      {showModal && (
        <Modal open onClose={closeModal} size="lg" title={editing ? 'Edit group' : 'New fleet group'}>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="fg-name">Group name *</label>
                <input id="fg-name" className="input w-full" placeholder="e.g. Gulf Logistics Holding" value={form.group_name} maxLength={200} required onChange={(e) => set('group_name', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fg-code">Group code (optional)</label>
                <input id="fg-code" className="input w-full" placeholder="e.g. GLH-001" value={form.group_code} maxLength={60} onChange={(e) => set('group_code', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fg-type">Type</label>
                <select id="fg-type" className="input w-full" value={form.group_type} onChange={(e) => set('group_type', e.target.value)}>
                  <option value="">Select type</option>
                  {GROUP_TYPES.map((t) => <option key={t} value={t}>{groupTypeLabel(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="fg-parent">Parent group (optional)</label>
                <select id="fg-parent" className="input w-full" value={form.parent_group} onChange={(e) => set('parent_group', e.target.value)}>
                  <option value="">None (top level)</option>
                  {parentOptions
                    .filter((name) => !editing || name !== editing.group_name)
                    .map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="fg-manager">Manager (optional)</label>
                <input id="fg-manager" className="input w-full" placeholder="e.g. A. Rahman" value={form.manager} maxLength={200} onChange={(e) => set('manager', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fg-region">Region (optional)</label>
                <input id="fg-region" className="input w-full" placeholder="e.g. Eastern Province" value={form.region} maxLength={200} onChange={(e) => set('region', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label" htmlFor="fg-assets">Own asset count</label>
                <input id="fg-assets" className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="0" value={form.asset_count} onChange={(e) => set('asset_count', e.target.value)} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Descendants roll up automatically.</p>
              </div>
              <div>
                <label className="label" htmlFor="fg-budget">Budget (optional)</label>
                <input id="fg-budget" className="input w-full" type="number" step="0.01" min="0" inputMode="decimal" placeholder="0" value={form.budget} onChange={(e) => set('budget', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fg-currency">Currency</label>
                <input id="fg-currency" className="input w-full" placeholder={currency} value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="fg-notes">Notes (optional)</label>
              <textarea id="fg-notes" className="input w-full min-h-[70px] resize-y" placeholder="e.g. consolidated cost centre for northern depots" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer min-h-[44px]">
              <input type="checkbox" className="accent-indigo-500 h-4 w-4" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              Active group
            </label>

            {formError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px] sm:min-h-0" disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60 min-h-[44px] sm:min-h-0" disabled={saving}>
                {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
                {saving ? 'Saving...' : editing ? 'Save changes' : 'Create group'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={closeDelete}
          size="sm"
          title="Delete this group?"
          footer={
            <>
              <button type="button" onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                {deleting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <p className="text-sm text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{confirmDelete.group_name || 'Group'}</span>{confirmDelete.group_code ? ` (#${confirmDelete.group_code})` : ''}. Child groups will become top level. This cannot be undone.
          </p>
          {deleteError && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-500 mt-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {deleteError}
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}
