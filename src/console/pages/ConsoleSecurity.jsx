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
import { Link, useSearchParams } from 'react-router-dom'
import { ShieldAlert, ShieldCheck, MonitorSmartphone, Globe2, KeyRound, ArrowUpRight } from 'lucide-react'
import SecurityCenter from '../../pages/SecurityCenter'
import SsoConfiguration from '../../pages/SsoConfiguration'
import { Segmented } from '../components/ui'

const TABS = [
  { key: 'security', label: 'Security Center',   desc: 'Sessions, login history and security events', Component: SecurityCenter },
  { key: 'sso',      label: 'SSO Configuration', desc: 'SAML and OIDC identity providers',            Component: SsoConfiguration },
]

// The rest of the security controls live on their own console pages. They are
// linked here so this hub is the one place to start, without re-hosting them.
const RELATED = [
  { to: '/console/security-audit', label: 'Security audit', icon: ShieldCheck, desc: 'Posture score and open findings' },
  { to: '/console/sessions', label: 'Sessions and devices', icon: MonitorSmartphone, desc: 'Who is signed in, from where' },
  { to: '/console/access-policies', label: 'Access policies', icon: Globe2, desc: 'IP allowlist and SSO enforcement' },
  { to: '/console/api-keys', label: 'API keys', icon: KeyRound, desc: 'Machine credentials across tenants' },
]

export default function ConsoleSecurity() {
  // The active tab lives in ?tab= so a link can open SSO directly and the
  // browser back button returns to the previous tab.
  const [params, setParams] = useSearchParams()
  const tab = TABS.find(t => t.key === params.get('tab')) ?? TABS[0]
  const active = tab.key
  const setActive = (key) => {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }
  const Active = tab.Component

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            <ShieldAlert size={18} className="text-orange-400" /> Security
          </h1>
          <p className="text-xs text-gray-400 mt-1">Account security, session control and single sign-on.</p>
        </div>
      </header>

      <nav aria-label="Related security pages" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {RELATED.map((r) => {
          const Icon = r.icon
          return (
            <Link key={r.to} to={r.to}
              className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-gray-800 bg-gray-900/50 hover:bg-gray-900 hover:border-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
              <Icon size={15} className="text-orange-400 mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-xs font-medium text-gray-200">{r.label} <ArrowUpRight size={11} aria-hidden="true" /></span>
                <span className="block text-[11px] text-gray-500 mt-0.5">{r.desc}</span>
              </span>
            </Link>
          )
        })}
      </nav>

      <div className="space-y-2">
        <Segmented
          size="md"
          ariaLabel="Security sections"
          value={active}
          onChange={setActive}
          options={TABS.map((t) => ({ key: t.key, label: t.label, hint: t.desc }))}
        />
        <p className="text-xs text-gray-400">{tab.desc}</p>
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
