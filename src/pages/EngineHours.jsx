/**
 * EngineHours (route /engine-hours) — Engine Hours Tracker. Logs engine-hour
 * meter readings per asset over time so the fleet can trend utilisation, plan
 * hour-based servicing, and spot meter anomalies. Full CRUD on the
 * `engine_hours_logs` table (V161) with KPI tiles, filters, search, Excel/PDF
 * export, and loading / empty / error / pre-migration states throughout.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Gauge, Activity, Clock, Truck, Plus, Pencil, Trash2, Search, X, Filter,
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listEngineHours, createEngineHours, updateEngineHours, deleteEngineHours,
  ENGINE_HOURS_SOURCES,
} from '../lib/api/engineHours'
import { summarizeEngineHours, latestPerAsset } from '../lib/engineHours'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const today = () => new Date().toISOString().slice(0, 10)
const emptyForm = () => ({ asset_no: '', engine_hours: '', reading_date: today(), source: 'manual', site: '', notes: '' })

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
const fmtHours = (v) => (v === null || v === undefined || v === '') ? '—'
  : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })
const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString()
}

export default function EngineHours() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [assetFilter, setAssetFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null) // row being edited, or null for create
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [confirmDelete, setConfirmDelete] = useState(null) // row pending delete
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listEngineHours({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load engine-hour readings.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeEngineHours(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.site || ''} ${r.source || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, assetFilter, search])

  const latestRows = useMemo(() => new Set(latestPerAsset(rows || []).map((r) => r.id)), [rows])

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '',
      engine_hours: r.engine_hours ?? '',
      reading_date: r.reading_date || today(),
      source: r.source || 'manual',
      site: r.site || '',
      notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (String(form.engine_hours).trim() === '' || Number.isNaN(Number(form.engine_hours))) {
      setFormError('A numeric engine-hours reading is required.'); return
    }
    setSaving(true)
    try {
      const payload = {
        asset_no: form.asset_no,
        engine_hours: form.engine_hours,
        reading_date: form.reading_date || null,
        source: form.source || null,
        site: form.site || null,
        notes: form.notes || null,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateEngineHours(editing.id, payload)
      else await createEngineHours(payload)
      setModalOpen(false)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the reading.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteEngineHours(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the reading.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // Export -------------------------------------------------------------------
  const EXPORT_COLS = ['asset_no', 'engine_hours', 'reading_date', 'source', 'site', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Engine hours', 'Reading date', 'Source', 'Site', 'Notes']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '',
    engine_hours: r.engine_hours ?? '',
    reading_date: r.reading_date || '',
    source: r.source || '',
    site: r.site || '',
    notes: r.notes || '',
  }))

  const kpis = [
    { label: 'Readings logged', value: summary.totalReadings, icon: Activity, tone: 'text-[var(--text-primary)]' },
    { label: 'Assets tracked', value: summary.assetsTracked, icon: Truck, tone: 'text-sky-400' },
    { label: 'Highest hours', value: summary.maxHours == null ? '—' : fmtHours(summary.maxHours), icon: Gauge, tone: 'text-amber-400' },
    { label: 'Avg hours (latest)', value: summary.avgHours == null ? '—' : fmtHours(summary.avgHours), icon: Clock, tone: 'text-green-400' },
  ]

  const clearFilters = () => { setAssetFilter(''); setSearch('') }
  const hasFilters = assetFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engine Hours Tracker"
        subtitle="Log engine-hour meter readings per asset over time — trend utilisation, plan hour-based servicing, and catch meter anomalies."
        icon={Gauge}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'engine_hours')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Engine Hours', 'engine_hours', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={missing}>
              <Plus size={14} /> Log reading
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Engine hours tracking isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V161_ENGINE_HOURS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load engine-hour readings.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, site, source, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {rows?.length || 0}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Engine hours', 'Reading date', 'Source', 'Site', 'Notes', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {(rows.length === 0 && !missing)
                    ? <><Gauge size={22} className="mx-auto mb-2 opacity-60" />No engine-hour readings yet. Log the first reading to get started.</>
                    : <><Filter size={22} className="mx-auto mb-2 opacity-60" />No readings match these filters.</>}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                      {r.asset_no || '—'}
                      {latestRows.has(r.id) && <span className="ml-2 badge text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 border border-green-700/50">latest</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] font-semibold">{fmtHours(r.engine_hours)} h</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.reading_date)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.source || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-muted)] max-w-[240px] truncate" title={r.notes || ''}>{r.notes || '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 overflow-y-auto py-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="card w-full max-w-lg m-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit reading' : 'Log engine-hour reading'}</h3>
              <button onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-014" value={form.asset_no} maxLength={120} onChange={(e) => setField('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Engine hours</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="0.0" value={form.engine_hours} onChange={(e) => setField('engine_hours', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Reading date</label>
                  <input className="input w-full" type="date" value={form.reading_date} onChange={(e) => setField('reading_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Source</label>
                  <select className="input w-full" value={form.source} onChange={(e) => setField('source', e.target.value)}>
                    {ENGINE_HOURS_SOURCES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Site (optional)</label>
                <input className="input w-full" placeholder="Depot / site" value={form.site} maxLength={200} onChange={(e) => setField('site', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Meter reset, telematics sync, anomaly…" value={form.notes} maxLength={4000} onChange={(e) => setField('notes', e.target.value)} />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving…' : (editing ? 'Save changes' : 'Log reading')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 py-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)]">Delete reading?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  This removes the {fmtHours(confirmDelete.engine_hours)} h reading for
                  <span className="font-medium text-[var(--text-secondary)]"> {confirmDelete.asset_no || 'this asset'}</span>
                  {confirmDelete.reading_date ? ` (${fmtDate(confirmDelete.reading_date)})` : ''}. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
