import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  ClipboardList, Plus, Search,
  FileText, FileSpreadsheet, Edit2, Trash2, X, Save,
  CheckCircle, AlertTriangle, AlertOctagon, HelpCircle,
  ChevronLeft, ChevronRight, Tag, Shield,
  RefreshCw, History, Zap, Truck, Info, BarChart3,
  ClipboardCheck, Wrench, BookOpen,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'
const uuidv4 = () => crypto.randomUUID()
import * as tyreSpecsApi from '../lib/api/tyreSpecs'
import {
  VEHICLE_TYPES, POSITIONS, SPEED_INDICES, PLY_RATINGS, APPROVED_BRANDS, SMART_DEFAULTS,
} from '../lib/tyreSpecCatalog'
import { buildPolicySections, renderTyreSpecPolicyPdf } from '../lib/tyreSpecPolicy'
import { normalizePosition } from '../lib/tyrePositions'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../lib/exportUtils'

ChartJS.register(ArcElement, Tooltip, Legend)

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25

// POSITIONS, VEHICLE_TYPES, SPEED_INDICES, PLY_RATINGS, APPROVED_BRANDS and
// SMART_DEFAULTS are the shared single source imported from ../lib/tyreSpecCatalog.

const STATUS_CONFIG = {
  Approved:            { label: 'Approved',           color: 'text-green-400',  bg: 'bg-green-900/20 border-green-800',  icon: CheckCircle },
  'Non-Standard Size': { label: 'Non-Standard Size',  color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-800', icon: AlertTriangle },
  'Non-Approved Brand':{ label: 'Non-Approved Brand', color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-800', icon: AlertTriangle },
  'Multiple Violations':{ label: 'Multiple Violations', color: 'text-red-400', bg: 'bg-red-900/20 border-red-800',    icon: AlertOctagon },
  'No Spec Defined':   { label: 'No Spec Defined',    color: 'text-gray-400',   bg: 'bg-gray-800 border-gray-700',        icon: HelpCircle },
}

const DOUGHNUT_COLORS = ['#22c55e', '#f97316', '#f59e0b', '#6b7280', '#ef4444']

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right',
      labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 }, padding: 12 },
    },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
    },
  },
}

// ── Spec normalization helpers ─────────────────────────────────────────────────

// Convert a form/default object into a DB-ready row (whitelisted columns only).
function specToRow(form, { country = null, createdBy = null } = {}) {
  const toNum = v => {
    if (v === '' || v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const row = {
    vehicle_type: String(form.vehicle_type ?? '').trim(),
    position: form.position ?? 'Steer',
    approved_sizes: Array.isArray(form.approved_sizes) ? form.approved_sizes : [],
    approved_brands: Array.isArray(form.approved_brands) ? form.approved_brands : [],
    min_load_index: toNum(form.min_load_index),
    min_speed_index: form.min_speed_index || null,
    ply_rating: form.ply_rating?.trim() ? form.ply_rating.trim() : null,
    recommended_pressure: toNum(form.recommended_pressure),
    min_tread_depth: toNum(form.min_tread_depth),
    notes: form.notes?.trim() ? form.notes.trim() : null,
  }
  if (country != null) row.country = country
  if (createdBy != null) row.created_by = createdBy
  return row
}

// Convert a DB row into the form/UI shape (numeric fields -> '' when null for inputs).
function rowToSpec(row) {
  return {
    ...row,
    approved_sizes: row.approved_sizes ?? [],
    approved_brands: row.approved_brands ?? [],
    min_load_index: row.min_load_index ?? '',
    min_speed_index: row.min_speed_index ?? '',
    ply_rating: row.ply_rating ?? '',
    recommended_pressure: row.recommended_pressure ?? '',
    min_tread_depth: row.min_tread_depth ?? '',
    notes: row.notes ?? '',
  }
}

// ── Tag input component ────────────────────────────────────────────────────────

function TagInput({ values = [], onChange, placeholder }) {
  const [input, setInput] = useState('')
  const ref = useRef()

  function add() {
    const v = input.trim().toUpperCase()
    if (v && !values.includes(v)) onChange([...values, v])
    setInput('')
  }

  function remove(v) {
    onChange(values.filter(x => x !== v))
  }

  return (
    <div
      className="min-h-[40px] bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1 flex flex-wrap gap-1 cursor-text focus-within:border-blue-500 transition-colors"
      onClick={() => ref.current?.focus()}
    >
      {values.map(v => (
        <span key={v} className="flex items-center gap-1 bg-blue-900/40 text-blue-300 text-xs px-2 py-0.5 rounded-full border border-blue-700">
          {v}
          <button type="button" onClick={() => remove(v)} className="text-blue-400 hover:text-red-400 transition-colors">
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }}
        onBlur={add}
        placeholder={values.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] bg-transparent text-[var(--text-primary)] text-sm outline-none placeholder-gray-600"
      />
    </div>
  )
}

// ── Brand tag input (preserves case) ──────────────────────────────────────────

function BrandTagInput({ values = [], onChange, placeholder, suggestions = [] }) {
  const [input, setInput] = useState('')
  const ref = useRef()
  const listId = useRef(`brand-suggestions-${Math.random().toString(36).slice(2)}`)

  function add() {
    const v = input.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setInput('')
  }

  function remove(v) {
    onChange(values.filter(x => x !== v))
  }

  return (
    <div
      className="min-h-[40px] bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1 flex flex-wrap gap-1 cursor-text focus-within:border-blue-500 transition-colors"
      onClick={() => ref.current?.focus()}
    >
      {values.map(v => (
        <span key={v} className="flex items-center gap-1 bg-purple-900/40 text-purple-300 text-xs px-2 py-0.5 rounded-full border border-purple-700">
          {v}
          <button type="button" onClick={() => remove(v)} className="text-purple-400 hover:text-red-400 transition-colors">
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        list={suggestions.length ? listId.current : undefined}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }}
        onBlur={add}
        placeholder={values.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] bg-transparent text-[var(--text-primary)] text-sm outline-none placeholder-gray-600"
      />
      {suggestions.length > 0 && (
        <datalist id={listId.current}>
          {suggestions.filter(b => !values.includes(b)).map(b => <option key={b} value={b} />)}
        </datalist>
      )}
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color = 'text-blue-400', loading }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="card flex items-start gap-4"
    >
      <div className={`p-2.5 rounded-lg bg-[var(--input-bg)] ${color}`}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-[var(--text-muted)] text-xs mb-1">{label}</p>
        {loading ? (
          <div className="h-7 w-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : (
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
        )}
        {sub && <p className="text-[var(--text-muted)] text-xs mt-0.5">{sub}</p>}
      </div>
    </motion.div>
  )
}

// ── Spec Form Modal ────────────────────────────────────────────────────────────

function SpecFormModal({ spec, onClose, onSave, isAdmin, saving }) {
  const [form, setForm] = useState(spec ?? {
    vehicle_type: '',
    position: 'Steer',
    approved_sizes: [],
    approved_brands: [],
    min_load_index: '',
    min_speed_index: '',
    ply_rating: '',
    recommended_pressure: '',
    min_tread_depth: '',
    notes: '',
  })
  const [error, setError] = useState('')

  function set(field, val) { setForm(prev => ({ ...prev, [field]: val })) }

  function validate() {
    if (!form.vehicle_type.trim()) return 'Vehicle Type is required'
    if (!form.position) return 'Position is required'
    if (form.approved_sizes.length === 0) return 'At least one approved size is required'
    if (form.approved_brands.length === 0) return 'At least one approved brand is required'
    return null
  }

  function submit(e) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }
    onSave(form)
  }

  if (!isAdmin) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between p-6 border-b border-[var(--input-border)]">
            <h3 className="text-[var(--text-primary)] font-semibold text-lg">
              {spec?.id ? 'Edit Specification' : 'Add Specification'}
            </h3>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              <X size={20} />
            </button>
          </div>

          <form onSubmit={submit} className="p-6 space-y-5">
            {error && (
              <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[var(--text-muted)] text-xs mb-1.5 block">Vehicle Type *</label>
                <div className="relative">
                  <input
                    list="vehicle-types-list"
                    value={form.vehicle_type}
                    onChange={e => set('vehicle_type', e.target.value)}
                    placeholder="e.g. Rigid Truck"
                    className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none"
                  />
                  <datalist id="vehicle-types-list">
                    {VEHICLE_TYPES.map(v => <option key={v} value={v} />)}
                  </datalist>
                </div>
              </div>
              <div>
                <label className="text-[var(--text-muted)] text-xs mb-1.5 block">Position *</label>
                <select
                  value={form.position}
                  onChange={e => set('position', e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none"
                >
                  {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[var(--text-muted)] text-xs mb-1.5 block">
                Approved Sizes * <span className="text-[var(--text-dim)]">(press Enter or comma to add)</span>
              </label>
              <TagInput
                values={form.approved_sizes}
                onChange={v => set('approved_sizes', v)}
                placeholder="e.g. 315/80R22.5"
              />
            </div>

            <div>
              <label className="text-[var(--text-muted)] text-xs mb-1.5 block">
                Approved Brands * <span className="text-[var(--text-dim)]">(press Enter or comma to add)</span>
              </label>
              <BrandTagInput
                values={form.approved_brands}
                onChange={v => set('approved_brands', v)}
                placeholder="e.g. Double Coin"
                suggestions={APPROVED_BRANDS}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[var(--text-muted)] text-xs mb-1.5 block">Min Load Index</label>
                <input
                  type="number"
                  value={form.min_load_index}
                  onChange={e => set('min_load_index', e.target.value)}
                  placeholder="e.g. 154"
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="text-[var(--text-muted)] text-xs mb-1.5 block">Min Speed Index</label>
                <select
                  value={form.min_speed_index}
                  onChange={e => set('min_speed_index', e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none"
                >
                  <option value="">Select...</option>
                  {SPEED_INDICES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[var(--text-muted)] text-xs mb-1.5 block">Min Ply / Star Rating</label>
                <input
                  list="ply-ratings-list"
                  value={form.ply_rating}
                  onChange={e => set('ply_rating', e.target.value)}
                  placeholder="e.g. 18PR"
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none"
                />
                <datalist id="ply-ratings-list">
                  {PLY_RATINGS.map(p => <option key={p} value={p} />)}
                </datalist>
              </div>
              <div>
                <label className="text-[var(--text-muted)] text-xs mb-1.5 block">Recommended Pressure (PSI)</label>
                <input
                  type="number"
                  value={form.recommended_pressure}
                  onChange={e => set('recommended_pressure', e.target.value)}
                  placeholder="e.g. 120"
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="text-[var(--text-muted)] text-xs mb-1.5 block">Min Tread Depth (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  value={form.min_tread_depth}
                  onChange={e => set('min_tread_depth', e.target.value)}
                  placeholder="e.g. 3"
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-[var(--text-muted)] text-xs mb-1.5 block">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                rows={3}
                placeholder="Engineering notes, compliance requirements..."
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 text-sm transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving...' : spec?.id ? 'Update Specification' : 'Save Specification'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Delete Confirm Modal ───────────────────────────────────────────────────────

function DeleteConfirmModal({ spec, onClose, onConfirm }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-[var(--surface-1)] border border-red-800 rounded-2xl w-full max-w-md p-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-red-900/30 rounded-lg">
              <Trash2 size={18} className="text-red-400" />
            </div>
            <h3 className="text-[var(--text-primary)] font-semibold">Delete Specification</h3>
          </div>
          <p className="text-[var(--text-muted)] text-sm mb-2">
            Delete <span className="text-[var(--text-primary)] font-medium">{spec?.vehicle_type}, {spec?.position}</span>?
          </p>
          <p className="text-[var(--text-muted)] text-xs mb-6">This action cannot be undone. Compliance records will show "No Spec Defined" for affected vehicles.</p>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm transition-colors">Cancel</button>
            <button onClick={onConfirm} className="flex items-center gap-2 bg-red-700 hover:bg-red-600 text-white text-sm px-4 py-2 rounded-lg transition-colors">
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Raise Work Order Modal ─────────────────────────────────────────────────────

function RaiseWorkOrderModal({ asset, violations, country, createdBy, onClose }) {
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      // Whitelisted columns only (verified against public.work_orders schema).
      const payload = {
        asset_no: asset.asset_no,
        work_type: 'Tyre Change',
        priority: 'High',
        status: 'Open',
        description: `Non-conforming tyre fitment detected. ${violations.join('; ')}`,
        site: asset.site || null,
        country: country || null,
        created_by: createdBy || null,
      }

      // Server-side sequential WO number; fall back to year-based sequence.
      const { data: woNo } = await tyreSpecsApi.generateWorkOrderNo()
      payload.work_order_no = woNo || `WO-${new Date().getFullYear()}-${Date.now()}`

      const { error: insErr } = await tyreSpecsApi.insertWorkOrder(payload)
      if (insErr) throw insErr
      setDone(true)
    } catch (err) {
      setError(err.message || 'Failed to raise work order')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl w-full max-w-lg p-6"
        >
          {done ? (
            <div className="text-center py-4">
              <CheckCircle size={40} className="text-green-400 mx-auto mb-3" />
              <p className="text-[var(--text-primary)] font-medium mb-1">Work Order Raised</p>
              <p className="text-[var(--text-muted)] text-sm">A high-priority work order has been created for {asset.asset_no}.</p>
              <button onClick={onClose} className="btn-secondary mt-4">Close</button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-orange-900/30 rounded-lg">
                  <Wrench size={18} className="text-orange-400" />
                </div>
                <h3 className="text-[var(--text-primary)] font-semibold">Raise Work Order</h3>
              </div>
              <p className="text-[var(--text-muted)] text-sm mb-2">Asset: <span className="text-[var(--text-primary)]">{asset.asset_no}</span>, Site: <span className="text-[var(--text-primary)]">{asset.site}</span></p>
              <div className="bg-[var(--input-bg)] rounded-lg p-3 mb-4 space-y-1">
                {violations.map((v, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-orange-300">
                    <AlertTriangle size={11} /> {v}
                  </div>
                ))}
              </div>
              {error && (
                <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 mb-4">
                  <AlertTriangle size={14} /> {error}
                </div>
              )}
              <form onSubmit={submit} className="flex justify-end gap-3">
                <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 text-sm transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm px-5 py-2 rounded-lg transition-colors">
                  {saving ? <RefreshCw size={14} className="animate-spin" /> : <Wrench size={14} />}
                  {saving ? 'Creating...' : 'Create Work Order'}
                </button>
              </form>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function TyreSpecifications() {
  const { profile, user } = useAuth()
  const { appSettings, activeCountry } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const isAdmin = profile?.role === 'Admin'
  const country = activeCountry && activeCountry !== 'All' ? activeCountry : null

  const [activeTab, setActiveTab] = useState('library')
  const [specs, setSpecs] = useState([])
  const [loadingSpecs, setLoadingSpecs] = useState(true)
  const [specsError, setSpecsError] = useState('')
  const [savingSpec, setSavingSpec] = useState(false)
  const [tyreRecords, setTyreRecords] = useState([])
  const [fleetMaster, setFleetMaster] = useState([])
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [history, setHistory] = useState([])

  // library filters
  const [libSearch, setLibSearch] = useState('')
  const [libTypeFilter, setLibTypeFilter] = useState('')
  const [libPosFilter, setLibPosFilter] = useState('')

  // compliance filters / pagination
  const [compSearch, setCompSearch] = useState('')
  const [compSiteFilter, setCompSiteFilter] = useState('')
  const [compTypeFilter, setCompTypeFilter] = useState('')
  const [compStatusFilter, setCompStatusFilter] = useState('')
  const [compPage, setCompPage] = useState(0)

  // modals
  const [showSpecModal, setShowSpecModal] = useState(false)
  const [editingSpec, setEditingSpec] = useState(null)
  const [deletingSpec, setDeletingSpec] = useState(null)
  const [workOrderAsset, setWorkOrderAsset] = useState(null)

  // Fitment Policy PDF generation state
  const [policyBusy, setPolicyBusy] = useState(false)
  const [policyError, setPolicyError] = useState('')

  // ── In-session audit log (DB does not persist spec history) ──────────────────

  const logHistory = useCallback((action, specObj, changedField = null, oldVal = null, newVal = null) => {
    setHistory(prev => [...prev, {
      id: uuidv4(),
      date: new Date().toISOString(),
      action,
      user: profile?.email || 'Unknown',
      vehicle_type: specObj?.vehicle_type || '',
      position: specObj?.position || '',
      changed_field: changedField || '',
      old_value: oldVal != null ? String(oldVal) : '',
      new_value: newVal != null ? String(newVal) : '',
    }].slice(-100))
  }, [profile?.email])

  // ── Load specs from Supabase ─────────────────────────────────────────────────

  const fetchSpecs = useCallback(async () => {
    setLoadingSpecs(true)
    setSpecsError('')
    try {
      const { data, error } = await tyreSpecsApi.listSpecs({ country })
      if (error) throw error
      setSpecs((data ?? []).map(rowToSpec))
    } catch (e) {
      setSpecsError(e.message || 'Failed to load specifications')
      setSpecs([])
    } finally {
      setLoadingSpecs(false)
    }
  }, [country])

  // ── Load data ────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchSpecs()
    fetchLiveData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountry])

  async function fetchLiveData() {
    setLoadingRecords(true)
    try {
      const { data: tr } = await tyreSpecsApi.listComplianceTyreRecords({ country: activeCountry })
      setTyreRecords(tr ?? [])

      const { data: fm } = await tyreSpecsApi.getFleetMaster()
      setFleetMaster(fm ?? [])
    } catch {
      setTyreRecords([])
    } finally {
      setLoadingRecords(false)
    }
  }

  // ── Derive vehicle type from asset number prefix when fleet_master unavailable ─

  function deriveVehicleType(assetNo) {
    if (!assetNo) return null
    const fm = fleetMaster.find(f => f.asset_no === assetNo)
    if (fm?.vehicle_type) return fm.vehicle_type
    // prefix heuristics
    const prefix = String(assetNo).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
    const map = {
      MIX: 'Mixer', TIP: 'Tipper', RIG: 'Rigid Truck', SEM: 'Semi-Trailer',
      TAN: 'Tanker', FLT: 'Flat Bed', CRN: 'Crane', BUS: 'Bus', TRK: 'Rigid Truck',
    }
    for (const [k, v] of Object.entries(map)) {
      if (prefix.startsWith(k)) return v
    }
    return null
  }

  // ── Compliance analysis ────────────────────────────────────────────────────────

  const complianceData = useMemo(() => {
    return tyreRecords.map(tr => {
      const vehicleType = deriveVehicleType(tr.asset_no)
      const position = normalizePosition(tr.position)
      const fm = fleetMaster.find(f => f.asset_no === tr.asset_no)
      const site = tr.site || fm?.site || ''

      const matchingSpec = specs.find(s =>
        s.vehicle_type === vehicleType &&
        (s.position === position || s.position === 'All Positions')
      )

      if (!vehicleType || !matchingSpec) {
        return { ...tr, vehicleType, site, specStatus: 'No Spec Defined', violations: [] }
      }

      const sizeOk = matchingSpec.approved_sizes.some(s => normalizeSize(s) === normalizeSize(tr.size))
      const brandOk = matchingSpec.approved_brands.some(b => b.toLowerCase() === (tr.brand || '').toLowerCase())

      const violations = []
      if (!sizeOk) violations.push(`Non-standard size: ${tr.size || 'Unknown'} (approved: ${matchingSpec.approved_sizes.join(', ')})`)
      if (!brandOk) violations.push(`Non-approved brand: ${tr.brand || 'Unknown'} (approved: ${matchingSpec.approved_brands.join(', ')})`)

      let specStatus
      if (violations.length === 0) specStatus = 'Approved'
      else if (violations.length >= 2) specStatus = 'Multiple Violations'
      else if (!sizeOk) specStatus = 'Non-Standard Size'
      else specStatus = 'Non-Approved Brand'

      return { ...tr, vehicleType, site, specStatus, violations, matchingSpec }
    })
  }, [tyreRecords, specs, fleetMaster])

  // normalizePosition sourced from lib/tyrePositions (coded + free-text aware).

  function normalizeSize(size) {
    return (size || '').replace(/\s/g, '').toUpperCase()
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const total = complianceData.length
    const approved = complianceData.filter(r => r.specStatus === 'Approved').length
    const nonConforming = complianceData.filter(r => r.specStatus !== 'Approved' && r.specStatus !== 'No Spec Defined').length
    const vehicleTypesCovered = new Set(specs.map(s => s.vehicle_type)).size
    const complianceRate = total > 0 ? Math.round((approved / total) * 100) : 0
    return { total, approved, nonConforming, vehicleTypesCovered, complianceRate }
  }, [complianceData, specs])

  // ── Filtered library ──────────────────────────────────────────────────────────

  const filteredSpecs = useMemo(() => {
    return specs.filter(s => {
      const matchSearch = !libSearch || s.vehicle_type.toLowerCase().includes(libSearch.toLowerCase()) || s.position.toLowerCase().includes(libSearch.toLowerCase()) || s.approved_sizes.some(x => x.toLowerCase().includes(libSearch.toLowerCase())) || s.approved_brands.some(x => x.toLowerCase().includes(libSearch.toLowerCase()))
      const matchType = !libTypeFilter || s.vehicle_type === libTypeFilter
      const matchPos = !libPosFilter || s.position === libPosFilter
      return matchSearch && matchType && matchPos
    })
  }, [specs, libSearch, libTypeFilter, libPosFilter])

  // ── Filtered compliance ────────────────────────────────────────────────────────

  const filteredCompliance = useMemo(() => {
    return complianceData.filter(r => {
      const matchSearch = !compSearch || r.asset_no?.toLowerCase().includes(compSearch.toLowerCase()) || r.vehicleType?.toLowerCase().includes(compSearch.toLowerCase())
      const matchSite = !compSiteFilter || r.site === compSiteFilter
      const matchType = !compTypeFilter || r.vehicleType === compTypeFilter
      const matchStatus = !compStatusFilter || r.specStatus === compStatusFilter
      return matchSearch && matchSite && matchType && matchStatus
    })
  }, [complianceData, compSearch, compSiteFilter, compTypeFilter, compStatusFilter])

  const compliancePage = useMemo(() => {
    return filteredCompliance.slice(compPage * PAGE_SIZE, (compPage + 1) * PAGE_SIZE)
  }, [filteredCompliance, compPage])

  const complianceTotalPages = Math.ceil(filteredCompliance.length / PAGE_SIZE)

  // ── Non-conformance grouped by asset ──────────────────────────────────────────

  const nonConformanceByAsset = useMemo(() => {
    const map = {}
    complianceData.filter(r => r.specStatus !== 'Approved' && r.specStatus !== 'No Spec Defined').forEach(r => {
      if (!map[r.asset_no]) {
        map[r.asset_no] = { asset_no: r.asset_no, site: r.site, vehicleType: r.vehicleType, violations: [], violationTypes: new Set() }
      }
      map[r.asset_no].violations.push(...r.violations)
      map[r.asset_no].violationTypes.add(r.specStatus)
    })
    return Object.values(map)
      .map(v => ({ ...v, violationTypes: [...v.violationTypes] }))
      .sort((a, b) => b.violations.length - a.violations.length)
  }, [complianceData])

  // ── Doughnut data ─────────────────────────────────────────────────────────────

  const doughnutData = useMemo(() => {
    const counts = {
      Approved: 0, 'Non-Standard Size': 0, 'Non-Approved Brand': 0, 'Multiple Violations': 0, 'No Spec Defined': 0,
    }
    complianceData.forEach(r => { if (counts[r.specStatus] !== undefined) counts[r.specStatus]++ })
    const labels = Object.keys(counts).filter(k => counts[k] > 0)
    return {
      labels,
      datasets: [{
        data: labels.map(l => counts[l]),
        backgroundColor: labels.map((l, i) => DOUGHNUT_COLORS[Object.keys(counts).indexOf(l)] + 'cc'),
        borderColor: labels.map((l, i) => DOUGHNUT_COLORS[Object.keys(counts).indexOf(l)]),
        borderWidth: 1,
      }],
    }
  }, [complianceData])

  // ── Site options for filter ────────────────────────────────────────────────────

  const siteOptions = useMemo(() => [...new Set(tyreRecords.map(r => r.site).filter(Boolean))].sort(), [tyreRecords])
  const typeOptions = useMemo(() => [...new Set(specs.map(s => s.vehicle_type).filter(Boolean))].sort(), [specs])
  const libTypeOptions = useMemo(() => [...new Set(specs.map(s => s.vehicle_type).filter(Boolean))].sort(), [specs])

  // ── CRUD operations ───────────────────────────────────────────────────────────

  async function handleSaveSpec(form) {
    setSavingSpec(true)
    setSpecsError('')
    try {
      const existing = editingSpec?.id ? specs.find(s => s.id === editingSpec.id) : null
      if (existing) {
        const row = { ...specToRow(form, { country }), updated_at: new Date().toISOString() }
        const { error } = await tyreSpecsApi.updateSpec(existing.id, row)
        if (error) throw error
        logHistory('Edit', form, 'Spec Update', JSON.stringify(existing), JSON.stringify(form))
      } else {
        const row = specToRow(form, { country, createdBy: user?.id })
        const { error } = await tyreSpecsApi.insertSpec(row)
        if (error) throw error
        logHistory('Add', form)
      }
      await fetchSpecs()
      setShowSpecModal(false)
      setEditingSpec(null)
    } catch (e) {
      setSpecsError(e.message || 'Failed to save specification')
    } finally {
      setSavingSpec(false)
    }
  }

  async function handleDeleteSpec() {
    const target = deletingSpec
    setSpecsError('')
    try {
      const { error } = await tyreSpecsApi.deleteSpec(target.id)
      if (error) throw error
      logHistory('Delete', target)
      await fetchSpecs()
    } catch (e) {
      setSpecsError(e.message || 'Failed to delete specification')
    } finally {
      setDeletingSpec(null)
    }
  }

  async function importQuickDefault(def) {
    const exists = specs.find(s => s.vehicle_type === def.vehicle_type && s.position === def.position)
    if (exists) return
    setSpecsError('')
    try {
      const row = specToRow(def, { country, createdBy: user?.id })
      const { error } = await tyreSpecsApi.insertSpec(row)
      if (error) throw error
      logHistory('Quick Setup Import', def)
      await fetchSpecs()
    } catch (e) {
      setSpecsError(e.message || 'Failed to import default')
    }
  }

  // ── Export specs to Excel ─────────────────────────────────────────────────────

  async function exportSpecsExcel() {
    const XLSX = await import('xlsx')
    const rows = specs.map(s => ({
      'Vehicle Type': s.vehicle_type,
      'Position': s.position,
      'Approved Sizes': s.approved_sizes.join(', '),
      'Approved Brands': s.approved_brands.join(', '),
      'Min Load Index': s.min_load_index,
      'Min Speed Index': s.min_speed_index,
      'Ply Rating': s.ply_rating,
      'Recommended Pressure': s.recommended_pressure,
      'Min Tread Depth': s.min_tread_depth,
      'Notes': s.notes,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Tyre Specs')
    XLSX.writeFile(wb, 'TyrePulse_Specifications.xlsx')
  }

  // ── Export compliance PDF ─────────────────────────────────────────────────────

  async function exportCompliancePdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const title = 'Fleet Compliance Report'
    const subtitle = `${filteredCompliance.length} fitments analysed`

    if (filteredCompliance.length === 0) {
      pdfHeader(doc, title, '0 fitments analysed', company, brand)
      pdfEmptyState(doc, 'No fitments match the selected filters', 'Adjust the filters and export again.')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save('TyrePulse_Compliance_Report.pdf')
      return
    }

    const statusColors = {
      Approved: [20, 83, 45],
      'Non-Standard Size': [124, 45, 18],
      'Non-Approved Brand': [113, 63, 18],
      'Multiple Violations': [127, 29, 29],
      'No Spec Defined': [75, 85, 99],
    }

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 30,
      margin: { left: 14, right: 14, top: 28 },
      head: [['Asset No', 'Vehicle Type', 'Position', 'Fitted Size', 'Fitted Brand', 'Site', 'Spec Status']],
      body: filteredCompliance.slice(0, 500).map(r => [
        r.asset_no || '', r.vehicleType || 'Unknown', normalizePosition(r.position), r.size || '', r.brand || '', r.site || '', r.specStatus,
      ]),
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 32 }, 2: { cellWidth: 24 }, 3: { cellWidth: 32 }, 4: { cellWidth: 28 }, 5: { cellWidth: 28 }, 6: { cellWidth: 38 } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 6) {
          const color = statusColors[data.cell.raw]
          if (color) { data.cell.styles.fillColor = color; data.cell.styles.textColor = [255, 255, 255] }
        }
      },
      didDrawPage: () => pdfHeader(doc, title, subtitle, company, brand),
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save('TyrePulse_Compliance_Report.pdf')
  }

  // ── Fitment Policy (branded standard document) ─────────────────────────────────

  const policySections = useMemo(() => {
    try {
      return buildPolicySections({
        specs,
        company,
        country,
        generatedBy: profile?.email,
        date: new Date(),
      }) || []
    } catch {
      return []
    }
  }, [specs, company, country, profile?.email])

  async function downloadPolicyPdf() {
    setPolicyBusy(true)
    setPolicyError('')
    try {
      await renderTyreSpecPolicyPdf({
        specs,
        company,
        branding,
        country,
        generatedBy: profile?.email,
        save: true,
      })
    } catch (e) {
      setPolicyError(e?.message || 'Failed to generate the policy PDF')
    } finally {
      setPolicyBusy(false)
    }
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────────

  const TABS = [
    { id: 'library',     label: 'Specification Library', icon: BookOpen },
    { id: 'compliance',  label: 'Fleet Compliance',      icon: ClipboardCheck },
    { id: 'violations',  label: 'Non-Conformance',       icon: AlertOctagon },
    { id: 'defaults',    label: 'Quick Setup',           icon: Zap },
    { id: 'policy',      label: 'Fitment Policy',        icon: FileText },
    { id: 'history',     label: 'Audit Trail',           icon: History },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      <PageHeader
        title="Tyre Specification Manager"
        subtitle="Define approved fitments, track compliance, and flag non-conforming tyres"
        icon={Shield}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { setEditingSpec(null); setShowSpecModal(true) }}
              disabled={!isAdmin}
              title={!isAdmin ? 'Admin access required' : ''}
              className="btn-primary gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={15} /> Add Specification
            </button>
            <button
              onClick={exportSpecsExcel}
              className="flex items-center gap-2 bg-[var(--input-bg)] hover:bg-gray-700 text-[var(--text-secondary)] text-sm px-3 py-2 rounded-lg border border-[var(--input-border)] transition-colors"
            >
              <FileSpreadsheet size={14} /> Export
            </button>
            <button
              onClick={exportCompliancePdf}
              className="flex items-center gap-2 bg-[var(--input-bg)] hover:bg-gray-700 text-[var(--text-secondary)] text-sm px-3 py-2 rounded-lg border border-[var(--input-border)] transition-colors"
            >
              <FileText size={14} /> PDF Report
            </button>
            <button
              onClick={() => { fetchSpecs(); fetchLiveData() }}
              disabled={loadingRecords || loadingSpecs}
              className="flex items-center gap-2 bg-[var(--input-bg)] hover:bg-gray-700 text-[var(--text-secondary)] text-sm px-3 py-2 rounded-lg border border-[var(--input-border)] transition-colors"
            >
              <RefreshCw size={14} className={(loadingRecords || loadingSpecs) ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {specsError && !loadingSpecs && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2">
          <AlertTriangle size={14} /> {specsError}
          <button onClick={fetchSpecs} className="ml-auto flex items-center gap-1 text-red-200 hover:text-[var(--text-primary)]"><RefreshCw size={13} /> Retry</button>
          <button onClick={() => setSpecsError('')}><X size={14} /></button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={ClipboardList} label="Total Spec Profiles" value={specs.length} color="text-blue-400" loading={loadingSpecs} sub={`${typeOptions.length} vehicle types`} />
        <KpiCard icon={Shield} label="Fleet Compliance Rate" value={`${kpis.complianceRate}%`} color={kpis.complianceRate >= 80 ? 'text-green-400' : kpis.complianceRate >= 60 ? 'text-yellow-400' : 'text-red-400'} loading={loadingRecords} sub={`${kpis.approved} of ${kpis.total} fitments`} />
        <KpiCard icon={AlertOctagon} label="Non-Conforming Fitments" value={kpis.nonConforming} color={kpis.nonConforming === 0 ? 'text-green-400' : 'text-orange-400'} loading={loadingRecords} sub="size or brand violations" />
        <KpiCard icon={Truck} label="Vehicle Types Covered" value={kpis.vehicleTypesCovered} color="text-purple-400" loading={loadingSpecs} sub={`${specs.length} total spec entries`} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--surface-1)] rounded-xl p-1 border border-[var(--input-border)] overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'}`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Specification Library ────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {activeTab === 'library' && (
          <motion.div key="library" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={libSearch}
                  onChange={e => setLibSearch(e.target.value)}
                  placeholder="Search specs..."
                  className="w-full pl-9 pr-3 py-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none"
                />
              </div>
              <select
                value={libTypeFilter}
                onChange={e => setLibTypeFilter(e.target.value)}
                className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] text-sm focus:border-blue-500 outline-none"
              >
                <option value="">All Vehicle Types</option>
                {libTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select
                value={libPosFilter}
                onChange={e => setLibPosFilter(e.target.value)}
                className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] text-sm focus:border-blue-500 outline-none"
              >
                <option value="">All Positions</option>
                {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            {/* Spec Cards */}
            {loadingSpecs ? (
              <div className="card py-16 text-center">
                <RefreshCw size={28} className="animate-spin text-[var(--text-dim)] mx-auto mb-3" />
                <p className="text-[var(--text-muted)] text-sm">Loading specifications...</p>
              </div>
            ) : specsError ? (
              <div className="bg-[var(--surface-1)] border border-red-800 rounded-xl py-16 text-center">
                <AlertOctagon size={40} className="text-red-500 mx-auto mb-3" />
                <p className="text-red-300 font-medium mb-1">Failed to Load Specifications</p>
                <p className="text-[var(--text-muted)] text-sm mb-4 max-w-md mx-auto">{specsError}</p>
                <button onClick={fetchSpecs} className="flex items-center gap-2 mx-auto bg-[var(--input-bg)] hover:bg-gray-700 text-[var(--text-secondary)] text-sm px-4 py-2 rounded-lg border border-[var(--input-border)] transition-colors">
                  <RefreshCw size={14} /> Retry
                </button>
              </div>
            ) : filteredSpecs.length === 0 ? (
              <div className="card py-16 text-center">
                <ClipboardList size={40} className="text-[var(--text-dim)] mx-auto mb-3" />
                <p className="text-[var(--text-muted)] font-medium mb-1">No Specification Profiles</p>
                <p className="text-[var(--text-dim)] text-sm mb-4">
                  {specs.length === 0 ? 'Get started by adding your first tyre specification or using Quick Setup.' : 'No specs match the current filters.'}
                </p>
                {isAdmin && specs.length === 0 && (
                  <button onClick={() => setActiveTab('defaults')} className="text-blue-400 hover:text-blue-300 text-sm underline">
                    View Quick Setup defaults →
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredSpecs.map((spec, idx) => (
                  <motion.div
                    key={spec.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="card hover:border-[var(--input-border)] transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <Truck size={13} className="text-blue-400" />
                          <span className="text-[var(--text-primary)] font-medium text-sm">{spec.vehicle_type}</span>
                        </div>
                        <span className="text-xs text-[var(--text-muted)] bg-[var(--input-bg)] px-2 py-0.5 rounded-full">{spec.position}</span>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditingSpec(spec); setShowSpecModal(true) }}
                            className="p-1.5 text-[var(--text-muted)] hover:text-blue-400 hover:bg-blue-900/20 rounded-lg transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => setDeletingSpec(spec)}
                            className="p-1.5 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2.5">
                      <div>
                        <p className="text-[var(--text-muted)] text-xs mb-1 flex items-center gap-1"><Tag size={10} /> Approved Sizes</p>
                        <div className="flex flex-wrap gap-1">
                          {spec.approved_sizes.map(s => (
                            <span key={s} className="text-xs bg-blue-900/30 text-blue-300 border border-blue-800 px-2 py-0.5 rounded-full">{s}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[var(--text-muted)] text-xs mb-1 flex items-center gap-1"><Shield size={10} /> Approved Brands</p>
                        <div className="flex flex-wrap gap-1">
                          {spec.approved_brands.map(b => (
                            <span key={b} className="text-xs bg-purple-900/30 text-purple-300 border border-purple-800 px-2 py-0.5 rounded-full">{b}</span>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-[var(--input-border)]">
                        {spec.recommended_pressure ? (
                          <div className="text-center">
                            <p className="text-[var(--text-muted)] text-xs">PSI</p>
                            <p className="text-[var(--text-primary)] text-sm font-semibold">{spec.recommended_pressure}</p>
                          </div>
                        ) : null}
                        {spec.min_tread_depth ? (
                          <div className="text-center">
                            <p className="text-[var(--text-muted)] text-xs">Min Tread</p>
                            <p className="text-[var(--text-primary)] text-sm font-semibold">{spec.min_tread_depth}mm</p>
                          </div>
                        ) : null}
                        {spec.min_load_index ? (
                          <div className="text-center">
                            <p className="text-[var(--text-muted)] text-xs">Load Idx</p>
                            <p className="text-[var(--text-primary)] text-sm font-semibold">{spec.min_load_index}{spec.min_speed_index}</p>
                          </div>
                        ) : null}
                        {spec.ply_rating ? (
                          <div className="text-center">
                            <p className="text-[var(--text-muted)] text-xs">Ply</p>
                            <p className="text-[var(--text-primary)] text-sm font-semibold">{spec.ply_rating}</p>
                          </div>
                        ) : null}
                      </div>

                      {spec.notes && (
                        <p className="text-[var(--text-muted)] text-xs border-t border-[var(--input-border)] pt-2 line-clamp-2">{spec.notes}</p>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── Tab: Fleet Compliance ───────────────────────────────────────────── */}
        {activeTab === 'compliance' && (
          <motion.div key="compliance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

            {/* Chart + Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="card flex flex-col">
                <p className="text-[var(--text-muted)] text-sm font-medium mb-3 flex items-center gap-2"><BarChart3 size={14} /> Compliance Breakdown</p>
                <div className="flex-1 min-h-[180px]">
                  {complianceData.length > 0 ? (
                    <Doughnut data={doughnutData} options={CHART_OPTS} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No data</div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
                {Object.entries({
                  Approved: complianceData.filter(r => r.specStatus === 'Approved').length,
                  'Non-Standard Size': complianceData.filter(r => r.specStatus === 'Non-Standard Size').length,
                  'Non-Approved Brand': complianceData.filter(r => r.specStatus === 'Non-Approved Brand').length,
                  'Multiple Violations': complianceData.filter(r => r.specStatus === 'Multiple Violations').length,
                  'No Spec Defined': complianceData.filter(r => r.specStatus === 'No Spec Defined').length,
                }).map(([status, count]) => {
                  const cfg = STATUS_CONFIG[status]
                  const Icon = cfg.icon
                  const pct = complianceData.length > 0 ? Math.round((count / complianceData.length) * 100) : 0
                  return (
                    <div key={status} className={`bg-[var(--surface-1)] border rounded-xl p-3 ${cfg.bg}`}>
                      <div className={`flex items-center gap-1.5 mb-1 ${cfg.color}`}>
                        <Icon size={13} />
                        <span className="text-xs font-medium">{status}</span>
                      </div>
                      <p className={`text-2xl font-bold ${cfg.color}`}>{count}</p>
                      <p className="text-[var(--text-muted)] text-xs">{pct}% of fleet</p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Compliance Table Filters */}
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={compSearch}
                  onChange={e => { setCompSearch(e.target.value); setCompPage(0) }}
                  placeholder="Search asset or vehicle type..."
                  className="w-full pl-9 pr-3 py-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none"
                />
              </div>
              <select value={compSiteFilter} onChange={e => { setCompSiteFilter(e.target.value); setCompPage(0) }} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] text-sm focus:border-blue-500 outline-none">
                <option value="">All Sites</option>
                {siteOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={compTypeFilter} onChange={e => { setCompTypeFilter(e.target.value); setCompPage(0) }} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] text-sm focus:border-blue-500 outline-none">
                <option value="">All Vehicle Types</option>
                {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={compStatusFilter} onChange={e => { setCompStatusFilter(e.target.value); setCompPage(0) }} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] text-sm focus:border-blue-500 outline-none">
                <option value="">All Statuses</option>
                {Object.keys(STATUS_CONFIG).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Compliance Table */}
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              {loadingRecords ? (
                <div className="py-16 text-center">
                  <RefreshCw size={24} className="animate-spin text-[var(--text-dim)] mx-auto mb-3" />
                  <p className="text-[var(--text-muted)] text-sm">Loading fleet data...</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--input-border)]">
                          {['Asset No', 'Vehicle Type', 'Position', 'Fitted Size', 'Fitted Brand', 'Site', 'Spec Status', 'Action'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs text-[var(--text-muted)] font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {compliancePage.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)] text-sm">No records match filters</td>
                          </tr>
                        ) : (
                          compliancePage.map((row, i) => {
                            const cfg = STATUS_CONFIG[row.specStatus]
                            const Icon = cfg.icon
                            return (
                              <motion.tr
                                key={`${row.id}-${i}`}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: i * 0.01 }}
                                className="border-b border-[var(--input-border)] hover:bg-gray-800/40 transition-colors"
                              >
                                <td className="px-4 py-3 text-[var(--text-primary)] text-sm font-mono">{row.asset_no || '-'}</td>
                                <td className="px-4 py-3 text-[var(--text-secondary)] text-sm">{row.vehicleType || <span className="text-[var(--text-dim)]">Unknown</span>}</td>
                                <td className="px-4 py-3 text-[var(--text-secondary)] text-sm">{normalizePosition(row.position) || '-'}</td>
                                <td className="px-4 py-3 text-[var(--text-secondary)] text-sm font-mono">{row.size || '-'}</td>
                                <td className="px-4 py-3 text-[var(--text-secondary)] text-sm">{row.brand || '-'}</td>
                                <td className="px-4 py-3 text-[var(--text-muted)] text-sm">{row.site || '-'}</td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
                                    <Icon size={10} /> {cfg.label}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  {(row.specStatus !== 'Approved' && row.specStatus !== 'No Spec Defined') && isAdmin && (
                                    <button
                                      onClick={() => setWorkOrderAsset({ asset_no: row.asset_no, site: row.site, violations: row.violations })}
                                      className="text-xs text-orange-400 hover:text-orange-300 underline whitespace-nowrap"
                                    >
                                      Raise WO
                                    </button>
                                  )}
                                </td>
                              </motion.tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {complianceTotalPages > 1 && (
                    <div className="px-4 py-3 border-t border-[var(--input-border)] flex items-center justify-between">
                      <p className="text-[var(--text-muted)] text-xs">
                        Showing {compPage * PAGE_SIZE + 1}-{Math.min((compPage + 1) * PAGE_SIZE, filteredCompliance.length)} of {filteredCompliance.length}
                      </p>
                      <div className="flex gap-1">
                        <button onClick={() => setCompPage(p => Math.max(0, p - 1))} disabled={compPage === 0} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors">
                          <ChevronLeft size={15} />
                        </button>
                        {Array.from({ length: Math.min(complianceTotalPages, 7) }, (_, i) => {
                          const pg = complianceTotalPages <= 7 ? i : compPage <= 3 ? i : compPage >= complianceTotalPages - 4 ? complianceTotalPages - 7 + i : compPage - 3 + i
                          return (
                            <button key={pg} onClick={() => setCompPage(pg)} className={`w-7 h-7 rounded text-xs transition-colors ${compPage === pg ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'}`}>{pg + 1}</button>
                          )
                        })}
                        <button onClick={() => setCompPage(p => Math.min(complianceTotalPages - 1, p + 1))} disabled={compPage >= complianceTotalPages - 1} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors">
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Tab: Non-Conformance ────────────────────────────────────────────── */}
        {activeTab === 'violations' && (
          <motion.div key="violations" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center justify-between">
                <p className="text-[var(--text-primary)] font-medium text-sm flex items-center gap-2">
                  <AlertOctagon size={15} className="text-red-400" />
                  Non-Conformance Report, Grouped by Asset
                </p>
                <span className="text-[var(--text-muted)] text-xs">{nonConformanceByAsset.length} vehicles with violations</span>
              </div>

              {loadingRecords ? (
                <div className="py-12 text-center">
                  <RefreshCw size={24} className="animate-spin text-[var(--text-dim)] mx-auto mb-3" />
                  <p className="text-[var(--text-muted)] text-sm">Analysing fleet...</p>
                </div>
              ) : nonConformanceByAsset.length === 0 ? (
                <EmptyState
                  illustration="state/success"
                  icon={CheckCircle}
                  title="Full Compliance"
                  description="No non-conforming fitments detected across the fleet."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--input-border)]">
                        {['Rank', 'Asset No', 'Site', 'Vehicle Type', 'Violations', 'Violation Types', 'Recommended Action', 'Action'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs text-[var(--text-muted)] font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {nonConformanceByAsset.map((a, i) => (
                        <motion.tr
                          key={a.asset_no}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.02 }}
                          className="border-b border-[var(--input-border)] hover:bg-gray-800/40 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-red-900 text-red-300' : 'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>{i + 1}</span>
                          </td>
                          <td className="px-4 py-3 text-[var(--text-primary)] font-mono text-sm">{a.asset_no}</td>
                          <td className="px-4 py-3 text-[var(--text-muted)] text-sm">{a.site || '-'}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)] text-sm">{a.vehicleType || 'Unknown'}</td>
                          <td className="px-4 py-3">
                            <span className={`text-sm font-bold ${a.violations.length >= 3 ? 'text-red-400' : 'text-orange-400'}`}>{a.violations.length}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {a.violationTypes.map(v => (
                                <span key={v} className="text-xs bg-red-900/30 text-red-300 border border-red-800 px-2 py-0.5 rounded-full">{v}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[var(--text-muted)] text-xs max-w-[180px]">
                            Replace non-approved fitments with spec-compliant tyres during next scheduled change
                          </td>
                          <td className="px-4 py-3">
                            {isAdmin && (
                              <button
                                onClick={() => setWorkOrderAsset({ asset_no: a.asset_no, site: a.site, violations: a.violations })}
                                className="flex items-center gap-1 bg-orange-900/30 hover:bg-orange-900/50 text-orange-400 text-xs px-3 py-1.5 rounded-lg border border-orange-800 transition-colors"
                              >
                                <Wrench size={11} /> Raise WO
                              </button>
                            )}
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Tab: Quick Setup ────────────────────────────────────────────────── */}
        {activeTab === 'defaults' && (
          <motion.div key="defaults" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

            <div className="card flex items-start gap-3">
              <Info size={16} className="text-blue-400 mt-0.5 shrink-0" />
              <p className="text-[var(--text-secondary)] text-sm">
                Industry-standard tyre specification defaults. Click <strong>Import</strong> to add any profile to your specification library. Already-imported specs are greyed out.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {SMART_DEFAULTS.map((def, i) => {
                const alreadyImported = specs.some(s => s.vehicle_type === def.vehicle_type && s.position === def.position)
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`bg-[var(--surface-1)] border rounded-xl p-4 transition-colors ${alreadyImported ? 'border-[var(--input-border)] opacity-50' : 'border-[var(--input-border)] hover:border-blue-700'}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <Zap size={13} className="text-yellow-400" />
                          <span className="text-[var(--text-primary)] font-medium text-sm">{def.vehicle_type}</span>
                        </div>
                        <span className="text-xs text-[var(--text-muted)] bg-[var(--input-bg)] px-2 py-0.5 rounded-full">{def.position}</span>
                      </div>
                      {alreadyImported ? (
                        <span className="flex items-center gap-1 text-xs text-green-400 bg-green-900/20 border border-green-800 px-2 py-1 rounded-lg">
                          <CheckCircle size={10} /> Imported
                        </span>
                      ) : (
                        isAdmin && (
                          <button
                            onClick={() => importQuickDefault(def)}
                            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <Plus size={11} /> Import
                          </button>
                        )
                      )}
                    </div>
                    <div className="space-y-2">
                      <div>
                        <p className="text-[var(--text-muted)] text-xs mb-1">Approved Sizes</p>
                        <div className="flex flex-wrap gap-1">
                          {def.approved_sizes.map(s => <span key={s} className="text-xs bg-blue-900/30 text-blue-300 border border-blue-800 px-2 py-0.5 rounded-full">{s}</span>)}
                        </div>
                      </div>
                      <div>
                        <p className="text-[var(--text-muted)] text-xs mb-1">Approved Brands</p>
                        <div className="flex flex-wrap gap-1">
                          {def.approved_brands.map(b => <span key={b} className="text-xs bg-purple-900/30 text-purple-300 border border-purple-800 px-2 py-0.5 rounded-full">{b}</span>)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--input-border)]">
                        <div className="text-center">
                          <p className="text-[var(--text-muted)] text-xs">PSI</p>
                          <p className="text-[var(--text-primary)] text-sm font-semibold">{def.recommended_pressure}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[var(--text-muted)] text-xs">Min Tread</p>
                          <p className="text-[var(--text-primary)] text-sm font-semibold">{def.min_tread_depth}mm</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[var(--text-muted)] text-xs">Load/Speed</p>
                          <p className="text-[var(--text-primary)] text-sm font-semibold">{def.min_load_index}{def.min_speed_index}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[var(--text-muted)] text-xs">Ply</p>
                          <p className="text-[var(--text-primary)] text-sm font-semibold">{def.ply_rating || 'N/A'}</p>
                        </div>
                      </div>
                      <p className="text-[var(--text-dim)] text-xs pt-1">{def.notes}</p>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </motion.div>
        )}

        {/* ── Tab: Fitment Policy ─────────────────────────────────────────────── */}
        {activeTab === 'policy' && (
          <motion.div key="policy" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

            {/* Intro + download */}
            <div className="card flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="p-2.5 rounded-lg bg-[var(--input-bg)] text-blue-400 shrink-0">
                <FileText size={20} />
              </div>
              <div className="flex-1">
                <p className="text-[var(--text-primary)] font-medium text-sm mb-1">Tyre Fitment and Specification Policy</p>
                <p className="text-[var(--text-muted)] text-sm">
                  Generate a standardized, company-branded policy document that defines the approved
                  tyre fitment standards every workshop and fitter must follow. It compiles the current
                  specification library into an official reference for procurement, fitment and audit.
                </p>
              </div>
              <button
                onClick={downloadPolicyPdf}
                disabled={policyBusy}
                className="btn-primary gap-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {policyBusy ? <RefreshCw size={15} className="animate-spin" /> : <FileText size={15} />}
                {policyBusy ? 'Generating...' : 'Download Policy (PDF)'}
              </button>
            </div>

            {policyError && (
              <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2">
                <AlertTriangle size={14} /> {policyError}
                <button onClick={() => setPolicyError('')} className="ml-auto"><X size={14} /></button>
              </div>
            )}

            {specs.length === 0 && (
              <div className="bg-amber-900/20 border border-amber-800 text-amber-300 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2">
                <Info size={14} className="shrink-0" />
                No specifications defined yet. The governance sections below still apply; adding specs in
                the Specification Library will populate the Approved Fitment Standards table.
              </div>
            )}

            {/* Live preview */}
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center justify-between">
                <p className="text-[var(--text-primary)] font-medium text-sm flex items-center gap-2">
                  <BookOpen size={15} className="text-blue-400" /> Policy Preview
                </p>
                <span className="text-[var(--text-muted)] text-xs">{policySections.length} sections</span>
              </div>

              <div className="p-4 space-y-4">
                {policySections.length === 0 ? (
                  <p className="text-[var(--text-muted)] text-sm">Policy content will appear here.</p>
                ) : (
                  <ol className="space-y-3">
                    {policySections.map((section, idx) => (
                      <li key={section.n ?? idx} className="border-l-2 border-[var(--input-border)] pl-4">
                        <p className="text-[var(--text-primary)] text-sm font-semibold mb-1">
                          {section.n != null ? `${section.n}. ` : ''}{section.title}
                        </p>
                        {section.body && (
                          <p className="text-[var(--text-muted)] text-xs whitespace-pre-line">{section.body}</p>
                        )}
                        {section.table && (() => {
                          const t = section.table
                          const head = Array.isArray(t.head) ? t.head
                            : Array.isArray(t.columns) ? t.columns
                            : (Array.isArray(t) && Array.isArray(t[0]) ? t[0] : [])
                          const rows = Array.isArray(t.rows) ? t.rows
                            : (Array.isArray(t) ? t.slice(head.length ? 1 : 0) : [])
                          if (rows.length === 0) {
                            return <p className="text-[var(--text-dim)] text-xs">No approved standards recorded yet.</p>
                          }
                          return (
                            <div className="overflow-x-auto mt-2 border border-[var(--input-border)] rounded-lg">
                              <table className="w-full">
                                {head.length > 0 && (
                                  <thead>
                                    <tr className="border-b border-[var(--input-border)]">
                                      {head.map((h, hi) => (
                                        <th key={hi} className="px-3 py-2 text-left text-xs text-[var(--text-muted)] font-medium whitespace-nowrap">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                )}
                                <tbody>
                                  {rows.map((r, ri) => (
                                    <tr key={ri} className="border-b border-[var(--input-border)] last:border-0">
                                      {(Array.isArray(r) ? r : Object.values(r)).map((cell, ci) => (
                                        <td key={ci} className="px-3 py-2 text-[var(--text-secondary)] text-xs">{cell == null || cell === '' ? 'N/A' : String(cell)}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )
                        })()}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Tab: Audit Trail ────────────────────────────────────────────────── */}
        {activeTab === 'history' && (
          <motion.div key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center justify-between">
                <p className="text-[var(--text-primary)] font-medium text-sm flex items-center gap-2">
                  <History size={15} className="text-blue-400" />
                  Specification Change History
                </p>
                <span className="text-[var(--text-muted)] text-xs">Last {Math.min(history.length, 100)} events</span>
              </div>

              {history.length === 0 ? (
                <EmptyState
                  illustration="state/no-data"
                  icon={History}
                  title="No history yet"
                  description="Changes to specifications will be tracked here."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--input-border)]">
                        {['Date', 'Action', 'User', 'Vehicle Type', 'Position', 'Changed Field', 'Old Value', 'New Value'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs text-[var(--text-muted)] font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...history].reverse().map((event, i) => {
                        const actionColor = event.action === 'Add' || event.action === 'Quick Setup Import' || event.action === 'Import' ? 'text-green-400' :
                          event.action === 'Edit' ? 'text-blue-400' : 'text-red-400'
                        return (
                          <tr key={event.id} className="border-b border-[var(--input-border)] hover:bg-gray-800/30 transition-colors">
                            <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs whitespace-nowrap">{new Date(event.date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                            <td className="px-4 py-2.5"><span className={`text-xs font-medium ${actionColor}`}>{event.action}</span></td>
                            <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs max-w-[120px] truncate">{event.user}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs">{event.vehicle_type}</td>
                            <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs">{event.position}</td>
                            <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs">{event.changed_field || '-'}</td>
                            <td className="px-4 py-2.5 text-[var(--text-dim)] text-xs max-w-[120px] truncate">{event.old_value || '-'}</td>
                            <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs max-w-[120px] truncate">{event.new_value || '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      {showSpecModal && (
        <SpecFormModal
          spec={editingSpec}
          onClose={() => { setShowSpecModal(false); setEditingSpec(null) }}
          onSave={handleSaveSpec}
          isAdmin={isAdmin}
          saving={savingSpec}
        />
      )}

      {deletingSpec && (
        <DeleteConfirmModal
          spec={deletingSpec}
          onClose={() => setDeletingSpec(null)}
          onConfirm={handleDeleteSpec}
        />
      )}

      {workOrderAsset && (
        <RaiseWorkOrderModal
          asset={workOrderAsset}
          violations={workOrderAsset.violations}
          country={country}
          createdBy={user?.id}
          onClose={() => setWorkOrderAsset(null)}
        />
      )}
    </div>
  )
}
