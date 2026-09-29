/**
 * "Add new tyre specification" rail form for the CATALOGUE (`tyre_spec_catalog`).
 * Also edits and duplicates. Every mockup field is a real column; the
 * dimension / load / inflation / weight / tread fields sit under "More details".
 *
 * Approval status is only offered to Admin/Manager/Director/super admin: the
 * server refuses (42501) a status set by anyone else, and stamps the approver.
 * Images and documents (JPG, PNG, PDF, max 10 MB) are uploaded after the row is
 * saved, under <organisation_id>/spec-catalog/<spec id>/ in `tyre-photos`.
 */
import { useState } from 'react'
import { X, Save, Upload, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { Card } from '../commandCenter/kit'
import { APPROVED_BRANDS, SPEED_INDICES, PLY_RATINGS, VEHICLE_TYPES } from '../../lib/tyreSpecCatalog'
import { composeSize, catalogSizeParts, catalogTypeLabel, catalogTypeToken, TYRE_TYPES, APPROVAL_OPTIONS } from '../../lib/tyreSpecView'
import { validateCatalogFile, MAX_FILE_BYTES } from '../../lib/api/tyreSpecCatalog'

const MORE_FIELDS = [
  ['tread_depth_new_mm', 'Tread depth new (mm)', '0.1'],
  ['tread_depth_min_mm', 'Minimum tread depth (mm)', '0.1'],
  ['overall_diameter_mm', 'Overall diameter (mm)', '1'],
  ['section_width_mm', 'Section width (mm)', '1'],
  ['max_load_single_kg', 'Max load single (kg)', '1'],
  ['max_load_dual_kg', 'Max load dual (kg)', '1'],
  ['inflation_single_kpa', 'Inflation single (kPa)', '1'],
  ['inflation_dual_kpa', 'Inflation dual (kPa)', '1'],
  ['weight_kg', 'Weight (kg)', '0.1'],
]

const BLANK = {
  brand: '', pattern: '', tyre_type: 'steer', load_index_single: '', load_index_dual: '', speed_rating: '',
  ply_rating: '', tube_type: 'tubeless', application: '', description: '', recommended_rim: '', suitable_for: [],
  approval_status: 'pending', approval_note: '', images: [], documents: [],
  ...Object.fromEntries(MORE_FIELDS.map(([k]) => [k, ''])),
}

function initial(spec) {
  if (!spec) return { ...BLANK }
  const out = { ...BLANK }
  for (const k of Object.keys(BLANK)) if (spec[k] != null) out[k] = Array.isArray(spec[k]) ? [...spec[k]] : spec[k]
  return out
}

/**
 * @param {{spec?:object|null, canCreate:boolean, canApprove:boolean, saving:boolean, error?:string,
 *   onSave:(form:object, files:{images:File[],documents:File[]})=>void, onCancel:()=>void}} props
 */
export default function CatalogFormPanel({ spec, canCreate, canApprove, saving, error, onSave, onCancel }) {
  const [form, setForm] = useState(() => initial(spec))
  const [size, setSize] = useState(() => catalogSizeParts(spec))
  const [suitable, setSuitable] = useState('')
  const [more, setMore] = useState(false)
  const [newFiles, setNewFiles] = useState([])
  const [localError, setLocalError] = useState('')
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const editing = Boolean(spec?.id)
  const title = editing ? 'Edit tyre specification' : spec ? 'Duplicate tyre specification' : 'Add new tyre specification'

  if (!canCreate) {
    return <Card title="Add new tyre specification"><div className="cc-empty">Your account must be approved to add tyre specifications.</div></Card>
  }
  if (editing && !canApprove && spec.approval_status !== 'pending') {
    return <Card title="Edit tyre specification"><div className="cc-empty">This specification is {spec.approval_status === 'approved' ? 'approved' : 'not approved'}. Only a manager can change it.</div></Card>
  }

  function addFiles(list) {
    const ok = []
    for (const f of Array.from(list || [])) {
      try { validateCatalogFile(f); ok.push(f) } catch (e) { setLocalError(`${f.name}: ${e.message}`); return }
    }
    setLocalError('')
    setNewFiles((cur) => [...cur, ...ok])
  }
  function addSuitable() {
    const v = suitable.trim()
    if (v && !form.suitable_for.some((x) => x.toLowerCase() === v.toLowerCase())) set('suitable_for', [...form.suitable_for, v])
    setSuitable('')
  }
  function submit(e) {
    e.preventDefault()
    const z = composeSize(size.w, size.a, size.r)
    let err = ''
    if (!form.brand.trim()) err = 'Brand is required.'
    else if (!form.pattern.trim()) err = 'Model / pattern is required.'
    else if (!z) err = 'Enter a width (e.g. 295), an aspect ratio (e.g. 80) and a rim (e.g. 22.5).'
    setLocalError(err)
    if (err) return
    const payload = { ...form, size: z, width_mm: size.w, aspect_ratio: size.a, rim_in: size.r }
    if (!canApprove) { delete payload.approval_status; delete payload.approval_note }
    if (!editing) { payload.images = []; payload.documents = [] }
    onSave(payload, {
      images: newFiles.filter((f) => f.type.startsWith('image/')),
      documents: newFiles.filter((f) => !f.type.startsWith('image/')),
    })
  }

  const kept = [...(form.images || []), ...(form.documents || [])]

  return (
    <Card title={title} sub={editing ? `${spec.brand} ${spec.pattern} ${spec.size}` : 'A catalogue entry: one brand, pattern and size.'}>
      <form className="ts-form" onSubmit={submit}>
        <label>Brand <em>*</em>
          <input list="tsc-brands" value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Select or type a brand" />
          <datalist id="tsc-brands">{APPROVED_BRANDS.map((b) => <option key={b} value={b} />)}</datalist>
        </label>
        <label>Model / pattern <em>*</em>
          <input value={form.pattern} onChange={(e) => set('pattern', e.target.value)} placeholder="e.g. RR202" />
        </label>

        <div className="ts-field">
          <span>Size <em>*</em></span>
          <div className="ts-size">
            <input inputMode="numeric" aria-label="Width" placeholder="Width" value={size.w} onChange={(e) => setSize((s) => ({ ...s, w: e.target.value }))} />
            <b>/</b>
            <input inputMode="numeric" aria-label="Aspect ratio" placeholder="Aspect" value={size.a} onChange={(e) => setSize((s) => ({ ...s, a: e.target.value }))} />
            <b>R</b>
            <input inputMode="decimal" aria-label="Rim" placeholder="Rim" value={size.r} onChange={(e) => setSize((s) => ({ ...s, r: e.target.value }))} />
          </div>
        </div>

        <div className="ts-field">
          <span>Tyre type</span>
          <div className="ts-seg" role="group" aria-label="Tyre type">
            {TYRE_TYPES.map((t) => (
              <button key={t} type="button" aria-pressed={catalogTypeLabel(form.tyre_type) === t} onClick={() => set('tyre_type', catalogTypeToken(t))}>{t}</button>
            ))}
          </div>
        </div>

        <div className="ts-row2">
          <label>Load index (single)
            <input type="number" value={form.load_index_single} onChange={(e) => set('load_index_single', e.target.value)} placeholder="e.g. 152" />
          </label>
          <label>Load index (dual)
            <input type="number" value={form.load_index_dual} onChange={(e) => set('load_index_dual', e.target.value)} placeholder="e.g. 148" />
          </label>
        </div>
        <div className="ts-row2">
          <label>Speed rating
            <select value={form.speed_rating} onChange={(e) => set('speed_rating', e.target.value)}>
              <option value="">Not set</option>
              {SPEED_INDICES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Ply rating
            <select value={form.ply_rating} onChange={(e) => set('ply_rating', e.target.value)}>
              <option value="">Not set</option>
              {PLY_RATINGS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>

        <div className="ts-field">
          <span>TT / TL</span>
          <div className="ts-seg" role="group" aria-label="Tube type">
            <button type="button" aria-pressed={form.tube_type === 'tubeless'} onClick={() => set('tube_type', 'tubeless')}>TL (tubeless)</button>
            <button type="button" aria-pressed={form.tube_type === 'tube'} onClick={() => set('tube_type', 'tube')}>TT (tube type)</button>
          </div>
        </div>

        <label>Application
          <input list="tsc-apps" value={form.application} onChange={(e) => set('application', e.target.value)} placeholder="e.g. Regional haul, mixer" />
          <datalist id="tsc-apps">{VEHICLE_TYPES.map((v) => <option key={v} value={v} />)}</datalist>
        </label>

        <div className="ts-field">
          <span>Suitable for</span>
          <div className="ts-inline">
            <input list="tsc-apps" value={suitable} onChange={(e) => setSuitable(e.target.value)} aria-label="Suitable for"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSuitable() } }} placeholder="Add a vehicle type" />
            <button type="button" className="cc-btn-ghost" onClick={addSuitable}>Add</button>
          </div>
          {form.suitable_for.length > 0 && (
            <div className="ts-chips">
              {form.suitable_for.map((x) => (
                <span key={x} className="ts-chip">{x}
                  <button type="button" aria-label={`Remove ${x}`} onClick={() => set('suitable_for', form.suitable_for.filter((y) => y !== x))}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        <label>Description
          <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Construction, use, restrictions" />
        </label>

        <button type="button" className="cc-link cc-link-btn" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />} More details
        </button>
        {more && (
          <div className="ts-row2">
            <label>Recommended rim
              <input value={form.recommended_rim} onChange={(e) => set('recommended_rim', e.target.value)} placeholder="e.g. 9.00" />
            </label>
            {MORE_FIELDS.map(([k, label, step]) => (
              <label key={k}>{label}
                <input type="number" step={step} min="0" value={form[k]} onChange={(e) => set(k, e.target.value)} />
              </label>
            ))}
          </div>
        )}

        <div className="ts-field">
          <span>Images and documents</span>
          <label className="ts-upload">
            <Upload size={16} aria-hidden="true" />
            <span>Add JPG, PNG or PDF (max {MAX_FILE_BYTES / 1024 / 1024} MB each)</span>
            <input type="file" accept="image/jpeg,image/png,application/pdf" multiple className="sr-only"
              onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          </label>
          {(kept.length > 0 || newFiles.length > 0) && (
            <div className="ts-chips">
              {kept.map((f) => (
                <span key={f.path} className="ts-chip"><FileText size={11} aria-hidden="true" /> {f.name || 'File'}
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => {
                    set('images', (form.images || []).filter((x) => x.path !== f.path))
                    set('documents', (form.documents || []).filter((x) => x.path !== f.path))
                  }}><X size={11} /></button>
                </span>
              ))}
              {newFiles.map((f, i) => (
                <span key={`${f.name}-${i}`} className="ts-chip muted">{f.name} (to upload)
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setNewFiles((cur) => cur.filter((_, j) => j !== i))}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="ts-field">
          <span>Approval status</span>
          {canApprove ? (
            <>
              <div className="ts-seg" role="radiogroup" aria-label="Approval status">
                {APPROVAL_OPTIONS.map((o) => (
                  <button key={o.key} type="button" role="radio" aria-checked={form.approval_status === o.key}
                    aria-pressed={form.approval_status === o.key} onClick={() => set('approval_status', o.key)}>{o.label}</button>
                ))}
              </div>
              <input value={form.approval_note || ''} onChange={(e) => set('approval_note', e.target.value)} placeholder="Approval note (optional)" aria-label="Approval note" />
            </>
          ) : (
            <p className="ts-note">New specifications start as Pending until a manager approves.</p>
          )}
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
