import { Link, useSearchParams } from 'react-router-dom'
import { Home, BookOpen, Inbox, AlertTriangle, UserPlus, History, Search } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'

export default function HelpNavigation() {
  const { t } = useLanguage()
  const [params, setParams] = useSearchParams()
  const section = params.get('section') || 'overview'
  const links = [
    ['overview', Home], ['guides', BookOpen], ['tickets', Inbox],
    ['problems', AlertTriangle, '/my-problems'], ['access', UserPlus, '/request-access'], ['updates', History, '/settings?tab=about'],
  ]
  return <div className="tp-help-navigation">
    <label className="tp-module-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label={t('shell.helpHub.findTopic')} placeholder={t('shell.helpHub.findTopic')} value={params.get('q') || ''}
      onChange={event => { const next = new URLSearchParams(params); next.set('section', 'guides'); next.set('q', event.target.value); setParams(next, { replace: true }) }} /></label>
    <div className="mt-4 space-y-1">
      {links.map(([key, Icon, path]) => <Link key={key} to={path || `/help?section=${key}`}
        aria-current={!path && section === key ? 'page' : undefined}>
        <Icon size={17} aria-hidden="true" /><span>{t(`shell.helpHub.nav.${key}`)}</span>
      </Link>)}
    </div>
    <p className="tp-help-navigation-note">{t('shell.helpHub.sidebarNote')}</p>
  </div>
}
