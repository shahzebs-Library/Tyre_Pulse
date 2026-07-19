/**
 * FleetRenewal (route /fleet-renewal) - Fleet Renewal Planning.
 *
 * Vehicle replacement / lifecycle planning: for each asset the page captures its
 * current age & mileage, a recommended action, a target replacement date, an
 * estimated cost and a priority + lifecycle status (planned -> approved ->
 * deferred -> completed). It surfaces a KPI band, a replacement pipeline
 * (by month/year from the target date), status + priority distributions,
 * by-site and by-vehicle-type breakdowns, age & mileage due bands, an overdue
 * watchlist, filters + search + sortable table, full role-gated CRUD, and
 * Excel/PDF export - with honest loading / empty / error states.
 *
 * Backed by `fleet_renewal_plans` (MIGRATIONS_V159_FLEET_RENEWAL.sql), enriched
 * with `vehicle_type` from vehicle_fleet by asset_no (best-effort, RLS-scoped).
 * Analytics live in the pure engine ./lib/fleetRenewalAnalytics; org isolation +
 * RBAC are enforced by RLS. No value is ever fabricated.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale,
  Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  Truck, TrendingUp, Calendar, DollarSign, Plus, Pencil, Trash2, Search, X,
  Filter, Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, ClipboardList,
  Gauge, MapPin, Clock, ArrowUpDown, CalendarClock, Layers, Wallet, ListChecks,
  AlertOctagon, ChevronUp, ChevronDown, CalendarDays,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listRenewalPlansEnriched, createRenewalPlan, updateRenewalPlan, deleteRenewalPlan,
} from '../lib/api/fleetRenewal'
import {
  RENEWAL_STATUSES, RENEWAL_PRIORITIES, RENEWAL_STATUS_META, RENEWAL_PRIORITY_META,
} from '../lib/fleetRenewal'
import {
  buildRenewalKpis, buildRenewalInsights, statusDistribution, priorityDistribution,
  renewalPipeline, estimateBudget, bySite, byVehicleType, ageBands, mileageBands,
  overduePlans, sortBySoonest, daysUntil,
} from '../lib/fleetRenewalAnalytics'
import { formatCurrencyCompact } from '../lib/formatters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

// Semantic colours (status/priority carry meaning -> NOT palettized).
const STATUS_STYLES = {
  planned:   'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  approved:  'bg-green-900/40 text-green-300 border border-green-700/50',
  deferred:  'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  completed: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
}
const PRIORITY_STYLES = {
  low:    'bg-slate-700/40 text-slate-300 border border-slate-600/50',
  medium: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  high:   'bg-red-900/40 text-red-300 border border-red-700/50',
}
const STATUS_HEX = { planned: '#0ea5e9', approved: '#22c55e', deferred: '#f59e0b', completed: '#10b981' }
const PRIORITY_HEX = { low: '#64748b', medium: '#0ea5e9', high: '#ef4444' }

const EMPTY_FORM = {
  asset_no: '', current_km: '', age_years: '', recommendation: '',
  target_replace_date: '', est_cost: '', priority: 'medium', status: 'planned',
  site: '', notes: '',
}

const SORT_KEYS = {
  soonest: 'Soonest first',
  asset: 'Asset',
  age: 'Age',
  km: 'Mileage',
  cost: 'Est. cost',
  priority: 'Priority',
}
const PRIORITY_RANK = { high: 3, medium: 2, low: 1 }

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find the table') ||
    m.includes('schema cache') || (m.includes('relation') && m.includes('fleet_renewal_plans'))
}
const fmtDate = (v) => (v ? String(v).slice(0, 10) : 'N/A')
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? 'N/A' : Number(v).toLocaleString())

export default function FleetRenewal() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDateVal, setToDateVal] = useState('')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('soonest')
  const [sortDir, setSortDir] = useState('asc')
  const [pipelineGranularity, setPipelineGranularity] = useState('month')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listRenewalPlansEnriched({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(isMissingRelation(err) ? 'missing' : toUserMessage(err, 'Could not load renewal plans.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const now = useMemo(() => new Date(), [rows])
  const kpi = useMemo(() => buildRenewalKpis(rows || [], now), [rows, now])
  const insights = useMemo(() => buildRenewalInsights(rows || [], now), [rows, now])
  const statusDist = useMemo(() => statusDistribution(rows || []), [rows])
  const priorityDist = useMemo(() => priorityDistribution(rows || []), [rows])
  const pipeline = useMemo(() => renewalPipeline(rows || [], { granularity: pipelineGranularity, now }), [rows, pipelineGranularity, now])
  const budget = useMemo(() => estimateBudget(rows || []), [rows])
  const siteBreakdown = useMemo(() => bySite(rows || []), [rows])
  const typeBreakdown = useMemo(() => byVehicleType(rows || []), [rows])
  const ageBandData = useMemo(() => ageBands(rows || []), [rows])
  const mileageBandData = useMemo(() => mileageBands(rows || []), [rows])
  const overdue = useMemo(() => overduePlans(rows || [], now), [rows, now])

  const siteOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const from = fromDate ? String(fromDate).slice(0, 10) : null
    const to = toDateVal ? String(toDateVal).slice(0, 10) : null
    const list = (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (priorityFilter !== 'all' && r.priority !== priorityFilter) return false
      if (siteFilter !== 'all' && (r.site || '') !== siteFilter) return false
      const d = r.target_replace_date ? String(r.target_replace_date).slice(0, 10) : null
      if (from && (!d || d < from)) return false
      if (to && (!d || d > to)) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.recommendation || ''} ${r.site || ''} ${r.vehicle_type || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    // Sort
    let sorted
    if (sortKey === 'soonest') {
      sorted = sortBySoonest(list, now)
    } else {
      const cmp = {
        asset: (a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || '')),
        age: (a, b) => (Number(a.age_years) || -1) - (Number(b.age_years) || -1),
        km: (a, b) => (Number(a.current_km) || -1) - (Number(b.current_km) || -1),
        cost: (a, b) => (Number(a.est_cost) || -1) - (Number(b.est_cost) || -1),
        priority: (a, b) => (PRIORITY_RANK[a.priority] || 0) - (PRIORITY_RANK[b.priority] || 0),
      }[sortKey]
      sorted = list.slice().sort(cmp)
    }
    if (sortDir === 'desc' && sortKey !== 'soonest') sorted = sorted.reverse()
    return sorted
  }, [rows, statusFilter, priorityFilter, siteFilter, fromDate, toDateVal, search, sortKey, sortDir, now])

  const chartText = (typeof document !== 'undefined'
    && getComputedStyle(document.documentElement).getPropertyValue('--text-muted')) || '#9ca3af'
  const gridColor = 'var(--panel-2)'

  const legendOpts = { legend: { labels: { color: chartText, boxWidth: 12, font: { size: 11 } } } }

  // Status doughnut
  const statusDonut = {
    labels: statusDist.map((s) => s.label),
    datasets: [{ data: statusDist.map((s) => s.count), backgroundColor: statusDist.map((s) => STATUS_HEX[s.key]), borderWidth: 0 }],
  }
  // Priority doughnut
  const priorityDonut = {
    labels: priorityDist.map((p) => p.label),
    datasets: [{ data: priorityDist.map((p) => p.count), backgroundColor: priorityDist.map((p) => PRIORITY_HEX[p.key]), borderWidth: 0 }],
  }
  const donutOpts = { responsive: true, maintainAspectRatio: false, plugins: legendOpts }

  // Pipeline bar
  const pipelineChart = {
    labels: pipeline.periods.map((p) => p.label),
    datasets: [{
      label: 'Plans due',
      data: pipeline.periods.map((p) => p.count),
      backgroundColor: pipeline.periods.map((_, i) => withAlpha(colorAt(i), 0.85)),
      borderRadius: 4,
    }],
  }
  const barOpts = (fmtY) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: fmtY ? { callbacks: { label: (c) => fmtY(c) } } : undefined,
    },
    scales: {
      x: { ticks: { color: chartText, font: { size: 10 } }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: chartText, precision: 0 }, grid: { color: gridColor } },
    },
  })

  // Site + type bars (categorical, themed)
  const makeCatBar = (data) => ({
    labels: data.map((d) => d.key),
    datasets: [{ label: 'Plans', data: data.map((d) => d.count), backgroundColor: categorical(data.length), borderRadius: 4 }],
  })
  const siteChart = makeCatBar(siteBreakdown.slice(0, 12))
  const typeChart = makeCatBar(typeBreakdown.slice(0, 12))

  // Band bars
  const ageBandChart = {
    labels: ageBandData.bands.map((b) => b.label),
    datasets: [{ label: 'Assets', data: ageBandData.bands.map((b) => b.count), backgroundColor: withAlpha('#f59e0b', 0.8), borderRadius: 4 }],
  }
  const mileageBandChart = {
    labels: mileageBandData.bands.map((b) => b.label),
    datasets: [{ label: 'Assets', data: mileageBandData.bands.map((b) => b.count), backgroundColor: withAlpha('#0ea5e9', 0.8), borderRadius: 4 }],
  }

  // Export
  const EXPORT_COLS = ['asset_no', 'vehicle_type', 'site', 'age_years', 'current_km', 'recommendation', 'priority', 'target_replace_date', 'est_cost', 'status']
  const EXPORT_HEADERS = ['Asset', 'Vehicle type', 'Site', 'Age (yrs)', 'Current km', 'Recommendation', 'Priority', 'Target date', 'Est. cost', 'Status']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '',
    vehicle_type: r.vehicle_type || '',
    site: r.site || '',
    age_years: r.age_years ?? '',
    current_km: r.current_km ?? '',
    recommendation: r.recommendation || '',
    priority: RENEWAL_PRIORITY_META[r.priority]?.label || r.priority || '',
    target_replace_date: r.target_replace_date || '',
    est_cost: r.est_cost ?? '',
    status: RENEWAL_STATUS_META[r.status]?.label || r.status || '',
  }))

  // CRUD
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', current_km: r.current_km ?? '', age_years: r.age_years ?? '',
      recommendation: r.recommendation || '', target_replace_date: r.target_replace_date ? String(r.target_replace_date).slice(0, 10) : '',
      est_cost: r.est_cost ?? '', priority: r.priority || 'medium', status: r.status || 'planned',
      site: r.site || '', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) {
        const updated = await updateRenewalPlan(editing.id, payload)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
      } else {
        const created = await createRenewalPlan(payload)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the plan.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteRenewalPlan(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not delete the plan.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  const clearFilters = () => {
    setStatusFilter('all'); setPriorityFilter('all'); setSiteFilter('all')
    setFromDate(''); setToDateVal(''); setSearch('')
  }
  const hasFilters = statusFilter !== 'all' || priorityFilter !== 'all' || siteFilter !== 'all' || fromDate || toDateVal || search

  const money = (v) => (v == null ? 'N/A' : formatCurrencyCompact(v, activeCurrency))

  const kpis = [
    { label: 'Total plans', value: kpi.total, icon: ClipboardList, tone: 'text-[var(--text-primary)]' },
    { label: 'Open', value: kpi.open, icon: ListChecks, tone: 'text-sky-400' },
    { label: 'Overdue', value: kpi.overdue, icon: AlertOctagon, tone: 'text-red-400' },
    { label: 'Due <= 90d', value: kpi.dueSoon, icon: CalendarClock, tone: 'text-amber-400' },
    { label: 'High priority open', value: kpi.highPriorityOpen, icon: TrendingUp, tone: 'text-red-400' },
    { label: 'Est. budget', value: money(kpi.estBudget), icon: Wallet, tone: 'text-emerald-400' },
    { label: 'Open budget', value: money(kpi.openBudget), icon: DollarSign, tone: 'text-amber-400' },
    { label: 'Avg age', value: kpi.avgAge == null ? 'N/A' : `${kpi.avgAge.toFixed(1)} yr`, icon: Gauge, tone: 'text-sky-400' },
  ]

  const setSort = (k) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'soonest' ? 'asc' : 'desc') }
  }
  const SortHead = ({ label, k }) => (
    <th className="px-4 py-3 font-semibold whitespace-nowrap">
      {k ? (
        <button onClick={() => setSort(k)} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
          {label}
          {sortKey === k ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ArrowUpDown size={11} className="opacity-40" />}
        </button>
      ) : label}
    </th>
  )

  const loading = rows === null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Renewal Planning"
        subtitle="Vehicle replacement & lifecycle planning: age, mileage, target date, budget and priority across the fleet."
        icon={Truck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'fleet_renewal_plans') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Fleet Renewal Planning', 'fleet_renewal_plans', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New plan
            </button>
          </div>
        }
      />

      {error === 'missing' ? (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Fleet renewal planning is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V159_FLEET_RENEWAL.sql</span>, then reload.
            </p>
          </div>
        </div>
      ) : error ? (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Could not load renewal plans.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary text-sm">Retry</button>
        </div>
      ) : null}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{loading ? 'N/A' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Insights */}
      {!loading && insights.length > 0 && (
        <div className="card border border-[var(--input-border)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-1.5">
            <AlertTriangle size={14} className="text-amber-400" /> Priority findings
          </h3>
          <ul className="space-y-1.5">
            {insights.map((s, i) => (
              <li key={i} className="text-sm text-[var(--text-secondary)] flex items-start gap-2">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pipeline */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
            <CalendarDays size={15} className="text-sky-400" /> Renewal pipeline
          </h3>
          <div className="flex items-center gap-1 text-xs">
            {['month', 'year'].map((g) => (
              <button key={g} onClick={() => setPipelineGranularity(g)}
                className={`px-2.5 py-1 rounded ${pipelineGranularity === g ? 'bg-[var(--input-bg)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                {g === 'month' ? 'Monthly' : 'Yearly'}
              </button>
            ))}
          </div>
        </div>
        <div className="h-64">
          {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
            : pipeline.hasDated ? <Bar data={pipelineChart} options={barOpts((c) => `${c.parsed.y} plan(s), ${money(pipeline.periods[c.dataIndex]?.estCost)}`)} />
            : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No plans carry a target replacement date yet.</div>}
        </div>
        {!loading && (pipeline.undated.count > 0 || pipeline.overdueCount > 0) && (
          <div className="flex flex-wrap gap-4 mt-3 text-xs text-[var(--text-muted)]">
            {pipeline.overdueCount > 0 && <span className="inline-flex items-center gap-1"><AlertOctagon size={12} className="text-red-400" /> {pipeline.overdueCount} overdue ({money(pipeline.overdueCost)})</span>}
            {pipeline.undated.count > 0 && <span className="inline-flex items-center gap-1"><Clock size={12} /> {pipeline.undated.count} without a target date</span>}
          </div>
        )}
      </div>

      {/* Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Lifecycle status</h3>
          <div className="h-56">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : (rows && rows.length) ? <Doughnut data={statusDonut} options={donutOpts} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No plans yet.</div>}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Priority</h3>
          <div className="h-56">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : (rows && rows.length) ? <Doughnut data={priorityDonut} options={donutOpts} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No plans yet.</div>}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-1.5"><Wallet size={14} className="text-emerald-400" /> Estimated budget</h3>
          <p className="text-3xl font-bold text-emerald-400">{loading ? 'N/A' : money(budget.total)}</p>
          {!loading && (
            <div className="mt-3 space-y-1.5 text-xs text-[var(--text-muted)]">
              <p>Open plans budget: <span className="text-[var(--text-secondary)] font-medium">{money(budget.openTotal)}</span></p>
              <p>{budget.withCost} of {budget.total_plans} plans costed ({Math.round(budget.coverage * 100)}% coverage)</p>
              {budget.withoutCost > 0 && <p className="text-amber-400">{budget.withoutCost} plan(s) have no estimated cost, so the budget is understated.</p>}
            </div>
          )}
        </div>
      </div>

      {/* Breakdowns: site + type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><MapPin size={14} className="text-sky-400" /> By site</h3>
          <div className="h-56">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : siteBreakdown.length ? <Bar data={siteChart} options={barOpts()} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No site data on these plans.</div>}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><Layers size={14} className="text-indigo-400" /> By vehicle type</h3>
          <div className="h-56">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : typeBreakdown.length ? <Bar data={typeChart} options={barOpts()} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No matching fleet-master vehicle types for these assets.</div>}
          </div>
        </div>
      </div>

      {/* Due bands: age + mileage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><Gauge size={14} className="text-amber-400" /> Age bands</h3>
          <div className="h-52">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : ageBandData.hasData ? <Bar data={ageBandChart} options={barOpts()} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No age recorded on these plans.</div>}
          </div>
          {!loading && ageBandData.hasData && <p className="text-xs text-[var(--text-muted)] mt-2">{ageBandData.withData} plan(s) with a recorded age.</p>}
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><TrendingUp size={14} className="text-sky-400" /> Mileage bands</h3>
          <div className="h-52">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : mileageBandData.hasData ? <Bar data={mileageBandChart} options={barOpts()} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No mileage recorded on these plans.</div>}
          </div>
          {!loading && mileageBandData.hasData && <p className="text-xs text-[var(--text-muted)] mt-2">{mileageBandData.withData} plan(s) with a recorded odometer.</p>}
        </div>
      </div>

      {/* Overdue watchlist */}
      {!loading && overdue.length > 0 && (
        <div className="card border border-red-800/50">
          <h3 className="text-sm font-semibold text-red-300 mb-3 flex items-center gap-1.5"><AlertOctagon size={15} /> Overdue watchlist ({overdue.length})</h3>
          <div className="flex flex-wrap gap-2">
            {sortBySoonest(overdue, now).slice(0, 12).map((r) => (
              <button key={r.id} onClick={() => openEdit(r)} className="text-left rounded-lg border border-red-800/40 bg-red-900/15 px-3 py-2 hover:bg-red-900/25">
                <p className="text-sm font-medium text-[var(--text-primary)]">{r.asset_no}</p>
                <p className="text-xs text-red-300">{Math.abs(daysUntil(r.target_replace_date, now) || 0)} day(s) overdue</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, type, recommendation, site..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {RENEWAL_STATUSES.map((s) => <option key={s} value={s}>{RENEWAL_STATUS_META[s].label}</option>)}
          </select>
          <select className="input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Priority">
            <option value="all">All priorities</option>
            {RENEWAL_PRIORITIES.map((p) => <option key={p} value={p}>{RENEWAL_PRIORITY_META[p].label}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site" disabled={!siteOptions.length}>
            <option value="all">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={sortKey} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            {Object.entries(SORT_KEYS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <label className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><Calendar size={13} /> Target from</label>
          <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="Target from" />
          <label className="text-xs text-[var(--text-muted)]">to</label>
          <input type="date" className="input" value={toDateVal} onChange={(e) => setToDateVal(e.target.value)} aria-label="Target to" />
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {kpi.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <SortHead label="Asset" k="asset" />
                <SortHead label="Type" />
                <SortHead label="Site" />
                <SortHead label="Age" k="age" />
                <SortHead label="Current km" k="km" />
                <SortHead label="Recommendation" />
                <SortHead label="Priority" k="priority" />
                <SortHead label="Target date" k="soonest" />
                <SortHead label="Est. cost" k="cost" />
                <SortHead label="Status" />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={11} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {kpi.total === 0 ? 'No renewal plans yet. Create the first to start planning.' : 'No plans match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const dd = daysUntil(r.target_replace_date, now)
                  const isOverdue = ['planned', 'approved', 'deferred'].includes(r.status) && dd != null && dd <= 0
                  return (
                    <tr key={r.id} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 ${isOverdue ? 'bg-red-900/10' : ''}`}>
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.vehicle_type || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.age_years == null ? 'N/A' : `${r.age_years} yr`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{num(r.current_km)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[220px] truncate" title={r.recommendation || ''}>{r.recommendation || 'N/A'}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${PRIORITY_STYLES[r.priority] || ''}`}>{RENEWAL_PRIORITY_META[r.priority]?.label || r.priority}</span></td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={isOverdue ? 'text-red-300 font-medium' : 'text-[var(--text-secondary)]'}>{fmtDate(r.target_replace_date)}</span>
                        {isOverdue && <span className="ml-1.5 text-[10px] text-red-400">overdue</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.est_cost == null ? 'N/A' : formatCurrencyCompact(r.est_cost, activeCurrency)}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || ''}`}>{RENEWAL_STATUS_META[r.status]?.label || r.status}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-300" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500. Refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[var(--input-border)] flex items-center justify-between">
              <h2 className="font-bold text-[var(--text-primary)] flex items-center gap-2">
                {editing ? <><Pencil size={16} /> Edit renewal plan</> : <><Plus size={16} /> New renewal plan</>}
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number *</label>
                  <input className="input w-full" value={form.asset_no} onChange={(e) => setField('asset_no', e.target.value)} placeholder="e.g. TRK-1042" maxLength={120} />
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" value={form.site} onChange={(e) => setField('site', e.target.value)} placeholder="Depot / branch" />
                </div>
                <div>
                  <label className="label">Current km</label>
                  <input type="number" className="input w-full" value={form.current_km} onChange={(e) => setField('current_km', e.target.value)} placeholder="e.g. 385000" />
                </div>
                <div>
                  <label className="label">Age (years)</label>
                  <input type="number" step="0.1" className="input w-full" value={form.age_years} onChange={(e) => setField('age_years', e.target.value)} placeholder="e.g. 8" />
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select className="input w-full" value={form.priority} onChange={(e) => setField('priority', e.target.value)}>
                    {RENEWAL_PRIORITIES.map((p) => <option key={p} value={p}>{RENEWAL_PRIORITY_META[p].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                    {RENEWAL_STATUSES.map((s) => <option key={s} value={s}>{RENEWAL_STATUS_META[s].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Target replace date</label>
                  <input type="date" className="input w-full" value={form.target_replace_date} onChange={(e) => setField('target_replace_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Estimated cost ({activeCurrency})</label>
                  <input type="number" className="input w-full" value={form.est_cost} onChange={(e) => setField('est_cost', e.target.value)} placeholder="e.g. 250000" />
                </div>
              </div>
              <div>
                <label className="label">Recommended action</label>
                <input className="input w-full" value={form.recommendation} onChange={(e) => setField('recommendation', e.target.value)} placeholder="e.g. Replace with EV tractor unit" maxLength={8000} />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input w-full min-h-[80px] resize-y" value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Justification, TCO context, procurement notes..." maxLength={8000} />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving...' : (editing ? 'Save changes' : 'Create plan')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">Delete renewal plan?</p>
                  <p className="text-sm text-[var(--text-muted)] mt-1">Plan for <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.asset_no}</span> will be permanently removed.</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
                <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                  {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
