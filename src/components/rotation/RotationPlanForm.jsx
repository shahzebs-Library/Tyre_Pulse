/**
 * Right rail "Create rotation schedule" panel, used for create and edit.
 * Rotation type, positions and technician have no column on tyre_rotations, so
 * they are written into the notes header (see rotationScheduleView.encodePlan).
 */
import { useMemo, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { Card } from '../commandCenter/kit'
import { PRIORITIES } from '../../lib/rotationScheduleAnalytics'
import {
  ROTATION_TYPES, POSITION_OPTIONS, POSITION_LABEL, newPositionsFor, encodePlan, parsePlan, validatePlan, isoDay,
} from '../../lib/rotationScheduleView'

function defaultDate() {
  const d = new Date(); d.setDate(d.getDate() + 7)
  return isoDay(d)
}

function initialForm(seed) {
  if (seed?.editing) {
    const p = parsePlan(seed.editing.notes)
    return {
      asset: seed.editing.asset || '', type: p.type && ROTATION_TYPES.includes(p.type) ? p.type : 'Custom',
      from: p.from, to: p.to, scheduledDate: seed.editing.scheduledDate || defaultDate(),
      priority: seed.editing.priority || 'Medium', technician: p.technician || '', site: seed.editing.site || '', notes: p.freeNotes || '',
    }
  }
  const v = seed?.vehicle
  return {
    asset: v?.asset || '', type: 'Standard', from: [], to: [], scheduledDate: defaultDate(),
    priority: v?.status === 'Overdue' ? 'Critical' : v?.status === 'Due Soon' ? 'High' : 'Medium',
    technician: '', site: v?.site && v.site !== 'Unassigned' ? v.site : '', notes: '',
  }
}

function Chips({ value, onToggle, label, disabled }) {
  return (
    <div className="rs-chips" role="group" aria-label={label}>
      {POSITION_OPTIONS.map((p) => {
        const idx = value.indexOf(p)
        return (
          <button key={p} type="button" aria-pressed={idx >= 0} disabled={disabled} title={POSITION_LABEL[p]} onClick={() => onToggle(p)}>
            {p}{idx >= 0 && value.length > 1 ? <small>{idx + 1}</small> : null}
          </button>
        )
      })}
    </div>
  )
}

export default function RotationPlanForm({ seed, assets, sites, technicians, techError, busy, onCancel, onSave }) {
  const [form, setForm] = useState(() => initialForm(seed))
  const [error, setError] = useState('')

  const assetByNo = useMemo(() => new Map(assets.map((a) => [a.asset, a])), [assets])
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const pickAsset = (asset) => {
    const a = assetByNo.get(asset.trim())
    set({ asset, ...(a && !form.site && a.site && a.site !== 'Unassigned' ? { site: a.site } : {}) })
  }
  const setType = (type) => set({ type, to: type === 'Custom' ? form.to : (newPositionsFor(type, form.from) || []) })
  const toggleFrom = (p) => {
    const from = form.from.includes(p) ? form.from.filter((x) => x !== p) : [...form.from, p]
    set({ from, to: form.type === 'Custom' ? form.to.filter((_, i) => i < from.length) : (newPositionsFor(form.type, from) || []) })
  }
  const toggleTo = (p) => set({ to: form.to.includes(p) ? form.to.filter((x) => x !== p) : [...form.to, p] })

  async function submit(e) {
    e.preventDefault()
    const msg = validatePlan(form)
    if (msg) { setError(msg); return }
    setError('')
    const a = assetByNo.get(form.asset.trim())
    const ok = await onSave({
      asset: form.asset.trim(),
      site: form.site,
      scheduledDate: form.scheduledDate,
      priority: form.priority,
      notes: encodePlan({ type: form.type, from: form.from, to: form.to, technician: form.technician, notes: form.notes }),
      currentKm: a?.currentKm ?? seed?.editing?.currentKm ?? null,
      status: 'Open',
    }, seed?.editing?.id || null)
    if (ok === false) setError('The schedule could not be saved. See the message above the register.')
  }

  const editing = !!seed?.editing
  return (
    <Card title={editing ? 'Edit rotation schedule' : 'Create rotation schedule'} action={onCancel ? <button type="button" className="cc-icon-btn" aria-label="Close the form" onClick={onCancel}><X size={14} /></button> : null}>
      <form className="rs-form" onSubmit={submit}>
        <label>
          <span>Vehicle / asset <em>*</em></span>
          <input list="rs-assets" value={form.asset} placeholder="Select vehicle or asset" autoComplete="off" onChange={(e) => pickAsset(e.target.value)} />
          <datalist id="rs-assets">{assets.slice(0, 3000).map((a) => <option key={a.asset} value={a.asset}>{[a.type, a.site].filter(Boolean).join(', ')}</option>)}</datalist>
        </label>
        <div>
          <span className="rs-lbl">Rotation type <em>*</em></span>
          <div className="rs-seg" role="group" aria-label="Rotation type">
            {ROTATION_TYPES.map((t) => <button key={t} type="button" aria-pressed={form.type === t} onClick={() => setType(t)}>{t}</button>)}
          </div>
        </div>
        <div>
          <span className="rs-lbl">Current positions <em>*</em></span>
          <Chips value={form.from} onToggle={toggleFrom} label="Current positions" />
        </div>
        <div>
          <span className="rs-lbl">New positions <em>*</em> {form.type !== 'Custom' && <small>set by the {form.type.toLowerCase()} pattern</small>}</span>
          <Chips value={form.to} onToggle={toggleTo} label="New positions" disabled={form.type !== 'Custom'} />
        </div>
        <label><span>Scheduled date <em>*</em></span><input type="date" value={form.scheduledDate} onChange={(e) => set({ scheduledDate: e.target.value })} /></label>
        <label><span>Priority</span>
          <select value={form.priority} onChange={(e) => set({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </label>
        <label><span>Technician</span>
          <input list="rs-techs" value={form.technician} placeholder="Select technician" autoComplete="off" onChange={(e) => set({ technician: e.target.value })} />
          <datalist id="rs-techs">{technicians.map((t) => <option key={t} value={t} />)}</datalist>
          {techError && <small className="rs-note">Technician list unavailable. Type a name.</small>}
        </label>
        <label><span>Site <em>*</em></span>
          <select value={form.site} onChange={(e) => set({ site: e.target.value })}>
            <option value="">Select site</option>
            {[...new Set([...sites, form.site].filter(Boolean))].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label><span>Notes</span><textarea rows={3} value={form.notes} placeholder="Enter notes" onChange={(e) => set({ notes: e.target.value })} /></label>
        <div>
          <span className="rs-lbl">Attachments</span>
          <div className="rs-upload" aria-disabled="true"><Upload size={16} aria-hidden="true" /><br />Attachments are not available yet: rotation schedules have no file storage.</div>
        </div>
        <p className="rs-note">Rotation type, positions and technician are kept in the schedule notes, because the schedule table has no columns for them yet.</p>
        {error && <p className="rs-err" role="alert">{error}</p>}
        <div className="rs-actions">
          <button type="button" className="cc-btn-ghost" onClick={() => (onCancel ? onCancel() : setForm(initialForm(null)))} disabled={busy}>Cancel</button>
          <button type="submit" className="cc-btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save schedule'}</button>
        </div>
      </form>
    </Card>
  )
}
