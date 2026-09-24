/**
 * ConsoleSecurity - super-admin security hub.
 *
 * The route (/console/security in App.jsx) is bridge-wrapped in
 * <ConsoleAuthBridge>, so the main-app useAuth() resolves to a super-admin value
 * inside this tree and the main-app admin pages render directly. This hub simply
 * frames two of them under one roof:
 *   - SecurityCenter    (sessions, login history, security events)
 *   - SsoConfiguration  (SAML / OIDC identity providers)
 *
 * No logic is re-implemented here; each tab renders the canonical page verbatim.
 */
import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import SecurityCenter from '../../pages/SecurityCenter'
import SsoConfiguration from '../../pages/SsoConfiguration'
import { Segmented } from '../components/ui'

const TABS = [
  { key: 'security', label: 'Security Center',   desc: 'Sessions, login history and security events', Component: SecurityCenter },
  { key: 'sso',      label: 'SSO Configuration', desc: 'SAML and OIDC identity providers',            Component: SsoConfiguration },
]

export default function ConsoleSecurity() {
  const [active, setActive] = useState('security')
  const tab = TABS.find(t => t.key === active) ?? TABS[0]
  const Active = tab.Component

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            <ShieldAlert size={18} className="text-orange-400" /> Security
          </h1>
          <p className="text-xs text-gray-500 mt-1">Account security, session control and single sign-on.</p>
        </div>
      </header>

      <div className="space-y-2">
        <Segmented
          size="md"
          value={active}
          onChange={setActive}
          options={TABS.map((t) => ({ key: t.key, label: t.label, hint: t.desc }))}
        />
        <p className="text-xs text-gray-500">{tab.desc}</p>
      </div>

      {/* The hosted pages render on the console surface, as they do under Access
          Control. They used to sit in a hard-coded white frame, but inside
          .console-root the theme tokens (and the console h1 rule) are the dark
          console palette, so their titles and body text were near-white on white. */}
      <div role="tabpanel" aria-label={tab.label}>
        <Active />
      </div>
    </div>
  )
}
