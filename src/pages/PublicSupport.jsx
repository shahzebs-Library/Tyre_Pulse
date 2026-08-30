import PublicTrustPage, { PublicSection } from '../components/public/PublicTrustPage'

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'info@tyrepulse.app'

export default function PublicSupport() {
  return (
    <PublicTrustPage
      eyebrow="Customer care"
      title="How can we help?"
      intro="Contact the TyrePulse team for sign-in, recovery, access, data or service problems. Do not send passwords or verification codes."
    >
      <PublicSection title="Account and sign-in support">
        <p>Try password recovery from the sign-in page using a previously verified recovery email. If you cannot access that contact, ask your organisation administrator to verify your identity and restore access.</p>
      </PublicSection>
      <PublicSection title="Report a problem">
        <p className="mb-4">Include your organisation name, affected screen, approximate time, browser/device, and what you expected to happen. Remove customer-sensitive data from screenshots whenever possible.</p>
        <a
          className="inline-flex min-h-11 items-center rounded-xl bg-green-700 px-5 py-2.5 font-bold text-white hover:bg-green-800"
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('TyrePulse support request')}`}
        >
          Email {SUPPORT_EMAIL}
        </a>
      </PublicSection>
      <PublicSection title="Service interruption">
        <p>Check <a className="font-semibold text-green-700 hover:underline" href="/status">Service Status</a> first. For safety-critical fleet events, continue using your organisation's approved operational and emergency procedures.</p>
      </PublicSection>
    </PublicTrustPage>
  )
}
