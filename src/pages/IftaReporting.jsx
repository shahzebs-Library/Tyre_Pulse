/**
 * IftaReporting (route /ifta-reporting) — IFTA Fuel Tax Reporting. Captures the
 * jurisdiction-by-jurisdiction distance (km) and fuel (litres/cost) data needed
 * to file quarterly International Fuel Tax Agreement (IFTA) returns for
 * interstate/inter-provincial operations. Per-jurisdiction distance and fuel are
 * the basis for net taxable distance and tax-due settlements, so every record is
 * org-isolated and country-scoped.
 *
 * Runs on the new `ifta_records` table (V173). Real data, KPI tiles, a
 * by-jurisdiction roll-up, create/edit modal, filters, search, delete confirm,
 * Excel/PDF export, and loading/empty/error states throughout. Jurisdiction
 * roll-ups and the fleet KPI summary live in the pure `src/lib/iftaRecords.js`
 * helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Fuel, Globe, Droplets, Coins, TrendingUp, Activity, AlertTriangle,
  Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listIftaRecords, createIftaRecord, updateIftaRecord, deleteIftaRecord,
} from '../lib/api/iftaRecords'
import { summariseIfta, byJurisdiction, fuelEconomyKmPerL } from '../lib/iftaRecords'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  asset_no: '', driver_name: '', jurisdiction: '', quarter: '', travel_date: '',
  distance_km: '', fuel_litres: '', fuel_cost: '', currency: '', tax_rate: '',
  taxable_km: '', notes: '',
}

const fmtNum = (v, unit) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString()}${unit ? ` ${unit}` : ''}`

function fmtMoney(v, currency) {
  if (v == null || v === '') return '—'
  return `${currency ? `${currency} ` : ''}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function IftaReporting() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [countryFilter, setCountryFilter] = useState('')
  const [quarterFilter, setQuarterFilter] = useState('')
  const [jurisdictionFilter, setJurisdictionFilter] = useState('')
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
      const data = await listIftaRecords({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load IFTA records.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseIfta(rows || []), [rows])
  const jurisdictionRollup = useMemo(() => byJurisdiction(rows || []), [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )
  const quarterOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.quarter).filter(Boolean))].sort(),
    [rows],
  )
  const jurisdictionOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.jurisdiction).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (countryFilter && r.country !== countryFilter) return false
      if (quarterFilter && r.quarter !== quarterFilter) return false
      if (jurisdictionFilter && r.jurisdiction !== jurisdictionFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.driver_name || ''} ${r.jurisdiction || ''} ${r.quarter || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, countryFilter, quarterFilter, jurisdictionFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Records logged', value: summary.totalRecords, icon: Activity, tone: 'text-[var(--text-primary)]' },
    { label: 'Total distance', value: `${Math.round(summary.totalDistanceKm).toLocaleString()} km`, icon: TrendingUp, tone: 'text-sky-400' },
    { label: 'Total fuel', value: `${Math.round(summary.totalFuelLitres).toLocaleString()} L`, icon: Droplets, tone: 'text-amber-400' },
    { label: 'Total fuel cost', value: summary.totalFuelCost > 0 ? summary.totalFuelCost.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0', icon: Coins, tone: 'text-green-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'driver_name', 'jurisdiction', 'quarter', 'travel_date', 'distance_km', 'fuel_litres', 'fuel_cost', 'currency', 'tax_rate', 'taxable_km', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Driver', 'Jurisdiction', 'Quarter', 'Travel date', 'Distance (km)', 'Fuel (L)', 'Fuel cost', 'Currency', 'Tax rate', 'Taxable (km)', 'Notes']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', driver_name: r.driver_name || '',
    jurisdiction: r.jurisdiction || '', quarter: r.quarter || '',
    travel_date: r.travel_date || '', distance_km: r.distance_km ?? '',
    fuel_litres: r.fuel_litres ?? '', fuel_cost: r.fuel_cost ?? '',
    currency: r.currency || '', tax_rate: r.tax_rate ?? '',
    taxable_km: r.taxable_km ?? '', notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      jurisdiction: r.jurisdiction || '', quarter: r.quarter || '',
      travel_date: r.travel_date || '', distance_km: r.distance_km ?? '',
      fuel_litres: r.fuel_litres ?? '', fuel_cost: r.fuel_cost ?? '',
      currency: r.currency || '', tax_rate: r.tax_rate ?? '',
      taxable_km: r.taxable_km ?? '', notes: r.notes || '',
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
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateIftaRecord(editing.id, payload)
      else await createIftaRecord(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the record.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteIftaRecord(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the record.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setCountryFilter(''); setQuarterFilter(''); setJurisdictionFilter(''); setSearch('') }
  const hasFilters = countryFilter || quarterFilter || jurisdictionFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="IFTA Fuel Tax Reporting"
        subtitle="Capture jurisdiction-by-jurisdiction distance and fuel for quarterly IFTA fuel-tax filing — the basis for net taxable distance and tax-due settlements."
        icon={Fuel}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'ifta_records')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'IFTA Fuel Tax Reporting', 'ifta_records', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Add record
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">IFTA fuel-tax reporting isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V173_IFTA_RECORDS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load IFTA records.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* By-jurisdiction roll-up */}
      <div className="card overflow-hidden !p-0">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] px-4 pt-4 pb-3 flex items-center gap-2">
          <Globe size={15} /> Distance &amp; fuel by jurisdiction
          {rows !== null && (
            <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">
              {summary.distinctJurisdictions} jurisdiction{summary.distinctJurisdictions === 1 ? '' : 's'}
              {summary.avgKmPerL != null && ` · fleet ${summary.avgKmPerL.toFixed(2)} km/L`}
            </span>
          )}
        </h3>
        {rows === null ? (
          <div className="px-4 pb-4"><div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" /></div>
        ) : jurisdictionRollup.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-[var(--text-muted)]">No jurisdiction data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  {['Jurisdiction', 'Distance (km)', 'Fuel (L)', 'Fuel cost', 'Taxable (km)', 'km/L'].map((h, i) => <th key={i} className={`px-4 py-2.5 font-semibold whitespace-nowrap ${i === 0 ? '' : 'text-right'}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {jurisdictionRollup.map((j) => {
                  const kmPerL = j.fuelLitres > 0 ? j.distanceKm / j.fuelLitres : null
                  return (
                    <tr key={j.jurisdiction} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{j.jurisdiction}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{Math.round(j.distanceKm).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{Math.round(j.fuelLitres).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{j.fuelCost > 0 ? j.fuelCost.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{Math.round(j.taxableKm).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-[var(--text-primary)]">{kmPerL == null ? '—' : kmPerL.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, driver, jurisdiction, quarter, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
            <option value="">All countries</option>
            {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" value={quarterFilter} onChange={(e) => setQuarterFilter(e.target.value)} aria-label="Quarter">
            <option value="">All quarters</option>
            {quarterOptions.map((qr) => <option key={qr} value={qr}>{qr}</option>)}
          </select>
          <select className="input" value={jurisdictionFilter} onChange={(e) => setJurisdictionFilter(e.target.value)} aria-label="Jurisdiction">
            <option value="">All jurisdictions</option>
            {jurisdictionOptions.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalRecords}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Jurisdiction', 'Quarter', 'Travel date', 'Distance', 'Fuel', 'Fuel cost', 'km/L', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No IFTA records yet — add your first record.' : 'No records match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const kmPerL = fuelEconomyKmPerL(r)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.jurisdiction || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.quarter || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.travel_date)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtNum(r.distance_km, 'km')}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtNum(r.fuel_litres, 'L')}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtMoney(r.fuel_cost, r.currency)}</td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">{kmPerL == null ? '—' : kmPerL.toFixed(2)}</td>
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit IFTA record' : 'Add IFTA record'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Driver (optional)</label>
                  <input className="input w-full" placeholder="e.g. J. Smith" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Jurisdiction</label>
                  <input className="input w-full" placeholder="e.g. TX / Ontario" value={form.jurisdiction} maxLength={120} onChange={(e) => set('jurisdiction', e.target.value)} />
                </div>
                <div>
                  <label className="label">Quarter</label>
                  <input className="input w-full" placeholder="e.g. 2026-Q1" value={form.quarter} maxLength={40} onChange={(e) => set('quarter', e.target.value)} />
                </div>
                <div>
                  <label className="label">Travel date</label>
                  <input className="input w-full" type="date" value={form.travel_date} onChange={(e) => set('travel_date', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Blank uses today.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Distance (km)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="640" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} />
                </div>
                <div>
                  <label className="label">Fuel (litres)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="210" value={form.fuel_litres} onChange={(e) => set('fuel_litres', e.target.value)} />
                </div>
                <div>
                  <label className="label">Taxable distance (km)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="640" value={form.taxable_km} onChange={(e) => set('taxable_km', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Fuel cost</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="315.00" value={form.fuel_cost} onChange={(e) => set('fuel_cost', e.target.value)} />
                </div>
                <div>
                  <label className="label">Currency</label>
                  <input className="input w-full" placeholder="USD / CAD / SAR" value={form.currency} maxLength={10} onChange={(e) => set('currency', e.target.value)} />
                </div>
                <div>
                  <label className="label">Tax rate</label>
                  <input className="input w-full" type="number" step="0.0001" min="0" placeholder="0.24" value={form.tax_rate} onChange={(e) => set('tax_rate', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. interstate haul via I-35" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add record'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this record?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Record'} · {confirmDelete.jurisdiction || '—'} · {fmtDate(confirmDelete.travel_date)}. This can’t be undone.
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
