import { useLanguage } from '../../../contexts/LanguageContext'
import BrandIcon from '../../ui/BrandIcon'

/**
 * The photo panel beside the sign-in form, in the marketing site's look:
 * asphalt and signal yellow, Archivo headline, a real site photo. It plays
 * one short entrance on load (photo settles, headline rises, yellow bar
 * draws) and stays still after that.
 */
export default function LoginHero({ logoSrc, customLogo }) {
  const { t, language, setLanguage, languages } = useLanguage()
  const p = (k, v) => t(`auth.login.page.${k}`, v)

  return (
    <section className="tpl-hero" aria-labelledby="tpl-hero-title">
      <img className="tpl-hero-bg" src="/login-art/riyadh-loader.webp" alt="" aria-hidden="true"
        width="800" height="1067" decoding="async" fetchpriority="high" />
      <div className="tpl-hero-shade" aria-hidden="true" />

      <header className="tpl-top">
        <div className="tpl-brand">
          {customLogo
            ? <span className="tpl-emblem"><BrandIcon src={logoSrc} custom chip size={24} /></span>
            : <span className="tpl-slash" aria-hidden="true" />}
          <span className="tpl-wordmark">Tyre Pulse</span>
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
        <span className="tpl-bar" aria-hidden="true" />
        <p className="tpl-lead">{p('lead')}</p>
      </div>
    </section>
  )
}
