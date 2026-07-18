/**
 * DataDeletion - PUBLIC account & data deletion page (no login required).
 *
 * This is the URL to enter in the Google Play "Data safety" form as the
 * data-deletion request mechanism, and it is linked from the app itself. It is
 * a self-contained, light-theme document page: it does not depend on the app
 * shell, auth, or theme providers, so it renders for anyone (including Google's
 * reviewers) at /data-deletion.
 *
 * NOTE: set SUPPORT_EMAIL to the real, monitored inbox before submitting to
 * Google - the deletion requests land there.
 */
import { useState } from 'react'

// The monitored inbox that receives deletion requests. CHANGE to your real one.
const SUPPORT_EMAIL = 'privacy@tyrepulse.com'
const APP_NAME = 'Tyre Pulse'
const RETENTION_DAYS = 30

export default function DataDeletion() {
  const [copied, setCopied] = useState(false)

  const subject = encodeURIComponent('Account & data deletion request')
  const body = encodeURIComponent(
    'Please delete my Tyre Pulse account and associated personal data.\n\n' +
    'Username or Employee ID: \n' +
    'Full name: \n' +
    'Company / site (if known): \n',
  )
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`

  function copyEmail() {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1600) }
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(SUPPORT_EMAIL).then(done).catch(done)
    else done()
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <header style={S.head}>
          <div style={S.badge}>{APP_NAME}</div>
          <h1 style={S.h1}>Account &amp; Data Deletion</h1>
          <p style={S.sub}>
            How to request deletion of your {APP_NAME} account and the personal data associated with it.
          </p>
        </header>

        <section style={S.section}>
          <h2 style={S.h2}>How to request deletion</h2>
          <p style={S.p}>
            Email <a href={mailto} style={S.link}>{SUPPORT_EMAIL}</a> from any address with the subject
            {' '}<strong>"Account &amp; data deletion request"</strong>, and include your <strong>username or
            Employee ID</strong> and <strong>full name</strong> so we can verify the account.
          </p>
          <div style={S.actions}>
            <a href={mailto} style={S.btnPrimary}>Email a deletion request</a>
            <button type="button" onClick={copyEmail} style={S.btnGhost}>
              {copied ? 'Copied' : `Copy ${SUPPORT_EMAIL}`}
            </button>
          </div>
          <p style={S.note}>
            We verify each request against the account holder before deleting, to protect fleet records from
            unauthorised removal.
          </p>
        </section>

        <section style={S.section}>
          <h2 style={S.h2}>What gets deleted</h2>
          <ul style={S.ul}>
            <li>Your profile and login (name, username, Employee ID, phone number, device push token).</li>
            <li>Your captured location tags, photos, and diagnostic/crash records linked to your account.</li>
            <li>Your account's access to the app is revoked immediately on request.</li>
          </ul>
        </section>

        <section style={S.section}>
          <h2 style={S.h2}>What may be retained (and why)</h2>
          <ul style={S.ul}>
            <li>
              Operational fleet records you created (inspections, accidents, work orders, meter logs) may be
              retained by your employing organisation as business/audit records, and are de-identified from your
              personal profile where retained.
            </li>
            <li>
              Minimal records required by law or for fraud/security auditing may be kept for the period the law
              requires, then deleted.
            </li>
          </ul>
        </section>

        <section style={S.section}>
          <h2 style={S.h2}>Timeline &amp; data we handle</h2>
          <p style={S.p}>
            Verified requests are completed within <strong>{RETENTION_DAYS} days</strong>. Data is encrypted in
            transit (HTTPS/TLS). {APP_NAME} does not sell your data and uses no third-party advertising. Crash
            and performance diagnostics are processed by our error-monitoring provider solely to keep the app
            reliable.
          </p>
        </section>

        <footer style={S.foot}>
          <p style={S.footText}>
            {APP_NAME} is a fleet tyre-management tool used by your employer. If your account was created by your
            organisation, deletion may also be handled by your fleet administrator.
          </p>
        </footer>
      </div>
    </div>
  )
}

// Self-contained light-theme styles (this page must render standalone).
const S = {
  page: { minHeight: '100vh', background: '#f1f5f9', color: '#0f172a', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', WebkitFontSmoothing: 'antialiased' },
  card: { maxWidth: 760, margin: '0 auto', background: '#fff', borderRadius: 18, border: '1px solid #e2e8f0', boxShadow: '0 10px 30px rgba(2,6,23,0.06)', overflow: 'hidden' },
  head: { padding: '28px 28px 8px' },
  badge: { display: 'inline-block', fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: '#16a34a', background: '#dcfce7', padding: '4px 10px', borderRadius: 999, marginBottom: 12 },
  h1: { fontSize: 26, fontWeight: 800, margin: '0 0 6px', letterSpacing: -0.4 },
  sub: { fontSize: 15, color: '#475569', margin: 0, lineHeight: 1.5 },
  section: { padding: '18px 28px', borderTop: '1px solid #f1f5f9' },
  h2: { fontSize: 16, fontWeight: 700, margin: '0 0 8px' },
  p: { fontSize: 14.5, color: '#334155', lineHeight: 1.65, margin: '0 0 8px' },
  ul: { margin: '0', paddingLeft: 18, color: '#334155', fontSize: 14.5, lineHeight: 1.7 },
  link: { color: '#15803d', fontWeight: 600, textDecoration: 'none' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 10, margin: '12px 0 6px' },
  btnPrimary: { background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: 14, padding: '10px 16px', borderRadius: 10, textDecoration: 'none' },
  btnGhost: { background: '#f1f5f9', color: '#0f172a', fontWeight: 600, fontSize: 14, padding: '10px 16px', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer' },
  note: { fontSize: 13, color: '#64748b', margin: '6px 0 0', lineHeight: 1.5 },
  foot: { padding: '18px 28px 26px', borderTop: '1px solid #f1f5f9', background: '#f8fafc' },
  footText: { fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.6 },
}
