/**
 * FuelTheftAlerts (route /fuel-theft-alerts) - Fuel Theft Alerts, rebuilt on
 * the shared Command Center kit to the owner's mockup: photo hero with a date
 * range, five headline tiles, the alert feed, loss hotspots, the variance
 * trend, after-hours split, top loss sites, repeat assets and the selected
 * alert investigation panel.
 *
 * Runs on the `fuel_theft_alerts` table (V180). Real data only. The table
 * records no fuel card, geofence, coordinates, tank-level series, odometer
 * series, alert type or recovered amount, so those parts of the mockup say
 * "Not recorded" instead of drawing a number or a map. Every capability of
 * the previous page is kept: log, edit, delete, status changes, filters,
 * search, Excel/PDF export, findings and the severity/status breakdowns
 * (Analysis tab). Losses in different currencies are never added together.
 *
 * Shaping lives in src/lib/fuelTheftAlertsView.js on top of
 * src/lib/fuelTheftAlertsAnalytics.js and src/lib/fuelTheftAlerts.js.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Fuel, Droplet, ShieldAlert, Coins, ShieldCheck, Search, X, FileSpreadsheet, FileText,
  Plus, Pencil, Trash2, RefreshCw, AlertTriangle, Loader2, Save, Lightbulb, Repeat2,
  MapPin, Info, Eye, BadgeCheck, CheckCircle2, Ban, CalendarDays,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, PageHero, Tabs, KitTable, Donut, VehicleThumb, fmtInt } from '../components/commandCenter/kit'
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
import {
  fuelHeadline, dailyVariance, afterHoursSplit, locationHotspots, alertTimeline,
  recommendedActions, AFTER_HOURS,
} from '../lib/fuelTheftAlertsView'
import { formatCurrency } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { isMissingRelation } from '../lib/api/_client'
import './FuelTheftAlerts.css'

const LIST_CAP = 500 // listFuelTheftAlerts returns the newest 500 alerts.

const EMPTY_FORM = {
  alert_no: '', asset_no: '', driver_name: '', location: '', detected_at: '',
  drop_litres: '', expected_litres: '', fuel_price_per_litre: '', estimated_loss: '',
  severity: 'medium', status: 'open', resolution: '', notes: '',
}

const SEV_PILL = { critical: 'bad', high: 'bad', medium: 'warn', low: 'good' }
const STATUS_PILL = { open: 'bad', investigating: 'warn', confirmed: 'orange', dismissed: 'muted', resolved: 'good' }
const BAND_LABEL = { high: 'High (10 or more)', medium: 'Medium (4 to 9)', low: 'Low (1 to 3)' }
// SVG presentation attributes do not resolve CSS variables, so the donut gets literal hues.
const HUE = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e', unrated: '#94a3b8' }

const fmtLitres = (v) => (v == null ? 'N/A' : `${Number(v).toLocaleString('en-US')} L`)
function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
function fmtTime(v) {
  const d = v ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'N/A'
}
// datetime-local wants LOCAL wall time; toISOString would shift it to UTC.
function toLocalInput(v) {
  const d = v ? new Date(v) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Daily litres lost as downward bars. Days without a reading draw nothing. */
function VarianceBars({ days }) {
  const vals = days.map((d) => d.litres).filter((v) => v != null)
  if (!vals.length) return null
  const max = Math.max(...vals.map((v) => Math.abs(v)), 1)
  const W = 340; const H = 140; const top = 12; const base = 20
  const bw = (W - 30) / days.length
  const label = (d) => d.day.slice(5)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="fta-bars" role="img" aria-label={days.filter((d) => d.litres != null).map((d) => `${d.day} ${d.litres} litres`).join(', ')}>
      <line x1="28" x2={W} y1={top} y2={top} className="fta-axis-line" />
      <text x="2" y={top + 3} className="fta-axis">0</text>
      <text x="2" y={H - base} className="fta-axis">-{Math.round(max)}</text>
      {days.map((d, i) => (d.litres == null ? null : (
        <rect key={d.day} x={30 + i * bw + 1} y={top} width={Math.max(1.5, bw - 2)} height={(Math.abs(d.litres) / max) * (H - top - base)} className="fta-bar-neg" />
      )))}
      {[0, Math.floor(days.length / 2), days.length - 1].map((i) => days[i] && (
        <text key={i} x={30 + i * bw + bw / 2} y={H - 4} textAnchor="middle" className="fta-axis">{label(days[i])}</text>
      ))}
    </svg>
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
  const [tab, setTab] = useState('overview')

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listFuelTheftAlerts({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      const t = new Date()
      setUpdatedAt(t); setNow(t.getTime())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load fuel theft alerts.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const all = useMemo(() => rows || [], [rows])
  const ready = rows !== null
  const cardState = { loading: !ready && !error, error: !ready && error ? error : null, data: rows, retry: load }
  const currency = activeCurrency || ''

  // Everything on the page follows the date range.
  const scoped = useMemo(() => filterAlerts(all, { from, to }), [all, from, to])
  const head = useMemo(() => fuelHeadline(scoped), [scoped])
  const kpi = useMemo(() => buildAlertKpis(scoped, now, currency), [scoped, now, currency])
  const insights = useMemo(() => buildAlertInsights(scoped, now, currency), [scoped, now, currency])
  const severities = useMemo(() => severityBreakdown(scoped), [scoped])
  const statuses = useMemo(() => statusBreakdown(scoped), [scoped])
  const repeat = useMemo(() => repeatAssets(scoped, currency).slice(0, 8), [scoped, currency])
  const variance = useMemo(() => dailyVariance(scoped, { from, to, now }), [scoped, from, to, now])
  const afterHours = useMemo(() => afterHoursSplit(scoped), [scoped])
  const hotspots = useMemo(() => locationHotspots(scoped), [scoped])

  const assetOptions = useMemo(() => [...new Set(scoped.map((r) => r.asset_no).filter(Boolean))].sort(), [scoped])
  const register = useMemo(() => {
    const f = filterAlerts(scoped, { asset: assetFilter, status: statusFilter, severity: severityFilter, openOnly, search })
    return enrichAlerts(f, now, currency).sort((a, b) => (b.detectedTime ?? -Infinity) - (a.detectedTime ?? -Infinity))
  }, [scoped, assetFilter, statusFilter, severityFilter, openOnly, search, now, currency])
  const selected = useMemo(() => {
    const pool = enrichAlerts(scoped, now, currency)
    return pool.find((r) => r.id === selectedId) || register[0] || null
  }, [scoped, register, selectedId, now, currency])

  const fmtMoney = useCallback((v, cur) => (v == null ? 'N/A' : formatCurrency(v, cur || currency, 0)), [currency])
  const fmtLoss = (loss) => (loss.total != null
    ? fmtMoney(loss.total, loss.currency)
    : loss.mixed ? loss.totals.map((t) => fmtMoney(t.total, t.currency)).join(' + ') : 'N/A')

  const scopeLabel = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
  const rangeLabel = from || to ? `${from || 'start'} to ${to || 'today'}` : 'All loaded alerts'
  const exportRows = useMemo(() => alertExportRows(register, now, currency), [register, now, currency])
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

  // ── Modal ───────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_FORM, currency: activeCurrency }); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      alert_no: r.alert_no || '', asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      location: r.location || '', detected_at: toLocalInput(r.detected_at),
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
      const payload = { ...form, currency: form.currency || activeCurrency, country: activeCountry !== 'All' ? activeCountry : null }
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

  const setStatus = useCallback(async (alert, status) => {
    if (!alert) return
    setStatusBusy(true); setActionError('')
    try {
      await updateFuelTheftAlert(alert.id, { status })
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not update the alert status.'))
    } finally {
      setStatusBusy(false)
    }
  }, [load])

  const clearFilters = () => { setAssetFilter(''); setStatusFilter(''); setSeverityFilter(''); setOpenOnly(false); setSearch('') }
  const hasFilters = !!(assetFilter || statusFilter || severityFilter || openOnly || search)
  const na = (v, f = fmtInt) => (!ready ? 'N/A' : (v == null ? 'N/A' : f(v)))

  const feedColumns = [
    { key: 'detectedTime', header: 'Time (local)', sortValue: (r) => r.detectedTime ?? -1, cell: (r) => <span className="fta-nowrap">{fmtTime(r.detected_at)}</span> },
    { key: 'asset_no', header: 'Asset', cell: (r) => <b className="fta-asset">{r.asset_no || 'N/A'}</b> },
    { key: 'driver_name', header: 'Driver', cell: (r) => r.driver_name || <span className="cc-na">N/A</span> },
    { key: 'location', header: 'Site / location', cell: (r) => r.location || <span className="cc-na">N/A</span> },
    {
      key: 'dropValue', header: 'Litres variance', numeric: true, sortValue: (r) => r.dropValue ?? -1,
      cell: (r) => (r.dropValue == null ? <span className="cc-na">N/A</span> : <b className="fta-neg">-{r.dropValue.toLocaleString('en-US')} L</b>),
    },
    {
      key: 'loss', header: 'Est. loss', numeric: true, sortValue: (r) => r.loss ?? -1,
      cell: (r) => (r.loss == null ? <span className="cc-na">N/A</span> : <span title={r.basis === 'stored' ? 'Recorded figure' : 'Drop x price'}>{fmtMoney(r.loss, r.cur)}</span>),
    },
    { key: 'sev', header: 'Severity', sortValue: (r) => (r.sev ? SEVERITY_KEYS.length - SEVERITY_KEYS.indexOf(r.sev) : -1), cell: (r) => (r.sev ? <span className={`cc-pill ${SEV_PILL[r.sev] || 'muted'}`}>{titleCase(r.sev)}</span> : <span className="cc-na">N/A</span>) },
    { key: 'st', header: 'Status', cell: (r) => (r.st ? <span className={`cc-pill ${STATUS_PILL[r.st] || 'muted'}`}>{titleCase(r.st)}</span> : <span className="cc-na">N/A</span>) },
    {
      key: 'actions', header: '', sortable: false,
      cell: (r) => (
        <span className="fta-row-actions">
          <button type="button" className="cc-icon-btn" onClick={(ev) => { ev.stopPropagation(); openEdit(r) }} aria-label={`Edit alert for ${r.asset_no}`}><Pencil size={13} /></button>
          <button type="button" className="cc-icon-btn fta-danger" onClick={(ev) => { ev.stopPropagation(); setDeleteError(''); setConfirmDelete(r) }} aria-label={`Delete alert for ${r.asset_no}`}><Trash2 size={13} /></button>
        </span>
      ),
    },
  ]

  const hotMax = Math.max(1, ...hotspots.byLitres.map((h) => h.litres))
  const afterSegments = [
    { label: 'High risk', count: afterHours.high, color: HUE.high },
    { label: 'Medium risk', count: afterHours.medium, color: HUE.medium },
    { label: 'Low risk', count: afterHours.low, color: HUE.low },
    ...(afterHours.unrated ? [{ label: 'Severity not set', count: afterHours.unrated, color: HUE.unrated }] : []),
  ]
  const timeline = alertTimeline(selected)
  const actions = recommendedActions(selected)
  const sevMax = Math.max(1, ...severities.map((s) => s.count))
  const stMax = Math.max(1, ...statuses.map((s) => s.count))

  return (
    <div className="cc fta-page">
      <PageHero
        hello="Monitoring and Logistics"
        title="Fuel Theft Alerts"
        lead="Detect suspicious fuel loss, siphoning and tank variance across your fleet."
        imgLight="/dashboard/hero-fueltheft-light.webp"
        imgDark="/dashboard/hero-fueltheft-dark.webp"
      />

      <div className="cc-card fta-bar">
        <Tabs label="Fuel theft views" value={tab} onChange={setTab} tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'analysis', label: 'Analysis', count: ready ? scoped.length : null },
        ]} />
        <div className="fta-range">
          <CalendarDays size={14} aria-hidden="true" />
          <label htmlFor="fta-from" className="sr-only">From date</label>
          <input id="fta-from" type="date" className="cc-select" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>to</span>
          <label htmlFor="fta-to" className="sr-only">To date</label>
          <input id="fta-to" type="date" className="cc-select" value={to} onChange={(e) => setTo(e.target.value)} />
          {(from || to) && <button type="button" className="cc-icon-btn" onClick={() => { setFrom(''); setTo('') }} aria-label="Clear date range"><X size={13} /></button>}
        </div>
        <div className="fta-bar-actions">
          {updatedAt && <span className="fta-updated">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button type="button" className="cc-btn-ghost" onClick={load} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'fta-spin' : ''} aria-hidden="true" /> Refresh</button>
          <button type="button" className="cc-btn-ghost" onClick={doExcel} disabled={!register.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
          <button type="button" className="cc-btn-ghost" onClick={doPdf} disabled={!register.length}><FileText size={14} aria-hidden="true" /> PDF</button>
          <button type="button" className="cc-btn-primary" onClick={openCreate} disabled={notProvisioned}><Plus size={15} aria-hidden="true" /> Log alert</button>
        </div>
      </div>

      {notProvisioned && (
        <div className="cc-card fta-banner warn" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <p>Fuel theft alerting is not enabled on this database yet. Apply MIGRATIONS_V180_FUEL_THEFT_ALERTS.sql, then reload.</p>
        </div>
      )}
      {error && (
        <div className="cc-card fta-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <p>Could not load fuel theft alerts. {error} The figures below stay N/A until the alerts load.</p>
          <button type="button" className="cc-btn-ghost" onClick={load} disabled={refreshing}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {actionError && (
        <div className="cc-card fta-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <p>{actionError}</p>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis fta-kpis">
        <Kpi icon={Fuel} tone="t-red" display={na(head.active)} label="Active alerts" loading={cardState.loading}
          title="Alerts with status Open" onClick={() => { setTab('overview'); setStatusFilter('open') }} />
        <Kpi icon={Droplet} tone="t-amber" display="N/A" label="Suspected siphoning" loading={cardState.loading}
          title="Not recorded: alerts carry no alert type, so siphoning cannot be told apart from other fuel loss" />
        <Kpi icon={ShieldAlert} tone="t-blue" display={na(head.unresolved)} label="Unresolved cases" loading={cardState.loading}
          title="Not yet resolved or dismissed" onClick={() => { setTab('overview'); setOpenOnly(true) }} />
        <Kpi icon={Coins} tone="t-green" display="N/A" label="Recovered amount" loading={cardState.loading}
          title="Not recorded: alerts have no recovered amount column" />
        <Kpi icon={ShieldCheck} tone="t-purple" display={na(head.falsePositivePct, (v) => `${v}%`)} label="False positive rate" loading={cardState.loading}
          title={ready ? `Dismissed share of the ${head.decided} alert(s) that reached a decision` : undefined} />
      </div>
      <p className="fta-scope">{rangeLabel} in {scopeLabel}. {ready ? `${fmtInt(scoped.length)} alert(s) in range.` : ''}{rows && rows.length >= LIST_CAP ? ` Only the newest ${LIST_CAP} alerts are loaded.` : ''}</p>

      {tab === 'overview' && (
        <>
          <div className="fta-top">
            <Card title="Alert Feed" sub="Latest fuel theft and anomaly alerts"
              action={(
                <div className="fta-filters">
                  <select className="cc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
                    <option value="">All statuses</option>
                    {STATUS_KEYS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </select>
                  <select className="cc-select" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
                    <option value="">All severities</option>
                    {SEVERITY_KEYS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </select>
                  <select className="cc-select" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
                    <option value="">All assets</option>
                    {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <label className="fta-search">
                    <Search size={14} aria-hidden="true" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search alerts" aria-label="Search alerts" />
                  </label>
                  <label className="fta-check"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open only</label>
                  {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={13} aria-hidden="true" /> Clear</button>}
                </div>
              )}>
              <CardState state={cardState} lines={6}
                empty={ready && !scoped.length ? (
                  <div>{all.length ? 'No alerts in this date range.' : 'No fuel theft alerts recorded yet.'}<br /><button type="button" className="cc-btn" onClick={openCreate} disabled={notProvisioned}>Log an alert</button></div>
                ) : null}>
                <KitTable columns={feedColumns} rows={register} getRowId={(r) => String(r.id)} onRowClick={(r) => setSelectedId(r.id)}
                  empty="No alerts match these filters." />
              </CardState>
            </Card>

            <Card title="Fuel Loss Hotspots" sub="Locations with the most fuel loss alerts">
              <CardState state={cardState} lines={5}
                empty={ready && !hotspots.byCount.length ? (scoped.length ? 'No alert in range records a location.' : 'No alerts in range.') : null}>
                <p className="fta-note"><Info size={13} aria-hidden="true" /> Alerts record a location name but no coordinates, so hotspots are listed rather than mapped.</p>
                <ul className="fta-hot">
                  {hotspots.byCount.slice(0, 8).map((h) => (
                    <li key={h.location}>
                      <span className={`fta-hot-dot ${h.band}`} aria-hidden="true">{h.count}</span>
                      <span className="fta-hot-name"><MapPin size={12} aria-hidden="true" /> {h.location}<small>{h.open} open | {h.litres == null ? 'litres not recorded' : `${Math.round(h.litres).toLocaleString('en-US')} L`}</small></span>
                      <span className={`cc-pill ${h.band === 'high' ? 'bad' : h.band === 'medium' ? 'warn' : 'good'}`}>{BAND_LABEL[h.band].split(' ')[0]}</span>
                    </li>
                  ))}
                </ul>
                <div className="fta-legend">
                  {Object.entries(BAND_LABEL).map(([k, l]) => <span key={k}><i className={`fta-hot-dot ${k} sm`} aria-hidden="true" /> {l}</span>)}
                </div>
                {hotspots.unlocated > 0 && <p className="fta-foot">{hotspots.unlocated} alert(s) have no location.</p>}
              </CardState>
            </Card>
          </div>

          <div className="fta-four">
            <Card title="Fuel Variance Trend" sub={from || to ? 'Litres lost per day in range' : 'Litres lost per day, last 30 days'}>
              <CardState state={cardState} lines={3}
                empty={ready && !variance.measuredDays ? 'No alert in this window records drop litres.' : null}>
                <VarianceBars days={variance.days} />
                <p className="fta-foot">Total {fmtLitres(variance.totalLitres == null ? null : Math.round(variance.totalLitres))} over {variance.measuredDays} day(s) with a reading. Positive variance is not recorded.</p>
              </CardState>
            </Card>

            <Card title="After-Hours Alerts" sub={`Detected ${AFTER_HOURS.start}:00 to 0${AFTER_HOURS.end}:00 local time`}>
              <CardState state={cardState} lines={3}
                empty={ready && !afterHours.timed ? 'No alert in range has a detected time.' : ready && !afterHours.total ? 'No alert in range was detected after hours.' : null}>
                <Donut segments={afterSegments} total={afterHours.total} centerLabel="After hours" />
                <p className="fta-foot">The after-hours window is a fixed assumption; site operating hours are not recorded. Fuelling transactions are not recorded, so this counts alerts, not refuels.</p>
              </CardState>
            </Card>

            <Card title="Top Fuel Loss Sites" sub="Litres lost by location">
              <CardState state={cardState} lines={4}
                empty={ready && !hotspots.byLitres.length ? 'No alert in range records both a location and drop litres.' : null}>
                <ul className="fta-sites">
                  {hotspots.byLitres.slice(0, 6).map((h, i) => (
                    <li key={h.location}>
                      <span className="fta-sites-name">{h.location}</span>
                      <span className="fta-sites-track"><i className={`c${i % 4}`} style={{ width: `${(h.litres / hotMax) * 100}%` }} /></span>
                      <b>{Math.round(h.litres).toLocaleString('en-US')} L</b>
                    </li>
                  ))}
                </ul>
              </CardState>
            </Card>

            <Card title="Repeat Assets" sub="Fuel card is not recorded, so repeat loss is shown by asset">
              <CardState state={cardState} lines={4}
                empty={ready && !repeat.length ? (scoped.length ? 'No asset has more than one alert in range.' : 'No alerts in range.') : null}>
                <ul className="fta-repeat">
                  {repeat.map((a) => (
                    <li key={a.asset_no}>
                      <button type="button" onClick={() => setAssetFilter(a.asset_no)} aria-label={`Filter feed to asset ${a.asset_no}`}>
                        <Repeat2 size={13} aria-hidden="true" />
                        <span><b>{a.asset_no}</b><small>{a.alerts} alerts | {a.open} open</small></span>
                        <span className="fta-neg">{fmtLoss(a.loss)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardState>
            </Card>
          </div>

          <Card className="fta-inv" title={selected ? (
            <span className="fta-inv-title">Selected Alert Investigation {selected.sev && <span className={`cc-pill ${SEV_PILL[selected.sev] || 'muted'}`}>{titleCase(selected.sev)}</span>} <small>{selected.alert_no || 'No alert number'}</small></span>
          ) : 'Selected Alert Investigation'}
            action={selected && (
              <div className="fta-inv-actions">
                <button type="button" className="cc-btn-ghost" disabled={statusBusy} onClick={() => setStatus(selected, 'investigating')}><Eye size={14} aria-hidden="true" /> Investigate</button>
                <button type="button" className="cc-btn-ghost" disabled={statusBusy} onClick={() => setStatus(selected, 'confirmed')}><BadgeCheck size={14} aria-hidden="true" /> Mark verified</button>
                <button type="button" className="cc-btn-ghost" disabled={statusBusy} onClick={() => setStatus(selected, 'resolved')}><CheckCircle2 size={14} aria-hidden="true" /> Resolve</button>
                <button type="button" className="cc-btn-ghost" disabled={statusBusy} onClick={() => setStatus(selected, 'dismissed')}><Ban size={14} aria-hidden="true" /> Dismiss</button>
                <button type="button" className="cc-btn-primary" onClick={() => openEdit(selected)}><Pencil size={14} aria-hidden="true" /> Edit</button>
              </div>
            )}>
            <CardState state={cardState} lines={4} empty={ready && !selected ? 'Pick an alert in the feed to investigate it.' : null}>
              {selected && (
                <div className="fta-inv-grid">
                  <div className="fta-inv-asset">
                    <VehicleThumb row={{ asset_no: selected.asset_no }} size="lg" />
                    <b>{selected.asset_no || 'N/A'}</b>
                    <dl>
                      <dt>Status</dt><dd>{selected.st ? <span className={`cc-pill ${STATUS_PILL[selected.st] || 'muted'}`}>{titleCase(selected.st)}</span> : 'N/A'}</dd>
                      <dt>Reported</dt><dd>{fmtDateTime(selected.detected_at)}</dd>
                      <dt>Open for</dt><dd>{selected.open ? (selected.ageDays == null ? 'N/A' : `${selected.ageDays} day(s)`) : 'Closed'}</dd>
                    </dl>
                  </div>
                  <dl className="fta-inv-facts">
                    <dt>Driver</dt><dd>{selected.driver_name || 'Not recorded'}</dd>
                    <dt>Fuel card</dt><dd className="cc-na">Not recorded</dd>
                    <dt>Site / location</dt><dd>{selected.location || 'Not recorded'}</dd>
                    <dt>Geofence context</dt><dd className="cc-na">Not recorded</dd>
                    <dt>Drop / expected</dt><dd>{fmtLitres(selected.dropValue)} / {fmtLitres(selected.expectedValue)}</dd>
                    <dt>Estimated loss</dt><dd>{fmtMoney(selected.loss, selected.cur)}{selected.basis === 'stored' ? ' (recorded)' : selected.basis === 'derived' ? ' (drop x price)' : ''}</dd>
                  </dl>
                  <div>
                    <h3 className="fta-sub">Event timeline</h3>
                    {timeline.length ? (
                      <ol className="fta-tl">
                        {timeline.map((e) => <li key={`${e.at}-${e.text}`} className={e.tone}><span>{fmtTime(e.at)}</span>{e.text}</li>)}
                      </ol>
                    ) : <p className="cc-na">No timestamps recorded.</p>}
                    {selected.resolution && <p className="fta-foot">Resolution: {selected.resolution}</p>}
                  </div>
                  <div>
                    <h3 className="fta-sub">Tank level and odometer</h3>
                    <div className="fta-nodata">Not recorded. Alerts carry no tank-level or odometer readings, so the consumption analysis cannot be drawn.</div>
                    {selected.notes && <p className="fta-foot">Notes: {selected.notes}</p>}
                  </div>
                  <div>
                    <h3 className="fta-sub">Recommended actions</h3>
                    <ul className="fta-recs">
                      {actions.map((a) => <li key={a.title}><Lightbulb size={13} aria-hidden="true" /><span><b>{a.title}</b><small>{a.sub}</small></span></li>)}
                    </ul>
                  </div>
                </div>
              )}
            </CardState>
          </Card>
        </>
      )}

      {tab === 'analysis' && (
        <>
          <div className="fta-analysis-kpis">
            <Card title="Estimated loss" sub="Per currency, never added across currencies">
              <CardState state={cardState} lines={1}>
                <b className="fta-big">{fmtLoss(kpi.loss)}</b>
                {kpi.unknownLoss > 0 && <p className="fta-foot">{kpi.unknownLoss} alert(s) without a loss figure.</p>}
              </CardState>
            </Card>
            <Card title="Litres lost"><CardState state={cardState} lines={1}><b className="fta-big">{kpi.litresLost == null ? 'N/A' : fmtLitres(Math.round(kpi.litresLost))}</b></CardState></Card>
            <Card title="Critical open"><CardState state={cardState} lines={1}><b className="fta-big">{fmtInt(kpi.criticalOpen)}</b></CardState></Card>
            <Card title="Oldest open alert"><CardState state={cardState} lines={1}><b className="fta-big">{kpi.oldestOpenDays == null ? 'N/A' : `${kpi.oldestOpenDays} day(s)`}</b>{kpi.staleOpen > 0 && <p className="fta-foot">{kpi.staleOpen} older than 7 days</p>}</CardState></Card>
          </div>

          <Card title="Findings">
            <CardState state={cardState} lines={2} empty={ready && !insights.length ? 'Nothing to flag in this range.' : null}>
              <ul className="fta-findings">{insights.map((s) => <li key={s}>{s}</li>)}</ul>
            </CardState>
          </Card>

          <div className="fta-two">
            <Card title="By severity">
              <CardState state={cardState} lines={4} empty={ready && !scoped.length ? 'No alerts in range.' : null}>
                <ul className="fta-dist">
                  {severities.map((s) => (
                    <li key={s.key}>
                      <button type="button" onClick={() => { setSeverityFilter(s.key); setTab('overview') }}>{s.label}</button>
                      <span className="fta-sites-track"><i className={`sev-${s.key}`} style={{ width: `${(s.count / sevMax) * 100}%` }} /></span>
                      <b>{s.count}</b>
                    </li>
                  ))}
                </ul>
              </CardState>
            </Card>
            <Card title="Investigation status">
              <CardState state={cardState} lines={4} empty={ready && !scoped.length ? 'No alerts in range.' : null}>
                <ul className="fta-dist">
                  {statuses.map((s) => (
                    <li key={s.key}>
                      <button type="button" onClick={() => { setStatusFilter(s.key); setTab('overview') }}>{s.label}</button>
                      <span className="fta-sites-track"><i className="c3" style={{ width: `${(s.count / stMax) * 100}%` }} /></span>
                      <b>{s.count}</b>
                    </li>
                  ))}
                </ul>
              </CardState>
            </Card>
          </div>
        </>
      )}

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
