/**
 * +not-found - what the user sees when a link points at no screen.
 *
 * WHY THIS FILE EXISTS. Without it expo-router substitutes its own built-in
 * `Unmatched` view (expo-router/build/views/Unmatched.js): a black developer
 * screen reading "Unmatched Route / Page could not be found", the raw deep-link
 * URL, and a "Sitemap" link that enumerates every route in the app. That is a
 * debugging aid, and it shipped to the product owner's phone - it is exactly
 * the screen he photographed after tapping a notification.
 *
 * This replaces it with plain language, no internal route names and no sitemap,
 * and one control that always lands the person somewhere real. It is the SAFETY
 * NET, not the fix: the broken links themselves are fixed at their source (see
 * lib/notificationsInbox.ts). It has to exist anyway, because the difference
 * between "we could not open that" and a developer error screen is the
 * difference between a product and a bug report.
 *
 * Sits at the root, OUTSIDE app/(app), so it is not a screen in the tab
 * navigator and needs no `href: null` declaration.
 */
import { View, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'
import { Screen, AppText, Button } from '../components/ui'
import { APP_HOME } from '../lib/goBack'
import { spacing } from '../lib/theme'

export default function NotFoundScreen() {
  const router = useRouter()
  const { theme } = useTheme()
  const { t } = useLanguage()

  // REPLACE, never push: this screen must not stay in the history behind Home,
  // and the user arrived here from a link that leads nowhere, so there may be
  // nothing sensible to go back to.
  const goHome = () => {
    try {
      router.replace(APP_HOME as never)
    } catch {
      // Never let the recovery control itself throw.
    }
  }

  return (
    <Screen edges={['top', 'bottom']} padded>
      <View style={styles.wrap}>
        <View style={[styles.badge, { backgroundColor: theme.color.surface, borderColor: theme.color.border }]}>
          <Ionicons name="help-circle-outline" size={40} color={theme.color.textMuted} />
        </View>

        <AppText variant="h2" center style={styles.title}>
          {t('modules.notFound.title')}
        </AppText>

        <AppText variant="body" color="muted" center style={styles.message}>
          {t('modules.notFound.body')}
        </AppText>

        <Button
          label={t('modules.notFound.home')}
          icon="home-outline"
          onPress={goHome}
          full
          style={styles.action}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  badge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { marginBottom: spacing.sm },
  message: { marginBottom: spacing.xl, maxWidth: 320 },
  action: { maxWidth: 320 },
})
