/**
 * "Add new tyre specification" rail panel (also the edit and duplicate form).
 * Writes only the real `tyre_specifications` columns through the page's
 * existing save handler (specToRow whitelist). Mockup fields with no column
 * (pattern, tube type, dual load, images, approval state) are stated as not
 * stored instead of being offered as inputs that would silently be dropped.
 */
import { useState } from 'react'
import { Plus, X, Save, Upload } from 'lucide-react'
import { Card } from '../commandCenter/kit'
import {
  VEHICLE_TYPES, POSITIONS, SPEED_INDICES, PLY_RATINGS, APPROVED_BRANDS,
} from '../../lib/tyreSpecCatalog'
import { composeSize, sizeKey, tyreTypeOf, positionForTyreType, TYRE_TYPES } from '../../lib/tyreSpecView'

const BLANK = {
  vehicle_type: '', position: 'Steer', approved_sizes: [], approved_brands: [],
  min_load_index: '', min_speed_index: '', ply_rating: '', recommended_pressure: '',
  min_tread_depth: '', notes: '',
}

function initialForm(spec) {
  if (!spec) return { ...BLANK }
  return {
    ...BLANK,
    ...spec,
    approved_sizes: [...(spec.approved_sizes || [])],
    approved_brands: [...(spec.approved_brands || [])],
  }
}

export default function SpecFormPanel({ spec, isAdmin, saving, error, onSave, onCancel }) {
  const [form, setForm] = useState(() => initialForm(spec))
  const [brandPick, setBrandPick] = useState('')
  const [size, setSize] = useState({ w: '', a: '', r: '' })
  const [localError, setLocalError] = useState('')
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const editing = Boolean(spec?.id)
  const title = editing ? 'Edit tyre specification' : spec ? 'Duplicate tyre specification' : 'Add new tyre specification'

  if (!isAdmin) {
    return (
      <Card title="Add new tyre specification">
        <div className="cc-empty">Only an Admin can add or change tyre specifications.</div>
      </Card>
    )
  }

  function addBrand() {
    const b = brandPick.trim()
    if (!b) return
    if (!form.approved_brands.some((x) => x.toLowerCase() === b.toLowerCase())) set('approved_brands', [...form.approved_brands, b])
    setBrandPick('')
  }
  function addSize() {
    const z = composeSize(size.w, size.a, size.r)
    if (!z) { setLocalError('Enter a width (e.g. 315), an aspect ratio (e.g. 80) and a rim (e.g. 22.5).'); return }
    if (!form.approved_sizes.some((x) => sizeKey(x) === sizeKey(z))) set('approved_sizes', [...form.approved_sizes, z])
    setSize({ w: '', a: '', r: '' })
    setLocalError('')
  }
  function submit(e) {
    e.preventDefault()
    let err = null
    if (!form.vehicle_type.trim()) err = 'Application (vehicle type) is required.'
    else if (!form.position) err = 'Position is required.'
    else if (!form.approved_sizes.length) err = 'Add at least one approved size.'
    else if (!form.approved_brands.length) err = 'Add at least one approved brand.'
    setLocalError(err || '')
    if (!err) onSave(form)
  }

  const tyreType = tyreTypeOf(form.position)
  const positionChoices = tyreType === 'Off-Road'
    ? POSITIONS.filter((p) => /otr/i.test(p))
    : tyreType === 'Other' ? POSITIONS.filter((p) => ['Lift Axle', 'Tag Axle', 'All Positions'].includes(p)) : null

  return (
    <Card title={title} sub="Saved as an approved fitment rule for one vehicle type and position.">
      <form className="ts-form" onSubmit={submit}>
        <label>Application (vehicle type) <em>*</em>
          <input list="ts-vehicle-types" value={form.vehicle_type} onChange={(e) => set('vehicle_type', e.target.value)} placeholder="e.g. Mixer" />
          <datalist id="ts-vehicle-types">{VEHICLE_TYPES.map((v) => <option key={v} value={v} />)}</datalist>
        </label>

        <div className="ts-field">
          <span>Brand <em>*</em></span>
          <div className="ts-inline">
            <input list="ts-brands" value={brandPick} onChange={(e) => setBrandPick(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBrand() } }} placeholder="Select or type a brand" aria-label="Brand" />
            <datalist id="ts-brands">{APPROVED_BRANDS.map((b) => <option key={b} value={b} />)}</datalist>
            <button type="button" className="cc-icon-btn" aria-label="Add brand" onClick={addBrand}><Plus size={14} /></button>
          </div>
          <TagList items={form.approved_brands} onRemove={(b) => set('approved_brands', form.approved_brands.filter((x) => x !== b))} />
        </div>

        <div className="ts-field">
          <span>Model / pattern</span>
          <p className="ts-note">Not stored for a specification. Record the pattern in Description if it matters.</p>
        </div>

        <div className="ts-field">
          <span>Size <em>*</em></span>
          <div className="ts-size">
            <input inputMode="numeric" aria-label="Width" placeholder="Width" value={size.w} onChange={(e) => setSize((s) => ({ ...s, w: e.target.value }))} />
            <b>/</b>
            <input inputMode="numeric" aria-label="Aspect ratio" placeholder="Aspect" value={size.a} onChange={(e) => setSize((s) => ({ ...s, a: e.target.value }))} />
            <b>R</b>
            <input inputMode="decimal" aria-label="Rim" placeholder="Rim" value={size.r} onChange={(e) => setSize((s) => ({ ...s, r: e.target.value }))} />
            <button type="button" className="cc-icon-btn" aria-label="Add size" onClick={addSize}><Plus size={14} /></button>
          </div>
          <TagList items={form.approved_sizes} onRemove={(z) => set('approved_sizes', form.approved_sizes.filter((x) => x !== z))} />
        </div>

        <div className="ts-field">
          <span>Tyre type <em>*</em></span>
          <div className="ts-seg" role="group" aria-label="Tyre type">
            {TYRE_TYPES.map((t) => (
              <button key={t} type="button" aria-pressed={tyreType === t} onClick={() => set('position', positionForTyreType(t, form.position))}>{t}</button>
            ))}
          </div>
          {positionChoices && (
            <select className="cc-select" aria-label="Position" value={form.position} onChange={(e) => set('position', e.target.value)}>
              {positionChoices.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
        </div>

        <div className="ts-row2">
          <label>Load index (single)
            <input type="number" value={form.min_load_index} onChange={(e) => set('min_load_index', e.target.value)} placeholder="e.g. 156" />
          </label>
          <label>Speed rating
            <select value={form.min_speed_index} onChange={(e) => set('min_speed_index', e.target.value)}>
              <option value="">Not set</option>
              {SPEED_INDICES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <p className="ts-note">A dual load index is not stored.</p>

        <div className="ts-row2">
          <label>Ply rating
            <select value={form.ply_rating} onChange={(e) => set('ply_rating', e.target.value)}>
              <option value="">Not set</option>
              {PLY_RATINGS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>Recommended pressure (psi)
            <input type="number" value={form.recommended_pressure} onChange={(e) => set('recommended_pressure', e.target.value)} placeholder="e.g. 120" />
          </label>
        </div>

        <div className="ts-row2">
          <label>Minimum tread (mm)
            <input type="number" step="0.1" value={form.min_tread_depth} onChange={(e) => set('min_tread_depth', e.target.value)} placeholder="e.g. 3" />
          </label>
          <div className="ts-field"><span>TT / TL</span><p className="ts-note">Not stored.</p></div>
        </div>

        <label>Description
          <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Fitment notes, pattern, restrictions" />
        </label>

        <div className="ts-upload" aria-disabled="true">
          <Upload size={16} aria-hidden="true" />
          <span>Image and document upload is not available: specifications have no file storage.</span>
        </div>

        <div className="ts-field">
          <span>Approval status</span>
          <p className="ts-note">A saved rule is the approved fitment. There is no pending or not approved state to set.</p>
        </div>

        {(localError || error) && <p className="ts-err" role="alert">{localError || error}</p>}

        <div className="ts-form-actions">
          <button type="button" className="cc-btn-ghost" onClick={onCancel} disabled={saving}><X size={14} aria-hidden="true" /> Cancel</button>
          <button type="submit" className="cc-btn-primary" disabled={saving}><Save size={14} aria-hidden="true" /> {saving ? 'Saving...' : 'Save specification'}</button>
        </div>
      </form>
    </Card>
  )
}

function TagList({ items, onRemove }) {
  if (!items.length) return null
  return (
    <div className="ts-chips">
      {items.map((x) => (
        <span key={x} className="ts-chip">
          {x}
          <button type="button" aria-label={`Remove ${x}`} onClick={() => onRemove(x)}><X size={11} /></button>
        </span>
      ))}
    </div>
  )
}
