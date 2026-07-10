import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar, ClipboardList, AlertTriangle, CheckCircle2, Clock, Users,
  ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText,
  Plus, X, Search, RefreshCw, Filter, ChevronDown, ChevronUp,
  Sliders, TrendingUp, TrendingDown, Minus, AlertOctagon, Eye,
  Trash2, Edit3, Check, MapPin, User, Layers, BarChart2, Lock,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/formatters'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

// ── Constants ──────────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const INTERVAL_OPTIONS = [7, 14, 30, 60]

// ── Helpers ────────────────────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10) }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function diffDays(a, b) {
  const msA = new Date(a + 'T00:00:00').getTime()
  const msB = new Date(b + 'T00:00:00').getTime()
  return Math.round((msB - msA) / 86400000)
}

function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

function weekLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const end = new Date(d); end.setDate(d.getDate() + 6)
  const fmt = dt => dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  return `${fmt(d)} - ${fmt(end)}`
}

function fmtDisplay(ds) {
  if (!ds) return '-'
  return formatDate(ds + 'T00:00:00', 'All', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Map a DB `inspection_schedules` row to the app-wide schedule item shape.
// The UI/exports use `inspection_date` and `type`; the DB uses
// `scheduled_date` and `inspection_type`. Normalise on read.
function dbRowToItem(r) {
  return {
    id: r.id,
    asset_no: r.asset_no || '',
    site: r.site || '',
    inspection_date: r.scheduled_date || '',
    inspection_time: r.inspection_time || '',
    inspector_name: r.inspector_name || '',
    type: r.inspection_type || 'Routine',
    priority: r.priority || null,
    status: r.status || 'Scheduled',
    notes: r.notes || '',
    country: r.country || null,
    created_at: r.created_at || null,
  }
}

// Map an app schedule item to a whitelisted DB write payload.
function itemToDbPayload(item) {
  return {
    asset_no: item.asset_no || null,
    site: item.site || null,
    scheduled_date: item.inspection_date || null,
    inspection_time: item.inspection_time || null,
    inspector_name: item.inspector_name || null,
    inspection_type: item.type || null,
    priority: item.priority || null,
    status: item.status || 'Scheduled',
    notes: item.notes || null,
  }
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, trend, color = 'blue', loading }) {
  const colors = {
    blue:   'from-blue-500/20 to-blue-600/5 border-blue-700/40 text-blue-400',
    green:  'from-green-500/20 to-green-600/5 border-green-700/40 text-green-400',
    red:    'from-red-500/20 to-red-600/5 border-red-700/40 text-red-400',
    yellow: 'from-yellow-500/20 to-yellow-600/5 border-yellow-700/40 text-yellow-400',
    purple: 'from-purple-500/20 to-purple-600/5 border-purple-700/40 text-purple-400',
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-xl border bg-gradient-to-br p-4 ${colors[color]}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">{label}</p>
          {loading
            ? <div className="h-8 w-20 bg-gray-700 animate-pulse rounded" />
            : <p className="text-2xl font-bold text-[var(--text-primary)]">{value}</p>
          }
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg bg-[var(--input-bg)]`}>
          <Icon size={18} className={colors[color].split(' ').find(c => c.startsWith('text-'))} />
        </div>
      </div>
      {trend !== undefined && !loading && (
        <div className="mt-2 flex items-center gap-1 text-xs">
          {trend > 0
            ? <><TrendingUp size={12} className="text-green-400" /><span className="text-green-400">+{trend}% vs last month</span></>
            : trend < 0
            ? <><TrendingDown size={12} className="text-red-400" /><span className="text-red-400">{trend}% vs last month</span></>
            : <><Minus size={12} className="text-gray-400" /><span className="text-gray-400">No change</span></>
          }
        </div>
      )}
    </motion.div>
  )
}

// ── Gap Status Badge ──────────────────────────────────────────────────────────
function GapBadge({ status }) {
  const map = {
    'On Track':   'bg-green-900/40 text-green-300 border-green-700/50',
    'Due Soon':   'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
    'Overdue':    'bg-red-900/40 text-red-300 border-red-700/50',
    'No History': 'bg-[var(--input-bg)] text-gray-400 border-[var(--input-border)]',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] || map['No History']}`}>
      {status}
    </span>
  )
}

// ── Schedule Modal ─────────────────────────────────────────────────────────────
function ScheduleModal({ onClose, onSave, prefill = null, assets = [], inspectors = [] }) {
  const [form, setForm] = useState({
    asset_no: prefill?.asset_no || '',
    inspection_date: prefill?.inspection_date || todayStr(),
    inspection_time: prefill?.inspection_time || '08:00',
    inspector_name: prefill?.inspector_name || '',
    site: prefill?.site || '',
    notes: prefill?.notes || '',
    type: prefill?.type || 'Routine',
    status: 'Scheduled',
  })
  const [assetSearch, setAssetSearch] = useState(form.asset_no)
  const [assetDropdown, setAssetDropdown] = useState(false)
  const [saving, setSaving] = useState(false)
  // Approval-engine gate: locks Save for an existing PM-service record while its
  // workflow is active (pending/in_review/returned) or locked (approved). Reset
  // whenever a different record is opened in this modal.
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [prefill?.id])

  const filteredAssets = useMemo(
    () => assets.filter(a => a.asset_no?.toLowerCase().includes(assetSearch.toLowerCase())).slice(0, 10),
    [assets, assetSearch]
  )

  async function handleSave() {
    // Block edits to a record whose approval workflow is active/locked.
    if (prefill?.id && wfLocked) return
    if (!form.asset_no || !form.inspection_date || !form.inspector_name) return
    setSaving(true)
    // `id` present → update; absent → insert (DB assigns uuid + timestamps).
    const item = { ...form, ...(prefill?.id ? { id: prefill.id } : {}) }
    const ok = await onSave(item)
    setSaving(false)
    return ok
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl w-full max-w-lg shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--input-border)]">
          <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Calendar size={16} className="text-blue-400" />
            {prefill?.id ? 'Edit Inspection' : 'Schedule Inspection'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--input-bg)] rounded-lg transition-colors">
            <X size={16} className="text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Asset No */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-400 mb-1">Asset No *</label>
            <input
              value={assetSearch}
              onChange={e => { setAssetSearch(e.target.value); setForm(f => ({ ...f, asset_no: e.target.value })); setAssetDropdown(true) }}
              onFocus={() => setAssetDropdown(true)}
              placeholder="Search or enter asset..."
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            {assetDropdown && filteredAssets.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg shadow-xl max-h-40 overflow-auto">
                {filteredAssets.map(a => (
                  <button
                    key={a.asset_no}
                    onClick={() => { setForm(f => ({ ...f, asset_no: a.asset_no, site: a.site || f.site })); setAssetSearch(a.asset_no); setAssetDropdown(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-gray-700 flex items-center justify-between"
                  >
                    <span>{a.asset_no}</span>
                    {a.site && <span className="text-xs text-gray-400">{a.site}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Date *</label>
              <input
                type="date"
                value={form.inspection_date}
                onChange={e => setForm(f => ({ ...f, inspection_date: e.target.value }))}
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Time</label>
              <input
                type="time"
                value={form.inspection_time}
                onChange={e => setForm(f => ({ ...f, inspection_time: e.target.value }))}
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Inspector */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Inspector *</label>
            <input
              list="inspector-list"
              value={form.inspector_name}
              onChange={e => setForm(f => ({ ...f, inspector_name: e.target.value }))}
              placeholder="Inspector name..."
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <datalist id="inspector-list">
              {inspectors.map(i => <option key={i} value={i} />)}
            </datalist>
          </div>

          {/* Site + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Site</label>
              <input
                value={form.site}
                onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
                placeholder="Site..."
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
              >
                {['Routine', 'Pressure', 'Visual', 'Full', 'Pre-Trip'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Additional notes..."
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          {/* PM Service Approval — only for an existing schedule record (edit mode). */}
          {prefill?.id && (
            <EntityApprovalPanel
              entityType="pm_service"
              entityId={prefill.id}
              entityLabel={prefill.asset_no || prefill.id}
              context={{
                asset_no: prefill.asset_no,
                due_date: prefill.inspection_date,
                service_type: prefill.type,
                status: prefill.status,
                site: prefill.site,
              }}
              onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
              title="PM Service Approval"
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--input-border)]">
          {prefill?.id && wfLocked && (
            <span className="flex items-center gap-1 text-xs text-yellow-400 mr-auto">
              <Lock size={12} /> Locked — in approval
            </span>
          )}
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-[var(--text-primary)] transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!form.asset_no || !form.inspection_date || !form.inspector_name || saving || (!!prefill?.id && wfLocked)}
            className="btn-primary gap-2 disabled:opacity-50"
          >
            {saving ? <><RefreshCw size={13} className="animate-spin" />Saving...</> : <><Check size={13} />Save</>}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Bulk Schedule Modal ────────────────────────────────────────────────────────
function BulkModal({ selected, inspectors, onClose, onSave }) {
  const [inspector, setInspector] = useState('')
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState(addDays(todayStr(), 6))
  const [type, setType] = useState('Routine')
  const [saving, setSaving] = useState(false)

  function buildDates() {
    const dates = []
    let cur = startDate
    while (cur <= endDate) { dates.push(cur); cur = addDays(cur, 1) }
    return dates
  }

  async function handleSave() {
    if (!inspector || !startDate || !endDate) return
    setSaving(true)
    const dates = buildDates()
    const items = selected.map((v, i) => ({
      asset_no: v.asset_no,
      site: v.site || '',
      inspector_name: inspector,
      inspection_date: dates[i % dates.length],
      inspection_time: '08:00',
      type,
      notes: `Bulk scheduled - overdue by ${v.days_overdue} days`,
      status: 'Scheduled',
    }))
    await onSave(items)
    setSaving(false)
  }

  const dates = buildDates()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl w-full max-w-lg shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--input-border)]">
          <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Layers size={16} className="text-purple-400" />
            Bulk Schedule - {selected.length} vehicles
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--input-bg)] rounded-lg transition-colors">
            <X size={16} className="text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Inspector *</label>
            <input
              list="bulk-inspector-list"
              value={inspector}
              onChange={e => setInspector(e.target.value)}
              placeholder="Assign inspector..."
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
            <datalist id="bulk-inspector-list">
              {inspectors.map(i => <option key={i} value={i} />)}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Start Date *</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">End Date *</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                min={startDate}
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Inspection Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-purple-500"
            >
              {['Routine', 'Pressure', 'Visual', 'Full', 'Pre-Trip'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="bg-[var(--input-bg)] rounded-lg p-3 text-xs text-gray-400">
            {dates.length} working date{dates.length !== 1 ? 's' : ''} · {selected.length} vehicles distributed across dates
            {dates.length > 0 && selected.length > 0 && (
              <span className="ml-1">≈ {Math.ceil(selected.length / dates.length)} per day</span>
            )}
          </div>

          <div className="max-h-32 overflow-auto space-y-1">
            {selected.map((v, i) => (
              <div key={v.asset_no} className="flex items-center justify-between text-xs px-2 py-1 bg-[var(--input-bg)] rounded">
                <span className="text-[var(--text-primary)] font-medium">{v.asset_no}</span>
                <span className="text-gray-400">{v.site}</span>
                <span className="text-blue-400">{dates[i % Math.max(dates.length, 1)] || startDate}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--input-border)]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-[var(--text-primary)] transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!inspector || !startDate || !endDate || saving}
            className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {saving ? <><RefreshCw size={13} className="animate-spin" />Scheduling...</> : <><Check size={13} />Schedule All</>}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function InspectionPlanner() {
  const { activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const { profile } = useAuth()

  // Raw data
  const [inspections, setInspections] = useState([])
  const [tyreRecords, setTyreRecords] = useState([])
  const [schedule, setSchedule] = useState([])
  const [scheduleLoading, setScheduleLoading] = useState(true)
  const [scheduleError, setScheduleError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Config
  const [interval, setIntervalDays] = useState(30)

  // UI
  const [tab, setTab] = useState('overdue')
  const [modal, setModal] = useState(null) // null | 'schedule' | 'bulk' | 'edit'
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [prefillAsset, setPrefillAsset] = useState(null)
  const [selectedBulk, setSelectedBulk] = useState([])
  const [overdueSearch, setOverdueSearch] = useState('')
  const [gapSearch, setGapSearch] = useState('')
  const [gapFilter, setGapFilter] = useState('All')
  const [calendarPeriod, setCalendarPeriod] = useState(0) // weeks offset
  const [exportLoading, setExportLoading] = useState(false)

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setRefreshing(true)
    try {
      let inspQ = supabase
        .from('inspections')
        .select('id, asset_no, tyre_serial, inspection_date, inspector, site, country, pressure_reading')
        .order('inspection_date', { ascending: false })

      let tyreQ = supabase
        .from('tyre_records')
        .select('id, asset_no, serial_number, site, country, risk_level, tread_depth, issue_date')

      if (activeCountry && activeCountry !== 'All') {
        inspQ = inspQ.eq('country', activeCountry)
        tyreQ = tyreQ.eq('country', activeCountry)
      }

      const [inspRes, tyreRes] = await Promise.all([inspQ, tyreQ])
      // Normalise DB column `inspector` to the app-wide `inspector_name` shape so
      // every downstream consumer (schedule, exports, analytics) reads one field.
      setInspections((inspRes.data || []).map(r => ({ ...r, inspector_name: r.inspector })))
      setTyreRecords(tyreRes.data || [])
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Schedule fetch (Supabase) ──────────────────────────────────────────────────
  const fetchSchedule = useCallback(async () => {
    setScheduleLoading(true)
    setScheduleError(null)
    try {
      let q = supabase
        .from('inspection_schedules')
        .select('id, asset_no, site, scheduled_date, inspection_time, inspector_name, inspection_type, priority, status, notes, country, created_at')
        .order('scheduled_date', { ascending: true })

      if (activeCountry && activeCountry !== 'All') {
        // Null-safe: include rows tagged for this country OR with no country set.
        q = q.or(`country.eq.${activeCountry},country.is.null`)
      }

      const { data, error } = await q
      if (error) throw error
      setSchedule((data || []).map(dbRowToItem))
    } catch (err) {
      setScheduleError(err?.message || 'Failed to load inspection schedule.')
      setSchedule([])
    } finally {
      setScheduleLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { fetchSchedule() }, [fetchSchedule])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const today = todayStr()

  const distinctAssets = useMemo(() => {
    const map = new Map()
    inspections.forEach(r => {
      if (!map.has(r.asset_no)) map.set(r.asset_no, { asset_no: r.asset_no, site: r.site, country: r.country })
    })
    tyreRecords.forEach(r => {
      if (!map.has(r.asset_no)) map.set(r.asset_no, { asset_no: r.asset_no, site: r.site, country: r.country })
    })
    return Array.from(map.values()).filter(a => a.asset_no)
  }, [inspections, tyreRecords])

  const distinctInspectors = useMemo(() => {
    const s = new Set(inspections.map(r => r.inspector_name).filter(Boolean))
    schedule.forEach(s2 => s2.inspector_name && s.add(s2.inspector_name))
    return Array.from(s).sort()
  }, [inspections, schedule])

  // Last inspection per asset
  const lastInspectionByAsset = useMemo(() => {
    const map = new Map()
    inspections.forEach(r => {
      const cur = map.get(r.asset_no)
      if (!cur || r.inspection_date > cur.inspection_date) map.set(r.asset_no, r)
    })
    return map
  }, [inspections])

  // Risk level per asset from tyre_records
  const riskByAsset = useMemo(() => {
    const map = new Map()
    const order = { Critical: 4, High: 3, Medium: 2, Low: 1 }
    tyreRecords.forEach(r => {
      if (!r.asset_no) return
      const cur = map.get(r.asset_no)
      if (!cur || (order[r.risk_level] || 0) > (order[cur] || 0)) map.set(r.asset_no, r.risk_level)
    })
    return map
  }, [tyreRecords])

  // Current week bounds
  const weekBounds = useMemo(() => {
    const d = new Date(today + 'T00:00:00')
    d.setDate(d.getDate() - d.getDay())
    const start = d.toISOString().slice(0, 10)
    const end = addDays(start, 6)
    return { start, end }
  }, [today])

  // Current month bounds
  const monthBounds = useMemo(() => {
    const d = new Date(today + 'T00:00:00')
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const end = new Date(nextMonth - 1).toISOString().slice(0, 10)
    return { start, end }
  }, [today])

  const lastMonthBounds = useMemo(() => {
    const d = new Date(today + 'T00:00:00')
    const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(firstOfMonth - 1).toISOString().slice(0, 10)
    const start = `${new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() - 1, 1).toISOString().slice(0, 10)}`
    return { start, end }
  }, [today])

  // KPIs
  const kpiData = useMemo(() => {
    const thisWeek = inspections.filter(r => r.inspection_date >= weekBounds.start && r.inspection_date <= weekBounds.end).length
    const thisMonth = inspections.filter(r => r.inspection_date >= monthBounds.start && r.inspection_date <= monthBounds.end).length
    const lastMonth = inspections.filter(r => r.inspection_date >= lastMonthBounds.start && r.inspection_date <= lastMonthBounds.end).length
    const monthTrend = lastMonth === 0 ? 0 : Math.round(((thisMonth - lastMonth) / lastMonth) * 100)

    // Overdue: assets whose last inspection is > interval days ago (or never inspected)
    const overdue = distinctAssets.filter(a => {
      const last = lastInspectionByAsset.get(a.asset_no)
      if (!last) return true
      return diffDays(last.inspection_date, today) > interval
    }).length

    // Compliance: scheduled this month that have a matching completed inspection
    const scheduledThisMonth = schedule.filter(s => s.inspection_date >= monthBounds.start && s.inspection_date <= monthBounds.end)
    const completedScheduled = scheduledThisMonth.filter(s => {
      return inspections.some(r => r.asset_no === s.asset_no &&
        Math.abs(diffDays(r.inspection_date, s.inspection_date)) <= 3)
    }).length
    const compliance = scheduledThisMonth.length > 0
      ? Math.round((completedScheduled / scheduledThisMonth.length) * 100)
      : (distinctAssets.length > 0 ? Math.round(((distinctAssets.length - overdue) / distinctAssets.length) * 100) : 0)

    // Inspector workload
    const activeInspectors = new Set(
      inspections
        .filter(r => r.inspection_date >= monthBounds.start)
        .map(r => r.inspector_name)
        .filter(Boolean)
    )
    const avgPerInspector = activeInspectors.size > 0
      ? Math.round(thisMonth / activeInspectors.size)
      : 0

    return { thisWeek, overdue, compliance, thisMonth, lastMonth, monthTrend, avgPerInspector, activeInspectors: activeInspectors.size }
  }, [inspections, distinctAssets, lastInspectionByAsset, weekBounds, monthBounds, lastMonthBounds, interval, today, schedule])

  // Overdue queue
  const overdueQueue = useMemo(() => {
    return distinctAssets
      .map(a => {
        const last = lastInspectionByAsset.get(a.asset_no)
        const daysSince = last ? diffDays(last.inspection_date, today) : 9999
        const daysOverdue = daysSince - interval
        if (daysOverdue <= 0) return null
        return {
          asset_no: a.asset_no,
          site: a.site || '-',
          last_inspection: last?.inspection_date || null,
          days_overdue: daysOverdue,
          last_risk: riskByAsset.get(a.asset_no) || 'Unknown',
          inspector: last?.inspector_name || '-',
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.days_overdue - a.days_overdue)
  }, [distinctAssets, lastInspectionByAsset, today, interval, riskByAsset])

  const filteredOverdue = useMemo(() => {
    if (!overdueSearch) return overdueQueue
    const q = overdueSearch.toLowerCase()
    return overdueQueue.filter(r =>
      r.asset_no?.toLowerCase().includes(q) ||
      r.site?.toLowerCase().includes(q) ||
      r.inspector?.toLowerCase().includes(q)
    )
  }, [overdueQueue, overdueSearch])

  // Gap analysis
  const gapAnalysis = useMemo(() => {
    return distinctAssets.map(a => {
      const last = lastInspectionByAsset.get(a.asset_no)
      const daysSince = last ? diffDays(last.inspection_date, today) : null
      let status = 'No History'
      if (daysSince !== null) {
        const ratio = daysSince / interval
        if (ratio <= 0.75) status = 'On Track'
        else if (ratio <= 1.0) status = 'Due Soon'
        else status = 'Overdue'
      }
      return {
        asset_no: a.asset_no,
        site: a.site || '-',
        days_since: daysSince,
        recommended: interval,
        status,
        inspector: last?.inspector_name || '-',
      }
    })
  }, [distinctAssets, lastInspectionByAsset, today, interval])

  const filteredGap = useMemo(() => {
    return gapAnalysis.filter(r => {
      if (gapFilter !== 'All' && r.status !== gapFilter) return false
      if (!gapSearch) return true
      const q = gapSearch.toLowerCase()
      return r.asset_no?.toLowerCase().includes(q) || r.site?.toLowerCase().includes(q)
    })
  }, [gapAnalysis, gapFilter, gapSearch])

  // Inspector board
  const inspectorBoard = useMemo(() => {
    return distinctInspectors.map(name => {
      const all = inspections.filter(r => r.inspector_name === name)
      const thisWeekCount = all.filter(r => r.inspection_date >= weekBounds.start && r.inspection_date <= weekBounds.end).length
      const thisMonthCount = all.filter(r => r.inspection_date >= monthBounds.start && r.inspection_date <= monthBounds.end).length
      const daysInMonth = new Date(today + 'T00:00:00').getDate()
      const avgPerDay = daysInMonth > 0 ? (thisMonthCount / daysInMonth).toFixed(1) : 0
      const totalScheduled = schedule.filter(s => s.inspector_name === name &&
        s.inspection_date >= monthBounds.start && s.inspection_date <= monthBounds.end).length
      const completionRate = totalScheduled > 0
        ? Math.round((thisMonthCount / totalScheduled) * 100)
        : null
      const siteSet = new Set(all.slice(0, 50).map(r => r.site).filter(Boolean))
      const topSite = all.length > 0 ? (all[0].site || '-') : '-'
      return { name, thisWeekCount, thisMonthCount, avgPerDay, completionRate, topSite, total: all.length }
    }).sort((a, b) => b.thisMonthCount - a.thisMonthCount)
  }, [distinctInspectors, inspections, weekBounds, monthBounds, today, schedule])

  // Frequency by site (last 6 months)
  const siteFrequencyData = useMemo(() => {
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today + 'T00:00:00')
      d.setMonth(d.getMonth() - i)
      months.push({ label: MONTH_NAMES[d.getMonth()], year: d.getFullYear(), month: d.getMonth() + 1 })
    }
    const sites = [...new Set(inspections.map(r => r.site).filter(Boolean))].slice(0, 6)
    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

    const datasets = sites.map((site, si) => ({
      label: site,
      data: months.map(m => inspections.filter(r =>
        r.site === site &&
        new Date(r.inspection_date + 'T00:00:00').getMonth() + 1 === m.month &&
        new Date(r.inspection_date + 'T00:00:00').getFullYear() === m.year
      ).length),
      backgroundColor: COLORS[si % COLORS.length] + '99',
      borderColor: COLORS[si % COLORS.length],
      borderWidth: 1,
      borderRadius: 4,
    }))

    return { labels: months.map(m => m.label), datasets }
  }, [inspections, today])

  // Calendar view (upcoming 30 days from offset)
  const calendarWeeks = useMemo(() => {
    const baseDate = new Date(today + 'T00:00:00')
    baseDate.setDate(baseDate.getDate() + calendarPeriod * 7)
    const startStr = baseDate.toISOString().slice(0, 10)
    const endStr = addDays(startStr, 29)

    const allItems = [
      ...schedule.filter(s => s.inspection_date >= startStr && s.inspection_date <= endStr).map(s => ({
        ...s,
        _source: 'scheduled',
        _status: s.status || 'Scheduled',
      })),
      ...inspections.filter(r => r.inspection_date >= startStr && r.inspection_date <= endStr).map(r => ({
        id: r.id,
        asset_no: r.asset_no,
        inspector_name: r.inspector_name,
        site: r.site,
        inspection_date: r.inspection_date,
        type: 'Completed',
        _source: 'db',
        _status: 'Completed',
      })),
    ]

    const weeks = new Map()
    allItems.forEach(item => {
      const ws = weekStart(item.inspection_date)
      if (!weeks.has(ws)) weeks.set(ws, [])
      weeks.get(ws).push(item)
    })

    return Array.from(weeks.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ws, items]) => ({
        weekStr: ws,
        label: weekLabel(ws),
        items: items.sort((a, b) => a.inspection_date.localeCompare(b.inspection_date)),
      }))
  }, [schedule, inspections, today, calendarPeriod])

  // ── Schedule CRUD (Supabase) ──────────────────────────────────────────────────
  // Country tag applied to new rows so they remain scoped under active filter.
  const writeCountry = activeCountry && activeCountry !== 'All' ? activeCountry : null

  async function handleSaveSchedule(item) {
    try {
      const payload = itemToDbPayload(item)
      if (item.id) {
        // Update existing schedule row.
        const { error } = await supabase
          .from('inspection_schedules')
          .update(payload)
          .eq('id', item.id)
        if (error) throw error
      } else {
        // Insert new schedule row; DB assigns id + timestamps.
        const { error } = await supabase
          .from('inspection_schedules')
          .insert({ ...payload, country: writeCountry, created_by: profile?.id || null })
        if (error) throw error
      }
      await fetchSchedule()
      setModal(null)
      setEditTarget(null)
      setPrefillAsset(null)
      return true
    } catch (err) {
      setScheduleError(err?.message || 'Failed to save inspection.')
      return false
    }
  }

  async function handleBulkSave(items) {
    try {
      const rows = items.map(it => ({
        ...itemToDbPayload(it),
        country: writeCountry,
        created_by: profile?.id || null,
      }))
      const { error } = await supabase.from('inspection_schedules').insert(rows)
      if (error) throw error
      await fetchSchedule()
      setModal(null)
      setSelectedBulk([])
      return true
    } catch (err) {
      setScheduleError(err?.message || 'Failed to bulk-schedule inspections.')
      return false
    }
  }

  async function handleCancelSchedule(id) {
    try {
      const { error } = await supabase
        .from('inspection_schedules')
        .update({ status: 'Cancelled' })
        .eq('id', id)
      if (error) throw error
      await fetchSchedule()
    } catch (err) {
      setScheduleError(err?.message || 'Failed to cancel inspection.')
    }
  }

  async function handleDeleteSchedule() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      const { data, error } = await supabase
        .from('inspection_schedules')
        .delete()
        .eq('id', deleteTarget.id)
        .select('id')
      if (error) throw error
      if ((data?.length ?? 0) === 0) {
        throw new Error('The inspection could not be deleted - you may not have permission, or it was already removed.')
      }
      setDeleteTarget(null)
      await fetchSchedule()
    } catch (err) {
      setDeleteError(err?.message || 'Failed to delete inspection. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────────
  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    setExportLoading(true)
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'Inspection Schedule', formatDate(new Date()), company, brand)

    const rows = schedule.filter(s => s.status !== 'Cancelled').map(s => [
      s.asset_no || '',
      s.inspection_date || '',
      s.inspection_time || '',
      s.inspector_name || '',
      s.site || '',
      s.type || '',
      s.status || '',
      s.notes || '',
    ])

    if (rows.length === 0) {
      pdfEmptyState(doc, 'No scheduled inspections for the selected period')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save('inspection_schedule.pdf')
      setExportLoading(false)
      return
    }

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 28,
      head: [['Asset', 'Date', 'Time', 'Inspector', 'Site', 'Type', 'Status', 'Notes']],
      body: rows,
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save('inspection_schedule.pdf')
    setExportLoading(false)
  }

  async function exportExcel() {
    const XLSX = await import('xlsx')
    setExportLoading(true)
    const wb = XLSX.utils.book_new()

    // Schedule sheet
    const schedRows = schedule.map(s => ({
      'Asset No': s.asset_no,
      'Date': s.inspection_date,
      'Time': s.inspection_time,
      'Inspector': s.inspector_name,
      'Site': s.site,
      'Type': s.type,
      'Status': s.status,
      'Notes': s.notes,
    }))
    const ws1 = XLSX.utils.json_to_sheet(schedRows)
    XLSX.utils.book_append_sheet(wb, ws1, 'Schedule')

    // Compliance sheet
    const compRows = gapAnalysis.map(r => ({
      'Asset No': r.asset_no,
      'Site': r.site,
      'Days Since Inspection': r.days_since ?? 'Never',
      'Recommended Interval': r.recommended,
      'Gap Status': r.status,
      'Inspector': r.inspector,
    }))
    const ws2 = XLSX.utils.json_to_sheet(compRows)
    XLSX.utils.book_append_sheet(wb, ws2, 'Compliance Report')

    XLSX.writeFile(wb, 'inspection_planner.xlsx')
    setExportLoading(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'overdue',    label: 'Overdue Queue',     icon: AlertOctagon },
    { id: 'calendar',  label: 'Calendar',           icon: Calendar },
    { id: 'inspector', label: 'Inspector Board',    icon: Users },
    { id: 'frequency', label: 'Frequency by Site',  icon: BarChart2 },
    { id: 'gap',       label: 'Gap Analysis',       icon: Sliders },
  ]

  const statusBadge = {
    Scheduled:  'bg-blue-900/40 text-blue-300 border-blue-700/50',
    Completed:  'bg-green-900/40 text-green-300 border-green-700/50',
    Cancelled:  'bg-[var(--input-bg)] text-gray-400 border-[var(--input-border)]',
    'In Progress': 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  }

  const riskBadge = {
    Critical: 'bg-red-900/40 text-red-300',
    High:     'bg-orange-900/40 text-orange-300',
    Medium:   'bg-yellow-900/40 text-yellow-300',
    Low:      'bg-green-900/40 text-green-300',
    Unknown:  'bg-[var(--input-bg)] text-gray-400',
  }

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
      tooltip: { backgroundColor: 'var(--panel-2)', titleColor: '#f9fafb', bodyColor: '#d1d5db' },
    },
    scales: {
      x: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
      y: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' }, beginAtZero: true },
    },
  }

  return (
    <div className="text-[var(--text-primary)] space-y-6">
      {/* Header */}
      <PageHeader
        title="Inspection Planner & Scheduler"
        subtitle={`${distinctAssets.length} assets · ${overdueQueue.length} overdue · ${schedule.filter(s => s.status === 'Scheduled').length} upcoming`}
        icon={ClipboardList}
        actions={<>
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="p-2 bg-[var(--input-bg)] hover:bg-gray-700 border border-[var(--input-border)] rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin text-blue-400' : 'text-gray-400'} />
          </button>
          <button
            onClick={exportExcel}
            disabled={exportLoading}
            className="flex items-center gap-2 px-3 py-2 bg-[var(--input-bg)] hover:bg-gray-700 border border-[var(--input-border)] rounded-lg text-sm text-gray-300 transition-colors"
          >
            <FileSpreadsheet size={14} className="text-green-400" />Excel
          </button>
          <button
            onClick={exportPdf}
            disabled={exportLoading}
            className="flex items-center gap-2 px-3 py-2 bg-[var(--input-bg)] hover:bg-gray-700 border border-[var(--input-border)] rounded-lg text-sm text-gray-300 transition-colors"
          >
            <FileText size={14} className="text-red-400" />PDF
          </button>
          <button
            onClick={() => { setPrefillAsset(null); setModal('schedule') }}
            className="btn-primary gap-2"
          >
            <Plus size={14} />Schedule
          </button>
        </>}
      />

      {/* Schedule load error banner */}
      {scheduleError && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-red-950/40 border border-red-800/60 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-red-200">
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
            <span>{scheduleError}</span>
          </div>
          <button
            onClick={fetchSchedule}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg text-xs font-medium text-[var(--text-primary)] transition-colors whitespace-nowrap self-start sm:self-auto"
          >
            <RefreshCw size={12} className={scheduleLoading ? 'animate-spin' : ''} />Retry
          </button>
        </div>
      )}

      {/* Interval Config */}
      <div className="card">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-300 whitespace-nowrap">
            <Sliders size={14} className="text-blue-400" />
            <span>Inspection Interval:</span>
            <span className="font-semibold text-[var(--text-primary)]">{interval} days</span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {INTERVAL_OPTIONS.map(opt => (
              <button
                key={opt}
                onClick={() => setIntervalDays(opt)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  interval === opt
                    ? 'bg-blue-600 border-blue-500 text-[var(--text-primary)]'
                    : 'bg-[var(--input-bg)] border-[var(--input-border)] text-gray-400 hover:border-gray-600'
                }`}
              >
                {opt}d
              </button>
            ))}
            <div className="flex-1 sm:w-48 ml-2">
              <input
                type="range"
                min="7"
                max="60"
                step="1"
                value={interval}
                onChange={e => setIntervalDays(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard
          icon={Calendar}
          label="This Week"
          value={loading ? '...' : kpiData.thisWeek}
          sub="Inspections completed"
          color="blue"
          loading={loading}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Overdue"
          value={loading ? '...' : kpiData.overdue}
          sub={`> ${interval}d since last`}
          color="red"
          loading={loading}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Compliance Rate"
          value={loading ? '...' : `${kpiData.compliance}%`}
          sub="On-time this month"
          color="green"
          loading={loading}
        />
        <KpiCard
          icon={BarChart2}
          label="This Month"
          value={loading ? '...' : kpiData.thisMonth}
          sub={`vs ${kpiData.lastMonth} last month`}
          color="yellow"
          trend={kpiData.monthTrend}
          loading={loading}
        />
        <KpiCard
          icon={Users}
          label="Inspector Workload"
          value={loading ? '...' : kpiData.avgPerInspector}
          sub={`avg · ${kpiData.activeInspectors} active inspectors`}
          color="purple"
          loading={loading}
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-[var(--input-border)]">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'bg-[var(--surface-1)] text-[var(--text-primary)] border border-[var(--input-border)] border-b-[var(--surface-1)] -mb-px'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <t.icon size={14} />
            {t.label}
            {t.id === 'overdue' && overdueQueue.length > 0 && (
              <span className="ml-1 bg-red-600 text-[var(--text-primary)] text-xs rounded-full px-1.5 py-0.5 min-w-[1.2rem] text-center">
                {overdueQueue.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {/* ── Overdue Queue ── */}
          {tab === 'overdue' && (
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 border-b border-[var(--input-border)]">
                <div className="flex items-center gap-2">
                  <AlertOctagon size={16} className="text-red-400" />
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">Overdue Inspection Queue</h2>
                  <span className="text-xs text-gray-400">({filteredOverdue.length} vehicles)</span>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-56">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      value={overdueSearch}
                      onChange={e => setOverdueSearch(e.target.value)}
                      placeholder="Search assets..."
                      className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  {selectedBulk.length > 0 && (
                    <button
                      onClick={() => setModal('bulk')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-xs font-medium text-[var(--text-primary)] transition-colors whitespace-nowrap"
                    >
                      <Layers size={12} />Schedule Bulk ({selectedBulk.length})
                    </button>
                  )}
                </div>
              </div>

              {loading ? (
                <div className="p-8 text-center">
                  <RefreshCw size={20} className="animate-spin text-blue-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Loading overdue queue...</p>
                </div>
              ) : filteredOverdue.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="No overdue inspections"
                  description="All vehicles are on schedule."
                  compact
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--input-border)] bg-[var(--surface-1)]">
                        <th className="w-8 px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selectedBulk.length === filteredOverdue.length && filteredOverdue.length > 0}
                            onChange={e => setSelectedBulk(e.target.checked ? [...filteredOverdue] : [])}
                            className="accent-blue-500"
                          />
                        </th>
                        {['Asset', 'Site', 'Last Inspection', 'Days Overdue', 'Last Risk', 'Inspector', ''].map(h => (
                          <th key={h} className="text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--input-border)]">
                      {filteredOverdue.map(row => {
                        const criticallyOverdue = row.days_overdue > interval * 2
                        const isSelected = selectedBulk.some(s => s.asset_no === row.asset_no)
                        return (
                          <tr
                            key={row.asset_no}
                            className={`transition-colors ${
                              criticallyOverdue ? 'bg-red-950/20 hover:bg-red-950/30' : 'hover:bg-[var(--input-bg)]'
                            }`}
                          >
                            <td className="px-4 py-2.5">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={e => setSelectedBulk(prev =>
                                  e.target.checked ? [...prev, row] : prev.filter(s => s.asset_no !== row.asset_no)
                                )}
                                className="accent-blue-500"
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`font-medium ${criticallyOverdue ? 'text-red-300' : 'text-[var(--text-primary)]'}`}>
                                {row.asset_no}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-300 text-xs">{row.site}</td>
                            <td className="px-3 py-2.5 text-gray-400 text-xs">
                              {row.last_inspection ? fmtDisplay(row.last_inspection) : <span className="text-gray-500">Never</span>}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`font-semibold text-xs px-2 py-0.5 rounded ${
                                criticallyOverdue ? 'bg-red-600 text-[var(--text-primary)]' : 'bg-red-900/40 text-red-300'
                              }`}>
                                {row.days_overdue}d
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`text-xs px-2 py-0.5 rounded ${riskBadge[row.last_risk] || riskBadge.Unknown}`}>
                                {row.last_risk}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-400 text-xs">{row.inspector}</td>
                            <td className="px-3 py-2.5">
                              <button
                                onClick={() => { setPrefillAsset(row); setModal('schedule') }}
                                className="px-3 py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-700/50 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
                              >
                                Schedule Now
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Calendar ── */}
          {tab === 'calendar' && (
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--input-border)]">
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-blue-400" />
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming Inspections - Next 30 Days</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCalendarPeriod(p => p - 1)}
                    className="p-1.5 bg-[var(--input-bg)] hover:bg-gray-700 border border-[var(--input-border)] rounded-lg transition-colors"
                  >
                    <ChevronLeft size={14} className="text-gray-400" />
                  </button>
                  <span className="text-xs text-gray-400 min-w-[80px] text-center">
                    {calendarPeriod === 0 ? 'This period' : calendarPeriod > 0 ? `+${calendarPeriod}w` : `${calendarPeriod}w`}
                  </span>
                  <button
                    onClick={() => setCalendarPeriod(p => p + 1)}
                    className="p-1.5 bg-[var(--input-bg)] hover:bg-gray-700 border border-[var(--input-border)] rounded-lg transition-colors"
                  >
                    <ChevronRight size={14} className="text-gray-400" />
                  </button>
                  <button
                    onClick={() => setCalendarPeriod(0)}
                    className="px-3 py-1.5 bg-[var(--input-bg)] hover:bg-gray-700 border border-[var(--input-border)] rounded-lg text-xs text-gray-400 transition-colors"
                  >
                    Today
                  </button>
                </div>
              </div>

              {(loading || scheduleLoading) ? (
                <div className="p-8 text-center">
                  <RefreshCw size={20} className="animate-spin text-blue-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Loading inspection schedule...</p>
                </div>
              ) : scheduleError ? (
                <div className="p-8 text-center">
                  <AlertTriangle size={32} className="text-red-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 mb-3">{scheduleError}</p>
                  <button
                    onClick={fetchSchedule}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium text-[var(--text-primary)] transition-colors inline-flex items-center gap-1.5"
                  >
                    <RefreshCw size={13} />Retry
                  </button>
                </div>
              ) : calendarWeeks.length === 0 ? (
                <div className="p-8 text-center">
                  <Calendar size={32} className="text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No inspections scheduled for this period.</p>
                  <button
                    onClick={() => setModal('schedule')}
                    className="btn-primary mt-3"
                  >
                    Schedule an Inspection
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-[var(--input-border)]">
                  {calendarWeeks.map(week => (
                    <div key={week.weekStr} className="p-4">
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <span className="w-1 h-4 bg-blue-500 rounded-full inline-block" />
                        {week.label}
                        <span className="font-normal text-gray-500">({week.items.length} inspections)</span>
                      </h3>
                      <div className="space-y-2">
                        {week.items.map(item => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-3 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] rounded-lg px-3 py-2 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="text-center min-w-[48px]">
                                <p className="text-xs text-gray-500">{formatDate(item.inspection_date + 'T00:00:00', 'All', { weekday: 'short' })}</p>
                                <p className="text-sm font-semibold text-[var(--text-primary)]">{new Date(item.inspection_date + 'T00:00:00').getDate()}</p>
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-[var(--text-primary)] truncate">{item.asset_no}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-xs border ${statusBadge[item._status] || statusBadge.Scheduled}`}>
                                    {item._status}
                                  </span>
                                  {item.type && item.type !== 'Completed' && (
                                    <span className="text-xs text-gray-500">{item.type}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                                  {item.inspector_name && <span className="flex items-center gap-1"><User size={10} />{item.inspector_name}</span>}
                                  {item.site && <span className="flex items-center gap-1"><MapPin size={10} />{item.site}</span>}
                                  {item.inspection_time && <span className="flex items-center gap-1"><Clock size={10} />{item.inspection_time}</span>}
                                </div>
                              </div>
                            </div>
                            {item._source === 'scheduled' && item._status !== 'Completed' && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => { setEditTarget(item); setModal('edit') }}
                                  className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                                  title="Edit"
                                >
                                  <Edit3 size={12} className="text-gray-300" />
                                </button>
                                <button
                                  onClick={() => handleCancelSchedule(item.id)}
                                  className="p-1.5 bg-gray-700 hover:bg-yellow-900/50 rounded-lg transition-colors"
                                  title="Cancel"
                                >
                                  <X size={12} className="text-yellow-400" />
                                </button>
                                <button
                                  onClick={() => { setDeleteError(''); setDeleteTarget(item) }}
                                  className="p-1.5 bg-gray-700 hover:bg-red-900/50 rounded-lg transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 size={12} className="text-red-400" />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Inspector Board ── */}
          {tab === 'inspector' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Users size={14} className="text-purple-400" />
                <span>{inspectorBoard.length} active inspectors</span>
              </div>
              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="card animate-pulse">
                      <div className="h-4 bg-gray-700 rounded w-32 mb-3" />
                      <div className="h-3 bg-[var(--input-bg)] rounded w-20 mb-2" />
                      <div className="h-2 bg-[var(--input-bg)] rounded w-full" />
                    </div>
                  ))}
                </div>
              ) : inspectorBoard.length === 0 ? (
                <div className="card">
                  <EmptyState
                    icon={Users}
                    title="No inspector data yet"
                    description="No inspector activity is available for this period."
                    compact
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {inspectorBoard.map((ins, idx) => {
                    const maxMonth = Math.max(...inspectorBoard.map(i => i.thisMonthCount), 1)
                    const pct = Math.round((ins.thisMonthCount / maxMonth) * 100)
                    return (
                      <motion.div
                        key={ins.name}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="card hover:border-[var(--input-border)] transition-colors"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{ins.name}</p>
                            <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                              <MapPin size={10} />{ins.topSite}
                            </p>
                          </div>
                          <div className="w-9 h-9 rounded-full bg-purple-900/40 border border-purple-700/40 flex items-center justify-center text-sm font-bold text-purple-300">
                            {ins.name.charAt(0).toUpperCase()}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                          <div className="bg-[var(--input-bg)] rounded-lg p-2 text-center">
                            <p className="text-lg font-bold text-[var(--text-primary)]">{ins.thisWeekCount}</p>
                            <p className="text-xs text-gray-500">This Week</p>
                          </div>
                          <div className="bg-[var(--input-bg)] rounded-lg p-2 text-center">
                            <p className="text-lg font-bold text-[var(--text-primary)]">{ins.thisMonthCount}</p>
                            <p className="text-xs text-gray-500">This Month</p>
                          </div>
                          <div className="bg-[var(--input-bg)] rounded-lg p-2 text-center">
                            <p className="text-lg font-bold text-[var(--text-primary)]">{ins.avgPerDay}</p>
                            <p className="text-xs text-gray-500">Avg/Day</p>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                            <span>Capacity</span>
                            <span>{pct}%</span>
                          </div>
                          <div className="h-2 bg-[var(--input-bg)] rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.6, ease: 'easeOut' }}
                              className={`h-full rounded-full ${
                                pct >= 80 ? 'bg-red-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-green-500'
                              }`}
                            />
                          </div>
                        </div>

                        {ins.completionRate !== null && (
                          <div className="mt-2 flex items-center justify-between text-xs">
                            <span className="text-gray-500">Completion rate</span>
                            <span className={`font-medium ${ins.completionRate >= 80 ? 'text-green-400' : ins.completionRate >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {ins.completionRate}%
                            </span>
                          </div>
                        )}
                      </motion.div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Frequency by Site ── */}
          {tab === 'frequency' && (
            <div className="card">
              <div className="flex items-center gap-2 mb-5">
                <BarChart2 size={16} className="text-blue-400" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Inspection Frequency by Site - Last 6 Months</h2>
              </div>
              {loading ? (
                <div className="h-72 bg-[var(--input-bg)] animate-pulse rounded-lg" />
              ) : siteFrequencyData.datasets.length === 0 ? (
                <div className="h-72 flex items-center justify-center text-gray-500 text-sm">
                  No site data available.
                </div>
              ) : (
                <div className="h-72">
                  <Bar data={siteFrequencyData} options={chartOpts} />
                </div>
              )}

              {/* Site Summary Table */}
              {!loading && siteFrequencyData.datasets.length > 0 && (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--input-border)]">
                        <th className="text-left py-2 px-3 text-gray-400 font-medium">Site</th>
                        <th className="text-right py-2 px-3 text-gray-400 font-medium">Total (6mo)</th>
                        <th className="text-right py-2 px-3 text-gray-400 font-medium">Avg/Month</th>
                        <th className="text-right py-2 px-3 text-gray-400 font-medium">Assets</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--input-border)]">
                      {siteFrequencyData.datasets.map((ds, i) => {
                        const total = ds.data.reduce((a, b) => a + b, 0)
                        const avg = (total / 6).toFixed(1)
                        const assetCount = new Set(inspections.filter(r => r.site === ds.label).map(r => r.asset_no)).size
                        return (
                          <tr key={ds.label} className="hover:bg-[var(--input-bg)] transition-colors">
                            <td className="py-2 px-3 text-[var(--text-primary)] flex items-center gap-2">
                              <span
                                className="w-2 h-2 rounded-full inline-block shrink-0"
                                style={{ backgroundColor: ds.borderColor }}
                              />
                              {ds.label}
                            </td>
                            <td className="py-2 px-3 text-right text-gray-300">{total}</td>
                            <td className="py-2 px-3 text-right text-gray-300">{avg}</td>
                            <td className="py-2 px-3 text-right text-gray-300">{assetCount}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Gap Analysis ── */}
          {tab === 'gap' && (
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 border-b border-[var(--input-border)]">
                <div className="flex items-center gap-2">
                  <Sliders size={16} className="text-yellow-400" />
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">Inspection Gap Analysis</h2>
                  <span className="text-xs text-gray-400">({filteredGap.length} vehicles)</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {['All', 'On Track', 'Due Soon', 'Overdue', 'No History'].map(f => (
                    <button
                      key={f}
                      onClick={() => setGapFilter(f)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        gapFilter === f
                          ? 'bg-yellow-600 border-yellow-500 text-[var(--text-primary)]'
                          : 'bg-[var(--input-bg)] border-[var(--input-border)] text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      value={gapSearch}
                      onChange={e => setGapSearch(e.target.value)}
                      placeholder="Search..."
                      className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg pl-7 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:border-yellow-500 w-36"
                    />
                  </div>
                </div>
              </div>

              {/* Summary badges */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-[var(--input-border)]">
                {['On Track', 'Due Soon', 'Overdue', 'No History'].map(s => {
                  const count = gapAnalysis.filter(r => r.status === s).length
                  const colors = {
                    'On Track':   'text-green-300 bg-green-900/20 border-green-800',
                    'Due Soon':   'text-yellow-300 bg-yellow-900/20 border-yellow-800',
                    'Overdue':    'text-red-300 bg-red-900/20 border-red-800',
                    'No History': 'text-gray-400 bg-[var(--input-bg)] border-[var(--input-border)]',
                  }
                  return (
                    <button
                      key={s}
                      onClick={() => setGapFilter(s)}
                      className={`rounded-lg border px-3 py-2 text-center transition-colors hover:opacity-80 ${colors[s]}`}
                    >
                      <p className="text-xl font-bold">{count}</p>
                      <p className="text-xs">{s}</p>
                    </button>
                  )
                })}
              </div>

              {loading ? (
                <div className="p-8 text-center">
                  <RefreshCw size={20} className="animate-spin text-yellow-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Analysing inspection gaps...</p>
                </div>
              ) : filteredGap.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No matching records"
                  description="No records match the selected filter."
                  compact
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--input-border)] bg-[var(--surface-1)]">
                        {['Asset', 'Site', 'Days Since', 'Interval', 'Gap Status', 'Inspector'].map(h => (
                          <th key={h} className="text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--input-border)]">
                      {filteredGap.slice(0, 200).map(row => (
                        <tr key={row.asset_no} className="hover:bg-[var(--input-bg)] transition-colors">
                          <td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">{row.asset_no}</td>
                          <td className="px-3 py-2.5 text-gray-300 text-xs">{row.site}</td>
                          <td className="px-3 py-2.5 text-gray-300 text-xs">
                            {row.days_since !== null ? `${row.days_since}d` : <span className="text-gray-500">Never</span>}
                          </td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{row.recommended}d</td>
                          <td className="px-3 py-2.5"><GapBadge status={row.status} /></td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{row.inspector}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredGap.length > 200 && (
                    <p className="text-xs text-gray-500 px-3 py-2">Showing 200 of {filteredGap.length} records.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Modals ── */}
      <AnimatePresence>
        {modal === 'schedule' && (
          <ScheduleModal
            key="schedule-modal"
            prefill={prefillAsset ? { asset_no: prefillAsset.asset_no, site: prefillAsset.site } : null}
            assets={distinctAssets}
            inspectors={distinctInspectors}
            onClose={() => { setModal(null); setPrefillAsset(null) }}
            onSave={handleSaveSchedule}
          />
        )}
        {modal === 'edit' && editTarget && (
          <ScheduleModal
            key="edit-modal"
            prefill={editTarget}
            assets={distinctAssets}
            inspectors={distinctInspectors}
            onClose={() => { setModal(null); setEditTarget(null) }}
            onSave={handleSaveSchedule}
          />
        )}
        {modal === 'bulk' && (
          <BulkModal
            key="bulk-modal"
            selected={selectedBulk}
            inspectors={distinctInspectors}
            onClose={() => setModal(null)}
            onSave={handleBulkSave}
          />
        )}
        {deleteTarget && (
          <div key="delete-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl w-full max-w-lg shadow-2xl"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--input-border)]">
                <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <Trash2 size={16} className="text-red-400" />
                  Delete Scheduled Inspection
                </h3>
                <button
                  onClick={() => { setDeleteTarget(null); setDeleteError('') }}
                  className="p-1 hover:bg-[var(--input-bg)] rounded-lg transition-colors"
                >
                  <X size={16} className="text-gray-400" />
                </button>
              </div>
              <div className="p-6">
                <div className="flex gap-3 mb-4">
                  <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[var(--text-primary)] font-medium">
                      Delete inspection for <span className="font-mono text-blue-400">{deleteTarget.asset_no}</span>
                      {deleteTarget.inspection_date ? ` on ${deleteTarget.inspection_date}` : ''}?
                    </p>
                    <p className="text-gray-400 text-sm mt-1">This removes the scheduled inspection permanently. Completed inspection records are not affected.</p>
                  </div>
                </div>
                {deleteError && (
                  <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{deleteError}</p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={handleDeleteSchedule}
                    disabled={deleting}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium text-[var(--text-primary)] transition-colors inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete Inspection'}
                  </button>
                  <button
                    onClick={() => { setDeleteTarget(null); setDeleteError('') }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
