/**
 * withLargeScreen — Android large-screen / foldable resizability config plugin.
 *
 * Google Play (Android 16 / API 35+) ignores a locked screenOrientation and a
 * non-resizeable app on large screens, and flags them in Play Console. This
 * plugin makes the merged AndroidManifest large-screen friendly, idempotently:
 *
 *   1. ensures xmlns:tools is declared on <manifest>,
 *   2. sets android:resizeableActivity="true" on <application>,
 *   3. removes any android:screenOrientation lock from the app's MainActivity,
 *   4. injects a manifest-merge override that strips the PORTRAIT lock the
 *      ML Kit code-scanner ships on its GmsBarcodeScanningDelegateActivity.
 *
 * Phone portrait-first UX is unaffected at rest; screens simply become
 * rotatable. If phones must stay portrait, add a runtime lock with
 * expo-screen-orientation (optional follow-up).
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins')

const TOOLS_NS = 'http://schemas.android.com/tools'
const MLKIT_SCANNER_ACTIVITY =
  'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity'

function withLargeScreen(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest

    // 1. xmlns:tools on <manifest>
    manifest.$ = manifest.$ || {}
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = TOOLS_NS
    }

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults)

    // 2. resizeableActivity="true" on <application>
    application.$ = application.$ || {}
    application.$['android:resizeableActivity'] = 'true'

    // 3. drop any screenOrientation lock from MainActivity
    const activities = Array.isArray(application.activity) ? application.activity : []
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults)
    if (mainActivity && mainActivity.$ && mainActivity.$['android:screenOrientation'] != null) {
      delete mainActivity.$['android:screenOrientation']
    }

    // 4. strip the third-party ML Kit code-scanner PORTRAIT lock at merge time
    application.activity = activities
    const alreadyPatched = application.activity.some(
      (a) => a && a.$ && a.$['android:name'] === MLKIT_SCANNER_ACTIVITY,
    )
    if (!alreadyPatched) {
      application.activity.push({
        $: {
          'android:name': MLKIT_SCANNER_ACTIVITY,
          'tools:node': 'merge',
          'tools:remove': 'android:screenOrientation',
        },
      })
    }

    return cfg
  })
}

module.exports = withLargeScreen
