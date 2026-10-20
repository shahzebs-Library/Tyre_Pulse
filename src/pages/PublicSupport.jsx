import PublicTrustPage, { PublicSection } from '../components/public/PublicTrustPage'

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'info@tyrepulse.app'

export default function PublicSupport() {
  return (
    <PublicTrustPage
      eyebrow="Support & contact"
      title="Contact Tyre Pulse"
      intro="Reach the Tyre Pulse team about customer support or a product demonstration. This page is public, so you can use it without signing in. Do not send passwords or verification codes."
    >
      <PublicSection title="Existing customer support">
        <p>Try password recovery from the sign-in page using a previously verified recovery email. If you cannot access that contact, ask your organisation administrator to verify your identity and restore access.</p>
        <p className="mt-3">For app, data or access problems, email the affected screen, your organisation name and approximate time. Leave out passwords, verification codes and sensitive customer information.</p>
        <a
          className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-5 py-2.5 font-bold text-slate-800 hover:bg-slate-50"
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('TyrePulse customer support')}`}
        >
          Email customer support
        </a>
      </PublicSection>
      <PublicSection title="Request a product demo">
        <p className="mb-4">Tell us about your fleet, sites and the workflows you want to improve. We will tailor the walkthrough to your operation.</p>
        <a
          className="inline-flex min-h-11 items-center rounded-xl bg-green-700 px-5 py-2.5 font-bold text-white hover:bg-green-800"
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Tyre Pulse demo request')}`}
        >
          Request a demo
        </a>
      </PublicSection>
      <PublicSection title="Service interruption">
        <p>Check <a className="font-semibold text-green-700 hover:underline" href="/status">Service Status</a> first. For safety-critical fleet events, continue using your organisation's approved operational and emergency procedures.</p>
      </PublicSection>
    </PublicTrustPage>
  )
}
