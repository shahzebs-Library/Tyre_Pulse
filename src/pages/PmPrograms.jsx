/**
 * PmPrograms (route /pm-programs) - Preventive Maintenance, on the Command
 * Center kit (src/components/commandCenter/kit.jsx).
 *
 * A complete Preventive Maintenance workbench for EVERY asset type (vehicles,
 * generators, plant, machinery, equipment). It supports time-based (days /
 * months) AND meter-based (km via odometer, engine hours) service scheduling,
 * recording a service (which advances the schedule) with full detail and a
 * permanent history, and a one-click Tyres vs Maintenance cost switch.
 *
 * Three tabs:
 *   1. Dashboard       - due queue, upcoming windows, category mix, the
 *                        Combined | Tyres | Maintenance cost switch over the
 *                        governed cost split, and service analytics.
 *   2. Plans           - the plan register (time + meter intervals, combined
 *                        due status) with search / status / category / due-only
 *                        filters, create / edit / delete, and Record service.
 *   3. Service History - the immutable service ledger with filters and export.
 *
 * All maths live in pure, unit-tested engines (pmSchedule / pmAnalytics /
 * pmProgramsAnalytics / costSources); page shaping lives in
 * src/lib/pmProgramsView.js. Data is org-isolated and country-scoped by RLS.
 * Money is never summed across countries: on the All countries view every
 * total that would mix currencies reads N/A with the reason.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  CalendarClock, Wrench, Calendar, AlertTriangle, CheckCircle2, Search, X,
  Plus, Pencil, Trash2, FileSpreadsheet, FileText, Loader2, Save, RefreshCw,
  ClipboardList, Gauge, Wallet, ListChecks, ClipboardCheck, LayoutTemplate, Coins,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, PageHero, Tabs, KitTable, Donut, fmtInt } from '../components/commandCenter/kit'
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
  resolveMeter, pmAssetDueStatus, advanceSchedule,
  summarizePmCompliance,
} from '../lib/pmSchedule'
import {
  PM_STATUS_META, PM_DUE_META, PM_STATUSES,
} from '../lib/pmPrograms'
import { templatesFor, applyTemplate } from '../lib/pmTemplates'
import PmVehicleLookup from '../components/PmVehicleLookup'
import { pmVehicleProfile, pmNextDueFromService } from '../lib/pmVehicleSetup'
import {
  costByAsset, costByCategory, monthlyServiceCost, outcomeBreakdown, pmSummary,
} from '../lib/pmAnalytics'
import { categorical } from '../lib/reportColors'
import {
  COST_MODES, pickCost, costModeLabel, pickMonthly, splitTotals,
} from '../lib/costSources'
import { loadGovernedCostSplit } from '../lib/api/governedCost'
import { generateWorkOrderNo, insertWorkOrder } from '../lib/api/workOrders'
import { listParts } from '../lib/api/partsCatalog'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import {
  sumPartsCost, intervalSummary, filterPlans, filterHistory, dueSortValue, historySummary,
  planExportRows as buildPlanExportRows, historyExportRows as buildHistoryExportRows,
  PLAN_EXPORT_COLS, PLAN_EXPORT_HEADERS, HIST_EXPORT_COLS, HIST_EXPORT_HEADERS,
} from '../lib/pmProgramsAnalytics'
import {
  pillClass, isSingleCountry, pageCurrency, dueDateText, dueMeterText, heroStat,
  kpiValues, bucketRows, segments, barRows, dueQueue, money as fmtMoney,
} from '../lib/pmProgramsView'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import './PmPrograms.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

// ── Presentation maps ─────────────────────────────────────────────────────────
const COST_MODE_COLOR = { combined: '#6366f1', tyres: '#22c55e', maintenance: '#f59e0b' }
const WO_PRIORITY = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
const mapToWOPriority = (p) => WO_PRIORITY[String(p || '').toLowerCase()] || 'Medium'

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

function Pill({ meta, fallback }) {
  return <span className={`cc-pill ${pillClass(meta?.tone)}`}>{meta?.label || fallback || 'N/A'}</span>
}

const NA = <span className="cc-na">N/A</span>

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
  const loadId = useRef(0)
  const [dataWarning, setDataWarning] = useState('')
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
  const [templateId, setTemplateId] = useState('') // create-mode "start from template" selection
  const [selectedVehicle, setSelectedVehicle] = useState(null)
  const vehicleProfile = useMemo(() => pmVehicleProfile(selectedVehicle), [selectedVehicle])
  useEffect(() => { setSelectedVehicle(null); setModalOpen(false) }, [activeCountry])

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Record-service modal
  const [recordFor, setRecordFor] = useState(null) // the plan being serviced
  const [recordForm, setRecordForm] = useState(EMPTY_RECORD)
  const [partDraft, setPartDraft] = useState({ name: '', qty: '', cost: '' })

  // Parts catalog (best-effort). Powers the record-service parts picker; when the
  // table is absent or empty the modal degrades to free-text part entry.
  const [partsCatalog, setPartsCatalog] = useState([])
  const [recording, setRecording] = useState(false)
  const [recordError, setRecordError] = useState('')
  const [recordOk, setRecordOk] = useState('')

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const request = ++loadId.current
    setRefreshing(true); setError(''); setMissing(false); setDataWarning('')
    setDashboard(null); setHistory(null); setCost(null)
    try {
      const [dash, hist, split] = await Promise.all([
        loadPmDashboard({ country: activeCountry }),
        listPmServiceRecords({ country: activeCountry }),
        loadGovernedCostSplit({ country: activeCountry }).catch(() => null),
      ])
      if (request !== loadId.current) return
      if (!split) setDataWarning('Cost information could not be loaded. Cost totals are unavailable.')
      setDashboard(dash || { plans: [], kmByAsset: {}, hoursByAsset: {} })
      setHistory(Array.isArray(hist) ? hist : [])
      setCost(split)
      setNowTs(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      if (request !== loadId.current) return
      if (isMissingRelation(err)) {
        setMissing(true)
        setDashboard({ plans: [], kmByAsset: {}, hoursByAsset: {} })
        setHistory([]); setCost(null)
      } else {
        setError(toUserMessage(err, 'Could not load Preventive Maintenance data.'))
        setDashboard({ plans: [], kmByAsset: {}, hoursByAsset: {} })
        setHistory([]); setCost(null)
      }
    } finally {
      if (request === loadId.current) setRefreshing(false)
    }
  }, [activeCountry])

    // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the current request on cleanup.
  useEffect(() => { load(); return () => { loadId.current++ } }, [load])

  // Load the spare-parts catalog once per country (best-effort, non-blocking).
  useEffect(() => {
    let alive = true
    listParts({ country: activeCountry, status: 'active' })
      .then((rows) => { if (alive) setPartsCatalog(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (alive) setPartsCatalog([]) })
    return () => { alive = false }
  }, [activeCountry])

  const catalogParts = useMemo(
    () => (partsCatalog || []).filter((p) => p && String(p.name || '').trim()),
    [partsCatalog],
  )
  const hasCatalog = catalogParts.length > 0
  const partByName = useMemo(() => {
    const m = new Map()
    for (const p of catalogParts) m.set(String(p.name).trim().toLowerCase(), p)
    return m
  }, [catalogParts])

  const plans = useMemo(() => dashboard?.plans || [], [dashboard])
  const kmByAsset = useMemo(() => dashboard?.kmByAsset || {}, [dashboard])
  const hoursByAsset = useMemo(() => dashboard?.hoursByAsset || {}, [dashboard])

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

  const filteredPlans = useMemo(
    () => filterPlans(enrichedPlans, { search, status: statusFilter, category: categoryFilter, dueOnly }),
    [enrichedPlans, search, statusFilter, categoryFilter, dueOnly],
  )

  const clearPlanFilters = () => { setSearch(''); setStatusFilter('all'); setCategoryFilter('all'); setDueOnly(false) }
  const hasPlanFilters = search || statusFilter !== 'all' || categoryFilter !== 'all' || dueOnly

  const filteredHistory = useMemo(
    () => filterHistory(history || [], { asset: histAsset, program: histProgram, outcome: histOutcome, from: histFrom, to: histTo }),
    [history, histAsset, histProgram, histOutcome, histFrom, histTo],
  )
  const histStats = useMemo(() => historySummary(filteredHistory), [filteredHistory])

  const clearHistFilters = () => { setHistAsset(''); setHistProgram('all'); setHistOutcome('all'); setHistFrom(''); setHistTo('') }
  const hasHistFilters = histAsset || histProgram !== 'all' || histOutcome !== 'all' || histFrom || histTo

  // ── Money scope ───────────────────────────────────────────────────────────
  // One country = one currency. On the All countries view, money that would
  // add SAR, AED and EGP together is withheld rather than mislabelled.
  const singleCountry = isSingleCountry(activeCountry)
  const moneyCurrency = pageCurrency(activeCountry, activeCurrency)
  const MIXED_REASON = 'Choose one country. Costs from several countries are in different currencies.'

  // ── Cost switch derivation (governed Tyres vs Maintenance split) ────────────
  const byMonth = useMemo(() => cost?.byMonth || [], [cost])
  const costTotals = useMemo(() => splitTotals(byMonth), [byMonth])
  const costTotal = pickCost(costMode, costTotals)
  const monthly = useMemo(() => pickMonthly(costMode, byMonth), [costMode, byMonth])
  const costBlended = Boolean(cost?.blended) || !singleCountry
  const costCurrency = cost?.currency && !costBlended ? cost.currency : moneyCurrency
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
        callbacks: { label: (ctx) => `${costModeLabel(costMode)}: ${formatCurrencyCompact(ctx.parsed.y, costCurrency)}` },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
      y: {
        grid: { color: 'var(--panel-2)' },
        ticks: { color: 'var(--text-muted)', font: { size: 10 }, callback: (v) => formatCurrencyCompact(v, costCurrency) },
      },
    },
  }), [costMode, costCurrency])

  // ── PM analytics (over loaded plans + the fetched service records) ────────────
  const records = useMemo(() => history || [], [history])
  const hasServiceData = records.length > 0
  const pmCatCost = useMemo(() => costByCategory(plans, records), [plans, records])
  const pmMonthlyCost = useMemo(() => monthlyServiceCost(records, { now: nowTs, months: 12 }), [records, nowTs])
  const pmOutcomes = useMemo(() => outcomeBreakdown(records), [records])
  const pmTopAssets = useMemo(() => barRows(costByAsset(records), { valueOf: (a) => a.total, limit: 6 }), [records])
  const pmStats = useMemo(() => pmSummary(plans, records, { now: nowTs, kmByAsset, hoursByAsset }), [plans, records, nowTs, kmByAsset, hoursByAsset])
  const catCostRows = useMemo(() => barRows(pmCatCost, { valueOf: (c) => c.total }), [pmCatCost])

  const outcomeSegs = useMemo(() => {
    const rows = pmOutcomes.filter((o) => o.count > 0)
    return segments(rows, {
      keyOf: (o) => o.outcome,
      labelOf: (o) => PM_OUTCOME_META[o.outcome]?.label || o.outcome,
      colors: categorical(rows.length),
    })
  }, [pmOutcomes])

  const categorySegs = useMemo(() => {
    const rows = summary.byCategory || []
    return segments(rows, {
      keyOf: (c) => c.category,
      labelOf: (c) => ASSET_CATEGORY_LABELS[c.category] || c.category,
      colors: categorical(rows.length),
    })
  }, [summary.byCategory])

  const monthlyCostChart = useMemo(() => ({
    labels: pmMonthlyCost.map((m) => monthLabel(m.month)),
    datasets: [{
      label: 'Service cost',
      data: pmMonthlyCost.map((m) => Math.round(m.total)),
      backgroundColor: '#16a34a',
      borderRadius: 4,
      maxBarThickness: 30,
    }],
  }), [pmMonthlyCost])

  const barCostOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => formatCurrencyCompact(ctx.parsed.y, moneyCurrency || '') } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
      y: {
        grid: { color: 'var(--panel-2)' },
        ticks: { color: 'var(--text-muted)', font: { size: 10 }, callback: (v) => formatCurrencyCompact(v, moneyCurrency || '') },
      },
    },
  }), [moneyCurrency])

  const pmMonthlyTotal = useMemo(() => pmMonthlyCost.reduce((s, m) => s + (m.total || 0), 0), [pmMonthlyCost])

  // ── Create / edit ───────────────────────────────────────────────────────────
  const openCreate = () => {
    setSelectedVehicle(null)
    setEditing(null); setForm(EMPTY_FORM); setTaskDraft(''); setFormError(''); setTemplateId(''); setModalOpen(true)
  }
  const openEdit = (p) => {
    setSelectedVehicle(null)
    setEditing(p); setTemplateId('')
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

  // "Start from a template" (create mode only). Templates are editable starting
  // points drawn from common OEM service practice, NOT live data.
  const availableTemplates = useMemo(
    () => templatesFor(canonAssetCategory(form.asset_category) || null)
      .filter(t => !vehicleProfile || vehicleProfile.sources.includes(t.meter_source)),
    [form.asset_category, vehicleProfile],
  )
  const applyTpl = (id) => {
    setTemplateId(id)
    if (!id) return
    const t = availableTemplates.find((x) => x.id === id)
    if (!t) return
    const a = applyTemplate(t)
    setForm((f) => ({
      ...f,
      // Prefill every field the template covers; keep a name / notes the user
      // has already typed, and never touch asset / site / assignee / dates.
      name: f.name.trim() ? f.name : (a.name || ''),
      asset_category: a.asset_category || f.asset_category,
      priority: a.priority || f.priority,
      interval_type: (a.interval_type === 'days' || a.interval_type === 'months') ? a.interval_type : f.interval_type,
      interval_value: a.interval_value != null ? String(a.interval_value) : f.interval_value,
      meter_source: a.meter_source || f.meter_source,
      meter_interval: (a.meter_source && a.meter_source !== 'none' && a.meter_interval != null) ? String(a.meter_interval) : f.meter_interval,
      task_list: Array.isArray(a.task_list) ? [...a.task_list] : f.task_list,
      notes: f.notes.trim() ? f.notes : (a.notes || ''),
    }))
  }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.name.trim()) { setFormError('Program name is required.'); return }
    if (form.asset_no.trim() && (!editing || form.asset_no !== editing.asset_no) && !selectedVehicle) { setFormError('Find and confirm the vehicle before saving its service plan.'); return }
    if ((form.interval_value !== '' && (!Number.isFinite(Number(form.interval_value)) || Number(form.interval_value) <= 0))
      || (form.meter_source !== 'none' && (!Number.isFinite(Number(form.meter_interval)) || Number(form.meter_interval) <= 0))) {
      setFormError('Enter a positive service interval for every enabled schedule.'); return
    }
    setSaving(true)
    try {
      const meterNone = form.meter_source === 'none'
      const payload = {
        name: form.name,
        asset_no: form.asset_no || null,
        asset_type: selectedVehicle?.vehicle_type || editing?.asset_type || null,
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
        const created = await createPmProgram({ ...payload, country: selectedVehicle?.country || (activeCountry !== 'All' ? activeCountry : null) })
        setDashboard((d) => ({ ...(d || { kmByAsset: {}, hoursByAsset: {} }), plans: [created, ...(d?.plans || [])] }))
      }
      setModalOpen(false)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the plan.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, selectedVehicle])

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
    setPartDraft({ name: '', qty: '', cost: '' })
    setRecordError(''); setRecordOk('')
  }
  const setRecordField = (k, v) => setRecordForm((f) => ({ ...f, [k]: v }))
  const toggleTaskDone = (task) => setRecordForm((f) => ({
    ...f,
    tasks_done: f.tasks_done.includes(task) ? f.tasks_done.filter((t) => t !== task) : [...f.tasks_done, task],
  }))
  // Selecting / typing a part name auto-fills the unit cost from the catalog when
  // the field is empty (never clobbers a cost the user has already typed).
  const onPartNameChange = (v) => setPartDraft((d) => {
    const next = { ...d, name: v }
    const match = partByName.get(String(v).trim().toLowerCase())
    if (match && (d.cost === '' || d.cost == null) && match.unit_cost != null) next.cost = String(match.unit_cost)
    return next
  })
  const addPart = () => {
    const name = partDraft.name.trim()
    if (!name) return
    const qtyN = partDraft.qty === '' ? 1 : Number(partDraft.qty)
    const costN = partDraft.cost === '' ? null : Number(partDraft.cost)
    const part = {
      name,
      qty: Number.isFinite(qtyN) && qtyN > 0 ? qtyN : 1,
      cost: Number.isFinite(costN) ? costN : null,
    }
    setRecordForm((f) => {
      const parts_used = [...f.parts_used, part]
      const sum = sumPartsCost(parts_used)
      return { ...f, parts_used, parts_cost: sum > 0 ? String(sum) : f.parts_cost }
    })
    setPartDraft((d) => ({ name: '', qty: '', cost: '', _task: d._task }))
  }
  const removePart = (i) => setRecordForm((f) => {
    const parts_used = f.parts_used.filter((_, idx) => idx !== i)
    const sum = sumPartsCost(parts_used)
    return { ...f, parts_used, parts_cost: sum > 0 ? String(sum) : f.parts_cost }
  })

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
  const PLAN_COLS = PLAN_EXPORT_COLS
  const PLAN_HEADERS = PLAN_EXPORT_HEADERS
  const planExportRows = buildPlanExportRows(filteredPlans)
  const planFileName = () => reportFileName('Preventive Maintenance Plans', reportDateLabel())
  const exportPlansExcel = () => exportToExcel(planExportRows, PLAN_COLS, PLAN_HEADERS, planFileName(), 'Plans', { title: 'Preventive Maintenance Plans', currency: activeCurrency })
  const exportPlansPdf = () => exportToPdf(planExportRows, PLAN_COLS.map((k, i) => ({ key: k, header: PLAN_HEADERS[i] })), 'Preventive Maintenance Plans', planFileName(), 'landscape', '', { currency: activeCurrency })

  const HIST_COLS = HIST_EXPORT_COLS
  const HIST_HEADERS = HIST_EXPORT_HEADERS
  const histExportRows = buildHistoryExportRows(filteredHistory, planNameById)
  const histFileName = () => reportFileName('Preventive Maintenance Service History', reportDateLabel())
  const exportHistExcel = () => exportToExcel(histExportRows, HIST_COLS, HIST_HEADERS, histFileName(), 'History', { title: 'Preventive Maintenance Service History', currency: activeCurrency })
  const exportHistPdf = () => exportToPdf(histExportRows, HIST_COLS.map((k, i) => ({ key: k, header: HIST_HEADERS[i] })), 'Preventive Maintenance Service History', histFileName(), 'landscape', '', { currency: activeCurrency })


  const notLoaded = dashboard === null
  const pageState = { loading: notLoaded && !error, data: notLoaded ? null : true, error: notLoaded && error ? error : null, retry: load }
  const kv = kpiValues({ summary, monthlyServiceTotal: pmMonthlyTotal, singleCountry, loaded: !notLoaded })
  const queue = dueQueue(summary.dueList, 8)
  const buckets = bucketRows(summary.buckets, summary.active)
  const dash = (v) => (v == null ? 'N/A' : fmtInt(v))
  const rowMoney = (v) => fmtMoney(v, moneyCurrency)
  const curLabel = moneyCurrency ? ` (${moneyCurrency})` : ''

  const goPlans = (patch = {}) => {
    setTab('plans')
    if (patch.dueOnly != null) setDueOnly(patch.dueOnly)
    if (patch.status) setStatusFilter(patch.status)
  }

  // ── Register columns (KitTable over EnterpriseTable) ────────────────────────
  const planColumns = [
    {
      key: 'name', header: 'Plan',
      cell: (p) => (
        <span className="pmp-plan">
          <b>{p.name || 'N/A'}</b>
          {p.site && <small>{p.site}</small>}
        </span>
      ),
    },
    {
      key: 'asset_no', header: 'Asset',
      cell: (p) => (
        <span className="pmp-plan">
          <b className="pmp-mono">{p.asset_no || 'N/A'}</b>
          {p.asset_category && <small>{ASSET_CATEGORY_LABELS[p.asset_category] || p.asset_category}</small>}
        </span>
      ),
    },
    {
      key: 'interval', header: 'Interval', sortable: false,
      sortValue: (p) => intervalSummary(p).map((it) => it.text).join(' / '),
      cell: (p) => {
        const intervals = intervalSummary(p)
        return intervals.length === 0 ? NA : <span className="pmp-plan">{intervals.map((it) => <small key={it.key} className="pmp-strong">{it.text}</small>)}</span>
      },
    },
    {
      key: 'next_due', header: 'Next due',
      sortValue: (p) => dueSortValue(p._st),
      cell: (p) => {
        const st = p._st
        const unit = st.unit || meterUnit(p.meter_source)
        const dt = dueDateText(st.daysToDue)
        const mt = p.next_due_meter != null ? dueMeterText(st.meterRemaining, unit) : null
        return (
          <span className="pmp-plan">
            <Pill meta={PM_DUE_META[st.band]} />
            {p.next_due && <small>{fmtDate(p.next_due)}{dt ? `, ${dt}` : ''}</small>}
            {p.next_due_meter != null && unit && <small>{fmtNum(p.next_due_meter)} {unit}{mt ? `, ${mt}` : ''}</small>}
          </span>
        )
      },
    },
    {
      key: 'priority', header: 'Priority',
      sortValue: (p) => PM_PRIORITIES.indexOf(p.priority),
      cell: (p) => <Pill meta={PM_PRIORITY_META[p.priority]} fallback={p.priority} />,
    },
    { key: 'assigned_to', header: 'Assigned', cell: (p) => p.assigned_to || NA },
    {
      key: 'status', header: 'Status',
      cell: (p) => <Pill meta={PM_STATUS_META[p.status]} fallback={p.status} />,
    },
    {
      key: 'actions', header: 'Actions', sortable: false,
      cell: (p) => (
        <div className="pmp-actions">
          <button type="button" className="cc-btn-ghost pmp-service" onClick={(e) => { e.stopPropagation(); openRecord(p) }}><Wrench size={13} aria-hidden="true" /> Service</button>
          <button type="button" className="cc-icon-btn" onClick={(e) => { e.stopPropagation(); openEdit(p) }} aria-label={`Edit ${p.name || 'plan'}`}><Pencil size={14} /></button>
          <button type="button" className="cc-icon-btn pmp-danger" onClick={(e) => { e.stopPropagation(); setConfirmDelete(p) }} aria-label={`Delete ${p.name || 'plan'}`}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ]

  const histColumns = [
    { key: 'service_date', header: 'Date', cell: (r) => <span className="pmp-nowrap">{fmtDate(r.service_date)}</span> },
    { key: 'asset_no', header: 'Asset', cell: (r) => (r.asset_no ? <span className="pmp-mono">{r.asset_no}</span> : NA) },
    {
      key: 'plan', header: 'Plan',
      sortValue: (r) => planNameById.get(String(r.pm_program_id)) || '',
      cell: (r) => planNameById.get(String(r.pm_program_id)) || NA,
    },
    {
      key: 'meter_reading', header: 'Meter', numeric: true,
      cell: (r) => {
        const unit = meterUnit(r.meter_type)
        return r.meter_reading != null ? <span className="pmp-nowrap">{fmtNum(r.meter_reading)}{unit ? ` ${unit}` : ''}</span> : NA
      },
    },
    { key: 'performed_by', header: 'Performed by', cell: (r) => r.performed_by || NA },
    {
      key: 'outcome', header: 'Outcome',
      cell: (r) => <Pill meta={PM_OUTCOME_META[r.outcome]} fallback={r.outcome} />,
    },
    { key: 'parts_cost', header: `Parts${curLabel}`, numeric: true, cell: (r) => rowMoney(r.parts_cost) },
    { key: 'labour_cost', header: `Labour${curLabel}`, numeric: true, cell: (r) => rowMoney(r.labour_cost) },
    { key: 'total_cost', header: `Total${curLabel}`, numeric: true, cell: (r) => <b>{rowMoney(r.total_cost)}</b> },
    {
      key: 'next_due', header: 'Next due',
      cell: (r) => {
        const unit = meterUnit(r.meter_type)
        return (
          <span className="pmp-plan">
            <span className="pmp-nowrap">{fmtDate(r.next_due)}</span>
            {r.next_due_meter != null && unit && <small>{fmtNum(r.next_due_meter)} {unit}</small>}
          </span>
        )
      },
    },
    { key: 'work_order_no', header: 'WO no', cell: (r) => (r.work_order_no ? <span className="pmp-mono">{r.work_order_no}</span> : NA) },
  ]

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="cc pmp-page">
      <PageHero
        icon={CalendarClock}
        hello="Workshop and Downtime / Preventive Maintenance"
        title="Preventive Maintenance"
        lead="Time and meter based service plans for every asset: vehicles, generators, plant, machinery and equipment. Record services, advance schedules and see what it costs."
        stat={heroStat(summary, !notLoaded)}
      />

      <div className="cc-card pmp-bar">
        <Tabs label="Preventive maintenance views" value={tab} onChange={setTab} tabs={[
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'plans', label: 'Plans', count: notLoaded ? null : plans.length },
          { key: 'history', label: 'Service history', count: history === null ? null : history.length },
        ]} />
        <div className="pmp-bar-actions">
          {updatedAt && <span className="pmp-updated">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button type="button" className="cc-btn-ghost" onClick={load} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'pmp-spin' : ''} aria-hidden="true" /> Refresh
          </button>
          <button type="button" className="cc-btn-primary" onClick={openCreate} disabled={missing}>
            <Plus size={15} aria-hidden="true" /> New plan
          </button>
        </div>
      </div>

      {missing && (
        <div className="cc-card pmp-banner warn" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <p>Preventive Maintenance is not enabled on this database yet. Apply MIGRATIONS_V253.sql, then reload.</p>
        </div>
      )}
      {error && (
        <div className="cc-card pmp-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <p>Something went wrong. {error}</p>
          <button type="button" className="cc-btn-ghost" onClick={load} disabled={refreshing}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {dataWarning && (
        <div className="cc-card pmp-banner warn" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <p>{dataWarning}</p>
        </div>
      )}
      {recordOk && (
        <div className="cc-card pmp-banner good" role="status">
          <CheckCircle2 size={17} aria-hidden="true" />
          <p>{recordOk}</p>
          <button type="button" className="cc-icon-btn" onClick={() => setRecordOk('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      {tab !== 'history' && (
      <div className="cc-kpis pmp-kpis">
        <Kpi icon={ClipboardList} tone="t-green" display={dash(kv.active)} label="Active plans" loading={notLoaded && !error}
          title={notLoaded ? undefined : `${fmtInt(summary.total)} plans in total`} onClick={() => goPlans({ status: 'active', dueOnly: false })} />
        <Kpi icon={AlertTriangle} tone="t-red" display={dash(kv.overdue)} label="Overdue" loading={notLoaded && !error} danger={kv.overdue > 0}
          title="Active plans past their due date or meter limit" onClick={() => goPlans({ dueOnly: true })} />
        <Kpi icon={Calendar} tone="t-amber" display={dash(kv.dueSoon)} label="Due soon" loading={notLoaded && !error}
          title="Active plans due within the warning window by date or meter" onClick={() => goPlans({ dueOnly: true })} />
        <Kpi icon={ClipboardCheck} tone="t-blue" display={kv.compliance == null ? 'N/A' : `${kv.compliance}%`} label="Compliance" loading={notLoaded && !error}
          title={kv.compliance == null ? 'No active plans to measure' : 'Share of active plans that are not overdue'} />
        <Kpi icon={Coins} tone="t-purple" display={kv.serviceCost12m == null ? 'N/A' : fmtMoney(kv.serviceCost12m, moneyCurrency)} label="Service cost, last 12 months" loading={notLoaded && !error}
          title={kv.costReason || 'Total cost of services recorded in the last 12 months'} onClick={() => setTab('history')} />
      </div>
      )}

      {/* ══════════════════════════ DASHBOARD ══════════════════════════ */}
      {tab === 'dashboard' && (
        <div className="pmp-grid">
          <Card className="pmp-a-due" title="Due now" sub="Overdue and due soon, worst first. Record the service to advance the schedule."
            action={queue.total > 0 ? <button type="button" className="cc-link cc-link-btn" onClick={() => goPlans({ dueOnly: true })}>View all {fmtInt(queue.total)}</button> : null}>
            <CardState state={pageState} lines={5}
              empty={!notLoaded && queue.total === 0 ? (summary.active > 0 ? 'Every active plan is on schedule.' : 'No active plans yet. Create a plan to start scheduling services.') : null}>
              <ul className="pmp-due">
                {queue.rows.map((p) => {
                  const dt = dueDateText(p.daysToDue)
                  const mt = p.next_due_meter != null ? dueMeterText(p.meterRemaining, p.unit || meterUnit(p.meter_source)) : null
                  return (
                    <li key={p.id} className={p.band === 'overdue' ? 'is-bad' : 'is-warn'}>
                      <span className="pmp-due-main">
                        <b>{p.name || 'Plan'}</b>
                        <small>{[p.asset_no || ASSET_CATEGORY_LABELS[p.asset_category] || 'Asset', dt, mt].filter(Boolean).join(' | ')}</small>
                      </span>
                      <Pill meta={PM_DUE_META[p.band]} />
                      <button type="button" className="cc-btn-ghost pmp-service" onClick={() => openRecord(p)}><Wrench size={13} aria-hidden="true" /> Service</button>
                    </li>
                  )
                })}
              </ul>
              {queue.more > 0 && <p className="pmp-note">{fmtInt(queue.more)} more in the Plans tab.</p>}
            </CardState>
          </Card>

          <Card className="pmp-a-up" title="Upcoming services" sub="Active plans due by date or meter in each window">
            <CardState state={pageState} lines={3}>
              <div className="pmp-bars">
                {buckets.map((b) => (
                  <div key={b.key} className="pmp-bar-row">
                    <span>{b.label}</span>
                    <span className="cc-bar-track"><i style={{ width: `${b.pct}%`, background: 'var(--cc-green)' }} /></span>
                    <b>{fmtInt(b.count)}</b>
                  </div>
                ))}
              </div>
              <p className="pmp-note">{summary.active > 0 ? `Out of ${fmtInt(summary.active)} active plans.` : 'No active plans to schedule yet.'}</p>
            </CardState>
          </Card>

          <Card className="pmp-a-cat" title="Plans by asset category" sub="Active plans">
            <CardState state={pageState} lines={3} empty={!notLoaded && categorySegs.length === 0 ? 'No active plans to categorise yet.' : null}>
              <Donut segments={categorySegs} centerLabel="active plans"
                onSelect={(s) => { setTab('plans'); setCategoryFilter(s.key); setStatusFilter('active') }} />
            </CardState>
          </Card>

          <Card className="pmp-a-cost" title="Cost view" sub="One-click Tyres vs Maintenance, from the governed cost split"
            action={(
              <div className="pmp-seg" role="group" aria-label="Cost view">
                {COST_MODES.map((m) => (
                  <button key={m.key} type="button" aria-pressed={costMode === m.key} onClick={() => setCostMode(m.key)}
                    style={costMode === m.key ? { background: COST_MODE_COLOR[m.key], borderColor: COST_MODE_COLOR[m.key] } : undefined}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}>
            {cost === null && notLoaded ? (
              <div className="pmp-cost-grid">{[0, 1].map((i) => <div key={i} className="cc-skel" style={{ height: 180 }} />)}</div>
            ) : costBlended ? (
              <div className="cc-empty">{MIXED_REASON}</div>
            ) : cost === null ? (
              <div className="cc-empty">Cost information could not be loaded.<br /><button type="button" className="cc-btn" onClick={load}>Try again</button></div>
            ) : (
              <div className="pmp-cost-grid">
                <div className="pmp-cost-total">
                  <span>{costModeLabel(costMode)} cost</span>
                  <b style={{ color: COST_MODE_COLOR[costMode] }}>{formatCurrencyCompact(costTotal, costCurrency)}</b>
                  <dl>
                    <div><dt>Tyres</dt><dd>{formatCurrencyCompact(costTotals.tyre, costCurrency)}</dd></div>
                    <div><dt>Maintenance</dt><dd>{formatCurrencyCompact(costTotals.maintenance, costCurrency)}</dd></div>
                    <div className="pmp-cost-sum"><dt>Combined</dt><dd>{formatCurrencyCompact(costTotals.combined, costCurrency)}</dd></div>
                  </dl>
                </div>
                <div className="pmp-chart">
                  {monthly.length === 0
                    ? <div className="cc-empty">No cost history for this country yet.</div>
                    : <Bar data={costChartData} options={costChartOpts} />}
                </div>
              </div>
            )}
          </Card>

          <Card className="pmp-a-svc" title="Service analytics" sub="From recorded services"
            action={hasServiceData ? (
              <div className="pmp-svc-stats">
                <span>Services <b>{fmtInt(pmStats.servicesCount)}</b></span>
                <span>Total <b>{singleCountry ? fmtMoney(pmStats.totalServiceCost, moneyCurrency) : 'N/A'}</b></span>
                <span>Average <b>{singleCountry && pmStats.avgCostPerService != null ? fmtMoney(pmStats.avgCostPerService, moneyCurrency) : 'N/A'}</b></span>
              </div>
            ) : null}>
            <CardState state={{ ...pageState, loading: (notLoaded || history === null) && !error }} lines={4}
              empty={!notLoaded && history !== null && !hasServiceData ? 'No services recorded yet. Record a service from the Plans tab to build cost and outcome analytics.' : null}>
              {!singleCountry && <p className="pmp-note pmp-note-top">{MIXED_REASON} Counts and outcomes below cover every country.</p>}
              <div className="pmp-svc-grid">
                <div className="pmp-inner">
                  <h3>Service cost by category</h3>
                  {!singleCountry ? <div className="cc-empty">N/A</div> : catCostRows.length === 0 ? <div className="cc-empty">No categorised service cost yet.</div> : (
                    <div className="pmp-bars">
                      {catCostRows.map((c, i) => (
                        <div key={c.category} className="pmp-bar-row">
                          <span>{ASSET_CATEGORY_LABELS[c.category] || c.category}</span>
                          <span className="cc-bar-track"><i style={{ width: `${c.pct}%`, background: categorical(catCostRows.length)[i] }} /></span>
                          <b>{fmtMoney(c.value, moneyCurrency)}</b>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="pmp-inner">
                  <h3>Service cost, last 12 months</h3>
                  <div className="pmp-chart">
                    {!singleCountry ? <div className="cc-empty">N/A</div> : pmMonthlyTotal > 0
                      ? <Bar data={monthlyCostChart} options={barCostOpts} />
                      : <div className="cc-empty">No service cost in the last 12 months.</div>}
                  </div>
                </div>
                <div className="pmp-inner">
                  <h3>Outcome breakdown</h3>
                  {outcomeSegs.length === 0
                    ? <div className="cc-empty">No recorded outcomes yet.</div>
                    : <Donut segments={outcomeSegs} centerLabel="services" onSelect={(s) => { setTab('history'); setHistOutcome(s.key) }} />}
                </div>
                <div className="pmp-inner">
                  <h3>Top cost assets</h3>
                  {!singleCountry ? <div className="cc-empty">N/A</div> : pmTopAssets.length === 0 ? <div className="cc-empty">No asset level service cost yet.</div> : (
                    <ol className="pmp-rank">
                      {pmTopAssets.map((a, i) => (
                        <li key={a.asset_no}>
                          <span className="pmp-rank-n">{i + 1}</span>
                          <button type="button" className="pmp-rank-main" onClick={() => { setTab('history'); setHistAsset(a.asset_no) }} title="Show this asset's service history">
                            <b className="pmp-mono">{a.asset_no}</b>
                            <span className="cc-bar-track"><i style={{ width: `${a.pct}%`, background: 'var(--cc-green)' }} /></span>
                          </button>
                          <span className="pmp-rank-val">{fmtMoney(a.value, moneyCurrency)}<small>{fmtInt(a.services)} svc</small></span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </CardState>
          </Card>
        </div>
      )}

      {/* ══════════════════════════ PLANS ══════════════════════════ */}
      {tab === 'plans' && (
        <Card title="Maintenance plans" sub={`${fmtInt(filteredPlans.length)} of ${fmtInt(plans.length)} plans`}
          action={(
            <div className="pmp-exports">
              <button type="button" className="cc-btn-ghost" onClick={exportPlansExcel} disabled={!planExportRows.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
              <button type="button" className="cc-btn-ghost" onClick={exportPlansPdf} disabled={!planExportRows.length}><FileText size={14} aria-hidden="true" /> PDF</button>
            </div>
          )}>
          <div className="cc-filters pmp-filters">
            <label className="cc-search">
              <Search size={15} aria-hidden="true" />
              <input aria-label="Search plans" placeholder="Search plan, asset, category, site, assignee" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <select className="cc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
              <option value="all">All statuses</option>
              {PM_STATUSES.map((s) => <option key={s} value={s}>{PM_STATUS_META[s]?.label || s}</option>)}
            </select>
            <select className="cc-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
              <option value="all">All categories</option>
              {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{ASSET_CATEGORY_LABELS[c]}</option>)}
            </select>
            <button type="button" className={`cc-btn-ghost ${dueOnly ? 'pmp-on' : ''}`} aria-pressed={dueOnly} onClick={() => setDueOnly((v) => !v)}>
              <AlertTriangle size={14} aria-hidden="true" /> Due only
            </button>
            {hasPlanFilters && <button type="button" className="cc-btn-ghost" onClick={clearPlanFilters}><X size={14} aria-hidden="true" /> Clear</button>}
          </div>
          <KitTable
            columns={planColumns}
            rows={filteredPlans}
            getRowId={(p) => String(p.id)}
            loading={notLoaded && !error}
            error={notLoaded && error ? error : null}
            onRetry={load}
            viewKey="pm-plans"
            empty={plans.length === 0 ? 'No maintenance plans yet. Create the first plan to get started.' : 'No plans match these filters.'}
          />
        </Card>
      )}

      {/* ══════════════════════════ SERVICE HISTORY ══════════════════════════ */}
      {tab === 'history' && (
        <>
          <div className="cc-kpis pmp-hist-kpis">
            <Kpi icon={Wrench} tone="t-green" display={history === null ? 'N/A' : fmtInt(histStats.services)} label={`Services, ${fmtInt(histStats.assets)} assets`} loading={history === null && !error} />
            <Kpi icon={Wallet} tone="t-purple" display={singleCountry ? rowMoney(histStats.totalCost) : 'N/A'} label="Total service cost" loading={history === null && !error}
              title={!singleCountry ? MIXED_REASON : histStats.costedShare == null ? 'No services' : `${Math.round(histStats.costedShare * 100)}% of services costed`} />
            <Kpi icon={Gauge} tone="t-blue" display={singleCountry ? rowMoney(histStats.avgCost) : 'N/A'} label="Average per service" loading={history === null && !error}
              title={singleCountry ? 'Costed services only' : MIXED_REASON} />
            <Kpi icon={ClipboardList} tone="t-amber" display={history === null ? 'N/A' : fmtInt(histStats.withWorkOrder)} label="Raised a work order" loading={history === null && !error}
              title={histStats.services ? `${Math.round((histStats.withWorkOrder / histStats.services) * 100)}% of services` : 'No services'} />
          </div>
          <Card title="Service history" sub="Every recorded service. The summary above follows these filters."
            action={(
              <div className="pmp-exports">
                <button type="button" className="cc-btn-ghost" onClick={exportHistExcel} disabled={!histExportRows.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                <button type="button" className="cc-btn-ghost" onClick={exportHistPdf} disabled={!histExportRows.length}><FileText size={14} aria-hidden="true" /> PDF</button>
              </div>
            )}>
            <div className="cc-filters pmp-filters">
              <label className="cc-search">
                <Search size={15} aria-hidden="true" />
                <input aria-label="Filter by asset number" placeholder="Filter by asset number" value={histAsset} onChange={(e) => setHistAsset(e.target.value)} />
              </label>
              <select className="cc-select" value={histProgram} onChange={(e) => setHistProgram(e.target.value)} aria-label="Plan">
                <option value="all">All plans</option>
                {plans.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </select>
              <select className="cc-select" value={histOutcome} onChange={(e) => setHistOutcome(e.target.value)} aria-label="Outcome">
                <option value="all">All outcomes</option>
                {PM_OUTCOMES.map((o) => <option key={o} value={o}>{PM_OUTCOME_META[o]?.label || o}</option>)}
              </select>
              <label className="pmp-date"><span>From</span><input type="date" className="cc-select" value={histFrom} onChange={(e) => setHistFrom(e.target.value)} aria-label="From date" /></label>
              <label className="pmp-date"><span>To</span><input type="date" className="cc-select" value={histTo} onChange={(e) => setHistTo(e.target.value)} aria-label="To date" /></label>
              {hasHistFilters && <button type="button" className="cc-btn-ghost" onClick={clearHistFilters}><X size={14} aria-hidden="true" /> Clear</button>}
            </div>
            {!singleCountry && <p className="pmp-note pmp-note-top">Costs are shown without a currency on the All countries view because rows come from several countries. Choose one country to see them in its currency.</p>}
            <KitTable
              columns={histColumns}
              rows={filteredHistory}
              getRowId={(r) => String(r.id)}
              loading={history === null && !error}
              error={history === null && error ? error : null}
              onRetry={load}
              viewKey="pm-history"
              empty={(history || []).length === 0 ? 'No services recorded yet. Record a service from the Plans tab.' : 'No services match these filters.'}
            />
          </Card>
        </>
      )}

      {/* ══════════════════════════ CREATE / EDIT MODAL ══════════════════════════ */}
      <Modal
        open={modalOpen}
        onClose={() => { if (!saving) setModalOpen(false) }}
        size="lg"
        title={editing ? 'Edit maintenance plan' : 'New maintenance plan'}
      >
        <form onSubmit={submit} className="space-y-5">
          <PmVehicleLookup key={`${activeCountry}:${editing?.id || 'new'}`} value={form.asset_no} country={activeCountry}
            onChange={value => { setSelectedVehicle(null); setTemplateId(''); setField('asset_no', value) }}
            onSelect={vehicle => {
              const profile = pmVehicleProfile(vehicle)
              setSelectedVehicle(vehicle); setTemplateId('')
              setForm(f => ({ ...f, asset_no: vehicle.asset_no, site: vehicle.site || '', asset_category: profile.category || '',
                ...(editing?.asset_no === vehicle.asset_no && editing?.country === vehicle.country ? {} :
                  { meter_source: 'none', meter_interval: '', last_done_meter: '', next_due_meter: '', last_done: '', next_due: '' }) }))
            }} />
          {selectedVehicle && <p className="text-sm text-[var(--text-secondary)]">
            {selectedVehicle.asset_no} · {selectedVehicle.vehicle_type || 'Vehicle type not recorded'} · {[selectedVehicle.make, selectedVehicle.model, selectedVehicle.site, selectedVehicle.country].filter(Boolean).join(' · ')}
            <span className="block text-xs mt-1">Choose the service below. Confirm its intervals against this vehicle’s service specification; current readings are not the last service reading.</span>
          </p>}
          {/* Start from a template (create mode only) */}
          {!editing && (
            <div className="rounded-xl border border-indigo-800/40 bg-indigo-500/5 p-4">
              <div className="flex items-center gap-2 mb-1">
                <LayoutTemplate size={15} className="text-indigo-300" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Start from a template</h3>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">
                Suggested service intervals, not a verified specification for this vehicle. Select its service and confirm the intervals before saving. The date or applicable meter limit that is reached first determines when service is due.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[240px]">
                  <label className="label">Template{form.asset_category ? ` (${ASSET_CATEGORY_LABELS[canonAssetCategory(form.asset_category)] || 'category'})` : ''}</label>
                  <select className="input w-full" value={templateId} onChange={(e) => applyTpl(e.target.value)}>
                    <option value="">No template : start from blank</option>
                    {availableTemplates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                {templateId && (
                  <div className="text-[11px] text-[var(--text-muted)] pb-2">
                    Prefilled {form.task_list.length} task{form.task_list.length === 1 ? '' : 's'}. Every field stays editable.
                  </div>
                )}
              </div>
              {availableTemplates.length === 0 && (
                <p className="text-[11px] text-[var(--text-muted)]">No templates for this category yet. Choose another category or build the plan manually below.</p>
              )}
            </div>
          )}

          {/* Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Plan name<span className="text-red-400"> *</span></label>
              <input className="input w-full" placeholder="e.g. 250 hour generator service" value={form.name} maxLength={200} onChange={(e) => setField('name', e.target.value)} />
            </div>
            <div>
              <label className="label">Asset category</label>
              <select className="input w-full" value={form.asset_category} disabled={Boolean(vehicleProfile?.category)} onChange={(e) => setField('asset_category', e.target.value)}>
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
                  {METER_SOURCES.filter(m => !vehicleProfile || vehicleProfile.sources.includes(m)).map((m) => <option key={m} value={m}>{METER_SOURCE_LABELS[m]}</option>)}
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
          <button type="button" className="btn-secondary text-sm" onClick={() => {
            const next = pmNextDueFromService(form)
            if (!Object.keys(next).length) { setFormError('Enter the last service date or reading and its interval to calculate the next due.'); return }
            setForm(f => ({ ...f, ...next })); setFormError('')
          }}>Calculate next due from last service</button>
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
      </Modal>

      {/* ══════════════════════════ RECORD SERVICE MODAL ══════════════════════════ */}
      {recordFor && (
        <Modal
          open
          onClose={() => { if (!recording) setRecordFor(null) }}
          size="lg"
          title="Record service"
          subtitle={`${recordFor.name}${recordFor.asset_no ? ` | ${recordFor.asset_no}` : ''}`}
        >
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
              {hasCatalog && (
                <datalist id="pm-parts-catalog">
                  {catalogParts.slice(0, 1000).map((p) => (
                    <option key={p.id} value={p.name} label={p.unit_cost != null ? `${activeCurrency} ${p.unit_cost}${p.part_no ? ` (${p.part_no})` : ''}` : (p.part_no || '')} />
                  ))}
                </datalist>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input flex-1 min-w-[180px]"
                  list={hasCatalog ? 'pm-parts-catalog' : undefined}
                  placeholder={hasCatalog ? 'Search catalog or type a part' : 'Part name'}
                  value={partDraft.name}
                  onChange={(e) => onPartNameChange(e.target.value)}
                />
                <input type="number" min="1" step="1" className="input w-20" placeholder="Qty" value={partDraft.qty} onChange={(e) => setPartDraft((d) => ({ ...d, qty: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPart() } }} />
                <input type="number" min="0" step="any" className="input w-32" placeholder={`Unit cost (${activeCurrency})`} value={partDraft.cost} onChange={(e) => setPartDraft((d) => ({ ...d, cost: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPart() } }} />
                <button type="button" onClick={addPart} className="btn-secondary text-sm inline-flex items-center gap-1"><Plus size={14} /> Add</button>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                {hasCatalog
                  ? 'Pick a catalog part to auto-fill its unit cost, or type an ad-hoc part. Line costs sum into Parts cost below.'
                  : 'Type any part and unit cost. Line costs sum into Parts cost below.'}
              </p>
              {recordForm.parts_used.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {recordForm.parts_used.map((p, i) => {
                    const q = Number(p.qty) > 0 ? Number(p.qty) : 1
                    const lineTotal = (Number.isFinite(Number(p.cost)) ? Number(p.cost) : 0) * q
                    return (
                      <li key={i} className="flex items-center gap-2 text-sm text-[var(--text-secondary)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2.5 py-1.5">
                        <span className="flex-1 truncate">{q > 1 ? `${fmtNum(q)} x ` : ''}{p.name}</span>
                        <span className="text-[var(--text-muted)] text-[12px] whitespace-nowrap">{p.cost != null ? formatCurrencyCompact(p.cost, activeCurrency) : 'no cost'}</span>
                        <span className="w-24 text-right text-[var(--text-secondary)] whitespace-nowrap">{p.cost != null ? formatCurrencyCompact(lineTotal, activeCurrency) : ''}</span>
                        <button type="button" onClick={() => removePart(i)} className="text-[var(--text-muted)] hover:text-red-400"><X size={13} /></button>
                      </li>
                    )
                  })}
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
        </Modal>
      )}

      {/* ══════════════════════════ DELETE CONFIRMATION ══════════════════════════ */}
      {confirmDelete && (
        <Modal
          open
          onClose={() => { if (!deleting) setConfirmDelete(null) }}
          size="sm"
          title="Delete maintenance plan?"
          footer={(
            <>
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="btn-secondary">Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-500 border-red-600 inline-flex items-center gap-2 disabled:opacity-60">
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting' : 'Delete'}
              </button>
            </>
          )}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0">
              <Trash2 size={20} className="text-red-400" />
            </div>
            <p className="flex-1 text-sm text-[var(--text-muted)]">
              This permanently removes <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.name}</span>. Recorded service history is retained. This cannot be undone.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
