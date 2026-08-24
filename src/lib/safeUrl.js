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

/**
 * The safe target for a CLIENT-SIDE route change (react-router `navigate()` /
 * `<Link to>`), or `undefined` when the value cannot be trusted.
 *
 * DIFFERENT JOB FROM safeHref. safeHref decides whether a URL may go in an
 * `<a href>` and deliberately allows absolute http(s) links, because linking off
 * site is legitimate. A ROUTE target is not: it must stay inside this app, so
 * anything that could leave it is rejected.
 *
 * WHAT IT REJECTS AND WHY:
 *   - any scheme at all (`javascript:`, `http:`, ...) - a route is a path
 *   - `//evil.com` - protocol-relative, the classic open redirect
 *   - `\evil.com` and `/\evil.com` - browsers normalise a backslash to `/`, so
 *     these reach the same place while looking like a path. This is the shape
 *     behind the react-router open-redirect advisory (CVE-2025-68470 and its
 *     bypass), and rejecting it here closes the class regardless of which
 *     router version is installed.
 *   - anything not starting with a single `/` - a bare `evil.com` would be
 *     resolved relative to the current route by some callers
 *
 * USE IT for any navigate() target that comes from DATA (a database row, an API
 * payload, a URL parameter). A target built from a developer constant does not
 * need it. Reject, do not repair: a caller that gets `undefined` should do
 * nothing rather than send the user somewhere unintended.
 *
 * @param {unknown} path
 * @returns {string|undefined}
 */
export function safeInternalPath(path) {
  if (typeof path !== 'string') return undefined
  const s = path.trim()
  if (!s) return undefined
  // Normalise backslashes before every check: the browser will.
  const normalised = s.split('\\').join('/')
  if (!normalised.startsWith('/')) return undefined   // must be an absolute app path
  if (normalised.startsWith('//')) return undefined   // protocol-relative
  if (schemeOf(normalised) !== null) return undefined // any scheme at all
  // Return the ORIGINAL string once proven safe, so a legitimate path is passed
  // through byte-for-byte rather than silently rewritten.
  return s
}
