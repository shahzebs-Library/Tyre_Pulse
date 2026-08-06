/**
 * AccidentPortalView - the page an INSURER or claims authority sees when they
 * open a shared case link (/accident-portal/:token). Anonymous, read-only,
 * forced LIGHT (it is an external document, not an app screen), and PII-lean
 * by construction: everything rendered comes from get_accident_portal_snapshot,
 * which excludes money and driver details at the database level.
 *
 * Sibling of ReportShare (/report/:token) - same anon-token pattern, no base
 * table is ever exposed; a bad/revoked/expired token gets a calm explanation.
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const STAGE_LABELS = {
  reported: 'Reported', initial_review: 'Initial review', hse_investigation: 'Safety investigation',
  workshop_assessment: 'Workshop assessment', insurance_claim: 'Insurance claim',
  repair_approval: 'Repair approval', repair_in_progress: 'Repair in progress',
  final_inspection: 'Final inspection', vehicle_release: 'Vehicle release',
  cost_recovery: 'Cost recovery', closed: 'Closed', cancelled: 'Cancelled',
}
const WS_LABELS = {
  incident_evidence: 'Incident evidence', police_report: 'Police report', insurance: 'Insurance claim',
  damage_assessment: 'Damage assessment', repair: 'Repair', quality_check: 'Quality check',
  finance: 'Finance', hse: 'Safety review', driver: 'Driver actions', closure: 'Closure',
}
const WS_STATUS_LABELS = {
  not_started: 'Not started', assigned: 'Assigned', in_progress: 'In progress',
  blocked: 'Blocked', completed: 'Completed', not_applicable: 'Not applicable',
}
const REASON_COPY = {
  invalid: 'This link is not valid. Please check the address you were sent, or ask the sender for a new link.',
  revoked: 'This link has been withdrawn by the sender. Ask them for a new one if you still need access.',
  expired: 'This link has expired. Ask the sender for a fresh link.',
  unavailable: 'The case summary is temporarily unavailable. Please try again in a moment.',
}

const label = (map, key) => map[key] || String(key || '').replace(/_/g, ' ')

function Row({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
      <span style={{ color: '#64748b', fontSize: 13 }}>{k}</span>
      <span style={{ color: '#0f172a', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{v || 'N/A'}</span>
    </div>
  )
}

export default function AccidentPortalView() {
  const { token } = useParams()
  const [snap, setSnap] = useState(null)     // null = loading
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (pw) => {
    setBusy(true)
    const { getCasePortalSnapshot } = await import('../lib/api/accidentPortal')
    const s = await getCasePortalSnapshot(token, pw)
    setSnap(s)
    setBusy(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const page = (children) => (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '32px 16px', fontFamily: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.08)', padding: 28 }}>
          {children}
        </div>
        <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 16 }}>
          Shared securely by TyrePulse. This page shows a read-only case summary and contains no personal or financial details.
        </p>
      </div>
    </div>
  )

  if (snap === null) {
    return page(<p style={{ color: '#64748b', fontSize: 14 }}>Loading the case summary...</p>)
  }

  if (!snap.ok && snap.reason === 'password') {
    return page(
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Protected case summary</h1>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>This link is protected. Enter the password you were given.</p>
        <form onSubmit={(e) => { e.preventDefault(); load(password) }} style={{ display: 'flex', gap: 8 }}>
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
            style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 10, padding: '10px 12px', fontSize: 14 }}
          />
          <button type="submit" disabled={busy || !password}
            style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: busy || !password ? 0.5 : 1 }}>
            {busy ? 'Checking...' : 'Open'}
          </button>
        </form>
      </div>,
    )
  }

  if (!snap.ok) {
    return page(
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Case summary unavailable</h1>
        <p style={{ color: '#64748b', fontSize: 13 }}>{REASON_COPY[snap.reason] || REASON_COPY.unavailable}</p>
      </div>,
    )
  }

  const ws = snap.workstreams && typeof snap.workstreams === 'object' ? Object.entries(snap.workstreams) : []
  const claim = snap.claim && typeof snap.claim === 'object' ? snap.claim : null

  return page(
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#16a34a', textTransform: 'uppercase', marginBottom: 4 }}>Accident case summary</p>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>{snap.case_no || snap.reference_no || 'Case'}</h1>
      {snap.reference_no && snap.case_no && (
        <p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12 }}>Internal reference {snap.reference_no}</p>
      )}

      <Row k="Incident date" v={snap.incident_date} />
      <Row k="Current stage" v={label(STAGE_LABELS, snap.workflow_stage || snap.status)} />
      <Row k="Severity" v={snap.severity ? snap.severity.charAt(0).toUpperCase() + snap.severity.slice(1) : null} />
      {claim && <Row k="Insurance claim" v={label(WS_STATUS_LABELS, claim.decision) || 'N/A'} />}

      {ws.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Progress by area</p>
          {ws.map(([k, v]) => (
            <Row key={k} k={label(WS_LABELS, k)} v={label(WS_STATUS_LABELS, v)} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
        <span style={{ color: '#94a3b8', fontSize: 11 }}>
          {snap.generated_at ? `As of ${new Date(snap.generated_at).toLocaleString()}` : ''}
        </span>
        <button type="button" onClick={() => load(password || undefined)} disabled={busy}
          style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
          {busy ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </div>,
  )
}
