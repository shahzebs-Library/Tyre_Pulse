import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, CircleDot, Wrench, User, ChevronRight, Lock, RefreshCw, Inbox } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { listTickets } from '../../lib/api/support'
import { listMyIssues } from '../../lib/api/userIssues'
import { recentHelpRequests, availableHelpGuides } from '../../lib/helpHub'
import { statusLabel } from '../../lib/problemReport'

export default function HelpOverview({ paths, onGuide, onTickets, renderFaq, refreshKey = 0 }) {
  const { user, profile } = useAuth() || {}
  const { t, language } = useLanguage()
  const uid = user?.id || profile?.id
  const [state, setState] = useState({ uid: null, loading: true, rows: [], failures: [] })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    setState({ uid, loading: Boolean(uid), rows: [], failures: [] })
    if (!uid) return () => { alive = false }
    Promise.allSettled([listTickets({ mine: true, limit: 5 }), listMyIssues(uid, { limit: 5 })]).then(results => {
      if (!alive) return
      const failures = results.flatMap((result, index) => result.status === 'rejected' ? [index === 0 ? 'tickets' : 'problems'] : [])
      setState({ uid, loading: false, rows: recentHelpRequests(results[0].status === 'fulfilled' ? results[0].value : [], results[1].status === 'fulfilled' ? results[1].value : []), failures })
    })
    return () => { alive = false }
  }, [uid, retry, refreshKey])
  const current = state.uid === uid ? state : { loading: true, rows: [], failures: [] }
  const icons = { inspections: ClipboardCheck, tyres: CircleDot, workshop: Wrench, account: User }
  return <div className="tp-help-columns">
    <div className="tp-help-main-column">
      <section className="tp-help-section"><h2>{t('shell.helpHub.startGuide')}</h2>
        <div className="tp-help-guides">{availableHelpGuides(paths).map(guide => {
          const Icon = icons[guide.id]
          return <button key={guide.id} type="button" onClick={() => onGuide(guide.category)}><span className="tp-help-guide-icon"><Icon size={23} /></span><span className="min-w-0 flex-1"><strong>{t(`shell.helpHub.guide.${guide.title}`)}</strong><span>{t(`shell.helpHub.guide.${guide.title}Description`)}</span></span><ChevronRight size={18} className="rtl-flip" /></button>
        })}</div>
      </section>
      <section className="tp-help-section"><h2>{t('shell.helpHub.commonQuestions')}</h2>{renderFaq()}</section>
    </div>
    <div className="tp-help-secondary-column">
      <section className="tp-help-section" aria-label={t('shell.helpHub.recent')}>
        <div className="tp-help-section-title"><h2>{t('shell.helpHub.recent')}</h2><button type="button" onClick={() => onTickets()}>{t('shell.helpHub.viewTickets')} <ChevronRight size={14} className="rtl-flip" /></button></div>
        {current.loading && <p role="status">{t('shell.helpHub.loading')}</p>}
        {current.failures.length > 0 && <div className="tp-help-load-error" role="alert"><p>{t('shell.helpHub.partialError')}</p><button type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} /> {t('shell.helpHub.retry')}</button></div>}
        {!current.loading && !current.failures.length && !current.rows.length && <div className="tp-help-no-requests"><Inbox size={25} /><p>{t('shell.helpHub.noRequests')}</p><span>{t('shell.helpHub.noRequestsHint')}</span></div>}
        <ul className="tp-help-recent-list">{current.rows.map(row => <li key={row.id}>
          <div className="tp-help-request-head"><strong>{row.title}</strong><span className="tp-help-status">{row.source === 'problem' ? statusLabel(row.status) : t(`shell.helpHub.status.${row.status}`)}</span></div>
          <div className="tp-help-request-meta"><span>{t(`shell.helpHub.source.${row.source}`)}</span><time>{row.updated ? new Date(row.updated).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-GB') : t('shell.helpHub.dateUnavailable')}</time></div>
          {row.source === 'ticket' ? <button type="button" onClick={() => onTickets(row.id.slice('ticket:'.length))}>{t('shell.helpHub.viewRequest')} <ChevronRight size={14} className="rtl-flip" /></button> : <Link to={`/my-problems?issue=${encodeURIComponent(row.id.slice('problem:'.length))}`}>{t('shell.helpHub.viewUpdate')} <ChevronRight size={14} className="rtl-flip" /></Link>}
        </li>)}</ul>
        <Link className="tp-help-all-problems" to="/my-problems">{t('shell.helpHub.nav.problems')} <ChevronRight size={14} className="rtl-flip" /></Link>
      </section>
      <section className="tp-help-access"><Lock size={26} /><div><h2>{t('shell.helpHub.accessTitle')}</h2><p>{t('shell.helpHub.accessDescription')}</p><Link to="/request-access">{t('shell.helpHub.nav.access')}</Link></div></section>
    </div>
  </div>
}
