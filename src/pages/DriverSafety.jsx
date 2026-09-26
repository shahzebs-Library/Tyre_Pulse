/**
 * DriverSafety (route /driver-safety) - Driver Safety Events. Captures
 * telematics driver-behaviour events (harsh braking / acceleration / cornering,
 * speeding, overspeed, idling, fatigue) per asset and driver, then scores each
 * driver on risk. Driver conduct drives tyre wear, fuel burn and accident
 * exposure, so every event is org-isolated and country-scoped.
 *
 * Runs on the `driver_safety_events` table (V170). The scoring maths lives in
 * `src/lib/driverSafety.js`; page-level shaping (filters, trip utilisation,
 * composite band merge, KPI + export shaping) lives in the pure
 * `src/lib/driverSafetyAnalytics.js`. Every figure is from real rows: no
 * synthetic trend, no invented utilisation, and a failed read is shown as a
 * failure with Retry, never as an empty register.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import {
  ShieldAlert, ShieldCheck, Users, Gauge, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, ListChecks, Award,
  Wrench, GraduationCap, TrendingUp, Activity, RefreshCw, Percent,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDriverSafetyEvents, createDriverSafetyEvent, updateDriverSafetyEvent,
  deleteDriverSafetyEvent, listDriverTyreRecords, listDriverTrips,
} from '../lib/api/driverSafety'
import {
  summariseSafety, driverScorecard, byEventType,
  weightedDriverScorecard, driverTyreCorrelation,
  coachingQueue, weeklyEventTrend,
} from '../lib/driverSafety'
import {
  EVENT_TYPES, EVENT_TYPE_LABEL, SEVERITIES,
  filterEventsBase, countryOptionsFor, bandScorecard, safetyKpiValues,
  eventExportRows, correlationExportRows, scorecardExportRows,
} from '../lib/driverSafetyAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { colorAt, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  Title, Tooltip, Legend, Filler,
)

const TABS = [
  { key: 'events', label: 'Event log', icon: ListChecks },
  { key: 'scorecards', label: 'Scorecards', icon: Award },
  { key: 'correlation', label: 'Tyre correlation', icon: Wrench },
]

const GRADE_TONE = {
  'A+': 'text-green-400 bg-green-900/20 border-green-800/50',
  A: 'text-green-400 bg-green-900/20 border-green-800/50',
  B: 'text-sky-400 bg-sky-900/20 border-sky-800/50',
  C: 'text-amber-400 bg-amber-900/20 border-amber-800/50',
  D: 'text-orange-400 bg-orange-900/20 border-orange-800/50',
  F: 'text-red-400 bg-red-900/20 border-red-800/50',
}
const BAND_TONE = {
  good: 'text-green-400 bg-green-900/20 border-green-800/50',
  watch: 'text-amber-400 bg-amber-900/20 border-amber-800/50',
  coach: 'text-red-400 bg-red-900/20 border-red-800/50',
  top_performer: 'text-green-400 bg-green-900/20 border-green-800/50',
  steady: 'text-sky-400 bg-sky-900/20 border-sky-800/50',
  coaching: 'text-amber-400 bg-amber-900/20 border-amber-800/50',
  risk: 'text-red-400 bg-red-900/20 border-red-800/50',
  inactive: 'text-[var(--text-muted)] bg-[var(--input-bg)] border-[var(--input-border)]',
  unknown: 'text-[var(--text-muted)] bg-[var(--input-bg)] border-[var(--input-border)]',
}
const BAND_LABEL = {
  good: 'Good', watch: 'Watch', coach: 'Coach',
  top_performer: 'Top performer', steady: 'Steady', coaching: 'Coaching',
  risk: 'Safety risk', inactive: 'Inactive', unknown: 'No activity',
}
const CATEGORY_LABEL = {
  harsh_brake: 'Harsh braking', harsh_accel: 'Harsh acceleration',
  harsh_corner: 'Harsh cornering', speeding: 'Speeding', overspeed: 'Overspeed',
  idling: 'Excessive idling', fatigue: 'Fatigue', other: 'Other',
}

const pct = (v) => (v == null ? 'N/A' : `${Math.round(v * 1000) / 10}%`)
const kmFmt = (v) => (v == null || !Number.isFinite(v) ? 'N/A' : `${Math.round(v).toLocaleString()} km`)
const num = (v) => (v == null || v === '' ? 'N/A' : Number(v).toLocaleString())
const kpiText = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())

const EMPTY_FORM = {
  asset_no: '', driver_name: '', event_type: '', severity: '', event_at: '',
  location: '', speed_kmh: '', speed_limit_kmh: '', g_force: '', penalty_points: '',
  notes: '',
}

const SEVERITY_TONE = {
  high: 'text-red-400 bg-red-900/20 border border-red-800/50',
  medium: 'text-amber-400 bg-amber-900/20 border border-amber-800/50',
  low: 'text-green-400 bg-green-900/20 border border-green-800/50',
}

const EVENT_EXPORT_COLS = ['asset_no', 'driver_name', 'event_type', 'severity', 'event_at', 'location', 'speed_kmh', 'speed_limit_kmh', 'g_force', 'penalty_points', 'notes']
const EVENT_EXPORT_HEADERS = ['Asset', 'Driver', 'Event type', 'Severity', 'Event at', 'Location', 'Speed (km/h)', 'Speed limit', 'G-force', 'Penalty points', 'Notes']
const EVENT_PDF_COLS = EVENT_EXPORT_COLS.map((k, i) => ({ key: k, header: EVENT_EXPORT_HEADERS[i] }))

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

function scoreTone(score) {
  if (score >= 85) return 'text-green-400'
  if (score >= 60) return 'text-amber-400'
  return 'text-red-400'
}

/** A settled side-read: rows on success, null + message on failure. */
function settled(result, fallbackMsg) {
  if (result.status === 'fulfilled') return { rows: Array.isArray(result.value) ? result.value : [], error: '' }
  return { rows: null, error: toUserMessage(result.reason, fallbackMsg) }
}

function SectionHeader({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[var(--input-border)]">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
        <Icon size={15} aria-hidden="true" /> {title}
      </h3>
      <div className="flex items-center gap-2">
        {hint && <span className="text-xs text-[var(--text-muted)]">{hint}</span>}
        {action}
      </div>
    </div>
  )
}

function ErrorPanel({ title, message, onRetry }) {
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 px-4 py-4">
      <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-[200px]">
        <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
          <RefreshCw size={14} aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  )
}

export default function DriverSafety() {
  const { activeCountry } = useSettings()
  const [tab, setTab] = useState('events')
  const [rows, setRows] = useState(null)
  const [tyreRecords, setTyreRecords] = useState(null)
  const [trips, setTrips] = useState(null)
  const [error, setError] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [tyreError, setTyreError] = useState('')
  const [tripError, setTripError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [countryFilter, setCountryFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setLoadFailed(false); setNotProvisioned(false)
    setTyreError(''); setTripError('')
    // Events are the primary source; tyre_records + trips enrich the Scorecards
    // and Tyre-correlation tabs. Each side-read is settled independently so a
    // failure there never blocks the event log, AND is reported as a failure
    // instead of silently reading as "no data".
    const [ev, ty, tr] = await Promise.allSettled([
      listDriverSafetyEvents({ country: activeCountry }),
      listDriverTyreRecords({ country: activeCountry }),
      listDriverTrips({ country: activeCountry }),
    ])
    if (ev.status === 'fulfilled') {
      setRows(Array.isArray(ev.value) ? ev.value : [])
      setUpdatedAt(new Date())
    } else if (isMissingRelation(ev.reason)) {
      setNotProvisioned(true); setRows([])
    } else {
      setError(toUserMessage(ev.reason, 'Could not load driver safety events.'))
      setLoadFailed(true); setRows([])
    }
    const tyres = settled(ty, 'Could not load tyre records for the correlation.')
    setTyreRecords(tyres.rows); setTyreError(tyres.error)
    const trps = settled(tr, 'Could not load trips, so utilisation is unavailable.')
    setTrips(trps.rows); setTripError(trps.error)
    setRefreshing(false)
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  /**
   * THE ROWS EVERY FILTER EXCEPT THE EVENT-TYPE ONE LEAVES.
   * The "Events by type" breakdown holds its OWN dimension out, or it collapses
   * to a single chip the moment a type is picked.
   */
  const filteredBase = useMemo(
    () => filterEventsBase(rows || [], { country: countryFilter, severity: severityFilter, search }),
    [rows, countryFilter, severityFilter, search],
  )

  // The event log, and the population every KPI/scorecard/trend is computed over.
  const filtered = useMemo(
    () => (typeFilter ? filteredBase.filter((r) => r.event_type === typeFilter) : filteredBase),
    [filteredBase, typeFilter],
  )

  const scopeActive = !!(countryFilter || typeFilter || severityFilter || search.trim())

  const summary = useMemo(() => summariseSafety(filtered), [filtered])
  const scorecard = useMemo(() => driverScorecard(filtered), [filtered])
  const eventTypes = useMemo(() => byEventType(filteredBase), [filteredBase])

  const weighted = useMemo(() => weightedDriverScorecard(filtered), [filtered])
  const correlation = useMemo(() => driverTyreCorrelation(tyreRecords || []), [tyreRecords])
  const trend = useMemo(() => weeklyEventTrend(filtered), [filtered])
  const bandedScorecard = useMemo(() => bandScorecard(weighted, trips || []), [weighted, trips])
  const coaching = useMemo(() => coachingQueue(weighted || []), [weighted])
  const countryOptions = useMemo(() => countryOptionsFor(rows || []), [rows])

  const loaded = rows !== null && !loadFailed && !notProvisioned
  const kv = safetyKpiValues(summary, { loaded, coachingCount: loaded ? coaching.length : null })

  const kpis = [
    { label: 'Events logged', value: kpiText(kv.events), icon: ShieldAlert, tone: 'text-[var(--text-primary)]' },
    { label: 'High severity', value: kpiText(kv.high), icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'High severity share', value: pct(kv.highShare), icon: Percent, tone: 'text-amber-400' },
    { label: 'Drivers tracked', value: kpiText(kv.drivers), icon: Users, tone: 'text-sky-400' },
    { label: 'Penalty points', value: kpiText(kv.penalty), icon: Gauge, tone: 'text-amber-400' },
    { label: 'Drivers to coach', value: kpiText(kv.coaching), icon: GraduationCap, tone: 'text-[var(--text-primary)]' },
  ]

  const exportRows = useMemo(() => eventExportRows(filtered), [filtered])
  const fileBase = reportFileName('Driver Safety Events')

  const runExport = async (fn) => {
    try { await fn() } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      event_type: r.event_type || '', severity: r.severity || '',
      event_at: r.event_at ? new Date(r.event_at).toISOString().slice(0, 16) : '',
      location: r.location || '', speed_kmh: r.speed_kmh ?? '',
      speed_limit_kmh: r.speed_limit_kmh ?? '', g_force: r.g_force ?? '',
      penalty_points: r.penalty_points ?? '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const closeDelete = () => { if (!deleting) setConfirmDelete(null) }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateDriverSafetyEvent(editing.id, payload)
      else await createDriverSafetyEvent(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the event.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteDriverSafetyEvent(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the event.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setCountryFilter(''); setTypeFilter(''); setSeverityFilter(''); setSearch('') }
  const hasFilters = countryFilter || typeFilter || severityFilter || search

  // ── Table columns ────────────────────────────────────────────────────────
  const riskColumns = useMemo(() => [
    { id: 'driver_name', header: 'Driver', accessorFn: (d) => d.driver_name,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.driver_name}</span> },
    { id: 'events', header: 'Events', accessorFn: (d) => d.events, meta: { align: 'right' } },
    { id: 'penaltyPoints', header: 'Penalty points', accessorFn: (d) => Math.round(d.penaltyPoints), meta: { align: 'right' },
      cell: ({ row }) => Math.round(row.original.penaltyPoints).toLocaleString() },
    { id: 'safetyScore', header: 'Safety score', accessorFn: (d) => Math.round(d.safetyScore),
      cell: ({ row }) => {
        const s = row.original.safetyScore
        return (
          <div className="flex items-center gap-2">
            <span className={`font-bold ${scoreTone(s)}`}>{Math.round(s)}</span>
            <div className="h-1.5 w-24 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
              <div className={`h-full ${s >= 85 ? 'bg-green-500' : s >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.max(4, s)}%` }} />
            </div>
          </div>
        )
      } },
  ], [])

  const eventColumns = useMemo(() => [
    { id: 'driver_name', header: 'Driver', accessorFn: (r) => r.driver_name || '',
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.driver_name || 'N/A'}</span> },
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => r.asset_no || '', cell: ({ row }) => row.original.asset_no || 'N/A' },
    { id: 'event_type', header: 'Event', accessorFn: (r) => EVENT_TYPE_LABEL[r.event_type] || r.event_type || '',
      cell: ({ row }) => <span className="whitespace-nowrap">{EVENT_TYPE_LABEL[row.original.event_type] || row.original.event_type || 'N/A'}</span> },
    { id: 'severity', header: 'Severity', accessorFn: (r) => r.severity || '',
      cell: ({ row }) => {
        const s = row.original.severity
        return s ? (
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_TONE[s] || 'text-[var(--text-secondary)]'}`}>
            {s[0].toUpperCase() + s.slice(1)}
          </span>
        ) : 'N/A'
      } },
    { id: 'event_at', header: 'When', accessorFn: (r) => r.event_at || '',
      cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.event_at)}</span> },
    { id: 'speed', header: 'Speed', accessorFn: (r) => Number(r.speed_kmh) || 0, meta: { align: 'right', exportValue: (r) => r.speed_kmh ?? '' },
      cell: ({ row }) => {
        const r = row.original
        return <span className="whitespace-nowrap">{num(r.speed_kmh)}{r.speed_limit_kmh != null && r.speed_limit_kmh !== '' ? ` / ${num(r.speed_limit_kmh)}` : ''}</span>
      } },
    { id: 'penalty_points', header: 'Penalty', accessorFn: (r) => Number(r.penalty_points) || 0, meta: { align: 'right', exportValue: (r) => r.penalty_points ?? '' },
      cell: ({ row }) => <span className="font-semibold text-[var(--text-primary)]">{num(row.original.penalty_points)}</span> },
    { id: 'actions', header: 'Actions', enableSorting: false, enableHiding: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        const who = r.driver_name || r.asset_no || 'event'
        return (
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(r) }} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" aria-label={`Edit event for ${who}`}><Pencil size={14} aria-hidden="true" /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(r) }} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" aria-label={`Delete event for ${who}`}><Trash2 size={14} aria-hidden="true" /></button>
          </div>
        )
      } },
  ], [openEdit])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Safety Events"
        subtitle="Track harsh braking, acceleration, cornering, speeding and fatigue events per driver, and score each driver on risk. Driver conduct drives tyre wear, fuel burn and accident exposure."
        icon={ShieldAlert}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => runExport(() => exportToExcel(exportRows, EVENT_EXPORT_COLS, EVENT_EXPORT_HEADERS, fileBase))} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => runExport(() => exportToPdf(exportRows, EVENT_PDF_COLS, 'Driver Safety Events', fileBase, 'landscape'))} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <EmailPdfButton
              disabled={!filtered.length}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"
              getPdf={async () => ({
                base64: await exportToPdf(exportRows, EVENT_PDF_COLS, 'Driver Safety Events', fileBase, 'landscape', '', { returnBase64: true }),
                filename: `${fileBase}.pdf`,
                subject: 'Driver Safety',
                bodyHtml: '<p>Attached is the Driver Safety report.</p>',
              })}
            />
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> Log event
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Driver safety tracking is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V170_DRIVER_SAFETY_EVENTS.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" pad="none">
          <ErrorPanel title={loadFailed ? 'Could not load driver safety events.' : 'Something went wrong.'} message={error} onRetry={load} />
        </Card>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-[var(--gap-grid)]">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <Card key={k.label}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums ${k.tone}`}>{rows === null ? 'N/A' : k.value}</p>
            </Card>
          )
        })}
      </div>
      {scopeActive && rows !== null && (
        <p className="text-xs text-[var(--text-muted)] -mt-1">
          These figures cover the {filtered.length} event{filtered.length === 1 ? '' : 's'} matching your filters, of {(rows || []).length} in total.
        </p>
      )}

      {/* Filters: they drive the KPI strip, every scorecard and the event log. */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="ds-search" className="sr-only">Search events</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="ds-search" type="search" className="input pl-9 w-full min-h-[44px]" placeholder="Search asset, driver, location, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {countryOptions.length > 0 && (
            <select className="input min-h-[44px]" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select className="input min-h-[44px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Event type">
            <option value="">All event types</option>
            {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {(rows || []).length}</span>
        </div>
      </Card>

      {/* Tab bar */}
      <div role="tablist" aria-label="Driver safety views" className="flex flex-wrap items-center gap-1 border-b border-[var(--input-border)]">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`ds-tab-${t.key}`}
              aria-selected={active}
              aria-controls={`ds-panel-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                active
                  ? 'border-[var(--accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon size={14} aria-hidden="true" /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'scorecards' && (
        <div role="tabpanel" id="ds-panel-scorecards" aria-labelledby="ds-tab-scorecards">
          <ScorecardsTab
            loading={rows === null}
            failed={loadFailed}
            onRetry={load}
            banded={bandedScorecard}
            coaching={coaching}
            trend={trend.fleet}
            tripError={tripError}
            onExportError={(e) => setError(toUserMessage(e, 'Could not export. Try again.'))}
          />
        </div>
      )}

      {tab === 'correlation' && (
        <div role="tabpanel" id="ds-panel-correlation" aria-labelledby="ds-tab-correlation">
          <CorrelationTab
            loading={tyreRecords === null && !tyreError}
            error={tyreError}
            onRetry={load}
            correlation={correlation}
            onExportError={(e) => setError(toUserMessage(e, 'Could not export. Try again.'))}
          />
        </div>
      )}

      {tab === 'events' && (
      <div role="tabpanel" id="ds-panel-events" aria-labelledby="ds-tab-events" className="space-y-6">
      <Card pad="none">
        <SectionHeader icon={ShieldCheck} title="Driver risk scorecard" hint="Worst first. Lower score means higher risk." />
        <div className="p-3">
          <EnterpriseTable
            columns={riskColumns}
            data={scorecard.slice(0, 15)}
            getRowId={(d) => d.driver_name}
            loading={rows === null}
            error={loadFailed ? error : null}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No driver events match the current filters."
          />
        </div>
      </Card>

      {/* Event-type distribution: holds its OWN dimension out of the filter set. */}
      <Card>
        <CardHeader icon={Filter} title="Events by type" />
        {rows === null ? (
          <div className="h-12 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : loadFailed ? (
          <p className="text-sm text-[var(--text-muted)]">Not available: the events could not be loaded.</p>
        ) : eventTypes.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No events logged yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {eventTypes.map((t) => (
              <button
                type="button"
                key={t.type}
                onClick={() => setTypeFilter(typeFilter === t.type ? '' : t.type)}
                aria-pressed={typeFilter === t.type}
                className={`rounded-lg border px-3 py-2 min-h-[44px] text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${typeFilter === t.type ? 'border-[var(--accent)] bg-[var(--input-bg)]' : 'border-[var(--input-border)] bg-[var(--input-bg)]/40 hover:border-[var(--accent)]'}`}
              >
                <span className="block text-xs text-[var(--text-muted)]">{EVENT_TYPE_LABEL[t.type] || t.type}</span>
                <span className="block text-lg font-semibold text-[var(--text-primary)] tabular-nums">{t.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card pad="none">
        <SectionHeader icon={ListChecks} title="Event log" hint={`${filtered.length.toLocaleString()} event${filtered.length === 1 ? '' : 's'}`} />
        <div className="p-3">
          <EnterpriseTable
            columns={eventColumns}
            data={filtered}
            getRowId={(r) => String(r.id)}
            loading={rows === null}
            error={loadFailed ? error : null}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            viewKey="driver-safety-events"
            emptyIcon={<Filter size={22} className="opacity-60" aria-hidden="true" />}
            emptyMessage={(rows || []).length === 0 && !notProvisioned ? 'No events logged yet. Log your first event.' : 'No events match these filters.'}
          />
        </div>
      </Card>
      </div>
      )}

      {/* Create / Edit modal. `size="lg"` because the speed / limit / g-force /
          penalty row is a 4-column grid that a narrower panel would crush. The
          submit button stays INSIDE the <form> rather than moving to Modal's
          `footer`: a footer button would need a `form="..."` association to keep
          submitting, which is a behaviour change, not a migration. */}
      {showModal && (
        <Modal
          open
          onClose={closeModal}
          size="lg"
          title={editing ? 'Edit safety event' : 'Log driver safety event'}
        >
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="ds-f-asset_no">Asset number</label>
                  <input id="ds-f-asset_no" className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="ds-f-driver_name">Driver</label>
                  <input id="ds-f-driver_name" className="input w-full" placeholder="e.g. Ahmed Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="ds-f-event_type">Event type</label>
                  <select id="ds-f-event_type" className="input w-full" value={form.event_type} onChange={(e) => set('event_type', e.target.value)}>
                    <option value="">Select</option>
                    {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="ds-f-severity">Severity</label>
                  <select id="ds-f-severity" className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                    <option value="">Select</option>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="ds-f-event_at">Event time</label>
                  <input id="ds-f-event_at" className="input w-full" type="datetime-local" value={form.event_at} onChange={(e) => set('event_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
                <div>
                  <label className="label" htmlFor="ds-f-location">Location (optional)</label>
                  <input id="ds-f-location" className="input w-full" placeholder="e.g. Riyadh to Dammam Hwy km 210" value={form.location} maxLength={300} onChange={(e) => set('location', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="label" htmlFor="ds-f-speed_kmh">Speed (km/h)</label>
                  <input id="ds-f-speed_kmh" className="input w-full" type="number" step="0.1" min="0" placeholder="98" value={form.speed_kmh} onChange={(e) => set('speed_kmh', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="ds-f-speed_limit_kmh">Speed limit</label>
                  <input id="ds-f-speed_limit_kmh" className="input w-full" type="number" step="0.1" min="0" placeholder="80" value={form.speed_limit_kmh} onChange={(e) => set('speed_limit_kmh', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="ds-f-g_force">G-force</label>
                  <input id="ds-f-g_force" className="input w-full" type="number" step="0.01" min="0" placeholder="0.45" value={form.g_force} onChange={(e) => set('g_force', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="ds-f-penalty_points">Penalty points</label>
                  <input id="ds-f-penalty_points" className="input w-full" type="number" step="1" min="0" placeholder="5" value={form.penalty_points} onChange={(e) => set('penalty_points', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="ds-f-notes">Notes (optional)</label>
                <textarea id="ds-f-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. sudden lane change, wet road" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving...' : editing ? 'Save changes' : 'Log event'}
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
          title="Delete this event?"
          footer={
            <>
              <button onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
            <p className="text-sm text-[var(--text-muted)]">
              {confirmDelete.driver_name || 'Event'} · {EVENT_TYPE_LABEL[confirmDelete.event_type] || confirmDelete.event_type || 'N/A'} · {fmtDateTime(confirmDelete.event_at)}. This cannot be undone.
            </p>
          </div>
        </Modal>
      )}

    </div>
  )
}

// ── Reusable pills ────────────────────────────────────────────────────────────

function GradePill({ grade }) {
  if (!grade) return <span className="text-[var(--text-muted)]">N/A</span>
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold border ${GRADE_TONE[grade] || BAND_TONE.unknown}`}>
      {grade}
    </span>
  )
}

function BandPill({ band }) {
  if (!band) return <span className="text-[var(--text-muted)]">N/A</span>
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${BAND_TONE[band] || BAND_TONE.unknown}`}>
      {BAND_LABEL[band] || band}
    </span>
  )
}

// ── Scorecards tab: weighted score + grade/band + weekly trend + coaching ────

const SCORECARD_EXPORT_COLS = ['driver_name', 'events', 'riskIndex', 'score', 'grade', 'band', 'composite', 'km', 'trips', 'topIssue']
const SCORECARD_EXPORT_HEADERS = ['Driver', 'Events', 'Risk index', 'Score', 'Grade', 'Band', 'Composite band', 'Trip km', 'Trips', 'Top issue']

function ScorecardsTab({ loading, failed, onRetry, banded, coaching, trend, tripError, onExportError }) {
  // Real, dated events only: weeklyEventTrend buckets actual event_at values.
  const chartData = useMemo(() => ({
    labels: (trend || []).map((w) => w.week),
    datasets: [
      {
        label: 'Events per week',
        data: (trend || []).map((w) => w.events),
        borderColor: colorAt(0),
        backgroundColor: withAlpha(colorAt(0), 0.15),
        fill: true,
        tension: 0.3,
        yAxisID: 'y',
      },
      {
        // Semantic: high severity stays red so the line reads as risk.
        label: 'High severity per week',
        data: (trend || []).map((w) => w.highSeverity),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.12)',
        borderDash: [6, 4],
        fill: true,
        tension: 0.3,
        yAxisID: 'y',
      },
    ],
  }), [trend])

  const chartOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: 'var(--text-muted)', boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: 'var(--text-muted)', autoSkip: true, maxRotation: 0 }, grid: { color: 'var(--panel-2)' } },
      y: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
    },
  }), [])

  const columns = useMemo(() => [
    { id: 'driver_name', header: 'Driver', accessorFn: (d) => d.driver_name,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.driver_name}</span> },
    { id: 'events', header: 'Events', accessorFn: (d) => d.events, meta: { align: 'right' } },
    { id: 'riskIndex', header: 'Risk index', accessorFn: (d) => d.riskIndex ?? 0, meta: { align: 'right' },
      cell: ({ row }) => (row.original.riskIndex == null ? 'N/A' : row.original.riskIndex.toLocaleString(undefined, { maximumFractionDigits: 1 })) },
    { id: 'score', header: 'Score', accessorFn: (d) => d.score ?? 0,
      cell: ({ row }) => {
        const s = row.original.score
        if (s == null) return 'N/A'
        return <span className={`font-bold ${s >= 85 ? 'text-green-400' : s >= 70 ? 'text-amber-400' : 'text-red-400'}`}>{s}</span>
      } },
    { id: 'grade', header: 'Grade', accessorFn: (d) => d.grade || '', cell: ({ row }) => <GradePill grade={row.original.grade} /> },
    { id: 'band', header: 'Band', accessorFn: (d) => d.band || '', cell: ({ row }) => <BandPill band={row.original.band} /> },
    { id: 'composite', header: 'Composite', accessorFn: (d) => d.composite?.band || '', cell: ({ row }) => <BandPill band={row.original.composite?.band} /> },
    { id: 'km', header: 'Trip km', accessorFn: (d) => d.km || 0, meta: { align: 'right' },
      cell: ({ row }) => (row.original.km > 0 ? kmFmt(row.original.km) : 'N/A') },
    { id: 'topIssue', header: 'Top issue', accessorFn: (d) => CATEGORY_LABEL[d.weakestCategory] || d.weakestCategory || '',
      cell: ({ row }) => <span className="whitespace-nowrap">{CATEGORY_LABEL[row.original.weakestCategory] || row.original.weakestCategory || 'N/A'}</span> },
  ], [])

  const exportScorecard = async () => {
    try {
      await exportToExcel(scorecardExportRows(banded, CATEGORY_LABEL), SCORECARD_EXPORT_COLS, SCORECARD_EXPORT_HEADERS, reportFileName('Driver Safety Scorecard'))
    } catch (e) { onExportError?.(e) }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader icon={TrendingUp} title="Weekly event trend" />
        {loading ? (
          <div className="h-64 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : failed ? (
          <ErrorPanel title="Trend unavailable" message="The events could not be loaded." onRetry={onRetry} />
        ) : (trend || []).length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">No dated events yet. Log events with a timestamp to build the trend.</p>
        ) : (
          <div className="h-64" role="img" aria-label={`Weekly driver safety events over ${(trend || []).length} weeks, with the high severity subset.`}>
            <Line data={chartData} options={chartOpts} />
          </div>
        )}
      </Card>

      {tripError && (
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-muted)]">{tripError} Composite bands below use behaviour only.</p>
        </Card>
      )}

      <Card pad="none">
        <SectionHeader
          icon={Award}
          title="Weighted driver scorecard"
          hint="Severity and type weighting, per-category capped, worst first"
          action={(
            <button type="button" onClick={exportScorecard} disabled={!(banded || []).length} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px]">
              <FileSpreadsheet size={13} aria-hidden="true" /> Excel
            </button>
          )}
        />
        <div className="p-3">
          <EnterpriseTable
            columns={columns}
            data={banded || []}
            getRowId={(d) => d.driver_name}
            loading={loading}
            error={failed ? 'The events could not be loaded.' : null}
            onRetry={onRetry}
            enableColumnFilters={false}
            enableExport={false}
            searchPlaceholder="Search drivers"
            initialPageSize={25}
            emptyMessage="No driver events logged yet."
          />
        </div>
      </Card>

      <Card pad="none" clip>
        <SectionHeader
          icon={GraduationCap}
          title="Coaching queue"
          hint={loading || failed ? '' : `${(coaching || []).length} driver(s) below the good band`}
        />
        {loading ? (
          <div className="p-4"><div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" /></div>
        ) : failed ? (
          <ErrorPanel title="Coaching queue unavailable" message="The events could not be loaded." onRetry={onRetry} />
        ) : (coaching || []).length === 0 ? (
          <p className="px-4 py-8 text-sm text-[var(--text-muted)] text-center">Every tracked driver is in the good band. No coaching needed.</p>
        ) : (
          <ul className="divide-y divide-[var(--input-border)]/50">
            {coaching.map((c) => (
              <li key={c.driver_name} className="px-4 py-3 flex items-start gap-3">
                <div className="shrink-0 flex flex-col items-center gap-1 w-16">
                  <span className={`text-lg font-bold ${c.score >= 70 ? 'text-amber-400' : 'text-red-400'}`}>{c.score}</span>
                  <GradePill grade={c.grade} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[var(--text-primary)]">{c.driver_name}</span>
                    <span className="text-xs text-[var(--text-muted)]">Focus: {CATEGORY_LABEL[c.focus] || c.focus}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] inline-flex items-center gap-1">
                      <Activity size={11} aria-hidden="true" /> {c.suggestedSessionMin} min session
                    </span>
                  </div>
                  <p className="text-sm text-[var(--text-muted)] mt-1">{c.tip}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ── Tyre correlation tab: the Tyre-Pulse-unique driver to damage intelligence ──

const CORR_EXPORT_COLS = ['driver_name', 'tyres', 'removals', 'driverCausedRemovalRate', 'driverCpk', 'prematureRemovalRate']
const CORR_EXPORT_HEADERS = ['Driver', 'Tyres', 'Removals', 'Driver-caused removal %', 'Driver CPK', 'Premature removal %']

function rateTone(v, high) {
  if (v == null) return 'text-[var(--text-muted)]'
  if (v >= high) return 'text-red-400 font-semibold'
  if (v > 0) return 'text-amber-400'
  return 'text-green-400'
}

function CorrelationTab({ loading, error, onRetry, correlation, onExportError }) {
  const drivers = correlation?.drivers || []
  const median = correlation?.fleetMedianLifeKm

  const columns = useMemo(() => [
    { id: 'driver_name', header: 'Driver', accessorFn: (d) => d.driver_name,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.driver_name}</span> },
    { id: 'tyres', header: 'Tyres', accessorFn: (d) => d.tyres, meta: { align: 'right' } },
    { id: 'removals', header: 'Removals', accessorFn: (d) => d.removals, meta: { align: 'right' } },
    { id: 'driverCaused', header: 'Driver-caused removals', accessorFn: (d) => d.driverCausedRemovalRate ?? -1,
      cell: ({ row }) => {
        const d = row.original
        return (
          <span>
            <span className={rateTone(d.driverCausedRemovalRate, 0.3)}>{pct(d.driverCausedRemovalRate)}</span>
            {d.driverCausedRemovalRate != null && <span className="text-[var(--text-muted)] text-xs ml-1">({d.driverCausedRemovals}/{d.removals})</span>}
          </span>
        )
      } },
    { id: 'driverCpk', header: 'Driver CPK', accessorFn: (d) => d.driverCpk ?? -1, meta: { align: 'right' },
      cell: ({ row }) => (row.original.driverCpk == null ? 'N/A' : row.original.driverCpk.toLocaleString(undefined, { maximumFractionDigits: 3 })) },
    { id: 'premature', header: 'Premature removals', accessorFn: (d) => d.prematureRemovalRate ?? -1,
      cell: ({ row }) => {
        const d = row.original
        return (
          <span>
            <span className={rateTone(d.prematureRemovalRate, 0.5)}>{pct(d.prematureRemovalRate)}</span>
            {d.prematureRemovalRate != null && <span className="text-[var(--text-muted)] text-xs ml-1">({d.prematureRemovals}/{d.removals})</span>}
          </span>
        )
      } },
  ], [])

  const exportCorrelation = async () => {
    try {
      await exportToExcel(correlationExportRows(drivers), CORR_EXPORT_COLS, CORR_EXPORT_HEADERS, reportFileName('Driver Tyre Correlation'))
    } catch (e) { onExportError?.(e) }
  }

  return (
    <div className="space-y-6">
      <Card tone="info" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
        <Wrench size={18} className="text-sky-400 mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-[var(--text-primary)] font-medium">Driver to tyre-damage correlation</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Joins each driver&apos;s tyre records to surface driver-attributable damage (impact, cut, kerb, under-inflation, run-flat, overload), their real tyre CPK, and how often their tyres come off below the fleet median life
            {median != null ? <> (<span className="font-mono text-[var(--text-primary)]">{kmFmt(median)}</span>)</> : null}. Drivers with no tyre history show N/A, never a guessed rate.
          </p>
        </div>
      </Card>

      <Card pad="none">
        <SectionHeader
          icon={Wrench}
          title="Per-driver tyre intelligence"
          action={(
            <button type="button" onClick={exportCorrelation} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px]" disabled={!drivers.length || !!error}>
              <FileSpreadsheet size={13} aria-hidden="true" /> Excel
            </button>
          )}
        />
        <div className="p-3">
          <EnterpriseTable
            columns={columns}
            data={error ? [] : drivers}
            getRowId={(d) => d.driver_name}
            loading={loading}
            error={error || null}
            onRetry={onRetry}
            enableColumnFilters={false}
            enableExport={false}
            searchPlaceholder="Search drivers"
            initialPageSize={25}
            emptyMessage="No tyre records carry a driver name yet. Populate driver_name on tyre records to unlock this analysis."
          />
        </div>
      </Card>
    </div>
  )
}
