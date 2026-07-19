/**
 * Emissions (route /emissions) — Emissions Tests / Smog Compliance. Captures
 * vehicle emissions / smog test certificates per asset over time: the measured
 * gas readings, the pass/fail result, cost, and — critically — the expiry date
 * that governs regulatory compliance. Certificate expiry drives fleet-off-road
 * risk, so every test is org-isolated and country-scoped.
 *
 * Runs on the new `emissions_tests` table (V178). Real data, KPI tiles, an
 * expiring/expired attention strip, a latest-per-asset compliance table with
 * expiry badges, create/edit modal, filters, search, delete confirm, Excel/PDF
 * export, and loading/empty/error states throughout. Expiry classification and
 * the fleet KPI summary live in the pure `src/lib/emissionsTests.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Wind, ShieldCheck, ShieldAlert, CalendarClock, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, CheckCircle2, XCircle, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listEmissionsTests, createEmissionsTest, updateEmissionsTest, deleteEmissionsTest,
} from '../lib/api/emissionsTests'
import {
  summariseEmissions, latestPerAsset, expiryStatus, daysUntilExpiry,
} from '../lib/emissionsTests'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const EMPTY_FORM = {
  asset_no: '', certificate_no: '', test_date: '', expiry_date: '', test_center: '',
  standard: '', co_pct: '', hc_ppm: '', nox_ppm: '', opacity_pct: '', co2_pct: '',
  result: '', cost: '', currency: '', notes: '',
}

const RESULT_OPTIONS = [
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'conditional', label: 'Conditional' },
]

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

const fmtNum = (v, suffix = '') =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString()}${suffix}`

function fmtMoney(v, currency) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return '—'
  return `${currency ? `${currency} ` : ''}${n.toLocaleString()}`
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

// ── Presentation for the pass/fail result and the certificate expiry status ──
const RESULT_BADGE = {
  pass: { label: 'Pass', cls: 'bg-green-900/30 text-green-300 border-green-800/50', Icon: CheckCircle2 },
  fail: { label: 'Fail', cls: 'bg-red-900/30 text-red-300 border-red-800/50', Icon: XCircle },
  conditional: { label: 'Conditional', cls: 'bg-amber-900/30 text-amber-300 border-amber-800/50', Icon: AlertTriangle },
}

const EXPIRY_BADGE = {
  expired: { label: 'Expired', cls: 'bg-red-900/30 text-red-300 border-red-800/50' },
  expiring_soon: { label: 'Expiring soon', cls: 'bg-amber-900/30 text-amber-300 border-amber-800/50' },
  valid: { label: 'Valid', cls: 'bg-green-900/30 text-green-300 border-green-800/50' },
  unknown: { label: 'No expiry', cls: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]' },
}

function ResultBadge({ value }) {
  const meta = RESULT_BADGE[String(value || '').toLowerCase()]
  if (!meta) return <span className="text-[var(--text-muted)]">—</span>
  const { Icon } = meta
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${meta.cls}`}>
      <Icon size={12} /> {meta.label}
    </span>
  )
}

function ExpiryBadge({ status, days }) {
  const meta = EXPIRY_BADGE[status] || EXPIRY_BADGE.unknown
  let suffix = ''
  if (status === 'expired' && days != null) suffix = ` · ${Math.abs(days)}d ago`
  else if (status === 'expiring_soon' && days != null) suffix = ` · ${days}d`
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${meta.cls}`}>
      {meta.label}{suffix}
    </span>
  )
}

export default function Emissions() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [assetFilter, setAssetFilter] = useState('')
  const [resultFilter, setResultFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Compute "now" once per render so every pure call classifies against the
  // same instant — deterministic and cheap.
  const nowMs = Date.now()

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listEmissionsTests({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load emissions tests.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseEmissions(rows || [], nowMs), [rows, nowMs])
  const latest = useMemo(() => latestPerAsset(rows || []), [rows])

  // Assets whose latest certificate is expired or expiring soon — the attention set.
  const attention = useMemo(() => {
    return latest
      .map((r) => ({ row: r, status: expiryStatus(r, nowMs), days: daysUntilExpiry(r, nowMs) }))
      .filter((x) => x.status === 'expired' || x.status === 'expiring_soon')
      .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity))
  }, [latest, nowMs])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (resultFilter && String(r.result || '').toLowerCase() !== resultFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.certificate_no || ''} ${r.test_center || ''} ${r.standard || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, assetFilter, resultFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Tests recorded', value: summary.totalTests, icon: Wind, tone: 'text-[var(--text-primary)]' },
    { label: 'Pass rate', value: `${summary.passRate}%`, icon: ShieldCheck, tone: summary.passRate >= 90 ? 'text-green-400' : summary.passRate >= 70 ? 'text-amber-400' : 'text-red-400' },
    { label: 'Certificates expired', value: summary.expiredCount, icon: ShieldAlert, tone: summary.expiredCount > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Expiring soon', value: summary.expiringSoonCount, icon: CalendarClock, tone: summary.expiringSoonCount > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'certificate_no', 'test_date', 'expiry_date', 'result', 'test_center', 'standard', 'co_pct', 'hc_ppm', 'nox_ppm', 'opacity_pct', 'co2_pct', 'cost', 'currency', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Certificate', 'Test date', 'Expiry date', 'Result', 'Test center', 'Standard', 'CO %', 'HC ppm', 'NOx ppm', 'Opacity %', 'CO2 %', 'Cost', 'Currency', 'Notes']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', certificate_no: r.certificate_no || '',
    test_date: r.test_date || '', expiry_date: r.expiry_date || '',
    result: r.result || '', test_center: r.test_center || '', standard: r.standard || '',
    co_pct: r.co_pct ?? '', hc_ppm: r.hc_ppm ?? '', nox_ppm: r.nox_ppm ?? '',
    opacity_pct: r.opacity_pct ?? '', co2_pct: r.co2_pct ?? '',
    cost: r.cost ?? '', currency: r.currency || '', notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', certificate_no: r.certificate_no || '',
      test_date: r.test_date || '', expiry_date: r.expiry_date || '',
      test_center: r.test_center || '', standard: r.standard || '',
      co_pct: r.co_pct ?? '', hc_ppm: r.hc_ppm ?? '', nox_ppm: r.nox_ppm ?? '',
      opacity_pct: r.opacity_pct ?? '', co2_pct: r.co2_pct ?? '',
      result: r.result || '', cost: r.cost ?? '', currency: r.currency || '',
      notes: r.notes || '',
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
        result: form.result || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateEmissionsTest(editing.id, payload)
      else await createEmissionsTest(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the emissions test.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteEmissionsTest(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the emissions test.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setAssetFilter(''); setResultFilter(''); setSearch('') }
  const hasFilters = assetFilter || resultFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Emissions Tests"
        subtitle="Track vehicle emissions / smog certificates per asset — gas readings, pass/fail results, and certificate expiry that governs regulatory compliance."
        icon={Wind}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'emissions_tests') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Emissions Tests', 'emissions_tests', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Record test
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Emissions testing isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V178_EMISSIONS_TESTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load emissions tests.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Expiring / expired attention strip */}
      {rows !== null && attention.length > 0 && (
        <div className="card border border-amber-800/40">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ShieldAlert size={15} className="text-amber-400" /> Certificates needing attention
            <span className="text-xs font-normal text-[var(--text-muted)]">({attention.length})</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {attention.slice(0, 24).map(({ row: r, status, days }) => (
              <div key={r.id} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">{r.asset_no}</p>
                  <ExpiryBadge status={status} days={days} />
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
                  <Clock size={10} /> Expires {fmtDate(r.expiry_date)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest-per-asset compliance snapshot */}
      <div className="card overflow-hidden !p-0">
        <div className="px-4 pt-4 pb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <ShieldCheck size={15} /> Latest certificate per asset
          </h3>
        </div>
        {rows === null ? (
          <div className="px-4 pb-4"><div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" /></div>
        ) : latest.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-[var(--text-muted)]">No emissions tests recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  {['Asset', 'Result', 'Test date', 'Expiry', 'Status'].map((h, i) => <th key={i} className="px-4 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {latest
                  .slice()
                  .sort((a, b) => (daysUntilExpiry(a, nowMs) ?? Infinity) - (daysUntilExpiry(b, nowMs) ?? Infinity))
                  .slice(0, 50)
                  .map((r) => (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no}</td>
                      <td className="px-4 py-2.5"><ResultBadge value={r.result} /></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.test_date)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.expiry_date)}</td>
                      <td className="px-4 py-2.5"><ExpiryBadge status={expiryStatus(r, nowMs)} days={daysUntilExpiry(r, nowMs)} /></td>
                    </tr>
                  ))}
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
            <input className="input pl-9 w-full" placeholder="Search asset, certificate, center, standard, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} aria-label="Result">
            <option value="">All results</option>
            {RESULT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalTests}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Certificate', 'Result', 'Test date', 'Expiry', 'Test center', 'Cost', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No emissions tests recorded yet — record your first test.' : 'No tests match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.certificate_no || '—'}</td>
                    <td className="px-4 py-2.5"><ResultBadge value={r.result} /></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.test_date)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--text-secondary)]">{fmtDate(r.expiry_date)}</span>
                        <ExpiryBadge status={expiryStatus(r, nowMs)} days={daysUntilExpiry(r, nowMs)} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.test_center || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtMoney(r.cost, r.currency)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
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
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit emissions test' : 'Record emissions test'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Certificate no. (optional)</label>
                  <input className="input w-full" placeholder="e.g. EM-2026-00123" value={form.certificate_no} maxLength={120} onChange={(e) => set('certificate_no', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Test date</label>
                  <input className="input w-full" type="date" value={form.test_date} onChange={(e) => set('test_date', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Blank = today.</p>
                </div>
                <div>
                  <label className="label">Expiry date</label>
                  <input className="input w-full" type="date" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Result</label>
                  <select className="input w-full" value={form.result} onChange={(e) => set('result', e.target.value)}>
                    <option value="">—</option>
                    {RESULT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Test center (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh Vehicle Testing" value={form.test_center} maxLength={200} onChange={(e) => set('test_center', e.target.value)} />
                </div>
                <div>
                  <label className="label">Standard (optional)</label>
                  <input className="input w-full" placeholder="e.g. Euro 5 / ASEP" value={form.standard} maxLength={120} onChange={(e) => set('standard', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <label className="label">CO %</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="0.5" value={form.co_pct} onChange={(e) => set('co_pct', e.target.value)} />
                </div>
                <div>
                  <label className="label">HC ppm</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="120" value={form.hc_ppm} onChange={(e) => set('hc_ppm', e.target.value)} />
                </div>
                <div>
                  <label className="label">NOx ppm</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="200" value={form.nox_ppm} onChange={(e) => set('nox_ppm', e.target.value)} />
                </div>
                <div>
                  <label className="label">Opacity %</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="1.2" value={form.opacity_pct} onChange={(e) => set('opacity_pct', e.target.value)} />
                </div>
                <div>
                  <label className="label">CO2 %</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="13.5" value={form.co2_pct} onChange={(e) => set('co2_pct', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Cost (optional)</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="150" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
                </div>
                <div>
                  <label className="label">Currency (optional)</label>
                  <input className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. re-test after ECU tune" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Record test'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this emissions test?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Test'} · {confirmDelete.certificate_no || 'no certificate'} · {fmtDate(confirmDelete.test_date)}. This can’t be undone.
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
