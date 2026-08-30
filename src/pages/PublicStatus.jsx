import { ExternalLink } from 'lucide-react'
import PublicTrustPage, { PublicSection } from '../components/public/PublicTrustPage'

const STATUS_URL = String(import.meta.env.VITE_STATUS_PAGE_URL || '').trim()

export default function PublicStatus() {
  return (
    <PublicTrustPage
      eyebrow="Service availability"
      title="TyrePulse service status"
      intro="This page never guesses service health. Use the monitored status service when configured, or contact support if you are experiencing an incident."
    >
      <div className={`rounded-xl border p-4 ${STATUS_URL ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`} role="status">
        <p className="font-bold text-slate-950">{STATUS_URL ? 'Live status page available' : 'Live status page is being configured'}</p>
        <p className="mt-1 text-slate-600">{STATUS_URL ? 'Open the monitored status page for current component health and incident updates.' : 'No automated service-health claim is shown until monitoring is connected.'}</p>
      </div>
      {STATUS_URL && (
        <a className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-green-700 px-5 py-2.5 font-bold text-white hover:bg-green-800" href={STATUS_URL} target="_blank" rel="noreferrer">
          Open live status <ExternalLink size={16} aria-hidden="true" />
        </a>
      )}
      <PublicSection title="Having trouble now?">
        <p>Visit <a className="font-semibold text-green-700 hover:underline" href="/support">Support</a> and include the affected workflow and approximate incident time.</p>
      </PublicSection>
    </PublicTrustPage>
  )
}
