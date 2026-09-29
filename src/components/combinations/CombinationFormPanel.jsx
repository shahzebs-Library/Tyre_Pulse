/**
 * Add / Edit Combination side panel (mockup right column). Controlled by the
 * page: it owns the form state and the save handler, this only renders.
 */
import { X } from 'lucide-react'
import { Card } from '../commandCenter/kit'
import TyreConfigVisual from './TyreConfigVisual'
import { MANAGER_STATUSES, STATUS_META, tyreConfigLabel } from '../../lib/combinationManagerView'
import { parseTrailerList } from '../../lib/combinations'

const AXLE_PRESETS = ['4x2', '6x2', '6x4', '8x4', '4x2 + 2A', '4x2 + 3A', '6x4 + 2A', '6x4 + 3A', '6x4 + 2A + 2A']

export default function CombinationFormPanel({
  form, setField, errors, editing, saving, saveError, placeholderNo,
  fleetOptions, typeOptions, siteOptions, onSave, onCancel,
}) {
  const err = (k) => (errors[k] ? <small className="cm-field-err">{errors[k]}</small> : null)
  const tyreLabel = tyreConfigLabel({ steer: form.steer, drive: form.drive, trailer: form.trailer })
  return (
    <Card
      className="cm-panel"
      title={editing ? 'Edit Combination' : 'Add Combination'}
      action={editing ? <button type="button" className="cc-icon-btn" onClick={onCancel} aria-label="Stop editing"><X size={14} /></button> : null}
    >
      <form className="cm-form" onSubmit={onSave} noValidate>
        <datalist id="cm-fleet-options">{fleetOptions.map((a) => <option key={a} value={a} />)}</datalist>
        <datalist id="cm-type-options">{typeOptions.map((t) => <option key={t} value={t} />)}</datalist>
        <datalist id="cm-site-options">{siteOptions.map((s) => <option key={s} value={s} />)}</datalist>
        <datalist id="cm-axle-options">{AXLE_PRESETS.map((a) => <option key={a} value={a} />)}</datalist>

        <label className="cc-field"><span>Combination No.</span>
          <input className="cm-input" value={form.combination_no} placeholder={placeholderNo} onChange={(e) => setField('combination_no', e.target.value)} />
        </label>
        <label className="cc-field"><span>Name</span>
          <input className="cm-input" value={form.name} placeholder="Optional, e.g. Route 12 rig" onChange={(e) => setField('name', e.target.value)} />
        </label>
        <label className="cc-field"><span>Prime Mover <b aria-hidden="true">*</b></span>
          <input className="cm-input" list="cm-fleet-options" value={form.prime_mover_no} placeholder="Select prime mover" required aria-required="true"
            aria-invalid={!!errors.prime_mover_no} onChange={(e) => setField('prime_mover_no', e.target.value)} />
          {err('prime_mover_no')}
        </label>
        <label className="cc-field"><span>Trailer / Equipment</span>
          <input className="cm-input" value={form.trailer_nos} placeholder="Asset numbers, comma separated" onChange={(e) => setField('trailer_nos', e.target.value)} />
          <small className="cm-hint">{parseTrailerList(form.trailer_nos).length} linked</small>
        </label>
        <label className="cc-field"><span>Combination type</span>
          <input className="cm-input" list="cm-type-options" value={form.combination_type} placeholder="e.g. Lowbed, Tipper, Tanker" onChange={(e) => setField('combination_type', e.target.value)} />
        </label>
        <label className="cc-field"><span>Axle Configuration</span>
          <input className="cm-input" list="cm-axle-options" value={form.axle_config} placeholder="e.g. 6x4 + 3A" aria-invalid={!!errors.axle_config} onChange={(e) => setField('axle_config', e.target.value)} />
          {err('axle_config')}
        </label>

        <fieldset className="cm-tyres">
          <legend>Tyre Configuration{tyreLabel ? `: ${tyreLabel}` : ''}</legend>
          <TyreConfigVisual axleConfig={form.axle_config} tyreConfig={{ steer: form.steer, drive: form.drive, trailer: form.trailer }} />
          <div className="cm-tyre-inputs">
            {[['steer', 'Steer'], ['drive', 'Drive'], ['trailer', 'Trailer']].map(([k, l]) => (
              <label key={k} className="cc-field"><span>{l} tyres</span>
                <input className="cm-input" inputMode="numeric" value={form[k]} onChange={(e) => setField(k, e.target.value)} aria-invalid={!!errors[k]} />
                {err(k)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="cm-two">
          <label className="cc-field"><span>Max Load (Ton)</span>
            <input className="cm-input" inputMode="decimal" value={form.max_load_tonnes} aria-invalid={!!errors.max_load_tonnes} onChange={(e) => setField('max_load_tonnes', e.target.value)} />
            {err('max_load_tonnes')}
          </label>
          <label className="cc-field"><span>Status</span>
            <select className="cc-select" value={form.status} onChange={(e) => setField('status', e.target.value)}>
              {MANAGER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </label>
        </div>
        <label className="cc-field"><span>Site</span>
          <input className="cm-input" list="cm-site-options" value={form.site} placeholder="Depot or yard" onChange={(e) => setField('site', e.target.value)} />
        </label>
        <label className="cc-field"><span>Notes</span>
          <textarea className="cm-input cm-notes" value={form.notes} placeholder="Enter notes" onChange={(e) => setField('notes', e.target.value)} />
        </label>

        {saveError && <p className="cm-save-err" role="alert">{saveError}</p>}
        <div className="cm-form-foot">
          <button type="button" className="cc-btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="submit" className="cc-btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Combination'}</button>
        </div>
      </form>
    </Card>
  )
}
