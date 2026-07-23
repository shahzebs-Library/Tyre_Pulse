import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import {
  ArrowLeft, Edit2, X, Save, RefreshCw, AlertTriangle, Activity,
  DollarSign, TrendingUp, MapPin, Zap, Target, Layers, Lock,
  ToggleLeft, ToggleRight, Truck, Wrench, ClipboardCheck, History,
  Shield, Gauge, ShieldAlert, User, Hash, Calendar, Building2, Fuel,
  CalendarClock, ExternalLink,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import * as assetApi from '../lib/api/assetManagement'
import { listPmPrograms, listPmServiceRecords } from '../lib/api/pmPrograms'
import { loadGridTyreByAsset } from '../lib/api/costSummary'
import { toUserMessage } from '../lib/safeError'
import { pmAssetDueStatus } from '../lib/pmSchedule'
import { PM_DUE_META } from '../lib/pmPrograms'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { formatCurrencyCompact, formatDate, formatMonthYear } from '../lib/formatters'
import LoadingState from '../components/LoadingState'
import EmptyState from '../components/EmptyState'
import CustomFieldsPanel from '../components/CustomFieldsPanel'
import TyreBay from '../components/TyreBay'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { Illustration } from '../components/illustrations'
import { vehicleArt } from '../lib/brand/vehicleArt'
import { severityRank } from '../lib/severity'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants (mirrored from AssetManagement for visual parity) ─────────────────
const RISK_COLOR = {
  Critical: { bg: 'bg-red-900/50',    text: 'text-red-300',    hex: '#dc2626' },
  High:     { bg: 'bg-orange-900/50', text: 'text-orange-300', hex: '#ea580c' },
  Medium:   { bg: 'bg-yellow-900/50', text: 'text-yellow-300', hex: '#ca8a04' },
  Low:      { bg: 'bg-green-900/50',  text: 'text-green-300',  hex: '#16a34a' },
}
const VEHICLE_TYPES = ['Truck','Tipper','Mixer','Rigid','Semi-Trailer','Pickup','Crane','Loader','Tanker','Bus','Other']

// PM due-band badge palette (keyed by pmAssetDueStatus band / PM_DUE_META tone).
const PM_DUE_BADGE = {
  overdue:   'bg-red-900/50 text-red-300',
  due_soon:  'bg-yellow-900/50 text-yellow-300',
  scheduled: 'bg-green-900/50 text-green-300',
  none:      'bg-[var(--surface-2)] text-[var(--text-secondary)]',
}
const PM_PRIORITY_BADGE = {
  critical: 'bg-red-900/50 text-red-300',
  high:     'bg-orange-900/50 text-orange-300',
  medium:   'bg-yellow-900/50 text-yellow-300',
  low:      'bg-[var(--surface-2)] text-[var(--text-secondary)]',
}
const PM_STATUS_BADGE = {
  active:    'bg-green-900/50 text-green-300',
  paused:    'bg-yellow-900/50 text-yellow-300',
  completed: 'bg-[var(--surface-2)] text-[var(--text-secondary)]',
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
    tooltip: {
      backgroundColor: 'var(--panel-2)',
      titleColor: '#f3f4f6',
      bodyColor: '#9ca3af',
      borderColor: 'rgba(59,130,246,0.3)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: 'var(--text-muted)' } },
    y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: 'var(--text-muted)' } },
  },
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
const fmtCurrency = (n, cur) => formatCurrencyCompact(n, cur)
const fmtDate = (d) => formatDate(d)
function daysSince(d) {
  if (!d) return null
  const ms = Date.now() - new Date(d).getTime()
  return Math.floor(ms / 86_400_000)
}
function worstRisk(tyres) {
  if (!tyres?.length) return null
  return tyres.reduce((best, t) => {
    if (t.risk_level && (best === null || severityRank(t.risk_level) > severityRank(best))) return t.risk_level
    return best
  }, null)
}

// ── Tyre Position SVG Diagram ─────────────────────────────────────────────────
function TyrePositionDiagram({ tyres = [] }) {
  const positions = [
    { id: 'FL',  label: 'FL',  cx: 70,  cy: 90  },
    { id: 'FR',  label: 'FR',  cx: 210, cy: 90  },
    { id: 'RLO', label: 'RLO', cx: 52,  cy: 190 },
    { id: 'RLI', label: 'RLI', cx: 78,  cy: 190 },
    { id: 'RRI', label: 'RRI', cx: 202, cy: 190 },
    { id: 'RRO', label: 'RRO', cx: 228, cy: 190 },
  ]
  const byPos = {}
  tyres.forEach(t => { if (t.position) byPos[t.position] = t })

  return (
    <svg viewBox="0 0 280 260" className="w-full max-w-xs mx-auto">
      <rect x={95} y={30} width={90} height={200} rx={8} fill="#1f2937" stroke="#374151" strokeWidth="2" />
      <text x={140} y={58} textAnchor="middle" fontSize="22">🚛</text>
      {[90, 190].map((y, i) => (
        <line key={i} x1={95} x2={185} y1={y} y2={y} stroke="#4b5563" strokeWidth="1" strokeDasharray="4 4" />
      ))}
      {positions.map(p => {
        const t = byPos[p.id]
        const col = t ? (RISK_COLOR[t.risk_level]?.hex ?? '#374151') : '#374151'
        const opacity = t ? 1 : 0.35
        return (
          <g key={p.id}>
            <circle cx={p.cx} cy={p.cy} r={13} fill={col} opacity={opacity} stroke={col} strokeWidth="1.5" />
            <text x={p.cx} y={p.cy + 4} textAnchor="middle" fill="#fff" fontSize="7" fontFamily="monospace" fontWeight="600">{p.label}</text>
            {t && (
              <text x={p.cx} y={p.cy + 26} textAnchor="middle" fill="#9ca3af" fontSize="6">{t.brand ?? ''}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ── Inline Edit Panel ───────────────────────────────────────────────────────────
// Self-contained editor for the detail page. Gated by the disposal-approval lock
// (`locked`) exactly like the registry modal, and writes through the same
// assetManagement API so behaviour matches the drawer's edit path.
function EditPanel({ asset, sites, countries, onSaved, onClose, locked = false }) {
  const { t } = useLanguage()
  const [form, setForm] = useState(asset)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (locked) return
    if (!form.asset_no?.trim()) { setError(t('assetmgmt.modal.errRequired')); return }
    setSaving(true); setError('')
    try {
      const payload = {
        asset_no: form.asset_no.trim().toUpperCase(),
        vehicle_type: form.vehicle_type || null,
        make: form.make || null,
        model: form.model || null,
        year: form.year ? parseInt(form.year) : null,
        site: form.site || null,
        country: form.country || null,
        active: form.active,
      }
      // Detail page only ever edits an existing asset (loaded by :assetNo).
      const { error: supaErr } = await assetApi.updateAsset(asset.id, payload)
      if (supaErr) {
        const dup = /duplicate key|unique constraint/i.test(supaErr.message || '')
        setError(dup ? t('assetmgmt.modal.errDuplicate') : toUserMessage(supaErr, t('assetmgmt.modal.errSaveFailed')))
        setSaving(false); return
      }
      onSaved(payload)
    } catch (e) {
      setError(toUserMessage(e, t('assetmgmt.modal.errUnexpected')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-[var(--surface-1)] rounded-2xl border border-[var(--border-dim)] w-full max-w-lg shadow-2xl"
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-dim)]">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Edit2 className="w-5 h-5 text-yellow-400" />
            {t('assetmgmt.modal.editTitle')}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.assetNo')}</label>
              <input value={form.asset_no ?? ''} onChange={e => set('asset_no', e.target.value.toUpperCase())}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.vehicleType')}</label>
              <select value={form.vehicle_type ?? ''} onChange={e => set('vehicle_type', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                <option value="">{t('assetmgmt.modal.selectType')}</option>
                {VEHICLE_TYPES.map(vt => <option key={vt}>{vt}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.make')}</label>
              <input value={form.make ?? ''} onChange={e => set('make', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.model')}</label>
              <input value={form.model ?? ''} onChange={e => set('model', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.year')}</label>
              <input type="number" min="1990" max="2030" value={form.year ?? ''} onChange={e => set('year', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.site')}</label>
              <input value={form.site ?? ''} onChange={e => set('site', e.target.value)} list="ad-sites-list"
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
              <datalist id="ad-sites-list">{sites.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.country')}</label>
              <select value={form.country ?? ''} onChange={e => set('country', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                <option value="">{t('assetmgmt.modal.select')}</option>
                {(countries.length ? countries : ['KSA','UAE','Egypt']).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <label className="text-xs text-[var(--text-secondary)]">{t('assetmgmt.modal.activeStatus')}</label>
              <button onClick={() => set('active', !form.active)} className="flex items-center gap-2">
                {form.active
                  ? <ToggleRight className="w-8 h-8 text-green-400" />
                  : <ToggleLeft className="w-8 h-8 text-[var(--text-dim)]" />}
                <span className={`text-sm font-medium ${form.active ? 'text-green-400' : 'text-[var(--text-muted)]'}`}>
                  {form.active ? t('assetmgmt.modal.active') : t('assetmgmt.modal.inactive')}
                </span>
              </button>
            </div>
          </div>
          {error && <p className="text-red-400 text-xs bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-5 pb-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[var(--surface-2)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-3)] transition-colors">{t('assetmgmt.modal.cancel')}</button>
          <button onClick={handleSave} disabled={saving || locked}
            title={locked ? 'Locked: in approval' : undefined}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
            {locked ? <Lock className="w-4 h-4" /> : saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? t('assetmgmt.modal.saving') : t('assetmgmt.modal.save')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Asset Detail Page ─────────────────────────────────────────────────────────
export default function AssetDetail() {
  const { assetNo } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { activeCurrency } = useSettings()
  const { t } = useLanguage()
  const isAdmin = profile?.role === 'Admin'

  const [asset, setAsset] = useState(null)
  const [tyres, setTyres] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [inspections, setInspections] = useState([])
  const [accidents, setAccidents] = useState([])
  const [meter, setMeter] = useState({ odometer: null, engineHours: null })
  const [pmPlans, setPmPlans] = useState([])
  const [pmServices, setPmServices] = useState([])
  const [overview, setOverview] = useState(null)
  // Authoritative tyre cost for THIS asset from the expense grid (V347 RPC). Null
  // means the grid is unavailable or has no tyre spend for this asset -> the cost
  // tile then falls back to the tyre_records cost_per_tyre sum.
  const [gridAssetCost, setGridAssetCost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const [tab, setTab] = useState('overview') // overview | tyres | costs | workorders | approvals
  const [editing, setEditing] = useState(false)
  // Approval-engine gate: locks the asset edit/dispose path while the disposal
  // workflow for this asset is active (pending/in_review/returned) or locked
  // (approved). EntityApprovalPanel reports the true state via onStateChange.
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [assetNo])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [assetRes, tyreRes, woRes, ovRes, inspRes, accRes, odoRes, ehRes, pmRes, pmSvcRes] = await Promise.allSettled([
        // vehicle_fleet is the fleet registry (fleet_master is empty). Alias
        // is_active → active so the page keeps its `active` contract.
        supabase.from('vehicle_fleet')
          .select('id,asset_no,fleet_number,make,model,vehicle_type,year,department,operator_name,site,country,region,tyre_size,tyre_brand_preferred,monthly_tyre_budget,current_km,registration_no,registration_date,status,notes,custom_data,image_path,active:is_active')
          .eq('asset_no', assetNo).maybeSingle(),
        assetApi.listAssetTyres(assetNo),
        assetApi.listAssetWorkOrders(),
        assetApi.reportAssetOverview({ country: 'All' }),
        assetApi.listAssetInspections(assetNo),
        assetApi.listAssetAccidents(assetNo),
        assetApi.latestOdometer(assetNo),
        assetApi.latestEngineHours(assetNo),
        // Preventive Maintenance: plans (client-filtered to this asset) + history.
        // Both degrade to [] when the pm_* tables are not provisioned yet.
        listPmPrograms({}),
        listPmServiceRecords({ asset_no: assetNo }),
      ])

      if (assetRes.status === 'rejected') throw new Error(assetRes.reason?.message || String(assetRes.reason))
      if (assetRes.value?.error) throw new Error(assetRes.value.error.message)

      const tyreRows = tyreRes.status === 'fulfilled' ? (tyreRes.value.data ?? []) : []
      const woRows   = woRes.status === 'fulfilled' ? (woRes.value.data ?? []) : []
      const ovRows   = ovRes.status === 'fulfilled' ? (ovRes.value.data ?? []) : []
      const inspRows = inspRes.status === 'fulfilled' ? (inspRes.value.data ?? []) : []
      const accRows  = accRes.status === 'fulfilled' ? (accRes.value.data ?? []) : []
      const odoRow   = odoRes.status === 'fulfilled' ? (odoRes.value.data ?? null) : null
      const ehRow    = ehRes.status === 'fulfilled' ? (ehRes.value.data ?? null) : null
      const pmRows   = pmRes.status === 'fulfilled' ? (pmRes.value ?? []) : []
      const pmSvcRows = pmSvcRes.status === 'fulfilled' ? (pmSvcRes.value ?? []) : []
      const ov       = ovRows.find(o => o.asset_no === assetNo) ?? null

      // Fall back to a synthesized record from the overview when vehicle_fleet
      // has no row for this asset (asset seen only through tyre/overview data).
      let record = assetRes.value?.data ?? null
      if (!record) {
        if (!tyreRows.length && !ov && !inspRows.length && !accRows.length) { setAsset(null); setLoading(false); return }
        record = {
          id: null, asset_no: assetNo, vehicle_type: null,
          make: null, model: null, year: null,
          site: ov?.site ?? tyreRows[0]?.site ?? inspRows[0]?.site ?? null,
          country: ov?.country ?? tyreRows[0]?.country ?? null,
          active: true,
        }
      }

      setAsset(record)
      setTyres(tyreRows)
      setWorkOrders(woRows.filter(w => w.asset_no === assetNo))
      setInspections(inspRows)
      setAccidents(accRows)
      setMeter({ odometer: odoRow, engineHours: ehRow })
      setPmPlans(pmRows.filter(p => p.asset_no === assetNo))
      setPmServices(pmSvcRows)
      setOverview(ov)
    } catch (e) {
      setError(toUserMessage(e, t('assetmgmt.detail.loadError')))
      setAsset(null)
    } finally {
      setLoading(false)
    }
  }, [assetNo, t])

  useEffect(() => { load() }, [load, refreshKey])

  // Resolve this asset's authoritative tyre cost from the expense grid (scoped to
  // the asset's country). Stores a number only when the grid is available AND
  // carries this asset; otherwise stays null so the tile falls back to legacy.
  useEffect(() => {
    let cancelled = false
    const key = String(assetNo ?? '').trim().toUpperCase()
    if (!key) { setGridAssetCost(null); return }
    loadGridTyreByAsset({ country: asset?.country || undefined })
      .then(res => {
        if (cancelled) return
        setGridAssetCost(res && res.map.has(key) ? res.map.get(key) : null)
      })
      .catch(() => { if (!cancelled) setGridAssetCost(null) })
    return () => { cancelled = true }
  }, [assetNo, asset?.country, refreshKey])

  // ── derived ────────────────────────────────────────────────────────────────
  const activeTyres = useMemo(() => tyres.filter(t => !t.km_at_removal), [tyres])
  // Total lifetime tyre cost: authoritative expense-grid amount for this asset
  // when available, else the tyre_records cost_per_tyre sum (honest fallback).
  const legacyTotalCost = useMemo(
    () => tyres.reduce((s, t) => s + (parseFloat(t.cost_per_tyre) || 0) * (Number(t.qty) || 1), 0),
    [tyres],
  )
  const totalCost = gridAssetCost != null ? gridAssetCost : legacyTotalCost
  const derivedWorstRisk = useMemo(() => overview?.worst_risk ?? worstRisk(activeTyres), [overview, activeTyres])
  const ytdCost = Number(overview?.ytd_cost) || 0
  const openWorkOrders = useMemo(
    () => workOrders.filter(w => !['completed', 'closed', 'cancelled'].includes(String(w.status ?? '').toLowerCase())).length,
    [workOrders],
  )
  // current_km is advanced by the odometer sync trigger; fall back to the latest
  // logged reading when the denormalised column is empty.
  const currentKm = useMemo(() => {
    const fromAsset = asset?.current_km != null && asset.current_km !== '' ? Number(asset.current_km) : null
    const fromLog = meter.odometer?.odometer_km != null ? Number(meter.odometer.odometer_km) : null
    return fromAsset ?? fromLog
  }, [asset, meter])
  const fmtNum = (n) => (n == null || isNaN(n) ? '-' : Number(n).toLocaleString('en-US'))

  // Current engine hours for meter-based PM bands (date-only when absent).
  const currentHours = useMemo(
    () => (meter.engineHours?.engine_hours != null ? Number(meter.engineHours.engine_hours) : null),
    [meter],
  )
  // Each PM plan for this asset paired with its combined date + meter due band.
  const pmDueRows = useMemo(() => {
    const now = Date.now()
    return pmPlans.map(plan => ({ plan, due: pmAssetDueStatus(plan, { now, currentKm, currentHours }) }))
  }, [pmPlans, currentKm, currentHours])

  const monthlyData = useMemo(() => {
    const now = new Date()
    const labels = []; const costs = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      labels.push(formatMonthYear(d))
      const mo = d.getMonth(); const yr = d.getFullYear()
      const sum = tyres.filter(t => {
        if (!t.issue_date) return false
        const td = new Date(t.issue_date)
        return td.getMonth() === mo && td.getFullYear() === yr
      }).reduce((s, t) => s + (parseFloat(t.cost_per_tyre) || 0) * (Number(t.qty) || 1), 0)
      costs.push(sum)
    }
    return { labels, costs }
  }, [tyres])

  const chartData = {
    labels: monthlyData.labels,
    datasets: [{
      label: t('assetmgmt.drawer.monthlyCostSeriesLabel'),
      data: monthlyData.costs,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.1)',
      fill: true, tension: 0.4, pointRadius: 3,
    }],
  }

  const recommendations = useMemo(() => {
    const out = []
    const criticalTyres = activeTyres.filter(t => t.risk_level === 'Critical')
    const highTyres = activeTyres.filter(t => t.risk_level === 'High')
    const lowTread = activeTyres.filter(t => parseFloat(t.tread_depth) < 3)
    if (criticalTyres.length) out.push({ level: 'Critical', msg: t('assetmgmt.drawer.recCriticalRisk', { count: criticalTyres.length }) })
    if (highTyres.length) out.push({ level: 'High', msg: t('assetmgmt.drawer.recHighRisk', { count: highTyres.length }) })
    if (lowTread.length) out.push({ level: 'High', msg: t('assetmgmt.drawer.recLowTread', { count: lowTread.length }) })
    if (!activeTyres.length) out.push({ level: 'Medium', msg: t('assetmgmt.drawer.recNoActive') })
    if (out.length === 0) out.push({ level: 'Low', msg: t('assetmgmt.drawer.recAllGood') })
    return out
  }, [activeTyres, t])

  const siteOptions = useMemo(() => [asset?.site].filter(Boolean), [asset])
  const countryOptions = useMemo(() => [asset?.country].filter(Boolean), [asset])

  // ── states ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="text-[var(--text-primary)]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
          <BackButton onClick={() => navigate('/assets')} label={t('assetmgmt.detail.backToAssets')} />
          <LoadingState message={t('assetmgmt.detail.loading')} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-[var(--text-primary)]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
          <BackButton onClick={() => navigate('/assets')} label={t('assetmgmt.detail.backToAssets')} />
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <AlertTriangle className="w-12 h-12 mb-3 text-red-400" />
            <p className="text-red-300 font-medium">{t('assetmgmt.detail.loadErrorTitle')}</p>
            <p className="text-[var(--text-muted)] text-sm mt-1 max-w-md">{error}</p>
            <button onClick={() => setRefreshKey(k => k + 1)} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
              <RefreshCw size={16} /> {t('assetmgmt.detail.retry')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!asset) {
    return (
      <div className="text-[var(--text-primary)]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
          <BackButton onClick={() => navigate('/assets')} label={t('assetmgmt.detail.backToAssets')} />
          <EmptyState
            icon={Truck}
            title={t('assetmgmt.detail.notFoundTitle', { assetNo })}
            description={t('assetmgmt.detail.notFoundDesc')}
            action={{ label: t('assetmgmt.detail.backToAssets'), onClick: () => navigate('/assets') }}
          />
        </div>
      </div>
    )
  }

  const TABS = [
    { id: 'overview',   label: t('assetmgmt.detail.tabs.overview'),   icon: Layers },
    { id: 'tyres',      label: t('assetmgmt.detail.tabs.tyres'),      icon: Activity },
    { id: 'costs',      label: t('assetmgmt.detail.tabs.costs'),      icon: DollarSign },
    { id: 'workorders', label: t('assetmgmt.detail.tabs.workOrders'), icon: Zap },
    { id: 'inspections', label: `Inspections${inspections.length ? ` (${inspections.length})` : ''}`, icon: ClipboardCheck },
    { id: 'pm',         label: `Preventive Maintenance${pmPlans.length ? ` (${pmPlans.length})` : ''}`, icon: CalendarClock },
    { id: 'incidents',  label: `Incidents${accidents.length ? ` (${accidents.length})` : ''}`, icon: ShieldAlert },
    { id: 'approvals',  label: t('assetmgmt.detail.tabs.approvals'),  icon: Shield },
  ]

  return (
    <div className="text-[var(--text-primary)]">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">

        <BackButton onClick={() => navigate('/assets')} label={t('assetmgmt.detail.backToAssets')} />

        {/* Header */}
        <div className="bg-[var(--surface-1)] rounded-2xl border border-[var(--border-dim)] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Illustration
              name={vehicleArt(asset.vehicle_type)}
              size={100}
              title={asset.vehicle_type || 'Vehicle'}
              className="shrink-0 hidden sm:block"
            />
            <div>
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest mb-1">{t('assetmgmt.drawer.assetProfile')}</p>
              <h1 className="text-2xl font-bold text-[var(--text-primary)]">{asset.asset_no}</h1>
              <p className="text-sm text-[var(--text-secondary)]">
                {[asset.vehicle_type, [asset.make, asset.model, asset.year].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5"><MapPin className="inline w-3 h-3 mr-1" />{asset.site ?? '-'} · {asset.country ?? '-'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${asset.active ? 'bg-green-900/50 text-green-300' : 'bg-[var(--surface-2)] text-[var(--text-secondary)]'}`}>
              {asset.active ? t('assetmgmt.drawer.active') : t('assetmgmt.drawer.inactive')}
            </span>
            {derivedWorstRisk && (
              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${RISK_COLOR[derivedWorstRisk]?.bg} ${RISK_COLOR[derivedWorstRisk]?.text}`}>
                {derivedWorstRisk}
              </span>
            )}
            {isAdmin && asset.id != null && (
              <button
                onClick={() => !wfLocked && setEditing(true)}
                disabled={wfLocked}
                title={wfLocked ? 'Locked: in approval' : t('assetmgmt.actions.editAsset')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-yellow-400 hover:text-yellow-300 text-sm transition-colors border border-[var(--border-bright)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {wfLocked ? <Lock className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                {t('assetmgmt.actions.editAsset')}
              </button>
            )}
          </div>
        </div>

        {wfLocked && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Lock className="w-3 h-3" /> {t('assetmgmt.detail.lockedInApproval')}
          </div>
        )}

        {/* Quick-nav actions (deep-links preserved from the quick-look drawers) */}
        <div className="flex flex-wrap gap-2">
          <QuickLink icon={History} label={t('assetmgmt.detail.quick.vehicleHistory')} onClick={() => navigate(`/vehicle-history?asset=${encodeURIComponent(asset.asset_no)}`)} />
          <QuickLink icon={Wrench} label={t('assetmgmt.detail.quick.workOrders')} onClick={() => navigate(`/work-orders?asset=${encodeURIComponent(asset.asset_no)}`)} />
          <QuickLink icon={ClipboardCheck} label={t('assetmgmt.detail.quick.inspections')} onClick={() => navigate(`/inspections?asset=${encodeURIComponent(asset.asset_no)}`)} />
        </div>

        {/* Live stat strip — real counts pulled for this asset */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile icon={Gauge} label="Current KM" value={currentKm != null ? fmtNum(currentKm) : '-'}
            sub={meter.odometer?.reading_date ? `as of ${fmtDate(meter.odometer.reading_date)}` : null} color="blue" />
          <StatTile icon={Fuel} label="Engine Hours"
            value={meter.engineHours?.engine_hours != null ? fmtNum(meter.engineHours.engine_hours) : '-'}
            sub={meter.engineHours?.reading_date ? fmtDate(meter.engineHours.reading_date) : null} color="teal" />
          <StatTile icon={Activity} label="Active Tyres" value={activeTyres.length}
            sub={`${tyres.length} on record`} color="green" />
          <StatTile icon={Wrench} label="Open Work Orders" value={openWorkOrders}
            sub={`${workOrders.length} total`} color="yellow" />
          <StatTile icon={ClipboardCheck} label="Inspections" value={inspections.length}
            sub={inspections[0]?.inspection_date ? `last ${fmtDate(inspections[0].inspection_date)}` : 'none logged'} color="purple" />
          <StatTile icon={ShieldAlert} label="Incidents" value={accidents.length}
            sub={accidents.length ? 'recorded' : 'none recorded'} color={accidents.length ? 'red' : 'green'} />
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 bg-[var(--surface-1)] rounded-xl p-1 border border-[var(--border-dim)] w-fit">
          {TABS.map(tb => (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === tb.id ? 'bg-blue-600 text-white' : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-2)]'
              }`}>
              <tb.icon className="w-4 h-4" />
              {tb.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ── Overview ──────────────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Tyre Position Diagram */}
              <div className="card">
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2"><Layers className="w-4 h-4 text-blue-400" /> {t('assetmgmt.drawer.tyrePositionMap')}</h3>
                <div className="flex gap-4 items-start">
                  <div className="flex-1"><TyrePositionDiagram tyres={activeTyres} /></div>
                  <div className="flex flex-col gap-2 pt-4">
                    {Object.entries(RISK_COLOR).map(([level, c]) => (
                      <div key={level} className="flex items-center gap-2 text-xs">
                        <span className="w-3 h-3 rounded-full" style={{ background: c.hex }} />
                        <span className="text-[var(--text-secondary)]">{level}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 text-xs mt-1">
                      <span className="w-3 h-3 rounded-full bg-gray-600 opacity-40" />
                      <span className="text-[var(--text-secondary)]">{t('assetmgmt.drawer.noDataLegend')}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recommendations */}
              <div className="card">
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
                  <Target className="w-4 h-4 text-purple-400" /> {t('assetmgmt.drawer.recommendations')}
                </h3>
                <div className="space-y-2">
                  {recommendations.map((r, i) => {
                    const rc = RISK_COLOR[r.level] ?? { bg: 'bg-[var(--surface-2)]', text: 'text-[var(--text-secondary)]' }
                    return (
                      <div key={i} className={`flex items-start gap-3 p-3 rounded-lg ${rc.bg} bg-opacity-20`}>
                        <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${rc.text}`} />
                        <p className={`text-xs ${rc.text}`}>{r.msg}</p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Vehicle profile — real registry fields */}
              <div className="lg:col-span-2 card">
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 flex items-center gap-2">
                  <Truck className="w-4 h-4 text-blue-400" /> Vehicle Profile
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
                  <ProfileField icon={Hash} label="Fleet Number" value={asset.fleet_number} />
                  <ProfileField icon={Truck} label="Type" value={asset.vehicle_type} />
                  <ProfileField icon={Layers} label="Make / Model" value={[asset.make, asset.model].filter(Boolean).join(' ')} />
                  <ProfileField icon={Calendar} label="Year" value={asset.year} />
                  <ProfileField icon={Building2} label="Department" value={asset.department} />
                  <ProfileField icon={User} label="Operator" value={asset.operator_name} />
                  <ProfileField icon={MapPin} label="Site" value={asset.site} />
                  <ProfileField icon={MapPin} label="Region" value={asset.region} />
                  <ProfileField icon={Hash} label="Registration No" value={asset.registration_no} />
                  <ProfileField icon={Calendar} label="Registration Date" value={asset.registration_date ? fmtDate(asset.registration_date) : null} />
                  <ProfileField icon={Activity} label="Tyre Size" value={asset.tyre_size} />
                  <ProfileField icon={DollarSign} label="Monthly Tyre Budget"
                    value={asset.monthly_tyre_budget != null ? fmtCurrency(asset.monthly_tyre_budget, activeCurrency) : null} />
                </div>
                {asset.notes && (
                  <p className="mt-4 pt-4 border-t border-[var(--border-dim)] text-xs text-[var(--text-secondary)] leading-relaxed">
                    <span className="text-[var(--text-muted)] uppercase tracking-widest mr-2">Notes</span>{asset.notes}
                  </p>
                )}
              </div>

              {/* Custom fields */}
              <div className="lg:col-span-2">
                <CustomFieldsPanel data={asset.custom_data} title={t('assetmgmt.drawer.customFieldsTitle')} />
              </div>
            </motion.div>
          )}

          {/* ── Tyre Bay ──────────────────────────────────────────────────────────
              Per-vehicle wheel bay: 3D diagram with current-tyre risk lit up,
              selected-position detail + full position history, one-click Move/Swap
              and Remove (gated by the approval lock), and per-tyre passport links.
              Receives the FULL tyres array so history is complete. */}
          {tab === 'tyres' && (
            <motion.div key="tyres" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <TyreBay
                asset={asset}
                tyres={tyres}
                currency={activeCurrency}
                locked={wfLocked}
                onMoved={load}
              />
            </motion.div>
          )}

          {/* ── Costs ─────────────────────────────────────────────────────────── */}
          {tab === 'costs' && (
            <motion.div key="costs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="card">
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-400" /> {t('assetmgmt.drawer.monthlyCostChartTitle')}
                </h3>
                <div className="h-56">
                  <Line data={chartData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
                </div>
                {gridAssetCost != null && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-2">
                    Monthly breakdown from tyre records; authoritative lifetime total from the expense grid.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-blue-900/20 to-blue-800/10 rounded-xl border border-blue-800/30 p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest">{t('assetmgmt.drawer.totalLifetimeCost')}</p>
                    <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{fmtCurrency(totalCost, activeCurrency)}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{t('assetmgmt.drawer.tyreRecordsTotal', { count: tyres.length })}</p>
                  </div>
                  <DollarSign className="w-10 h-10 text-blue-500 opacity-40" />
                </div>
                <div className="bg-gradient-to-br from-purple-900/20 to-purple-800/10 rounded-xl border border-purple-800/30 p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest">{t('assetmgmt.detail.ytdCost')}</p>
                    <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{fmtCurrency(ytdCost, activeCurrency)}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{t('assetmgmt.detail.ytdCostSub')}</p>
                  </div>
                  <DollarSign className="w-10 h-10 text-purple-500 opacity-40" />
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Work Orders ───────────────────────────────────────────────────── */}
          {tab === 'workorders' && (
            <motion.div key="workorders" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="bg-[var(--surface-2)] rounded-xl border border-[var(--border-bright)] overflow-hidden">
                <div className="p-4 border-b border-[var(--border-bright)] flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400" /> {t('assetmgmt.drawer.recentWorkOrders')}
                  </h3>
                  <button onClick={() => navigate(`/work-orders?asset=${encodeURIComponent(asset.asset_no)}`)}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors">{t('assetmgmt.detail.viewAll')}</button>
                </div>
                {workOrders.length ? (
                  <div className="divide-y divide-[var(--border-bright)]">
                    {workOrders.slice(0, 20).map((wo, i) => (
                      <div key={wo.id ?? i} className="px-4 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">{wo.work_type ?? t('assetmgmt.drawer.workOrderFallback')}</p>
                          <p className="text-xs text-[var(--text-muted)]">{fmtDate(wo.created_at)}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {wo.total_cost && <span className="text-xs text-[var(--text-secondary)]">{fmtCurrency(wo.total_cost, activeCurrency)}</span>}
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            wo.status === 'Completed' ? 'bg-green-900/50 text-green-300' :
                            wo.status === 'Open' ? 'bg-blue-900/50 text-blue-300' :
                            'bg-yellow-900/50 text-yellow-300'
                          }`}>{wo.status ?? '-'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-[var(--text-muted)] text-sm">{t('assetmgmt.detail.noWorkOrders')}</div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Inspections ───────────────────────────────────────────────────── */}
          {tab === 'inspections' && (
            <motion.div key="inspections" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="bg-[var(--surface-2)] rounded-xl border border-[var(--border-bright)] overflow-hidden">
                <div className="p-4 border-b border-[var(--border-bright)] flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-blue-400" /> Inspection History ({inspections.length})
                  </h3>
                  <button onClick={() => navigate(`/inspections?asset=${encodeURIComponent(asset.asset_no)}`)}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors">{t('assetmgmt.detail.viewAll')}</button>
                </div>
                {inspections.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border-bright)]">
                          {['Date', 'Type', 'Inspector', 'Odometer', 'Severity', 'Status', 'Findings'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[var(--text-muted)] font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {inspections.map((ins, i) => {
                          const sev = String(ins.severity ?? '').toLowerCase()
                          const sevColor = sev === 'critical' || sev === 'high' ? 'text-red-400'
                            : sev === 'medium' ? 'text-yellow-400' : sev ? 'text-green-400' : 'text-[var(--text-dim)]'
                          return (
                            <tr key={ins.id ?? i} className="border-b border-[var(--border-bright)] hover:bg-[var(--surface-3)] transition-colors">
                              <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(ins.inspection_date ?? ins.completed_date ?? ins.scheduled_date ?? ins.created_at)}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{ins.inspection_type ?? ins.title ?? '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{ins.inspector ?? '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{ins.odometer_km != null ? `${fmtNum(ins.odometer_km)} km` : '-'}</td>
                              <td className={`px-3 py-2 font-medium ${sevColor}`}>{ins.severity ?? '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{ins.approval_status ?? ins.status ?? '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)] max-w-[240px] truncate" title={ins.findings ?? ''}>{ins.findings ?? ins.notes ?? '-'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center text-[var(--text-muted)] text-sm">No inspections recorded for this asset.</div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Preventive Maintenance ────────────────────────────────────────── */}
          {tab === 'pm' && (
            <motion.div key="pm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              {/* Plans for this asset */}
              <div className="bg-[var(--surface-2)] rounded-xl border border-[var(--border-bright)] overflow-hidden">
                <div className="p-4 border-b border-[var(--border-bright)] flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-blue-400" /> Preventive Maintenance Plans ({pmPlans.length})
                  </h3>
                  <button onClick={() => navigate('/pm-programs')}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors inline-flex items-center gap-1">
                    <ExternalLink className="w-3.5 h-3.5" /> Manage plans
                  </button>
                </div>
                {pmDueRows.length ? (
                  <div className="divide-y divide-[var(--border-bright)]">
                    {pmDueRows.map(({ plan, due }, i) => {
                      const meta = PM_DUE_META[due.band] ?? PM_DUE_META.none
                      const priority = String(plan.priority ?? '').toLowerCase()
                      const status = String(plan.status ?? '').toLowerCase()
                      const meterDue = plan.next_due_meter != null
                        ? `${fmtNum(plan.next_due_meter)}${due.unit ? ` ${due.unit}` : ''}`
                        : null
                      return (
                        <div key={plan.id ?? i} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{plan.name ?? 'Untitled plan'}</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              {'Next due: '}
                              {plan.next_due ? fmtDate(plan.next_due) : 'no date'}
                              {meterDue ? ` | at ${meterDue}` : ''}
                              {due.daysToDue != null ? ` | ${due.daysToDue}d` : ''}
                              {due.meterRemaining != null ? ` | ${fmtNum(due.meterRemaining)}${due.unit ? ` ${due.unit}` : ''} left` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PM_DUE_BADGE[due.band] ?? PM_DUE_BADGE.none}`}>{meta.label}</span>
                            {priority && (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${PM_PRIORITY_BADGE[priority] ?? PM_PRIORITY_BADGE.low}`}>{priority}</span>
                            )}
                            {status && (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${PM_STATUS_BADGE[status] ?? PM_STATUS_BADGE.completed}`}>{status}</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="p-6 text-center text-[var(--text-muted)] text-sm">No preventive maintenance plans for this asset.</div>
                )}
              </div>

              {/* Service history for this asset */}
              <div className="bg-[var(--surface-2)] rounded-xl border border-[var(--border-bright)] overflow-hidden">
                <div className="p-4 border-b border-[var(--border-bright)]">
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-yellow-400" /> Service History ({pmServices.length})
                  </h3>
                </div>
                {pmServices.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border-bright)]">
                          {['Date', 'Meter', 'Outcome', 'Performed By', 'Total Cost'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[var(--text-muted)] font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pmServices.map((sv, i) => {
                          const outcome = String(sv.outcome ?? '').toLowerCase()
                          const outcomeColor = outcome === 'completed' ? 'text-green-400'
                            : outcome === 'deferred' ? 'text-yellow-400'
                            : outcome ? 'text-[var(--text-secondary)]' : 'text-[var(--text-dim)]'
                          const meterUnit = sv.meter_type === 'engine_hours' ? 'h' : sv.meter_type === 'odometer' ? 'km' : ''
                          return (
                            <tr key={sv.id ?? i} className="border-b border-[var(--border-bright)] hover:bg-[var(--surface-3)] transition-colors">
                              <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{sv.service_date ? fmtDate(sv.service_date) : '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{sv.meter_reading != null ? `${fmtNum(sv.meter_reading)}${meterUnit ? ` ${meterUnit}` : ''}` : '-'}</td>
                              <td className={`px-3 py-2 font-medium capitalize ${outcomeColor}`}>{sv.outcome ?? '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{sv.performed_by ?? '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{sv.total_cost != null ? fmtCurrency(sv.total_cost, activeCurrency) : '-'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center text-[var(--text-muted)] text-sm">No preventive maintenance service history for this asset.</div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Incidents / Accidents ─────────────────────────────────────────── */}
          {tab === 'incidents' && (
            <motion.div key="incidents" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="bg-[var(--surface-2)] rounded-xl border border-[var(--border-bright)] overflow-hidden">
                <div className="p-4 border-b border-[var(--border-bright)] flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-400" /> Incident History ({accidents.length})
                  </h3>
                  <button onClick={() => navigate(`/accidents?asset=${encodeURIComponent(asset.asset_no)}`)}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors">{t('assetmgmt.detail.viewAll')}</button>
                </div>
                {accidents.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border-bright)]">
                          {['Date', 'Type', 'Severity', 'Location', 'Driver', 'Status', 'Claim', 'Est. Damage'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[var(--text-muted)] font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {accidents.map((ac, i) => {
                          const sev = String(ac.severity ?? '').toLowerCase()
                          const sevColor = sev === 'critical' || sev === 'major' || sev === 'high' ? 'text-red-400'
                            : sev === 'moderate' || sev === 'medium' ? 'text-yellow-400' : sev ? 'text-green-400' : 'text-[var(--text-dim)]'
                          const cost = (parseFloat(ac.repair_cost) || 0) || (parseFloat(ac.estimated_damage_cost) || 0)
                          return (
                            <tr key={ac.id ?? i} className="border-b border-[var(--border-bright)] hover:bg-[var(--surface-3)] transition-colors">
                              <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(ac.incident_date ?? ac.created_at)}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{ac.accident_type ?? '-'}</td>
                              <td className={`px-3 py-2 font-medium ${sevColor}`}>{ac.severity ?? '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)] max-w-[160px] truncate" title={ac.location ?? ''}>{ac.location ?? '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{ac.driver_name ?? '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{ac.status ?? '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{ac.claim_status ?? '-'}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{cost > 0 ? fmtCurrency(cost, activeCurrency) : '-'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center text-[var(--text-muted)] text-sm">No incidents recorded for this asset.</div>
                )}
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {/* ── Approvals ───────────────────────────────────────────────────────
            Mounted for every tab (not just "approvals") so the disposal-approval
            state stays authoritative — the header edit gate depends on wfLocked,
            which this panel reports. Only its container is toggled by tab. */}
        <div className={tab === 'approvals' ? 'block' : 'hidden'}>
          <EntityApprovalPanel
            entityType="asset_disposal"
            entityId={asset.id ?? asset.asset_no}
            entityLabel={asset.asset_no || asset.id}
            context={{
              book_value: ytdCost,
              disposal_reason: asset.active === false ? 'inactive' : null,
              asset_type: asset.vehicle_type || null,
              site: asset.site || null,
              country: asset.country || null,
              worst_risk: derivedWorstRisk || null,
            }}
            onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
            title={t('assetmgmt.drawer.disposalApprovalTitle')}
          />
        </div>
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {editing && asset.id != null && (
          <EditPanel
            asset={asset}
            sites={siteOptions}
            countries={countryOptions}
            locked={wfLocked}
            onClose={() => setEditing(false)}
            onSaved={(payload) => { setEditing(false); setAsset(prev => ({ ...prev, ...payload })); setRefreshKey(k => k + 1) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Small building blocks ───────────────────────────────────────────────────────
function BackButton({ onClick, label }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors mb-4">
      <ArrowLeft className="w-4 h-4" /> {label}
    </button>
  )
}

const STAT_COLORS = {
  blue:   'text-blue-400',
  green:  'text-green-400',
  yellow: 'text-yellow-400',
  purple: 'text-purple-400',
  red:    'text-red-400',
  teal:   'text-teal-400',
}
function StatTile({ icon: Icon, label, value, sub, color = 'blue' }) {
  return (
    <div className="bg-[var(--surface-1)] rounded-xl border border-[var(--border-dim)] p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-widest font-medium">{label}</span>
        <Icon className={`w-4 h-4 ${STAT_COLORS[color] ?? STAT_COLORS.blue}`} />
      </div>
      <p className="text-xl font-bold text-[var(--text-primary)] leading-tight">{value ?? '-'}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] truncate">{sub}</p>}
    </div>
  )
}

function ProfileField({ icon: Icon, label, value }) {
  const shown = value == null || value === '' ? '-' : value
  return (
    <div>
      <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1 flex items-center gap-1.5">
        {Icon && <Icon className="w-3 h-3" />}{label}
      </p>
      <p className={`text-sm font-medium ${shown === '-' ? 'text-[var(--text-dim)]' : 'text-[var(--text-primary)]'} break-words`}>{shown}</p>
    </div>
  )
}

function QuickLink({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-medium transition-colors">
      <Icon className="w-4 h-4" /> {label}
    </button>
  )
}
