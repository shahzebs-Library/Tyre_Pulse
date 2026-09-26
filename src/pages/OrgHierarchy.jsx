/**
 * OrgHierarchy (route /org-hierarchy) - Organization Hierarchy (Enterprise
 * section 3). Models the internal structure as a governed tree (company,
 * country, region, branch, project, site, workshop, department, team) and
 * assigns users to any level. This module owns the `org_units` and
 * `user_org_assignments` tables (V206) and touches no operational data.
 *
 * Tree/descendant/depth/active-window maths: `src/lib/orgUnits.js`.
 * Register rows, filters, KPIs, type mix, member + coverage registers and
 * export shapes: `src/lib/orgHierarchyAnalytics.js`.
 *
 * The member and people reads are best-effort for the TREE, but a failed read
 * is SAID on screen: member counts then read N/A, never a fabricated 0.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  Network, Building2, Layers, Boxes, Search, X,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, AlertTriangle,
  ChevronRight, ChevronDown, MapPin, Users, UserPlus, Star, Calendar, RefreshCw, PieChart, UserX,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  listUnits, createUnit, updateUnit, deleteUnit, UNIT_TYPES,
  listAssignments, createAssignment, updateAssignment, deleteAssignment,
} from '../lib/api/orgUnits'
import { listProfiles } from '../lib/api/users'
import { buildTree, descendantsOf } from '../lib/orgUnits'
import {
  UNIT_TYPE_LABELS, personLabel, countsByUnit, unitRegister, filterUnits, hierarchyKpis,
  typeMix, memberRows, coverageRows, unitExportRows, UNIT_EXPORT_COLS, UNIT_EXPORT_HEADERS,
  memberExportRows, MEMBER_EXPORT_COLS, MEMBER_EXPORT_HEADERS,
} from '../lib/orgHierarchyAnalytics'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import { colorAt, withAlpha } from '../lib/reportColors'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')

// The list services read at most this many rows; reaching it means the read
// may be incomplete, which the page says rather than presenting it as whole.
const READ_LIMIT = 1000

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
  team:       { label: 'Team',       cls: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]' },
}

function TypeBadge({ type }) {
  const meta = TYPE_META[type]
  if (!meta) return <span className="text-[var(--text-muted)]">N/A</span>
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function Kpi({ label, value, sub, icon: Icon, tone = 'text-[var(--text-primary)]' }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        {Icon && <Icon size={16} className={tone} aria-hidden="true" />}
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-1">{sub}</p>}
    </Card>
  )
}

/** Recursive tree row: the unit name selects it; chevron collapses; pencil edits. */
function TreeNode({ node, depth, onEdit, onSelect, selectedId, countsByUnitMap, membersKnown }) {
  const [open, setOpen] = useState(true)
  const u = node.unit
  const hasKids = node.children.length > 0
  const counts = countsByUnitMap.get(String(u.id))
  const isSelected = String(u.id) === String(selectedId)

  return (
    <li role="treeitem" aria-expanded={hasKids ? open : undefined} aria-selected={isSelected}>
      <div
        className={`flex items-center gap-2 pr-2 rounded-lg ${isSelected ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/30' : 'hover:bg-[var(--input-bg)]/50'}`}
        style={{ paddingLeft: `${Math.min(depth, 8) * 20 + 4}px` }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="p-2 min-w-[36px] min-h-[36px] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)]"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${u.name}`}
          >
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : (
          <span className="w-[36px] shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={() => onSelect(u)}
          className="flex flex-1 min-w-0 flex-wrap items-center gap-2 py-2 min-h-[44px] text-left rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)]"
          aria-label={`Show members of ${u.name}`}
        >
          <Network size={14} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
          <span className="font-medium text-[var(--text-primary)] truncate">{u.name}</span>
          {u.code && <span className="text-[11px] text-[var(--text-muted)] font-mono">#{u.code}</span>}
          <TypeBadge type={u.unit_type} />
          {u.country && (
            <span className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1">
              <MapPin size={11} className="opacity-60" aria-hidden="true" />{u.country}
            </span>
          )}
          {membersKnown && counts?.total > 0 && (
            <span className="text-[11px] text-[var(--text-secondary)] inline-flex items-center gap-1">
              <Users size={11} className="opacity-70" aria-hidden="true" />{counts.active} of {counts.total} active
            </span>
          )}
          {u.active === false && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] border border-[var(--input-border)] rounded px-1.5 py-0.5">Inactive</span>
          )}
          {hasKids && (
            <span className="text-xs text-[var(--text-muted)] whitespace-nowrap ml-auto">
              <span className="text-[var(--text-secondary)] font-semibold">{node.children.length}</span> child{node.children.length === 1 ? '' : 'ren'}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onEdit(u)}
          className="p-2 min-w-[36px] min-h-[36px] rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)]"
          aria-label={`Edit ${u.name}`}
        >
          <Pencil size={13} />
        </button>
      </div>
      {hasKids && open && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.unit.id} node={child} depth={depth + 1}
              onEdit={onEdit} onSelect={onSelect} selectedId={selectedId}
              countsByUnitMap={countsByUnitMap} membersKnown={membersKnown}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function OrgHierarchy() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [sideErrors, setSideErrors] = useState({ assignments: '', profiles: '' })

  const [typeFilter, setTypeFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [staffingFilter, setStaffingFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [assignments, setAssignments] = useState([])
  const [profiles, setProfiles] = useState([])
  const [selectedUnitId, setSelectedUnitId] = useState(null)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState(null)
  const [assignForm, setAssignForm] = useState(null)
  const [assignSaving, setAssignSaving] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [removing, setRemoving] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      // Units are the page: a failure there is a page error. Assignments and
      // people are read alongside; their failure is reported, not hidden.
      const [data, asg, profs] = await Promise.all([
        listUnits({}),
        listAssignments({}).then((v) => ({ v, e: '' }), (e) => ({ v: [], e: toUserMessage(e, 'Could not load unit members.') })),
        listProfiles().then((v) => ({ v, e: '' }), (e) => ({ v: [], e: toUserMessage(e, 'Could not load users.') })),
      ])
      setRows(Array.isArray(data) ? data : [])
      setAssignments(Array.isArray(asg.v) ? asg.v : [])
      setProfiles(Array.isArray(profs.v) ? profs.v : [])
      setSideErrors({ assignments: asg.e, profiles: profs.e })
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load organisation units.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const nowMs = updatedAt?.getTime() ?? Date.now()
  const membersKnown = !sideErrors.assignments
  const tree = useMemo(() => buildTree(rows || []), [rows])
  const register = useMemo(() => unitRegister(rows || [], assignments, nowMs), [rows, assignments, nowMs])
  const kpis = useMemo(() => hierarchyKpis(rows || [], register, assignments, nowMs), [rows, register, assignments, nowMs])
  const mix = useMemo(() => typeMix(register), [register])
  const countsMap = useMemo(() => countsByUnit(assignments, nowMs), [assignments, nowMs])
  const filtered = useMemo(
    () => filterUnits(register, { search, type: typeFilter, status: activeFilter, staffing: membersKnown ? staffingFilter : '' }),
    [register, search, typeFilter, activeFilter, staffingFilter, membersKnown],
  )

  const profileById = useMemo(() => new Map(profiles.map((p) => [String(p.id), p])), [profiles])
  const userLabel = useCallback((userId) => personLabel(profileById.get(String(userId)), userId), [profileById])

  const parentOptions = useMemo(() => {
    const all = (rows || []).map((r) => ({ id: String(r.id), name: r.name, type: r.unit_type }))
    if (!editing) return all
    const banned = new Set([String(editing.id), ...descendantsOf(rows || [], editing.id)])
    return all.filter((o) => !banned.has(o.id))
  }, [rows, editing])

  const selectedUnit = useMemo(
    () => (rows || []).find((r) => String(r.id) === String(selectedUnitId)) || null,
    [rows, selectedUnitId],
  )
  const unitMembers = useMemo(() => memberRows(assignments, selectedUnitId, profileById, nowMs), [assignments, selectedUnitId, profileById, nowMs])
  const coverage = useMemo(() => coverageRows(rows || [], assignments, profileById, nowMs), [rows, assignments, profileById, nowMs])

  const readCapped = (rows?.length || 0) >= READ_LIMIT || assignments.length >= READ_LIMIT

  // ── Tables ────────────────────────────────────────────────────────────────
  const unitColumns = useMemo(() => [
    { id: 'name', header: 'Unit', accessorFn: (r) => r.name || '', size: 240,
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--text-primary)]">{r.name || 'N/A'}</span>
            {r.code && <span className="text-[11px] text-[var(--text-muted)] font-mono">#{r.code}</span>}
            {!r.isActive && <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] border border-[var(--input-border)] rounded px-1.5">Inactive</span>}
          </div>
        )
      } },
    { id: 'type', header: 'Type', accessorFn: (r) => r.typeLabel, size: 120, cell: ({ row }) => <TypeBadge type={row.original.unit_type} /> },
    { id: 'parent', header: 'Parent', accessorFn: (r) => r.parentName || '', size: 180,
      cell: ({ row }) => {
        const r = row.original
        if (r.isRoot) return <span className="text-[var(--text-muted)]">Root</span>
        if (r.orphanParent) return <span className="text-amber-400">Parent missing</span>
        return r.parentName
      } },
    { id: 'country', header: 'Country', accessorFn: (r) => r.country || '', size: 130,
      cell: ({ row }) => (row.original.country ? <span className="inline-flex items-center gap-1"><MapPin size={12} className="opacity-60" aria-hidden="true" />{row.original.country}</span> : <span className="text-[var(--text-muted)]">N/A</span>) },
    { id: 'site_ref', header: 'Site ref', accessorFn: (r) => r.site_ref || '', size: 120,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.site_ref || 'N/A'}</span> },
    { id: 'depth', header: 'Depth', accessorFn: (r) => r.depth ?? -1, size: 80, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.depth ?? 'N/A'}</span> },
    { id: 'children', header: 'Children', accessorFn: (r) => r.children, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.children}</span> },
    { id: 'members', header: 'Members', accessorFn: (r) => r.activeMembers, size: 140,
      cell: ({ row }) => {
        const r = row.original
        const sel = String(r.id) === String(selectedUnitId)
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setSelectedUnitId(String(r.id)) }}
            className={`inline-flex items-center gap-1.5 text-xs rounded-lg px-2 min-h-[36px] border focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)] ${sel ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'}`}
            aria-label={`Manage members of ${r.name}`}
          >
            <Users size={12} aria-hidden="true" />
            {membersKnown ? `${r.activeMembers} of ${r.members}` : 'N/A'}
          </button>
        )
      } },
    { id: 'actions', header: '', enableSorting: false, size: 100, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className="p-2 min-w-[36px] min-h-[36px] rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit ${row.original.name}`}><Pencil size={14} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row.original) }} className="p-2 min-w-[36px] min-h-[36px] rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete ${row.original.name}`}><Trash2 size={14} /></button>
        </div>
      ) },
  ], [selectedUnitId, membersKnown])

  const memberColumns = useMemo(() => [
    { id: 'name', header: 'User', accessorFn: (m) => m.name, size: 220,
      cell: ({ row }) => {
        const m = row.original
        return (
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-[var(--text-primary)]">{m.name}</span>
              {m.is_primary && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded px-1.5 py-0.5">
                  <Star size={9} className="fill-amber-300" aria-hidden="true" /> Primary
                </span>
              )}
            </div>
            {m.sub && <span className="text-[11px] text-[var(--text-muted)]">{m.sub}</span>}
          </div>
        )
      } },
    { id: 'role', header: 'Role at unit', accessorFn: (m) => m.role || '', size: 150, cell: ({ row }) => row.original.role || <span className="text-[var(--text-muted)]">N/A</span> },
    { id: 'window', header: 'Window', accessorFn: (m) => m.starts_at || '', size: 190,
      cell: ({ row }) => {
        const m = row.original
        return (m.starts_at || m.ends_at) ? (
          <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap">
            <Calendar size={11} className="opacity-60" aria-hidden="true" />
            {m.starts_at ? String(m.starts_at).slice(0, 10) : 'Open'} to {m.ends_at ? String(m.ends_at).slice(0, 10) : 'open'}
          </span>
        ) : <span className="text-[var(--text-muted)] text-xs">Open-ended</span>
      } },
    { id: 'status', header: 'Status', accessorFn: (m) => (m._active ? 'Active' : 'Scheduled or ended'), size: 150,
      cell: ({ row }) => (row.original._active
        ? <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 px-2 py-0.5 text-[11px] font-medium">Active</span>
        : <span className="inline-flex items-center rounded-full border border-[var(--input-border)] text-[var(--text-muted)] px-2 py-0.5 text-[11px]">Scheduled or ended</span>) },
    { id: 'actions', header: '', enableSorting: false, size: 100,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openAssignEdit(row.original)} className="p-2 min-w-[36px] min-h-[36px] rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit assignment for ${row.original.name}`}><Pencil size={14} /></button>
          <button type="button" onClick={() => setConfirmRemove(row.original)} className="p-2 min-w-[36px] min-h-[36px] rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Remove ${row.original.name} from this unit`}><Trash2 size={14} /></button>
        </div>
      ) },
  ], [])

  const coverageColumns = useMemo(() => [
    { id: 'name', header: 'User', accessorFn: (c) => c.name, size: 220,
      cell: ({ row }) => (
        <div><span className="font-medium text-[var(--text-primary)]">{row.original.name}</span>
          {row.original.sub && <span className="block text-[11px] text-[var(--text-muted)]">{row.original.sub}</span>}</div>
      ) },
    { id: 'primary', header: 'Primary unit', accessorFn: (c) => c.primaryUnit || '', size: 180,
      cell: ({ row }) => (row.original.primaryUnit
        ? <span className="inline-flex items-center gap-1"><Star size={11} className="text-amber-400 fill-amber-400/40" aria-hidden="true" />{row.original.primaryUnit}</span>
        : <span className="text-[var(--text-muted)]">None set</span>) },
    { id: 'direct', header: 'Direct', accessorFn: (c) => c.directCount, size: 90, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.directCount}</span> },
    { id: 'inherited', header: 'Inherited', accessorFn: (c) => c.inherited, size: 100, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.inherited}</span> },
    { id: 'effective', header: 'Effective reach', accessorFn: (c) => c.effectiveCount, size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{row.original.effectiveCount} unit{row.original.effectiveCount === 1 ? '' : 's'}</span> },
  ], [])

  const mixChart = useMemo(() => (mix.length ? {
    labels: mix.map((m) => m.label),
    datasets: [{ label: 'Units', data: mix.map((m) => m.count), backgroundColor: mix.map((_, i) => withAlpha(colorAt(i), 0.75)), borderColor: mix.map((_, i) => colorAt(i)), borderWidth: 1, borderRadius: 3 }],
  } : null), [mix])
  const mixOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
      y: { ticks: { color: 'var(--text-muted)' }, grid: { display: false } },
    },
  }

  // ── Exports ───────────────────────────────────────────────────────────────
  async function exportUnits(kind) {
    const { exportToExcel, exportToPdf, reportFileName, reportDateLabel } = await loadExportUtils()
    const rowsOut = unitExportRows(filtered)
    const name = reportFileName('TyrePulse Organization Hierarchy', reportDateLabel())
    if (kind === 'pdf') exportToPdf(rowsOut, UNIT_EXPORT_COLS.map((key, i) => ({ key, header: UNIT_EXPORT_HEADERS[i] })), 'Organization Hierarchy', name, 'landscape')
    else exportToExcel(rowsOut, UNIT_EXPORT_COLS, UNIT_EXPORT_HEADERS, name)
  }
  async function exportMembers() {
    const { exportToExcel, reportFileName, reportDateLabel } = await loadExportUtils()
    exportToExcel(memberExportRows(unitMembers), MEMBER_EXPORT_COLS, MEMBER_EXPORT_HEADERS,
      reportFileName('TyrePulse Unit Members', selectedUnit?.name, reportDateLabel()))
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  function openEdit(r) {
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
      const payload = { ...form, parent_id: form.parent_id || null, sort_order: form.sort_order === '' ? null : form.sort_order }
      if (editing) await updateUnit(editing.id, payload, rows || [])
      else await createUnit(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the unit.'))
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
      setError(toUserMessage(err, 'Could not delete the unit.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // ── Members / assignments ──────────────────────────────────────────────────
  const selectUnit = useCallback((u) => setSelectedUnitId(u ? String(u.id) : null), [])

  const openAssignCreate = () => {
    if (!selectedUnitId) return
    setEditingAssignment(null)
    setAssignForm({ user_id: '', role: '', is_primary: false, starts_at: '', ends_at: '' })
    setAssignError(''); setShowAssignModal(true)
  }
  function openAssignEdit(a) {
    setEditingAssignment(a)
    setAssignForm({
      user_id: String(a.user_id || ''),
      role: a.role || '',
      is_primary: !!a.is_primary,
      starts_at: a.starts_at ? String(a.starts_at).slice(0, 10) : '',
      ends_at: a.ends_at ? String(a.ends_at).slice(0, 10) : '',
    })
    setAssignError(''); setShowAssignModal(true)
  }
  const closeAssignModal = () => { if (!assignSaving) { setShowAssignModal(false); setEditingAssignment(null); setAssignForm(null) } }
  const setAssign = (k, v) => setAssignForm((f) => ({ ...f, [k]: v }))

  const assignableProfiles = useMemo(() => {
    const taken = new Set(
      unitMembers.filter((m) => !editingAssignment || m.id !== editingAssignment.id).map((m) => String(m.user_id)),
    )
    return profiles
      .filter((p) => !taken.has(String(p.id)))
      .sort((a, b) => (a.full_name || a.username || a.email || '').localeCompare(b.full_name || b.username || b.email || ''))
  }, [profiles, unitMembers, editingAssignment])

  const submitAssignment = useCallback(async (e) => {
    e?.preventDefault?.()
    setAssignError('')
    if (!assignForm?.user_id) { setAssignError('Select a user to assign.'); return }
    setAssignSaving(true)
    try {
      const payload = {
        user_id: assignForm.user_id,
        org_unit_id: selectedUnitId,
        role: assignForm.role || null,
        is_primary: assignForm.is_primary,
        starts_at: assignForm.starts_at || null,
        ends_at: assignForm.ends_at || null,
      }
      if (editingAssignment) await updateAssignment(editingAssignment.id, payload)
      else await createAssignment(payload)
      setShowAssignModal(false); setEditingAssignment(null); setAssignForm(null)
      await load()
    } catch (err) {
      const msg = String(err?.message || '')
      setAssignError(
        /duplicate|unique/i.test(msg)
          ? 'That user is already assigned to this unit.'
          : toUserMessage(err, 'Could not save the assignment.'),
      )
    } finally {
      setAssignSaving(false)
    }
  }, [assignForm, selectedUnitId, editingAssignment, load])

  const doRemoveAssignment = useCallback(async () => {
    if (!confirmRemove) return
    setRemoving(true)
    try {
      await deleteAssignment(confirmRemove.id)
      setConfirmRemove(null)
      await load()
    } catch (err) {
      setAssignError(toUserMessage(err, 'Could not remove the assignment.'))
    } finally {
      setRemoving(false)
    }
  }, [confirmRemove, load])

  const clearFilters = () => { setTypeFilter(''); setActiveFilter(''); setStaffingFilter(''); setSearch('') }
  const hasFilters = typeFilter || activeFilter || staffingFilter || search
  const loading = rows === null
  const kv = (v) => (loading ? 'N/A' : v)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Hierarchy"
        subtitle="Model your internal structure (company, country, region, branch, project, site, workshop, department and team) as a governed tree, and assign users to any level."
        icon={Network}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => exportUnits('excel')} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => exportUnits('pdf')} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm min-h-[44px] inline-flex items-center gap-1.5" disabled={notProvisioned || !!error}>
              <Plus size={14} aria-hidden="true" /> New unit
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Organization Hierarchy is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V206_ORG_HIERARCHY.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row', flexWrap: 'wrap' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]"><p className="text-[var(--text-primary)] font-medium">Couldn&apos;t load organisation units.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </Card>
      )}

      {(sideErrors.assignments || sideErrors.profiles) && (
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row', flexWrap: 'wrap' }} role="alert">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px] text-sm">
            <p className="text-[var(--text-primary)] font-medium">Part of this page could not be read.</p>
            {sideErrors.assignments && <p className="text-[var(--text-muted)] mt-1">Unit members: {sideErrors.assignments} Member counts show N/A rather than zero.</p>}
            {sideErrors.profiles && <p className="text-[var(--text-muted)] mt-1">Users: {sideErrors.profiles} Names may show as Unknown user.</p>}
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </Card>
      )}

      {readCapped && (
        <p className="text-xs text-amber-400" role="note">
          This page read the first {READ_LIMIT.toLocaleString()} rows of units or assignments. Figures may be incomplete.
        </p>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total units" value={kv(kpis.total)} icon={Boxes} sub={loading ? null : `${kpis.inactive} inactive`} />
        <Kpi label="Active units" value={kv(kpis.active)} icon={Building2} tone="text-emerald-400" />
        <Kpi label="Root units" value={kv(kpis.roots)} icon={Network} sub={!loading && kpis.orphanParents ? `${kpis.orphanParents} with a missing parent` : null} />
        <Kpi label="Max depth" value={kv(kpis.maxDepth)} icon={Layers} sub="Levels below the root" />
        <Kpi label="Active members" value={membersKnown ? kv(kpis.activeMembers) : 'N/A'} icon={Users} sub={membersKnown && !loading ? `${kpis.people} distinct people` : null} />
        <Kpi label="Staffed active units" value={membersKnown && !loading ? (kpis.staffedPct == null ? 'N/A' : `${kpis.staffedPct}%`) : 'N/A'} icon={UserX}
          tone={membersKnown && kpis.unstaffed ? 'text-amber-400' : 'text-[var(--text-primary)]'}
          sub={membersKnown && !loading ? `${kpis.unstaffed} with no active member` : null} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Tree */}
        <Card className="xl:col-span-2 min-w-0">
          <CardHeader
            title="Organisation tree"
            icon={Network}
            actions={rows !== null && rows.length > 0 ? (
              <span className="text-xs text-[var(--text-muted)]">Depth {kpis.maxDepth}, {kpis.roots} root{kpis.roots === 1 ? '' : 's'}</span>
            ) : null}
          />
          {loading ? (
            <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-8 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : tree.length === 0 ? (
            <div className="py-10 text-center text-[var(--text-muted)]">
              <Network size={26} className="mx-auto mb-2 opacity-60" aria-hidden="true" />
              <p className="text-sm">{notProvisioned ? 'Enable the module to start building your hierarchy.' : error ? 'The hierarchy could not be read.' : 'No units yet. Create a company or country to begin.'}</p>
            </div>
          ) : (
            <ul role="tree" aria-label="Organisation tree" className="-mx-1 max-h-[520px] overflow-y-auto">
              {tree.map((node) => (
                <TreeNode
                  key={node.unit.id} node={node} depth={0}
                  onEdit={openEdit} onSelect={selectUnit}
                  selectedId={selectedUnitId} countsByUnitMap={countsMap} membersKnown={membersKnown}
                />
              ))}
            </ul>
          )}
          {rows !== null && tree.length > 0 && !selectedUnit && (
            <p className="text-[11px] text-[var(--text-muted)] mt-3 flex items-center gap-1.5">
              <Users size={12} className="opacity-60" aria-hidden="true" /> Select a unit to manage its members.
            </p>
          )}
        </Card>

        {/* Type mix */}
        <Card className="min-w-0">
          <CardHeader title="Units by type" icon={PieChart} />
          {loading ? (
            <div className="h-64 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : mixChart ? (
            <div style={{ height: Math.max(220, mix.length * 34) }} role="img"
              aria-label={`Units by type: ${mix.map((m) => `${m.label} ${m.count}`).join(', ')}.`}>
              <Bar data={mixChart} options={mixOpts} />
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-sm text-[var(--text-muted)]">No units to chart yet.</div>
          )}
        </Card>
      </div>

      {/* Members of the selected unit */}
      {selectedUnit && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex flex-wrap items-center gap-2">
                <Users size={15} aria-hidden="true" /> Members of
                <span className="text-[var(--text-primary)]">{selectedUnit.name}</span>
                <TypeBadge type={selectedUnit.unit_type} />
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {!membersKnown ? 'Members could not be read.'
                  : unitMembers.length === 0 ? 'No users assigned to this unit yet.'
                    : `${unitMembers.filter((m) => m._active).length} active of ${unitMembers.length} assignment${unitMembers.length === 1 ? '' : 's'}.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button type="button" onClick={exportMembers} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5" disabled={!unitMembers.length}>
                <FileSpreadsheet size={14} aria-hidden="true" /> Excel
              </button>
              <button type="button" onClick={openAssignCreate} className="btn-primary text-sm min-h-[44px] inline-flex items-center gap-1.5" disabled={notProvisioned || !membersKnown}>
                <UserPlus size={14} aria-hidden="true" /> Assign user
              </button>
              <button type="button" onClick={() => selectUnit(null)} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5">
                <X size={14} aria-hidden="true" /> Close
              </button>
            </div>
          </div>
          <EnterpriseTable
            columns={memberColumns}
            data={unitMembers}
            getRowId={(m) => String(m.id)}
            error={sideErrors.assignments || null}
            onRetry={load}
            enableGlobalFilter={unitMembers.length > 10}
            searchPlaceholder="Search members"
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="Assign a user to give them a place in this unit."
          />
        </Card>
      )}

      {/* Coverage (read-only preview of section 3 scope resolution) */}
      {rows !== null && membersKnown && coverage.length > 0 && (
        <Card>
          <CardHeader
            title="User coverage"
            icon={Users}
            description="Effective reach = units a user is assigned to, plus every unit beneath them. This is a preview only. No access is scoped by unit yet."
            actions={<span className="text-xs text-[var(--text-muted)]">{coverage.length} user{coverage.length === 1 ? '' : 's'} with active assignments</span>}
          />
          <EnterpriseTable
            columns={coverageColumns}
            data={coverage}
            getRowId={(c) => String(c.userId)}
            searchPlaceholder="Search users"
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No users with active assignments."
          />
        </Card>
      )}

      {/* Filters + unit register */}
      <Card className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="oh-search" className="text-xs text-[var(--text-muted)]">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="oh-search" type="search" className="input pl-9 w-full min-h-[44px]" placeholder="Unit, code, country, site ref or parent" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="oh-type" className="text-xs text-[var(--text-muted)]">Type</label>
            <select id="oh-type" className="input min-h-[44px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {UNIT_TYPES.map((t) => <option key={t} value={t}>{UNIT_TYPE_LABELS[t] || t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="oh-status" className="text-xs text-[var(--text-muted)]">Status</label>
            <select id="oh-status" className="input min-h-[44px]" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="oh-staffing" className="text-xs text-[var(--text-muted)]">Staffing</label>
            <select id="oh-staffing" className="input min-h-[44px]" value={staffingFilter} onChange={(e) => setStaffingFilter(e.target.value)} disabled={!membersKnown}>
              <option value="">Any staffing</option>
              <option value="staffed">Has an active member</option>
              <option value="unstaffed">No active member</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]" aria-live="polite">
          <span>{filtered.length} of {kpis.total} units</span>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-xs min-h-[36px] px-3 inline-flex items-center gap-1">
              <X size={12} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      </Card>

      <EnterpriseTable
        columns={unitColumns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={error || null}
        onRetry={load}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        initialPageSize={25}
        onRowClick={(r) => selectUnit(r)}
        emptyMessage={hasFilters ? 'No units match these filters.' : notProvisioned ? 'Enable the module to start building your hierarchy.' : 'No units yet. Create your first unit.'}
      />

      {/* Create / Edit modal. The submit button STAYS inside its <form> rather
          than moving to Modal's footer: the footer sits outside the form
          element, so the button would need a `form` attribute association - a
          behaviour change, not a migration. The old backdrop handler's
          in-flight guard already lives inside `closeModal`, so Escape, the
          backdrop and the X now share one guarded close and cannot diverge. */}
      {showModal && (
        <Modal
          open
          onClose={closeModal}
          size="lg"
          title={editing ? 'Edit unit' : 'New organisation unit'}
        >
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="oh-f-name">Unit name</label>
                <input id="oh-f-name" className="input w-full" placeholder="e.g. Eastern Region" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="oh-f-type">Type</label>
                <select id="oh-f-type" className="input w-full" value={form.unit_type} onChange={(e) => set('unit_type', e.target.value)}>
                  <option value="">Select type</option>
                  {UNIT_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t]?.label || t}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="oh-f-parent">Parent unit (optional)</label>
                <select id="oh-f-parent" className="input w-full" value={form.parent_id} onChange={(e) => set('parent_id', e.target.value)}>
                  <option value="">None (top level)</option>
                  {parentOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}{o.type ? `, ${TYPE_META[o.type]?.label || o.type}` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="oh-f-code">Code (optional)</label>
                <input id="oh-f-code" className="input w-full" placeholder="e.g. ER-01" value={form.code} maxLength={60} onChange={(e) => set('code', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label" htmlFor="oh-f-country">Country (optional)</label>
                <input id="oh-f-country" className="input w-full" placeholder="e.g. Saudi Arabia" value={form.country} maxLength={120} onChange={(e) => set('country', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="oh-f-site">Site ref (optional)</label>
                <input id="oh-f-site" className="input w-full" placeholder="e.g. SITE-204" value={form.site_ref} maxLength={200} onChange={(e) => set('site_ref', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="oh-f-sort">Sort order (optional)</label>
                <input id="oh-f-sort" className="input w-full" type="number" step="1" placeholder="0" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="oh-f-notes">Notes (optional)</label>
              <textarea id="oh-f-notes" className="input w-full min-h-[70px] resize-y" placeholder="e.g. covers all eastern-province depots" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" className="accent-indigo-500" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              Active unit
            </label>

            {formError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                {saving ? 'Saving' : editing ? 'Save changes' : 'Create unit'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Assign / edit member modal. Same in-flight guard, now shared by all
          three close paths through `closeAssignModal`; the unit name keeps its
          icon by riding Modal's `subtitle` slot. */}
      {showAssignModal && assignForm && (
        <Modal
          open
          onClose={closeAssignModal}
          size="md"
          title={editingAssignment ? 'Edit assignment' : 'Assign user'}
          subtitle={<span className="inline-flex items-center gap-1.5"><Network size={12} className="opacity-60" /> {selectedUnit?.name}</span>}
        >
          <form onSubmit={submitAssignment} className="space-y-4">
            <div>
              <label className="label" htmlFor="oh-a-user">User</label>
              {editingAssignment ? (
                <div className="input w-full flex items-center gap-2 !cursor-default">
                  <span className="font-medium text-[var(--text-primary)]">{userLabel(assignForm.user_id).name}</span>
                  {userLabel(assignForm.user_id).sub && <span className="text-[11px] text-[var(--text-muted)]">{userLabel(assignForm.user_id).sub}</span>}
                </div>
              ) : (
                <select id="oh-a-user" className="input w-full" value={assignForm.user_id} onChange={(e) => setAssign('user_id', e.target.value)}>
                  <option value="">Select a user</option>
                  {assignableProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {(p.full_name || p.username || p.email || 'Unnamed user')}{p.email ? `, ${p.email}` : (p.role ? `, ${p.role}` : '')}
                    </option>
                  ))}
                </select>
              )}
              {!editingAssignment && assignableProfiles.length === 0 && (
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Every known user is already assigned to this unit.</p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="oh-a-role">Role at this unit (optional)</label>
              <input id="oh-a-role" className="input w-full" placeholder="e.g. Branch Manager" value={assignForm.role} maxLength={80} onChange={(e) => setAssign('role', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="oh-a-start">Starts (optional)</label>
                <input id="oh-a-start" className="input w-full" type="date" value={assignForm.starts_at} onChange={(e) => setAssign('starts_at', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="oh-a-end">Ends (optional)</label>
                <input id="oh-a-end" className="input w-full" type="date" value={assignForm.ends_at} onChange={(e) => setAssign('ends_at', e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" className="accent-amber-500" checked={assignForm.is_primary} onChange={(e) => setAssign('is_primary', e.target.checked)} />
              <Star size={13} className="text-amber-400" /> Primary unit for this user
            </label>

            {assignError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {assignError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeAssignModal} className="btn-secondary text-sm" disabled={assignSaving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={assignSaving || (!editingAssignment && !assignForm.user_id)}>
                {assignSaving ? 'Saving' : editingAssignment ? 'Save changes' : 'Assign user'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Remove assignment confirm. No form here, so the actions belong in
          Modal's pinned footer. The backdrop's `!removing` guard moves onto
          `onClose`, which now also governs Escape and the X - the old markup
          had no close button at all, so a keyboard user could only leave by
          pressing one of the two buttons. */}
      {confirmRemove && (
        <Modal
          open
          onClose={() => { if (!removing) setConfirmRemove(null) }}
          size="sm"
          title="Remove this assignment?"
          footer={(
            <>
              <button onClick={() => setConfirmRemove(null)} className="btn-secondary text-sm" disabled={removing}>Cancel</button>
              <button onClick={doRemoveAssignment} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={removing}>
                <Trash2 size={14} /> {removing ? 'Removing' : 'Remove'}
              </button>
            </>
          )}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
            <p className="text-sm text-[var(--text-muted)]">
              {userLabel(confirmRemove.user_id).name} will no longer be a member of {selectedUnit?.name}. This cannot be undone.
            </p>
          </div>
        </Modal>
      )}

      {/* Delete confirm. The consequence line is the affordance that makes this
          dialog honest - child units are re-parented and their assignments are
          removed - so it is carried over word for word. */}
      {confirmDelete && (
        <Modal
          open
          onClose={() => { if (!deleting) setConfirmDelete(null) }}
          size="sm"
          title="Delete this unit?"
          footer={(
            <>
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting' : 'Delete'}
              </button>
            </>
          )}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
            <p className="text-sm text-[var(--text-muted)]">
              {confirmDelete.name || 'Unit'}{confirmDelete.code ? `, #${confirmDelete.code}` : ''}. Child units become root-level; their user assignments are removed. This cannot be undone.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
