/**
 * URL safety helpers — the single, dependency-free guard against stored/reflected
 * XSS through unvalidated `*_url` fields (e.g. `javascript:alert(1)` slipped into
 * a `signature_url`, `video_url`, `logo_url`, …).
 *
 * The threat: a value read from the database and dropped straight into an
 * `<a href>` or `<img src>` can carry a dangerous scheme. Browsers execute
 * `javascript:` / `vbscript:` hrefs and can render `data:text/html` documents,
 * turning a plain text column into a script-execution vector.
 *
 * Strategy: allowlist safe schemes only. Anything not provably safe returns
 * `undefined` so the caller can omit the attribute (render plain text / no
 * image) rather than emit an attacker-controlled URL. We deliberately do NOT
 * try to "sanitise" a bad URL into a good one — reject, don't repair.
 *
 * Relative URLs (no scheme) are allowed: they cannot introduce a new scheme and
 * so cannot execute script. A value only counts as relative when it has no
 * scheme token, i.e. no `:` appears before the first path/query/fragment
 * delimiter (`/`, `?`, `#`). This closes the "relative-with-colon" trick where
 * `javascript:foo` would otherwise masquerade as a relative reference.
 */

// Schemes safe to place in an <a href>. Lower-case; comparison is normalised.
const HREF_SCHEMES = new Set(['http', 'https', 'mailto'])

// Schemes safe to place in an <img src>. `data:` is special-cased to the
// image/* media type only; `blob:` (object URLs) is allowed wholesale.
const IMG_SCHEMES = new Set(['http', 'https', 'blob'])

/**
 * Extract the lower-cased scheme token from a trimmed URL string, or `null`
 * when the value carries no scheme (i.e. it is relative).
 *
 * A scheme exists only when a `:` appears before the first `/`, `?` or `#`.
 * `foo:bar` → scheme "foo"; `/a:b` or `a/b:c` or `#x:y` → no scheme (relative).
 *
 * @param {string} s trimmed candidate URL
 * @returns {string|null} lower-cased scheme, or null when relative
 */
function schemeOf(s) {
  const colon = s.indexOf(':')
  if (colon === -1) return null // no colon at all → relative

  // First path/query/fragment delimiter. Infinity when none is present.
  let delim = Infinity
  for (const ch of ['/', '?', '#']) {
    const i = s.indexOf(ch)
    if (i !== -1 && i < delim) delim = i
  }

  // A colon that appears only after a delimiter belongs to the path/query,
  // not to a scheme → the value is relative.
  if (colon > delim) return null

  return s.slice(0, colon).toLowerCase()
}

/**
 * Return `url` unchanged when it is safe to use as an `<a href>`, otherwise
 * `undefined`.
 *
 * Safe means, after trimming: a relative reference (no scheme), or an absolute
 * URL whose scheme is one of `http`, `https`, `mailto` (case-insensitive).
 * `javascript:`, `vbscript:`, `data:` and every other scheme are rejected.
 *
 * @param {unknown} url candidate URL (only strings can be safe)
 * @returns {string|undefined} the original string when safe, else undefined
 */
export function safeHref(url) {
  if (typeof url !== 'string') return undefined
  const s = url.trim()
  if (s === '') return undefined

  const scheme = schemeOf(s)
  if (scheme === null) return s // relative reference — cannot introduce a scheme
  return HREF_SCHEMES.has(scheme) ? s : undefined
}

/**
 * Return `url` unchanged when it is safe to use as an `<img src>`, otherwise
 * `undefined`.
 *
 * Safe means, after trimming: a relative reference (no scheme), an absolute URL
 * whose scheme is `http`/`https`, a `blob:` object URL, or a `data:` URL whose
 * media type is `image/*`. A `data:text/html` (or any non-image data URL) is
 * rejected — those can carry active content.
 *
 * @param {unknown} url candidate URL (only strings can be safe)
 * @returns {string|undefined} the original string when safe, else undefined
 */
export function safeImageSrc(url) {
  if (typeof url !== 'string') return undefined
  const s = url.trim()
  if (s === '') return undefined

  const scheme = schemeOf(s)
  if (scheme === null) return s // relative reference — safe
  if (IMG_SCHEMES.has(scheme)) return s
  if (scheme === 'data') {
    // Only image media types; everything else (text/html, application/*, …) out.
    return s.slice(0, 11).toLowerCase() === 'data:image/' ? s : undefined
  }
  return undefined
}
