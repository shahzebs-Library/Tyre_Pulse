/**
 * InsuranceClaimPanel — the "Register insurance claim" case tab: register/update
 * the claim, record the insurer's decision, settle it, track recoveries, and work
 * a required-document checklist. Backed by accidentInsuranceClaims.js
 * (accident_insurance_claims + accident_claim_documents + accident_claim_recoveries,
 * all writes via the accident_claim_* / accident_recovery_record RPCs), verified
 * live against project jhssdmeruxtrlqnwfksc before this panel was written.
 *
 * Distinct from AccidentInsurerRecord (mounted on the older "Claim & Recovery"
 * tab): that panel READS the separate, pre-existing insurance_claim_register
 * ledger (an insurer-maintained document) purely for comparison. This panel is
 * this case's OWN claim workflow — the thing this app writes to when a claim is
 * actually being worked. Neither writes the other's table.
 *
 * The document checklist offers a suggested set of claim documents (doc_type is
 * free text server-side, no CHECK) so a required item can be added with one
 * click; "mark received" flips the outstanding flag without requiring a file
 * attachment yet (the RPC already supports an optional storage_ref for later).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  FileCheck2, ShieldCheck, AlertCircle, Loader2, RefreshCw, Plus, Check, Banknote, Pencil, Lock,
} from 'lucide-react'
import {
  getInsuranceClaim, listClaimDocuments, listRecoveries,
  registerClaim, decideClaim, settleClaim, recordRecovery,
  addClaimDocument, markClaimDocumentReceived,
  CLAIM_DECISIONS, RECOVERY_SOURCES, RECOVERY_STATUSES,
} from '../../lib/api/accidentInsuranceClaims'
import NotifyRecipientsPanel from './NotifyRecipientsPanel'
import { toUserMessage } from '../../lib/safeError'

const INSURANCE_RECIPIENTS = [
  { key: 'insurer', label: 'Insurer / Broker' },
  { key: 'fleet', label: 'Fleet Manager' },
  { key: 'finance', label: 'Finance' },
  { key: 'legal', label: 'Legal' },
]

// Suggested checklist — doc_type is free text server-side; this is a UI
// convenience, not an enforced vocabulary.
const SUGGESTED_DOCS = [
  { doc_type: 'driving_license', label: 'Driving License' },
  { doc_type: 'vehicle_registration', label: 'Vehicle Registration' },
  { doc_type: 'police_report', label: 'Police Report' },
  { doc_type: 'najm_report', label: 'Najm Report' },
  { doc_type: 'taqdeer_report', label: 'Taqdeer Estimation' },
  { doc_type: 'repair_quotation', label: 'Repair Quotation' },
  { doc_type: 'policy_copy', label: 'Insurance Policy Copy' },
  { doc_type: 'damage_photos', label: 'Damage Photos' },
]
const DOC_LABEL = Object.fromEntries(SUGGESTED_DOCS.map((d) => [d.doc_type, d.label]))
function docLabel(docType) {
  return DOC_LABEL[docType] || docType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// The claim's full decision/status vocabulary (accident_insurance_claims.decision
// CHECK, 02_DATA_MODEL.sql B5) — wider than CLAIM_DECISIONS, which is only the
// subset a "record decision" action may assert.
const CLAIM_STATUS_LABEL = {
  not_required: 'Not required', under_review: 'Under review', documents_incomplete: 'Documents incomplete',
  registered: 'Registered', awaiting_acknowledgement: 'Awaiting acknowledgement', awaiting_surveyor: 'Awaiting surveyor',
  survey_completed: 'Survey completed', awaiting_decision: 'Awaiting decision', fully_approved: 'Fully approved',
  partially_approved: 'Partially approved', rejected: 'Rejected', withdrawn: 'Withdrawn', settled: 'Settled',
  disputed: 'Disputed', legal_escalation: 'Legal escalation',
}
const CLAIM_STATUS_TONE = {
  fully_approved: 'text-green-400', settled: 'text-green-400', partially_approved: 'text-amber-400',
  rejected: 'text-red-400', withdrawn: 'text-red-400', disputed: 'text-red-400', legal_escalation: 'text-red-400',
  not_required: 'text-[var(--text-muted)]',
}
const DECISION_ACTION_LABEL = {
  fully_approved: 'Fully approve', partially_approved: 'Partially approve', rejected: 'Reject', withdrawn: 'Withdraw',
  documents_requested: 'Request documents', survey_ordered: 'Order survey', acknowledged: 'Acknowledge',
  settled: 'Mark settled', disputed: 'Dispute',
}
const RECOVERY_SOURCE_LABEL = { insurer: 'Insurer', third_party: 'Third party', driver: 'Driver', other: 'Other' }
const RECOVERY_STATUS_LABEL = {
  pending: 'Pending', in_progress: 'In progress', partial: 'Partial', recovered: 'Recovered',
  written_off: 'Written off', not_applicable: 'Not applicable',
}
const RECOVERY_STATUS_TONE = {
  recovered: 'text-green-400', partial: 'text-amber-400', in_progress: 'text-blue-300',
  written_off: 'text-red-400', pending: 'text-[var(--text-muted)]', not_applicable: 'text-[var(--text-muted)]',
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

export default function InsuranceClaimPanel({ accidentId, elevated, acc, fmtCurrency, onChanged }) {
  const [claim, setClaim] = useState(null) // null while loading, {} when none registered
  const [docs, setDocs] = useState([])
  const [recoveries, setRecoveries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [regForm, setRegForm] = useState({ insurer: '', policyNo: '', claimNo: '', claimAmount: '', deductible: '' })
  const [decisionForm, setDecisionForm] = useState({ decision: '', approvedAmount: '', reason: '' })
  const [settleForm, setSettleForm] = useState({ settledAmount: '', settledAt: '', reference: '' })
  const [recoveryForm, setRecoveryForm] = useState({ source: 'insurer', amount: '', status: 'pending', recoveredAt: '' })
  // Once a claim is registered the registration form is LOCKED to a read-only
  // summary (the card above already shows every field) - "Edit registration"
  // reopens it, rather than always leaving an editable form sitting under a
  // claim that is already being worked through decision/settlement.
  const [editingReg, setEditingReg] = useState(false)
  const [docsOverride, setDocsOverride] = useState(false)
  const [carriedFromReport, setCarriedFromReport] = useState(false)

  const money = (v) => (typeof fmtCurrency === 'function' ? fmtCurrency(v) : (v == null ? 'N/A' : String(v)))

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [c, d, r] = await Promise.all([
        getInsuranceClaim(accidentId), listClaimDocuments(accidentId), listRecoveries(accidentId),
      ])
      const claimRow = c || {}
      setClaim(claimRow)
      setDocs(d)
      setRecoveries(r)
      // No claim has been formally registered yet (no accident_insurance_claims
      // row) - carry forward whatever was already captured on the incident
      // report itself (accidents.insurer/policy_no/insurance_claim_no/
      // claim_amount) rather than showing a blank form under details the user
      // already typed once. Once a claim IS registered, that row is always the
      // one shown here - the incident report's own values are never read again.
      const fromReport = !claimRow.id && !!acc
      setCarriedFromReport(fromReport && !!(acc?.insurer || acc?.policy_no || acc?.insurance_claim_no || acc?.claim_amount))
      setRegForm({
        insurer: claimRow.insurer || (fromReport ? acc.insurer : '') || '',
        policyNo: claimRow.policy_no || (fromReport ? acc.policy_no : '') || '',
        claimNo: claimRow.claim_no || (fromReport ? acc.insurance_claim_no : '') || '',
        claimAmount: fromReport && acc.claim_amount != null ? String(acc.claim_amount) : '',
        deductible: claimRow.deductible ?? '',
      })
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the insurance claim.'))
    } finally {
      setLoading(false)
    }
  }, [accidentId, acc])

  useEffect(() => { load() }, [load])

  async function submitRegister(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setErr('')
    try {
      const saved = await registerClaim(accidentId, {
        insurer: regForm.insurer || null,
        policyNo: regForm.policyNo || null,
        claimNo: regForm.claimNo || null,
        claimAmount: regForm.claimAmount === '' ? null : Number(regForm.claimAmount),
        deductible: regForm.deductible === '' ? null : Number(regForm.deductible),
      })
      setClaim(saved)
      setEditingReg(false)
      setCarriedFromReport(false)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not register the claim.'))
    } finally {
      setSaving(false)
    }
  }

  async function submitDecision(e) {
    e.preventDefault()
    if (saving || !claim?.id || !decisionForm.decision) return
    setSaving(true); setErr('')
    try {
      const result = await decideClaim(claim.id, {
        decision: decisionForm.decision,
        approvedAmount: decisionForm.approvedAmount === '' ? null : Number(decisionForm.approvedAmount),
        reason: decisionForm.reason || null,
      })
      setClaim(result.claim || claim)
      setDecisionForm({ decision: '', approvedAmount: '', reason: '' })
      setDocsOverride(false)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not record the claim decision.'))
    } finally {
      setSaving(false)
    }
  }

  async function submitSettlement(e) {
    e.preventDefault()
    if (saving || !claim?.id) return
    setSaving(true); setErr('')
    try {
      const result = await settleClaim(claim.id, {
        settledAmount: settleForm.settledAmount === '' ? null : Number(settleForm.settledAmount),
        settledAt: settleForm.settledAt || null,
        reference: settleForm.reference || null,
      })
      setClaim(result.claim || claim)
      setSettleForm({ settledAmount: '', settledAt: '', reference: '' })
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not record the settlement.'))
    } finally {
      setSaving(false)
    }
  }

  async function submitRecovery(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setErr('')
    try {
      const saved = await recordRecovery(accidentId, {
        source: recoveryForm.source,
        amount: recoveryForm.amount === '' ? null : Number(recoveryForm.amount),
        status: recoveryForm.status,
        recoveredAt: recoveryForm.recoveredAt || null,
      })
      setRecoveries((prev) => [saved, ...prev])
      setRecoveryForm({ source: 'insurer', amount: '', status: 'pending', recoveredAt: '' })
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not record the recovery.'))
    } finally {
      setSaving(false)
    }
  }

  async function addDoc(docType) {
    setSaving(true); setErr('')
    try {
      const saved = await addClaimDocument(accidentId, { docType })
      setDocs((prev) => [...prev, saved])
    } catch (e) {
      setErr(toUserMessage(e, 'Could not add the document to the checklist.'))
    } finally {
      setSaving(false)
    }
  }

  async function markReceived(documentId) {
    setSaving(true); setErr('')
    try {
      const saved = await markClaimDocumentReceived(accidentId, documentId)
      setDocs((prev) => prev.map((d) => (d.id === documentId ? saved : d)))
    } catch (e) {
      setErr(toUserMessage(e, 'Could not mark the document received.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading insurance claim…</div>
  }
  if (err && claim == null) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-red-400 flex items-center gap-2"><AlertCircle size={16} /> {err}</p>
        <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={load}><RefreshCw size={13} /> Retry</button>
      </div>
    )
  }

  const hasClaim = !!claim?.id
  const addedDocTypes = new Set(docs.map((d) => d.doc_type))
  const missingDocs = SUGGESTED_DOCS.filter((d) => !addedDocTypes.has(d.doc_type))
  const requiredDocs = docs.filter((d) => d.required)
  const outstandingCount = requiredDocs.filter((d) => !d.received).length
  // Complete only once at least one required document has actually been
  // added AND none of them are outstanding - "nothing added yet" must never
  // read as "complete".
  const docsComplete = requiredDocs.length > 0 && outstandingCount === 0
  const showRegForm = elevated && (!hasClaim || editingReg)

  return (
    <div className="p-6 space-y-6">
      <section className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><FileCheck2 size={16} /> Insurance claim</h3>
          {hasClaim && (
            <span className={`text-sm font-semibold ${CLAIM_STATUS_TONE[claim.decision] || 'text-[var(--text-secondary)]'}`}>
              {CLAIM_STATUS_LABEL[claim.decision] || claim.decision}
            </span>
          )}
        </div>

        {hasClaim && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-3 border-b border-[var(--input-border)]">
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Insurer</p><p className="text-sm text-[var(--text-primary)]">{claim.insurer || 'N/A'}</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Policy no.</p><p className="text-sm text-[var(--text-primary)]">{claim.policy_no || 'N/A'}</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Claim no.</p><p className="text-sm text-[var(--text-primary)]">{claim.claim_no || 'N/A'}</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Approved amount</p><p className="text-sm font-semibold text-green-400">{claim.approved_amount != null ? money(claim.approved_amount) : 'N/A'}</p></div>
          </div>
        )}

        {!elevated && (
          <p className="text-xs text-[var(--text-muted)]">Only Admin / Manager / Director can register or update this claim.</p>
        )}

        {elevated && hasClaim && !editingReg && (
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => setEditingReg(true)}>
            <Pencil size={12} /> Edit registration
          </button>
        )}

        {showRegForm && (
          <form onSubmit={submitRegister} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {hasClaim && (
              <p className="sm:col-span-2 text-[11px] text-amber-300 flex items-center gap-1.5"><Lock size={11} /> Revising an already-registered claim - the insurer's own decision/settlement records below are unaffected.</p>
            )}
            {carriedFromReport && (
              <p className="sm:col-span-2 text-[11px] text-blue-300">Pre-filled from what was already entered on the incident report - check and register to make it the claim of record.</p>
            )}
            <Field label="Insurer">
              <input className="input w-full" value={regForm.insurer} onChange={(e) => setRegForm((f) => ({ ...f, insurer: e.target.value }))} />
            </Field>
            <Field label="Policy no.">
              <input className="input w-full" value={regForm.policyNo} onChange={(e) => setRegForm((f) => ({ ...f, policyNo: e.target.value }))} />
            </Field>
            <Field label="Claim no.">
              <input className="input w-full" value={regForm.claimNo} onChange={(e) => setRegForm((f) => ({ ...f, claimNo: e.target.value }))} />
            </Field>
            <Field label="Claim amount">
              <input type="number" min="0" className="input w-full" value={regForm.claimAmount}
                onChange={(e) => setRegForm((f) => ({ ...f, claimAmount: e.target.value }))} placeholder="Leave blank to keep unchanged" />
            </Field>
            <Field label="Deductible">
              <input type="number" min="0" className="input w-full" value={regForm.deductible}
                onChange={(e) => setRegForm((f) => ({ ...f, deductible: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2 flex items-center gap-2">
              <button type="submit" className="btn-primary text-xs" disabled={saving}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : (hasClaim ? 'Save changes' : 'Register claim')}
              </button>
              {hasClaim && (
                <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={() => setEditingReg(false)}>Cancel</button>
              )}
            </div>
          </form>
        )}
      </section>

      {hasClaim && elevated && (
        <section className="card space-y-4">
          <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><ShieldCheck size={16} /> Insurer decision</h3>

          {!docsComplete && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2 space-y-1.5">
              <p className="text-xs text-amber-300">
                {requiredDocs.length === 0
                  ? 'No documents have been added to the checklist yet.'
                  : `${outstandingCount} of ${requiredDocs.length} required document${requiredDocs.length === 1 ? '' : 's'} still outstanding.`}
                {' '}Insurers usually decide once documents are complete.
              </p>
              <label className="flex items-center gap-1.5 text-[11px] text-amber-200">
                <input type="checkbox" checked={docsOverride} onChange={(e) => setDocsOverride(e.target.checked)} />
                Record the decision anyway (documents incomplete)
              </label>
            </div>
          )}

          <form onSubmit={submitDecision} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <Field label="Decision">
              <select className="input w-full" value={decisionForm.decision}
                onChange={(e) => setDecisionForm((f) => ({ ...f, decision: e.target.value }))}>
                <option value="">Select…</option>
                {CLAIM_DECISIONS.map((d) => <option key={d} value={d}>{DECISION_ACTION_LABEL[d] || d}</option>)}
              </select>
            </Field>
            {(decisionForm.decision === 'fully_approved' || decisionForm.decision === 'partially_approved') && (
              <Field label="Approved amount">
                <input type="number" min="0" className="input w-full" value={decisionForm.approvedAmount}
                  onChange={(e) => setDecisionForm((f) => ({ ...f, approvedAmount: e.target.value }))} />
              </Field>
            )}
            <Field label="Reason / remarks">
              <input className="input w-full" value={decisionForm.reason}
                onChange={(e) => setDecisionForm((f) => ({ ...f, reason: e.target.value }))} />
            </Field>
            <button type="submit" className="btn-secondary text-xs" disabled={saving || !decisionForm.decision || (!docsComplete && !docsOverride)}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : 'Record decision'}
            </button>
          </form>

          <div className="border-t border-[var(--input-border)] pt-4">
            <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-2"><Banknote size={14} /> Settlement</p>
            <form onSubmit={submitSettlement} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <Field label="Settled amount">
                <input type="number" min="0" className="input w-full" value={settleForm.settledAmount}
                  onChange={(e) => setSettleForm((f) => ({ ...f, settledAmount: e.target.value }))} />
              </Field>
              <Field label="Settled on">
                <input type="date" className="input w-full" value={settleForm.settledAt}
                  onChange={(e) => setSettleForm((f) => ({ ...f, settledAt: e.target.value }))} />
              </Field>
              <Field label="Reference">
                <input className="input w-full" value={settleForm.reference}
                  onChange={(e) => setSettleForm((f) => ({ ...f, reference: e.target.value }))} />
              </Field>
              <button type="submit" className="btn-secondary text-xs"
                disabled={saving || settleForm.settledAmount === '' || !settleForm.settledAt}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : 'Record settlement'}
              </button>
            </form>
          </div>
        </section>
      )}

      <section className="card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-[var(--text-primary)]">Document checklist</h3>
          {requiredDocs.length > 0 && (
            <span className={`text-xs font-semibold ${docsComplete ? 'text-green-400' : 'text-amber-400'}`}>
              {requiredDocs.length - outstandingCount} of {requiredDocs.length} received
            </span>
          )}
        </div>
        {requiredDocs.length > 0 && (
          <div className="h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
            <div
              className={`h-full ${docsComplete ? 'bg-green-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.round(((requiredDocs.length - outstandingCount) / requiredDocs.length) * 100)}%` }}
            />
          </div>
        )}
        {docs.length === 0 && <p className="text-sm text-[var(--text-muted)]">No documents added to the checklist yet.</p>}
        <div className="space-y-2">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--input-border)] px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-[var(--text-primary)] truncate">{d.doc_name || docLabel(d.doc_type)}</p>
                {d.received_at && <p className="text-[11px] text-[var(--text-muted)]">Received {new Date(d.received_at).toLocaleDateString()}</p>}
              </div>
              {d.received ? (
                <span className="text-xs text-green-400 flex items-center gap-1 shrink-0"><Check size={13} /> Received</span>
              ) : elevated ? (
                <button className="btn-secondary text-xs shrink-0" disabled={saving} onClick={() => markReceived(d.id)}>Mark received</button>
              ) : (
                <span className="text-xs text-amber-400 shrink-0">Outstanding</span>
              )}
            </div>
          ))}
        </div>
        {elevated && missingDocs.length > 0 && (
          <div className="pt-2 border-t border-[var(--input-border)]">
            <p className="text-[11px] text-[var(--text-muted)] mb-2">Add to checklist</p>
            <div className="flex flex-wrap gap-2">
              {missingDocs.map((d) => (
                <button key={d.doc_type} type="button" className="btn-secondary text-xs inline-flex items-center gap-1" disabled={saving}
                  onClick={() => addDoc(d.doc_type)}>
                  <Plus size={12} /> {d.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <h3 className="font-semibold text-[var(--text-primary)]">Recoveries</h3>
        {recoveries.length === 0 && <p className="text-sm text-[var(--text-muted)]">No recovery recorded yet.</p>}
        <div className="space-y-2">
          {recoveries.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--input-border)] px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-[var(--text-primary)]">{RECOVERY_SOURCE_LABEL[r.source] || r.source}</p>
                {r.reference && <p className="text-[11px] text-[var(--text-muted)]">Ref: {r.reference}</p>}
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{r.amount != null ? money(r.amount) : 'N/A'}</p>
                <p className={`text-[11px] ${RECOVERY_STATUS_TONE[r.status] || 'text-[var(--text-muted)]'}`}>{RECOVERY_STATUS_LABEL[r.status] || r.status}</p>
              </div>
            </div>
          ))}
        </div>
        {elevated && (
          <form onSubmit={submitRecovery} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end pt-2 border-t border-[var(--input-border)]">
            <Field label="Source">
              <select className="input w-full" value={recoveryForm.source}
                onChange={(e) => setRecoveryForm((f) => ({ ...f, source: e.target.value }))}>
                {RECOVERY_SOURCES.map((s) => <option key={s} value={s}>{RECOVERY_SOURCE_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Amount">
              <input type="number" min="0" className="input w-full" value={recoveryForm.amount}
                onChange={(e) => setRecoveryForm((f) => ({ ...f, amount: e.target.value }))} />
            </Field>
            <Field label="Status">
              <select className="input w-full" value={recoveryForm.status}
                onChange={(e) => setRecoveryForm((f) => ({ ...f, status: e.target.value }))}>
                {RECOVERY_STATUSES.map((s) => <option key={s} value={s}>{RECOVERY_STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
            {recoveryForm.status === 'recovered' && (
              <Field label="Recovered on">
                <input type="date" className="input w-full" value={recoveryForm.recoveredAt}
                  onChange={(e) => setRecoveryForm((f) => ({ ...f, recoveredAt: e.target.value }))} />
              </Field>
            )}
            <div>
              <button type="submit" className="btn-secondary text-xs" disabled={saving || (recoveryForm.status === 'recovered' && !recoveryForm.recoveredAt)}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : 'Add recovery'}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="card">
        <NotifyRecipientsPanel
          accidentId={accidentId}
          workstreamKey="insurance"
          recipients={INSURANCE_RECIPIENTS}
          title="Notify recipients"
          subject="Insurance claim update"
        />
      </section>

      {err && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertCircle size={12} /> {err}</p>}
    </div>
  )
}
