/**
 * FuelTheftAlerts (route /fuel-theft-alerts) - Fuel Theft / Fuel Anomaly Alerts.
 * Captures detected fuel-level drops and refuel discrepancies per asset: the
 * investigation queue for fuel loss, one of the largest fleet operating costs
 * after tyres. Every alert is org-isolated and country-scoped, carries a
 * severity and an investigation status, and quantifies the estimated financial
 * loss (drop litres x fuel price, or a stored figure).
 *
 * Runs on the `fuel_theft_alerts` table (V180). Real data only: KPI strip,
 * severity and status breakdowns, repeat-asset watchlist, findings, a sortable
 * register (EnterpriseTable), search + filters, create/edit/delete, Excel/PDF
 * export, and loading / empty / error+Retry / not-provisioned states.
 *
 * Loss maths lives in src/lib/fuelTheftAlerts.js; KPI, filter, ageing and
 * export shaping in src/lib/fuelTheftAlertsAnalytics.js. Losses in different
 * currencies are never added together.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Fuel, ShieldAlert, TrendingDown, AlertTriangle, Search, X, FileSpreadsheet,
  FileText, Plus, Pencil, Trash2, RefreshCw, Lightbulb, Hourglass, Repeat2,
  Droplet, Loader2, Save, CheckCircle2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listFuelTheftAlerts, createFuelTheftAlert, updateFuelTheftAlert, deleteFuelTheftAlert,
} from '../lib/api/fuelTheftAlerts'
import { estimatedLoss } from '../lib/fuelTheftAlerts'
import {
  SEVERITY_KEYS, STATUS_KEYS, titleCase, enrichAlerts, filterAlerts, buildAlertKpis,
  buildAlertInsights, severityBreakdown, statusBreakdown, repeatAssets,
  alertExportRows, ALERT_EXPORT_COLUMNS,
} from '../lib/fuelTheftAlertsAnalytics'
import { compareValues } from '../lib/consoleTable'
import { formatCurrency } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { isMissingRelation } from '../lib/api/_client'

const LIST_CAP = 500 // listFuelTheftAlerts returns the newest 500 alerts.

const EMPTY_FORM = {
  alert_no: '', asset_no: '', driver_name: '', location: '', detected_at: '',
  drop_litres: '', expected_litres: '', fuel_price_per_litre: '', estimated_loss: '',
  severity: 'medium', status: 'open', resolution: '', notes: '',
}

// Semantic severity / status colours. The text label always accompanies them.
const SEVERITY_BADGE = {
  low: 'bg-sky-500/15 text-sky-500 border border-sky-500/40',
  medium: 'bg-amber-500/15 text-amber-500 border border-amber-500/40',
  high: 'bg-orange-500/15 text-orange-500 border border-orange-500/40',
  critical: 'bg-red-500/15 text-red-500 border border-red-500/40',
}
const SEVERITY_BAR = { critical: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-amber-500', low: 'bg-sky-500' }
const STATUS_BADGE = {
  open: 'bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--input-border)]',
  investigating: 'bg-indigo-500/15 text-indigo-500 border border-indigo-500/40',
  confirmed: 'bg-red-500/15 text-red-500 border border-red-500/40',
  dismissed: 'bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]',
  resolved: 'bg-green-500/15 text-green-500 border border-green-500/40',
}

const ICON_BTN = 'inline-flex items-center justify-center h-11 w-11 sm:h-9 sm:w-9 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (v === null || v === undefined || v === '' ? undefined : v)
const fmtLitres = (v) => (v == null ? 'N/A' : `${Number(v).toLocaleString()} L`)

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
// datetime-local wants LOCAL wall time; toISOString would shift it to UTC.
function toLocalInput(v) {
  const d = v ? new Date(v) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums break-words ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function FuelTheftAlerts() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const [assetFilter, setAssetFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listFuelTheftAlerts({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      const t = new Date()
      setUpdatedAt(t); setNow(t.getTime())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else setError(toUserMessage(err, 'Could not load fuel theft alerts.'))
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const all = useMemo(() => rows || [], [rows])
  const loading = rows === null && !error
  const failedEmpty = rows === null && !!error
  const currency = activeCurrency || ''

  const kpi = useMemo(() => buildAlertKpis(all, now, currency), [all, now, currency])
  const insights = useMemo(() => buildAlertInsights(all, now, currency), [all, now, currency])
  const severities = useMemo(() => severityBreakdown(all), [all])
  const statuses = useMemo(() => statusBreakdown(all), [all])
  // Top 12 repeat assets: a watchlist, not the register.
  const repeat = useMemo(() => repeatAssets(all, currency).slice(0, 12), [all, currency])

  const fmtMoney = useCallback((v, cur) => (v == null ? 'N/A' : formatCurrency(v, cur || currency, 0)), [currency])
  const fmtLoss = (loss) => (loss.total != null
    ? fmtMoney(loss.total, loss.currency)
    : loss.mixed ? loss.totals.map((t) => fmtMoney(t.total, t.currency)).join(' + ') : 'N/A')

  const assetOptions = useMemo(() => [...new Set(all.map((r) => r.asset_no).filter(Boolean))].sort(), [all])

  const filtered = useMemo(() => filterAlerts(all, {
    asset: assetFilter, status: statusFilter, severity: severityFilter, openOnly, from, to, search,
  }), [all, assetFilter, statusFilter, severityFilter, openOnly, from, to, search])
  const register = useMemo(
    () => enrichAlerts(filtered, now, currency).sort((a, b) => (b.detectedTime ?? -Infinity) - (a.detectedTime ?? -Infinity)),
    [filtered, now, currency],
  )

  const kpis = [
    { label: 'Total alerts', value: kpi.total.toLocaleString(), icon: Fuel, tone: 'text-[var(--text-primary)]', sub: kpi.confirmed ? `${kpi.confirmed} confirmed` : null },
    { label: 'Open', value: kpi.open.toLocaleString(), icon: AlertTriangle, tone: 'text-amber-500', sub: kpi.staleOpen ? `${kpi.staleOpen} older than 7 days` : null },
    { label: 'Critical open', value: kpi.criticalOpen.toLocaleString(), icon: ShieldAlert, tone: kpi.criticalOpen ? 'text-red-500' : 'text-[var(--text-primary)]' },
    { label: 'Estimated loss', value: kpi.loss.total != null ? fmtMoney(kpi.loss.total, kpi.loss.currency) : 'N/A', icon: TrendingDown, tone: 'text-orange-500', sub: kpi.loss.mixed ? `Mixed: ${fmtLoss(kpi.loss)}` : kpi.unknownLoss ? `${kpi.unknownLoss} alert(s) without a loss figure` : null },
    { label: 'Litres lost', value: kpi.litresLost == null ? 'N/A' : fmtLitres(Math.round(kpi.litresLost)), icon: Droplet, tone: 'text-sky-500' },
    { label: 'Oldest open alert', value: kpi.oldestOpenDays == null ? 'N/A' : `${kpi.oldestOpenDays} day(s)`, icon: Hourglass, tone: kpi.oldestOpenDays != null && kpi.oldestOpenDays > 7 ? 'text-red-500' : 'text-[var(--text-primary)]' },
  ]

  const exportRows = useMemo(() => alertExportRows(register, now, currency), [register, now, currency])
  const scopeLabel = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
  const doExcel = async () => {
    setActionError('')
    try {
      await exportToExcel(exportRows, ALERT_EXPORT_COLUMNS.map((c) => c.key), ALERT_EXPORT_COLUMNS.map((c) => c.header), reportFileName('Fuel Theft Alerts', scopeLabel))
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    setActionError('')
    try {
      await exportToPdf(exportRows, ALERT_EXPORT_COLUMNS, `Fuel Theft Alerts (${scopeLabel})`, reportFileName('Fuel Theft Alerts', scopeLabel), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm({ ...EMPTY_FORM, currency: activeCurrency }); setFormError(''); setShowModal(true)
  }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      alert_no: r.alert_no || '', asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      location: r.location || '',
      detected_at: toLocalInput(r.detected_at),
      drop_litres: r.drop_litres ?? '', expected_litres: r.expected_litres ?? '',
      fuel_price_per_litre: r.fuel_price_per_litre ?? '', estimated_loss: r.estimated_loss ?? '',
      severity: r.severity || 'medium', status: r.status || 'open',
      resolution: r.resolution || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const livePreviewLoss = estimatedLoss(form)

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        currency: form.currency || activeCurrency,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateFuelTheftAlert(editing.id, payload)
      else await createFuelTheftAlert(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the alert.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, activeCurrency, load])

  const closeDelete = () => { if (!deleting) { setConfirmDelete(null); setDeleteError('') } }
  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setDeleteError('')
    try {
      await deleteFuelTheftAlert(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete the alert.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setAssetFilter(''); setStatusFilter(''); setSeverityFilter(''); setOpenOnly(false); setFrom(''); setTo(''); setSearch('') }
  const hasFilters = assetFilter || statusFilter || severityFilter || openOnly || from || to || search

  const columns = useMemo(() => [
    { id: 'alert_no', header: 'Alert #', accessorFn: (r) => blank(r.alert_no), sortingFn: valueSort, sortUndefined: 'last', size: 120, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    {
      id: 'asset', header: 'Asset', accessorFn: (r) => blank(r.asset_no), sortingFn: valueSort, sortUndefined: 'last', size: 150,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="font-medium text-[var(--text-primary)] truncate">{row.original.asset_no || 'N/A'}</p>
          {(row.original.driver_name || row.original.location) && <p className="text-[11px] text-[var(--text-muted)] truncate">{[row.original.driver_name, row.original.location].filter(Boolean).join(' | ')}</p>}
        </div>
      ),
    },
    { id: 'detected', header: 'Detected', accessorFn: (r) => r.detectedTime ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 170, cell: ({ row }) => <span className="text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(row.original.detected_at)}</span> },
    {
      id: 'drop', header: 'Drop', accessorFn: (r) => r.dropValue ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 120, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
          {fmtLitres(row.original.dropValue)}
          {row.original.excessLitres != null && row.original.excessLitres > 0 && <span className="block text-[10px] text-[var(--text-muted)]">{row.original.excessLitres.toLocaleString()} L over expected</span>}
        </span>
      ),
    },
    {
      id: 'loss', header: 'Est. loss', accessorFn: (r) => r.loss ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 130, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums whitespace-nowrap">
          <span className="font-semibold text-orange-500">{fmtMoney(row.original.loss, row.original.cur)}</span>
          {row.original.basis === 'stored' && <span className="block text-[10px] text-[var(--text-muted)]">recorded figure</span>}
        </span>
      ),
    },
    {
      id: 'severity', header: 'Severity', accessorFn: (r) => (r.sev ? SEVERITY_KEYS.length - SEVERITY_KEYS.indexOf(r.sev) : undefined), sortingFn: valueSort, sortUndefined: 'last', size: 110,
      cell: ({ row }) => row.original.sev ? <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${SEVERITY_BADGE[row.original.sev] || SEVERITY_BADGE.medium}`}>{titleCase(row.original.sev)}</span> : <span className="text-[var(--text-muted)]">N/A</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => (r.st ? titleCase(r.st) : undefined), sortingFn: valueSort, sortUndefined: 'last', size: 130,
      cell: ({ row }) => row.original.st ? <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[row.original.st] || STATUS_BADGE.open}`}>{titleCase(row.original.st)}</span> : <span className="text-[var(--text-muted)]">N/A</span>,
    },
    { id: 'age', header: 'Open for', accessorFn: (r) => r.ageDays ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 100, meta: { align: 'right' }, cell: ({ row }) => <span className={`tabular-nums ${row.original.ageDays != null && row.original.ageDays > 7 ? 'text-red-500 font-medium' : 'text-[var(--text-secondary)]'}`}>{row.original.open ? (row.original.ageDays == null ? 'N/A' : `${row.original.ageDays} d`) : 'Closed'}</span> },
    {
      id: 'actions', header: '', enableSorting: false, size: 100, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit alert for ${row.original.asset_no}`}><Pencil size={14} /></button>
          <button type="button" onClick={() => { setDeleteError(''); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-500`} aria-label={`Delete alert for ${row.original.asset_no}`}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ], [fmtMoney, openEdit])

  const sevMax = Math.max(1, ...severities.map((s) => s.count))
  const stMax = Math.max(1, ...statuses.map((s) => s.count))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fuel Theft Alerts"
        subtitle="Detected fuel-level drops and refuel discrepancies per asset: triage, investigate, and quantify fuel loss across the fleet."
        icon={Fuel}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!register.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!register.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> Log alert
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Fuel theft alerting is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V180_FUEL_THEFT_ALERTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[var(--text-primary)] font-medium">Could not load fuel theft alerts.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-500/40 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)] flex-1">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <section aria-label="Fuel theft figures">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {kpis.map((k) => <Kpi key={k.label} {...k} value={rows === null ? 'N/A' : k.value} sub={rows === null ? null : k.sub} />)}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-2">
          Figures cover all {kpi.total.toLocaleString()} alert(s) in {scopeLabel}. Filters below narrow the register only.
          {rows && rows.length >= LIST_CAP ? ` Only the newest ${LIST_CAP} alerts are loaded, so older ones are not counted.` : ''}
        </p>
      </section>

      {!loading && insights.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2"><Lightbulb size={15} className="text-amber-500" aria-hidden="true" /> Findings</h2>
          <ul className="space-y-1.5">
            {insights.map((s) => (
              <li key={s} className="text-sm text-[var(--text-secondary)] flex items-start gap-2">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" /> {s}
              </li>
            ))}
          </ul>
          {kpi.open > 0 && (
            <button type="button" onClick={() => setOpenOnly(true)} className="btn-secondary text-sm mt-3 min-h-[44px] sm:min-h-0">Show the {kpi.open} open alert(s)</button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><ShieldAlert size={15} aria-hidden="true" /> By severity</h2>
          {loading ? <div className="h-28 bg-[var(--input-bg)] rounded animate-pulse" /> : kpi.total === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No alerts logged yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {severities.map((s) => (
                <li key={s.key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <button type="button" onClick={() => setSeverityFilter(s.key)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline" aria-label={`Filter register to ${s.label} severity`}>{s.label}</button>
                    <span className="tabular-nums font-semibold text-[var(--text-primary)]">{s.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                    <div className={`h-full rounded-full ${SEVERITY_BAR[s.key]}`} style={{ width: `${(s.count / sevMax) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><CheckCircle2 size={15} aria-hidden="true" /> Investigation status</h2>
          {loading ? <div className="h-28 bg-[var(--input-bg)] rounded animate-pulse" /> : kpi.total === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No alerts logged yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {statuses.map((s) => (
                <li key={s.key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <button type="button" onClick={() => setStatusFilter(s.key)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline" aria-label={`Filter register to ${s.label}`}>{s.label}</button>
                    <span className="tabular-nums font-semibold text-[var(--text-primary)]">{s.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full bg-[var(--text-muted)]" style={{ width: `${(s.count / stMax) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Repeat2 size={15} aria-hidden="true" /> Repeat assets</h2>
          {loading ? <div className="h-28 bg-[var(--input-bg)] rounded animate-pulse" /> : repeat.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{kpi.total === 0 ? 'No alerts logged yet.' : 'No asset has more than one alert.'}</p>
          ) : (
            <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {repeat.map((a) => (
                <li key={a.asset_no}>
                  <button type="button" onClick={() => setAssetFilter(a.asset_no)} className="w-full text-left flex items-center justify-between rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 min-h-[44px] hover:bg-[var(--input-bg)]" aria-label={`Filter register to asset ${a.asset_no}`}>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[var(--text-primary)] truncate">{a.asset_no}</span>
                      <span className="block text-[11px] text-[var(--text-muted)]">{a.alerts} alerts | {a.open} open</span>
                    </span>
                    <span className="text-sm font-semibold text-orange-500 tabular-nums ml-2 text-right">{fmtLoss(a.loss)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="ft-search" className="sr-only">Search alerts</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="ft-search" className="input pl-9 w-full" placeholder="Search alert #, asset, driver, location, notes..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input w-full sm:w-auto" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input w-full sm:w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_KEYS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <select className="input w-full sm:w-auto" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
            <option value="">All severities</option>
            {SEVERITY_KEYS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="ft-from" className="text-xs text-[var(--text-muted)]">Detected from</label>
          <input id="ft-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label htmlFor="ft-to" className="text-xs text-[var(--text-muted)]">to</label>
          <input id="ft-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] min-h-[44px] cursor-pointer">
            <input type="checkbox" className="h-4 w-4" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Open only
          </label>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{register.length} of {kpi.total}</span>
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={register}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={failedEmpty ? error : null}
        onRetry={load}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        viewKey="fuel-theft-alerts"
        initialPageSize={25}
        emptyMessage={notProvisioned ? 'Fuel theft alerting is not enabled yet.' : all.length === 0 ? 'No alerts logged yet. Log your first alert.' : 'No alerts match these filters.'}
      />

      {showModal && (
        <Modal open onClose={closeModal} size="lg" title={editing ? 'Edit alert' : 'Log fuel theft alert'}>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="ft-asset">Asset number *</label>
                <input id="ft-asset" className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} required onChange={(e) => set('asset_no', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="ft-alertno">Alert # (optional)</label>
                <input id="ft-alertno" className="input w-full" placeholder="e.g. FA-2026-0117" value={form.alert_no} maxLength={60} onChange={(e) => set('alert_no', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="ft-driver">Driver (optional)</label>
                <input id="ft-driver" className="input w-full" placeholder="e.g. A. Rahman" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="ft-location">Location (optional)</label>
                <input id="ft-location" className="input w-full" placeholder="e.g. Riyadh, Ring Rd" value={form.location} maxLength={200} onChange={(e) => set('location', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="ft-detected">Detected at</label>
                <input id="ft-detected" className="input w-full" type="datetime-local" value={form.detected_at} onChange={(e) => set('detected_at', e.target.value)} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="ft-sev">Severity</label>
                  <select id="ft-sev" className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                    {SEVERITY_KEYS.slice().reverse().map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="ft-status">Status</label>
                  <select id="ft-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUS_KEYS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                ['drop_litres', 'Drop (L)', '120'],
                ['expected_litres', 'Expected (L)', '20'],
                ['fuel_price_per_litre', 'Price / L', '2.33'],
                ['estimated_loss', 'Est. loss', 'auto'],
              ].map(([k, label, ph]) => (
                <div key={k}>
                  <label className="label" htmlFor={`ft-${k}`}>{label}</label>
                  <input id={`ft-${k}`} className="input w-full" type="number" step="0.01" min="0" inputMode="decimal" placeholder={ph} value={form[k]} onChange={(e) => set(k, e.target.value)} />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-muted)]" aria-live="polite">
              Loss used in reports: <span className="font-semibold text-[var(--text-primary)]">{livePreviewLoss == null ? 'Not enough data' : fmtMoney(livePreviewLoss, form.currency || currency)}</span>. Drop x price is used when both are set, otherwise the recorded loss.
            </p>
            <div>
              <label className="label" htmlFor="ft-resolution">Resolution (optional)</label>
              <input id="ft-resolution" className="input w-full" placeholder="e.g. confirmed siphoning, driver counselled" value={form.resolution} maxLength={8000} onChange={(e) => set('resolution', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ft-notes">Notes (optional)</label>
              <textarea id="ft-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. tank level dropped 120 L overnight while parked" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
            </div>

            {formError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px] sm:min-h-0" disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60 min-h-[44px] sm:min-h-0" disabled={saving}>
                {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
                {saving ? 'Saving...' : editing ? 'Save changes' : 'Log alert'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={closeDelete}
          size="sm"
          title="Delete this alert?"
          footer={
            <>
              <button type="button" onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                {deleting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <p className="text-sm text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{confirmDelete.asset_no || 'Alert'}</span> | {fmtDateTime(confirmDelete.detected_at)} | {fmtMoney(estimatedLoss(confirmDelete), confirmDelete.currency)}. This cannot be undone.
          </p>
          {deleteError && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-500 mt-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {deleteError}
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}
