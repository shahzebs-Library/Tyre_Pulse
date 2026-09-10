import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useWorkspaceNavigation } from '../contexts/WorkspaceNavigationContext'
import { governingModuleKey } from '../lib/navAccess'
import { moduleAvailable, WORKSPACE_COUNTS } from '../lib/workspaceAccess'
import { loadWorkspaceCount } from '../lib/api/workspace'

export default function MyWorkspace() {
  const auth = useAuth()
  const { activeCountry } = useSettings()
  const navigation = useWorkspaceNavigation()
  const modules = navigation.filter(item => item.to !== '/' && moduleAvailable(auth, governingModuleKey(item.to)))
  const summaries = moduleAvailable(auth, 'dashboard')
  const scope = JSON.stringify([auth.profile?.id, auth.profile?.role, auth.profile?.country, auth.profile?.site, auth.profile?.sites, activeCountry, summaries, modules.map(item => item.to)])
  return <Workspace key={scope} modules={modules} summaries={summaries} profile={auth.profile} country={activeCountry} />
}

function Workspace({ modules, summaries, profile, country }) {
  const { t } = useLanguage()
  const [counts, setCounts] = useState({})
  const [attempt, setAttempt] = useState(0)
  const profileId = profile?.id
  const keys = [...new Set(modules.map(item => governingModuleKey(item.to)).filter(key => WORKSPACE_COUNTS[key]))].sort().join(',')
  useEffect(() => {
    if (!summaries || !keys) return
    const controller = new AbortController()
    setCounts({})
    for (const key of keys.split(',')) {
      loadWorkspaceCount(key, { country, profile: { id: profileId }, signal: controller.signal })
        .then(count => { if (!controller.signal.aborted) setCounts(old => ({ ...old, [key]: { count } })) })
        .catch(() => { if (!controller.signal.aborted) setCounts(old => ({ ...old, [key]: { error: true } })) })
    }
    return () => controller.abort()
  }, [summaries, keys, country, profileId, attempt])
  return <div className="space-y-5">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold text-[var(--text-primary)]">My Workspace</h1><p className="text-sm text-[var(--text-secondary)] mt-1">Open your available modules. Records follow your assigned country and sites.</p></div>{summaries && keys && <button className="btn-secondary" onClick={() => setAttempt(value => value + 1)}>Refresh summaries</button>}</div>
    {!modules.length && <div className="card">No operational modules are currently available for your account. Contact your administrator to assign access.</div>}
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{modules.map(item => {
      const key = governingModuleKey(item.to), metric = WORKSPACE_COUNTS[key], result = counts[key]
      const Icon = item.icon
      return <Link key={item.to} to={item.to} className="card block hover:border-green-500 focus-visible:outline focus-visible:outline-green-500">
        <div className="flex items-center gap-3">{Icon && <Icon size={21} aria-hidden="true" />}<h2 className="font-semibold">{t(item.label)}</h2></div>
        {summaries && metric && <p className="text-sm mt-3 text-[var(--text-secondary)]">{metric.label}: {result?.error ? 'Unavailable — open module to retry' : result ? result.count.toLocaleString() : 'Loading...'}</p>}
      </Link>
    })}</div>
    <Link to="/settings" className="btn-secondary inline-block">Settings</Link>
  </div>
}
