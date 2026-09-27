/**
 * Weighbridge (route /weighbridge) - Weighbridge Tickets / Axle Weight. Captures
 * weighing events per asset: gross / tare / net weight and the legal gross
 * limit, then flags overweight vehicles. Overloading is a primary root cause of
 * accelerated tyre wear and casing failure, so this weight history is
 * org-isolated, country-scoped, and feeds tyre-life / CPK analytics.
 *
 * Runs on the `weighbridge_tickets` table (V177). Weight maths lives in
 * `src/lib/weighbridgeTickets.js`; filtering, the honest-null KPI set, the
 * per-asset load profile, the monthly tonnage trend and export rows live in
 * `src/lib/weighbridgeAnalytics.js`. This page only renders them.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, BarElement, LineElement, LineController, PointElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  Scale, Activity, Truck, ShieldAlert, Package, AlertTriangle, X, FileSpreadsheet, FileText,
  Plus, Pencil, Trash2, RotateCw, Percent, BarChart3,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listWeighbridgeTickets, createWeighbridgeTicket, updateWeighbridgeTicket, deleteWeighbridgeTicket,
} from '../lib/api/weighbridgeTickets'
import { netWeight, overloadKg, isOverweight } from '../lib/weighbridgeTickets'
import {
  TICKET_STATUSES, TICKET_STATUS_LABEL, NO_STATUS, isJudgeable, loadPct,
  filterTickets, weighbridgeKpis, assetLoadProfile, monthlyTonnage,
  WEIGHBRIDGE_EXPORT_COLUMNS, weighbridgeExportRows,
} from '../lib/weighbridgeAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { colorAt } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(BarElement, LineElement, LineController, PointElement, CategoryScale, LinearScale, Tooltip, Legend)

const EMPTY_FORM = {
  ticket_no: '', asset_no: '', driver_name: '', site: '', weighed_at: '',
  gross_weight_kg: '', tare_weight_kg: '', net_weight_kg: '', gross_limit_kg: '',
  cargo_type: '', status: '', notes: '',
}

const STATUS_TONE = {
  draft: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]',
  recorded: 'bg-sky-900/40 text-sky-300',
  overweight: 'bg-red-900/40 text-red-300',
  disputed: 'bg-amber-900/40 text-amber-300',
  cleared: 'bg-green-900/40 text-green-300',
}

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

const fmtKg = (v) => (v == null || v === '' ? 'N/A' : `${Math.round(Number(v)).toLocaleString()} kg`)
const fmtTonnes = (v) => (v == null ? 'N/A' : `${(Number(v) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} t`)
function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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

export default function Weighbridge() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [asOf, setAsOf] = useState(() => new Date())

  const [assetFilter, setAssetFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [loadFilter, setLoadFilter] = useState('')
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
      const data = await listWeighbridgeTickets({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setAsOf(new Date())
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load weighbridge tickets.'))
      setRows(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const failed = !!error || notProvisioned
  const na = rows === null
  const all = useMemo(() => rows || [], [rows])
  const assetOptions = useMemo(() => [...new Set(all.map((r) => r.asset_no).filter(Boolean))].sort(), [all])
  const siteOptions = useMemo(() => [...new Set(all.map((r) => String(r.site || '').trim()).filter(Boolean))].sort(), [all])

  const filtered = useMemo(() => filterTickets(all, {
    asset: assetFilter, status: statusFilter, site: siteFilter, load: loadFilter, from: fromDate, to: toDate, search,
  }), [all, assetFilter, statusFilter, siteFilter, loadFilter, fromDate, toDate, search])

  const kpi = useMemo(() => weighbridgeKpis(filtered, { now: asOf }), [filtered, asOf])
  const profile = useMemo(() => assetLoadProfile(filtered, 8), [filtered])
  const trend = useMemo(() => monthlyTonnage(filtered, { now: asOf }), [filtered, asOf])
  const overweightRows = useMemo(() => filtered.filter(isOverweight).sort((a, b) => overloadKg(b) - overloadKg(a)), [filtered])

  const hasFilters = !!(assetFilter || statusFilter || siteFilter || loadFilter || fromDate || toDate || search)
  const clearFilters = () => {
    setAssetFilter(''); setStatusFilter(''); setSiteFilter(''); setLoadFilter('')
    setFromDate(''); setToDate(''); setSearch('')
  }

  const v = (x) => (na ? 'N/A' : x)
  const kpis = [
    { label: 'Tickets', value: v(kpi.totalTickets.toLocaleString()), icon: Activity, sub: na ? null : `${kpi.last30Days} in the last 30 days` },
    { label: 'Total net weight', value: v(fmtTonnes(kpi.totalNetKg)), icon: Package, tone: 'text-sky-400' },
    { label: 'Average net load', value: v(fmtKg(kpi.avgNetKg)), icon: Truck },
    { label: 'Overweight tickets', value: v(kpi.overweightCount), icon: ShieldAlert, tone: kpi.overweightCount > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Overweight rate', value: v(kpi.overweightRate == null ? 'N/A' : `${kpi.overweightRate}%`), icon: Percent, tone: 'text-red-400', sub: na ? null : `${kpi.unjudgedTickets} tickets lack a gross or a limit` },
    { label: 'Largest overload', value: v(fmtKg(kpi.maxOverloadKg)), icon: AlertTriangle, tone: 'text-amber-400' },
    { label: 'Average overload', value: v(fmtKg(kpi.avgOverloadKg)), icon: AlertTriangle, tone: 'text-amber-400', sub: 'Across overweight tickets' },
    { label: 'Disputed tickets', value: v(kpi.disputedCount), icon: Scale, sub: na ? null : `${kpi.distinctAssets} assets weighed` },
  ]

  const exportRows = useMemo(() => weighbridgeExportRows(filtered, { fmtDate: fmtDateTime }), [filtered])
  const fileName = reportFileName('TyrePulse Weighbridge Tickets', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExcel = () => exportToExcel(exportRows, WEIGHBRIDGE_EXPORT_COLUMNS.map((c) => c[0]), WEIGHBRIDGE_EXPORT_COLUMNS.map((c) => c[1]), fileName)
  const doPdf = () => exportToPdf(exportRows, WEIGHBRIDGE_EXPORT_COLUMNS.map(([key, header]) => ({ key, header })), 'Weighbridge Tickets', fileName, 'landscape')

  const trendTickets = trend.reduce((s, m) => s + m.tickets, 0)
  const trendData = {
    labels: trend.map((m) => m.month),
    datasets: [
      { type: 'bar', label: 'Net tonnes', data: trend.map((m) => m.netTonnes), backgroundColor: colorAt(0), borderRadius: 3, yAxisID: 'y' },
      { type: 'line', label: 'Overweight tickets', data: trend.map((m) => m.overweight), borderColor: '#ef4444', backgroundColor: '#ef4444', tension: 0.3, yAxisID: 'y1' },
    ],
  }
  const trendOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: 'var(--text-muted)', boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
      y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Net tonnes', color: 'var(--text-muted)' }, ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' } },
      y1: { beginAtZero: true, position: 'right', title: { display: true, text: 'Overweight tickets', color: 'var(--text-muted)' }, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { display: false } },
    },
  }

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      ticket_no: r.ticket_no || '', asset_no: r.asset_no || '',
      driver_name: r.driver_name || '', site: r.site || '',
      weighed_at: toLocalInput(r.weighed_at), gross_weight_kg: r.gross_weight_kg ?? '',
      tare_weight_kg: r.tare_weight_kg ?? '', net_weight_kg: r.net_weight_kg ?? '',
      gross_limit_kg: r.gross_limit_kg ?? '', cargo_type: r.cargo_type || '',
      status: r.status || '', notes: r.notes || '',
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
        status: form.status || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateWeighbridgeTicket(editing.id, payload)
      else await createWeighbridgeTicket(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the ticket.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteWeighbridgeTicket(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the ticket.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const columns = useMemo(() => [
    { id: 'ticket', header: 'Ticket', accessorFn: (r) => r.ticket_no || '', size: 130, cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{row.original.ticket_no || 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 120, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || '', size: 140, cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.site || 'N/A'}</span> },
    { id: 'weighed_at', header: 'Weighed at', accessorFn: (r) => (r.weighed_at ? new Date(r.weighed_at).getTime() : -Infinity), size: 170, meta: { exportValue: (r) => fmtDateTime(r.weighed_at) }, cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDateTime(row.original.weighed_at)}</span> },
    { id: 'net', header: 'Net weight', accessorFn: (r) => netWeight(r) ?? -1, size: 120, meta: { align: 'right', exportValue: (r) => fmtKg(netWeight(r)) }, cell: ({ row }) => <span className="font-semibold tabular-nums text-[var(--text-primary)]">{fmtKg(netWeight(row.original))}</span> },
    { id: 'gross', header: 'Gross', accessorFn: (r) => (r.gross_weight_kg == null || r.gross_weight_kg === '' ? -1 : Number(r.gross_weight_kg)), size: 110, meta: { align: 'right', exportValue: (r) => fmtKg(r.gross_weight_kg) }, cell: ({ row }) => <span className="tabular-nums">{fmtKg(row.original.gross_weight_kg)}</span> },
    { id: 'limit', header: 'Limit', accessorFn: (r) => (r.gross_limit_kg == null || r.gross_limit_kg === '' ? -1 : Number(r.gross_limit_kg)), size: 110, meta: { align: 'right', exportValue: (r) => fmtKg(r.gross_limit_kg) }, cell: ({ row }) => <span className="tabular-nums">{fmtKg(row.original.gross_limit_kg)}</span> },
    {
      id: 'load', header: 'Load of limit', accessorFn: (r) => loadPct(r) ?? -1, size: 150, meta: { align: 'right', exportValue: (r) => (loadPct(r) == null ? 'N/A' : `${loadPct(r)}%`) },
      cell: ({ row }) => {
        const r = row.original
        if (!isJudgeable(r)) return <span className="text-[var(--text-muted)] text-xs">Cannot judge</span>
        const over = overloadKg(r)
        return over > 0
          ? <span className="inline-flex items-center gap-1 rounded-full bg-red-900/40 text-red-300 px-2 py-0.5 text-[11px] font-medium"><ShieldAlert size={11} aria-hidden="true" /> {loadPct(r)}%, {fmtKg(over)} over</span>
          : <span className="tabular-nums text-green-400 text-xs">{loadPct(r)}%, within limit</span>
      },
    },
    { id: 'cargo', header: 'Cargo', accessorFn: (r) => r.cargo_type || '', size: 120, cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.cargo_type || 'N/A'}</span> },
    {
      id: 'status', header: 'Status', accessorFn: (r) => TICKET_STATUS_LABEL[r.status] || r.status || '', size: 110,
      cell: ({ row }) => (row.original.status
        ? <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[row.original.status] || STATUS_TONE.draft}`}>{TICKET_STATUS_LABEL[row.original.status] || row.original.status}</span>
        : <span className="text-[var(--text-muted)]">N/A</span>),
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit ticket for ${row.original.asset_no || 'asset'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete ticket for ${row.original.asset_no || 'asset'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weighbridge Tickets"
        subtitle="Record gross, tare and net weights per asset, flag overweight vehicles, and keep a compliance trail: the load basis for tyre-life and reliability analytics."
        icon={Scale}
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
              <Plus size={14} aria-hidden="true" /> New ticket
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Weighbridge tickets are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Ask your administrator to enable weighbridge tickets, then refresh.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-red-300 font-medium">Could not load weighbridge tickets.</p>
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => <KpiTile key={k.label} {...k} />)}
      </div>
      {hasFilters && !na && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">These figures cover the {filtered.length} tickets matching the current filters.</p>
      )}

      {!na && overweightRows.length > 0 && (
        <div className="card border border-red-800/50">
          <h2 className="text-sm font-semibold text-red-300 mb-3 flex flex-wrap items-center gap-2">
            <ShieldAlert size={15} aria-hidden="true" /> Overweight vehicles need attention
            <span className="text-xs font-normal text-[var(--text-muted)]">{overweightRows.length} over the legal limit</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {overweightRows.slice(0, 24).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openEdit(r)}
                className="text-left rounded-lg border border-red-800/50 bg-red-900/15 px-3 py-2 min-h-[44px] hover:bg-red-900/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label={`Open ticket for ${r.asset_no}, ${fmtKg(overloadKg(r))} over the limit`}
              >
                <p className="text-xs text-[var(--text-muted)]">{r.asset_no}{r.ticket_no ? `, ${r.ticket_no}` : ''}</p>
                <p className="text-sm font-semibold text-red-300">{fmtKg(overloadKg(r))} over</p>
                <p className="text-[11px] text-[var(--text-muted)]">{fmtDateTime(r.weighed_at)}</p>
              </button>
            ))}
          </div>
          {overweightRows.length > 24 && <p className="text-xs text-[var(--text-muted)] mt-2">{overweightRows.length - 24} more are in the register below (filter Load: Overweight).</p>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><BarChart3 size={15} aria-hidden="true" /> Net tonnes and overweight tickets per month</h2>
          <div className="h-60">
            {na ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
              : trendTickets === 0 ? <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No dated tickets in the last 12 months.</p>
                : <Bar data={trendData} options={trendOpts} role="img" aria-label="Net tonnes and overweight tickets per month" />}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Truck size={15} aria-hidden="true" /> Asset load profile</h2>
          {na ? <div className="h-56 bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
            : profile.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No tickets to profile.</p> : (
              <ul className="divide-y divide-[var(--input-border)]/60">
                {profile.map((p) => (
                  <li key={p.asset} className="py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[var(--text-primary)]">{p.asset}</span>
                      <span className={`text-xs tabular-nums ${p.overweight ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>{p.overweight} of {p.tickets} over</span>
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      Average net {fmtKg(p.avgNetKg)}, worst overload {fmtKg(p.maxOverloadKg)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>

      <div className="card space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block"><span className="label">Search</span>
            <input className="input w-full min-h-[44px]" placeholder="Asset, ticket, driver, site, cargo" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label className="block"><span className="label">Asset</span>
            <select className="input w-full min-h-[44px]" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
              <option value="">All assets</option>
              {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select></label>
          <label className="block"><span className="label">Site</span>
            <select className="input w-full min-h-[44px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select></label>
          <label className="block"><span className="label">Status</span>
            <select className="input w-full min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {TICKET_STATUSES.map((s) => <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>)}
              <option value={NO_STATUS}>{NO_STATUS}</option>
            </select></label>
          <label className="block"><span className="label">Load</span>
            <select className="input w-full min-h-[44px]" value={loadFilter} onChange={(e) => setLoadFilter(e.target.value)}>
              <option value="">Any load</option>
              <option value="over">Overweight</option>
              <option value="within">Within limit</option>
              <option value="unknown">Cannot judge (missing gross or limit)</option>
            </select></label>
          <label className="block"><span className="label">Weighed from</span>
            <input type="date" className="input w-full min-h-[44px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label className="block"><span className="label">Weighed to</span>
            <input type="date" className="input w-full min-h-[44px]" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{na ? 'Not loaded' : `${filtered.length} of ${all.length} tickets`}</span>
        </div>
      </div>

      {failed ? (
        <div className="card text-center py-10 text-sm text-[var(--text-muted)]">Weighbridge tickets are unavailable.</div>
      ) : (
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={na}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          exportFileName={fileName}
          viewKey="weighbridge"
          initialPageSize={25}
          emptyMessage={all.length === 0 ? 'No tickets recorded yet. Record your first weighbridge ticket.' : 'No tickets match these filters.'}
        />
      )}

      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit ticket' : 'New weighbridge ticket'} size="lg">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Asset number *</span>
              <input className="input w-full" required placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} /></label>
            <label className="block"><span className="label">Ticket number (optional)</span>
              <input className="input w-full" placeholder="e.g. WB-2026-0182" value={form.ticket_no} maxLength={120} onChange={(e) => set('ticket_no', e.target.value)} /></label>
            <label className="block"><span className="label">Driver (optional)</span>
              <input className="input w-full" placeholder="Driver name" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} /></label>
            <label className="block"><span className="label">Weighed at</span>
              <input className="input w-full" type="datetime-local" value={form.weighed_at} onChange={(e) => set('weighed_at', e.target.value)} />
              <span className="block text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</span></label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block"><span className="label">Gross weight (kg)</span>
              <input className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="18000" value={form.gross_weight_kg} onChange={(e) => set('gross_weight_kg', e.target.value)} /></label>
            <label className="block"><span className="label">Tare weight (kg)</span>
              <input className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="7000" value={form.tare_weight_kg} onChange={(e) => set('tare_weight_kg', e.target.value)} /></label>
            <label className="block"><span className="label">Net weight (kg)</span>
              <input className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="gross minus tare" value={form.net_weight_kg} onChange={(e) => set('net_weight_kg', e.target.value)} />
              <span className="block text-[11px] text-[var(--text-muted)] mt-1">Leave blank to derive from gross minus tare.</span></label>
            <label className="block"><span className="label">Gross limit (kg)</span>
              <input className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="17000" value={form.gross_limit_kg} onChange={(e) => set('gross_limit_kg', e.target.value)} /></label>
            <label className="block"><span className="label">Cargo type (optional)</span>
              <input className="input w-full" placeholder="e.g. Aggregate" value={form.cargo_type} maxLength={200} onChange={(e) => set('cargo_type', e.target.value)} /></label>
            <label className="block"><span className="label">Status</span>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">None</option>
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>)}
              </select></label>
          </div>
          <label className="block"><span className="label">Site (optional)</span>
            <input className="input w-full" placeholder="e.g. Riyadh weighbridge" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} /></label>
          <label className="block"><span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. axle 2 near limit; recheck load distribution" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} /></label>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create ticket'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this ticket?"
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
          {confirmDelete?.asset_no || 'Ticket'}{confirmDelete?.ticket_no ? `, ${confirmDelete.ticket_no}` : ''}, {fmtKg(confirmDelete ? netWeight(confirmDelete) : null)} net, {fmtDateTime(confirmDelete?.weighed_at)}. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
