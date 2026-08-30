import PublicTrustPage, { PublicSection } from '../components/public/PublicTrustPage'

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'info@tyrepulse.app'

export default function Terms() {
  return (
    <PublicTrustPage
      eyebrow="Legal"
      title="Terms of Service"
      intro="These terms describe the basic rules for using TyrePulse. Your organisation's signed agreement takes priority where it contains different terms."
    >
      <PublicSection title="Authorised workplace use">
        <p>Use TyrePulse only for the organisation and responsibilities assigned to your account. Keep credentials private, use accurate operational data, and do not attempt to access another organisation's records.</p>
      </PublicSection>
      <PublicSection title="Organisation administrators">
        <p>Your organisation controls user approval, roles, sites, retention requirements and the operational records entered by its users. Administrators are responsible for removing access promptly when a user changes role or leaves.</p>
      </PublicSection>
      <PublicSection title="Service and availability">
        <p>Planned maintenance and incidents may temporarily affect availability. Do not use TyrePulse as the sole emergency communication or life-safety system. Report service-impacting problems through the support channel below.</p>
      </PublicSection>
      <PublicSection title="Acceptable use">
        <p>Do not upload unlawful content, malware, unnecessary sensitive personal information, or attempt to bypass access controls, rate limits, tenant isolation or security monitoring.</p>
      </PublicSection>
      <PublicSection title="Privacy and account closure">
        <p>Our <a className="font-semibold text-green-700 hover:underline" href="/privacy">Privacy Policy</a> explains data handling. Account and data-deletion requests are available at <a className="font-semibold text-green-700 hover:underline" href="/data-deletion">Data Deletion</a>.</p>
      </PublicSection>
      <PublicSection title="Questions">
        <p>Contact <a className="font-semibold text-green-700 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. These terms should be reviewed with your organisation's final commercial agreement and applicable law before public launch.</p>
      </PublicSection>
    </PublicTrustPage>
  )
}
