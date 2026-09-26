/**
 * AccidentPortalView - the page an INSURER or claims authority sees when they
 * open a shared case link (/accident-portal/:token). Anonymous, read-only,
 * forced LIGHT (it is an external document, not an app screen), and PII-lean
 * by construction: everything rendered comes from get_accident_portal_snapshot,
 * which excludes money and driver details at the database level.
 *
 * PRESENTATION ONLY. This page renders exactly the fields the RPC returns
 * (reference_no, case_no, incident_date, status, workflow_stage, case_status,
 * severity, workstreams {key: status}, claim {decision, claim_no, insurer,
 * insurance_applicable, claim_registered_date}, generated_at) and nothing else.
 * No other read is made. A field the snapshot does not carry reads "N/A".
 *
 * Sibling of ReportShare (/report/:token) - same anon-token pattern, no base
 * table is ever exposed; a bad/revoked/expired token gets a calm explanation.
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ShieldCheck, Lock, Clock, Ban, AlertCircle, CheckCircle2, CircleDashed, Hourglass,
  MinusCircle, Printer, RefreshCcw, FileCheck2,
} from 'lucide-react'

/** Ordered case journey. 'cancelled' is off-path and shown as a note, not a step. */
const STAGE_FLOW = [
  ['reported', 'Reported'], ['initial_review', 'Initial review'], ['hse_investigation', 'Safety investigation'],
  ['workshop_assessment', 'Workshop assessment'], ['insurance_claim', 'Insurance claim'],
  ['repair_approval', 'Repair approval'], ['repair_in_progress', 'Repair in progress'],
  ['final_inspection', 'Final inspection'], ['vehicle_release', 'Vehicle release'],
  ['cost_recovery', 'Cost recovery'], ['closed', 'Closed'],
]
const STAGE_LABELS = { ...Object.fromEntries(STAGE_FLOW), cancelled: 'Cancelled' }
const WS_LABELS = {
  incident_evidence: 'Incident evidence', police_report: 'Police report', insurance: 'Insurance claim',
  damage_assessment: 'Damage assessment', repair: 'Repair', quality_check: 'Quality check',
  finance: 'Finance', hse: 'Safety review', driver: 'Driver actions', closure: 'Closure',
}
const WS_ORDER = Object.keys(WS_LABELS)
const WS_STATUS = {
  completed: { label: 'Completed', color: '#15803d', bg: '#dcfce7', Icon: CheckCircle2 },
  not_applicable: { label: 'Not applicable', color: '#475569', bg: '#f1f5f9', Icon: MinusCircle },
  in_progress: { label: 'In progress', color: '#1d4ed8', bg: '#dbeafe', Icon: Hourglass },
  assigned: { label: 'Assigned', color: '#1d4ed8', bg: '#dbeafe', Icon: Hourglass },
  blocked: { label: 'Blocked', color: '#b91c1c', bg: '#fee2e2', Icon: AlertCircle },
  not_started: { label: 'Not started', color: '#64748b', bg: '#f8fafc', Icon: CircleDashed },
}
const CLAIM_DECISION = {
  not_required: 'No insurance claim on this case',
  pending: 'Awaiting insurer decision', submitted: 'Submitted to insurer', registered: 'Registered with insurer',
  approved: 'Approved', partially_approved: 'Partially approved', rejected: 'Rejected',
  settled: 'Settled', withdrawn: 'Withdrawn',
}
const REASON_COPY = {
  invalid: { title: 'Link not valid', Icon: AlertCircle, body: 'This link is not valid. Please check the address you were sent, or ask the sender for a new link.' },
  revoked: { title: 'Link withdrawn', Icon: Ban, body: 'This link has been withdrawn by the sender. Ask them for a new one if you still need access.' },
  expired: { title: 'Link expired', Icon: Clock, body: 'This link has expired. Ask the sender for a fresh link.' },
  unavailable: { title: 'Temporarily unavailable', Icon: AlertCircle, body: 'The case summary is temporarily unavailable. Please try again in a moment.' },
}

const C = { ink: '#0f172a', muted: '#64748b', faint: '#94a3b8', line: '#e2e8f0', brand: '#15803d' }

const humanize = (v) => String(v || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const label = (map, key) => (key ? (map[key] || humanize(key)) : null)

function fmtDate(v, withTime = false) {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('en-GB', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' })
}

const PRINT_CSS = `
@media print {
  .acp-noprint { display: none !important; }
  .acp-shell { background: #ffffff !important; padding: 0 !important; }
  .acp-card { box-shadow: none !important; border: none !important; padding: 0 !important; }
  .acp-section { break-inside: avoid; }
  @page { margin: 14mm; }
}
`

function Field({ k, v }) {
  return (
    <div style={{ padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 10, background: '#ffffff' }}>
      <div style={{ color: C.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
      <div style={{ color: C.ink, fontSize: 14, fontWeight: 600, marginTop: 2 }}>{v || 'N/A'}</div>
    </div>
  )
}

function SectionTitle({ children }) {
  return <h2 style={{ fontSize: 13, fontWeight: 700, color: '#334155', margin: '22px 0 8px' }}>{children}</h2>
}

function StageProgress({ stage }) {
  if (stage === 'cancelled') {
    return <p style={{ color: C.muted, fontSize: 13 }}>This case was cancelled and is not progressing.</p>
  }
  const idx = STAGE_FLOW.findIndex(([k]) => k === stage)
  if (idx < 0) {
    return <p style={{ color: C.muted, fontSize: 13 }}>Current stage: {label(STAGE_LABELS, stage) || 'N/A'}</p>
  }
  const pct = Math.round(((idx + 1) / STAGE_FLOW.length) * 100)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted, marginBottom: 6 }}>
        <span>Step {idx + 1} of {STAGE_FLOW.length}: <strong style={{ color: C.ink }}>{STAGE_FLOW[idx][1]}</strong></span>
        <span>{pct}%</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        style={{ height: 8, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: C.brand }} />
      </div>
      <ol style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
        {STAGE_FLOW.map(([k, name], i) => {
          const state = i < idx ? 'done' : i === idx ? 'current' : 'next'
          return (
            <li key={k} aria-current={state === 'current' ? 'step' : undefined} style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
              color: state === 'next' ? C.faint : C.ink, fontWeight: state === 'current' ? 700 : 500,
            }}>
              <span aria-hidden="true" style={{
                width: 18, height: 18, borderRadius: 999, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
                background: state === 'done' ? C.brand : state === 'current' ? '#ffffff' : '#f1f5f9',
                color: state === 'done' ? '#ffffff' : state === 'current' ? C.brand : C.faint,
                border: state === 'current' ? `2px solid ${C.brand}` : '1px solid #e2e8f0',
              }}>{state === 'done' ? '✓' : i + 1}</span>
              {name}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function WorkstreamChecklist({ workstreams }) {
  const entries = Object.entries(workstreams || {})
    .sort(([a], [b]) => {
      const ia = WS_ORDER.indexOf(a); const ib = WS_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  if (!entries.length) {
    return <p style={{ color: C.muted, fontSize: 13 }}>No progress areas have been opened on this case yet.</p>
  }
  const done = entries.filter(([, s]) => s === 'completed' || s === 'not_applicable').length
  return (
    <div>
      <p style={{ color: C.muted, fontSize: 12, margin: '0 0 8px' }}>{done} of {entries.length} areas complete or not required</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden' }}>
        {entries.map(([k, s], i) => {
          const meta = WS_STATUS[s] || { label: humanize(s) || 'N/A', color: C.muted, bg: '#f8fafc', Icon: CircleDashed }
          const { Icon } = meta
          return (
            <li key={k} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px',
              borderTop: i ? `1px solid ${C.line}` : 'none', fontSize: 13,
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.ink }}>
                <Icon size={16} color={meta.color} aria-hidden="true" /> {label(WS_LABELS, k)}
              </span>
              <span style={{ background: meta.bg, color: meta.color, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
                {meta.label}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const btn = (primary, disabled) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer',
  background: primary ? C.brand : '#f1f5f9', color: primary ? '#ffffff' : '#334155',
  border: primary ? 'none' : '1px solid #cbd5e1', borderRadius: 8, padding: '7px 14px',
  fontSize: 12, fontWeight: 600, opacity: disabled ? 0.5 : 1,
})

export default function AccidentPortalView() {
  const { token } = useParams()
  const [snap, setSnap] = useState(null)     // null = loading
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [triedPassword, setTriedPassword] = useState(false)

  const load = useCallback(async (pw) => {
    setBusy(true)
    try {
      const { getCasePortalSnapshot } = await import('../lib/api/accidentPortal')
      const s = await getCasePortalSnapshot(token, pw)
      setSnap(s && typeof s === 'object' ? s : { ok: false, reason: 'unavailable' })
    } catch {
      // This public surface must not expose transport, database, or token details.
      setSnap({ ok: false, reason: 'unavailable' })
    } finally {
      setBusy(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const page = (children, wide = false) => (
    <div className="acp-shell" style={{ minHeight: '100vh', background: '#f1f5f9', padding: '32px 16px', fontFamily: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif', colorScheme: 'light' }}>
      <style>{PRINT_CSS}</style>
      <div style={{ maxWidth: wide ? 760 : 520, margin: '0 auto' }}>
        <div className="acp-card" style={{ background: '#ffffff', borderRadius: 16, border: `1px solid ${C.line}`, boxShadow: '0 1px 3px rgba(15,23,42,0.08)', padding: 28 }}>
          {children}
        </div>
        <p style={{ textAlign: 'center', color: C.faint, fontSize: 11, marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <ShieldCheck size={13} aria-hidden="true" />
          Shared securely by TyrePulse. Read-only case summary with no personal or financial details.
        </p>
      </div>
    </div>
  )

  if (snap === null) {
    return page(
      <div aria-busy="true">
        <div style={{ height: 12, width: 140, background: '#e2e8f0', borderRadius: 6, marginBottom: 10 }} />
        <div style={{ height: 22, width: 220, background: '#e2e8f0', borderRadius: 6, marginBottom: 18 }} />
        <p style={{ color: C.muted, fontSize: 14 }}>Loading the case summary</p>
      </div>,
    )
  }

  if (!snap.ok && snap.reason === 'password') {
    return page(
      <div>
        <Lock size={22} color={C.brand} aria-hidden="true" />
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.ink, margin: '8px 0 6px' }}>Protected case summary</h1>
        <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>This link is protected. Enter the password you were given.</p>
        <form onSubmit={(e) => { e.preventDefault(); setTriedPassword(true); load(password) }} style={{ display: 'flex', gap: 8 }}>
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
            aria-label="Password" autoComplete="off" autoFocus
            style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 10, padding: '10px 12px', fontSize: 14 }}
          />
          <button type="submit" disabled={busy || !password} style={{ ...btn(true, busy || !password), padding: '10px 18px', fontSize: 14 }}>
            {busy ? 'Checking' : 'Open'}
          </button>
        </form>
        {triedPassword && !busy && (
          <p role="alert" style={{ color: '#b91c1c', fontSize: 12, marginTop: 10 }}>That password did not match. Please try again.</p>
        )}
      </div>,
    )
  }

  if (!snap.ok) {
    const copy = REASON_COPY[snap.reason] || REASON_COPY.unavailable
    const { Icon } = copy
    return page(
      <div>
        <Icon size={22} color={C.muted} aria-hidden="true" />
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.ink, margin: '8px 0 6px' }}>{copy.title}</h1>
        <p style={{ color: C.muted, fontSize: 13 }}>{copy.body}</p>
        {(snap.reason === 'unavailable' || !REASON_COPY[snap.reason]) && (
          <button type="button" onClick={() => load(password || undefined)} disabled={busy}
            style={{ ...btn(false, busy), marginTop: 14 }}>
            <RefreshCcw size={13} aria-hidden="true" /> {busy ? 'Trying again' : 'Try again'}
          </button>
        )}
      </div>,
    )
  }

  const claim = snap.claim && typeof snap.claim === 'object' ? snap.claim : null
  const stage = snap.workflow_stage || snap.status
  const noClaim = !claim || claim.decision === 'not_required'
  const applicable = claim && typeof claim.insurance_applicable === 'boolean'
    ? (claim.insurance_applicable ? 'Yes' : 'No') : null

  return page(
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.brand, textTransform: 'uppercase', margin: '0 0 4px' }}>Accident case summary</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.ink, margin: 0 }}>{snap.case_no || snap.reference_no || 'Case'}</h1>
          {snap.reference_no && snap.case_no && (
            <p style={{ color: C.faint, fontSize: 12, margin: '2px 0 0' }}>Internal reference {snap.reference_no}</p>
          )}
        </div>
        <div className="acp-noprint" style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => load(password || undefined)} disabled={busy} style={btn(false, busy)}>
            <RefreshCcw size={13} aria-hidden="true" /> {busy ? 'Refreshing' : 'Refresh'}
          </button>
          <button type="button" onClick={() => window.print()} style={btn(true, false)}>
            <Printer size={13} aria-hidden="true" /> Print
          </button>
        </div>
      </div>

      <div className="acp-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 18 }}>
        <Field k="Incident date" v={fmtDate(snap.incident_date)} />
        <Field k="Current stage" v={label(STAGE_LABELS, stage)} />
        <Field k="Severity" v={label({ severe: 'Major' }, snap.severity)} />
        <Field k="Case status" v={label({}, snap.case_status)} />
      </div>

      <div className="acp-section">
        <SectionTitle>Case progress</SectionTitle>
        <StageProgress stage={stage} />
      </div>

      <div className="acp-section">
        <SectionTitle>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FileCheck2 size={14} aria-hidden="true" /> Insurance claim
          </span>
        </SectionTitle>
        {noClaim ? (
          <p style={{ color: C.muted, fontSize: 13 }}>No insurance claim has been registered on this case.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <Field k="Claim status" v={label(CLAIM_DECISION, claim.decision)} />
            <Field k="Claim number" v={claim.claim_no} />
            <Field k="Insurer" v={claim.insurer} />
            <Field k="Registered" v={fmtDate(claim.claim_registered_date)} />
            <Field k="Insurance applicable" v={applicable} />
          </div>
        )}
      </div>

      <div className="acp-section">
        <SectionTitle>Checklist by area</SectionTitle>
        <WorkstreamChecklist workstreams={snap.workstreams && typeof snap.workstreams === 'object' ? snap.workstreams : null} />
      </div>

      <p style={{ color: C.faint, fontSize: 11, marginTop: 20 }}>
        {snap.generated_at ? `As of ${fmtDate(snap.generated_at, true)}` : 'Time of this summary not recorded'}
      </p>
    </div>,
    true,
  )
}
