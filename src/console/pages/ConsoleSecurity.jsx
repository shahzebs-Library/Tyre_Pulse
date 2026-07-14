/**
 * ConsoleSecurity — super-admin security hub.
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
import { ShieldAlert, KeyRound, Fingerprint } from 'lucide-react'
import SecurityCenter from '../../pages/SecurityCenter'
import SsoConfiguration from '../../pages/SsoConfiguration'

const TABS = [
  { key: 'security', label: 'Security Center', icon: Fingerprint, desc: 'Sessions, login history and security events', Component: SecurityCenter },
  { key: 'sso',      label: 'SSO Configuration', icon: KeyRound,  desc: 'SAML and OIDC identity providers', Component: SsoConfiguration },
]

export default function ConsoleSecurity() {
  const [active, setActive] = useState('security')
  const tab = TABS.find(t => t.key === active) ?? TABS[0]
  const Active = tab.Component

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg bg-red-900/30 border border-red-800/40 flex items-center justify-center">
          <ShieldAlert size={17} className="text-red-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Security</h1>
          <p className="text-sm text-gray-500 mt-0.5">Account security, session control and single sign-on</p>
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex flex-wrap gap-2 border-b border-gray-800 pb-3">
        {TABS.map(t => {
          const Icon = t.icon
          const on = t.key === active
          return (
            <button key={t.key} role="tab" aria-selected={on} onClick={() => setActive(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors border ${
                on ? 'bg-orange-950/50 text-orange-300 border-orange-800/50'
                   : 'bg-gray-900/40 text-gray-400 border-gray-800 hover:text-white'
              }`}>
              <Icon size={13} />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-gray-600 -mt-2">{tab.desc}</p>

      {/* Panel — main-app pages are light-themed; frame them on a light surface */}
      <div role="tabpanel" aria-label={tab.label}
        className="rounded-2xl bg-white text-gray-900 border border-gray-200 shadow-sm overflow-hidden">
        <Active />
      </div>
    </div>
  )
}
