/**
 * captcha - landing route for `tyrepulse-inspector://captcha?state=..&token=..`.
 *
 * expo-router turns every incoming deep link into a navigation. Without this
 * file the security-check return link would land on +not-found ("we could not
 * open that"). The link itself is handled by the Linking listener in
 * app/(auth)/login.tsx via lib/captchaBridge.ts; this screen only gets the
 * person back where they were, without ever showing the token or the state.
 *
 * It sits at the root, outside the (auth) and (app) groups, so it needs no
 * tab declaration and no auth guard of its own: it never reads data.
 */
import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { useRouter, useGlobalSearchParams } from 'expo-router'
import { deliverReturnUrl, APP_SCHEME, RETURN_HOST } from '../lib/captchaBridge'
import { backTo } from '../lib/goBack'

export default function CaptchaReturn() {
  const router = useRouter()
  const params = useGlobalSearchParams<{ state?: string; token?: string }>()

  useEffect(() => {
    // Belt and braces: if the Linking event never reached the sign-in screen
    // (it was not mounted), deliver the same link here. Delivery is single-use,
    // so a second delivery of an accepted link cannot sign in twice.
    const state = typeof params.state === 'string' ? params.state : ''
    const token = typeof params.token === 'string' ? params.token : ''
    if (state && token) {
      deliverReturnUrl(
        `${APP_SCHEME}://${RETURN_HOST}?state=${encodeURIComponent(state)}&token=${encodeURIComponent(token)}`,
      )
    }
    // Back to the sign-in screen when it is underneath; otherwise (cold start)
    // replace to the entry route, which decides between sign-in and the app.
    // backTo never throws and is never a no-op.
    backTo(router, '/')
  // Run once on arrival.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f5f1' }}>
      <ActivityIndicator size="large" color="#16a34a" />
    </View>
  )
}
