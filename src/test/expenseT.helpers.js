// English translator for render tests of the expense screens.
//
// Locale namespaces are lazy-loaded at runtime, so a component rendered outside
// a LanguageProvider would only ever show a key path or a humanized stand-in.
// Tests mock useLanguage with this instead: it resolves `ns.key` from the real
// English dictionaries (with {var} interpolation) and returns an unknown key
// unchanged, as the identity mocks it replaces did.
const EN = Object.fromEntries(
  Object.entries(import.meta.glob('../locales/en/*.json', { eager: true, import: 'default' }))
    .map(([p, mod]) => [p.slice(p.lastIndexOf('/') + 1, -5), mod]),
)

export function expenseT(key, vars) {
  if (typeof key !== 'string') return key
  let cur = EN
  for (const part of key.split('.')) {
    cur = cur && typeof cur === 'object' ? cur[part] : undefined
  }
  if (typeof cur !== 'string') return key
  if (!vars) return cur
  return cur.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
}
