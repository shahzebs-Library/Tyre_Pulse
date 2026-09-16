/**
 * LiabilityPaymentPanel - the "Responsibility and payment" case tab, rebuilt
 * field for field against the owner's mock screen M3 (2026-09-16):
 *
 *   Workstream header  Owner: <fleet owner> | Insurance review: <insurance owner>
 *   1  Who was at fault?     5 tiles (FAULT_TILES) + fault status / GCC % / other-party %
 *   2  Who will pay?         6 tiles (PAYER_TILES) + fault party / payer / responsible company / recovery required
 *   3  Third-party and authority details   Value | Recorded by | Verification (AUTHORITY_ROWS)
 *   4  Responsibility documents             Document | Status | Uploader | Time | Verification, "N of M required"
 *   Warning when Taqdeer is required and its document is missing
 *   Save responsibility details | Request missing Taqdeer document | Continue to damage mapping
 *
 * Data: accident_liability_assessments (+ the 2026-09-16 parity columns:
 * payer, responsible_company, recovery_required, third_party_*, taqdeer_required,
 * field_audit) via accidentLiability.js; police / Najm / Taqdeer through the
 * EXISTING accident_authority_reports service; documents through accident_evidence
 * keyed on requirement_key (accidentEvidence.js). Every vocabulary is imported
 * from accidentCaseVocab.js - nothing is re-declared here.
 *
 * SHIP-BEFORE-MIGRATE: the parity migration is authored but not applied. The
 * service falls back to the base column list and reports parityProvisioned=false;
 * this panel then disables the parity-backed controls and says so in one honest
 * note instead of failing. The existing approve/lock + change-reason behaviour
 * and the safety-assessment fields are kept in a collapsible block.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Scale, ShieldCheck, Banknote, AlertCircle, Loader2, RefreshCw, Lock, FileWarning,
  ChevronDown, ChevronRight, Paperclip, Upload, Check, X, FileText, ArrowRight, Send, Info,
} from 'lucide-react'
import {
  getLiabilityAssessmentWithMeta, saveLiabilityAssessment, approveLiabilityAssessment,
  listAuthorityReports, saveAuthorityReport, saveFieldAudit, mergeFieldAudit, stripParityFields,
} from '../../lib/api/accidentLiability'
import { listEvidence, addEvidence, verifyEvidence } from '../../lib/api/accidentEvidence'
import { logCommunication } from '../../lib/api/accidentCommunications'
import { listWorkstreams } from '../../lib/api/accidentCase'
import { listProfiles } from '../../lib/api/users'
import { isMissingColumn } from '../../lib/api/_client'
import { useAuth } from '../../contexts/AuthContext'
import {
  FAULT_TILES, faultStatusFor, PAYER_TILES, payerLabel, recoveryRequiredFor,
  AUTHORITY_ROWS, VERIFICATION_STATES,
} from '../../lib/accidentCaseVocab'
import {
  summarizeResponsibilityDocs, showTaqdeerWarning, TAQDEER_WARNING, VERIFICATION_LABEL,
} from '../../lib/responsibilityDocs'
import WorkstreamHeader from './WorkstreamHeader'
import NotifyRecipientsPanel from './NotifyRecipientsPanel'
import { safeHref } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'

const NOT_SET = 'Not set'
const NOT_PROVISIONED_NOTE =
  'Payer, responsible company, third-party details, Taqdeer flag and per-field verification are not provisioned in the database yet (parity migration pending). Fault, liability split, safety fields and authority reports still save.'

const PREVENTABLE = [
  { value: 'preventable', label: 'Preventable' },
  { value: 'non_preventable', label: 'Non-preventable' },
  { value: 'under_review', label: 'Under review' },
]
const SAFETY_FIELDS = {
  root_cause: 'Root cause', immediate_cause: 'Immediate cause', contributing_factors: 'Contributing factors',
  driver_violation: 'Driver violation', unsafe_act: 'Unsafe act', unsafe_condition: 'Unsafe condition',
  weather_condition: 'Weather condition', road_condition: 'Road condition',
}

const REPORT_STATUS = [
  { value: 'available', label: 'Received' },
  { value: 'pending', label: 'Pending' },
  { value: 'none', label: 'Missing' },
]
const REPORT_STATUS_LABEL = Object.fromEntries(REPORT_STATUS.map((s) => [s.value, s.label]))

/** How each AUTHORITY_ROWS key is backed. */
const AUTH_SOURCE = {
  third_party_plate:  { kind: 'text' },
  third_party_driver: { kind: 'text' },
  third_party_phone:  { kind: 'text' },
  police_report_no:   { kind: 'report_no', authority: 'police' },
  najm_report:        { kind: 'report_status', authority: 'najm' },
  taqdeer_required:   { kind: 'bool' },
  taqdeer_no:         { kind: 'report_no', authority: 'taqdeer' },
}
/** Draft fields whose change stamps "recorded by" on save. */
const AUDITED_DRAFT_FIELDS = [
  'third_party_plate', 'third_party_driver', 'third_party_phone', 'taqdeer_required',
  'payer', 'responsible_company', 'recovery_required',
]
const FAULT_STATUS_TONE = {
  Faulty: 'text-red-400', 'Non-faulty': 'text-green-400', 'Under review': 'text-blue-300', 'Not applicable': 'text-[var(--text-muted)]',
}
const VERIFICATION_TONE = {
  verified: 'text-green-400', pending: 'text-amber-400', missing: 'text-red-400', rejected: 'text-red-400',
}

function fmtTime(iso) {
  if (!iso) return NOT_SET
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? NOT_SET : d.toLocaleString()
}
function pct(v) {
  return v == null || v === '' ? NOT_SET : `${v}%`
}
function boolLabel(v) {
  return v === true ? 'Yes' : v === false ? 'No' : NOT_SET
}

function Tile({ active, disabled, onClick, children, tone = 'green' }) {
  const on = tone === 'blue' ? 'border-blue-500 bg-blue-900/20 text-blue-300' : 'border-green-500 bg-green-900/20 text-green-300'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={!!active}
      className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-2 disabled:opacity-60 ${
        active ? on : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
      }`}
    >
      {active && <ShieldCheck size={14} />} {children}
    </button>
  )
}

function Derived({ label, children }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <div className="text-sm font-semibold text-[var(--text-primary)]">{children}</div>
    </div>
  )
}

function Field({ label, value, onChange, disabled, placeholder }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input w-full" value={value ?? ''} onChange={(e) => onChange(e.target.value)}
        disabled={disabled} placeholder={placeholder} maxLength={500} />
    </div>
  )
}

export default function LiabilityPaymentPanel({ accidentId, elevated, acc, onChanged, workstreams, onNavigateTab }) {
  const { profile } = useAuth() || {}
  const me = profile?.full_name || profile?.username || null

  const [assessment, setAssessment] = useState(null)
  const [draft, setDraft] = useState(null)
  const [reports, setReports] = useState([])
  const [evidence, setEvidence] = useState([])
  const [wsRows, setWsRows] = useState(Array.isArray(workstreams) ? workstreams : [])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [parityProvisioned, setParityProvisioned] = useState(true)
  const [changeReason, setChangeReason] = useState('')
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [uploadingKey, setUploadingKey] = useState('')
  const [requesting, setRequesting] = useState(false)
  const fileInputs = useRef({})

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [meta, r, ev, ws, ppl] = await Promise.all([
        getLiabilityAssessmentWithMeta(accidentId),
        listAuthorityReports(accidentId),
        listEvidence(accidentId, { workstreamKey: 'liability' }).catch(() => []),
        Array.isArray(workstreams) ? Promise.resolve(workstreams) : listWorkstreams(accidentId).catch(() => []),
        listProfiles().catch(() => []),
      ])
      const row = { ...(meta.assessment || {}) }
      if (!row.id && acc?.gcc_liability_ratio != null && row.our_liability_pct == null) {
        row.our_liability_pct = acc.gcc_liability_ratio
      }
      setAssessment(row); setDraft(row); setReports(r || []); setEvidence(ev || [])
      setWsRows(Array.isArray(ws) ? ws : []); setUsers(Array.isArray(ppl) ? ppl : [])
      setParityProvisioned(meta.parityProvisioned !== false)
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load responsibility details.'))
    } finally {
      setLoading(false)
    }
  }, [accidentId, acc?.gcc_liability_ratio, workstreams])

  useEffect(() => { load() }, [load])

  const usersById = useMemo(() => {
    const m = new Map()
    for (const u of users) if (u?.id) m.set(u.id, u)
    return m
  }, [users])

  const nameForId = useCallback((id) => {
    const u = id ? usersById.get(id) : null
    return u?.full_name || u?.username || ''
  }, [usersById])

  const ownerLine = useMemo(() => {
    const ownerOf = (key) => {
      const ws = (wsRows || []).find((w) => (w.workstream_key || w.workstream) === key)
      return (ws && (nameForId(ws.owner_id) || ws.owner_role || ws.team)) || NOT_SET
    }
    return `${ownerOf('liability')} | Insurance review: ${ownerOf('insurance')}`
  }, [wsRows, nameForId])

  const locked = !!(assessment?.approved && assessment?.locked)
  const canEdit = !!elevated && !locked
  const canEditParity = canEdit && parityProvisioned
  const audit = draft?.field_audit && typeof draft.field_audit === 'object' ? draft.field_audit : {}
  const faultTile = FAULT_TILES.find((t) => t.key === draft?.liability_type) || null
  const faultStatus = faultStatusFor(draft?.liability_type, draft?.our_liability_pct) || NOT_SET
  const autoRecovery = recoveryRequiredFor(draft?.payer)
  const recovery = draft?.recovery_required ?? (draft?.payer ? autoRecovery : null)
  const docSummary = useMemo(() => summarizeResponsibilityDocs(evidence, { profilesById: usersById }), [evidence, usersById])
  const taqdeerWarning = showTaqdeerWarning(draft?.taqdeer_required, docSummary)
  const reportFor = (authority) => (reports || []).find((r) => r.authority_type === authority) || {}

  function markNotProvisioned() {
    setParityProvisioned(false)
    setNotice(NOT_PROVISIONED_NOTE)
  }

  function pickFault(tile) {
    setDraft((d) => ({
      ...d,
      liability_type: tile.key,
      our_liability_pct: tile.ourPct == null ? null : tile.ourPct,
      third_party_pct: tile.otherPct == null ? null : tile.otherPct,
    }))
  }

  async function save() {
    if (saving || !draft) return
    setSaving(true); setErr(''); setNotice('')
    try {
      let fieldAudit = audit
      const now = new Date().toISOString()
      for (const k of AUDITED_DRAFT_FIELDS) {
        if ((draft[k] ?? null) !== (assessment?.[k] ?? null)) {
          fieldAudit = mergeFieldAudit(fieldAudit, k, { recorded_by: me || null, recorded_at: now })
        }
      }
      let patch = { ...draft, field_audit: fieldAudit, change_reason: locked ? changeReason : undefined }
      for (const k of ['id', 'accident_id', 'created_at', 'updated_at', 'created_by', '_parityProvisioned']) delete patch[k]
      if (!parityProvisioned) patch = stripParityFields(patch)
      const saved = await saveLiabilityAssessment(accidentId, patch, { existingId: assessment?.id, isLocked: locked })
      if (saved?._parityProvisioned === false) markNotProvisioned()
      const clean = { ...saved }; delete clean._parityProvisioned
      setAssessment(clean); setDraft(clean); setChangeReason('')
      onChanged?.()
    } catch (e) {
      if (isMissingColumn(e)) markNotProvisioned()
      setErr(toUserMessage(e, 'Could not save the responsibility assessment.'))
    } finally {
      setSaving(false)
    }
  }

  async function approve() {
    if (!assessment?.id || saving) return
    setSaving(true); setErr('')
    try {
      const saved = await approveLiabilityAssessment(assessment.id, me)
      setAssessment(saved); setDraft(saved)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not approve the assessment.'))
    } finally {
      setSaving(false)
    }
  }

  /** Persist a merged field_audit map (verification / recorded-by stamps). */
  async function persistAudit(nextAudit) {
    if (!parityProvisioned) { markNotProvisioned(); return }
    try {
      const saved = await saveFieldAudit(accidentId, { existingId: assessment?.id, fieldAudit: nextAudit })
      setAssessment((a) => ({ ...(a || {}), ...saved }))
      setDraft((d) => ({ ...(d || {}), id: saved.id, field_audit: saved.field_audit }))
    } catch (e) {
      if (isMissingColumn(e)) { markNotProvisioned(); return }
      setErr(toUserMessage(e, 'Could not save the verification.'))
    }
  }

  async function setVerification(fieldKey, state) {
    if (!VERIFICATION_STATES.includes(state)) return
    const entry = state === 'verified'
      ? { verification: state, verified_by: me || null, verified_at: new Date().toISOString() }
      : { verification: state, verified_by: null, verified_at: null }
    await persistAudit(mergeFieldAudit(audit, fieldKey, entry))
  }

  async function saveReport(fieldKey, authority, patch) {
    setSaving(true); setErr('')
    try {
      const saved = await saveAuthorityReport(accidentId, authority, patch)
      setReports((prev) => [saved, ...(prev || []).filter((r) => r.authority_type !== authority)])
      if (parityProvisioned) {
        await persistAudit(mergeFieldAudit(audit, fieldKey, { recorded_by: me || null, recorded_at: new Date().toISOString() }))
      }
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the authority report.'))
    } finally {
      setSaving(false)
    }
  }

  async function onPickDoc(docKey, e) {
    const file = e.target.files?.[0]
    if (fileInputs.current[docKey]) fileInputs.current[docKey].value = ''
    if (!file) return
    setUploadingKey(docKey); setErr('')
    try {
      const kind = file.type?.startsWith('image/') ? 'photo' : (file.type?.startsWith('video/') ? 'video' : 'document')
      const saved = await addEvidence(accidentId, file, { kind, workstreamKey: 'liability', requirementKey: docKey })
      setEvidence((prev) => [saved, ...(prev || [])])
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not attach that file.'))
    } finally {
      setUploadingKey('')
    }
  }

  async function verifyDoc(row, decision) {
    if (!row?.evidence?.id) return
    setErr('')
    try {
      const saved = await verifyEvidence(accidentId, row.evidence.id, decision)
      setEvidence((prev) => (prev || []).map((r) => (r.id === row.evidence.id ? saved : r)))
    } catch (e) {
      setErr(toUserMessage(e, 'Could not update that document.'))
    }
  }

  async function requestTaqdeer() {
    if (requesting) return
    setRequesting(true); setErr(''); setNotice('')
    try {
      await logCommunication(accidentId, {
        channel: 'in_app',
        direction: 'internal',
        subject: 'Taqdeer assessment document requested',
        body: 'The Taqdeer assessment document is required for payer confirmation and is not attached to this case yet.',
        authorName: me,
        workstreamKey: 'liability',
      })
      setNotice('Request logged in the case communications. No message was sent automatically.')
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not log the Taqdeer request.'))
    } finally {
      setRequesting(false)
    }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading responsibility details...</div>
  }
  if (err && !draft) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-red-400 flex items-center gap-2"><AlertCircle size={16} /> {err}</p>
        <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={load}><RefreshCw size={13} /> Retry</button>
      </div>
    )
  }

  // ── Section 3 row renderers ────────────────────────────────────────────────
  function authorityValue(row) {
    const src = AUTH_SOURCE[row.key]
    if (src.kind === 'text') {
      return canEditParity ? (
        <input className="input text-xs w-full" aria-label={row.label} value={draft?.[row.key] ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))} maxLength={200} />
      ) : <span>{draft?.[row.key] || NOT_SET}</span>
    }
    if (src.kind === 'bool') {
      return canEditParity ? (
        <div className="flex gap-1.5">
          {[true, false].map((v) => (
            <button key={String(v)} type="button" aria-pressed={draft?.taqdeer_required === v}
              onClick={() => setDraft((d) => ({ ...d, taqdeer_required: v }))}
              className={`px-2 py-1 rounded border text-xs ${draft?.taqdeer_required === v ? 'border-amber-500 bg-amber-900/20 text-amber-300' : 'border-[var(--input-border)] text-[var(--text-secondary)]'}`}>
              {v ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      ) : <span>{boolLabel(draft?.taqdeer_required)}</span>
    }
    const rep = reportFor(src.authority)
    if (src.kind === 'report_status') {
      return elevated ? (
        <select className="input text-xs" aria-label={row.label} value={rep.report_status || ''}
          onChange={(e) => e.target.value && saveReport(row.key, src.authority, { report_status: e.target.value })}>
          <option value="">Status...</option>
          {REPORT_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      ) : <span>{REPORT_STATUS_LABEL[rep.report_status] || NOT_SET}</span>
    }
    return elevated ? (
      <input className="input text-xs w-full" aria-label={row.label} placeholder="Report no." defaultValue={rep.report_no || ''}
        onBlur={(e) => e.target.value !== (rep.report_no || '') && saveReport(row.key, src.authority, { report_no: e.target.value || null })} />
    ) : <span>{rep.report_no || NOT_SET}</span>
  }

  function recordedBy(row) {
    const a = audit[row.key] || {}
    let name = a.recorded_by || ''
    if (!name) {
      const src = AUTH_SOURCE[row.key]
      if (src.authority) name = nameForId(reportFor(src.authority).created_by)
    }
    const at = a.recorded_at || (AUTH_SOURCE[row.key].authority ? reportFor(AUTH_SOURCE[row.key].authority).updated_at : null)
    return (
      <div>
        <p className="text-xs text-[var(--text-primary)]">{name || NOT_SET}</p>
        {at && <p className="text-[10px] text-[var(--text-muted)]">{fmtTime(at)}</p>}
      </div>
    )
  }

  function verificationCell(row) {
    const state = audit[row.key]?.verification || ''
    const label = VERIFICATION_LABEL[state] || NOT_SET
    if (!elevated || !parityProvisioned) return <span className={`text-xs ${VERIFICATION_TONE[state] || 'text-[var(--text-muted)]'}`}>{label}</span>
    return (
      <select className="input text-xs" aria-label={`Verification for ${row.label}`} value={state}
        onChange={(e) => e.target.value && setVerification(row.key, e.target.value)}>
        <option value="">{NOT_SET}</option>
        {VERIFICATION_STATES.map((s) => <option key={s} value={s}>{VERIFICATION_LABEL[s]}</option>)}
      </select>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <WorkstreamHeader accidentId={accidentId} workstreamKey="liability" workstreams={wsRows} ownerName={ownerLine} />

      {!parityProvisioned && (
        <p className="text-xs text-amber-300 flex items-start gap-1.5 rounded-lg border border-amber-700/40 bg-amber-900/10 px-3 py-2" data-testid="parity-note">
          <Info size={13} className="shrink-0 mt-0.5" /> {NOT_PROVISIONED_NOTE}
        </p>
      )}

      {/* 1 Who was at fault? */}
      <section className="card space-y-4">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Scale size={16} /> 1. Who was at fault?</h3>
        <div className="flex flex-wrap gap-2">
          {FAULT_TILES.map((t) => (
            <Tile key={t.key} active={draft?.liability_type === t.key} disabled={!canEdit} onClick={() => pickFault(t)}>{t.label}</Tile>
          ))}
          {!elevated && <span className="text-xs text-[var(--text-muted)] self-center">Read-only</span>}
        </div>
        {draft?.liability_type && !faultTile && (
          <p className="text-xs text-[var(--text-muted)]">Stored fault type: {draft.liability_type}. Pick a tile to replace it.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[var(--input-border)]">
          <Derived label="Fault status"><span className={FAULT_STATUS_TONE[faultStatus] || 'text-[var(--text-muted)]'}>{faultStatus}</span></Derived>
          <Derived label="GCC liability %">
            {canEdit && draft?.liability_type === 'shared' ? (
              <input type="number" min="0" max="100" aria-label="GCC liability %" className="input w-24 text-sm" value={draft?.our_liability_pct ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, our_liability_pct: e.target.value === '' ? null : Number(e.target.value) }))} />
            ) : pct(draft?.our_liability_pct)}
          </Derived>
          <Derived label="Other-party liability %">
            {canEdit && draft?.liability_type === 'shared' ? (
              <input type="number" min="0" max="100" aria-label="Other-party liability %" className="input w-24 text-sm" value={draft?.third_party_pct ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, third_party_pct: e.target.value === '' ? null : Number(e.target.value) }))} />
            ) : pct(draft?.third_party_pct)}
          </Derived>
        </div>
        {!locked ? (
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><FileWarning size={12} /> Provisional until authority/insurer confirmation.</p>
        ) : (
          <p className="text-xs text-green-400 flex items-center gap-1.5"><Lock size={12} /> Approved and locked. A further edit requires a change reason.</p>
        )}

        <div className="border-t border-[var(--input-border)] pt-3">
          <button type="button" className="text-xs font-semibold text-[var(--text-secondary)] inline-flex items-center gap-1" onClick={() => setSafetyOpen((o) => !o)} aria-expanded={safetyOpen}>
            {safetyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Safety assessment
          </button>
          {safetyOpen && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="label">Preventable</label>
                <div className="flex gap-2">
                  {PREVENTABLE.map((p) => (
                    <button key={p.value} type="button" disabled={!canEdit} onClick={() => setDraft((d) => ({ ...d, preventable: p.value }))}
                      className={`px-2.5 py-1.5 rounded border text-xs disabled:opacity-60 ${draft?.preventable === p.value ? 'border-amber-500 bg-amber-900/20 text-amber-300' : 'border-[var(--input-border)] text-[var(--text-secondary)]'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(SAFETY_FIELDS).map(([key, label]) => (
                  <Field key={key} label={label} value={draft?.[key]} disabled={!canEdit} onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))} />
                ))}
              </div>
              {locked && elevated && (
                <Field label="Change reason (required to revise a locked assessment)" value={changeReason} onChange={setChangeReason} />
              )}
              {elevated && assessment?.id && !assessment.approved && (
                <button className="btn-secondary text-xs" disabled={saving} onClick={approve}>Approve and lock</button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 2 Who will pay? */}
      <section className="card space-y-4">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Banknote size={16} /> 2. Who will pay?</h3>
        <div className="flex flex-wrap gap-2">
          {PAYER_TILES.map((p) => (
            <Tile key={p.key} tone="blue" active={draft?.payer === p.key} disabled={!canEditParity}
              onClick={() => setDraft((d) => ({ ...d, payer: p.key }))}>{p.label}</Tile>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2 border-t border-[var(--input-border)]">
          <Derived label="Fault party">{faultTile?.label || NOT_SET}</Derived>
          <Derived label="Payer">{payerLabel(draft?.payer) || NOT_SET}</Derived>
          <Derived label="Responsible company">
            {canEditParity ? (
              <input className="input text-sm w-full" aria-label="Responsible company" value={draft?.responsible_company ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, responsible_company: e.target.value }))} maxLength={200} />
            ) : (draft?.responsible_company || NOT_SET)}
          </Derived>
          <Derived label="Recovery required">
            {canEditParity ? (
              <div className="flex gap-1.5 items-center">
                {[true, false].map((v) => (
                  <button key={String(v)} type="button" aria-pressed={recovery === v}
                    onClick={() => setDraft((d) => ({ ...d, recovery_required: v }))}
                    className={`px-2 py-1 rounded border text-xs ${recovery === v ? 'border-blue-500 bg-blue-900/20 text-blue-300' : 'border-[var(--input-border)] text-[var(--text-secondary)]'}`}>
                    {v ? 'Yes' : 'No'}
                  </button>
                ))}
                {draft?.recovery_required != null && draft?.payer && (
                  <button type="button" className="text-[10px] text-[var(--text-muted)] underline" onClick={() => setDraft((d) => ({ ...d, recovery_required: null }))}>Use auto</button>
                )}
              </div>
            ) : boolLabel(recovery)}
            {draft?.recovery_required == null && draft?.payer && (
              <p className="text-[10px] font-normal text-[var(--text-muted)]">Derived from payer</p>
            )}
          </Derived>
        </div>
      </section>

      {/* 3 Third-party and authority details */}
      <section className="card space-y-3">
        <h3 className="font-semibold text-[var(--text-primary)]">3. Third-party and authority details</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="py-1.5 pr-3 font-medium">Field</th>
                <th className="py-1.5 pr-3 font-medium">Value</th>
                <th className="py-1.5 pr-3 font-medium">Recorded by</th>
                <th className="py-1.5 font-medium">Verification</th>
              </tr>
            </thead>
            <tbody>
              {AUTHORITY_ROWS.map((row) => (
                <tr key={row.key} className="border-t border-[var(--input-border)] align-top">
                  <td className="py-2 pr-3 font-semibold text-[var(--text-primary)] whitespace-nowrap">{row.label}</td>
                  <td className="py-2 pr-3 text-[var(--text-primary)] min-w-[10rem]">{authorityValue(row)}</td>
                  <td className="py-2 pr-3">{recordedBy(row)}</td>
                  <td className="py-2">{verificationCell(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4 Responsibility documents */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Paperclip size={16} /> 4. Responsibility documents</h3>
          <span className="text-xs text-[var(--text-secondary)]" data-testid="docs-counter">{docSummary.counterLabel}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="py-1.5 pr-3 font-medium">Document</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium">Uploader</th>
                <th className="py-1.5 pr-3 font-medium">Time</th>
                <th className="py-1.5 pr-3 font-medium">Verification</th>
                <th className="py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {docSummary.rows.map((row) => {
                const href = row.evidence ? safeHref(row.evidence.storage_ref) : null
                return (
                  <tr key={row.key} className="border-t border-[var(--input-border)] align-top">
                    <td className="py-2 pr-3 font-semibold text-[var(--text-primary)]">
                      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{row.label}</a> : row.label}
                      {!row.required && <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">(Optional)</span>}
                    </td>
                    <td className={`py-2 pr-3 ${row.status === 'attached' ? 'text-green-400' : row.required ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                      {row.status === 'attached' ? (row.count > 1 ? `Attached (${row.count})` : 'Attached') : 'Missing'}
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-primary)]">{row.uploader}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{fmtTime(row.time)}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center gap-2 ${VERIFICATION_TONE[row.verification] || 'text-[var(--text-muted)]'}`}>
                        {VERIFICATION_LABEL[row.verification] || NOT_SET}
                        {elevated && row.evidence && row.verification !== 'verified' && (
                          <button type="button" title={`Verify ${row.label}`} className="text-green-400 hover:text-green-300" onClick={() => verifyDoc(row, 'verified')}><Check size={13} /></button>
                        )}
                        {elevated && row.evidence && row.verification !== 'rejected' && (
                          <button type="button" title={`Reject ${row.label}`} className="text-red-400 hover:text-red-300" onClick={() => verifyDoc(row, 'rejected')}><X size={13} /></button>
                        )}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      {elevated && (
                        <>
                          <input ref={(el) => { fileInputs.current[row.key] = el }} type="file" className="hidden" aria-label={`Attach ${row.label}`} onChange={(e) => onPickDoc(row.key, e)} />
                          <button type="button" className="btn-secondary text-[11px] inline-flex items-center gap-1" disabled={!!uploadingKey}
                            onClick={() => fileInputs.current[row.key]?.click()}>
                            {uploadingKey === row.key ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} {row.evidence ? 'Replace' : 'Attach'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {docSummary.missingRequired.length > 0 && (
          <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5"><FileText size={11} /> Missing: {docSummary.missingRequired.join(', ')}</p>
        )}
      </section>

      {taqdeerWarning && (
        <p className="text-sm text-amber-300 flex items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-900/10 px-3 py-2" role="status" data-testid="taqdeer-warning">
          <AlertCircle size={15} /> {TAQDEER_WARNING}
        </p>
      )}

      {err && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertCircle size={12} /> {err}</p>}
      {notice && <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5"><Info size={12} /> {notice}</p>}

      <div className="flex flex-wrap gap-2">
        {elevated && (
          <button className="btn-primary text-xs" disabled={saving || (locked && !changeReason.trim())} onClick={save}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : 'Save responsibility details'}
          </button>
        )}
        {elevated && (
          <button className="btn-secondary text-xs inline-flex items-center gap-1.5" disabled={requesting} onClick={requestTaqdeer}
            title="Logs an in-app request in the case communications. Nothing is emailed automatically.">
            {requesting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Request missing Taqdeer document
          </button>
        )}
        {typeof onNavigateTab === 'function' && (
          <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => onNavigateTab('damage_map')}>
            Continue to damage mapping <ArrowRight size={13} />
          </button>
        )}
      </div>

      <section className="card">
        <NotifyRecipientsPanel accidentId={accidentId} workstreamKey="liability" title="Notify recipients" subject="Responsibility and payment update" />
      </section>
    </div>
  )
}
