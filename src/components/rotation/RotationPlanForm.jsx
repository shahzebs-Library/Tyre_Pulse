/**
 * Right rail "Create rotation schedule" panel, used for create and edit.
 * Rotation type, positions, technician and attachments are written to their own
 * tyre_rotations columns (see rotationScheduleView.planColumns).
 */
import { useMemo, useState } from 'react'
import { Upload, X, Paperclip } from 'lucide-react'
import { Card } from '../commandCenter/kit'
import { PRIORITIES } from '../../lib/rotationScheduleAnalytics'
import {
  ROTATION_TYPES, POSITION_OPTIONS, POSITION_LABEL, newPositionsFor, planOf, planColumns, attachmentsOf, validatePlan, isoDay,
} from '../../lib/rotationScheduleView'
import { validateAttachment, ATTACHMENT_ACCEPT } from '../../lib/api/rotations'

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function defaultDate() {
  const d = new Date(); d.setDate(d.getDate() + 7)
  return isoDay(d)
}

function initialForm(seed) {
  if (seed?.editing) {
    const p = planOf(seed.editing)
    return {
      asset: seed.editing.asset || '', type: p.type && ROTATION_TYPES.includes(p.type) ? p.type : 'Custom',
      from: p.from, to: p.to, scheduledDate: seed.editing.scheduledDate || defaultDate(),
      priority: seed.editing.priority || 'Medium', technician: p.technician || '', site: seed.editing.site || '', notes: p.freeNotes || '',
      attachments: attachmentsOf(seed.editing), files: [],
    }
  }
  const v = seed?.vehicle
  return {
    asset: v?.asset || '', type: 'Standard', from: [], to: [], scheduledDate: defaultDate(),
    priority: v?.status === 'Overdue' ? 'Critical' : v?.status === 'Due Soon' ? 'High' : 'Medium',
    technician: '', site: v?.site && v.site !== 'Unassigned' ? v.site : '', notes: '', attachments: [], files: [],
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
  const [fileError, setFileError] = useState('')

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

  const addFiles = (list) => {
    const picked = [...(list || [])]
    const bad = picked.map(validateAttachment).find(Boolean)
    setFileError(bad || '')
    const ok = picked.filter((f) => !validateAttachment(f))
    if (ok.length) set({ files: [...form.files, ...ok] })
  }

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
      columns: planColumns(form, technicians),
      attachments: form.attachments,
      files: form.files,
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
          <datalist id="rs-techs">{technicians.map((t) => <option key={t.id} value={t.name} />)}</datalist>
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
          <label
            className="rs-upload"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer?.files) }}
          >
            <Upload size={16} aria-hidden="true" /><br />
            Drop files here or choose files. JPG, PNG or PDF, up to 10 MB each.
            <input type="file" multiple accept={ATTACHMENT_ACCEPT} className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          </label>
          {fileError && <small className="rs-err" role="alert">{fileError}</small>}
          {(form.attachments.length > 0 || form.files.length > 0) && (
            <ul className="rs-files">
              {form.attachments.map((f) => (
                <li key={f.path}><Paperclip size={12} aria-hidden="true" /> <span>{f.name}</span> <small>{fmtSize(f.size || 0)}</small>
                  <button type="button" className="cc-icon-btn" aria-label={`Remove ${f.name}`} onClick={() => set({ attachments: form.attachments.filter((x) => x.path !== f.path) })}><X size={12} /></button>
                </li>
              ))}
              {form.files.map((f, i) => (
                <li key={`new-${i}-${f.name}`}><Paperclip size={12} aria-hidden="true" /> <span>{f.name}</span> <small>{fmtSize(f.size)}, uploads on save</small>
                  <button type="button" className="cc-icon-btn" aria-label={`Remove ${f.name}`} onClick={() => set({ files: form.files.filter((_, j) => j !== i) })}><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <p className="rs-err" role="alert">{error}</p>}
        <div className="rs-actions">
          <button type="button" className="cc-btn-ghost" onClick={() => (onCancel ? onCancel() : setForm(initialForm(null)))} disabled={busy}>Cancel</button>
          <button type="submit" className="cc-btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save schedule'}</button>
        </div>
      </form>
    </Card>
  )
}
