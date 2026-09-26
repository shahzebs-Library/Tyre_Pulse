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
  CalendarClock, ExternalLink, Globe,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import * as assetApi from '../lib/api/assetManagement'
import { listPmPrograms, listPmServiceRecords } from '../lib/api/pmPrograms'
import AssetFullHistory from '../components/asset/AssetFullHistory'
import { loadGridTyreByAsset } from '../lib/api/costSummary'
import { getAssetMaster, COUNTRY_CURRENCY } from '../lib/api/assetMaster'
import { getAssetUtilization } from '../lib/api/assetUtilization'
import { idlePct as utilIdlePct, secondsToHours as utilHours } from '../lib/fleetUtilization'
import { getAssetOwnershipFor } from '../lib/api/assetOwnership'
import { basisMeta, ownershipExplanation, UNKNOWN_OWNER } from '../lib/assetOwnership'
import { toUserMessage } from '../lib/safeError'
import { pmAssetDueStatus } from '../lib/pmSchedule'
import { PM_DUE_META } from '../lib/pmPrograms'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { formatCurrencyCompact, formatDate, formatMonthYear } from '../lib/formatters'
import LoadingState from '../components/LoadingState'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmptyState from '../components/EmptyState'
import Modal from '../components/ui/Modal'
import CustomFieldsPanel from '../components/CustomFieldsPanel'
import TyreBay from '../components/TyreBay'
import AssetInsurancePanel from '../components/insurance/AssetInsurancePanel'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { Illustration } from '../components/illustrations'
import { vehicleArt } from '../lib/brand/vehicleArt'
import { fetchAllPages } from '../lib/fetchAll'
import { applyCountry } from '../lib/api/_client'
import { colorAt, withAlpha } from '../lib/reportColors'
import { reportFileName, reportDateLabel } from '../lib/exportUtils'
import {
  worstRisk, activeTyresOf, tyreRecordCost, countOpenWorkOrders, workOrderSpend, workOrderStatusLabel,
  currentKmOf, monthlyTyreCost, tyreRecommendations, severityTone, inspectionDateOf, accidentCostOf,
  serviceMeterUnit, pmDueSummary, crossCountryRows as buildCrossCountryRows,
} from '../lib/assetDetailAnalytics'

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
    legend: { labels: { color: 'var(--text-secondary)', font: { size: 11 }, boxWidth: 12 } },
    tooltip: {
      backgroundColor: 'var(--panel-2)',
      titleColor: 'var(--text-primary)',
      bodyColor: 'var(--text-secondary)',
      borderColor: 'var(--border-bright)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
const fmtCurrency = (n, cur) => formatCurrencyCompact(n, cur)
const fmtDate = (d) => formatDate(d)
// Undefined (not null) marks a missing number so it always sorts last.
const numOrUndef = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))
const NUM = { sortUndefined: 'last', sortingFn: 'basic', meta: { align: 'right' } }
const fmtNum = (n) => (n == null || n === '' || !Number.isFinite(Number(n)) ? 'N/A' : Number(n).toLocaleString('en-US'))
const SEV_TEXT = { danger: 'text-red-400', warning: 'text-yellow-400', good: 'text-green-400', none: 'text-[var(--text-dim)]' }
const WO_BADGE = {
  Completed: 'bg-green-900/50 text-green-300',
  Cancelled: 'bg-[var(--surface-3)] text-[var(--text-secondary)]',
  New: 'bg-blue-900/50 text-blue-300',
}

/**
 * This machine's job cards only: asset AND country (V376 - the same code in
 * another country is a different vehicle). Paged so a busy machine is never
 * cut at the server's 1,000-row cap, ordered with an id tiebreak.
 */
function listThisAssetWorkOrders(assetNo, country) {
  return fetchAllPages((from, to) => applyCountry(
    supabase.from('work_orders')
      .select('id,asset_no,country,status,total_cost,created_at,opened_at,work_type,work_order_no,priority,labour_cost,parts_cost,completed_at')
      .eq('asset_no', assetNo),
    country,
  ).order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to), { max: 20000 })
}

/** A section whose read failed: says so and offers Retry, never an empty list. */
function ReadFailed({ what, onRetry }) {
  return (
    <div role="alert" className="p-6 flex flex-col items-center gap-3 text-center">
      <AlertTriangle className="w-6 h-6 text-red-400" aria-hidden="true" />
      <p className="text-sm text-[var(--text-secondary)]">The {what} for this asset could not be read. This is not the same as there being none.</p>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 px-3 py-2 min-h-11 rounded-lg bg-[var(--surface-1)] border border-[var(--border-bright)] text-sm text-[var(--text-primary)] hover:bg-[var(--surface-3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry
      </button>
    </div>
  )
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
    <svg viewBox="0 0 280 260" className="w-full max-w-xs mx-auto" role="img"
      aria-label={`Tyre position map: ${tyres.length} fitted tyre${tyres.length === 1 ? '' : 's'}${positions.filter(p => byPos[p.id]).map(p => `, ${p.label} ${byPos[p.id].risk_level || 'unrated'}`).join('')}`}>
      <rect x={95} y={30} width={90} height={200} rx={8} strokeWidth="2" style={{ fill: 'var(--panel-2)', stroke: 'var(--border-bright)' }} />
      <rect x={110} y={40} width={60} height={28} rx={5} strokeWidth="1.5" style={{ fill: 'var(--surface-3)', stroke: 'var(--border-bright)' }} />
      {[90, 190].map((y, i) => (
        <line key={i} x1={95} x2={185} y1={y} y2={y} strokeWidth="1" strokeDasharray="4 4" style={{ stroke: 'var(--border-bright)' }} />
      ))}
      {positions.map(p => {
        const t = byPos[p.id]
        const col = t ? (RISK_COLOR[t.risk_level]?.hex ?? '#9ca3af') : '#9ca3af'
        const opacity = t ? 1 : 0.35
        return (
          <g key={p.id}>
            <circle cx={p.cx} cy={p.cy} r={13} fill={col} opacity={opacity} stroke={col} strokeWidth="1.5" />
            <text x={p.cx} y={p.cy + 4} textAnchor="middle" fill="#fff" fontSize="7" fontFamily="monospace" fontWeight="600">{p.label}</text>
            {t && (
              <text x={p.cx} y={p.cy + 26} textAnchor="middle" fontSize="6" style={{ fill: 'var(--text-muted)' }}>{t.brand ?? ''}</text>
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
    <Modal
      open
      onClose={onClose}
      size="md"
      title={<span className="flex items-center gap-2"><Edit2 className="w-5 h-5 text-yellow-400" aria-hidden="true" />{t('assetmgmt.modal.editTitle')}</span>}
      footer={(
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 min-h-11 rounded-lg bg-[var(--surface-2)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-3)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{t('assetmgmt.modal.cancel')}</button>
          <button type="button" onClick={handleSave} disabled={saving || locked}
            title={locked ? 'Locked: in approval' : undefined}
            className="px-5 py-2 min-h-11 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            {locked ? <Lock className="w-4 h-4" aria-hidden="true" /> : saving ? <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
            {saving ? t('assetmgmt.modal.saving') : t('assetmgmt.modal.save')}
          </button>
        </div>
      )}
    >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ad-edit-assetNo" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.assetNo')}</label>
              <input id="ad-edit-assetNo" value={form.asset_no ?? ''} onChange={e => set('asset_no', e.target.value.toUpperCase())}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] min-h-11 focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40" />
            </div>
            <div>
              <label htmlFor="ad-edit-vehicleType" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.vehicleType')}</label>
              <select id="ad-edit-vehicleType" value={form.vehicle_type ?? ''} onChange={e => set('vehicle_type', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                <option value="">{t('assetmgmt.modal.selectType')}</option>
                {VEHICLE_TYPES.map(vt => <option key={vt}>{vt}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ad-edit-make" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.make')}</label>
              <input id="ad-edit-make" value={form.make ?? ''} onChange={e => set('make', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] min-h-11 focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40" />
            </div>
            <div>
              <label htmlFor="ad-edit-model" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.model')}</label>
              <input id="ad-edit-model" value={form.model ?? ''} onChange={e => set('model', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] min-h-11 focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40" />
            </div>
            <div>
              <label htmlFor="ad-edit-year" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.year')}</label>
              <input id="ad-edit-year" type="number" min="1990" max="2030" value={form.year ?? ''} onChange={e => set('year', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] min-h-11 focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40" />
            </div>
            <div>
              <label htmlFor="ad-edit-site" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.site')}</label>
              <input id="ad-edit-site" value={form.site ?? ''} onChange={e => set('site', e.target.value)} list="ad-sites-list"
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] min-h-11 focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40" />
              <datalist id="ad-sites-list">{sites.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label htmlFor="ad-edit-country" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.country')}</label>
              <select id="ad-edit-country" value={form.country ?? ''} onChange={e => set('country', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                <option value="">{t('assetmgmt.modal.select')}</option>
                {(countries.length ? countries : ['KSA','UAE','Egypt']).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-[var(--text-secondary)]">{t('assetmgmt.modal.activeStatus')}</span>
              <button type="button" onClick={() => set('active', !form.active)} aria-pressed={!!form.active} className="flex items-center gap-2 min-h-11 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                {form.active
                  ? <ToggleRight className="w-8 h-8 text-green-400" />
                  : <ToggleLeft className="w-8 h-8 text-[var(--text-dim)]" />}
                <span className={`text-sm font-medium ${form.active ? 'text-green-400' : 'text-[var(--text-muted)]'}`}>
                  {form.active ? t('assetmgmt.modal.active') : t('assetmgmt.modal.inactive')}
                </span>
              </button>
            </div>
          </div>
          {error && <p role="alert" className="text-red-400 text-xs bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
        </div>
    </Modal>
  )
}

// ── Asset Detail Page ─────────────────────────────────────────────────────────
export default function AssetDetail() {
  const { assetNo } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { activeCurrency: settingsCurrency, activeCountry } = useSettings()
  const { t } = useLanguage()
  const isAdmin = profile?.role === 'Admin'

  const [asset, setAsset] = useState(null)
  // This machine belongs to ONE country; its money is shown in that country's
  // currency, not the header selector's (on "All" that is the org default and
  // would label AED or EGP figures as riyals).
  const activeCurrency = COUNTRY_CURRENCY[asset?.country] || settingsCurrency
  const [tyres, setTyres] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [inspections, setInspections] = useState([])
  const [accidents, setAccidents] = useState([])
  const [meter, setMeter] = useState({ odometer: null, engineHours: null })
  const [assetUtil, setAssetUtil] = useState(null)
  const [pmPlans, setPmPlans] = useState([])
  const [pmServices, setPmServices] = useState([])
  const [overview, setOverview] = useState(null)
  // Authoritative tyre cost for THIS asset from the expense grid (V347 RPC). Null
  // means the grid is unavailable or has no tyre spend for this asset -> the cost
  // tile then falls back to the tyre_records cost_per_tyre sum.
  const [gridAssetCost, setGridAssetCost] = useState(null)
  // Cross-country "one vehicle" rollup for this asset_no (V356 RPC via
  // getAssetMaster). Null = not found / RPC unavailable -> the panel stays hidden.
  const [masterRow, setMasterRow] = useState(null)
  // Which country OWNS this asset vs which bore its cost (V376 RPC). Null = no
  // expense history or the RPC is unavailable -> the ownership header is skipped
  // while the rest of the cross-country panel still renders.
  const [ownership, setOwnership] = useState(null)
  // Every fleet row carrying this asset number, and which one is on screen. The
  // same code in two countries is two DIFFERENT machines (V376), so the page has
  // to say whose vehicle it is showing instead of picking one in silence.
  const [matches, setMatches] = useState({ rows: [], countries: [], shown: null, missingInCountry: false, requested: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [readFailed, setReadFailed] = useState({})
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
      // The SAME asset code exists in more than one country for 239 codes, and
      // each is a DIFFERENT machine (V376), so this must never demand one row
      // (.single()/.maybeSingle() is exactly what errored the page). Resolve the
      // fleet rows FIRST, pick the one for the country on screen, then read that
      // machine's history scoped to its own country - merging two vehicles'
      // tyres, inspections and incidents would be worse than the error.
      const scopeCountry = activeCountry && activeCountry !== 'All' ? activeCountry : null
      const { data: fleetRows, error: fleetErr } = await supabase.from('vehicle_fleet')
        .select('id,asset_no,fleet_number,make,model,vehicle_type,year,department,operator_name,site,country,region,tyre_size,tyre_brand_preferred,monthly_tyre_budget,current_km,registration_no,registration_date,status,notes,custom_data,image_path,active:is_active')
        .eq('asset_no', assetNo)
        .order('country', { ascending: true })
        .order('id', { ascending: true })
        .limit(20)
      if (fleetErr) throw new Error(fleetErr.message)
      const allRows = Array.isArray(fleetRows) ? fleetRows : []
      const scopedRows = scopeCountry ? allRows.filter(r => r.country === scopeCountry) : allRows
      const fleetRow = scopedRows[0] || null
      setMatches({
        rows: allRows,
        countries: [...new Set(allRows.map(r => r.country).filter(Boolean))],
        shown: fleetRow?.country ?? null,
        missingInCountry: allRows.length > 0 && scopedRows.length === 0,
        requested: scopeCountry,
      })
      // Read the history of THIS machine only. Falls back to the country on
      // screen when the code has no fleet row at all.
      const dataCountry = fleetRow?.country || scopeCountry || null

      const [tyreRes, woRes, ovRes, inspRes, accRes, odoRes, ehRes, pmRes, pmSvcRes, utilRes] = await Promise.allSettled([
        assetApi.listAssetTyres(assetNo, dataCountry),
        listThisAssetWorkOrders(assetNo, dataCountry),
        assetApi.reportAssetOverview({ country: dataCountry || 'All' }),
        assetApi.listAssetInspections(assetNo, dataCountry),
        assetApi.listAssetAccidents(assetNo, dataCountry),
        assetApi.latestOdometer(assetNo, dataCountry),
        assetApi.latestEngineHours(assetNo, dataCountry),
        // Preventive Maintenance: plans (client-filtered to this asset) + history.
        // Both degrade to [] when the pm_* tables are not provisioned yet.
        listPmPrograms({}),
        listPmServiceRecords({ asset_no: assetNo }),
        // Telematics utilization snapshot for this asset ([] / null when absent).
        getAssetUtilization(assetNo),
      ])

      const tyreRows = tyreRes.status === 'fulfilled' ? (tyreRes.value.data ?? []) : []
      const woRows   = woRes.status === 'fulfilled' ? (woRes.value.data ?? []) : []
      const ovRows   = ovRes.status === 'fulfilled' ? (ovRes.value.data ?? []) : []
      const inspRows = inspRes.status === 'fulfilled' ? (inspRes.value.data ?? []) : []
      const accRows  = accRes.status === 'fulfilled' ? (accRes.value.data ?? []) : []
      const odoRow   = odoRes.status === 'fulfilled' ? (odoRes.value.data ?? null) : null
      const ehRow    = ehRes.status === 'fulfilled' ? (ehRes.value.data ?? null) : null
      const pmRows   = pmRes.status === 'fulfilled' ? (pmRes.value ?? []) : []
      const pmSvcRows = pmSvcRes.status === 'fulfilled' ? (pmSvcRes.value ?? []) : []
      setAssetUtil(utilRes.status === 'fulfilled' ? (utilRes.value ?? null) : null)
      // A read that failed (rejected, or resolved with an error) is recorded so
      // its tab says "could not be read" instead of "none recorded".
      const failed = (r) => r.status === 'rejected' || !!r.value?.error
      setReadFailed({
        tyres: failed(tyreRes), workOrders: failed(woRes), inspections: failed(inspRes),
        accidents: failed(accRes), pm: pmRes.status === 'rejected', pmServices: pmSvcRes.status === 'rejected',
      })
      const ov       = ovRows.find(o => o.asset_no === assetNo) ?? null

      // Fall back to a synthesized record from the overview when vehicle_fleet
      // has no row for this asset (asset seen only through tyre/overview data).
      let record = fleetRow
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
      setWorkOrders(woRows)
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
  }, [assetNo, activeCountry, t])

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

  // Cross-country master rollup: fetch the single master row that matches this
  // asset_no (case-insensitive/trim). getAssetMaster never throws (returns []),
  // so a missing/empty result simply clears the row and hides the panel.
  useEffect(() => {
    let cancelled = false
    const key = String(assetNo ?? '').trim().toUpperCase()
    if (!key) { setMasterRow(null); return }
    getAssetMaster({ search: assetNo, limit: 5 })
      .then(rows => {
        if (cancelled) return
        const match = (Array.isArray(rows) ? rows : []).find(
          r => String(r?.asset_no ?? '').trim().toUpperCase() === key,
        )
        setMasterRow(match ?? null)
      })
      .catch(() => { if (!cancelled) setMasterRow(null) })
    return () => { cancelled = true }
  }, [assetNo, refreshKey])

  // Ownership vs cost-bearing country. Uses the RPC's indexed single-asset fast
  // path; never throws (resolves null), so a failure just hides the header.
  useEffect(() => {
    let cancelled = false
    if (!String(assetNo ?? '').trim()) { setOwnership(null); return }
    getAssetOwnershipFor(assetNo)
      .then(row => { if (!cancelled) setOwnership(row) })
      .catch(() => { if (!cancelled) setOwnership(null) })
    return () => { cancelled = true }
  }, [assetNo, refreshKey])

  // ── derived ────────────────────────────────────────────────────────────────
  // One row per country for the cross-country panel, merging the fleet rollup
  // (tyres / work orders / tyre expense, V356) with the ownership view (total
  // cost borne + who owns it, V376). Either source may be missing; a country
  // appearing in only one of them is still shown, with N/A for the other side.
  const crossCountryRows = useMemo(() => buildCrossCountryRows(masterRow, ownership, COUNTRY_CURRENCY), [masterRow, ownership])

  const activeTyres = useMemo(() => activeTyresOf(tyres), [tyres])
  // Total lifetime tyre cost: authoritative expense-grid amount for this asset
  // when available, else the tyre_records cost_per_tyre sum (honest fallback,
  // null when no tyre carries a price at all).
  const recordCost = useMemo(() => tyreRecordCost(tyres), [tyres])
  const totalCost = gridAssetCost != null ? gridAssetCost : recordCost.total
  const derivedWorstRisk = useMemo(() => overview?.worst_risk ?? worstRisk(activeTyres), [overview, activeTyres])
  // Year-to-date cost from the overview RPC; null when the RPC has no row, so
  // it reads N/A rather than a spend of zero.
  const ytdCost = overview?.ytd_cost != null && Number.isFinite(Number(overview.ytd_cost)) ? Number(overview.ytd_cost) : null
  const openWorkOrders = useMemo(() => countOpenWorkOrders(workOrders), [workOrders])
  const woSpend = useMemo(() => workOrderSpend(workOrders), [workOrders])
  // current_km is advanced by the odometer sync trigger; fall back to the latest
  // logged reading when the denormalised column is empty.
  const currentKm = useMemo(() => currentKmOf(asset, meter), [asset, meter])

  // Current engine hours for meter-based PM bands (date-only when absent).
  const currentHours = useMemo(
    () => (meter.engineHours?.engine_hours != null ? Number(meter.engineHours.engine_hours) : null),
    [meter],
  )
  // Each PM plan for this asset paired with its combined date + meter due band.
  const pmDueRows = useMemo(() => {
    const now = Date.now()
    return pmPlans.map(plan => ({ id: plan.id, plan, due: pmAssetDueStatus(plan, { now, currentKm, currentHours }) }))
  }, [pmPlans, currentKm, currentHours])
  const pmSummary = useMemo(() => pmDueSummary(pmDueRows), [pmDueRows])

  const monthly = useMemo(() => monthlyTyreCost(tyres), [tyres])
  const chartData = {
    labels: monthly.months.map(m => formatMonthYear(m.date)),
    datasets: [{
      label: t('assetmgmt.drawer.monthlyCostSeriesLabel'),
      data: monthly.months.map(m => m.cost),
      borderColor: colorAt(0),
      backgroundColor: withAlpha(colorAt(0), 0.12),
      fill: true, tension: 0.4, pointRadius: 3,
    }],
  }

  const recommendations = useMemo(
    () => tyreRecommendations(activeTyres).map(r => ({ level: r.level, msg: t(`assetmgmt.drawer.${r.key}`, { count: r.count }) })),
    [activeTyres, t],
  )


  // ── tables ────────────────────────────────────────────────────────────────
  const money = useCallback((v, cur) => (v == null ? 'N/A' : fmtCurrency(v, cur || activeCurrency)), [activeCurrency])
  const countryColumns = useMemo(() => [
    { id: 'country', header: 'Country', accessorFn: r => r.country || 'N/A', cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    {
      id: 'role', header: 'Role',
      accessorFn: r => (r.role === 'owner' ? 'Owner' : r.role === 'bears' ? `Bears cost for ${ownership?.owningCountry || ''}`.trim() : r.role === 'contested' ? 'Contested' : 'N/A'),
      cell: ({ row, getValue }) => {
        const r = row.original
        const cls = r.role === 'owner' ? 'bg-emerald-900/30 text-emerald-300' : r.role === 'bears' ? 'bg-blue-900/30 text-blue-300' : r.role === 'contested' ? 'bg-amber-900/30 text-amber-300' : null
        return cls ? <span className={`px-2 py-0.5 rounded-full text-[11px] ${cls}`}>{getValue()}</span> : <span className="text-[var(--text-muted)]">N/A</span>
      },
    },
    { id: 'tyres', header: 'Tyres', accessorFn: r => numOrUndef(r.tyres), ...NUM, cell: ({ row }) => fmtNum(row.original.tyres) },
    { id: 'workOrders', header: 'Work Orders', accessorFn: r => numOrUndef(r.workOrders), ...NUM, cell: ({ row }) => fmtNum(row.original.workOrders) },
    // Each country in its OWN currency; deliberately no total row.
    { id: 'tyreExpense', header: 'Tyre Expense', accessorFn: r => numOrUndef(r.tyreExpense), ...NUM, cell: ({ row }) => money(row.original.tyreExpense, row.original.currency || COUNTRY_CURRENCY[row.original.country]) },
    { id: 'borne', header: 'Total Cost Borne', accessorFn: r => numOrUndef(r.borne), ...NUM, cell: ({ row }) => money(row.original.borne, row.original.currency || COUNTRY_CURRENCY[row.original.country]) },
  ], [ownership, money])

  const workOrderColumns = useMemo(() => [
    { id: 'no', header: 'Work order', accessorFn: w => w.work_order_no || 'N/A', cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)] whitespace-nowrap">{getValue()}</span> },
    { id: 'type', header: 'Type', accessorFn: w => w.work_type || t('assetmgmt.drawer.workOrderFallback') },
    { id: 'opened', header: 'Opened', accessorFn: w => w.opened_at || w.created_at || undefined, sortUndefined: 'last', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.opened_at || row.original.created_at)}</span> },
    { id: 'completed', header: 'Completed', accessorFn: w => w.completed_at || undefined, sortUndefined: 'last', cell: ({ row }) => (row.original.completed_at ? fmtDate(row.original.completed_at) : 'N/A') },
    { id: 'priority', header: 'Priority', accessorFn: w => w.priority || 'N/A' },
    {
      id: 'status', header: 'Status', accessorFn: w => workOrderStatusLabel(w.status) || 'N/A',
      meta: { filterVariant: 'select' },
      cell: ({ getValue }) => { const v = getValue(); return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${WO_BADGE[v] || 'bg-yellow-900/50 text-yellow-300'}`}>{v}</span> },
    },
    { id: 'cost', header: 'Total cost', accessorFn: w => numOrUndef(w.total_cost), ...NUM, cell: ({ row }) => money(numOrUndef(row.original.total_cost) ?? null) },
  ], [t, money])

  const inspectionColumns = useMemo(() => [
    { id: 'date', header: 'Date', accessorFn: i => inspectionDateOf(i) || undefined, sortUndefined: 'last', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(inspectionDateOf(row.original))}</span> },
    { id: 'type', header: 'Type', accessorFn: i => i.inspection_type ?? i.title ?? 'N/A' },
    { id: 'inspector', header: 'Inspector', accessorFn: i => i.inspector ?? 'N/A' },
    { id: 'odometer', header: 'Odometer', accessorFn: i => numOrUndef(i.odometer_km), ...NUM, cell: ({ row }) => (row.original.odometer_km != null ? `${fmtNum(row.original.odometer_km)} km` : 'N/A') },
    { id: 'severity', header: 'Severity', accessorFn: i => i.severity ?? 'N/A', meta: { filterVariant: 'select' }, cell: ({ row }) => <span className={`font-medium ${SEV_TEXT[severityTone(row.original.severity)]}`}>{row.original.severity ?? 'N/A'}</span> },
    { id: 'status', header: 'Status', accessorFn: i => i.approval_status ?? i.status ?? 'N/A', meta: { filterVariant: 'select' } },
    { id: 'findings', header: 'Findings', accessorFn: i => i.findings ?? i.notes ?? 'N/A', cell: ({ getValue }) => <span className="block max-w-[240px] truncate" title={getValue()}>{getValue()}</span> },
  ], [])

  const pmPlanColumns = useMemo(() => [
    { id: 'name', header: 'Plan', accessorFn: r => r.plan.name ?? 'Untitled plan', cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'due', header: 'Due status', accessorFn: r => (PM_DUE_META[r.due.band] ?? PM_DUE_META.none).label, meta: { filterVariant: 'select' }, cell: ({ row, getValue }) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PM_DUE_BADGE[row.original.due.band] ?? PM_DUE_BADGE.none}`}>{getValue()}</span> },
    { id: 'nextDue', header: 'Next due date', accessorFn: r => r.plan.next_due || undefined, sortUndefined: 'last', cell: ({ row }) => (row.original.plan.next_due ? fmtDate(row.original.plan.next_due) : 'No date') },
    { id: 'days', header: 'Days to due', accessorFn: r => numOrUndef(r.due.daysToDue), ...NUM, cell: ({ row }) => (row.original.due.daysToDue != null ? `${row.original.due.daysToDue}d` : 'N/A') },
    { id: 'meterDue', header: 'Due at meter', accessorFn: r => numOrUndef(r.plan.next_due_meter), ...NUM, cell: ({ row }) => (row.original.plan.next_due_meter != null ? `${fmtNum(row.original.plan.next_due_meter)}${row.original.due.unit ? ` ${row.original.due.unit}` : ''}` : 'N/A') },
    { id: 'left', header: 'Meter left', accessorFn: r => numOrUndef(r.due.meterRemaining), ...NUM, cell: ({ row }) => (row.original.due.meterRemaining != null ? `${fmtNum(row.original.due.meterRemaining)}${row.original.due.unit ? ` ${row.original.due.unit}` : ''}` : 'N/A') },
    { id: 'priority', header: 'Priority', accessorFn: r => String(r.plan.priority ?? '').toLowerCase() || 'N/A', cell: ({ getValue }) => { const v = getValue(); return v === 'N/A' ? v : <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${PM_PRIORITY_BADGE[v] ?? PM_PRIORITY_BADGE.low}`}>{v}</span> } },
    { id: 'status', header: 'Status', accessorFn: r => String(r.plan.status ?? '').toLowerCase() || 'N/A', cell: ({ getValue }) => { const v = getValue(); return v === 'N/A' ? v : <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${PM_STATUS_BADGE[v] ?? PM_STATUS_BADGE.completed}`}>{v}</span> } },
  ], [])

  const serviceColumns = useMemo(() => [
    { id: 'date', header: 'Date', accessorFn: sv => sv.service_date || undefined, sortUndefined: 'last', cell: ({ row }) => <span className="whitespace-nowrap">{row.original.service_date ? fmtDate(row.original.service_date) : 'N/A'}</span> },
    { id: 'meter', header: 'Meter', accessorFn: sv => numOrUndef(sv.meter_reading), ...NUM, cell: ({ row }) => { const sv = row.original; const u = serviceMeterUnit(sv); return sv.meter_reading != null ? `${fmtNum(sv.meter_reading)}${u ? ` ${u}` : ''}` : 'N/A' } },
    { id: 'outcome', header: 'Outcome', accessorFn: sv => sv.outcome ?? 'N/A', meta: { filterVariant: 'select' }, cell: ({ getValue }) => { const v = String(getValue()); const lo = v.toLowerCase(); return <span className={`font-medium capitalize ${lo === 'completed' ? 'text-green-400' : lo === 'deferred' ? 'text-yellow-400' : 'text-[var(--text-secondary)]'}`}>{v}</span> } },
    { id: 'by', header: 'Performed By', accessorFn: sv => sv.performed_by ?? 'N/A' },
    { id: 'cost', header: 'Total Cost', accessorFn: sv => numOrUndef(sv.total_cost), ...NUM, cell: ({ row }) => money(numOrUndef(row.original.total_cost) ?? null) },
  ], [money])

  const accidentColumns = useMemo(() => [
    { id: 'date', header: 'Date', accessorFn: a => a.incident_date ?? a.created_at ?? undefined, sortUndefined: 'last', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.incident_date ?? row.original.created_at)}</span> },
    { id: 'type', header: 'Type', accessorFn: a => a.accident_type ?? 'N/A' },
    { id: 'severity', header: 'Severity', accessorFn: a => a.severity ?? 'N/A', meta: { filterVariant: 'select' }, cell: ({ row }) => <span className={`font-medium ${SEV_TEXT[severityTone(row.original.severity)]}`}>{row.original.severity ?? 'N/A'}</span> },
    { id: 'location', header: 'Location', accessorFn: a => a.location ?? 'N/A', cell: ({ getValue }) => <span className="block max-w-[160px] truncate" title={getValue()}>{getValue()}</span> },
    { id: 'driver', header: 'Driver', accessorFn: a => a.driver_name ?? 'N/A' },
    { id: 'status', header: 'Status', accessorFn: a => a.status ?? 'N/A', meta: { filterVariant: 'select' } },
    { id: 'claim', header: 'Claim', accessorFn: a => a.claim_status ?? 'N/A' },
    { id: 'cost', header: 'Est. Damage', accessorFn: a => accidentCostOf(a) ?? undefined, ...NUM, cell: ({ row }) => money(accidentCostOf(row.original)) },
  ], [money])
  const tableFile = (what) => reportFileName(`${assetNo} ${what}`, reportDateLabel())
  const siteOptions = useMemo(() => [asset?.site].filter(Boolean), [asset])
  const countryOptions = useMemo(() => [asset?.country].filter(Boolean), [asset])

  // ── states ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="text-[var(--text-primary)]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
          <BackButton onClick={() => navigate('/asset-management')} label={t('assetmgmt.detail.backToAssets')} />
          <LoadingState message={t('assetmgmt.detail.loading')} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-[var(--text-primary)]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
          <BackButton onClick={() => navigate('/asset-management')} label={t('assetmgmt.detail.backToAssets')} />
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
          <BackButton onClick={() => navigate('/asset-management')} label={t('assetmgmt.detail.backToAssets')} />
          <EmptyState
            icon={Truck}
            title={t('assetmgmt.detail.notFoundTitle', { assetNo })}
            description={
              // The code DOES exist, just not in the country on screen. Saying
              // "not found" there would send someone hunting for missing data,
              // and showing the other country's machine would be a wrong vehicle.
              matches.missingInCountry
                ? `${assetNo} is not registered in ${matches.requested}. This asset number exists in ${matches.countries.join(', ')}. Switch country to open that machine - an asset number is only unique within its own country, so these are different vehicles.`
                : t('assetmgmt.detail.notFoundDesc')
            }
            action={{ label: t('assetmgmt.detail.backToAssets'), onClick: () => navigate('/asset-management') }}
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
    // Every record that ever touched this machine, merged into one timeline.
    // Carries no count: the tabs above each read ONE table, this one reads
    // sixteen and only knows the total once it has loaded them.
    { id: 'history',    label: 'Full history',                        icon: History },
    { id: 'approvals',  label: t('assetmgmt.detail.tabs.approvals'),  icon: Shield },
  ]

  return (
    <div className="text-[var(--text-primary)]">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">

        <BackButton onClick={() => navigate('/asset-management')} label={t('assetmgmt.detail.backToAssets')} />

        {/* Same asset number, more than one country = more than one machine
            (V376). Name the one on screen: a silent pick reads as the wrong
            vehicle's history. */}
        {matches.rows.length > 1 && (
          <div
            className="rounded-xl border px-4 py-3 text-sm flex items-start gap-2"
            style={{ borderColor: 'var(--border-bright)', background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
          >
            <Globe className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Asset number {asset.asset_no} is registered in {matches.countries.length} countries
              ({matches.countries.join(', ')}). An asset number is only unique within its own
              country, so these are different machines.{' '}
              <strong style={{ color: 'var(--text-primary)' }}>
                Showing the {asset.country || 'unassigned country'} machine
              </strong>
              {' '}and only its own tyres, inspections, incidents and meters. Switch country to open
              the other one.
            </span>
          </div>
        )}

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
                {[asset.vehicle_type, [asset.make, asset.model, asset.year].filter(Boolean).join(' ')].filter(Boolean).join(' | ') || 'Type not recorded'}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5"><MapPin className="inline w-3 h-3 mr-1" />{asset.site ?? 'N/A'} | {asset.country ?? 'N/A'}</p>
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
          <StatTile icon={Gauge} label="Current KM" value={fmtNum(currentKm)}
            sub={meter.odometer?.reading_date ? `as of ${fmtDate(meter.odometer.reading_date)}` : null} color="blue" />
          <StatTile icon={Fuel} label="Engine Hours"
            value={fmtNum(meter.engineHours?.engine_hours)}
            sub={meter.engineHours?.reading_date ? fmtDate(meter.engineHours.reading_date) : null} color="teal" />
          {assetUtil && assetUtil.utilization_pct != null && (
            <StatTile icon={Activity} label="Utilization"
              value={`${Math.round(Number(assetUtil.utilization_pct) * 10) / 10}%`}
              sub={(() => { const ip = utilIdlePct(assetUtil); return ip != null ? `idle ${Math.round(ip * 10) / 10}%` : 'telematics' })()}
              color="teal" />
          )}
          {assetUtil && assetUtil.distance_km != null && (
            <StatTile icon={Gauge} label="Distance (period)" value={`${Number(assetUtil.distance_km).toLocaleString()} km`}
              sub={assetUtil.working_seconds != null ? `${utilHours(assetUtil.working_seconds)} h worked` : 'telematics'} color="blue" />
          )}
          <StatTile icon={Activity} label="Active Tyres" value={readFailed.tyres ? 'N/A' : activeTyres.length}
            sub={readFailed.tyres ? 'could not be read' : `${tyres.length} on record`} color="green" />
          <StatTile icon={Wrench} label="Open Work Orders" value={readFailed.workOrders ? 'N/A' : openWorkOrders}
            sub={readFailed.workOrders ? 'could not be read' : `${workOrders.length} total`} color="yellow" />
          <StatTile icon={ClipboardCheck} label="Inspections" value={readFailed.inspections ? 'N/A' : inspections.length}
            sub={readFailed.inspections ? 'could not be read' : inspections[0]?.inspection_date ? `last ${fmtDate(inspections[0].inspection_date)}` : 'none logged'} color="purple" />
          <StatTile icon={CalendarClock} label="PM Overdue" value={readFailed.pm ? 'N/A' : pmSummary.overdue}
            sub={readFailed.pm ? 'could not be read' : pmSummary.total ? `${pmSummary.dueSoon} due soon of ${pmSummary.total} plans` : 'no plans'} color={pmSummary.overdue ? 'red' : 'green'} />
          <StatTile icon={ShieldAlert} label="Incidents" value={readFailed.accidents ? 'N/A' : accidents.length}
            sub={readFailed.accidents ? 'could not be read' : accidents.length ? 'recorded' : 'none recorded'} color={accidents.length ? 'red' : 'green'} />
        </div>

        {/* This vehicle across countries — cross-country "one vehicle" rollup.
            Rendered only when a master row is found; expense is shown PER COUNTRY
            in each country's own currency (never summed across currencies). */}
        {crossCountryRows.length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" /> This vehicle across countries
            </h3>

            {/* Ownership vs cost bearing. An asset whose evidence does not name an
                owner reads "N/A" with the reason, never a guessed country. */}
            {ownership && (
              <div className="mb-4 rounded-lg border border-[var(--border-dim)] bg-[var(--surface-1)] px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)]">Owned by</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${
                    ownership.owningCountry
                      ? 'bg-emerald-900/40 text-emerald-300'
                      : 'bg-amber-900/40 text-amber-300'
                  }`}>
                    {ownership.owningCountry ? <Building2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    {ownership.owningCountryLabel || UNKNOWN_OWNER}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] border ${
                    basisMeta(ownership.basis).tone === 'warn'
                      ? 'bg-amber-900/20 text-amber-300 border-amber-700/50'
                      : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
                  }`}>{ownership.basisLabel}</span>
                  {ownership.identityConflict && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-red-900/30 text-red-300 border border-red-700/50">
                      Make or type differs by country
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-2 leading-relaxed">
                  {ownershipExplanation(ownership)}
                </p>
                {ownership.registrationCountry && !ownership.owningCountry && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
                    Registration is recorded in {ownership.registrationCountry}, but registration exists for KSA
                    assets only in this data, so it is shown as context and does not decide ownership.
                  </p>
                )}
              </div>
            )}

            {/* Country chips + identity. The panel can render from the ownership
                source alone, so masterRow may be absent; chips then come from the
                merged country rows. */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {(String(masterRow?.countries ?? '')
                .split(',')
                .map(c => c.trim())
                .filter(Boolean)
                .length
                ? String(masterRow.countries).split(',').map(c => c.trim()).filter(Boolean)
                : crossCountryRows.map(r => r.country).filter(Boolean)
              ).map(c => (
                <span key={c} className="px-2 py-1 rounded-full text-xs font-semibold bg-blue-900/40 text-blue-300 inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {c}
                </span>
              ))}
              {[masterRow?.vehicle_type, [masterRow?.make, masterRow?.model].filter(Boolean).join(' ')]
                .filter(Boolean)
                .map((v, i) => (
                  <span key={`id-${i}`} className="text-xs text-[var(--text-muted)]">{v}</span>
                ))}
            </div>

            {/* Per-country activity + expense (each in its own currency) */}
            <EnterpriseTable
              columns={countryColumns}
              data={crossCountryRows}
              getRowId={r => String(r.country)}
              enableColumnFilters={false}
              enableGlobalFilter={false}
              enableColumnVisibility={false}
              initialPageSize={25}
              exportFileName={tableFile('across countries')}
              reportMeta={{ title: `${asset.asset_no} across countries` }}
              emptyMessage="No country rollup for this asset."
            />

            {crossCountryRows.length > 1 && (
              <p className="text-[11px] text-[var(--text-muted)] mt-3 leading-relaxed">
                This asset number appears in more than one country. Each country is shown in its own currency and the
                amounts are never added together.
              </p>
            )}
          </div>
        )}

        {/* Tabs */}
        <div role="tablist" aria-label="Asset sections" className="flex flex-wrap gap-1 bg-[var(--surface-1)] rounded-xl p-1 border border-[var(--border-dim)] max-w-full">
          {TABS.map(tb => (
            <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id} onClick={() => setTab(tb.id)}
              className={`flex items-center gap-2 px-4 py-2 min-h-11 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                tab === tb.id ? 'bg-blue-600 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]'
              }`}>
              <tb.icon className="w-4 h-4" aria-hidden="true" />
              {tb.label}
            </button>
          ))}
        </div>

        {/* Tab content must switch immediately. `mode="wait"` made the next
            panel depend on an exit-animation completion event; under reduced
            motion, background tabs, and test DOMs that event is not guaranteed
            to arrive promptly, leaving the selected tab with stale content. */}
        <AnimatePresence initial={false} mode="sync">
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

              {/* Insurance: this asset's own cover and its claim history on the
                  insurer's register. Additive, no new route and no nav entry. */}
              <div className="lg:col-span-2">
                <AssetInsurancePanel asset={asset} country={activeCountry} />
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
                <div className="h-56" role="img" aria-label={`Monthly tyre spend, last 12 months: ${monthly.months.map(m => `${formatMonthYear(m.date)} ${Math.round(m.cost)}`).join(', ')}`}>
                  <Line data={chartData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  {gridAssetCost != null ? 'Monthly breakdown from tyre records; authoritative lifetime total from the expense grid. ' : ''}
                  {monthly.priced} of {monthly.months.reduce((n, m) => n + m.fitments, 0)} fitments in the last 12 months carry a price.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-blue-900/20 to-blue-800/10 rounded-xl border border-blue-800/30 p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest">{t('assetmgmt.drawer.totalLifetimeCost')}</p>
                    <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{totalCost == null ? 'N/A' : fmtCurrency(totalCost, activeCurrency)}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{t('assetmgmt.drawer.tyreRecordsTotal', { count: tyres.length })}</p>
                  </div>
                  <DollarSign className="w-10 h-10 text-blue-500 opacity-40" />
                </div>
                <div className="bg-gradient-to-br from-purple-900/20 to-purple-800/10 rounded-xl border border-purple-800/30 p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest">{t('assetmgmt.detail.ytdCost')}</p>
                    <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{ytdCost == null ? 'N/A' : fmtCurrency(ytdCost, activeCurrency)}</p>
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
                {readFailed.workOrders ? <ReadFailed what="work orders" onRetry={() => setRefreshKey(k => k + 1)} /> : (
                  <div className="p-3 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MiniStat label="Work orders" value={fmtNum(workOrders.length)} />
                      <MiniStat label="Open" value={fmtNum(openWorkOrders)} />
                      <MiniStat label="Recorded spend" value={woSpend.total == null ? 'N/A' : fmtCurrency(woSpend.total, activeCurrency)} sub={woSpend.total == null ? 'No work order carries a cost' : `${woSpend.priced} of ${workOrders.length} priced`} />
                      <MiniStat label="Last opened" value={workOrders[0] ? fmtDate(workOrders[0].opened_at || workOrders[0].created_at) : 'N/A'} />
                    </div>
                    <EnterpriseTable
                      columns={workOrderColumns}
                      data={workOrders}
                      getRowId={w => String(w.id)}
                      searchPlaceholder="Search work orders"
                      initialPageSize={25}
                      exportFileName={tableFile('work orders')}
                      reportMeta={{ title: `${asset.asset_no} work orders`, currency: activeCurrency }}
                      emptyMessage={t('assetmgmt.detail.noWorkOrders')}
                    />
                  </div>
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
                {readFailed.inspections ? <ReadFailed what="inspections" onRetry={() => setRefreshKey(k => k + 1)} /> : (
                  <div className="p-3">
                    <EnterpriseTable
                      columns={inspectionColumns}
                      data={inspections}
                      getRowId={(i) => String(i.id)}
                      searchPlaceholder="Search inspections"
                      initialPageSize={25}
                      exportFileName={tableFile('inspections')}
                      reportMeta={{ title: `${asset.asset_no} inspections` }}
                      emptyMessage="No inspections recorded for this asset."
                    />
                  </div>
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
                {readFailed.pm ? <ReadFailed what="preventive maintenance plans" onRetry={() => setRefreshKey(k => k + 1)} /> : (
                  <div className="p-3 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MiniStat label="Plans" value={fmtNum(pmSummary.total)} />
                      <MiniStat label="Overdue" value={fmtNum(pmSummary.overdue)} tone={pmSummary.overdue ? 'text-red-400' : undefined} />
                      <MiniStat label="Due soon" value={fmtNum(pmSummary.dueSoon)} tone={pmSummary.dueSoon ? 'text-yellow-400' : undefined} />
                      <MiniStat label="No due date" value={fmtNum(pmSummary.undated)} />
                    </div>
                    <EnterpriseTable
                      columns={pmPlanColumns}
                      data={pmDueRows}
                      getRowId={(r, i) => String(r.id ?? i)}
                      enableColumnFilters={false}
                      searchPlaceholder="Search plans"
                      initialPageSize={25}
                      exportFileName={tableFile('PM plans')}
                      reportMeta={{ title: `${asset.asset_no} preventive maintenance plans` }}
                      emptyMessage="No preventive maintenance plans for this asset."
                    />
                  </div>
                )}
              </div>

              {/* Service history for this asset */}
              <div className="bg-[var(--surface-2)] rounded-xl border border-[var(--border-bright)] overflow-hidden">
                <div className="p-4 border-b border-[var(--border-bright)]">
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-yellow-400" /> Service History ({pmServices.length})
                  </h3>
                </div>
                {readFailed.pmServices ? <ReadFailed what="service history" onRetry={() => setRefreshKey(k => k + 1)} /> : (
                  <div className="p-3">
                    <EnterpriseTable
                      columns={serviceColumns}
                      data={pmServices}
                      getRowId={(sv, i) => String(sv.id ?? i)}
                      searchPlaceholder="Search service history"
                      initialPageSize={25}
                      exportFileName={tableFile('PM service history')}
                      reportMeta={{ title: `${asset.asset_no} service history`, currency: activeCurrency }}
                      emptyMessage="No preventive maintenance service history for this asset."
                    />
                  </div>
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
                {readFailed.accidents ? <ReadFailed what="incidents" onRetry={() => setRefreshKey(k => k + 1)} /> : (
                  <div className="p-3">
                    <EnterpriseTable
                      columns={accidentColumns}
                      data={accidents}
                      getRowId={(a, i) => String(a.id ?? i)}
                      searchPlaceholder="Search incidents"
                      initialPageSize={25}
                      exportFileName={tableFile('incidents')}
                      reportMeta={{ title: `${asset.asset_no} incidents`, currency: activeCurrency }}
                      emptyMessage="No incidents recorded for this asset."
                    />
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Full history ──────────────────────────────────────────────────
              The country is the IDENTITY, not a filter: 239 asset codes exist
              in more than one country and each is a different machine (V376).
              `asset.country` is the country of the fleet row this page actually
              resolved, mirroring the `dataCountry` the loader above uses to read
              this machine's tyres, inspections and incidents; `matches.requested`
              is the country on screen, used only when the code has no fleet row
              at all. Passing the raw active country instead would merge two
              machines' histories. */}
          {tab === 'history' && (
            <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AssetFullHistory
                assetNo={assetNo}
                country={asset?.country || matches.requested || undefined}
              />
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
              book_value: ytdCost ?? 0,
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
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-2 min-h-11 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors mb-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
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
      <p className="text-xl font-bold text-[var(--text-primary)] leading-tight tabular-nums">{value ?? 'N/A'}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] truncate">{sub}</p>}
    </div>
  )
}

function MiniStat({ label, value, sub, tone }) {
  return (
    <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--surface-1)] px-3 py-2 min-w-0">
      <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone || 'text-[var(--text-primary)]'}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] truncate">{sub}</p>}
    </div>
  )
}

function ProfileField({ icon: Icon, label, value }) {
  const shown = value == null || value === '' ? 'Not recorded' : value
  return (
    <div>
      <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1 flex items-center gap-1.5">
        {Icon && <Icon className="w-3 h-3" />}{label}
      </p>
      <p className={`text-sm font-medium ${shown === 'Not recorded' ? 'text-[var(--text-dim)]' : 'text-[var(--text-primary)]'} break-words`}>{shown}</p>
    </div>
  )
}

function QuickLink({ icon: Icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 min-h-11 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-medium transition-colors">
      <Icon className="w-4 h-4" /> {label}
    </button>
  )
}
