/**
 * RN-safe client id generation.
 *
 * `crypto.randomUUID()` only exists on newer Hermes/RN runtimes. On older
 * devices the bare global `crypto` is undefined, so calling `crypto.randomUUID()`
 * throws a `ReferenceError: Property 'crypto' doesn't exist` — which, in the
 * inspection submit / offline-queue paths, aborts the save before it can even
 * queue offline. This helper never throws: it uses the native UUID when present
 * and otherwise falls back to an RFC4122-shaped v4 id built from Math.random
 * (sufficient for client-side dedup keys, which are not a security boundary).
 */
export function safeUuid(): string {
  const c = (globalThis as any).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Prefixed client id used to dedupe an inspection across online + offline retry. */
export function clientId(prefix = 'local'): string {
  return `${prefix}_${safeUuid()}`
}
