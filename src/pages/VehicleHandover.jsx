/**
 * VehicleHandover (route /vehicle-handover, also reached as /handovers) -
 * Vehicle Handover, rebuilt on the shared page kit to the owner's reference
 * design: a 5-step handover wizard (Vehicle Details, Condition Check, Photos &
 * Notes, Signatures, Complete) with the handover register beside it.
 *
 * Runs on the `handover_reports` table (V181). Zone conditions are stored in
 * the existing `damages` jsonb (one entry per zone that is not good), so the
 * damage roll-ups keep working. The drawn signature is saved as the same SVG
 * markup the field app stores. Engine hours, the driver's contact number and
 * the previous readings are context only: there is no column for them on a
 * handover, so they are shown, never saved.
 *
 * Kept from the previous page: register with filters, KPIs, monthly trend,
 * condition mix, vehicles still out, damage leaders, edit and delete, Excel and
 * PDF export of the filtered set, loading / error+Retry / not-provisioned states.
 * Pure wizard logic: src/lib/vehicleHandoverView.js. Register analytics:
 * src/lib/vehicleHandoverAnalytics.js.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  ClipboardCheck, LogOut, LogIn, ShieldAlert, X, Plus, Pencil, Trash2, Eye,
  AlertTriangle, Users, FileSpreadsheet, FileText, RefreshCw, Fuel, Car, Check,
  Search, Gauge, ArrowRight, ArrowLeft, CheckCircle2, Camera, PenLine, Truck,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import SignatureCapture from '../components/checklist/SignatureCapture'
import SignatureView from '../components/checklist/SignatureView'
import {
  Card, Kpi, PageHero, Donut, KitTable, Tabs, VehicleThumb, fmtInt,
} from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import {
  listHandoverReports, createHandoverReport, updateHandoverReport, deleteHandoverReport,
  listHandoverDrivers,
} from '../lib/api/handoverReports'
import { getAssetMatches } from '../lib/api/assets'
import { listEngineHours } from '../lib/api/engineHours'
import { damageCount } from '../lib/handoverReports'
import {
  HANDOVER_TYPE_LABEL, CONDITIONS, CONDITION_LABEL, CLEANLINESS, NOT_RATED,
  filterHandovers, handoverKpis, conditionMix, monthlyHandoverTrend, assetDamageLeaders,
  vehiclesStillOut, HANDOVER_EXPORT_COLUMNS, handoverExportRows,
} from '../lib/vehicleHandoverAnalytics'
import {
  WIZARD_STEPS, ZONES, ZONE_CONDITIONS, EMPTY_WIZARD, zoneConditionMeta, zonesFromDamages,
  latestHandoverFor, previousReadings, validateStep, firstInvalidStep, stepState,
  buildHandoverPayload, readingDeltas, driverOptions, matchDriver, num,
} from '../lib/vehicleHandoverView'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { safeImageSrc, safeHref } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import './VehicleHandover.css'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)

const EMPTY_EDIT = {
  asset_no: '', report_no: '', handover_type: 'checkout', from_driver: '', to_driver: '',
  handover_at: '', odometer_km: '', fuel_level_pct: '', condition_rating: 'good',
  cleanliness: 'clean', signature_url: '', photo_url: '', notes: '',
}
const CONDITION_TONE = { excellent: 'good', good: 'good', fair: 'warn', poor: 'bad' }
const MIX_COLORS = ['#16a34a', '#22c55e', '#f59e0b', '#dc2626', '#94a3b8']
const isSvg = (v) => typeof v === 'string' && /^<svg[\s>]/i.test(v.trim())

const fmtKm = (v) => (num(v) == null ? 'N/A' : `${num(v).toLocaleString('en-US')} km`)
const fmtFuel = (v) => (num(v) == null ? 'N/A' : `${num(v)}%`)
const fmtRate = (v) => (v == null ? 'N/A' : `${v}%`)
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'N/A')
function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function TypePill({ type }) {
  if (!HANDOVER_TYPE_LABEL[type]) return <span className="cc-na">N/A</span>
  const Icon = type === 'checkout' ? LogOut : LogIn
  return <span className={`cc-pill ${type === 'checkout' ? 'warn' : 'info'}`}><Icon size={11} aria-hidden="true" /> {HANDOVER_TYPE_LABEL[type]}</span>
}
function ConditionPill({ rating }) {
  if (!CONDITION_LABEL[rating]) return <span className="cc-na">N/A</span>
  return <span className={`cc-pill ${CONDITION_TONE[rating]}`}>{CONDITION_LABEL[rating]}</span>
}

/** Top-down truck outline with the four zone markers laid over it. */
function ConditionDiagram({ zones, onChange, readOnly }) {
  return (
    <div className="vh-diagram">
      <svg viewBox="0 0 120 240" className="vh-truck" role="img" aria-label="Top view of the vehicle">
        <rect x="30" y="18" width="60" height="46" rx="12" className="vh-truck-cab" />
        <rect x="38" y="24" width="44" height="14" rx="4" className="vh-truck-glass" />
        <rect x="26" y="70" width="68" height="152" rx="8" className="vh-truck-body" />
        {[40, 180, 202].map((y) => (
          <g key={y}>
            <rect x="16" y={y} width="10" height="20" rx="3" className="vh-truck-wheel" />
            <rect x="94" y={y} width="10" height="20" rx="3" className="vh-truck-wheel" />
          </g>
        ))}
        <line x1="60" y1="80" x2="60" y2="212" className="vh-truck-line" />
      </svg>
      {ZONES.map((z) => {
        const meta = zoneConditionMeta(zones[z.key]) || ZONE_CONDITIONS[0]
        return (
          <div key={z.key} className={`vh-zone vh-zone-${z.key}`}>
            <span className={`vh-zone-dot ${meta.tone}`} aria-hidden="true" />
            <div className="vh-zone-text">
              <b>{z.label}</b>
              {readOnly ? <span className={`vh-zone-val ${meta.tone}`}>{meta.label}</span> : (
                <select className="vh-zone-select" aria-label={`${z.label} condition`} value={zones[z.key]} onChange={(e) => onChange(z.key, e.target.value)}>
                  {ZONE_CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function InfoField({ label, value }) {
  return (
    <div className="vh-info">
      <span>{label}</span>
      <b>{value == null || value === '' ? <span className="cc-na">N/A</span> : value}</b>
    </div>
  )
}

function Stepper({ step, onJump }) {
  return (
    <ol className="vh-stepper" aria-label="Handover steps">
      {WIZARD_STEPS.map((s, i) => {
        const st = stepState(i, step)
        return (
          <li key={s.key} className={`vh-step ${st}`}>
            <button type="button" onClick={() => onJump(i)} aria-current={st === 'active' ? 'step' : undefined} disabled={st === 'todo'}>
              <span className="vh-step-num">{st === 'done' ? <Check size={14} aria-hidden="true" /> : i + 1}</span>
              <span className="vh-step-label">{s.label}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export default function VehicleHandover() {
  const { activeCountry } = useSettings()
  const [tab, setTab] = useState('new')

  // ── Register data ──────────────────────────────────────────────────────────
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [asOf] = useState(() => new Date())

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listHandoverReports({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load handover reports.'))
      setRows(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])
  useEffect(() => { load() }, [load])

  // Drivers for the picker load on their own; a failure only affects the picker.
  const [drivers, setDrivers] = useState({ loading: true, rows: [], error: '' })
  const loadDrivers = useCallback(async () => {
    setDrivers((d) => ({ ...d, loading: true, error: '' }))
    try {
      setDrivers({ loading: false, rows: await listHandoverDrivers({ country: activeCountry }), error: '' })
    } catch (err) {
      setDrivers({ loading: false, rows: [], error: toUserMessage(err, 'Could not load drivers.') })
    }
  }, [activeCountry])
  useEffect(() => { loadDrivers() }, [loadDrivers])
  const driverOpts = useMemo(() => driverOptions(drivers.rows), [drivers.rows])

  const failed = !!error || notProvisioned
  const all = useMemo(() => rows || [], [rows])

  // ── Wizard state ───────────────────────────────────────────────────────────
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(EMPTY_WIZARD)
  const [stepErrors, setStepErrors] = useState([])
  const [asset, setAsset] = useState({ loading: false, row: null, error: '', looked: '' })
  const [hours, setHours] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(null)
  const [signKey, setSignKey] = useState(0)

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setZone = (zone, v) => setForm((f) => ({ ...f, zones: { ...f.zones, [zone]: v } }))

  const lookupAsset = useCallback(async (code) => {
    const assetNo = String(code || '').trim().toUpperCase()
    if (!assetNo) return
    setAsset({ loading: true, row: null, error: '', looked: assetNo }); setHours(null)
    try {
      const [m, eh] = await Promise.all([
        getAssetMatches(assetNo, activeCountry),
        listEngineHours({ asset_no: assetNo, country: activeCountry, limit: 1 }).catch(() => []),
      ])
      // The same code in two countries is usually two different machines, so
      // on the All-countries view an ambiguous code is never resolved by guess.
      const ambiguousAll = (!activeCountry || activeCountry === 'All') && m.countries.length > 1
      const row = ambiguousAll ? null : m.row
      const msg = ambiguousAll
        ? `This asset number exists in ${m.countries.join(' and ')}. Choose a country at the top of the app to pick the right machine.`
        : row ? '' : 'This asset is not in the fleet register for this country. You can still record the handover.'
      setAsset({ loading: false, row: row || null, error: msg, looked: assetNo })
      setHours(!ambiguousAll && Array.isArray(eh) && eh.length ? eh[0] : null)
    } catch (err) {
      setAsset({ loading: false, row: null, error: toUserMessage(err, 'Could not look up this asset.'), looked: assetNo })
    }
  }, [activeCountry])

  const lastHandover = useMemo(() => {
    const c = asset.row?.country
    return latestHandoverFor(c ? all.filter((r) => !r.country || r.country === c) : all, form.asset_no)
  }, [all, form.asset_no, asset.row])
  const prev = useMemo(
    () => previousReadings({ lastHandover, asset: asset.looked === form.asset_no.trim().toUpperCase() ? asset.row : null, engineHours: hours }),
    [lastHandover, asset, hours, form.asset_no],
  )
  const deltas = readingDeltas(form, prev)

  const startWizard = (type = 'checkout') => {
    setTab('new'); setStep(0); setForm({ ...EMPTY_WIZARD, handover_type: type })
    setStepErrors([]); setSaveError(''); setSaved(null); setAsset({ loading: false, row: null, error: '', looked: '' }); setHours(null)
    setSignKey((k) => k + 1)
  }
  const next = () => {
    const errs = validateStep(step, form, prev)
    setStepErrors(errs)
    if (!errs.length) setStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1))
  }
  const back = () => { setStepErrors([]); setStep((s) => Math.max(0, s - 1)) }
  const jump = (i) => { if (i <= step) { setStepErrors([]); setStep(i) } }
  const goComplete = () => {
    setTab('new')
    const bad = firstInvalidStep(form, prev, WIZARD_STEPS.length - 1)
    if (bad >= 0) { setStep(bad); setStepErrors(validateStep(bad, form, prev)) } else { setStepErrors([]); setStep(WIZARD_STEPS.length - 1) }
  }
  const pickDriver = (text) => {
    const m = matchDriver(driverOpts, text)
    setForm((f) => ({ ...f, driver_name: text, driver_phone: m ? m.phone : f.driver_phone }))
    if (m?.asset && !form.asset_no) { setF('asset_no', m.asset); lookupAsset(m.asset) }
  }

  const completeHandover = async () => {
    const bad = firstInvalidStep(form, prev, WIZARD_STEPS.length - 1)
    if (bad >= 0) { setStep(bad); setStepErrors(validateStep(bad, form, prev)); return }
    setSaving(true); setSaveError('')
    try {
      const payload = buildHandoverPayload(form, { country: asset.row?.country || activeCountry })
      const row = await createHandoverReport(payload)
      setSaved(row || payload)
      await load()
    } catch (err) {
      setSaveError(toUserMessage(err, 'Could not save the handover.'))
    } finally {
      setSaving(false)
    }
  }

  // ── Register filters + analytics ───────────────────────────────────────────
  const [countryFilter, setCountryFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [conditionFilter, setConditionFilter] = useState('')
  const [cleanFilter, setCleanFilter] = useState('')
  const [damagedOnly, setDamagedOnly] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')
  const countryOptions = useMemo(() => [...new Set(all.map((r) => r.country).filter(Boolean))].sort(), [all])
  const filtered = useMemo(() => filterHandovers(all, {
    country: countryFilter, type: typeFilter, condition: conditionFilter, cleanliness: cleanFilter,
    damagedOnly, from: fromDate, to: toDate, search,
  }), [all, countryFilter, typeFilter, conditionFilter, cleanFilter, damagedOnly, fromDate, toDate, search])
  const kpi = useMemo(() => handoverKpis(filtered, { now: asOf }), [filtered, asOf])
  const mix = useMemo(() => conditionMix(filtered), [filtered])
  const trend = useMemo(() => monthlyHandoverTrend(filtered, { now: asOf }), [filtered, asOf])
  const leaders = useMemo(() => assetDamageLeaders(filtered), [filtered])
  const stillOut = useMemo(() => vehiclesStillOut(filtered), [filtered])
  const hasFilters = !!(countryFilter || typeFilter || conditionFilter || cleanFilter || damagedOnly || fromDate || toDate || search)
  const clearFilters = () => {
    setCountryFilter(''); setTypeFilter(''); setConditionFilter(''); setCleanFilter('')
    setDamagedOnly(false); setFromDate(''); setToDate(''); setSearch('')
  }
  const na = rows === null
  const trendTotal = trend.reduce((s, m) => s + m.checkouts + m.checkins, 0)
  const trendData = {
    labels: trend.map((m) => m.month),
    datasets: [
      { label: 'Check-outs', data: trend.map((m) => m.checkouts), backgroundColor: '#f59e0b', borderRadius: 3 },
      { label: 'Check-ins', data: trend.map((m) => m.checkins), backgroundColor: '#16a34a', borderRadius: 3 },
    ],
  }
  const trendOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: 'var(--cc-ink-2)', boxWidth: 12 } } },
    scales: {
      x: { stacked: true, ticks: { color: 'var(--cc-ink-3)', font: { size: 10 } }, grid: { display: false } },
      y: { stacked: true, beginAtZero: true, ticks: { color: 'var(--cc-ink-3)', precision: 0 }, grid: { color: 'var(--cc-track)' } },
    },
  }

  const exportRows = useMemo(() => handoverExportRows(filtered), [filtered])
  const fileName = reportFileName('TyrePulse Vehicle Handover', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExcel = () => exportToExcel(exportRows, HANDOVER_EXPORT_COLUMNS.map((c) => c[0]), HANDOVER_EXPORT_COLUMNS.map((c) => c[1]), fileName)
  const doPdf = () => exportToPdf(exportRows, HANDOVER_EXPORT_COLUMNS.map(([key, header]) => ({ key, header })), 'Vehicle Handover Reports', fileName, 'landscape')

  // ── View / edit / delete ───────────────────────────────────────────────────
  const [viewing, setViewing] = useState(null)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_EDIT)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const openEdit = useCallback((r) => {
    setEditing(r)
    setEditForm({
      asset_no: r.asset_no || '', report_no: r.report_no || '', handover_type: r.handover_type || 'checkout',
      from_driver: r.from_driver || '', to_driver: r.to_driver || '', handover_at: toLocalInput(r.handover_at),
      odometer_km: r.odometer_km ?? '', fuel_level_pct: r.fuel_level_pct ?? '', condition_rating: r.condition_rating || 'good',
      cleanliness: r.cleanliness || 'clean', signature_url: r.signature_url || '', photo_url: r.photo_url || '', notes: r.notes || '',
    })
    setEditError('')
  }, [])
  const setE = (k, v) => setEditForm((f) => ({ ...f, [k]: v }))
  const saveEdit = async (e) => {
    e?.preventDefault?.()
    if (!editForm.asset_no.trim()) { setEditError('An asset number is required.'); return }
    setEditSaving(true); setEditError('')
    try {
      await updateHandoverReport(editing.id, {
        ...editForm,
        handover_at: editForm.handover_at ? new Date(editForm.handover_at).toISOString() : null,
      })
      setEditing(null)
      await load()
    } catch (err) {
      setEditError(toUserMessage(err, 'Could not save the handover report.'))
    } finally {
      setEditSaving(false)
    }
  }
  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteHandoverReport(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the handover report.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const columns = useMemo(() => [
    {
      key: 'asset_no', header: 'Asset', sortValue: (r) => r.asset_no || '',
      cell: (r) => (
        <div className="cc-vehicle">
          <VehicleThumb row={r} size="sm" />
          <div><b className="cc-strong">{r.asset_no || 'N/A'}</b>{r.report_no && <span className="cc-sub">{r.report_no}</span>}</div>
        </div>
      ),
    },
    { key: 'handover_type', header: 'Type', sortValue: (r) => HANDOVER_TYPE_LABEL[r.handover_type] || '', cell: (r) => <TypePill type={r.handover_type} /> },
    { key: 'from_driver', header: 'From driver', cell: (r) => r.from_driver || <span className="cc-na">N/A</span> },
    { key: 'to_driver', header: 'To driver', cell: (r) => r.to_driver || <span className="cc-na">N/A</span> },
    { key: 'handover_at', header: 'Handover at', sortValue: (r) => (r.handover_at ? new Date(r.handover_at).getTime() : -Infinity), cell: (r) => fmtDateTime(r.handover_at) },
    { key: 'odometer_km', header: 'Odometer', align: 'right', sortValue: (r) => num(r.odometer_km) ?? -1, cell: (r) => fmtKm(r.odometer_km) },
    { key: 'fuel_level_pct', header: 'Fuel', align: 'right', sortValue: (r) => num(r.fuel_level_pct) ?? -1, cell: (r) => fmtFuel(r.fuel_level_pct) },
    { key: 'condition_rating', header: 'Condition', sortValue: (r) => CONDITION_LABEL[r.condition_rating] || NOT_RATED, cell: (r) => <ConditionPill rating={r.condition_rating} /> },
    {
      key: 'damages', header: 'Damages', align: 'right', sortValue: (r) => damageCount(r),
      cell: (r) => (damageCount(r) > 0 ? <span className="cc-pill warn"><ShieldAlert size={11} aria-hidden="true" /> {damageCount(r)}</span> : <span className="cc-na">None logged</span>),
    },
    { key: 'cleanliness', header: 'Cleanliness', cell: (r) => cap(r.cleanliness) },
    {
      key: 'actions', header: '', sortable: false,
      cell: (r) => (
        <div className="vh-row-actions">
          <button type="button" className="cc-icon-btn" onClick={() => setViewing(r)} aria-label={`View handover for ${r.asset_no || 'asset'}`}><Eye size={14} /></button>
          <button type="button" className="cc-icon-btn" onClick={() => openEdit(r)} aria-label={`Edit handover for ${r.asset_no || 'asset'}`}><Pencil size={14} /></button>
          <button type="button" className="cc-icon-btn" onClick={() => setConfirmDelete(r)} aria-label={`Delete handover for ${r.asset_no || 'asset'}`}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ], [openEdit])

  const checkout = form.handover_type !== 'checkin'
  const assetRow = asset.looked && asset.looked === form.asset_no.trim().toUpperCase() ? asset.row : null
  const nextLabel = WIZARD_STEPS[step + 1]?.label

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cc vh-page">
      <div className="vh-hero-wrap">
        <PageHero
          title="Vehicle Handover"
          lead="Complete handover process with condition check, odometer, fuel level, photos and digital signatures."
          imgLight="/dashboard/hero-history-light.webp"
          imgDark="/dashboard/hero-history-dark.webp"
        />
        <div className="vh-hero-actions">
          <button type="button" className="cc-btn-ghost" onClick={() => startWizard('checkout')} disabled={failed}><LogOut size={15} aria-hidden="true" /> Check Out</button>
          <button type="button" className="cc-btn-primary" onClick={goComplete} disabled={failed || !!saved}><CheckCircle2 size={15} aria-hidden="true" /> Complete</button>
        </div>
      </div>

      {notProvisioned && (
        <div className="cc-card vh-banner warn" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><b>Vehicle handover reporting is not enabled on this database yet.</b><p>Ask your administrator to enable handover reports, then refresh.</p></div>
        </div>
      )}
      {error && (
        <div className="cc-card vh-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><b>Could not load handover reports.</b><p>{error}</p></div>
          <button type="button" className="cc-btn-ghost" onClick={load}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {actionError && (
        <div className="cc-card vh-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><p>{actionError}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <Tabs
        variant="line" label="Handover sections" value={tab} onChange={setTab}
        tabs={[{ key: 'new', label: 'New handover' }, { key: 'register', label: 'Handover register', count: na ? null : all.length }]}
      />

      {tab === 'new' && (
        <>
          <Card><Stepper step={step} onJump={jump} /></Card>

          {saved ? (
            <Card title="Handover recorded">
              <div className="vh-done">
                <CheckCircle2 size={40} aria-hidden="true" />
                <p><b>{saved.asset_no}</b> {saved.handover_type === 'checkin' ? 'checked in from' : 'checked out to'} {(saved.handover_type === 'checkin' ? saved.from_driver : saved.to_driver) || 'the driver'}.</p>
                <div className="vh-actions">
                  <button type="button" className="cc-btn-ghost" onClick={() => setTab('register')}>View register</button>
                  <button type="button" className="cc-btn-primary" onClick={() => startWizard('checkout')}><Plus size={14} aria-hidden="true" /> Start another handover</button>
                </div>
              </div>
            </Card>
          ) : (
            <>
              {step === 0 && (
                <div className="vh-grid">
                  <div className="vh-col">
                    <Card title="Vehicle Information" sub="Pick the vehicle by asset number; details come from the fleet register.">
                      <form className="vh-asset-find" onSubmit={(e) => { e.preventDefault(); lookupAsset(form.asset_no) }}>
                        <div className="cc-search">
                          <Search size={15} aria-hidden="true" />
                          <input aria-label="Asset number" placeholder="Asset number, for example TM514" value={form.asset_no} onChange={(e) => setF('asset_no', e.target.value)} onBlur={() => { if (form.asset_no.trim() && form.asset_no.trim().toUpperCase() !== asset.looked) lookupAsset(form.asset_no) }} />
                        </div>
                        <button type="submit" className="cc-btn-ghost" disabled={!form.asset_no.trim() || asset.loading}>{asset.loading ? 'Looking up...' : 'Find'}</button>
                      </form>
                      {asset.error && <p className="vh-note" role="status">{asset.error}</p>}
                      <div className="vh-vehicle-head">
                        <VehicleThumb row={assetRow || { asset_no: form.asset_no }} size="lg" />
                        <div className="vh-info-grid">
                          <InfoField label="Fleet no" value={assetRow ? (assetRow.fleet_number || assetRow.asset_no) : null} />
                          <InfoField label="Make / model" value={assetRow ? [assetRow.make, assetRow.model].filter(Boolean).join(' ') : null} />
                          <InfoField label="Asset type" value={assetRow?.vehicle_type} />
                          <InfoField label="Current odometer" value={prev.prevOdometer != null ? `${fmtInt(prev.prevOdometer)} km` : null} />
                          <InfoField label="Engine hours" value={prev.engineHours != null ? `${fmtInt(prev.engineHours)} h` : null} />
                          <InfoField label="Current fuel level" value={prev.prevFuel != null ? `${prev.prevFuel}%` : null} />
                          <InfoField label="Site / location" value={assetRow?.site} />
                          <InfoField label="Country" value={assetRow?.country} />
                        </div>
                      </div>
                    </Card>

                    <Card title="Handover Type">
                      <div className="vh-radio-row" role="radiogroup" aria-label="Handover type">
                        {[
                          { key: 'checkout', label: 'Check Out', sub: 'Vehicle is handed to a driver', icon: LogOut },
                          { key: 'checkin', label: 'Check In', sub: 'Vehicle is returned by a driver', icon: LogIn },
                        ].map((o) => (
                          <label key={o.key} className={`vh-radio ${form.handover_type === o.key ? 'on' : ''}`}>
                            <input type="radio" name="vh-type" value={o.key} checked={form.handover_type === o.key} onChange={() => setF('handover_type', o.key)} />
                            <o.icon size={18} aria-hidden="true" />
                            <span><b>{o.label}</b><small>{o.sub}</small></span>
                          </label>
                        ))}
                      </div>
                    </Card>

                    <Card title="Driver Information" sub={drivers.error ? drivers.error : undefined}>
                      <div className="vh-form-grid">
                        <label className="cc-field">
                          <span>{checkout ? 'Driver receiving the vehicle' : 'Driver returning the vehicle'}</span>
                          <input className="vh-input" list="vh-driver-list" placeholder={drivers.loading ? 'Loading drivers...' : 'Search or select driver'} value={form.driver_name} onChange={(e) => pickDriver(e.target.value)} />
                          <datalist id="vh-driver-list">
                            {driverOpts.map((d) => <option key={d.id} value={d.name}>{d.code}</option>)}
                          </datalist>
                        </label>
                        <label className="cc-field">
                          <span>Contact no</span>
                          <input className="vh-input" value={form.driver_phone} readOnly placeholder="From the driver register" />
                        </label>
                        <label className="cc-field">
                          <span>{checkout ? 'Handed over by (optional)' : 'Received by (optional)'}</span>
                          <input className="vh-input" value={form.other_party} maxLength={200} onChange={(e) => setF('other_party', e.target.value)} />
                        </label>
                        <label className="cc-field">
                          <span>Handover date and time</span>
                          <input className="vh-input" type="datetime-local" value={form.handover_at} onChange={(e) => setF('handover_at', e.target.value)} />
                          <small className="vh-hint">Leave blank to use now.</small>
                        </label>
                        <label className="cc-field">
                          <span>Report number (optional)</span>
                          <input className="vh-input" value={form.report_no} maxLength={120} onChange={(e) => setF('report_no', e.target.value)} />
                        </label>
                      </div>
                      {!drivers.loading && !drivers.error && !driverOpts.length && <p className="vh-note">No drivers in the driver register yet. Type the driver name.</p>}
                    </Card>
                  </div>

                  <div className="vh-col">
                    <Card title="Condition Overview" sub="Set each side; anything other than Good is logged as a damage.">
                      <ConditionDiagram zones={form.zones} onChange={setZone} />
                    </Card>
                    <Card title="Odometer & Fuel">
                      <div className="vh-readings">
                        <div className="vh-reading">
                          <Gauge size={16} aria-hidden="true" />
                          <div>
                            <span>Previous odometer</span>
                            <b>{prev.prevOdometer != null ? `${fmtInt(prev.prevOdometer)} km` : <span className="cc-na">N/A</span>}</b>
                            {prev.odometerSource && <small>{prev.odometerSource}</small>}
                          </div>
                        </div>
                        <label className="cc-field">
                          <span>Current odometer (km)</span>
                          <input className="vh-input" type="number" min="0" step="1" inputMode="numeric" value={form.odometer_km} onChange={(e) => setF('odometer_km', e.target.value)} />
                          {deltas.kmSince != null && deltas.kmSince >= 0 && <small className="vh-hint">{fmtInt(deltas.kmSince)} km since the previous reading</small>}
                        </label>
                        <div className="vh-reading">
                          <Fuel size={16} aria-hidden="true" />
                          <div>
                            <span>Previous fuel</span>
                            <b>{prev.prevFuel != null ? `${prev.prevFuel}%` : <span className="cc-na">N/A</span>}</b>
                            {prev.prevHandoverAt && <small>{fmtDateTime(prev.prevHandoverAt)}</small>}
                          </div>
                        </div>
                        <label className="cc-field">
                          <span>Current fuel level (%)</span>
                          <input className="vh-input" type="number" min="0" max="100" step="1" inputMode="numeric" value={form.fuel_level_pct} onChange={(e) => setF('fuel_level_pct', e.target.value)} />
                          {num(form.fuel_level_pct) != null && num(form.fuel_level_pct) >= 0 && num(form.fuel_level_pct) <= 100 && (
                            <span className="vh-fuel" aria-hidden="true"><i style={{ width: `${num(form.fuel_level_pct)}%` }} /></span>
                          )}
                        </label>
                      </div>
                    </Card>
                    <Card title="Handover Notes">
                      <textarea className="vh-input vh-textarea" aria-label="Handover notes" placeholder="Anything the next driver or the workshop should know" value={form.notes} maxLength={8000} onChange={(e) => setF('notes', e.target.value)} />
                    </Card>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="vh-grid">
                  <div className="vh-col">
                    <Card title="Overall condition">
                      <div className="vh-radio-row four" role="radiogroup" aria-label="Overall condition">
                        {CONDITIONS.map((c) => (
                          <label key={c} className={`vh-radio ${form.condition_rating === c ? 'on' : ''}`}>
                            <input type="radio" name="vh-cond" value={c} checked={form.condition_rating === c} onChange={() => setF('condition_rating', c)} />
                            <span><b>{CONDITION_LABEL[c]}</b></span>
                          </label>
                        ))}
                      </div>
                    </Card>
                    <Card title="Cleanliness">
                      <div className="vh-radio-row" role="radiogroup" aria-label="Cleanliness">
                        {CLEANLINESS.map((c) => (
                          <label key={c} className={`vh-radio ${form.cleanliness === c ? 'on' : ''}`}>
                            <input type="radio" name="vh-clean" value={c} checked={form.cleanliness === c} onChange={() => setF('cleanliness', c)} />
                            <span><b>{cap(c)}</b></span>
                          </label>
                        ))}
                      </div>
                    </Card>
                  </div>
                  <div className="vh-col">
                    <Card title="Body condition by side">
                      <ConditionDiagram zones={form.zones} onChange={setZone} />
                    </Card>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="vh-grid">
                  <Card title="Photos" sub="Paste a link to the handover photo (for example from the document store).">
                    <label className="cc-field">
                      <span>Photo link</span>
                      <input className="vh-input" type="url" placeholder="https://" value={form.photo_url} maxLength={2000} onChange={(e) => setF('photo_url', e.target.value)} />
                    </label>
                    <div className="vh-photo">
                      {safeImageSrc(form.photo_url) && /^https?:/i.test(form.photo_url.trim())
                        ? <img src={safeImageSrc(form.photo_url)} alt="Handover photo preview" />
                        : <span><Camera size={22} aria-hidden="true" /> No photo added</span>}
                    </div>
                  </Card>
                  <Card title="Notes">
                    <textarea className="vh-input vh-textarea tall" aria-label="Handover notes" placeholder="For example: minor scratch on the rear left panel, noted at handover" value={form.notes} maxLength={8000} onChange={(e) => setF('notes', e.target.value)} />
                  </Card>
                </div>
              )}

              {step === 3 && (
                <Card title="Driver signature" sub={`Signed by ${form.driver_name || 'the driver'}. The person recording the handover is saved automatically as its author.`}>
                  {form.signature ? (
                    <div className="vh-sig">
                      <SignatureView value={form.signature} label="Driver" name={form.driver_name || null} />
                      <button type="button" className="cc-btn-ghost" onClick={() => { setF('signature', null); setSignKey((k) => k + 1) }}><PenLine size={14} aria-hidden="true" /> Sign again</button>
                    </div>
                  ) : (
                    <div className="vh-sig-pad">
                      <SignatureCapture key={signKey} label="Driver signs here" onChange={(svg) => setF('signature', svg)} height={160} />
                      <p className="vh-hint">A signature is optional but recommended; an unsigned handover is saved as not signed.</p>
                    </div>
                  )}
                </Card>
              )}

              {step === 4 && (
                <Card title="Review and complete" sub="Check the details, then complete the handover.">
                  <div className="vh-review">
                    <InfoField label="Vehicle" value={form.asset_no.trim().toUpperCase()} />
                    <InfoField label="Handover type" value={HANDOVER_TYPE_LABEL[form.handover_type]} />
                    <InfoField label={checkout ? 'To driver' : 'From driver'} value={form.driver_name} />
                    <InfoField label={checkout ? 'Handed over by' : 'Received by'} value={form.other_party} />
                    <InfoField label="Handover at" value={form.handover_at ? fmtDateTime(form.handover_at) : 'Now'} />
                    <InfoField label="Odometer" value={num(form.odometer_km) != null ? fmtKm(form.odometer_km) : null} />
                    <InfoField label="Fuel level" value={num(form.fuel_level_pct) != null ? fmtFuel(form.fuel_level_pct) : null} />
                    <InfoField label="Overall condition" value={CONDITION_LABEL[form.condition_rating]} />
                    <InfoField label="Cleanliness" value={cap(form.cleanliness)} />
                    <InfoField label="Sides not good" value={String(ZONES.filter((z) => form.zones[z.key] !== 'good').length)} />
                    <InfoField label="Photo" value={form.photo_url ? 'Added' : null} />
                    <InfoField label="Signature" value={form.signature ? 'Signed' : 'Not signed'} />
                  </div>
                  <ConditionDiagram zones={form.zones} readOnly />
                  {form.notes && <p className="vh-review-notes">{form.notes}</p>}
                  {saveError && <p className="vh-error" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {saveError}</p>}
                </Card>
              )}

              {stepErrors.length > 0 && (
                <div className="cc-card vh-banner bad" role="alert">
                  <AlertTriangle size={17} aria-hidden="true" />
                  <div>{stepErrors.map((e) => <p key={e}>{e}</p>)}</div>
                </div>
              )}

              <div className="vh-footer">
                <button type="button" className="cc-btn-ghost" onClick={() => startWizard(form.handover_type)} disabled={saving}>Cancel</button>
                <div className="vh-actions">
                  {step > 0 && <button type="button" className="cc-btn-ghost" onClick={back} disabled={saving}><ArrowLeft size={14} aria-hidden="true" /> Back</button>}
                  {step < WIZARD_STEPS.length - 1
                    ? <button type="button" className="cc-btn-primary" onClick={next} disabled={failed}>Next: {nextLabel} <ArrowRight size={14} aria-hidden="true" /></button>
                    : <button type="button" className="cc-btn-primary" onClick={completeHandover} disabled={saving || failed}><CheckCircle2 size={14} aria-hidden="true" /> {saving ? 'Saving...' : 'Complete handover'}</button>}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'register' && (
        <>
          <div className="cc-kpis vh-kpis">
            <Kpi icon={ClipboardCheck} tone="t-green" loading={refreshing && na} display={na ? 'N/A' : fmtInt(kpi.totalReports)} label={na ? 'Handover reports' : `Handover reports, ${kpi.last30Days} in 30 days`} />
            <Kpi icon={LogOut} tone="t-amber" display={na ? 'N/A' : fmtInt(kpi.checkoutCount)} label="Check-outs" onClick={() => setTypeFilter('checkout')} />
            <Kpi icon={LogIn} tone="t-blue" display={na ? 'N/A' : fmtInt(kpi.checkinCount)} label="Check-ins" onClick={() => setTypeFilter('checkin')} />
            <Kpi icon={Car} tone="t-orange" display={na ? 'N/A' : fmtInt(kpi.stillOut)} label="Vehicles still out" />
            <Kpi icon={ShieldAlert} tone="t-red" display={na ? 'N/A' : fmtRate(kpi.poorRate)} label={na ? 'Poor condition rate' : `Poor condition, ${kpi.poorConditionCount} of ${kpi.ratedReports} rated`} />
            <Kpi icon={AlertTriangle} tone="t-amber" display={na ? 'N/A' : fmtRate(kpi.damageRate)} label={na ? 'Reports with damage' : `With damage, ${kpi.totalDamages} logged`} onClick={() => setDamagedOnly(true)} />
          </div>
          <div className="vh-kpi-foot">
            <span><Fuel size={13} aria-hidden="true" /> Average fuel at handover: <b>{na ? 'N/A' : fmtRate(kpi.avgFuelPct)}</b></span>
            <span><Users size={13} aria-hidden="true" /> Drivers involved: <b>{na ? 'N/A' : fmtInt(kpi.distinctDrivers)}</b> across <b>{na ? 'N/A' : fmtInt(kpi.distinctAssets)}</b> assets</span>
            {hasFilters && !na && <span>These figures cover the {filtered.length} reports matching the current filters.</span>}
          </div>

          <div className="vh-row3">
            <Card title="Handovers per month" sub="Last 12 months">
              <div className="vh-chart">
                {na ? <div className="cc-skel" style={{ height: '100%' }} />
                  : trendTotal === 0 ? <div className="cc-empty">No dated handovers in the last 12 months.</div>
                    : <Bar data={trendData} options={trendOpts} aria-label="Check-outs and check-ins per month" role="img" />}
              </div>
            </Card>
            <Card title="Condition mix">
              {na ? <div className="cc-skel" style={{ height: 150 }} />
                : filtered.length === 0 ? <div className="cc-empty">No handover reports to rate.</div>
                  : <Donut segments={mix.map((m, i) => ({ label: m.label, count: m.count, color: MIX_COLORS[i % MIX_COLORS.length], key: m.key }))} centerLabel="Reports" onSelect={(s) => setConditionFilter(s.key)} />}
            </Card>
            <Card title={`Vehicles still out${na ? '' : ` (${stillOut.length})`}`} sub="Latest handover is a check-out">
              {na ? <div className="cc-skel" style={{ height: 150 }} />
                : stillOut.length === 0 ? <div className="cc-empty">Every vehicle checked out has a later check-in.</div> : (
                  <div className="cc-list vh-scroll">
                    {stillOut.slice(0, 30).map((r) => (
                      <div key={r.id} className="cc-row">
                        <span className="cc-row-icon t-amber"><Truck size={15} aria-hidden="true" /></span>
                        <div className="cc-row-main">
                          <div className="cc-row-title">{r.asset_no}</div>
                          <div className="cc-row-meta">{r.to_driver || 'Driver not recorded'}</div>
                        </div>
                        <span className="cc-row-time">{fmtDateTime(r.handover_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
            </Card>
          </div>

          {!na && leaders.length > 0 && (
            <Card title="Assets with most damage">
              <div className="cc-list">
                {leaders.map((l) => (
                  <div key={l.asset} className="cc-row">
                    <span className="cc-row-icon t-red"><ShieldAlert size={15} aria-hidden="true" /></span>
                    <div className="cc-row-main"><div className="cc-row-title">{l.asset}</div><div className="cc-row-meta">{l.reports} reports</div></div>
                    <span className="cc-pill warn">{l.damages} damages</span>
                    <span className="cc-pill bad">{l.poor} poor</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card
            title="Handover register"
            sub={na ? undefined : `${filtered.length} of ${all.length} reports`}
            action={(
              <div className="vh-actions">
                <button type="button" className="cc-btn-ghost" onClick={load} disabled={refreshing}><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
                <button type="button" className="cc-btn-ghost" onClick={doExcel} disabled={!filtered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                <button type="button" className="cc-btn-ghost" onClick={doPdf} disabled={!filtered.length}><FileText size={14} aria-hidden="true" /> PDF</button>
                <button type="button" className="cc-btn-primary" onClick={() => startWizard('checkout')} disabled={failed}><Plus size={14} aria-hidden="true" /> New handover</button>
              </div>
            )}
          >
            <div className="cc-filters vh-filters">
              <div className="cc-search">
                <Search size={15} aria-hidden="true" />
                <input aria-label="Search handovers" placeholder="Asset, report, driver, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {countryOptions.length > 1 && (
                <label className="cc-field"><span>Country</span>
                  <select className="cc-select" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
                    <option value="">All countries</option>
                    {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select></label>
              )}
              <label className="cc-field"><span>Type</span>
                <select className="cc-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  <option value="">All types</option><option value="checkout">Check-out</option><option value="checkin">Check-in</option>
                </select></label>
              <label className="cc-field"><span>Condition</span>
                <select className="cc-select" value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)}>
                  <option value="">All conditions</option>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                  <option value={NOT_RATED}>{NOT_RATED}</option>
                </select></label>
              <label className="cc-field"><span>Cleanliness</span>
                <select className="cc-select" value={cleanFilter} onChange={(e) => setCleanFilter(e.target.value)}>
                  <option value="">Any</option>
                  {CLEANLINESS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
                </select></label>
              <label className="cc-field"><span>From</span><input type="date" className="vh-input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
              <label className="cc-field"><span>To</span><input type="date" className="vh-input" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
              <label className="vh-check"><input type="checkbox" checked={damagedOnly} onChange={(e) => setDamagedOnly(e.target.checked)} /> Only with damage</label>
              {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> Clear</button>}
            </div>
            {failed ? <div className="cc-empty">Handover reports are unavailable.</div> : (
              <KitTable
                columns={columns}
                rows={filtered}
                getRowId={(r) => String(r.id)}
                loading={na}
                empty={all.length === 0 ? 'No handover reports recorded yet. Record your first handover.' : 'No reports match these filters.'}
              />
            )}
          </Card>
        </>
      )}

      {/* View */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={`Handover ${viewing?.asset_no || ''}`} size="lg">
        {viewing && (
          <div className="cc vh-view">
            <div className="vh-review">
              <InfoField label="Type" value={HANDOVER_TYPE_LABEL[viewing.handover_type]} />
              <InfoField label="Report no" value={viewing.report_no} />
              <InfoField label="Handover at" value={fmtDateTime(viewing.handover_at)} />
              <InfoField label="From driver" value={viewing.from_driver} />
              <InfoField label="To driver" value={viewing.to_driver} />
              <InfoField label="Odometer" value={num(viewing.odometer_km) != null ? fmtKm(viewing.odometer_km) : null} />
              <InfoField label="Fuel level" value={num(viewing.fuel_level_pct) != null ? fmtFuel(viewing.fuel_level_pct) : null} />
              <InfoField label="Condition" value={CONDITION_LABEL[viewing.condition_rating]} />
              <InfoField label="Cleanliness" value={viewing.cleanliness ? cap(viewing.cleanliness) : null} />
              <InfoField label="Damages" value={String(damageCount(viewing))} />
            </div>
            <ConditionDiagram zones={zonesFromDamages(viewing.damages)} readOnly />
            {viewing.notes && <p className="vh-review-notes">{viewing.notes}</p>}
            <div className="vh-view-media">
              <SignatureView value={viewing.signature_url || null} label="Driver" />
              {safeImageSrc(viewing.photo_url) && safeHref(viewing.photo_url)
                ? <a href={safeHref(viewing.photo_url)} target="_blank" rel="noopener noreferrer" className="vh-photo small"><img src={safeImageSrc(viewing.photo_url)} alt="Handover photo" /></a>
                : <span className="cc-na">No photo</span>}
            </div>
          </div>
        )}
      </Modal>

      {/* Edit */}
      <Modal open={!!editing} onClose={() => { if (!editSaving) setEditing(null) }} title="Edit handover report" size="lg">
        <form onSubmit={saveEdit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Asset number *</span>
              <input className="input w-full" required value={editForm.asset_no} maxLength={120} onChange={(e) => setE('asset_no', e.target.value)} /></label>
            <label className="block"><span className="label">Report number (optional)</span>
              <input className="input w-full" value={editForm.report_no} maxLength={120} onChange={(e) => setE('report_no', e.target.value)} /></label>
            <label className="block"><span className="label">Handover type</span>
              <select className="input w-full" value={editForm.handover_type} onChange={(e) => setE('handover_type', e.target.value)}>
                <option value="checkout">Check-out</option><option value="checkin">Check-in</option>
              </select></label>
            <label className="block"><span className="label">Handover date and time</span>
              <input className="input w-full" type="datetime-local" value={editForm.handover_at} onChange={(e) => setE('handover_at', e.target.value)} /></label>
            <label className="block"><span className="label">From driver (outgoing)</span>
              <input className="input w-full" value={editForm.from_driver} maxLength={200} onChange={(e) => setE('from_driver', e.target.value)} /></label>
            <label className="block"><span className="label">To driver (incoming)</span>
              <input className="input w-full" value={editForm.to_driver} maxLength={200} onChange={(e) => setE('to_driver', e.target.value)} /></label>
            <label className="block"><span className="label">Odometer (km)</span>
              <input className="input w-full" type="number" step="1" min="0" value={editForm.odometer_km} onChange={(e) => setE('odometer_km', e.target.value)} /></label>
            <label className="block"><span className="label">Fuel level (%)</span>
              <input className="input w-full" type="number" step="1" min="0" max="100" value={editForm.fuel_level_pct} onChange={(e) => setE('fuel_level_pct', e.target.value)} /></label>
            <label className="block"><span className="label">Overall condition</span>
              <select className="input w-full" value={editForm.condition_rating} onChange={(e) => setE('condition_rating', e.target.value)}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
              </select></label>
            <label className="block"><span className="label">Cleanliness</span>
              <select className="input w-full" value={editForm.cleanliness} onChange={(e) => setE('cleanliness', e.target.value)}>
                {CLEANLINESS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
              </select></label>
            {isSvg(editForm.signature_url) ? (
              <div className="block"><span className="label">Signature</span>
                <SignatureView value={editForm.signature_url} label="Driver" />
                <button type="button" className="btn-secondary text-sm mt-2" onClick={() => setE('signature_url', '')}>Remove signature</button>
              </div>
            ) : (
              <label className="block"><span className="label">Signature URL (optional)</span>
                <input className="input w-full" type="url" placeholder="https://" value={editForm.signature_url} maxLength={2000} onChange={(e) => setE('signature_url', e.target.value)} /></label>
            )}
            <label className="block"><span className="label">Photo URL (optional)</span>
              <input className="input w-full" type="url" placeholder="https://" value={editForm.photo_url} maxLength={2000} onChange={(e) => setE('photo_url', e.target.value)} /></label>
          </div>
          <label className="block"><span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[80px] resize-y" value={editForm.notes} maxLength={8000} onChange={(e) => setE('notes', e.target.value)} /></label>
          {editError && <p className="text-sm text-red-400" role="alert">{editError}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={() => setEditing(null)} className="btn-secondary text-sm min-h-[44px]" disabled={editSaving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm min-h-[44px]" disabled={editSaving}>{editSaving ? 'Saving...' : 'Save changes'}</button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this handover report?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-muted)]">
          {confirmDelete?.asset_no || 'Report'}, {HANDOVER_TYPE_LABEL[confirmDelete?.handover_type] || 'N/A'}, {fmtDateTime(confirmDelete?.handover_at)}. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
