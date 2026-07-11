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
