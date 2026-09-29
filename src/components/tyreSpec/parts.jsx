/**
 * Tyre Specifications building blocks: row mappers, the shared table shell,
 * column models, and the dialogs the page and its workbench tabs open
 * (delete confirm, raise work order, supplier quote form). Moved out of
 * src/pages/TyreSpecifications.jsx unchanged so the page could be rebuilt on
 * the Command Center kit without rewriting the working tools.
 */
import { useState, useRef } from 'react'
import {
  Trash2, X, Save, CheckCircle, AlertTriangle, AlertOctagon, HelpCircle, Tag, RefreshCw, Truck, Wrench, DollarSign, TrendingDown, Award, Gauge, Package,
} from 'lucide-react'
import Modal from '../ui/Modal'
import EnterpriseTable from '../ui/EnterpriseTable'
import * as tyreSpecsApi from '../../lib/api/tyreSpecs'
import {
  VEHICLE_TYPES, POSITIONS, SPEED_INDICES, PLY_RATINGS, APPROVED_BRANDS, SMART_DEFAULTS, brandMeta,
} from '../../lib/tyreSpecCatalog'
import { normalizePosition } from '../../lib/tyrePositions'
import { recommend } from '../../lib/tyreValueAdvisor'
import { toUserMessage } from '../../lib/safeError'

// ── Constants ─────────────────────────────────────────────────────────────────

export const PAGE_SIZE = 25

// POSITIONS, VEHICLE_TYPES, SPEED_INDICES, PLY_RATINGS, APPROVED_BRANDS and
// SMART_DEFAULTS are the shared single source imported from ../lib/tyreSpecCatalog.

export const STATUS_CONFIG = {
  Approved:            { label: 'Approved',           color: 'text-green-400',  bg: 'bg-green-900/20 border-green-800',  icon: CheckCircle },
  'Non-Standard Size': { label: 'Non-Standard Size',  color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-800', icon: AlertTriangle },
  'Non-Approved Brand':{ label: 'Non-Approved Brand', color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-800', icon: AlertTriangle },
  'Multiple Violations':{ label: 'Multiple Violations', color: 'text-red-400', bg: 'bg-red-900/20 border-red-800',    icon: AlertOctagon },
  'No Spec Defined':   { label: 'No Spec Defined',    color: 'text-gray-400',   bg: 'bg-gray-800 border-gray-700',        icon: HelpCircle },
}

export const DOUGHNUT_COLORS = ['#22c55e', '#f97316', '#f59e0b', '#6b7280', '#ef4444']

export const CHART_OPTS = {
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
export function specToRow(form, { country = null, createdBy = null } = {}) {
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
export function rowToSpec(row) {
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

export function TagInput({ values = [], onChange, placeholder }) {
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

export function BrandTagInput({ values = [], onChange, placeholder, suggestions = [] }) {
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

// ── Delete Confirm Modal ───────────────────────────────────────────────────────

// No form here, so the actions belong in Modal's pinned footer. The red panel
// edge the old overlay carried was decorative; the dialog shell owns its border
// now and the destructive intent is carried by the red Delete button and the
// consequence line, which is where it belongs.
export function DeleteConfirmModal({ spec, onClose, onConfirm }) {
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Delete Specification"
      footer={(
        <>
          <button onClick={onClose} className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm transition-colors">Cancel</button>
          <button onClick={onConfirm} className="flex items-center gap-2 bg-red-700 hover:bg-red-600 text-white text-sm px-4 py-2 rounded-lg transition-colors">
            <Trash2 size={14} /> Delete
          </button>
        </>
      )}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 bg-red-900/30 rounded-lg shrink-0">
          <Trash2 size={18} className="text-red-400" />
        </div>
        <div>
          <p className="text-[var(--text-muted)] text-sm mb-2">
            Delete <span className="text-[var(--text-primary)] font-medium">{spec?.vehicle_type}, {spec?.position}</span>?
          </p>
          {/* Kept verbatim. Deleting a fitment standard silently re-labels every
              affected vehicle in the compliance report, so the reader has to be
              told before, not after. */}
          <p className="text-[var(--text-muted)] text-xs">This action cannot be undone. Compliance records will show "No Spec Defined" for affected vehicles.</p>
        </div>
      </div>
    </Modal>
  )
}

// ── Raise Work Order Modal ─────────────────────────────────────────────────────

export function RaiseWorkOrderModal({ asset, violations, country, createdBy, onClose }) {
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
      setError(toUserMessage(err, 'Failed to raise work order'))
    } finally {
      setSaving(false)
    }
  }

  // One guarded close for Escape, the backdrop and the X. Previously only the
  // Cancel button was disabled while the insert was in flight, so dismissing
  // via the backdrop mid-request left the caller with no idea whether the work
  // order had been created. `submit` clears `saving` in a `finally`.
  const guardedClose = () => { if (!saving) onClose() }

  return (
    <Modal
      open
      onClose={guardedClose}
      size="md"
      title={done ? 'Work Order Raised' : 'Raise Work Order'}
    >
          {done ? (
            <div className="text-center py-4">
              <CheckCircle size={40} className="text-green-400 mx-auto mb-3" />
              <p className="text-[var(--text-muted)] text-sm">A high-priority work order has been created for {asset.asset_no}.</p>
              <button onClick={onClose} className="btn-secondary mt-4">Close</button>
            </div>
          ) : (
            <>
              <p className="text-[var(--text-muted)] text-sm mb-2">Asset: <span className="text-[var(--text-primary)]">{asset.asset_no}</span>, Site: <span className="text-[var(--text-primary)]">{asset.site}</span></p>
              {/* The violations this work order is being raised for, listed in
                  full - the person approving it must see what they are
                  committing a workshop to. */}
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
              {/* Submit stays inside its <form> rather than moving to Modal's
                  footer, which sits outside the form element. */}
              <form onSubmit={submit} className="flex justify-end gap-3">
                <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 text-sm transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm px-5 py-2 rounded-lg transition-colors">
                  {saving ? <RefreshCw size={14} className="animate-spin" /> : <Wrench size={14} />}
                  {saving ? 'Creating...' : 'Create Work Order'}
                </button>
              </form>
            </>
          )}
    </Modal>
  )
}

// ── Value Advisor helpers ──────────────────────────────────────────────────────

// Currency-aware money formatter. Null / blank -> "N/A" (never a dash).
export function fmtMoney(v, currency = 'SAR') {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return 'N/A'
  return `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`
}

// Plain value or "N/A".
export function fmtVal(v, suffix = '') {
  if (v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) return 'N/A'
  return `${v}${suffix}`
}

// Whitelisted DB row from the quote form (numbers coerced, blanks -> null).
export function quoteToRow(form, { country = null, createdBy = null } = {}) {
  const toNum = v => {
    if (v === '' || v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const row = {
    vehicle_type: String(form.vehicle_type ?? '').trim(),
    position: form.position || 'All Positions',
    brand: String(form.brand ?? '').trim(),
    size: form.size?.trim() ? form.size.trim() : null,
    ply_rating: form.ply_rating?.trim() ? form.ply_rating.trim() : null,
    supplier: form.supplier?.trim() ? form.supplier.trim() : null,
    unit_price: toNum(form.unit_price),
    currency: (form.currency?.trim() || 'SAR'),
    expected_life_km: toNum(form.expected_life_km),
    retreadable: !!form.retreadable,
    retread_count: toNum(form.retread_count),
    retread_cost_pct: toNum(form.retread_cost_pct),
    warranty_km: toNum(form.warranty_km),
    casing_value: toNum(form.casing_value),
    notes: form.notes?.trim() ? form.notes.trim() : null,
  }
  if (country != null) row.country = country
  if (createdBy != null) row.created_by = createdBy
  return row
}

export const CONFIDENCE_META = {
  high:     { label: 'High',     color: 'text-green-400',  bg: 'bg-green-900/20 border-green-800' },
  moderate: { label: 'Moderate', color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-800' },
  guidance: { label: 'Guidance', color: 'text-[var(--text-muted)]', bg: 'bg-[var(--input-bg)] border-[var(--input-border)]' },
}

// Row badges derived from the engine flags on each ranked econ item.
export function EconBadges({ e }) {
  const pills = []
  if (e.bestValue)   pills.push({ key: 'bv', label: 'Best Value',   icon: Award,        cls: 'text-green-300 bg-green-900/30 border-green-800' })
  if (e.bestDeal)    pills.push({ key: 'bd', label: 'Best Deal',    icon: DollarSign,   cls: 'text-blue-300 bg-blue-900/30 border-blue-800' })
  if (e.lowestCpk)   pills.push({ key: 'lc', label: 'Lowest CPK',   icon: TrendingDown, cls: 'text-emerald-300 bg-emerald-900/30 border-emerald-800' })
  if (e.longestLife) pills.push({ key: 'll', label: 'Longest Life', icon: Gauge,        cls: 'text-purple-300 bg-purple-900/30 border-purple-800' })
  if (pills.length === 0) return <span className="text-[var(--text-dim)] text-xs">-</span>
  return (
    <div className="flex flex-wrap gap-1">
      {pills.map(p => (
        <span key={p.key} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${p.cls}`}>
          <p.icon size={9} /> {p.label}
        </span>
      ))}
    </div>
  )
}

// Honest brand-economics guidance when there is not enough quote data to rank.
export function BrandGuidancePanel({ brands = [] }) {
  const list = Array.isArray(brands) ? brands.filter(Boolean) : []
  if (list.length === 0) {
    return (
      <p className="text-[var(--text-dim)] text-sm">
        No approved brands recorded for this fitment. Define the approved brands in the Specification
        Library to unlock brand-economics guidance.
      </p>
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {list.map(b => {
        const m = brandMeta(b)
        return (
          <div key={b} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[var(--text-primary)] font-medium text-sm flex items-center gap-1.5">
                <Package size={12} className="text-purple-400" /> {b}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] bg-[var(--input-bg)] px-2 py-0.5 rounded-full">
                {m.tier || 'unknown'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-[var(--text-muted)]">Origin: </span><span className="text-[var(--text-secondary)]">{fmtVal(m.origin || null)}</span></div>
              <div><span className="text-[var(--text-muted)]">Retreadable: </span><span className="text-[var(--text-secondary)]">{m.retreadable ? 'Yes' : 'No'}</span></div>
              <div><span className="text-[var(--text-muted)]">Casing: </span><span className="text-[var(--text-secondary)]">{fmtVal(m.casing || null)}</span></div>
              <div><span className="text-[var(--text-muted)]">Price idx: </span><span className="text-[var(--text-secondary)]">{fmtVal(m.priceIndex)}</span></div>
              <div><span className="text-[var(--text-muted)]">Durability idx: </span><span className="text-[var(--text-secondary)]">{fmtVal(m.durabilityIndex)}</span></div>
              <div className="col-span-2">
                <span className="text-[var(--text-muted)]">Application: </span>
                <span className="text-[var(--text-secondary)]">{m.application?.length ? m.application.join(', ') : 'N/A'}</span>
              </div>
            </div>
            {m.note && <p className="text-[var(--text-dim)] text-xs mt-2 leading-snug">{m.note}</p>}
          </div>
        )
      })}
    </div>
  )
}

// ── Quote Form Modal ───────────────────────────────────────────────────────────

export function QuoteFormModal({ quote, onClose, onSave, saving }) {
  const [form, setForm] = useState(quote ? {
    vehicle_type: quote.vehicle_type ?? '',
    position: quote.position ?? 'All Positions',
    brand: quote.brand ?? '',
    size: quote.size ?? '',
    ply_rating: quote.ply_rating ?? '',
    supplier: quote.supplier ?? '',
    unit_price: quote.unit_price ?? '',
    currency: quote.currency ?? 'SAR',
    expected_life_km: quote.expected_life_km ?? '',
    retreadable: !!quote.retreadable,
    retread_count: quote.retread_count ?? '',
    retread_cost_pct: quote.retread_cost_pct ?? 0.4,
    warranty_km: quote.warranty_km ?? '',
    casing_value: quote.casing_value ?? '',
    notes: quote.notes ?? '',
  } : {
    vehicle_type: '',
    position: 'All Positions',
    brand: '',
    size: '',
    ply_rating: '',
    supplier: '',
    unit_price: '',
    currency: 'SAR',
    expected_life_km: '',
    retreadable: false,
    retread_count: '',
    retread_cost_pct: 0.4,
    warranty_km: '',
    casing_value: '',
    notes: '',
  })
  const [error, setError] = useState('')

  function set(field, val) { setForm(prev => ({ ...prev, [field]: val })) }

  function validate() {
    if (!form.vehicle_type.trim()) return 'Vehicle Type is required'
    if (!form.position) return 'Position is required'
    if (!form.brand.trim()) return 'Brand is required'
    if (!form.supplier.trim()) return 'Supplier is required'
    if (form.unit_price === '' || !(Number(form.unit_price) > 0)) return 'Unit Price must be a positive number'
    if (form.expected_life_km === '' || !(Number(form.expected_life_km) > 0)) return 'Expected Life (km) must be a positive number'
    return null
  }

  function submit(e) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }
    onSave(form)
  }

  const inputCls = 'w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none'
  const labelCls = 'text-[var(--text-muted)] text-xs mb-1.5 block'

  // Same single guarded close as the specification form: the old backdrop and
  // X could both dismiss a save still in flight while Cancel was disabled.
  // `handleSaveQuote` clears `saving` in a `finally`.
  const guardedClose = () => { if (!saving) onClose() }

  return (
    <Modal
      open
      onClose={guardedClose}
      size="lg"
      title={quote?.id ? 'Edit Supplier Quote' : 'Add Supplier Quote'}
    >
          {/* Submit stays inside its <form>; Modal's footer is outside it. */}
          <form onSubmit={submit} className="space-y-5">
            {error && (
              <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Vehicle Type *</label>
                <input list="advisor-vehicle-types" value={form.vehicle_type} onChange={e => set('vehicle_type', e.target.value)} placeholder="e.g. Rigid Truck" className={inputCls} />
                <datalist id="advisor-vehicle-types">{VEHICLE_TYPES.map(v => <option key={v} value={v} />)}</datalist>
              </div>
              <div>
                <label className={labelCls}>Position *</label>
                <select value={form.position} onChange={e => set('position', e.target.value)} className={inputCls}>
                  {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Brand *</label>
                <input list="advisor-brands" value={form.brand} onChange={e => set('brand', e.target.value)} placeholder="e.g. Double Coin" className={inputCls} />
                <datalist id="advisor-brands">{APPROVED_BRANDS.map(b => <option key={b} value={b} />)}</datalist>
              </div>
              <div>
                <label className={labelCls}>Supplier *</label>
                <input value={form.supplier} onChange={e => set('supplier', e.target.value)} placeholder="e.g. Al Jazira Tyres" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Size</label>
                <input value={form.size} onChange={e => set('size', e.target.value)} placeholder="e.g. 315/80R22.5" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Ply / Star Rating</label>
                <input list="advisor-ply" value={form.ply_rating} onChange={e => set('ply_rating', e.target.value)} placeholder="e.g. 18PR" className={inputCls} />
                <datalist id="advisor-ply">{PLY_RATINGS.map(p => <option key={p} value={p} />)}</datalist>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Unit Price *</label>
                <input type="number" step="0.01" value={form.unit_price} onChange={e => set('unit_price', e.target.value)} placeholder="e.g. 1450" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Currency</label>
                <input value={form.currency} onChange={e => set('currency', e.target.value)} placeholder="SAR" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Expected Life (km) *</label>
                <input type="number" value={form.expected_life_km} onChange={e => set('expected_life_km', e.target.value)} placeholder="e.g. 120000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Warranty (km)</label>
                <input type="number" value={form.warranty_km} onChange={e => set('warranty_km', e.target.value)} placeholder="e.g. 60000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Casing Value</label>
                <input type="number" step="0.01" value={form.casing_value} onChange={e => set('casing_value', e.target.value)} placeholder="e.g. 200" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Retread Cost (fraction of new)</label>
                <input type="number" step="0.05" value={form.retread_cost_pct} onChange={e => set('retread_cost_pct', e.target.value)} placeholder="0.4" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 items-end">
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none pt-5">
                <input type="checkbox" checked={form.retreadable} onChange={e => set('retreadable', e.target.checked)} className="w-4 h-4 accent-blue-600" />
                Retreadable casing
              </label>
              <div>
                <label className={labelCls}>Planned Retread Count</label>
                <input type="number" value={form.retread_count} onChange={e => set('retread_count', e.target.value)} placeholder="e.g. 1" disabled={!form.retreadable} className={`${inputCls} disabled:opacity-40`} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Lead time, payment terms, delivery..." className={`${inputCls} resize-none`} />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 text-sm transition-colors">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving...' : quote?.id ? 'Update Quote' : 'Save Quote'}
              </button>
            </div>
          </form>
    </Modal>
  )
}

// ── Delete Quote Confirm Modal ─────────────────────────────────────────────────

// No form, so the actions sit in Modal's pinned footer.
export function DeleteQuoteConfirmModal({ quote, onClose, onConfirm }) {
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Delete Supplier Quote"
      footer={(
        <>
          <button onClick={onClose} className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm transition-colors">Cancel</button>
          <button onClick={onConfirm} className="flex items-center gap-2 bg-red-700 hover:bg-red-600 text-white text-sm px-4 py-2 rounded-lg transition-colors">
            <Trash2 size={14} /> Delete
          </button>
        </>
      )}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 bg-red-900/30 rounded-lg shrink-0"><Trash2 size={18} className="text-red-400" /></div>
        <div>
          <p className="text-[var(--text-muted)] text-sm mb-2">
            Delete the quote for <span className="text-[var(--text-primary)] font-medium">{quote?.brand || 'this brand'}</span>
            {quote?.supplier ? <> from <span className="text-[var(--text-primary)] font-medium">{quote.supplier}</span></> : null}?
          </p>
          {/* Kept verbatim: removing a quote changes which option the advisor
              ranks as best value, so the effect is stated, not implied. */}
          <p className="text-[var(--text-muted)] text-xs">This removes it from the value ranking. This action cannot be undone.</p>
        </div>
      </div>
    </Modal>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

// ── Shared table shell ─────────────────────────────────────────────────────────
// Every grid on this page keeps its OWN controls: the compliance grid has four
// filters and its own pager, the size inventory its own search and export, the
// advisor ranking and the audit trail carry an order that IS the record. So the
// shared EnterpriseTable runs here with search, sorting, column filters, export
// and keyboard nav switched OFF - it contributes the header contract, empty
// state and row rendering only, and can never re-order or re-scope a grid.
export function SpecTable({ columns, data, getRowId, emptyMessage = 'No records', maxHeight = 640, onRowClick }) {
  return (
    <EnterpriseTable
      columns={columns}
      data={data}
      getRowId={getRowId}
      className="border-0 rounded-none shadow-none"
      enableGlobalFilter={false}
      enableColumnFilters={false}
      enableSorting={false}
      enableExport={false}
      enableColumnVisibility={false}
      enableKeyboard={false}
      virtual
      maxHeight={maxHeight}
      emptyMessage={emptyMessage}
      onRowClick={onRowClick}
    />
  )
}

export const dash = (v) => (v == null || v === '' ? 'N/A' : v)

export function complianceColumns({ isAdmin, onRaiseWo }) {
  return [
    { id: 'asset', header: 'Asset No', cell: ({ row }) => <span className="text-[var(--text-primary)] text-sm font-mono">{dash(row.original.asset_no)}</span> },
    { id: 'type', header: 'Vehicle Type', cell: ({ row }) => row.original.vehicleType ? <span className="text-[var(--text-secondary)] text-sm">{row.original.vehicleType}</span> : <span className="text-[var(--text-dim)] text-sm">Unknown</span> },
    { id: 'position', header: 'Position', cell: ({ row }) => <span className="text-[var(--text-secondary)] text-sm">{dash(normalizePosition(row.original.position))}</span> },
    { id: 'size', header: 'Fitted Size', cell: ({ row }) => <span className="text-[var(--text-secondary)] text-sm font-mono">{dash(row.original.size)}</span> },
    { id: 'brand', header: 'Fitted Brand', cell: ({ row }) => <span className="text-[var(--text-secondary)] text-sm">{dash(row.original.brand)}</span> },
    { id: 'site', header: 'Site', cell: ({ row }) => <span className="text-[var(--text-muted)] text-sm">{dash(row.original.site)}</span> },
    {
      id: 'status', header: 'Spec Status',
      cell: ({ row }) => {
        const cfg = STATUS_CONFIG[row.original.specStatus] || STATUS_CONFIG['No Spec Defined']
        const Icon = cfg.icon
        return (
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
            <Icon size={10} /> {cfg.label}
          </span>
        )
      },
    },
    {
      id: 'action', header: 'Action',
      cell: ({ row }) => {
        const r = row.original
        if (r.specStatus === 'Approved' || r.specStatus === 'No Spec Defined' || !isAdmin) return null
        return (
          <button
            onClick={() => onRaiseWo({ asset_no: r.asset_no, site: r.site, violations: r.violations })}
            className="text-xs text-orange-400 hover:text-orange-300 underline whitespace-nowrap"
          >
            Raise WO
          </button>
        )
      },
    },
  ]
}

export function nonConformanceColumns({ isAdmin, onRaiseWo }) {
  return [
    {
      id: 'rank', header: 'Rank',
      cell: ({ row }) => (
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${row.original.rank <= 3 ? 'bg-red-900 text-red-300' : 'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>{row.original.rank}</span>
      ),
    },
    { id: 'asset', header: 'Asset No', cell: ({ row }) => <span className="text-[var(--text-primary)] font-mono text-sm">{row.original.asset_no}</span> },
    { id: 'site', header: 'Site', cell: ({ row }) => <span className="text-[var(--text-muted)] text-sm">{dash(row.original.site)}</span> },
    { id: 'type', header: 'Vehicle Type', cell: ({ row }) => <span className="text-[var(--text-secondary)] text-sm">{row.original.vehicleType || 'Unknown'}</span> },
    {
      id: 'count', header: 'Violations',
      cell: ({ row }) => <span className={`text-sm font-bold ${row.original.violations.length >= 3 ? 'text-red-400' : 'text-orange-400'}`}>{row.original.violations.length}</span>,
    },
    {
      id: 'types', header: 'Violation Types',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.violationTypes.map(v => (
            <span key={v} className="text-xs bg-red-900/30 text-red-300 border border-red-800 px-2 py-0.5 rounded-full">{v}</span>
          ))}
        </div>
      ),
    },
    {
      id: 'recommend', header: 'Recommended Action',
      cell: () => <span className="block text-[var(--text-muted)] text-xs max-w-[180px] whitespace-normal">Replace non-approved fitments with spec-compliant tyres during next scheduled change</span>,
    },
    {
      id: 'action', header: 'Action',
      cell: ({ row }) => {
        const a = row.original
        if (!isAdmin) return null
        return (
          <button
            onClick={() => onRaiseWo({ asset_no: a.asset_no, site: a.site, violations: a.violations })}
            className="flex items-center gap-1 bg-orange-900/30 hover:bg-orange-900/50 text-orange-400 text-xs px-3 py-1.5 rounded-lg border border-orange-800 transition-colors"
          >
            <Wrench size={11} /> Raise WO
          </button>
        )
      },
    },
  ]
}

export const textCell = (key, cls = 'text-[var(--text-secondary)] text-xs whitespace-nowrap') =>
  ({ row }) => <span className={cls}>{dash(row.original[key])}</span>

export const SIZE_INVENTORY_COLUMNS = [
  { id: 'size', header: 'Tyre Size', cell: textCell('size', 'text-[var(--text-primary)] text-xs font-semibold whitespace-nowrap') },
  { id: 'count', header: 'Fitted Qty', cell: textCell('count') },
  { id: 'brands', header: 'Brands In Use', cell: ({ row }) => <span className="block text-[var(--text-secondary)] text-xs max-w-[220px] whitespace-normal" title={row.original.brandsLabel}>{dash(row.original.brandsLabel)}</span> },
  { id: 'approved', header: 'Approved Brands', cell: ({ row }) => <span className="block text-[var(--text-secondary)] text-xs max-w-[220px] whitespace-normal" title={row.original.approvedBrandsLabel}>{dash(row.original.approvedBrandsLabel)}</span> },
  { id: 'ply', header: 'Ply Rating', cell: textCell('plyRating') },
  { id: 'tread', header: 'Min Tread (mm)', cell: textCell('minTreadDepth') },
  { id: 'load', header: 'Load Idx', cell: textCell('minLoadIndex') },
  { id: 'speed', header: 'Speed', cell: textCell('minSpeedIndex') },
  { id: 'pressure', header: 'Pressure (PSI)', cell: textCell('recommendedPressure') },
  { id: 'types', header: 'Vehicle Types', cell: ({ row }) => <span className="block text-[var(--text-secondary)] text-xs max-w-[200px] whitespace-normal" title={row.original.vehicleTypesLabel}>{dash(row.original.vehicleTypesLabel)}</span> },
  {
    id: 'nonConforming', header: 'Non-Conforming',
    cell: ({ row }) => row.original.nonConformingCount > 0
      ? <span className="text-orange-400 font-medium text-xs">{row.original.nonConformingCount}</span>
      : <span className="text-green-400 text-xs">0</span>,
  },
]

/**
 * A policy section's table arrives in one of three shapes (head / columns / an
 * array-of-arrays). Normalise it to string-indexed cells and generate the column
 * defs from however many cells the widest row carries.
 */
export function policyTableModel(table) {
  const head = Array.isArray(table?.head) ? table.head
    : Array.isArray(table?.columns) ? table.columns
    : (Array.isArray(table) && Array.isArray(table[0]) ? table[0] : [])
  const raw = Array.isArray(table?.rows) ? table.rows
    : (Array.isArray(table) ? table.slice(head.length ? 1 : 0) : [])
  const rows = raw.map((r, ri) => {
    const cells = Array.isArray(r) ? r : Object.values(r || {})
    return { __key: String(ri), cells }
  })
  const width = Math.max(head.length, ...rows.map(r => r.cells.length), 0)
  const columns = Array.from({ length: width }, (_, ci) => ({
    id: `c${ci}`,
    header: head[ci] != null ? String(head[ci]) : '',
    cell: ({ row }) => {
      const v = row.original.cells[ci]
      return <span className="text-[var(--text-secondary)] text-xs">{v == null || v === '' ? 'N/A' : String(v)}</span>
    },
  }))
  return { columns, rows }
}

export function advisorColumns(rec, cur) {
  return [
    {
      id: 'brand', header: 'Brand',
      cell: ({ row }) => {
        const e = row.original
        return (
          <div className="text-[var(--text-primary)] text-sm font-medium whitespace-nowrap">
            <span className="flex items-center gap-1.5">
              {e === rec.pick && <CheckCircle size={12} className="text-emerald-400 shrink-0" />}
              {e.brand || 'N/A'}
            </span>
            {!e.valid && <span className="block text-[10px] text-amber-400">incomplete (needs price + life)</span>}
          </div>
        )
      },
    },
    { id: 'supplier', header: 'Supplier', cell: ({ row }) => <span className="text-[var(--text-secondary)] text-sm whitespace-nowrap">{row.original.supplier || 'N/A'}</span> },
    { id: 'price', header: 'Price', cell: ({ row }) => <span className="text-[var(--text-secondary)] text-sm whitespace-nowrap">{fmtMoney(row.original.unit_price, cur)}</span> },
    { id: 'life', header: 'Exp Life (km)', cell: ({ row }) => <span className="text-[var(--text-secondary)] text-sm whitespace-nowrap">{fmtVal(row.original.expected_life_km != null ? Number(row.original.expected_life_km).toLocaleString('en-US') : null)}</span> },
    { id: 'cpk', header: 'Lifecycle CPK', cell: ({ row }) => <span className="text-sm whitespace-nowrap font-semibold text-[var(--text-primary)]">{fmtVal(row.original.lifecycleCpk)}</span> },
    { id: 'per1000', header: 'Cost/1000km', cell: ({ row }) => <span className="text-[var(--text-secondary)] text-sm whitespace-nowrap">{fmtVal(row.original.costPer1000Km)}</span> },
    { id: 'warranty', header: 'Warranty %', cell: ({ row }) => <span className="text-[var(--text-secondary)] text-sm whitespace-nowrap">{fmtVal(row.original.warrantyCoverPct, '%')}</span> },
    { id: 'realized', header: 'Realized CPK', cell: ({ row }) => <span className="text-[var(--text-secondary)] text-sm whitespace-nowrap">{fmtVal(row.original.realizedCpk)}</span> },
    {
      id: 'confidence', header: 'Confidence',
      cell: ({ row }) => {
        const cm = CONFIDENCE_META[row.original.confidence] || CONFIDENCE_META.guidance
        return <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full border ${cm.bg} ${cm.color}`}>{cm.label}</span>
      },
    },
    { id: 'badges', header: 'Badges', cell: ({ row }) => <EconBadges e={row.original} /> },
  ]
}

export function historyActionColor(action) {
  if (action === 'Add' || action === 'Quick Setup Import' || action === 'Import') return 'text-green-400'
  if (action === 'Edit') return 'text-blue-400'
  return 'text-red-400'
}

export const HISTORY_COLUMNS = [
  {
    id: 'date', header: 'Date',
    cell: ({ row }) => {
      const d = new Date(row.original.date)
      return <span className="text-[var(--text-muted)] text-xs whitespace-nowrap">{Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
    },
  },
  { id: 'action', header: 'Action', cell: ({ row }) => <span className={`text-xs font-medium ${historyActionColor(row.original.action)}`}>{row.original.action}</span> },
  { id: 'user', header: 'User', cell: ({ row }) => <span className="block text-[var(--text-muted)] text-xs max-w-[120px] truncate">{dash(row.original.user)}</span> },
  { id: 'type', header: 'Vehicle Type', cell: ({ row }) => <span className="text-[var(--text-secondary)] text-xs">{dash(row.original.vehicle_type)}</span> },
  { id: 'position', header: 'Position', cell: ({ row }) => <span className="text-[var(--text-muted)] text-xs">{dash(row.original.position)}</span> },
  { id: 'field', header: 'Changed Field', cell: ({ row }) => <span className="text-[var(--text-muted)] text-xs">{dash(row.original.changed_field)}</span> },
  { id: 'old', header: 'Old Value', cell: ({ row }) => <span className="block text-[var(--text-dim)] text-xs max-w-[120px] truncate">{dash(row.original.old_value)}</span> },
  { id: 'new', header: 'New Value', cell: ({ row }) => <span className="block text-[var(--text-muted)] text-xs max-w-[120px] truncate">{dash(row.original.new_value)}</span> },
]
