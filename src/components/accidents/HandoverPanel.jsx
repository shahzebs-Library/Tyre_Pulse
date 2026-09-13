/**
 * HandoverPanel — the "Vehicle dispatch and handover" case tab: the receiving
 * party's workshop-receipt inspection (matches the approved scope? operational
 * test done? accepted / rejected / needs rectification?), with a signature
 * captured on the spot. Backed by accident_handover_inspections
 * (accidentHandover.js), direct RLS-governed insert - always a NEW row, never
 * an edit, so a corrected receipt is its own record and the original is kept.
 *
 * The table has no dedicated signature column, so - matching this plan's own
 * "reuse the existing jsonb column rather than a new migration" pattern for
 * accident_damage_assessments.damage_areas - a captured signature is stored as
 * one more tagged entry in the row's `photos` jsonb array
 * ({kind:'signature', data_url, signed_by, signed_at}), rendered directly (the
 * signature pad already produces a PNG data URL, same convention Inspections.jsx
 * uses for inspector_signature - no storage upload involved).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Truck, PenLine, CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, ClipboardCheck, Trash2,
  MapPin, Wrench, Check, Circle,
} from 'lucide-react'
import { listHandoverInspections, recordHandoverInspection } from '../../lib/api/accidentHandover'
import { getOpenRepairOrder, upsertRepairOrder, WORKSHOP_TYPES } from '../../lib/api/accidentRepairOrders'
import { getDowntime, saveDowntime, VEHICLE_STATUSES } from '../../lib/api/accidentDowntime'
import { dispatchSteps } from '../../lib/accidentDispatch'
import NotifyRecipientsPanel from './NotifyRecipientsPanel'
import { toUserMessage } from '../../lib/safeError'
import SignaturePad from '../SignaturePad'

const WORKSHOP_TYPE_LABEL = {
  internal: 'Internal workshop', external: 'External / third-party', insurer_approved: "Insurer's approved workshop",
  dealer: 'Dealer', specialist: 'Specialist',
}
const VEHICLE_STATUS_LABEL = {
  operational: 'Operational', restricted: 'Restricted', awaiting_recovery: 'Awaiting recovery',
  off_road_accident: 'Off-road (accident)', under_inspection: 'Under inspection', under_repair: 'Under repair',
  ready_for_inspection: 'Ready for inspection', rejected_after_repair: 'Rejected after repair',
  returned_to_operation: 'Returned to operation', total_loss: 'Total loss', disposed: 'Disposed',
}

function Stepper({ steps }) {
  return (
    <div className="flex items-center overflow-x-auto pb-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center shrink-0">
          <div className="flex flex-col items-center gap-1 min-w-[92px]">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center border-2 ${
              s.done ? 'border-green-500 bg-green-900/30 text-green-400'
                : s.current ? 'border-blue-500 bg-blue-900/30 text-blue-300'
                  : 'border-[var(--input-border)] text-[var(--text-muted)]'
            }`}>
              {s.done ? <Check size={14} /> : <Circle size={9} className={s.current ? 'fill-current' : ''} />}
            </span>
            <span className={`text-[11px] text-center leading-tight ${s.current ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'}`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <span className={`h-0.5 w-10 mb-4 ${s.done ? 'bg-green-500' : 'bg-[var(--input-border)]'}`} />}
        </div>
      ))}
    </div>
  )
}

const DECISIONS = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'rectification_required', label: 'Rectification required' },
  { value: 'rejected', label: 'Rejected' },
]
const DECISION_TONE = { accepted: 'text-green-400', rectification_required: 'text-amber-400', rejected: 'text-red-400' }
const DECISION_ICON = { accepted: CheckCircle2, rectification_required: AlertTriangle, rejected: XCircle }

function signatureOf(row) {
  const photos = Array.isArray(row?.photos) ? row.photos : []
  return photos.find((p) => p && p.kind === 'signature') || null
}

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={`flex items-center gap-2 text-sm text-[var(--text-secondary)] ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={!!checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} className="accent-green-500" />
      {label}
    </label>
  )
}

const BLANK_FORM = {
  inspector_name: '', decision: 'accepted', matches_approved_scope: true, operational_test_done: false,
  rejection_reason: '', remarks: '', return_to_service_date: '', actual_downtime_days: '',
}

export default function HandoverPanel({ accidentId, elevated, onChanged }) {
  const [rows, setRows] = useState(null) // null = loading
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)
  const [signature, setSignature] = useState(null) // { dataUrl, signedAt }
  const [showPad, setShowPad] = useState(false)

  // Destination/vendor (the SAME accident_repair_orders row Workshop
  // Assessment writes - one workshop assignment per case, not a second one).
  const [repairOrder, setRepairOrder] = useState(null) // null=loading, {}=none yet
  const [destForm, setDestForm] = useState({ workshopType: '', workshopName: '' })
  const [destSaving, setDestSaving] = useState(false)

  // Dispatch details (accident_vehicle_downtime - recovery/towing/delivery).
  const [downtime, setDowntime] = useState(null)
  const [dispForm, setDispForm] = useState({
    vehicle_status: '', recovery_required: false, towing_reference: '',
    delivered_to_workshop_at: '', expected_return_date: '',
  })
  const [dispSaving, setDispSaving] = useState(false)

  const load = useCallback(async () => {
    setRows(null); setErr('')
    try {
      const [h, order, d] = await Promise.all([
        listHandoverInspections(accidentId),
        getOpenRepairOrder(accidentId),
        getDowntime(accidentId),
      ])
      setRows(h)
      setRepairOrder(order || {})
      setDestForm({ workshopType: order?.workshop_type || '', workshopName: order?.workshop_name || '' })
      setDowntime(d || {})
      setDispForm({
        vehicle_status: d?.vehicle_status || '',
        recovery_required: !!d?.recovery_required,
        towing_reference: d?.towing_reference || '',
        delivered_to_workshop_at: d?.delivered_to_workshop_at ? d.delivered_to_workshop_at.slice(0, 16) : '',
        expected_return_date: d?.expected_return_date || '',
      })
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the handover inspections.'))
      setRows([])
    }
  }, [accidentId])

  useEffect(() => { load() }, [load])

  async function saveDestination(e) {
    e.preventDefault()
    if (destSaving) return
    setDestSaving(true); setErr('')
    try {
      const saved = await upsertRepairOrder(accidentId, {
        workshopType: destForm.workshopType || undefined,
        workshopName: destForm.workshopName || undefined,
      })
      setRepairOrder(saved)
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not save the destination workshop.'))
    } finally {
      setDestSaving(false)
    }
  }

  async function saveDispatch(e) {
    e.preventDefault()
    if (dispSaving) return
    setDispSaving(true); setErr('')
    try {
      const saved = await saveDowntime(accidentId, {
        vehicle_status: dispForm.vehicle_status || null,
        recovery_required: dispForm.recovery_required,
        towing_reference: dispForm.towing_reference || null,
        delivered_to_workshop_at: dispForm.delivered_to_workshop_at ? new Date(dispForm.delivered_to_workshop_at).toISOString() : null,
        expected_return_date: dispForm.expected_return_date || null,
      }, { existingId: downtime?.id })
      setDowntime(saved)
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not save the dispatch details.'))
    } finally {
      setDispSaving(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setErr('')
    try {
      const photos = signature
        ? [{ kind: 'signature', data_url: signature.dataUrl, signed_by: form.inspector_name || null, signed_at: signature.signedAt }]
        : []
      const saved = await recordHandoverInspection(accidentId, {
        inspector_name: form.inspector_name || null,
        decision: form.decision,
        matches_approved_scope: form.matches_approved_scope,
        operational_test_done: form.operational_test_done,
        rejection_reason: form.decision === 'accepted' ? null : (form.rejection_reason || null),
        remarks: form.remarks || null,
        return_to_service_date: form.return_to_service_date || null,
        actual_downtime_days: form.actual_downtime_days === '' ? null : Number(form.actual_downtime_days),
        photos,
      })
      setRows((prev) => [saved, ...(prev || [])])
      setForm(BLANK_FORM)
      setSignature(null)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not record the handover inspection.'))
    } finally {
      setSaving(false)
    }
  }

  const steps = dispatchSteps({ downtime, handoverRows: rows || [] })

  return (
    <div className="p-6 space-y-6">
      <section className="card">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3"><Truck size={16} /> Dispatch &amp; handover progress</h3>
        <Stepper steps={steps} />
      </section>

      <section className="card space-y-4">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Wrench size={16} /> Destination workshop</h3>
        {elevated ? (
          <form onSubmit={saveDestination} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="label">Workshop type</label>
              <select className="input w-full" value={destForm.workshopType} onChange={(e) => setDestForm((f) => ({ ...f, workshopType: e.target.value }))}>
                <option value="">Select…</option>
                {WORKSHOP_TYPES.map((t) => <option key={t} value={t}>{WORKSHOP_TYPE_LABEL[t] || t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Workshop / vendor name</label>
              <input className="input w-full" value={destForm.workshopName} onChange={(e) => setDestForm((f) => ({ ...f, workshopName: e.target.value }))} />
            </div>
            <button type="submit" className="btn-secondary text-xs" disabled={destSaving}>
              {destSaving ? <Loader2 size={13} className="animate-spin" /> : 'Save destination'}
            </button>
          </form>
        ) : (
          <div className="text-sm text-[var(--text-primary)]">
            {repairOrder?.workshop_name || 'No destination workshop set.'}
            {repairOrder?.workshop_type && <span className="text-[var(--text-muted)]"> · {WORKSHOP_TYPE_LABEL[repairOrder.workshop_type] || repairOrder.workshop_type}</span>}
          </div>
        )}
        <p className="text-[11px] text-[var(--text-muted)]">Shared with the Workshop Assessment tab's repair order - one workshop assignment per case.</p>
      </section>

      <section className="card space-y-4">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><MapPin size={16} /> Dispatch details</h3>
        {elevated ? (
          <form onSubmit={saveDispatch} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Vehicle status</label>
              <select className="input w-full" value={dispForm.vehicle_status} onChange={(e) => setDispForm((f) => ({ ...f, vehicle_status: e.target.value }))}>
                <option value="">Select…</option>
                {VEHICLE_STATUSES.map((v) => <option key={v} value={v}>{VEHICLE_STATUS_LABEL[v] || v}</option>)}
              </select>
            </div>
            <Toggle label="Recovery / towing required" checked={dispForm.recovery_required}
              onChange={(v) => setDispForm((f) => ({ ...f, recovery_required: v }))} />
            <div>
              <label className="label">Towing reference</label>
              <input className="input w-full" value={dispForm.towing_reference} disabled={!dispForm.recovery_required}
                onChange={(e) => setDispForm((f) => ({ ...f, towing_reference: e.target.value }))} />
            </div>
            <div>
              <label className="label">Delivered to workshop</label>
              <input type="datetime-local" className="input w-full" value={dispForm.delivered_to_workshop_at}
                onChange={(e) => setDispForm((f) => ({ ...f, delivered_to_workshop_at: e.target.value }))} />
            </div>
            <div>
              <label className="label">Expected return date</label>
              <input type="date" className="input w-full" value={dispForm.expected_return_date}
                onChange={(e) => setDispForm((f) => ({ ...f, expected_return_date: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className="btn-secondary text-xs" disabled={dispSaving}>
                {dispSaving ? <Loader2 size={13} className="animate-spin" /> : 'Save dispatch details'}
              </button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">Only Admin / Manager / Director can update dispatch details.</p>
        )}
      </section>

      <section className="card space-y-4">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Truck size={16} /> Workshop receipt (vendor-completed)</h3>
        <p className="text-xs text-[var(--text-muted)]">
          Recorded by the receiving party at workshop check-in (or a later check-out receipt). Each
          inspection is its own record - a correction is added as a new entry, the original is kept.
        </p>

        {elevated ? (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Inspector name</label>
                <input className="input w-full" value={form.inspector_name}
                  onChange={(e) => setForm((f) => ({ ...f, inspector_name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Decision</label>
                <div className="flex gap-2 mt-1">
                  {DECISIONS.map((d) => {
                    const Icon = DECISION_ICON[d.value]
                    return (
                      <button key={d.value} type="button" onClick={() => setForm((f) => ({ ...f, decision: d.value }))}
                        className={`px-2.5 py-1.5 rounded border text-xs inline-flex items-center gap-1.5 ${
                          form.decision === d.value
                            ? `border-current ${DECISION_TONE[d.value]} bg-current/10`
                            : 'border-[var(--input-border)] text-[var(--text-secondary)]'
                        }`}>
                        <Icon size={12} /> {d.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <Toggle label="Matches approved scope" checked={form.matches_approved_scope}
                onChange={(v) => setForm((f) => ({ ...f, matches_approved_scope: v }))} />
              <Toggle label="Operational test done" checked={form.operational_test_done}
                onChange={(v) => setForm((f) => ({ ...f, operational_test_done: v }))} />
            </div>

            {form.decision !== 'accepted' && (
              <div>
                <label className="label">Reason</label>
                <input className="input w-full" value={form.rejection_reason}
                  onChange={(e) => setForm((f) => ({ ...f, rejection_reason: e.target.value }))} />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Return to service date</label>
                <input type="date" className="input w-full" value={form.return_to_service_date}
                  onChange={(e) => setForm((f) => ({ ...f, return_to_service_date: e.target.value }))} />
              </div>
              <div>
                <label className="label">Actual downtime (days)</label>
                <input type="number" min="0" className="input w-full" value={form.actual_downtime_days}
                  onChange={(e) => setForm((f) => ({ ...f, actual_downtime_days: e.target.value }))} />
              </div>
            </div>

            <div>
              <label className="label">Remarks</label>
              <textarea rows={2} className="input w-full" value={form.remarks}
                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
            </div>

            <div>
              <label className="label mb-1.5 block">Signature</label>
              {signature ? (
                <div className="flex items-center gap-3">
                  <img src={signature.dataUrl} alt="Captured signature" className="h-16 rounded border border-[var(--input-border)] bg-white" />
                  <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => setSignature(null)}>
                    <Trash2 size={12} /> Clear
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setShowPad(true)}
                  className="btn-secondary text-xs inline-flex items-center gap-1.5">
                  <PenLine size={13} /> Capture signature
                </button>
              )}
            </div>

            <button type="submit" className="btn-primary text-xs" disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : 'Record inspection'}
            </button>
          </form>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">Only Admin / Manager / Director can record a handover inspection.</p>
        )}

        {err && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertTriangle size={12} /> {err} <button className="underline inline-flex items-center gap-1" onClick={load}><RefreshCw size={10} /> Retry</button></p>}
      </section>

      <section className="card space-y-3">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><ClipboardCheck size={16} /> Inspection history</h3>
        {rows === null ? (
          <div className="space-y-2 animate-pulse">{[0, 1].map((i) => <div key={i} className="h-14 bg-[var(--input-bg)]/60 rounded" />)}</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No handover inspection recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const Icon = DECISION_ICON[r.decision] || CheckCircle2
              const sig = signatureOf(r)
              return (
                <div key={r.id} className="rounded-lg border border-[var(--input-border)] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold flex items-center gap-1.5 ${DECISION_TONE[r.decision] || 'text-[var(--text-primary)]'}`}>
                        <Icon size={13} /> {DECISIONS.find((d) => d.value === r.decision)?.label || r.decision}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                        {r.inspector_name || 'Unknown inspector'} · {r.inspected_at ? new Date(r.inspected_at).toLocaleString() : 'N/A'}
                      </p>
                      {r.rejection_reason && <p className="text-xs text-[var(--text-secondary)] mt-1">{r.rejection_reason}</p>}
                      {r.remarks && <p className="text-xs text-[var(--text-secondary)] mt-1 whitespace-pre-wrap">{r.remarks}</p>}
                      <p className="text-[11px] text-[var(--text-muted)] mt-1">
                        {r.matches_approved_scope ? 'Matches approved scope' : 'Does not match approved scope'}
                        {' · '}
                        {r.operational_test_done ? 'Operational test done' : 'Operational test not done'}
                      </p>
                    </div>
                    {sig?.data_url && (
                      <img src={sig.data_url} alt="Signature" className="h-12 rounded border border-[var(--input-border)] bg-white shrink-0" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="card">
        <NotifyRecipientsPanel
          accidentId={accidentId}
          workstreamKey="handover"
          title="Notify recipients"
          subject="Dispatch & handover update"
        />
      </section>

      {showPad && (
        <SignaturePad
          label="Handover signature"
          inspectorName={form.inspector_name}
          onSave={(dataUrl) => { setSignature({ dataUrl, signedAt: new Date().toISOString() }); setShowPad(false) }}
          onClose={() => setShowPad(false)}
        />
      )}
    </div>
  )
}
