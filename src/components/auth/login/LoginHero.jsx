import { MapPin, Truck, Building2, Users } from 'lucide-react'
import { useLanguage } from '../../../contexts/LanguageContext'
import BrandIcon from '../../ui/BrandIcon'
import { INDUSTRIES, CAPABILITIES, NAV_LINKS, MARKETING_URL, formatCount } from './loginContent'

/**
 * The dark photographic hero on the sign-in page. It stays dark in BOTH themes
 * (a photo band); only the sign-in card flips. Figures come from the live
 * showcase RPC; a figure the platform could not read renders N/A, never an
 * invented number.
 */
export default function LoginHero({ logoSrc, customLogo, showcase }) {
  const { t, language, setLanguage, languages } = useLanguage()
  const p = (k, v) => t(`auth.login.page.${k}`, v)
  const na = p('stats.na')
  const stats = [
    { key: 'vehicles', icon: Truck, value: formatCount(showcase?.vehicles, language) },
    { key: 'sites', icon: Building2, value: formatCount(showcase?.sites, language) },
    { key: 'users', icon: Users, value: formatCount(showcase?.users, language) },
  ]
  const countries = showcase?.countries || []
  const countryName = (c) => {
    const k = `auth.login.page.countryNames.${c}`
    const v = t(k)
    return v && v !== k && !/countryNames/.test(v) ? v : c
  }

  return (
    <section className="tpl-hero" aria-labelledby="tpl-hero-title">
      <img className="tpl-hero-bg" src="/login-art/hero-lineup.webp" alt="" aria-hidden="true"
        width="1200" height="434" decoding="async" />
      <div className="tpl-hero-shade" aria-hidden="true" />

      <header className="tpl-top">
        <div className="tpl-brand">
          <span className="tpl-emblem">
            <BrandIcon src={logoSrc} custom={customLogo} chip={customLogo} size={26} />
          </span>
          <span className="tpl-brand-text">
            <span className="tpl-wordmark" role="img" aria-label="TyrePulse" data-a="Tyre" data-b="Pulse" />
            <span className="tpl-brand-sub">{p('fleetIntelligence')}</span>
          </span>
        </div>
        <nav className="tpl-nav" aria-label={p('navLabel')}>
          {NAV_LINKS.map(l => (
            <a key={l.key} href={`${MARKETING_URL}${l.path}`}>{p(`nav.${l.key}`)}</a>
          ))}
        </nav>
        <div className="tpl-lang" role="group" aria-label={p('language')}>
          {languages.map(l => (
            <button key={l.code} type="button" lang={l.code}
              aria-pressed={language === l.code}
              onClick={() => setLanguage(l.code)}>
              {l.code === 'ar' ? 'AR' : 'EN'}
            </button>
          ))}
        </div>
      </header>

      <div className="tpl-hero-body">
        <p className="tpl-eyebrow">{p('eyebrow')}</p>
        <h1 id="tpl-hero-title" className="tpl-title">
          {p('titleLead')} <span>{p('titleAccent')}</span>
        </h1>
        <p className="tpl-lead">{p('lead')}</p>

        <h2 className="tpl-sr">{p('industriesHeading')}</h2>
        <ul className="tpl-industries">
          {INDUSTRIES.map(({ key, icon: Icon, photo }) => (
            <li key={key} className="tpl-ind">
              <img src={photo} alt="" width="480" height="300" loading="lazy" decoding="async" />
              <span className="tpl-ind-icon" aria-hidden="true"><Icon size={14} /></span>
              <div className="tpl-ind-body">
                <span className="tpl-ind-title">{p(`industries.${key}.title`)}</span>
                <span className="tpl-ind-sub">{p(`industries.${key}.sub`)}</span>
              </div>
            </li>
          ))}
        </ul>

        <div className="tpl-mid">
          <div className="tpl-countries">
            <h2 className="tpl-mini-h">{p('countriesHeading')}</h2>
            {countries.length ? (
              <ul>
                {countries.map(c => (
                  <li key={c}><MapPin size={14} aria-hidden="true" />{countryName(c)}</li>
                ))}
              </ul>
            ) : <p className="tpl-muted">{p('countriesEmpty')}</p>}
          </div>
          <div className="tpl-stats">
            <h2 className="tpl-sr">{p('statsHeading')}</h2>
            {stats.map(({ key, icon: Icon, value }) => (
              <div key={key} className="tpl-stat">
                <Icon size={18} aria-hidden="true" />
                <span className="tpl-stat-num">{value ?? na}</span>
                <span className="tpl-stat-label">{p(`stats.${key}`)}</span>
              </div>
            ))}
          </div>
        </div>

        <h2 className="tpl-mini-h tpl-caps-h">{p('capabilitiesHeading')}</h2>
        <ul className="tpl-caps">
          {CAPABILITIES.map(({ key, icon: Icon }) => (
            <li key={key}>
              <span className="tpl-cap-icon"><Icon size={16} aria-hidden="true" /></span>
              <span className="tpl-cap-title">{p(`capabilities.${key}.title`)}</span>
              <span className="tpl-cap-sub">{p(`capabilities.${key}.sub`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
