/**
 * InsuranceClaimPanel - the "Register insurance claim" case tab, field for
 * field the owner's mock M4 (Workstream 3 of 7, Insurance / Claims):
 *
 *   header      WorkstreamHeader (received / with team / SLA) + "External repair
 *               assessment" banner when the repair route is external
 *   section 1   Claim document package: the 8 CLAIM_PACKAGE_DOCS with
 *               Received / Missing / "N received", "7 of 8 required documents",
 *               Request <doc> (logs an accident_case_communications request) and
 *               Upload document (the existing accident_evidence upload)
 *   section 2   Claim registration: insurer, policy, claim number (auto after
 *               registration), liability + GCC %, claim amount, deductible, net
 *               claimable (derived); "Register claim with insurer" is LOCKED
 *               until every required document is in
 *   section 3   Payment and recovery: status pill, approved, recovered (sum),
 *               outstanding (derived), source, last updated, update recovery
 *   section 4   After registration notify: NOTIFY_ROLES chips with the resolved
 *               workstream owner's name when known
 *   footer      Save claim draft | Complete documents; "<Command Center owner>
 *               is monitoring SLA and missing documents."
 *
 * Every number comes from src/lib/claimPackage.js (pure). Writes still go
 * through accidentInsuranceClaims.js (RPC-backed register/decision/settlement/
 * recovery) - the older decision + settlement forms live on under the
 * "Insurer decision" disclosure, unchanged in behaviour.
 *
 * "Save claim draft" keeps the unsent registration form on THIS device
 * (localStorage) and says so; a draft must not call the register RPC, which
 * moves the insurance workstream to in_progress and posts claim_amount onto
 * the accident - that is registration, not a draft.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FileCheck2, ShieldCheck, AlertCircle, AlertTriangle, Loader2, RefreshCw, Check, Banknote, Pencil,
  Upload, Send, ChevronDown, ChevronRight, Save, ListChecks, Megaphone, Info,
} from 'lucide-react'
import {
  loadClaimTabContext, registerClaim, decideClaim, settleClaim, recordRecovery,
  CLAIM_DECISIONS, RECOVERY_SOURCES, RECOVERY_STATUSES,
} from '../../lib/api/accidentInsuranceClaims'
import { addEvidence } from '../../lib/api/accidentEvidence'
import { logCommunication } from '../../lib/api/accidentCommunications'
import { CLAIM_PACKAGE_DOCS } from '../../lib/accidentCaseVocab'
import {
  buildClaimPackage, netClaimable, outstanding, recoveredTotal, lastUpdatedAt,
  liabilityLabel, gccLiabilityPct, isExternalRepairRoute, resolveNotifyPeople, commandCenterOwner,
} from '../../lib/claimPackage'
import WorkstreamHeader from './WorkstreamHeader'
import { useAuth } from '../../contexts/AuthContext'
import { toUserMessage } from '../../lib/safeError'
import { formatCurrency, formatDateTime } from '../../lib/formatters'

const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }
const NOT_SET = 'Not set'
const REQUEST_SUBJECT_PREFIX = 'Document request: '

// accident_insurance_claims.decision vocabulary (02_DATA_MODEL.sql B5).
const CLAIM_STATUS_LABEL = {
  not_required: 'Not required', under_review: 'Under review', documents_incomplete: 'Documents incomplete',
  registered: 'Registered', awaiting_acknowledgement: 'Awaiting acknowledgement', awaiting_surveyor: 'Awaiting surveyor',
  survey_completed: 'Survey completed', awaiting_decision: 'Awaiting decision', fully_approved: 'Fully approved',
  partially_approved: 'Partially approved', rejected: 'Rejected', withdrawn: 'Withdrawn', settled: 'Settled',
  disputed: 'Disputed', legal_escalation: 'Legal escalation',
}
const CLAIM_STATUS_TONE = {
  fully_approved: 'bg-emerald-500/15 text-emerald-500', settled: 'bg-emerald-500/15 text-emerald-500',
  partially_approved: 'bg-amber-500/15 text-amber-500', rejected: 'bg-red-500/15 text-red-500',
  withdrawn: 'bg-red-500/15 text-red-500', disputed: 'bg-red-500/15 text-red-500',
  legal_escalation: 'bg-red-500/15 text-red-500',
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

const draftKey = (id) => `tp.claimDraft.${id}`
function readDraft(id) {
  try { const raw = window.localStorage.getItem(draftKey(id)); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeDraft(id, draft) {
  try { window.localStorage.setItem(draftKey(id), JSON.stringify(draft)); return true } catch { return false }
}

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  )
}
function ReadOnly({ label, value, tone = '' }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className={`text-sm text-[var(--text-primary)] ${tone}`}>{value == null || value === '' ? NOT_SET : value}</p>
    </div>
  )
}
function SectionTitle({ n, icon: Icon, children, right }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--input-bg)] text-[11px]">{n}</span>
        <Icon size={16} /> {children}
      </h3>
      {right}
    </div>
  )
}

export default function InsuranceClaimPanel({ accidentId, elevated, acc, fmtCurrency, onChanged, workstreams: wsProp }) {
  const { profile } = useAuth()
  const authorName = profile?.full_name || profile?.username || null

  const [ctx, setCtx] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')

  const [regForm, setRegForm] = useState({ insurer: '', policyNo: '', claimNo: '', claimAmount: '', deductible: '' })
  const [decisionForm, setDecisionForm] = useState({ decision: '', approvedAmount: '', reason: '' })
  const [settleForm, setSettleForm] = useState({ settledAmount: '', settledAt: '', reference: '' })
  const [recoveryForm, setRecoveryForm] = useState({ source: 'insurer', amount: '', status: 'pending', recoveredAt: '' })
  const [editingReg, setEditingReg] = useState(false)
  const [decisionOpen, setDecisionOpen] = useState(false)
  const [docsOverride, setDocsOverride] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadKey, setUploadKey] = useState('')
  const [highlightMissing, setHighlightMissing] = useState(false)
  const [requested, setRequested] = useState(() => new Set())
  const [draftSavedAt, setDraftSavedAt] = useState(null)
  const [notified, setNotified] = useState(false)

  const packageRef = useRef(null)
  const fileRef = useRef(null)

  const currency = acc?.currency || COUNTRY_CURRENCY[acc?.country] || null
  const money = useCallback((v) => {
    if (v == null || v === '' || !Number.isFinite(Number(v))) return NOT_SET
    if (typeof fmtCurrency === 'function') return fmtCurrency(v)
    return currency ? formatCurrency(v, currency, 0) : Number(v).toLocaleString('en-US')
  }, [fmtCurrency, currency])
  const when = (iso) => (iso ? formatDateTime(iso, acc?.country || 'All') : NOT_SET)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const data = await loadClaimTabContext(accidentId, { country: acc?.country })
      setCtx(data)
      const claimRow = data.claim || {}
      const draft = claimRow.id ? null : readDraft(accidentId)
      const fromReport = !claimRow.id && !!acc
      setRegForm({
        insurer: claimRow.insurer || draft?.insurer || (fromReport ? acc.insurer : '') || '',
        policyNo: claimRow.policy_no || draft?.policyNo || (fromReport ? acc.policy_no : '') || '',
        claimNo: claimRow.claim_no || '',
        // accident_claim_register posts claim_amount onto the ACCIDENT row (the
        // claims table carries no such column), so the accident is its source.
        claimAmount: draft?.claimAmount ?? (acc?.claim_amount != null ? String(acc.claim_amount) : ''),
        deductible: claimRow.deductible ?? draft?.deductible ?? '',
      })
      if (draft?.savedAt) setDraftSavedAt(draft.savedAt)
      // Prior document requests already on the case timeline read as "Requested".
      const prior = new Set()
      for (const c of data.communications || []) {
        const subj = String(c?.subject || '')
        if (subj.startsWith(REQUEST_SUBJECT_PREFIX)) {
          const label = subj.slice(REQUEST_SUBJECT_PREFIX.length)
          const doc = CLAIM_PACKAGE_DOCS.find((d) => d.label === label)
          if (doc) prior.add(doc.key)
        }
      }
      setRequested(prior)
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the insurance claim.'))
    } finally {
      setLoading(false)
    }
  }, [accidentId, acc])

  useEffect(() => { load() }, [load])

  const claim = ctx?.claim || null
  const hasClaim = !!claim?.id
  const workstreams = useMemo(() => (Array.isArray(wsProp) && wsProp.length ? wsProp : ctx?.workstreams) || [], [wsProp, ctx?.workstreams])
  const pkg = useMemo(() => buildClaimPackage(ctx?.evidence || []), [ctx?.evidence])
  const recovered = recoveredTotal(ctx?.recoveries || [])
  const claimAmount = hasClaim ? (acc?.claim_amount ?? claim.claim_amount ?? null) : (regForm.claimAmount === '' ? null : Number(regForm.claimAmount))
  const deductible = hasClaim ? claim.deductible : (regForm.deductible === '' ? null : Number(regForm.deductible))
  const net = netClaimable(claimAmount, deductible)
  const owed = outstanding(claimAmount, claim?.approved_amount, recovered)
  const people = useMemo(() => resolveNotifyPeople(workstreams, ctx?.profiles || []), [workstreams, ctx?.profiles])
  const ccOwner = commandCenterOwner(workstreams, ctx?.profiles || [])
  const insuranceWs = workstreams.find((w) => w.workstream_key === 'insurance')
  const insuranceOwner = insuranceWs?.owner_id
    ? (ctx?.profiles || []).find((p) => p.id === insuranceWs.owner_id) : null
  const ownerName = insuranceOwner?.full_name || insuranceOwner?.username || null
  const external = isExternalRepairRoute(ctx?.repairOrder, ctx?.assessment)
  const liab = liabilityLabel(ctx?.liability)
  const gccPct = gccLiabilityPct(ctx?.liability)
  const latestRecovery = (ctx?.recoveries || [])[0] || null
  const canRegister = pkg.canRegister
  const showRegForm = elevated && (!hasClaim || editingReg)

  // ── writes ──────────────────────────────────────────────────────────────
  async function submitRegister(e) {
    e?.preventDefault?.()
    if (saving || !elevated) return
    if (!hasClaim && !canRegister) return
    setSaving(true); setErr(''); setNotice('')
    try {
      const saved = await registerClaim(accidentId, {
        insurer: regForm.insurer || null,
        policyNo: regForm.policyNo || null,
        claimNo: regForm.claimNo || null,
        claimAmount: regForm.claimAmount === '' ? null : Number(regForm.claimAmount),
        deductible: regForm.deductible === '' ? null : Number(regForm.deductible),
      })
      setCtx((c) => ({ ...(c || {}), claim: saved }))
      setEditingReg(false)
      try { window.localStorage.removeItem(draftKey(accidentId)) } catch { /* device storage unavailable */ }
      setDraftSavedAt(null)
      setNotice(hasClaim ? 'Claim registration updated.' : 'Claim registered with the insurer.')
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not register the claim.'))
    } finally {
      setSaving(false)
    }
  }

  function saveDraft() {
    const draft = { insurer: regForm.insurer, policyNo: regForm.policyNo, claimAmount: regForm.claimAmount, deductible: regForm.deductible, savedAt: new Date().toISOString() }
    if (writeDraft(accidentId, draft)) {
      setDraftSavedAt(draft.savedAt)
      setNotice('Claim draft saved on this device. Nothing has been sent to the insurer.')
    } else {
      setErr('The draft could not be saved on this device.')
    }
  }

  function completeDocuments() {
    setHighlightMissing(true)
    setUploadOpen(true)
    if (!uploadKey && pkg.missingRequired[0]) setUploadKey(pkg.missingRequired[0].key)
    packageRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  async function requestDoc(doc) {
    if (saving) return
    setSaving(true); setErr(''); setNotice('')
    try {
      await logCommunication(accidentId, {
        channel: 'in_app', direction: 'outbound',
        subject: `${REQUEST_SUBJECT_PREFIX}${doc.label}`,
        body: `${doc.label} is required to register the insurance claim. Please upload it to the case.`,
        toParty: 'Fleet', authorName, workstreamKey: 'insurance',
      })
      setRequested((prev) => new Set(prev).add(doc.key))
      setNotice(`${doc.label} requested. The request is on the case timeline.`)
    } catch (e) {
      setErr(toUserMessage(e, 'Could not log the document request.'))
    } finally {
      setSaving(false)
    }
  }

  async function uploadDoc(file) {
    const doc = CLAIM_PACKAGE_DOCS.find((d) => d.key === uploadKey)
    if (!file || !doc || saving) return
    setSaving(true); setErr(''); setNotice('')
    try {
      const row = await addEvidence(accidentId, file, {
        kind: doc.countable ? 'photo' : 'document', caption: doc.label,
        workstreamKey: 'insurance', requirementKey: doc.key,
      })
      setCtx((c) => ({ ...(c || {}), evidence: [row, ...((c?.evidence) || [])] }))
      setNotice(`${doc.label} uploaded.`)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not upload the document.'))
    } finally {
      setSaving(false)
      if (fileRef.current) fileRef.current.value = ''
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
      setCtx((c) => ({ ...(c || {}), claim: result.claim || c?.claim }))
      setDecisionForm({ decision: '', approvedAmount: '', reason: '' })
      setDocsOverride(false)
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not record the claim decision.'))
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
      setCtx((c) => ({ ...(c || {}), claim: result.claim || c?.claim }))
      setSettleForm({ settledAmount: '', settledAt: '', reference: '' })
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not record the settlement.'))
    } finally {
      setSaving(false)
    }
  }

  async function submitRecovery(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setErr(''); setNotice('')
    try {
      const saved = await recordRecovery(accidentId, {
        source: recoveryForm.source,
        amount: recoveryForm.amount === '' ? null : Number(recoveryForm.amount),
        status: recoveryForm.status,
        recoveredAt: recoveryForm.recoveredAt || null,
      })
      setCtx((c) => ({ ...(c || {}), recoveries: [saved, ...((c?.recoveries) || [])] }))
      setRecoveryForm({ source: 'insurer', amount: '', status: 'pending', recoveredAt: '' })
      setRecoveryOpen(false)
      setNotice('Recovery recorded. The adjustment is timestamped on the case.')
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not record the recovery.'))
    } finally {
      setSaving(false)
    }
  }

  async function notifyAfterRegistration() {
    if (saving || !hasClaim) return
    setSaving(true); setErr(''); setNotice('')
    try {
      const status = CLAIM_STATUS_LABEL[claim.decision] || claim.decision || 'Registered'
      const nextAction = pkg.complete ? 'Await insurer acknowledgement' : `Complete documents (${pkg.missingRequired.map((d) => d.label).join(', ')})`
      await logCommunication(accidentId, {
        channel: 'in_app', direction: 'outbound',
        subject: 'Insurance claim registered',
        body: `Claim number ${claim.claim_no || NOT_SET}. Documents ${pkg.counterLabel}. Claim amount ${money(claimAmount)}. Status ${status}. Next action: ${nextAction}.`,
        toParty: people.map((p) => p.display).join(', '), authorName, workstreamKey: 'insurance',
      })
      setNotified(true)
      setNotice('Notification logged on the case timeline.')
    } catch (e) {
      setErr(toUserMessage(e, 'Could not log the notification.'))
    } finally {
      setSaving(false)
    }
  }

  // ── render ──────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading insurance claim...</div>
  }
  if (err && !ctx) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-red-400 flex items-center gap-2"><AlertCircle size={16} /> {err}</p>
        <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={load}><RefreshCw size={13} /> Retry</button>
      </div>
    )
  }

  const statusLabel = hasClaim ? (CLAIM_STATUS_LABEL[claim.decision] || claim.decision || 'Registered') : 'Not registered'
  const statusTone = hasClaim ? (CLAIM_STATUS_TONE[claim.decision] || 'bg-blue-500/15 text-blue-400') : 'bg-[var(--input-bg)] text-[var(--text-secondary)]'

  return (
    <div className="p-6 space-y-6" data-testid="insurance-claim-panel">
      <WorkstreamHeader
        accidentId={accidentId}
        workstreamKey="insurance"
        workstreams={workstreams}
        ownerName={ownerName}
        banner={external ? 'External repair assessment' : null}
      />

      {/* 1 Claim document package */}
      <section ref={packageRef} className="card space-y-4" data-testid="claim-package">
        <SectionTitle n={1} icon={FileCheck2}
          right={<span className={`text-xs font-semibold ${pkg.complete ? 'text-emerald-500' : 'text-amber-500'}`}>{pkg.counterLabel}</span>}>
          Claim document package
        </SectionTitle>
        <div className="h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
          <div className={`h-full ${pkg.complete ? 'bg-emerald-500' : 'bg-amber-500'}`}
            style={{ width: `${pkg.requiredTotal ? Math.round((pkg.requiredReceived / pkg.requiredTotal) * 100) : 0}%` }} />
        </div>
        <ul className="divide-y divide-[var(--input-border)]">
          {pkg.items.map((d) => {
            const missing = d.required && !d.received
            const hot = missing && highlightMissing
            return (
              <li key={d.key} data-testid={`pkg-${d.key}`}
                className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${hot ? 'bg-amber-500/10 ring-1 ring-amber-400' : ''}`}>
                <div className="min-w-0 flex items-center gap-2">
                  {d.received ? <Check size={14} className="text-emerald-500 shrink-0" /> : <AlertCircle size={14} className="text-amber-500 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text-primary)] truncate">{d.label}{d.required ? '' : ' (optional)'}</p>
                    {d.latestAt ? <p className="text-[11px] text-[var(--text-muted)]">Latest {when(d.latestAt)}</p> : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-medium ${d.received ? 'text-emerald-500' : 'text-amber-500'}`}>{d.statusLabel}</span>
                  {missing && elevated ? (
                    requested.has(d.key)
                      ? <span className="text-[11px] text-[var(--text-muted)]">Requested</span>
                      : <button type="button" className="btn-secondary text-[11px] inline-flex items-center gap-1" disabled={saving} onClick={() => requestDoc(d)}>
                          <Send size={11} /> Request {d.label.toLowerCase()}
                        </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
        {!pkg.complete && (
          <p className="text-xs text-amber-500 flex items-center gap-1.5"><AlertTriangle size={13} /> Claim registration unlocks when all required documents are complete.</p>
        )}
        {elevated && (
          <div className="pt-2 border-t border-[var(--input-border)] space-y-2">
            <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => { setUploadOpen((v) => !v); if (!uploadKey) setUploadKey((pkg.missingRequired[0] || pkg.items[0]).key) }}>
              <Upload size={12} /> Upload document
            </button>
            {uploadOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <Field label="Document">
                  <select className="input w-full" aria-label="Document to upload" value={uploadKey} onChange={(e) => setUploadKey(e.target.value)}>
                    {pkg.items.map((d) => <option key={d.key} value={d.key}>{d.label}{d.received ? ' (received)' : ''}</option>)}
                  </select>
                </Field>
                <Field label="File">
                  <input ref={fileRef} type="file" aria-label="Choose file" className="input w-full text-xs" disabled={saving || !uploadKey}
                    onChange={(e) => uploadDoc(e.target.files?.[0])} />
                </Field>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2 Claim registration */}
      <section className="card space-y-4" data-testid="claim-registration">
        <SectionTitle n={2} icon={ShieldCheck}
          right={hasClaim && elevated && !editingReg ? (
            <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => setEditingReg(true)}><Pencil size={12} /> Edit registration</button>
          ) : null}>
          Claim registration
        </SectionTitle>
        {!elevated && <p className="text-xs text-[var(--text-muted)]">Only Admin / Manager / Director can register or update this claim.</p>}

        <form onSubmit={submitRegister} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {showRegForm ? (
            <>
              <Field label="Insurer"><input className="input w-full" aria-label="Insurer" value={regForm.insurer} onChange={(e) => setRegForm((f) => ({ ...f, insurer: e.target.value }))} /></Field>
              <Field label="Policy no."><input className="input w-full" aria-label="Policy no." value={regForm.policyNo} onChange={(e) => setRegForm((f) => ({ ...f, policyNo: e.target.value }))} /></Field>
            </>
          ) : (
            <>
              <ReadOnly label="Insurer" value={claim?.insurer} />
              <ReadOnly label="Policy no." value={claim?.policy_no} />
            </>
          )}
          {hasClaim && editingReg ? (
            <Field label="Claim number" hint="Leave blank if the insurer has not issued one yet.">
              <input className="input w-full" aria-label="Claim number" value={regForm.claimNo} onChange={(e) => setRegForm((f) => ({ ...f, claimNo: e.target.value }))} />
            </Field>
          ) : (
            <ReadOnly label="Claim number" value={hasClaim ? (claim.claim_no || NOT_SET) : 'Auto-generated after registration'} tone={hasClaim && claim.claim_no ? '' : 'text-[var(--text-muted)] italic'} />
          )}
          <ReadOnly label="Liability" value={liab || NOT_SET} />
          <ReadOnly label="GCC liability %" value={gccPct == null ? NOT_SET : `${gccPct}%`} />
          {showRegForm ? (
            <>
              <Field label="Claim amount"><input type="number" min="0" className="input w-full" aria-label="Claim amount" value={regForm.claimAmount} onChange={(e) => setRegForm((f) => ({ ...f, claimAmount: e.target.value }))} /></Field>
              <Field label="Deductible"><input type="number" min="0" className="input w-full" aria-label="Deductible" value={regForm.deductible} onChange={(e) => setRegForm((f) => ({ ...f, deductible: e.target.value }))} /></Field>
            </>
          ) : (
            <>
              <ReadOnly label="Claim amount" value={money(claimAmount)} />
              <ReadOnly label="Deductible" value={money(deductible)} />
            </>
          )}
          <ReadOnly label="Net claimable" value={money(net)} tone="font-semibold" />

          {showRegForm && (
            <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-3 flex-wrap pt-1">
              {!hasClaim ? (
                <>
                  <button type="submit" className="btn-primary text-xs inline-flex items-center gap-1.5" disabled={saving || !canRegister} aria-disabled={!canRegister}>
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Register claim with insurer
                  </button>
                  {!canRegister && <span className="text-[11px] text-[var(--text-muted)]">Enable once all required documents are complete.</span>}
                </>
              ) : (
                <>
                  <button type="submit" className="btn-primary text-xs" disabled={saving}>{saving ? <Loader2 size={13} className="animate-spin" /> : 'Save changes'}</button>
                  <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={() => setEditingReg(false)}>Cancel</button>
                  <span className="text-[11px] text-amber-500">Revising a registered claim. Insurer decisions and settlements are unaffected.</span>
                </>
              )}
            </div>
          )}
        </form>

        {hasClaim && elevated && (
          <div className="border-t border-[var(--input-border)] pt-3">
            <button type="button" className="text-xs font-medium inline-flex items-center gap-1 text-[var(--text-secondary)]" onClick={() => setDecisionOpen((v) => !v)} aria-expanded={decisionOpen}>
              {decisionOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Insurer decision
            </button>
            {decisionOpen && (
              <div className="mt-3 space-y-4">
                {!pkg.complete && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 space-y-1.5">
                    <p className="text-xs text-amber-500">{pkg.counterLabel} received. Insurers usually decide once documents are complete.</p>
                    <label className="flex items-center gap-1.5 text-[11px] text-amber-500">
                      <input type="checkbox" checked={docsOverride} onChange={(e) => setDocsOverride(e.target.checked)} /> Record the decision anyway (documents incomplete)
                    </label>
                  </div>
                )}
                <form onSubmit={submitDecision} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <Field label="Decision">
                    <select className="input w-full" value={decisionForm.decision} onChange={(e) => setDecisionForm((f) => ({ ...f, decision: e.target.value }))}>
                      <option value="">Select...</option>
                      {CLAIM_DECISIONS.map((d) => <option key={d} value={d}>{DECISION_ACTION_LABEL[d] || d}</option>)}
                    </select>
                  </Field>
                  {(decisionForm.decision === 'fully_approved' || decisionForm.decision === 'partially_approved') && (
                    <Field label="Approved amount">
                      <input type="number" min="0" className="input w-full" value={decisionForm.approvedAmount} onChange={(e) => setDecisionForm((f) => ({ ...f, approvedAmount: e.target.value }))} />
                    </Field>
                  )}
                  <Field label="Reason / remarks">
                    <input className="input w-full" value={decisionForm.reason} onChange={(e) => setDecisionForm((f) => ({ ...f, reason: e.target.value }))} />
                  </Field>
                  <button type="submit" className="btn-secondary text-xs" disabled={saving || !decisionForm.decision || (!pkg.complete && !docsOverride)}>
                    {saving ? <Loader2 size={13} className="animate-spin" /> : 'Record decision'}
                  </button>
                </form>
                <div className="border-t border-[var(--input-border)] pt-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-2"><Banknote size={14} /> Settlement</p>
                  <form onSubmit={submitSettlement} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                    <Field label="Settled amount"><input type="number" min="0" className="input w-full" value={settleForm.settledAmount} onChange={(e) => setSettleForm((f) => ({ ...f, settledAmount: e.target.value }))} /></Field>
                    <Field label="Settled on"><input type="date" className="input w-full" value={settleForm.settledAt} onChange={(e) => setSettleForm((f) => ({ ...f, settledAt: e.target.value }))} /></Field>
                    <Field label="Reference"><input className="input w-full" value={settleForm.reference} onChange={(e) => setSettleForm((f) => ({ ...f, reference: e.target.value }))} /></Field>
                    <button type="submit" className="btn-secondary text-xs" disabled={saving || settleForm.settledAmount === '' || !settleForm.settledAt}>
                      {saving ? <Loader2 size={13} className="animate-spin" /> : 'Record settlement'}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 3 Payment and recovery */}
      <section className="card space-y-4" data-testid="claim-payment">
        <SectionTitle n={3} icon={Banknote}
          right={<span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusTone}`} data-testid="claim-status">{statusLabel}</span>}>
          Payment and recovery
        </SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <ReadOnly label="Approved amount" value={money(claim?.approved_amount)} />
          <ReadOnly label="Recovered amount" value={money(recovered)} />
          <ReadOnly label="Outstanding" value={money(owed)} tone="font-semibold" />
          <ReadOnly label="Recovery source" value={latestRecovery ? (RECOVERY_SOURCE_LABEL[latestRecovery.source] || latestRecovery.source) : NOT_SET} />
          <ReadOnly label="Last updated" value={when(lastUpdatedAt(claim, ctx?.recoveries || []))} />
        </div>
        {(ctx?.recoveries || []).length > 0 && (
          <ul className="space-y-1">
            {(ctx.recoveries).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 text-xs rounded-md border border-[var(--input-border)] px-3 py-1.5">
                <span className="text-[var(--text-primary)]">{RECOVERY_SOURCE_LABEL[r.source] || r.source}{r.reference ? ` (ref ${r.reference})` : ''}</span>
                <span className="text-[var(--text-secondary)]">{money(r.amount)} | {RECOVERY_STATUS_LABEL[r.status] || r.status} | {when(r.updated_at || r.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {elevated && (
          <div className="space-y-3">
            <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => setRecoveryOpen((v) => !v)}>
              <Banknote size={12} /> Update recovery amount
            </button>
            {recoveryOpen && (
              <form onSubmit={submitRecovery} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <Field label="Source">
                  <select className="input w-full" value={recoveryForm.source} onChange={(e) => setRecoveryForm((f) => ({ ...f, source: e.target.value }))}>
                    {RECOVERY_SOURCES.map((s) => <option key={s} value={s}>{RECOVERY_SOURCE_LABEL[s]}</option>)}
                  </select>
                </Field>
                <Field label="Amount"><input type="number" min="0" className="input w-full" value={recoveryForm.amount} onChange={(e) => setRecoveryForm((f) => ({ ...f, amount: e.target.value }))} /></Field>
                <Field label="Status">
                  <select className="input w-full" value={recoveryForm.status} onChange={(e) => setRecoveryForm((f) => ({ ...f, status: e.target.value }))}>
                    {RECOVERY_STATUSES.map((s) => <option key={s} value={s}>{RECOVERY_STATUS_LABEL[s]}</option>)}
                  </select>
                </Field>
                {recoveryForm.status === 'recovered' && (
                  <Field label="Recovered on"><input type="date" className="input w-full" value={recoveryForm.recoveredAt} onChange={(e) => setRecoveryForm((f) => ({ ...f, recoveredAt: e.target.value }))} /></Field>
                )}
                <div>
                  <button type="submit" className="btn-primary text-xs" disabled={saving || (recoveryForm.status === 'recovered' && !recoveryForm.recoveredAt)}>
                    {saving ? <Loader2 size={13} className="animate-spin" /> : 'Add recovery'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
        <p className="text-[11px] text-[var(--text-muted)] flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" /> Recovery amounts remain editable after operational case closure. Every adjustment is timestamped and audited.</p>
      </section>

      {/* 4 After registration notify */}
      <section className="card space-y-3" data-testid="claim-notify">
        <SectionTitle n={4} icon={Megaphone}>After registration notify</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {people.map((p) => (
            <span key={p.key} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--input-border)] px-3 py-1 text-xs text-[var(--text-primary)]" data-testid={`notify-${p.key}`}>
              {p.display}
              <span className="text-[var(--text-muted)]">{p.visibilityOnly ? '(visibility)' : p.name ? p.label : ''}</span>
            </span>
          ))}
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">Notification includes claim number, document status, claim amount, and next action.</p>
        {elevated && (
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" disabled={saving || !hasClaim || notified} onClick={notifyAfterRegistration}>
            {notified ? <Check size={12} /> : <Megaphone size={12} />} {notified ? 'Notification logged' : 'Log notification now'}
          </button>
        )}
        {!hasClaim && <p className="text-[11px] text-[var(--text-muted)]">Available once the claim is registered.</p>}
      </section>

      {/* Actions + footer */}
      <div className="flex items-center gap-3 flex-wrap">
        {elevated && !hasClaim && (
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={saveDraft} disabled={saving}>
            <Save size={12} /> Save claim draft
          </button>
        )}
        {!pkg.complete && (
          <button type="button" className="btn-primary text-xs inline-flex items-center gap-1.5" onClick={completeDocuments}>
            <ListChecks size={12} /> Complete documents
          </button>
        )}
        {draftSavedAt && !hasClaim && <span className="text-[11px] text-[var(--text-muted)]">Draft saved on this device {when(draftSavedAt)}</span>}
      </div>
      {ccOwner ? (
        <p className="text-[11px] text-[var(--text-muted)]" data-testid="cc-footer">{ccOwner} is monitoring SLA and missing documents.</p>
      ) : null}

      {notice && <p className="text-emerald-500 text-xs flex items-center gap-1.5"><Check size={12} /> {notice}</p>}
      {err && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertCircle size={12} /> {err}</p>}
    </div>
  )
}
