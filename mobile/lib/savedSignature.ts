/**
 * savedSignature - the rules around a person's own remembered signature.
 *
 * MIRROR OF `src/lib/savedSignature.js`. Change both together: the web and the
 * phone write into the SAME `user_signatures` row, so a value one side stores
 * and the other refuses would leave an approver with a mark that renders on one
 * device and not the other.
 *
 * WHAT THIS IS FOR. Until V601 every approval asked the approver to draw their
 * signature again from nothing. A saved signature removes the redrawing and
 * NOTHING ELSE: it is loaded into the pad, it is shown, and the person still
 * presses Approve. Pre-filling is not signing.
 *
 * Pure on purpose - no Supabase, no React - so the rules can be tested without
 * a database or a canvas.
 */

/**
 * Mirrors `user_signatures_len_chk` in V601. A value the column would refuse
 * must be refused here too, or the screen offers to save something the server
 * throws away.
 */
export const SIGNATURE_MAX_LEN = 200000

/**
 * The one place that decides whether a value is a signature we can store or
 * hand to an approval RPC.
 *
 * Both capture formats are accepted deliberately. The checklist path emits
 * self-contained `<svg>` markup; the canvas pad emits a `data:image/...` URL.
 * `SignatureView` already renders both, so refusing one here would make a mark
 * drawn on one screen unusable on another.
 */
export function normaliseSignature(value: unknown): string | null {
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
export function isUsableSignature(value: unknown): boolean {
  return normaliseSignature(value) !== null
}

export type SignatureSource = 'drawn' | 'saved' | 'none'

/**
 * What the approval screen should start with, and why.
 *
 * The `source` is not decoration - it is what the screen prints. A person has
 * to be able to see that the mark about to be attached is the one they saved
 * earlier rather than something they drew just now, otherwise "my signature
 * came from somewhere" is indistinguishable from "the app signed for me".
 *
 * A mark drawn NOW always wins over the saved one: someone who has just taken
 * the trouble to redraw must not have it silently replaced by their old mark.
 */
export function resolveSignature(
  input: { saved?: unknown; drawn?: unknown } = {},
): { value: string | null; source: SignatureSource } {
  const d = normaliseSignature(input.drawn)
  if (d) return { value: d, source: 'drawn' }
  const s = normaliseSignature(input.saved)
  if (s) return { value: s, source: 'saved' }
  return { value: null, source: 'none' }
}
