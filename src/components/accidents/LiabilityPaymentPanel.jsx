/**
 * LiabilityPaymentPanel — the "Responsibility and payment" case tab: who was at
 * fault, the GCC liability split, the root-cause fields, and the police / Najm /
 * Taqdeer authority-report checklist. Backed by accidentLiability.js
 * (accident_liability_assessments + accident_authority_reports), verified live
 * against project jhssdmeruxtrlqnwfksc before this panel was written.
 *
 * Deliberately does NOT duplicate "who pays" / "recovery required" - those
 * already live on the accidents row and are edited on the existing Claim &
 * Recovery tab (payer / recovery_status, PAYER_OPTS in accidentVocab.js). This
 * panel links to that tab rather than a second, differently-worded payer
 * control. Third-party plate/driver/phone have no backing column anywhere in
 * the schema yet - honestly omitted rather than invented; flagged in the
 * accident-case plan as an open item.
 *
 * Honest states: loading, not-provisioned (accident_liability_assessments not
 * migrated for this org), error + Retry, and a read-only view for a non-elevated
 * user. A LOCKED (approved) assessment requires a change reason to revise, so a
 * closed-out finding is never silently overwritten.
 */
import { useCallback, useEffect, useState } from 'react'
import { Scale, ShieldCheck, Banknote, AlertCircle, Loader2, RefreshCw, Lock, FileWarning } from 'lucide-react'
import {
  getLiabilityAssessment, saveLiabilityAssessment, approveLiabilityAssessment,
  listAuthorityReports, saveAuthorityReport,
} from '../../lib/api/accidentLiability'
import { setAccidentPayer } from '../../lib/api/accidentWorkflow'
import { PAYER_OPTS, canonPayer } from '../../lib/accidentVocab'
import NotifyRecipientsPanel from './NotifyRecipientsPanel'
import EvidenceTable from './EvidenceTable'
import { toUserMessage } from '../../lib/safeError'

const LIABILITY_TYPES = [
  { value: 'our_driver_full', label: 'Our driver / GCC' },
  { value: 'third_party_full', label: 'Other party' },
  { value: 'shared', label: 'Shared fault' },
  { value: 'under_investigation', label: 'Under investigation' },
  { value: 'not_applicable', label: 'Not applicable' },
  { value: 'our_driver_partial', label: 'Our driver, partial' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'hit_and_run', label: 'Hit and run' },
  { value: 'no_third_party', label: 'No third party' },
]
const PRIMARY_TYPES = LIABILITY_TYPES.slice(0, 5)

const FAULT_LABEL = {
  our_driver_full: { label: 'Faulty', tone: 'text-red-400' },
  our_driver_partial: { label: 'Partly faulty', tone: 'text-amber-400' },
  third_party_full: { label: 'Non-faulty', tone: 'text-green-400' },
  no_third_party: { label: 'Non-faulty', tone: 'text-green-400' },
  shared: { label: 'Shared', tone: 'text-amber-400' },
  under_investigation: { label: 'Under review', tone: 'text-blue-300' },
  disputed: { label: 'Disputed', tone: 'text-amber-400' },
  hit_and_run: { label: 'Hit and run', tone: 'text-red-400' },
  not_applicable: { label: 'N/A', tone: 'text-[var(--text-muted)]' },
}

const PREVENTABLE = [
  { value: 'preventable', label: 'Preventable' },
  { value: 'non_preventable', label: 'Non-preventable' },
  { value: 'under_review', label: 'Under review' },
]

const AUTHORITIES = [
  { key: 'police', label: 'Police' },
  { key: 'najm', label: 'Najm' },
  { key: 'taqdeer', label: 'Taqdeer' },
]
const REPORT_STATUS = [
  { value: 'available', label: 'Received' },
  { value: 'pending', label: 'Pending' },
  { value: 'none', label: 'Missing' },
]
const REPORT_STATUS_TONE = { available: 'text-green-400', pending: 'text-amber-400', none: 'text-red-400' }

const FIELD_LABELS = {
  root_cause: 'Root cause', immediate_cause: 'Immediate cause', contributing_factors: 'Contributing factors',
  driver_violation: 'Driver violation', unsafe_act: 'Unsafe act', unsafe_condition: 'Unsafe condition',
  weather_condition: 'Weather condition', road_condition: 'Road condition',
}

function Field({ label, value, onChange, disabled, placeholder }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input w-full"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={500}
      />
    </div>
  )
}

export default function LiabilityPaymentPanel({ accidentId, elevated, acc, onChanged }) {
  const [assessment, setAssessment] = useState(null) // null while loading, {} when none exists yet
  const [reports, setReports] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [provisioned, setProvisioned] = useState(true)
  const [changeReason, setChangeReason] = useState('')
  const [payerSaving, setPayerSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [a, r] = await Promise.all([getLiabilityAssessment(accidentId), listAuthorityReports(accidentId)])
      const row = a || {}
      // No formal assessment yet - carry forward the GCC liability % already
      // captured on the incident report (accidents.gcc_liability_ratio; same
      // numeric percentage as our_liability_pct here) rather than showing a
      // blank percentage under a figure the user already entered once. Every
      // other field here is only asked once the assessment itself is opened.
      if (!row.id && acc?.gcc_liability_ratio != null && row.our_liability_pct == null) {
        row.our_liability_pct = acc.gcc_liability_ratio
      }
      setAssessment(row)
      setDraft(row)
      setReports(r)
      setProvisioned(true)
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load responsibility details.'))
    } finally {
      setLoading(false)
    }
  }, [accidentId, acc?.gcc_liability_ratio])

  useEffect(() => { load() }, [load])

  const locked = assessment?.approved && assessment?.locked

  async function save() {
    if (saving) return
    setSaving(true); setErr('')
    try {
      const patch = { ...draft, change_reason: locked ? changeReason : undefined }
      delete patch.id; delete patch.accident_id; delete patch.created_at; delete patch.updated_at; delete patch.created_by
      const saved = await saveLiabilityAssessment(accidentId, patch, { existingId: assessment?.id, isLocked: locked })
      setAssessment(saved); setDraft(saved); setChangeReason('')
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the responsibility assessment.'))
    } finally {
      setSaving(false)
    }
  }

  async function approve() {
    if (!assessment?.id || saving) return
    setSaving(true); setErr('')
    try {
      const saved = await approveLiabilityAssessment(assessment.id)
      setAssessment(saved); setDraft(saved)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not approve the assessment.'))
    } finally {
      setSaving(false)
    }
  }

  async function setPayer(payer) {
    if (!elevated || payerSaving) return
    setPayerSaving(true); setErr('')
    try {
      await setAccidentPayer(accidentId, payer)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save who will pay.'))
    } finally {
      setPayerSaving(false)
    }
  }

  async function saveReport(authorityType, patch) {
    setSaving(true); setErr('')
    try {
      const saved = await saveAuthorityReport(accidentId, authorityType, patch)
      setReports((prev) => {
        const rest = (prev || []).filter((r) => r.authority_type !== authorityType)
        return [saved, ...rest]
      })
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the authority report.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading responsibility details…</div>
  }
  if (err && !draft) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-red-400 flex items-center gap-2"><AlertCircle size={16} /> {err}</p>
        <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={load}><RefreshCw size={13} /> Retry</button>
      </div>
    )
  }

  const faultMeta = FAULT_LABEL[draft?.liability_type] || null

  return (
    <div className="p-6 space-y-6">
      <section className="card space-y-4">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Scale size={16} /> Who was at fault?</h3>
        <div className="flex flex-wrap gap-2">
          {PRIMARY_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              disabled={!elevated || locked}
              onClick={() => setDraft((d) => ({ ...d, liability_type: t.value }))}
              className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-2 disabled:opacity-60 ${
                draft?.liability_type === t.value
                  ? 'border-green-500 bg-green-900/20 text-green-300'
                  : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
              }`}
            >
              {draft?.liability_type === t.value && <ShieldCheck size={14} />} {t.label}
            </button>
          ))}
          {!elevated && <span className="text-xs text-[var(--text-muted)] self-center">Read-only</span>}
        </div>
        {(!elevated || locked) ? null : (
          <select
            className="input w-full sm:w-64 text-xs"
            value={LIABILITY_TYPES.slice(5).some((t) => t.value === draft?.liability_type) ? draft.liability_type : ''}
            onChange={(e) => e.target.value && setDraft((d) => ({ ...d, liability_type: e.target.value }))}
          >
            <option value="">More options…</option>
            {LIABILITY_TYPES.slice(5).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[var(--input-border)]">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Fault status</p>
            <p className={`text-sm font-semibold ${faultMeta?.tone || 'text-[var(--text-muted)]'}`}>{faultMeta?.label || 'Not set'}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">GCC liability</p>
            {elevated && !locked ? (
              <input type="number" min="0" max="100" className="input w-24 text-sm" value={draft?.our_liability_pct ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, our_liability_pct: e.target.value === '' ? null : Number(e.target.value) }))} />
            ) : (
              <p className="text-sm font-bold text-[var(--text-primary)]">{draft?.our_liability_pct != null ? `${draft.our_liability_pct}%` : 'N/A'}</p>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Other-party liability</p>
            {elevated && !locked ? (
              <input type="number" min="0" max="100" className="input w-24 text-sm" value={draft?.third_party_pct ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, third_party_pct: e.target.value === '' ? null : Number(e.target.value) }))} />
            ) : (
              <p className="text-sm font-bold text-red-400">{draft?.third_party_pct != null ? `${draft.third_party_pct}%` : 'N/A'}</p>
            )}
          </div>
        </div>

        {!locked && (
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><FileWarning size={12} /> Provisional until authority/insurer confirmation.</p>
        )}
        {locked && (
          <p className="text-xs text-green-400 flex items-center gap-1.5"><Lock size={12} /> Approved and locked - a further edit requires a change reason.</p>
        )}

        <div>
          <label className="label">Preventable</label>
          <div className="flex gap-2">
            {PREVENTABLE.map((p) => (
              <button key={p.value} type="button" disabled={!elevated || locked}
                onClick={() => setDraft((d) => ({ ...d, preventable: p.value }))}
                className={`px-2.5 py-1.5 rounded border text-xs disabled:opacity-60 ${draft?.preventable === p.value ? 'border-amber-500 bg-amber-900/20 text-amber-300' : 'border-[var(--input-border)] text-[var(--text-secondary)]'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(FIELD_LABELS).map(([key, label]) => (
            <Field key={key} label={label} value={draft?.[key]} disabled={!elevated || locked}
              onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))} />
          ))}
        </div>

        {locked && elevated && (
          <Field label="Change reason (required to revise a locked assessment)" value={changeReason} onChange={setChangeReason} />
        )}

        {elevated && (
          <div className="flex gap-2 pt-2">
            <button className="btn-primary text-xs" disabled={saving || (locked && !changeReason.trim())} onClick={save}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : 'Save responsibility details'}
            </button>
            {assessment?.id && !assessment.approved && (
              <button className="btn-secondary text-xs" disabled={saving} onClick={approve}>Approve and lock</button>
            )}
          </div>
        )}
        <div className="pt-3 border-t border-[var(--input-border)]">
          <label className="label flex items-center gap-1.5"><Banknote size={13} /> Who will pay?</label>
          <div className="flex flex-wrap gap-2">
            {PAYER_OPTS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={!elevated || payerSaving}
                onClick={() => setPayer(p)}
                className={`px-3 py-1.5 rounded-lg border text-sm disabled:opacity-60 ${
                  canonPayer(acc?.payer) === p
                    ? 'border-blue-500 bg-blue-900/20 text-blue-300'
                    : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
                }`}
              >
                {p}
              </button>
            ))}
            {payerSaving && <Loader2 size={14} className="animate-spin text-[var(--text-muted)] self-center" />}
          </div>
        </div>

        {err && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertCircle size={12} /> {err}</p>}
      </section>

      <section className="card space-y-4">
        <h3 className="font-semibold text-[var(--text-primary)]">Third-party and authority reports</h3>
        <div className="space-y-3">
          {AUTHORITIES.map((auth) => {
            const row = (reports || []).find((r) => r.authority_type === auth.key) || {}
            return (
              <div key={auth.key} className="rounded-lg border border-[var(--input-border)] p-3 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div>
                  <p className="text-xs font-semibold text-[var(--text-primary)]">{auth.label}</p>
                  <p className={`text-xs ${REPORT_STATUS_TONE[row.report_status] || 'text-[var(--text-muted)]'}`}>
                    {REPORT_STATUS.find((s) => s.value === row.report_status)?.label || 'Not set'}
                  </p>
                </div>
                <select className="input text-xs" disabled={!elevated} value={row.report_status || ''}
                  onChange={(e) => saveReport(auth.key, { report_status: e.target.value })}>
                  <option value="">Status…</option>
                  {REPORT_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <input className="input text-xs" placeholder="Report no." disabled={!elevated} defaultValue={row.report_no || ''}
                  onBlur={(e) => e.target.value !== (row.report_no || '') && saveReport(auth.key, { report_no: e.target.value || null })} />
                <input type="date" className="input text-xs" disabled={!elevated} defaultValue={row.report_date || ''}
                  onBlur={(e) => e.target.value !== (row.report_date || '') && saveReport(auth.key, { report_date: e.target.value || null })} />
              </div>
            )
          })}
        </div>
      </section>

      <section className="card">
        <EvidenceTable accidentId={accidentId} workstreamKey="liability" elevated={elevated} title="Responsibility documents" />
      </section>

      <section className="card">
        <NotifyRecipientsPanel
          accidentId={accidentId}
          workstreamKey="liability"
          title="Notify recipients"
          subject="Responsibility & payment update"
        />
      </section>
    </div>
  )
}
