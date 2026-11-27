/**
 * Translator for the warehouse floor helpers (namespace `wmsmsgfloor`).
 *
 * textFn(t) returns the caller's `t`, or English when there is none. The one
 * gap it leaves: the first time a screen builds a message, the `wmsmsgfloor`
 * dictionary may still be loading, and `t` then answers with a humanized key
 * ("Only Free") or the key itself. A validation message is stored in state
 * once, so that placeholder would stay on screen. This wrapper falls back to
 * the English sentence in that case instead.
 */
import { enText, textFn } from '../wmsText'

const humanize = (key) => {
  const last = key.slice(key.lastIndexOf('.') + 1)
  const words = last.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

/** `(key, vars) => string` for wmsmsgfloor keys; English without `t`. */
export function floorText(t) {
  const tx = textFn(t)
  if (tx === enText) return enText
  return (key, vars) => {
    const v = tx(key, vars)
    if (typeof v !== 'string' || !v || v === key || v === humanize(key)) return enText(key, vars)
    return v
  }
}

/**
 * Ask for the wmsmsgfloor dictionary early (call during render) so it is
 * loaded by the time a message is built. Returns nothing useful.
 */
export function warmFloorText(t) {
  if (typeof t === 'function') t('wmsmsgfloor.common.na')
}
