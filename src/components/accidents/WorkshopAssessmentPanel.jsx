/**
 * WorkshopAssessmentPanel — the "Workshop assessment report" case tab: record
 * visible/hidden damage, cost + downtime estimates, a repair-route
 * recommendation, and open the repair order that recommendation feeds. Backed
 * by accidentDamageAssessment.js (accident_damage_assessments, direct RLS-
 * governed writes) and accidentRepairOrders.js (accident_repair_orders, all
 * writes via accident_repair_order_upsert), both verified live against project
 * jhssdmeruxtrlqnwfksc before this panel was written.
 *
 * The per-region damage marks (the orthographic multi-view "mark damage" tool
 * from the mockups) are step 9 of this plan and are not built yet - they will
 * write into this same assessment's `damage_areas` jsonb array via
 * upsertDamageMark/removeDamageMark (already in accidentDamageAssessment.js).
 * This panel reads that array honestly today: empty until the mapper exists.
 *
 * assessment_status is draft -> submitted -> approved/rejected. Once an
 * assessment leaves 'draft' it is no longer edited in place (a later
 * re-assessment is a NEW row, so the record of what was actually submitted is
 * never rewritten) - the form becomes read-only and a "Submit" action is the
 * only write left.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ClipboardCheck, Wrench, AlertTriangle, Loader2, RefreshCw, Send, MapPin, ShieldAlert,
  AlertOctagon, Award, Camera,
} from 'lucide-react'
import {
  getDamageAssessment, saveDamageAssessment, submitDamageAssessment, REPAIR_ROUTES,
} from '../../lib/api/accidentDamageAssessment'
import { getOpenRepairOrder, upsertRepairOrder, WORKSHOP_TYPES } from '../../lib/api/accidentRepairOrders'
import EvidenceTable from './EvidenceTable'
import NotifyRecipientsPanel from './NotifyRecipientsPanel'
import { toUserMessage } from '../../lib/safeError'

// Shared vocabulary between accident_damage_assessments.recommended_route and
// accident_repair_orders.repair_route (identical token set, verified live).
const ROUTE_LABEL = {
  none: 'None', temporary: 'Temporary repair', internal: 'Internal workshop', external: 'External workshop',
  insurer_approved: 'Insurer-approved workshop', dealer: 'Dealer workshop', specialist: 'Specialist workshop',
  replacement: 'Replacement', total_loss: 'Total loss', disposal: 'Disposal', under_review: 'Under review',
}
const WORKSHOP_TYPE_LABEL = {
  internal: 'Internal', external: 'External', insurer_approved: 'Insurer-approved', dealer: 'Dealer', specialist: 'Specialist',
}
const ASSESSMENT_STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' }
const ASSESSMENT_STATUS_TONE = {
  draft: 'text-[var(--text-muted)]', submitted: 'text-blue-300', approved: 'text-green-400', rejected: 'text-red-400',
}
const ORDER_STATUS_LABEL = {
  planned: 'Planned', awaiting_parts: 'Awaiting parts', awaiting_po: 'Awaiting PO', awaiting_quotation: 'Awaiting quotation',
  in_progress: 'In progress', qc_pending: 'QC pending', qc_passed: 'QC passed', qc_failed: 'QC failed',
  completed: 'Completed', cancelled: 'Cancelled',
}
const ORDER_STATUS_TONE = {
  qc_passed: 'text-green-400', completed: 'text-green-400', qc_failed: 'text-red-400', cancelled: 'text-red-400',
  in_progress: 'text-blue-300', qc_pending: 'text-amber-400',
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

// A safety/mobility FLAG, not a plain form checkbox - each is a real,
// schema-backed field (recommended_offroad / specialist_required /
// total_loss_possible), just given the visual weight a safety flag deserves.
function FlagToggle({ checked, onChange, label, icon: Icon, tone, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-default ${
        checked ? `border-current ${tone} bg-current/10` : 'border-[var(--input-border)] text-[var(--text-muted)]'
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  )
}

export default function WorkshopAssessmentPanel({ accidentId, elevated, acc, fmtCurrency, onChanged }) {
  const [assessment, setAssessment] = useState(null) // null while loading, {} when none exists yet
  const [order, setOrder] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [orderForm, setOrderForm] = useState({ repairRoute: '', workshopType: '', workshopName: '', quotationAmount: '', plannedCompletion: '' })

  const money = (v) => (typeof fmtCurrency === 'function' ? fmtCurrency(v) : (v == null ? 'N/A' : String(v)))

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [a, o] = await Promise.all([getDamageAssessment(accidentId), getOpenRepairOrder(accidentId)])
      const row = a || {}
      setAssessment(row)
      setDraft(row)
      setOrder(o)
      setOrderForm({
        repairRoute: o?.repair_route || row.recommended_route || '',
        workshopType: o?.workshop_type || '',
        // No repair order opened yet - carry forward the workshop already
        // named on the incident report (accidents.workshop_name) rather than
        // showing a blank field under a name the user already typed once.
        workshopName: o?.workshop_name || (!o ? acc?.workshop_name : '') || '',
        quotationAmount: o?.quotation_amount ?? '',
        plannedCompletion: o?.planned_completion || '',
      })
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the workshop assessment.'))
    } finally {
      setLoading(false)
    }
  }, [accidentId, acc?.workshop_name])

  useEffect(() => { load() }, [load])

  const editable = !assessment?.id || assessment.assessment_status === 'draft'

  async function save() {
    if (saving) return
    setSaving(true); setErr('')
    try {
      const patch = { ...draft }
      delete patch.id; delete patch.accident_id; delete patch.created_at; delete patch.updated_at
      delete patch.created_by; delete patch.approved_by; delete patch.approved_at; delete patch.assessment_status
      delete patch.damage_areas
      const saved = await saveDamageAssessment(accidentId, patch, { existingId: assessment?.id, editable: true })
      setAssessment(saved); setDraft(saved)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the workshop assessment.'))
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    if (saving || !assessment?.id) return
    setSaving(true); setErr('')
    try {
      const saved = await submitDamageAssessment(assessment.id)
      setAssessment(saved); setDraft(saved)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not submit the assessment.'))
    } finally {
      setSaving(false)
    }
  }

  async function submitOrder(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setErr('')
    try {
      const saved = await upsertRepairOrder(accidentId, {
        repairRoute: orderForm.repairRoute || null,
        workshopType: orderForm.workshopType || null,
        workshopName: orderForm.workshopName || null,
        quotationAmount: orderForm.quotationAmount === '' ? null : Number(orderForm.quotationAmount),
        plannedCompletion: orderForm.plannedCompletion || null,
      })
      setOrder(saved)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not open the repair order.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading the workshop assessment…</div>
  }
  if (err && draft == null) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-red-400 flex items-center gap-2"><AlertTriangle size={16} /> {err}</p>
        <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={load}><RefreshCw size={13} /> Retry</button>
      </div>
    )
  }

  const damageAreas = Array.isArray(assessment?.damage_areas) ? assessment.damage_areas : []

  return (
    <div className="p-6 space-y-6">
      <section className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><ClipboardCheck size={16} /> Workshop assessment report</h3>
          {assessment?.id && (
            <span className={`text-sm font-semibold ${ASSESSMENT_STATUS_TONE[assessment.assessment_status] || 'text-[var(--text-secondary)]'}`}>
              {ASSESSMENT_STATUS_LABEL[assessment.assessment_status] || assessment.assessment_status}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Assessor name">
            <input className="input w-full" value={draft?.assessor_name ?? ''} disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, assessor_name: e.target.value }))} />
          </Field>
          <Field label="Assessed on">
            <input type="date" className="input w-full" value={draft?.assessed_at ? String(draft.assessed_at).slice(0, 10) : ''} disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, assessed_at: e.target.value || null }))} />
          </Field>
          <Field label="Recommended repair route">
            <select className="input w-full" value={draft?.recommended_route ?? ''} disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, recommended_route: e.target.value || null }))}>
              <option value="">Select…</option>
              {REPAIR_ROUTES.map((r) => <option key={r} value={r}>{ROUTE_LABEL[r] || r}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Visible damage">
            <textarea rows={3} className="input w-full" value={draft?.visible_damage ?? ''} disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, visible_damage: e.target.value }))} />
          </Field>
          <Field label="Hidden / suspected damage">
            <textarea rows={3} className="input w-full" value={draft?.hidden_damage ?? ''} disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, hidden_damage: e.target.value }))} />
          </Field>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Est. labour hours">
            <input type="number" min="0" className="input w-full" value={draft?.estimated_labour_hours ?? ''} disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, estimated_labour_hours: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label="Est. parts cost">
            <input type="number" min="0" className="input w-full" value={draft?.estimated_parts_cost ?? ''} disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, estimated_parts_cost: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label="Est. total cost">
            <input type="number" min="0" className="input w-full" value={draft?.estimated_total_cost ?? ''} disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, estimated_total_cost: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label="Est. downtime (days)">
            <input type="number" min="0" className="input w-full" value={draft?.estimated_downtime_days ?? ''} disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, estimated_downtime_days: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] font-semibold mb-1.5">Safety &amp; mobility flags</p>
          <div className="flex flex-wrap gap-2">
            <FlagToggle label="Vehicle should not be driven" icon={ShieldAlert} tone="text-red-400" disabled={!editable}
              checked={draft?.recommended_offroad} onChange={(v) => setDraft((d) => ({ ...d, recommended_offroad: v }))} />
            <FlagToggle label="Specialist required" icon={Wrench} tone="text-amber-400" disabled={!editable}
              checked={draft?.specialist_required} onChange={(v) => setDraft((d) => ({ ...d, specialist_required: v }))} />
            <FlagToggle label="Total loss possible" icon={AlertOctagon} tone="text-red-400" disabled={!editable}
              checked={draft?.total_loss_possible} onChange={(v) => setDraft((d) => ({ ...d, total_loss_possible: v }))} />
          </div>
        </div>

        {elevated && editable && (
          <div className="flex gap-2 pt-2">
            <button className="btn-primary text-xs" disabled={saving} onClick={save}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : 'Save assessment'}
            </button>
            {assessment?.id && (
              <button className="btn-secondary text-xs inline-flex items-center gap-1.5" disabled={saving} onClick={submit}>
                <Send size={13} /> Submit
              </button>
            )}
          </div>
        )}
        {!elevated && <p className="text-xs text-[var(--text-muted)]">Only Admin / Manager / Director can record this assessment.</p>}
        {err && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}

        <div className="pt-3 border-t border-[var(--input-border)]">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] font-semibold mb-2 flex items-center gap-1.5">
            <MapPin size={11} /> Damage assessment ({damageAreas.length})
          </p>
          {damageAreas.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No damage areas marked yet - use the "Mark vehicle/equipment damage" tab to add marks and photos.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                    <th className="px-2 py-1.5 font-medium">Photo</th>
                    <th className="px-2 py-1.5 font-medium">Component</th>
                    <th className="px-2 py-1.5 font-medium">View</th>
                    <th className="px-2 py-1.5 font-medium">Damage type</th>
                    <th className="px-2 py-1.5 font-medium">Severity</th>
                    <th className="px-2 py-1.5 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--input-border)]">
                  {damageAreas.map((a, i) => (
                    <tr key={`${a.view}-${a.region_key}-${i}`}>
                      <td className="px-2 py-1.5">
                        {Array.isArray(a.photo_refs) && a.photo_refs[0] ? (
                          <img src={a.photo_refs[0]} alt="Damage" className="h-9 w-9 object-cover rounded border border-[var(--input-border)]" />
                        ) : (
                          <span className="h-9 w-9 rounded border border-dashed border-[var(--input-border)] flex items-center justify-center text-[var(--text-muted)]"><Camera size={12} /></span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-[var(--text-primary)]">{a.component_label || a.region_key}</td>
                      <td className="px-2 py-1.5 text-[var(--text-secondary)]">{a.view}</td>
                      <td className="px-2 py-1.5 text-[var(--text-secondary)]">{a.damage_type || 'N/A'}</td>
                      <td className="px-2 py-1.5">
                        <span className={`badge text-[10px] ${
                          a.severity === 'major' ? 'bg-red-900/30 text-red-300 border border-red-700/50'
                            : a.severity === 'moderate' ? 'bg-amber-900/30 text-amber-300 border border-amber-700/50'
                              : 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]'
                        }`}>{a.severity || 'minor'}</span>
                      </td>
                      <td className="px-2 py-1.5 text-[var(--text-muted)]">{a.note || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="card space-y-4">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Wrench size={16} /> Repair order</h3>
        {order && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-3 border-b border-[var(--input-border)]">
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Status</p><p className={`text-sm font-semibold ${ORDER_STATUS_TONE[order.status] || 'text-[var(--text-secondary)]'}`}>{ORDER_STATUS_LABEL[order.status] || order.status}</p></div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Route</p>
              <p className="text-sm text-[var(--text-primary)] flex items-center gap-1.5">
                {ROUTE_LABEL[order.repair_route] || order.repair_route || 'N/A'}
                {assessment?.recommended_route && order.repair_route === assessment.recommended_route && (
                  <span className="badge text-[10px] bg-green-900/30 text-green-300 border border-green-700/50 inline-flex items-center gap-1"><Award size={10} /> Recommended</span>
                )}
              </p>
            </div>
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Quotation</p><p className="text-sm text-[var(--text-primary)]">{order.quotation_amount != null ? money(order.quotation_amount) : 'N/A'}</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Planned completion</p><p className="text-sm text-[var(--text-primary)]">{order.planned_completion ? new Date(order.planned_completion).toLocaleDateString() : 'N/A'}</p></div>
          </div>
        )}
        {!order && <p className="text-sm text-[var(--text-muted)]">No open repair order for this case yet.</p>}

        {elevated ? (
          <form onSubmit={submitOrder} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Repair route">
              <select className="input w-full" value={orderForm.repairRoute}
                onChange={(e) => setOrderForm((f) => ({ ...f, repairRoute: e.target.value }))}>
                <option value="">Select…</option>
                {REPAIR_ROUTES.map((r) => (
                  <option key={r} value={r}>
                    {r === assessment?.recommended_route ? '★ ' : ''}{ROUTE_LABEL[r] || r}{r === assessment?.recommended_route ? ' (Recommended)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Workshop type">
              <select className="input w-full" value={orderForm.workshopType}
                onChange={(e) => setOrderForm((f) => ({ ...f, workshopType: e.target.value }))}>
                <option value="">Select…</option>
                {WORKSHOP_TYPES.map((w) => <option key={w} value={w}>{WORKSHOP_TYPE_LABEL[w] || w}</option>)}
              </select>
            </Field>
            <Field label="Workshop name">
              <input className="input w-full" value={orderForm.workshopName}
                onChange={(e) => setOrderForm((f) => ({ ...f, workshopName: e.target.value }))} />
            </Field>
            <Field label="Quotation amount">
              <input type="number" min="0" className="input w-full" value={orderForm.quotationAmount}
                onChange={(e) => setOrderForm((f) => ({ ...f, quotationAmount: e.target.value }))} />
            </Field>
            <Field label="Planned completion">
              <input type="date" className="input w-full" value={orderForm.plannedCompletion}
                onChange={(e) => setOrderForm((f) => ({ ...f, plannedCompletion: e.target.value }))} />
            </Field>
            <div className="flex items-end">
              <button type="submit" className="btn-primary text-xs" disabled={saving}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : (order ? 'Update repair order' : 'Open repair order')}
              </button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">Only Admin / Manager / Director can open or update the repair order.</p>
        )}
      </section>

      <section className="card">
        <EvidenceTable accidentId={accidentId} workstreamKey="assessment" elevated={elevated} title="Attachments" />
      </section>

      <section className="card">
        <NotifyRecipientsPanel
          accidentId={accidentId}
          workstreamKey="assessment"
          title="Notify recipients"
          subject="Workshop assessment report"
        />
      </section>
    </div>
  )
}
