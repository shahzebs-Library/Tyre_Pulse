/**
 * ColdChain (route /cold-chain) - Cold-Chain Monitor. Logs refrigerated-cargo
 * temperature readings for an asset/site against a configured safe range and
 * turns them into excursion intelligence: every reading is classified in-range /
 * above-max / below-min, deviation magnitude and excursion episode duration are
 * derived from the real timestamps, and compliance is rolled up by asset, site
 * and over time. Manual entry today; the schema + service are sensor-ready for a
 * future ingest feed.
 *
 * Runs on the `cold_chain_logs` table (V143). Real data only - honest empty
 * states, never a fabricated reading. KPI tiles, temperature-trend line,
 * excursion-distribution + breaches-by-asset bars, a status doughnut, a
 * filterable/searchable/sortable register, an excursion-episode feed,
 * create/edit modal, delete confirm, Excel/PDF export and loading/error/empty
 * states throughout. Breach classification lives in the pure `coldChain.js`
 * helpers; excursion analytics in the pure `coldChainAnalytics.js` engine.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Line, Bar } from 'react-chartjs-2'
import {
  Snowflake, ThermometerSnowflake, AlertTriangle, Boxes, Search, X,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Gauge, Timer, Percent,
  ArrowUp, ArrowDown, MapPin, Activity, Clock, RefreshCw, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import SegmentedControl from '../components/ui/SegmentedControl'
import { useSettings } from '../contexts/SettingsContext'
import {
  listReadings, createReading, updateReading, deleteReading,
} from '../lib/api/coldChain'
import { probeRelation } from '../lib/api/_client'
import {
  classifyTemp, summarizeColdChain, COLD_CHAIN_STATUS_META,
} from '../lib/coldChain'
import {
  summarizeColdChainAnalytics, filterReadings, coldChainRegisterRows, episodeRows,
  formatDurationMin,
} from '../lib/coldChainAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { ACCENTS, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Filler, Tooltip, Legend,
)

// The service reads the newest N readings; say so when the window is full
// instead of presenting a partial register as the whole history.
const READ_LIMIT = 500

const STATUS_STYLES = {
  breach: 'bg-red-900/40 text-red-300 border border-red-700/50',
  warning: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  ok: 'bg-green-900/40 text-green-300 border border-green-700/50',
}
const TEMP_TONE = { breach: 'text-red-400', warning: 'text-amber-300', ok: 'text-[var(--text-primary)]' }
const KIND_TONE = { above: 'text-red-400', below: 'text-sky-300', in_range: 'text-[var(--text-muted)]', mixed: 'text-amber-300' }

// Semantic status colours (legend + tooltip always carry the text label).
const STATUS_COLOURS = { ok: ACCENTS.good, warning: ACCENTS.watch, breach: ACCENTS.risk }
const TICK = 'var(--text-muted)'
const GRID = 'var(--panel-2)'

const EMPTY_FORM = {
  asset_no: '', site: '', temperature_c: '', min_threshold_c: '', max_threshold_c: '',
  recorded_at: '', notes: '',
}

const NA = 'N/A'

function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}
function fmtDateTime(v) {
  if (!v) return NA
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? NA : d.toLocaleString()
}

function ChartSlot({ loading, empty, emptyText, children }) {
  if (loading) return <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
  if (empty) return <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4">{emptyText}</div>
  return children
}

export default function ColdChain() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [breakdown, setBreakdown] = useState('asset')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listReadings({ country: activeCountry, limit: READ_LIMIT })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      // listReadings degrades a missing table to [] without throwing, so the
      // page can never learn from the list alone that `cold_chain_logs` is
      // absent - which is why the banner below had no way to fire. Ask the
      // database, and only on a CERTAIN answer (checked && !exists). An empty
      // list on its own proves nothing: it is the ordinary "nothing logged
      // yet" case, and claiming otherwise would send someone to the database
      // for no reason.
      if (list.length === 0) {
        const { exists, checked } = await probeRelation('cold_chain_logs')
        setNotProvisioned(checked && !exists)
      }
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load cold-chain readings.'))
      setRows((prev) => prev ?? [])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Legacy KPI header counts (kept) + the deep excursion analytics engine.
  const summary = useMemo(() => summarizeColdChain(rows || []), [rows])

  const filters = useMemo(
    () => ({ asset: assetFilter, site: siteFilter, status: statusFilter, search, from: fromDate, to: toDate }),
    [assetFilter, siteFilter, statusFilter, search, fromDate, toDate],
  )

  const filtered = useMemo(() => filterReadings(rows || [], filters), [rows, filters])
  const analytics = useMemo(() => summarizeColdChainAnalytics(filtered), [filtered])
  const registerRows = useMemo(() => coldChainRegisterRows(filtered), [filtered])
  const episodes = useMemo(() => episodeRows(analytics.episodes), [analytics])
  const breakdownRows = breakdown === 'asset' ? analytics.byAsset : analytics.bySite

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )
  const siteOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )

  const loadingFirst = rows === null
  const hasData = rows != null && filtered.length > 0
  const truncated = (rows?.length || 0) >= READ_LIMIT

  // Charts --------------------------------------------------------------------
  const donutData = {
    labels: ['OK', 'Warning', 'Breach'],
    datasets: [{
      data: [analytics.ok, analytics.warning, analytics.breach],
      backgroundColor: [STATUS_COLOURS.ok, STATUS_COLOURS.warning, STATUS_COLOURS.breach],
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: TICK, boxWidth: 12 } } },
  }

  const trendData = {
    labels: analytics.trend.map((t) => t.label),
    datasets: [
      {
        label: 'Avg temp (C)', data: analytics.trend.map((t) => t.avg),
        borderColor: ACCENTS.info, backgroundColor: withAlpha(ACCENTS.info, 0.15),
        borderWidth: 2, tension: 0.3, fill: true, pointRadius: 2, spanGaps: true, yAxisID: 'y',
      },
      {
        label: 'Max', data: analytics.trend.map((t) => t.max),
        borderColor: withAlpha(ACCENTS.risk, 0.7), borderWidth: 1, borderDash: [4, 3],
        pointRadius: 0, tension: 0.3, fill: false, spanGaps: true, yAxisID: 'y',
      },
      {
        label: 'Min', data: analytics.trend.map((t) => t.min),
        borderColor: withAlpha(ACCENTS.primary, 0.7), borderWidth: 1, borderDash: [4, 3],
        pointRadius: 0, tension: 0.3, fill: false, spanGaps: true, yAxisID: 'y',
      },
      {
        label: 'Breaches', data: analytics.trend.map((t) => t.breaches),
        type: 'bar', backgroundColor: withAlpha(ACCENTS.risk, 0.45), yAxisID: 'y1',
      },
    ],
  }
  const trendOpts = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: TICK, boxWidth: 12, font: { size: 10 } } } },
    scales: {
      x: { ticks: { color: TICK, maxRotation: 0, autoSkip: true }, grid: { color: GRID } },
      y: { position: 'left', ticks: { color: TICK }, grid: { color: GRID }, title: { display: true, text: 'Temp (C)', color: TICK } },
      y1: { position: 'right', beginAtZero: true, ticks: { color: TICK, precision: 0 }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Breaches', color: TICK } },
    },
  }

  const distData = {
    labels: ['In range', 'Above max', 'Below min'],
    datasets: [{
      label: 'Readings',
      data: [analytics.distribution.in_range, analytics.distribution.above, analytics.distribution.below],
      backgroundColor: [ACCENTS.good, ACCENTS.risk, ACCENTS.info], borderWidth: 0,
    }],
  }
  const distOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: TICK }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: TICK, precision: 0 }, grid: { color: GRID } },
    },
  }

  const topBreachAssets = useMemo(() => analytics.byAsset.filter((a) => a.breaches > 0).slice(0, 8), [analytics])
  const assetBarData = {
    labels: topBreachAssets.map((a) => a.key),
    datasets: [{ label: 'Breaches', data: topBreachAssets.map((a) => a.breaches), backgroundColor: ACCENTS.risk, borderWidth: 0 }],
  }
  const assetBarOpts = {
    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { color: TICK, precision: 0 }, grid: { color: GRID } },
      y: { ticks: { color: TICK }, grid: { display: false } },
    },
  }

  // Export --------------------------------------------------------------------
  const EXPORT_COLS = ['asset_no', 'site', 'temperature_c', 'range', 'deviation', 'kindLabel', 'statusLabel', 'recorded', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Site', 'Temp (C)', 'Safe range', 'Deviation (C)', 'Direction', 'Status', 'Recorded at', 'Notes']
  const exportRows = registerRows.map((r) => ({
    ...r,
    asset_no: r.asset_no ?? '', site: r.site ?? '', temperature_c: r.temperature_c ?? '',
    deviation: r.deviation ?? '', recorded: r.recorded_at ? new Date(r.recorded_at).toLocaleString() : '',
  }))
  const fileBase = reportFileName('Cold Chain Readings', reportDateLabel())
  const exportNote = truncated ? `Newest ${READ_LIMIT} readings only` : undefined
  const doExcel = async () => {
    try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase, 'Readings') }
    catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    try {
      await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Cold-Chain Monitor', fileBase, 'landscape', '', exportNote ? { subtitleNote: exportNote } : {})
    } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // Modal ---------------------------------------------------------------------
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', site: r.site || '',
      temperature_c: r.temperature_c ?? '', min_threshold_c: r.min_threshold_c ?? '',
      max_threshold_c: r.max_threshold_c ?? '', recorded_at: toLocalInput(r.recorded_at),
      notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  // One guarded close for the delete dialog: Modal routes Escape, the backdrop
  // and its X through this, so none of them can drop the dialog mid-delete.
  const closeDelete = () => { if (!deleting) setConfirmDelete(null) }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const previewStatus = useMemo(
    () => classifyTemp(form.temperature_c, form.min_threshold_c, form.max_threshold_c),
    [form.temperature_c, form.min_threshold_c, form.max_threshold_c],
  )

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset (unit) number is required.'); return }
    if (form.temperature_c === '' || form.temperature_c == null) { setFormError('A temperature reading is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
        recorded_at: form.recorded_at ? new Date(form.recorded_at).toISOString() : null,
      }
      if (editing) await updateReading(editing.id, payload)
      else await createReading(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the reading.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteReading(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the reading.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => {
    setStatusFilter('all'); setAssetFilter(''); setSiteFilter(''); setSearch(''); setFromDate(''); setToDate('')
  }
  const hasFilters = statusFilter !== 'all' || assetFilter || siteFilter || search || fromDate || toDate

  // Table columns -------------------------------------------------------------
  const registerColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => r.asset_no ?? '', cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || NA}</span> },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site ?? '', cell: ({ row }) => row.original.site || NA },
    {
      id: 'temperature_c', header: 'Temperature', accessorFn: (r) => r.temperature_c ?? -Infinity, meta: { align: 'right' },
      cell: ({ row }) => <span className={`tabular-nums font-semibold ${TEMP_TONE[row.original.status] || ''}`}>{row.original.temperature_c == null ? NA : `${row.original.temperature_c} C`}</span>,
    },
    { id: 'range', header: 'Safe range', accessorFn: (r) => r.range, enableSorting: false },
    {
      id: 'deviation', header: 'Deviation', accessorFn: (r) => r.deviation ?? -1, meta: { align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        if (r.deviation == null) return <span className="text-[var(--text-muted)]">{NA}</span>
        return (
          <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${KIND_TONE[r.kind]}`}>
            {r.kind === 'above' ? <ArrowUp size={12} aria-hidden="true" /> : r.kind === 'below' ? <ArrowDown size={12} aria-hidden="true" /> : null}
            {r.deviation} C <span className="sr-only">{r.kindLabel}</span>
          </span>
        )
      },
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => ({ breach: 0, warning: 1, ok: 2 }[r.status] ?? 3),
      cell: ({ row }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[row.original.status] || ''}`}>{row.original.statusLabel}</span>,
    },
    { id: 'recorded_at', header: 'Recorded at', accessorFn: (r) => r.recordedMs ?? -Infinity, cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.recorded_at)}</span> },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const label = `${r.asset_no || 'reading'} at ${fmtDateTime(r.recorded_at)}`
        return (
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={() => openEdit(r.raw)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit ${label}`}><Pencil size={15} /></button>
            <button type="button" onClick={() => setConfirmDelete(r.raw)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete ${label}`}><Trash2 size={15} /></button>
          </div>
        )
      },
    },
  ], [openEdit])

  const breakdownColumns = useMemo(() => [
    { id: 'key', header: breakdown === 'asset' ? 'Asset' : 'Site', accessorFn: (r) => r.key, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.key}</span> },
    ...(breakdown === 'asset' ? [{ id: 'site', header: 'Site', accessorFn: (r) => r.site || '', cell: ({ row }) => row.original.site || NA }] : []),
    { id: 'total', header: 'Reads', accessorFn: (r) => r.total, meta: { align: 'right' } },
    { id: 'breaches', header: 'Breaches', accessorFn: (r) => r.breaches, meta: { align: 'right' }, cell: ({ row }) => <span className={`tabular-nums font-semibold ${row.original.breaches ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>{row.original.breaches}</span> },
    { id: 'warnings', header: 'Near limit', accessorFn: (r) => r.warnings, meta: { align: 'right' } },
    { id: 'maxDeviation', header: 'Max dev.', accessorFn: (r) => r.maxDeviation, meta: { align: 'right' }, cell: ({ row }) => (row.original.maxDeviation > 0 ? `${row.original.maxDeviation} C` : NA) },
    {
      id: 'compliancePct', header: 'Compliance', accessorFn: (r) => r.compliancePct ?? -1, meta: { align: 'right' },
      cell: ({ row }) => {
        const v = row.original.compliancePct
        return <span className={`tabular-nums font-semibold ${v != null && v < 90 ? 'text-amber-300' : 'text-green-400'}`}>{v == null ? NA : `${v}%`}</span>
      },
    },
  ], [breakdown])

  const episodeColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => r.asset_no, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no}</span> },
    { id: 'startAt', header: 'Started', accessorFn: (r) => r.startMs, cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.startAt)}</span> },
    { id: 'duration', header: 'Duration', accessorFn: (r) => r.durationMin ?? -1, meta: { align: 'right' }, cell: ({ row }) => row.original.duration },
    { id: 'peak', header: 'Peak dev.', accessorFn: (r) => r.peakDeviation ?? -1, meta: { align: 'right' }, cell: ({ row }) => (row.original.peakDeviation == null ? NA : `${row.original.peakDeviation} C`) },
    { id: 'kind', header: 'Direction', accessorFn: (r) => r.kindLabel },
    {
      id: 'state', header: 'State', accessorFn: (r) => r.state,
      cell: ({ row }) => (
        <span className={`badge text-[11px] px-2 py-0.5 rounded ${row.original.state === 'Recovered' ? STATUS_STYLES.ok : STATUS_STYLES.breach}`}>{row.original.state}</span>
      ),
    },
  ], [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cold-Chain Monitor"
        subtitle="Refrigerated-cargo temperature compliance. Every reading is checked against its safe range; excursions, deviation and event duration are flagged automatically."
        icon={Snowflake}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50" disabled={!registerRows.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50" disabled={!registerRows.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> Log reading
            </button>
          </div>
        }
      />

      {notProvisioned && (
        // `border border-amber-800/50` as CLASSES would be dead here: Card sets
        // `border` inline and an inline declaration beats a plain class, so the
        // tint is carried by `tone`. Card is `flex flex-col` and Tailwind emits
        // .flex-col after .flex-row, so the row direction goes in `style`, which
        // Card spreads last.
        <Card tone="warn" role="status" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-300 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Cold-Chain monitoring is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V143_COLD_CHAIN_LOGS.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" role="alert" className="items-start justify-between gap-[var(--space-3)]" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div><p className="text-[var(--text-primary)] font-medium">Something went wrong with the cold-chain readings.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm shrink-0 inline-flex items-center gap-1.5 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </Card>
      )}

      {truncated && (
        <Card tone="info" role="status" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <Info size={16} className="text-sky-300 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-muted)]">Showing the newest {READ_LIMIT} readings. Older readings are not loaded, so totals below cover this window only.</p>
        </Card>
      )}

      {/* Filters scope every KPI, chart and table below. */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="relative flex-1 min-w-[200px]">
            <span className="sr-only">Search readings</span>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full min-h-[44px]" placeholder="Search asset, site, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">Status
            <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="breach">Breach</option>
              <option value="warning">Warning</option>
              <option value="ok">OK</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">Asset
            <select className="input min-h-[44px]" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
              <option value="">All assets</option>
              {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">Site
            <select className="input min-h-[44px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">From
            <input type="date" className="input min-h-[44px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">To
            <input type="date" className="input min-h-[44px]" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
        </div>
        <p className="text-xs text-[var(--text-muted)]" aria-live="polite">{loadingFirst ? 'Loading readings' : `${filtered.length} of ${summary.total} readings in view`}</p>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <StatTile label="Readings" value={loadingFirst ? NA : analytics.total} icon={ThermometerSnowflake} />
        <StatTile label="Compliance" value={loadingFirst || analytics.compliancePct == null ? NA : analytics.compliancePct} unit={!loadingFirst && analytics.compliancePct != null ? '%' : undefined} icon={Percent} tone="accent" sub="within safe range" />
        <StatTile label="Breaches" value={loadingFirst ? NA : analytics.breaches} icon={AlertTriangle} tone="crit" />
        <StatTile label="Near limit" value={loadingFirst ? NA : analytics.warnings} icon={AlertTriangle} tone="warn" />
        <StatTile label="Excursion events" value={loadingFirst ? NA : analytics.excursionEpisodes} icon={Activity} tone="warn" sub={`${analytics.openEpisodes} still open`} />
        <StatTile label="Avg deviation" value={loadingFirst || !analytics.avgDeviation ? NA : analytics.avgDeviation} unit={!loadingFirst && analytics.avgDeviation ? 'C' : undefined} icon={Gauge} tone="crit" sub={analytics.maxDeviation ? `max ${analytics.maxDeviation} C` : 'no excursions'} />
        <StatTile label="Avg duration" value={loadingFirst ? NA : formatDurationMin(analytics.avgExcursionMin)} icon={Timer} tone="info" sub="recovered events" />
        <StatTile label="Assets" value={loadingFirst ? NA : analytics.assetsMonitored} icon={Boxes} tone="info" sub={`${analytics.sitesMonitored} site${analytics.sitesMonitored === 1 ? '' : 's'}`} />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader title="Readings by status" />
          <div className="h-64" role="img" aria-label={`Status split: ${analytics.ok} OK, ${analytics.warning} warning, ${analytics.breach} breach`}>
            <ChartSlot loading={loadingFirst} empty={!hasData} emptyText="No readings to chart.">
              <Doughnut data={donutData} options={donutOpts} />
            </ChartSlot>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader icon={Clock} title="Temperature trend (daily)" description="Average with daily min and max; bars count breaches." />
          <div className="h-64">
            <ChartSlot loading={loadingFirst} empty={!hasData || !analytics.trend.length} emptyText="No dated readings to trend.">
              <Line data={trendData} options={trendOpts} />
            </ChartSlot>
          </div>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Excursion distribution" />
          <div className="h-56">
            <ChartSlot loading={loadingFirst} empty={!hasData} emptyText="No readings to chart.">
              <Bar data={distData} options={distOpts} />
            </ChartSlot>
          </div>
          <dl className="grid grid-cols-3 gap-2 mt-3 text-center">
            <div><dt className="text-xs text-[var(--text-muted)]">In range</dt><dd className="text-lg font-bold text-green-400 tabular-nums">{analytics.distribution.in_range}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)] flex items-center justify-center gap-0.5"><ArrowUp size={11} aria-hidden="true" /> Above max</dt><dd className="text-lg font-bold text-red-400 tabular-nums">{analytics.distribution.above}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)] flex items-center justify-center gap-0.5"><ArrowDown size={11} aria-hidden="true" /> Below min</dt><dd className="text-lg font-bold text-sky-300 tabular-nums">{analytics.distribution.below}</dd></div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Breaches by asset (worst first)" />
          <div className="h-56">
            <ChartSlot loading={loadingFirst} empty={!topBreachAssets.length} emptyText="No excursions recorded.">
              <Bar data={assetBarData} options={assetBarOpts} />
            </ChartSlot>
          </div>
        </Card>
      </div>

      {/* Compliance breakdown + excursion events */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card pad="none">
          <div className="px-4 pt-4">
            <CardHeader
              icon={MapPin}
              title={breakdown === 'asset' ? 'Compliance by asset' : 'Compliance by site'}
              actions={(
                <SegmentedControl
                  value={breakdown}
                  onChange={setBreakdown}
                  options={[{ value: 'asset', label: 'Asset' }, { value: 'site', label: 'Site' }]}
                  ariaLabel="Group compliance by"
                />
              )}
            />
          </div>
          <EnterpriseTable
            columns={breakdownColumns}
            data={breakdownRows}
            getRowId={(r) => r.key}
            loading={loadingFirst}
            enableExport={false}
            enableColumnFilters={false}
            searchPlaceholder={breakdown === 'asset' ? 'Search asset' : 'Search site'}
            initialPageSize={25}
            emptyMessage="No readings in view."
          />
        </Card>
        <Card pad="none">
          <div className="px-4 pt-4">
            <CardHeader icon={Activity} title="Excursion events" description="A run of consecutive breaches on one unit, closed by the next in-range reading." />
          </div>
          <EnterpriseTable
            columns={episodeColumns}
            data={episodes}
            getRowId={(r) => r.id}
            loading={loadingFirst}
            enableExport={false}
            enableColumnFilters={false}
            searchPlaceholder="Search asset"
            initialPageSize={25}
            emptyMessage="No excursion events in view."
          />
        </Card>
      </div>

      {/* Register. The page filter card above is the search, so the table's
          own search box is off to avoid two competing boxes. */}
      <Card pad="none">
        <div className="px-4 pt-4"><CardHeader icon={ThermometerSnowflake} title="Reading register" description={`${registerRows.length} readings`} /></div>
        <EnterpriseTable
          columns={registerColumns}
          data={registerRows}
          getRowId={(r, i) => String(r.id ?? i)}
          loading={loadingFirst}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={notProvisioned
            ? 'No readings, because the cold-chain table has not been provisioned yet.'
            : (rows || []).length === 0 ? 'No readings logged yet. Use "Log reading" to record the first one.' : 'No readings match these filters.'}
        />
      </Card>
      {/* Create / Edit modal. The submit button stays INSIDE the <form> rather
          than moving to Modal's `footer`: a footer button would need a
          `form="..."` association to keep submitting, which is a behaviour
          change, not a migration. `closeModal` already refuses to close while a
          save is in flight, and Modal routes Escape, the backdrop and its own X
          through that one guarded callback - the hand-rolled overlay guarded
          only the backdrop. Modal also owns the height cap the `max-h-[90vh]`
          was doing by hand, the focus trap, the scroll lock and the portal. */}
      {showModal && (
        <Modal
          open
          onClose={closeModal}
          size="md"
          title={editing ? 'Edit reading' : 'Log temperature reading'}
        >
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="cc-asset">Asset / unit no.</label>
                  <input id="cc-asset" className="input w-full" placeholder="e.g. REEFER-01" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="cc-site">Site (optional)</label>
                  <input id="cc-site" className="input w-full" placeholder="e.g. Riyadh DC" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label" htmlFor="cc-temp">Temperature (C)</label>
                  <input id="cc-temp" className="input w-full" type="number" step="0.1" placeholder="-18" value={form.temperature_c} onChange={(e) => set('temperature_c', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="cc-min">Min safe (C)</label>
                  <input id="cc-min" className="input w-full" type="number" step="0.1" placeholder="-20" value={form.min_threshold_c} onChange={(e) => set('min_threshold_c', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="cc-max">Max safe (C)</label>
                  <input id="cc-max" className="input w-full" type="number" step="0.1" placeholder="-15" value={form.max_threshold_c} onChange={(e) => set('max_threshold_c', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="cc-recorded">Recorded at (optional)</label>
                <input id="cc-recorded" className="input w-full" type="datetime-local" value={form.recorded_at} onChange={(e) => set('recorded_at', e.target.value)} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to stamp now.</p>
              </div>
              <div>
                <label className="label" htmlFor="cc-notes">Notes (optional)</label>
                <textarea id="cc-notes" className="input w-full min-h-[80px] resize-y" placeholder="Door left open during loading" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {form.temperature_c !== '' && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--text-muted)]">This reading classifies as</span>
                  <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[previewStatus]}`}>{COLD_CHAIN_STATUS_META[previewStatus].label}</span>
                </div>
              )}

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving' : editing ? 'Save changes' : 'Log reading'}
                </button>
              </div>
            </form>
        </Modal>
      )}

      {/* Delete confirm. No <form> here, so the actions belong in Modal's
          `footer`, which pins them where a user can always reach them. The
          legacy overlay guarded only its backdrop against closing mid-delete
          and had no X at all; `closeDelete` is now the single guarded close
          behind Escape, the backdrop and the X alike. */}
      {confirmDelete && (
        <Modal
          open
          onClose={closeDelete}
          size="sm"
          title="Delete this reading?"
          footer={
            <>
              <button onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting' : 'Delete'}
              </button>
            </>
          }
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
            <p className="text-sm text-[var(--text-muted)]">
              {confirmDelete.asset_no || 'Reading'} at {confirmDelete.temperature_c == null ? NA : `${confirmDelete.temperature_c} C`} on {fmtDateTime(confirmDelete.recorded_at)}. This cannot be undone.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
