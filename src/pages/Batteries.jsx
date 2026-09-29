/**
 * Batteries (route /batteries) - Battery Lifecycle Management, rebuilt on the
 * shared page kit to the owner's light reference design.
 *
 * Runs on the `batteries` table (MIGRATIONS_V146_BATTERIES.sql): serial, asset,
 * brand, install date, warranty term, health %, voltage, status and site. When
 * the table is not deployed the page says so rather than pretending the fleet
 * has no batteries.
 *
 * Lifecycle maths lives in `src/lib/batteries.js`, page shaping (enrichment,
 * warranty window, filters, export rows) in `src/lib/batteriesAnalytics.js`,
 * and the mockup blocks (KPIs, health donut, replacement forecast, lifecycle
 * stages) in `src/lib/batteryLifecycleView.js`.
 *
 * Honest gaps: the table has no battery type and no state of charge, so the
 * register shows neither and the mockup's type filter is not offered. No
 * earlier snapshot is stored, so KPI tiles carry no trend arrows.
 *
 * Kept from the previous page: register / edit / delete, search and the
 * status, asset, warranty and needs-attention filters, Excel and PDF export
 * of the filtered register, loading, error with Retry and not-provisioned
 * states.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  BatteryCharging, CheckCircle2, ShieldCheck, AlertTriangle, RefreshCw, HeartPulse,
  Plus, Pencil, Trash2, Search, X, FileSpreadsheet, FileText, CalendarClock, Eye, Info,
  CircleSlash, Clock, Loader2,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import {
  Card, CardState, Kpi, PageHero, Donut, Pager, KitTable, fmtInt,
} from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import {
  listBatteries, createBattery, updateBattery, deleteBattery,
} from '../lib/api/batteries'
import { warrantyExpiry } from '../lib/batteries'
import {
  BATTERY_STATUSES, EMPTY_BATTERY_FILTERS, WARRANTY_SOON_DAYS,
  enrichBatteries, assetOptions, activeBatteryFilterCount, batteryExportRows,
  BATTERY_EXPORT_COLUMNS, statusLabel,
} from '../lib/batteriesAnalytics'
import {
  lifecycleKpis, healthDistribution, replacementForecast, lifecycleStages, filterRegister,
  siteOptions, warrantyText, healthTone, statusView, ageYears, FORECAST_RULE, STAGE_RULE,
} from '../lib/batteryLifecycleView'
import { greeting } from '../lib/commandCenter'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import './Batteries.css'

const EMPTY_FORM = {
  serial_no: '', asset_no: '', brand: '', install_date: '', warranty_months: '',
  health_pct: '', voltage: '', status: 'healthy', site: '', notes: '',
}
const EMPTY_FILTERS = { ...EMPTY_BATTERY_FILTERS, site: '' }
const STAGE_ICON = { in_service: BatteryCharging, aging: AlertTriangle, due: RefreshCw, warranty: ShieldCheck, retired: CircleSlash }

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function EmptyInvite({ onAdd, missing, text = 'No batteries registered yet.' }) {
  if (missing) return 'Battery tracking is not enabled on this database yet.'
  return (
    <div>
      {text}
      <br />
      <button type="button" className="cc-btn" onClick={onAdd}>Add battery</button>
    </div>
  )
}

export default function Batteries() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0) }
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [selection, setSelection] = useState({})

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmSchedule, setConfirmSchedule] = useState(null)
  const [scheduling, setScheduling] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listBatteries({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setNowMs(Date.now())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load batteries.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  const failed = Boolean(error)
  const state = { loading: loading || (refreshing && !rows?.length), data: failed ? null : rows, error: failed ? error : null, retry: load }

  const enriched = useMemo(() => enrichBatteries(rows || [], nowMs), [rows, nowMs])
  const kpi = useMemo(() => lifecycleKpis(enriched, nowMs), [enriched, nowMs])
  const dist = useMemo(() => healthDistribution(enriched), [enriched])
  const forecast = useMemo(() => replacementForecast(enriched, nowMs), [enriched, nowMs])
  const stages = useMemo(() => lifecycleStages(enriched, nowMs), [enriched, nowMs])
  const assets = useMemo(() => assetOptions(rows || []), [rows])
  const sites = useMemo(() => siteOptions(rows || []), [rows])
  const filtered = useMemo(() => filterRegister(enriched, filters), [enriched, filters])
  const filterCount = activeBatteryFilterCount(filters) + (filters.site ? 1 : 0)
  const pageRows = useMemo(() => filtered.slice(page * pageSize, (page + 1) * pageSize), [filtered, page, pageSize])
  const selectedRows = useMemo(() => enriched.filter((r) => selection[String(r.id)]), [enriched, selection])

  useEffect(() => {
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
    if (page > pages - 1) setPage(pages - 1)
  }, [filtered.length, pageSize, page])

  const doExport = async (kind) => {
    const out = batteryExportRows(filtered)
    const keys = BATTERY_EXPORT_COLUMNS.map(([k]) => k)
    const headers = BATTERY_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse Battery Lifecycle')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name)
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Battery Lifecycle', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      serial_no: r.serial_no || '', asset_no: r.asset_no || '', brand: r.brand || '',
      install_date: r.install_date || '', warranty_months: r.warranty_months ?? '',
      health_pct: r.health_pct ?? '', voltage: r.voltage ?? '', status: r.status || 'healthy',
      site: r.site || '', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }, [])
  const closeModal = () => { if (!saving) { setModalOpen(false); setEditing(null) } }

  const replaceRow = (saved) => setRows((prev) => (prev || []).map((r) => (r.id === saved.id ? saved : r)))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim() && !form.serial_no.trim()) {
      setFormError('Enter an asset number or a serial number.'); return
    }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry && activeCountry !== 'All' ? activeCountry : null }
      const saved = editing ? await updateBattery(editing.id, payload) : await createBattery(payload)
      setRows((prev) => {
        const list = prev || []
        return editing ? list.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...list]
      })
      setModalOpen(false); setEditing(null)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the battery.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDel) return
    setDeleting(true)
    try {
      await deleteBattery(confirmDel.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDel.id))
      setSelection((s) => { const n = { ...s }; delete n[String(confirmDel.id)]; return n })
      setConfirmDel(null)
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not delete the battery.'))
      setConfirmDel(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDel])

  const askSchedule = (list) => {
    const eligible = list.filter((r) => r.status !== 'replace' && r.status !== 'retired')
    if (!list.length) { setNotice('Select one or more batteries in the register first, or use the calendar button on a row.'); return }
    if (!eligible.length) { setNotice('The selected batteries are already marked Replace or are retired.'); return }
    setConfirmSchedule(eligible)
  }

  const doSchedule = async () => {
    if (!confirmSchedule) return
    setScheduling(true)
    let failedCount = 0
    for (const r of confirmSchedule) {
      try { replaceRow(await updateBattery(r.id, { status: 'replace' })) } catch { failedCount += 1 }
    }
    setScheduling(false)
    setConfirmSchedule(null)
    setSelection({})
    if (failedCount) setNotice(`${failedCount} of the selected batteries could not be marked for replacement. Try again.`)
  }

  const kv = (v) => (failed || missing ? null : v)
  const kpis = [
    { icon: BatteryCharging, tone: 't-green', value: kv(kpi.total), label: 'Total batteries' },
    { icon: CheckCircle2, tone: 't-green', value: kv(kpi.active), label: 'Active batteries', title: 'Every battery not retired' },
    { icon: ShieldCheck, tone: 't-blue', value: kv(kpi.underWarranty), label: 'Under warranty', title: 'In service with warranty time left (install date plus warranty months)' },
    { icon: AlertTriangle, tone: 't-amber', value: kv(kpi.lowHealth), label: 'Low health', title: 'In service with recorded health below 50%', onClick: () => setFilters({ ...EMPTY_FILTERS, attentionOnly: true }) },
    { icon: RefreshCw, tone: 't-red', value: kv(kpi.replacementsDue), label: 'Replacements due', title: FORECAST_RULE },
    {
      icon: HeartPulse, tone: 't-green', label: 'Avg. battery health',
      display: failed || missing || kpi.avgHealth == null ? 'N/A' : `${Math.round(kpi.avgHealth)}%`,
      title: kpi.total ? `${kpi.measured} of ${kpi.total} batteries have a recorded health reading` : 'No health readings recorded',
    },
  ]

  const columns = [
    {
      key: 'serial', header: 'Battery ID', sortValue: (r) => r.serial_no || '',
      cell: (r) => <span className="cc-strong">{r.serial_no || <span className="cc-na">N/A</span>}</span>,
    },
    { key: 'asset', header: 'Asset no', cell: (r) => r.asset_no || <span className="cc-na">N/A</span> },
    { key: 'brand', header: 'Brand', cell: (r) => r.brand || <span className="cc-na">N/A</span> },
    { key: 'installed', header: 'Install date', cell: (r) => (r.install_date ? fmtDate(r.install_date) : <span className="cc-na">N/A</span>) },
    {
      key: 'age', header: 'Age',
      cell: (r) => { const a = ageYears(r.install_date, nowMs); return a == null ? <span className="cc-na">N/A</span> : `${a} yrs` },
    },
    {
      key: 'voltage', header: 'Voltage / charge',
      cell: (r) => (
        <span className="bt-volt" title="The register records voltage only; state of charge is not captured.">
          {r.voltage == null || r.voltage === '' ? <span className="cc-na">N/A</span> : `${Number(r.voltage)} V`}
          <span className="cc-na"> / N/A</span>
        </span>
      ),
    },
    {
      key: 'health', header: 'Health',
      cell: (r) => (r._health == null
        ? <span className="cc-na">Not measured</span>
        : <span className={`cc-pill ${healthTone(r._health)}`}>{Math.round(r._health)}%</span>),
    },
    {
      key: 'warranty', header: 'Warranty',
      cell: (r) => { const w = warrantyText(r._warranty); return <span className={`cc-pill ${w.tone}`}>{w.text}</span> },
    },
    { key: 'site', header: 'Site', cell: (r) => r.site || <span className="cc-na">N/A</span> },
    {
      key: 'status', header: 'Status',
      cell: (r) => { const s = statusView(r.status); return <span className={`cc-pill ${s.tone}`}>{s.label}</span> },
    },
    {
      key: 'actions', header: 'Actions', sortable: false,
      cell: (r) => {
        const who = r.asset_no || r.serial_no || 'battery'
        const canClaim = r._warranty?.key === 'active' || r._warranty?.key === 'soon'
        return (
          <div className="bt-actions" onClick={(e) => e.stopPropagation()} role="presentation">
            <button type="button" className="cc-icon-btn" onClick={() => openEdit(r)} aria-label={`View or edit ${who}`} title="View or edit"><Eye size={14} /></button>
            <button type="button" className="cc-icon-btn" onClick={() => askSchedule([r])} disabled={r.status === 'replace' || r.status === 'retired'} aria-label={`Schedule replacement for ${who}`} title={r.status === 'replace' ? 'Already marked Replace' : 'Schedule replacement (mark as Replace)'}><CalendarClock size={14} /></button>
            {canClaim
              ? <Link className="cc-icon-btn" to="/warranty" aria-label={`Claim warranty for ${who}`} title="Open the warranty tracker to raise a claim"><ShieldCheck size={14} /></Link>
              : <button type="button" className="cc-icon-btn" disabled aria-label={`Warranty claim not available for ${who}`} title="No warranty time left or no warranty recorded"><ShieldCheck size={14} /></button>}
            <button type="button" className="cc-icon-btn bt-danger" onClick={() => setConfirmDel(r)} aria-label={`Delete ${who}`} title="Delete"><Trash2 size={14} /></button>
          </div>
        )
      },
    },
  ]

  const previewExpiry = form.install_date && form.warranty_months
    ? warrantyExpiry({ install_date: form.install_date, warranty_months: form.warranty_months })
    : null

  const noData = !failed && !loading && kpi.total === 0
  const maxBar = Math.max(1, ...forecast.buckets.map((b) => b.count))

  return (
    <div className="cc bt-page">
      <PageHero
        hello={`${greeting()},`}
        title="Battery Lifecycle Management"
        lead="Maximize battery performance, safety and lifecycle value across your fleet."
        imgLight="/dashboard/hero-battery-light.webp"
        imgDark="/dashboard/hero-battery-dark.webp"
      />

      {missing && (
        <div className="cc-card bt-banner warn" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <b>Battery tracking is not enabled on this database yet.</b>
            <p>Apply MIGRATIONS_V146_BATTERIES.sql, then reload.</p>
          </div>
        </div>
      )}
      {notice && (
        <div className="cc-card bt-banner warn" role="status">
          <Info size={18} aria-hidden="true" />
          <div><p>{notice}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setNotice('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      <div className="bt-row">
        <Card title="Battery Health Distribution" action={<button type="button" className="cc-link cc-link-btn" onClick={() => setFilters(EMPTY_FILTERS)}>View all batteries</button>}>
          <CardState state={state} empty={noData || missing ? <EmptyInvite onAdd={openCreate} missing={missing} /> : dist.measured === 0 ? 'No battery has a recorded health reading yet. Add health % when editing a battery.' : null}>
            <Donut segments={dist.segments} total={dist.avg} centerLabel="Avg. health %" />
            {dist.notMeasured > 0 && <p className="bt-note">{fmtInt(dist.notMeasured)} batteries have no health reading and are not shown.</p>}
          </CardState>
        </Card>

        <Card title="Replacement Forecast" sub="Next 12 months">
          <CardState state={state} empty={noData || missing ? <EmptyInvite onAdd={openCreate} missing={missing} /> : null}>
            <div className="bt-fc-head">
              <span><b>{fmtInt(forecast.dueNow)}</b> due now</span>
              <span><b>{fmtInt(forecast.total)}</b> in the next 12 months</span>
              {forecast.unforecastable > 0 && <span>{fmtInt(forecast.unforecastable)} with no install date</span>}
            </div>
            <div className="bt-bars" role="img" aria-label={forecast.buckets.map((b) => `${b.label} ${b.year}: ${b.count}`).join(', ')}>
              {forecast.buckets.map((b) => (
                <div key={b.key} className="bt-bar" title={`${b.label} ${b.year}: ${b.count}`}>
                  <span className="bt-bar-n">{b.count || ''}</span>
                  <i style={{ height: `${(b.count / maxBar) * 100}%` }} />
                  <small>{b.label}</small>
                </div>
              ))}
            </div>
            <p className="bt-note">{FORECAST_RULE}</p>
          </CardState>
        </Card>

        <Card title="Lifecycle Stages">
          <CardState state={state} empty={noData || missing ? <EmptyInvite onAdd={openCreate} missing={missing} /> : null}>
            <div className="bt-stages">
              {stages.map((s) => {
                const Icon = STAGE_ICON[s.key] || Clock
                return (
                  <div key={s.key} className="bt-stage">
                    <span className={`cc-row-icon ${s.tone}`}><Icon size={15} aria-hidden="true" /></span>
                    <span className="bt-stage-label">{s.label}</span>
                    <span className="cc-bar-track"><i style={{ width: `${s.pct ?? 0}%`, background: s.color }} /></span>
                    <b>{fmtInt(s.count)}</b>
                    <span className="bt-stage-pct">{s.pct == null ? 'N/A' : `${s.pct}%`}</span>
                  </div>
                )
              })}
            </div>
            <p className="bt-note">{STAGE_RULE}</p>
          </CardState>
        </Card>
      </div>

      <section className="cc-card" aria-label="Battery register">
        <div className="cc-filters bt-filters">
          <label className="cc-search">
            <Search size={15} aria-hidden="true" />
            <input aria-label="Search batteries" placeholder="Search battery ID, asset no, brand, site, notes..." value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
          </label>
          <select className="cc-select" aria-label="Site" value={filters.site} onChange={(e) => setFilter('site', e.target.value)}>
            <option value="">All sites</option>
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="cc-select" aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="all">All statuses</option>
            {BATTERY_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <select className="cc-select" aria-label="Asset" value={filters.asset} onChange={(e) => setFilter('asset', e.target.value)}>
            <option value="">All assets</option>
            {assets.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="cc-select" aria-label="Warranty" value={filters.warranty} onChange={(e) => setFilter('warranty', e.target.value)}>
            <option value="all">Any warranty state</option>
            <option value="active">In warranty</option>
            <option value="soon">Ending within {WARRANTY_SOON_DAYS} days</option>
            <option value="expired">Expired</option>
            <option value="unknown">Not recorded</option>
          </select>
          <button type="button" className="cc-btn-ghost" aria-pressed={filters.attentionOnly} onClick={() => setFilter('attentionOnly', !filters.attentionOnly)} style={filters.attentionOnly ? { borderColor: 'var(--cc-green)' } : undefined}>
            <AlertTriangle size={14} aria-hidden="true" /> Needs attention
          </button>
          <div className="bt-toolbar-actions">
            <button type="button" className="cc-btn-primary" onClick={openCreate} disabled={missing}><Plus size={15} aria-hidden="true" /> Add battery</button>
            <button type="button" className="cc-btn-ghost" onClick={() => askSchedule(selectedRows)} disabled={missing || !kpi.total} title="Mark the selected batteries as Replace"><CalendarClock size={14} aria-hidden="true" /> Schedule replacement</button>
            <Link className="cc-btn-ghost" to="/warranty" title="Open the warranty tracker to raise a claim"><ShieldCheck size={14} aria-hidden="true" /> Claim warranty</Link>
            <button type="button" className="cc-btn-ghost" onClick={() => doExport('excel')} disabled={!filtered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Export</button>
            <button type="button" className="cc-icon-btn" onClick={() => doExport('pdf')} disabled={!filtered.length} aria-label="Export to PDF" title="PDF"><FileText size={14} /></button>
            <button type="button" className="cc-icon-btn" onClick={load} aria-label="Refresh" title="Refresh"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /></button>
          </div>
        </div>
        <div className="bt-filter-meta">
          <span aria-live="polite">{fmtInt(filtered.length)} of {fmtInt(kpi.total)} batteries{selectedRows.length ? `, ${selectedRows.length} selected` : ''}</span>
          {filterCount > 0 && <button type="button" className="cc-link cc-link-btn" onClick={() => { setFilters(EMPTY_FILTERS); setPage(0) }}><X size={13} aria-hidden="true" /> Clear filters</button>}
        </div>

        <CardState state={state} lines={6} empty={noData || missing ? <EmptyInvite onAdd={openCreate} missing={missing} text="No batteries registered yet. Add the first one to start tracking health, warranty and replacement." /> : null}>
          <KitTable
            manualPagination showPagination={false} enableSorting={false}
            pageIndex={page} pageSize={pageSize} pageCount={Math.max(1, Math.ceil(filtered.length / pageSize))}
            totalRows={filtered.length} onPageChange={setPage}
            enableRowSelection rowSelection={selection} onRowSelectionChange={setSelection}
            getRowId={(r) => String(r.id)}
            onRowClick={(r) => openEdit(r)}
            rows={pageRows} columns={columns}
            empty="No batteries match these filters."
          />
          <Pager page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }} noun="batteries" />
        </CardState>
        <p className="bt-note">Battery type and state of charge are not recorded in the register, so they are not shown.</p>
      </section>

      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit battery' : 'Add battery'} size="md">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Asset number</span>
              <input className="input w-full" placeholder="TRK-014" value={form.asset_no} onChange={(e) => set('asset_no', e.target.value)} maxLength={120} />
            </label>
            <label className="block"><span className="label">Serial number</span>
              <input className="input w-full" placeholder="BAT-2026-00123" value={form.serial_no} onChange={(e) => set('serial_no', e.target.value)} maxLength={120} />
            </label>
            <label className="block"><span className="label">Brand</span>
              <input className="input w-full" placeholder="Exide, Varta, Bosch" value={form.brand} onChange={(e) => set('brand', e.target.value)} maxLength={120} />
            </label>
            <label className="block"><span className="label">Site</span>
              <input className="input w-full" placeholder="Depot name" value={form.site} onChange={(e) => set('site', e.target.value)} maxLength={120} />
            </label>
            <label className="block"><span className="label">Install date</span>
              <input type="date" className="input w-full" value={form.install_date} onChange={(e) => set('install_date', e.target.value)} />
            </label>
            <label className="block"><span className="label">Warranty (months)</span>
              <input type="number" min="0" className="input w-full" placeholder="24" value={form.warranty_months} onChange={(e) => set('warranty_months', e.target.value)} />
            </label>
            <label className="block"><span className="label">Health %</span>
              <input type="number" min="0" max="100" step="0.1" className="input w-full" placeholder="95" value={form.health_pct} onChange={(e) => set('health_pct', e.target.value)} />
            </label>
            <label className="block"><span className="label">Voltage (V)</span>
              <input type="number" step="0.1" className="input w-full" placeholder="12.6" value={form.voltage} onChange={(e) => set('voltage', e.target.value)} />
            </label>
            <label className="block sm:col-span-2"><span className="label">Status</span>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {BATTERY_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </label>
          </div>
          <label className="block"><span className="label">Notes</span>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="Fitment notes, load test results, supplier" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
          </label>
          {previewExpiry && (
            <p className="text-xs text-[var(--text-muted)]">
              Warranty expires <span className="font-semibold text-[var(--text-secondary)]">{fmtDate(previewExpiry)}</span>.
            </p>
          )}
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            {editing && (
              <button type="button" onClick={() => { setModalOpen(false); setConfirmDel(editing) }} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] mr-auto" disabled={saving}>
                <Trash2 size={14} /> Delete
              </button>
            )}
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Add battery'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(confirmSchedule)}
        onClose={() => { if (!scheduling) setConfirmSchedule(null) }}
        title="Schedule replacement?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmSchedule(null)} className="btn-secondary text-sm min-h-[44px]" disabled={scheduling}>Cancel</button>
            <button type="button" onClick={doSchedule} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={scheduling}>
              {scheduling ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />} Mark as Replace
            </button>
          </>
        )}
      >
        {confirmSchedule && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmSchedule.length === 1
              ? <>Battery <span className="font-semibold text-[var(--text-secondary)]">{confirmSchedule[0].asset_no || confirmSchedule[0].serial_no}</span> will be marked Replace and counted as a replacement due.</>
              : <>{confirmSchedule.length} batteries will be marked Replace and counted as replacements due.</>}
          </p>
        )}
      </Modal>

      <Modal
        open={Boolean(confirmDel)}
        onClose={() => { if (!deleting) setConfirmDel(null) }}
        title="Delete battery?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDel(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
      >
        {confirmDel && (
          <p className="text-sm text-[var(--text-muted)]">
            This permanently removes battery <span className="font-semibold text-[var(--text-secondary)]">{confirmDel.asset_no || confirmDel.serial_no || confirmDel.id}</span>. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
