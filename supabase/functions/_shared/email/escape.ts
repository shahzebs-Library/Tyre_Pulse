// Pure helpers. No Deno or Node imports so vitest and the edge runtime share them.

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Header fields (subject, address, reply-to) must never carry CR/LF: that is header injection. */
export function stripCrLf(value: unknown): string {
  return String(value ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/** One line of body text: control characters out, length capped. */
export function cleanText(value: unknown, max = 500): string {
  // eslint-disable-next-line no-control-regex
  const s = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/
export const SYNTHETIC_EMAIL_RE = /@users\.tyrepulse\.app$/i

/** A deliverable address or null. Synthetic login addresses are never deliverable. */
export function cleanAddress(raw: unknown): string | null {
  const e = stripCrLf(raw).toLowerCase()
  if (e.length > 254 || !EMAIL_RE.test(e) || SYNTHETIC_EMAIL_RE.test(e)) return null
  return e
}
