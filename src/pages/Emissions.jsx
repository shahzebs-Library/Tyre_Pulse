/**
 * Emissions (route /emissions) - Emissions Tests / Smog Compliance. Captures
 * vehicle emissions certificates per asset over time: the measured gas
 * readings, the pass/fail result, cost, and the expiry date that governs
 * regulatory compliance. Every test is org-isolated and country-scoped.
 *
 * Runs on the `emissions_tests` table (V178). Expiry classification lives in
 * `src/lib/emissionsTests.js`; filtering, the compliance snapshot, the renewal
 * pipeline, pollutant averages, the honest pass rate and the per-currency cost
 * split live in the pure, tested `src/lib/emissionsAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Wind, ShieldCheck, ShieldAlert, CalendarClock, AlertTriangle, Search, X,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, CheckCircle2, XCircle, RefreshCw,
  FlaskConical, Coins, Truck,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listEmissionsTests, createEmissionsTest, updateEmissionsTest, deleteEmissionsTest,
} from '../lib/api/emissionsTests'
import {
  filterEmissionsTests, complianceSnapshot, renewalPipeline, pollutantAverages,
  costByCurrency, emissionsKpis, expiryStatus, daysUntilExpiry,
  EXPIRY_ORDER, EXPIRY_LABELS, EXPIRING_SOON_DAYS,
} from '../lib/emissionsAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

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
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)
function fmtMoney(v, currency) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return 'N/A'
  return `${currency ? `${currency} ` : ''}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

const RESULT_BADGE = {
  pass: { label: 'Pass', cls: 'bg-green-900/30 text-green-300 border-green-800/50', Icon: CheckCircle2 },
  fail: { label: 'Fail', cls: 'bg-red-900/30 text-red-300 border-red-800/50', Icon: XCircle },
  conditional: { label: 'Conditional', cls: 'bg-amber-900/30 text-amber-300 border-amber-800/50', Icon: AlertTriangle },
}

const EXPIRY_BADGE = {
  expired: 'bg-red-900/30 text-red-300 border-red-800/50',
  expiring_soon: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  valid: 'bg-green-900/30 text-green-300 border-green-800/50',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

function ResultBadge({ value }) {
  const meta = RESULT_BADGE[String(value || '').toLowerCase()]
  if (!meta) return <span className="text-[var(--text-muted)]">Not recorded</span>
  const { Icon } = meta
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${meta.cls}`}>
      <Icon size={12} aria-hidden="true" /> {meta.label}
    </span>
  )
}

function ExpiryBadge({ status, days }) {
  let suffix = ''
  if (status === 'expired' && days != null) suffix = `, ${Math.abs(days)}d ago`
  else if (status === 'expiring_soon' && days != null) suffix = `, in ${days}d`
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${EXPIRY_BADGE[status] || EXPIRY_BADGE.unknown}`}>
      {EXPIRY_LABELS[status] || EXPIRY_LABELS.unknown}{suffix}
    </span>
  )
}

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]'

const PIPELINE = [
  { key: 'overdue', label: 'Overdue', cls: 'bg-red-500' },
  { key: 'd30', label: 'Next 30 days', cls: 'bg-amber-500' },
  { key: 'd60', label: '31 to 60 days', cls: 'bg-yellow-500' },
  { key: 'd90', label: '61 to 90 days', cls: 'bg-sky-500' },
  { key: 'later', label: 'Beyond 90 days', cls: 'bg-green-500' },
  { key: 'unknown', label: 'No expiry recorded', cls: 'bg-[var(--text-muted)]' },
]

export default function Emissions() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  // One reference instant per load, so every classification on the page agrees.
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [assetFilter, setAssetFilter] = useState('')
  const [resultFilter, setResultFilter] = useState('')
  const [expiryFilter, setExpiryFilter] = useState('')
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
      const data = await listEmissionsTests({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      setNowMs(Date.now())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load emissions tests.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null && !error
  const all = useMemo(() => rows || [], [rows])
  const assetOptions = useMemo(() => [...new Set(all.map((r) => r.asset_no).filter(Boolean))].sort(), [all])

  const filtered = useMemo(() => filterEmissionsTests(all, {
    asset: assetFilter, result: resultFilter, expiry: expiryFilter, search, nowMs,
  }), [all, assetFilter, resultFilter, expiryFilter, search, nowMs])

  const kpis = useMemo(() => emissionsKpis(filtered, nowMs), [filtered, nowMs])
  const snapshot = useMemo(() => complianceSnapshot(filtered, nowMs), [filtered, nowMs])
  const pipeline = useMemo(() => renewalPipeline(filtered, nowMs), [filtered, nowMs])
  const pollutants = useMemo(() => pollutantAverages(filtered), [filtered])
  const costs = useMemo(() => costByCurrency(filtered), [filtered])

  const hasFilters = assetFilter || resultFilter || expiryFilter || search
  const clearFilters = () => { setAssetFilter(''); setResultFilter(''); setExpiryFilter(''); setSearch('') }

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'certificate_no', 'test_date', 'expiry_date', 'expiry_status', 'result', 'test_center', 'standard', 'co_pct', 'hc_ppm', 'nox_ppm', 'opacity_pct', 'co2_pct', 'cost', 'currency', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Certificate', 'Test date', 'Expiry date', 'Expiry status', 'Result', 'Test center', 'Standard', 'CO %', 'HC ppm', 'NOx ppm', 'Opacity %', 'CO2 %', 'Cost', 'Currency', 'Notes']
  const exportRows = () => filtered.map((r) => ({
    asset_no: r.asset_no || '', certificate_no: r.certificate_no || '',
    test_date: r.test_date || '', expiry_date: r.expiry_date || '',
    expiry_status: EXPIRY_LABELS[expiryStatus(r, nowMs)],
    result: r.result || '', test_center: r.test_center || '', standard: r.standard || '',
    co_pct: r.co_pct ?? '', hc_ppm: r.hc_ppm ?? '', nox_ppm: r.nox_ppm ?? '',
    opacity_pct: r.opacity_pct ?? '', co2_pct: r.co2_pct ?? '',
    cost: r.cost ?? '', currency: r.currency || '', notes: r.notes || '',
  }))
  const fileName = () => reportFileName('TyrePulse Emissions Tests', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExcel = async () => {
    setActionError('')
    try { await exportToExcel(exportRows(), EXPORT_COLS, EXPORT_HEADERS, fileName()) }
    catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    setActionError('')
    try { await exportToPdf(exportRows(), EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Emissions Tests', fileName(), 'landscape') }
    catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
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
  }, [])
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
      setActionError(toUserMessage(err, 'Could not delete the emissions test.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // ── Columns ──────────────────────────────────────────────────────────────
  const snapshotColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no}</span> },
    { id: 'certificate', header: 'Certificate', accessorFn: (r) => r.certificate_no || '', cell: ({ row }) => row.original.certificate_no || 'N/A' },
    { id: 'result', header: 'Latest result', accessorFn: (r) => r.result || '', cell: ({ row }) => <ResultBadge value={row.original.result} /> },
    { id: 'tested', header: 'Tested', accessorFn: (r) => r.test_date || '', cell: ({ row }) => fmtDate(row.original.test_date) },
    { id: 'expiry', header: 'Expires', accessorFn: (r) => r.expiry_date || '', cell: ({ row }) => fmtDate(row.original.expiry_date) },
    { id: 'days', header: 'Days left', accessorFn: (r) => r.days_to_expiry, meta: { align: 'right' }, cell: ({ row }) => (row.original.days_to_expiry == null ? 'N/A' : row.original.days_to_expiry) },
    { id: 'status', header: 'Status', accessorFn: (r) => EXPIRY_ORDER.indexOf(r.expiry_status), meta: { exportValue: (r) => EXPIRY_LABELS[r.expiry_status] }, cell: ({ row }) => <ExpiryBadge status={row.original.expiry_status} days={row.original.days_to_expiry} /> },
  ], [])

  const testColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'certificate', header: 'Certificate', accessorFn: (r) => r.certificate_no || '', cell: ({ row }) => row.original.certificate_no || 'N/A' },
    { id: 'result', header: 'Result', accessorFn: (r) => r.result || '', cell: ({ row }) => <ResultBadge value={row.original.result} /> },
    { id: 'tested', header: 'Test date', accessorFn: (r) => r.test_date || '', cell: ({ row }) => fmtDate(row.original.test_date) },
    {
      id: 'expiry', header: 'Expiry', accessorFn: (r) => r.expiry_date || '',
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>{fmtDate(row.original.expiry_date)}</span>
          <ExpiryBadge status={expiryStatus(row.original, nowMs)} days={daysUntilExpiry(row.original, nowMs)} />
        </div>
      ),
    },
    { id: 'center', header: 'Test center', accessorFn: (r) => r.test_center || '', cell: ({ row }) => row.original.test_center || 'N/A' },
    { id: 'standard', header: 'Standard', accessorFn: (r) => r.standard || '', cell: ({ row }) => row.original.standard || 'N/A' },
    { id: 'cost', header: 'Cost', accessorFn: (r) => Number(r.cost) || null, meta: { align: 'right' }, cell: ({ row }) => fmtMoney(row.original.cost, row.original.currency) },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit test for ${row.original.asset_no || 'asset'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:!text-red-400`} aria-label={`Delete test for ${row.original.asset_no || 'asset'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit, nowMs])

  const na = (v) => (rows === null ? 'N/A' : v)
  const pipelineTotal = Object.values(pipeline).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Emissions Tests"
        subtitle="Vehicle emissions certificates per asset: gas readings, pass or fail results, and the expiry that governs regulatory compliance."
        icon={Wind}
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
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned || !!error}>
              <Plus size={14} aria-hidden="true" /> Record test
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Emissions testing is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V178_EMISSIONS_TESTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-red-300 font-medium">Could not load emissions tests.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error} Nothing below is a reading of your data until this loads.</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* Filters */}
      <section className="card space-y-3" aria-label="Filters">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="em-search" className="label">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="em-search" className="input pl-9 w-full min-h-[44px]" placeholder="Asset, certificate, center, standard" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="em-asset" className="label">Asset</label>
            <select id="em-asset" className="input w-full min-h-[44px]" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
              <option value="">All assets</option>
              {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="em-result" className="label">Result</label>
            <select id="em-result" className="input w-full min-h-[44px]" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
              <option value="">All results</option>
              {RESULT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              <option value="none">Not recorded</option>
            </select>
          </div>
          <div>
            <label htmlFor="em-expiry" className="label">Certificate status</label>
            <select id="em-expiry" className="input w-full min-h-[44px]" value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value)}>
              <option value="">All statuses</option>
              {EXPIRY_ORDER.map((s) => <option key={s} value={s}>{EXPIRY_LABELS[s]}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">
            {rows === null ? 'Not loaded' : `Figures below cover ${filtered.length.toLocaleString()} of ${all.length.toLocaleString()} tests`}
          </span>
        </div>
      </section>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Tests" value={na(kpis.totalTests.toLocaleString())} icon={Wind} sub={`${kpis.assets} assets`} index={0} />
        <StatTile label="Pass rate" value={na(fmtPct(kpis.passRate))} icon={ShieldCheck} tone={kpis.passRate != null && kpis.passRate < 90 ? 'warn' : 'accent'} sub={`${kpis.passCount} pass, ${kpis.failCount} fail`} index={1} />
        <StatTile label="Certified now" value={na(fmtPct(kpis.compliantShare))} icon={Truck} sub="assets with an unexpired certificate" index={2} />
        <StatTile label="Expired" value={na(kpis.expired)} icon={ShieldAlert} tone={kpis.expired > 0 ? 'crit' : 'neutral'} sub="latest certificate lapsed" index={3} />
        <StatTile label="Expiring soon" value={na(kpis.expiringSoon)} icon={CalendarClock} tone={kpis.expiringSoon > 0 ? 'warn' : 'neutral'} sub={`within ${EXPIRING_SOON_DAYS} days`} index={4} />
        <StatTile label="Expiry recorded" value={na(fmtPct(kpis.expiryCoverage))} icon={FlaskConical} sub={`${kpis.noExpiry} assets with no expiry`} index={5} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Renewal pipeline */}
        <section className="card space-y-3" aria-labelledby="em-pipe-title">
          <h3 id="em-pipe-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <CalendarClock size={15} aria-hidden="true" /> Renewal pipeline
          </h3>
          {loading ? <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" /> : pipelineTotal === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No certificates in this selection.</p>
          ) : (
            <ul className="space-y-2">
              {PIPELINE.map((p) => (
                <li key={p.key} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 text-[var(--text-secondary)] text-xs">{p.label}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                    <div className={`h-full rounded-full ${p.cls}`} style={{ width: `${(pipeline[p.key] / pipelineTotal) * 100}%` }} />
                  </div>
                  <span className="tabular-nums text-[var(--text-primary)] w-8 text-right">{pipeline[p.key]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Pollutants */}
        <section className="card space-y-3" aria-labelledby="em-pol-title">
          <h3 id="em-pol-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <FlaskConical size={15} aria-hidden="true" /> Average readings
          </h3>
          {loading ? <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" /> : (
            <dl className="grid grid-cols-2 gap-3">
              {pollutants.map((p) => (
                <div key={p.key}>
                  <dt className="text-xs text-[var(--text-muted)]">{p.label} ({p.unit})</dt>
                  <dd className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{p.average == null ? 'N/A' : p.average}</dd>
                  <dd className="text-[11px] text-[var(--text-muted)]">{p.samples} readings</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {/* Cost */}
        <section className="card space-y-3" aria-labelledby="em-cost-title">
          <h3 id="em-cost-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Coins size={15} aria-hidden="true" /> Test cost by currency
          </h3>
          {loading ? <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" /> : costs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No test costs recorded in this selection.</p>
          ) : (
            <ul className="space-y-2">
              {costs.map((c) => (
                <li key={c.currency} className="flex items-center justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">{c.currency === 'Unspecified' ? 'No currency recorded' : c.currency}</span>
                  <span className="tabular-nums font-semibold text-[var(--text-primary)]">
                    {fmtMoney(c.cost, c.currency === 'Unspecified' ? '' : c.currency)} <span className="text-xs font-normal text-[var(--text-muted)]">({c.tests} tests)</span>
                  </span>
                </li>
              ))}
              <li className="text-[11px] text-[var(--text-muted)]">Never added across currencies.</li>
            </ul>
          )}
        </section>
      </div>

      {/* Compliance snapshot */}
      <section className="space-y-2" aria-labelledby="em-snap-title">
        <h3 id="em-snap-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <ShieldCheck size={15} aria-hidden="true" /> Latest certificate per asset
          <span className="text-xs font-normal text-[var(--text-muted)]">soonest expiry first</span>
        </h3>
        <EnterpriseTable
          columns={snapshotColumns}
          data={snapshot}
          getRowId={(r) => String(r.asset_no)}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          exportFileName={reportFileName('TyrePulse Emissions Compliance', reportDateLabel())}
          emptyMessage={all.length === 0 ? 'No emissions tests recorded yet.' : 'No assets match these filters.'}
        />
      </section>

      {/* Tests */}
      <section className="space-y-2" aria-labelledby="em-tests-title">
        <h3 id="em-tests-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Wind size={15} aria-hidden="true" /> All tests
        </h3>
        <EnterpriseTable
          columns={testColumns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          viewKey="emissions"
          emptyMessage={all.length === 0 && !notProvisioned ? 'No emissions tests recorded yet. Record the first test.' : 'No tests match these filters.'}
        />
      </section>

      {/* Create / Edit */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit emissions test' : 'Record emissions test'}
        size="lg"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="em-form" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Record test'}
            </button>
          </div>
        )}
      >
        <form id="em-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="em-f-asset" className="label">Asset number *</label>
              <input id="em-f-asset" className="input w-full" required placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
            <div>
              <label htmlFor="em-f-cert" className="label">Certificate no. (optional)</label>
              <input id="em-f-cert" className="input w-full" placeholder="e.g. EM-2026-00123" value={form.certificate_no} maxLength={120} onChange={(e) => set('certificate_no', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="em-f-test" className="label">Test date</label>
              <input id="em-f-test" className="input w-full" type="date" value={form.test_date} onChange={(e) => set('test_date', e.target.value)} />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Blank uses today.</p>
            </div>
            <div>
              <label htmlFor="em-f-exp" className="label">Expiry date</label>
              <input id="em-f-exp" className="input w-full" type="date" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
            </div>
            <div>
              <label htmlFor="em-f-result" className="label">Result</label>
              <select id="em-f-result" className="input w-full" value={form.result} onChange={(e) => set('result', e.target.value)}>
                <option value="">Not recorded</option>
                {RESULT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="em-f-center" className="label">Test center (optional)</label>
              <input id="em-f-center" className="input w-full" placeholder="e.g. Riyadh Vehicle Testing" value={form.test_center} maxLength={200} onChange={(e) => set('test_center', e.target.value)} />
            </div>
            <div>
              <label htmlFor="em-f-std" className="label">Standard (optional)</label>
              <input id="em-f-std" className="input w-full" placeholder="e.g. Euro 5 or ASEP" value={form.standard} maxLength={120} onChange={(e) => set('standard', e.target.value)} />
            </div>
          </div>
          <fieldset>
            <legend className="label">Gas readings (optional)</legend>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                ['co_pct', 'CO %', '0.01', '0.5'], ['hc_ppm', 'HC ppm', '1', '120'], ['nox_ppm', 'NOx ppm', '1', '200'],
                ['opacity_pct', 'Opacity %', '0.1', '1.2'], ['co2_pct', 'CO2 %', '0.1', '13.5'],
              ].map(([k, label, step, ph]) => (
                <div key={k}>
                  <label htmlFor={`em-f-${k}`} className="text-xs text-[var(--text-muted)]">{label}</label>
                  <input id={`em-f-${k}`} className="input w-full" type="number" step={step} min="0" inputMode="decimal" placeholder={ph} value={form[k]} onChange={(e) => set(k, e.target.value)} />
                </div>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="em-f-cost" className="label">Cost (optional)</label>
              <input id="em-f-cost" className="input w-full" type="number" step="0.01" min="0" inputMode="decimal" placeholder="150" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
            </div>
            <div>
              <label htmlFor="em-f-cur" className="label">Currency (optional)</label>
              <input id="em-f-cur" className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="em-f-notes" className="label">Notes (optional)</label>
            <textarea id="em-f-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. re-test after ECU tune" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => !deleting && setConfirmDelete(null)}
        title="Delete this emissions test?"
        size="sm"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete.asset_no || 'Test'}, {confirmDelete.certificate_no || 'no certificate'}, {fmtDate(confirmDelete.test_date)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
