/**
 * SpeedLimiter (route /speed-limiter) - Speed Limiter Compliance Registry.
 *
 * Speed governors are a GCC legal requirement: every heavy asset must carry a
 * working, correctly-set limiter and it must be re-verified / re-calibrated
 * periodically. This page registers the limiter fitted to each asset (governed
 * limit, device, status, last verification) and turns that register into a
 * compliance picture: fitment-status distribution, a verification pipeline
 * (Verified / Expiring soon / Overdue / Not verified), set-speed distribution,
 * by-site coverage vs the live fleet, and a prioritised non-compliant list.
 *
 * HONESTY NOTE: the `speed_limiters` table has NO dedicated calibration-expiry
 * column. The verification pipeline is DERIVED from the real `last_verified_at`
 * date plus a tunable re-verification interval (default 365 days, GCC annual
 * cadence) - it is never fabricated, and records with no verification date are
 * shown as "Not verified", not assumed compliant.
 *
 * Runs on `speed_limiters` (MIGRATIONS_V153_SPEED_LIMITERS.sql); coverage reads
 * a lean projection of `vehicle_fleet`. When either table is not deployed the
 * service degrades to [] and the page surfaces an honest hint / empty state.
 * Writes stay role-gated (Admin/Manager/Director) at the RLS layer.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  Gauge, Zap, AlertTriangle, Settings, Plus, Pencil, Trash2, Search, X, Filter,
  FileSpreadsheet, FileText, ShieldCheck, ShieldAlert, CalendarClock, CalendarX,
  CheckCircle2, MapPin, ArrowUpDown, Percent,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listSpeedLimiters, createSpeedLimiter, updateSpeedLimiter, deleteSpeedLimiter,
  listFleetForCoverage,
} from '../lib/api/speedLimiters'
import {
  SPEED_LIMITER_STATUSES, SPEED_LIMITER_STATUS_META,
  VERIFICATION_BANDS, VERIFICATION_BAND_META,
  DEFAULT_REVERIFY_DAYS, DEFAULT_EXPIRING_SOON_DAYS,
  summarizeSpeedLimiters, setSpeedDistribution, bySiteCoverage,
  nonCompliantList, filterSpeedLimiters, sortByExpiry,
  verificationBand, nextDueDate, daysToNextDue,
} from '../lib/speedLimiterAnalytics'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import toUserMessage from '../lib/safeError'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

const STATUS_BADGE = {
  active: 'bg-green-900/40 text-green-300 border border-green-700/50',
  disabled: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
  fault: 'bg-red-900/40 text-red-300 border border-red-700/50',
}
const STATUS_COLOR = { active: '#22c55e', disabled: '#64748b', fault: '#ef4444' }

const BAND_BADGE = {
  valid: 'bg-green-900/40 text-green-300 border border-green-700/50',
  expiring: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  expired: 'bg-red-900/40 text-red-300 border border-red-700/50',
  unverified: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const BAND_COLOR = { valid: '#22c55e', expiring: '#f59e0b', expired: '#ef4444', unverified: '#64748b' }

const REVERIFY_OPTIONS = [
  { value: 180, label: 'Every 6 months' },
  { value: 365, label: 'Annual (GCC standard)' },
  { value: 730, label: 'Every 2 years' },
]
const SOON_OPTIONS = [30, 60, 90]

const EMPTY_FORM = {
  asset_no: '', limit_kph: '', device_id: '', last_verified_at: '',
  status: 'active', site: '', notes: '',
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 10)
}
function fmtDueLabel(days) {
  if (days == null) return 'Not verified'
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'Due today'
  return `In ${days}d`
}
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}

export default function SpeedLimiter() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [fleet, setFleet] = useState([])
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  // Stable reference "now" for the whole session so band computations don't drift.
  const [asOf] = useState(() => new Date())
  const [reverifyDays, setReverifyDays] = useState(DEFAULT_REVERIFY_DAYS)
  const [soonDays, setSoonDays] = useState(DEFAULT_EXPIRING_SOON_DAYS)

  const [statusFilter, setStatusFilter] = useState('all')
  const [bandFilter, setBandFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [sortDir, setSortDir] = useState('asc')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const engineOpts = useMemo(
    () => ({ asOf, reverifyDays, expiringSoonDays: soonDays }),
    [asOf, reverifyDays, soonDays],
  )

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const [data, fleetRows] = await Promise.all([
        listSpeedLimiters({ country: activeCountry }),
        listFleetForCoverage({ country: activeCountry }).catch(() => []),
      ])
      setRows(Array.isArray(data) ? data : [])
      setFleet(Array.isArray(fleetRows) ? fleetRows : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load speed limiters.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeSpeedLimiters(rows || [], engineOpts), [rows, engineOpts])
  const coverage = useMemo(() => bySiteCoverage(rows || [], fleet || []), [rows, fleet])
  const speedDist = useMemo(() => setSpeedDistribution(rows || []), [rows])
  const nonCompliant = useMemo(() => nonCompliantList(rows || [], engineOpts), [rows, engineOpts])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )
  const siteOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const base = filterSpeedLimiters(rows || [], {
      status: statusFilter, band: bandFilter, site: siteFilter, search,
      from: fromDate, to: toDate, ...engineOpts,
    }).filter((r) => !assetFilter || r.asset_no === assetFilter)
    return sortByExpiry(base, { direction: sortDir, ...engineOpts })
  }, [rows, statusFilter, bandFilter, siteFilter, assetFilter, search, fromDate, toDate, sortDir, engineOpts])

  // ---- Charts -------------------------------------------------------------
  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--panel-2') || '#1f2937'

  const statusDonut = {
    labels: SPEED_LIMITER_STATUSES.map((s) => SPEED_LIMITER_STATUS_META[s].label),
    datasets: [{
      data: SPEED_LIMITER_STATUSES.map((s) => summary.byStatus[s]),
      backgroundColor: SPEED_LIMITER_STATUSES.map((s) => STATUS_COLOR[s]),
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
  }

  const bandBar = {
    labels: VERIFICATION_BANDS.map((b) => VERIFICATION_BAND_META[b].label),
    datasets: [{
      label: 'Limiters',
      data: VERIFICATION_BANDS.map((b) => summary.byBand[b]),
      backgroundColor: VERIFICATION_BANDS.map((b) => BAND_COLOR[b]),
      borderRadius: 4,
    }],
  }
  const speedBar = {
    labels: speedDist.map((d) => (d.limit == null ? 'Not set' : `${d.limit} km/h`)),
    datasets: [{
      label: 'Assets', data: speedDist.map((d) => d.count),
      backgroundColor: '#38bdf8', borderRadius: 4,
    }],
  }
  const coverageBar = {
    labels: coverage.bySite.slice(0, 12).map((b) => b.site),
    datasets: [{
      label: 'Coverage %',
      data: coverage.bySite.slice(0, 12).map((b) => (b.coverage == null ? 0 : b.coverage)),
      backgroundColor: coverage.bySite.slice(0, 12).map((b) => {
        const c = b.coverage == null ? 0 : b.coverage
        return c >= 90 ? '#22c55e' : c >= 60 ? '#f59e0b' : '#ef4444'
      }),
      borderRadius: 4,
    }],
  }
  const barOpts = (max) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: chartText, font: { size: 10 } }, grid: { display: false } },
      y: { beginAtZero: true, max, ticks: { color: chartText, precision: 0 }, grid: { color: gridColor } },
    },
  })

  // ---- KPIs ---------------------------------------------------------------
  const kpis = [
    { label: 'Total limiters', value: summary.total, icon: Gauge, tone: 'text-[var(--text-primary)]' },
    { label: 'Compliance rate', value: summary.complianceRate == null ? 'N/A' : `${summary.complianceRate}%`, icon: ShieldCheck, tone: summary.complianceRate != null && summary.complianceRate >= 90 ? 'text-green-400' : summary.complianceRate != null && summary.complianceRate >= 60 ? 'text-amber-400' : 'text-red-400' },
    { label: 'Faults', value: summary.faults, icon: AlertTriangle, tone: summary.faults ? 'text-red-400' : 'text-green-400' },
    { label: 'Verification overdue', value: summary.expired, icon: CalendarX, tone: summary.expired ? 'text-red-400' : 'text-green-400' },
    { label: 'Expiring soon', value: summary.expiringSoon, icon: CalendarClock, tone: summary.expiringSoon ? 'text-amber-400' : 'text-[var(--text-primary)]' },
    { label: 'Not verified', value: summary.unverified, icon: ShieldAlert, tone: summary.unverified ? 'text-amber-400' : 'text-green-400' },
    { label: 'Fleet coverage', value: coverage.overall.coverage == null ? 'N/A' : `${coverage.overall.coverage}%`, icon: MapPin, tone: coverage.overall.coverage != null && coverage.overall.coverage >= 90 ? 'text-green-400' : 'text-sky-400' },
    { label: 'Avg limit (km/h)', value: summary.avgLimit == null ? 'N/A' : summary.avgLimit, icon: Settings, tone: 'text-sky-400' },
  ]

  // ---- Export -------------------------------------------------------------
  const EXPORT_COLS = ['asset_no', 'limit_kph', 'device_id', 'status', 'site', 'last_verified_at', 'next_due', 'verification', 'compliant']
  const EXPORT_HEADERS = ['Asset', 'Limit (km/h)', 'Device', 'Status', 'Site', 'Last verified', 'Next due', 'Verification', 'Compliant']
  const exportRows = filtered.map((r) => {
    const band = verificationBand(r, engineOpts)
    const due = nextDueDate(r, reverifyDays)
    const days = daysToNextDue(r, engineOpts)
    return {
      asset_no: r.asset_no || '', limit_kph: r.limit_kph ?? '', device_id: r.device_id || '',
      status: SPEED_LIMITER_STATUS_META[r.status]?.label || r.status || '',
      site: r.site || '', last_verified_at: r.last_verified_at || '',
      next_due: due ? due.toISOString().slice(0, 10) : 'N/A',
      verification: `${VERIFICATION_BAND_META[band].label} (${fmtDueLabel(days)})`,
      compliant: (r.status === 'active' && (band === 'valid' || band === 'expiring')) ? 'Yes' : 'No',
    }
  })

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', limit_kph: r.limit_kph ?? '', device_id: r.device_id || '',
      last_verified_at: r.last_verified_at || '', status: r.status || 'active',
      site: r.site || '', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const closeModal = () => { if (!saving) { setModalOpen(false); setEditing(null) } }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('Enter an asset number.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry && activeCountry !== 'All' ? activeCountry : null }
      const saved = editing ? await updateSpeedLimiter(editing.id, payload) : await createSpeedLimiter(payload)
      setRows((prev) => {
        const list = prev || []
        return editing ? list.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...list]
      })
      setModalOpen(false); setEditing(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the speed limiter.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDel) return
    setDeleting(true)
    try {
      await deleteSpeedLimiter(confirmDel.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDel.id))
      setConfirmDel(null)
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the speed limiter.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDel])

  const clearFilters = () => {
    setStatusFilter('all'); setBandFilter('all'); setSiteFilter(''); setAssetFilter('')
    setSearch(''); setFromDate(''); setToDate('')
  }
  const hasFilters = statusFilter !== 'all' || bandFilter !== 'all' || siteFilter || assetFilter || search || fromDate || toDate

  return (
    <div className="space-y-6">
      <PageHeader
        title="Speed Limiter Compliance"
        subtitle="Register the governed speed limiter fitted to every asset and audit fitment status, re-verification, and fleet coverage against GCC governor requirements."
        icon={Gauge}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'speed_limiters')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Speed Limiter Compliance', 'speed_limiters', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> Register limiter
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Speed limiters are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V153_SPEED_LIMITERS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Could not load speed limiters.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary text-sm shrink-0">Retry</button>
        </div>
      )}

      {/* Verification policy control (tunable, transparent) */}
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <CalendarClock size={15} className="text-sky-400" />
          <span>Re-verification pipeline derived from <span className="text-[var(--text-secondary)]">Last verified</span> + interval.</span>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--text-muted)]">Interval</span>
          <select className="input py-1.5" value={reverifyDays} onChange={(e) => setReverifyDays(Number(e.target.value))} aria-label="Re-verification interval">
            {REVERIFY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--text-muted)]">Expiring soon</span>
          <select className="input py-1.5" value={soonDays} onChange={(e) => setSoonDays(Number(e.target.value))} aria-label="Expiring soon window">
            {SOON_OPTIONS.map((d) => <option key={d} value={d}>Within {d}d</option>)}
          </select>
        </label>
        {!coverage.hasFleet && rows && rows.length > 0 && (
          <span className="text-xs text-[var(--text-muted)] ml-auto inline-flex items-center gap-1">
            <AlertTriangle size={12} className="text-amber-400" /> No fleet master data: coverage ratios unavailable.
          </span>
        )}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? 'N/A' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Fitment status distribution</h3>
          <div className="h-64">
            {rows && summary.total ? <Doughnut data={statusDonut} options={donutOpts} /> : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                {rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No speed limiters registered yet.'}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
            <CalendarClock size={15} className="text-sky-400" /> Verification pipeline
          </h3>
          <div className="h-64">
            {rows && summary.total ? <Bar data={bandBar} options={barOpts()} /> : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                {rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No speed limiters registered yet.'}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Governed set-speed distribution</h3>
          <div className="h-64">
            {rows && speedDist.length ? <Bar data={speedBar} options={barOpts()} /> : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                {rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No set-speeds recorded yet.'}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
            <MapPin size={15} className="text-sky-400" /> Active coverage by site
          </h3>
          <div className="h-64">
            {rows === null ? (
              <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
            ) : coverage.hasFleet && coverage.bySite.length ? (
              <Bar data={coverageBar} options={barOpts(100)} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-sm text-[var(--text-muted)] gap-2 text-center px-4">
                <MapPin size={22} className="opacity-60" />
                {coverage.hasFleet ? 'No sites to compare yet.' : 'Fleet master data unavailable, so coverage vs fleet cannot be computed.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Non-compliant priority list */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
            <ShieldAlert size={15} className="text-red-400" /> Non-compliant limiters
          </h3>
          {rows && <span className="text-xs text-[var(--text-muted)]">{nonCompliant.length} needing action</span>}
        </div>
        {rows === null ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
        ) : nonCompliant.length === 0 ? (
          <div className="h-32 flex flex-col items-center justify-center text-sm text-[var(--text-muted)] gap-2">
            <CheckCircle2 size={24} className="text-green-400" />
            {summary.total === 0 ? 'No speed limiters registered yet.' : 'Every registered limiter is compliant.'}
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-[var(--input-border)]/60">
            {nonCompliant.slice(0, 40).map(({ row: r, reason, band, daysToDue }) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--text-primary)] truncate font-mono">{r.asset_no || 'N/A'}</p>
                  <p className="text-xs text-[var(--text-muted)] truncate">{r.device_id || 'No device'}{r.site ? ` | ${r.site}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-[var(--text-muted)] hidden sm:inline">{fmtDueLabel(daysToDue)}</span>
                  <span className="text-sm font-semibold text-sky-400">{r.limit_kph == null || r.limit_kph === '' ? 'N/A' : `${r.limit_kph} km/h`}</span>
                  <span className={`badge text-[11px] px-2 py-0.5 rounded ${r.status === 'fault' ? STATUS_BADGE.fault : r.status === 'disabled' ? STATUS_BADGE.disabled : BAND_BADGE[band]}`}>{reason}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, device, site, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {SPEED_LIMITER_STATUSES.map((s) => <option key={s} value={s}>{SPEED_LIMITER_STATUS_META[s].label}</option>)}
          </select>
          <select className="input" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Verification">
            <option value="all">All verification</option>
            {VERIFICATION_BANDS.map((b) => <option key={b} value={b}>{VERIFICATION_BAND_META[b].label}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            Verified from
            <input type="date" className="input py-1.5" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="Verified from" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            to
            <input type="date" className="input py-1.5" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="Verified to" />
          </label>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Limit (km/h)', 'Device', 'Site', 'Last verified', 'Status', 'Verification'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
                <th className="px-4 py-3 font-semibold whitespace-nowrap">
                  <button onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]" title="Sort by next due">
                    Next due <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {summary.total === 0 && !missing ? (
                    <div className="flex flex-col items-center gap-3">
                      <Gauge size={26} className="opacity-60" />
                      <p>No speed limiters registered yet.</p>
                      <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={14} /> Register your first limiter</button>
                    </div>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No speed limiters match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const band = verificationBand(r, engineOpts)
                  const days = daysToNextDue(r, engineOpts)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.asset_no || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.limit_kph == null || r.limit_kph === '' ? 'N/A' : `${r.limit_kph}`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.device_id || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.last_verified_at)}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE[r.status]}`}>{SPEED_LIMITER_STATUS_META[r.status]?.label || r.status}</span></td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${BAND_BADGE[band]}`}>{VERIFICATION_BAND_META[band].label}</span></td>
                      <td className={`px-4 py-2.5 whitespace-nowrap ${days != null && days < 0 ? 'text-red-400' : days != null && days <= soonDays ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}>{fmtDueLabel(days)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDel(r)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-900/20" aria-label="Delete"><Trash2 size={14} /></button>
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

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onMouseDown={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Gauge size={18} className="text-[var(--brand-bright)]" />
                {editing ? 'Edit speed limiter' : 'Register speed limiter'}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="TRK-014" value={form.asset_no} onChange={(e) => set('asset_no', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">Limit (km/h)</label>
                  <input type="number" min="0" step="1" className="input w-full" placeholder="80" value={form.limit_kph} onChange={(e) => set('limit_kph', e.target.value)} />
                </div>
                <div>
                  <label className="label">Device ID</label>
                  <input className="input w-full" placeholder="SL-2026-00123" value={form.device_id} onChange={(e) => set('device_id', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" placeholder="Riyadh Depot" value={form.site} onChange={(e) => set('site', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">Last verified</label>
                  <input type="date" className="input w-full" value={form.last_verified_at} onChange={(e) => set('last_verified_at', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {SPEED_LIMITER_STATUSES.map((s) => <option key={s} value={s}>{SPEED_LIMITER_STATUS_META[s].label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Calibration notes, installer, certificate reference" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving...' : editing ? 'Save changes' : 'Register limiter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onMouseDown={() => !deleting && setConfirmDel(null)}>
          <div className="card w-full max-w-md" onMouseDown={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2"><Trash2 size={18} className="text-red-400" /> Delete speed limiter?</h2>
            <p className="text-sm text-[var(--text-muted)] mt-2">
              This permanently removes the limiter for asset <span className="font-semibold text-[var(--text-secondary)]">{confirmDel.asset_no || confirmDel.id}</span>. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDel(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
