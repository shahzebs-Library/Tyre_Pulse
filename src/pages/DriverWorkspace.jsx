import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import SignaturePad from '../components/SignaturePad'
import { loadDriverWorkspace, driverWorkspaceCommand, driverWorkspaceOptions, fineSignature, evidenceUrl, uploadFineEvidence } from '../lib/api/driverWorkspace'
import { RECEIPT_STATEMENT, RECORD_TYPES, RESOLUTIONS, recordLabel, signatureImage, validateFineResponse } from '../lib/driverWorkspace'
import { toUserMessage } from '../lib/safeError'
import { driverCopy } from '../lib/driverWorkspaceCopy'

const labels = {
  direct_payment: 'I will pay directly', already_paid: 'Already paid', dispute: 'Dispute / incorrect assignment', company_recovery: 'Request company payment / recovery', instalments: 'Request instalments',
  create_driver: 'Add verified driver', link_account: 'Link login account', assign_team: 'Assign team and vehicle', create_fine: 'Issue traffic fine', link_record: 'Link work record', respond_fine: 'Review and sign', review_fine: 'Review response / payment',
}
const human = key => labels[key] || key.replaceAll('_', ' ')
const fields = {
  create_driver: [['driver_id', 'Employee ID'], ['driver_name', 'Driver name'], ['country', 'Country'], ['site', 'Site']],
  link_account: [['user_id', 'Login account (blank removes link)', 'users'], ['reason', 'Identity verification / reason']],
  assign_team: [['supervisor_id', 'Supervisor', 'users'], ['manager_id', 'Manager', 'users'], ['vehicle_id', 'Vehicle', 'vehicles'], ['reason', 'Assignment reason']],
  create_fine: [['vehicle_id', 'Vehicle', 'vehicles'], ['authority', 'Issuing authority'], ['notice_reference', 'Notice reference'], ['incident_at', 'Incident date and time', 'datetime-local'], ['due_date', 'Due date', 'date'], ['amount', 'Fine amount', 'number'], ['currency', 'Currency code'], ['description', 'Notice details'], ['assignment_reason', 'Evidence confirming driver assignment']],
  link_record: [['source_type', 'Record type', 'record_type'], ['source_id', 'Existing record', 'records'], ['reason', 'How driver identity was verified']],
  respond_fine: [['resolution', 'Preferred resolution', 'resolution'], ['explanation', 'Explanation / proposed arrangement'], ['payment_reference', 'Payment reference (if paid)'], ['proposed_date', 'Proposed payment date', 'date']],
  review_fine: [['decision', 'Decision', 'decision'], ['reason', 'Review reason / approved arrangement'], ['payment_reference', 'Verified payment reference'], ['payment_amount', 'Verified payment amount', 'number']],
}

function SearchPicker({ kind, value, onChange, label }) {
  const [search, setSearch] = useState(''); const [rows, setRows] = useState([]); const [error, setError] = useState(''); const [offset, setOffset] = useState(0)
  useEffect(() => {
    let live = true; setError('')
    const timer = setTimeout(() => driverWorkspaceOptions(kind, search, offset).then(data => { if (live) setRows(data) }).catch(e => { if (live) setError(toUserMessage(e, 'Could not load options')) }), 200)
    return () => { live = false; clearTimeout(timer) }
  }, [kind, search, offset])
  return <div className="space-y-2"><input className="input w-full" aria-label={`Search ${label}`} placeholder={`Search ${label}`} value={search} onChange={e => { setSearch(e.target.value); setOffset(0) }} />
    <select aria-label={label} className="input w-full" value={value || ''} onChange={e => onChange(e.target.value || null)}><option value="">Select / none</option>{value && !rows.some(r => r.id === value) && <option value={value}>Selected record</option>}{rows.slice(0, 100).map(r => <option key={r.id} value={r.id}>{r.label || recordLabel(r.record)}</option>)}</select>
    {error && <p role="alert">{error}</p>}<div className="flex gap-2">{offset > 0 && <button type="button" className="btn-secondary" onClick={() => setOffset(offset - 100)}>Previous options</button>}{rows.length > 100 && <button type="button" className="btn-secondary" onClick={() => setOffset(offset + 100)}>More options</button>}</div></div>
}

function ActionForm({ action, driverId, fine, onClose, onSaved }) {
  const { language } = useLanguage()
  const tr = value => driverCopy(value, language)
  const [values, setValues] = useState({ source_type: RECORD_TYPES[0], resolution: 'direct_payment', decision: 'approve' })
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [pad, setPad] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  const set = (key, value) => { requestId.current = crypto.randomUUID(); setValues(v => ({ ...v, [key]: value, ...(key === 'source_type' ? { source_id: null } : {}) })) }
  async function submit(e) {
    e.preventDefault(); if (saving) return
    if (action === 'respond_fine') { const message = validateFineResponse(values); if (message) { setError(message); return } }
    setSaving(true); setError('')
    try {
      const payload = { ...values, driver_id: driverId, ...(fine ? { fine_id: fine.id, version: fine.version } : {}) }
      if (action === 'create_driver') payload.driver_id = values.driver_id
      if (action === 'respond_fine') { payload.statement_version = 'receipt-v1'; payload.statement_language = language }
      if (payload.incident_at) payload.incident_at = new Date(payload.incident_at).toISOString()
      for (const key of ['due_date', 'proposed_date', 'user_id', 'supervisor_id', 'manager_id', 'vehicle_id']) if (payload[key] === '') payload[key] = null
      await driverWorkspaceCommand(action, payload, requestId.current); onSaved()
    } catch (e) { setError(toUserMessage(e, 'Could not save. Refresh if the case changed.')) } finally { setSaving(false) }
  }
  const formId = `driver-workspace-${action}-form`
  const footer = <><button form={formId} type="submit" disabled={saving} className="btn-primary">{tr(saving ? 'Saving…' : 'Submit')}</button><button type="button" disabled={saving} className="btn-secondary" onClick={onClose}>{tr('Cancel')}</button></>
  return <Modal open onClose={saving ? undefined : onClose} title={tr(human(action))} size="md" footer={footer}><form id={formId} onSubmit={submit} className="space-y-4">
    {fields[action].map(([key, label, type]) => <div key={key}><label className="label" htmlFor={`dw-${key}`}>{tr(label)}</label>
      {['users', 'vehicles', 'records'].includes(type) ? <SearchPicker kind={type === 'records' ? values.source_type : type} value={values[key]} onChange={v => set(key, v)} label={label} />
        : ['resolution', 'decision', 'record_type'].includes(type) ? <select id={`dw-${key}`} className="input w-full" value={values[key] || ''} onChange={e => set(key, e.target.value)}>{(type === 'resolution' ? RESOLUTIONS : type === 'record_type' ? RECORD_TYPES : ['approve', 'return', 'payment', 'cancel', 'reopen']).map(v => <option key={v} value={v}>{tr(human(v))}</option>)}</select>
          : <input id={`dw-${key}`} className="input w-full" type={type || 'text'} step={type === 'number' ? '0.01' : undefined} maxLength={4000} value={values[key] || ''} onChange={e => set(key, e.target.value)} />}</div>)}
    {action === 'respond_fine' && <><label className="flex gap-3"><input type="checkbox" checked={!!values.acknowledged} onChange={e => set('acknowledged', e.target.checked)} /><span>{tr(RECEIPT_STATEMENT)}</span></label><button type="button" className="btn-secondary" onClick={() => setPad(true)}>{tr('Draw signature')}</button>{values.signature && <img className="max-h-32 bg-white" src={signatureImage(values.signature)} alt="Your signature" />}</>}
    {action === 'review_fine' && <p>Approval records the reviewed arrangement. It does not execute a payment or payroll deduction. Record only verified payments.</p>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {pad && <SignaturePad label="Driver acknowledgment" onSave={signature => { set('signature', signature); setPad(false) }} onClose={() => setPad(false)} />}
  </form></Modal>
}

function FineCard({ fine, data, onAction, refresh }) {
  const [signature, setSignature] = useState(null); const [error, setError] = useState(''); const [uploading, setUploading] = useState(false); const [kind, setKind] = useState('supporting')
  async function openEvidence(path) { try { const url = await evidenceUrl(path); window.open(url, '_blank', 'noopener,noreferrer') } catch (e) { setError(toUserMessage(e, 'Could not open evidence')) } }
  async function upload(file) { if (!file) return; setUploading(true); setError(''); try { await uploadFineEvidence(fine, file, kind, crypto.randomUUID()); refresh() } catch (e) { setError(toUserMessage(e, 'Upload failed. Your file has not been attached.')) } finally { setUploading(false) } }
  return <details className="rounded-xl border border-[var(--input-border)] p-4"><summary className="cursor-pointer font-semibold">{fine.notice_reference} · {fine.currency} {fine.amount} · {human(fine.status)} · {human(fine.response_status)}</summary><div className="space-y-3 mt-4">
    <p>{fine.authority} · {fine.asset_no} · {new Date(fine.incident_at).toLocaleString()}</p><p>{fine.description}</p><p>Assignment: {fine.assignment_reason}</p><p>Due: {fine.due_date || 'Not supplied'} · Paid: {fine.paid_amount} · Balance: {Number(fine.amount) - Number(fine.paid_amount)} {fine.currency}</p>
    <div className="flex flex-wrap gap-2">{data.can_respond && fine.status === 'open' && ['awaiting_response', 'returned'].includes(fine.response_status) && <button className="btn-primary" onClick={() => onAction('respond_fine', fine)}>Acknowledge and respond</button>}{data.can_review && <button className="btn-secondary" onClick={() => onAction('review_fine', fine)}>Review / record payment</button>}</div>
    {(fine.evidence || []).map(e => <button className="btn-secondary mr-2" key={e.id} onClick={() => openEvidence(e.object_path)}>{human(e.kind)}: {e.file_name}</button>)}
    {(data.can_respond || data.can_review) && fine.status === 'open' && <div><label className="label">Attach notice / receipt / supporting evidence (PNG, JPEG, PDF; 5 MB)</label><select className="input" aria-label="Evidence type" value={kind} onChange={e => setKind(e.target.value)}><option value="supporting">Supporting evidence</option><option value="payment">Payment receipt</option>{data.can_review && ['awaiting_response', 'returned'].includes(fine.response_status) && <option value="notice">Official notice</option>}</select><input aria-label="Evidence file" type="file" accept="image/png,image/jpeg,application/pdf" disabled={uploading} onChange={e => upload(e.target.files[0])} />{uploading && <p>Uploading…</p>}</div>}
    {(fine.responses || []).map(r => <div key={r.id} className="p-3 bg-[var(--input-bg)] rounded"><p>{human(r.resolution)} · {new Date(r.signed_at).toLocaleString()} · Notice version {r.notice_version}</p><p>{r.explanation}</p>{r.payment_reference && <p>Payment reference: {r.payment_reference}</p>}<button className="btn-secondary" onClick={async () => { try { setSignature(await fineSignature(r.id)) } catch (e) { setError(toUserMessage(e, 'Signature unavailable')) } }}>View signed acknowledgment</button></div>)}
    {signature && <div><p>{RECEIPT_STATEMENT}</p><img src={signatureImage(signature)} alt="Recorded driver signature" className="bg-white max-h-40" /></div>}{error && <p role="alert">{error}</p>}
  </div></details>
}

export default function DriverWorkspace() {
  const [params, setParams] = useSearchParams(); const driverId = params.get('driver')
  const { isRTL, language } = useLanguage()
  const tr = value => driverCopy(value, language)
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [action, setAction] = useState(null); const [search, setSearch] = useState(''); const sequence = useRef(0)
  const load = useCallback(async () => { const seq = ++sequence.current; setLoading(true); setError(''); setData(null); try { const result = await loadDriverWorkspace(driverId); if (seq === sequence.current) setData(result) } catch (e) { if (seq === sequence.current) setError(toUserMessage(e, 'Driver workspace unavailable. Check access and backend configuration.')) } finally { if (seq === sequence.current) setLoading(false) } }, [driverId])
  useEffect(() => { load(); return () => { sequence.current++ } }, [load])
  async function exportReport() {
    try {
      const { loadPdf } = await import('../lib/pdfEngine'); const { applyExportPolicy } = await import('../lib/exportUtils')
      if (applyExportPolicy(data.fines).length !== data.fines.length) throw new Error('The export exceeds your configured row limit. Narrow the report first.')
      const { jsPDF, autoTable } = await loadPdf(); const doc = new jsPDF()
      doc.text(`Driver statement: ${data.driver.driver_name}`, 14, 18)
      autoTable(doc, { startY: 26, head: [['Notice', 'Currency', 'Amount', 'Paid', 'Status', 'Response']], body: data.fines.map(f => [f.notice_reference, f.currency, f.amount, f.paid_amount, f.status, f.response_status]) })
      doc.save('driver-fine-statement.pdf')
    } catch (e) { setError(toUserMessage(e, 'Report could not be generated')) }
  }
  return <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-5 p-4 text-[var(--text-primary)]">
    <PageHeader title={tr('Driver workspace')} subtitle={tr('Fines, verified work records, supervisors and vehicle assignments')} />
    <div className="flex flex-wrap gap-2">{driverId && <button className="btn-secondary" onClick={() => setParams({})}>Back to drivers</button>}<button className="btn-secondary" onClick={load}>Refresh</button><Link className="btn-secondary" to="/driver-management">Driver Intelligence</Link>{data?.can_manage && !driverId && <button className="btn-primary" onClick={() => setAction({ name: 'create_driver' })}>Add verified driver</button>}</div>
    {loading && <p role="status">Loading driver workspace…</p>}{error && <p role="alert" className="text-red-500">{error}</p>}{data?.truncated && <p role="alert">This view reached 10,000 records. The report is incomplete; narrow the workspace before exporting.</p>}
    {data && !driverId && <><input className="input w-full" aria-label="Search drivers" placeholder="Search name, employee ID or site" value={search} onChange={e => setSearch(e.target.value)} />{data.drivers.length === 0 && <p>No linked driver or assigned team is available. An authorized manager must verify the driver record, login and team assignment.</p>}<div className="grid md:grid-cols-2 gap-3">{data.drivers.filter(d => `${d.driver_name} ${d.driver_id} ${d.site}`.toLowerCase().includes(search.toLowerCase())).map(d => <button key={d.id} className="text-start rounded-xl border border-[var(--input-border)] p-4" onClick={() => setParams({ driver: d.id })}><strong>{d.driver_name} · {d.driver_id}</strong><p>{d.position || tr('Position not recorded')}</p><p>{d.site} · {d.country}</p><p>{d.open_fines} open fines · {d.awaiting_response} awaiting response</p><p>{d.user_id ? 'Login linked' : 'Login not linked'} · {human(d.access)}</p></button>)}</div></>}
    {data?.driver && <><h2 className="text-xl font-bold">{data.driver.driver_name} · {data.driver.driver_id}</h2><p>{data.driver.position || tr('Position not recorded')}</p><p>{data.driver.country} · {data.driver.site}</p>
      <div className="flex flex-wrap gap-2">{data.can_manage && ['link_account', 'assign_team', 'link_record'].map(name => <button key={name} className="btn-secondary" onClick={() => setAction({ name })}>{human(name)}</button>)}{data.can_review && <button className="btn-primary" onClick={() => setAction({ name: 'create_fine' })}>Issue traffic fine</button>}<button className="btn-secondary" disabled={data.truncated} onClick={exportReport}>Export fine statement PDF</button></div>
      <div className="flex gap-3">{data.balances.map(b => <p key={b.currency} className="rounded border p-3">Outstanding: {b.outstanding} {b.currency}</p>)}</div>
      <h3 className="font-semibold">Traffic fines</h3>{data.fines.length === 0 && <p>No fines recorded for this driver.</p>}{data.fines.map(f => <FineCard key={`${f.id}-${f.version}`} fine={f} data={data} onAction={(name, fine) => setAction({ name, fine })} refresh={load} />)}
      <h3 className="font-semibold">Team and vehicle assignment history</h3>{data.assignments.length === 0 && <p>No assignment recorded.</p>}{data.assignments.map(a => <div key={a.id} className="rounded border border-[var(--input-border)] p-3"><p>{a.ends_at ? 'Previous assignment' : 'Current assignment'} · {a.asset_no || 'No vehicle'}</p><p>Supervisor: {a.supervisor_name || 'Not assigned'} · Manager: {a.manager_name || 'Not assigned'}</p><p>{new Date(a.starts_at).toLocaleString()} → {a.ends_at ? new Date(a.ends_at).toLocaleString() : 'Present'}</p><p>{a.reason}</p></div>)}
      <h3 className="font-semibold">Assigned work</h3>{(data.work || []).map(w => <div key={w.id} className="rounded border p-3"><strong>{w.title}</strong><p>{human(w.status || 'Not supplied')}</p></div>)}
      <h3 className="font-semibold">Verified work and driver records</h3><p>Only records explicitly linked to this driver are shown. Unmatched historical records require identity review.</p>{data.records.map(l => <div key={l.id} className="rounded border border-[var(--input-border)] p-3"><strong>{human(l.source_type)}</strong><p>{recordLabel(l.record)}</p>{l.record && <dl className="grid sm:grid-cols-2 gap-1">{Object.entries(l.record).filter(([k, v]) => k !== 'id' && v !== null).map(([k, v]) => <div key={k}><dt className="text-sm text-[var(--text-muted)]">{human(k)}</dt><dd>{String(v)}</dd></div>)}</dl>}</div>)}
      <details><summary>Activity history ({data.events.length})</summary>{data.events.map(e => <p key={e.id}>{new Date(e.created_at).toLocaleString()} · {e.actor_name || 'Recorded user'} · {human(e.action)} · {e.details.reason || e.details.explanation || ''}</p>)}</details>
    </>}{action && <ActionForm key={`${action.name}-${action.fine?.id || ''}`} action={action.name} driverId={driverId} fine={action.fine} onClose={() => setAction(null)} onSaved={() => { setAction(null); load() }} />}
  </div>
}
