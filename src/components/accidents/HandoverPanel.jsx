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
} from 'lucide-react'
import { listHandoverInspections, recordHandoverInspection } from '../../lib/api/accidentHandover'
import { toUserMessage } from '../../lib/safeError'
import SignaturePad from '../SignaturePad'

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

  const load = useCallback(async () => {
    setRows(null); setErr('')
    try {
      setRows(await listHandoverInspections(accidentId))
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the handover inspections.'))
      setRows([])
    }
  }, [accidentId])

  useEffect(() => { load() }, [load])

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

  return (
    <div className="p-6 space-y-6">
      <section className="card space-y-4">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Truck size={16} /> Vehicle dispatch and handover</h3>
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
