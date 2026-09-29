import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useFilterState } from '../hooks/useFilterState'
import { useScrollRestore } from '../hooks/useScrollRestore'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Truck, Plus, Edit2, Save, Search, SlidersHorizontal,
  FileSpreadsheet, FileText, RefreshCw, Download, Bookmark, Settings2,
  ChevronDown, ChevronUp, ChevronsUpDown, AlertTriangle, CheckCircle2, HeartPulse,
  BarChart3, Database, MapPin, MoreHorizontal, Eye, Trash2,
  ToggleLeft, ToggleRight, Lock, X as XIcon,
} from 'lucide-react'
import * as assetApi from '../lib/api/assetManagement'
import { listAssetUtilization } from '../lib/api/assetUtilization'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { toUserMessage } from '../lib/safeError'
import { formatCurrencyCompact, formatDate } from '../lib/formatters'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../components/ui/TablePagination'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import useAnchoredPopover from '../components/ui/useAnchoredPopover'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  PageHero, Kpi, Tabs, Card, Donut, Pager, VehicleThumb, MeterCell, KitTable, fmtInt, fmtPct,
} from '../components/commandCenter/kit'
import { greeting, growthPct, utilizationByMonth, monthLabel } from '../lib/commandCenter'
import { vehicleKind, KIND_LABEL } from '../lib/vehiclePhoto'
import {
  enrichAssets, sortAssets, typeCounts, siteRiskBreakdown, summarizeByType,
  healthMatrix, lowHealthAssets,
  conditionBand, CONDITION_META, averageHealth, completenessPct,
  utilizationIndex, utilizationFor, healthUtilGrid, inGridCell, GRID_ROWS, GRID_COLS,
  compositionSegments, complianceStatus, COMPLIANCE_FIELDS, EXPIRING_DAYS,
  inspectionStatus, INSPECTION_OVERDUE_DAYS, latestInspectionIndex, latestInspectionFor,
} from '../lib/assetManagementAnalytics'
import './assetManagement.css'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// ── Constants ──────────────────────────────────────────────────────────────────
const RISK_COLOR = {
  Critical: { tone: 'bad', hex: '#dc2626' },
  High: { tone: 'orange', hex: '#ea580c' },
  Medium: { tone: 'warn', hex: '#ca8a04' },
  Low: { tone: 'good', hex: '#16a34a' },
}

/**
 * Operational state as the owner records it on the monthly asset sheet.
 *
 * This is NOT the register's Active/Inactive. A machine can be Active - part of
 * the current fleet - and broken down today, or Active and already earmarked
 * for scrap. Showing only one of the two hides whichever question you are
 * actually asking. An asset with no operational status reads "Not recorded"
 * rather than being assumed to be running.
 */
const OPS_STATUS = {
  running: { label: 'Running', tone: 'good' },
  breakdown: { label: 'Breakdown', tone: 'bad' },
  idle: { label: 'Idle / standby', tone: 'warn' },
  planned_scrap: { label: 'Planned scrap', tone: 'orange' },
  reallocation: { label: 'Reallocating', tone: 'info' },
  yard: { label: 'In yard', tone: 'muted' },
  other: { label: 'Other', tone: 'muted' },
}

function OpsStatusBadge({ value, note }) {
  if (!value) return <span className="cc-na">Not recorded</span>
  const meta = OPS_STATUS[value] || OPS_STATUS.other
  return <span className={`cc-pill ${meta.tone}`} title={note || meta.label}>{meta.label}</span>
}

const COMPLIANCE_META = {
  compliant: { label: 'Compliant', tone: 'good' },
  expiring: { label: `Expiring in ${EXPIRING_DAYS} days`, tone: 'warn' },
  expired: { label: 'Expired', tone: 'bad' },
  none: { label: 'Not recorded', tone: 'muted' },
}

const SEGMENT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6']
const OTHER_COLOR = '#94a3b8'

const categoryOf = (a) => KIND_LABEL[vehicleKind(a)] || 'Other'

const GRID_ROW_LABEL = { high: ['High', '(80 to 100)'], medium: ['Medium', '(50 to 79)'], low: ['Low', '(0 to 49)'] }
const GRID_COL_LABEL = { low: ['Low', '(0 to 30%)'], medium: ['Medium', '(31 to 70%)'], high: ['High', '(71 to 100%)'] }
// Heat tone per cell: good health on a working machine is the green corner,
// poor health on a busy machine is the red one.
const HEAT_TONE = {
  'high:low': 'g2', 'high:medium': 'g1', 'high:high': 'a1',
  'medium:low': 'a1', 'medium:medium': 'a2', 'medium:high': 'o1',
  'low:low': 'r1', 'low:medium': 'r2', 'low:high': 'r3',
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--cc-ink-2)', font: { size: 11 }, boxWidth: 12 } },
    tooltip: { backgroundColor: 'var(--panel-2)', titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)', borderColor: 'var(--border-bright)', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: 'var(--cc-ink-3)', font: { size: 11 } }, grid: { color: 'var(--cc-track)' } },
    y: { ticks: { color: 'var(--cc-ink-3)', font: { size: 11 } }, grid: { color: 'var(--cc-track)' } },
  },
}
const DONUT_OPTS = {
  ...CHART_OPTS,
  scales: undefined,
  plugins: { ...CHART_OPTS.plugins, legend: { position: 'right', labels: { color: 'var(--cc-ink-2)', font: { size: 11 }, boxWidth: 12, padding: 12 } } },
}

const VEHICLE_TYPES = ['Truck','Tipper','Mixer','Rigid','Semi-Trailer','Pickup','Crane','Loader','Tanker','Bus','Other']

const EMPTY_ASSET = (country = 'KSA') => ({
  asset_no: '', vehicle_type: '', make: '', model: '', year: '',
  site: '', country, active: true,
})

// Registry columns the reader can show or hide. `always` columns cannot be
// hidden (the id and the row actions are how a row is identified and used).
const COLUMN_DEFS = [
  { key: 'asset_no', label: 'Asset ID', always: true, sort: 'asset_no' },
  { key: 'asset', label: 'Asset' },
  { key: 'category', label: 'Category', sort: '_category' },
  { key: 'make', label: 'Make / Model', sort: 'make' },
  { key: 'site', label: 'Site', sort: 'site' },
  { key: 'condition', label: 'Condition', sort: '_healthScore' },
  { key: 'health', label: 'Health Score', sort: '_healthScore' },
  { key: 'util', label: 'Utilization', sort: '_util' },
  { key: 'inspection', label: 'Last Inspection' },
  { key: 'type', label: 'Vehicle Type', sort: 'vehicle_type', hidden: true },
  { key: 'ops', label: 'Operational', sort: 'ops_status', hidden: true },
  { key: 'status', label: 'Status', sort: 'active', hidden: true },
  { key: 'risk', label: 'Worst Tyre Risk', sort: '_worstRisk', hidden: true },
  { key: 'compliance', label: 'Compliance', sort: '_compliance', hidden: true },
  { key: 'km', label: 'Current KM', sort: 'current_km', hidden: true },
  { key: 'year', label: 'Year', sort: 'year', hidden: true },
  { key: 'ytd', label: 'YTD Tyre Cost', sort: '_ytdCost', hidden: true },
]
const COLUMNS_KEY = 'assetManagement.columns.v1'
const VIEWS_KEY = 'assetManagement.savedViews.v1'
const VIEW_KEYS = ['search', 'site', 'country', 'type', 'status', 'risk', 'ops', 'cat', 'health', 'comp', 'cell', 'sort', 'dir']

function readStore(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}
function writeStore(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable: the choice lasts this visit only */ }
}
const defaultColumns = () => COLUMN_DEFS.filter((c) => !c.hidden).map((c) => c.key)

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n, dec = 0) {
  if (n == null || n === '' || isNaN(n)) return 'N/A'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
// Shared formatters; currency is always supplied from activeCurrency at call sites.
const fmtCurrency = (n, cur) => formatCurrencyCompact(n, cur)
const fmtDate = (d) => formatDate(d)

/** A portalled menu or panel anchored to its trigger (escapes table clipping). */
function Popover({ open, onClose, width = 220, height = 260, role = 'menu', label, trigger, children }) {
  const { triggerRef, panelRef, coords } = useAnchoredPopover(open, { width, height, align: 'right', nav: role === 'menu' ? 'menu' : 'trap', onRequestClose: onClose })
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      onClose()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, onClose, panelRef, triggerRef])
  return (
    <>
      {trigger(triggerRef)}
      {open && coords && createPortal(
        <div className="cc am-pop" ref={panelRef} role={role} aria-label={label}
          style={{ top: coords.top, left: coords.left, width, maxHeight: coords.maxHeight }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}

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
    <Modal
      open
      onClose={onClose}
      title={(
        <span className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-blue-400" aria-hidden="true" />
          {isEdit ? t('assetmgmt.modal.editTitle') : t('assetmgmt.modal.addTitle')}
        </span>
      )}
      size="md"
      footer={(
        <>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[var(--surface-2)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-3)] transition-colors">{t('assetmgmt.modal.cancel')}</button>
          <button onClick={handleSave} disabled={saving || (isEdit && locked)}
            title={isEdit && locked ? 'Locked: in approval' : undefined}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
            {isEdit && locked ? <Lock className="w-4 h-4" /> : saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? t('assetmgmt.modal.saving') : t('assetmgmt.modal.save')}
          </button>
        </>
      )}
    >
        <div className="space-y-4">
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
    </Modal>
  )
}


// ── Overview cards ─────────────────────────────────────────────────────────────

function CompositionCard({ segments, total, active, onSelect, onViewAll }) {
  return (
    <Card title="Fleet Composition" className="am-card"
      action={<button type="button" className="cc-link cc-link-btn" onClick={onViewAll}>View all</button>}>
      {total === 0
        ? <div className="cc-empty">No assets in this view.</div>
        : (
          <div className="am-comp">
            <Donut segments={segments} total={total} centerLabel="Total Assets" onSelect={onSelect} />
            {active && <p className="am-note">Filtered to {active}. Pick it again to clear.</p>}
          </div>
        )}
    </Card>
  )
}

function HealthMatrixCard({ grid, active, onSelect, onViewAll, utilState }) {
  const utilMissing = utilState === 'none' || utilState === 'error'
  return (
    <Card title="Asset Health Matrix" className="am-card"
      action={<button type="button" className="cc-link cc-link-btn" onClick={onViewAll}>View all</button>}>
      {utilState === 'loading'
        ? <div className="cc-skel" style={{ height: 180 }} />
        : (
          <>
            <div className="am-heat-wrap">
              <span className="am-heat-axis-y">Health Score</span>
              <div className="cc-heat am-heat" role="group" aria-label="Assets by health score and utilization rate">
                {GRID_ROWS.map((r) => (
                  <div key={r} style={{ display: 'contents' }}>
                    <span className="cc-heat-y">{GRID_ROW_LABEL[r][0]}<small>{GRID_ROW_LABEL[r][1]}</small></span>
                    {GRID_COLS.map((c) => {
                      const key = `${r}:${c}`
                      const n = grid.cells[key]
                      const on = active === key
                      return (
                        <button key={key} type="button" aria-pressed={on}
                          className={`cc-heat-cell am-heat-${HEAT_TONE[key]}${on ? ' am-heat-on' : ''}`}
                          aria-label={`${n} assets with ${r} health and ${c} utilization${on ? ', filter on' : ''}`}
                          onClick={() => onSelect(on ? '' : key)}>
                          {fmtInt(n)}
                        </button>
                      )
                    })}
                  </div>
                ))}
                <span />
                {GRID_COLS.map((c) => <span key={c} className="cc-heat-x">{GRID_COL_LABEL[c][0]}<br /><small>{GRID_COL_LABEL[c][1]}</small></span>)}
              </div>
            </div>
            <p className="am-heat-axis-x">Utilization Rate</p>
            <p className="am-note">
              {utilMissing
                ? 'No utilization readings are recorded for these assets, so none can be placed. '
                : `${fmtInt(grid.placed)} assets placed. `}
              {grid.unplaced > 0 && `${fmtInt(grid.unplaced)} not placed: ${fmtInt(grid.noHealth)} have no health score, ${fmtInt(grid.noUtil)} have no utilization reading.`}
            </p>
          </>
        )}
    </Card>
  )
}

function TrendChart({ series }) {
  const W = 420; const H = 170; const pad = { l: 36, r: 12, t: 10, b: 22 }
  const x = (i) => pad.l + (series.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (series.length - 1))
  const y = (v) => pad.t + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - pad.t - pad.b)
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ')
  const area = series.length > 1 ? `${d} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : ''
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label={`Average utilization by month: ${series.map((p) => `${monthLabel(p.month)} ${p.value}%`).join(', ')}`}>
      <defs>
        <linearGradient id="amUtil" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#3b82f6" stopOpacity="0.28" />
          <stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--cc-track)" />
          <text className="cc-axis" x={pad.l - 6} y={y(v)} dy="0.35em" textAnchor="end">{v}%</text>
        </g>
      ))}
      {area && <path d={area} fill="url(#amUtil)" />}
      {series.length > 1 && <path d={d} fill="none" stroke="#3b82f6" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      {series.map((p, i) => <circle key={p.month} cx={x(i)} cy={y(p.value)} r="3.2" fill="#3b82f6" />)}
      {series.map((p, i) => <text key={`l${p.month}`} className="cc-axis" x={x(i)} y={H - 5} textAnchor="middle">{monthLabel(p.month)}</text>)}
    </svg>
  )
}

function TrendCard({ state, series, average, months, onMonths }) {
  return (
    <Card title="Utilization & Health Trend" className="am-card"
      action={(
        <select className="cc-select" aria-label="Trend period" value={months} onChange={(e) => onMonths(Number(e.target.value))}>
          <option value={3}>Last 3 months</option>
          <option value={6}>Last 6 months</option>
          <option value={12}>Last 12 months</option>
        </select>
      )}>
      {state === 'loading' && <div className="cc-skel" style={{ height: 180 }} />}
      {state === 'error' && <div className="cc-empty" role="alert">Utilization readings could not be loaded.</div>}
      {state === 'ready' && (series.length === 0
        ? <div className="cc-empty">No utilization readings in this period.</div>
        : (
          <>
            <div className="am-trend-legend">
              <span><i style={{ background: '#3b82f6' }} aria-hidden="true" />Asset Utilization</span>
              <b>{fmtPct(average)} average</b>
            </div>
            <div className="cc-chart am-trend"><TrendChart series={series} /></div>
          </>
        ))}
      {state !== 'loading' && (
        <p className="am-note">Health history is not recorded, so only utilization is plotted. Health today is shown in the matrix and the table.</p>
      )}
    </Card>
  )
}

// ── KPI tile tooltip copy (the definitions, stated where the number is) ─────
const KPI_TITLES = {
  total: 'Every asset in the register for this view. Trend compares with 30 days ago by the date each asset was added.',
  active: 'Assets marked active on the register.',
  health: 'Average tyre health score over the assets that have one. Assets with no tyre records have no score and are left out.',
  risk: 'An asset is at risk when its health score is below 50, or its worst fitted tyre is rated High or Critical.',
  util: 'Average of each asset\'s latest telematics utilization reading. Assets with no reading are left out.',
  complete: 'Share of assets with make, model, site and vehicle type all recorded.',
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
  // Telematics utilisation: its own state, so a failed read leaves the register
  // working and the utilisation figures honestly N/A.
  const [utilRows, setUtilRows] = useState([])
  const [utilState, setUtilState] = useState('loading') // loading | ready | none | error

  // ── filter state ─────────────────────────────────────────────────────────────
  // Search, filters, sort and page live in the URL (useFilterState) so they
  // SURVIVE opening an asset and pressing Back: a row opens `/asset-management/:assetNo`
  // as a route, so without this the registry would remount unfiltered on page 1.
  // NOTE: `country` here is the page's own column filter over the loaded rows,
  // NOT the working-context country - that stays in the settings context.
  const [filters, setFilter, , , setFilters] = useFilterState({
    search: '', site: '', country: '', type: '', status: '', risk: '', ops: '',
    cat: '', health: '', comp: '', cell: '',
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
  const filterCat = filters.cat
  const filterHealth = filters.health
  const filterComp = filters.comp
  const filterCell = filters.cell
  // The less common filters sit behind "More filters". Opens on arrival when
  // the restored URL already carries one - a hidden applied filter reads as a
  // wrong result, not a filter.
  const [showMore, setShowMore] = useState(() => !!(filters.status || filters.risk || filters.ops))

  // ── sort state ───────────────────────────────────────────────────────────────
  const sortCol = filters.sort
  const sortDir = filters.dir === 'desc' ? 'desc' : 'asc'

  // ── pagination ───────────────────────────────────────────────────────────────
  // The URL carries a human-readable 1-based page; the list is 0-based. Page
  // AND size ride in the URL for the same reason the filters do.
  const rawPage = Math.max(0, (Number(filters.page) || 1) - 1)
  const setPage = useCallback(p => setFilter('page', String((Number(p) || 0) + 1)), [setFilter])
  // Clamped to the sizes the pager offers: a hand-typed `?size=100000` must
  // not become the page size.
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(filters.size))
    ? Number(filters.size)
    : DEFAULT_PAGE_SIZE
  const setPageSize = useCallback(n => setFilters({ size: String(n), page: '1' }), [setFilters])

  // ── UI state ─────────────────────────────────────────────────────────────────
  // Full asset detail lives on the dedicated /asset-management/:assetNo page.
  const [editAsset, setEditAsset] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [activeTab, setActiveTab] = useState('registry') // registry | charts | health
  const [trendMonths, setTrendMonths] = useState(6)
  const [columns, setColumns] = useState(() => {
    const saved = readStore(COLUMNS_KEY, null)
    const known = new Set(COLUMN_DEFS.map((c) => c.key))
    return Array.isArray(saved) && saved.length ? saved.filter((k) => known.has(k)) : defaultColumns()
  })
  const [views, setViews] = useState(() => {
    const v = readStore(VIEWS_KEY, [])
    return Array.isArray(v) ? v : []
  })
  const [viewName, setViewName] = useState('')
  const [menu, setMenu] = useState(null) // 'views' | 'export' | 'columns' | `row:<id>`
  const closeMenu = useCallback(() => setMenu(null), [])
  const [selected, setSelected] = useState(() => new Set())

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

      // If the register is empty, synthesize from the per-asset overview
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

  useEffect(() => {
    let live = true
    setUtilState('loading')
    listAssetUtilization({ country: activeCountry })
      .then((rows) => {
        if (!live) return
        setUtilRows(rows || [])
        setUtilState(rows && rows.length ? 'ready' : 'none')
      })
      .catch(() => { if (live) { setUtilRows([]); setUtilState('error') } })
    return () => { live = false }
  }, [activeCountry, refreshKey])

  // ── derived data ──────────────────────────────────────────────────────────────
  const utilIndex = useMemo(() => utilizationIndex(utilRows), [utilRows])
  const now = useMemo(() => new Date(), [assets]) // eslint-disable-line react-hooks/exhaustive-deps
  // Enrichment lives in assetManagementAnalytics: an asset with no tyre
  // overview carries a NULL health score, never a zero that ranks it worst.
  const enrichedAssets = useMemo(
    () => enrichAssets(assets, overview).map((a) => ({
      ...a,
      _category: categoryOf(a),
      _util: utilizationFor(utilIndex, a),
      _compliance: complianceStatus(a, now),
    })),
    [assets, overview, utilIndex, now],
  )
  const utilOf = useCallback((a) => a._util, [])

  // Which categories keep their own slice is decided once over the whole
  // register, so the grouping (and the category filter) does not shift as
  // other filters narrow the counts.
  const namedCategories = useMemo(() => {
    const segs = compositionSegments(enrichedAssets, (a) => a._category)
    return new Set(segs.filter((s) => s.label !== 'Other').map((s) => s.label))
  }, [enrichedAssets])
  const groupOf = useCallback((a) => (namedCategories.has(a._category) ? a._category : 'Other'), [namedCategories])

  // ── filter + sort ─────────────────────────────────────────────────────────────

  /**
   * THE ONE register filter rule, with a hold-out list.
   *
   * Every surface on this page narrows with the register filters, but a surface
   * that BREAKS DOWN a dimension has to hold that dimension out or it stops
   * saying anything: filter to Critical risk and a "Fleet at risk" tile computed
   * over the filtered rows just restates the row count, and a composition
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
        (a.site ?? '').toLowerCase().includes(q) ||
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
    if (!skip.cat && filterCat) out = out.filter(a => groupOf(a) === filterCat)
    if (!skip.health && filterHealth) out = out.filter(a => conditionBand(a._healthScore) === filterHealth)
    if (!skip.comp && filterComp) out = out.filter(a => a._compliance === filterComp)
    if (!skip.cell && filterCell) out = out.filter(a => inGridCell(a, filterCell, utilOf))
    return out
  }, [search, filterSite, filterCountry, filterType, filterStatus, filterOps, filterRisk, filterCat, filterHealth, filterComp, filterCell, groupOf, utilOf])

  // Is the register showing a NARROWED set? Drives the caption under the tiles.
  const scopeActive = !!(search || filterSite || filterCountry || filterType || filterStatus || filterOps || filterRisk || filterCat || filterHealth || filterComp || filterCell)

  // Sorted by the engine (consoleTable semantics): blanks last in either
  // direction, numbers as numbers, risk by severity.
  const filteredAssets = useMemo(
    () => sortAssets(applyAssetFilters(enrichedAssets), sortCol, sortDir),
    [enrichedAssets, applyAssetFilters, sortCol, sortDir],
  )

  // ── KPIs ──────────────────────────────────────────────────────────────────────
  /**
   * WHAT THE TILES COUNT: the assets the register's own filters leave, minus the
   * two dimensions the tiles themselves break down (active/inactive status and
   * worst risk). The caption under the tiles states the scope in words.
   */
  const kpiAssets = useMemo(
    () => applyAssetFilters(enrichedAssets, { status: true, risk: true }),
    [enrichedAssets, applyAssetFilters],
  )
  const kpis = useMemo(() => {
    const totalActive = kpiAssets.filter(a => a.active !== false).length
    const totalInactive = kpiAssets.filter(a => a.active === false).length
    // At risk: worst tyre High or Critical, or a health score below 50.
    const atRisk = kpiAssets.filter(a => a._worstRisk === 'Critical' || a._worstRisk === 'High' || (a._healthScore != null && a._healthScore < 50)).length
    const totalYtdCost = kpiAssets.reduce((s, a) => s + (a._ytdCost || 0), 0)
    // No active vehicle means the average is unmeasurable, not zero.
    const avgCost = totalActive > 0 ? totalYtdCost / totalActive : null
    const utilVals = kpiAssets.map(a => a._util).filter(v => v != null)
    const avgUtil = utilVals.length ? utilVals.reduce((s, v) => s + v, 0) / utilVals.length : null
    const nowMs = Date.now()
    return {
      total: kpiAssets.length,
      totalActive, totalInactive, atRisk, avgCost,
      avgHealth: averageHealth(kpiAssets),
      scored: kpiAssets.filter(a => a._healthScore != null).length,
      avgUtil, utilCount: utilVals.length,
      completeness: completenessPct(kpiAssets),
      trendTotal: growthPct(kpiAssets, nowMs),
      trendActive: growthPct(kpiAssets, nowMs, a => a.active !== false),
      covered: kpiAssets.length,
    }
  }, [kpiAssets])

  // ── Filter options ─────────────────────────────────────────────────────────────
  const siteOptions = useMemo(() => [...new Set(assets.map(a => a.site).filter(Boolean))].sort(), [assets])
  const countryOptions = useMemo(() => [...new Set(assets.map(a => a.country).filter(Boolean))].sort(), [assets])
  const typeOptions = useMemo(() => [...new Set(assets.map(a => a.vehicle_type).filter(Boolean))].sort(), [assets])
  const opsOptions = useMemo(() => [...new Set(assets.map(a => a.ops_status).filter(Boolean))].sort(), [assets])

  // ── Overview cards ─────────────────────────────────────────────────────────────
  // Composition holds out the CATEGORY filter; the grid holds out its own cell
  // and the health filter it breaks down (see applyAssetFilters).
  const compAssets = useMemo(() => applyAssetFilters(enrichedAssets, { cat: true }), [enrichedAssets, applyAssetFilters])
  const compSegments = useMemo(() => {
    const counts = new Map()
    for (const a of compAssets) counts.set(groupOf(a), (counts.get(groupOf(a)) || 0) + 1)
    const named = [...counts.entries()].filter(([l]) => l !== 'Other').sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    const segs = named.map(([label, count], i) => ({ label, count, color: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }))
    if (counts.get('Other')) segs.push({ label: 'Other', count: counts.get('Other'), color: OTHER_COLOR })
    return segs
  }, [compAssets, groupOf])

  const gridAssets = useMemo(() => applyAssetFilters(enrichedAssets, { cell: true, health: true }), [enrichedAssets, applyAssetFilters])
  const grid = useMemo(() => healthUtilGrid(gridAssets, utilOf), [gridAssets, utilOf])

  // Trend: the readings of the assets in view, by month.
  const trend = useMemo(() => {
    const keys = new Set(kpiAssets.map(a => `${String(a.asset_no || '').trim().toUpperCase()}|${a.country || ''}`))
    const codes = new Set(kpiAssets.map(a => String(a.asset_no || '').trim().toUpperCase()))
    const rows = utilRows.filter((r) => {
      const code = String(r.asset_no || '').trim().toUpperCase()
      return keys.has(`${code}|${r.country || ''}`) || (!r.country && codes.has(code))
    })
    return utilizationByMonth(rows, trendMonths)
  }, [utilRows, kpiAssets, trendMonths])

  // ── Fleet Composition tab charts ─────────────────────────────────────────────
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
  const bands = useMemo(() => {
    const out = { good: 0, monitor: 0, critical: 0, none: 0 }
    for (const a of matrixAssets) out[conditionBand(a._healthScore)] += 1
    return out
  }, [matrixAssets])

  // ── Sort helper ───────────────────────────────────────────────────────────────
  function toggleSort(col) {
    const dir = sortCol === col && sortDir === 'asc' ? 'desc' : 'asc'
    setFilters({ sort: col, dir, page: '1' })
  }
  // The register's sort rides in the URL (it survives opening an asset and
  // pressing Back) and covers the WHOLE filtered set.
  function renderSortHeader(col, label) {
    const active = sortCol === col
    const dirLabel = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'not sorted'
    const Icon = !active ? ChevronsUpDown : sortDir === 'asc' ? ChevronUp : ChevronDown
    return (
      <button type="button" onClick={() => toggleSort(col)} aria-label={`${label}, ${dirLabel}. Sort by ${label}`}>
        {label}<Icon size={12} className={active ? 'am-sort-on' : 'am-sort'} aria-hidden="true" />
      </button>
    )
  }

  // ── Pagination ────────────────────────────────────────────────────────────────
  // Only the TABLE is paged. `filteredAssets` stays the full filtered set and
  // remains what the exports write and what the row-count caption quotes.
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / pageSize))
  // Clamp, so a restored `?page=40` that no longer exists after a filter renders
  // the last real page instead of an empty table - which reads as "no matches".
  const page = Math.min(rawPage, totalPages - 1)
  const pageAssets = filteredAssets.slice(page * pageSize, (page + 1) * pageSize)

  // Last inspection for the visible page only: ONE bounded `.in()` read.
  const pageKey = pageAssets.map(a => `${a.asset_no}|${a.country || ''}`).join(',')
  const [insp, setInsp] = useState({ state: 'idle', index: {}, truncated: false })
  useEffect(() => {
    const codes = pageAssets.map(a => a.asset_no).filter(Boolean)
    if (!codes.length) { setInsp({ state: 'ready', index: {}, truncated: false }); return undefined }
    let live = true
    setInsp((s) => ({ ...s, state: 'loading' }))
    assetApi.listLatestInspections(codes, activeCountry)
      .then(({ rows, truncated }) => { if (live) setInsp({ state: 'ready', index: latestInspectionIndex(rows), truncated }) })
      .catch(() => { if (live) setInsp({ state: 'error', index: {}, truncated: false }) })
    return () => { live = false }
  }, [pageKey, activeCountry]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilter = !!(filterSite || filterCountry || filterType || filterStatus || filterRisk || filterOps || filterCat || filterHealth || filterComp || filterCell)
  const clearFilters = () => setFilters({ search: '', site: '', country: '', type: '', status: '', risk: '', ops: '', cat: '', health: '', comp: '', cell: '', page: '1' })

  // ── Saved views + columns ─────────────────────────────────────────────────────
  function saveView() {
    const name = viewName.trim()
    if (!name) return
    const snapshot = Object.fromEntries(VIEW_KEYS.map(k => [k, filters[k] ?? '']))
    const next = [...views.filter(v => v.name !== name), { name, filters: snapshot }]
    setViews(next); writeStore(VIEWS_KEY, next); setViewName('')
  }
  function applyView(v) {
    const blank = Object.fromEntries(VIEW_KEYS.map(k => [k, '']))
    setFilters({ ...blank, sort: 'asset_no', dir: 'asc', ...v.filters, page: '1' })
    setShowMore(!!(v.filters?.status || v.filters?.risk || v.filters?.ops))
    closeMenu()
  }
  function deleteView(name) {
    const next = views.filter(v => v.name !== name)
    setViews(next); writeStore(VIEWS_KEY, next)
  }
  function toggleColumn(key) {
    const next = columns.includes(key) ? columns.filter(k => k !== key) : COLUMN_DEFS.map(c => c.key).filter(k => k === key || columns.includes(k))
    setColumns(next); writeStore(COLUMNS_KEY, next)
  }
  function resetColumns() { const d = defaultColumns(); setColumns(d); writeStore(COLUMNS_KEY, d) }
  const shownColumns = COLUMN_DEFS.filter(c => c.always || columns.includes(c.key))

  const pageIds = pageAssets.map(a => String(a.id ?? a.asset_no))
  const allOnPage = pageIds.length > 0 && pageIds.every(id => selected.has(id))
  function togglePageSelection() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allOnPage) pageIds.forEach(id => next.delete(id))
      else pageIds.forEach(id => next.add(id))
      return next
    })
  }
  function toggleRow(id) {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  // ── Export ────────────────────────────────────────────────────────────────────
  // Exports always write the whole filtered set (never one page); with rows
  // ticked in the table, only the ticked rows are written.
  const exportSet = selected.size ? filteredAssets.filter(a => selected.has(String(a.id ?? a.asset_no))) : filteredAssets
  async function handleExcelExport() {
    setExportError('')
    closeMenu()
    const { exportToExcel, reportFileName } = await loadExportUtils()
    const rows = filteredAssets.map(a => ({
      asset_no: a.asset_no,
      fleet_number: a.fleet_number ?? '',
      vehicle_type: a.vehicle_type ?? '',
      category: a._category,
      make: a.make ?? '',
      model: a.model ?? '',
      year: a.year ?? '',
      site: a.site ?? '',
      country: a.country ?? '',
      current_km: a.current_km ?? '',
      operator_name: a.operator_name ?? '',
      active: a.active ? 'Active' : 'Inactive',
      condition: CONDITION_META[conditionBand(a._healthScore)].label,
      health_score: a._healthScore == null ? 'N/A' : a._healthScore,
      utilization: a._util == null ? 'N/A' : `${Math.round(a._util)}%`,
      compliance: COMPLIANCE_META[a._compliance].label,
      active_tyres: a._activeCount,
      worst_risk: a._worstRisk ?? '',
      ytd_cost: a._hasTyreData ? a._ytdCost : '',
      last_service: a._latestDate ? fmtDate(a._latestDate) : 'N/A',
    })).filter((r, i) => exportSet === filteredAssets || selected.has(String(filteredAssets[i].id ?? filteredAssets[i].asset_no)))
    try {
      await exportToExcel(
        rows,
        ['asset_no','fleet_number','vehicle_type','category','make','model','year','site','country','current_km','operator_name','active','condition','health_score','utilization','compliance','active_tyres','worst_risk','ytd_cost','last_service'],
        ['Asset No','Fleet No','Type','Category','Make','Model','Year','Site','Country','Current KM','Operator','Status','Condition','Health Score','Utilization','Compliance','Active Tyres','Worst Risk','YTD Cost','Last Service'],
        reportFileName('Asset Register'),
        'Assets'
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  async function handlePdfExport() {
    setExportError('')
    closeMenu()
    const { exportToPdf, reportFileName } = await loadExportUtils()
    try {
      await exportToPdf(
        filteredAssets.map(a => ({
        _keep: exportSet === filteredAssets || selected.has(String(a.id ?? a.asset_no)),
        asset_no: a.asset_no,
        category: a._category,
        make: `${a.make ?? ''} ${a.model ?? ''}`.trim() || 'N/A',
        site: a.site ?? 'N/A',
        condition: CONDITION_META[conditionBand(a._healthScore)].label,
        health_score: a._healthScore == null ? 'N/A' : `${a._healthScore}/100`,
        utilization: a._util == null ? 'N/A' : `${Math.round(a._util)}%`,
        worst_risk: a._worstRisk ?? 'N/A',
        ytd_cost: a._hasTyreData ? fmtCurrency(a._ytdCost, activeCurrency) : 'N/A',
        last_service: a._latestDate ? fmtDate(a._latestDate) : 'N/A',
      })).filter(r => r._keep),
      [
        { key: 'asset_no', header: 'Asset No', width: 22 },
        { key: 'category', header: 'Category', width: 26 },
        { key: 'make', header: 'Make / Model', width: 34 },
        { key: 'site', header: 'Site', width: 28 },
        { key: 'condition', header: 'Condition', width: 20 },
        { key: 'health_score', header: 'Health', width: 18 },
        { key: 'utilization', header: 'Utilization', width: 20 },
        { key: 'worst_risk', header: 'Risk', width: 18 },
        { key: 'ytd_cost', header: 'YTD Cost', width: 24 },
        { key: 'last_service', header: 'Last Service', width: 26 },
      ],
      'Asset Management Register',
      reportFileName('Asset Register')
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // ── Table cells ───────────────────────────────────────────────────────────────
  function renderCell(key, a) {
    switch (key) {
      case 'asset_no': return <span className="cc-strong">{a.asset_no}</span>
      case 'asset': return <VehicleThumb row={a} size="sm" />
      case 'category': return a._category
      case 'make': {
        const mm = [a.make, a.model].filter(Boolean).join(' ')
        return mm ? <span className="am-trunc" title={mm}>{mm}</span> : <span className="cc-na">N/A</span>
      }
      case 'site': return a.site
        ? <span className="cc-site"><MapPin size={13} aria-hidden="true" /><span className="am-trunc" title={a.site}>{a.site}</span></span>
        : <span className="cc-na">N/A</span>
      case 'condition': {
        const m = CONDITION_META[conditionBand(a._healthScore)]
        return <span className={`cc-pill ${m.tone} am-cond`}>{m.label}</span>
      }
      case 'health': return <MeterCell value={a._healthScore} tone={a._healthScore == null ? undefined : a._healthScore >= 80 ? 'var(--cc-green)' : a._healthScore >= 50 ? 'var(--cc-amber)' : 'var(--cc-red)'} />
      case 'util': return <MeterCell value={a._util} suffix="%" tone="var(--cc-green)" />
      case 'inspection': {
        if (insp.state === 'loading' || insp.state === 'idle') return <span className="cc-na">Checking</span>
        if (insp.state === 'error') return <span className="cc-na" title="Inspections could not be loaded">N/A</span>
        const d = latestInspectionFor(insp.index, a)
        if (!d) return <span className="cc-na" title={insp.truncated ? 'Not checked: too many inspections to read for this page' : 'No inspection recorded'}>{insp.truncated ? 'Not checked' : 'N/A'}</span>
        const st = inspectionStatus(d, now)
        return (
          <span className="am-insp" title={`Overdue when the last inspection is more than ${INSPECTION_OVERDUE_DAYS} days old`}>
            <span>{fmtDate(d)}</span>
            <span className={`am-insp-st ${st === 'overdue' ? 'is-bad' : 'is-good'}`}>
              <i aria-hidden="true" />{st === 'overdue' ? 'Overdue' : 'On schedule'}
            </span>
          </span>
        )
      }
      case 'type': return a.vehicle_type || <span className="cc-na">N/A</span>
      case 'ops': return <OpsStatusBadge value={a.ops_status} note={a.ops_status_note} />
      case 'status': return <span className={`cc-pill ${a.active ? 'good' : 'muted'}`}>{a.active ? 'Active' : 'Inactive'}</span>
      case 'risk': return a._worstRisk
        ? <span className={`cc-pill ${RISK_COLOR[a._worstRisk]?.tone || 'muted'}`}>{a._worstRisk}</span>
        : <span className="cc-na">N/A</span>
      case 'compliance': {
        const m = COMPLIANCE_META[a._compliance]
        return <span className={`cc-pill ${m.tone}`}>{m.label}</span>
      }
      case 'km': return a.current_km != null && a.current_km !== '' ? `${fmt(a.current_km)} km` : <span className="cc-na">N/A</span>
      case 'year': return a.year ?? <span className="cc-na">N/A</span>
      case 'ytd': return a._hasTyreData ? fmtCurrency(a._ytdCost, activeCurrency) : <span className="cc-na">N/A</span>
      default: return null
    }
  }

  const typeColumns = [
    { accessorKey: 'type', header: 'Vehicle Type', cell: ({ getValue }) => <span className="cc-strong">{getValue()}</span> },
    { accessorKey: 'count', header: 'Count', meta: { align: 'right' } },
    { accessorKey: 'active', header: 'Active', meta: { align: 'right' } },
    { accessorKey: 'atRisk', header: 'At Risk', meta: { align: 'right' }, cell: ({ getValue }) => <span style={getValue() > 0 ? { color: 'var(--cc-red)', fontWeight: 600 } : undefined}>{getValue()}</span> },
    { id: 'avgCost', accessorFn: r => r.avgCost ?? undefined, sortUndefined: 'last', header: 'Avg YTD Cost', meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? 'N/A' : fmtCurrency(getValue(), activeCurrency)) },
    {
      id: 'avgHealth', accessorFn: r => r.avgHealth ?? undefined, sortUndefined: 'last', header: 'Health Avg',
      cell: ({ row }) => (row.original.avgHealth == null
        ? <span className="cc-na">No data</span>
        : <span title={`Average of ${row.original.scored} scored asset${row.original.scored === 1 ? '' : 's'}`}><MeterCell value={row.original.avgHealth} /></span>),
    },
  ]

  const na = loading ? null : loadError ? 'N/A' : undefined
  const hello = `${greeting()},`

  // ── Render ────────────────────────────────────────────────────────────────────
  const registryColumns = [
    {
      key: '_sel', sortable: false,
      header: <input type="checkbox" aria-label="Select all assets on this page" checked={allOnPage} onChange={togglePageSelection} />,
      cell: (a) => { const id = String(a.id ?? a.asset_no); return <span onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select asset ${a.asset_no}`} checked={selected.has(id)} onChange={() => toggleRow(id)} /></span> },
    },
    ...shownColumns.map(c => ({ key: c.key, sortable: false, header: c.sort ? renderSortHeader(c.sort, c.label) : c.label, cell: (a) => renderCell(c.key, a) })),
    {
      key: '_actions', sortable: false, header: 'Actions',
      cell: (a) => {
        const id = String(a.id ?? a.asset_no)
        return (
          <span onClick={e => e.stopPropagation()}>
            <Popover open={menu === `row:${id}`} onClose={closeMenu} width={170} label={`Actions for ${a.asset_no}`}
              trigger={(ref) => (
                <button ref={ref} type="button" className="cc-icon-btn am-dots" aria-haspopup="menu" aria-expanded={menu === `row:${id}`}
                  aria-label={`Actions for asset ${a.asset_no}`} onClick={() => setMenu(m => (m === `row:${id}` ? null : `row:${id}`))}>
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
              )}>
              <button type="button" role="menuitem" className="am-pop-item" onClick={() => { closeMenu(); openAsset(a.asset_no) }}>
                <Eye size={14} aria-hidden="true" /> {t('assetmgmt.registry.viewDetail')}
              </button>
              {isAdmin && (
                <button type="button" role="menuitem" className="am-pop-item" onClick={() => { closeMenu(); setEditAsset(a) }}>
                  <Edit2 size={14} aria-hidden="true" /> {t('assetmgmt.registry.editAsset')}
                </button>
              )}
            </Popover>
          </span>
        )
      },
    },
  ]

  return (
    <div className="cc am-page">
      <PageHero
        hello={hello}
        title="Asset Management"
        lead="Track asset registry, fleet composition, health scoring and operational intelligence."
        imgLight="/dashboard/hero-assets-light.webp"
        imgDark="/dashboard/hero-assets-dark.webp"
      />

      {exportError && (
        <div className="cc-card am-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{exportError}</span>
          <button type="button" className="cc-icon-btn" onClick={() => setExportError('')} aria-label="Dismiss export error"><XIcon size={14} aria-hidden="true" /></button>
        </div>
      )}

      {/* KPI tiles. EVERY figure is computed over `kpiAssets`: the assets the
          register below shows, minus the status and risk dimensions the tiles
          themselves break down. The caption states that in words. */}
      <div className="cc-kpis">
        <Kpi icon={Truck} tone="t-green" loading={loading} display={na} value={kpis.total} label="Total Assets" trend={loadError ? null : kpis.trendTotal} title={KPI_TITLES.total} />
        <Kpi icon={CheckCircle2} tone="t-green" loading={loading} display={na} value={kpis.totalActive} label="Active Assets" trend={loadError ? null : kpis.trendActive} title={`${KPI_TITLES.active} ${fmtInt(kpis.totalInactive)} inactive.`} />
        <Kpi icon={HeartPulse} tone="t-green" loading={loading} display={na ?? (kpis.avgHealth == null ? 'N/A' : String(kpis.avgHealth))} label="Avg. Health Score" title={`${KPI_TITLES.health} Based on ${fmtInt(kpis.scored)} scored assets.`} />
        <Kpi icon={AlertTriangle} tone="t-red" danger={!loading && !loadError && kpis.atRisk > 0} loading={loading} display={na} value={kpis.atRisk} label="At-Risk Assets" title={KPI_TITLES.risk} />
        <Kpi icon={BarChart3} tone="t-green" loading={loading || utilState === 'loading'} display={na ?? (utilState === 'error' ? 'N/A' : fmtPct(kpis.avgUtil))} label="Utilization" title={`${KPI_TITLES.util} ${utilState === 'error' ? 'Readings could not be loaded.' : `Based on ${fmtInt(kpis.utilCount)} assets with a reading.`}`} />
        <Kpi icon={Database} tone="t-green" loading={loading} display={na ?? fmtPct(kpis.completeness)} label="Data Completeness" title={KPI_TITLES.complete} />
      </div>
      {scopeActive && !loading && (
        <p className="am-note am-scope">
          These figures cover the {kpis.covered} asset{kpis.covered === 1 ? '' : 's'} matching your filters, of {enrichedAssets.length} in the register.
        </p>
      )}

      <Tabs variant="line" label="Asset views" value={activeTab} onChange={setActiveTab}
        tabs={[
          { key: 'registry', label: 'Asset Registry' },
          { key: 'charts', label: 'Fleet Composition' },
          { key: 'health', label: 'Health Matrix' },
        ]} />

      {/* ── Filter row ─────────────────────────────────────────────────────── */}
      <div className="cc-filters am-filters">
        <label className="cc-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" aria-label="Search assets" value={search}
            onChange={e => setFilters({ search: e.target.value, page: '1' })}
            placeholder="Search assets by ID, make, model, site..." />
        </label>
        <label className="cc-field">
          <span>Asset Type</span>
          <select className="cc-select" value={filterType} onChange={e => setFilters({ type: e.target.value, page: '1' })}>
            <option value="">All types</option>
            {typeOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="cc-field">
          <span>Site</span>
          <select className="cc-select" value={filterSite} onChange={e => setFilters({ site: e.target.value, page: '1' })}>
            <option value="">All sites</option>
            {siteOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        {activeCountry === 'All' && (
          <label className="cc-field">
            <span>Country</span>
            <select className="cc-select" value={filterCountry} onChange={e => setFilters({ country: e.target.value, page: '1' })}>
              <option value="">All countries</option>
              {countryOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        )}
        <label className="cc-field">
          <span>Health Status</span>
          <select className="cc-select" value={filterHealth} onChange={e => setFilters({ health: e.target.value, page: '1' })}>
            <option value="">All status</option>
            <option value="good">Good (80 and above)</option>
            <option value="monitor">Monitor (50 to 79)</option>
            <option value="critical">Critical (below 50)</option>
            <option value="none">Not measured</option>
          </select>
        </label>
        <label className="cc-field">
          <span>Compliance</span>
          <select className="cc-select" value={filterComp} onChange={e => setFilters({ comp: e.target.value, page: '1' })}
            title={`From the recorded ${COMPLIANCE_FIELDS.map(f => f.label).join(', ')} expiry dates`}>
            <option value="">All status</option>
            {Object.entries(COMPLIANCE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </label>
        <div className="am-filter-actions">
          <button type="button" className="cc-btn-ghost" aria-expanded={showMore} aria-controls="am-more" onClick={() => setShowMore(v => !v)}>
            <SlidersHorizontal size={15} aria-hidden="true" /> More{(filterStatus || filterRisk || filterOps) ? ' (on)' : ''}
          </button>
          <Popover open={menu === 'views'} onClose={closeMenu} width={260} role="dialog" label="Saved views"
            trigger={(ref) => (
              <button ref={ref} type="button" className="cc-btn-ghost" aria-haspopup="dialog" aria-expanded={menu === 'views'} onClick={() => setMenu(m => (m === 'views' ? null : 'views'))}>
                <Bookmark size={15} aria-hidden="true" /> Saved Views <ChevronDown size={14} aria-hidden="true" />
              </button>
            )}>
            <p className="am-pop-title">Saved views</p>
            {views.length === 0 && <p className="am-pop-empty">No saved views yet. Save the current filters below.</p>}
            {views.map(v => (
              <div key={v.name} className="am-pop-row">
                <button type="button" className="am-pop-item" onClick={() => applyView(v)}>{v.name}</button>
                <button type="button" className="cc-icon-btn" aria-label={`Delete view ${v.name}`} onClick={() => deleteView(v.name)}><Trash2 size={13} aria-hidden="true" /></button>
              </div>
            ))}
            <form className="am-pop-save" onSubmit={e => { e.preventDefault(); saveView() }}>
              <input aria-label="View name" placeholder="Name this view" value={viewName} onChange={e => setViewName(e.target.value)} maxLength={40} />
              <button type="submit" className="cc-btn-primary" disabled={!viewName.trim()}>Save</button>
            </form>
            <p className="am-pop-empty">Saved on this device only.</p>
          </Popover>
          <Popover open={menu === 'export'} onClose={closeMenu} width={200} label="Export"
            trigger={(ref) => (
              <button ref={ref} type="button" className="cc-btn-ghost" aria-haspopup="menu" aria-expanded={menu === 'export'}
                disabled={loading || !!loadError || filteredAssets.length === 0} onClick={() => setMenu(m => (m === 'export' ? null : 'export'))}>
                <Download size={15} aria-hidden="true" /> Export
              </button>
            )}>
            <button type="button" role="menuitem" className="am-pop-item" onClick={handleExcelExport}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
            <button type="button" role="menuitem" className="am-pop-item" onClick={handlePdfExport}><FileText size={14} aria-hidden="true" /> PDF</button>
            <p className="am-pop-empty">{selected.size ? `${fmtInt(selected.size)} ticked rows` : `All ${fmtInt(filteredAssets.length)} filtered assets`}</p>
          </Popover>
          <button type="button" className="cc-icon-btn am-refresh" onClick={() => setRefreshKey(k => k + 1)} aria-label="Refresh assets" disabled={loading}>
            <RefreshCw size={15} className={loading ? 'am-spin' : ''} aria-hidden="true" />
          </button>
          {isAdmin && (
            <button type="button" className="cc-btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={15} aria-hidden="true" /> {t('assetmgmt.actions.addAsset')}
            </button>
          )}
        </div>
      </div>
      {showMore && (
        <div className="cc-filters am-more" id="am-more">
          <label className="cc-field">
            <span>Status</span>
            <select className="cc-select" value={filterStatus} onChange={e => setFilters({ status: e.target.value, page: '1' })}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="cc-field">
            <span>Worst Tyre Risk</span>
            <select className="cc-select" value={filterRisk} onChange={e => setFilters({ risk: e.target.value, page: '1' })}>
              <option value="">All</option>
              {['Critical', 'High', 'Medium', 'Low'].map(r => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="cc-field">
            <span>Operational status</span>
            <select className="cc-select" value={filterOps} onChange={e => setFilters({ ops: e.target.value, page: '1' })}>
              <option value="">All</option>
              {opsOptions.map(o => <option key={o} value={o}>{OPS_STATUS[o]?.label || o}</option>)}
            </select>
          </label>
        </div>
      )}
      {(hasFilter || search) && (
        <div className="am-chips">
          {filterCat && <span className="cc-pill info">Category: {filterCat}</span>}
          {filterCell && <span className="cc-pill info">Matrix: {filterCell.split(':')[0]} health, {filterCell.split(':')[1]} utilization</span>}
          <button type="button" className="cc-link cc-link-btn" onClick={clearFilters}><XIcon size={13} aria-hidden="true" /> Clear filters</button>
        </div>
      )}

      {/* ── Asset Registry Tab ─────────────────────────────────────────────── */}
      {activeTab === 'registry' && (
        <>
          <div className="am-cards">
            <CompositionCard segments={compSegments} total={compAssets.length} active={filterCat}
              onSelect={s => setFilters({ cat: filterCat === s.label ? '' : s.label, page: '1' })}
              onViewAll={() => setActiveTab('charts')} />
            <HealthMatrixCard grid={grid} active={filterCell} utilState={utilState}
              onSelect={cell => setFilters({ cell, page: '1' })}
              onViewAll={() => setActiveTab('health')} />
            <TrendCard state={utilState === 'none' ? 'ready' : utilState} series={trend.series} average={trend.average}
              months={trendMonths} onMonths={setTrendMonths} />
          </div>

          {/* Table. The wrapper anchors the scroll-restore hook, so returning
              from /asset-management/:assetNo lands on the same row. */}
          <section ref={listRef} className="cc-card am-registry" aria-label="Asset Registry">
            <div className="cc-card-head">
              <h2 className="cc-card-title" aria-live="polite">
                Asset Registry <span className="am-count">
                  ({filteredAssets.length} asset{filteredAssets.length !== 1 ? 's' : ''}
                  {filteredAssets.length !== enrichedAssets.length && `, filtered from ${enrichedAssets.length}`})
                </span>
              </h2>
              <div className="am-head-actions">
                {selected.size > 0 && (
                  <>
                    <span className="am-sel">{fmtInt(selected.size)} selected</span>
                    <button type="button" className="cc-link cc-link-btn" onClick={() => setSelected(new Set())}>Clear selection</button>
                  </>
                )}
                <Popover open={menu === 'columns'} onClose={closeMenu} width={240} height={420} role="dialog" label="Customize columns"
                  trigger={(ref) => (
                    <button ref={ref} type="button" className="cc-btn-ghost" aria-haspopup="dialog" aria-expanded={menu === 'columns'} onClick={() => setMenu(m => (m === 'columns' ? null : 'columns'))}>
                      <Settings2 size={15} aria-hidden="true" /> Customize Columns
                    </button>
                  )}>
                  <p className="am-pop-title">Columns</p>
                  {COLUMN_DEFS.filter(c => !c.always).map(c => (
                    <label key={c.key} className="am-pop-check">
                      <input type="checkbox" checked={columns.includes(c.key)} onChange={() => toggleColumn(c.key)} /> {c.label}
                    </label>
                  ))}
                  <button type="button" className="cc-link cc-link-btn am-pop-reset" onClick={resetColumns}>Reset to default</button>
                </Popover>
              </div>
            </div>

            {loading ? (
              <div style={{ display: 'grid', gap: 8 }}>{Array.from({ length: 8 }, (_, i) => <div key={i} className="cc-skel" style={{ height: 38 }} />)}</div>
            ) : loadError ? (
              <div className="cc-empty" role="alert">
                <div>
                  <b>Could not load fleet assets</b><br />{loadError}<br />
                  <button type="button" className="cc-btn" onClick={() => setRefreshKey(k => k + 1)}>Retry</button>
                </div>
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="cc-empty">
                {hasFilter || search ? 'No assets match these filters. Clear a filter to widen the list.' : 'No assets in the register yet. Add your first asset.'}
              </div>
            ) : (
              <KitTable className="am-table" manualPagination showPagination={false} enableSorting={false}
                pageIndex={page} pageSize={pageSize} pageCount={Math.max(1, Math.ceil(filteredAssets.length / pageSize))}
                totalRows={filteredAssets.length} getRowId={(a) => String(a.id ?? a.asset_no)}
                onRowClick={(a) => openAsset(a.asset_no)} rows={pageAssets} columns={registryColumns} />
            )}

            {!loading && !loadError && filteredAssets.length > 0 && (
              <Pager page={page} pageSize={pageSize} total={filteredAssets.length} noun="assets"
                sizes={PAGE_SIZE_OPTIONS} onPage={setPage} onPageSize={setPageSize} />
            )}
          </section>
        </>
      )}

      {/* ── Fleet Composition Tab ────────────────────────────────────────── */}
      {activeTab === 'charts' && (
        <>
          {/* The composition charts follow the filters above. Said in words
              rather than left to be assumed. */}
          {scopeActive && (
            <p className="am-note am-scope">
              These charts cover the assets matching the filters set on the Registry tab, of {enrichedAssets.length} in the register. Each chart holds out the filter it breaks down.
            </p>
          )}
          <div className="am-two">
            <Card title="Vehicle Type Distribution">
              <div className="am-chart" role="img" aria-label={`Vehicle types: ${typeChartData.labels.slice(0, 5).map((l, i) => `${l} ${typeChartData.datasets[0].data[i]}`).join(', ')}`}>
                {typeChartData.labels.length
                  ? <Doughnut data={typeChartData} options={DONUT_OPTS} />
                  : <div className="cc-empty">No data available</div>}
              </div>
            </Card>
            <Card title="Assets per Site by Tyre Risk">
              <div className="am-chart" role="img" aria-label={`Assets per site across ${siteRiskChartData.labels.length} sites, stacked by worst tyre risk.`}>
                {siteRiskChartData.labels.length
                  ? <Bar data={siteRiskChartData} options={{ ...CHART_OPTS, scales: { ...CHART_OPTS.scales, x: { ...CHART_OPTS.scales.x, stacked: true }, y: { ...CHART_OPTS.scales.y, stacked: true } } }} />
                  : <div className="cc-empty">No site data available</div>}
              </div>
            </Card>
          </div>
          <Card title="Fleet Summary by Type"
            sub={`Averages rest only on the assets that carry the measure: cost on assets with tyre records, health on scored assets. A type with none reads N/A. Average YTD tyre cost per active asset: ${kpis.avgCost == null ? 'N/A' : fmtCurrency(kpis.avgCost, activeCurrency)}.`}>
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
          </Card>
        </>
      )}

      {/* ── Health Matrix Tab ─────────────────────────────────────────────── */}
      {activeTab === 'health' && (
        <>
          <Card title="Asset Health Score Matrix"
            sub="Score = tread compliance (40%) + risk level (40%) + inspection recency (20%). Sorted by score, lowest first; assets with no tyre records have no score and sit last."
            action={(
              <div className="am-legend">
                <span><i className="am-sw-g" />80 to 100</span><span><i className="am-sw-a" />50 to 79</span><span><i className="am-sw-r" />Below 50</span>
              </div>
            )}>
            <p className="am-note" aria-live="polite">
              {bands.good} good, {bands.monitor} monitor, {bands.critical} critical, {bands.none} not measured.
            </p>
            <div className="am-tiles">
              {matrixAssets.map(a => {
                const band = conditionBand(a._healthScore)
                return (
                  <button type="button" key={a.id ?? a.asset_no} className={`am-tile am-tile-${band}`} onClick={() => openAsset(a.asset_no)}
                    aria-label={`${a.asset_no}, ${a._healthScore == null ? 'no health score' : `health ${a._healthScore}`}${a._worstRisk ? `, worst risk ${a._worstRisk}` : ''}`}>
                    <i aria-hidden="true" />
                    <b>{a.asset_no}</b>
                    <small>{a._category}</small>
                    <span className="am-tile-foot">
                      {a._healthScore != null ? <strong>{a._healthScore}</strong> : <small title="No tyre records yet">No data</small>}
                      {a._worstRisk && <small style={{ color: RISK_COLOR[a._worstRisk]?.hex }}>{a._worstRisk}</small>}
                    </span>
                  </button>
                )
              })}
              {!loading && matrixAssets.length === 0 && <div className="cc-empty" style={{ gridColumn: '1 / -1' }}>No active assets to display.</div>}
            </div>
          </Card>

          {lowHealth.length > 0 && (
            <Card title="Low Health Assets: review required" sub="Active, scored assets below 60, lowest first.">
              <div className="cc-list">
                {lowHealth.map(a => (
                  <button type="button" key={a.id ?? a.asset_no} className="cc-row am-lowrow" onClick={() => openAsset(a.asset_no)}>
                    <span className={`am-score am-tile-${conditionBand(a._healthScore)}`}>{a._healthScore}</span>
                    <VehicleThumb row={a} size="sm" />
                    <span className="cc-row-main">
                      <span className="cc-row-title">{a.asset_no}</span>
                      <span className="cc-row-meta">{a._category} | {a.site ?? 'N/A'}</span>
                    </span>
                    {a._worstRisk && <span className={`cc-pill ${RISK_COLOR[a._worstRisk]?.tone || 'muted'}`}>{a._worstRisk}</span>}
                    <span className="cc-row-time">{a._activeCount} tyres</span>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── Add/Edit Modal ─────────────────────────────────────────────────────── */}
      {(showAdd || editAsset) && (
        <AssetModal
          asset={editAsset ?? null}
          sites={siteOptions}
          countries={countryOptions.length ? countryOptions : ['KSA','UAE','Egypt']}
          onSave={() => { setShowAdd(false); setEditAsset(null); setRefreshKey(k => k + 1) }}
          onClose={() => { setShowAdd(false); setEditAsset(null) }}
        />
      )}
    </div>
  )
}
