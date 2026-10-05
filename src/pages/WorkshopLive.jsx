/**
 * WorkshopLive.jsx - Workshop Live Control (route /workshop-live), rebuilt on
 * the shared Command Center kit to the owner's mockup: breadcrumb + title,
 * five headline tiles, a secondary productivity strip, the Technician Board
 * beside Live Alerts, and the Job Flow strip (which opens the full kanban).
 *
 * ALL maths live in the pure engines: `src/lib/workshopLive.js` (buildBoard /
 * computeKpis / deriveAlerts / delayBreakdown) and the presentation shapers
 * `workshopLiveAnalytics.js` + `workshopLiveView.js` (job flow stages, alert
 * rows, board chips). This page loads raw rows via `src/lib/api/workshopLive.js`,
 * feeds the engines and renders. Foreman actions (assign / reassign / status /
 * priority / VOR / QC / tasks / confirm) go back through the service; the audit
 * trail is server side. The working pieces (kanban card, delay panel, modals,
 * foreman drawer) live in `src/components/workshop/WorkshopLiveParts.jsx`.
 *
 * Live updates: a Supabase postgres_changes subscription triggers a debounced
 * reload; a 60s poll is the fallback (paused while the tab is hidden, with a
 * catch-up refresh on return).
 *
 * Date range: the header From/To (quick picks Today / Yesterday / Last 7 days /
 * This month) drives ONLY the measured figures (completed jobs, productive /
 * lost / overtime hours, utilisation, delay causes). The live surfaces
 * (technician status, current job, live alerts, open job flow, open and overdue
 * cards, the headline tiles) stay on the current moment and are labelled "Now".
 * Past days are read once per range via `loadRangeActivity` and rolled up per
 * local day by `computeRangeMeasures` (workshopAnalytics.js), which reuses the
 * live buildBoard / computeKpis / delayBreakdown; today always comes from the
 * live board itself, so a range of Today equals the live figures exactly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  RefreshCw, Users, Wrench, AlertTriangle, Package, ShieldAlert,
  Coffee, UserX, X, Gauge, Timer, TrendingUp, CheckCircle2, Car, UserCheck,
  User, Zap, Plus, Search, FileSpreadsheet, FileText, ChevronRight, Bell,
  CalendarDays, Kanban, Settings2,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import * as workshop from '../lib/api/workshopLive'
import { loadWorkshopConfig } from '../lib/api/workshopConfig'
import { loadRangeActivity } from '../lib/api/workshopAnalytics'
import {
  RANGE_PRESETS, rangePreset, matchPreset, normalizeRange, rangeLabel,
  localDayKey, localDayStart, buildRangeDays, computeRangeMeasures,
} from '../lib/workshopAnalytics'
import {
  buildBoard, computeKpis, deriveAlerts, STATUS, STATUS_META,
} from '../lib/workshopLive'
import { taskRollup, jobTaskSummary, qcOutcome } from '../lib/workshopTasks'
import { Card, CardState, Kpi, Tabs } from '../components/commandCenter/kit'
import WorkshopTvShareButton from '../components/workshop/WorkshopTvShareButton'
import WorkshopNewJobModal from '../components/workshop/WorkshopNewJobModal'
import {
  KANBAN_COLUMNS, JobCard, DelayPanel, SmartAssignModal, TaskModal, TechDrawer,
} from '../components/workshop/WorkshopLiveParts'
import { safeImageSrc } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'
import {
  fmtMins, relTime, pct, siteOptions as buildSiteOptions,
  filterBoard, filterJobs, bucketJobs, boardExportRows, BOARD_EXPORT_KEYS, BOARD_EXPORT_HEADERS,
} from '../lib/workshopLiveAnalytics'
import {
  jobFlowCounts, jobFlowStage, alertRows, alertLevelCounts, initials, techJobLine,
  BOARD_CHIPS, chipCounts,
} from '../lib/workshopLiveView'
import { reportFileName } from '../lib/exportUtils'
import './WorkshopLive.css'

// Engine status tone -> kit pill tone.
const PILL_TONE = { green: 'good', blue: 'info', amber: 'warn', purple: 'info', red: 'bad', grey: 'muted' }

// ── KPI config (values come straight from the engine `kpis`) ─────────────────

// ── KPI strip config (values come straight from the engine `kpis`) ─────────────

function buildKpiDefs(kpis) {
  return [
    { key: 'onDuty',            label: 'On Duty',        value: kpis.onDuty,            icon: Users,        scope: 'tech', pred: (x) => x.status !== STATUS.OFF_DUTY && x.status !== STATUS.ABSENT },
    { key: 'working',          label: 'Working',        value: kpis.working,          icon: Wrench,       scope: 'tech', pred: (x) => x.status === STATUS.WORKING },
    { key: 'available',        label: 'Available',      value: kpis.available,        icon: UserCheck,    scope: 'tech', pred: (x) => x.status === STATUS.AVAILABLE },
    { key: 'unassigned',       label: 'Unassigned',     value: kpis.unassigned,       icon: User,         scope: 'tech', pred: (x) => x.status === STATUS.AVAILABLE && !x.currentJobId },
    { key: 'waitingParts',     label: 'Waiting Parts',  value: kpis.waitingParts,     icon: Package,      scope: 'tech', pred: (x) => x.status === STATUS.WAITING_PARTS },
    { key: 'waitingApproval',  label: 'Waiting Approval', value: kpis.waitingApproval, icon: ShieldAlert, scope: 'tech', pred: (x) => x.status === STATUS.WAITING_APPROVAL },
    { key: 'onBreak',          label: 'On Break',       value: kpis.onBreak,          icon: Coffee,       scope: 'tech', pred: (x) => x.status === STATUS.ON_BREAK },
    { key: 'absent',           label: 'Absent',         value: kpis.absent,           icon: UserX,        scope: 'tech', pred: (x) => x.status === STATUS.ABSENT },
    { key: 'openJobs',         label: 'Open Job Cards', value: kpis.openJobs,         icon: Wrench,       scope: 'job',  jobCol: null },
    { key: 'overdueJobs',      label: 'Overdue',        value: kpis.overdueJobs,      icon: AlertTriangle, scope: 'job', jobCol: 'Overdue' },
    { key: 'vehiclesOffRoad',  label: 'Vehicles Off Road', value: kpis.vehiclesOffRoad, icon: Car,        scope: 'job',  jobPred: (j) => j.vor === true },
    { key: 'jobsCompletedToday', label: 'Completed Today', value: kpis.jobsCompletedToday, icon: CheckCircle2, scope: 'job', jobCol: 'Completed' },
    { key: 'utilization',      label: 'Utilization',    value: pct(kpis.utilization), icon: Gauge,        scope: null },
    { key: 'productiveHours',  label: 'Productive Hours', value: kpis.productiveHours, icon: TrendingUp,  scope: null },
    { key: 'lostHours',        label: 'Lost Hours',     value: kpis.lostHours,        icon: Timer,        scope: null },
    { key: 'overtimeHours',    label: 'Overtime Hours', value: kpis.overtimeHours,    icon: Zap,          scope: null },
  ]
}
// Headline tiles (mockup order) and the secondary strip.
const HEADLINE = [
  { key: 'onDuty', tone: 't-green', sub: 'Now: technicians on shift' },
  { key: 'working', tone: 't-blue', sub: 'Now: on an active job' },
  { key: 'available', tone: 't-purple', sub: 'Now: ready to assign' },
  { key: 'waitingParts', tone: 't-amber', sub: 'Now: blocked on parts' },
  { key: 'vehiclesOffRoad', tone: 't-red', sub: 'Now: vehicles off road' },
]
// "Now" items stay on the current moment; the measured items follow the range.
const STRIP_NOW = ['openJobs', 'overdueJobs']
const STRIP_RANGE = [
  { key: 'completed', label: 'Completed', title: 'Job cards completed in the chosen dates (by completion time)' },
  { key: 'utilization', label: 'Utilisation', title: 'Average productive share of available duty time per technician-day (technician-days with a measurable shift)' },
  { key: 'productiveHours', label: 'Productive hrs', title: 'Time on an active job in the chosen dates' },
  { key: 'lostHours', label: 'Lost hrs', title: 'Blocked plus unassigned duty time in the chosen dates' },
  { key: 'overtimeHours', label: 'Overtime', title: 'Productive or blocked time past the shift end in the chosen dates' },
]
function fmtMeasure(key, v) {
  if (v == null) return 'N/A'
  if (key === 'utilization') return pct(v)
  if (key === 'completed') return String(v)
  return `${v}h`
}

// ── Technician tile ──────────────────────────────────────────────────────────

function TechTile({ tech, now, highlight, onOpen, onViewJob }) {
  const meta = STATUS_META[tech.status] || { label: tech.status || 'Unknown', tone: 'grey' }
  const util = tech.utilization == null ? null : Math.round(tech.utilization * 100)
  const src = tech.avatar ? safeImageSrc(tech.avatar) : null
  return (
    <article id={`ref-${tech.userId}`} className={`wl-tech${highlight ? ' is-hl' : ''}`} data-tone={meta.tone}>
      <div className="wl-tech-top">
        <span className="wl-avatar" aria-hidden="true">{src ? <img src={src} alt="" /> : initials(tech.name)}</span>
        <div className="wl-tech-id">
          <b title={tech.name}>{tech.name}</b>
          <span className="wl-tech-job" title={techJobLine(tech)}>{techJobLine(tech)}</span>
        </div>
        <span className={`cc-pill ${PILL_TONE[meta.tone] || 'muted'}`}>{meta.label}</span>
      </div>
      <dl className="wl-tech-stats">
        <div><dt>Productive</dt><dd>{fmtMins(tech.productiveMin)}</dd></div>
        <div><dt>Blocked</dt><dd className={tech.blockedMin > 0 ? 'is-warn' : ''}>{fmtMins(tech.blockedMin)}</dd></div>
        <div><dt>Utilisation</dt><dd>{util == null ? <span className="cc-na" title="No measurable shift time today">N/A</span> : `${util}%`}</dd></div>
      </dl>
      <div className="wl-tech-foot">
        <span className="wl-muted">Last update {relTime(tech.lastActivityAt, now)}</span>
        {tech.status === STATUS.AWAITING_INSPECTION && <span className="cc-pill warn">Task to confirm</span>}
        <span className="wl-tech-actions">
          {tech.currentJobId && (
            <button type="button" className="cc-link cc-link-btn" onClick={() => onViewJob(tech.currentJobId)}>
              View job <ChevronRight size={13} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="cc-icon-btn" onClick={() => onOpen(tech)} aria-label={`Foreman actions for ${tech.name}`} title="Assign, confirm and foreman actions">
            <Settings2 size={14} />
          </button>
        </span>
      </div>
    </article>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function WorkshopLive() {
  const { activeCountry } = useSettings()
  const loadId = useRef(0)
  const [raw, setRaw] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)      // { type:'ok'|'err', msg }
  const [filter, setFilter] = useState(null)     // { scope, key }
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('All')
  const [nowTs, setNowTs] = useState(() => Date.now())
  const [highlightRef, setHighlightRef] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [skillsByUser, setSkillsByUser] = useState({})
  const [tasksByJob, setTasksByJob] = useState({})     // { [jobId]: rawTask[] }
  const [expandedJobs, setExpandedJobs] = useState({})  // { [jobId]: bool }
  const [smartAssignJob, setSmartAssignJob] = useState(null)
  const [taskModalJob, setTaskModalJob] = useState(null)
  const [drawerTech, setDrawerTech] = useState(null)
  const [newJobOpen, setNewJobOpen] = useState(false)
  const [boardChip, setBoardChip] = useState('all')   // technician status chip
  const [stage, setStage] = useState(null)            // Job Flow stage filter
  const [showKanban, setShowKanban] = useState(false) // full job board toggle
  // Measured-figures window. A quick pick is stored by key so "Today" keeps
  // meaning today after midnight; a custom pick is stored as dates.
  const [rangeSel, setRangeSel] = useState({ preset: 'today' })
  const [past, setPast] = useState(null)               // rows for the days before today
  const [pastError, setPastError] = useState(null)
  const [pastNonce, setPastNonce] = useState(0)        // bumps to retry the past read
  const pastLoadId = useRef(0)
  const metaLoaded = useRef(false)                    // skills + config loaded once

  const reloadTimer = useRef(null)
  const flashTimer = useRef(null)
  const mounted = useRef(true)

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async ({ silent = false } = {}) => {
    const request = ++loadId.current
    if (silent) setRefreshing(true)
    else setLoading(true)
    try {
      // Skills + thresholds change rarely: read them on the first and on manual
      // loads only, so the realtime reload and the 60s poll stay one board read.
      const needMeta = !silent || !metaLoaded.current
      const [data, skills, config] = await Promise.all([
        workshop.loadLiveBoard({ country: activeCountry }),
        needMeta ? workshop.listTechnicianSkills({}).catch(() => null) : Promise.resolve(null),
        needMeta ? loadWorkshopConfig().catch(() => null) : Promise.resolve(null),
      ])
      if (!mounted.current || request !== loadId.current) return
      setRaw(data)
      if (skills) setSkillsByUser(skills)
      if (needMeta) metaLoaded.current = true
      if (config) setCfg(config)
      setError(null)
      setNowTs(Date.now())
      setUpdatedAt(new Date())
    } catch (e) {
      if (!mounted.current || request !== loadId.current) return
      setError(toUserMessage(e))
    } finally {
      if (!mounted.current || request !== loadId.current) return
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeCountry])

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => load({ silent: true }), 1500)
  }, [load])

  useEffect(() => {
    mounted.current = true
    setRaw(null); setSiteFilter('All')
    load()
    return () => {
      mounted.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the current request on cleanup.
      loadId.current++
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [load])

  // Realtime: reload (debounced) on workshop activity + work order changes.
  useEffect(() => {
    const channel = supabase
      .channel('workshop-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tech_activity_events' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wo_assignments' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wo_tasks' }, scheduleReload)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [scheduleReload])

  // 60s poll fallback + a lightweight clock tick (keeps relative times / overdue fresh).
  useEffect(() => {
    // Paused while the tab is hidden (a wall screen that is off, a background
    // tab); one catch-up refresh when it becomes visible again.
    const hidden = () => typeof document !== 'undefined' && document.hidden
    const poll = setInterval(() => { if (!hidden()) load({ silent: true }) }, 60000)
    const tick = setInterval(() => { if (!hidden()) setNowTs(Date.now()) }, 30000)
    const onVis = () => { if (!hidden()) load({ silent: true }) }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(poll); clearInterval(tick); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  // ── Engine derivation (all maths here, not recomputed by hand) ─────────────
  const todayStart = useMemo(() => { const d = new Date(nowTs); d.setHours(0, 0, 0, 0); return d.getTime() }, [nowTs])

  // ── Date range (measured figures only) ─────────────────────────────────────
  const todayKey = localDayKey(nowTs)
  const range = useMemo(
    () => (rangeSel.preset ? rangePreset(rangeSel.preset, nowTs) : normalizeRange(rangeSel, nowTs)),
    // todayKey (not nowTs) so the range only moves when the calendar day does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeSel, todayKey],
  )
  const activePreset = rangeSel.preset || matchPreset(range, nowTs)
  const rangeName = useMemo(() => rangeLabel(range.from, range.to), [range])
  const includesToday = range.to === todayKey
  // Days before today are read once per range; today always comes from the live board.
  const pastTo = useMemo(() => {
    if (range.from >= todayKey) return null
    if (range.to < todayKey) return range.to
    const d = new Date(localDayStart(todayKey)); d.setDate(d.getDate() - 1)
    return localDayKey(d)
  }, [range, todayKey])

  useEffect(() => {
    if (!pastTo) { setPast(null); setPastError(null); return undefined }
    const request = ++pastLoadId.current
    setPastError(null)
    loadRangeActivity({ from: range.from, to: pastTo, country: activeCountry })
      .then((rows) => {
        if (!mounted.current || request !== pastLoadId.current) return
        setPast({ ...rows, from: range.from, to: pastTo })
      })
      .catch((e) => {
        if (!mounted.current || request !== pastLoadId.current) return
        setPast(null)
        setPastError(toUserMessage(e, 'Could not load the figures for these dates.'))
      })
    return undefined
  }, [range.from, pastTo, activeCountry, pastNonce])

  const pastReady = !pastTo || (past && past.from === range.from && past.to === pastTo)

  const board = useMemo(() => {
    if (!raw) return []
    return buildBoard(raw.technicians, raw.eventsByUser, {
      now: nowTs,
      shiftByUser: raw.shiftByUser,
      presentByUser: raw.presentByUser,
      jobsById: raw.jobsById,
    })
  }, [raw, nowTs])

  const kpis = useMemo(() => computeKpis(board, raw?.jobs || [], { now: nowTs, todayStart }), [board, raw, nowTs, todayStart])
  const alerts = useMemo(
    () => deriveAlerts(board, raw?.jobs || [], { now: nowTs, assignments: raw?.assignments || [], presentByUser: raw?.presentByUser || {}, thresholds: cfg?.thresholds }),
    [board, raw, nowTs, cfg],
  )
  // Measured figures for the chosen dates: past days from the range read, today
  // from the live board's own inputs (so Today equals the live figures exactly).
  const measures = useMemo(() => {
    if (!raw || !pastReady) return null
    const days = past && pastTo
      ? buildRangeDays({ technicians: raw.technicians, events: past.events, shifts: past.shifts, from: range.from, to: pastTo, now: nowTs })
      : []
    if (includesToday) {
      days.push({
        day: todayKey, now: nowTs,
        eventsByUser: raw.eventsByUser || {},
        shiftByUser: raw.shiftByUser || {},
        presentByUser: raw.presentByUser || {},
      })
    }
    const seen = new Set()
    const completedJobs = [...(past?.completedJobs || []), ...(includesToday ? raw.jobs || [] : [])]
      .filter((j) => (j?.id == null || seen.has(j.id) ? false : (seen.add(j.id), true)))
    return computeRangeMeasures({
      technicians: raw.technicians,
      days,
      completedJobs,
      from: range.from,
      to: range.to,
      now: nowTs,
      labourRate: cfg?.labourRate,
      rateJobs: raw.jobs || [],
      site: siteFilter,
    })
  }, [raw, past, pastReady, pastTo, range, includesToday, todayKey, nowTs, cfg, siteFilter])
  const delays = measures?.delays || []
  const rangeTruncated = !!(past?.eventsTruncated || past?.jobsTruncated)

  const pickPreset = (key) => setRangeSel({ preset: key })
  const pickDate = (edge, value) => {
    if (!value) return
    setRangeSel((cur) => {
      const base = cur.preset ? rangePreset(cur.preset, nowTs) : cur
      return { preset: null, ...normalizeRange({ ...base, [edge]: value }, nowTs) }
    })
  }

  const kpiDefs = useMemo(() => buildKpiDefs(kpis), [kpis])

  // Flat event list (grouped by user in the load) so task time can be scoped by job.
  const allEvents = useMemo(() => Object.values(raw?.eventsByUser || {}).flat(), [raw])
  const eventsForJob = useCallback((jobId) => allEvents.filter((e) => String(e.job_id) === String(jobId)), [allEvents])

  // Per-job task rollup + summary (from the cached raw tasks + this job's events).
  const taskRollupByJob = useMemo(() => {
    const out = {}
    for (const [jobId, tks] of Object.entries(tasksByJob)) {
      out[jobId] = taskRollup(tks, eventsForJob(jobId), { now: nowTs })
    }
    return out
  }, [tasksByJob, eventsForJob, nowTs])

  const taskSummaryByJob = useMemo(() => {
    const out = {}
    for (const [jobId, tks] of Object.entries(tasksByJob)) out[jobId] = jobTaskSummary(tks)
    return out
  }, [tasksByJob])

  // Technician metadata (phone) from the raw roster, for the foreman drawer.
  const techMetaById = useMemo(() => Object.fromEntries((raw?.technicians || []).map((t) => [t.id, t])), [raw])

  // Site options (client-side filter over the loaded board + jobs).
  const siteOptions = useMemo(() => buildSiteOptions(board, raw?.jobs || []), [board, raw])

  const techById = useMemo(() => Object.fromEntries(board.map((b) => [b.userId, b])), [board])

  // Apply site + KPI + search filters to the two surfaces (engine does the work).
  const bySite = useCallback(
    (site) => siteFilter === 'All' || site === siteFilter,
    [siteFilter],
  )

  const activeDef = useMemo(() => (filter ? kpiDefs.find((d) => d.key === filter.key) : null), [filter, kpiDefs])

  const filteredBoard = useMemo(() => {
    const kpiPred = filter?.scope === 'tech' ? activeDef?.pred : null
    const chipPred = BOARD_CHIPS.find((c) => c.key === boardChip)?.pred || null
    const pred = kpiPred && chipPred ? (x) => kpiPred(x) && chipPred(x) : (kpiPred || chipPred)
    return filterBoard(board, { site: siteFilter, pred, query: search })
  }, [board, siteFilter, filter, activeDef, search, boardChip])

  // Chip counts follow the site + search scope (not the chip itself).
  const chips = useMemo(
    () => chipCounts(filterBoard(board, { site: siteFilter, query: search })),
    [board, siteFilter, search],
  )

  const filteredJobs = useMemo(() => {
    const kpiPred = filter?.scope === 'job' ? activeDef?.jobPred : null
    const stagePred = stage ? (j) => jobFlowStage(j) === stage : null
    const pred = kpiPred && stagePred ? (j) => kpiPred(j) && stagePred(j) : (kpiPred || stagePred)
    return filterJobs(raw?.jobs || [], {
      site: siteFilter,
      // openJobs (jobCol null) keeps every open job already returned by the service.
      pred,
      column: filter?.scope === 'job' && !activeDef?.jobPred ? activeDef?.jobCol : null,
      query: search,
      now: nowTs,
    })
  }, [raw, siteFilter, filter, activeDef, search, nowTs, stage])

  // Job Flow counts over the site + search scope (the stage filter is the click target).
  const flow = useMemo(
    () => jobFlowCounts(filterJobs(raw?.jobs || [], { site: siteFilter, query: search, now: nowTs })),
    [raw, siteFilter, search, nowTs],
  )
  const alertList = useMemo(() => alertRows(alerts), [alerts])
  const levels = useMemo(() => alertLevelCounts(alerts), [alerts])

  const columns = useMemo(
    () => bucketJobs(filteredJobs, KANBAN_COLUMNS.map((c) => c.key), nowTs),
    [filteredJobs, nowTs],
  )

  const exportBoard = useCallback(async (kind) => {
    const rows = boardExportRows(filteredBoard, nowTs)
    const name = reportFileName('Workshop Technician Board', siteFilter === 'All' ? 'All sites' : siteFilter)
    try {
      const { exportToExcel, exportToPdf } = await import('../lib/exportUtils')
      if (kind === 'pdf') {
        await exportToPdf(rows, BOARD_EXPORT_KEYS.map((k, i) => ({ key: k, header: BOARD_EXPORT_HEADERS[i] })), 'Workshop Technician Board', name, 'landscape')
      } else {
        await exportToExcel(rows, BOARD_EXPORT_KEYS, BOARD_EXPORT_HEADERS, name, 'Technicians')
      }
    } catch (e) {
      setFlash({ type: 'err', msg: toUserMessage(e, 'Export failed. Please try again.') })
    }
  }, [filteredBoard, nowTs, siteFilter])

  const openJobsForAssign = useMemo(
    () => (raw?.jobs || []).filter((j) => bySite(j.site)),
    [raw, bySite],
  )

  // ── Actions ────────────────────────────────────────────────────────────────
  const mutate = useCallback(async (promise, okMsg) => {
    setBusy(true)
    try {
      await promise
      setFlash({ type: 'ok', msg: okMsg })
      scheduleReload()
    } catch (e) {
      setFlash({ type: 'err', msg: toUserMessage(e) })
    } finally {
      setBusy(false)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => mounted.current && setFlash(null), 4000)
    }
  }, [scheduleReload])

  const onAssign = (jobId, userId) => mutate(workshop.assignJob({ job_id: jobId, user_id: userId }), 'Technician assigned.')
  const onReassign = (jobId, from, to) => mutate(workshop.reassignJob({ job_id: jobId, from_user_id: from, to_user_id: to }), 'Job reassigned.')
  const onStatus = (jobId, status) => mutate(workshop.setJobStatus(jobId, status), 'Status updated.')
  const onPriority = (jobId, priority) => mutate(workshop.setJobPriority(jobId, priority), 'Priority updated.')
  const onVor = (jobId, on) => mutate(workshop.setVor(jobId, on), on ? 'Marked Vehicle Off Road.' : 'Cleared Vehicle Off Road.')
  const onConfirm = (eventId) => mutate(workshop.confirmEvent(eventId), 'Task confirmed.')

  // ── QC sign-off (pure transition from workshopTasks.qcOutcome) ────────────────
  const onQcPass = (job) => {
    const t = qcOutcome('pass') // { status:'Completed', qc_status:'passed' }
    mutate(
      workshop.setJobStatus(job.id, t.status).then(() => workshop.setQcStatus(job.id, t.qc_status)),
      'QC passed. Job completed.',
    )
  }
  const onQcFail = (job) => {
    const t = qcOutcome('fail') // { status:'In Progress', qc_status:'failed', rework:true, note }
    // Record a rework signal against the job (attributed to its owner when known)
    // so first-time-fix analytics stay honest - a QC failure is not a clean fix.
    const run = workshop.setJobStatus(job.id, t.status)
      .then(() => workshop.setQcStatus(job.id, t.qc_status))
      .then(() => workshop.recordEvent({
        user_id: job.assigned_owner_id || undefined,
        job_id: job.id,
        asset_no: job.asset_no || undefined,
        event_type: 'report_problem',
        reason_code: 'support',
        note: t.note,
      }))
    mutate(run, 'QC failed. Job sent back for rework.')
  }

  // ── New job creation ─────────────────────────────────────────────────────────
  const onCreateJob = (values) => {
    const run = workshop.createJob(values).then(async (row) => {
      if (values.assignee && row?.id) {
        await workshop.assignJob({ job_id: row.id, user_id: values.assignee })
      }
      return row
    })
    mutate(run, values.assignee ? 'Job created and assigned.' : 'Job created.')
    setNewJobOpen(false)
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const refreshTasks = useCallback(async (jobId) => {
    try {
      const rows = await workshop.listTasks(jobId)
      if (mounted.current) setTasksByJob((cur) => ({ ...cur, [jobId]: rows }))
    } catch {
      // Non-fatal: leave the cached task list; the mutate() flash reports errors.
    }
  }, [])

  const toggleTasks = useCallback((jobId) => {
    setExpandedJobs((cur) => {
      const next = { ...cur, [jobId]: !cur[jobId] }
      if (next[jobId] && !tasksByJob[jobId]) refreshTasks(jobId)
      return next
    })
  }, [tasksByJob, refreshTasks])

  const openTaskModal = useCallback((job) => {
    setTaskModalJob(job)
    if (!tasksByJob[job.id]) refreshTasks(job.id)
  }, [tasksByJob, refreshTasks])

  const onCreateTask = (jobId, values) =>
    mutate(workshop.createTask(jobId, values).then(() => refreshTasks(jobId)), 'Task added.')
  const onUpdateTask = (jobId, taskId, patch) =>
    mutate(workshop.updateTask(taskId, patch).then(() => refreshTasks(jobId)), 'Task updated.')
  const onSetTaskStatus = (jobId, taskId, status) =>
    mutate(workshop.setTaskStatus(taskId, status).then(() => refreshTasks(jobId)), 'Task status updated.')

  // ── Foreman drawer events ────────────────────────────────────────────────────
  const onForemanEvent = (userId, { event_type, reason_code, note, job_id, confirm }) => {
    const label = {
      pause_job: 'Technician marked unavailable.', request_parts: 'Parts escalated.',
      waiting_approval: 'Approval escalated.', training: 'Technician sent to training.',
    }[event_type] || 'Action recorded.'
    const run = workshop.recordEvent({ user_id: userId, event_type, reason_code, note, job_id })
      .then((row) => (confirm && row?.id ? workshop.confirmEvent(row.id) : row))
    mutate(run, label)
    setDrawerTech(null)
  }

  const onForemanNotify = (userId, message) =>
    mutate(
      workshop.recordEvent({ user_id: userId, event_type: 'report_problem', note: `Foreman note: ${message}` }),
      'Note sent to technician.',
    )

  const openJobById = (jobId) => { setDrawerTech(null); viewJob(jobId) }

  const focusRef = (ref) => {
    setHighlightRef(ref)
    const el = document.getElementById(`ref-${ref}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => mounted.current && setHighlightRef(null), 2500)
  }

  // A job card lives in the (collapsible) kanban: open it before scrolling.
  const jobIds = useMemo(() => new Set((raw?.jobs || []).map((j) => String(j.id))), [raw])
  const viewJob = (jobId) => {
    setShowKanban(true)
    setStage(null)
    setTimeout(() => focusRef(jobId), 60)
  }
  const focusAlert = (ref) => (jobIds.has(String(ref)) ? viewJob(ref) : focusRef(ref))

  const toggleFilter = (def) => {
    if (!def.scope) return
    setFilter((cur) => (cur && cur.key === def.key ? null : { scope: def.scope, key: def.key }))
    if (def.scope === 'job') setShowKanban(true)
  }


  // ── Render ─────────────────────────────────────────────────────────────────
  const firstLoad = loading && !raw
  const loadFailed = !!error && !raw
  const pageState = { loading: firstLoad, data: raw, error: loadFailed ? error : null, retry: () => load() }
  const defByKey = Object.fromEntries(kpiDefs.map((d) => [d.key, d]))
  const emptyBoard = board.length === 0
  const emptyJobs = (raw?.jobs || []).length === 0
  const activeLabel = filter ? defByKey[filter.key]?.label : null
  const stageLabel = stage ? flow.stages.find((s) => s.key === stage)?.label : null
  const rangeIsToday = range.from === todayKey && range.to === todayKey

  return (
    <div className="cc wl-page">
      {/* Header: breadcrumb, title, lead, date + site + primary action */}
      <header className="wl-head">
        <div className="wl-head-copy">
          <nav className="wl-crumb" aria-label="Breadcrumb">
            <Link to="/workshop-management">Workshop and Maintenance</Link>
            <ChevronRight size={12} aria-hidden="true" />
            <span aria-current="page">Live Control</span>
          </nav>
          <h1>Workshop Live Control</h1>
          <p>Real-time technician productivity, job flow, blocked work and vehicle-off-road status.</p>
        </div>
        <div className="wl-head-actions">
          <div className="wl-range" role="group" aria-label="Dates for the measured figures">
            <span className="wl-range-icon" aria-hidden="true"><CalendarDays size={14} /></span>
            <label className="wl-range-field">
              <input
                type="date"
                value={range.from}
                max={range.to}
                onChange={(e) => pickDate('from', e.target.value)}
                aria-label="From date"
              />
            </label>
            <span className="wl-range-sep" aria-hidden="true">to</span>
            <label className="wl-range-field">
              <input
                type="date"
                value={range.to}
                min={range.from}
                max={todayKey}
                onChange={(e) => pickDate('to', e.target.value)}
                aria-label="To date"
              />
            </label>
          </div>
          <select
            className="cc-select wl-range-pick"
            value={activePreset || 'custom'}
            onChange={(e) => { if (e.target.value !== 'custom') pickPreset(e.target.value) }}
            aria-label="Quick date range"
          >
            {RANGE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            {!activePreset && <option value="custom">Custom dates</option>}
          </select>
          <select className="cc-select" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Filter by site" disabled={siteOptions.length <= 1}>
            {siteOptions.map((s) => <option key={s} value={s}>{s === 'All' ? 'All sites' : s}</option>)}
          </select>
          <button type="button" className="cc-btn-primary wl-new" onClick={() => setNewJobOpen(true)}>
            <Plus size={16} aria-hidden="true" /> New Job
          </button>
        </div>
      </header>

      {flash && (
        <div className={`cc-card wl-flash ${flash.type === 'ok' ? 'ok' : 'err'}`} role={flash.type === 'ok' ? 'status' : 'alert'}>
          {flash.type === 'ok' ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
          <span>{flash.msg}</span>
          <button type="button" className="cc-icon-btn" onClick={() => setFlash(null)} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      {loadFailed ? (
        <Card title="Could not load the workshop board"><CardState state={pageState} /></Card>
      ) : (
        <>
          {/* Headline tiles */}
          <div className="cc-kpis wl-kpis">
            {HEADLINE.map((h) => {
              const d = defByKey[h.key]
              const on = filter?.key === h.key
              return (
                <div key={h.key} className="wl-kpi-wrap" data-active={on}>
                  <Kpi
                    icon={d.icon}
                    tone={h.tone}
                    value={d.value}
                    loading={firstLoad}
                    danger={h.key === 'vehiclesOffRoad' && d.value > 0}
                    label={<>{d.label}<span className="wl-kpi-sub">{h.sub}</span></>}
                    onClick={() => toggleFilter(d)}
                    title={on ? 'Showing only these. Click again to clear.' : 'Click to filter the board'}
                  />
                </div>
              )
            })}
          </div>

          {/* Secondary strip: "Now" job figures + measured figures for the chosen dates */}
          <section className="cc-card wl-strip" aria-label="Job and productivity figures">
            <div className="wl-strip-group wl-strip-now">
              <span className="wl-strip-tag" title="Live: these follow the current moment, not the chosen dates">Now</span>
              {STRIP_NOW.map((k) => {
                const d = defByKey[k]
                const on = filter?.key === k
                return (
                  <button key={k} type="button" className="wl-strip-item" aria-pressed={on} onClick={() => toggleFilter(d)} title="Click to filter the job cards">
                    <span>{d.label}</span>
                    <b className={k === 'overdueJobs' && d.value > 0 ? 'is-bad' : ''}>{firstLoad ? '...' : d.value}</b>
                  </button>
                )
              })}
            </div>
            <div className="wl-strip-group wl-strip-range">
              <span className="wl-strip-tag is-range" title="Measured over the dates chosen in the header">{rangeName}</span>
              {STRIP_RANGE.map((m) => {
                const pending = firstLoad || (!measures && !pastError)
                const value = measures ? measures[m.key] : null
                const shown = pending ? '...' : (pastError ? 'N/A' : fmtMeasure(m.key, value))
                // Completed opens the board's Completed column, which only holds today's jobs.
                const clickable = m.key === 'completed' && rangeIsToday
                const on = clickable && filter?.key === 'jobsCompletedToday'
                const body = <><span>{m.label}</span><b>{shown}</b></>
                return clickable
                  ? <button key={m.key} type="button" className="wl-strip-item" aria-pressed={on} onClick={() => toggleFilter(defByKey.jobsCompletedToday)} title={`${m.title}. Click to show them on the job board.`}>{body}</button>
                  : <div key={m.key} className="wl-strip-item" title={m.title}>{body}</div>
              })}
            </div>
            {(pastError || (measures && !measures.hasActivity) || rangeTruncated) && (
              <p className={`wl-strip-note${pastError ? ' is-err' : ''}`} role={pastError ? 'alert' : 'status'}>
                {pastError ? (
                  <>
                    {pastError}{' '}
                    <button type="button" className="cc-link cc-link-btn" onClick={() => setPastNonce((n) => n + 1)}>Retry</button>
                  </>
                ) : rangeTruncated ? (
                  `${rangeName} holds more activity than one read covers, so these figures are a partial count. Choose fewer dates for a complete figure.`
                ) : (
                  `No technician activity recorded in ${rangeName}${siteFilter !== 'All' ? ` at ${siteFilter}` : ''}, so hours and utilisation are not measurable.`
                )}
              </p>
            )}
          </section>

          {/* Toolbar: search, refresh, exports, TV */}
          <div className="cc-filters wl-tools">
            <label className="cc-search wl-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search technician, job card, asset, plate"
                aria-label="Search technicians and job cards"
              />
            </label>
            {(filter || stage) && (
              <button type="button" className="cc-btn-ghost" onClick={() => { setFilter(null); setStage(null) }}>
                <X size={14} aria-hidden="true" /> Clear {[activeLabel, stageLabel].filter(Boolean).join(' and ')}
              </button>
            )}
            <span className="wl-tools-right">
              <span className="wl-muted wl-updated" aria-live="polite">
                {refreshing ? 'Updating...' : updatedAt ? `Updated ${relTime(updatedAt.getTime(), nowTs)}` : ''}
              </span>
              <button type="button" className="cc-icon-btn" onClick={() => load({ silent: true })} aria-label="Refresh" title="Refresh now">
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </button>
              <button type="button" className="cc-btn-ghost" onClick={() => exportBoard('excel')} disabled={!filteredBoard.length}>
                <FileSpreadsheet size={14} aria-hidden="true" /> Excel
              </button>
              <button type="button" className="cc-icon-btn" onClick={() => exportBoard('pdf')} disabled={!filteredBoard.length} aria-label="Export technician board to PDF" title="PDF">
                <FileText size={14} />
              </button>
              <WorkshopTvShareButton className="wl-tv" />
            </span>
          </div>

          {/* Technician Board + Live Alerts */}
          <div className="wl-main">
            <Card
              title="Technician Board"
              sub={<><span className="wl-now-tag">Now</span> Live status by technician. {firstLoad ? '' : `${filteredBoard.length} of ${board.length} shown.`}</>}
              className="wl-board"
            >
              <Tabs
                label="Technician status"
                variant="line"
                value={boardChip}
                onChange={setBoardChip}
                tabs={BOARD_CHIPS.map((c) => ({ key: c.key, label: c.label, count: firstLoad ? null : chips[c.key] }))}
              />
              <CardState
                state={pageState}
                lines={4}
                empty={emptyBoard
                  ? 'No technicians yet. Give staff a workshop role or a skills profile to see them here.'
                  : (filteredBoard.length === 0 ? 'No technicians match these filters.' : null)}
              >
                <div className="wl-tech-grid">
                  {filteredBoard.map((tech) => (
                    <TechTile
                      key={tech.userId}
                      tech={tech}
                      now={nowTs}
                      highlight={highlightRef === tech.userId}
                      onOpen={setDrawerTech}
                      onViewJob={viewJob}
                    />
                  ))}
                </div>
              </CardState>
            </Card>

            <Card
              title={<span className="wl-alert-title"><Bell size={15} aria-hidden="true" /> Live Alerts</span>}
              sub={<><span className="wl-now-tag">Now</span> {firstLoad ? 'Requires supervisor attention' : `${alerts.length} need attention: ${levels.critical} critical, ${levels.warning} warning, ${levels.info} info`}</>}
              className="wl-alerts"
            >
              <CardState
                state={pageState}
                lines={5}
                empty={alerts.length === 0 ? <span className="wl-clear"><CheckCircle2 size={16} aria-hidden="true" /> All clear. Nothing needs a supervisor right now.</span> : null}
              >
                <ul className="wl-alert-list">
                  {alertList.map((a) => (
                    <li key={a.key}>
                      <button type="button" className={`wl-alert lvl-${a.level}`} onClick={() => focusAlert(a.ref)} title="Show the technician or job card">
                        <span className="wl-alert-body">
                          <b>{a.title}</b>
                          <span>{a.detail}</span>
                        </span>
                        <span className={`cc-pill ${a.pillTone}`}>{a.pillLabel}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardState>
            </Card>
          </div>

          {/* Job Flow + full kanban */}
          <Card
            title="Job Flow"
            sub={<><span className="wl-now-tag">Now</span> {firstLoad ? 'Open workshop work by stage' : `${flow.open} open job cards by stage${flow.other ? `. ${flow.other} with a status outside these stages.` : '.'} Click a stage to open it on the board.`}</>}
            action={(
              <button type="button" className="cc-btn-ghost" aria-expanded={showKanban} onClick={() => setShowKanban((v) => !v)}>
                <Kanban size={14} aria-hidden="true" /> {showKanban ? 'Hide job board' : 'Show job board'}
              </button>
            )}
          >
            <CardState state={pageState} lines={2} empty={emptyJobs ? 'No open job cards. Open work orders appear here as they are raised.' : null}>
              <div className="wl-flow">
                {flow.stages.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={`wl-stage tone-${s.tone}`}
                    aria-pressed={stage === s.key}
                    title={s.hint}
                    onClick={() => { setStage((cur) => (cur === s.key ? null : s.key)); setShowKanban(true) }}
                  >
                    <span>{s.label}</span>
                    <b>{s.count}</b>
                    <i aria-hidden="true"><em style={{ width: `${Math.round(s.bar * 100)}%` }} /></i>
                    <small>{flow.open ? `${Math.round(s.share * 100)}% of open` : 'N/A'}</small>
                  </button>
                ))}
              </div>
            </CardState>

            {showKanban && !emptyJobs && (
              <div className="wl-kanban-wrap">
                <div className="wl-kanban-head">
                  <span className="wl-muted">{filteredJobs.length} job cards{stageLabel ? ` in ${stageLabel}` : ''}{activeLabel ? ` (${activeLabel})` : ''}</span>
                </div>
                <div className="wl-kanban">
                  {KANBAN_COLUMNS.map((col) => {
                    const items = columns[col.key] || []
                    return (
                      <div key={col.key} className={`wl-col${col.key === 'Overdue' && items.length ? ' is-over' : ''}`}>
                        <div className="wl-col-head"><span>{col.label}</span><b>{items.length}</b></div>
                        <div className="wl-col-body">
                          {items.length === 0 ? (
                            <div className="wl-col-empty">Empty</div>
                          ) : items.map((job) => (
                            <JobCard
                              key={job.id}
                              job={job}
                              now={nowTs}
                              technicians={board}
                              techById={techById}
                              busy={busy}
                              onAssign={onAssign}
                              onReassign={onReassign}
                              onStatus={onStatus}
                              onPriority={onPriority}
                              onVor={onVor}
                              onQcPass={onQcPass}
                              onQcFail={onQcFail}
                              tasks={taskRollupByJob[job.id]}
                              taskSummary={taskSummaryByJob[job.id]}
                              expanded={!!expandedJobs[job.id]}
                              onToggleTasks={toggleTasks}
                              onManageTasks={openTaskModal}
                              onSmartAssign={setSmartAssignJob}
                              onSetTaskStatus={(taskId, status, jobId) => onSetTaskStatus(jobId, taskId, status)}
                              highlight={highlightRef === job.id}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="wl-quick">
              <Link to="/work-orders">All work orders</Link>
              <Link to="/parts-requests">Parts requests</Link>
              <Link to="/workshop-absence">Absence and attendance</Link>
              <Link to="/workshop-analytics">Workshop analytics</Link>
              <Link to="/workshop-settings">Alert thresholds</Link>
            </div>
          </Card>

          {/* Delay and root cause (lost hours and their cost) */}
          <Card
            title={<span className="wl-alert-title"><Timer size={15} aria-hidden="true" /> Delay and root cause</span>}
            sub={`Blocked time in ${rangeName} by cause, with the responsible team, cost impact and suggested action`}
          >
            <CardState state={pageState} lines={3}>
              {pastError ? (
                <p className="wl-strip-note is-err" role="alert">
                  {pastError}{' '}
                  <button type="button" className="cc-link cc-link-btn" onClick={() => setPastNonce((n) => n + 1)}>Retry</button>
                </p>
              ) : !measures ? (
                <p className="wl-muted" aria-live="polite">Loading delay causes for {rangeName}...</p>
              ) : !measures.hasActivity ? (
                <p className="wl-muted">No technician activity recorded in {rangeName}, so there is no blocked time to break down.</p>
              ) : (
                <DelayPanel delays={delays} bare period={rangeIsToday ? null : rangeName} />
              )}
            </CardState>
          </Card>
        </>
      )}

      {smartAssignJob && (
        <SmartAssignModal
          job={smartAssignJob}
          board={board}
          technicians={board}
          skillsByUser={skillsByUser}
          assignments={raw?.assignments || []}
          busy={busy}
          onClose={() => setSmartAssignJob(null)}
          onAssign={onAssign}
          onReassign={onReassign}
        />
      )}

      {taskModalJob && (
        <TaskModal
          job={taskModalJob}
          tasks={taskRollupByJob[taskModalJob.id]}
          technicians={board}
          busy={busy}
          onClose={() => setTaskModalJob(null)}
          onCreate={onCreateTask}
          onUpdate={(taskId, patch) => onUpdateTask(taskModalJob.id, taskId, patch)}
          onSetStatus={(taskId, status) => onSetTaskStatus(taskModalJob.id, taskId, status)}
        />
      )}

      {drawerTech && (
        <TechDrawer
          tech={drawerTech}
          meta={techMetaById[drawerTech.userId]}
          assignments={raw?.assignments || []}
          skillsByUser={skillsByUser}
          busy={busy}
          onClose={() => setDrawerTech(null)}
          onEvent={onForemanEvent}
          onNotify={onForemanNotify}
          onOpenJob={openJobById}
          now={nowTs}
          events={raw?.eventsByUser?.[drawerTech.userId]}
          jobs={openJobsForAssign}
          onAssign={(j, u) => { onAssign(j, u); setDrawerTech(null) }}
          onReassign={(j, f, t) => { onReassign(j, f, t); setDrawerTech(null) }}
          onConfirm={(id) => { onConfirm(id); setDrawerTech(null) }}
        />
      )}

      {newJobOpen && (
        <WorkshopNewJobModal
          technicians={board}
          busy={busy}
          onClose={() => setNewJobOpen(false)}
          onCreate={onCreateJob}
        />
      )}
    </div>
  )
}
