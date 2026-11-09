// Synchronous English translator for workforce component tests rendered without a
// LanguageProvider. The real provider loads the workforce namespace lazily, so the first
// render would otherwise show placeholder labels.
import en from '../locales/en/workforce.json'

const resolve = key => key.split('.').slice(1).reduce((o, p) => (o == null ? undefined : o[p]), en)

export const workforceT = (key, vars) => {
  const val = String(key).startsWith('workforce.') ? resolve(key) : undefined
  if (typeof val !== 'string') return key
  return vars ? val.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : val
}

export async function mockWorkforceLanguage (importOriginal) {
  const actual = await importOriginal()
  return { ...actual, useLanguage: () => ({ language: 'en', isRTL: false, setLanguage: () => {}, t: workforceT, languages: actual.LANGUAGES }) }
}
