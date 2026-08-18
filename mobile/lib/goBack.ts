/**
 * goBack - the ONE way this app leaves a screen.
 *
 * WHY THIS EXISTS: a bare `router.back()` is a silent NO-OP whenever there is
 * no navigation history to pop - a deep link, a push-notification tap, a screen
 * reached after `router.replace`, or a cold start straight into a route. The
 * user presses Back and nothing at all happens, which is exactly the defect the
 * product owner hit on the Tyre Records filters screen.
 *
 * `backTo` can never be a no-op: with history it pops, without history it
 * REPLACES to a sensible parent so the user always lands somewhere real.
 *
 * Pure by design - it takes the router as an argument and imports nothing from
 * expo-router or react-native, so it is unit-testable in a plain Node runner.
 * Screens should use the `useGoBack` hook (hooks/useGoBack.ts) or the shared
 * <BackButton> (components/ui/BackButton.tsx) rather than calling this directly.
 *
 * RULE: never write a bare `router.back()` in a screen again.
 */

/** Default landing place: the Home hub, which every pushed screen hangs off. */
export const APP_HOME = '/(app)'

/** The slice of the expo-router Router this helper needs. */
export interface BackCapableRouter {
  canGoBack: () => boolean
  back: () => void
  replace: (href: any) => void
}

/** What `backTo` actually did - returned so callers and tests can assert it. */
export type BackOutcome = 'back' | 'replace' | 'unavailable'

/**
 * Leave the current screen.
 *
 * @param router   expo-router Router (or anything with canGoBack/back/replace).
 * @param fallback Route to REPLACE to when there is no history to pop.
 *                 Defaults to the Home hub; pass the real parent for a
 *                 sub-screen (e.g. '/(app)/admin' for an admin sub-page).
 * @returns 'back' when history was popped, 'replace' when the fallback was
 *          used, 'unavailable' only when no usable router was supplied.
 */
export function backTo(
  router: BackCapableRouter | null | undefined,
  fallback: string = APP_HOME,
): BackOutcome {
  if (!router || typeof router.replace !== 'function') return 'unavailable'

  // A router that cannot report its history is treated as having none, so we
  // fall through to the fallback rather than firing a call that does nothing.
  let hasHistory = false
  try {
    hasHistory = typeof router.canGoBack === 'function' && router.canGoBack() === true
  } catch {
    hasHistory = false
  }

  if (hasHistory && typeof router.back === 'function') {
    router.back()
    return 'back'
  }

  // Blank / whitespace-only fallback would replace to nowhere - use Home.
  const target = typeof fallback === 'string' && fallback.trim() ? fallback : APP_HOME
  router.replace(target)
  return 'replace'
}
