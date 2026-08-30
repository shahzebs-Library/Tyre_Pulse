/**
 * Repair Requests (RFR) - route /repair-requests
 *
 * An RFR is the document a driver or operator raises BEFORE a job card exists.
 * The chain the workshop actually runs is
 *   RFR  ->  Job Card (work_orders)  ->  MIS store issue  ->  parts lines,
 * and until now only the last three links were in the system. `work_orders.rfr_no`
 * has carried the reference all along (measured live: 57,192 of 90,535 cards name
 * one, and all 57,192 are distinct), but the REQUEST itself, the hours before
 * somebody carded it, and the requests nobody ever carded were invisible.
 *
 * THREE TABS, ANSWERING THREE DIFFERENT QUESTIONS:
 *   1. Requests            the live queue: what is waiting on the workshop now
 *   2. RFR on job cards    the history already in the system, useful on day one
 *   3. Analytics           where the time goes between raising and carding
 *
 * ALL ARITHMETIC LIVES IN THE PURE ENGINE `src/lib/repairRequests.js`. The
 * tiles, the table, the charts and both exports read the same functions, so a
 * figure on screen and the same figure in Excel cannot drift.
 *
 * THE HONESTY RULES THIS PAGE ENFORCES:
 *  - An unmeasurable figure renders "Not measurable", never 0. A median over a
 *    set where nothing converted is not zero hours; zero reads as instant.
 *  - Tab 1 degrades to a stated "not provisioned yet" panel when the backing
 *    table is absent, rather than an empty list that reads as "no requests".
 *  - Time to acknowledge is reported as "Not recorded" because the schema
 *    carries no acknowledged_at. It is NOT approximated from updated_at, which
 *    any later edit would move.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  ClipboardList, RefreshCw, Filter, X, Search, Download, FileText, Plus,
  CheckCircle2, XCircle, Ban, ArrowRight, Clock, AlertTriangle, TrendingUp,
  Inbox, Wrench, Link2, ChevronRight, Hash, User, Camera, ListChecks,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  listRepairRequests, listRfrJobCards, countRfrCoverage,
  createRepairRequest, setRepairRequestStatus, convertToJobCard, nextRfrNo,
} from '../lib/api/repairRequests'
import {
  RFR_STATUSES, RFR_PRIORITIES, RFR_FAULT_CATEGORIES, RFR_TARGET_HOURS,
  RFR_STATUS_META, EMPTY_RFR_FILTERS,
  canonRfrPriority, rfrStatusLabel, rfrStatusMeta,
  nextRfrStatuses, rfrAgeHours, hoursToConvert, isRfrOverdue,
  filterRfrs, filterJobCardRfrs, summarizeRfrs, summarizeJobCardRfrs,
  rfrConversionFunnel, byRfrGroup, timeToConvertBands, rfrMonthlyTrend,
  jobCardRfrView, rfrExportRows, jobCardRfrExportRows, rfrFindings, dayKey,
} from '../lib/repairRequests'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { safeImageSrc } from '../lib/safeUrl'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement,
  Filler, Tooltip, Legend,
)

const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])

const TONE = {
  danger: { bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.30)', text: '#fca5a5' },
  warning: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)', text: '#fcd34d' },
  info: { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.30)', text: '#93c5fd' },
  good: { bg: 'rgba(22,163,74,0.10)', border: 'rgba(22,163,74,0.30)', text: '#86efac' },
  quiet: { bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)', text: '#cbd5e1' },
}

const inputCls =
  'w-full rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 '
  + 'text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]'

const chartOpts = (extra = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, ...(extra.plugins || {}) },
  ...extra,
})

/** Hours rendered for a person. Null is stated, never printed as a zero. */
function hours(n) {
  if (n === null || n === undefined) return 'Not measurable'
  if (n < 1) return `${Math.round(n * 60)} min`
  if (n < 48) return `${Math.round(n * 10) / 10} h`
  return `${Math.round(n / 24)} d`
}

function Tile({ label, value, sub, icon: Icon, tone, active, onClick }) {
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Cmp
      onClick={onClick}
      className={`card p-4 text-left w-full ${onClick ? 'hover:border-white/20 transition-colors' : ''}`}
      style={active ? { borderColor: 'var(--accent)' } : undefined}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        {Icon && <Icon className="w-4 h-4" style={{ color: tone || 'var(--text-dim)' }} />}
      </div>
      <div className="text-2xl font-semibold" style={{ color: tone || 'var(--text-primary)' }}>
        {value === null || value === undefined ? 'N/A' : value}
      </div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{sub}</div>}
    </Cmp>
  )
}

function StatusPill({ status }) {
  const meta = rfrStatusMeta(status)
  const t = meta ? TONE[meta.tone] : TONE.quiet
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap"
      style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text }}
    >
      {rfrStatusLabel(status)}
    </span>
  )
}

function PriorityPill({ priority }) {
  const p = canonRfrPriority(priority)
  if (!p) return <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Not set</span>
  const tone = p === 'Critical' ? TONE.danger : p === 'High' ? TONE.warning
    : p === 'Medium' ? TONE.info : TONE.good
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px]"
      style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.text }}
    >
      {p}
    </span>
  )
}

const TABS = [
  { key: 'requests', label: 'Requests', icon: Inbox },
  { key: 'jobcards', label: 'RFR on job cards', icon: Wrench },
  { key: 'analytics', label: 'Analytics', icon: TrendingUp },
]

const BLANK_FORM = {
  rfr_no: '', asset_no: '', plate_no: '', site: '', fault_category: '',
  priority: 'Medium', description: '', reported_by_name: '', odometer: '',
  engine_hours: '',
}

export default function RepairRequests() {
  const { activeCountry } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const canWrite = isSuperAdmin === true || WRITE_ROLES.has(profile?.role)

  const [tab, setTab] = useState('requests')

  // Live queue
  const [queue, setQueue] = useState(null)      // { ok, reason, rows, truncated }
  const [queueLoading, setQueueLoading] = useState(true)
  const [queueError, setQueueError] = useState('')

  // History (job cards that name an RFR)
  const [cards, setCards] = useState(null)
  const [cardsLoading, setCardsLoading] = useState(true)
  const [cardsError, setCardsError] = useState('')
  const [coverage, setCoverage] = useState(null)

  const [filters, setFilters] = useState(EMPTY_RFR_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [open, setOpen] = useState(null)         // request in the drawer
  const [form, setForm] = useState(null)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(null)
  const [converting, setConverting] = useState(null)
  const [notice, setNotice] = useState('')

  // ONE clock for the whole render, so every age on screen is measured from the
  // same instant rather than drifting row by row as the render walks the list.
  const [now, setNow] = useState(() => Date.now())

  const loadQueue = useCallback(async () => {
    setQueueLoading(true); setQueueError('')
    try {
      const res = await listRepairRequests({ country: activeCountry })
      setQueue(res)
      setNow(Date.now())
    } catch (e) {
      setQueueError(toUserMessage(e, 'Could not load the repair request queue.'))
    } finally { setQueueLoading(false) }
  }, [activeCountry])

  const loadCards = useCallback(async () => {
    setCardsLoading(true); setCardsError('')
    try {
      const [res, cov] = await Promise.all([
        listRfrJobCards({ country: activeCountry }),
        countRfrCoverage({ country: activeCountry }).catch(() => null),
      ])
      setCards(res)
      setCoverage(cov)
    } catch (e) {
      setCardsError(toUserMessage(e, 'Could not load the job cards that name an RFR.'))
    } finally { setCardsLoading(false) }
  }, [activeCountry])

  useEffect(() => { loadQueue() }, [loadQueue])
  useEffect(() => { loadCards() }, [loadCards])

  const refreshAll = () => { loadQueue(); loadCards() }

  // ── derived: live queue ───────────────────────────────────────────────────
  // Memoised rather than computed inline: the `[]` fallback would be a NEW array
  // on every render, so every memo keyed on it would recompute the whole filter,
  // summary and chart chain on each keystroke in the search box.
  const queueRows = useMemo(() => (queue?.ok ? queue.rows : []), [queue])
  const filteredQueue = useMemo(() => filterRfrs(queueRows, filters), [queueRows, filters])
  const summary = useMemo(() => summarizeRfrs(filteredQueue, now), [filteredQueue, now])
  const findings = useMemo(
    () => rfrFindings(filteredQueue, summary, now),
    [filteredQueue, summary, now],
  )

  const sortedQueue = useMemo(() => {
    // Oldest waiting first: the queue exists to be worked from the top, and a
    // request whose age is unknown sorts last rather than being treated as new.
    return [...filteredQueue].sort((a, b) => {
      const ao = isRfrOverdue(a, now) ? 1 : 0
      const bo = isRfrOverdue(b, now) ? 1 : 0
      if (ao !== bo) return bo - ao
      const ax = rfrAgeHours(a, now)
      const bx = rfrAgeHours(b, now)
      if (ax === null && bx === null) return 0
      if (ax === null) return 1
      if (bx === null) return -1
      return bx - ax
    })
  }, [filteredQueue, now])

  // ── derived: history ──────────────────────────────────────────────────────
  const cardViews = useMemo(
    () => (cards?.ok ? cards.rows.map(jobCardRfrView).filter(Boolean) : []),
    [cards],
  )
  const filteredCards = useMemo(
    () => filterJobCardRfrs(cardViews, filters),
    [cardViews, filters],
  )
  const queuePager = usePagedRows(sortedQueue)
  const cardsPager = usePagedRows(filteredCards)
  const cardSummary = useMemo(() => summarizeJobCardRfrs(filteredCards), [filteredCards])

  // ── derived: analytics (over whichever tab's set is in view) ──────────────
  const funnel = useMemo(() => rfrConversionFunnel(filteredQueue), [filteredQueue])
  const convertBands = useMemo(() => timeToConvertBands(filteredQueue), [filteredQueue])
  const byFault = useMemo(() => byRfrGroup(filteredQueue, 'fault_category'), [filteredQueue])
  const bySiteQueue = useMemo(() => byRfrGroup(filteredQueue, 'site', { limit: 12 }), [filteredQueue])
  const bySiteCards = useMemo(() => byRfrGroup(filteredCards, 'site', { limit: 12 }), [filteredCards])
  const trend = useMemo(() => rfrMonthlyTrend(filteredQueue, { months: 12, now }), [filteredQueue, now])
  const cardTrend = useMemo(
    () => rfrMonthlyTrend(filteredCards, { months: 12, now, dateField: 'opened_at' }),
    [filteredCards, now],
  )

  // ── options derived from what is loaded, never invented ───────────────────
  const siteOptions = useMemo(() => {
    const set = new Set()
    for (const r of queueRows) if (r?.site) set.add(r.site)
    for (const r of cardViews) if (r?.site) set.add(r.site)
    return [...set].sort()
  }, [queueRows, cardViews])

  const activeFilterCount = useMemo(
    () => Object.entries(filters).filter(([, v]) => !!String(v || '').trim()).length,
    [filters],
  )
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  // ── exports ───────────────────────────────────────────────────────────────
  const exportQueue = (kind) => {
    const { columns, headers, rows } = rfrExportRows(sortedQueue, now)
    const name = reportFileName('TyrePulse Repair Requests')
    if (kind === 'excel') exportToExcel(rows, columns, headers, name)
    else {
      exportToPdf(
        rows,
        columns.map((k, i) => ({ key: k, header: headers[i] })),
        'Repair Requests (RFR)',
        name,
        'landscape',
      )
    }
  }

  const exportCards = (kind) => {
    const { columns, headers, rows } = jobCardRfrExportRows(filteredCards)
    const name = reportFileName('TyrePulse RFR Job Cards')
    if (kind === 'excel') exportToExcel(rows, columns, headers, name)
    else {
      exportToPdf(
        rows,
        columns.map((k, i) => ({ key: k, header: headers[i] })),
        'RFR references on job cards',
        name,
        'landscape',
      )
    }
  }

  const exportAnalytics = (kind) => {
    // The analytics export is the numbers behind the charts, not a picture of
    // them: a sheet somebody can reconcile beats an image they cannot.
    const rows = [
      ...funnel.map((s) => ({
        section: 'Conversion funnel', label: s.label, value: s.count,
        share: s.pct === null ? 'Not measurable' : `${s.pct}%`,
      })),
      ...convertBands.bands.map((b) => ({
        section: 'Time to job card', label: b.label, value: b.count, share: '',
      })),
      { section: 'Time to job card', label: 'Never converted', value: convertBands.unconverted, share: '' },
      ...byFault.map((g) => ({ section: 'Fault category', label: g.label, value: g.count, share: '' })),
      ...bySiteQueue.map((g) => ({ section: 'Site', label: g.label, value: g.count, share: '' })),
      ...trend.points.map((p) => ({
        section: 'Monthly', label: p.month, value: p.count, share: `${p.converted} converted`,
      })),
    ]
    const columns = ['section', 'label', 'value', 'share']
    const headers = ['Section', 'Item', 'Count', 'Detail']
    const name = reportFileName('TyrePulse RFR Analytics')
    if (kind === 'excel') exportToExcel(rows, columns, headers, name)
    else {
      exportToPdf(
        rows,
        columns.map((k, i) => ({ key: k, header: headers[i] })),
        'Repair request analytics',
        name,
        'landscape',
      )
    }
  }

  const exportForTab = (kind) => {
    if (tab === 'jobcards') return exportCards(kind)
    if (tab === 'analytics') return exportAnalytics(kind)
    return exportQueue(kind)
  }

  const exportDisabled = tab === 'jobcards'
    ? !filteredCards.length
    : tab === 'analytics'
      ? !filteredQueue.length
      : !sortedQueue.length

  // ── actions ───────────────────────────────────────────────────────────────
  const move = async (row, status, reason) => {
    setBusy(true); setNotice('')
    try {
      await setRepairRequestStatus(row.id, status, { reason })
      setRejecting(null)
      setOpen(null)
      await loadQueue()
    } catch (e) {
      setQueueError(toUserMessage(e, 'Could not update this request.'))
    } finally { setBusy(false) }
  }

  const doConvert = async () => {
    if (!converting) return
    setBusy(true); setNotice('')
    try {
      const res = await convertToJobCard(converting.row.id, {
        workOrderNo: converting.workOrderNo,
      })
      if (!res.ok) {
        setFormError(res.detail || 'Converting a request to a job card is not available yet.')
        return
      }
      const jc = (res.row && (res.row.work_order_no || res.row.workOrderNo))
        || converting.workOrderNo
      setNotice(jc
        ? `Request ${converting.row.rfr_no || ''} is now job card ${jc}.`.trim()
        : 'The request was converted to a job card.')
      setConverting(null)
      setOpen(null)
      await Promise.all([loadQueue(), loadCards()])
    } catch (e) {
      setFormError(toUserMessage(e, 'Could not convert this request.'))
    } finally { setBusy(false) }
  }

  const openForm = async () => {
    setFormError('')
    const draft = { ...BLANK_FORM, site: filters.site || '' }
    setForm(draft)
    // Server-minted reference. The number is a per-country per-month sequence,
    // so two people raising a request in the same minute must not both compute
    // the same one. A workspace without the function simply gets a blank field
    // the person can type into, rather than a blocked form.
    try {
      const no = await nextRfrNo({ country: activeCountry, site: draft.site })
      if (no) setForm((f) => (f ? { ...f, rfr_no: no } : f))
    } catch { /* the field stays typeable */ }
  }

  const submitForm = async (e) => {
    e.preventDefault()
    if (!form?.asset_no?.trim()) { setFormError('An asset code is required.'); return }
    if (!form?.description?.trim()) { setFormError('Describe the fault so the workshop knows what it is taking on.'); return }
    setBusy(true); setFormError('')
    try {
      await createRepairRequest({
        ...form,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
        reported_at: new Date().toISOString(),
      })
      setForm(null)
      await loadQueue()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not raise this request.'))
    } finally { setBusy(false) }
  }

  // ── chart data (palette follows the shared report theme) ──────────────────
  const funnelData = useMemo(() => {
    const steps = funnel.filter((s) => s.key !== 'rejected' && s.key !== 'cancelled')
    return {
      labels: steps.map((s) => s.label),
      datasets: [{
        label: 'Requests',
        data: steps.map((s) => s.count),
        backgroundColor: steps.map((_, i) => withAlpha(colorAt(i), 0.75)),
        borderColor: steps.map((_, i) => colorAt(i)),
        borderWidth: 1,
      }],
    }
  }, [funnel])

  const bandData = useMemo(() => ({
    labels: convertBands.bands.map((b) => b.label),
    datasets: [{
      label: 'Requests',
      data: convertBands.bands.map((b) => b.count),
      backgroundColor: convertBands.bands.map((_, i) => withAlpha(colorAt(i), 0.75)),
      borderColor: convertBands.bands.map((_, i) => colorAt(i)),
      borderWidth: 1,
    }],
  }), [convertBands])

  const faultData = useMemo(() => ({
    labels: byFault.map((g) => g.label),
    datasets: [{ data: byFault.map((g) => g.count), backgroundColor: categorical(byFault.length), borderWidth: 0 }],
  }), [byFault])

  const siteData = useMemo(() => ({
    labels: bySiteQueue.map((g) => g.label),
    datasets: [{
      label: 'Requests',
      data: bySiteQueue.map((g) => g.count),
      backgroundColor: bySiteQueue.map((_, i) => withAlpha(colorAt(i), 0.75)),
      borderColor: bySiteQueue.map((_, i) => colorAt(i)),
      borderWidth: 1,
    }],
  }), [bySiteQueue])

  const trendData = useMemo(() => ({
    labels: trend.points.map((p) => p.month),
    datasets: [
      {
        label: 'Raised',
        data: trend.points.map((p) => p.count),
        borderColor: colorAt(0),
        backgroundColor: withAlpha(colorAt(0), 0.18),
        fill: true,
        tension: 0.3,
      },
      {
        label: 'Converted',
        data: trend.points.map((p) => p.converted),
        borderColor: colorAt(1),
        backgroundColor: withAlpha(colorAt(1), 0.18),
        fill: true,
        tension: 0.3,
      },
    ],
  }), [trend])

  const cardTrendData = useMemo(() => ({
    labels: cardTrend.points.map((p) => p.month),
    datasets: [{
      label: 'Job cards raised from an RFR',
      data: cardTrend.points.map((p) => p.count),
      borderColor: colorAt(2),
      backgroundColor: withAlpha(colorAt(2), 0.18),
      fill: true,
      tension: 0.3,
    }],
  }), [cardTrend])

  const legendOpts = {
    plugins: {
      legend: {
        display: true, position: 'bottom',
        labels: { color: 'var(--text-secondary)', boxWidth: 12 },
      },
    },
  }

  // ── render helpers ────────────────────────────────────────────────────────
  const notProvisioned = queue && !queue.ok

  const filterPanel = (
    <div className="card p-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Search</span>
          <div className="relative mt-1">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5" style={{ color: 'var(--text-dim)' }} />
            <input
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
              placeholder="RFR number, asset, job card or fault"
              className={`${inputCls} pl-8`}
            />
          </div>
        </label>
        {tab === 'requests' && (
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Status</span>
            <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">Any status</option>
              {RFR_STATUSES.map((s) => (
                <option key={s} value={s}>{RFR_STATUS_META[s].label}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Priority</span>
          <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)} className={`${inputCls} mt-1`}>
            <option value="">Any priority</option>
            {RFR_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Site</span>
          <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)} className={`${inputCls} mt-1`}>
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {tab === 'requests' && (
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Fault</span>
            <select value={filters.faultCategory} onChange={(e) => setFilter('faultCategory', e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">Any fault</option>
              {RFR_FAULT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Asset code</span>
          <input value={filters.assetNo} onChange={(e) => setFilter('assetNo', e.target.value)} placeholder="TM514" className={`${inputCls} mt-1`} />
        </label>
        <label className="block">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>From</span>
          <input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} className={`${inputCls} mt-1`} />
        </label>
        <label className="block">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>To</span>
          <input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} className={`${inputCls} mt-1`} />
        </label>
      </div>
      <div className="flex items-center justify-between mt-3">
        <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
          {tab === 'jobcards'
            ? `Showing ${filteredCards.length} of ${cardViews.length} job cards that name an RFR.`
            : `Showing ${filteredQueue.length} of ${queueRows.length} requests.`}
        </p>
        <button onClick={() => setFilters(EMPTY_RFR_FILTERS)} className="btn-secondary text-xs inline-flex items-center gap-1">
          <X className="w-3 h-3" /> Clear filters
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Repair Requests (RFR)"
        subtitle="What the fleet has asked the workshop to fix, before it becomes a job card"
        icon={ClipboardList}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={refreshAll} className="btn-secondary text-sm inline-flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            {tab !== 'analytics' && (
              <button onClick={() => setShowFilters((s) => !s)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                <Filter className="w-4 h-4" />
                Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
              </button>
            )}
            <button onClick={() => exportForTab('excel')} disabled={exportDisabled} className="btn-secondary text-sm inline-flex items-center gap-1.5">
              <Download className="w-4 h-4" /> Excel
            </button>
            <button onClick={() => exportForTab('pdf')} disabled={exportDisabled} className="btn-secondary text-sm inline-flex items-center gap-1.5">
              <FileText className="w-4 h-4" /> PDF
            </button>
            {canWrite && !notProvisioned && (
              <button onClick={openForm} className="btn-primary text-sm inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Raise a request
              </button>
            )}
          </div>
        )}
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon
          const on = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-3 py-2 rounded-lg text-sm inline-flex items-center gap-1.5 border transition-colors"
              style={{
                background: on ? 'var(--brand-subtle, rgba(22,163,74,0.12))' : 'transparent',
                borderColor: on ? 'var(--accent)' : 'var(--border-subtle, rgba(255,255,255,0.08))',
                color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {notice && (
        <div className="card p-3 flex items-start justify-between gap-3"
          style={{ background: TONE.good.bg, borderColor: TONE.good.border }}>
          <p className="text-sm" style={{ color: TONE.good.text }}>{notice}</p>
          <button onClick={() => setNotice('')} className="btn-secondary text-xs">Dismiss</button>
        </div>
      )}

      {showFilters && tab !== 'analytics' && filterPanel}

      {/* ── Tab 1: the live queue ─────────────────────────────────────────── */}
      {tab === 'requests' && (
        <>
          {queueError && (
            <div className="card p-4 flex items-start justify-between gap-3"
              style={{ background: TONE.danger.bg, borderColor: TONE.danger.border }}>
              <p className="text-sm" style={{ color: TONE.danger.text }}>{queueError}</p>
              <button onClick={loadQueue} className="btn-secondary text-xs">Retry</button>
            </div>
          )}

          {queueLoading ? (
            <div className="card p-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              Loading the repair request queue...
            </div>
          ) : notProvisioned ? (
            <EmptyState
              icon={ClipboardList}
              title={queue.reason === 'schema_mismatch'
                ? 'Repair requests need a schema update'
                : 'Repair requests are not set up in this workspace yet'}
              description={queue.reason === 'schema_mismatch'
                ? (queue.detail || 'The repair requests table exists but does not carry the columns this page reads.')
                : 'Nothing has been lost. The RFR references already recorded on job cards are on the "RFR on job cards" tab, and the live queue appears here once the register is provisioned.'}
              action={{ label: 'Check again', onClick: loadQueue }}
            />
          ) : (
            <>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <Tile label="Open requests" value={summary.open} icon={Inbox}
                  sub={summary.assets ? `${summary.assets} distinct assets` : null}
                  tone={summary.open ? '#f59e0b' : undefined} />
                <Tile label="Awaiting acknowledgement" value={summary.awaitingAcknowledgement} icon={Clock}
                  active={filters.status === 'submitted'}
                  onClick={() => setFilter('status', filters.status === 'submitted' ? '' : 'submitted')} />
                <Tile label="Past response target" value={summary.overdue} icon={AlertTriangle}
                  tone={summary.overdue ? '#ef4444' : undefined}
                  sub={`Critical ${RFR_TARGET_HOURS.Critical} h, High ${RFR_TARGET_HOURS.High} h, Medium ${RFR_TARGET_HOURS.Medium} h, Low ${RFR_TARGET_HOURS.Low} h`} />
                <Tile label="Converted to job cards" value={summary.converted} icon={CheckCircle2}
                  sub={summary.conversionRate === null ? 'Rate not measurable' : `${summary.conversionRate}% of requests`}
                  active={filters.status === 'converted'}
                  onClick={() => setFilter('status', filters.status === 'converted' ? '' : 'converted')} />
                <Tile label="Median time to job card" value={hours(summary.medianHoursToConvert)} icon={ArrowRight}
                  sub={summary.convertMeasured
                    ? `Measured on ${summary.convertMeasured} request${summary.convertMeasured === 1 ? '' : 's'}`
                    : 'Nothing has converted in this view'} />
                <Tile label="Median time to acknowledge"
                  value={summary.acknowledgeMeasured ? hours(summary.medianHoursToAcknowledge) : 'Not recorded'}
                  icon={ListChecks}
                  sub={summary.acknowledgeMeasured
                    ? `Measured on ${summary.acknowledgeMeasured}`
                    : 'No request records when it was acknowledged'} />
              </div>

              {queue.truncated && (
                <div className="card p-3" style={{ background: TONE.warning.bg, borderColor: TONE.warning.border }}>
                  <p className="text-sm" style={{ color: TONE.warning.text }}>
                    This view was capped. Narrow the date range to see the whole register.
                  </p>
                </div>
              )}

              {findings.length > 0 && (
                <div className="card p-4 space-y-2">
                  <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>What needs attention</h3>
                  {findings.map((f, i) => (
                    <div key={i} className="rounded-lg px-3 py-2 text-sm"
                      style={{ background: TONE[f.tone]?.bg, border: `1px solid ${TONE[f.tone]?.border}`, color: TONE[f.tone]?.text }}>
                      {f.text}
                    </div>
                  ))}
                </div>
              )}

              <div className="card overflow-hidden">
                {!sortedQueue.length ? (
                  <EmptyState
                    icon={Inbox}
                    title={queueRows.length ? 'No requests match these filters' : 'No repair requests recorded yet'}
                    description={queueRows.length
                      ? 'Clear a filter to widen the view.'
                      : 'A request raised from the workshop or the field app appears here.'}
                    action={queueRows.length ? { label: 'Clear filters', onClick: () => setFilters(EMPTY_RFR_FILTERS) } : null}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.08))' }}>
                          {['RFR', 'Asset', 'Fault', 'Site', 'Priority', 'Status', 'Waiting', 'Job card', ''].map((h) => (
                            <th key={h} className="text-left px-3 py-2 text-xs font-medium whitespace-nowrap"
                              style={{ color: 'var(--text-secondary)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {queuePager.pageRows.map((r) => {
                          const overdue = isRfrOverdue(r, now)
                          return (
                            <tr key={r.id}
                              className="cursor-pointer hover:bg-white/5"
                              onClick={() => setOpen(r)}
                              style={{ borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.05))' }}>
                              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                                {r.rfr_no || 'N/A'}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                                {r.asset_no || 'N/A'}
                              </td>
                              <td className="px-3 py-2 max-w-[22rem] truncate" style={{ color: 'var(--text-secondary)' }}
                                title={r.description || ''}>
                                {r.fault_category || 'Not recorded'}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                                {r.site || 'Not recorded'}
                              </td>
                              <td className="px-3 py-2"><PriorityPill priority={r.priority} /></td>
                              <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                              <td className="px-3 py-2 whitespace-nowrap"
                                style={{ color: overdue ? '#fca5a5' : 'var(--text-secondary)' }}>
                                {hours(rfrAgeHours(r, now))}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                                {r.work_order_no || ''}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <ChevronRight className="w-4 h-4 inline" style={{ color: 'var(--text-dim)' }} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <TablePagination {...queuePager} />
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Tab 2: RFR references already on job cards ────────────────────── */}
      {tab === 'jobcards' && (
        <>
          {cardsError && (
            <div className="card p-4 flex items-start justify-between gap-3"
              style={{ background: TONE.danger.bg, borderColor: TONE.danger.border }}>
              <p className="text-sm" style={{ color: TONE.danger.text }}>{cardsError}</p>
              <button onClick={loadCards} className="btn-secondary text-xs">Retry</button>
            </div>
          )}

          {cardsLoading ? (
            <div className="card p-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              Loading job cards that name an RFR...
            </div>
          ) : cards && !cards.ok ? (
            <EmptyState
              icon={Wrench}
              title="Job cards could not be read"
              description="The job card register is not available in this workspace."
              action={{ label: 'Check again', onClick: loadCards }}
            />
          ) : (
            <>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <Tile label="Job cards with an RFR" value={cardSummary.total} icon={Wrench}
                  sub={coverage?.pct === null || coverage?.pct === undefined
                    ? null
                    : `${coverage.pct}% of all job cards`} />
                <Tile label="Distinct RFR references" value={cardSummary.distinctRfrNumbers} icon={Hash}
                  sub={cardSummary.duplicateRfrNumbers
                    ? `${cardSummary.duplicateRfrNumbers} reference reused on more than one card`
                    : 'Every reference is unique'}
                  tone={cardSummary.duplicateRfrNumbers ? '#f59e0b' : undefined} />
                <Tile label="People raising requests" value={cardSummary.distinctRaisers} icon={User}
                  sub={cardSummary.raisedByCoveragePct === null
                    ? 'Coverage not measurable'
                    : `Recorded on ${cardSummary.raisedByCoveragePct}% of cards`} />
                <Tile label="Sites" value={cardSummary.sites} icon={ClipboardList} />
                <Tile label="References this page can read" value={cardSummary.parseableRfrNumbers} icon={ListChecks}
                  sub={cardSummary.unparseableRfrNumbers
                    ? `${cardSummary.unparseableRfrNumbers} do not match the expected format`
                    : 'All match the expected format'} />
              </div>

              {cards?.truncated && (
                <div className="card p-3" style={{ background: TONE.warning.bg, borderColor: TONE.warning.border }}>
                  <p className="text-sm" style={{ color: TONE.warning.text }}>
                    This view was capped before the whole history was read. Narrow the date range for a complete set.
                  </p>
                </div>
              )}

              <div className="card p-4">
                <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                  Job cards raised from a request, by month
                </h3>
                {cardTrend.points.some((p) => p.count) ? (
                  <div className="h-56"><Line data={cardTrendData} options={chartOpts(legendOpts)} /></div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Nothing to chart in this view.</p>
                )}
                {cardTrend.anchor && (
                  <p className="text-[11px] mt-2" style={{ color: 'var(--text-dim)' }}>
                    Twelve months ending {cardTrend.anchor}
                    {cardTrend.anchoredToData ? ', the newest month with data.' : '.'}
                  </p>
                )}
              </div>

              <div className="card overflow-hidden">
                {!filteredCards.length ? (
                  <EmptyState
                    icon={Wrench}
                    title={cardViews.length ? 'No job cards match these filters' : 'No job card names an RFR here'}
                    description={cardViews.length
                      ? 'Clear a filter to widen the view.'
                      : 'Once job cards carrying an RFR reference are imported they appear here.'}
                    action={cardViews.length ? { label: 'Clear filters', onClick: () => setFilters(EMPTY_RFR_FILTERS) } : null}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.08))' }}>
                          {['RFR', 'Period', 'Raised by', 'Raised on', 'Job card', 'Asset', 'Site', 'Type', 'Card status'].map((h) => (
                            <th key={h} className="text-left px-3 py-2 text-xs font-medium whitespace-nowrap"
                              style={{ color: 'var(--text-secondary)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cardsPager.pageRows.map((r) => (
                          <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.05))' }}>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{r.rfr_no || 'N/A'}</td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-dim)' }}>{r.rfr_period || 'N/A'}</td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{r.raised_by || 'Not recorded'}</td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{r.raised_at || 'Not recorded'}</td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{r.work_order_no || 'N/A'}</td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{r.asset_no || 'N/A'}</td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{r.site || 'Not recorded'}</td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{r.work_type || 'N/A'}</td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{r.status || 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <TablePagination {...cardsPager} />
                  </div>
                )}
              </div>

              <div className="card p-4">
                <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Where requests come from</h3>
                {bySiteCards.length ? (
                  <div className="space-y-1.5">
                    {bySiteCards.map((g, i) => {
                      const max = bySiteCards[0].count || 1
                      return (
                        <div key={g.label} className="flex items-center gap-3">
                          <span className="text-xs w-40 truncate" style={{ color: 'var(--text-secondary)' }}>{g.label}</span>
                          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--panel-2, rgba(255,255,255,0.06))' }}>
                            <div className="h-full rounded-full" style={{ width: `${(g.count / max) * 100}%`, background: colorAt(i) }} />
                          </div>
                          <span className="text-xs w-14 text-right" style={{ color: 'var(--text-primary)' }}>{g.count}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Nothing to show in this view.</p>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Tab 3: analytics ──────────────────────────────────────────────── */}
      {tab === 'analytics' && (
        <>
          {notProvisioned ? (
            <EmptyState
              icon={TrendingUp}
              title="Nothing to analyse yet"
              description="These charts describe the live request queue, which is not set up in this workspace yet. The RFR references already on job cards are on the previous tab."
            />
          ) : !filteredQueue.length ? (
            <EmptyState
              icon={TrendingUp}
              title="No requests to analyse"
              description="Once requests are raised, the funnel, the time to a job card and the fault mix appear here."
            />
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="card p-4">
                  <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Conversion funnel</h3>
                  <p className="text-[11px] mb-3" style={{ color: 'var(--text-dim)' }}>
                    A converted request was necessarily acknowledged, so the middle stage counts it even when nobody stamped the acknowledgement.
                  </p>
                  <div className="h-64"><Bar data={funnelData} options={chartOpts({ indexAxis: 'y' })} /></div>
                  <div className="mt-3 space-y-1">
                    {funnel.map((s) => (
                      <div key={s.key} className="flex items-center justify-between text-xs">
                        <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {s.count}
                          {s.pct === null ? '' : ` (${s.pct}%)`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card p-4">
                  <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>How long until a job card</h3>
                  <p className="text-[11px] mb-3" style={{ color: 'var(--text-dim)' }}>
                    {convertBands.unconverted
                      ? `${convertBands.unconverted} request${convertBands.unconverted === 1 ? '' : 's'} never converted and are excluded rather than counted as a long wait.`
                      : 'Every request in this view converted.'}
                  </p>
                  <div className="h-64"><Bar data={bandData} options={chartOpts()} /></div>
                </div>

                <div className="card p-4">
                  <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>What is being reported</h3>
                  {byFault.length ? (
                    <div className="h-64"><Doughnut data={faultData} options={chartOpts(legendOpts)} /></div>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Nothing to chart in this view.</p>
                  )}
                </div>

                <div className="card p-4">
                  <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Requests by site</h3>
                  {bySiteQueue.length ? (
                    <div className="h-64"><Bar data={siteData} options={chartOpts()} /></div>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Nothing to chart in this view.</p>
                  )}
                </div>
              </div>

              <div className="card p-4">
                <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Raised and converted, by month</h3>
                <div className="h-64"><Line data={trendData} options={chartOpts(legendOpts)} /></div>
                {trend.anchor && (
                  <p className="text-[11px] mt-2" style={{ color: 'var(--text-dim)' }}>
                    Twelve months ending {trend.anchor}
                    {trend.anchoredToData
                      ? ', the newest month with data rather than the current month.'
                      : '.'}
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Drawer: one request ───────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setOpen(null)}>
          <div className="w-full max-w-xl h-full overflow-y-auto p-5 space-y-4"
            style={{ background: 'var(--surface, #0b1220)' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {open.rfr_no || 'Repair request'}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <StatusPill status={open.status} />
                  <PriorityPill priority={open.priority} />
                </div>
              </div>
              <button onClick={() => setOpen(null)} className="btn-secondary text-xs">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Asset', open.asset_no],
                ['Plate', open.plate_no],
                ['Description', open.asset_description],
                ['Site', open.site],
                ['Fault', open.fault_category],
                ['Raised by', open.reported_by_name],
                ['Raised on', dayKey(open.reported_at)],
                ['Waiting', hours(rfrAgeHours(open, now))],
                ['Odometer', open.odometer],
                ['Hour meter', open.engine_hours],
                ['Time to job card', hours(hoursToConvert(open))],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{label}</div>
                  <div style={{ color: 'var(--text-primary)' }}>
                    {value === null || value === undefined || value === '' ? 'Not recorded' : String(value)}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[11px] mb-1" style={{ color: 'var(--text-dim)' }}>Reported fault</div>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                {open.description || 'Not recorded'}
              </p>
            </div>

            {open.rejected_reason && (
              <div className="rounded-lg px-3 py-2 text-sm"
                style={{ background: TONE.danger.bg, border: `1px solid ${TONE.danger.border}`, color: TONE.danger.text }}>
                Rejected: {open.rejected_reason}
              </div>
            )}

            {open.work_order_no && (
              <div className="rounded-lg px-3 py-2 text-sm flex items-center gap-2"
                style={{ background: TONE.good.bg, border: `1px solid ${TONE.good.border}`, color: TONE.good.text }}>
                <Link2 className="w-4 h-4" />
                Converted to job card {open.work_order_no}
              </div>
            )}

            {Array.isArray(open.photos) && open.photos.length > 0 && (
              <div>
                <div className="text-[11px] mb-1 flex items-center gap-1" style={{ color: 'var(--text-dim)' }}>
                  <Camera className="w-3 h-3" /> Photographs
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {open.photos.map((p, i) => {
                    const src = safeImageSrc(typeof p === 'string' ? p : p?.url || p?.uri)
                    if (!src) return null
                    return (
                      <img key={i} src={src} alt={`Request photograph ${i + 1}`}
                        className="w-full h-24 object-cover rounded-lg border"
                        style={{ borderColor: 'var(--border-subtle, rgba(255,255,255,0.08))' }} />
                    )
                  })}
                </div>
              </div>
            )}

            {canWrite && (
              <div className="flex flex-wrap gap-2 pt-2">
                {nextRfrStatuses(open.status).includes('acknowledged') && (
                  <button disabled={busy} onClick={() => move(open, 'acknowledged')}
                    className="btn-secondary text-sm inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Acknowledge
                  </button>
                )}
                {nextRfrStatuses(open.status).includes('converted') && (
                  <button disabled={busy}
                    onClick={() => { setFormError(''); setConverting({ row: open, workOrderNo: '' }) }}
                    className="btn-primary text-sm inline-flex items-center gap-1.5">
                    <ArrowRight className="w-4 h-4" /> Convert to job card
                  </button>
                )}
                {nextRfrStatuses(open.status).includes('rejected') && (
                  <button disabled={busy} onClick={() => setRejecting({ row: open, reason: '' })}
                    className="btn-secondary text-sm inline-flex items-center gap-1.5">
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                )}
                {nextRfrStatuses(open.status).includes('cancelled') && (
                  <button disabled={busy} onClick={() => move(open, 'cancelled')}
                    className="btn-secondary text-sm inline-flex items-center gap-1.5">
                    <Ban className="w-4 h-4" /> Cancel
                  </button>
                )}
                {!nextRfrStatuses(open.status).length && (
                  <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
                    This request is closed. Its job card carries the work from here.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Reject, with a reason ─────────────────────────────────────────── */}
      {rejecting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setRejecting(null)}>
          <div className="card p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Reject this request</h3>
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
              A rejected request whose reason nobody recorded is indistinguishable from one that was lost, so the reason is required.
            </p>
            <textarea rows={3} className={inputCls} value={rejecting.reason}
              placeholder="Why is this not going to a job card?"
              onChange={(e) => setRejecting((r) => ({ ...r, reason: e.target.value }))} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary text-sm" onClick={() => setRejecting(null)}>Cancel</button>
              <button className="btn-primary text-sm" disabled={busy || !rejecting.reason.trim()}
                onClick={() => move(rejecting.row, 'rejected', rejecting.reason.trim())}>
                Reject request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Convert to a job card ─────────────────────────────────────────── */}
      {converting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setConverting(null)}>
          <div className="card p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Convert to a job card</h3>
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
              The request and the card are stamped together, so the same job can never be open in both places. Leave the number blank to let the system mint one.
            </p>
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Job card number (optional)</span>
              <input className={`${inputCls} mt-1`} value={converting.workOrderNo}
                placeholder="Leave blank to generate"
                onChange={(e) => setConverting((c) => ({ ...c, workOrderNo: e.target.value }))} />
            </label>
            {formError && <p className="text-sm" style={{ color: TONE.danger.text }}>{formError}</p>}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary text-sm" onClick={() => setConverting(null)}>Cancel</button>
              <button className="btn-primary text-sm" disabled={busy} onClick={doConvert}>Convert</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Raise a request ───────────────────────────────────────────────── */}
      {form && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setForm(null)}>
          <form onSubmit={submitForm} className="card p-5 w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Raise a repair request</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>RFR number</span>
                <input className={`${inputCls} mt-1`} value={form.rfr_no}
                  placeholder="Generated when available"
                  onChange={(e) => setForm((f) => ({ ...f, rfr_no: e.target.value }))} />
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Asset code</span>
                <input className={`${inputCls} mt-1`} value={form.asset_no} required placeholder="TM514"
                  onChange={(e) => setForm((f) => ({ ...f, asset_no: e.target.value }))} />
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Plate</span>
                <input className={`${inputCls} mt-1`} value={form.plate_no}
                  onChange={(e) => setForm((f) => ({ ...f, plate_no: e.target.value }))} />
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Site</span>
                <input className={`${inputCls} mt-1`} value={form.site} list="rfr-site-options"
                  onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} />
                <datalist id="rfr-site-options">
                  {siteOptions.map((s) => <option key={s} value={s} />)}
                </datalist>
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Fault</span>
                <select className={`${inputCls} mt-1`} value={form.fault_category}
                  onChange={(e) => setForm((f) => ({ ...f, fault_category: e.target.value }))}>
                  <option value="">Not categorised</option>
                  {RFR_FAULT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Priority</span>
                <select className={`${inputCls} mt-1`} value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                  {RFR_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Odometer</span>
                <input type="number" className={`${inputCls} mt-1`} value={form.odometer}
                  onChange={(e) => setForm((f) => ({ ...f, odometer: e.target.value }))} />
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Hour meter</span>
                <input type="number" className={`${inputCls} mt-1`} value={form.engine_hours}
                  onChange={(e) => setForm((f) => ({ ...f, engine_hours: e.target.value }))} />
              </label>
              <label className="block md:col-span-2">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Raised by</span>
                <input className={`${inputCls} mt-1`} value={form.reported_by_name}
                  onChange={(e) => setForm((f) => ({ ...f, reported_by_name: e.target.value }))} />
              </label>
              <label className="block md:col-span-2">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>What is wrong</span>
                <textarea rows={3} className={`${inputCls} mt-1`} value={form.description} required
                  placeholder="Describe the fault the operator reported"
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </label>
            </div>
            {formError && <p className="text-sm" style={{ color: TONE.danger.text }}>{formError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn-primary text-sm" disabled={busy}>Raise request</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
