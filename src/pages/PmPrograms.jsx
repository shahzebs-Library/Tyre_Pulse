/**
 * PmPrograms (route /pm-programs) - Preventive Maintenance.
 *
 * A complete Preventive Maintenance workbench for EVERY asset type (vehicles,
 * generators, plant, machinery, equipment). It supports time-based (days /
 * months) AND meter-based (km via odometer, engine hours) service scheduling,
 * recording a service (which advances the schedule) with full detail and a
 * permanent history, and a one-click Tyres vs Maintenance cost switch.
 *
 * Three tabs:
 *   1. Dashboard       - compliance KPIs, upcoming buckets, category mix, the
 *                        due banner, and the Combined | Tyres | Maintenance
 *                        cost view switch over a 12-month cost series.
 *   2. Plans           - the plan register (time + meter intervals, combined
 *                        due badge) with search / status / category / due-only
 *                        filters, create / edit / delete, and Record service.
 *   3. Service History - the immutable service ledger with filters and export.
 *
 * All maths live in pure, unit-tested engines (pmSchedule / pmPrograms /
 * costSources); this page is presentation + orchestration only. Data is
 * org-isolated and country-scoped by RLS. Honest loading / empty / error
 * states, no fabricated data.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  CalendarClock, Wrench, Calendar, AlertTriangle, CheckCircle2, Search, X,
  Filter, Plus, Pencil, Trash2, FileSpreadsheet, FileText, Loader2, Save,
  LayoutDashboard, ClipboardList, History, Gauge, Wallet, TrendingUp,
  ListChecks, ClipboardCheck, Timer, Layers,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  createPmProgram, updatePmProgram, deletePmProgram,
  recordPmService, listPmServiceRecords, loadPmDashboard,
} from '../lib/api/pmPrograms'
import {
  ASSET_CATEGORIES, ASSET_CATEGORY_LABELS, canonAssetCategory,
  PM_PRIORITIES, PM_PRIORITY_META, toDbPriority,
  PM_OUTCOMES, PM_OUTCOME_META,
  METER_SOURCES, METER_SOURCE_LABELS, meterUnit,
} from '../lib/pmVocab'
import {
  addTimeInterval, resolveMeter, pmAssetDueStatus, advanceSchedule,
  summarizePmCompliance,
} from '../lib/pmSchedule'
import {
  PM_STATUS_META, PM_DUE_META, PM_STATUSES,
} from '../lib/pmPrograms'
import {
  COST_MODES, pickCost, costModeLabel, pickMonthly, splitTotals,
} from '../lib/costSources'
import { loadCostSplit } from '../lib/api/costSummary'
import { generateWorkOrderNo, insertWorkOrder } from '../lib/api/workOrders'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

// ── Presentation maps ─────────────────────────────────────────────────────────
const TONE_CLS = {
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
  slate: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  sky: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
}
const INTERVAL_TYPE_LABEL = { days: 'days', months: 'months', km: 'km', hours: 'h' }
const COST_MODE_COLOR = { combined: '#6366f1', tyres: '#22c55e', maintenance: '#f59e0b' }
const WO_PRIORITY = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
const mapToWOPriority = (p) => WO_PRIORITY[String(p || '').toLowerCase()] || 'Medium'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'plans', label: 'Plans', icon: ClipboardList },
  { id: 'history', label: 'Service History', icon: History },
]

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}
function fmtNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : 'N/A'
}
function monthLabel(m) {
  if (!m) return ''
  const [y, mo] = String(m).split('-')
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const idx = Number(mo) - 1
  return idx >= 0 && idx < 12 ? `${MON[idx]} ${String(y).slice(2)}` : String(m)
}
const todayISO = () => new Date().toISOString().slice(0, 10)

function Badge({ tone, children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLS[tone] || TONE_CLS.slate}`}>
      {children}
    </span>
  )
}

// Build the "both intervals" cell text for a plan.
function intervalSummary(p) {
  const parts = []
  if (p.interval_value != null && p.interval_value !== '' && (p.interval_type === 'days' || p.interval_type === 'months')) {
    parts.push({ key: 'time', text: `${p.interval_value} ${INTERVAL_TYPE_LABEL[p.interval_type] || p.interval_type}` })
  } else if (p.interval_value != null && p.interval_value !== '') {
    parts.push({ key: 'time', text: `${p.interval_value} ${INTERVAL_TYPE_LABEL[p.interval_type] || p.interval_type}` })
  }
  const mu = meterUnit(p.meter_source)
  if (mu && p.meter_interval != null && p.meter_interval !== '') {
    parts.push({ key: 'meter', text: `every ${fmtNum(p.meter_interval)} ${mu}` })
  }
  return parts
}

const EMPTY_FORM = {
  name: '', asset_no: '', asset_category: '', site: '', assigned_to: '',
  priority: 'medium', status: 'active',
  interval_type: 'months', interval_value: '',
  meter_source: 'none', meter_interval: '', last_done_meter: '', next_due_meter: '',
  last_done: '', next_due: '', estimated_cost: '',
  task_list: [], notes: '',
}

const EMPTY_RECORD = {
  service_date: todayISO(), meter_reading: '', performed_by: '', workshop: '', site: '',
  tasks_done: [], parts_used: [], parts_cost: '', labour_cost: '',
  findings: '', outcome: 'completed', notes: '', create_wo: false,
}

export default function PmPrograms() {
  const { activeCountry, activeCurrency } = useSettings()

  // ── Data (null sentinel = not loaded yet) ─────────────────────────────────
  const [dashboard, setDashboard] = useState(null) // { plans, kmByAsset, hoursByAsset }
  const [history, setHistory] = useState(null)
  const [cost, setCost] = useState(null) // { tyre, maintenance, byMonth }
  const [nowTs, setNowTs] = useState(() => Date.now())
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [tab, setTab] = useState('dashboard')
  const [costMode, setCostMode] = useState('combined')

  // Plans filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [dueOnly, setDueOnly] = useState(false)

  // History filters
  const [histAsset, setHistAsset] = useState('')
  const [histProgram, setHistProgram] = useState('all')
  const [histOutcome, setHistOutcome] = useState('all')
  const [histFrom, setHistFrom] = useState('')
  const [histTo, setHistTo] = useState('')

  // Create / edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [taskDraft, setTaskDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Record-service modal
  const [recordFor, setRecordFor] = useState(null) // the plan being serviced
  const [recordForm, setRecordForm] = useState(EMPTY_RECORD)
  const [partDraft, setPartDraft] = useState({ name: '', cost: '' })
  const [recording, setRecording] = useState(false)
  const [recordError, setRecordError] = useState('')
  const [recordOk, setRecordOk] = useState('')

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const [dash, hist, split] = await Promise.all([
        loadPmDashboard({ country: activeCountry }),
        listPmServiceRecords({ country: activeCountry }).catch(() => []),
        loadCostSplit({ country: activeCountry }).catch(() => ({ tyre: 0, maintenance: 0, byMonth: [] })),
      ])
      setDashboard(dash || { plans: [], kmByAsset: {}, hoursByAsset: {} })
      setHistory(Array.isArray(hist) ? hist : [])
      setCost(split || { tyre: 0, maintenance: 0, byMonth: [] })
      setNowTs(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) {
        setMissing(true)
        setDashboard({ plans: [], kmByAsset: {}, hoursByAsset: {} })
        setHistory([]); setCost({ tyre: 0, maintenance: 0, byMonth: [] })
      } else {
        setError(toUserMessage(err, 'Could not load Preventive Maintenance data.'))
        setDashboard({ plans: [], kmByAsset: {}, hoursByAsset: {} })
        setHistory([]); setCost({ tyre: 0, maintenance: 0, byMonth: [] })
      }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const plans = dashboard?.plans || []
  const kmByAsset = dashboard?.kmByAsset || {}
  const hoursByAsset = dashboard?.hoursByAsset || {}

  const summary = useMemo(
    () => summarizePmCompliance(plans, { now: nowTs, kmByAsset, hoursByAsset }),
    [plans, kmByAsset, hoursByAsset, nowTs],
  )

  const enrichedPlans = useMemo(
    () => plans.map((p) => ({
      ...p,
      _st: pmAssetDueStatus(p, { now: nowTs, currentKm: kmByAsset[p.asset_no], currentHours: hoursByAsset[p.asset_no] }),
    })),
    [plans, kmByAsset, hoursByAsset, nowTs],
  )

  const planNameById = useMemo(() => {
    const m = new Map()
    for (const p of plans) m.set(String(p.id), p.name || 'Plan')
    return m
  }, [plans])

  const filteredPlans = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enrichedPlans.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (categoryFilter !== 'all' && (p.asset_category || '') !== categoryFilter) return false
      if (dueOnly && !(p._st.band === 'overdue' || p._st.band === 'due_soon')) return false
      if (q) {
        const hay = `${p.name || ''} ${p.asset_no || ''} ${ASSET_CATEGORY_LABELS[p.asset_category] || ''} ${p.site || ''} ${p.assigned_to || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enrichedPlans, search, statusFilter, categoryFilter, dueOnly])

  const clearPlanFilters = () => { setSearch(''); setStatusFilter('all'); setCategoryFilter('all'); setDueOnly(false) }
  const hasPlanFilters = search || statusFilter !== 'all' || categoryFilter !== 'all' || dueOnly

  const filteredHistory = useMemo(() => {
    const list = history || []
    const asset = histAsset.trim().toLowerCase()
    return list.filter((r) => {
      if (asset && !String(r.asset_no || '').toLowerCase().includes(asset)) return false
      if (histProgram !== 'all' && String(r.pm_program_id) !== histProgram) return false
      if (histOutcome !== 'all' && r.outcome !== histOutcome) return false
      const d = r.service_date ? String(r.service_date).slice(0, 10) : ''
      if (histFrom && (!d || d < histFrom)) return false
      if (histTo && (!d || d > histTo)) return false
      return true
    })
  }, [history, histAsset, histProgram, histOutcome, histFrom, histTo])

  const clearHistFilters = () => { setHistAsset(''); setHistProgram('all'); setHistOutcome('all'); setHistFrom(''); setHistTo('') }
  const hasHistFilters = histAsset || histProgram !== 'all' || histOutcome !== 'all' || histFrom || histTo

  // ── Cost switch derivation ──────────────────────────────────────────────────
  const byMonth = cost?.byMonth || []
  const costTotals = useMemo(() => splitTotals(byMonth), [byMonth])
  const costTotal = pickCost(costMode, costTotals)
  const monthly = useMemo(() => pickMonthly(costMode, byMonth), [costMode, byMonth])
  const costChartData = useMemo(() => ({
    labels: monthly.map((m) => monthLabel(m.month)),
    datasets: [{
      label: `${costModeLabel(costMode)} cost`,
      data: monthly.map((m) => Math.round(m.value)),
      backgroundColor: COST_MODE_COLOR[costMode] || COST_MODE_COLOR.combined,
      borderRadius: 4,
      maxBarThickness: 34,
    }],
  }), [monthly, costMode])
  const costChartOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: { label: (ctx) => `${costModeLabel(costMode)}: ${formatCurrencyCompact(ctx.parsed.y, activeCurrency)}` },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 } } },
      y: {
        grid: { color: 'rgba(148,163,184,0.12)' },
        ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 }, callback: (v) => formatCurrencyCompact(v, activeCurrency) },
      },
    },
  }), [costMode, activeCurrency])

  // ── Create / edit ───────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setTaskDraft(''); setFormError(''); setModalOpen(true)
  }
  const openEdit = (p) => {
    setEditing(p)
    setForm({
      name: p.name || '',
      asset_no: p.asset_no || '',
      asset_category: p.asset_category || '',
      site: p.site || '',
      assigned_to: p.assigned_to || '',
      priority: p.priority || 'medium',
      status: p.status || 'active',
      interval_type: (p.interval_type === 'days' || p.interval_type === 'months') ? p.interval_type : 'months',
      interval_value: p.interval_value ?? '',
      meter_source: p.meter_source || 'none',
      meter_interval: p.meter_interval ?? '',
      last_done_meter: p.last_done_meter ?? '',
      next_due_meter: p.next_due_meter ?? '',
      last_done: p.last_done || '',
      next_due: p.next_due || '',
      estimated_cost: p.estimated_cost ?? '',
      task_list: Array.isArray(p.task_list) ? [...p.task_list] : [],
      notes: p.notes || '',
    })
    setTaskDraft(''); setFormError(''); setModalOpen(true)
  }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const addTask = () => {
    const t = taskDraft.trim()
    if (!t) return
    setForm((f) => ({ ...f, task_list: [...f.task_list, t] }))
    setTaskDraft('')
  }
  const removeTask = (i) => setForm((f) => ({ ...f, task_list: f.task_list.filter((_, idx) => idx !== i) }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.name.trim()) { setFormError('Program name is required.'); return }
    setSaving(true)
    try {
      const meterNone = form.meter_source === 'none'
      const payload = {
        name: form.name,
        asset_no: form.asset_no || null,
        asset_category: canonAssetCategory(form.asset_category),
        site: form.site || null,
        assigned_to: form.assigned_to || null,
        priority: toDbPriority(form.priority),
        status: PM_STATUSES.includes(form.status) ? form.status : 'active',
        interval_type: form.interval_type,
        interval_value: form.interval_value === '' ? null : Number(form.interval_value),
        meter_source: form.meter_source,
        meter_interval: meterNone || form.meter_interval === '' ? null : Number(form.meter_interval),
        last_done_meter: meterNone || form.last_done_meter === '' ? null : Number(form.last_done_meter),
        next_due_meter: meterNone || form.next_due_meter === '' ? null : Number(form.next_due_meter),
        last_done: form.last_done || null,
        next_due: form.next_due || null,
        estimated_cost: form.estimated_cost === '' ? null : Number(form.estimated_cost),
        task_list: form.task_list,
        notes: form.notes || null,
      }
      if (editing) {
        const updated = await updatePmProgram(editing.id, payload)
        setDashboard((d) => ({ ...d, plans: (d?.plans || []).map((r) => (r.id === updated.id ? updated : r)) }))
      } else {
        const created = await createPmProgram({ ...payload, country: activeCountry !== 'All' ? activeCountry : null })
        setDashboard((d) => ({ ...(d || { kmByAsset: {}, hoursByAsset: {} }), plans: [created, ...(d?.plans || [])] }))
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
      await deletePmProgram(confirmDelete.id)
      setDashboard((d) => ({ ...d, plans: (d?.plans || []).filter((r) => r.id !== confirmDelete.id) }))
      setConfirmDelete(null)
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the plan.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  // ── Record service ──────────────────────────────────────────────────────────
  const openRecord = (p) => {
    const rm = resolveMeter(p, { currentKm: kmByAsset[p.asset_no], currentHours: hoursByAsset[p.asset_no] })
    setRecordFor(p)
    setRecordForm({
      ...EMPTY_RECORD,
      service_date: todayISO(),
      site: p.site || '',
      meter_reading: rm.currentMeter != null ? String(rm.currentMeter) : '',
      tasks_done: [],
    })
    setPartDraft({ name: '', cost: '' })
    setRecordError(''); setRecordOk('')
  }
  const setRecordField = (k, v) => setRecordForm((f) => ({ ...f, [k]: v }))
  const toggleTaskDone = (task) => setRecordForm((f) => ({
    ...f,
    tasks_done: f.tasks_done.includes(task) ? f.tasks_done.filter((t) => t !== task) : [...f.tasks_done, task],
  }))
  const addPart = () => {
    const name = partDraft.name.trim()
    if (!name) return
    const cost = partDraft.cost === '' ? null : Number(partDraft.cost)
    setRecordForm((f) => ({ ...f, parts_used: [...f.parts_used, { name, cost: Number.isFinite(cost) ? cost : null }] }))
    setPartDraft({ name: '', cost: '' })
  }
  const removePart = (i) => setRecordForm((f) => ({ ...f, parts_used: f.parts_used.filter((_, idx) => idx !== i) }))

  const recordMeter = recordFor
    ? resolveMeter(recordFor, { currentKm: kmByAsset[recordFor.asset_no], currentHours: hoursByAsset[recordFor.asset_no] })
    : { unit: '', source: 'none' }
  const recordPreview = useMemo(() => {
    if (!recordFor) return null
    return advanceSchedule(recordFor, {
      service_date: recordForm.service_date,
      meter_reading: recordForm.meter_reading === '' ? null : Number(recordForm.meter_reading),
    })
  }, [recordFor, recordForm.service_date, recordForm.meter_reading])
  const recordTotal = (Number(recordForm.parts_cost) || 0) + (Number(recordForm.labour_cost) || 0)

  const submitRecord = useCallback(async (e) => {
    e?.preventDefault?.()
    if (!recordFor) return
    setRecordError(''); setRecordOk('')
    setRecording(true)
    try {
      let workOrderNo = null
      if (recordForm.create_wo) {
        const woNo = await generateWorkOrderNo()
        const wo = {
          work_order_no: woNo,
          asset_no: recordFor.asset_no || null,
          work_type: 'Preventive Maintenance',
          description: recordFor.name || 'Preventive Maintenance',
          priority: mapToWOPriority(recordFor.priority),
          site: recordFor.site || null,
          country: activeCountry !== 'All' ? activeCountry : null,
        }
        await insertWorkOrder(wo)
        workOrderNo = woNo
      }
      const values = {
        service_date: recordForm.service_date || null,
        meter_reading: recordMeter.source === 'none' || recordForm.meter_reading === '' ? null : Number(recordForm.meter_reading),
        performed_by: recordForm.performed_by || null,
        workshop: recordForm.workshop || null,
        site: recordForm.site || null,
        tasks_done: recordForm.tasks_done,
        parts_used: recordForm.parts_used,
        parts_cost: recordForm.parts_cost === '' ? null : Number(recordForm.parts_cost),
        labour_cost: recordForm.labour_cost === '' ? null : Number(recordForm.labour_cost),
        findings: recordForm.findings || null,
        outcome: recordForm.outcome || 'completed',
        work_order_no: workOrderNo,
        notes: recordForm.notes || null,
      }
      const { record, program } = await recordPmService(recordFor.id, values)
      if (program) {
        setDashboard((d) => ({ ...d, plans: (d?.plans || []).map((r) => (r.id === program.id ? program : r)) }))
      }
      if (record) setHistory((h) => [record, ...(h || [])])
      setRecordOk('Service recorded and the schedule advanced.')
      setRecordFor(null)
    } catch (err) {
      setRecordError(toUserMessage(err, 'Could not record the service.'))
    } finally {
      setRecording(false)
    }
  }, [recordFor, recordForm, recordMeter.source, activeCountry])

  // ── Exports ───────────────────────────────────────────────────────────────
  const PLAN_COLS = ['name', 'asset_no', 'asset_category', 'interval', 'meter_interval', 'next_due', 'next_due_meter', 'priority', 'assigned_to', 'status', 'due']
  const PLAN_HEADERS = ['Plan', 'Asset', 'Category', 'Time interval', 'Meter interval', 'Next due', 'Next due meter', 'Priority', 'Assigned', 'Status', 'Due']
  const planExportRows = filteredPlans.map((p) => ({
    name: p.name || '',
    asset_no: p.asset_no || '',
    asset_category: ASSET_CATEGORY_LABELS[p.asset_category] || '',
    interval: (p.interval_value != null && p.interval_value !== '') ? `${p.interval_value} ${INTERVAL_TYPE_LABEL[p.interval_type] || p.interval_type}` : '',
    meter_interval: (meterUnit(p.meter_source) && p.meter_interval != null) ? `${p.meter_interval} ${meterUnit(p.meter_source)}` : '',
    next_due: p.next_due || '',
    next_due_meter: (p.next_due_meter != null && meterUnit(p.meter_source)) ? `${p.next_due_meter} ${meterUnit(p.meter_source)}` : '',
    priority: PM_PRIORITY_META[p.priority]?.label || p.priority || '',
    assigned_to: p.assigned_to || '',
    status: PM_STATUS_META[p.status]?.label || p.status || '',
    due: PM_DUE_META[p._st.band]?.label || p._st.band || '',
  }))
  const exportPlansExcel = () => exportToExcel(planExportRows, PLAN_COLS, PLAN_HEADERS, 'preventive maintenance plans', 'Plans', { title: 'Preventive Maintenance Plans', currency: activeCurrency })
  const exportPlansPdf = () => exportToPdf(planExportRows, PLAN_COLS.map((k, i) => ({ key: k, header: PLAN_HEADERS[i] })), 'Preventive Maintenance Plans', 'preventive maintenance plans', 'landscape', '', { currency: activeCurrency })

  const HIST_COLS = ['service_date', 'asset_no', 'plan', 'meter', 'performed_by', 'outcome', 'parts_cost', 'labour_cost', 'total_cost', 'next_due', 'work_order_no']
  const HIST_HEADERS = ['Date', 'Asset', 'Plan', 'Meter reading', 'Performed by', 'Outcome', 'Parts', 'Labour', 'Total', 'Next due', 'WO no']
  const histExportRows = filteredHistory.map((r) => {
    const unit = meterUnit(r.meter_type)
    return {
      service_date: r.service_date ? String(r.service_date).slice(0, 10) : '',
      asset_no: r.asset_no || '',
      plan: planNameById.get(String(r.pm_program_id)) || '',
      meter: (r.meter_reading != null && unit) ? `${r.meter_reading} ${unit}` : (r.meter_reading != null ? String(r.meter_reading) : ''),
      performed_by: r.performed_by || '',
      outcome: PM_OUTCOME_META[r.outcome]?.label || r.outcome || '',
      parts_cost: r.parts_cost ?? '',
      labour_cost: r.labour_cost ?? '',
      total_cost: r.total_cost ?? '',
      next_due: r.next_due || '',
      work_order_no: r.work_order_no || '',
    }
  })
  const exportHistExcel = () => exportToExcel(histExportRows, HIST_COLS, HIST_HEADERS, 'preventive maintenance history', 'History', { title: 'Preventive Maintenance Service History', currency: activeCurrency })
  const exportHistPdf = () => exportToPdf(histExportRows, HIST_COLS.map((k, i) => ({ key: k, header: HIST_HEADERS[i] })), 'Preventive Maintenance Service History', 'preventive maintenance history', 'landscape', '', { currency: activeCurrency })

  const notLoaded = dashboard === null

  const kpis = [
    { label: 'Total plans', value: summary.total, icon: ClipboardList, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: summary.active, icon: CheckCircle2, tone: 'text-emerald-400' },
    { label: 'Overdue', value: summary.overdue, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Due soon', value: summary.dueSoon, icon: Calendar, tone: 'text-amber-400' },
  ]

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Preventive Maintenance"
        subtitle="Time and meter based service scheduling for every asset: vehicles, generators, plant, machinery and equipment. Record services, advance schedules, and split Tyres vs Maintenance cost in one click."
        icon={CalendarClock}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportPlansExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!planExportRows.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={exportPlansPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!planExportRows.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={missing}>
              <Plus size={14} /> New plan
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Preventive Maintenance is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V253.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Something went wrong.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {recordOk && (
        <div className="card border border-emerald-800/50 flex items-center gap-3 !py-3">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <span className="text-sm text-emerald-200">{recordOk}</span>
          <button onClick={() => setRecordOk('')} className="ml-auto p-1 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)]"><X size={14} /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--input-border)]">
        {TABS.map((t) => {
          const Icon = t.icon
          const on = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${on ? 'border-blue-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* ══════════════════════════ DASHBOARD ══════════════════════════ */}
      {tab === 'dashboard' && (
        <div className="space-y-6">
          {/* Due banner */}
          {(summary.overdue > 0 || summary.dueSoon > 0) && (
            <div className="card border border-amber-800/50 space-y-2 !py-3">
              <div className="flex items-center gap-2">
                <CalendarClock size={16} className="text-amber-400 shrink-0" />
                <span className="text-sm text-amber-200">
                  {summary.overdue > 0 && <><span className="font-semibold text-red-300">{summary.overdue}</span> overdue</>}
                  {summary.overdue > 0 && summary.dueSoon > 0 && ' | '}
                  {summary.dueSoon > 0 && <><span className="font-semibold">{summary.dueSoon}</span> due soon</>}
                  {' '}: schedule the work to keep assets compliant.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {summary.dueList.slice(0, 8).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setTab('plans'); setDueOnly(true) }}
                    className="text-[11px] px-2 py-1 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] hover:border-amber-600/50 text-[var(--text-secondary)]"
                    title="View in Plans"
                  >
                    <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                    <span className="text-[var(--text-muted)]"> | {p.asset_no || ASSET_CATEGORY_LABELS[p.asset_category] || 'asset'}</span>
                    <span className={p.band === 'overdue' ? 'text-red-300' : 'text-amber-300'}> | {PM_DUE_META[p.band]?.label}</span>
                  </button>
                ))}
              </div>
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
                  <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{notLoaded ? '-' : k.value}</p>
                </div>
              )
            })}
            <div className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">Compliance</p>
                <ClipboardCheck size={16} className="text-sky-400" />
              </div>
              <p className="text-3xl font-bold mt-1 text-sky-300">
                {notLoaded ? '-' : (summary.compliantPct == null ? 'N/A' : `${summary.compliantPct}%`)}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">active plans not overdue</p>
            </div>
          </div>

          {/* Upcoming buckets + category mix */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Timer size={16} className="text-[var(--text-secondary)]" />
                <h3 className="font-semibold text-[var(--text-primary)]">Upcoming services</h3>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[['Next 30 days', summary.buckets.d30], ['Next 60 days', summary.buckets.d60], ['Next 90 days', summary.buckets.d90]].map(([label, val]) => (
                  <div key={label} className="rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)] p-3 text-center">
                    <p className="text-2xl font-bold text-[var(--text-primary)]">{notLoaded ? '-' : val}</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-3">Counts active plans due by date or by meter within each window.</p>
            </div>

            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Layers size={16} className="text-[var(--text-secondary)]" />
                <h3 className="font-semibold text-[var(--text-primary)]">Plans by asset category</h3>
              </div>
              {notLoaded ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-4 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
              ) : summary.byCategory.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No active plans to categorise yet.</p>
              ) : (
                <div className="space-y-2">
                  {summary.byCategory.map((c) => {
                    const pctW = summary.active > 0 ? Math.round((c.count / summary.active) * 100) : 0
                    return (
                      <div key={c.category} className="flex items-center gap-3">
                        <span className="w-24 text-sm text-[var(--text-secondary)] shrink-0">{ASSET_CATEGORY_LABELS[c.category] || c.category}</span>
                        <div className="flex-1 h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                          <div className="h-full rounded-full bg-indigo-500/70" style={{ width: `${pctW}%` }} />
                        </div>
                        <span className="w-10 text-right text-sm font-medium text-[var(--text-primary)]">{c.count}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Cost view switch */}
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Wallet size={16} className="text-[var(--text-secondary)]" />
                <h3 className="font-semibold text-[var(--text-primary)]">Cost view</h3>
                <span className="text-[11px] text-[var(--text-muted)]">one-click Tyres vs Maintenance</span>
              </div>
              <div className="inline-flex rounded-lg border border-[var(--input-border)] overflow-hidden">
                {COST_MODES.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setCostMode(m.key)}
                    className={`px-3.5 py-1.5 text-sm font-medium transition-colors ${costMode === m.key ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] bg-transparent'}`}
                    style={costMode === m.key ? { backgroundColor: COST_MODE_COLOR[m.key] } : undefined}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              <div className="rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)] p-4 flex flex-col justify-center">
                <p className="text-xs text-[var(--text-muted)]">{costModeLabel(costMode)} cost</p>
                <p className="text-3xl font-bold mt-1" style={{ color: COST_MODE_COLOR[costMode] }}>
                  {cost === null ? '-' : formatCurrencyCompact(costTotal, activeCurrency)}
                </p>
                <div className="mt-3 space-y-1 text-[11px] text-[var(--text-muted)]">
                  <div className="flex items-center justify-between"><span>Tyres</span><span className="text-[var(--text-secondary)]">{formatCurrencyCompact(costTotals.tyre, activeCurrency)}</span></div>
                  <div className="flex items-center justify-between"><span>Maintenance</span><span className="text-[var(--text-secondary)]">{formatCurrencyCompact(costTotals.maintenance, activeCurrency)}</span></div>
                  <div className="flex items-center justify-between border-t border-[var(--input-border)] pt-1"><span>Combined</span><span className="text-[var(--text-primary)] font-medium">{formatCurrencyCompact(costTotals.combined, activeCurrency)}</span></div>
                </div>
              </div>
              <div className="lg:col-span-3 rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={14} className="text-[var(--text-muted)]" />
                  <p className="text-xs text-[var(--text-muted)]">Last 12 months : {costModeLabel(costMode)}</p>
                </div>
                <div className="h-[220px]">
                  {cost === null ? (
                    <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
                  ) : monthly.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No cost history for this country yet.</div>
                  ) : (
                    <Bar data={costChartData} options={costChartOpts} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════ PLANS ══════════════════════════ */}
      {tab === 'plans' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="card">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input className="input pl-9 w-full" placeholder="Search plan, asset, category, site, assignee" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
                <option value="all">All statuses</option>
                {PM_STATUSES.map((s) => <option key={s} value={s}>{PM_STATUS_META[s]?.label || s}</option>)}
              </select>
              <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
                <option value="all">All categories</option>
                {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{ASSET_CATEGORY_LABELS[c]}</option>)}
              </select>
              <button
                onClick={() => setDueOnly((v) => !v)}
                className={`text-sm inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border ${dueOnly ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-secondary)]'}`}
              >
                <AlertTriangle size={14} /> Due only
              </button>
              {hasPlanFilters && <button onClick={clearPlanFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
              <span className="text-xs text-[var(--text-muted)] ml-auto">{filteredPlans.length} of {plans.length}</span>
            </div>
          </div>

          {/* Table */}
          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    {['Plan', 'Asset', 'Interval', 'Next due', 'Priority', 'Assigned', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {notLoaded ? (
                    [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                  ) : filteredPlans.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />{plans.length === 0 ? 'No maintenance plans yet. Create the first plan to get started.' : 'No plans match these filters.'}</td></tr>
                  ) : (
                    filteredPlans.slice(0, 500).map((p) => {
                      const st = p._st
                      const intervals = intervalSummary(p)
                      const unit = st.unit || meterUnit(p.meter_source)
                      return (
                        <tr key={p.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 align-top">
                          <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{p.name || 'N/A'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                            {p.asset_no || 'N/A'}
                            {p.asset_category && <span className="block text-[11px] text-[var(--text-muted)]">{ASSET_CATEGORY_LABELS[p.asset_category] || p.asset_category}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                            {intervals.length === 0 ? 'N/A' : intervals.map((it) => (
                              <span key={it.key} className="block text-[13px]">{it.text}</span>
                            ))}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge tone={PM_DUE_META[st.band]?.tone}>{PM_DUE_META[st.band]?.label}</Badge>
                            {p.next_due && (
                              <span className="block text-[11px] text-[var(--text-muted)] mt-1">
                                {fmtDate(p.next_due)}{st.daysToDue != null && <> ({st.daysToDue < 0 ? `${Math.abs(st.daysToDue)}d ago` : `${st.daysToDue}d`})</>}
                              </span>
                            )}
                            {p.next_due_meter != null && unit && (
                              <span className="block text-[11px] text-[var(--text-muted)]">
                                {fmtNum(p.next_due_meter)} {unit}{st.meterRemaining != null && <> ({st.meterRemaining < 0 ? `${fmtNum(Math.abs(st.meterRemaining))} ${unit} over` : `${fmtNum(st.meterRemaining)} ${unit} left`})</>}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5"><Badge tone={PM_PRIORITY_META[p.priority]?.tone}>{PM_PRIORITY_META[p.priority]?.label || p.priority}</Badge></td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.assigned_to || 'N/A'}</td>
                          <td className="px-4 py-2.5"><Badge tone={PM_STATUS_META[p.status]?.tone}>{PM_STATUS_META[p.status]?.label || p.status}</Badge></td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => openRecord(p)} className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 text-[11px] font-medium inline-flex items-center gap-1" title="Record service"><Wrench size={13} /> Service</button>
                              <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                              <button onClick={() => setConfirmDelete(p)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            {filteredPlans.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 : refine filters or export for the full set.</p>}
          </div>
        </div>
      )}

      {/* ══════════════════════════ SERVICE HISTORY ══════════════════════════ */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input className="input pl-9 w-full" placeholder="Filter by asset number" value={histAsset} onChange={(e) => setHistAsset(e.target.value)} />
              </div>
              <select className="input" value={histProgram} onChange={(e) => setHistProgram(e.target.value)} aria-label="Plan">
                <option value="all">All plans</option>
                {plans.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </select>
              <select className="input" value={histOutcome} onChange={(e) => setHistOutcome(e.target.value)} aria-label="Outcome">
                <option value="all">All outcomes</option>
                {PM_OUTCOMES.map((o) => <option key={o} value={o}>{PM_OUTCOME_META[o]?.label || o}</option>)}
              </select>
              <input type="date" className="input" value={histFrom} onChange={(e) => setHistFrom(e.target.value)} aria-label="From date" />
              <input type="date" className="input" value={histTo} onChange={(e) => setHistTo(e.target.value)} aria-label="To date" />
              {hasHistFilters && <button onClick={clearHistFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={exportHistExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!histExportRows.length}><FileSpreadsheet size={14} /> Excel</button>
                <button onClick={exportHistPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!histExportRows.length}><FileText size={14} /> PDF</button>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    {['Date', 'Asset', 'Plan', 'Meter', 'Performed by', 'Outcome', 'Parts', 'Labour', 'Total', 'Next due', 'WO no'].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {history === null ? (
                    [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={11} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                  ) : filteredHistory.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-12 text-center text-[var(--text-muted)]"><History size={22} className="mx-auto mb-2 opacity-60" />{(history || []).length === 0 ? 'No services recorded yet. Record a service from the Plans tab.' : 'No services match these filters.'}</td></tr>
                  ) : (
                    filteredHistory.slice(0, 500).map((r) => {
                      const unit = meterUnit(r.meter_type)
                      return (
                        <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.service_date)}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || 'N/A'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-primary)]">{planNameById.get(String(r.pm_program_id)) || 'N/A'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.meter_reading != null ? `${fmtNum(r.meter_reading)}${unit ? ` ${unit}` : ''}` : 'N/A'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.performed_by || 'N/A'}</td>
                          <td className="px-4 py-2.5"><Badge tone={PM_OUTCOME_META[r.outcome]?.tone}>{PM_OUTCOME_META[r.outcome]?.label || r.outcome}</Badge></td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.parts_cost != null ? formatCurrencyCompact(r.parts_cost, activeCurrency) : 'N/A'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.labour_cost != null ? formatCurrencyCompact(r.labour_cost, activeCurrency) : 'N/A'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium whitespace-nowrap">{r.total_cost != null ? formatCurrencyCompact(r.total_cost, activeCurrency) : 'N/A'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                            {fmtDate(r.next_due)}
                            {r.next_due_meter != null && unit && <span className="block text-[11px] text-[var(--text-muted)]">{fmtNum(r.next_due_meter)} {unit}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.work_order_no || 'N/A'}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            {filteredHistory.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 : refine filters or export for the full set.</p>}
          </div>
        </div>
      )}

      {/* ══════════════════════════ CREATE / EDIT MODAL ══════════════════════════ */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="card w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit maintenance plan' : 'New maintenance plan'}</h2>
              <button onClick={() => !saving && setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-5">
              {/* Identity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="label">Plan name<span className="text-red-400"> *</span></label>
                  <input className="input w-full" placeholder="e.g. 250 hour generator service" value={form.name} maxLength={200} onChange={(e) => setField('name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. GEN-014" value={form.asset_no} maxLength={120} onChange={(e) => setField('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Asset category</label>
                  <select className="input w-full" value={form.asset_category} onChange={(e) => setField('asset_category', e.target.value)}>
                    <option value="">Select category</option>
                    {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{ASSET_CATEGORY_LABELS[c]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" placeholder="Depot / workshop" value={form.site} maxLength={120} onChange={(e) => setField('site', e.target.value)} />
                </div>
                <div>
                  <label className="label">Assigned to</label>
                  <input className="input w-full" placeholder="Owner / technician" value={form.assigned_to} maxLength={120} onChange={(e) => setField('assigned_to', e.target.value)} />
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select className="input w-full" value={form.priority} onChange={(e) => setField('priority', e.target.value)}>
                    {PM_PRIORITIES.map((p) => <option key={p} value={p}>{PM_PRIORITY_META[p]?.label || p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                    {PM_STATUSES.map((s) => <option key={s} value={s}>{PM_STATUS_META[s]?.label || s}</option>)}
                  </select>
                </div>
              </div>

              {/* Time schedule */}
              <div className="rounded-xl border border-[var(--input-border)] p-4">
                <div className="flex items-center gap-2 mb-3"><Calendar size={15} className="text-[var(--text-secondary)]" /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Time schedule</h3></div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="label">Interval type</label>
                    <select className="input w-full" value={form.interval_type} onChange={(e) => setField('interval_type', e.target.value)}>
                      <option value="days">Days</option>
                      <option value="months">Months</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Interval value</label>
                    <input type="number" min="0" step="1" className="input w-full" placeholder="e.g. 6" value={form.interval_value} onChange={(e) => setField('interval_value', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Last done</label>
                    <input type="date" className="input w-full" value={form.last_done || ''} onChange={(e) => setField('last_done', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Next due</label>
                    <input type="date" className="input w-full" value={form.next_due || ''} onChange={(e) => setField('next_due', e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Meter schedule */}
              <div className="rounded-xl border border-[var(--input-border)] p-4">
                <div className="flex items-center gap-2 mb-3"><Gauge size={15} className="text-[var(--text-secondary)]" /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Meter schedule</h3></div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="label">Meter source</label>
                    <select className="input w-full" value={form.meter_source} onChange={(e) => setField('meter_source', e.target.value)}>
                      {METER_SOURCES.map((m) => <option key={m} value={m}>{METER_SOURCE_LABELS[m]}</option>)}
                    </select>
                  </div>
                  {form.meter_source !== 'none' && (
                    <>
                      <div>
                        <label className="label">Interval ({meterUnit(form.meter_source)})</label>
                        <input type="number" min="0" step="any" className="input w-full" placeholder={`e.g. ${form.meter_source === 'engine_hours' ? '250' : '5000'}`} value={form.meter_interval} onChange={(e) => setField('meter_interval', e.target.value)} />
                      </div>
                      <div>
                        <label className="label">Last done ({meterUnit(form.meter_source)})</label>
                        <input type="number" min="0" step="any" className="input w-full" value={form.last_done_meter} onChange={(e) => setField('last_done_meter', e.target.value)} />
                      </div>
                      <div>
                        <label className="label">Next due ({meterUnit(form.meter_source)})</label>
                        <input type="number" min="0" step="any" className="input w-full" value={form.next_due_meter} onChange={(e) => setField('next_due_meter', e.target.value)} />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Tasks + cost */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Task checklist</label>
                  <div className="flex items-center gap-2">
                    <input className="input flex-1" placeholder="Add a task, e.g. Replace oil filter" value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTask() } }} />
                    <button type="button" onClick={addTask} className="btn-secondary text-sm inline-flex items-center gap-1"><Plus size={14} /> Add</button>
                  </div>
                  {form.task_list.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {form.task_list.map((t, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-[var(--text-secondary)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2.5 py-1.5">
                          <ListChecks size={13} className="text-[var(--text-muted)] shrink-0" />
                          <span className="flex-1 truncate">{t}</span>
                          <button type="button" onClick={() => removeTask(i)} className="text-[var(--text-muted)] hover:text-red-400"><X size={13} /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <label className="label">Estimated cost ({activeCurrency})</label>
                  <input type="number" min="0" step="any" className="input w-full" placeholder="0" value={form.estimated_cost} onChange={(e) => setField('estimated_cost', e.target.value)} />
                  <label className="label mt-4">Notes</label>
                  <textarea className="input w-full min-h-[80px] resize-y" value={form.notes} maxLength={4000} onChange={(e) => setField('notes', e.target.value)} />
                </div>
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving' : editing ? 'Save changes' : 'Create plan'}
                </button>
                <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════ RECORD SERVICE MODAL ══════════════════════════ */}
      {recordFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !recording && setRecordFor(null)}>
          <div className="card w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">Record service</h2>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">{recordFor.name}{recordFor.asset_no ? ` | ${recordFor.asset_no}` : ''}</p>
              </div>
              <button onClick={() => !recording && setRecordFor(null)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)]"><X size={18} /></button>
            </div>
            <form onSubmit={submitRecord} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Service date</label>
                  <input type="date" className="input w-full" value={recordForm.service_date} onChange={(e) => setRecordField('service_date', e.target.value)} />
                </div>
                {recordMeter.source !== 'none' && (
                  <div>
                    <label className="label">Meter reading ({recordMeter.unit})</label>
                    <input type="number" min="0" step="any" className="input w-full" value={recordForm.meter_reading} onChange={(e) => setRecordField('meter_reading', e.target.value)} />
                  </div>
                )}
                <div>
                  <label className="label">Performed by</label>
                  <input className="input w-full" placeholder="Technician" value={recordForm.performed_by} maxLength={120} onChange={(e) => setRecordField('performed_by', e.target.value)} />
                </div>
                <div>
                  <label className="label">Workshop</label>
                  <input className="input w-full" placeholder="Workshop / vendor" value={recordForm.workshop} maxLength={120} onChange={(e) => setRecordField('workshop', e.target.value)} />
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" value={recordForm.site} maxLength={120} onChange={(e) => setRecordField('site', e.target.value)} />
                </div>
                <div>
                  <label className="label">Outcome</label>
                  <select className="input w-full" value={recordForm.outcome} onChange={(e) => setRecordField('outcome', e.target.value)}>
                    {PM_OUTCOMES.map((o) => <option key={o} value={o}>{PM_OUTCOME_META[o]?.label || o}</option>)}
                  </select>
                </div>
              </div>

              {/* Tasks done */}
              <div>
                <label className="label">Tasks completed</label>
                {(recordFor.task_list || []).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {(recordFor.task_list || []).map((t, i) => {
                      const on = recordForm.tasks_done.includes(t)
                      return (
                        <button type="button" key={i} onClick={() => toggleTaskDone(t)} className={`text-[12px] px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ${on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-secondary)]'}`}>
                          {on ? <CheckCircle2 size={13} /> : <ListChecks size={13} />} {t}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-[12px] text-[var(--text-muted)]">This plan has no task checklist. Add tasks on the plan to track them here.</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <input className="input flex-1" placeholder="Add another completed task" value={partDraft._task || ''} onChange={(e) => setPartDraft((d) => ({ ...d, _task: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = (partDraft._task || '').trim(); if (v) { setRecordForm((f) => ({ ...f, tasks_done: [...f.tasks_done, v] })); setPartDraft((d) => ({ ...d, _task: '' })) } } }} />
                  <button type="button" onClick={() => { const v = (partDraft._task || '').trim(); if (v) { setRecordForm((f) => ({ ...f, tasks_done: [...f.tasks_done, v] })); setPartDraft((d) => ({ ...d, _task: '' })) } }} className="btn-secondary text-sm inline-flex items-center gap-1"><Plus size={14} /> Add</button>
                </div>
              </div>

              {/* Parts */}
              <div>
                <label className="label">Parts used</label>
                <div className="flex items-center gap-2">
                  <input className="input flex-1" placeholder="Part name" value={partDraft.name} onChange={(e) => setPartDraft((d) => ({ ...d, name: e.target.value }))} />
                  <input type="number" min="0" step="any" className="input w-32" placeholder={`Cost (${activeCurrency})`} value={partDraft.cost} onChange={(e) => setPartDraft((d) => ({ ...d, cost: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPart() } }} />
                  <button type="button" onClick={addPart} className="btn-secondary text-sm inline-flex items-center gap-1"><Plus size={14} /> Add</button>
                </div>
                {recordForm.parts_used.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {recordForm.parts_used.map((p, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-[var(--text-secondary)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2.5 py-1.5">
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="text-[var(--text-muted)]">{p.cost != null ? formatCurrencyCompact(p.cost, activeCurrency) : 'no cost'}</span>
                        <button type="button" onClick={() => removePart(i)} className="text-[var(--text-muted)] hover:text-red-400"><X size={13} /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Parts cost ({activeCurrency})</label>
                  <input type="number" min="0" step="any" className="input w-full" placeholder="0" value={recordForm.parts_cost} onChange={(e) => setRecordField('parts_cost', e.target.value)} />
                </div>
                <div>
                  <label className="label">Labour cost ({activeCurrency})</label>
                  <input type="number" min="0" step="any" className="input w-full" placeholder="0" value={recordForm.labour_cost} onChange={(e) => setRecordField('labour_cost', e.target.value)} />
                </div>
                <div className="flex flex-col justify-end">
                  <label className="label">Total</label>
                  <div className="input w-full flex items-center font-semibold text-[var(--text-primary)]">{formatCurrencyCompact(recordTotal, activeCurrency)}</div>
                </div>
              </div>

              <div>
                <label className="label">Findings</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="Observations, defects found, follow-ups" value={recordForm.findings} maxLength={4000} onChange={(e) => setRecordField('findings', e.target.value)} />
              </div>

              {/* Live next-due preview */}
              <div className="rounded-xl border border-sky-800/40 bg-sky-500/5 px-4 py-3 flex items-start gap-3">
                <CalendarClock size={16} className="text-sky-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="text-sky-200 font-medium">After recording, the schedule advances to:</p>
                  <p className="text-[var(--text-secondary)] mt-0.5">
                    Next due: <span className="text-[var(--text-primary)]">{recordPreview?.next_due ? fmtDate(recordPreview.next_due) : 'unchanged'}</span>
                    {recordMeter.source !== 'none' && (
                      <> {' | '} meter: <span className="text-[var(--text-primary)]">{recordPreview?.next_due_meter != null ? `${fmtNum(recordPreview.next_due_meter)} ${recordMeter.unit}` : 'unchanged'}</span></>
                    )}
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" className="accent-blue-500" checked={recordForm.create_wo} onChange={(e) => setRecordField('create_wo', e.target.checked)} />
                Create a linked work order for this service
              </label>

              {recordError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {recordError}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={recording} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
                  {recording ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />}
                  {recording ? 'Recording' : 'Record service'}
                </button>
                <button type="button" onClick={() => setRecordFor(null)} disabled={recording} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════ DELETE CONFIRMATION ══════════════════════════ */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0">
                <Trash2 size={20} className="text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-[var(--text-primary)]">Delete maintenance plan?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  This permanently removes <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.name}</span>. Recorded service history is retained. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-5">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="btn-secondary">Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-500 border-red-600 inline-flex items-center gap-2 disabled:opacity-60">
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
