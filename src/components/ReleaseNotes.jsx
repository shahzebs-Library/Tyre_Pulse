import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { installedRelease, visibleReleases } from '../lib/releases'

export function ReleaseNotes({ releases }) {
  const auth = useAuth()
  const { language, t } = useLanguage()
  const visible = visibleReleases(releases, auth)
  if (!visible.length) return <p className="text-xs text-[var(--text-muted)]">{t('pwa.noRelevantChanges')}</p>
  return <div className="space-y-4">
    {visible.map(release => <section key={release.id}>
      <p className="text-xs font-semibold text-[var(--text-secondary)]"><bdi>{release.id}</bdi> · <time dateTime={release.date}>{new Date(`${release.date}T12:00:00Z`).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</time></p>
      <ul className="mt-2 space-y-1 list-disc ps-5 text-sm text-[var(--text-primary)]">
        {release.changes.map((change, i) => <li key={i}>{change.text[language] || change.text.en}</li>)}
      </ul>
    </section>)}
  </div>
}

export default function UpdateHistory() {
  const { t } = useLanguage()
  const { hash } = useLocation()
  const section = useRef(null)
  useEffect(() => {
    if (hash !== '#updates' || !section.current) return
    section.current.open = true
    section.current.scrollIntoView?.({ block: 'start' })
  }, [hash])
  return <details id="updates" ref={section} className="card scroll-mt-20">
    <summary className="cursor-pointer font-semibold text-[var(--text-primary)]">{t('pwa.updateHistory')}</summary>
    <p className="mt-3 text-xs text-[var(--text-muted)]">{t('pwa.installedVersion')} <bdi>{installedRelease.releases[0].id}</bdi></p>
    <div className="mt-4"><ReleaseNotes releases={installedRelease.releases} /></div>
  </details>
}
