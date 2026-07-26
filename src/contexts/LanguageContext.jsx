import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'

/**
 * Web i18n for the TyrePulse PWA.
 *
 * Namespaces live as individual JSON files under `src/locales/<lang>/<ns>.json`
 * and are merged at build time via `import.meta.glob`. This lets many
 * contributors (and parallel agents) add translation files without ever editing
 * a shared dictionary — each file is its own namespace, so there are no merge
 * conflicts. A key is addressed as `namespace.path.to.value`.
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

// Eagerly import every namespace file for each language and fold them into a
// single object keyed by namespace (the file basename).
function loadDict(glob) {
  const out = {}
  for (const [path, mod] of Object.entries(glob)) {
    const ns = path.split('/').pop().replace('.json', '')
    out[ns] = mod
  }
  return out
}

// English is EAGER: it is the default language and the fallback for every
// missing key, so it must be resolvable synchronously from the first render.
const EN = loadDict(import.meta.glob('../locales/en/*.json', { eager: true, import: 'default' }))

// Arabic is LAZY. Both dictionaries together are ~764 KB of JSON across 114
// files; shipping and parsing both on every startup cost every user the weight
// of a language they are not using. Arabic now loads only when it is actually
// selected, which takes that off the critical path for the default case.
// Until it resolves, translate() falls back to English exactly as it already
// does for a missing key, so nothing renders blank.
const AR_MODULES = import.meta.glob('../locales/ar/*.json', { import: 'default' })

const DICTS = { en: EN }
/** Languages that exist but may not be loaded yet (drives setLanguage + detect). */
const KNOWN_LANGS = new Set(LANGUAGES.map((l) => l.code))

let arLoading = null
/** Load the Arabic dictionary once; resolves to true when it becomes available. */
function loadArabic() {
  if (DICTS.ar) return Promise.resolve(true)
  if (!arLoading) {
    arLoading = Promise.all(
      Object.entries(AR_MODULES).map(([path, load]) =>
        load().then((mod) => [path.split('/').pop().replace('.json', ''), mod])),
    )
      .then((pairs) => {
        DICTS.ar = Object.fromEntries(pairs)
        return true
      })
      .catch(() => {
        // Keep English rather than breaking the UI if a chunk fails to load.
        arLoading = null
        return false
      })
  }
  return arLoading
}

function resolve(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function interpolate(str, vars) {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
}

// Standalone translator shared by the provider and the no-provider fallback so
// components render real English strings even if mounted outside a provider
// (e.g. isolated unit tests).
function translate(language, key, vars) {
  if (!key) return ''
  let val = resolve(DICTS[language] || DICTS.en, key)
  if (typeof val !== 'string') val = resolve(DICTS.en, key)
  if (typeof val !== 'string') return key
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
  // Bumped when a lazily-loaded dictionary arrives, so `t` is recreated and the
  // tree re-renders with the real strings instead of the English fallback.
  const [dictVersion, setDictVersion] = useState(0)

  const isRTL = RTL_LANGS.has(language)

  // Pull in the Arabic dictionary whenever Arabic is active and not yet loaded.
  useEffect(() => {
    if (language !== 'ar' || DICTS.ar) return
    let cancelled = false
    loadArabic().then((ok) => { if (ok && !cancelled) setDictVersion((v) => v + 1) })
    return () => { cancelled = true }
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
    // Accept any KNOWN language, not only a loaded one: Arabic is fetched on
    // demand by the effect above and would otherwise be unselectable.
    if (KNOWN_LANGS.has(lang)) setLanguageState(lang)
  }, [])

  // t('ns.key', { vars }) → localized string; falls back to English, then the key.
  // dictVersion is a dependency so `t` is re-created once a lazy dictionary
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
