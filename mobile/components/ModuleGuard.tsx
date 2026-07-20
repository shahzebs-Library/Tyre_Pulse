/**
 * ModuleGuard — the ONE client-side route guard for the mobile app.
 *
 * Renders its children only when the signed-in user has effective access to
 * `moduleKey`; otherwise it shows a clean, Daylight-styled "no access" screen
 * with a Back action. A `null` moduleKey means the screen is authenticated-only
 * (no module gate) — it still waits for the profile to resolve so a deep link
 * can never flash protected content before the session is validated.
 *
 * Access is resolved with `resolveGuardedAccess`, which fails CLOSED for
 * SENSITIVE modules (admin / user management / approvals) when the permission
 * RPCs errored, so a fail-open empty matrix can never hand a non-admin an
 * administration surface.
 *
 * Client guard is UX + defense-in-depth only; the server (RLS + RPCs) is the
 * real authorization boundary.
 */
import { ReactNode } from 'react'
import { View, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { spacing } from '../lib/theme'
import { Screen } from './ui/Screen'
import { AppText } from './ui/Text'
import { Button } from './ui/Button'
import { Loading } from './ui/States'
import { ModuleKey, resolveGuardedAccess } from '../lib/permissions'

export function ModuleGuard({
  moduleKey, children,
}: { moduleKey: ModuleKey | null; children: ReactNode }) {
  const {
    profile, loading, profileLoading, permissionsError,
    isSuperAdmin, grants, roleMatrix,
  } = useAuth()

  // Still resolving the auth session or the profile — show a spinner, never
  // leak protected content. The (app) layout normally reaches these screens
  // only when ready, but a cold deep link can mount a screen first.
  if (loading || profileLoading) {
    return <Screen><Loading /></Screen>
  }

  // Authenticated-only screen: no module gate. The (app) layout + login redirect
  // enforce authentication; here we simply render once the profile has resolved.
  if (moduleKey === null) {
    return <>{children}</>
  }

  const allowed = resolveGuardedAccess(
    moduleKey, profile?.role ?? null, grants, isSuperAdmin, roleMatrix, permissionsError,
  )

  if (!allowed) return <NoAccess />

  return <>{children}</>
}

/**
 * HOC form: wrap a route screen's component so the guard applies before it
 * renders, without touching the screen's internals. Route screens take no props
 * (they read params via hooks), so the wrapper forwards none in practice.
 */
export function withModuleGuard<P extends object>(
  Component: React.ComponentType<P>,
  moduleKey: ModuleKey | null,
): React.ComponentType<P> {
  function Guarded(props: P) {
    return (
      <ModuleGuard moduleKey={moduleKey}>
        <Component {...props} />
      </ModuleGuard>
    )
  }
  Guarded.displayName = `withModuleGuard(${Component.displayName || Component.name || 'Screen'})`
  return Guarded
}

// Denied view — Daylight styled, honest message, Back action.
function NoAccess() {
  const { theme } = useTheme()
  const router = useRouter()
  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(app)')
  }
  return (
    <Screen>
      <View style={styles.center}>
        <View style={[styles.bigIcon, { backgroundColor: theme.color.warning.soft }]}>
          <Ionicons name="lock-closed-outline" size={34} color={theme.color.warning.base} />
        </View>
        <AppText variant="h3" center>No access to this module</AppText>
        <AppText variant="body" color="muted" center style={styles.msg}>
          You do not have access to this module. Contact your administrator.
        </AppText>
        <Button label="Back" icon="arrow-back" variant="secondary" onPress={goBack} style={styles.action} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing['3xl'], minHeight: 220 },
  bigIcon: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  msg: { marginTop: spacing.xs, maxWidth: 300 },
  action: { marginTop: spacing.xl, minWidth: 180 },
})
