/**
 * FuelTheftAlerts (route /fuel-theft-alerts) — Fuel Theft / Fuel Anomaly Alerts.
 * Captures detected fuel-level drops and refuel discrepancies per asset — the
 * investigation queue for fuel loss, one of the largest fleet operating costs
 * after tyres. Every alert is org-isolated and country-scoped, carries a
 * severity and an investigation status, and quantifies the estimated financial
 * loss (drop litres × fuel price, or a stored figure).
 *
 * Runs on the new `fuel_theft_alerts` table (V180). Real data, KPI tiles, a
 * per-asset loss roll-up, create/edit modal, filters, search, delete confirm,
 * Excel/PDF export, and loading/empty/error/not-provisioned states throughout.
 * Aggregation logic lives in the pure `src/lib/fuelTheftAlerts.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Fuel, ShieldAlert, TrendingDown, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Truck,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listFuelTheftAlerts, createFuelTheftAlert, updateFuelTheftAlert, deleteFuelTheftAlert,
} from '../lib/api/fuelTheftAlerts'
import { summariseAlerts, byAsset, estimatedLoss } from '../lib/fuelTheftAlerts'
import { formatCurrency } from '../lib/formatters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  alert_no: '', asset_no: '', driver_name: '', location: '', detected_at: '',
  drop_litres: '', expected_litres: '', fuel_price_per_litre: '', estimated_loss: '',
  severity: 'medium', status: 'open', resolution: '', notes: '',
}

const SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical']
const STATUS_OPTIONS = ['open', 'investigating', 'confirmed', 'dismissed', 'resolved']

const SEVERITY_BADGE = {
  low: 'bg-sky-900/30 text-sky-300 border border-sky-800/50',
  medium: 'bg-amber-900/30 text-amber-300 border border-amber-800/50',
  high: 'bg-orange-900/30 text-orange-300 border border-orange-800/50',
  critical: 'bg-red-900/30 text-red-300 border border-red-800/50',
}
const STATUS_BADGE = {
  open: 'bg-slate-700/40 text-slate-200 border border-slate-600/50',
  investigating: 'bg-indigo-900/30 text-indigo-300 border border-indigo-800/50',
  confirmed: 'bg-red-900/30 text-red-300 border border-red-800/50',
  dismissed: 'bg-slate-800/40 text-slate-400 border border-slate-700/50',
  resolved: 'bg-green-900/30 text-green-300 border border-green-800/50',
}

const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '—')
const fmtLitres = (v) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString()} L`

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function FuelTheftAlerts() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [assetFilter, setAssetFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
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
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listFuelTheftAlerts({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load fuel theft alerts.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseAlerts(rows || []), [rows])
  const assetRollup = useMemo(() => byAsset(rows || []), [rows])

  const fmtMoney = useCallback(
    (v) => (v == null ? '—' : formatCurrency(v, activeCurrency, 0)),
    [activeCurrency],
  )

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (statusFilter && String(r.status || '').toLowerCase() !== statusFilter) return false
      if (severityFilter && String(r.severity || '').toLowerCase() !== severityFilter) return false
      if (q) {
        const hay = `${r.alert_no || ''} ${r.asset_no || ''} ${r.driver_name || ''} ${r.location || ''} ${r.notes || ''} ${r.resolution || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, assetFilter, statusFilter, severityFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total alerts', value: summary.totalAlerts, icon: Fuel, tone: 'text-[var(--text-primary)]' },
    { label: 'Open', value: summary.openCount, icon: AlertTriangle, tone: 'text-amber-400' },
    { label: 'Critical open', value: summary.criticalOpenCount, icon: ShieldAlert, tone: 'text-red-400' },
    { label: 'Estimated loss', value: fmtMoney(summary.totalEstimatedLoss), icon: TrendingDown, tone: 'text-orange-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['alert_no', 'asset_no', 'driver_name', 'location', 'detected_at', 'drop_litres', 'expected_litres', 'fuel_price_per_litre', 'estimated_loss', 'severity', 'status']
  const EXPORT_HEADERS = ['Alert #', 'Asset', 'Driver', 'Location', 'Detected', 'Drop (L)', 'Expected (L)', 'Price/L', 'Est. loss', 'Severity', 'Status']
  const exportRows = filtered.map((r) => ({
    alert_no: r.alert_no || '', asset_no: r.asset_no || '', driver_name: r.driver_name || '',
    location: r.location || '', detected_at: r.detected_at || '',
    drop_litres: r.drop_litres ?? '', expected_litres: r.expected_litres ?? '',
    fuel_price_per_litre: r.fuel_price_per_litre ?? '',
    estimated_loss: estimatedLoss(r) ?? '', severity: r.severity || '', status: r.status || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm({ ...EMPTY_FORM, currency: activeCurrency }); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      alert_no: r.alert_no || '', asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      location: r.location || '',
      detected_at: r.detected_at ? new Date(r.detected_at).toISOString().slice(0, 16) : '',
      drop_litres: r.drop_litres ?? '', expected_litres: r.expected_litres ?? '',
      fuel_price_per_litre: r.fuel_price_per_litre ?? '', estimated_loss: r.estimated_loss ?? '',
      severity: r.severity || 'medium', status: r.status || 'open',
      resolution: r.resolution || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

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
      setFormError(err?.message || 'Could not save the alert.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, activeCurrency, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteFuelTheftAlert(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the alert.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setAssetFilter(''); setStatusFilter(''); setSeverityFilter(''); setSearch('') }
  const hasFilters = assetFilter || statusFilter || severityFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fuel Theft Alerts"
        subtitle="Detected fuel-level drops and refuel discrepancies per asset — triage, investigate, and quantify fuel loss across the fleet."
        icon={Fuel}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'fuel_theft_alerts')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Fuel Theft Alerts', 'fuel_theft_alerts', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log alert
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Fuel theft alerting isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V180_FUEL_THEFT_ALERTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load fuel theft alerts.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

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
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Per-asset loss roll-up */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Truck size={15} /> Estimated loss by asset
        </h3>
        {rows === null ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : assetRollup.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No alerts logged yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {assetRollup.slice(0, 24).map((a) => (
              <div key={a.asset_no} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                <p className="text-xs text-[var(--text-muted)]">{a.asset_no}</p>
                <p className="text-sm font-semibold text-orange-400">{fmtMoney(a.loss)}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{a.alerts} alert{a.alerts === 1 ? '' : 's'}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search alert #, asset, driver, location, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <select className="input" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
            <option value="">All severities</option>
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalAlerts}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Alert #', 'Asset', 'Detected', 'Drop', 'Est. loss', 'Severity', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No alerts logged yet — log your first alert.' : 'No alerts match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const sev = String(r.severity || '').toLowerCase()
                  const st = String(r.status || '').toLowerCase()
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.alert_no || '—'}</td>
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.detected_at)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtLitres(r.drop_litres)}</td>
                      <td className="px-4 py-2.5 font-semibold text-orange-400 whitespace-nowrap">{fmtMoney(estimatedLoss(r))}</td>
                      <td className="px-4 py-2.5">
                        {sev ? <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${SEVERITY_BADGE[sev] || SEVERITY_BADGE.medium}`}>{titleCase(sev)}</span> : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {st ? <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[st] || STATUS_BADGE.open}`}>{titleCase(st)}</span> : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit alert' : 'Log fuel theft alert'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Alert # (optional)</label>
                  <input className="input w-full" placeholder="e.g. FA-2026-0117" value={form.alert_no} maxLength={60} onChange={(e) => set('alert_no', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Driver (optional)</label>
                  <input className="input w-full" placeholder="e.g. A. Rahman" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Location (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh — Ring Rd" value={form.location} maxLength={200} onChange={(e) => set('location', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Detected at</label>
                  <input className="input w-full" type="datetime-local" value={form.detected_at} onChange={(e) => set('detected_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Severity</label>
                    <select className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                      {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Status</label>
                    <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="label">Drop (L)</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="120" value={form.drop_litres} onChange={(e) => set('drop_litres', e.target.value)} />
                </div>
                <div>
                  <label className="label">Expected (L)</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="20" value={form.expected_litres} onChange={(e) => set('expected_litres', e.target.value)} />
                </div>
                <div>
                  <label className="label">Price / L</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="2.33" value={form.fuel_price_per_litre} onChange={(e) => set('fuel_price_per_litre', e.target.value)} />
                </div>
                <div>
                  <label className="label">Est. loss</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="auto" value={form.estimated_loss} onChange={(e) => set('estimated_loss', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Auto if drop × price set.</p>
                </div>
              </div>
              <div>
                <label className="label">Resolution (optional)</label>
                <input className="input w-full" placeholder="e.g. confirmed siphoning — driver counselled" value={form.resolution} maxLength={8000} onChange={(e) => set('resolution', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. tank level dropped 120 L overnight while parked" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Log alert'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this alert?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Alert'} · {fmtDateTime(confirmDelete.detected_at)} · {fmtMoney(estimatedLoss(confirmDelete))}. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
