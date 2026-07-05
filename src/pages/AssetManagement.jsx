import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  Truck, Plus, Edit2, X, Save, Search, Filter, Download,
  FileSpreadsheet, FileText, RefreshCw, ChevronLeft, ChevronRight,
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Clock,
  DollarSign, Activity, Shield, BarChart2, TrendingUp, Eye,
  ToggleLeft, ToggleRight, MapPin, Globe, Calendar, Zap, Target,
  Award, Layers, Info,
} from 'lucide-react'
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton'
import * as assetApi from '../lib/api/assetManagement'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatCurrencyCompact, formatDate, formatMonthYear } from '../lib/formatters'
import PageHeader from '../components/ui/PageHeader'
import CustomFieldsPanel from '../components/CustomFieldsPanel'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ──────────────────────────────────────────────────────────────────
const PAGE_SIZE = 25

const RISK_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 }
const RISK_COLOR = {
  Critical: { bg: 'bg-red-900/50',    text: 'text-red-300',    hex: '#dc2626' },
  High:     { bg: 'bg-orange-900/50', text: 'text-orange-300', hex: '#ea580c' },
  Medium:   { bg: 'bg-yellow-900/50', text: 'text-yellow-300', hex: '#ca8a04' },
  Low:      { bg: 'bg-green-900/50',  text: 'text-green-300',  hex: '#16a34a' },
}
const SCORE_COLOR = (s) => {
  if (s >= 80) return 'bg-green-500'
  if (s >= 60) return 'bg-yellow-500'
  if (s >= 40) return 'bg-orange-500'
  return 'bg-red-500'
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
    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color:'var(--text-muted)' } },
    y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color:'var(--text-muted)' } },
  },
}
const DONUT_OPTS = {
  ...CHART_OPTS,
  scales: undefined,
  plugins: {
    ...CHART_OPTS.plugins,
    legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12, padding: 12 } },
  },
}

const PALETTE = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16']

const VEHICLE_TYPES = ['Truck','Tipper','Mixer','Rigid','Semi-Trailer','Pickup','Crane','Loader','Tanker','Bus','Other']

const EMPTY_ASSET = (country = 'KSA') => ({
  asset_no: '', vehicle_type: '', make: '', model: '', year: '',
  site: '', country, active: true,
})

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n, dec = 0) {
  if (n == null || isNaN(n)) return '-'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
// Shared formatters; currency is always supplied from activeCurrency at call sites.
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
    if (t.risk_level && (best === null || (RISK_ORDER[t.risk_level] ?? 99) < (RISK_ORDER[best] ?? 99))) return t.risk_level
    return best
  }, null)
}
function healthScore(tyres, latestDate) {
  if (!tyres?.length) return 0
  const treadScore = tyres.reduce((sum, t) => {
    const td = parseFloat(t.tread_depth) || 0
    if (td >= 6) return sum + 100
    if (td >= 4) return sum + 70
    if (td >= 2) return sum + 40
    return sum + 10
  }, 0) / tyres.length
  const riskScore = tyres.reduce((sum, t) => {
    const map = { Low: 100, Medium: 70, High: 40, Critical: 10 }
    return sum + (map[t.risk_level] ?? 50)
  }, 0) / tyres.length
  const days = latestDate ? daysSince(latestDate) : 999
  const recencyScore = days <= 7 ? 100 : days <= 14 ? 80 : days <= 30 ? 60 : days <= 60 ? 30 : 0
  return Math.round(treadScore * 0.4 + riskScore * 0.4 + recencyScore * 0.2)
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

// ── Asset Detail Drawer ────────────────────────────────────────────────────────
function AssetDrawer({ asset, tyres = [], workOrders, currency, onClose }) {
  const { t } = useLanguage()
  const activeTyres = tyres.filter(t => !t.km_at_removal)
  const totalCost = tyres.reduce((s, t) => s + (parseFloat(t.cost_per_tyre) || 0) * (Number(t.qty) || 1), 0)

  // Monthly tyre cost chart (last 12 months)
  const monthlyData = useMemo(() => {
    const now = new Date()
    const labels = []
    const costs = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      labels.push(formatMonthYear(d))
      const mo = d.getMonth()
      const yr = d.getFullYear()
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
      fill: true,
      tension: 0.4,
      pointRadius: 3,
    }],
  }

  const assetWOs = (workOrders ?? []).filter(w => w.asset_no === asset.asset_no).slice(0, 5)

  // Recommendations engine
  const recommendations = []
  const criticalTyres = activeTyres.filter(t => t.risk_level === 'Critical')
  const highTyres = activeTyres.filter(t => t.risk_level === 'High')
  const lowTread = activeTyres.filter(t => parseFloat(t.tread_depth) < 3)
  if (criticalTyres.length) recommendations.push({ level: 'Critical', msg: t('assetmgmt.drawer.recCriticalRisk', { count: criticalTyres.length }) })
  if (highTyres.length) recommendations.push({ level: 'High', msg: t('assetmgmt.drawer.recHighRisk', { count: highTyres.length }) })
  if (lowTread.length) recommendations.push({ level: 'High', msg: t('assetmgmt.drawer.recLowTread', { count: lowTread.length }) })
  if (!activeTyres.length) recommendations.push({ level: 'Medium', msg: t('assetmgmt.drawer.recNoActive') })
  if (recommendations.length === 0) recommendations.push({ level: 'Low', msg: t('assetmgmt.drawer.recAllGood') })

  return (
    <motion.div
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.3 }}
      className="fixed right-0 top-0 h-full w-full max-w-2xl bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-gray-800 bg-gray-900 shrink-0">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">{t('assetmgmt.drawer.assetProfile')}</p>
          <h2 className="text-xl font-bold text-white">{asset.asset_no}</h2>
          <p className="text-sm text-gray-400">{asset.vehicle_type} · {asset.make} {asset.model} {asset.year}</p>
          <p className="text-xs text-gray-500 mt-0.5"><MapPin className="inline w-3 h-3 mr-1" />{asset.site ?? '-'}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${asset.active ? 'bg-green-900/50 text-green-300' : 'bg-gray-800 text-gray-400'}`}>
            {asset.active ? t('assetmgmt.drawer.active') : t('assetmgmt.drawer.inactive')}
          </span>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* Tyre Position Diagram */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2"><Layers className="w-4 h-4 text-blue-400" /> {t('assetmgmt.drawer.tyrePositionMap')}</h3>
          <div className="flex gap-4 items-start">
            <div className="flex-1">
              <TyrePositionDiagram tyres={activeTyres} />
            </div>
            <div className="flex flex-col gap-2 pt-4">
              {Object.entries(RISK_COLOR).map(([level, c]) => (
                <div key={level} className="flex items-center gap-2 text-xs">
                  <span className={`w-3 h-3 rounded-full`} style={{ background: c.hex }} />
                  <span className="text-gray-400">{level}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs mt-1">
                <span className="w-3 h-3 rounded-full bg-gray-600 opacity-40" />
                <span className="text-gray-400">{t('assetmgmt.drawer.noDataLegend')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Active Tyres Table */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Activity className="w-4 h-4 text-green-400" /> {t('assetmgmt.drawer.activeTyres', { count: activeTyres.length })}
            </h3>
          </div>
          {activeTyres.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-700">
                    {[
                      t('assetmgmt.drawer.columns.position'), t('assetmgmt.drawer.columns.serial'), t('assetmgmt.drawer.columns.brand'),
                      t('assetmgmt.drawer.columns.size'), t('assetmgmt.drawer.columns.tread'), t('assetmgmt.drawer.columns.risk'),
                      t('assetmgmt.drawer.columns.daysFitted'), t('assetmgmt.drawer.columns.cpk'),
                    ].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeTyres.map((t, i) => {
                    const days = t.issue_date ? daysSince(t.issue_date) : null
                    const km = (parseFloat(t.km_at_removal) || 0) - (parseFloat(t.km_at_fitment) || 0)
                    const cpk = km > 0 && t.cost_per_tyre ? (parseFloat(t.cost_per_tyre) / km).toFixed(4) : '-'
                    const rc = RISK_COLOR[t.risk_level] ?? { bg: 'bg-gray-800', text: 'text-gray-400' }
                    return (
                      <tr key={t.id ?? i} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                        <td className="px-3 py-2 font-mono text-gray-300">{t.position ?? '-'}</td>
                        <td className="px-3 py-2 text-gray-300">{t.serial_number ?? '-'}</td>
                        <td className="px-3 py-2 text-gray-300">{t.brand ?? '-'}</td>
                        <td className="px-3 py-2 text-gray-400">{t.size ?? '-'}</td>
                        <td className="px-3 py-2 text-gray-300">{t.tread_depth ? `${t.tread_depth}mm` : '-'}</td>
                        <td className="px-3 py-2">
                          {t.risk_level ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${rc.bg} ${rc.text}`}>{t.risk_level}</span>
                          ) : <span className="text-gray-600">-</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-400">{days != null ? `${days}d` : '-'}</td>
                        <td className="px-3 py-2 text-gray-400">{cpk}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-gray-500 text-sm">{t('assetmgmt.drawer.noActiveTyres')}</div>
          )}
        </div>

        {/* Monthly Cost Chart */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-400" /> {t('assetmgmt.drawer.monthlyCostChartTitle')}
          </h3>
          <div className="h-44">
            <Line data={chartData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
          </div>
        </div>

        {/* Work Orders */}
        {assetWOs.length > 0 && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-400" /> {t('assetmgmt.drawer.recentWorkOrders')}
              </h3>
            </div>
            <div className="divide-y divide-gray-700/50">
              {assetWOs.map((wo, i) => (
                <div key={wo.id ?? i} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-300">{wo.work_type ?? t('assetmgmt.drawer.workOrderFallback')}</p>
                    <p className="text-xs text-gray-500">{fmtDate(wo.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {wo.total_cost && <span className="text-xs text-gray-400">{fmtCurrency(wo.total_cost, currency)}</span>}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      wo.status === 'Completed' ? 'bg-green-900/50 text-green-300' :
                      wo.status === 'Open' ? 'bg-blue-900/50 text-blue-300' :
                      'bg-yellow-900/50 text-yellow-300'
                    }`}>{wo.status ?? '-'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lifetime Cost */}
        <div className="bg-gradient-to-br from-blue-900/20 to-blue-800/10 rounded-xl border border-blue-800/30 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest">{t('assetmgmt.drawer.totalLifetimeCost')}</p>
            <p className="text-2xl font-bold text-white mt-1">{fmtCurrency(totalCost, currency)}</p>
            <p className="text-xs text-gray-500 mt-1">{t('assetmgmt.drawer.tyreRecordsTotal', { count: tyres.length })}</p>
          </div>
          <DollarSign className="w-10 h-10 text-blue-500 opacity-40" />
        </div>

        {/* Recommendations */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-purple-400" /> {t('assetmgmt.drawer.recommendations')}
          </h3>
          <div className="space-y-2">
            {recommendations.map((r, i) => {
              const rc = RISK_COLOR[r.level] ?? { bg: 'bg-gray-800', text: 'text-gray-400' }
              return (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg ${rc.bg} bg-opacity-20`}>
                  <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${rc.text}`} />
                  <p className={`text-xs ${rc.text}`}>{r.msg}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Additional imported fields */}
        <CustomFieldsPanel data={asset.custom_data} title={t('assetmgmt.drawer.customFieldsTitle')} />
      </div>
    </motion.div>
  )
}

// ── Add/Edit Asset Modal ────────────────────────────────────────────────────────
function AssetModal({ asset, sites, countries, onSave, onClose }) {
  const { t } = useLanguage()
  const [form, setForm] = useState(asset ?? EMPTY_ASSET())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isEdit = !!asset?.id || !!asset?.asset_no

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
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
        setError(dup ? t('assetmgmt.modal.errDuplicate') : (supaErr.message || t('assetmgmt.modal.errSaveFailed')))
        setSaving(false)
        return
      }
      onSave()
    } catch (e) {
      setError(e.message ?? t('assetmgmt.modal.errUnexpected'))
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
        className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-lg shadow-2xl"
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-400" />
            {isEdit ? t('assetmgmt.modal.editTitle') : t('assetmgmt.modal.addTitle')}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('assetmgmt.modal.assetNo')}</label>
              <input
                value={form.asset_no}
                onChange={e => set('asset_no', e.target.value.toUpperCase())}
                placeholder={t('assetmgmt.modal.placeholders.assetNo')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('assetmgmt.modal.vehicleType')}</label>
              <select
                value={form.vehicle_type}
                onChange={e => set('vehicle_type', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">{t('assetmgmt.modal.selectType')}</option>
                {VEHICLE_TYPES.map(vt => <option key={vt}>{vt}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('assetmgmt.modal.make')}</label>
              <input value={form.make} onChange={e => set('make', e.target.value)} placeholder={t('assetmgmt.modal.placeholders.make')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('assetmgmt.modal.model')}</label>
              <input value={form.model} onChange={e => set('model', e.target.value)} placeholder={t('assetmgmt.modal.placeholders.model')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('assetmgmt.modal.year')}</label>
              <input type="number" min="1990" max="2030" value={form.year} onChange={e => set('year', e.target.value)} placeholder={t('assetmgmt.modal.placeholders.year')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('assetmgmt.modal.site')}</label>
              <input value={form.site} onChange={e => set('site', e.target.value)} placeholder={t('assetmgmt.modal.placeholders.site')}
                list="am-sites-list"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500" />
              <datalist id="am-sites-list">{sites.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('assetmgmt.modal.country')}</label>
              <select value={form.country} onChange={e => set('country', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">{t('assetmgmt.modal.select')}</option>
                {(countries.length ? countries : ['KSA','UAE','Egypt']).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <label className="text-xs text-gray-400">{t('assetmgmt.modal.activeStatus')}</label>
              <button onClick={() => set('active', !form.active)} className="flex items-center gap-2">
                {form.active
                  ? <ToggleRight className="w-8 h-8 text-green-400" />
                  : <ToggleLeft className="w-8 h-8 text-gray-600" />}
                <span className={`text-sm font-medium ${form.active ? 'text-green-400' : 'text-gray-500'}`}>
                  {form.active ? t('assetmgmt.modal.active') : t('assetmgmt.modal.inactive')}
                </span>
              </button>
            </div>
          </div>
          {error && <p className="text-red-400 text-xs bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-5 pb-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 transition-colors">{t('assetmgmt.modal.cancel')}</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-50 transition-colors flex items-center gap-2">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? t('assetmgmt.modal.saving') : t('assetmgmt.modal.save')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'blue', trend }) {
  const { t } = useLanguage()
  const colors = {
    blue:   { bg: 'from-blue-900/30 to-blue-800/10',   border: 'border-blue-800/30',   icon: 'text-blue-400' },
    red:    { bg: 'from-red-900/30 to-red-800/10',     border: 'border-red-800/30',     icon: 'text-red-400' },
    green:  { bg: 'from-green-900/30 to-green-800/10', border: 'border-green-800/30',   icon: 'text-green-400' },
    yellow: { bg: 'from-yellow-900/30 to-yellow-800/10',border: 'border-yellow-800/30', icon: 'text-yellow-400' },
    purple: { bg: 'from-purple-900/30 to-purple-800/10',border: 'border-purple-800/30', icon: 'text-purple-400' },
  }
  const c = colors[color]
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className={`bg-gradient-to-br ${c.bg} rounded-xl border ${c.border} p-5 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-widest font-medium">{label}</span>
        <Icon className={`w-5 h-5 ${c.icon}`} />
      </div>
      <p className="text-2xl font-bold text-white leading-tight">{value ?? '-'}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
      {trend != null && (
        <p className={`text-xs font-medium flex items-center gap-1 ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingUp className="w-3 h-3 rotate-180" />}
          {t('assetmgmt.kpis.vsLastMonth', { percent: Math.abs(trend) })}
        </p>
      )}
    </motion.div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AssetManagement() {
  const { profile } = useAuth()
  const { activeCurrency, activeCountry } = useSettings()
  const { t } = useLanguage()
  const isAdmin = profile?.role === 'Admin'

  // ── data state ───────────────────────────────────────────────────────────────
  const [assets, setAssets] = useState([])
  const [overview, setOverview] = useState([])
  const [drawerTyres, setDrawerTyres] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  // ── filter state ─────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [filterSite, setFilterSite] = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterRisk, setFilterRisk] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // ── sort state ───────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState('asset_no')
  const [sortDir, setSortDir] = useState('asc')

  // ── pagination ───────────────────────────────────────────────────────────────
  const [page, setPage] = useState(0)

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [drawerAsset, setDrawerAsset] = useState(null)
  const [editAsset, setEditAsset] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [activeTab, setActiveTab] = useState('registry') // registry | charts | health

  // ── load data ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadAll()
  }, [refreshKey, activeCountry])

  async function loadAll() {
    setLoading(true)
    setLoadError('')
    try {
      const [assetsRes, ovRes, woRes] = await Promise.allSettled([
        assetApi.listFleetMaster(),
        assetApi.reportAssetOverview({ country: activeCountry }),
        assetApi.listAssetWorkOrders(),
      ])

      // Surface a hard load failure (offline / RLS-denied) rather than showing an
      // empty fleet that looks identical to "no assets".
      const assetErr = assetsRes.status === 'rejected'
        ? assetsRes.reason
        : assetsRes.value.error
      if (assetErr) throw new Error(assetErr.message || String(assetErr))

      let rawAssets = assetsRes.status === 'fulfilled' ? (assetsRes.value.data ?? []) : []
      const ov     = ovRes.status === 'fulfilled' ? (ovRes.value.data ?? []) : []
      const rawWOs = woRes.status === 'fulfilled' ? (woRes.value.data ?? []) : []

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
      setWorkOrders(rawWOs)
    } catch (e) {
      setLoadError(e.message || 'Failed to load fleet assets.')
      setAssets([])
    } finally {
      setLoading(false)
    }
  }

  // Lazy-load the open asset's tyres for the detail drawer.
  useEffect(() => {
    if (!drawerAsset) { setDrawerTyres([]); return }
    assetApi.listAssetTyres(drawerAsset.asset_no)
      .then(({ data }) => setDrawerTyres(data || []))
  }, [drawerAsset])

  // ── derived data ──────────────────────────────────────────────────────────────
  const overviewMap = useMemo(() => {
    const map = {}
    overview.forEach(o => { if (o.asset_no) map[o.asset_no] = o })
    return map
  }, [overview])

  const enrichedAssets = useMemo(() => {
    const now = Date.now()
    return assets.map(a => {
      const o = overviewMap[a.asset_no] || {}
      const latestDate = o.latest_date ?? null
      return {
        ...a,
        _activeCount: o.active_tyres ?? 0,
        _totalCount: o.total_tyres ?? 0,
        _worstRisk: o.worst_risk ?? null,
        _ytdCost: Number(o.ytd_cost) || 0,
        _latestDate: latestDate,
        _noRecentRecord: !latestDate || (now - new Date(latestDate).getTime()) > 60 * 86_400_000,
        _healthScore: o.health_score ?? 0,
      }
    })
  }, [assets, overviewMap])

  // ── filter + sort ─────────────────────────────────────────────────────────────
  const filteredAssets = useMemo(() => {
    let list = [...enrichedAssets]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        (a.asset_no ?? '').toLowerCase().includes(q) ||
        (a.make ?? '').toLowerCase().includes(q) ||
        (a.model ?? '').toLowerCase().includes(q)
      )
    }
    if (filterSite) list = list.filter(a => a.site === filterSite)
    if (filterCountry) list = list.filter(a => a.country === filterCountry)
    if (filterType) list = list.filter(a => a.vehicle_type === filterType)
    if (filterStatus === 'active') list = list.filter(a => a.active)
    if (filterStatus === 'inactive') list = list.filter(a => !a.active)
    if (filterRisk) list = list.filter(a => a._worstRisk === filterRisk)

    list.sort((a, b) => {
      let av = a[sortCol] ?? a[`_${sortCol}`] ?? ''
      let bv = b[sortCol] ?? b[`_${sortCol}`] ?? ''
      if (sortCol === '_ytdCost' || sortCol === '_healthScore') {
        av = Number(av); bv = Number(bv)
      } else {
        av = String(av).toLowerCase(); bv = String(bv).toLowerCase()
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [enrichedAssets, search, filterSite, filterCountry, filterType, filterStatus, filterRisk, sortCol, sortDir])

  // ── KPIs ──────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalActive = enrichedAssets.filter(a => a.active !== false).length
    const totalInactive = enrichedAssets.filter(a => a.active === false).length
    const atRisk = enrichedAssets.filter(a => a._worstRisk === 'Critical' || a._worstRisk === 'High').length
    const ytdStart = new Date(new Date().getFullYear(), 0, 1)
    const totalYtdCost = enrichedAssets.reduce((s, a) => s + (a._ytdCost || 0), 0)
    const avgCost = totalActive > 0 ? totalYtdCost / totalActive : 0
    const needsAttention = enrichedAssets.filter(a => a.active !== false && a._noRecentRecord).length
    return { totalActive, totalInactive, atRisk, avgCost, needsAttention }
  }, [enrichedAssets])

  // ── Filter options ─────────────────────────────────────────────────────────────
  const siteOptions = useMemo(() => [...new Set(assets.map(a => a.site).filter(Boolean))].sort(), [assets])
  const countryOptions = useMemo(() => [...new Set(assets.map(a => a.country).filter(Boolean))].sort(), [assets])
  const typeOptions = useMemo(() => [...new Set(assets.map(a => a.vehicle_type).filter(Boolean))].sort(), [assets])

  // ── Chart data ────────────────────────────────────────────────────────────────
  const typeChartData = useMemo(() => {
    const counts = {}
    enrichedAssets.forEach(a => { const t = a.vehicle_type ?? 'Unknown'; counts[t] = (counts[t] ?? 0) + 1 })
    const labels = Object.keys(counts)
    return {
      labels,
      datasets: [{
        data: labels.map(l => counts[l]),
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'),
        borderColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 2,
      }],
    }
  }, [enrichedAssets])

  const siteRiskChartData = useMemo(() => {
    const sites = [...new Set(enrichedAssets.map(a => a.site).filter(Boolean))].sort()
    return {
      labels: sites,
      datasets: [
        { label: 'Low', data: sites.map(s => enrichedAssets.filter(a => a.site === s && a._worstRisk === 'Low').length), backgroundColor: '#16a34acc', borderRadius: 4 },
        { label: 'Medium', data: sites.map(s => enrichedAssets.filter(a => a.site === s && a._worstRisk === 'Medium').length), backgroundColor: '#ca8a04cc', borderRadius: 4 },
        { label: 'High', data: sites.map(s => enrichedAssets.filter(a => a.site === s && a._worstRisk === 'High').length), backgroundColor: '#ea580ccc', borderRadius: 4 },
        { label: 'Critical', data: sites.map(s => enrichedAssets.filter(a => a.site === s && a._worstRisk === 'Critical').length), backgroundColor: '#dc2626cc', borderRadius: 4 },
      ],
    }
  }, [enrichedAssets])

  // ── Sort helper ───────────────────────────────────────────────────────────────
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
    setPage(0)
  }
  function SortIcon({ col }) {
    if (sortCol !== col) return <ChevronDown className="w-3 h-3 text-gray-600 inline ml-1" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-blue-400 inline ml-1" />
      : <ChevronDown className="w-3 h-3 text-blue-400 inline ml-1" />
  }

  // ── Pagination ────────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(filteredAssets.length / PAGE_SIZE)
  const pageAssets = filteredAssets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // ── Export ────────────────────────────────────────────────────────────────────
  function handleExcelExport() {
    const rows = filteredAssets.map(a => ({
      asset_no: a.asset_no,
      vehicle_type: a.vehicle_type ?? '',
      make: a.make ?? '',
      model: a.model ?? '',
      year: a.year ?? '',
      site: a.site ?? '',
      country: a.country ?? '',
      active: a.active ? 'Active' : 'Inactive',
      active_tyres: a._activeCount,
      worst_risk: a._worstRisk ?? '',
      ytd_cost: a._ytdCost ?? 0,
      last_service: fmtDate(a._latestDate),
      health_score: a._healthScore,
    }))
    exportToExcel(
      rows,
      ['asset_no','vehicle_type','make','model','year','site','country','active','active_tyres','worst_risk','ytd_cost','last_service','health_score'],
      ['Asset No','Type','Make','Model','Year','Site','Country','Status','Active Tyres','Worst Risk','YTD Cost','Last Service','Health Score'],
      `asset_register_${new Date().toISOString().slice(0,10)}`,
      'Assets'
    )
  }

  function handlePdfExport() {
    exportToPdf(
      filteredAssets.map(a => ({
        asset_no: a.asset_no,
        vehicle_type: a.vehicle_type ?? '-',
        make: `${a.make ?? ''} ${a.model ?? ''}`.trim() || '-',
        year: a.year ?? '-',
        site: a.site ?? '-',
        active_tyres: a._activeCount,
        worst_risk: a._worstRisk ?? '-',
        ytd_cost: fmtCurrency(a._ytdCost, activeCurrency),
        last_service: fmtDate(a._latestDate),
        health_score: `${a._healthScore}/100`,
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
      `asset_register_${new Date().toISOString().slice(0,10)}`
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="text-white space-y-6">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Page Header */}
        <PageHeader
          title="Asset Management"
          subtitle="Fleet registry · tyre profiling · health scoring · operational intelligence"
          icon={Truck}
          actions={<>
            <button onClick={() => setRefreshKey(k => k + 1)}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors border border-gray-700">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={handleExcelExport}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-green-400 hover:text-green-300 text-sm transition-colors border border-gray-700">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </button>
            <button onClick={handlePdfExport}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-red-400 hover:text-red-300 text-sm transition-colors border border-gray-700">
              <FileText className="w-4 h-4" /> PDF
            </button>
            {isAdmin && (
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors">
                <Plus className="w-4 h-4" /> Add Asset
              </button>
            )}
          </>}
        />

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
          <KpiCard icon={Truck} label="Total Active Assets" value={fmt(kpis.totalActive)} sub={`${fmt(kpis.totalInactive)} inactive`} color="blue" />
          <KpiCard icon={AlertTriangle} label="Fleet At Risk" value={fmt(kpis.atRisk)} sub="Critical or High risk" color="red" />
          <KpiCard icon={DollarSign} label="Avg Asset Cost YTD" value={fmtCurrency(kpis.avgCost, activeCurrency)} sub="Per active vehicle" color="purple" />
          <KpiCard icon={Clock} label="Needs Attention" value={fmt(kpis.needsAttention)} sub="No tyre record >60d" color="yellow" />
          <KpiCard icon={Activity} label="Active / Inactive" value={`${fmt(kpis.totalActive)} / ${fmt(kpis.totalInactive)}`} sub={`${enrichedAssets.length} total fleet`} color="green" />
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800 w-fit">
          {[
            { id: 'registry', label: 'Asset Registry', icon: Layers },
            { id: 'charts', label: 'Fleet Composition', icon: BarChart2 },
            { id: 'health', label: 'Health Matrix', icon: Shield },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}>
              <tab.icon className="w-4 h-4" />
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
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      value={search}
                      onChange={e => { setSearch(e.target.value); setPage(0) }}
                      placeholder="Search by asset no, make, model..."
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button onClick={() => setShowFilters(v => !v)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${showFilters ? 'bg-blue-900/40 border-blue-700 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
                    <Filter className="w-4 h-4" />
                    Filters
                    {(filterSite || filterCountry || filterType || filterStatus || filterRisk) && (
                      <span className="w-2 h-2 rounded-full bg-blue-400 ml-1" />
                    )}
                  </button>
                </div>

                <AnimatePresence>
                  {showFilters && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden">
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4 pt-4 border-t border-gray-800">
                        {[
                          { label: 'Site', value: filterSite, onChange: setFilterSite, opts: siteOptions },
                          { label: 'Country', value: filterCountry, onChange: setFilterCountry, opts: countryOptions },
                          { label: 'Vehicle Type', value: filterType, onChange: setFilterType, opts: typeOptions },
                        ].map(f => (
                          <div key={f.label}>
                            <label className="text-xs text-gray-500 mb-1 block">{f.label}</label>
                            <select value={f.value} onChange={e => { f.onChange(e.target.value); setPage(0) }}
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                              <option value="">All</option>
                              {f.opts.map(o => <option key={o}>{o}</option>)}
                            </select>
                          </div>
                        ))}
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Status</label>
                          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0) }}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                            <option value="">All</option>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Risk Level</label>
                          <select value={filterRisk} onChange={e => { setFilterRisk(e.target.value); setPage(0) }}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                            <option value="">All</option>
                            {['Critical','High','Medium','Low'].map(r => <option key={r}>{r}</option>)}
                          </select>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Table */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                  <span className="text-sm text-gray-400">
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
                  <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                    <AlertTriangle className="w-12 h-12 mb-3 text-red-400" />
                    <p className="text-red-300 font-medium">Could not load fleet assets</p>
                    <p className="text-gray-500 text-sm mt-1 max-w-md">{loadError}</p>
                    <button onClick={() => setRefreshKey(k => k + 1)} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
                      <RefreshCw size={16} /> Retry
                    </button>
                  </div>
                ) : pageAssets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-600">
                    <Truck className="w-12 h-12 mb-3 opacity-30" />
                    <p className="text-sm">No assets found. Adjust filters or add your first asset.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                          {[
                            { col: 'asset_no', label: 'Asset No' },
                            { col: 'vehicle_type', label: 'Type' },
                            { col: 'make', label: 'Make / Model' },
                            { col: 'year', label: 'Year' },
                            { col: 'site', label: 'Site' },
                            { col: null, label: 'Active Tyres' },
                            { col: '_worstRisk', label: 'Worst Risk' },
                            { col: '_ytdCost', label: 'YTD Cost' },
                            { col: '_latestDate', label: 'Last Service' },
                            { col: 'active', label: 'Status' },
                            { col: null, label: 'Actions' },
                          ].map(h => (
                            <th key={h.label}
                              onClick={h.col ? () => toggleSort(h.col) : undefined}
                              className={`px-4 py-3 text-left font-medium whitespace-nowrap ${h.col ? 'cursor-pointer hover:text-gray-300 select-none' : ''}`}>
                              {h.label}
                              {h.col && <SortIcon col={h.col} />}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageAssets.map((a, i) => {
                          const rc = RISK_COLOR[a._worstRisk]
                          return (
                            <tr key={a.id ?? a.asset_no ?? i}
                              className="border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors">
                              <td className="px-4 py-3 font-mono font-semibold text-blue-300">{a.asset_no}</td>
                              <td className="px-4 py-3 text-gray-300">{a.vehicle_type ?? '-'}</td>
                              <td className="px-4 py-3 text-gray-300 max-w-[140px] truncate">
                                {[a.make, a.model].filter(Boolean).join(' ') || '-'}
                              </td>
                              <td className="px-4 py-3 text-gray-400">{a.year ?? '-'}</td>
                              <td className="px-4 py-3 text-gray-400 max-w-[120px] truncate">{a.site ?? '-'}</td>
                              <td className="px-4 py-3 text-center">
                                <span className="font-semibold text-white">{a._activeCount}</span>
                                {a._totalCount > a._activeCount && (
                                  <span className="text-gray-600 text-xs ml-1">/{a._totalCount}</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {rc ? (
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${rc.bg} ${rc.text}`}>{a._worstRisk}</span>
                                ) : <span className="text-gray-600">-</span>}
                              </td>
                              <td className="px-4 py-3 text-gray-300">
                                {a._ytdCost > 0 ? fmtCurrency(a._ytdCost, activeCurrency) : <span className="text-gray-600">-</span>}
                              </td>
                              <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                                {a._latestDate ? (
                                  <span className={a._noRecentRecord ? 'text-orange-400' : ''}>
                                    {fmtDate(a._latestDate)}
                                  </span>
                                ) : <span className="text-gray-600">-</span>}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${a.active ? 'bg-green-900/50 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                                  {a.active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1">
                                  <button onClick={() => setDrawerAsset(a)}
                                    className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-blue-400 transition-colors" title="View detail">
                                    <Eye className="w-4 h-4" />
                                  </button>
                                  {isAdmin && (
                                    <button onClick={() => setEditAsset(a)}
                                      className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-yellow-400 transition-colors" title="Edit asset">
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 text-sm text-gray-400">
                    <span>Page {page + 1} of {totalPages}</span>
                    <div className="flex items-center gap-2">
                      <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                        className="p-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-30 transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        const pg = Math.max(0, Math.min(page - 2 + i, totalPages - 1))
                        return (
                          <button key={pg} onClick={() => setPage(pg)}
                            className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${pg === page ? 'bg-blue-600 text-white' : 'hover:bg-gray-800'}`}>
                            {pg + 1}
                          </button>
                        )
                      })}
                      <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                        className="p-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-30 transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Fleet Composition Tab ────────────────────────────────────────── */}
          {activeTab === 'charts' && (
            <motion.div key="charts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-blue-400" /> Vehicle Type Distribution
                  </h3>
                  <div className="h-64">
                    {typeChartData.labels.length ? (
                      <Doughnut data={typeChartData} options={DONUT_OPTS} />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-600 text-sm">No data available</div>
                    )}
                  </div>
                </div>

                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-green-400" /> Assets per Site by Risk Status
                  </h3>
                  <div className="h-64">
                    {siteRiskChartData.labels.length ? (
                      <Bar data={siteRiskChartData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins }, scales: { ...CHART_OPTS.scales, x: { ...CHART_OPTS.scales.x, stacked: true }, y: { ...CHART_OPTS.scales.y, stacked: true } } }} />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-600 text-sm">No site data available</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Summary stats */}
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                  <Award className="w-4 h-4 text-yellow-400" /> Fleet Summary by Type
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                        {['Vehicle Type','Count','Active','At Risk','Avg YTD Cost','Health Avg'].map(h => (
                          <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...new Set(enrichedAssets.map(a => a.vehicle_type ?? 'Unknown'))].sort().map(type => {
                        const group = enrichedAssets.filter(a => (a.vehicle_type ?? 'Unknown') === type)
                        const active = group.filter(a => a.active).length
                        const atRisk = group.filter(a => a._worstRisk === 'Critical' || a._worstRisk === 'High').length
                        const avgCost = group.reduce((s, a) => s + (a._ytdCost || 0), 0) / (group.length || 1)
                        const avgHealth = group.reduce((s, a) => s + a._healthScore, 0) / (group.length || 1)
                        return (
                          <tr key={type} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                            <td className="px-4 py-3 text-gray-300 font-medium">{type}</td>
                            <td className="px-4 py-3 text-white font-semibold">{group.length}</td>
                            <td className="px-4 py-3 text-green-400">{active}</td>
                            <td className="px-4 py-3">
                              {atRisk > 0 ? <span className="text-red-400 font-semibold">{atRisk}</span> : <span className="text-gray-600">0</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-300">{fmtCurrency(avgCost, activeCurrency)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-gray-800 rounded-full h-1.5 max-w-20">
                                  <div className={`h-1.5 rounded-full ${SCORE_COLOR(avgHealth)}`} style={{ width: `${avgHealth}%` }} />
                                </div>
                                <span className="text-gray-400 text-xs">{Math.round(avgHealth)}</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Health Matrix Tab ─────────────────────────────────────────────── */}
          {activeTab === 'health' && (
            <motion.div key="health" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="card">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                  <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-purple-400" /> Asset Health Score Matrix
                  </h3>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500" />80-100</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-500" />60-79</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-500" />40-59</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500" />0-39</div>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Score = Tread compliance (40%) + Risk level (40%) + Inspection recency (20%). Sorted by score ascending.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                  {[...enrichedAssets]
                    .filter(a => a.active !== false)
                    .sort((a, b) => a._healthScore - b._healthScore)
                    .map(a => (
                      <button
                        key={a.id ?? a.asset_no}
                        onClick={() => setDrawerAsset(a)}
                        className="bg-gray-800 rounded-lg p-3 text-left hover:bg-gray-700 transition-colors border border-gray-700 hover:border-gray-600 group"
                      >
                        <div className={`w-full h-1.5 rounded-full mb-2 ${SCORE_COLOR(a._healthScore)}`} />
                        <p className="text-xs font-mono font-semibold text-gray-200 truncate group-hover:text-white">{a.asset_no}</p>
                        <p className="text-xs text-gray-500 truncate">{a.vehicle_type ?? '-'}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-lg font-bold text-white">{a._healthScore}</span>
                          {a._worstRisk && (
                            <span className="text-xs" style={{ color: RISK_COLOR[a._worstRisk]?.hex }}>
                              {a._worstRisk?.[0]}
                            </span>
                          )}
                        </div>
                      </button>
                    ))
                  }
                  {enrichedAssets.filter(a => a.active !== false).length === 0 && (
                    <div className="col-span-full text-center py-12 text-gray-600 text-sm">
                      No active assets to display.
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom 10 worst */}
              {enrichedAssets.filter(a => a.active !== false && a._healthScore < 60).length > 0 && (
                <div className="bg-gray-900 rounded-xl border border-red-900/30 p-5">
                  <h3 className="text-sm font-semibold text-red-400 mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Low Health Assets - Immediate Review Required
                  </h3>
                  <div className="space-y-2">
                    {[...enrichedAssets]
                      .filter(a => a.active !== false && a._healthScore < 60)
                      .sort((a, b) => a._healthScore - b._healthScore)
                      .slice(0, 10)
                      .map(a => (
                        <div key={a.id ?? a.asset_no}
                          className="flex items-center justify-between p-3 bg-gray-800 rounded-lg border border-gray-700 hover:border-red-900/40 transition-colors cursor-pointer"
                          onClick={() => setDrawerAsset(a)}>
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-lg ${SCORE_COLOR(a._healthScore)} flex items-center justify-center font-bold text-white text-sm`}>
                              {a._healthScore}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-white font-mono">{a.asset_no}</p>
                              <p className="text-xs text-gray-500">{a.vehicle_type ?? '-'} · {a.site ?? '-'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            {a._worstRisk && (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${RISK_COLOR[a._worstRisk]?.bg} ${RISK_COLOR[a._worstRisk]?.text}`}>
                                {a._worstRisk}
                              </span>
                            )}
                            <span className="text-xs text-gray-500">{a._activeCount} tyres</span>
                            <Eye className="w-4 h-4 text-gray-600 hover:text-blue-400" />
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Asset Detail Drawer ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {drawerAsset && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setDrawerAsset(null)} />
            <AssetDrawer
              asset={drawerAsset}
              tyres={drawerTyres}
              workOrders={workOrders}
              currency={activeCurrency}
              onClose={() => setDrawerAsset(null)}
            />
          </>
        )}
      </AnimatePresence>

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
