import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'

// Core namespaces are imported statically (never lazily) because every module
// in the app's synchronous startup graph can render before any lazy chunk
// resolves: Layout + Breadcrumbs (nav, shell, common, roles), ProtectedRoute
// (auth, common, roles), GlobalSearch + CommandPalette (ui), the PWA prompts
// (pwa) and OnboardingWizard (onboarding). `dashboard` is included because it
// is the landing route after login, so keeping it here removes the fallback
// frame from the single most-visited screen.
import authNs from '../locales/en/auth.json'
import commonNs from '../locales/en/common.json'
import dashboardNs from '../locales/en/dashboard.json'
import navNs from '../locales/en/nav.json'
import onboardingNs from '../locales/en/onboarding.json'
import pwaNs from '../locales/en/pwa.json'
import rolesNs from '../locales/en/roles.json'
import shellNs from '../locales/en/shell.json'
import uiNs from '../locales/en/ui.json'

/**
 * Web i18n for the TyrePulse PWA.
 *
 * Namespaces live as individual JSON files under `src/locales/<lang>/<ns>.json`
 * and are discovered via `import.meta.glob`. This lets many contributors (and
 * parallel agents) add translation files without ever editing a shared
 * dictionary - each file is its own namespace, so there are no merge
 * conflicts. A key is addressed as `namespace.path.to.value`.
 *
 * Only the small core set above ships in the startup bundle. The remaining
 * page-specific namespaces (~91% of the English dictionary) are fetched on
 * demand and prefetched once the app has mounted, so their JSON is neither
 * downloaded nor parsed before first paint. Every namespace those pages need
 * belongs to a lazily-routed page, which already suspends on its own larger
 * chunk, so the dictionary is in place by the time the page renders.
 *
 * Arabic switches the document to RTL (`dir="rtl"`, `lang="ar"`) so the entire
 * app mirrors; the CSS in index.css handles directional flips.
 */

export const LANGUAGES = [
  { code: 'en', label: 'English',  native: 'English', dir: 'ltr' },
  { code: 'ar', label: 'Arabic',   native: 'العربية', dir: 'rtl' },
]

const RTL_LANGS = new Set(['ar'])
const STORAGE_KEY = 'tp_language'

const EN_CORE = {
  auth: authNs,
  common: commonNs,
  dashboard: dashboardNs,
  nav: navNs,
  onboarding: onboardingNs,
  pwa: pwaNs,
  roles: rolesNs,
  shell: shellNs,
  ui: uiNs,
}

// The core files are excluded from the lazy glob on purpose. A module that is
// reachable through import.meta.glob has to stay a standalone chunk so it can
// be fetched on demand, which would split these nine small files out of the
// startup chunk into nine extra preloaded requests. Excluding them lets Rollup
// inline them where they are already statically imported.
const EN_MODULES = import.meta.glob(
  ['../locales/en/*.json',
   '!../locales/en/auth.json', '!../locales/en/common.json', '!../locales/en/dashboard.json',
   '!../locales/en/nav.json', '!../locales/en/onboarding.json', '!../locales/en/pwa.json',
   '!../locales/en/roles.json', '!../locales/en/shell.json', '!../locales/en/ui.json'],
  { import: 'default' },
)
const AR_MODULES = import.meta.glob('../locales/ar/*.json', { import: 'default' })
const MODULES = { en: EN_MODULES, ar: AR_MODULES }

const nsOf = (path) => path.split('/').pop().replace('.json', '')

/**
 * Every namespace that actually exists. This is what separates "not loaded
 * yet" from "this key is a typo": a key in a real namespace must never render
 * as a raw dotted path, while an unknown namespace keeps the long-standing
 * contract of returning the key so the mistake is visible in development.
 */
const NAMESPACES = new Set([...Object.keys(EN_CORE), ...Object.keys(EN_MODULES).map(nsOf)])

const DICTS = { en: { ...EN_CORE }, ar: {} }

/** Languages that exist but may not be loaded yet (drives setLanguage + detect). */
const KNOWN_LANGS = new Set(LANGUAGES.map((l) => l.code))

const isLoaded = (lang, ns) => Boolean(DICTS[lang] && Object.prototype.hasOwnProperty.call(DICTS[lang], ns))

// Mounted providers re-render when a namespace lands. A module-level listener
// set is used because translate() is also callable outside a provider.
const listeners = new Set()
const notify = () => { for (const fn of listeners) fn() }

const inFlight = new Map()

/**
 * Fetch one namespace for one language. Deduped, and never rejects: a failed
 * chunk must degrade to the English fallback rather than break the screen.
 */
function requestNamespace(lang, ns) {
  if (isLoaded(lang, ns)) return Promise.resolve(true)
  const cacheKey = `${lang}:${ns}`
  const pending = inFlight.get(cacheKey)
  if (pending) return pending
  const load = MODULES[lang]?.[`../locales/${lang}/${ns}.json`]
  if (!load) return Promise.resolve(false)
  const p = load()
    .then((mod) => {
      if (!DICTS[lang]) DICTS[lang] = {}
      DICTS[lang][ns] = mod
      notify()
      return true
    })
    .catch(() => {
      // Allow a retry on the next render rather than caching the failure.
      inFlight.delete(cacheKey)
      return false
    })
  inFlight.set(cacheKey, p)
  return p
}

/** Warm every remaining namespace for a language so navigation never waits. */
function prefetchAll(lang) {
  const mods = MODULES[lang]
  if (!mods) return Promise.resolve()
  return Promise.all(Object.keys(mods).map((path) => requestNamespace(lang, nsOf(path))))
}

function resolve(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function interpolate(str, vars) {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
}

/**
 * Readable stand-in for a key whose namespace is real but still in flight.
 * These key segments are descriptive camelCase, so `totalSpend` reads as
 * "Total Spend" - a plausible label for the frame or two before the real
 * string arrives, rather than a raw `intake.upload.totalSpend` path that a
 * user would read as a bug.
 */
function humanize(key) {
  const last = key.slice(key.lastIndexOf('.') + 1)
  const words = last.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

// Standalone translator shared by the provider and the no-provider fallback so
// components render real English strings even if mounted outside a provider
// (e.g. isolated unit tests).
function translate(language, key, vars) {
  if (!key) return ''

  const dot = key.indexOf('.')
  const ns = dot > 0 ? key.slice(0, dot) : ''
  const known = ns !== '' && NAMESPACES.has(ns)

  if (known) {
    if (!isLoaded(language, ns)) requestNamespace(language, ns)
    // English backs every other language, so it has to be present as well.
    if (language !== 'en' && !isLoaded('en', ns)) requestNamespace('en', ns)
  }

  let val = resolve(DICTS[language] || DICTS.en, key)
  if (typeof val !== 'string') val = resolve(DICTS.en, key)
  if (typeof val !== 'string') {
    // A real namespace that has not landed yet is a timing gap, not a typo.
    return known && !isLoaded('en', ns) ? humanize(key) : key
  }
  return interpolate(val, vars)
}

const LanguageContext = createContext(null)

function detectInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    // KNOWN_LANGS, not DICTS: Arabic is a valid saved choice before it loads.
    if (saved && KNOWN_LANGS.has(saved)) return saved
  } catch { /* ignore */ }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en'
  return nav.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(detectInitial)
  // Bumped when a lazily-loaded namespace arrives, so `t` is recreated and the
  // tree re-renders with the real strings instead of the fallback.
  const [dictVersion, setDictVersion] = useState(0)

  const isRTL = RTL_LANGS.has(language)

  // Re-render this provider whenever any namespace resolves, including ones
  // requested from inside translate() during a child's render.
  useEffect(() => {
    const onLoad = () => setDictVersion((v) => v + 1)
    listeners.add(onLoad)
    return () => { listeners.delete(onLoad) }
  }, [])

  // Warm the rest of the dictionary after mount. English is deferred to idle
  // time because nothing on screen is waiting for it; a non-English language is
  // fetched immediately so the whole page flips together instead of key by key.
  useEffect(() => {
    if (language !== 'en') prefetchAll(language)
    let idle = null
    let timer = null
    const run = () => { prefetchAll('en') }
    if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(run, { timeout: 2000 })
    else timer = setTimeout(run, 300)
    return () => {
      if (idle != null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle)
      if (timer != null) clearTimeout(timer)
    }
  }, [language])

  // Reflect language + direction on the document so global CSS and the browser
  // apply correct text direction and Arabic-capable typography.
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('lang', language)
    root.setAttribute('dir', isRTL ? 'rtl' : 'ltr')
    root.classList.toggle('rtl', isRTL)
    try { localStorage.setItem(STORAGE_KEY, language) } catch { /* ignore */ }
  }, [language, isRTL])

  const setLanguage = useCallback((lang) => {
    // Accept any KNOWN language, not only a loaded one: dictionaries are
    // fetched on demand by the effect above and would otherwise be unselectable.
    if (KNOWN_LANGS.has(lang)) setLanguageState(lang)
  }, [])

  // t('ns.key', { vars }) -> localized string; falls back to English, then the key.
  // dictVersion is a dependency so `t` is re-created once a lazy namespace
  // lands and consumers re-render with the translated strings.
  const t = useCallback((key, vars) => translate(language, key, vars), [language, dictVersion])

  const value = useMemo(() => ({ language, isRTL, setLanguage, t, languages: LANGUAGES }),
    [language, isRTL, setLanguage, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    // Safe fallback so components never crash if used outside the provider.
    return { language: 'en', isRTL: false, setLanguage: () => {}, t: (k, v) => translate('en', k, v), languages: LANGUAGES }
  }
  return ctx
}
