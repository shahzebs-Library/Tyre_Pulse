/**
 * Tool custody and calibration actions: issue a tool to a person, record its
 * return, and record a calibration. Each write is one server RPC that re-checks
 * the company, the site scope and the stock permission (migration
 * 20261124133000). The form mints one request key when it opens and reuses it
 * on a retry, so a double tap cannot issue twice.
 */
import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import { Field } from '../inventory/InvUi'
import { newIdempotencyKey, listAssignablePeople } from '../../lib/api/inventory'
import { issueTool, returnTool, recordCalibration } from '../../lib/api/warehouseAssets'
import { validateToolIssue, validateCalibration } from '../../lib/warehouseClasses/specialClasses'
import { toUserMessage } from '../../lib/inventory/errorText'

const today = () => new Date().toISOString().slice(0, 10)

function Footer({ busy, onClose, onSubmit, label }) {
  return (
    <div className="inv-actions">
      <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="cc-btn" onClick={onSubmit} disabled={busy}>{busy ? 'Saving...' : label}</button>
    </div>
  )
}

export function IssueToolModal({ tool, onClose, onDone }) {
  const [form, setForm] = useState({ holder_user_id: '', holder_name: '', due_back_at: '', condition_out: '', notes: '' })
  const [people, setPeople] = useState([])
  const [key] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    let live = true
    listAssignablePeople().then((r) => { if (live) setPeople(r) }).catch(() => { if (live) setPeople([]) })
    return () => { live = false }
  }, [])

  async function submit() {
    const v = validateToolIssue(form)
    if (v.error) { setError(v.error); return }
    setBusy(true); setError(null)
    try {
      await issueTool({
        equipment_id: tool.id, holder_user_id: form.holder_user_id || null, holder_name: form.holder_name.trim() || null,
        due_back_at: form.due_back_at ? new Date(`${form.due_back_at}T17:00:00`).toISOString() : null,
        condition_out: form.condition_out.trim() || null, notes: form.notes.trim() || null,
      }, key)
      onDone()
    } catch (err) {
      setError(toUserMessage(err, 'The tool could not be issued.'))
    } finally { setBusy(false) }
  }

  return (
    <Modal className="cc inv-panel" open={!!tool} onClose={() => !busy && onClose()} size="md" title="Issue a tool"
      subtitle={tool ? `${tool.name}${tool.serial_no ? ` (${tool.serial_no})` : ''}` : null}
      footer={<Footer busy={busy} onClose={onClose} onSubmit={submit} label="Issue tool" />}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        <Field label="Person taking it" id="ti-person" full>
          <select id="ti-person" className="cc-select" value={form.holder_user_id} onChange={set('holder_user_id')}>
            <option value="">Someone without an account (type the name below)</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username}{p.role ? ` (${p.role})` : ''}</option>)}
          </select>
        </Field>
        {!form.holder_user_id && (
          <Field label="Name" id="ti-name" full>
            <input id="ti-name" className="cc-input" value={form.holder_name} onChange={set('holder_name')} maxLength={200} />
          </Field>
        )}
        <Field label="Due back" id="ti-due">
          <input id="ti-due" className="cc-input" type="date" min={today()} value={form.due_back_at} onChange={set('due_back_at')} />
        </Field>
        <Field label="Condition when issued" id="ti-cond">
          <input id="ti-cond" className="cc-input" value={form.condition_out} onChange={set('condition_out')} maxLength={200} />
        </Field>
        <Field label="Notes" id="ti-notes" full>
          <textarea id="ti-notes" className="cc-input" rows={2} value={form.notes} onChange={set('notes')} maxLength={2000} />
        </Field>
        <p className="cc-card-sub">Without a due-back date the tool is never called overdue. A tool whose calibration is overdue cannot be issued.</p>
      </div>
    </Modal>
  )
}

export function ReturnToolModal({ custody, toolName, onClose, onDone }) {
  const [condition, setCondition] = useState('good')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    setBusy(true); setError(null)
    try {
      await returnTool({ custody_id: custody.id, condition_in: condition })
      onDone()
    } catch (err) {
      setError(toUserMessage(err, 'The return could not be recorded.'))
    } finally { setBusy(false) }
  }

  return (
    <Modal className="cc inv-panel" open={!!custody} onClose={() => !busy && onClose()} size="sm" title="Record a return"
      subtitle={custody ? `${toolName || 'Tool'} from ${custody.holder_name}` : null}
      footer={<Footer busy={busy} onClose={onClose} onSubmit={submit} label="Record return" />}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        <Field label="Condition on return" id="tr-cond" full>
          <select id="tr-cond" className="cc-select" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="good">Good</option>
            <option value="needs repair">Needs repair (tool goes to maintenance)</option>
            <option value="damaged">Damaged (tool goes to maintenance)</option>
          </select>
        </Field>
      </div>
    </Modal>
  )
}

export function CalibrationModal({ tool, onClose, onDone }) {
  const [form, setForm] = useState({ calibrated_on: today(), next_due: '', result: 'pass', certificate_ref: '', provider: '', notes: '' })
  const [key] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit() {
    const v = validateCalibration(form)
    if (v.error) { setError(v.error); return }
    setBusy(true); setError(null)
    try {
      await recordCalibration({
        equipment_id: tool.id, calibrated_on: form.calibrated_on, next_due: form.result === 'fail' ? null : form.next_due,
        result: form.result, certificate_ref: form.certificate_ref.trim() || null, provider: form.provider.trim() || null,
        notes: form.notes.trim() || null,
      }, key)
      onDone()
    } catch (err) {
      setError(toUserMessage(err, 'The calibration could not be saved.'))
    } finally { setBusy(false) }
  }

  return (
    <Modal className="cc inv-panel" open={!!tool} onClose={() => !busy && onClose()} size="md" title="Record a calibration"
      subtitle={tool ? `${tool.name}${tool.serial_no ? ` (${tool.serial_no})` : ''}` : null}
      footer={<Footer busy={busy} onClose={onClose} onSubmit={submit} label="Save calibration" />}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        <Field label="Calibrated on" id="tc-on">
          <input id="tc-on" className="cc-input" type="date" max={today()} value={form.calibrated_on} onChange={set('calibrated_on')} />
        </Field>
        <Field label="Result" id="tc-res">
          <select id="tc-res" className="cc-select" value={form.result} onChange={set('result')}>
            <option value="pass">Pass</option>
            <option value="adjusted">Adjusted, now within limits</option>
            <option value="fail">Fail (tool goes to maintenance)</option>
          </select>
        </Field>
        {form.result !== 'fail' && (
          <Field label="Next due" id="tc-due">
            <input id="tc-due" className="cc-input" type="date" min={form.calibrated_on || today()} value={form.next_due} onChange={set('next_due')} />
          </Field>
        )}
        <Field label="Certificate number" id="tc-cert">
          <input id="tc-cert" className="cc-input" value={form.certificate_ref} onChange={set('certificate_ref')} maxLength={120} />
        </Field>
        <Field label="Calibrated by (provider)" id="tc-prov" full>
          <input id="tc-prov" className="cc-input" value={form.provider} onChange={set('provider')} maxLength={200} />
        </Field>
        <Field label="Notes" id="tc-notes" full>
          <textarea id="tc-notes" className="cc-input" rows={2} value={form.notes} onChange={set('notes')} maxLength={2000} />
        </Field>
      </div>
    </Modal>
  )
}
