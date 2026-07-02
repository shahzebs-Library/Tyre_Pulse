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

const EN = loadDict(import.meta.glob('../locales/en/*.json', { eager: true, import: 'default' }))
const AR = loadDict(import.meta.glob('../locales/ar/*.json', { eager: true, import: 'default' }))

const DICTS = { en: EN, ar: AR }

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
    if (saved && DICTS[saved]) return saved
  } catch { /* ignore */ }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en'
  return nav.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(detectInitial)

  const isRTL = RTL_LANGS.has(language)

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
    if (DICTS[lang]) setLanguageState(lang)
  }, [])

  // t('ns.key', { vars }) → localized string; falls back to English, then the key.
  const t = useCallback((key, vars) => translate(language, key, vars), [language])

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
