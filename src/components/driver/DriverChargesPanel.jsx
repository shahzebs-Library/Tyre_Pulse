import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../ui/Modal'
import SignaturePad from '../SignaturePad'
import { listDriverCharges, getDriverCharge, driverChargeSources, driverChargeCommand } from '../../lib/api/driverCharges'
import { driverWorkspaceOptions } from '../../lib/api/driverWorkspace'
import {
  ACTION_LABELS, CATEGORIES, SOURCE_TYPES, STATUSES, REVERSAL_CODES, EVIDENCE_KINDS,
  enumLabel, money, capAmountFor, monthStart, buildInstalmentPlan, validateIssue, validateResponse, outstandingByCurrency,
} from '../../lib/driverCharges'
import { signatureImage } from '../../lib/driverWorkspace'
import { toUserMessage } from '../../lib/safeError'

const when = v => (v ? new Date(v).toLocaleString() : 'Not recorded')

function Picker({ label, load, value, onChange }) {
  const [search, setSearch] = useState(''); const [rows, setRows] = useState([]); const [error, setError] = useState('')
  useEffect(() => {
    let live = true; setError('')
    const timer = setTimeout(() => load(search).then(r => { if (live) setRows(Array.isArray(r) ? r : []) }).catch(e => { if (live) setError(toUserMessage(e, 'Could not load options')) }), 200)
    return () => { live = false; clearTimeout(timer) }
  }, [search, load])
  return <div className="space-y-1">
    <input className="input w-full" aria-label={`Search ${label}`} placeholder={`Search ${label}`} value={search} onChange={e => setSearch(e.target.value)} />
    <select className="input w-full" aria-label={label} value={value || ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">Select</option>
      {value && !rows.some(r => r.id === value) && <option value={value}>Selected record</option>}
      {rows.slice(0, 100).map(r => <option key={r.id} value={r.id}>{r.label || r.summary?.label || r.id}</option>)}
    </select>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
  </div>
}

function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}

function initialFor(action, detail) {
  const c = detail?.charge
  switch (action) {
    case 'charge_issue': return { category: 'missing_item', source_type: 'none', currency: 'SAR', evidence: [{ kind: 'document', ref: '', label: '' }] }
    case 'charge_correct': return { amount: c?.amount ?? '', basis: c?.basis || '', reason: '' }
    case 'charge_attach_evidence': return { kind: 'document', ref: '', label: '' }
    case 'charge_respond': return { response: 'accept', explanation: '' }
    case 'charge_supervisor_review':
    case 'charge_finance_review': return { decision: 'approve', reason: '' }
    case 'charge_schedule': return { monthly_wage: '', first_month: monthStart(new Date()), reason: '' }
    case 'charge_record_deduction': return { instalment_id: (detail?.instalments || []).find(i => i.status === 'scheduled')?.id || '', payroll_reference: '' }
    case 'charge_reverse': return { reversal_code: 'wrong_amount', reason: '', reissue: false }
    case 'charge_decide_appeal': return { outcome: 'upheld', reason: '' }
    default: return { reason: '' }
  }
}

function ChargeActionForm({ action, driverId, detail, onClose, onSaved }) {
  const [v, setV] = useState(() => initialFor(action, detail))
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [pad, setPad] = useState(null)
  const requestId = useRef(crypto.randomUUID())
  const set = (key, value) => { requestId.current = crypto.randomUUID(); setV(prev => ({ ...prev, [key]: value })) }
  const charge = detail?.charge
  const outstanding = charge ? Number(charge.amount) - Number(charge.deducted_amount || 0) : 0
  const cap = capAmountFor(v.monthly_wage, detail?.settings?.cap_pct)
  const plan = useMemo(() => (action === 'charge_schedule' && cap ? buildInstalmentPlan(outstanding, cap, v.first_month) : []), [action, cap, outstanding, v.first_month])
  const loadVehicles = useCallback(s => driverWorkspaceOptions('vehicles', s, 0), [])
  const loadDrivers = useCallback(s => driverWorkspaceOptions('drivers', s, 0), [])
  const loadSources = useCallback(s => driverChargeSources(v.source_type, driverId, s, 0).then(rows => rows.map(r => ({ id: r.id, label: r.summary?.label || r.id }))), [v.source_type, driverId])
  const statementVersion = v.response === 'dispute' ? 'receipt-dispute-v1' : 'deduction-consent-v1'

  async function submit(e) {
    e.preventDefault(); if (saving) return
    let payload = { driver_id: driverId, ...(charge ? { charge_id: charge.id, version: charge.version } : {}) }
    let message = null
    if (action === 'charge_issue') {
      message = validateIssue(v)
      const evidence = (v.evidence || []).filter(x => x.ref || x.label)
      payload = { ...payload, category: v.category, source_type: v.source_type, source_id: v.source_type === 'none' ? null : v.source_id, vehicle_id: v.vehicle_id || null,
        incident_at: v.incident_at ? new Date(v.incident_at).toISOString() : null, basis: v.basis, amount: Number(v.amount), currency: String(v.currency || '').toUpperCase(), evidence }
    } else if (action === 'charge_respond') {
      message = validateResponse(v)
      payload = { ...payload, response: v.response, explanation: v.explanation, statement_version: statementVersion, statement_language: 'en', acknowledged: !!v.acknowledged, signature: v.signature }
    } else if (action === 'charge_record_refusal') {
      if ((v.witness_name || '').trim().length < 2 || !v.witness_signature) message = 'A refusal needs the witness name and the witness signature.'
      payload = { ...payload, witness_name: v.witness_name, witness_signature: v.witness_signature, reason: v.reason }
    } else if (action === 'charge_schedule') {
      if (!plan.length) message = 'Enter the monthly wage and first month to build the schedule.'
      payload = { ...payload, monthly_wage: Number(v.monthly_wage), instalments: plan, reason: v.reason }
    } else if (action === 'charge_reverse') {
      payload = { ...payload, reversal_code: v.reversal_code, reason: v.reason, ...(v.reissue ? { reissue: { driver_id: v.reissue_driver_id || null, ...(v.reissue_amount ? { amount: Number(v.reissue_amount) } : {}), ...(v.reissue_basis ? { basis: v.reissue_basis } : {}) } } : {}) }
    } else if (action === 'charge_correct') {
      payload = { ...payload, amount: Number(v.amount), basis: v.basis, reason: v.reason }
    } else {
      const { evidence: _e, ...rest } = v
      payload = { ...payload, ...rest }
    }
    if (message) { setError(message); return }
    setSaving(true); setError('')
    try { await driverChargeCommand(action, payload, requestId.current); onSaved() } catch (err) { setError(toUserMessage(err, 'Could not save. Refresh if the charge changed.')) } finally { setSaving(false) }
  }

  const formId = `driver-charge-${action}-form`
  const footer = <><button form={formId} type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Submit'}</button><button type="button" disabled={saving} className="btn-secondary" onClick={onClose}>Cancel</button></>
  const reasonField = label => <Field label={label}><textarea className="input w-full" rows={3} maxLength={2000} aria-label={label} value={v.reason || ''} onChange={e => set('reason', e.target.value)} /></Field>
  return <Modal open onClose={saving ? undefined : onClose} title={ACTION_LABELS[action]} size="md" footer={footer}><form id={formId} onSubmit={submit} className="space-y-4">
    {action === 'charge_issue' && <>
      <Field label="Category"><select aria-label="Category" className="input w-full" value={v.category} onChange={e => { set('category', e.target.value); if (e.target.value === 'traffic_fine') set('source_type', 'driver_fine') }}>{CATEGORIES.map(k => <option key={k} value={k}>{enumLabel('category', k)}</option>)}</select></Field>
      <Field label="Linked record type"><select aria-label="Linked record type" className="input w-full" value={v.source_type} onChange={e => { set('source_type', e.target.value); set('source_id', null) }}>{SOURCE_TYPES.map(k => <option key={k} value={k}>{enumLabel('source_type', k)}</option>)}</select></Field>
      {v.source_type !== 'none' && <Field label="Linked record"><Picker key={v.source_type} label="linked record" load={loadSources} value={v.source_id} onChange={id => set('source_id', id)} /></Field>}
      <Field label="Vehicle (optional)"><Picker label="vehicle" load={loadVehicles} value={v.vehicle_id} onChange={id => set('vehicle_id', id)} /></Field>
      <Field label="Incident date and time"><input aria-label="Incident date and time" type="datetime-local" className="input w-full" value={v.incident_at || ''} onChange={e => set('incident_at', e.target.value)} /></Field>
      <Field label="Written basis for the charge"><textarea aria-label="Written basis for the charge" className="input w-full" rows={4} maxLength={4000} value={v.basis || ''} onChange={e => set('basis', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Amount"><input aria-label="Amount" type="number" step="0.01" min="0" className="input w-full" value={v.amount || ''} onChange={e => set('amount', e.target.value)} /></Field>
        <Field label="Currency"><input aria-label="Currency" className="input w-full" maxLength={3} value={v.currency || ''} onChange={e => set('currency', e.target.value.toUpperCase())} /></Field></div>
      <div className="space-y-2"><p className="label">Evidence</p>{(v.evidence || []).map((row, i) => <div key={i} className="grid grid-cols-3 gap-2">
        <select aria-label={`Evidence type ${i + 1}`} className="input" value={row.kind} onChange={e => set('evidence', v.evidence.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}>{EVIDENCE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select>
        <input aria-label={`Evidence reference ${i + 1}`} className="input" placeholder="Reference or file path" value={row.ref} onChange={e => set('evidence', v.evidence.map((x, j) => (j === i ? { ...x, ref: e.target.value } : x)))} />
        <input aria-label={`Evidence description ${i + 1}`} className="input" placeholder="Description" value={row.label} onChange={e => set('evidence', v.evidence.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></div>)}
        <button type="button" className="btn-secondary" onClick={() => set('evidence', [...(v.evidence || []), { kind: 'document', ref: '', label: '' }])}>Add evidence row</button></div>
      <p className="text-xs text-[var(--text-muted)]">The charge stays editable until you notify the driver. After that it can only be reversed with a reason.</p>
    </>}
    {action === 'charge_correct' && <>
      <Field label="Amount"><input aria-label="Amount" type="number" step="0.01" className="input w-full" value={v.amount} onChange={e => set('amount', e.target.value)} /></Field>
      <Field label="Written basis"><textarea aria-label="Written basis" className="input w-full" rows={4} value={v.basis} onChange={e => set('basis', e.target.value)} /></Field>
      {reasonField('Correction reason')}
    </>}
    {action === 'charge_attach_evidence' && <>
      <Field label="Type"><select aria-label="Type" className="input w-full" value={v.kind} onChange={e => set('kind', e.target.value)}>{EVIDENCE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select></Field>
      <Field label="Reference"><input aria-label="Reference" className="input w-full" value={v.ref} onChange={e => set('ref', e.target.value)} /></Field>
      <Field label="Description"><input aria-label="Description" className="input w-full" value={v.label} onChange={e => set('label', e.target.value)} /></Field>
    </>}
    {action === 'charge_notify' && <p>The driver will be asked to accept or dispute this charge. After notification the amount, basis and evidence are frozen.</p>}
    {action === 'charge_respond' && <>
      <Field label="Your response"><select aria-label="Your response" className="input w-full" value={v.response} onChange={e => { set('response', e.target.value); set('acknowledged', false) }}><option value="accept">I accept and consent to the deduction</option><option value="dispute">I dispute this charge</option></select></Field>
      {v.response === 'dispute' && <Field label="Why you dispute it"><textarea aria-label="Why you dispute it" className="input w-full" rows={4} value={v.explanation} onChange={e => set('explanation', e.target.value)} /></Field>}
      <div className="rounded border border-[var(--input-border)] p-3 text-sm">{detail?.statements?.[statementVersion] || 'Statement unavailable. Refresh before signing.'}</div>
      <label className="flex gap-3"><input type="checkbox" checked={!!v.acknowledged} disabled={!detail?.statements?.[statementVersion]} onChange={e => set('acknowledged', e.target.checked)} /><span>I have read this statement.</span></label>
      <button type="button" className="btn-secondary" onClick={() => setPad('signature')}>Draw signature</button>{v.signature && <img className="max-h-32 bg-white" src={signatureImage(v.signature)} alt="Your signature" />}
    </>}
    {action === 'charge_record_refusal' && <>
      <div className="rounded border border-[var(--input-border)] p-3 text-sm">{detail?.statements?.['refusal-witness-v1']}</div>
      <Field label="Witness full name"><input aria-label="Witness full name" className="input w-full" value={v.witness_name || ''} onChange={e => set('witness_name', e.target.value)} /></Field>
      <button type="button" className="btn-secondary" onClick={() => setPad('witness_signature')}>Witness signs</button>{v.witness_signature && <img className="max-h-32 bg-white" src={signatureImage(v.witness_signature)} alt="Witness signature" />}
      {reasonField('Where and how the notice was presented')}
    </>}
    {['charge_supervisor_review', 'charge_finance_review'].includes(action) && <>
      <Field label="Decision"><select aria-label="Decision" className="input w-full" value={v.decision} onChange={e => set('decision', e.target.value)}><option value="approve">Approve</option><option value="return">Return</option></select></Field>
      {reasonField('Review reason')}
      <p className="text-xs text-[var(--text-muted)]">Supervisor and finance approvals must be made by two different people. The person who issued the charge cannot approve it.</p>
    </>}
    {action === 'charge_schedule' && <>
      <p className="text-sm">Outstanding: {money(outstanding, charge?.currency)}. Limit per month: {detail?.settings?.cap_pct}% of the monthly wage.</p>
      <Field label="Driver monthly wage"><input aria-label="Driver monthly wage" type="number" step="0.01" className="input w-full" value={v.monthly_wage} onChange={e => set('monthly_wage', e.target.value)} /></Field>
      <Field label="First deduction month"><input aria-label="First deduction month" type="month" className="input w-full" value={(v.first_month || '').slice(0, 7)} onChange={e => set('first_month', e.target.value ? `${e.target.value}-01` : '')} /></Field>
      {cap && <p className="text-sm">Highest instalment: {money(cap, charge?.currency)}</p>}
      {plan.length > 0 && <table className="w-full text-sm"><thead><tr><th className="text-start">Month</th><th className="text-end">Amount</th></tr></thead><tbody>{plan.map(p => <tr key={p.due_month}><td>{p.due_month.slice(0, 7)}</td><td className="text-end">{money(p.amount, charge?.currency)}</td></tr>)}</tbody></table>}
      {reasonField('Note (optional)')}
    </>}
    {action === 'charge_record_deduction' && <>
      <Field label="Instalment"><select aria-label="Instalment" className="input w-full" value={v.instalment_id} onChange={e => set('instalment_id', e.target.value)}>{(detail?.instalments || []).filter(i => i.status === 'scheduled').map(i => <option key={i.id} value={i.id}>{i.seq}. {i.due_month.slice(0, 7)} {money(i.amount, i.currency)}</option>)}</select></Field>
      <Field label="Payroll reference"><input aria-label="Payroll reference" className="input w-full" value={v.payroll_reference} onChange={e => set('payroll_reference', e.target.value)} /></Field>
    </>}
    {action === 'charge_waive' && reasonField('Waiver reason')}
    {action === 'charge_reverse' && <>
      <Field label="Why the charge was wrong"><select aria-label="Why the charge was wrong" className="input w-full" value={v.reversal_code} onChange={e => set('reversal_code', e.target.value)}>{REVERSAL_CODES.map(k => <option key={k} value={k}>{enumLabel('reversal_code', k)}</option>)}</select></Field>
      {reasonField('Reversal explanation')}
      {!['duplicate', 'misused'].includes(v.reversal_code) && <label className="flex gap-3"><input type="checkbox" checked={!!v.reissue} onChange={e => set('reissue', e.target.checked)} /><span>Reissue a corrected charge</span></label>}
      {v.reissue && <>
        <Field label="Driver for the new charge (blank keeps this driver)"><Picker label="driver" load={loadDrivers} value={v.reissue_driver_id} onChange={id => set('reissue_driver_id', id)} /></Field>
        <Field label="Corrected amount (blank keeps it)"><input aria-label="Corrected amount" type="number" step="0.01" className="input w-full" value={v.reissue_amount || ''} onChange={e => set('reissue_amount', e.target.value)} /></Field>
        <Field label="Corrected basis (blank keeps it)"><textarea aria-label="Corrected basis" className="input w-full" rows={3} value={v.reissue_basis || ''} onChange={e => set('reissue_basis', e.target.value)} /></Field>
      </>}
    </>}
    {action === 'charge_appeal' && reasonField('Grounds for your appeal')}
    {action === 'charge_decide_appeal' && <>
      <Field label="Outcome"><select aria-label="Outcome" className="input w-full" value={v.outcome} onChange={e => set('outcome', e.target.value)}><option value="upheld">Uphold the charge</option><option value="allowed">Allow the appeal and waive the charge</option></select></Field>
      {reasonField('Decision reason')}
      <p className="text-xs text-[var(--text-muted)]">Only a person who did not issue or approve this charge may decide the appeal.</p>
    </>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {pad && <SignaturePad label={pad === 'signature' ? 'Driver signature' : 'Witness signature'} onSave={sig => { set(pad, sig); setPad(null) }} onClose={() => setPad(null)} />}
  </form></Modal>
}

function ChargeDetail({ chargeId, driverId, onClose, onChanged }) {
  const [detail, setDetail] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const [action, setAction] = useState(null); const [exporting, setExporting] = useState(false)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setDetail(await getDriverCharge(chargeId)) } catch (e) { setError(toUserMessage(e, 'Charge details are unavailable.')) } finally { setLoading(false) }
  }, [chargeId])
  useEffect(() => { load() }, [load])
  async function exportPdf() {
    setExporting(true); setError('')
    try {
      const [{ renderDriverChargePdf }, { signaturePng }] = await Promise.all([import('../../lib/driverChargePdf'), import('../../lib/driverFineReports')])
      await renderDriverChargePdf(detail, { signatureToPng: signaturePng })
    } catch (e) { setError(toUserMessage(e, 'The charge notice PDF could not be generated.')) } finally { setExporting(false) }
  }
  const c = detail?.charge
  return <Modal open onClose={onClose} title={c ? `${c.charge_no} | ${enumLabel('category', c.category)}` : 'Charge'} size="lg"
    footer={<><button type="button" className="btn-secondary" disabled={!detail || exporting} onClick={exportPdf}>{exporting ? 'Generating PDF...' : 'Download notice PDF'}</button><button type="button" className="btn-secondary" onClick={onClose}>Close</button></>}>
    {loading && <p role="status">Loading charge...</p>}
    {error && <p role="alert" className="text-red-500">{error} <button type="button" className="btn-secondary ms-2" onClick={load}>Retry</button></p>}
    {c && <div className="space-y-4 text-sm">
      <div className="grid sm:grid-cols-2 gap-2">
        <p><strong>Status:</strong> {enumLabel('status', c.status)}</p><p><strong>Amount:</strong> {money(c.amount, c.currency)} (deducted {money(c.deducted_amount, c.currency)})</p>
        <p><strong>Linked record:</strong> {enumLabel('source_type', c.source_type)} {c.source_summary?.label || ''}</p><p><strong>Vehicle:</strong> {c.asset_no || 'Not recorded'}</p>
        <p><strong>Issued:</strong> {when(c.created_at)} by {c.issued_by_name || 'Recorded user'}</p><p><strong>Notified:</strong> {when(c.notified_at)}</p>
        {c.supersedes_charge_id && <p>Replaces an earlier charge that was reversed.</p>}{c.superseded_by_charge_id && <p>Reversed and replaced by a new charge.</p>}
      </div>
      <div><h4 className="font-semibold">Written basis</h4><p className="whitespace-pre-wrap">{c.basis}</p></div>
      <div className="flex flex-wrap gap-2">{(detail.actions || []).map(a => <button key={a} type="button" className={a === 'charge_respond' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAction(a)}>{ACTION_LABELS[a] || a}</button>)}</div>
      <div><h4 className="font-semibold">Evidence</h4>{detail.evidence.length === 0 ? <p>No evidence listed.</p> : detail.evidence.map(e => <p key={e.id}>{e.kind}: {e.label} ({e.ref})</p>)}</div>
      <div><h4 className="font-semibold">Signatures</h4>{detail.signatures.length === 0 && <p>No signature recorded.</p>}{detail.signatures.map(s => <div key={s.id} className="rounded border border-[var(--input-border)] p-2 mb-2"><p><strong>{enumLabel('signature_kind', s.kind)}</strong> | {s.signer_name} | {when(s.signed_at)}</p><p className="text-xs">{s.statement_text}</p>{s.signature && <img className="max-h-24 bg-white" src={signatureImage(s.signature)} alt={`${s.signer_name} signature`} />}</div>)}</div>
      <div><h4 className="font-semibold">Decisions</h4>{detail.decisions.length === 0 ? <p>No review recorded yet.</p> : detail.decisions.map(d => <p key={d.id}>{when(d.created_at)} | {enumLabel('decision_stage', d.stage)} | {enumLabel('decision', d.decision)} | {d.decided_by_name || 'Recorded user'} | {d.reason}</p>)}</div>
      {detail.appeal && <div><h4 className="font-semibold">Appeal</h4><p>{when(detail.appeal.filed_at)}: {detail.appeal.reason}</p><p>Outcome: {enumLabel('appeal_outcome', detail.appeal.outcome)} {detail.appeal.decided_by_name ? `by ${detail.appeal.decided_by_name}` : ''}</p></div>}
      {detail.instalments.length > 0 && <div><h4 className="font-semibold">Deduction schedule</h4><p>Limit per month: {money(c.schedule_cap_amount, c.currency)} ({c.schedule_cap_pct}% of {money(c.schedule_monthly_wage, c.currency)})</p>{detail.instalments.map(i => <p key={i.id}>{i.seq}. {i.due_month.slice(0, 7)} | {money(i.amount, i.currency)} | {enumLabel('instalment_status', i.status)}{i.payroll_reference ? ` | ${i.payroll_reference}` : ''}</p>)}</div>}
      <details><summary>Full timeline ({detail.events.length})</summary>{detail.events.map(e => <p key={e.id}>{when(e.created_at)} | {e.actor_name || 'System'} | {enumLabel('action', e.action)} {e.details?.reason ? `| ${e.details.reason}` : ''}</p>)}</details>
    </div>}
    {action && <ChargeActionForm action={action} driverId={driverId} detail={detail} onClose={() => setAction(null)} onSaved={() => { setAction(null); load(); onChanged() }} />}
  </Modal>
}

export default function DriverChargesPanel({ driverId, canIssue }) {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(''); const [category, setCategory] = useState(''); const [search, setSearch] = useState(''); const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null); const [issuing, setIssuing] = useState(false); const [offset, setOffset] = useState(0)
  useEffect(() => { const t = setTimeout(() => { setQuery(search); setOffset(0) }, 250); return () => clearTimeout(t) }, [search])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await listDriverCharges({ driver_id: driverId, status, category, search: query }, offset)) } catch (e) { setError(toUserMessage(e, 'Driver charges are unavailable.')) } finally { setLoading(false) }
  }, [driverId, status, category, query, offset])
  useEffect(() => { load() }, [load])
  const rows = (data?.rows || []).slice(0, 100)
  const balances = outstandingByCurrency(rows)
  const filtered = status || category || query
  return <section className="space-y-3" aria-label="Driver charges">
    <div className="flex flex-wrap gap-2 items-end">
      <input className="input flex-1 min-w-[200px]" aria-label="Search charges" placeholder="Search charge number, basis, vehicle" value={search} onChange={e => setSearch(e.target.value)} />
      <select className="input" aria-label="Charge status" value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}><option value="">All statuses</option>{STATUSES.map(s => <option key={s} value={s}>{enumLabel('status', s)}</option>)}</select>
      <select className="input" aria-label="Charge category" value={category} onChange={e => { setCategory(e.target.value); setOffset(0) }}><option value="">All categories</option>{CATEGORIES.map(s => <option key={s} value={s}>{enumLabel('category', s)}</option>)}</select>
      <button type="button" className="btn-secondary" onClick={load}>Refresh</button>
      {canIssue && <button type="button" className="btn-primary" onClick={() => setIssuing(true)}>Issue charge</button>}
    </div>
    {balances.length > 0 && <div className="flex flex-wrap gap-2 text-sm">{balances.map(b => <p key={b.currency} className="rounded border border-[var(--input-border)] px-3 py-2">Outstanding {money(b.outstanding, b.currency)}</p>)}</div>}
    {loading && <p role="status">Loading charges...</p>}
    {error && <p role="alert" className="text-red-500">{error} <button type="button" className="btn-secondary ms-2" onClick={load}>Retry</button></p>}
    {!loading && !error && rows.length === 0 && <p>{filtered ? 'No charges match these filters.' : 'No charges recorded for this driver.'}</p>}
    <div className="grid gap-2">{rows.map(r => <button key={r.id} type="button" className="text-start rounded-xl border border-[var(--input-border)] p-3" onClick={() => setOpen(r.id)}>
      <strong>{r.charge_no} | {enumLabel('category', r.category)} | {money(r.amount, r.currency)}</strong>
      <p>{enumLabel('status', r.status)}{r.source_label ? ` | ${r.source_label}` : ''}{r.asset_no ? ` | ${r.asset_no}` : ''}</p>
    </button>)}</div>
    <div className="flex gap-2">{offset > 0 && <button type="button" className="btn-secondary" onClick={() => setOffset(offset - 100)}>Previous</button>}{(data?.rows || []).length > 100 && <button type="button" className="btn-secondary" onClick={() => setOffset(offset + 100)}>Next</button>}</div>
    {open && <ChargeDetail chargeId={open} driverId={driverId} onClose={() => setOpen(null)} onChanged={load} />}
    {issuing && <ChargeActionForm action="charge_issue" driverId={driverId} detail={null} onClose={() => setIssuing(false)} onSaved={() => { setIssuing(false); load() }} />}
  </section>
}
