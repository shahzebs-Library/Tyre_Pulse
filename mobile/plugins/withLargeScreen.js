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
 *      ML Kit code-scanner ships on its GmsBarcodeScanningDelegateActivity,
 *   5. declares the hardware this app uses as OPTIONAL (see below).
 *
 * Phone portrait-first UX is unaffected at rest; screens simply become
 * rotatable. If phones must stay portrait, add a runtime lock with
 * expo-screen-orientation (optional follow-up).
 *
 * WHY (5) MATTERS: requesting CAMERA / ACCESS_FINE_LOCATION makes Android imply
 * android.hardware.camera, camera.autofocus and location.gps as REQUIRED
 * features, and Google Play then hides the listing from every device that lacks
 * them - notably Wi-Fi-only tablets, i.e. exactly the large-screen audience the
 * rest of this plugin exists to support. Declaring them required="false" keeps
 * the app installable there. This is safe because the app already degrades:
 * the scanner has a mount-error fallback with manual entry, and the location
 * lookup times out and never blocks an inspection.
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins')

const TOOLS_NS = 'http://schemas.android.com/tools'
const MLKIT_SCANNER_ACTIVITY =
  'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity'

/** Hardware the app uses but can live without; keeps tablets eligible. */
const OPTIONAL_FEATURES = [
  'android.hardware.camera',
  'android.hardware.camera.any',
  'android.hardware.camera.autofocus',
  'android.hardware.camera.flash',
  'android.hardware.location',
  'android.hardware.location.gps',
  'android.hardware.microphone',
  'android.hardware.touchscreen',
]

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

    // 2b. Keep the LEGACY back behaviour for now.
    //
    // Targeting API 36 (Android 16) turns the predictive back gesture ON by
    // default. Nothing in this app implements the OnBackInvokedCallback contract,
    // and the screens most likely to break under it are the ones field staff rely
    // on - camera, barcode scanner and the modal capture forms - where a
    // mishandled back can drop half-entered work. Opting out is still supported
    // and keeps this release's only job as Play API-36 compliance.
    //
    // TO ENABLE LATER: delete this line, then hand-test the back gesture on every
    // screen (camera, scanner, every modal) before shipping.
    application.$['android:enableOnBackInvokedCallback'] = 'false'

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

    // 5. declare implied hardware as OPTIONAL so Play does not filter the app
    //    off tablets and other devices without a camera / GPS. Idempotent: an
    //    existing entry is forced to required="false" rather than duplicated.
    const features = Array.isArray(manifest['uses-feature']) ? manifest['uses-feature'] : []
    for (const name of OPTIONAL_FEATURES) {
      const existing = features.find((f) => f && f.$ && f.$['android:name'] === name)
      if (existing) {
        existing.$['android:required'] = 'false'
      } else {
        features.push({ $: { 'android:name': name, 'android:required': 'false' } })
      }
    }
    manifest['uses-feature'] = features

    return cfg
  })
}

module.exports = withLargeScreen
