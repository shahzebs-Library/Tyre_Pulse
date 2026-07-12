/**
 * RetreadClaims (route /retread-claims) — Safety & Compliance module.
 *
 * Tracks retread warranty / quality claims raised against retread vendors for a
 * specific casing/tyre serial, through their lifecycle
 * (open → submitted → approved/rejected → settled) with cost-vs-recovered
 * amounts driving a fleet recovery-rate KPI and vendor accountability. Real
 * data, KPI tiles, create/edit modal, status badges, status + vendor + search
 * filters, delete confirm, Excel/PDF export, and loading / empty / error /
 * not-migrated states throughout.
 *
 * CRUD lives in src/lib/api/retreadClaims.js; aggregation logic in the pure,
 * unit-tested src/lib/retreadClaims.js.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Recycle, Plus, Search, X, Filter, Pencil, Trash2, Loader2, Save,
  FileSpreadsheet, FileText, AlertTriangle, DollarSign, Inbox, TrendingUp,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  listRetreadClaims, createRetreadClaim, updateRetreadClaim, deleteRetreadClaim,
} from '../lib/api/retreadClaims'
import {
  summarizeRetreadClaims, RETREAD_CLAIM_STATUSES, RETREAD_CLAIM_STATUS_META,
} from '../lib/retreadClaims'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const STATUS_STYLES = {
  open:      'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  submitted: 'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  approved:  'bg-green-900/40 text-green-300 border border-green-700/50',
  rejected:  'bg-red-900/40 text-red-300 border border-red-700/50',
  settled:   'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
}

const EMPTY_FORM = {
  claim_no: '', tyre_serial: '', asset_no: '', vendor: '', reason: '',
  claim_date: '', cost: '', amount_recovered: '', status: 'open', notes: '',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10)
}

export default function RetreadClaims() {
  const { activeCountry, activeCurrency } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleting, setDeleting] = useState(null)

  const ccy = activeCurrency || 'SAR'
  const money = useCallback((v) => (v == null || v === '' ? '—' : formatCurrencyCompact(v, ccy)), [ccy])

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listRetreadClaims({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load retread claims.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeRetreadClaims(rows || []), [rows])

  const vendorOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.vendor).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (vendorFilter && r.vendor !== vendorFilter) return false
      if (q) {
        const hay = `${r.claim_no || ''} ${r.tyre_serial || ''} ${r.asset_no || ''} ${r.vendor || ''} ${r.reason || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, vendorFilter, search])

  // ── Modal handlers ──────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      claim_no: r.claim_no || '', tyre_serial: r.tyre_serial || '', asset_no: r.asset_no || '',
      vendor: r.vendor || '', reason: r.reason || '', claim_date: r.claim_date || '',
      cost: r.cost ?? '', amount_recovered: r.amount_recovered ?? '',
      status: r.status || 'open', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.vendor.trim() && !form.tyre_serial.trim()) {
      setFormError('Provide a vendor or a tyre serial.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateRetreadClaim(editing.id, payload)
      else await createRetreadClaim(payload)
      setModalOpen(false)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the claim.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    try {
      await deleteRetreadClaim(deleting.id)
      setDeleting(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the claim.')
      setDeleting(null)
    }
  }, [deleting, load])

  // ── Export ──────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['claim_no', 'tyre_serial', 'asset_no', 'vendor', 'reason', 'claim_date', 'cost', 'amount_recovered', 'status']
  const EXPORT_HEADERS = ['Claim No', 'Tyre Serial', 'Asset', 'Vendor', 'Reason', 'Claim Date', 'Cost', 'Recovered', 'Status']
  const exportRows = filtered.map((r) => ({
    claim_no: r.claim_no || '', tyre_serial: r.tyre_serial || '', asset_no: r.asset_no || '',
    vendor: r.vendor || '', reason: r.reason || '', claim_date: fmtDate(r.claim_date),
    cost: r.cost ?? '', amount_recovered: r.amount_recovered ?? '',
    status: RETREAD_CLAIM_STATUS_META[r.status]?.label || r.status,
  }))

  const kpis = [
    { label: 'Open claims', value: summary.openCount, icon: Inbox, tone: 'text-sky-400' },
    { label: 'Total cost', value: rows === null ? '—' : money(summary.totalCost), icon: DollarSign, tone: 'text-[var(--text-primary)]' },
    { label: 'Total recovered', value: rows === null ? '—' : money(summary.totalRecovered), icon: TrendingUp, tone: 'text-emerald-400' },
    { label: 'Recovery rate', value: rows === null ? '—' : `${summary.recoveryRate}%`, icon: Recycle, tone: summary.recoveryRate >= 70 ? 'text-green-400' : 'text-amber-400' },
  ]

  const clearFilters = () => { setStatusFilter('all'); setVendorFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || vendorFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Retread Claims"
        subtitle="Retread warranty & quality claims raised against retread vendors — casing serial, vendor, reason, cost and recovery, tracked through the full lifecycle."
        icon={Recycle}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'retread_claims')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Retread Claims', 'retread_claims', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New claim
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Retread claims aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V145_RETREAD_CLAIMS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load retread claims.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search claim no, serial, asset, vendor, reason…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {RETREAD_CLAIM_STATUSES.map((s) => <option key={s} value={s}>{RETREAD_CLAIM_STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} aria-label="Vendor">
            <option value="">All vendors</option>
            {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
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
                {['Claim No', 'Tyre Serial', 'Vendor', 'Reason', 'Claim Date', 'Cost', 'Recovered', 'Status', ''].map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {summary.total === 0 ? 'No retread claims yet — record your first claim.' : 'No claims match these filters.'}
                </td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.claim_no || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.tyre_serial || '—'}{r.asset_no ? <span className="text-[var(--text-muted)]"> · {r.asset_no}</span> : ''}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.vendor || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[220px] truncate" title={r.reason || ''}>{r.reason || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.claim_date)}</td>
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{money(r.cost)}</td>
                    <td className="px-4 py-2.5 text-emerald-400">{r.amount_recovered ? money(r.amount_recovered) : '—'}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || STATUS_STYLES.open}`}>{RETREAD_CLAIM_STATUS_META[r.status]?.label || r.status}</span></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit claim"><Pencil size={14} /></button>
                        <button onClick={() => setDeleting(r)} className="p-1.5 rounded-lg hover:bg-red-900/40 text-[var(--text-muted)] hover:text-red-300" aria-label="Delete claim"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[var(--input-border)] flex items-center justify-between">
              <h2 className="font-bold text-[var(--text-primary)]">{editing ? 'Edit claim' : 'New retread claim'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label">Claim No</label><input className="input w-full" value={form.claim_no} onChange={(e) => setField('claim_no', e.target.value)} placeholder="RTC-0001" /></div>
                <div><label className="label">Tyre Serial</label><input className="input w-full" value={form.tyre_serial} onChange={(e) => setField('tyre_serial', e.target.value)} placeholder="Casing / tyre serial" /></div>
                <div><label className="label">Asset No</label><input className="input w-full" value={form.asset_no} onChange={(e) => setField('asset_no', e.target.value)} placeholder="Vehicle / asset" /></div>
                <div><label className="label">Vendor</label><input className="input w-full" value={form.vendor} onChange={(e) => setField('vendor', e.target.value)} placeholder="Retread vendor" /></div>
                <div><label className="label">Claim date</label><input type="date" className="input w-full" value={form.claim_date || ''} onChange={(e) => setField('claim_date', e.target.value)} /></div>
                <div><label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                    {RETREAD_CLAIM_STATUSES.map((s) => <option key={s} value={s}>{RETREAD_CLAIM_STATUS_META[s]?.label || s}</option>)}
                  </select>
                </div>
                <div><label className="label">Cost ({ccy})</label><input type="number" min="0" step="0.01" className="input w-full" value={form.cost} onChange={(e) => setField('cost', e.target.value)} /></div>
                <div><label className="label">Amount recovered ({ccy})</label><input type="number" min="0" step="0.01" className="input w-full" value={form.amount_recovered} onChange={(e) => setField('amount_recovered', e.target.value)} /></div>
              </div>
              <div><label className="label">Reason</label>
                <textarea className="input w-full min-h-[70px] resize-y" value={form.reason} maxLength={8000} onChange={(e) => setField('reason', e.target.value)} placeholder="Claim reason — separation, defect, premature failure…" />
              </div>
              <div><label className="label">Notes</label>
                <textarea className="input w-full min-h-[70px] resize-y" value={form.notes} maxLength={8000} onChange={(e) => setField('notes', e.target.value)} placeholder="Vendor response, resolution notes…" />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create claim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleting && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setDeleting(null)}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="font-bold text-[var(--text-primary)]">Delete claim?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {deleting.claim_no ? <span className="font-mono text-[var(--text-secondary)]">{deleting.claim_no}</span> : 'This claim'} will be permanently removed. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={confirmDelete} className="btn-primary text-sm bg-red-600 hover:bg-red-500 inline-flex items-center gap-1.5"><Trash2 size={14} /> Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
