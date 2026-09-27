/**
 * VehicleHandover (route /vehicle-handover) - Vehicle Handover / Condition
 * Reports. Captures check-in / check-out condition records whenever a vehicle
 * changes hands between drivers: outgoing/incoming driver, odometer, fuel level,
 * overall condition, logged damages, cleanliness, and supporting evidence.
 * Condition history underpins damage attribution, cost recovery, driver
 * accountability, and downtime analysis, so every report is org-isolated and
 * country-scoped.
 *
 * Runs on the `handover_reports` table (V181). The base roll-up lives in
 * `src/lib/handoverReports.js`; filtering, the honest-null KPI set, the
 * condition mix, the monthly trend, vehicles still out and export rows live in
 * `src/lib/vehicleHandoverAnalytics.js`. This page only renders them.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  ClipboardCheck, ArrowLeftRight, LogOut, LogIn, ShieldAlert, X, Plus, Pencil, Trash2,
  AlertTriangle, Users, FileSpreadsheet, FileText, RotateCw, Fuel, Car, BarChart3, CalendarClock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listHandoverReports, createHandoverReport, updateHandoverReport, deleteHandoverReport,
} from '../lib/api/handoverReports'
import { damageCount } from '../lib/handoverReports'
import {
  HANDOVER_TYPE_LABEL, CONDITIONS, CONDITION_LABEL, CLEANLINESS, NOT_RATED,
  filterHandovers, handoverKpis, conditionMix, monthlyHandoverTrend, assetDamageLeaders,
  vehiclesStillOut, HANDOVER_EXPORT_COLUMNS, handoverExportRows,
} from '../lib/vehicleHandoverAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { colorAt, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)

const EMPTY_FORM = {
  asset_no: '', report_no: '', handover_type: 'checkout', from_driver: '', to_driver: '',
  handover_at: '', odometer_km: '', fuel_level_pct: '', condition_rating: 'good',
  cleanliness: 'clean', signature_url: '', photo_url: '', notes: '',
}

const TYPE_META = {
  checkout: { icon: LogOut, cls: 'bg-amber-900/30 text-amber-300 border border-amber-800/50' },
  checkin: { icon: LogIn, cls: 'bg-sky-900/30 text-sky-300 border border-sky-800/50' },
}
const CONDITION_CLS = {
  excellent: 'bg-emerald-900/30 text-emerald-300 border border-emerald-800/50',
  good: 'bg-green-900/30 text-green-300 border border-green-800/50',
  fair: 'bg-amber-900/30 text-amber-300 border border-amber-800/50',
  poor: 'bg-red-900/30 text-red-300 border border-red-800/50',
}

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

const fmtKm = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} km`)
const fmtPct = (v) => (v == null || v === '' ? 'N/A' : `${Number(v)}%`)
const fmtRate = (v) => (v == null ? 'N/A' : `${v}%`)
function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
/** timestamptz to the value for <input type="datetime-local">. */
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

function TypeBadge({ type }) {
  const meta = TYPE_META[type]
  if (!meta) return <span className="text-[var(--text-muted)]">N/A</span>
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
      <Icon size={11} aria-hidden="true" /> {HANDOVER_TYPE_LABEL[type]}
    </span>
  )
}
function ConditionBadge({ rating }) {
  if (!CONDITION_CLS[rating]) return <span className="text-[var(--text-muted)]">N/A</span>
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${CONDITION_CLS[rating]}`}>{CONDITION_LABEL[rating]}</span>
}

function KpiTile({ label, value, icon: Icon, tone = 'text-[var(--text-primary)]', sub }) {
  return (
    <div className="card !p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

const chartOpts = (stacked = false) => ({
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: 'var(--text-muted)', boxWidth: 12 } } },
  scales: {
    x: { stacked, ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
    y: { stacked, beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
  },
})

export default function VehicleHandover() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [asOf] = useState(() => new Date())

  const [countryFilter, setCountryFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [conditionFilter, setConditionFilter] = useState('')
  const [cleanFilter, setCleanFilter] = useState('')
  const [damagedOnly, setDamagedOnly] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')

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
      const data = await listHandoverReports({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load handover reports.'))
      setRows(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const failed = !!error || notProvisioned
  const all = useMemo(() => rows || [], [rows])
  const countryOptions = useMemo(() => [...new Set(all.map((r) => r.country).filter(Boolean))].sort(), [all])

  const filtered = useMemo(() => filterHandovers(all, {
    country: countryFilter, type: typeFilter, condition: conditionFilter, cleanliness: cleanFilter,
    damagedOnly, from: fromDate, to: toDate, search,
  }), [all, countryFilter, typeFilter, conditionFilter, cleanFilter, damagedOnly, fromDate, toDate, search])

  // KPIs and charts describe the set the reader is looking at.
  const kpi = useMemo(() => handoverKpis(filtered, { now: asOf }), [filtered, asOf])
  const mix = useMemo(() => conditionMix(filtered), [filtered])
  const trend = useMemo(() => monthlyHandoverTrend(filtered, { now: asOf }), [filtered, asOf])
  const leaders = useMemo(() => assetDamageLeaders(filtered), [filtered])
  const stillOut = useMemo(() => vehiclesStillOut(filtered), [filtered])

  const hasFilters = !!(countryFilter || typeFilter || conditionFilter || cleanFilter || damagedOnly || fromDate || toDate || search)
  const clearFilters = () => {
    setCountryFilter(''); setTypeFilter(''); setConditionFilter(''); setCleanFilter('')
    setDamagedOnly(false); setFromDate(''); setToDate(''); setSearch('')
  }

  const na = rows === null
  const v = (x) => (na ? 'N/A' : x)
  const kpis = [
    { label: 'Handover reports', value: v(kpi.totalReports.toLocaleString()), icon: ClipboardCheck, sub: na ? null : `${kpi.last30Days} in the last 30 days` },
    { label: 'Check-outs', value: v(kpi.checkoutCount), icon: LogOut, tone: 'text-amber-400' },
    { label: 'Check-ins', value: v(kpi.checkinCount), icon: LogIn, tone: 'text-sky-400' },
    { label: 'Vehicles still out', value: v(kpi.stillOut), icon: Car, tone: kpi.stillOut ? 'text-amber-400' : 'text-[var(--text-primary)]', sub: 'Latest handover is a check-out' },
    { label: 'Poor condition rate', value: v(fmtRate(kpi.poorRate)), icon: ShieldAlert, tone: 'text-red-400', sub: na ? null : `${kpi.poorConditionCount} of ${kpi.ratedReports} rated` },
    { label: 'Reports with damage', value: v(fmtRate(kpi.damageRate)), icon: AlertTriangle, tone: 'text-amber-400', sub: na ? null : `${kpi.totalDamages} damages logged` },
    { label: 'Average fuel at handover', value: v(fmtRate(kpi.avgFuelPct)), icon: Fuel, tone: 'text-sky-400' },
    { label: 'Drivers involved', value: v(kpi.distinctDrivers), icon: Users, sub: na ? null : `${kpi.distinctAssets} assets` },
  ]

  // ── Export (whole filtered set, never the visible page) ─────────────────────
  const exportRows = useMemo(() => handoverExportRows(filtered), [filtered])
  const fileName = reportFileName('TyrePulse Vehicle Handover', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExcel = () => exportToExcel(exportRows, HANDOVER_EXPORT_COLUMNS.map((c) => c[0]), HANDOVER_EXPORT_COLUMNS.map((c) => c[1]), fileName)
  const doPdf = () => exportToPdf(exportRows, HANDOVER_EXPORT_COLUMNS.map(([key, header]) => ({ key, header })), 'Vehicle Handover Reports', fileName, 'landscape')

  // ── Charts ──────────────────────────────────────────────────────────────────
  const trendData = {
    labels: trend.map((m) => m.month),
    datasets: [
      { label: 'Check-outs', data: trend.map((m) => m.checkouts), backgroundColor: colorAt(0), borderRadius: 3 },
      { label: 'Check-ins', data: trend.map((m) => m.checkins), backgroundColor: colorAt(1), borderRadius: 3 },
    ],
  }
  const mixData = {
    labels: mix.map((m) => m.label),
    datasets: [{ label: 'Reports', data: mix.map((m) => m.count), backgroundColor: mix.map((_, i) => withAlpha(colorAt(i), 0.85)), borderRadius: 4 }],
  }
  const trendTotal = trend.reduce((s, m) => s + m.checkouts + m.checkins, 0)

  // ── Modal ───────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', report_no: r.report_no || '',
      handover_type: r.handover_type || 'checkout',
      from_driver: r.from_driver || '', to_driver: r.to_driver || '',
      handover_at: toLocalInput(r.handover_at), odometer_km: r.odometer_km ?? '',
      fuel_level_pct: r.fuel_level_pct ?? '', condition_rating: r.condition_rating || 'good',
      cleanliness: r.cleanliness || 'clean', signature_url: r.signature_url || '',
      photo_url: r.photo_url || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, val) => setForm((f) => ({ ...f, [k]: val }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        handover_at: form.handover_at ? new Date(form.handover_at).toISOString() : null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateHandoverReport(editing.id, payload)
      else await createHandoverReport(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the handover report.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteHandoverReport(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the handover report.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // ── Table ───────────────────────────────────────────────────────────────────
  const columns = useMemo(() => [
    {
      id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 150,
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</div>
          {row.original.report_no && <div className="text-[11px] text-[var(--text-muted)]">{row.original.report_no}</div>}
        </div>
      ),
    },
    { id: 'type', header: 'Type', accessorFn: (r) => HANDOVER_TYPE_LABEL[r.handover_type] || '', size: 120, cell: ({ row }) => <TypeBadge type={row.original.handover_type} /> },
    {
      id: 'drivers', header: 'Drivers', accessorFn: (r) => `${r.from_driver || ''} ${r.to_driver || ''}`, size: 220,
      meta: { exportValue: (r) => `${r.from_driver || 'N/A'} to ${r.to_driver || 'N/A'}` },
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 whitespace-nowrap text-[var(--text-secondary)]">
          <span>{row.original.from_driver || 'N/A'}</span>
          <ArrowLeftRight size={12} className="text-[var(--text-muted)] shrink-0" aria-label="handed to" />
          <span>{row.original.to_driver || 'N/A'}</span>
        </div>
      ),
    },
    {
      id: 'handover_at', header: 'Handover at', accessorFn: (r) => (r.handover_at ? new Date(r.handover_at).getTime() : -Infinity), size: 170,
      meta: { exportValue: (r) => fmtDateTime(r.handover_at) },
      cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDateTime(row.original.handover_at)}</span>,
    },
    { id: 'odometer', header: 'Odometer', accessorFn: (r) => (r.odometer_km == null || r.odometer_km === '' ? -1 : Number(r.odometer_km)), size: 120, meta: { align: 'right', exportValue: (r) => fmtKm(r.odometer_km) }, cell: ({ row }) => <span className="tabular-nums">{fmtKm(row.original.odometer_km)}</span> },
    { id: 'fuel', header: 'Fuel', accessorFn: (r) => (r.fuel_level_pct == null || r.fuel_level_pct === '' ? -1 : Number(r.fuel_level_pct)), size: 80, meta: { align: 'right', exportValue: (r) => fmtPct(r.fuel_level_pct) }, cell: ({ row }) => <span className="tabular-nums">{fmtPct(row.original.fuel_level_pct)}</span> },
    { id: 'condition', header: 'Condition', accessorFn: (r) => CONDITION_LABEL[r.condition_rating] || NOT_RATED, size: 110, cell: ({ row }) => <ConditionBadge rating={row.original.condition_rating} /> },
    {
      id: 'damages', header: 'Damages', accessorFn: (r) => damageCount(r), size: 100, meta: { align: 'right' },
      cell: ({ row }) => {
        const n = damageCount(row.original)
        return n > 0
          ? <span className="inline-flex items-center gap-1 text-amber-400 font-medium"><ShieldAlert size={13} aria-hidden="true" /> {n}</span>
          : <span className="text-[var(--text-muted)]">None logged</span>
      },
    },
    { id: 'cleanliness', header: 'Cleanliness', accessorFn: (r) => r.cleanliness || '', size: 110, cell: ({ row }) => <span className="capitalize text-[var(--text-secondary)]">{row.original.cleanliness || 'N/A'}</span> },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit handover for ${row.original.asset_no || 'asset'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete handover for ${row.original.asset_no || 'asset'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Handover"
        subtitle="Record check-in and check-out condition reports each time a vehicle changes hands between drivers: the accountability basis for damage attribution, cost recovery, and downtime analysis."
        icon={ClipboardCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={failed}>
              <Plus size={14} aria-hidden="true" /> New handover
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Vehicle handover reporting is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Ask your administrator to enable handover reports, then refresh.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-red-300 font-medium">Could not load handover reports.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RotateCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => <KpiTile key={k.label} {...k} />)}
      </div>
      {hasFilters && !na && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">These figures cover the {filtered.length} reports matching the current filters.</p>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><BarChart3 size={15} aria-hidden="true" /> Handovers per month (last 12 months)</h2>
          <div className="h-60">
            {na ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
              : trendTotal === 0 ? <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No dated handovers in the last 12 months.</p>
                : <Bar data={trendData} options={chartOpts(true)} aria-label="Check-outs and check-ins per month" role="img" />}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><ArrowLeftRight size={15} aria-hidden="true" /> Condition mix</h2>
          <div className="h-60">
            {na ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
              : filtered.length === 0 ? <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No handover reports to rate.</p>
                : <Bar data={mixData} options={{ ...chartOpts(), plugins: { legend: { display: false } } }} aria-label="Handover reports by condition" role="img" />}
          </div>
        </div>
      </div>

      {/* Attention lists */}
      {!na && (stillOut.length > 0 || leaders.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><CalendarClock size={15} aria-hidden="true" /> Vehicles still out ({stillOut.length})</h2>
            {stillOut.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Every vehicle checked out has a later check-in.</p> : (
              <ul className="divide-y divide-[var(--input-border)]/60 max-h-60 overflow-y-auto">
                {stillOut.slice(0, 30).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="font-medium text-[var(--text-primary)]">{r.asset_no}</span>
                    <span className="text-[var(--text-secondary)] truncate">{r.to_driver || 'Driver not recorded'}</span>
                    <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">since {fmtDateTime(r.handover_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><ShieldAlert size={15} aria-hidden="true" /> Assets with most damage</h2>
            {leaders.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No damages or poor ratings logged.</p> : (
              <ul className="divide-y divide-[var(--input-border)]/60">
                {leaders.map((l) => (
                  <li key={l.asset} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="font-medium text-[var(--text-primary)]">{l.asset}</span>
                    <span className="text-xs text-[var(--text-muted)]">{l.reports} reports</span>
                    <span className="text-amber-400 font-semibold tabular-nums">{l.damages} damages</span>
                    <span className="text-xs text-red-400 tabular-nums">{l.poor} poor</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block">
            <span className="label">Search</span>
            <input className="input w-full min-h-[44px]" placeholder="Asset, report, driver, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {countryOptions.length > 1 && (
            <label className="block">
              <span className="label">Country</span>
              <select className="input w-full min-h-[44px]" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
                <option value="">All countries</option>
                {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          <label className="block">
            <span className="label">Handover type</span>
            <select className="input w-full min-h-[44px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              <option value="checkout">Check-out</option>
              <option value="checkin">Check-in</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Condition</span>
            <select className="input w-full min-h-[44px]" value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)}>
              <option value="">All conditions</option>
              {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
              <option value={NOT_RATED}>{NOT_RATED}</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Cleanliness</span>
            <select className="input w-full min-h-[44px]" value={cleanFilter} onChange={(e) => setCleanFilter(e.target.value)}>
              <option value="">Any</option>
              {CLEANLINESS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Handover from</span>
            <input type="date" className="input w-full min-h-[44px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Handover to</span>
            <input type="date" className="input w-full min-h-[44px]" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 self-end min-h-[44px] text-sm text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" className="h-4 w-4" checked={damagedOnly} onChange={(e) => setDamagedOnly(e.target.checked)} />
            Only reports with damage
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{na ? 'N/A' : `${filtered.length} of ${all.length}`} reports</span>
        </div>
      </div>

      {/* Register */}
      {failed ? (
        <div className="card text-center py-10 text-sm text-[var(--text-muted)]">Handover reports are unavailable.</div>
      ) : (
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={na}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          exportFileName={fileName}
          viewKey="vehicle-handover"
          initialPageSize={25}
          emptyMessage={all.length === 0 ? 'No handover reports recorded yet. Record your first handover.' : 'No reports match these filters.'}
        />
      )}

      {/* Create / Edit */}
      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit handover report' : 'New handover report'} size="lg">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Asset number *</span>
              <input className="input w-full" required placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} /></label>
            <label className="block"><span className="label">Report number (optional)</span>
              <input className="input w-full" placeholder="e.g. HO-2026-0091" value={form.report_no} maxLength={120} onChange={(e) => set('report_no', e.target.value)} /></label>
            <label className="block"><span className="label">Handover type</span>
              <select className="input w-full" value={form.handover_type} onChange={(e) => set('handover_type', e.target.value)}>
                <option value="checkout">Check-out</option><option value="checkin">Check-in</option>
              </select></label>
            <label className="block"><span className="label">Handover date and time</span>
              <input className="input w-full" type="datetime-local" value={form.handover_at} onChange={(e) => set('handover_at', e.target.value)} />
              <span className="block text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</span></label>
            <label className="block"><span className="label">From driver (outgoing)</span>
              <input className="input w-full" placeholder="e.g. A. Rahman" value={form.from_driver} maxLength={200} onChange={(e) => set('from_driver', e.target.value)} /></label>
            <label className="block"><span className="label">To driver (incoming)</span>
              <input className="input w-full" placeholder="e.g. M. Salah" value={form.to_driver} maxLength={200} onChange={(e) => set('to_driver', e.target.value)} /></label>
            <label className="block"><span className="label">Odometer (km)</span>
              <input className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="45000" value={form.odometer_km} onChange={(e) => set('odometer_km', e.target.value)} /></label>
            <label className="block"><span className="label">Fuel level (%)</span>
              <input className="input w-full" type="number" step="1" min="0" max="100" inputMode="numeric" placeholder="75" value={form.fuel_level_pct} onChange={(e) => set('fuel_level_pct', e.target.value)} /></label>
            <label className="block"><span className="label">Overall condition</span>
              <select className="input w-full" value={form.condition_rating} onChange={(e) => set('condition_rating', e.target.value)}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
              </select></label>
            <label className="block"><span className="label">Cleanliness</span>
              <select className="input w-full" value={form.cleanliness} onChange={(e) => set('cleanliness', e.target.value)}>
                {CLEANLINESS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select></label>
            <label className="block"><span className="label">Signature URL (optional)</span>
              <input className="input w-full" type="url" placeholder="https://" value={form.signature_url} maxLength={2000} onChange={(e) => set('signature_url', e.target.value)} /></label>
            <label className="block"><span className="label">Photo URL (optional)</span>
              <input className="input w-full" type="url" placeholder="https://" value={form.photo_url} maxLength={2000} onChange={(e) => set('photo_url', e.target.value)} /></label>
          </div>
          <label className="block"><span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. minor scratch on rear left panel, noted at handover" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} /></label>

          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Record handover'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this handover report?"
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-muted)]">
          {confirmDelete?.asset_no || 'Report'}, {HANDOVER_TYPE_LABEL[confirmDelete?.handover_type] || 'N/A'}, {fmtDateTime(confirmDelete?.handover_at)}. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
