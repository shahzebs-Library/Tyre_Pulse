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
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, ClipboardList,
  Gauge, MapPin, Clock, CalendarClock, Layers, Wallet, ListChecks,
  AlertOctagon, CalendarDays, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
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
  overduePlans, sortBySoonest, daysUntil, filterRenewalPlans, renewalRegisterRows,
  renewalExportRows, RENEWAL_EXPORT_COLUMNS,
} from '../lib/fleetRenewalAnalytics'
import { formatCurrencyCompact } from '../lib/formatters'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { compareValues } from '../lib/consoleTable'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { isMissingRelation } from '../lib/api/_client'

const EPOCH_DATE = new Date(0)
const ICON_BTN = 'inline-flex items-center justify-center h-11 w-11 sm:h-9 sm:w-9 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (v === null || v === undefined || v === '' ? undefined : v)

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

// Semantic colours (status/priority carry meaning -> NOT palettized).
const STATUS_STYLES = {
  planned:   'bg-sky-500/15 text-sky-500 border border-sky-500/40',
  approved:  'bg-green-500/15 text-green-500 border border-green-500/40',
  deferred:  'bg-amber-500/15 text-amber-500 border border-amber-500/40',
  completed: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/40',
}
const PRIORITY_STYLES = {
  low:    'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]',
  medium: 'bg-sky-500/15 text-sky-500 border border-sky-500/40',
  high:   'bg-red-500/15 text-red-500 border border-red-500/40',
}
const STATUS_HEX = { planned: '#0ea5e9', approved: '#22c55e', deferred: '#f59e0b', completed: '#10b981' }
const PRIORITY_HEX = { low: '#64748b', medium: '#0ea5e9', high: '#ef4444' }

const EMPTY_FORM = {
  asset_no: '', current_km: '', age_years: '', recommendation: '',
  target_replace_date: '', est_cost: '', priority: 'medium', status: 'planned',
  site: '', notes: '',
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
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [pipelineGranularity, setPipelineGranularity] = useState('month')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  // The delete dialog needs its OWN error slot. `formError` renders only inside
  // the create/edit dialog, so a failed delete used to write its message where
  // nothing could show it: the dialog just stayed open with no explanation.
  const [deleteError, setDeleteError] = useState('')
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

  const now = updatedAt ?? EPOCH_DATE
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

  const filtered = useMemo(() => filterRenewalPlans(rows || [], {
    status: statusFilter, priority: priorityFilter, site: siteFilter,
    from: fromDate, to: toDateVal, search, overdueOnly,
  }, now), [rows, statusFilter, priorityFilter, siteFilter, fromDate, toDateVal, search, overdueOnly, now])

  // Soonest action first; the register sorts across the WHOLE filtered set and
  // the exports below walk it in full, never just the visible page.
  const register = useMemo(() => renewalRegisterRows(filtered, now), [filtered, now])

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
    datasets: [{ label: 'Assets', data: ageBandData.bands.map((b) => b.count), backgroundColor: withAlpha(colorAt(2), 0.8), borderRadius: 4 }],
  }
  const mileageBandChart = {
    labels: mileageBandData.bands.map((b) => b.label),
    datasets: [{ label: 'Assets', data: mileageBandData.bands.map((b) => b.count), backgroundColor: withAlpha(colorAt(4), 0.8), borderRadius: 4 }],
  }

  // Export: the full filtered register, in soonest-first order.
  const exportRows = useMemo(() => renewalExportRows(filtered, now), [filtered, now])
  const scopeLabel = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
  const doExcel = async () => {
    try {
      await exportToExcel(exportRows, RENEWAL_EXPORT_COLUMNS.map((c) => c.key), RENEWAL_EXPORT_COLUMNS.map((c) => c.header), reportFileName('Fleet Renewal Plans', scopeLabel))
    } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    try {
      await exportToPdf(exportRows, RENEWAL_EXPORT_COLUMNS, `Fleet Renewal Planning (${scopeLabel})`, reportFileName('Fleet Renewal Plans', scopeLabel), 'landscape')
    } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

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
    setDeleteError('')
    try {
      await deleteRenewalPlan(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete the plan.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  // One named close per dialog, carrying the in-flight guard the hand-rolled
  // backdrop already had. Each dialog can now be closed from Escape, the
  // backdrop, the X and Cancel, and all four must agree: dropping out mid-save
  // would hide a write that is still running. `useDialogBehavior` keeps onClose
  // in a ref, so a plain function here needs no useCallback.
  const closeForm = () => { if (!saving) setModalOpen(false) }
  const closeDelete = () => { if (!deleting) { setConfirmDelete(null); setDeleteError('') } }

  const clearFilters = () => {
    setStatusFilter('all'); setPriorityFilter('all'); setSiteFilter('all')
    setFromDate(''); setToDateVal(''); setSearch(''); setOverdueOnly(false)
  }
  const hasFilters = statusFilter !== 'all' || priorityFilter !== 'all' || siteFilter !== 'all' || fromDate || toDateVal || search || overdueOnly

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

  const loading = rows === null

  const columns = [
    {
      id: 'asset', header: 'Asset', accessorFn: (r) => blank(r.asset_no), sortingFn: valueSort, sortUndefined: 'last', size: 140,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span>,
    },
    { id: 'type', header: 'Type', accessorFn: (r) => blank(r.vehicle_type), sortingFn: valueSort, sortUndefined: 'last', size: 120, cell: ({ getValue }) => <span className="text-[var(--text-secondary)]">{getValue() || 'N/A'}</span> },
    { id: 'site', header: 'Site', accessorFn: (r) => blank(r.site), sortingFn: valueSort, sortUndefined: 'last', size: 120, cell: ({ getValue }) => <span className="text-[var(--text-secondary)]">{getValue() || 'N/A'}</span> },
    { id: 'age', header: 'Age', accessorFn: (r) => r.ageValue ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 80, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{getValue() == null ? 'N/A' : `${getValue()} yr`}</span> },
    { id: 'km', header: 'Current km', accessorFn: (r) => r.kmValue ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 110, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{num(getValue())}</span> },
    { id: 'recommendation', header: 'Recommendation', accessorFn: (r) => blank(r.recommendation), sortingFn: valueSort, sortUndefined: 'last', size: 220, cell: ({ getValue }) => <span className="text-[var(--text-secondary)] block max-w-[220px] truncate" title={getValue() || ''}>{getValue() || 'N/A'}</span> },
    { id: 'priority', header: 'Priority', accessorFn: (r) => r.priorityRank || undefined, sortingFn: valueSort, sortUndefined: 'last', size: 100, cell: ({ row }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${PRIORITY_STYLES[row.original.priority] || ''}`}>{RENEWAL_PRIORITY_META[row.original.priority]?.label || row.original.priority || 'N/A'}</span> },
    {
      id: 'target', header: 'Target date', accessorFn: (r) => r.daysToTarget ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 150,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          <span className={row.original.isOverdue ? 'text-red-500 font-medium' : 'text-[var(--text-secondary)]'}>{fmtDate(row.original.target_replace_date)}</span>
          {row.original.isOverdue && <span className="ml-1.5 text-[10px] font-semibold uppercase text-red-500">overdue</span>}
        </span>
      ),
    },
    { id: 'cost', header: 'Est. cost', accessorFn: (r) => r.costValue ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 110, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums text-[var(--text-secondary)]">{getValue() == null ? 'N/A' : formatCurrencyCompact(getValue(), activeCurrency)}</span> },
    { id: 'status', header: 'Status', accessorFn: (r) => blank(RENEWAL_STATUS_META[r.status]?.label || r.status), sortingFn: valueSort, sortUndefined: 'last', size: 110, cell: ({ row }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[row.original.status] || ''}`}>{RENEWAL_STATUS_META[row.original.status]?.label || row.original.status || 'N/A'}</span> },
    {
      id: 'actions', header: '', enableSorting: false, size: 100, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit plan for ${row.original.asset_no}`}><Pencil size={14} /></button>
          <button type="button" onClick={() => { setDeleteError(''); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-500`} aria-label={`Delete plan for ${row.original.asset_no}`}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ]

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
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={error === 'missing'}>
              <Plus size={14} aria-hidden="true" /> New plan
            </button>
          </div>
        }
      />

      {error === 'missing' ? (
        // `border border-amber-800/50` as classes would be DEAD here: Card sets
        // `border` and `borderColor` inline and inline beats a class, so the tint
        // is carried by `tone` instead. Card is `flex flex-col` and Tailwind
        // emits .flex-col after .flex-row, so the row direction goes in `style`,
        // which Card spreads last.
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Fleet renewal planning is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V159_FLEET_RENEWAL.sql</span>, then reload.
            </p>
          </div>
        </Card>
      ) : error ? (
        <Card tone="crit" className="items-start gap-[var(--space-3)] flex-wrap" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Could not load renewal plans.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </Card>
      ) : null}

      {/* KPI tiles */}
      <p className="text-[11px] text-[var(--text-muted)] -mb-3">Figures cover all {kpi.total.toLocaleString()} plan(s) in {scopeLabel}. Filters below narrow the register only.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[var(--gap-grid)]">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <Card key={k.label}>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{loading ? 'N/A' : k.value}</p>
            </Card>
          )
        })}
      </div>

      {/* Insights */}
      {!loading && insights.length > 0 && (
        // The old `border border-[var(--input-border)]` only restated the default
        // card edge, and as a class it could not win against Card's inline
        // border anyway. Card's default tone already draws it.
        <Card>
          <CardHeader icon={AlertTriangle} title="Priority findings" />
          <ul className="space-y-1.5">
            {insights.map((s, i) => (
              <li key={i} className="text-sm text-[var(--text-secondary)] flex items-start gap-2">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" /> {s}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Pipeline */}
      <Card>
        {/* Two short toggles only, so they are safe in `actions` (which is
            flex-shrink-0 and cannot wrap); a wider button group would belong on
            its own row beneath the header instead. */}
        <CardHeader
          icon={CalendarDays}
          title="Renewal pipeline"
          actions={
            <div className="flex items-center gap-1 text-xs">
              {['month', 'year'].map((g) => (
                <button key={g} type="button" onClick={() => setPipelineGranularity(g)} aria-pressed={pipelineGranularity === g}
                  className={`px-2.5 py-1 min-h-[36px] rounded ${pipelineGranularity === g ? 'bg-[var(--input-bg)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                  {g === 'month' ? 'Monthly' : 'Yearly'}
                </button>
              ))}
            </div>
          }
        />
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
      </Card>

      {/* Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--gap-grid)]">
        <Card>
          <CardHeader title="Lifecycle status" />
          <div className="h-56">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : (rows && rows.length) ? <Doughnut data={statusDonut} options={donutOpts} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No plans yet.</div>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Priority" />
          <div className="h-56">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : (rows && rows.length) ? <Doughnut data={priorityDonut} options={donutOpts} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No plans yet.</div>}
          </div>
        </Card>
        <Card>
          <CardHeader icon={Wallet} title="Estimated budget" />
          {/* `money(null)` is 'N/A', never 0: a fleet with no costed plan must not
              read as a zero budget. The engine returns null for that case. */}
          <p className="text-3xl font-bold text-emerald-400">{loading ? 'N/A' : money(budget.total)}</p>
          {!loading && (
            <div className="mt-3 space-y-1.5 text-xs text-[var(--text-muted)]">
              <p>Open plans budget: <span className="text-[var(--text-secondary)] font-medium">{money(budget.openTotal)}</span></p>
              <p>{budget.withCost} of {budget.total_plans} plans costed ({Math.round(budget.coverage * 100)}% coverage)</p>
              {budget.withoutCost > 0 && <p className="text-amber-400">{budget.withoutCost} plan(s) have no estimated cost, so the budget is understated.</p>}
            </div>
          )}
        </Card>
      </div>

      {/* Breakdowns: site + type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--gap-grid)]">
        <Card>
          <CardHeader icon={MapPin} title="By site" />
          <div className="h-56">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : siteBreakdown.length ? <Bar data={siteChart} options={barOpts()} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No site data on these plans.</div>}
          </div>
        </Card>
        <Card>
          <CardHeader icon={Layers} title="By vehicle type" />
          <div className="h-56">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : typeBreakdown.length ? <Bar data={typeChart} options={barOpts()} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No matching fleet-master vehicle types for these assets.</div>}
          </div>
        </Card>
      </div>

      {/* Due bands: age + mileage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--gap-grid)]">
        <Card>
          <CardHeader icon={Gauge} title="Age bands" />
          <div className="h-52">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : ageBandData.hasData ? <Bar data={ageBandChart} options={barOpts()} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No age recorded on these plans.</div>}
          </div>
          {!loading && ageBandData.hasData && <p className="text-xs text-[var(--text-muted)] mt-2">{ageBandData.withData} plan(s) with a recorded age.</p>}
        </Card>
        <Card>
          <CardHeader icon={TrendingUp} title="Mileage bands" />
          <div className="h-52">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : mileageBandData.hasData ? <Bar data={mileageBandChart} options={barOpts()} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No mileage recorded on these plans.</div>}
          </div>
          {!loading && mileageBandData.hasData && <p className="text-xs text-[var(--text-muted)] mt-2">{mileageBandData.withData} plan(s) with a recorded odometer.</p>}
        </Card>
      </div>

      {/* Overdue watchlist */}
      {!loading && overdue.length > 0 && (
        // Deliberately NOT CardHeader: the red heading is semantic here (this is
        // an alert surface), and CardHeader pins its title to --text-primary.
        // The `border border-red-800/50` classes moved to `tone`, which is the
        // only place a Card border tint can be set.
        <Card tone="crit">
          <h3 className="text-sm font-semibold text-red-300 mb-3 flex items-center gap-1.5"><AlertOctagon size={15} /> Overdue watchlist ({overdue.length})</h3>
          <div className="flex flex-wrap gap-2">
            {sortBySoonest(overdue, now).slice(0, 12).map((r) => (
              <button key={r.id} type="button" onClick={() => openEdit(r)} className="text-left rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 min-h-[44px] hover:bg-red-500/20" aria-label={`Edit overdue plan for ${r.asset_no}`}>
                <p className="text-sm font-medium text-[var(--text-primary)]">{r.asset_no}</p>
                <p className="text-xs text-red-500">{Math.abs(daysUntil(r.target_replace_date, now) || 0)} day(s) overdue</p>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setOverdueOnly(true)} className="btn-secondary text-sm mt-3 min-h-[44px] sm:min-h-0">Show all {overdue.length} overdue in the register</button>
        </Card>
      )}

      {/* Filters. No `clip`: the controls here are native <select> and
          <input type="date">, whose popups the browser paints outside the page's
          overflow context, so nothing in this card needs cropping. */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <label htmlFor="fr-search" className="sr-only">Search renewal plans</label>
            <input id="fr-search" className="input pl-9 w-full" placeholder="Search asset, type, recommendation, site..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] min-h-[44px] cursor-pointer">
            <input type="checkbox" className="h-4 w-4" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Overdue only
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <label htmlFor="fr-from" className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><Calendar size={13} aria-hidden="true" /> Target from</label>
          <input id="fr-from" type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <label htmlFor="fr-to" className="text-xs text-[var(--text-muted)]">to</label>
          <input id="fr-to" type="date" className="input" value={toDateVal} onChange={(e) => setToDateVal(e.target.value)} />
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {kpi.total}</span>
        </div>
      </Card>

      <EnterpriseTable
        columns={columns}
        data={register}
        getRowId={(r) => String(r.id)}
        loading={loading}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        viewKey="fleet-renewal"
        initialPageSize={25}
        emptyMessage={error === 'missing' ? 'Fleet renewal planning is not enabled yet.' : error ? 'Plans could not be loaded. Use Retry above.' : kpi.total === 0 ? 'No renewal plans yet. Create the first to start planning.' : 'No plans match these filters.'}
      />

      {/* Create / Edit modal. The submit button stays INSIDE the <form> rather
          than moving to Modal's `footer`: a footer button would need a
          `form="..."` association to keep submitting, which is a behaviour
          change, not a migration. Modal already owns the height cap, the focus
          trap, the scroll lock and escape-to-close. */}
      {modalOpen && (
        <Modal
          open
          onClose={closeForm}
          size="md"
          title={
            <span className="inline-flex items-center gap-2">
              {editing ? <><Pencil size={16} /> Edit renewal plan</> : <><Plus size={16} /> New renewal plan</>}
            </span>
          }
        >
            <form onSubmit={submit} className="space-y-4">
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
                <button type="button" onClick={closeForm} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving...' : (editing ? 'Save changes' : 'Create plan')}
                </button>
              </div>
            </form>
        </Modal>
      )}

      {/* Delete confirm. No <form> here, so the actions belong in Modal's
          `footer`, which pins them where a user can always reach them. */}
      {confirmDelete && (
        <Modal
          open
          onClose={closeDelete}
          size="sm"
          title="Delete renewal plan?"
          footer={
            <>
              <button onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
            <p className="text-sm text-[var(--text-muted)]">Plan for <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.asset_no}</span> will be permanently removed.</p>
          </div>
          {deleteError && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-400" style={{ marginTop: 'var(--space-3)' }}>
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {deleteError}
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}
