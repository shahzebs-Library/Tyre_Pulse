/**
 * Workshop Status -> English, ASCII-only text for PDF exports (Loop 14).
 *
 * jsPDF's built-in fonts cannot shape Arabic, and report output is ASCII only
 * (owner rule), so PDF labels always come from the ENGLISH locale whatever the
 * screen language. Excel keeps the on-screen language (it renders any script).
 * Pure: the caller passes the English dictionary in.
 */

const TYPO = [
  [/[–—−]/g, '-'],
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/…/g, '...'],
  [/[   ]/g, ' '],
  [/[→←]/g, '-'],
  [/·/g, '|'],
]

/** Fold typographic punctuation to ASCII. Non-text values pass through. */
export function toAscii(v) {
  if (typeof v !== 'string') return v
  let s = v
  for (const [re, to] of TYPO) s = s.replace(re, to)
  return s
}

function lookup(dict, path) {
  let cur = dict
  for (const part of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

/**
 * A t-like function over one English namespace. `prefix` scopes keys
 * (e.g. 'active'); `{name}` placeholders are filled from vars. A missing key
 * returns the key itself, so a gap is visible rather than blank.
 */
export function makeEnglishT(dict, prefix = '') {
  return (key, vars) => {
    const path = prefix ? `${prefix}.${key}` : key
    let s = lookup(dict, path)
    if (s == null) return key
    if (vars && typeof vars === 'object') {
      s = s.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (m, name) => (vars[name] == null ? m : String(vars[name])))
    }
    return toAscii(s)
  }
}
