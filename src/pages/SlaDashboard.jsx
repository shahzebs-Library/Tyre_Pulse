/**
 * SlaDashboard (route /sla-dashboard) - SLA Dashboard. Tracks service-level
 * agreements across operational work (work orders, breakdown callouts,
 * deliveries, inspections, procurement, support tickets) so the fleet can
 * measure responsiveness, catch at-risk commitments before they breach, and
 * report compliance to customers and management.
 *
 * Runs on the `sla_records` table (V185). KPI strip, compliance by type and by
 * owner, a status mix chart, an attention list of every breached or at-risk
 * record, filters + search, a sortable EnterpriseTable register with a live
 * countdown, create/edit, delete, and Excel/PDF export. Breach rules live in
 * `src/lib/slaRecords.js`; every page figure in `src/lib/slaDashboardAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  ShieldCheck, CheckCircle2, AlertOctagon, Timer, Percent, Hourglass,
  AlertTriangle, Search, X, FileSpreadsheet, FileText, Plus, Pencil,
  Trash2, ListChecks, Flag, Clock, CalendarOff, UserCog,
} from 'lucide-react'
import { toUserMessage } from '../lib/safeError'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listSlaRecords, createSlaRecord, updateSlaRecord, deleteSlaRecord,
} from '../lib/api/slaRecords'
import {
  SLA_TYPES, SLA_PRIORITIES, SLA_STORED_STATUSES, SLA_DERIVED_STATUSES, SLA_STATUS_LABEL, EMPTY_SLA_FILTERS,
  decorateSla, filterSla, slaKpis, complianceByType, breachesByOwner, attentionList, ownerOptions,
  activeSlaFilterCount, slaExportRows, SLA_EXPORT_COLUMNS, fmtCountdown, titleCase, typeLabel,
} from '../lib/slaDashboardAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(ArcElement, Tooltip, Legend)

const EMPTY_FORM = {
  reference: '', sla_type: 'work_order', asset_no: '', priority: 'medium',
  target_hours: '', started_at: '', due_at: '', resolved_at: '',
  status: 'on_track', owner: '', notes: '',
}

// Semantic status colours: they carry meaning, and the label always names the status.
const STATUS_META = {
  met: { cls: 'bg-green-500/15 text-green-300 border border-green-500/40', color: '#22c55e' },
  on_track: { cls: 'bg-sky-500/15 text-sky-300 border border-sky-500/40', color: '#0ea5e9' },
  at_risk: { cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/40', color: '#f59e0b' },
  breached: { cls: 'bg-red-500/15 text-red-300 border border-red-500/40', color: '#ef4444' },
  cancelled: { cls: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]', color: '#64748b' },
  unknown: { cls: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]', color: '#64748b' },
}
const PRIORITY_META = {
  critical: 'bg-red-500/15 text-red-300 border border-red-500/40',
  high: 'bg-orange-500/15 text-orange-300 border border-orange-500/40',
  medium: 'bg-amber-500/15 text-amber-300 border border-amber-500/40',
  low: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]',
}
const ICON_BTN = 'inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
const ATTENTION_PREVIEW = 12

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
function fmtHours(v) {
  if (v == null) return 'N/A'
  return `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`
}
const toLocalInput = (v) => {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}
const rateBar = (rate) => (rate == null ? 'bg-[var(--text-dim)]' : rate >= 90 ? 'bg-green-500' : rate >= 70 ? 'bg-amber-500' : 'bg-red-500')

function Kpi({ label, value, icon: Icon, tone, sub, loading }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-3xl font-bold mt-1 tabular-nums ${tone}`}>
        {loading ? <span className="inline-block h-8 w-16 rounded bg-[var(--input-bg)] animate-pulse" aria-label="Loading" /> : (value ?? 'N/A')}
      </p>
      {sub && !loading && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p>}
    </div>
  )
}

function RateRow({ label, rate, detail }) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr_auto] sm:grid-cols-[8rem_1fr_3.5rem_8rem] items-center gap-3">
      <div className="text-sm text-[var(--text-secondary)] truncate" title={label}>{label}</div>
      <div className="h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
        {rate != null && <div className={`h-full ${rateBar(rate)} rounded-full`} style={{ width: `${Math.max(2, rate)}%` }} />}
      </div>
      <div className="text-right text-sm font-semibold text-[var(--text-primary)] tabular-nums">{rate == null ? 'N/A' : `${rate}%`}</div>
      <div className="hidden sm:block text-right text-xs text-[var(--text-muted)]">{detail}</div>
    </div>
  )
}

export default function SlaDashboard() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [filters, setFilters] = useState(EMPTY_SLA_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const [showAllAttention, setShowAllAttention] = useState(false)

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
      const data = await listSlaRecords({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      setNowMs(Date.now())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load SLA records.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Keep countdowns honest while the page is open: one clock tick a minute.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  const loading = rows === null
  const failed = Boolean(error) || notProvisioned
  const decorated = useMemo(() => decorateSla(rows || [], nowMs), [rows, nowMs])
  const kpi = useMemo(() => slaKpis(decorated), [decorated])
  const byType = useMemo(() => complianceByType(decorated), [decorated])
  const byOwner = useMemo(() => breachesByOwner(decorated), [decorated])
  const attention = useMemo(() => attentionList(decorated), [decorated])
  const owners = useMemo(() => ownerOptions(rows || []), [rows])
  const filtered = useMemo(() => filterSla(decorated, filters), [decorated, filters])
  const filterCount = activeSlaFilterCount(filters)
  const shownAttention = showAllAttention ? attention : attention.slice(0, ATTENTION_PREVIEW)

  const kv = (v) => (failed ? null : v)
  const kpis = [
    { label: 'Tracked SLAs', value: kv(kpi.total), icon: ListChecks, tone: 'text-[var(--text-primary)]', sub: failed ? null : `${kpi.decided} decided (met or breached)` },
    { label: 'Compliance', value: failed || kpi.complianceRate == null ? null : `${kpi.complianceRate}%`, icon: Percent, tone: 'text-sky-400', sub: failed ? null : kpi.complianceRate == null ? 'Nothing decided yet' : `${kpi.met} met of ${kpi.decided}` },
    { label: 'Breached', value: kv(kpi.breached), icon: AlertOctagon, tone: 'text-red-400', sub: failed ? null : `${kpi.openBreached} still open` },
    { label: 'At risk', value: kv(kpi.atRisk), icon: Timer, tone: 'text-amber-400', sub: 'Under 20% of the window left' },
    { label: 'Avg resolution', value: failed ? null : fmtHours(kpi.avgResolutionHours), icon: Hourglass, tone: 'text-violet-400', sub: failed ? null : `${kpi.resolutionSample} resolved with a start time` },
    { label: 'No due date', value: kv(kpi.noDueDate), icon: CalendarOff, tone: kpi.noDueDate ? 'text-orange-400' : 'text-green-400', sub: 'Open SLAs that cannot be judged' },
  ]

  const doExport = async (kind) => {
    const out = slaExportRows(filtered)
    const keys = SLA_EXPORT_COLUMNS.map(([k]) => k)
    const headers = SLA_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse SLA Dashboard')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name)
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'SLA Dashboard', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      reference: r.reference || '', sla_type: r.sla_type || 'work_order',
      asset_no: r.asset_no || '', priority: r.priority || 'medium',
      target_hours: r.target_hours ?? '', started_at: toLocalInput(r.started_at),
      due_at: toLocalInput(r.due_at), resolved_at: toLocalInput(r.resolved_at),
      status: r.status || 'on_track', owner: r.owner || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.reference.trim()) { setFormError('A reference is required.'); return }
    if (form.target_hours !== '' && Number(form.target_hours) < 0) { setFormError('Target hours cannot be negative.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        target_hours: form.target_hours === '' ? null : form.target_hours,
        started_at: form.started_at || null,
        due_at: form.due_at || null,
        resolved_at: form.resolved_at || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateSlaRecord(editing.id, payload)
      else await createSlaRecord(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the SLA record.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteSlaRecord(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not delete the SLA record.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const columns = useMemo(() => [
    { id: 'reference', header: 'Reference', accessorFn: (r) => r.reference || '', size: 150, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'type', header: 'Type', accessorFn: (r) => r._typeLabel, size: 120 },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 110, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'priority', header: 'Priority', accessorFn: (r) => SLA_PRIORITIES.indexOf(r.priority), size: 100,
      cell: ({ row }) => <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${PRIORITY_META[row.original.priority] || PRIORITY_META.medium}`}>{titleCase(row.original.priority)}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r._statusLabel, size: 120,
      cell: ({ row }) => <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${(STATUS_META[row.original._status] || STATUS_META.unknown).cls}`}>{row.original._statusLabel}</span>,
    },
    { id: 'due', header: 'Due', accessorFn: (r) => (r.due_at ? new Date(r.due_at).getTime() : null), size: 170, sortUndefined: 'last', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.due_at)}</span> },
    {
      id: 'remaining', header: 'Time remaining', accessorFn: (r) => (r._open ? r._remaining : null), size: 150, sortUndefined: 'last',
      cell: ({ row }) => {
        const r = row.original
        if (r._status === 'met') return <span className="text-green-400">{r._resolution == null ? 'Met' : `Met in ${fmtHours(r._resolution)}`}</span>
        if (r._open && r._remaining != null) {
          return <span className={r._remaining < 0 ? 'text-red-400 font-medium' : r._status === 'at_risk' ? 'text-amber-400' : 'text-[var(--text-secondary)]'}>{fmtCountdown(r._remaining)}</span>
        }
        return <span className="text-[var(--text-muted)]">N/A</span>
      },
    },
    { id: 'owner', header: 'Owner', accessorFn: (r) => r.owner || '', size: 140, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className={`${ICON_BTN} hover:text-[var(--text-primary)]`} aria-label={`Edit SLA ${row.original.reference || ''}`}><Pencil size={15} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete SLA ${row.original.reference || ''}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])

  const statusCounts = SLA_DERIVED_STATUSES.map((s) => filtered.filter((r) => r._status === s).length)
  const statusChart = {
    labels: SLA_DERIVED_STATUSES.map((s) => SLA_STATUS_LABEL[s]),
    datasets: [{ data: statusCounts, backgroundColor: SLA_DERIVED_STATUSES.map((s) => STATUS_META[s].color), borderWidth: 0 }],
  }
  const statusOpts = { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12 } } } }
  const unavailableText = 'Unavailable: SLA records could not be loaded.'

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLA Dashboard"
        subtitle="Track service-level agreements across work orders, breakdowns, deliveries, inspections, procurement and support. Catch at-risk commitments before they breach and report compliance."
        icon={ShieldCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> New SLA
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">SLA tracking is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V185_SLA_RECORDS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-red-300 font-medium">Could not load SLA records.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error} The figures below are unavailable until the register loads.</p>
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px]" disabled={refreshing}>Retry</button>
        </div>
      )}

      {notice && (
        <div className="card border border-amber-500/40 flex items-start justify-between gap-3" role="status">
          <p className="text-sm text-amber-300">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="card lg:col-span-2" aria-labelledby="sla-type-heading">
          <h2 id="sla-type-heading" className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex flex-wrap items-center gap-2">
            <Flag size={15} aria-hidden="true" /> Compliance by SLA type
            {!failed && byType[0] && byType[0].breached > 0 && (
              <span className="text-xs font-normal text-red-300">Worst: {byType[0].label} ({byType[0].breached} breached)</span>
            )}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mb-3">Met divided by met plus breached. N/A until something of that type is decided.</p>
          {loading ? (
            <div className="h-20 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : failed ? (
            <p className="text-sm text-[var(--text-muted)]">{unavailableText}</p>
          ) : byType.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No SLA records yet.</p>
          ) : (
            <div className="space-y-2.5">
              {byType.map((t) => (
                <RateRow key={t.sla_type} label={t.label} rate={t.complianceRate} detail={`${t.total} total${t.breached ? `, ${t.breached} breached` : ''}`} />
              ))}
            </div>
          )}
        </section>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><ShieldCheck size={15} aria-hidden="true" /> Status mix</h2>
          <div className="h-56">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{unavailableText}</div>
                : filtered.length ? (
                  <div className="h-full" role="img" aria-label={SLA_DERIVED_STATUSES.map((s, i) => `${SLA_STATUS_LABEL[s]} ${statusCounts[i]}`).join(', ')}>
                    <Doughnut data={statusChart} options={statusOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No SLA records in this view.</div>}
          </div>
        </div>
      </div>

      <section className="card" aria-labelledby="sla-owner-heading">
        <h2 id="sla-owner-heading" className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><UserCog size={15} aria-hidden="true" /> Compliance by owner</h2>
        <p className="text-xs text-[var(--text-muted)] mb-3">Owners with at least one decided SLA, most breaches first.</p>
        {loading ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : failed ? (
          <p className="text-sm text-[var(--text-muted)]">{unavailableText}</p>
        ) : byOwner.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No SLA has been met or breached yet.</p>
        ) : (
          <div className="space-y-2.5">
            {byOwner.map((o) => (
              <RateRow key={o.owner} label={o.owner} rate={o.complianceRate} detail={`${o.met} met, ${o.breached} breached`} />
            ))}
          </div>
        )}
      </section>

      {!loading && !failed && attention.length > 0 && (
        <section className="card border border-amber-500/40" aria-labelledby="sla-attention-heading">
          <h2 id="sla-attention-heading" className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex flex-wrap items-center gap-2">
            <AlertTriangle size={15} className="text-amber-400" aria-hidden="true" /> Needs attention
            <span className="text-xs font-normal text-[var(--text-muted)]">({attention.length} breached or at risk)</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {shownAttention.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openEdit(r)}
                className="text-left rounded-lg border border-[var(--input-border)] px-3 py-2 min-h-[44px] hover:bg-[var(--input-bg)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{r.reference || 'N/A'}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_META[r._status].cls}`}>{r._statusLabel}</span>
                </span>
                <span className="block text-xs text-[var(--text-muted)] mt-0.5">{typeLabel(r.sla_type)}{r.asset_no ? `, ${r.asset_no}` : ''}</span>
                <span className={`text-xs mt-1 flex items-center gap-1 ${r._status === 'breached' ? 'text-red-300' : 'text-amber-300'}`}>
                  <Clock size={12} aria-hidden="true" /> {r.resolved_at ? 'Resolved late' : fmtCountdown(r._remaining)}
                </span>
              </button>
            ))}
          </div>
          {attention.length > ATTENTION_PREVIEW && (
            <button type="button" onClick={() => setShowAllAttention((v) => !v)} className="btn-secondary text-sm mt-3 min-h-[44px]" aria-expanded={showAllAttention}>
              {showAllAttention ? 'Show fewer' : `Show all ${attention.length}`}
            </button>
          )}
        </section>
      )}

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,2fr)_1fr_1fr_1fr_1fr] gap-3 items-end">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Search</span>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" placeholder="Reference, asset, owner, notes" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Type</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.type} onChange={(e) => setFilter('type', e.target.value)}>
              <option value="">All types</option>
              {SLA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Status</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {SLA_DERIVED_STATUSES.map((s) => <option key={s} value={s}>{SLA_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Priority</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)}>
              <option value="">All priorities</option>
              {SLA_PRIORITIES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Owner</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.owner} onChange={(e) => setFilter('owner', e.target.value)}>
              <option value="">All owners</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <span className="text-xs text-[var(--text-muted)]" aria-live="polite">{filtered.length} of {kpi.total} records</span>
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_SLA_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={loading}
        enableGlobalFilter={false}
        enableExport={false}
        initialPageSize={25}
        viewKey="sla-records"
        onRowClick={(r) => openEdit(r)}
        emptyMessage={
          failed ? 'SLA records are unavailable.'
            : kpi.total === 0 ? 'No SLA records yet. Create your first tracked SLA.'
              : 'No records match these filters.'
        }
      />

      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit SLA record' : 'New SLA record'} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Reference <span className="text-red-400" aria-hidden="true">*</span></span>
              <input className="input w-full min-h-[44px]" placeholder="e.g. WO-2048 or TICKET-119" value={form.reference} maxLength={200} required onChange={(e) => set('reference', e.target.value)} />
            </label>
            <label className="block"><span className="label">Type</span>
              <select className="input w-full min-h-[44px]" value={form.sla_type} onChange={(e) => set('sla_type', e.target.value)}>
                {SLA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block"><span className="label">Asset (optional)</span>
              <input className="input w-full min-h-[44px]" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </label>
            <label className="block"><span className="label">Priority</span>
              <select className="input w-full min-h-[44px]" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                {SLA_PRIORITIES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Status</span>
              <select className="input w-full min-h-[44px]" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {SLA_STORED_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Target hours</span>
              <input className="input w-full min-h-[44px]" type="number" step="0.5" min="0" placeholder="e.g. 24" value={form.target_hours} onChange={(e) => set('target_hours', e.target.value)} />
              <span className="block text-[11px] text-[var(--text-muted)] mt-1">The agreed resolution window. Drives the at-risk threshold.</span>
            </label>
            <label className="block"><span className="label">Owner (optional)</span>
              <input className="input w-full min-h-[44px]" placeholder="e.g. Riyadh workshop" value={form.owner} maxLength={200} onChange={(e) => set('owner', e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block"><span className="label">Started at (optional)</span>
              <input className="input w-full min-h-[44px]" type="datetime-local" value={form.started_at} onChange={(e) => set('started_at', e.target.value)} />
            </label>
            <label className="block"><span className="label">Due at (optional)</span>
              <input className="input w-full min-h-[44px]" type="datetime-local" value={form.due_at} onChange={(e) => set('due_at', e.target.value)} />
            </label>
            <label className="block"><span className="label">Resolved at (optional)</span>
              <input className="input w-full min-h-[44px]" type="datetime-local" value={form.resolved_at} onChange={(e) => set('resolved_at', e.target.value)} />
            </label>
          </div>
          <label className="block"><span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="Context, escalation history, root cause" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </label>

          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create SLA'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this SLA record?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete.reference || 'Record'}, {typeLabel(confirmDelete.sla_type)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
