import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  LayoutDashboard, Plus, Trash2, Edit2, X, Save, Loader2, Star,
  Share2, Lock, ChevronUp, ChevronDown, AlertTriangle, RefreshCw,
  CircleDot, DollarSign, ShieldAlert, ClipboardCheck, Wrench, AlertOctagon,
  Radio, Activity, TrendingUp, PieChart, Eye, Pencil, CheckCircle,
} from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line, Doughnut } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import * as userDashboards from '../lib/api/userDashboards'
import { useAuth } from '../contexts/AuthContext'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ─── Widget catalog ───────────────────────────────────────────────────────────

const WIDGET_CATALOG = [
  { type: 'kpi_tyres_total',       kind: 'kpi',   label: 'Total Tyres',          desc: 'All tyre records in the fleet',        icon: CircleDot,      color: 'text-orange-400 bg-orange-500/20' },
  { type: 'kpi_spend_30d',         kind: 'kpi',   label: 'Tyre Spend (30d)',     desc: 'Cost of tyres issued last 30 days',    icon: DollarSign,     color: 'text-green-400 bg-green-500/20' },
  { type: 'kpi_high_risk',         kind: 'kpi',   label: 'High Risk Tyres',      desc: 'Tyres flagged as high risk',           icon: ShieldAlert,    color: 'text-red-400 bg-red-500/20' },
  { type: 'kpi_inspections_30d',   kind: 'kpi',   label: 'Inspections (30d)',    desc: 'Inspections scheduled last 30 days',   icon: ClipboardCheck, color: 'text-blue-400 bg-blue-500/20' },
  { type: 'kpi_open_workorders',   kind: 'kpi',   label: 'Open Work Orders',     desc: 'Open / in-progress work orders',       icon: Wrench,         color: 'text-yellow-400 bg-yellow-500/20' },
  { type: 'kpi_open_accidents',    kind: 'kpi',   label: 'Open Accidents',       desc: 'Accidents not yet closed',             icon: AlertOctagon,   color: 'text-purple-400 bg-purple-500/20' },
  { type: 'table_recent_events',      kind: 'table', label: 'Recent Events',       desc: 'Last 10 domain events',                icon: Radio,          color: 'text-teal-400 bg-teal-500/20' },
  { type: 'table_recent_inspections', kind: 'table', label: 'Recent Inspections',  desc: 'Last 10 inspections',                  icon: Activity,       color: 'text-blue-400 bg-blue-500/20' },
  { type: 'chart_spend_trend',     kind: 'chart', label: 'Spend Trend',          desc: 'Monthly tyre spend, last 6 months',    icon: TrendingUp,     color: 'text-green-400 bg-green-500/20' },
  { type: 'chart_risk_breakdown',  kind: 'chart', label: 'Risk Breakdown',       desc: 'Tyres by risk level (doughnut)',       icon: PieChart,       color: 'text-red-400 bg-red-500/20' },
]

const CATALOG_BY_TYPE = Object.fromEntries(WIDGET_CATALOG.map(w => [w.type, w]))

const SIZES = ['sm', 'md', 'lg', 'xl']
// Static class strings so Tailwind can see them at build time.
const SIZE_CLASS = {
  sm: 'col-span-1',
  md: 'col-span-1 md:col-span-2',
  lg: 'col-span-1 md:col-span-2 xl:col-span-3',
  xl: 'col-span-1 md:col-span-2 xl:col-span-4',
}
const MAX_WIDGETS = 40

const CHART_PALETTE = ['#f97316', '#22c55e', '#3b82f6', '#eab308', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899']

// ─── Data fetchers (one cheap query per widget; org scoping via RLS) ──────────

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

async function fetchCount(table, refine) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true })
  if (refine) q = refine(q)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function fetchWidgetData(type) {
  switch (type) {
    case 'kpi_tyres_total':
      return { value: await fetchCount('tyre_records') }
    case 'kpi_high_risk':
      return { value: await fetchCount('tyre_records', q => q.eq('risk_level', 'High')) }
    case 'kpi_inspections_30d':
      return { value: await fetchCount('inspections', q => q.gte('scheduled_date', daysAgoIso(30))) }
    case 'kpi_open_workorders':
      return { value: await fetchCount('work_orders', q => q.in('status', ['Open', 'In Progress', 'Awaiting Parts'])) }
    case 'kpi_open_accidents':
      return { value: await fetchCount('accidents', q => q.neq('status', 'Closed')) }
    case 'kpi_spend_30d': {
      const { data, error } = await supabase
        .from('tyre_records')
        .select('cost_per_tyre,qty')
        .gte('issue_date', daysAgoIso(30))
        .limit(5000)
      if (error) throw new Error(error.message)
      const total = (data || []).reduce(
        (s, r) => s + (Number(r.cost_per_tyre) || 0) * (Number(r.qty) || 1), 0)
      return { value: total, currency: true }
    }
    case 'table_recent_events': {
      const { data, error } = await supabase
        .from('domain_events')
        .select('id,event_type,entity_type,status,created_at')
        .order('id', { ascending: false })
        .limit(10)
      if (error) throw new Error(error.message)
      return {
        columns: ['Event', 'Entity', 'Status', 'When'],
        rows: (data || []).map(e => [
          e.event_type, e.entity_type || '—', e.status,
          e.created_at ? new Date(e.created_at).toLocaleString() : '—',
        ]),
      }
    }
    case 'table_recent_inspections': {
      const { data, error } = await supabase
        .from('inspections')
        .select('asset_no,inspection_type,status,site,scheduled_date')
        .order('scheduled_date', { ascending: false })
        .limit(10)
      if (error) throw new Error(error.message)
      return {
        columns: ['Asset', 'Type', 'Status', 'Site', 'Scheduled'],
        rows: (data || []).map(i => [
          i.asset_no || '—', i.inspection_type || '—', i.status || '—',
          i.site || '—', i.scheduled_date || '—',
        ]),
      }
    }
    case 'chart_spend_trend': {
      const since = new Date()
      since.setMonth(since.getMonth() - 5)
      since.setDate(1)
      const { data, error } = await supabase
        .from('tyre_records')
        .select('issue_date,cost_per_tyre,qty')
        .gte('issue_date', since.toISOString().slice(0, 10))
        .limit(10000)
      if (error) throw new Error(error.message)
      const months = []
      const d = new Date(since)
      for (let i = 0; i < 6; i++) {
        months.push(d.toISOString().slice(0, 7))
        d.setMonth(d.getMonth() + 1)
      }
      const sums = Object.fromEntries(months.map(m => [m, 0]))
      for (const r of data || []) {
        const m = (r.issue_date || '').slice(0, 7)
        if (m in sums) sums[m] += (Number(r.cost_per_tyre) || 0) * (Number(r.qty) || 1)
      }
      return { chart: 'line', labels: months, values: months.map(m => Math.round(sums[m])) }
    }
    case 'chart_risk_breakdown': {
      const { data, error } = await supabase
        .from('tyre_records')
        .select('risk_level')
        .not('risk_level', 'is', null)
        .limit(10000)
      if (error) throw new Error(error.message)
      const counts = {}
      for (const r of data || []) counts[r.risk_level] = (counts[r.risk_level] || 0) + 1
      const labels = Object.keys(counts)
      return { chart: 'doughnut', labels, values: labels.map(l => counts[l]) }
    }
    default:
      throw new Error(`Unknown widget type: ${type}`)
  }
}

// ─── Widget body ──────────────────────────────────────────────────────────────

function WidgetBody({ type }) {
  const meta = CATALOG_BY_TYPE[type]
  const [state, setState] = useState({ loading: true, error: null, data: null })

  const load = useCallback(async () => {
    setState({ loading: true, error: null, data: null })
    try {
      const data = await fetchWidgetData(type)
      setState({ loading: false, error: null, data })
    } catch (err) {
      setState({ loading: false, error: err.message || 'Failed to load', data: null })
    }
  }, [type])

  useEffect(() => { load() }, [load])

  if (state.loading) {
    return (
      <div className="animate-pulse space-y-2 p-4">
        <div className="h-4 w-1/3 bg-gray-700 rounded" />
        <div className="h-8 w-2/3 bg-gray-700 rounded" />
        {meta?.kind !== 'kpi' && <div className="h-24 w-full bg-gray-700/60 rounded" />}
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-5 text-center">
        <AlertTriangle className="w-5 h-5 text-red-400" />
        <p className="text-red-400 text-xs">{state.error}</p>
        <button onClick={load} className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors">
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    )
  }

  const { data } = state

  if (meta?.kind === 'kpi') {
    return (
      <div className="p-4">
        <p className="text-3xl font-bold text-white leading-none">
          {data.currency
            ? `SAR ${Math.round(data.value).toLocaleString()}`
            : Number(data.value).toLocaleString()}
        </p>
      </div>
    )
  }

  if (meta?.kind === 'table') {
    if (!data.rows.length) {
      return <p className="text-gray-500 text-xs p-4">No records found.</p>
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-700/60">
              {data.columns.map(c => <th key={c} className="px-3 py-2 font-semibold whitespace-nowrap">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} className="border-b border-gray-700/30 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5 text-gray-300 whitespace-nowrap max-w-[220px] truncate">{String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // charts
  if (!data.values.length || data.values.every(v => !v)) {
    return <p className="text-gray-500 text-xs p-4">No data for this period.</p>
  }
  if (data.chart === 'doughnut') {
    return (
      <div className="p-4 h-56">
        <Doughnut
          data={{
            labels: data.labels,
            datasets: [{ data: data.values, backgroundColor: CHART_PALETTE, borderWidth: 0 }],
          }}
          options={{
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 10, font: { size: 10 } } } },
          }}
        />
      </div>
    )
  }
  return (
    <div className="p-4 h-56">
      <Line
        data={{
          labels: data.labels,
          datasets: [{
            label: 'Spend', data: data.values,
            borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.15)',
            fill: true, tension: 0.35, pointRadius: 3,
          }],
        }}
        options={{
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          },
        }}
      />
    </div>
  )
}

// ─── Widget frame ─────────────────────────────────────────────────────────────

function WidgetFrame({ widget, editing, index, total, onSize, onMove, onRemove }) {
  const meta = CATALOG_BY_TYPE[widget.type]
  const Icon = meta?.icon || LayoutDashboard
  return (
    <div className={`${SIZE_CLASS[widget.size] || SIZE_CLASS.sm} bg-gray-800 border border-gray-700 rounded-xl overflow-hidden flex flex-col`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/60">
        <span className={`p-1.5 rounded-lg ${meta?.color || 'text-gray-400 bg-gray-700'}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <p className="text-white text-xs font-semibold truncate flex-1">{meta?.label || widget.type}</p>
        {editing && (
          <div className="flex items-center gap-1 shrink-0">
            <select
              value={widget.size}
              onChange={e => onSize(widget.id, e.target.value)}
              title="Widget size"
              className="bg-gray-900 border border-gray-700 rounded-md px-1 py-0.5 text-[10px] text-gray-300 focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
            >
              {SIZES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
            <button onClick={() => onMove(widget.id, -1)} disabled={index === 0} title="Move up"
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition-all">
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onMove(widget.id, 1)} disabled={index === total - 1} title="Move down"
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition-all">
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onRemove(widget.id)} title="Remove widget"
              className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-[64px]">
        <WidgetBody type={widget.type} />
      </div>
    </div>
  )
}

// ─── Name modal (create / rename) ─────────────────────────────────────────────

function NameModal({ title, initial = '', saving, onSave, onClose }) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState(null)
  function submit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    onSave(name.trim())
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-base">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <input
          autoFocus type="text" value={name}
          onChange={e => { setName(e.target.value); setError(null) }}
          placeholder="e.g. Fleet Overview"
          className={`w-full bg-gray-800 border rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${error ? 'border-red-500' : 'border-gray-700'}`}
        />
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
        <div className="flex gap-3 justify-end mt-5">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-all">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-lg disabled:opacity-50 transition-all shadow-lg shadow-orange-500/20">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardBuilder() {
  const { profile } = useAuth()
  const [dashboards, setDashboards] = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [layout, setLayout]         = useState({ widgets: [] })
  const [savedLayout, setSavedLayout] = useState('{"widgets":[]}')
  const [editing, setEditing]       = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [modal, setModal]           = useState(null) // null | 'create' | 'rename'

  const selected = dashboards.find(d => d.id === selectedId) || null
  const isOwn    = selected ? selected.user_id === profile?.id : false
  const dirty    = JSON.stringify(layout) !== savedLayout

  const fetchDashboards = useCallback(async (preferId) => {
    setLoading(true); setError(null)
    try {
      const rows = await userDashboards.listDashboards()
      setDashboards(rows || [])
      const pick =
        (preferId && rows?.find(d => d.id === preferId)) ||
        rows?.find(d => d.user_id === profile?.id && d.is_default) ||
        rows?.[0] || null
      setSelectedId(pick?.id ?? null)
      const l = pick?.layout && Array.isArray(pick.layout.widgets) ? pick.layout : { widgets: [] }
      setLayout(l)
      setSavedLayout(JSON.stringify(l))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { if (profile?.id) fetchDashboards() }, [profile?.id, fetchDashboards])

  function selectDashboard(d) {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    setSelectedId(d.id)
    const l = d.layout && Array.isArray(d.layout.widgets) ? d.layout : { widgets: [] }
    setLayout(l)
    setSavedLayout(JSON.stringify(l))
    setEditing(false)
  }

  // ── CRUD ────────────────────────────────────────────────────────────────
  async function handleCreate(name) {
    setSaving(true)
    try {
      const row = await userDashboards.createDashboard({
        user_id: profile.id, name, layout: { widgets: [] },
        is_default: dashboards.filter(d => d.user_id === profile.id).length === 0,
      })
      setModal(null)
      await fetchDashboards(row.id)
      setEditing(true)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  async function handleRename(name) {
    setSaving(true)
    try {
      await userDashboards.updateDashboard(selected.id, { name, updated_at: new Date().toISOString() })
      setModal(null)
      setDashboards(prev => prev.map(d => d.id === selected.id ? { ...d, name } : d))
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete dashboard "${selected.name}"?`)) return
    try {
      await userDashboards.deleteDashboard(selected.id)
      await fetchDashboards()
    } catch (err) { setError(err.message) }
  }

  async function handleSetDefault() {
    try {
      const prevDefault = dashboards.find(d => d.user_id === profile.id && d.is_default && d.id !== selected.id)
      if (prevDefault) await userDashboards.updateDashboard(prevDefault.id, { is_default: false })
      await userDashboards.updateDashboard(selected.id, { is_default: true })
      setDashboards(prev => prev.map(d => ({
        ...d,
        is_default: d.user_id === profile.id ? d.id === selected.id : d.is_default,
      })))
    } catch (err) { setError(err.message) }
  }

  async function handleShareToggle() {
    try {
      await userDashboards.updateDashboard(selected.id, { shared: !selected.shared })
      setDashboards(prev => prev.map(d => d.id === selected.id ? { ...d, shared: !selected.shared } : d))
    } catch (err) { setError(err.message) }
  }

  async function handleSaveLayout() {
    setSaving(true)
    try {
      await userDashboards.updateDashboard(selected.id, { layout, updated_at: new Date().toISOString() })
      setSavedLayout(JSON.stringify(layout))
      setDashboards(prev => prev.map(d => d.id === selected.id ? { ...d, layout } : d))
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  // ── Layout editing ──────────────────────────────────────────────────────
  function addWidget(type) {
    if (layout.widgets.length >= MAX_WIDGETS) {
      setError(`A dashboard holds at most ${MAX_WIDGETS} widgets.`)
      return
    }
    const kind = CATALOG_BY_TYPE[type]?.kind
    const size = kind === 'kpi' ? 'sm' : kind === 'chart' ? 'md' : 'lg'
    setLayout(l => ({ widgets: [...l.widgets, { id: crypto.randomUUID(), type, size, config: {} }] }))
  }

  function setSize(id, size) {
    setLayout(l => ({ widgets: l.widgets.map(w => w.id === id ? { ...w, size } : w) }))
  }

  function moveWidget(id, delta) {
    setLayout(l => {
      const ws = [...l.widgets]
      const i = ws.findIndex(w => w.id === id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= ws.length) return l
      ;[ws[i], ws[j]] = [ws[j], ws[i]]
      return { widgets: ws }
    })
  }

  function removeWidget(id) {
    setLayout(l => ({ widgets: l.widgets.filter(w => w.id !== id) }))
  }

  const ownCount = useMemo(() => dashboards.filter(d => d.user_id === profile?.id).length, [dashboards, profile?.id])

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="text-white space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-lg bg-orange-500/20">
              <LayoutDashboard className="w-5 h-5 text-orange-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">My Dashboards</h1>
          </div>
          <p className="text-gray-400 text-sm ml-11">Build personal dashboards from live fleet widgets</p>
        </div>
        <button
          onClick={() => setModal('create')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-500/25 transition-all whitespace-nowrap self-start"
        >
          <Plus className="w-4 h-4" /> New Dashboard
        </button>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
        </div>
      )}

      {/* ── No dashboards at all ── */}
      {!loading && dashboards.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-5">
          <div className="w-20 h-20 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
            <LayoutDashboard className="w-9 h-9 text-gray-500" />
          </div>
          <div className="text-center">
            <p className="text-gray-300 text-lg font-medium">No dashboards yet</p>
            <p className="text-gray-500 text-sm mt-1">Create a dashboard, then add KPI, table and chart widgets.</p>
            <button
              onClick={() => setModal('create')}
              className="mt-4 inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Create your first dashboard
            </button>
          </div>
        </div>
      )}

      {!loading && dashboards.length > 0 && (
        <>
          {/* ── Picker ── */}
          <div className="flex flex-wrap items-center gap-2">
            {dashboards.map(d => {
              const own = d.user_id === profile?.id
              const active = d.id === selectedId
              return (
                <button
                  key={d.id}
                  onClick={() => selectDashboard(d)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                    active
                      ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white hover:border-gray-600'
                  }`}
                >
                  {d.is_default && own && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />}
                  <span className="max-w-[160px] truncate">{d.name}</span>
                  {!own && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px]">
                      <Share2 className="w-2.5 h-2.5" /> Shared
                    </span>
                  )}
                  {own && d.shared && <Share2 className="w-3 h-3 text-blue-400" />}
                </button>
              )
            })}
          </div>

          {/* ── Toolbar for selected dashboard ── */}
          {selected && (
            <div className="flex flex-wrap items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5">
              <p className="text-sm font-semibold text-white mr-1 truncate max-w-[220px]">{selected.name}</p>
              {!isOwn && (
                <span className="inline-flex items-center gap-1 text-[11px] text-blue-300 bg-blue-500/15 px-2 py-0.5 rounded-full">
                  <Lock className="w-3 h-3" /> Read-only (shared with your organisation)
                </span>
              )}
              {isOwn && (
                <>
                  <button onClick={() => setEditing(e => !e)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      editing ? 'bg-orange-500/20 text-orange-300 border-orange-500/40' : 'text-gray-400 border-gray-700 hover:text-white'
                    }`}>
                    {editing ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                    {editing ? 'View mode' : 'Edit mode'}
                  </button>
                  {editing && (
                    <button onClick={() => setDrawerOpen(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 transition-all">
                      <Plus className="w-3.5 h-3.5" /> Add widget
                    </button>
                  )}
                  <button onClick={() => setModal('rename')} title="Rename"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-all">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleSetDefault} disabled={selected.is_default} title={selected.is_default ? 'Default dashboard' : 'Set as default'}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10 disabled:text-yellow-400 transition-all">
                    <Star className={`w-3.5 h-3.5 ${selected.is_default ? 'fill-yellow-400 text-yellow-400' : ''}`} />
                  </button>
                  <button onClick={handleShareToggle} title={selected.shared ? 'Stop sharing with organisation' : 'Share with organisation'}
                    className={`p-1.5 rounded-lg transition-all ${selected.shared ? 'text-blue-400 bg-blue-500/10' : 'text-gray-400 hover:text-blue-400 hover:bg-blue-500/10'}`}>
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleDelete} title="Delete dashboard"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    disabled={ownCount === 0}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    {dirty && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-yellow-300 bg-yellow-500/15 px-2 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3" /> Unsaved changes
                      </span>
                    )}
                    {!dirty && editing && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-green-300 bg-green-500/15 px-2 py-0.5 rounded-full">
                        <CheckCircle className="w-3 h-3" /> Saved
                      </span>
                    )}
                    <button onClick={handleSaveLayout} disabled={!dirty || saving}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 disabled:opacity-40 transition-all">
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Widget grid ── */}
          {selected && layout.widgets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 border border-dashed border-gray-700 rounded-2xl">
              <LayoutDashboard className="w-8 h-8 text-gray-600" />
              <p className="text-gray-400 text-sm">This dashboard is empty.</p>
              {isOwn && (
                <button
                  onClick={() => { setEditing(true); setDrawerOpen(true) }}
                  className="inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add your first widget
                </button>
              )}
            </div>
          )}

          {selected && layout.widgets.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {layout.widgets.map((w, i) => (
                <WidgetFrame
                  key={w.id}
                  widget={w}
                  editing={editing && isOwn}
                  index={i}
                  total={layout.widgets.length}
                  onSize={setSize}
                  onMove={moveWidget}
                  onRemove={removeWidget}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Widget catalog drawer ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-full max-w-sm h-full bg-gray-900 border-l border-gray-700 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-white font-semibold text-base">Widget catalog</h2>
              <button onClick={() => setDrawerOpen(false)} className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {WIDGET_CATALOG.map(w => {
                const Icon = w.icon
                return (
                  <button
                    key={w.type}
                    onClick={() => addWidget(w.type)}
                    className="w-full flex items-start gap-3 p-3.5 rounded-xl bg-gray-800 border border-gray-700 hover:border-orange-500/50 transition-all text-left group"
                  >
                    <span className={`shrink-0 mt-0.5 p-2 rounded-lg ${w.color}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-white text-sm font-medium group-hover:text-orange-400 transition-colors">{w.label}</span>
                      <span className="block text-gray-500 text-xs mt-0.5">{w.desc}</span>
                    </span>
                    <Plus className="w-4 h-4 text-gray-500 group-hover:text-orange-400 mt-1 transition-colors" />
                  </button>
                )
              })}
            </div>
            <div className="px-5 py-3 border-t border-gray-800 text-xs text-gray-500">
              {layout.widgets.length} / {MAX_WIDGETS} widgets on this dashboard
            </div>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {modal === 'create' && (
        <NameModal title="New Dashboard" saving={saving} onSave={handleCreate} onClose={() => setModal(null)} />
      )}
      {modal === 'rename' && selected && (
        <NameModal title="Rename Dashboard" initial={selected.name} saving={saving} onSave={handleRename} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
