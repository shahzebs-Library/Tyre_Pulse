import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFilterState } from '../hooks/useFilterState'
import { useScrollRestore } from '../hooks/useScrollRestore'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  Truck, Plus, Edit2, X, Save, Search, Filter,
  FileSpreadsheet, FileText, RefreshCw,
  ChevronDown, ChevronUp, AlertTriangle, Clock,
  DollarSign, Activity, Shield, BarChart2, TrendingUp, Eye,
  ToggleLeft, ToggleRight, MapPin,
  Award, Layers, Lock, Database, X as XIcon,
} from 'lucide-react'
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton'
import * as assetApi from '../lib/api/assetManagement'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { toUserMessage } from '../lib/safeError'
import { formatCurrencyCompact, formatDate } from '../lib/formatters'
import PageHeader from '../components/ui/PageHeader'
import { TablePagination, PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../components/ui/TablePagination'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  enrichAssets, sortAssets, typeCounts, siteRiskBreakdown, summarizeByType,
  healthMatrix, lowHealthAssets, healthBands,
} from '../lib/assetManagementAnalytics'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ──────────────────────────────────────────────────────────────────
// Rows per page comes from the shared pager (50). It is NOT a constant here:
// the reader can change it and the choice rides in the URL with the filters.

const RISK_COLOR = {
  Critical: { bg: 'bg-red-900/50',    text: 'text-red-300',    hex: '#dc2626' },
  High:     { bg: 'bg-orange-900/50', text: 'text-orange-300', hex: '#ea580c' },
  Medium:   { bg: 'bg-yellow-900/50', text: 'text-yellow-300', hex: '#ca8a04' },
  Low:      { bg: 'bg-green-900/50',  text: 'text-green-300',  hex: '#16a34a' },
}
/**
 * Operational state as the owner records it on the monthly asset sheet.
 *
 * This is NOT the register's Active/Inactive. A machine can be Active - part of
 * the current fleet - and broken down today, or Active and already earmarked
 * for scrap. Showing only one of the two hides whichever question you are
 * actually asking.
 *
 * An asset with no operational status renders a quiet dash rather than being
 * assumed to be running: never recorded and running are different claims.
 */
const OPS_STATUS = {
  running:       { label: 'Running',        bg: 'bg-green-900/40',  text: 'text-green-300' },
  breakdown:     { label: 'Breakdown',      bg: 'bg-red-900/40',    text: 'text-red-300' },
  idle:          { label: 'Idle / standby', bg: 'bg-yellow-900/40', text: 'text-yellow-300' },
  planned_scrap: { label: 'Planned scrap',  bg: 'bg-orange-900/40', text: 'text-orange-300' },
  reallocation:  { label: 'Reallocating',   bg: 'bg-blue-900/40',   text: 'text-blue-300' },
  yard:          { label: 'In yard',        bg: 'bg-slate-800/60',  text: 'text-slate-300' },
  other:         { label: 'Other',          bg: 'bg-slate-800/60',  text: 'text-slate-300' },
}

function OpsStatusBadge({ value, note }) {
  if (!value) return <span className="text-[var(--text-muted)]">Not recorded</span>
  const meta = OPS_STATUS[value] || OPS_STATUS.other
  return (
    <span
      title={note || meta.label}
      className={`inline-block px-2 py-0.5 rounded text-xs whitespace-nowrap ${meta.bg} ${meta.text}`}
    >
      {meta.label}
    </span>
  )
}

const SCORE_COLOR = (s) => {
  if (s == null) return 'bg-[var(--surface-3)]'
  if (s >= 80) return 'bg-green-500'
  if (s >= 60) return 'bg-yellow-500'
  if (s >= 40) return 'bg-orange-500'
  return 'bg-red-500'
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
const DONUT_OPTS = {
  ...CHART_OPTS,
  scales: undefined,
  plugins: {
    ...CHART_OPTS.plugins,
    legend: { position: 'right', labels: { color: 'var(--text-secondary)', font: { size: 11 }, boxWidth: 12, padding: 12 } },
  },
}

const VEHICLE_TYPES = ['Truck','Tipper','Mixer','Rigid','Semi-Trailer','Pickup','Crane','Loader','Tanker','Bus','Other']

const EMPTY_ASSET = (country = 'KSA') => ({
  asset_no: '', vehicle_type: '', make: '', model: '', year: '',
  site: '', country, active: true,
})

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n, dec = 0) {
  if (n == null || n === '' || isNaN(n)) return 'N/A'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
// Shared formatters; currency is always supplied from activeCurrency at call sites.
const fmtCurrency = (n, cur) => formatCurrencyCompact(n, cur)
const fmtDate = (d) => formatDate(d)


// ── Add/Edit Asset Modal ────────────────────────────────────────────────────────
function AssetModal({ asset, sites, countries, onSave, onClose, locked = false }) {
  const { t } = useLanguage()
  const [form, setForm] = useState(asset ?? EMPTY_ASSET())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isEdit = !!asset?.id || !!asset?.asset_no

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    // Block saving an edit to a record whose disposal approval is active/locked.
    if (isEdit && locked) return
    if (!form.asset_no?.trim()) { setError(t('assetmgmt.modal.errRequired')); return }
    setSaving(true)
    setError('')
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
      const { error: supaErr } = isEdit
        ? await assetApi.updateAsset(asset.id, payload)
        : await assetApi.insertAsset(payload)

      // Never mask a failed save behind a localStorage write that reports
      // success - the record would exist only in this browser, invisible to
      // everyone else and lost on cache clear. Surface the real error instead.
      if (supaErr) {
        const dup = /duplicate key|unique constraint/i.test(supaErr.message || '')
        setError(dup ? t('assetmgmt.modal.errDuplicate') : toUserMessage(supaErr, t('assetmgmt.modal.errSaveFailed')))
        setSaving(false)
        return
      }
      onSave()
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
            <Truck className="w-5 h-5 text-blue-400" />
            {isEdit ? t('assetmgmt.modal.editTitle') : t('assetmgmt.modal.addTitle')}
          </h2>
          <button onClick={onClose} aria-label="Close" className="p-2.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="am-m-asset" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.assetNo')}</label>
              <input id="am-m-asset"
                value={form.asset_no}
                onChange={e => set('asset_no', e.target.value.toUpperCase())}
                placeholder={t('assetmgmt.modal.placeholders.assetNo')}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="am-m-type" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.vehicleType')}</label>
              <select id="am-m-type"
                value={form.vehicle_type}
                onChange={e => set('vehicle_type', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
              >
                <option value="">{t('assetmgmt.modal.selectType')}</option>
                {VEHICLE_TYPES.map(vt => <option key={vt}>{vt}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="am-m-make" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.make')}</label>
              <input id="am-m-make" value={form.make} onChange={e => set('make', e.target.value)} placeholder={t('assetmgmt.modal.placeholders.make')}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label htmlFor="am-m-model" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.model')}</label>
              <input id="am-m-model" value={form.model} onChange={e => set('model', e.target.value)} placeholder={t('assetmgmt.modal.placeholders.model')}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label htmlFor="am-m-year" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.year')}</label>
              <input id="am-m-year" type="number" min="1990" max="2030" value={form.year} onChange={e => set('year', e.target.value)} placeholder={t('assetmgmt.modal.placeholders.year')}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label htmlFor="am-m-site" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.site')}</label>
              <input id="am-m-site" value={form.site} onChange={e => set('site', e.target.value)} placeholder={t('assetmgmt.modal.placeholders.site')}
                list="am-sites-list"
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-blue-500" />
              <datalist id="am-sites-list">{sites.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label htmlFor="am-m-country" className="text-xs text-[var(--text-secondary)] mb-1 block">{t('assetmgmt.modal.country')}</label>
              <select id="am-m-country" value={form.country} onChange={e => set('country', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                <option value="">{t('assetmgmt.modal.select')}</option>
                {(countries.length ? countries : ['KSA','UAE','Egypt']).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <label className="text-xs text-[var(--text-secondary)]">{t('assetmgmt.modal.activeStatus')}</label>
              <button type="button" role="switch" aria-checked={!!form.active} onClick={() => set('active', !form.active)} className="flex items-center gap-2 min-h-[44px]">
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
          <button onClick={handleSave} disabled={saving || (isEdit && locked)}
            title={isEdit && locked ? 'Locked: in approval' : undefined}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
            {isEdit && locked ? <Lock className="w-4 h-4" /> : saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? t('assetmgmt.modal.saving') : t('assetmgmt.modal.save')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
// A plain token card so light and dark read the same; the icon carries the
// accent and the label carries the meaning (colour is never the only signal).
const KPI_ICON = {
  blue: 'text-blue-400', red: 'text-red-400', green: 'text-green-400',
  yellow: 'text-yellow-400', purple: 'text-purple-400',
}
function KpiCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">{label}</span>
        <Icon className={`w-5 h-5 shrink-0 ${KPI_ICON[color] || KPI_ICON.blue}`} aria-hidden="true" />
      </div>
      <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight tabular-nums">{value ?? 'N/A'}</p>
      {sub && <p className="text-xs text-[var(--text-muted)]">{sub}</p>}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AssetManagement() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { activeCurrency, activeCountry } = useSettings()
  const { t } = useLanguage()
  const isAdmin = profile?.role === 'Admin'

  // ── data state ───────────────────────────────────────────────────────────────
  const [assets, setAssets] = useState([])
  const [overview, setOverview] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  // Export failures get their own line: they must not replace the loaded
  // register with an error state as if the READ had failed.
  const [exportError, setExportError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  // ── filter state ─────────────────────────────────────────────────────────────
  // Search, filters, sort and page live in the URL (useFilterState) so they
  // SURVIVE opening an asset and pressing Back: a row opens `/asset-management/:assetNo`
  // as a route, so without this the registry would remount unfiltered on page 1.
  // NOTE: `country` here is the page's own column filter over the loaded rows,
  // NOT the working-context country - that stays in the settings context.
  const [filters, setFilter, , , setFilters] = useFilterState({
    search: '', site: '', country: '', type: '', status: '', risk: '', ops: '',
    sort: 'asset_no', dir: 'asc', page: '1', size: String(DEFAULT_PAGE_SIZE),
  })
  const search = filters.search
  const filterSite = filters.site
  const filterCountry = filters.country
  const filterType = filters.type
  const filterStatus = filters.status
  const filterRisk = filters.risk
  // Operational state from the owner's monthly asset sheet. Kept SEPARATE from
  // the register's Active/Inactive: a machine can be on the current fleet and
  // broken down today, and merging the two would hide exactly that.
  const filterOps = filters.ops
  // Opens on arrival when the restored URL already carries an advanced filter -
  // a filter that is applied but hidden reads as a wrong result, not a filter.
  const [showFilters, setShowFilters] = useState(
    () => !!(filters.site || filters.country || filters.type || filters.status || filters.risk || filters.ops),
  )

  // ── sort state ───────────────────────────────────────────────────────────────
  const sortCol = filters.sort
  const sortDir = filters.dir === 'desc' ? 'desc' : 'asc'

  // ── pagination ───────────────────────────────────────────────────────────────
  // The URL carries a human-readable 1-based page; the list is 0-based.
  // Page AND size ride in the URL for the same reason the filters do: a row
  // opens `/asset-management/:assetNo` as a route, so local state would be lost on Back.
  // That rules out `usePagedRows`, which owns its page in component state - the
  // shared BAR is still what renders, so there is no second pager UI, and the
  // arithmetic below is the same shape FleetMaster already uses for its own
  // URL-borne pager.
  const rawPage = Math.max(0, (Number(filters.page) || 1) - 1)
  const setPage = useCallback(p => setFilter('page', String((Number(p) || 0) + 1)), [setFilter])
  // Clamped to the sizes the bar itself offers: a hand-typed `?size=100000`
  // must not become the page size.
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(filters.size))
    ? Number(filters.size)
    : DEFAULT_PAGE_SIZE
  const setPageSize = useCallback(n => setFilters({ size: String(n), page: '1' }), [setFilters])

  // ── UI state ─────────────────────────────────────────────────────────────────
  // Full asset detail (profile, tyres, costs, work orders, disposal approval) now
  // lives on the dedicated /asset-management/:assetNo page — the registry navigates there.
  const [editAsset, setEditAsset] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [activeTab, setActiveTab] = useState('registry') // registry | charts | health

  const openAsset = useCallback(
    (assetNo) => navigate(`/asset-management/${encodeURIComponent(assetNo)}`),
    [navigate],
  )
  // Puts the registry back where it was scrolled to on return from an asset.
  const listRef = useScrollRestore('asset-management', !loading && assets.length > 0)

  // ── load data ─────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [assetsRes, ovRes] = await Promise.allSettled([
        assetApi.listFleetMaster(),
        assetApi.reportAssetOverview({ country: activeCountry }),
      ])

      // Surface a hard load failure (offline / RLS-denied) rather than showing an
      // empty fleet that looks identical to "no assets".
      const assetErr = assetsRes.status === 'rejected'
        ? assetsRes.reason
        : assetsRes.value.error
      if (assetErr) throw new Error(assetErr.message || String(assetErr))

      let rawAssets = assetsRes.status === 'fulfilled' ? (assetsRes.value.data ?? []) : []
      const ov     = ovRes.status === 'fulfilled' ? (ovRes.value.data ?? []) : []

      // If fleet_master is empty, synthesize from the per-asset overview
      if (rawAssets.length === 0 && ov.length > 0) {
        rawAssets = ov.map(o => ({
          id: null, asset_no: o.asset_no, vehicle_type: null,
          make: null, model: null, year: null,
          site: o.site, country: o.country, active: true,
        }))
      }

      // Apply country filter
      const filtered = activeCountry === 'All'
        ? rawAssets
        : rawAssets.filter(a => a.country === activeCountry)

      setAssets(filtered)
      setOverview(ov)
    } catch (e) {
      setLoadError(toUserMessage(e, t('assetmgmt.registry.loadErrorFallback')))
      setAssets([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry, t])

  useEffect(() => {
    loadAll()
  }, [loadAll, refreshKey])

  // ── derived data ──────────────────────────────────────────────────────────────
  // Enrichment lives in assetManagementAnalytics: an asset with no tyre
  // overview carries a NULL health score, never a zero that ranks it worst.
  const enrichedAssets = useMemo(() => enrichAssets(assets, overview), [assets, overview])

  // ── filter + sort ─────────────────────────────────────────────────────────────

  /**
   * THE ONE register filter rule, with a hold-out list.
   *
   * Every surface on this page narrows with the register filters, but a surface
   * that BREAKS DOWN a dimension has to hold that dimension out or it stops
   * saying anything: filter to Critical risk and a "Fleet at risk" tile computed
   * over the filtered rows just restates the row count, and an assets-by-type
   * doughnut computed the same way collapses to a single slice. So each caller
   * names the dimensions it reports on and those are skipped for it alone.
   */
  const applyAssetFilters = useCallback((list, skip = {}) => {
    let out = list
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(a =>
        (a.asset_no ?? '').toLowerCase().includes(q) ||
        (a.fleet_number ?? '').toLowerCase().includes(q) ||
        (a.make ?? '').toLowerCase().includes(q) ||
        (a.model ?? '').toLowerCase().includes(q) ||
        (a.operator_name ?? '').toLowerCase().includes(q) ||
        (a.registration_no ?? '').toLowerCase().includes(q)
      )
    }
    if (!skip.site && filterSite) out = out.filter(a => a.site === filterSite)
    if (!skip.country && filterCountry) out = out.filter(a => a.country === filterCountry)
    if (!skip.type && filterType) out = out.filter(a => a.vehicle_type === filterType)
    if (!skip.status && filterStatus === 'active') out = out.filter(a => a.active)
    if (!skip.status && filterStatus === 'inactive') out = out.filter(a => !a.active)
    if (!skip.ops && filterOps) out = out.filter(a => (a.ops_status ?? '') === filterOps)
    if (!skip.risk && filterRisk) out = out.filter(a => a._worstRisk === filterRisk)
    return out
  }, [search, filterSite, filterCountry, filterType, filterStatus, filterOps, filterRisk])

  // Is the register showing a NARROWED set? Drives the caption under the tiles.
  const scopeActive = !!(search || filterSite || filterCountry || filterType || filterStatus || filterOps || filterRisk)

  // Sorted by the engine (consoleTable semantics): blanks last in either
  // direction, numbers as numbers, risk by severity.
  const filteredAssets = useMemo(
    () => sortAssets(applyAssetFilters(enrichedAssets), sortCol, sortDir),
    [enrichedAssets, applyAssetFilters, sortCol, sortDir],
  )

  // ── KPIs ──────────────────────────────────────────────────────────────────────
  /**
   * WHAT THE FIVE TILES COUNT: the assets the register's own filters leave, minus
   * the two dimensions the tiles themselves break down (active/inactive status and
   * worst risk). Before this every tile was computed over `enrichedAssets`, so
   * filtering the register to one site left "Fleet at risk" and "Avg asset cost
   * YTD" stating whole-register numbers directly above a caption reading
   * "18 assets (filtered from 1,617)".
   */
  const kpiAssets = useMemo(
    () => applyAssetFilters(enrichedAssets, { status: true, risk: true }),
    [enrichedAssets, applyAssetFilters],
  )
  const kpis = useMemo(() => {
    const totalActive = kpiAssets.filter(a => a.active !== false).length
    const totalInactive = kpiAssets.filter(a => a.active === false).length
    const atRisk = kpiAssets.filter(a => a._worstRisk === 'Critical' || a._worstRisk === 'High').length
    const totalYtdCost = kpiAssets.reduce((s, a) => s + (a._ytdCost || 0), 0)
    // No active vehicle means the average is unmeasurable, not zero.
    const avgCost = totalActive > 0 ? totalYtdCost / totalActive : null
    const needsAttention = kpiAssets.filter(a => a.active !== false && a._noRecentRecord).length
    const withTyreData = kpiAssets.filter(a => a._hasTyreData).length
    const coverage = kpiAssets.length > 0 ? withTyreData / kpiAssets.length : null
    return { totalActive, totalInactive, atRisk, avgCost, needsAttention, withTyreData, coverage, covered: kpiAssets.length }
  }, [kpiAssets])

  // ── Filter options ─────────────────────────────────────────────────────────────
  const siteOptions = useMemo(() => [...new Set(assets.map(a => a.site).filter(Boolean))].sort(), [assets])
  const countryOptions = useMemo(() => [...new Set(assets.map(a => a.country).filter(Boolean))].sort(), [assets])
  const typeOptions = useMemo(() => [...new Set(assets.map(a => a.vehicle_type).filter(Boolean))].sort(), [assets])
  const opsOptions = useMemo(() => [...new Set(assets.map(a => a.ops_status).filter(Boolean))].sort(), [assets])

  // ── Chart data ────────────────────────────────────────────────────────────────
  // Holds out the TYPE filter - see applyAssetFilters.
  const typeChartAssets = useMemo(
    () => applyAssetFilters(enrichedAssets, { type: true }),
    [enrichedAssets, applyAssetFilters],
  )
  const typeChartData = useMemo(() => {
    const counts = typeCounts(typeChartAssets)
    return {
      labels: counts.map(c => c.label),
      datasets: [{
        data: counts.map(c => c.count),
        backgroundColor: counts.map((_, i) => withAlpha(colorAt(i), 0.8)),
        borderColor: counts.map((_, i) => colorAt(i)),
        borderWidth: 2,
      }],
    }
  }, [typeChartAssets])
  const typeSummary = useMemo(() => summarizeByType(typeChartAssets), [typeChartAssets])

  // Holds out the SITE and RISK filters - it is a breakdown of both.
  const siteRiskAssets = useMemo(
    () => applyAssetFilters(enrichedAssets, { site: true, risk: true }),
    [enrichedAssets, applyAssetFilters],
  )
  // Risk colours are semantic (they carry meaning), so they stay fixed.
  const siteRiskChartData = useMemo(() => {
    const { sites, series } = siteRiskBreakdown(siteRiskAssets)
    return {
      labels: sites,
      datasets: ['Low', 'Medium', 'High', 'Critical'].map(level => ({
        label: level, data: series[level], backgroundColor: withAlpha(RISK_COLOR[level].hex, 0.8), borderRadius: 4,
      })),
    }
  }, [siteRiskAssets])

  const matrixAssets = useMemo(() => healthMatrix(enrichedAssets), [enrichedAssets])
  const lowHealth = useMemo(() => lowHealthAssets(enrichedAssets), [enrichedAssets])
  const bands = useMemo(() => healthBands(enrichedAssets), [enrichedAssets])

  // ── Sort helper ───────────────────────────────────────────────────────────────
  function toggleSort(col) {
    const dir = sortCol === col && sortDir === 'asc' ? 'desc' : 'asc'
    setFilters({ sort: col, dir, page: '1' })
  }
  // The register's sort rides in the URL (it survives opening an asset and
  // pressing Back) and covers the WHOLE filtered set, so the header buttons
  // drive that URL sort rather than EnterpriseTable's page-local sort.
  function renderSortHeader(col, label) {
    const active = sortCol === col
    const dirLabel = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'not sorted'
    return (
      <button
        type="button"
        onClick={() => toggleSort(col)}
        aria-label={`${label}, ${dirLabel}. Sort by ${label}`}
        className="inline-flex items-center gap-1 min-h-[32px] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
      >
        {label}
        {!active
          ? <ChevronDown className="w-3 h-3 text-[var(--text-dim)]" aria-hidden="true" />
          : sortDir === 'asc'
            ? <ChevronUp className="w-3 h-3 text-blue-400" aria-hidden="true" />
            : <ChevronDown className="w-3 h-3 text-blue-400" aria-hidden="true" />}
      </button>
    )
  }

  // ── Pagination ────────────────────────────────────────────────────────────────
  // Only the TABLE is paged. `filteredAssets` stays the full filtered set and
  // remains what the exports write and what the row-count caption quotes - a
  // page is a reading convenience, not a narrowing of what the reader asked for.
  // The tiles read `kpiAssets` (see above) and are untouched by paging.
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / pageSize))
  // Clamp, so a restored `?page=40` that no longer exists after a filter renders
  // the last real page instead of an empty table - which reads as "no matches".
  const page = Math.min(rawPage, totalPages - 1)
  const pageAssets = filteredAssets.slice(page * pageSize, (page + 1) * pageSize)

  // Register columns. EnterpriseTable renders the PAGE; sorting is the URL
  // sort above (SortHeader), which orders the whole filtered set first.
  const sortable = (col, label) => ({ id: col, header: () => renderSortHeader(col, label) })
  const registerColumns = [
    { ...sortable('asset_no', 'Asset No'), accessorKey: 'asset_no', meta: { exportHeader: 'Asset No' }, cell: ({ getValue }) => <span className="font-mono font-semibold text-blue-400">{getValue()}</span> },
    { ...sortable('vehicle_type', 'Type'), accessorFn: a => a.vehicle_type, cell: ({ getValue }) => getValue() || 'N/A' },
    { ...sortable('ops_status', 'Operational'), accessorFn: a => a.ops_status, cell: ({ row }) => <OpsStatusBadge value={row.original.ops_status} note={row.original.ops_status_note} /> },
    { ...sortable('make', 'Make / Model'), accessorFn: a => [a.make, a.model].filter(Boolean).join(' '), cell: ({ getValue }) => <span className="block max-w-[160px] truncate" title={getValue() || ''}>{getValue() || 'N/A'}</span> },
    { ...sortable('year', 'Year'), accessorFn: a => a.year, cell: ({ getValue }) => getValue() ?? 'N/A' },
    { ...sortable('site', 'Site'), accessorFn: a => a.site, cell: ({ getValue }) => <span className="block max-w-[140px] truncate" title={getValue() || ''}>{getValue() || 'N/A'}</span> },
    { ...sortable('current_km', 'Current KM'), accessorFn: a => a.current_km, meta: { align: 'right' }, cell: ({ getValue }) => (getValue() != null && getValue() !== '' ? `${fmt(getValue())} km` : 'N/A') },
    {
      id: 'tyres', header: 'Active Tyres', accessorFn: a => a._activeCount, meta: { align: 'center' },
      cell: ({ row }) => {
        const a = row.original
        if (!a._hasTyreData) return <span className="text-[var(--text-muted)]">N/A</span>
        return <span><span className="font-semibold text-[var(--text-primary)]">{a._activeCount}</span>{a._totalCount > a._activeCount && <span className="text-[var(--text-dim)] text-xs ml-1">/{a._totalCount}</span>}</span>
      },
    },
    {
      ...sortable('_worstRisk', 'Worst Risk'), accessorFn: a => a._worstRisk,
      cell: ({ getValue }) => {
        const rc = RISK_COLOR[getValue()]
        return rc ? <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${rc.bg} ${rc.text}`}>{getValue()}</span> : <span className="text-[var(--text-muted)]">N/A</span>
      },
    },
    { ...sortable('_ytdCost', 'YTD Cost'), accessorFn: a => a._ytdCost, meta: { align: 'right' }, cell: ({ row }) => (row.original._hasTyreData ? fmtCurrency(row.original._ytdCost, activeCurrency) : 'N/A') },
    {
      ...sortable('_latestDate', 'Last Service'), accessorFn: a => a._latestDate,
      cell: ({ row }) => {
        const a = row.original
        if (!a._latestDate) return <span className="text-[var(--text-muted)]">N/A</span>
        return <span className={a._noRecentRecord ? 'text-orange-400' : ''} title={a._noRecentRecord ? 'No record in over 60 days' : undefined}>{fmtDate(a._latestDate)}{a._noRecentRecord ? ' (stale)' : ''}</span>
      },
    },
    {
      ...sortable('active', 'Status'), accessorFn: a => (a.active ? 'Active' : 'Inactive'),
      cell: ({ row }) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${row.original.active ? 'bg-green-900/50 text-green-400' : 'bg-[var(--surface-2)] text-[var(--text-muted)]'}`}>{row.original.active ? 'Active' : 'Inactive'}</span>,
    },
    {
      id: 'actions', header: 'Actions', meta: { export: false },
      cell: ({ row }) => {
        const a = row.original
        return (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <button onClick={() => openAsset(a.asset_no)} aria-label={`View asset ${a.asset_no}`}
              className="p-2.5 rounded-lg hover:bg-[var(--surface-3)] text-[var(--text-secondary)] hover:text-blue-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" title={t('assetmgmt.registry.viewDetail')}>
              <Eye className="w-4 h-4" aria-hidden="true" />
            </button>
            {isAdmin && (
              <button onClick={() => setEditAsset(a)} aria-label={`Edit asset ${a.asset_no}`}
                className="p-2.5 rounded-lg hover:bg-[var(--surface-3)] text-[var(--text-secondary)] hover:text-yellow-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                title={t('assetmgmt.registry.editAsset')}>
                <Edit2 className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )
      },
    },
  ]

  const typeColumns = [
    { accessorKey: 'type', header: 'Vehicle Type', cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { accessorKey: 'count', header: 'Count', meta: { align: 'right' } },
    { accessorKey: 'active', header: 'Active', meta: { align: 'right' } },
    { accessorKey: 'atRisk', header: 'At Risk', meta: { align: 'right' }, cell: ({ getValue }) => <span className={getValue() > 0 ? 'text-red-400 font-semibold' : ''}>{getValue()}</span> },
    { id: 'avgCost', accessorFn: r => r.avgCost ?? undefined, sortUndefined: 'last', header: 'Avg YTD Cost', meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? 'N/A' : fmtCurrency(getValue(), activeCurrency)) },
    {
      id: 'avgHealth', accessorFn: r => r.avgHealth ?? undefined, sortUndefined: 'last', header: 'Health Avg',
      cell: ({ row }) => {
        const r = row.original
        if (r.avgHealth == null) return <span className="text-[var(--text-muted)]">No data</span>
        return (
          <div className="flex items-center gap-2" title={`Average of ${r.scored} scored asset${r.scored === 1 ? '' : 's'}`}>
            <div className="flex-1 bg-[var(--surface-2)] rounded-full h-1.5 max-w-20">
              <div className={`h-1.5 rounded-full ${SCORE_COLOR(r.avgHealth)}`} style={{ width: `${r.avgHealth}%` }} />
            </div>
            <span className="text-[var(--text-secondary)] text-xs tabular-nums">{Math.round(r.avgHealth)}</span>
          </div>
        )
      },
    },
  ]
  const hasAdvancedFilter = !!(filterSite || filterCountry || filterType || filterStatus || filterRisk || filterOps)
  const clearFilters = () => setFilters({ search: '', site: '', country: '', type: '', status: '', risk: '', ops: '', page: '1' })

  // ── Export ────────────────────────────────────────────────────────────────────
  async function handleExcelExport() {
    setExportError('')
    const { exportToExcel, reportFileName } = await loadExportUtils()
    const rows = filteredAssets.map(a => ({
      asset_no: a.asset_no,
      fleet_number: a.fleet_number ?? '',
      vehicle_type: a.vehicle_type ?? '',
      make: a.make ?? '',
      model: a.model ?? '',
      year: a.year ?? '',
      site: a.site ?? '',
      country: a.country ?? '',
      current_km: a.current_km ?? '',
      operator_name: a.operator_name ?? '',
      active: a.active ? 'Active' : 'Inactive',
      active_tyres: a._activeCount,
      worst_risk: a._worstRisk ?? '',
      ytd_cost: a._hasTyreData ? a._ytdCost : '',
      last_service: a._latestDate ? fmtDate(a._latestDate) : 'N/A',
      health_score: a._healthScore == null ? 'N/A' : a._healthScore,
    }))
    try {
      await exportToExcel(
        rows,
        ['asset_no','fleet_number','vehicle_type','make','model','year','site','country','current_km','operator_name','active','active_tyres','worst_risk','ytd_cost','last_service','health_score'],
        ['Asset No','Fleet No','Type','Make','Model','Year','Site','Country','Current KM','Operator','Status','Active Tyres','Worst Risk','YTD Cost','Last Service','Health Score'],
        reportFileName('Asset Register'),
        'Assets'
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  async function handlePdfExport() {
    setExportError('')
    const { exportToPdf, reportFileName } = await loadExportUtils()
    try {
      await exportToPdf(
        filteredAssets.map(a => ({
        asset_no: a.asset_no,
        vehicle_type: a.vehicle_type ?? 'N/A',
        make: `${a.make ?? ''} ${a.model ?? ''}`.trim() || 'N/A',
        year: a.year ?? 'N/A',
        site: a.site ?? 'N/A',
        active_tyres: a._activeCount,
        worst_risk: a._worstRisk ?? 'N/A',
        ytd_cost: a._hasTyreData ? fmtCurrency(a._ytdCost, activeCurrency) : 'N/A',
        last_service: a._latestDate ? fmtDate(a._latestDate) : 'N/A',
        health_score: a._healthScore == null ? 'N/A' : `${a._healthScore}/100`,
      })),
      [
        { key: 'asset_no', header: 'Asset No', width: 22 },
        { key: 'vehicle_type', header: 'Type', width: 22 },
        { key: 'make', header: 'Make / Model', width: 34 },
        { key: 'year', header: 'Year', width: 14 },
        { key: 'site', header: 'Site', width: 28 },
        { key: 'active_tyres', header: 'Tyres', width: 14 },
        { key: 'worst_risk', header: 'Risk', width: 18 },
        { key: 'ytd_cost', header: 'YTD Cost', width: 24 },
        { key: 'last_service', header: 'Last Service', width: 26 },
        { key: 'health_score', header: 'Health', width: 18 },
      ],
      'Asset Management Register',
      reportFileName('Asset Register')
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="text-[var(--text-primary)] space-y-6">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Page Header */}
        <PageHeader
          title={t('assetmgmt.title')}
          subtitle={t('assetmgmt.subtitle')}
          icon={Truck}
          actions={<>
            <button onClick={() => setRefreshKey(k => k + 1)} aria-label="Refresh assets" disabled={loading}
              className="p-3 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border-bright)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
            <button onClick={handleExcelExport} disabled={loading || !!loadError || filteredAssets.length === 0}
              className="flex items-center gap-2 px-3 min-h-[44px] rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] text-sm transition-colors border border-[var(--border-bright)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <FileSpreadsheet className="w-4 h-4 text-green-500" aria-hidden="true" /> {t('assetmgmt.actions.excel')}
            </button>
            <button onClick={handlePdfExport} disabled={loading || !!loadError || filteredAssets.length === 0}
              className="flex items-center gap-2 px-3 min-h-[44px] rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] text-sm transition-colors border border-[var(--border-bright)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <FileText className="w-4 h-4 text-red-500" aria-hidden="true" /> {t('assetmgmt.actions.pdf')}
            </button>
            {isAdmin && (
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 px-4 min-h-[44px] rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                <Plus className="w-4 h-4" /> {t('assetmgmt.actions.addAsset')}
              </button>
            )}
          </>}
        />

        {/* KPI Cards.

            EVERY figure here is computed over `kpiAssets`: the same assets the
            register below is showing, minus the status and risk dimensions the
            tiles themselves break down. The caption states that in words, because
            a scoped number sitting beside an unscoped one is unreadable either
            way round. */}
        {exportError && (
          <div className="card border border-red-800/50 flex items-center gap-3" role="alert">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
            <p className="text-sm text-red-400 flex-1">{exportError}</p>
            <button onClick={() => setExportError('')} aria-label="Dismiss export error" className="p-2.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"><XIcon className="w-4 h-4" aria-hidden="true" /></button>
          </div>
        )}
        {(() => {
          // A failed read is not a measurement: every tile reads N/A.
          const na = loading ? '...' : loadError ? 'N/A' : null
          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
              <KpiCard icon={Truck} label={t('assetmgmt.kpis.totalActiveAssets')} value={na ?? fmt(kpis.totalActive)} sub={t('assetmgmt.kpis.inactiveSub', { count: fmt(kpis.totalInactive) })} color="blue" />
              <KpiCard icon={AlertTriangle} label={t('assetmgmt.kpis.fleetAtRisk')} value={na ?? fmt(kpis.atRisk)} sub={t('assetmgmt.kpis.criticalOrHighRisk')} color="red" />
              <KpiCard icon={DollarSign} label={t('assetmgmt.kpis.avgAssetCostYtd')} value={na ?? (kpis.avgCost == null ? 'N/A' : fmtCurrency(kpis.avgCost, activeCurrency))} sub={t('assetmgmt.kpis.perActiveVehicle')} color="purple" />
              <KpiCard icon={Clock} label={t('assetmgmt.kpis.needsAttention')} value={na ?? fmt(kpis.needsAttention)} sub={t('assetmgmt.kpis.noRecordOver60d')} color="yellow" />
              <KpiCard icon={Activity} label={t('assetmgmt.kpis.activeInactive')} value={na ?? `${fmt(kpis.totalActive)} / ${fmt(kpis.totalInactive)}`} sub={t('assetmgmt.kpis.totalFleet', { count: kpis.covered })} color="green" />
              <KpiCard icon={Database} label="Tyre data coverage" value={na ?? (kpis.coverage == null ? 'N/A' : `${Math.round(kpis.coverage * 100)}%`)} sub={`${fmt(kpis.withTyreData)} of ${fmt(kpis.covered)} assets have tyre records`} color="blue" />
            </div>
          )
        })()}
        {scopeActive && !loading && (
          <p className="text-xs text-[var(--text-muted)] -mt-2">
            These figures cover the {kpis.covered} asset{kpis.covered === 1 ? '' : 's'} matching your filters, of {enrichedAssets.length} in the register.
          </p>
        )}

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-1 bg-[var(--surface-1)] rounded-xl p-1 border border-[var(--border-dim)] w-fit max-w-full" role="tablist" aria-label="Asset views">
          {[
            { id: 'registry', label: t('assetmgmt.tabs.registry'), icon: Layers },
            { id: 'charts', label: t('assetmgmt.tabs.charts'), icon: BarChart2 },
            { id: 'health', label: t('assetmgmt.tabs.health'), icon: Shield },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} role="tab" aria-selected={activeTab === tab.id}
              className={`flex items-center gap-2 px-4 min-h-[44px] rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]'
              }`}>
              <tab.icon className="w-4 h-4" aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Asset Registry Tab ─────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {activeTab === 'registry' && (
            <motion.div key="registry" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">

              {/* Search & Filters */}
              <div className="card">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
                    <input
                      type="search"
                      aria-label="Search assets"
                      value={search}
                      onChange={e => setFilters({ search: e.target.value, page: '1' })}
                      placeholder="Search by asset no, fleet no, make, model, operator, reg..."
                      className="w-full min-h-[44px] bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg pl-10 pr-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button onClick={() => setShowFilters(v => !v)} aria-expanded={showFilters} aria-controls="am-filters"
                    className={`flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-lg border text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${showFilters ? 'bg-blue-900/40 border-blue-700 text-blue-400' : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                    <Filter className="w-4 h-4" aria-hidden="true" />
                    Filters
                    {hasAdvancedFilter && <span className="text-xs">(on)</span>}
                  </button>
                  {(hasAdvancedFilter || search) && (
                    <button onClick={clearFilters}
                      className="flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-lg border border-[var(--border-bright)] bg-[var(--surface-2)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                      <XIcon className="w-4 h-4" aria-hidden="true" /> Clear
                    </button>
                  )}
                </div>

                <AnimatePresence>
                  {showFilters && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden" id="am-filters">
                      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4 pt-4 border-t border-[var(--border-dim)]">
                        {[
                          { label: 'Site', value: filterSite, key: 'site', opts: siteOptions },
                          { label: 'Country', value: filterCountry, key: 'country', opts: countryOptions },
                          { label: 'Vehicle Type', value: filterType, key: 'type', opts: typeOptions },
                          { label: 'Operational status', value: filterOps, key: 'ops', opts: opsOptions },
                        ].map(f => (
                          <div key={f.label}>
                            <label htmlFor={`am-f-${f.key}`} className="text-xs text-[var(--text-muted)] mb-1 block">{f.label}</label>
                            <select id={`am-f-${f.key}`} value={f.value} onChange={e => setFilters({ [f.key]: e.target.value, page: '1' })}
                              className="w-full min-h-[44px] bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                              <option value="">All</option>
                              {f.opts.map(o => <option key={o} value={o}>{f.key === 'ops' ? (OPS_STATUS[o]?.label || o) : o}</option>)}
                            </select>
                          </div>
                        ))}
                        <div>
                          <label htmlFor="am-f-status" className="text-xs text-[var(--text-muted)] mb-1 block">Status</label>
                          <select id="am-f-status" value={filterStatus} onChange={e => setFilters({ status: e.target.value, page: '1' })}
                            className="w-full min-h-[44px] bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                            <option value="">All</option>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="am-f-risk" className="text-xs text-[var(--text-muted)] mb-1 block">Risk Level</label>
                          <select id="am-f-risk" value={filterRisk} onChange={e => setFilters({ risk: e.target.value, page: '1' })}
                            className="w-full min-h-[44px] bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                            <option value="">All</option>
                            {['Critical','High','Medium','Low'].map(r => <option key={r}>{r}</option>)}
                          </select>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Table. The wrapper anchors the scroll-restore hook, so
                  returning from /asset-management/:assetNo lands on the same row. */}
              <div ref={listRef} className="bg-[var(--surface-1)] rounded-xl border border-[var(--border-dim)] overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--border-dim)] flex items-center justify-between" aria-live="polite">
                  <span className="text-sm text-[var(--text-secondary)]">
                    {filteredAssets.length} asset{filteredAssets.length !== 1 ? 's' : ''}
                    {filteredAssets.length !== enrichedAssets.length && ` (filtered from ${enrichedAssets.length})`}
                  </span>
                </div>

                {loading ? (
                  <div className="space-y-4">
                    <SkeletonCards count={4} />
                    <SkeletonTable rows={8} cols={6} />
                  </div>
                ) : loadError ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center px-6" role="alert">
                    <AlertTriangle className="w-12 h-12 mb-3 text-red-400" aria-hidden="true" />
                    <p className="text-red-400 font-medium">Could not load fleet assets</p>
                    <p className="text-[var(--text-muted)] text-sm mt-1 max-w-md">{loadError}</p>
                    <button onClick={() => setRefreshKey(k => k + 1)} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
                      <RefreshCw size={16} /> Retry
                    </button>
                  </div>
                ) : (
                  <EnterpriseTable
                    columns={registerColumns}
                    data={pageAssets}
                    getRowId={(a) => String(a.id ?? a.asset_no)}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableSorting={false}
                    enableExport={false}
                    virtual
                    maxHeight={640}
                    onRowClick={(a) => openAsset(a.asset_no)}
                    emptyMessage={hasAdvancedFilter || search ? 'No assets match these filters. Clear a filter to widen the list.' : 'No assets in the register yet. Add your first asset.'}
                  />
                )}

                {/* Pagination - the shared bar, so this register behaves like
                    every other table in the app (50 a page by default). */}
                <TablePagination
                  page={page}
                  setPage={setPage}
                  pageSize={pageSize}
                  setPageSize={setPageSize}
                  total={filteredAssets.length}
                  totalPages={totalPages}
                  from={filteredAssets.length === 0 ? 0 : page * pageSize + 1}
                  to={Math.min(filteredAssets.length, (page + 1) * pageSize)}
                  className="border-[var(--border-dim)]"
                />
              </div>
            </motion.div>
          )}

          {/* ── Fleet Composition Tab ────────────────────────────────────────── */}
          {activeTab === 'charts' && (
            <motion.div key="charts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              {/* The register filters live on the Registry tab, so a chart narrowed
                  by them would be narrowed by something the reader cannot see from
                  here. Said in words rather than left to be assumed. */}
              {scopeActive && (
                <p className="text-xs text-[var(--text-muted)]">
                  These charts cover the assets matching the filters set on the Registry tab, of {enrichedAssets.length} in the register. Each chart holds out the filter it breaks down.
                </p>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-blue-400" aria-hidden="true" /> Vehicle Type Distribution
                  </h3>
                  <div className="h-64" role="img" aria-label={`Vehicle types: ${typeChartData.labels.slice(0, 5).map((l, i) => `${l} ${typeChartData.datasets[0].data[i]}`).join(', ')}`}>
                    {typeChartData.labels.length ? (
                      <Doughnut data={typeChartData} options={DONUT_OPTS} />
                    ) : (
                      <div className="flex items-center justify-center h-full text-[var(--text-dim)] text-sm">No data available</div>
                    )}
                  </div>
                </div>

                <div className="card">
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-green-400" aria-hidden="true" /> Assets per Site by Risk Status
                  </h3>
                  <div className="h-64" role="img" aria-label={`Assets per site across ${siteRiskChartData.labels.length} sites, stacked by worst tyre risk.`}>
                    {siteRiskChartData.labels.length ? (
                      <Bar data={siteRiskChartData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins }, scales: { ...CHART_OPTS.scales, x: { ...CHART_OPTS.scales.x, stacked: true }, y: { ...CHART_OPTS.scales.y, stacked: true } } }} />
                    ) : (
                      <div className="flex items-center justify-center h-full text-[var(--text-dim)] text-sm">No site data available</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Summary stats */}
              <div className="card">
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 flex items-center gap-2">
                  <Award className="w-4 h-4 text-yellow-400" /> Fleet Summary by Type
                </h3>
                <p className="text-xs text-[var(--text-muted)] mb-3">
                  Averages rest only on the assets that carry the measure: cost on assets with tyre records, health on scored assets. A type with none reads N/A.
                </p>
                <EnterpriseTable
                  columns={typeColumns}
                  data={typeSummary}
                  getRowId={(r) => r.type}
                  enableColumnFilters={false}
                  enableExport={false}
                  enableKeyboard={false}
                  initialPageSize={25}
                  searchPlaceholder="Search vehicle types"
                  emptyMessage="No assets to summarise."
                />
              </div>
            </motion.div>
          )}

          {/* ── Health Matrix Tab ─────────────────────────────────────────────── */}
          {activeTab === 'health' && (
            <motion.div key="health" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="card">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
                    <Shield className="w-4 h-4 text-purple-400" /> Asset Health Score Matrix
                  </h3>
                  <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500" />80-100</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-500" />60-79</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-500" />40-59</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500" />0-39</div>
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-2">
                  Score = Tread compliance (40%) + Risk level (40%) + Inspection recency (20%). Sorted by score ascending; assets with no tyre records have no score and sit last.
                </p>
                <p className="text-xs text-[var(--text-secondary)] mb-4" aria-live="polite">
                  {bands.good} good, {bands.fair} fair, {bands.poor} poor, {bands.critical} critical, {bands.none} with no score.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                  {matrixAssets.map(a => (
                      <button
                        key={a.id ?? a.asset_no}
                        onClick={() => openAsset(a.asset_no)}
                        aria-label={`${a.asset_no}, ${a._healthScore == null ? 'no health score' : `health ${a._healthScore}`}${a._worstRisk ? `, worst risk ${a._worstRisk}` : ''}`}
                        className="bg-[var(--surface-2)] rounded-lg p-3 text-left hover:bg-[var(--surface-3)] transition-colors border border-[var(--border-bright)] group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        <div className={`w-full h-1.5 rounded-full mb-2 ${SCORE_COLOR(a._healthScore)}`} />
                        <p className="text-xs font-mono font-semibold text-[var(--text-primary)] truncate group-hover:text-[var(--text-primary)]">{a.asset_no}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">{a.vehicle_type ?? 'N/A'}</p>
                        <div className="flex items-center justify-between mt-2">
                          {a._healthScore != null
                            ? <span className="text-lg font-bold text-[var(--text-primary)]">{a._healthScore}</span>
                            : <span className="text-xs text-[var(--text-dim)]" title="No tyre records yet">No data</span>}
                          {a._worstRisk && (
                            <span className="text-xs" style={{ color: RISK_COLOR[a._worstRisk]?.hex }}>
                              {a._worstRisk?.[0]}
                            </span>
                          )}
                        </div>
                      </button>
                    ))
                  }
                  {!loading && matrixAssets.length === 0 && (
                    <div className="col-span-full text-center py-12 text-[var(--text-dim)] text-sm">
                      No active assets to display.
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom 10 worst */}
              {lowHealth.length > 0 && (
                <div className="bg-[var(--surface-1)] rounded-xl border border-red-900/30 p-5">
                  <h3 className="text-sm font-semibold text-red-400 mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Low Health Assets - Immediate Review Required
                  </h3>
                  <div className="space-y-2">
                    {lowHealth.map(a => (
                        <button type="button" key={a.id ?? a.asset_no}
                          className="w-full text-left flex items-center justify-between p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border-bright)] hover:border-red-900/40 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          onClick={() => openAsset(a.asset_no)}>
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-lg ${SCORE_COLOR(a._healthScore)} flex items-center justify-center font-bold text-[var(--text-primary)] text-sm`}>
                              {a._healthScore}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-[var(--text-primary)] font-mono">{a.asset_no}</p>
                              <p className="text-xs text-[var(--text-muted)]">{a.vehicle_type ?? 'N/A'} | {a.site ?? 'N/A'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            {a._worstRisk && (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${RISK_COLOR[a._worstRisk]?.bg} ${RISK_COLOR[a._worstRisk]?.text}`}>
                                {a._worstRisk}
                              </span>
                            )}
                            <span className="text-xs text-[var(--text-muted)]">{a._activeCount} tyres</span>
                            <Eye className="w-4 h-4 text-[var(--text-dim)]" aria-hidden="true" />
                          </div>
                        </button>
                      ))
                    }
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Add/Edit Modal ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {(showAdd || editAsset) && (
          <AssetModal
            asset={editAsset ?? null}
            sites={siteOptions}
            countries={countryOptions.length ? countryOptions : ['KSA','UAE','Egypt']}
            onSave={() => { setShowAdd(false); setEditAsset(null); setRefreshKey(k => k + 1) }}
            onClose={() => { setShowAdd(false); setEditAsset(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
