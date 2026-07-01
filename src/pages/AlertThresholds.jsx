import { useState, useEffect, useCallback } from 'react'
import {
  Bell, BellOff, Plus, Edit2, Trash2, Mail, MailOff,
  CheckCircle, XCircle, Clock, Tag, Layers, Zap,
  ChevronRight, AlertTriangle, Gauge, Calendar, DollarSign,
  Search, Filter, X, Save, Loader2, ToggleLeft, ToggleRight,
} from 'lucide-react'
import * as alertThresholds from '../lib/api/alertThresholds'
import { useAuth } from '../contexts/AuthContext'
import { formatDistanceToNow } from 'date-fns'

// ─── Constants ────────────────────────────────────────────────────────────────

const METRICS = [
  { value: 'tread_depth',           label: 'Tread Depth',                unit: 'mm',   icon: Layers,        color: 'orange' },
  { value: 'pressure',              label: 'Tyre Pressure',              unit: 'PSI',  icon: Gauge,         color: 'blue' },
  { value: 'tyre_age_days',         label: 'Tyre Age',                   unit: 'days', icon: Calendar,      color: 'purple' },
  { value: 'cpk',                   label: 'Cost Per KM (CPK)',          unit: 'cost', icon: DollarSign,    color: 'green' },
  { value: 'inspection_overdue_days', label: 'Days Since Last Inspection', unit: 'days', icon: Clock,       color: 'yellow' },
]

const OPERATORS = [
  { value: 'lt',  label: 'is less than' },
  { value: 'lte', label: 'is less than or equal to' },
  { value: 'gt',  label: 'is greater than' },
  { value: 'gte', label: 'is greater than or equal to' },
  { value: 'eq',  label: 'equals' },
]

const PRESETS = [
  { name: 'Critical Tread Warning',   metric: 'tread_depth',             operator: 'lt',  threshold: 3,    notify_email: true,  notify_in_app: true },
  { name: 'Low Pressure Alert',        metric: 'pressure',                operator: 'lt',  threshold: 80,   notify_email: true,  notify_in_app: true },
  { name: 'Tyre Overdue Inspection',   metric: 'inspection_overdue_days', operator: 'gt',  threshold: 30,   notify_email: false, notify_in_app: true },
  { name: 'Ageing Tyres',             metric: 'tyre_age_days',           operator: 'gt',  threshold: 1095, notify_email: false, notify_in_app: true },
]

const METRIC_BORDER = {
  tread_depth:             'border-orange-500',
  pressure:                'border-blue-500',
  tyre_age_days:           'border-purple-500',
  cpk:                     'border-green-500',
  inspection_overdue_days: 'border-yellow-500',
}

const METRIC_BADGE = {
  tread_depth:             'bg-orange-500/20 text-orange-400',
  pressure:                'bg-blue-500/20 text-blue-400',
  tyre_age_days:           'bg-purple-500/20 text-purple-400',
  cpk:                     'bg-green-500/20 text-green-400',
  inspection_overdue_days: 'bg-yellow-500/20 text-yellow-400',
}

const METRIC_ICON_COLOR = {
  tread_depth:             'text-orange-400',
  pressure:                'text-blue-400',
  tyre_age_days:           'text-purple-400',
  cpk:                     'text-green-400',
  inspection_overdue_days: 'text-yellow-400',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function metaFor(metric) {
  return METRICS.find(m => m.value === metric) || METRICS[0]
}

function operatorLabel(op) {
  return OPERATORS.find(o => o.value === op)?.label ?? op
}

function humanDescription(threshold) {
  const meta  = metaFor(threshold.metric)
  const opLbl = operatorLabel(threshold.operator)
  return `${meta.label} ${opLbl} ${threshold.threshold}${meta.unit !== 'cost' ? ' ' + meta.unit : ''}`
}

function relativeTime(ts) {
  if (!ts) return null
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }) }
  catch { return null }
}

// ─── Empty / Presets ──────────────────────────────────────────────────────────

function EmptyState({ onNew, onPreset }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-8">
      <div className="w-20 h-20 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
        <Bell className="w-9 h-9 text-gray-500" />
      </div>
      <div className="text-center">
        <p className="text-gray-300 text-lg font-medium">No alert thresholds configured</p>
        <p className="text-gray-500 text-sm mt-1">Create rules to get notified when fleet metrics exceed safe limits.</p>
        <button
          onClick={onNew}
          className="mt-4 inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
        >
          Create your first rule <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Preset suggestions */}
      <div className="w-full max-w-3xl">
        <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Suggested presets</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PRESETS.map(p => {
            const meta = metaFor(p.metric)
            const Icon = meta.icon
            return (
              <button
                key={p.name}
                onClick={() => onPreset(p)}
                className="flex items-start gap-3 p-4 rounded-xl bg-gray-800 border border-gray-700 hover:border-orange-500/50 hover:bg-gray-750 transition-all text-left group"
              >
                <div className={`mt-0.5 p-2 rounded-lg ${METRIC_BADGE[p.metric]}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium group-hover:text-orange-400 transition-colors">{p.name}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{humanDescription(p)}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Threshold Card ───────────────────────────────────────────────────────────

function ThresholdCard({ threshold, onEdit, onDelete, onToggle }) {
  const meta = metaFor(threshold.metric)
  const Icon = meta.icon
  const triggered = relativeTime(threshold.last_triggered_at)
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)

  async function handleDelete() {
    if (!window.confirm(`Delete "${threshold.name}"?`)) return
    setDeleting(true)
    await onDelete(threshold.id)
    setDeleting(false)
  }

  async function handleToggle() {
    setToggling(true)
    await onToggle(threshold.id, !threshold.active)
    setToggling(false)
  }

  return (
    <div className={`relative bg-gray-800 rounded-xl border border-gray-700 border-l-4 ${METRIC_BORDER[threshold.metric]} overflow-hidden transition-all hover:border-gray-600`}>
      {/* Top row */}
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`shrink-0 mt-0.5 p-2 rounded-lg ${METRIC_BADGE[threshold.metric]}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm truncate">{threshold.name}</p>
              <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{humanDescription(threshold)}</p>
            </div>
          </div>
          {/* Active toggle */}
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={threshold.active ? 'Disable' : 'Enable'}
            className="shrink-0 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {toggling
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : threshold.active
                ? <ToggleRight className="w-6 h-6 text-orange-500" />
                : <ToggleLeft className="w-6 h-6" />
            }
          </button>
        </div>

        {/* Filters */}
        {(threshold.site_filter || threshold.brand_filter) && (
          <div className="flex flex-wrap gap-1.5 mt-2.5 ml-11">
            {threshold.site_filter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700 text-gray-300 text-xs">
                <Tag className="w-3 h-3" /> {threshold.site_filter}
              </span>
            )}
            {threshold.brand_filter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700 text-gray-300 text-xs">
                <Zap className="w-3 h-3" /> {threshold.brand_filter}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom row */}
      <div className="px-4 py-2.5 border-t border-gray-700/60 flex items-center justify-between gap-2">
        {/* Notification methods */}
        <div className="flex items-center gap-2">
          <span title={threshold.notify_email ? 'Email on' : 'Email off'}>
            {threshold.notify_email
              ? <Mail className="w-3.5 h-3.5 text-blue-400" />
              : <MailOff className="w-3.5 h-3.5 text-gray-600" />
            }
          </span>
          <span title={threshold.notify_in_app ? 'In-app on' : 'In-app off'}>
            {threshold.notify_in_app
              ? <Bell className="w-3.5 h-3.5 text-orange-400" />
              : <BellOff className="w-3.5 h-3.5 text-gray-600" />
            }
          </span>
          <span className="text-gray-600 text-xs mx-1">|</span>
          <span className="text-gray-500 text-xs">
            {threshold.triggered_count > 0
              ? `Triggered ${threshold.triggered_count} time${threshold.triggered_count !== 1 ? 's' : ''}`
              : 'Never triggered'
            }
          </span>
          {triggered && (
            <span className="text-gray-600 text-xs">· {triggered}</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(threshold)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-all"
            title="Edit"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
            title="Delete"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Inactive overlay */}
      {!threshold.active && (
        <div className="absolute inset-0 bg-gray-900/40 rounded-xl pointer-events-none" />
      )}
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: '',
  metric: 'tread_depth',
  operator: 'lt',
  threshold: '',
  site_filter: '',
  brand_filter: '',
  notify_email: true,
  notify_in_app: true,
  active: true,
}

function Modal({ mode, initial, onSave, onClose, saving }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial })
  const [errors, setErrors] = useState({})

  const unit = metaFor(form.metric).unit

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => { const n = { ...e }; delete n[key]; return n })
  }

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (form.threshold === '' || isNaN(Number(form.threshold))) e.threshold = 'Enter a valid number'
    if (!form.notify_email && !form.notify_in_app) e.notify = 'Enable at least one notification method'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    onSave({
      ...form,
      threshold: Number(form.threshold),
      site_filter:  form.site_filter.trim()  || null,
      brand_filter: form.brand_filter.trim() || null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold text-base">
            {mode === 'edit' ? 'Edit Threshold' : 'New Alert Threshold'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
          <div className="px-6 py-5 space-y-5">

            {/* Name */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Rule Name <span className="text-orange-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Low tread warning"
                className={`w-full bg-gray-800 border rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.name ? 'border-red-500' : 'border-gray-700'}`}
              />
              {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
            </div>

            {/* Metric */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Metric</label>
              <select
                value={form.metric}
                onChange={e => set('metric', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
              >
                {METRICS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Condition + Threshold */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Condition</label>
                <select
                  value={form.operator}
                  onChange={e => set('operator', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
                >
                  {OPERATORS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Value <span className="text-gray-600 normal-case font-normal">({unit})</span>
                </label>
                <input
                  type="number"
                  step="any"
                  value={form.threshold}
                  onChange={e => set('threshold', e.target.value)}
                  placeholder={unit === 'mm' ? '4.0' : unit === 'PSI' ? '80' : '30'}
                  className={`w-full bg-gray-800 border rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.threshold ? 'border-red-500' : 'border-gray-700'}`}
                />
                {errors.threshold && <p className="text-red-400 text-xs mt-1">{errors.threshold}</p>}
              </div>
            </div>

            {/* Preview */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/60 border border-gray-700/50">
              <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
              <p className="text-gray-300 text-xs">
                Alert when: <span className="text-white font-medium">{humanDescription(form)}</span>
              </p>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Site Filter <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.site_filter}
                  onChange={e => set('site_filter', e.target.value)}
                  placeholder="Leave blank for all sites"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Brand Filter <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.brand_filter}
                  onChange={e => set('brand_filter', e.target.value)}
                  placeholder="Leave blank for all brands"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                />
              </div>
            </div>

            {/* Notification methods */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Notify via</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.notify_email}
                    onChange={e => set('notify_email', e.target.checked)}
                    className="w-4 h-4 rounded accent-orange-500 cursor-pointer"
                  />
                  <Mail className="w-4 h-4 text-blue-400" />
                  <span className="text-gray-300 text-sm">Email</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.notify_in_app}
                    onChange={e => set('notify_in_app', e.target.checked)}
                    className="w-4 h-4 rounded accent-orange-500 cursor-pointer"
                  />
                  <Bell className="w-4 h-4 text-orange-400" />
                  <span className="text-gray-300 text-sm">In-app</span>
                </label>
              </div>
              {errors.notify && <p className="text-red-400 text-xs mt-1">{errors.notify}</p>}
            </div>

            {/* Active */}
            <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-gray-800 border border-gray-700">
              <div>
                <p className="text-white text-sm font-medium">Rule active</p>
                <p className="text-gray-500 text-xs">Disable to pause without deleting</p>
              </div>
              <button
                type="button"
                onClick={() => set('active', !form.active)}
                className="transition-colors"
              >
                {form.active
                  ? <ToggleRight className="w-8 h-8 text-orange-500" />
                  : <ToggleLeft className="w-8 h-8 text-gray-500" />
                }
              </button>
            </div>

          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-800 flex gap-3 justify-end bg-gray-900/80">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-lg disabled:opacity-50 transition-all shadow-lg shadow-orange-500/20"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {mode === 'edit' ? 'Save Changes' : 'Create Threshold'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AlertThresholds() {
  const { profile } = useAuth()
  const [thresholds, setThresholds]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [modal, setModal]             = useState(null)   // null | { mode, initial }
  const [saving, setSaving]           = useState(false)
  const [search, setSearch]           = useState('')
  const [filterMetric, setFilterMetric] = useState('all')
  const [filterActive, setFilterActive] = useState('all')

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetch = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    setError(null)
    try {
      const data = await alertThresholds.listAlertThresholds({ userId: profile.id })
      setThresholds(data || [])
      setLoading(false)
    } catch (err) {
      setError(err.message); setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { fetch() }, [fetch])

  // ── Filtering ────────────────────────────────────────────────────────────
  const visible = thresholds.filter(t => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase())
    const matchMetric = filterMetric === 'all' || t.metric === filterMetric
    const matchActive = filterActive === 'all' || (filterActive === 'active' ? t.active : !t.active)
    return matchSearch && matchMetric && matchActive
  })

  // ── CRUD ─────────────────────────────────────────────────────────────────
  async function handleSave(formData) {
    if (!profile?.id) return
    setSaving(true)
    const payload = {
      ...formData,
      user_id: profile.id,
      org_id:  profile.org_id ?? null,
      updated_at: new Date().toISOString(),
    }
    try {
      if (modal.mode === 'edit') {
        await alertThresholds.updateAlertThreshold(modal.initial.id, payload)
      } else {
        await alertThresholds.createAlertThreshold(payload)
      }
    } catch (err) {
      setSaving(false)
      setError(err.message); return
    }
    setSaving(false)
    setModal(null)
    fetch()
  }

  async function handleDelete(id) {
    try {
      await alertThresholds.deleteAlertThreshold(id)
    } catch (err) { setError(err.message); return }
    setThresholds(prev => prev.filter(t => t.id !== id))
  }

  async function handleToggle(id, active) {
    try {
      await alertThresholds.updateAlertThreshold(id, { active, updated_at: new Date().toISOString() })
    } catch (err) { setError(err.message); return }
    setThresholds(prev => prev.map(t => t.id === id ? { ...t, active } : t))
  }

  function openNew()       { setModal({ mode: 'create', initial: {} }) }
  function openEdit(t)     { setModal({ mode: 'edit',   initial: t  }) }
  function openPreset(p)   { setModal({ mode: 'create', initial: p  }) }

  const activeCount   = thresholds.filter(t => t.active).length
  const triggeredTotal = thresholds.reduce((s, t) => s + (t.triggered_count || 0), 0)

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-lg bg-orange-500/20">
              <Bell className="w-5 h-5 text-orange-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Alert Thresholds</h1>
          </div>
          <p className="text-gray-400 text-sm ml-11">Personal notification rules for your fleet</p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-500/25 transition-all whitespace-nowrap self-start"
        >
          <Plus className="w-4 h-4" /> New Threshold
        </button>
      </div>

      {/* ── Stats ── */}
      {thresholds.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Total Rules',     value: thresholds.length,  icon: Bell,         color: 'text-orange-400' },
            { label: 'Active',          value: activeCount,         icon: CheckCircle,  color: 'text-green-400'  },
            { label: 'Total Triggered', value: triggeredTotal,      icon: Zap,          color: 'text-yellow-400' },
          ].map(s => {
            const Icon = s.icon
            return (
              <div key={s.label} className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 flex items-center gap-3">
                <Icon className={`w-5 h-5 ${s.color} shrink-0`} />
                <div>
                  <p className="text-white font-bold text-xl leading-none">{s.value}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{s.label}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Filters ── */}
      {thresholds.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search thresholds…"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Metric filter */}
          <select
            value={filterMetric}
            onChange={e => setFilterMetric(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
          >
            <option value="all">All Metrics</option>
            {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>

          {/* Active filter */}
          <select
            value={filterActive}
            onChange={e => setFilterActive(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30 mb-4">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && thresholds.length === 0 && (
        <EmptyState onNew={openNew} onPreset={openPreset} />
      )}

      {/* ── Grid ── */}
      {!loading && thresholds.length > 0 && (
        <>
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Filter className="w-8 h-8 text-gray-600" />
              <p className="text-gray-400 text-sm">No thresholds match your filters.</p>
              <button onClick={() => { setSearch(''); setFilterMetric('all'); setFilterActive('all') }} className="text-orange-400 text-xs hover:text-orange-300 transition-colors">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visible.map(t => (
                <ThresholdCard
                  key={t.id}
                  threshold={t}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          )}

          {/* Suggested presets (shown below existing cards) */}
          <div className="mt-10">
            <p className="text-gray-500 text-xs font-semibold uppercase tracking-widest mb-3">Suggested presets</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {PRESETS.map(p => {
                const meta = metaFor(p.metric)
                const Icon = meta.icon
                return (
                  <button
                    key={p.name}
                    onClick={() => openPreset(p)}
                    className="flex items-start gap-3 p-3.5 rounded-xl bg-gray-800/60 border border-gray-700 hover:border-orange-500/40 hover:bg-gray-800 transition-all text-left group"
                  >
                    <div className={`shrink-0 mt-0.5 p-1.5 rounded-lg ${METRIC_BADGE[p.metric]}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <p className="text-gray-300 text-xs font-medium group-hover:text-white transition-colors">{p.name}</p>
                      <p className="text-gray-600 text-xs mt-0.5">{humanDescription(p)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Modal ── */}
      {modal && (
        <Modal
          mode={modal.mode}
          initial={modal.initial}
          onSave={handleSave}
          onClose={() => setModal(null)}
          saving={saving}
        />
      )}
    </div>
  )
}
