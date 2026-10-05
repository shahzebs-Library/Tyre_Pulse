/**
 * TollTransactions (route /toll-transactions) - toll-road charges per asset,
 * rebuilt on the Command Center kit to the owner's "Toll Transactions" mockup:
 * KPI strip, spend by route, daily trend, status donut, filter bar, the
 * transaction ledger, reconciliation overview and the selected-transaction
 * panel (raise dispute / mark reconciled).
 *
 * Runs on `toll_transactions` (V169). Money rules live in
 * src/lib/tollTransactionsAnalytics.js and the page shaping in
 * src/lib/tollTransactionsView.js: money is shown in its own currency, and a
 * scope mixing SAR, AED and EGP reports each currency on its own line.
 *
 * The table has no operator, trip link, toll evidence or dispute history
 * column; those places in the mockup read "Not recorded".
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, LineElement, PointElement,
  Filler, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Receipt, Coins, AlertTriangle, Clock, Tag, Search, X, FileSpreadsheet, FileText,
  Plus, Pencil, Trash2, RotateCcw, Upload, ChevronLeft, ChevronRight, CheckCircle2, MapPin, Truck, Download,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, Tabs, KitTable, Donut, ViewAll, fmtInt } from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTollTransactions, createTollTransaction, updateTollTransaction, deleteTollTransaction,
} from '../lib/api/tollTransactions'
import {
  filterTolls, summarizeTollAnalytics, monthlyTrend, methodMix, rollupsForCurrency,
  tollExportRows, currencyOf, titleCase, TOLL_STATUSES, TOLL_METHODS,
  EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/tollTransactionsAnalytics'
import {
  reconBucket, reconOverview, routeSpend, dailyTrend, tagSummary, previousWindow, changePct,
  selectionNav, statusPill, mapImportRows, IMPORT_TEMPLATE_HEADERS, RECON_META, CARD_PERIODS, periodRows,
} from '../lib/tollTransactionsView'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import './TollTransactions.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, LineElement, PointElement, Filler, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')
const READ_LIMIT = 500

const EMPTY_FORM = {
  asset_no: '', driver_name: '', tag_id: '', plaza_name: '', highway: '',
  transaction_at: '', amount: '', currency: '', payment_method: '', status: '', notes: '',
}

const fmtAmount = (v, currency) => {
  if (v == null || v === '') return 'N/A'
  const n = Number(v)
  if (!Number.isFinite(n)) return 'N/A'
  const num = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency && currency !== 'Unspecified' ? `${currency} ${num}` : num
}
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Local <input type="datetime-local"> value (YYYY-MM-DDTHH:mm) from an ISO/date. */
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const TOOLTIP = { backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1, titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)' }
const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: TOOLTIP },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }, grid: { display: false } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}
const DONUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-muted)', boxWidth: 10, font: { size: 11 } } }, tooltip: TOOLTIP },
}
const SERIES = ['#22c55e', '#06b6d4', '#f59e0b', '#ef4444', '#f97316', '#3b82f6', '#a855f7', '#94a3b8']

const NOT_RECORDED = <span className="cc-na">Not recorded</span>

export default function TollTransactions() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const [countryFilter, setCountryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [currencyFilter, setCurrencyFilter] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
  const [reconFilter, setReconFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('ledger')
  const [detailTab, setDetailTab] = useState('timeline')
  const [selectedId, setSelectedId] = useState(null)
  const [routePeriod, setRoutePeriod] = useState('all')
  const [dailyDays, setDailyDays] = useState(30)
  const [statusPeriod, setStatusPeriod] = useState('all')
  const [exportOpen, setExportOpen] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError] = useState('')
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listTollTransactions({ country: activeCountry, limit: READ_LIMIT })
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load toll transactions.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loaded = Array.isArray(rows)
  const loadState = { loading: !loaded && !error, data: rows, error: error || null, retry: load }
  const all = useMemo(() => rows || [], [rows])
  const baseFilter = useMemo(() => ({
    search, country: countryFilter, status: statusFilter, method: methodFilter,
    currency: currencyFilter, asset: assetFilter,
  }), [search, countryFilter, statusFilter, methodFilter, currencyFilter, assetFilter])
  const filtered = useMemo(() => filterTolls(all, { ...baseFilter, from: fromDate, to: toDate }), [all, baseFilter, fromDate, toDate])
  const ledgerRows = useMemo(() => (reconFilter ? filtered.filter((r) => reconBucket(r) === reconFilter) : filtered), [filtered, reconFilter])

  const summary = useMemo(() => summarizeTollAnalytics(filtered, { now: Date.now() }), [filtered])
  const recon = useMemo(() => reconOverview(filtered), [filtered])
  const tags = useMemo(() => tagSummary(filtered), [filtered])
  const routes = useMemo(() => routeSpend(periodRows(filtered, routePeriod, Date.now()), summary.currency), [filtered, routePeriod, summary.currency])
  const daily = useMemo(() => dailyTrend(filtered, { now: Date.now(), to: toDate, days: dailyDays, currency: summary.currency }), [filtered, toDate, dailyDays, summary.currency])
  const statusRecon = useMemo(() => reconOverview(periodRows(filtered, statusPeriod, Date.now())), [filtered, statusPeriod])
  const trend = useMemo(() => monthlyTrend(filtered, { now: Date.now(), currency: summary.currency }), [filtered, summary.currency])
  const methods = useMemo(() => methodMix(filtered), [filtered])
  const rollups = useMemo(() => rollupsForCurrency(filtered, summary.currency), [filtered, summary.currency])

  // Previous period: only when a full From/To window is chosen.
  const prevWin = previousWindow(fromDate, toDate)
  const prev = useMemo(() => {
    if (!prevWin) return null
    const p = filterTolls(all, { ...baseFilter, from: prevWin.from, to: prevWin.to })
    return { rows: p, summary: summarizeTollAnalytics(p, { now: Date.now() }), recon: reconOverview(p) }
  }, [all, baseFilter, prevWin?.from, prevWin?.to]) // eslint-disable-line react-hooks/exhaustive-deps
  const trendOf = (cur, before) => (prev ? changePct(cur, before) : null)
  const trendTitle = prevWin ? `Change vs ${prevWin.from} to ${prevWin.to}` : undefined

  const countryOptions = useMemo(() => [...new Set(all.map((r) => r.country).filter(Boolean))].sort(), [all])
  const currencyOptions = useMemo(() => [...new Set(all.map(currencyOf))].sort(), [all])
  const assetOptions = useMemo(() => [...new Set(all.map((r) => String(r.asset_no || '').trim()).filter(Boolean))].sort(), [all])
  const truncated = loaded && all.length >= READ_LIMIT

  const selected = useMemo(() => ledgerRows.find((r) => String(r.id) === String(selectedId)) || ledgerRows[0] || null, [ledgerRows, selectedId])
  const nav = selectionNav(ledgerRows, selected?.id)

  // ── Exports (whole filtered set, never one page) ─────────────────────────
  const exportRows = useMemo(() => tollExportRows(ledgerRows), [ledgerRows])
  const fileBase = async () => {
    const { reportFileName, reportDateLabel } = await loadExportUtils()
    return reportFileName('TyrePulse Toll Transactions', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  }
  const doExcel = async () => {
    try {
      const { exportToExcel } = await loadExportUtils()
      await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, await fileBase())
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }
  const doPdf = async () => {
    try {
      const { exportToPdf } = await loadExportUtils()
      await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Toll Transactions', await fileBase(), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }

  // ── Create / edit ────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', driver_name: r.driver_name || '', tag_id: r.tag_id || '',
      plaza_name: r.plaza_name || '', highway: r.highway || '',
      transaction_at: toLocalInput(r.transaction_at), amount: r.amount ?? '',
      currency: r.currency || '', payment_method: r.payment_method || '',
      status: r.status || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (form.amount !== '' && form.amount != null && !Number.isFinite(Number(form.amount))) {
      setFormError('Amount must be a number.'); return
    }
    if (form.amount !== '' && Number(form.amount) < 0) { setFormError('Amount cannot be negative.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        transaction_at: form.transaction_at ? new Date(form.transaction_at).toISOString() : null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateTollTransaction(editing.id, payload)
      else await createTollTransaction(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the toll transaction.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteTollTransaction(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the toll transaction.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const setStatus = useCallback(async (r, status) => {
    if (!r) return
    setBusyId(r.id); setActionError(''); setNotice('')
    try {
      await updateTollTransaction(r.id, { status })
      setNotice(status === 'disputed' ? `Dispute raised for ${r.asset_no || 'the transaction'}.` : `${r.asset_no || 'Transaction'} marked as reconciled.`)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not update the transaction status.'))
    } finally {
      setBusyId(null)
    }
  }, [load])

  // ── Import ───────────────────────────────────────────────────────────────
  const onImportFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setImporting(true); setImportError(''); setImportResult(null)
    try {
      const { parseWorkbook } = await import('../lib/import/parseWorkbook')
      const wb = await parseWorkbook(await f.arrayBuffer(), { fileName: f.name })
      const sheet = wb.sheets?.[0]
      if (!sheet) throw new Error('No sheet found in the file.')
      const { rows: payloads, skipped } = mapImportRows(sheet.rows || [])
      if (!payloads.length) throw new Error('No rows with an asset number were found. Check the column headers.')
      let saved = 0
      const failures = []
      for (const p of payloads.slice(0, 5000)) {
        try {
          await createTollTransaction({ ...p, country: activeCountry !== 'All' ? activeCountry : null })
          saved += 1
        } catch (err) {
          if (failures.length < 5) failures.push(`${p.asset_no}: ${toUserMessage(err, 'not saved')}`)
        }
      }
      setImportResult({ saved, skipped, failed: payloads.length - saved, failures, capped: payloads.length > 5000 })
      if (saved) await load()
    } catch (err) {
      setImportError(toUserMessage(err, 'Could not read that file.'))
    } finally {
      setImporting(false)
    }
  }

  const clearFilters = () => {
    setCountryFilter(''); setStatusFilter(''); setMethodFilter(''); setCurrencyFilter(''); setAssetFilter('')
    setFromDate(''); setToDate(''); setSearch(''); setReconFilter('')
  }
  const hasFilters = !!(countryFilter || statusFilter || methodFilter || currencyFilter || assetFilter || fromDate || toDate || search || reconFilter)
  const emptyAll = loaded && all.length === 0

  // ── Ledger columns ───────────────────────────────────────────────────────
  const columns = useMemo(() => [
    { key: 'when', header: 'Date and time', sortValue: (r) => r.transaction_at || '', cell: (r) => <span className="tt-nowrap">{fmtDateTime(r.transaction_at)}</span> },
    { key: 'asset', header: 'Asset', sortValue: (r) => r.asset_no || '', cell: (r) => <span className="tt-asset"><Truck size={13} aria-hidden="true" />{r.asset_no || 'N/A'}</span> },
    { key: 'route', header: 'Route', sortValue: (r) => r.highway || '', cell: (r) => (r.highway ? <span className="tt-route">{r.highway}</span> : NOT_RECORDED) },
    { key: 'tag', header: 'Tag / Payment', sortValue: (r) => r.tag_id || r.payment_method || '', cell: (r) => (
      <span className="tt-tag">
        <span>{r.tag_id || (r.payment_method ? titleCase(r.payment_method) : 'Not recorded')}</span>
        {r.tag_id && r.payment_method && <small>{titleCase(r.payment_method)}</small>}
      </span>
    ) },
    { key: 'plaza', header: 'Toll point', sortValue: (r) => r.plaza_name || '', cell: (r) => r.plaza_name || NOT_RECORDED },
    { key: 'amount', header: 'Amount', numeric: true, sortValue: (r) => (r.amount == null || r.amount === '' ? null : Number(r.amount)), cell: (r) => <b className="tt-amount">{fmtAmount(r.amount, currencyOf(r))}</b> },
    { key: 'status', header: 'Status', sortValue: (r) => reconBucket(r), cell: (r) => { const p = statusPill(r); return <span className={`cc-pill ${p.tone}`}>{p.label}</span> } },
    { key: 'trip', header: 'Linked trip', sortable: false, cell: () => <span className="cc-na" title="Toll charges are not linked to trips.">Not recorded</span> },
    { key: 'actions', header: '', sortable: false, align: 'right', cell: (r) => (
      <span className="tt-row-actions">
        <button type="button" className="cc-icon-btn" onClick={(e) => { e.stopPropagation(); openEdit(r) }} aria-label={`Edit toll for ${r.asset_no || 'asset'}`} title="Edit"><Pencil size={13} /></button>
        <button type="button" className="cc-icon-btn tt-danger" onClick={(e) => { e.stopPropagation(); setConfirmDelete(r) }} aria-label={`Delete toll for ${r.asset_no || 'asset'}`} title="Delete"><Trash2 size={13} /></button>
      </span>
    ) },
  ], [openEdit])

  const assetColumns = useMemo(() => [
    { key: 'asset_no', header: 'Asset' },
    { key: 'count', header: 'Charges', numeric: true },
    { key: 'amount', header: 'Spend', numeric: true, cell: (a) => fmtAmount(a.amount, summary.currency) },
  ], [summary.currency])
  const plazaColumns = useMemo(() => [
    { key: 'plaza', header: 'Toll point' },
    { key: 'count', header: 'Charges', numeric: true },
    { key: 'amount', header: 'Spend', numeric: true, cell: (p) => fmtAmount(p.amount, summary.currency) },
  ], [summary.currency])

  // ── KPI strip ────────────────────────────────────────────────────────────
  const moneyNote = summary.mixedCurrency ? 'Mixed currencies: see the per-currency split' : null
  const kpiLoading = !loaded && !error
  const routeMax = routes.reduce((m, r) => Math.max(m, r.amount), 0)

  const dailyData = {
    labels: daily.series.map((d) => d.day.slice(5)),
    datasets: [{
      data: daily.series.map((d) => (daily.metric === 'amount' ? d.amount : d.count)),
      borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.18)', fill: true, tension: 0.35, pointRadius: 2,
    }],
  }

  return (
    <div className="cc tt-page">
      {/* Header */}
      <div className="tt-head">
        <div className="tt-hero-img cc-hero-dark" style={{ backgroundImage: 'url(/dashboard/hero-toll-dark.webp)' }} aria-hidden="true" />
        <div className="tt-hero-img cc-hero-light" style={{ backgroundImage: 'url(/dashboard/hero-toll-light.webp)' }} aria-hidden="true" />
        <div className="tt-head-copy">
          <div className="tt-crumb">Monitoring and Logistics <ChevronRight size={12} aria-hidden="true" /> <span>Toll Transactions</span></div>
          <h1>Toll Transactions</h1>
          <p>Track toll-road charges, reconciliation, disputes and trip-level cost visibility across your fleet.</p>
        </div>
        <div className="tt-head-actions">
          <div className="tt-btn-row">
            <button type="button" className="cc-btn-ghost" onClick={() => { setImportResult(null); setImportError(''); setImportOpen(true) }} disabled={notProvisioned || !loaded}>
              <Upload size={14} aria-hidden="true" /> Import
            </button>
            <span className="tt-menu-wrap">
              <button type="button" className="cc-btn-ghost" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)} disabled={!ledgerRows.length}>
                <Download size={14} aria-hidden="true" /> Export
              </button>
              {exportOpen && (
                <span className="tt-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setExportOpen(false); doExcel() }}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                  <button type="button" role="menuitem" onClick={() => { setExportOpen(false); doPdf() }}><FileText size={14} aria-hidden="true" /> PDF</button>
                </span>
              )}
            </span>
            <button type="button" className="cc-btn-primary" onClick={openCreate} disabled={notProvisioned || !loaded}><Plus size={14} aria-hidden="true" /> Add Transaction</button>
          </div>
          <div className="tt-btn-row">
            <span className="tt-range" role="group" aria-label="Date range">
              <input type="date" className="cc-select" aria-label="From date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
              <span aria-hidden="true">to</span>
              <input type="date" className="cc-select" aria-label="To date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
            </span>
            <select className="cc-select tt-head-sel" aria-label="Country" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
              <option value="">All Countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="cc-select tt-head-sel" aria-label="Operator" disabled title="Toll operator is not recorded on toll transactions.">
              <option>All Operators</option>
            </select>
          </div>
        </div>
      </div>

      {notProvisioned && (
        <div className="cc-card tt-banner" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <div><b>Toll transactions are not enabled on this database yet.</b><p>Apply MIGRATIONS_V169_TOLL_TRANSACTIONS.sql, then reload.</p></div>
        </div>
      )}
      {error && (
        <div className="cc-card tt-banner bad" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div><b>Could not load toll transactions.</b><p>{error}</p></div>
          <button type="button" className="cc-btn-ghost" onClick={load} disabled={refreshing}><RotateCcw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {actionError && (
        <div className="cc-card tt-banner bad" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div><p>{actionError}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}
      {notice && (
        <div className="cc-card tt-banner good" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <div><p>{notice}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setNotice('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}
      {emptyAll && !notProvisioned && (
        <div className="cc-card tt-banner" role="status">
          <Receipt size={18} aria-hidden="true" />
          <div><b>No toll transactions recorded yet.</b><p>Add the first charge by hand or import a statement from your toll operator (CSV or Excel). Every figure on this page fills in from those records.</p></div>
          <button type="button" className="cc-btn-primary" onClick={openCreate}><Plus size={14} aria-hidden="true" /> Add Transaction</button>
        </div>
      )}

      {/* KPI strip */}
      <div className="cc-kpis tt-kpis">
        <Kpi icon={Coins} tone="t-green" loading={kpiLoading}
          display={summary.mixedCurrency ? 'Mixed' : fmtAmount(summary.totalAmount, summary.currency)}
          trend={summary.currency && prev?.summary.currency === summary.currency ? trendOf(summary.totalAmount, prev.summary.totalAmount) : null}
          goodWhenUp={false} title={trendTitle}
          label={<>Total toll spend<small className="tt-kpi-sub">{moneyNote || (summary.unpricedCount ? `${summary.unpricedCount} without an amount` : `${fmtInt(summary.total)} transactions`)}</small></>} />
        <Kpi icon={AlertTriangle} tone="t-red" loading={kpiLoading} value={loaded ? summary.disputedCount : null}
          trend={trendOf(summary.disputedCount, prev?.summary.disputedCount)} goodWhenUp={false} title={trendTitle}
          onClick={() => { setReconFilter('disputed'); setTab('ledger') }}
          label={<>Disputed transactions<small className="tt-kpi-sub">{fmtPct(summary.disputeRatePct)} of total</small></>} />
        <Kpi icon={Clock} tone="t-amber" loading={kpiLoading} value={loaded ? recon.unreconciled : null}
          trend={trendOf(recon.unreconciled, prev?.recon.unreconciled)} goodWhenUp={false} title={trendTitle}
          onClick={() => { setReconFilter('unreconciled'); setTab('ledger') }}
          label={<>Unreconciled transactions<small className="tt-kpi-sub">{fmtPct(recon.unreconciledPct)} of total</small></>} />
        <Kpi icon={Receipt} tone="t-blue" loading={kpiLoading}
          display={summary.mixedCurrency ? 'Mixed' : fmtAmount(summary.avgAmount, summary.currency)}
          title="Average per priced charge. Charges carry no trip link, so a per-trip cost cannot be measured."
          label={<>Average charge<small className="tt-kpi-sub">{moneyNote ? 'Pick one currency' : 'Per transaction (no trip link recorded)'}</small></>} />
        <Kpi icon={Tag} tone="t-purple" loading={kpiLoading} value={loaded ? tags.tags : null}
          label={<>Active tags<small className="tt-kpi-sub">{loaded ? `Across ${fmtInt(tags.assets)} assets` : 'N/A'}</small></>} />
      </div>
      {loaded && (
        <p className="tt-scope">
          These figures cover the {fmtInt(filtered.length)} transaction{filtered.length === 1 ? '' : 's'} matching the current filters
          {truncated ? `. Only the most recent ${READ_LIMIT} transactions are loaded, so older charges are not included.` : '.'}
          {!prevWin && ' Pick a From and To date to compare with the previous period.'}
        </p>
      )}

      {/* Per-currency split: money is never added across currencies */}
      {loaded && summary.currencies.length > 1 && (
        <Card title="Spend by currency" sub="This scope mixes currencies, so each is reported on its own. Pick one to see totals, routes and trend in one currency.">
          <div className="tt-cur-grid">
            {summary.currencies.map((c) => (
              <button type="button" key={c.currency} className="tt-cur" onClick={() => setCurrencyFilter(c.currency)} aria-label={`Show only ${c.currency} transactions`}>
                <span>{c.currency}</span>
                <b>{fmtAmount(c.priced ? c.amount : null, c.currency)}</b>
                <small>{c.count} charge{c.count === 1 ? '' : 's'} | disputed {fmtAmount(c.priced ? c.disputedAmount : null, c.currency)}</small>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Route / daily / status */}
      <div className="tt-row3">
        <Card title="Toll Spend by Route" sub={summary.currency ? `Top routes by toll spend (${summary.currency})` : 'Top routes by toll spend'}
          action={<select className="cc-select tt-card-sel" aria-label="Route period" value={routePeriod} onChange={(e) => setRoutePeriod(e.target.value)}>{CARD_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>}>
          <CardState state={loadState} empty={
            summary.mixedCurrency ? 'Routes are ranked in one currency. Pick a currency above.'
              : routes.length === 0 ? 'No priced toll charges in this scope yet.' : null
          }>
            <div className="tt-routes">
              {routes.map((r, i) => (
                <div key={r.route} className="tt-route-row">
                  <span className="tt-route-name" title={r.route}>{r.route}</span>
                  <span className="cc-bar-track"><i style={{ width: `${routeMax ? (r.amount / routeMax) * 100 : 0}%`, background: SERIES[i % SERIES.length] }} /></span>
                  <b>{fmtAmount(r.amount, summary.currency)}</b>
                </div>
              ))}
            </div>
          </CardState>
        </Card>

        <Card title={daily.metric === 'amount' ? 'Daily Toll Spend Trend' : 'Daily Transactions Trend'} sub={`Last ${dailyDays} days${toDate ? ` to ${toDate}` : ''}${daily.metric === 'count' && summary.mixedCurrency ? ', counted because currencies are mixed' : ''}`}
          action={<select className="cc-select tt-card-sel" aria-label="Trend window" value={dailyDays} onChange={(e) => setDailyDays(Number(e.target.value))}><option value={7}>Last 7 Days</option><option value={30}>Last 30 Days</option><option value={90}>Last 90 Days</option></select>}>
          <CardState state={loadState} empty={!daily.any ? `No toll transactions in the last ${dailyDays} days of this scope.` : null}>
            <div className="tt-chart" role="img" aria-label={`Daily toll trend for the last ${dailyDays} days`}><Line data={dailyData} options={CHART_OPTS} /></div>
          </CardState>
        </Card>

        <Card title="Transaction Status" sub="Reconciliation state of transactions in scope"
          action={<select className="cc-select tt-card-sel" aria-label="Status period" value={statusPeriod} onChange={(e) => setStatusPeriod(e.target.value)}>{CARD_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>}>
          <CardState state={loadState} empty={statusRecon.total === 0 ? 'No transactions to break down in this period.' : null}>
            <Donut segments={statusRecon.segments} total={statusRecon.total} centerLabel="Total" onSelect={(s) => { setReconFilter(s.key); setTab('ledger') }} />
          </CardState>
        </Card>
      </div>

      {/* Filters */}
      <div className="cc-card">
        <div className="cc-filters tt-filters">
          <label className="cc-field"><span>Country</span>
            <select className="cc-select" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
              <option value="">All Countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="cc-field"><span>Operator</span>
            <select className="cc-select" disabled title="Toll operator is not recorded on toll transactions.">
              <option>All Operators</option>
            </select>
          </label>
          <label className="cc-field"><span>Asset</span>
            <select className="cc-select" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
              <option value="">All assets</option>
              {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="cc-field"><span>Payment type</span>
            <select className="cc-select" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
              <option value="">All types</option>
              {TOLL_METHODS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
            </select>
          </label>
          <label className="cc-field"><span>Status</span>
            <select className="cc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {TOLL_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </label>
          <label className="cc-field"><span>Currency</span>
            <select className="cc-select" value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)}>
              <option value="">All currencies</option>
              {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button type="button" className="cc-btn-ghost tt-push" onClick={clearFilters} disabled={!hasFilters}><RotateCcw size={14} aria-hidden="true" /> Reset filters</button>
        </div>
      </div>

        <div className="tt-ledger-grid">
          <Card title="Transaction Ledger" sub={loaded ? `${fmtInt(ledgerRows.length)} transactions${reconFilter ? `, ${RECON_META[reconFilter].label.toLowerCase()} only` : ''}` : undefined} className="tt-ledger"
            action={(
              <span className="tt-ledger-tools">
                {reconFilter && <button type="button" className="cc-link cc-link-btn" onClick={() => setReconFilter('')}>Show all</button>}
                <label className="cc-search tt-search">
                  <Search size={14} aria-hidden="true" />
                  <input aria-label="Search toll transactions" placeholder="Asset, tag, toll point, route" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
              </span>
            )}>
            <KitTable
              columns={columns}
              rows={ledgerRows}
              getRowId={(r) => String(r.id)}
              loading={!loaded && !error}
              error={error && !loaded ? error : null}
              onRetry={load}
              onRowClick={(r) => { setSelectedId(r.id); setDetailTab('timeline') }}
              empty={emptyAll ? 'No toll transactions recorded yet. Add your first transaction or import a statement.' : 'No transactions match these filters.'}
              viewKey="toll-transactions"
            />
          </Card>

          <div className="tt-side">
            <Card title="Reconciliation Overview" sub="Reconciled includes refunded charges" action={<ViewAll label="View All" onClick={() => setReconFilter('')} />}>
              <CardState state={loadState} empty={recon.total === 0 ? 'Nothing to reconcile yet.' : null}>
                <div className="tt-stack" role="img" aria-label={recon.segments.map((s) => `${s.label} ${s.count}`).join(', ')}>
                  {recon.segments.map((s) => s.count > 0 && <i key={s.key} style={{ width: `${(s.count / recon.total) * 100}%`, background: s.color }} />)}
                </div>
                <ul className="tt-stack-legend">
                  {recon.segments.map((s) => (
                    <li key={s.key}><i style={{ background: s.color }} aria-hidden="true" />{s.label} ({fmtInt(s.count)})<b>{fmtPct(recon[`${s.key}Pct`])}</b></li>
                  ))}
                </ul>
                <button type="button" className="cc-btn-ghost tt-wide" disabled={!recon.unreconciled} onClick={() => setReconFilter('unreconciled')}>
                  Reconcile Unmatched ({fmtInt(recon.unreconciled)}) <ChevronRight size={14} aria-hidden="true" />
                </button>
              </CardState>
            </Card>

            <Card title="Selected Transaction Details" action={selected && (
              <span className="tt-nav">
                <button type="button" className="cc-icon-btn" disabled={!nav.prev} onClick={() => setSelectedId(nav.prev?.id)} aria-label="Previous transaction"><ChevronLeft size={14} /></button>
                <span>{nav.index + 1} of {fmtInt(nav.total)}</span>
                <button type="button" className="cc-icon-btn" disabled={!nav.next} onClick={() => setSelectedId(nav.next?.id)} aria-label="Next transaction"><ChevronRight size={14} /></button>
              </span>
            )}>
              {!selected ? (
                <div className="cc-empty">{loaded ? 'Select a transaction in the ledger to see its details.' : 'Loading...'}</div>
              ) : (
                <div className="tt-detail">
                  <div className="tt-detail-top">
                    <div>
                      <h3><Truck size={15} aria-hidden="true" /> {selected.asset_no || 'N/A'}</h3>
                      <small>{fmtDateTime(selected.transaction_at)}</small>
                    </div>
                    <div className="tt-detail-amt">
                      <span className={`cc-pill ${statusPill(selected).tone}`}>{statusPill(selected).label}</span>
                      <b>{fmtAmount(selected.amount, currencyOf(selected))}</b>
                    </div>
                  </div>
                  <dl className="tt-dl">
                    <div><dt>Route</dt><dd>{selected.highway || NOT_RECORDED}</dd></div>
                    <div><dt>Toll point</dt><dd>{selected.plaza_name || NOT_RECORDED}</dd></div>
                    <div><dt>Operator</dt><dd>{NOT_RECORDED}</dd></div>
                    <div><dt>Payment method</dt><dd>{selected.payment_method ? titleCase(selected.payment_method) : NOT_RECORDED}</dd></div>
                    <div><dt>Tag</dt><dd>{selected.tag_id || NOT_RECORDED}</dd></div>
                    <div><dt>Driver</dt><dd>{selected.driver_name || NOT_RECORDED}</dd></div>
                    <div><dt>Linked trip</dt><dd>{NOT_RECORDED}</dd></div>
                    <div><dt>Transaction ID</dt><dd className="tt-mono">{String(selected.id).slice(0, 8)}</dd></div>
                  </dl>
                  <Tabs variant="line" label="Transaction details" value={detailTab} onChange={setDetailTab} tabs={[
                    { key: 'timeline', label: 'Trip timeline' },
                    { key: 'evidence', label: 'Toll evidence' },
                    { key: 'dispute', label: 'Dispute history' },
                    { key: 'notes', label: 'Notes' },
                  ]} />
                  <div className="tt-detail-body">
                    {detailTab === 'timeline' && <p>Not recorded. Toll charges are not linked to trips, so departure and arrival are not available for this charge.</p>}
                    {detailTab === 'evidence' && <p>Not recorded. No gantry photo or receipt is stored with toll charges.</p>}
                    {detailTab === 'dispute' && <p>Not recorded. Only the current status is stored{String(selected.status).toLowerCase() === 'disputed' ? ' (disputed)' : ''}; no dispute log is kept for toll charges.</p>}
                    {detailTab === 'notes' && <p>{selected.notes || 'No notes on this transaction.'}</p>}
                  </div>
                  <div className="tt-detail-actions">
                    <button type="button" className="cc-btn-ghost tt-danger-btn" disabled={busyId === selected.id || String(selected.status).toLowerCase() === 'disputed'} onClick={() => setStatus(selected, 'disputed')}>
                      <AlertTriangle size={14} aria-hidden="true" /> Raise dispute
                    </button>
                    <button type="button" className="cc-btn-primary" disabled={busyId === selected.id || String(selected.status).toLowerCase() === 'reconciled'} onClick={() => setStatus(selected, 'reconciled')}>
                      <CheckCircle2 size={14} aria-hidden="true" /> Mark as reconciled
                    </button>
                    <button type="button" className="cc-icon-btn" onClick={() => openEdit(selected)} aria-label="Edit this transaction" title="Edit"><Pencil size={13} /></button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>

      <div className="cc-card tt-tabbar">
        <span className="tt-more">More views</span>
        <Tabs label="More toll views" value={tab} onChange={setTab} tabs={[
          { key: 'ledger', label: 'Ledger only' },
          { key: 'rankings', label: 'Asset and toll point rankings' },
          { key: 'analysis', label: 'Monthly and payment mix' },
        ]} />
      </div>

      {tab === 'rankings' && (
        <div className="tt-two">
          <Card title="Toll spend by asset" action={<Truck size={15} aria-hidden="true" />}>
            {summary.mixedCurrency
              ? <div className="cc-empty">Rankings need one currency. Choose a currency filter above.</div>
              : <KitTable columns={assetColumns} rows={rollups.assets} getRowId={(a) => a.asset_no} loading={!loaded && !error} empty="No toll charges carry an asset number." />}
          </Card>
          <Card title="Toll spend by toll point" action={<MapPin size={15} aria-hidden="true" />}>
            {summary.mixedCurrency
              ? <div className="cc-empty">Rankings need one currency. Choose a currency filter above.</div>
              : <KitTable columns={plazaColumns} rows={rollups.plazas} getRowId={(p) => p.plaza} loading={!loaded && !error} empty="No toll charges carry a toll point name." />}
          </Card>
        </div>
      )}

      {tab === 'analysis' && (
        <div className="tt-two tt-two-wide">
          <Card title={summary.currency ? `Monthly toll spend (${summary.currency}), last 12 months` : 'Monthly transactions, last 12 months'}>
            <CardState state={loadState} empty={!trend.some((t) => t.count > 0) ? 'No transactions in the last 12 months for this scope.' : null}>
              <div className="tt-chart tt-chart-lg" role="img" aria-label="Monthly toll trend">
                <Bar data={{ labels: trend.map((t) => t.month), datasets: [{ data: trend.map((t) => (summary.currency ? t.amount : t.count)), backgroundColor: 'rgba(34,197,94,0.75)', borderRadius: 4 }] }} options={CHART_OPTS} />
              </div>
            </CardState>
          </Card>
          <Card title="Payment method mix">
            <CardState state={loadState} empty={!methods.length ? 'No transactions to break down.' : null}>
              <div className="tt-chart tt-chart-lg" role="img" aria-label="Transactions by payment method">
                <Doughnut data={{ labels: methods.map((m) => m.label), datasets: [{ data: methods.map((m) => m.count), backgroundColor: methods.map((_, i) => SERIES[i % SERIES.length]), borderWidth: 0 }] }} options={DONUT_OPTS} />
              </div>
            </CardState>
          </Card>
        </div>
      )}

      {/* Create / Edit */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit toll transaction' : 'Add toll transaction'}
        size="lg"
        footer={
          <div className="tt-modal-foot">
            <button type="button" onClick={closeModal} className="cc-btn-ghost" disabled={saving}>Cancel</button>
            <button type="submit" form="toll-form" className="cc-btn-primary" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Add transaction'}
            </button>
          </div>
        }
      >
        <form id="toll-form" onSubmit={submit} className="cc tt-form" noValidate>
          <div className="tt-form-grid">
            <label htmlFor="tf-asset">Asset number <span aria-hidden="true">*</span>
              <input id="tf-asset" className="cc-select tt-input" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} required onChange={(e) => set('asset_no', e.target.value)} />
            </label>
            <label htmlFor="tf-driver">Driver (optional)
              <input id="tf-driver" className="cc-select tt-input" placeholder="e.g. Ahmed Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
            </label>
            <label htmlFor="tf-plaza">Toll point (optional)
              <input id="tf-plaza" className="cc-select tt-input" placeholder="e.g. Riyadh North Plaza" value={form.plaza_name} maxLength={200} onChange={(e) => set('plaza_name', e.target.value)} />
            </label>
            <label htmlFor="tf-highway">Route or highway (optional)
              <input id="tf-highway" className="cc-select tt-input" placeholder="e.g. Highway 40" value={form.highway} maxLength={200} onChange={(e) => set('highway', e.target.value)} />
            </label>
            <label htmlFor="tf-when">Transaction date and time
              <input id="tf-when" className="cc-select tt-input" type="datetime-local" value={form.transaction_at} onChange={(e) => set('transaction_at', e.target.value)} />
            </label>
            <label htmlFor="tf-tag">Tag ID (optional)
              <input id="tf-tag" className="cc-select tt-input" placeholder="e.g. RFID-88231" value={form.tag_id} maxLength={120} onChange={(e) => set('tag_id', e.target.value)} />
            </label>
            <label htmlFor="tf-amount">Amount
              <input id="tf-amount" className="cc-select tt-input" type="number" step="0.01" min="0" inputMode="decimal" placeholder="25.00" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
            </label>
            <label htmlFor="tf-currency">Currency (optional)
              <input id="tf-currency" className="cc-select tt-input" placeholder="SAR" value={form.currency} maxLength={12} onChange={(e) => set('currency', e.target.value)} />
            </label>
            <label htmlFor="tf-method">Payment method
              <select id="tf-method" className="cc-select tt-input" value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
                <option value="">None</option>
                {TOLL_METHODS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
              </select>
            </label>
            <label htmlFor="tf-status">Status
              <select id="tf-status" className="cc-select tt-input" value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">None</option>
                {TOLL_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </label>
          </div>
          <label htmlFor="tf-notes">Notes (optional)
            <textarea id="tf-notes" className="cc-select tt-input tt-textarea" placeholder="e.g. disputed, duplicate charge on same trip" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </label>
          {formError && <p className="tt-err" role="alert">{formError}</p>}
        </form>
      </Modal>

      {/* Import */}
      <Modal
        open={importOpen}
        onClose={() => { if (!importing) setImportOpen(false) }}
        title="Import toll transactions"
        size="md"
        footer={
          <div className="tt-modal-foot">
            <button type="button" className="cc-btn-ghost" onClick={() => setImportOpen(false)} disabled={importing}>Close</button>
            <button type="button" className="cc-btn-primary" onClick={() => fileRef.current?.click()} disabled={importing}>
              <Upload size={14} aria-hidden="true" /> {importing ? 'Importing...' : 'Choose a file'}
            </button>
          </div>
        }
      >
        <div className="cc tt-form">
          <p>Upload a CSV or Excel statement. The first sheet is read; each row needs an asset number. Recognised columns:</p>
          <p className="tt-mono">{IMPORT_TEMPLATE_HEADERS.join(', ')}</p>
          <p>Rows are saved {activeCountry !== 'All' ? `under ${activeCountry}` : 'with no country (pick a country first to stamp one)'}.</p>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="tt-hidden" onChange={onImportFile} aria-label="Toll statement file" />
          {importError && <p className="tt-err" role="alert">{importError}</p>}
          {importResult && (
            <div role="status">
              <p><b>{fmtInt(importResult.saved)}</b> saved, {fmtInt(importResult.failed)} failed, {fmtInt(importResult.skipped)} skipped (no asset number).</p>
              {importResult.capped && <p>Only the first 5,000 rows were imported. Split the file for the rest.</p>}
              {importResult.failures.map((f, i) => <p key={i} className="tt-err">{f}</p>)}
            </div>
          )}
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this transaction?"
        size="sm"
        footer={
          <div className="tt-modal-foot">
            <button type="button" onClick={() => setConfirmDelete(null)} className="cc-btn-ghost" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="cc-btn-primary tt-danger-fill" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        {confirmDelete && (
          <p className="tt-confirm">
            {confirmDelete.asset_no || 'Transaction'} | {fmtAmount(confirmDelete.amount, currencyOf(confirmDelete))} | {fmtDateTime(confirmDelete.transaction_at)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
