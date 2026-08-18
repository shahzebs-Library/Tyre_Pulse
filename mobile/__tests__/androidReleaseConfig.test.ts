/**
 * Android release build configuration.
 *
 * R8 (code shrinking + optimisation) is a NATIVE build setting: it cannot be
 * changed by an expo-updates OTA, it only takes effect in a release build, and
 * every failure mode it has is invisible in development. That combination is
 * why it needs a guard rather than a comment - a well-meaning edit to app.json
 * can turn it off, or strip the one rule that keeps crash reports readable, and
 * nothing would fail until a tester's phone crashed in a way nobody could read.
 */
import appJson from '../app.json'

function androidBuildProps(): Record<string, any> {
  const plugins: any[] = (appJson as any).expo?.plugins ?? []
  const entry = plugins.find((p) => Array.isArray(p) && String(p[0]).includes('build-properties'))
  expect(entry).toBeDefined()
  return entry[1]?.android ?? {}
}

describe('android release build', () => {
  it('has R8 enabled for release builds', () => {
    expect(androidBuildProps().enableProguardInReleaseBuilds).toBe(true)
  })

  it('keeps line numbers so a release crash is still readable in Sentry', () => {
    // R8 strips SourceFile and LineNumberTable by default. Without them every
    // Java/Kotlin frame arriving at Sentry loses its file and line, and a crash
    // on a field handset stops being diagnosable - which is exactly how the
    // last native crash in this app WAS diagnosed.
    const rules = String(androidBuildProps().extraProguardRules ?? '')
    expect(rules).toContain('-keepattributes SourceFile,LineNumberTable')
    expect(rules).toContain('-renamesourcefileattribute SourceFile')
  })

  it('keeps the attributes Expo and Kotlin read reflectively', () => {
    // Expo resolves module definitions and coerces argument types by
    // reflection; a stripped Signature or annotation shows up as a module that
    // silently fails to load, in release only.
    const rules = String(androidBuildProps().extraProguardRules ?? '')
    expect(rules).toMatch(/-keepattributes .*Signature/)
    expect(rules).toMatch(/-keepattributes .*\*Annotation\*/)
  })

  it('keeps Sentry, which ships no consumer rules of its own', () => {
    const rules = String(androidBuildProps().extraProguardRules ?? '')
    expect(rules).toContain('-keep class io.sentry.** { *; }')
  })

  it('does NOT enable resource shrinking, deliberately', () => {
    // enableShrinkResourcesInReleaseBuilds is a DIFFERENT tool from R8: it is
    // the Android Gradle resource shrinker, and its failure mode is a drawable
    // or string that is only ever looked up by name at runtime being deleted.
    // R8 code shrinking is where the size win is and where the ecosystem's
    // consumer rules are mature. Turning resource shrinking on is a separate
    // decision that must be paired with a real release build and a device
    // smoke test, so it stays off until somebody does that.
    expect(androidBuildProps().enableShrinkResourcesInReleaseBuilds).toBeUndefined()
  })

  it('still targets the minSdk the fleet is on', () => {
    // Raising this silently orphans devices that already have the app.
    expect(androidBuildProps().minSdkVersion).toBe(24)
  })
})
