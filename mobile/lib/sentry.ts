/**
 * Sentry crash + performance monitoring.
 *
 * DSN is read from the environment (EXPO_PUBLIC_SENTRY_DSN, injected via
 * eas.json / .env) — never hardcoded — so the same code is safe in open source
 * and each build targets the right Sentry project. If no DSN is present (e.g.
 * local Expo Go), Sentry stays completely inert. Events are only *sent* from
 * release builds, so development never pollutes the dashboard.
 */
import * as Sentry from '@sentry/react-native'
import Constants from 'expo-constants'

const extra = (Constants.expoConfig?.extra ?? (Constants as any).manifest?.extra ?? {}) as {
  sentryDsn?: string
}

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? extra.sentryDsn ?? ''

export const sentryEnabled = !!dsn

/**
 * Event / breadcrumb sanitizer. Nothing that looks sensitive leaves the device.
 * Redacted before send:
 *  - any object key that looks like a credential (password, token, authorization,
 *    bearer, api key, secret, access_token, refresh_token, jwt, cookie, session,
 *    pin, otp, credential) -> value replaced entirely.
 *  - JWT-shaped strings and "Bearer <token>" / "token <value>" fragments anywhere
 *    in string values (so a token embedded in a URL or message is scrubbed).
 *  - large base64 / data:image payloads and file:// photo paths (inspection photos)
 *    -> replaced with a short marker so crash payloads stay small and PII-free.
 *  - request bodies, headers, cookies and query strings are deep-scrubbed.
 * The signed-in user (id + username, set via setSentryUser) is intentionally kept
 * as low-risk debugging context and is never touched here.
 * All of this is best effort: it never throws, and always returns the event.
 */
const REDACTED = '[redacted]'
const REDACTED_PAYLOAD = '[redacted large payload]'
const MAX_STRING_LEN = 2048
const MAX_DEPTH = 8
const MAX_ARRAY = 200

const SENSITIVE_KEY =
  /(pass(word)?|token|authorization|auth[_-]?token|bearer|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|jwt|credential|cookie|session|pin|otp)/i
const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g
const BEARER_RE = /\b(bearer|token)\s+[A-Za-z0-9._~+/-]{8,}=*/gi
const DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i
const PHOTO_FILE_RE = /file:\/\/\S+\.(?:jpe?g|png|heic|heif|webp|gif|bmp)/gi
const LONG_BASE64_RE = /^[A-Za-z0-9+/=\s]{2048,}$/

function scrubString(value: string): string {
  if (DATA_IMAGE_RE.test(value) || (value.length > MAX_STRING_LEN && LONG_BASE64_RE.test(value))) {
    return REDACTED_PAYLOAD
  }
  let out = value
  out = out.replace(JWT_RE, REDACTED)
  out = out.replace(BEARER_RE, REDACTED)
  out = out.replace(PHOTO_FILE_RE, REDACTED)
  return out
}

function sanitizeValue(value: unknown, keyIsSensitive: boolean, depth: number): unknown {
  if (keyIsSensitive && value != null && typeof value !== 'object') return REDACTED
  if (typeof value === 'string') return keyIsSensitive ? REDACTED : scrubString(value)
  if (value == null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return value
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitizeValue(item, false, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sanitizeValue(v, SENSITIVE_KEY.test(k), depth + 1)
  }
  return out
}

function sanitizeField<T>(obj: T, field: keyof T): void {
  const target = obj as Record<string, unknown>
  if (target[field as string] != null) {
    target[field as string] = sanitizeValue(target[field as string], false, 0)
  }
}

function sanitizeEvent<T extends Sentry.Event>(event: T): T {
  try {
    if (event.request) {
      sanitizeField(event.request, 'data' as keyof typeof event.request)
      sanitizeField(event.request, 'headers' as keyof typeof event.request)
      sanitizeField(event.request, 'cookies' as keyof typeof event.request)
      if (typeof event.request.query_string === 'string') {
        event.request.query_string = scrubString(event.request.query_string)
      }
    }
    if (event.extra) event.extra = sanitizeValue(event.extra, false, 0) as typeof event.extra
    if (event.contexts) event.contexts = sanitizeValue(event.contexts, false, 0) as typeof event.contexts
    if (event.tags) event.tags = sanitizeValue(event.tags, false, 0) as typeof event.tags
    if (typeof event.message === 'string') event.message = scrubString(event.message)
    if (Array.isArray(event.exception?.values)) {
      for (const ex of event.exception!.values!) {
        if (typeof ex.value === 'string') ex.value = scrubString(ex.value)
      }
    }
    if (Array.isArray(event.breadcrumbs)) {
      for (const crumb of event.breadcrumbs) {
        if (typeof crumb.message === 'string') crumb.message = scrubString(crumb.message)
        if (crumb.data) crumb.data = sanitizeValue(crumb.data, false, 0) as typeof crumb.data
      }
    }
  } catch {
    // Never let sanitization block a crash report; send whatever we have.
  }
  return event
}

if (dsn) {
  Sentry.init({
    dsn,
    // Keep local development out of the dashboard; release builds report.
    enabled: !__DEV__,
    environment: process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? 'development' : 'production'),
    // Distributed field app: capture a meaningful sample of performance traces
    // without overwhelming quota. Errors are always captured in full.
    tracesSampleRate: 0.2,
    enableAutoSessionTracking: true,
    // Trim noisy, non-actionable breadcrumbs.
    maxBreadcrumbs: 50,
    // Belt and braces: do not attach automatic PII (IP address, etc).
    sendDefaultPii: false,
    // Strip credentials / tokens / photo payloads before anything leaves the device.
    beforeSend: (event) => sanitizeEvent(event),
    beforeBreadcrumb: (breadcrumb) => {
      try {
        if (typeof breadcrumb.message === 'string') breadcrumb.message = scrubString(breadcrumb.message)
        if (breadcrumb.data) {
          breadcrumb.data = sanitizeValue(breadcrumb.data, false, 0) as typeof breadcrumb.data
        }
      } catch {
        // Ignore: keep the breadcrumb rather than lose diagnostic context.
      }
      return breadcrumb
    },
  })
}

/**
 * Tag subsequent events with the signed-in user so field issues are traceable
 * to a device/operator. Call with null on sign-out. No-op when Sentry is off.
 */
export function setSentryUser(user: { id?: string | null; username?: string | null } | null) {
  if (!sentryEnabled) return
  if (user?.id) {
    Sentry.setUser({ id: user.id, username: user.username ?? undefined })
  } else {
    Sentry.setUser(null)
  }
}

export { Sentry }
