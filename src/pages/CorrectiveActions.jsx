import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { correctiveActions } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  Plus, Save, X, CheckCircle, Clock, AlertCircle, Download, FileText,
  Camera, ClipboardCheck, Search, LayoutList, LayoutGrid, ChevronDown,
  TrendingUp, AlertTriangle, Timer, Filter, BarChart2, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatDate } from '../lib/formatters'
import { RISK_BADGE_DARK } from '../lib/formatters'

// ── Constants ──────────────────────────────────────────────────────────────────
const STATUS_META = {
  Open:          { icon: AlertCircle,  color: 'text-red-400',    bg: 'bg-red-900/30 border-red-700/50',    pill: 'bg-red-900/40 text-red-300 border-red-700/50' },
  'In Progress': { icon: Clock,        color: 'text-yellow-400', bg: 'bg-yellow-900/30 border-yellow-700/50', pill: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50' },
  Closed:        { icon: CheckCircle,  color: 'text-green-400',  bg: 'bg-green-900/30 border-green-700/50',  pill: 'bg-green-900/40 text-green-300 border-green-700/50' },
}

const PRIORITY_BADGE = {
  High:   RISK_BADGE_DARK.Critical,
  Medium: RISK_BADGE_DARK.Medium,
  Low:    RISK_BADGE_DARK.Low,
}

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 }

const EMPTY_FORM = {
  title: '', priority: 'Medium', site: '', description: '', assigned_to: '',
  status: 'Open', asset_no: '', tyre_serial: '', root_cause: '', due_date: '',
  photo_data: null,
}

const ROOT_CAUSES = [
  'Under Inflation', 'Over Inflation', 'Alignment Issue', 'Overloading',
  'Driver Behavior', 'Road Damage', 'Mechanical Fault', 'Mounting Error',
  'Wear Limit Reached', 'Other',
]

// ── Helpers ────────────────────────────────────────────────────────────────────
function overdueDays(due_date, status) {
  if (!due_date || status === 'Closed') return null
  const days = Math.floor((Date.now() - new Date(due_date)) / 86_400_000)
  return days > 0 ? days : null
}

function daysOpen(created_at, closed_at) {
  const end = closed_at ? new Date(closed_at) : new Date()
  return Math.max(0, Math.floor((end - new Date(created_at)) / 86_400_000))
}

function avgDaysToClose(actions) {
  const closed = actions.filter(a => a.status === 'Closed' && a.closed_at && a.created_at)
  if (!closed.length) return null
  const total = closed.reduce((s, a) => s + daysOpen(a.created_at, a.closed_at), 0)
  return Math.round(total / closed.length)
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color = 'text-blue-400', onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 min-w-[130px] p-4 rounded-xl border transition-all text-left ${
        active ? 'bg-blue-900/30 border-blue-600/60 ring-1 ring-blue-500/30' : 'card hover:border-gray-600'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
          <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
          {sub !== undefined && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
        </div>
        {Icon && <Icon size={20} className={`${color} opacity-60 flex-shrink-0 mt-0.5`} />}
      </div>
    </button>
  )
}

function RootCauseBar({ actions }) {
  const map = useMemo(() => {
    const m = {}
    actions.filter(a => a.root_cause).forEach(a => { m[a.root_cause] = (m[a.root_cause] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [actions])

  if (!map.length) return null
  const max = map[0][1]

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 size={14} className="text-blue-400" />
        <span className="text-sm font-semibold text-white">Root Cause Distribution</span>
        <span className="text-xs text-gray-500 ml-auto">{actions.filter(a => a.root_cause).length} with cause</span>
      </div>
      <div className="space-y-2">
        {map.map(([cause, count]) => (
          <div key={cause} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-32 truncate flex-shrink-0">{cause}</span>
            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-600 to-blue-500 rounded-full transition-all"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-6 text-right">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ActionCard({ a, onEdit, onStatusChange, country }) {
  const od = overdueDays(a.due_date, a.status)
  const meta = STATUS_META[a.status] ?? STATUS_META.Open
  const Icon = meta.icon

  return (
    <div className={`card transition-all hover:border-gray-600 ${od ? 'border-red-800/60' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        {/* Left */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon size={14} className={meta.color} />
            <h3 className="font-semibold text-white text-sm">
              {a.title}
              {a.photo_data && <Camera className="inline w-3 h-3 ml-1.5 text-gray-500" title="Has photo" />}
            </h3>
            <span className={`badge text-xs px-2 py-0.5 rounded-full border font-medium ${PRIORITY_BADGE[a.priority]}`}>
              {a.priority}
            </span>
            {od && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 border border-red-700/50 font-medium">
                {od}d overdue
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-400">
            {a.site        && <span>📍 {a.site}</span>}
            {a.assigned_to && <span>👤 {a.assigned_to}</span>}
            {a.asset_no    && <span>🚛 {a.asset_no}</span>}
            {a.tyre_serial && <span>🔵 {a.tyre_serial}</span>}
            {a.due_date    && (
              <span className={od ? 'text-red-400' : ''}>
                📅 Due: {formatDate(a.due_date, country)}
              </span>
            )}
            <span className="text-gray-600">
              {daysOpen(a.created_at, a.closed_at)}d {a.status === 'Closed' ? 'to close' : 'open'}
            </span>
          </div>

          {a.description && (
            <p className="text-xs text-gray-500 mt-2 line-clamp-1">{a.description}</p>
          )}
          {a.root_cause && (
            <span className="inline-block mt-1.5 text-xs px-2 py-0.5 rounded bg-indigo-900/30 text-indigo-300 border border-indigo-700/30">
              ⚙ {a.root_cause}
            </span>
          )}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={a.status}
            onChange={e => onStatusChange(a.id, e.target.value)}
            className={`text-xs border rounded-md px-2 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-colors ${meta.bg}`}
          >
            <option value="Open">Open</option>
            <option value="In Progress">In Progress</option>
            <option value="Closed">Closed</option>
          </select>
          <button onClick={() => onEdit(a)} className="text-xs text-gray-400 hover:text-blue-400 transition-colors px-2 py-1 rounded border border-gray-700 hover:border-blue-600/50">
            Edit
          </button>
        </div>
      </div>
    </div>
  )
}

function TableRow({ a, onEdit, onStatusChange, country }) {
  const od = overdueDays(a.due_date, a.status)
  const meta = STATUS_META[a.status] ?? STATUS_META.Open
  const Icon = meta.icon

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className={meta.color} />
          <span className="text-sm text-white font-medium">{a.title}</span>
          {a.photo_data && <Camera size={10} className="text-gray-600" />}
        </div>
        {a.root_cause && (
          <span className="text-xs text-indigo-400 opacity-70">{a.root_cause}</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className={`badge text-xs px-2 py-0.5 rounded-full border ${PRIORITY_BADGE[a.priority]}`}>{a.priority}</span>
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-400">{a.site || '-'}</td>
      <td className="px-3 py-2.5 text-xs text-gray-400">{a.assigned_to || '-'}</td>
      <td className="px-3 py-2.5 text-xs text-gray-400">{a.asset_no || '-'}</td>
      <td className="px-3 py-2.5 text-xs">
        {od
          ? <span className="text-red-400">{od}d overdue</span>
          : a.due_date ? <span className="text-gray-400">{formatDate(a.due_date, country)}</span>
          : <span className="text-gray-600">-</span>
        }
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-500">{daysOpen(a.created_at, a.closed_at)}d</td>
      <td className="px-3 py-2.5">
        <select
          value={a.status}
          onChange={e => onStatusChange(a.id, e.target.value)}
          className={`text-xs border rounded px-1.5 py-0.5 cursor-pointer focus:outline-none ${meta.bg}`}
        >
          <option value="Open">Open</option>
          <option value="In Progress">In Progress</option>
          <option value="Closed">Closed</option>
        </select>
      </td>
      <td className="px-3 py-2.5">
        <button onClick={() => onEdit(a)} className="text-xs text-gray-400 hover:text-blue-400 transition-colors">Edit</button>
      </td>
    </tr>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CorrectiveActions() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()

  const [actions, setActions]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Filters
  const [search, setSearch]               = useState('')
  const [statusFilter, setStatusFilter]   = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [siteFilter, setSiteFilter]       = useState('')
  const [overdueOnly, setOverdueOnly]     = useState(false)
  const [sortBy, setSortBy]               = useState('created_at')

  // UI
  const [viewMode, setViewMode]   = useState('cards')
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [editId, setEditId]       = useState(null)
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState('')
  const [showAnalytics, setShowAnalytics] = useState(false)

  const photoRef = useRef(null)

  // ── Data ──────────────────────────────────────────────────────────────────────
  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    let data = []
    try { data = await correctiveActions.listCorrectiveActions({ country: activeCountry }) } catch { data = [] }
    setActions(data ?? [])
    quiet ? setRefreshing(false) : setLoading(false)
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Derived ───────────────────────────────────────────────────────────────────
  const sites = useMemo(() =>
    [...new Set(actions.map(a => a.site).filter(Boolean))].sort(),
    [actions]
  )

  const counts = useMemo(() => {
    const c = { Open: 0, 'In Progress': 0, Closed: 0 }
    actions.forEach(a => { if (c[a.status] !== undefined) c[a.status]++ })
    return c
  }, [actions])

  const overdueCount = useMemo(() =>
    actions.filter(a => overdueDays(a.due_date, a.status) !== null).length,
    [actions]
  )

  const avgClose = useMemo(() => avgDaysToClose(actions), [actions])

  const filtered = useMemo(() => {
    let arr = actions
    if (statusFilter)   arr = arr.filter(a => a.status === statusFilter)
    if (priorityFilter) arr = arr.filter(a => a.priority === priorityFilter)
    if (siteFilter)     arr = arr.filter(a => a.site === siteFilter)
    if (overdueOnly)    arr = arr.filter(a => overdueDays(a.due_date, a.status) !== null)
    if (search) {
      const q = search.toLowerCase()
      arr = arr.filter(a =>
        a.title?.toLowerCase().includes(q) ||
        a.assigned_to?.toLowerCase().includes(q) ||
        a.asset_no?.toLowerCase().includes(q) ||
        a.tyre_serial?.toLowerCase().includes(q) ||
        a.site?.toLowerCase().includes(q) ||
        a.root_cause?.toLowerCase().includes(q)
      )
    }
    // Sort
    return [...arr].sort((a, b) => {
      if (sortBy === 'priority') return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      if (sortBy === 'due_date') return (a.due_date ?? 'z').localeCompare(b.due_date ?? 'z')
      if (sortBy === 'overdue') {
        const oa = overdueDays(a.due_date, a.status) ?? 0
        const ob = overdueDays(b.due_date, b.status) ?? 0
        return ob - oa
      }
      return new Date(b.created_at) - new Date(a.created_at)
    })
  }, [actions, statusFilter, priorityFilter, siteFilter, overdueOnly, search, sortBy])

  // ── Mutations ─────────────────────────────────────────────────────────────────
  function startAdd() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setShowForm(true)
    setFormError('')
  }

  function startEdit(a) {
    setForm({
      title:        a.title,
      priority:     a.priority,
      site:         a.site ?? '',
      description:  a.description ?? '',
      assigned_to:  a.assigned_to ?? '',
      status:       a.status,
      asset_no:     a.asset_no ?? '',
      tyre_serial:  a.tyre_serial ?? '',
      root_cause:   a.root_cause ?? '',
      due_date:     a.due_date ? a.due_date.split('T')[0] : '',
      photo_data:   a.photo_data ?? null,
    })
    setEditId(a.id)
    setShowForm(true)
    setFormError('')
  }

  async function save(e) {
    e.preventDefault()
    if (!form.title.trim()) { setFormError('Title is required'); return }
    setSaving(true)
    setFormError('')
    const payload = {
      ...form,
      due_date:    form.due_date || null,
      created_by:  editId ? undefined : profile?.id,
      ...(form.status === 'Closed'
        ? { closed_by: profile?.id, closed_at: new Date().toISOString() }
        : { closed_by: null, closed_at: null }),
    }
    try {
      if (editId) await correctiveActions.updateCorrectiveAction(editId, payload)
      else await correctiveActions.createCorrectiveAction(payload)
    } catch (err) { setFormError(err.message); setSaving(false); return }
    setShowForm(false)
    load(true)
    setSaving(false)
  }

  async function handleStatusChange(id, newStatus) {
    try {
      await correctiveActions.updateCorrectiveAction(id, {
        status: newStatus,
        ...(newStatus === 'Closed'
          ? { closed_by: profile?.id, closed_at: new Date().toISOString() }
          : { closed_by: null, closed_at: null }),
      })
    } catch { /* original ignored update errors here */ }
    load(true)
  }

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setForm(f => ({ ...f, photo_data: ev.target.result }))
    reader.readAsDataURL(file)
  }

  // ── Export ────────────────────────────────────────────────────────────────────
  function doExcelExport() {
    exportToExcel(
      filtered,
      ['title', 'priority', 'status', 'site', 'assigned_to', 'asset_no', 'tyre_serial', 'root_cause', 'due_date', 'created_at'],
      ['Title', 'Priority', 'Status', 'Site', 'Assigned To', 'Asset No', 'Tyre Serial', 'Root Cause', 'Due Date', 'Created'],
      'TyrePulse_CorrectiveActions'
    )
  }

  function doPdfExport() {
    exportToPdf(
      filtered,
      [
        { key: 'title',       header: 'Title' },
        { key: 'priority',    header: 'Priority' },
        { key: 'status',      header: 'Status' },
        { key: 'site',        header: 'Site' },
        { key: 'assigned_to', header: 'Assigned To' },
        { key: 'asset_no',    header: 'Asset' },
        { key: 'root_cause',  header: 'Root Cause' },
        { key: 'due_date',    header: 'Due Date' },
      ],
      'Corrective Actions Register',
      'TyrePulse_CorrectiveActions',
      'landscape'
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <PageHeader
        title="Corrective Actions"
        subtitle={`${actions.length} total · ${counts['Open']} open · ${overdueCount > 0 ? `${overdueCount} overdue` : 'none overdue'}`}
        icon={ClipboardCheck}
      />

      {/* KPI strip */}
      <div className="flex gap-3 flex-wrap">
        <KpiCard
          label="Open" value={counts.Open}
          icon={AlertCircle} color="text-red-400"
          active={statusFilter === 'Open'}
          onClick={() => setStatusFilter(statusFilter === 'Open' ? '' : 'Open')}
        />
        <KpiCard
          label="In Progress" value={counts['In Progress']}
          icon={Clock} color="text-yellow-400"
          active={statusFilter === 'In Progress'}
          onClick={() => setStatusFilter(statusFilter === 'In Progress' ? '' : 'In Progress')}
        />
        <KpiCard
          label="Closed" value={counts.Closed}
          icon={CheckCircle} color="text-green-400"
          active={statusFilter === 'Closed'}
          onClick={() => setStatusFilter(statusFilter === 'Closed' ? '' : 'Closed')}
        />
        <KpiCard
          label="Overdue" value={overdueCount}
          sub={overdueCount > 0 ? 'need attention' : 'on track'}
          icon={AlertTriangle} color={overdueCount > 0 ? 'text-red-400' : 'text-gray-500'}
          active={overdueOnly}
          onClick={() => setOverdueOnly(!overdueOnly)}
        />
        {avgClose !== null && (
          <KpiCard
            label="Avg Resolution" value={`${avgClose}d`}
            sub="time to close"
            icon={Timer} color="text-blue-400"
          />
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input pl-9 text-sm"
            placeholder="Search title, asset, site…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Priority filter */}
        <div className="flex items-center gap-1">
          {['High', 'Medium', 'Low'].map(p => (
            <button key={p}
              onClick={() => setPriorityFilter(priorityFilter === p ? '' : p)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                priorityFilter === p ? PRIORITY_BADGE[p] + ' ring-1 ring-white/20' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
              }`}
            >{p}</button>
          ))}
        </div>

        {/* Site filter */}
        {sites.length > 0 && (
          <select
            value={siteFilter}
            onChange={e => setSiteFilter(e.target.value)}
            className="input text-sm py-1.5 pr-7 max-w-[160px]"
          >
            <option value="">All Sites</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        {/* Sort */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="input text-sm py-1.5 max-w-[150px]"
        >
          <option value="created_at">Newest first</option>
          <option value="priority">By priority</option>
          <option value="due_date">By due date</option>
          <option value="overdue">Most overdue</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          {/* Analytics toggle */}
          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            className={`btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 ${showAnalytics ? 'text-blue-400 border-blue-600/50' : ''}`}
          >
            <BarChart2 size={14} /> Analytics
          </button>

          {/* View mode */}
          <button
            onClick={() => setViewMode('cards')}
            className={`p-1.5 rounded border transition-colors ${viewMode === 'cards' ? 'bg-blue-600/20 border-blue-600/50 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`p-1.5 rounded border transition-colors ${viewMode === 'table' ? 'bg-blue-600/20 border-blue-600/50 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}
          >
            <LayoutList size={15} />
          </button>

          {/* Refresh */}
          <button
            onClick={() => load(true)}
            className="p-1.5 rounded border border-gray-700 bg-gray-800 text-gray-400 hover:text-white transition-colors"
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>

          {/* Exports */}
          <button onClick={doExcelExport} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
            <Download size={14} /> Excel
          </button>
          <button onClick={doPdfExport} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
            <FileText size={14} /> PDF
          </button>

          {/* New */}
          <button onClick={startAdd} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> New Action
          </button>
        </div>
      </div>

      {/* Active filter indicators */}
      {(search || statusFilter || priorityFilter || siteFilter || overdueOnly) && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Filter size={12} className="text-gray-500" />
          <span className="text-gray-500">Filters:</span>
          {statusFilter   && <Chip label={statusFilter}   onRemove={() => setStatusFilter('')} />}
          {priorityFilter && <Chip label={priorityFilter} onRemove={() => setPriorityFilter('')} />}
          {siteFilter     && <Chip label={siteFilter}     onRemove={() => setSiteFilter('')} />}
          {overdueOnly    && <Chip label="Overdue only"   onRemove={() => setOverdueOnly(false)} />}
          {search         && <Chip label={`"${search}"`}  onRemove={() => setSearch('')} />}
          <button
            onClick={() => { setSearch(''); setStatusFilter(''); setPriorityFilter(''); setSiteFilter(''); setOverdueOnly(false) }}
            className="text-gray-500 hover:text-red-400 transition-colors ml-1"
          >Clear all</button>
          <span className="ml-auto text-gray-500">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Analytics panel */}
      {showAnalytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RootCauseBar actions={actions} />
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={14} className="text-blue-400" />
              <span className="text-sm font-semibold text-white">Resolution Performance</span>
            </div>
            <div className="space-y-2">
              {[
                { label: 'Open', count: counts.Open, pct: actions.length ? Math.round(counts.Open / actions.length * 100) : 0, color: 'bg-red-500' },
                { label: 'In Progress', count: counts['In Progress'], pct: actions.length ? Math.round(counts['In Progress'] / actions.length * 100) : 0, color: 'bg-yellow-500' },
                { label: 'Closed', count: counts.Closed, pct: actions.length ? Math.round(counts.Closed / actions.length * 100) : 0, color: 'bg-green-500' },
              ].map(row => (
                <div key={row.label} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-20">{row.label}</span>
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${row.color} rounded-full`} style={{ width: `${row.pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 w-16 text-right">{row.count} ({row.pct}%)</span>
                </div>
              ))}
              {avgClose !== null && (
                <p className="text-xs text-gray-500 pt-2 border-t border-gray-800 mt-2">
                  Average time to close: <span className="text-blue-400 font-medium">{avgClose} days</span>
                </p>
              )}
              <p className="text-xs text-gray-500">
                Overdue rate: <span className={`font-medium ${overdueCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {counts.Open + counts['In Progress'] > 0
                    ? Math.round(overdueCount / (counts.Open + counts['In Progress']) * 100)
                    : 0}%
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState hasFilters={!!(search || statusFilter || priorityFilter || siteFilter || overdueOnly)} onAdd={startAdd} />
      ) : viewMode === 'cards' ? (
        <div className="space-y-2.5">
          {filtered.map(a => (
            <ActionCard key={a.id} a={a} country={activeCountry} onEdit={startEdit} onStatusChange={handleStatusChange} />
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-800/60 border-b border-gray-700">
                <tr>
                  {['Title / Root Cause', 'Priority', 'Site', 'Assigned To', 'Asset', 'Due Date', 'Age', 'Status', ''].map(h => (
                    <th key={h} className="px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <TableRow key={a.id} a={a} country={activeCountry} onEdit={startEdit} onStatusChange={handleStatusChange} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
            {filtered.length} action{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto"
          onClick={() => setShowForm(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg p-6 my-8 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <ClipboardCheck size={16} className="text-blue-400" />
                {editId ? 'Edit Corrective Action' : 'New Corrective Action'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            {formError && (
              <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2.5 mb-4 text-sm">
                {formError}
              </div>
            )}

            <form onSubmit={save} className="space-y-3">
              <div>
                <label className="label">Title *</label>
                <input
                  className="input"
                  placeholder="Describe the corrective action…"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Priority</label>
                  <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                    {['High', 'Medium', 'Low'].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {['Open', 'In Progress', 'Closed'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Site</label>
                  <input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
                    list="ca-sites" placeholder="Enter or pick site" />
                  <datalist id="ca-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
                </div>
                <div>
                  <label className="label">Due Date</label>
                  <input type="date" className="input" value={form.due_date}
                    onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Assigned To</label>
                  <input className="input" value={form.assigned_to}
                    onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Asset No</label>
                  <input className="input" value={form.asset_no}
                    onChange={e => setForm(f => ({ ...f, asset_no: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="label">Tyre Serial</label>
                <input className="input" value={form.tyre_serial}
                  onChange={e => setForm(f => ({ ...f, tyre_serial: e.target.value }))}
                  placeholder="Linked tyre serial number" />
              </div>

              <div>
                <label className="label">Root Cause</label>
                <select className="input" value={form.root_cause}
                  onChange={e => setForm(f => ({ ...f, root_cause: e.target.value }))}>
                  <option value="">Select root cause…</option>
                  {ROOT_CAUSES.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label className="label">Description</label>
                <textarea className="input" rows={3} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Detailed description of the issue and actions taken…" />
              </div>

              {/* Photo */}
              <div>
                <label className="label">Photo / Evidence</label>
                <div className="flex items-center gap-3">
                  <button type="button"
                    onClick={() => photoRef.current?.click()}
                    className="btn-secondary text-sm flex items-center gap-2 px-3 py-2">
                    <Camera size={14} /> {form.photo_data ? 'Change Photo' : 'Attach Photo'}
                  </button>
                  {form.photo_data && (
                    <button type="button"
                      onClick={() => setForm(f => ({ ...f, photo_data: null }))}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors">
                      Remove
                    </button>
                  )}
                  <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                </div>
                {form.photo_data && (
                  <img src={form.photo_data} alt="Evidence" className="mt-2 rounded-lg max-h-40 border border-gray-700 object-cover w-full" />
                )}
              </div>

              <div className="flex gap-3 pt-2 border-t border-gray-800">
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Save size={15} /> {saving ? 'Saving…' : 'Save Action'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Util sub-components ────────────────────────────────────────────────────────
function Chip({ label, onRemove }) {
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-900/30 text-blue-300 border border-blue-700/40 rounded-full">
      {label}
      <button onClick={onRemove} className="hover:text-red-400 transition-colors"><X size={10} /></button>
    </span>
  )
}

function LoadingState() {
  return (
    <div className="space-y-2.5">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="card animate-pulse h-20 bg-gray-800/40" />
      ))}
    </div>
  )
}

function EmptyState({ hasFilters, onAdd }) {
  return (
    <div className="card text-center py-16">
      <ClipboardCheck size={40} className="mx-auto text-gray-700 mb-3" />
      <p className="text-gray-400 font-medium">
        {hasFilters ? 'No actions match the current filters' : 'No corrective actions yet'}
      </p>
      <p className="text-gray-600 text-sm mt-1">
        {hasFilters ? 'Try adjusting or clearing the filters' : 'Create an action to track issues and resolutions'}
      </p>
      {!hasFilters && (
        <button onClick={onAdd} className="btn-primary mt-4 inline-flex items-center gap-2 text-sm">
          <Plus size={14} /> New Action
        </button>
      )}
    </div>
  )
}
