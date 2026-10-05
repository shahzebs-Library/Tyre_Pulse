/**
 * DailyOps (route /daily-ops): live operational control for the selected day,
 * rebuilt on the Command Center kit to the owner's Daily Ops mockup.
 *
 * Real sources (read under RLS, country scoped): tyre_records, inspections,
 * work_orders, alerts, accidents and action_items (with realtime updates and
 * the audited transition_action_item lifecycle), plus shift_handovers.
 *
 * What the mockup shows that this database cannot: a live GPS map, trips in
 * progress, ETAs, distance remaining and driver contact for a trip. trips and
 * gps_positions hold no rows, so those surfaces state that plainly instead of
 * drawing invented positions. The dispatch board is built on work orders (the
 * real "jobs" of the day). Pure shaping lives in src/lib/dailyOpsView.js and
 * src/lib/dailyOpsAnalytics.js.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, CheckCircle2, ClipboardList,
  Clock, Wrench, Truck, FileText, Printer, Download, Bell, User, Timer, Ban, Siren,
  History, Send, CheckCheck, MonitorPlay, Search, MapPin, Gauge, Activity, ShieldAlert,
  AlertOctagon, Building2, Briefcase,
} from 'lucide-react'
import * as dailyOpsApi from '../lib/api/dailyOps'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import { exportDailyOpsBriefingPdf, exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import Modal from '../components/ui/Modal'
import {
  Card, Kpi, Tabs, Donut, KitTable, VehicleThumb, ViewAll, fmtInt, fmtPct,
} from '../components/commandCenter/kit'
import {
  toIsoDay as fmtDate, addDays, weekRange, prevWeek, inDayRange, onDay, tyreSpend, weekDelta,
  dailyBudgetFromTargets, fleetStatus, upcomingWorkOrders,
  buildPriorityQueue, queueCounts, filterActionItems, isActiveAction, isSlaBreached, actionKpis,
  uniqueSorted, buildBriefingHtml,
} from '../lib/dailyOpsAnalytics'
import {
  headlineKpis, shiftProgress, jobBacklog, turnaround, activityShare, siteBoard, dispatchRows,
  exceptionQueues, jobTimeline, fmtHours, STATUS_TONE, PRIORITY_TONE, activeAssetsOn,
} from '../lib/dailyOpsView'
import { toUserMessage } from '../lib/safeError'
import { listActionItems, listActionItemHistory, subscribeToActionItems, transitionActionItem } from '../lib/api/actionCenter'
import { listShiftHandovers, submitShiftHandover, reviewShiftHandover } from '../lib/api/operationalWorkflow'
import { WO_STATUSES } from '../lib/workOrderStatus'
import './DailyOps.css'

const NA = <span className="cc-na">N/A</span>

const SEV_TONE = { Critical: 'bad', High: 'orange', Medium: 'warn', Low: 'info' }
const SEV_ICON = { Critical: AlertOctagon, High: AlertTriangle, Medium: Clock, Low: Activity }
const EVENT_TONE = { 'New Fitment': 'good', Removal: 'orange', Inspection: 'info', Alert: 'bad', 'Work Order': 'muted' }
const EVENT_TYPE_I18N_KEY = {
  'New Fitment': 'newFitment', Removal: 'removal', Inspection: 'inspection', Alert: 'alert', 'Work Order': 'workOrder',
}

function fmtDisp(iso) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}
function fmtShort(iso) {
  if (!iso) return 'N/A'
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtTime(ts) {
  if (!ts) return '--:--'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '--:--'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function fmtMoney(n) {
  return n == null ? 'N/A' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
}
function readKpiTargets() {
  try { return JSON.parse(localStorage.getItem('tp_kpi_targets') || '{}') } catch { return {} }
}

/** A section that failed to load says so, with Retry; it never renders as "none". */
function Failed({ what, onRetry }) {
  return (
    <div className="cc-empty" role="alert">
      <div>{what} could not be loaded, so this is not shown as empty.<br />
        <button type="button" className="cc-btn" onClick={onRetry}>Try again</button>
      </div>
    </div>
  )
}

function WeekTile({ curr, prev, label, prefix = '' }) {
  let note
  if (curr == null) note = 'No priced records this week'
  else if (prev == null) note = 'No priced records last week to compare'
  else {
    const { val, pct } = weekDelta(curr, prev)
    if (val === 0) note = 'Same as last week'
    else if (pct == null) note = `${val > 0 ? '+' : ''}${prefix}${Math.abs(val).toLocaleString()} vs last week (no prior base)`
    else note = `${val > 0 ? '+' : '-'}${prefix}${Math.abs(val).toLocaleString()} (${pct > 0 ? '+' : ''}${pct}%) vs last week`
  }
  return (
    <div className="do-week-tile">
      <span>{label}</span>
      <b>{curr == null ? 'N/A' : `${prefix}${Number(curr).toLocaleString()}`}</b>
      <small>{note}</small>
    </div>
  )
}

export default function DailyOps() {
  const { t } = useLanguage()
  const { activeCurrency, activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const { user, profile, isSuperAdmin } = useAuth()
  const [selectedDate, setSelectedDate] = useState(fmtDate(new Date()))
  const [loading, setLoading] = useState(true)
  const [failedSources, setFailedSources] = useState([])

  const [tyreRecords, setTyreRecords] = useState([])
  const [inspections, setInspections] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [alerts, setAlerts] = useState([])
  const [accidents, setAccidents] = useState([])
  const [allTyres30, setAllTyres30] = useState([])
  const [capped, setCapped] = useState(false)
  const [loadedAt, setLoadedAt] = useState(null)

  const [queueSeverity, setQueueSeverity] = useState('All')
  const [queueLimit, setQueueLimit] = useState(12)
  const [actionItems, setActionItems] = useState([])
  const [actionStatus, setActionStatus] = useState('active')
  const [actionOwner, setActionOwner] = useState('All')
  const [actionSite, setActionSite] = useState('All')
  const [actionShift, setActionShift] = useState('All')
  const [myWork, setMyWork] = useState(true)
  const [actionSearch, setActionSearch] = useState('')
  const [actionSaving, setActionSaving] = useState('')
  const [actionError, setActionError] = useState('')
  const [workflowDialog, setWorkflowDialog] = useState(null)
  const [workflowReason, setWorkflowReason] = useState('')
  const [historyFor, setHistoryFor] = useState(null)
  const [historyRows, setHistoryRows] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [liveStatus, setLiveStatus] = useState('connecting')
  const [handovers, setHandovers] = useState([])
  const [handoverSummary, setHandoverSummary] = useState('')
  const [handoverSaving, setHandoverSaving] = useState(false)

  // Mockup UI state
  const [jobSearch, setJobSearch] = useState('')
  const [jobStatus, setJobStatus] = useState('')
  const [jobPriority, setJobPriority] = useState('')
  const [jobSite, setJobSite] = useState('')
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [detailTab, setDetailTab] = useState('overview')
  const [exceptionTab, setExceptionTab] = useState('delays')
  const [lowerTab, setLowerTab] = useState('work')

  const fetchData = useCallback(async (date) => {
    setLoading(true)
    setFailedSources([])
    const { end: wEnd } = weekRange(date)
    const thirtyDaysAgo = addDays(date, -30)

    // Null-safe country scoping (the app-wide applyCountry convention): "All"
    // applies no predicate; a country keeps its own rows plus NULL-country rows.
    // work_orders / alerts / accidents are scoped server-side; the paged tyre
    // reads carry a country column and are scoped in memory, so money on this
    // page stays in a single currency when a country is selected.
    const scoped = Boolean(activeCountry && activeCountry !== 'All')
    const country = scoped ? activeCountry : 'All'
    const scopeRows = (rows) =>
      scoped ? rows.filter(r => r.country == null || r.country === activeCountry) : rows

    const [trRes, insRes, woRes, alRes, t30Res, actionsRes, accRes] = await Promise.allSettled([
      dailyOpsApi.listDailyTyreRecords({ thirtyDaysAgo, wEnd }),
      dailyOpsApi.listDailyInspections({ thirtyDaysAgo, wEnd }),
      dailyOpsApi.listDailyWorkOrders({ thirtyDaysAgo, wEnd, country }),
      dailyOpsApi.listDailyAlerts({ thirtyDaysAgo, wEnd, country }),
      dailyOpsApi.listDailyTyreFitments({ thirtyDaysAgo, date }),
      listActionItems({ country, limit: 1000 }),
      dailyOpsApi.listDailyAccidents({ thirtyDaysAgo, wEnd, country }),
    ])

    const sources = [
      ['tyre records', trRes], ['inspections', insRes], ['work orders', woRes], ['alerts', alRes],
      ['fitments', t30Res], ['operational actions', actionsRes], ['accidents', accRes],
    ]
    setFailedSources(sources.filter(([, r]) => r.status === 'rejected' || r.value?.error).map(([name]) => name))

    const ok = (r) => r.status === 'fulfilled' && r.value?.data ? r.value.data : []
    setTyreRecords(scopeRows(ok(trRes)))
    setInspections(ok(insRes))
    setWorkOrders(ok(woRes))
    setAlerts(ok(alRes))
    setAccidents(ok(accRes))
    setAllTyres30(scopeRows(ok(t30Res)))
    setActionItems(actionsRes.status === 'fulfilled' && Array.isArray(actionsRes.value) ? actionsRes.value : [])
    setCapped(
      (woRes.status === 'fulfilled' && woRes.value.truncated === true) ||
      (alRes.status === 'fulfilled' && alRes.value.truncated === true),
    )
    setLoadedAt(new Date())
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { fetchData(selectedDate) }, [selectedDate, fetchData])

  useEffect(() => subscribeToActionItems(
    () => listActionItems({ country: activeCountry, limit: 1000 }).then(setActionItems).catch(() => setLiveStatus('degraded')),
    (status) => setLiveStatus(status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'degraded' : 'connecting'),
  ), [activeCountry])

  useEffect(() => {
    listShiftHandovers({ site: actionSite }).then(setHandovers).catch(() => setHandovers([]))
  }, [actionSite])

  function navigate(dir) {
    const d = new Date(selectedDate + 'T00:00:00')
    d.setDate(d.getDate() + dir)
    setSelectedDate(fmtDate(d))
  }
  const retry = () => fetchData(selectedDate)
  const failed = (name) => failedSources.includes(name)

  // ── Day slices ─────────────────────────────────────────────────────────────
  const todayRecs = useMemo(() => onDay(tyreRecords, 'issue_date', selectedDate), [tyreRecords, selectedDate])
  const todayIns = useMemo(() => onDay(inspections, 'inspection_date', selectedDate), [inspections, selectedDate])
  const todayWO = useMemo(() => onDay(workOrders, 'created_at', selectedDate), [workOrders, selectedDate])
  const todayAlerts = useMemo(() => onDay(alerts, 'created_at', selectedDate), [alerts, selectedDate])

  const { start: thisWeekStart, end: thisWeekEnd } = useMemo(() => weekRange(selectedDate), [selectedDate])
  const { start: lastWeekStart, end: lastWeekEnd } = useMemo(() => prevWeek(selectedDate), [selectedDate])
  const thisWeekRecs = useMemo(() => inDayRange(tyreRecords, 'issue_date', thisWeekStart, thisWeekEnd), [tyreRecords, thisWeekStart, thisWeekEnd])
  const lastWeekRecs = useMemo(() => inDayRange(tyreRecords, 'issue_date', lastWeekStart, lastWeekEnd), [tyreRecords, lastWeekStart, lastWeekEnd])
  const thisWeekIns = useMemo(() => inDayRange(inspections, 'inspection_date', thisWeekStart, thisWeekEnd), [inspections, thisWeekStart, thisWeekEnd])
  const lastWeekIns = useMemo(() => inDayRange(inspections, 'inspection_date', lastWeekStart, lastWeekEnd), [inspections, lastWeekStart, lastWeekEnd])
  const thisWeekCrit = useMemo(() => thisWeekRecs.filter(r => r.risk_level === 'Critical').length, [thisWeekRecs])
  const lastWeekCrit = useMemo(() => lastWeekRecs.filter(r => r.risk_level === 'Critical').length, [lastWeekRecs])
  const thisWeekSpend = useMemo(() => tyreSpend(thisWeekRecs), [thisWeekRecs])
  const lastWeekSpend = useMemo(() => tyreSpend(lastWeekRecs), [lastWeekRecs])
  const todaySpend = useMemo(() => tyreSpend(todayRecs), [todayRecs])
  const todayCost = todaySpend.total
  const dailyBudget = useMemo(() => dailyBudgetFromTargets(readKpiTargets()), [])

  const priorityQueue = useMemo(
    () => buildPriorityQueue({ todayRecs, workOrders, tyreRecords, inspections, allTyres30, selectedDate }, t),
    [todayRecs, workOrders, selectedDate, tyreRecords, inspections, allTyres30, t],
  )

  const activityFeed = useMemo(() => {
    const events = []
    todayRecs.forEach(r => events.push({
      id: `tr-${r.id}`, time: r.created_at || r.issue_date, type: r.km_at_removal ? 'Removal' : 'New Fitment',
      asset: r.asset_no, site: r.site,
      detail: `${r.brand || t('dailyops.unknown')} | ${r.position || 'N/A'} | ${r.serial_number || t('dailyops.noSerial')}`,
    }))
    todayIns.forEach(r => {
      const tc = Array.isArray(r.tyre_conditions) ? r.tyre_conditions : (r.tyre_conditions ? Object.values(r.tyre_conditions) : [])
      const flagged = tc.filter(p => p && p.condition && p.condition !== 'Good').length
      events.push({
        id: `ins-${r.id}`, time: r.created_at || r.inspection_date, type: 'Inspection', asset: r.asset_no, site: r.site,
        detail: `${t('dailyops.activityFeed.inspectorLabel')} ${r.inspector || t('dailyops.na')} | ${t('dailyops.activityFeed.tyresLabel')} ${tc.length}${flagged ? t('dailyops.activityFeed.flaggedSuffix', { count: flagged }) : ''}`,
      })
    })
    todayAlerts.forEach(r => events.push({
      id: `al-${r.id}`, time: r.created_at, type: 'Alert', asset: r.asset_no, site: '',
      detail: r.message || r.alert_type || t('dailyops.activityFeed.alertRaised'),
    }))
    todayWO.forEach(r => events.push({
      id: `wo-${r.id}`, time: r.created_at, type: 'Work Order', asset: r.asset_no, site: r.site,
      detail: `${t('dailyops.activityFeed.woLabel')} ${r.work_order_no || r.id} | ${r.status} | ${t('dailyops.activityFeed.priorityLabel')} ${r.priority || t('dailyops.na')}`,
    }))
    return events.sort((a, b) => new Date(b.time) - new Date(a.time))
  }, [todayRecs, todayIns, todayAlerts, todayWO, t])

  const fleet = useMemo(
    () => fleetStatus({ todayRecs, todayIns, tyreRecords, allTyres30, selectedDate }),
    [todayRecs, todayIns, tyreRecords, allTyres30, selectedDate],
  )

  // ── Mockup shaping (pure, src/lib/dailyOpsView.js) ─────────────────────────
  const kpis = useMemo(
    () => headlineKpis({ tyreRecords, inspections, workOrders, accidents, selectedDate }),
    [tyreRecords, inspections, workOrders, accidents, selectedDate],
  )
  const progress = useMemo(() => shiftProgress(todayWO), [todayWO])
  const backlog = useMemo(() => jobBacklog(workOrders, selectedDate), [workOrders, selectedDate])
  const tat = useMemo(() => turnaround(workOrders, selectedDate), [workOrders, selectedDate])
  const share = useMemo(() => activityShare({
    activeCount: activeAssetsOn({ tyreRecords, inspections }, selectedDate).size, allTyres30,
  }), [tyreRecords, inspections, selectedDate, allTyres30])
  const sites = useMemo(() => siteBoard({ todayRecs, todayIns, todayWO }), [todayRecs, todayIns, todayWO])
  const jobs = useMemo(
    () => dispatchRows(workOrders, selectedDate, { search: jobSearch, status: jobStatus, priority: jobPriority, site: jobSite }),
    [workOrders, selectedDate, jobSearch, jobStatus, jobPriority, jobSite],
  )
  const jobSites = useMemo(() => uniqueSorted(workOrders.map((w) => w.site)), [workOrders])
  const selectedJob = useMemo(() => jobs.find((j) => j.id === selectedJobId) || jobs[0] || null, [jobs, selectedJobId])
  const nowIso = loadedAt ? loadedAt.toISOString() : null
  const queues = useMemo(
    () => exceptionQueues({ workOrders, alerts, actionItems, iso: selectedDate, now: nowIso }),
    [workOrders, alerts, actionItems, selectedDate, nowIso],
  )

  const upcomingWOs = useMemo(() => upcomingWorkOrders(workOrders, selectedDate), [workOrders, selectedDate])

  // ── Briefing exports ───────────────────────────────────────────────────────
  async function generatePDF() {
    try {
      await exportDailyOpsBriefingPdf(
        {
          date: fmtDisp(selectedDate),
          kpis: { tyreChanges: todayRecs.length, inspections: todayIns.length, workOrders: todayWO.length, alerts: todayAlerts.length, cost: todayCost },
          priorityQueue: priorityQueue.slice(0, 15).map(i => ({ severity: i.severity, type: i.type, asset: i.asset, description: i.description })),
          siteActivity: sites.map((s) => [s.site, s.tyres]).filter(([, c]) => c > 0),
        },
        {
          company: branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse',
          branding, currency: activeCurrency, filename: `DailyOps_${selectedDate}`,
        },
      )
    } catch (err) { setActionError(toUserMessage(err, 'Could not create the briefing PDF.')) }
  }

  function printBriefing() {
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) return
    win.document.write(buildBriefingHtml({
      dateLabel: fmtDisp(selectedDate),
      dateIso: selectedDate,
      summary: [
        ['Tyre Changes', todayRecs.length], ['Inspections', todayIns.length], ['Work Orders', todayWO.length],
        ['Alerts', todayAlerts.length], [`Cost (${activeCurrency})`, fmtMoney(todayCost)],
      ],
      queue: priorityQueue,
      sites: sites.map((s) => [s.site, s.tyres]).filter(([, c]) => c > 0),
      generatedAt: new Date().toLocaleString(),
    }))
    win.document.close()
    win.print()
  }

  // ── Operational work (action_items) ───────────────────────────────────────
  const { Critical: critCount, High: highCount } = queueCounts(priorityQueue)
  const visibleQueue = queueSeverity === 'All' ? priorityQueue : priorityQueue.filter((i) => i.severity === queueSeverity)
  const actionOwners = uniqueSorted(actionItems.map((i) => i.assigned_to))
  const actionSites = uniqueSorted(actionItems.map((i) => i.site))
  const actionShifts = uniqueSorted(actionItems.map((i) => i.shift_id))
  const coreFailedCount = failedSources.filter((s) => !['operational actions', 'accidents'].includes(s)).length
  const actionsFailed = failed('operational actions')
  const visibleActions = filterActionItems(
    actionItems,
    { status: actionStatus, owner: actionOwner, site: actionSite, shift: actionShift, myWork, selectedDate, search: actionSearch },
    { userId: user?.id, names: [profile?.full_name, profile?.username, profile?.employee_id] },
  )
  const nowMs = Date.now()
  const workKpis = actionKpis(actionItems, selectedDate, nowMs)
  const openVisibleCount = visibleActions.filter(isActiveAction).length
  const canApprove = isSuperAdmin || ['Admin', 'Manager', 'Supervisor'].includes(profile?.role)

  const exportStamp = reportFileName('Daily Operations', selectedDate)
  const exportUpcoming = (kind) => {
    const rows = upcomingWOs.map((wo) => ({
      scheduled_date: String(wo.scheduled_date || '').slice(0, 10), asset_no: wo.asset_no || 'N/A',
      work_order_no: wo.work_order_no || String(wo.id || '').slice(0, 8), status: wo.status || 'N/A',
      priority: wo.priority || 'N/A', site: wo.site || 'N/A',
    }))
    const keys = ['scheduled_date', 'asset_no', 'work_order_no', 'status', 'priority', 'site']
    const headers = ['Date', 'Asset', 'WO No.', 'Status', 'Priority', 'Site']
    const file = reportFileName('Daily Operations Upcoming Work Orders', selectedDate)
    if (kind === 'excel') return exportToExcel(rows, keys, headers, file, 'Upcoming')
    return exportToPdf(rows, keys.map((key, i) => ({ key, header: headers[i] })), 'Daily Operations: Upcoming Work Orders (next 7 days)', file, 'landscape')
  }
  const exportJobs = (kind) => {
    const rows = jobs.map((j) => ({
      ref: j.ref, asset: j.asset || 'N/A', site: j.site || 'N/A', status: j.status, priority: j.priorityLabel,
      opened: j.opened ? fmtShort(j.opened) : 'N/A', target: j.target || 'N/A',
      delay: j.delayed ? `${j.delayDays} days` : 'On schedule',
    }))
    const keys = ['ref', 'asset', 'site', 'status', 'priority', 'opened', 'target', 'delay']
    const headers = ['Job', 'Asset', 'Site', 'Status', 'Priority', 'Opened', 'Target', 'Delay']
    const file = `${exportStamp} Dispatch Board`
    if (kind === 'excel') return exportToExcel(rows, keys, headers, file, 'Dispatch')
    return exportToPdf(rows, keys.map((key, i) => ({ key, header: headers[i] })), 'Daily Operations: Dispatch and jobs', file, 'landscape')
  }
  const exportActions = (kind) => {
    const rows = visibleActions.map((item) => ({
      title: item.title || 'N/A', severity: item.severity || 'N/A',
      status: item.status ? item.status.replaceAll('_', ' ') : 'N/A', asset_no: item.asset_no || 'N/A',
      assigned_to: item.assigned_to || 'Unassigned', site: item.site || 'N/A', due_date: item.due_date || 'N/A',
      sla_due_at: item.sla_due_at ? new Date(item.sla_due_at).toLocaleString() : 'N/A',
      sla: isSlaBreached(item, nowMs) ? 'Breached' : item.sla_due_at ? 'Within SLA' : 'N/A',
    }))
    const keys = ['title', 'severity', 'status', 'asset_no', 'assigned_to', 'site', 'due_date', 'sla_due_at', 'sla']
    const headers = ['Action', 'Severity', 'Status', 'Asset', 'Owner', 'Site', 'Due', 'SLA due', 'SLA state']
    const file = `${exportStamp} Operational Work`
    if (kind === 'excel') return exportToExcel(rows, keys, headers, file, 'Operational Work')
    return exportToPdf(rows, keys.map((key, i) => ({ key, header: headers[i] })), 'Daily Operations: Operational Work', file, 'landscape')
  }

  async function transitionAction(item, status, options = {}) {
    setActionSaving(item.id)
    setActionError('')
    try {
      const updated = await transitionActionItem(item.id, status, {
        reason: options.reason,
        approvalNote: options.approvalNote,
        resolution: status === 'resolved' ? (options.reason || item.resolution || `Completed from Daily Operations on ${selectedDate}`) : item.resolution,
      })
      setActionItems((rows) => rows.map((row) => row.id === item.id ? updated : row))
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not update the action. Try again.'))
    } finally {
      setActionSaving('')
    }
  }
  function openTransition(item, status, label) {
    setWorkflowReason('')
    setWorkflowDialog({ item, status, label })
  }
  async function confirmTransition() {
    if (!workflowDialog || !workflowReason.trim()) return
    await transitionAction(workflowDialog.item, workflowDialog.status, { reason: workflowReason.trim(), approvalNote: workflowReason.trim() })
    setWorkflowDialog(null)
  }
  async function openHistory(item) {
    setHistoryFor(item)
    setHistoryRows([])
    setHistoryLoading(true)
    try { setHistoryRows(await listActionItemHistory(item.id)) }
    catch (err) { setActionError(toUserMessage(err, 'Could not load action history.')) }
    finally { setHistoryLoading(false) }
  }
  async function createHandover() {
    setHandoverSaving(true)
    setActionError('')
    try {
      const activeIds = visibleActions.filter(isActiveAction).map((item) => item.id)
      const created = await submitShiftHandover({ country: activeCountry, site: actionSite, shiftId: actionShift === 'All' ? null : actionShift, summary: handoverSummary, actionItemIds: activeIds })
      setHandovers((rows) => [created, ...rows])
      setHandoverSummary('')
    } catch (err) { setActionError(toUserMessage(err, 'Could not submit shift handover.')) }
    finally { setHandoverSaving(false) }
  }
  async function acceptHandover(handover) {
    try {
      const row = await reviewShiftHandover(handover.id, true)
      setHandovers((all) => all.map((h) => h.id === handover.id ? { ...h, ...row } : h))
    } catch (err) { setActionError(toUserMessage(err, 'Could not accept handover.')) }
  }

  // ── Tables ─────────────────────────────────────────────────────────────────
  const jobColumns = [
    { key: 'ref', header: 'Job', cell: (r) => <span className="do-job-ref"><i className={`do-dot ${r.delayed ? 'bad' : (STATUS_TONE[r.status] || 'muted')}`} aria-hidden="true" />{r.ref}</span> },
    { key: 'asset', header: 'Asset', cell: (r) => r.asset || NA },
    { key: 'site', header: 'Site', cell: (r) => r.site || NA },
    { key: 'workType', header: 'Type', cell: (r) => r.workType || NA },
    { key: 'target', header: 'Target', sortValue: (r) => r.target || '', cell: (r) => (r.target ? fmtShort(r.target) : NA) },
    { key: 'status', header: 'Status', cell: (r) => <span className={`cc-pill ${STATUS_TONE[r.status] || 'muted'}`}>{r.status}</span> },
    { key: 'delayDays', header: 'Delay', numeric: true, cell: (r) => (r.delayed ? <span className="do-late">+{r.delayDays} d</span> : <span className="cc-na">On time</span>) },
    { key: 'priority', header: 'Priority', sortValue: (r) => ['critical', 'high', 'medium', 'low', 'unset'].indexOf(r.priority), cell: (r) => <span className={`cc-pill ${PRIORITY_TONE[r.priority]}`}>{r.priorityLabel}</span> },
  ]
  const upcomingColumns = [
    { key: 'scheduled_date', header: 'Date', cell: (r) => fmtShort(r.scheduled_date) },
    { key: 'asset_no', header: 'Asset', cell: (r) => r.asset_no || NA },
    { key: 'work_order_no', header: 'WO No.', cell: (r) => r.work_order_no || String(r.id || '').slice(0, 8) },
    { key: 'status', header: 'Status', cell: (r) => <span className="cc-pill muted">{r.status || 'N/A'}</span> },
    { key: 'priority', header: 'Priority', cell: (r) => r.priority || NA },
    { key: 'site', header: 'Site', cell: (r) => r.site || NA },
  ]

  const exceptionTabs = [
    { key: 'delays', label: 'Delays', count: queues.delays.length, countTone: queues.delays.length ? 'red' : '' },
    { key: 'breakdowns', label: 'Breakdowns', count: queues.breakdowns.length },
    { key: 'sla', label: 'SLA risk', count: actionsFailed ? null : queues.sla.length },
    { key: 'alerts', label: 'Alerts', count: failed('alerts') ? null : queues.alerts.length },
  ]
  const exceptionList = queues[exceptionTab] || []
  const exceptionFailed = (exceptionTab === 'sla' && actionsFailed) || (exceptionTab === 'alerts' && failed('alerts'))
    || (['delays', 'breakdowns'].includes(exceptionTab) && failed('work orders'))
  const EXCEPTION_EMPTY = {
    delays: 'No open job is past its target completion date.',
    breakdowns: 'No open breakdown (Emergency) jobs.',
    sla: 'No operational action is past its SLA.',
    alerts: 'No unresolved high or critical alerts in the last 30 days.',
  }

  const wkFail = failed('work orders')
  const loadingFirst = loading && !loadedAt
  const kv = (v) => (loadingFirst ? null : v)

  return (
    <div className="cc do-page">
      <header className="do-head">
        <div className="do-head-art do-art-dark" style={{ backgroundImage: 'url(/dashboard/hero-dark.webp)' }} aria-hidden="true" />
        <div className="do-head-art do-art-light" style={{ backgroundImage: 'url(/dashboard/hero-light.webp)' }} aria-hidden="true" />
        <div className="do-head-copy">
          <nav className="do-crumb" aria-label="Breadcrumb">Monitoring and Logistics <ChevronRight size={12} aria-hidden="true" /> <span>Daily Ops</span></nav>
          <h1>{t('dailyops.header.title')}</h1>
          <p>Live operational control for the day: jobs, delays, exceptions and owned work. {fmtDisp(selectedDate)}.</p>
        </div>
        <div className="do-head-actions">
          <div className="do-datebar" role="group" aria-label="Briefing date">
            <button type="button" className="cc-icon-btn" onClick={() => navigate(-1)} aria-label="Previous day"><ChevronLeft size={15} /></button>
            <button type="button" className="cc-btn-ghost" onClick={() => setSelectedDate(fmtDate(new Date()))}>{t('dailyops.header.today')}</button>
            <button type="button" className="cc-icon-btn" onClick={() => navigate(1)} aria-label="Next day"><ChevronRight size={15} /></button>
            <input type="date" className="cc-select do-date" value={selectedDate} onChange={e => e.target.value && setSelectedDate(e.target.value)} aria-label="Briefing date" />
          </div>
          <div className="do-btnrow">
            <button type="button" className="cc-btn-primary" onClick={retry} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh live board
            </button>
            <Link className="cc-btn-ghost" to="/action-center"><Siren size={14} aria-hidden="true" /> Escalate</Link>
            <Link className="cc-btn-ghost" to="/report-sharing"><MonitorPlay size={14} aria-hidden="true" /> Share TV view</Link>
            <button type="button" className="cc-btn-ghost" onClick={generatePDF} disabled={loading}><FileText size={14} aria-hidden="true" /> {t('dailyops.header.pdf')}</button>
            <button type="button" className="cc-btn-ghost" onClick={printBriefing} disabled={loading}><Printer size={14} aria-hidden="true" /> {t('dailyops.header.printBriefing')}</button>
          </div>
        </div>
      </header>

      {!loading && coreFailedCount === 5 && (
        <div className="cc-card do-banner bad" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>Daily operations data could not be loaded. No operational conclusion is shown.</div>
          <button type="button" className="cc-btn" onClick={retry}>Retry all sources</button>
        </div>
      )}
      {!loading && failedSources.length > 0 && coreFailedCount < 5 && (
        <div className="cc-card do-banner warn" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>Partial view: {failedSources.join(', ')} could not be loaded. Figures from those sources read N/A.</div>
          <button type="button" className="cc-btn" onClick={retry}>Retry all sources</button>
        </div>
      )}
      {activeCountry === 'All' && (
        <div className="cc-card do-banner info" role="note">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>Showing all countries. Cost figures span SAR, AED and EGP and are not added together; select a country to see spend in its own currency.</div>
        </div>
      )}
      {capped && (
        <div className="cc-card do-banner warn" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>Capped view. This 30-day window holds more work orders or alerts than the display limit (20,000). Pick a country for a complete view.</div>
        </div>
      )}

      {/* KPI strip */}
      <div className="cc-kpis do-kpis">
        <Kpi icon={Truck} tone="t-green" loading={loadingFirst} value={kv(kpis.activeVehicles.value)}
          display={failed('tyre records') && failed('inspections') ? 'N/A' : undefined}
          label="Active vehicles" trend={kpis.activeVehicles.trend}
          title="Distinct assets with a tyre change or inspection on this day. Trend against the previous day." />
        <Kpi icon={ClipboardList} tone="t-blue" loading={loadingFirst} value={kv(kpis.workOrdersOpened.value)}
          display={wkFail ? 'N/A' : undefined} label="Jobs opened" trend={kpis.workOrdersOpened.trend}
          title="Work orders opened on this day. Trend against the previous day." />
        <Kpi icon={AlertOctagon} tone="t-red" loading={loadingFirst} value={kv(kpis.delayedJobs.value)}
          display={wkFail ? 'N/A' : undefined} label="Delayed jobs" danger={kpis.delayedJobs.value > 0}
          onClick={() => { setJobStatus('delayed'); setExceptionTab('delays') }}
          title="Open work orders past their target completion date. No day-before trend: delay is not snapshotted." />
        <Kpi icon={AlertTriangle} tone="t-amber" loading={loadingFirst} value={kv(kpis.incidents.value)}
          display={failed('accidents') ? 'N/A' : undefined} label="Incidents today" trend={kpis.incidents.trend} goodWhenUp={false}
          to="/accidents" title="Accidents reported with this incident date." />
        <Kpi icon={CheckCircle2} tone="t-green" loading={loadingFirst}
          display={wkFail ? 'N/A' : fmtPct(kpis.onTime.value)}
          label={<>On-time completion<small className="do-kpi-sub">{kpis.onTime.judged ? `${fmtInt(kpis.onTime.judged)} jobs with a target, last 30 days` : 'No completed job with a target date'}</small></>}
          title="Completed work orders whose completion date is on or before the target, over the 30-day window." />
      </div>

      {/* Row 1: location, operations overview, job details */}
      <div className="do-grid">
        <Card area="do-a-map" title="Live fleet location" sub="Where today's activity happened, by site"
          action={<ViewAll to="/gps-tracking" label="GPS tracking" />}>
          <div className="do-map">
            <div className="do-map-note">
              <MapPin size={18} aria-hidden="true" />
              <div><b>No live GPS positions recorded.</b> The gps_positions and trips tables hold no rows, so vehicles are not placed on a map. Activity is shown by site instead.</div>
            </div>
            {loadingFirst ? <div className="cc-skel" style={{ height: 160 }} />
              : coreFailedCount === 5 ? <Failed what="Site activity" onRetry={retry} />
                : sites.length === 0 ? <div className="cc-empty">No tyre, inspection or job activity at any site on this day.</div>
                  : (
                    <ul className="do-sites" aria-label="Activity by site">
                      {sites.slice(0, 8).map((s) => (
                        <li key={s.site}>
                          <span className="do-site-name"><Building2 size={13} aria-hidden="true" />{s.site}</span>
                          <span className="do-site-bar" aria-hidden="true"><i style={{ width: `${Math.max(6, (s.total / sites[0].total) * 100)}%` }} /></span>
                          <span className="do-site-num" title={`${s.tyres} tyre changes, ${s.inspections} inspections, ${s.workOrders} jobs`}>{s.total}</span>
                        </li>
                      ))}
                    </ul>
                  )}
            <div className="do-map-legend">
              <div><i className="do-dot good" />Active today<b>{fmtInt(fleet.active)}</b></div>
              <div><i className="do-dot bad" />Critical tyre risk<b>{fmtInt(fleet.critical)}</b></div>
              <div><i className="do-dot muted" />Dormant 30 days<b>{fmtInt(fleet.dormant)}</b></div>
            </div>
          </div>
        </Card>

        <Card area="do-a-ops" title="Operations overview"
          sub={loadedAt ? `Updated ${fmtTime(loadedAt)}` : 'Loading'}
          action={<span className={`do-live ${liveStatus}`}><i aria-hidden="true" />{liveStatus === 'live' ? 'Live' : liveStatus === 'degraded' ? 'Updates paused' : 'Connecting'}</span>}>
          <div className="do-ops">
            <div className="do-ops-cell">
              <h3>Shift progress</h3>
              {loadingFirst ? <div className="cc-skel" style={{ height: 120 }} />
                : wkFail ? <Failed what="Today's jobs" onRetry={retry} />
                  : progress.total === 0 ? <div className="cc-empty">No jobs opened on this day.</div>
                    : (
                      <>
                        <Donut total={progress.total} centerLabel="jobs today" segments={[
                          { label: 'Completed', count: progress.completed, color: 'var(--cc-green)' },
                          { label: 'In progress', count: progress.inProgress, color: 'var(--cc-blue)' },
                          { label: 'Pending', count: progress.pending, color: 'var(--cc-amber)' },
                          { label: 'Cancelled', count: progress.cancelled, color: 'var(--cc-red)' },
                        ]} />
                        <p className="do-foot">{progress.pct == null ? 'Completion N/A' : `${progress.pct}% of today's jobs completed`}</p>
                      </>
                    )}
            </div>
            <div className="do-ops-cell">
              <h3>Job backlog</h3>
              {loadingFirst ? <div className="cc-skel" style={{ height: 120 }} />
                : wkFail ? <Failed what="Job backlog" onRetry={retry} />
                  : (
                    <>
                      <div className="do-big"><Briefcase size={18} aria-hidden="true" /><b>{fmtInt(backlog.total)}</b><span>open jobs opened in the last 30 days</span></div>
                      <div className="do-prio-bars" aria-label="Open jobs by priority">
                        {[['Critical', backlog.critical, 'var(--cc-red)'], ['High', backlog.high, 'var(--cc-orange)'], ['Medium', backlog.medium, 'var(--cc-amber)'], ['Low', backlog.low, 'var(--cc-green)'], ['Not set', backlog.unset, 'var(--cc-ink-3)']].map(([l, n, c]) => (
                          <div key={l} className="do-prio">
                            <span className="do-prio-track"><i style={{ height: `${backlog.total ? Math.max(4, (n / backlog.total) * 100) : 0}%`, background: c }} /></span>
                            <small>{l}</small><b>{fmtInt(n)}</b>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
            </div>
            <div className="do-ops-cell">
              <h3>Job turnaround</h3>
              {loadingFirst ? <div className="cc-skel" style={{ height: 60 }} /> : (
                <>
                  <div className="do-big"><Timer size={18} aria-hidden="true" /><b>{wkFail ? 'N/A' : fmtHours(tat.hours)}</b></div>
                  <p className="do-foot">{wkFail ? 'Work orders could not be loaded.' : tat.n ? `Average opened to completed, ${tat.n} job${tat.n === 1 ? '' : 's'} completed this day${tat.trend != null ? `, ${tat.trend > 0 ? '+' : ''}${tat.trend}% vs previous day` : ''}` : 'No job was completed on this day.'}</p>
                </>
              )}
            </div>
            <div className="do-ops-cell">
              <h3>Fleet activity</h3>
              {loadingFirst ? <div className="cc-skel" style={{ height: 60 }} /> : (
                <>
                  <div className="do-big"><Gauge size={18} aria-hidden="true" /><b>{fmtPct(share.pct)}</b></div>
                  <p className="do-foot">{share.pct == null ? 'No asset had a tyre fitment in the last 30 days, so there is no base.' : `Assets active this day out of ${fmtInt(share.known)} seen in the last 30 days. Utilisation hours are not recorded.`}</p>
                </>
              )}
            </div>
          </div>
        </Card>

        <Card area="do-a-detail" title="Job details" sub={selectedJob ? 'Selected from the dispatch board' : undefined}>
          {loadingFirst ? <div className="cc-skel" style={{ height: 260 }} />
            : wkFail ? <Failed what="Jobs" onRetry={retry} />
              : !selectedJob ? <div className="cc-empty">No open or new job for this day. Select a day with jobs, or open Work Orders.</div>
                : (
                  <div className="do-detail">
                    <div className="do-detail-head">
                      <VehicleThumb row={{ asset_no: selectedJob.asset }} size="lg" />
                      <div className="do-detail-id">
                        <b>{selectedJob.ref}</b>
                        <span className={`cc-pill ${selectedJob.delayed ? 'bad' : (STATUS_TONE[selectedJob.status] || 'muted')}`}>{selectedJob.delayed ? 'Delayed' : selectedJob.status}</span>
                        <small><MapPin size={12} aria-hidden="true" /> {selectedJob.asset || 'No asset'} | {selectedJob.site || 'No site'}</small>
                      </div>
                    </div>
                    <Tabs variant="line" label="Job detail" value={detailTab} onChange={setDetailTab}
                      tabs={[{ key: 'overview', label: 'Overview' }, { key: 'timeline', label: 'Timeline' }]} />
                    {detailTab === 'overview' ? (
                      <>
                        <div className="do-detail-tiles">
                          <div><span>Target completion</span><b>{selectedJob.target ? fmtShort(selectedJob.target) : 'Not set'}</b>{selectedJob.delayed && <em>+{selectedJob.delayDays} days</em>}</div>
                          <div><span>Opened</span><b>{selectedJob.opened ? fmtShort(selectedJob.opened) : 'N/A'}</b><small>{selectedJob.opened ? fmtTime(selectedJob.opened) : ''}</small></div>
                        </div>
                        <dl className="do-dl">
                          <dt>Priority</dt><dd><span className={`cc-pill ${PRIORITY_TONE[selectedJob.priority]}`}>{selectedJob.priorityLabel}</span></dd>
                          <dt>Job type</dt><dd>{selectedJob.workType || 'Not recorded'}</dd>
                          <dt>Status</dt><dd>{selectedJob.status}</dd>
                          <dt>Completed</dt><dd>{selectedJob.completed ? fmtShort(selectedJob.completed) : 'Not yet'}</dd>
                          <dt>Driver and ETA</dt><dd className="cc-na">Not recorded: no trip is linked to work orders</dd>
                        </dl>
                      </>
                    ) : (
                      <ol className="do-tl">
                        {jobTimeline(selectedJob, selectedDate).map((e) => (
                          <li key={e.key}><i className={`do-dot ${e.tone}`} aria-hidden="true" /><span>{e.at ? `${fmtShort(e.at)}${String(e.at).length > 10 ? ` ${fmtTime(e.at)}` : ''}` : 'Pending'}</span><b>{e.label}</b><small>{e.note}</small></li>
                        ))}
                      </ol>
                    )}
                    <div className="do-detail-actions">
                      <Link className="cc-btn-primary" to="/work-orders"><Wrench size={14} aria-hidden="true" /> Open work orders</Link>
                      <Link className="cc-btn-ghost" to="/action-center"><Siren size={14} aria-hidden="true" /> Escalate</Link>
                    </div>
                  </div>
                )}
        </Card>
      </div>

      {/* Row 2: dispatch board + exception queues */}
      <div className="do-grid2">
        <Card title="Live dispatch and jobs" sub="Open jobs and jobs opened this day, delayed first. Trips are not recorded, so jobs stand in for dispatch."
          action={(
            <div className="do-mini-actions">
              <button type="button" className="cc-btn-ghost" onClick={() => exportJobs('excel')} disabled={!jobs.length}><Download size={13} aria-hidden="true" /> Excel</button>
              <button type="button" className="cc-btn-ghost" onClick={() => exportJobs('pdf')} disabled={!jobs.length}><FileText size={13} aria-hidden="true" /> PDF</button>
            </div>
          )}>
          <div className="cc-filters do-filters">
            <label className="cc-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Search jobs</span>
              <input type="search" value={jobSearch} onChange={(e) => setJobSearch(e.target.value)} placeholder="Search job, asset, site" /></label>
            <select className="cc-select" aria-label="Filter jobs by status" value={jobStatus} onChange={(e) => setJobStatus(e.target.value)}>
              <option value="">All status</option><option value="delayed">Delayed</option>
              {WO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="cc-select" aria-label="Filter jobs by priority" value={jobPriority} onChange={(e) => setJobPriority(e.target.value)}>
              <option value="">All priorities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="unset">Not set</option>
            </select>
            <select className="cc-select" aria-label="Filter jobs by site" value={jobSite} onChange={(e) => setJobSite(e.target.value)}>
              <option value="">All sites</option>{jobSites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <KitTable
            columns={jobColumns}
            rows={jobs}
            loading={loadingFirst}
            error={wkFail ? 'Work orders could not be loaded, so jobs are not shown as empty.' : null}
            onRetry={retry}
            getRowId={(r) => String(r.id)}
            onRowClick={(r) => { setSelectedJobId(r.id); setDetailTab('overview') }}
            initialPageSize={10}
            empty={jobSearch || jobStatus || jobPriority || jobSite ? 'No jobs match these filters.' : 'No open or new jobs for this day.'}
          />
        </Card>

        <Card title="Exception queues" sub="Jobs and work needing attention" action={<ViewAll to="/action-center" label="Action Center" />}>
          <Tabs label="Exception queues" value={exceptionTab} onChange={setExceptionTab} tabs={exceptionTabs} />
          <div className="do-exc">
            {loadingFirst ? <div className="cc-skel" style={{ height: 200 }} />
              : exceptionFailed ? <Failed what="This queue" onRetry={retry} />
                : exceptionList.length === 0 ? <div className="cc-empty">{EXCEPTION_EMPTY[exceptionTab]}</div>
                  : (
                    <ul className="do-exc-list">
                      {exceptionList.slice(0, 8).map((e) => (
                        <li key={e.id}>
                          <i className={`do-exc-ic ${e.tone}`} aria-hidden="true"><AlertTriangle size={13} /></i>
                          <div><b>{e.ref}</b><span className={`do-exc-title ${e.tone}`}>{e.title}</span><small>{e.detail}</small></div>
                          <time>{e.when}</time>
                        </li>
                      ))}
                      {exceptionList.length > 8 && <li className="do-exc-more">{fmtInt(exceptionList.length - 8)} more in this queue</li>}
                    </ul>
                  )}
          </div>
          <p className="do-foot">Missing check-ins are not tracked: no check-in schedule is recorded.</p>
        </Card>
      </div>

      {/* Lower tabs: every capability of the previous board */}
      <Card className="do-lower">
        <Tabs label="Daily Ops sections" value={lowerTab} onChange={setLowerTab} tabs={[
          { key: 'work', label: 'Operational work', count: actionsFailed ? null : workKpis.active },
          { key: 'handover', label: 'Shift handover' },
          { key: 'queue', label: t('dailyops.priorityQueue.title'), count: priorityQueue.length, countTone: critCount ? 'red' : '' },
          { key: 'activity', label: t('dailyops.activityFeed.title'), count: activityFeed.length },
          { key: 'week', label: 'Week and cost' },
          { key: 'upcoming', label: 'Upcoming', count: upcomingWOs.length },
        ]} />

        {actionError && <p role="alert" className="do-error">{actionError}</p>}

        {lowerTab === 'work' && (
          <section aria-labelledby="daily-work-heading" className="do-section">
            <div className="do-section-head">
              <div>
                <h2 id="daily-work-heading">Operational work</h2>
                <p>Owned work, SLA, approvals and exceptions without leaving today&apos;s briefing.</p>
              </div>
              <span role="status" className={`do-live ${liveStatus}`}><i aria-hidden="true" />{liveStatus === 'live' ? 'Live' : liveStatus === 'degraded' ? 'Updates paused' : 'Connecting'}</span>
            </div>
            <div className="cc-filters do-filters">
              <button type="button" onClick={() => setMyWork((v) => !v)} aria-pressed={myWork} className={myWork ? 'cc-btn-primary' : 'cc-btn-ghost'}><User size={14} aria-hidden="true" />My work</button>
              <select className="cc-select" value={actionStatus} onChange={(e) => setActionStatus(e.target.value)} aria-label="Filter operational work by status">
                <option value="active">Active work</option><option value="overdue">Overdue work</option><option value="resolved">Resolved work</option><option value="all">All work</option>
              </select>
              <select className="cc-select" value={actionOwner} onChange={(e) => setActionOwner(e.target.value)} aria-label="Filter operational work by owner">
                <option value="All">All owners</option>{actionOwners.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <select className="cc-select" value={actionSite} onChange={(e) => setActionSite(e.target.value)} aria-label="Filter operational work by site">
                <option value="All">All sites</option>{actionSites.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="cc-select" value={actionShift} onChange={(e) => setActionShift(e.target.value)} aria-label="Filter operational work by shift">
                <option value="All">All shifts</option>{actionShifts.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <label className="cc-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Search operational work</span>
                <input id="dailyops-action-search" type="search" value={actionSearch} onChange={(e) => setActionSearch(e.target.value)} placeholder="Title, asset, owner or site" /></label>
              <button type="button" className="cc-btn-ghost" onClick={() => exportActions('excel')} disabled={!visibleActions.length}><Download size={13} aria-hidden="true" /> Excel</button>
              <button type="button" className="cc-btn-ghost" onClick={() => exportActions('pdf')} disabled={!visibleActions.length}><FileText size={13} aria-hidden="true" /> PDF</button>
              <Link className="cc-btn-ghost" to="/action-center">Open Action Center</Link>
            </div>
            <div className="do-work-kpis" aria-label="Operational work summary">
              {[
                { label: 'Active', value: workKpis.active, icon: ClipboardList },
                { label: 'Overdue', value: workKpis.overdue, icon: Clock, bad: workKpis.overdue > 0 },
                { label: 'SLA breached', value: workKpis.slaBreached, icon: Timer, bad: workKpis.slaBreached > 0 },
                { label: 'Pending approval', value: workKpis.pendingApproval, icon: CheckCheck },
                { label: 'Blocked', value: workKpis.blocked, icon: Ban, warn: workKpis.blocked > 0 },
              ].map(({ label, value, icon: Icon, bad, warn }) => (
                <div key={label} className="do-work-kpi">
                  <span><Icon size={12} aria-hidden="true" />{label}</span>
                  <b className={bad ? 'bad' : warn ? 'warn' : ''}>{actionsFailed ? 'N/A' : value.toLocaleString()}</b>
                </div>
              ))}
            </div>
            {actionsFailed ? <Failed what="Operational work" onRetry={retry} />
              : visibleActions.length === 0 ? <div className="cc-empty">No actions match these filters.</div>
                : (
                  <ul className="do-actions">
                    {visibleActions.slice(0, 20).map((item) => (
                      <li key={item.id}>
                        <div className="do-action-main">
                          <div className="do-action-tags">
                            <b>{item.title}</b>
                            <span className="cc-pill muted">{item.severity}</span>
                            <span className="cc-pill info">{item.status?.replace('_', ' ')}</span>
                            {item.approval_status && item.approval_status !== 'not_required' && <span className="cc-pill warn">Approval: {item.approval_status}</span>}
                            {item.sla_due_at && <span className={`do-sla ${isSlaBreached(item, nowMs) ? 'bad' : ''}`}><Timer size={12} aria-hidden="true" />{isSlaBreached(item, nowMs) ? 'SLA breached ' : 'SLA '}{new Date(item.sla_due_at).toLocaleString()}</span>}
                          </div>
                          <small>{item.asset_no || 'No asset'} | {item.assigned_to || 'Unassigned'} | {item.due_date ? `Due ${item.due_date}` : 'No due date'} | {item.site || 'No site'} | {item.shift_id ? `Shift ${item.shift_id}` : 'No shift'}</small>
                          {(item.blocked_reason || item.escalated_reason) && <small className="do-warn-text">{item.blocked_reason || item.escalated_reason}</small>}
                        </div>
                        <div className="do-action-btns">
                          <button type="button" className="cc-btn-ghost" onClick={() => openHistory(item)}><History size={12} aria-hidden="true" />History</button>
                          {isActiveAction(item) && <>
                            {item.status === 'open' && <button type="button" className="cc-btn-ghost" disabled={actionSaving === item.id} onClick={() => transitionAction(item, 'acknowledged')}>Acknowledge</button>}
                            {item.status !== 'in_progress' && <button type="button" className="cc-btn-ghost" disabled={actionSaving === item.id} onClick={() => transitionAction(item, 'in_progress')}>Start</button>}
                            <button type="button" className="cc-btn-ghost" disabled={actionSaving === item.id} onClick={() => openTransition(item, 'blocked', 'Block work')}><Ban size={12} aria-hidden="true" />Block</button>
                            <button type="button" className="cc-btn-ghost" disabled={actionSaving === item.id} onClick={() => openTransition(item, 'escalated', 'Escalate work')}><Siren size={12} aria-hidden="true" />Escalate</button>
                            {item.approval_status === 'pending' && canApprove && <button type="button" className="cc-btn-ghost" disabled={actionSaving === item.id} onClick={() => openTransition(item, 'in_progress', 'Approve work')}><CheckCheck size={12} aria-hidden="true" />Approve</button>}
                            {item.status !== 'pending_approval' && <button type="button" className="cc-btn-primary" disabled={actionSaving === item.id} onClick={() => openTransition(item, item.approval_status === 'pending' ? 'pending_approval' : 'resolved', item.approval_status === 'pending' ? 'Submit for approval' : 'Complete work')}>Complete</button>}
                          </>}
                        </div>
                      </li>
                    ))}
                    {visibleActions.length > 20 && <li className="do-exc-more">Showing 20 of {visibleActions.length.toLocaleString()} matching actions. Narrow the filters or open the Action Center; the export covers all of them.</li>}
                  </ul>
                )}
          </section>
        )}

        {lowerTab === 'handover' && (
          <section aria-labelledby="shift-handover-heading" className="do-section">
            <div className="do-section-head">
              <div><h2 id="shift-handover-heading">Shift handover</h2><p>Submit the filtered open work with an accountable handover note.</p></div>
              <span className="do-muted">{openVisibleCount} open items included</span>
            </div>
            <textarea className="do-textarea" maxLength={8000} value={handoverSummary} onChange={(e) => setHandoverSummary(e.target.value)} aria-label="Shift handover summary" placeholder="Risks, work completed, blocked items, next owner and required follow-up" />
            <div className="do-right"><button type="button" className="cc-btn-primary" onClick={createHandover} disabled={handoverSaving || !handoverSummary.trim()}><Send size={13} aria-hidden="true" />{handoverSaving ? 'Submitting...' : 'Submit handover'}</button></div>
            {handovers.length === 0 ? <div className="cc-empty">No shift handovers submitted yet for this site filter.</div> : (
              <ul className="do-actions">
                {handovers.slice(0, 5).map((h) => (
                  <li key={h.id}>
                    <div className="do-action-main"><b>{h.summary}</b><small>{h.site || 'All sites'} | {h.open_item_count || 0} items | {h.status}</small></div>
                    {h.status === 'submitted' && canApprove && <div className="do-action-btns"><button type="button" className="cc-btn-primary" onClick={() => acceptHandover(h)}>Accept handover</button></div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {lowerTab === 'queue' && (
          <section className="do-section" aria-label={t('dailyops.priorityQueue.title')}>
            <div className="do-section-head">
              <div className="do-action-tags">
                <ShieldAlert size={16} aria-hidden="true" />
                {critCount > 0 && <span className="cc-pill bad">{t('dailyops.priorityQueue.criticalChip', { count: critCount })}</span>}
                {highCount > 0 && <span className="cc-pill orange">{t('dailyops.priorityQueue.highChip', { count: highCount })}</span>}
              </div>
              <div className="do-sev" role="group" aria-label="Filter priority actions by severity">
                {['All', 'Critical', 'High', 'Medium'].map((s) => (
                  <button key={s} type="button" aria-pressed={queueSeverity === s} className={queueSeverity === s ? 'cc-btn-primary' : 'cc-btn-ghost'} onClick={() => { setQueueSeverity(s); setQueueLimit(12) }}>{s}</button>
                ))}
              </div>
            </div>
            {coreFailedCount === 5 ? <Failed what="The priority queue" onRetry={retry} />
              : priorityQueue.length === 0 ? <div className="cc-empty do-clear"><CheckCircle2 size={18} aria-hidden="true" /> {t('dailyops.priorityQueue.allClear')}</div>
                : visibleQueue.length === 0 ? <div className="cc-empty">No {queueSeverity.toLowerCase()} priority actions for this date.</div>
                  : (
                    <ul className="do-exc-list">
                      {visibleQueue.slice(0, queueLimit).map((item) => {
                        const Icon = SEV_ICON[item.severity] || Activity
                        const tone = SEV_TONE[item.severity] || 'info'
                        return (
                          <li key={item.id}>
                            <i className={`do-exc-ic ${tone}`} aria-hidden="true"><Icon size={13} /></i>
                            <div>
                              <b>{item.asset || item.type}</b>
                              <span className={`do-exc-title ${tone}`}>{item.severity} | {item.type}</span>
                              <small>{item.description}{item.detail ? ` | ${item.detail}` : ''}</small>
                            </div>
                            {item.link && <a className="cc-btn" href={item.link} aria-label={`${t('dailyops.priorityQueue.view')}: ${item.description}`}>{t('dailyops.priorityQueue.view')}</a>}
                          </li>
                        )
                      })}
                      {visibleQueue.length > queueLimit && (
                        <li className="do-exc-more"><button type="button" className="cc-btn" onClick={() => setQueueLimit((l) => l + 25)}>Show next {Math.min(25, visibleQueue.length - queueLimit)} actions</button></li>
                      )}
                    </ul>
                  )}
          </section>
        )}

        {lowerTab === 'activity' && (
          <section className="do-section do-activity" aria-label={t('dailyops.activityFeed.title')}>
            <div>
              <div className="do-work-kpis">
                {[
                  { label: t('dailyops.stats.tyreChanges'), value: todayRecs.length, icon: Wrench, src: 'tyre records' },
                  { label: t('dailyops.stats.inspections'), value: todayIns.length, icon: ClipboardList, src: 'inspections' },
                  { label: t('dailyops.stats.workOrders'), value: todayWO.length, icon: Briefcase, src: 'work orders' },
                  { label: t('dailyops.stats.alertsRaised'), value: todayAlerts.length, icon: Bell, src: 'alerts' },
                ].map(({ label, value, icon: Icon, src }) => (
                  <div key={label} className="do-work-kpi"><span><Icon size={12} aria-hidden="true" />{label}</span><b>{failed(src) ? 'N/A' : value.toLocaleString()}</b></div>
                ))}
              </div>
              {activityFeed.length === 0 ? (
                <div className="cc-empty">{coreFailedCount > 0 ? 'Some sources could not be loaded, so this day\'s activity may be incomplete.' : t('dailyops.activityFeed.empty')}</div>
              ) : (
                <ul className="do-feed">
                  {activityFeed.map((ev) => (
                    <li key={ev.id}>
                      <time>{fmtTime(ev.time)}</time>
                      <span className={`cc-pill ${EVENT_TONE[ev.type] || 'muted'}`}>{t(`dailyops.activityFeed.eventTypes.${EVENT_TYPE_I18N_KEY[ev.type] || 'workOrder'}`)}</span>
                      <div><b>{ev.asset || 'N/A'}</b>{ev.site && <small> {ev.site}</small>}<p title={ev.detail}>{ev.detail}</p></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="do-fleet">
              <h3>{t('dailyops.fleetStatus.title')}</h3>
              <Donut centerLabel="assets" segments={[
                { label: t('dailyops.fleetStatus.activeToday'), count: fleet.active, color: 'var(--cc-green)' },
                { label: t('dailyops.fleetStatus.criticalRisk'), count: fleet.critical, color: 'var(--cc-red)' },
                { label: t('dailyops.fleetStatus.dormant30d'), count: fleet.dormant, color: 'var(--cc-ink-3)' },
              ]} />
            </div>
          </section>
        )}

        {lowerTab === 'week' && (
          <section className="do-section" aria-label="Week and cost">
            <p className="do-muted">This week: {fmtShort(thisWeekStart)} to {fmtShort(thisWeekEnd)}</p>
            <div className="do-week">
              <WeekTile curr={thisWeekRecs.length} prev={lastWeekRecs.length} label="Tyre changes" />
              <WeekTile curr={thisWeekSpend.total == null ? null : Math.round(thisWeekSpend.total)} prev={lastWeekSpend.total == null ? null : Math.round(lastWeekSpend.total)} label={activeCountry === 'All' ? 'Cost (mixed currencies)' : `Cost (${activeCurrency})`} />
              <WeekTile curr={thisWeekIns.length} prev={lastWeekIns.length} label="Inspections" />
              <WeekTile curr={thisWeekCrit} prev={lastWeekCrit} label="Critical incidents" />
            </div>
            <div className="do-cost">
              <h3>{t('dailyops.costTracker.title')}</h3>
              <div className="do-cost-row">
                <div><span>{t('dailyops.costTracker.todaysSpend')}</span><b>{todayCost == null ? 'N/A' : activeCountry === 'All' ? `${fmtMoney(todayCost)} (mixed)` : `${activeCurrency} ${fmtMoney(todayCost)}`}</b>
                  {todaySpend.count > 0 && todaySpend.priced < todaySpend.count && <small>{todaySpend.priced} of {todaySpend.count} fitments priced</small>}
                  {todayCost == null && <small>No priced fitments on this day.</small>}
                </div>
                <div><span>{t('dailyops.costTracker.dailyBudget')}</span><b>{dailyBudget == null ? 'Not set' : `${activeCurrency} ${fmtMoney(dailyBudget)}`}</b>
                  {dailyBudget == null && <small>{t('dailyops.costTracker.noBudgetHint')}</small>}
                  {dailyBudget != null && todayCost != null && todayCost > dailyBudget && <small className="do-warn-text">{t('dailyops.costTracker.overBudget', { currency: activeCurrency, amount: fmtMoney(todayCost - dailyBudget) })}</small>}
                </div>
              </div>
              {dailyBudget != null && todayCost != null && (
                <div className="do-budget" role="img" aria-label={`Spend ${fmtMoney(todayCost)} of a daily budget of ${fmtMoney(dailyBudget)}`}>
                  <i className={todayCost > dailyBudget ? 'over' : ''} style={{ width: `${Math.min(100, (todayCost / dailyBudget) * 100)}%` }} />
                </div>
              )}
            </div>
          </section>
        )}

        {lowerTab === 'upcoming' && (
          <section className="do-section" aria-label="Upcoming this week">
            <div className="do-section-head">
              <div><h2>Upcoming this week</h2><p>{upcomingWOs.length.toLocaleString()} open work orders scheduled in the next 7 days.</p></div>
              <div className="do-mini-actions">
                <button type="button" className="cc-btn-ghost" onClick={() => exportUpcoming('excel')} disabled={!upcomingWOs.length}><Download size={13} aria-hidden="true" /> Excel</button>
                <button type="button" className="cc-btn-ghost" onClick={() => exportUpcoming('pdf')} disabled={!upcomingWOs.length}><FileText size={13} aria-hidden="true" /> PDF</button>
              </div>
            </div>
            <KitTable
              columns={upcomingColumns}
              rows={upcomingWOs}
              getRowId={(r) => String(r.id)}
              error={wkFail ? 'Work orders could not be loaded, so upcoming work is not shown as empty.' : null}
              onRetry={retry}
              enableGlobalFilter
              searchPlaceholder="Search asset, WO, site"
              empty="No upcoming work orders in the next 7 days."
            />
          </section>
        )}
      </Card>

      {workflowDialog && (
        <Modal open onClose={() => setWorkflowDialog(null)} size="md" title={workflowDialog.label} subtitle={workflowDialog.item.title}
          footer={(
            <>
              <button type="button" className="btn-secondary" onClick={() => setWorkflowDialog(null)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={!workflowReason.trim() || actionSaving === workflowDialog.item.id} onClick={confirmTransition}>{actionSaving === workflowDialog.item.id ? 'Saving...' : 'Confirm'}</button>
            </>
          )}>
          <label className="block text-sm text-[var(--text-secondary)]">Reason / evidence<textarea autoFocus className="input w-full min-h-[100px] mt-1" maxLength={4000} value={workflowReason} onChange={(e) => setWorkflowReason(e.target.value)} required /></label>
        </Modal>
      )}

      {historyFor && (
        <Modal open onClose={() => setHistoryFor(null)} size="lg" title="Action history" subtitle={historyFor.title}
          footer={<button type="button" className="btn-secondary" onClick={() => setHistoryFor(null)}>Close</button>}>
          {historyLoading ? <p className="text-sm text-[var(--text-muted)]">Loading history...</p>
            : historyRows.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No recorded transitions yet.</p>
              : (
                <ol className="border-l border-[var(--input-border)] ml-2 space-y-4">
                  {historyRows.map((ev) => (
                    <li key={ev.id} className="pl-4">
                      <p className="text-sm text-[var(--text-primary)]">{ev.event_type?.replaceAll('_', ' ') || 'Updated'}{ev.from_status || ev.to_status ? ` | ${ev.from_status || 'new'} to ${ev.to_status || 'updated'}` : ''}</p>
                      {ev.reason && <p className="text-sm text-[var(--text-muted)] mt-1">{ev.reason}</p>}
                      <time className="text-xs text-[var(--text-muted)]">{new Date(ev.created_at).toLocaleString()}</time>
                    </li>
                  ))}
                </ol>
              )}
        </Modal>
      )}
    </div>
  )
}
