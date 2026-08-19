/**
 * savedSignature - the rules around a person's own remembered signature.
 *
 * WHAT THIS IS FOR. Until V601 every approval asked the approver to draw their
 * signature again from nothing, every single time. 379 inspections have been
 * approved on this system and every one of those marks was drawn on the spot.
 * A saved signature removes the redrawing and NOTHING ELSE: it is loaded into
 * the pad, it is shown, and the person still presses Approve. Pre-filling is
 * not signing.
 *
 * Pure on purpose - no Supabase, no React - so the rules that decide whether a
 * stored value is usable can be tested without a database or a canvas.
 */

/**
 * Mirrors `user_signatures_len_chk` in V601. Kept in step with the database on
 * purpose: a value the column would refuse must be refused here too, or the
 * screen offers to save something the server throws away.
 */
export const SIGNATURE_MAX_LEN = 200000

/**
 * The one place that decides whether a value is a signature we can store or
 * hand to an approval RPC.
 *
 * Both capture formats are accepted deliberately. `SignatureCapture` (and the
 * field app) emit self-contained `<svg>` markup; the canvas `SignaturePad`
 * emits a `data:image/...` URL. `signatureSrc()` in SignatureView already
 * renders both, so refusing one here would make a signature drawn on one screen
 * unusable on another.
 *
 * @param {unknown} value
 * @returns {string|null} the value to store, or null when there is nothing usable
 */
export function normaliseSignature(value) {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  if (s.length > SIGNATURE_MAX_LEN) return null
  const head = s.slice(0, 5).toLowerCase()
  if (head.startsWith('<svg')) return s
  if (head === 'data:') return s
  // Anything else is not a mark this app draws. Storing it would put an
  // arbitrary string in front of a reader as though it were a signature.
  return null
}

/** True when a value would render as an actual signature. */
export function isUsableSignature(value) {
  return normaliseSignature(value) !== null
}

/**
 * What the approval screen should start with, and why.
 *
 * The `source` is not decoration - it is what the screen prints. A person has
 * to be able to see that the mark about to be attached is the one they saved
 * earlier rather than something they drew just now, otherwise "my signature
 * came from somewhere" is indistinguishable from "the app signed for me".
 *
 * @param {{ saved?: unknown, drawn?: unknown }} input
 * @returns {{ value: string|null, source: 'drawn'|'saved'|'none' }}
 */
export function resolveSignature({ saved, drawn } = {}) {
  const d = normaliseSignature(drawn)
  if (d) return { value: d, source: 'drawn' }
  const s = normaliseSignature(saved)
  if (s) return { value: s, source: 'saved' }
  return { value: null, source: 'none' }
}
