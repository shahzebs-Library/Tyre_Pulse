/**
 * Right rail "New tyre exchange" form. It records a tyre service event
 * (tyre_service_events): Replacement, Transfer (other) or Interchange
 * (rotation). The tyre register itself (tyre_records) is not rewritten here;
 * the page says so, so nobody expects the register to change on save.
 */
import { useMemo, useState } from 'react'
import { ScanLine, Save, X, ImageOff } from 'lucide-react'
import { Card, CardState } from '../commandCenter/kit'
import VehicleTyreDiagram from '../VehicleTyreDiagram'
import { legacyPositionCode } from '../../lib/tyrePositions'
import { buildExchangePayload, currentTyreAt } from '../../lib/tyreExchangeView'
import { toUserMessage } from '../../lib/safeError'

const TYPES = ['Replacement', 'Transfer', 'Interchange']
const CONDITIONS = ['', 'Worn out', 'Damaged', 'Puncture', 'Good', 'Other']
const EMPTY = {
  type: 'Replacement', asset: '', position: '', toAsset: '', toPosition: '',
  removedSerial: '', removedCondition: '', installedSerial: '', installedKind: 'New',
  installedCondition: '', technician: '', site: '', notes: '', date: '',
}

export default function NewExchangePanel({ assets, sites, records, technicians, country, onSave, recent }) {
  const [form, setForm] = useState(EMPTY)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState([])
  const [saved, setSaved] = useState('')
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors([]); setSaved('') }

  const asset = useMemo(() => assets.find((a) => a.asset === form.asset) || null, [assets, form.asset])
  const matches = useMemo(() => {
    const s = q.trim().toUpperCase()
    if (!s) return []
    return assets.filter((a) => a.asset.includes(s)).slice(0, 8)
  }, [assets, q])
  const onNow = useMemo(() => currentTyreAt(records, form.asset, form.position), [records, form.asset, form.position])

  function pickAsset(a) {
    setForm((f) => ({ ...f, asset: a.asset, position: '', site: f.site || a.site || '', removedSerial: '' }))
    setQ('')
    setErrors([]); setSaved('')
  }
  function pickPosition(id) {
    const code = legacyPositionCode(asset?.vehicleType, id)
    const cur = currentTyreAt(records, form.asset, code)
    setForm((f) => ({ ...f, position: code, removedSerial: f.removedSerial || cur?.serial || '' }))
    setErrors([]); setSaved('')
  }

  async function submit(e) {
    e.preventDefault()
    const res = buildExchangePayload(form, { country })
    if (!res.ok) { setErrors(res.errors); return }
    setBusy(true)
    try {
      await onSave(res.payload)
      setForm({ ...EMPTY, type: form.type })
      setSaved('Exchange recorded as a tyre service event.')
    } catch (err) {
      setErrors([toUserMessage(err, 'Could not save the exchange.')])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card title="New tyre exchange" sub="Recorded as a tyre service event. The tyre register updates from the next tyre upload.">
        <form className="tx-form" onSubmit={submit} noValidate>
          <div className="tx-seg" role="group" aria-label="Exchange type">
            {TYPES.map((t) => (
              <button key={t} type="button" aria-pressed={form.type === t} onClick={() => set('type', t)}>{t}</button>
            ))}
          </div>

          <label>Vehicle / asset <em>*</em>
            {form.asset
              ? <span className="tx-picked"><b>{form.asset}</b><small>{asset?.vehicleType || 'Type not recorded'}{asset?.site ? `, ${asset.site}` : ''}</small>
                  <button type="button" className="cc-icon-btn" aria-label="Change vehicle" onClick={() => set('asset', '')}><X size={13} /></button></span>
              : <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search asset code" aria-label="Search asset code" />}
          </label>
          {!form.asset && matches.length > 0 && (
            <ul className="tx-matches">
              {matches.map((a) => (
                <li key={a.asset}><button type="button" onClick={() => pickAsset(a)}><b>{a.asset}</b><small>{a.vehicleType || 'Type not recorded'}</small></button></li>
              ))}
            </ul>
          )}

          <div>
            <span className="tx-label">Position <em>*</em></span>
            {form.asset
              ? (
                <div className="tx-diagram">
                  <VehicleTyreDiagram vehicleType={asset?.vehicleType} onPositionClick={({ position }) => pickPosition(position)} width={200} />
                  <p className="tx-note">{form.position ? `Selected ${form.position}${onNow ? `, tyre on it now ${onNow.serial || 'N/A'}` : ''}.` : 'Tap a wheel to choose the position.'}</p>
                </div>
              )
              : <p className="tx-note">Choose a vehicle first.</p>}
          </div>

          {form.type === 'Transfer' && (
            <div className="tx-row2">
              <label>To vehicle <em>*</em>
                <select value={form.toAsset} onChange={(e) => set('toAsset', e.target.value)}>
                  <option value="">Select</option>
                  {assets.filter((a) => a.asset !== form.asset).map((a) => <option key={a.asset} value={a.asset}>{a.asset}</option>)}
                </select>
              </label>
              <label>To position<input value={form.toPosition} onChange={(e) => set('toPosition', e.target.value)} placeholder="e.g. LHF1" /></label>
            </div>
          )}
          {form.type === 'Interchange' && (
            <label>Move to position <em>*</em><input value={form.toPosition} onChange={(e) => set('toPosition', e.target.value)} placeholder="e.g. RHF1" /></label>
          )}

          <div className="tx-row2">
            <label>Removed tyre serial
              <span className="tx-inline"><input value={form.removedSerial} onChange={(e) => set('removedSerial', e.target.value)} placeholder="Scan or type" /><ScanLine size={15} aria-hidden="true" /></span>
            </label>
            <label>Condition
              <select value={form.removedCondition} onChange={(e) => set('removedCondition', e.target.value)}>{CONDITIONS.map((c) => <option key={c} value={c}>{c || 'Select'}</option>)}</select>
            </label>
          </div>
          <div className="tx-row2">
            <label>Installed tyre serial{form.type === 'Replacement' && <em> *</em>}
              <span className="tx-inline"><input value={form.installedSerial} onChange={(e) => set('installedSerial', e.target.value)} placeholder="Scan or type" /><ScanLine size={15} aria-hidden="true" /></span>
            </label>
            <label>Installed as
              <select value={form.installedKind} onChange={(e) => set('installedKind', e.target.value)}>
                <option value="New">New</option><option value="Retreaded">Retreaded</option><option value="Used">Used</option>
              </select>
            </label>
          </div>
          <label>Installed tyre condition
            <select value={form.installedCondition} onChange={(e) => set('installedCondition', e.target.value)}>{CONDITIONS.map((c) => <option key={c} value={c}>{c || 'Select'}</option>)}</select>
          </label>

          <div className="tx-row2">
            <label>Technician
              <input list="tx-techs" value={form.technician} onChange={(e) => set('technician', e.target.value)} placeholder="Name" />
              <datalist id="tx-techs">{technicians.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
            <label>Site
              <select value={form.site} onChange={(e) => set('site', e.target.value)}>
                <option value="">Select</option>
                {sites.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <label>Date<input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></label>
          <label>Notes<textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Reason or remarks" /></label>
          <div className="tx-upload" aria-disabled="true"><ImageOff size={15} aria-hidden="true" /> Photo upload is not available for exchange records yet. Add photos on the tyre inspection instead.</div>

          {errors.length > 0 && <ul className="tx-err" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {saved && <p className="tx-ok" role="status">{saved}</p>}
          <div className="tx-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => { setForm(EMPTY); setQ(''); setErrors([]); setSaved('') }}>Cancel</button>
            <button type="submit" className="cc-btn-primary" disabled={busy}><Save size={14} aria-hidden="true" /> {busy ? 'Saving' : 'Save exchange'}</button>
          </div>
        </form>
      </Card>

      <Card title="Recently recorded" sub="Exchange events saved from this page.">
        <CardState state={recent} empty={recent.data && recent.data.length === 0 ? 'No exchange events recorded yet.' : null} lines={3}>
          <ul className="tx-recent">
            {(recent.data || []).slice(0, 6).map((ev) => (
              <li key={ev.id}>
                <b>{ev.asset_no || 'N/A'} {ev.position || ''}</b>
                <small>{ev.event_date || 'Date not recorded'}{ev.technician ? `, ${ev.technician}` : ''}</small>
                <span>{ev.notes || ev.tyre_serial || 'N/A'}</span>
              </li>
            ))}
          </ul>
        </CardState>
      </Card>
    </>
  )
}
