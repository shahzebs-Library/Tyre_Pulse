/**
 * Privacy - PUBLIC privacy policy page (no login required).
 *
 * This is the Privacy Policy URL required by the Google Play Console (App
 * content -> Privacy policy) and referenced by the Data Safety form. Self
 * contained light-theme document; does not depend on the app shell, auth, or
 * theme providers, so it renders for anyone (including reviewers) at /privacy.
 *
 * Keep in lockstep with the Data Safety declaration and the /data-deletion
 * page. SUPPORT_EMAIL is the real monitored inbox.
 */

const SUPPORT_EMAIL = 'info@tyrepulse.app'
const APP_NAME = 'Tyre Pulse'
const EFFECTIVE = '18 July 2026'
const RETENTION_DAYS = 30

export default function Privacy() {
  return (
    <div style={S.page}>
      <div style={S.card}>
        <header style={S.head}>
          <div style={S.badge}>{APP_NAME}</div>
          <h1 style={S.h1}>Privacy Policy</h1>
          <p style={S.sub}>Effective {EFFECTIVE}</p>
        </header>

        <section style={S.section}>
          <p style={S.p}>
            {APP_NAME} is a fleet tyre, inspection, workshop, accident and stock management platform used by
            organisations to manage their vehicles. This policy explains what data the {APP_NAME} mobile and web
            apps collect, why, how it is protected, and your choices. Accounts are typically created by your
            employing organisation, which controls the operational records you create.
          </p>
        </section>

        <section style={S.section}>
          <h2 style={S.h2}>Data we collect</h2>
          <ul style={S.ul}>
            <li><strong>Account information</strong> - name, username, Employee ID, and optional phone number. Login uses your username/Employee ID; email addresses are internal, non-routable identifiers.</li>
            <li><strong>App activity</strong> - the operational records you create: inspections, accidents, meter readings, work orders and stock counts.</li>
            <li><strong>Location</strong> - approximate/precise location captured only while the app is in use, to geotag where an inspection was performed. Declined permission simply omits the tag.</li>
            <li><strong>Photos</strong> - images you take or attach to inspections and accident reports.</li>
            <li><strong>Device identifiers</strong> - a push notification token, so we can send you approval and sync alerts.</li>
            <li><strong>Diagnostics &amp; performance</strong> - crash logs and a sample of performance traces, to keep the app reliable.</li>
          </ul>
        </section>

        <section style={S.section}>
          <h2 style={S.h2}>How we use it</h2>
          <p style={S.p}>
            Solely to provide the service: authenticating you, recording and displaying fleet operations,
            geotagging and attaching evidence to records, sending operational notifications, and diagnosing
            crashes/performance. We do <strong>not</strong> use your data for advertising and we do <strong>not
            </strong> sell it.
          </p>
        </section>

        <section style={S.section}>
          <h2 style={S.h2}>Sharing</h2>
          <p style={S.p}>
            Your data is stored in our secure backend (Supabase) and is visible only within your organisation
            under strict role and country/site access controls. The only data shared with a third party is
            crash and performance <strong>diagnostics</strong>, sent to our error-monitoring provider (Sentry)
            purely to keep the app stable. No advertising or analytics-tracking SDKs are used in the mobile app.
          </p>
        </section>

        <section style={S.section}>
          <h2 style={S.h2}>Security &amp; retention</h2>
          <p style={S.p}>
            All data is encrypted in transit (HTTPS/TLS). Access is enforced at the database layer by row-level
            security, so users only see data for their organisation, country and assigned sites. Operational
            records are retained for as long as your organisation needs them for business and audit purposes.
          </p>
        </section>

        <section style={S.section}>
          <h2 style={S.h2}>Your rights &amp; data deletion</h2>
          <p style={S.p}>
            You can request deletion of your account and personal data at any time - see{' '}
            <a href="/data-deletion" style={S.link}>tyrepulse.app/data-deletion</a>, or email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={S.link}>{SUPPORT_EMAIL}</a>. Verified requests are
            completed within {RETENTION_DAYS} days; operational records retained by your organisation are
            de-identified from your personal profile where kept.
          </p>
        </section>

        <section style={S.section}>
          <h2 style={S.h2}>Children</h2>
          <p style={S.p}>
            {APP_NAME} is a workplace tool intended for employees and is not directed to children under 16.
          </p>
        </section>

        <section style={S.section}>
          <h2 style={S.h2}>Changes &amp; contact</h2>
          <p style={S.p}>
            We may update this policy; material changes will be reflected by a new effective date. Questions or
            requests: <a href={`mailto:${SUPPORT_EMAIL}`} style={S.link}>{SUPPORT_EMAIL}</a>.
          </p>
        </section>
      </div>
    </div>
  )
}

const S = {
  page: { minHeight: '100vh', background: '#f1f5f9', color: '#0f172a', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', WebkitFontSmoothing: 'antialiased' },
  card: { maxWidth: 780, margin: '0 auto', background: '#fff', borderRadius: 18, border: '1px solid #e2e8f0', boxShadow: '0 10px 30px rgba(2,6,23,0.06)', overflow: 'hidden' },
  head: { padding: '28px 28px 8px' },
  badge: { display: 'inline-block', fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: '#16a34a', background: '#dcfce7', padding: '4px 10px', borderRadius: 999, marginBottom: 12 },
  h1: { fontSize: 26, fontWeight: 800, margin: '0 0 6px', letterSpacing: -0.4 },
  sub: { fontSize: 14, color: '#64748b', margin: 0 },
  section: { padding: '16px 28px', borderTop: '1px solid #f1f5f9' },
  h2: { fontSize: 16, fontWeight: 700, margin: '0 0 8px' },
  p: { fontSize: 14.5, color: '#334155', lineHeight: 1.65, margin: 0 },
  ul: { margin: 0, paddingLeft: 18, color: '#334155', fontSize: 14.5, lineHeight: 1.75 },
  link: { color: '#15803d', fontWeight: 600, textDecoration: 'none' },
}
