import { useLanguage } from '../../../contexts/LanguageContext'
import BrandIcon from '../../ui/BrandIcon'
import { formatCount } from './loginContent'

/**
 * The brand panel beside the sign-in form. Deliberately quiet: the logo, one
 * headline, a single heartbeat line that draws once, and the three live
 * platform figures. Figures come from the live showcase RPC; a figure the
 * platform could not read renders N/A, never an invented number.
 */
export default function LoginHero({ logoSrc, customLogo, showcase }) {
  const { t, language, setLanguage, languages } = useLanguage()
  const p = (k, v) => t(`auth.login.page.${k}`, v)
  const na = p('stats.na')
  const stats = [
    { key: 'vehicles', value: formatCount(showcase?.vehicles, language) },
    { key: 'sites', value: formatCount(showcase?.sites, language) },
    { key: 'users', value: formatCount(showcase?.users, language) },
  ]

  return (
    <section className="tpl-hero" aria-labelledby="tpl-hero-title">
      <header className="tpl-top">
        <div className="tpl-brand">
          <span className="tpl-emblem">
            <BrandIcon src={logoSrc} custom={customLogo} chip={customLogo} size={24} />
          </span>
          <span className="tpl-wordmark" role="img" aria-label="TyrePulse" data-a="Tyre" data-b="Pulse" />
        </div>
        <div className="tpl-lang" role="group" aria-label={p('language')}>
          {languages.map(l => (
            <button key={l.code} type="button" lang={l.code}
              aria-pressed={language === l.code}
              onClick={() => setLanguage(l.code)}>
              {l.code === 'ar' ? 'عربي' : 'English'}
            </button>
          ))}
        </div>
      </header>

      <div className="tpl-hero-body">
        <h1 id="tpl-hero-title" className="tpl-title">{p('heroTitle')}</h1>
        <p className="tpl-lead">{p('lead')}</p>

        <svg className="tpl-pulse" viewBox="0 0 600 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 34 H210 L228 34 L240 10 L256 54 L270 22 L282 34 H600" />
        </svg>

        <dl className="tpl-stats">
          {stats.map(({ key, value }) => (
            <div key={key} className="tpl-stat">
              <dt>{p(`stats.${key}`)}</dt>
              <dd>{value ?? na}</dd>
            </div>
          ))}
        </dl>
      </div>

      <img className="tpl-hero-bg" src="/login-art/hero-lineup.webp" alt="" aria-hidden="true"
        width="1200" height="434" decoding="async" />
    </section>
  )
}
