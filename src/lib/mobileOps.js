/**
 * Mobile app operations - pure logic for the console Mobile App Control page.
 *
 * The forced-update gate (system_config.flutter_min_version for the Flutter
 * field app; mobile_min_version is the retired Expo app's key) is the one setting
 * in this system that can LOCK EVERY FIELD PHONE OUT with a single keystroke:
 * set it above the version people actually have installed and the whole fleet
 * sees the update wall with nothing to update to. These helpers exist so the
 * page can refuse that mistake BEFORE it reaches the database.
 *
 * Version comparison mirrors tyre_pulse_flutter/lib/core/auth/app_version.dart
 * (itself a port of the retired mobile/lib/appVersion.ts): segments compare
 * as NUMBERS (a text compare puts 1.10.0 below 1.9.0) and an unparseable value
 * is treated as "no gate" - the mobile gate FAILS OPEN on junk, so the console
 * must reason with the same rules or the two disagree about the same string.
 */

/** Parse "1.2.3" into numeric segments; null when it is not a version at all. */
export function parseVersion(v) {
  const s = String(v ?? '').trim().replace(/^v/i, '')
  if (!s || !/^\d+(\.\d+)*$/.test(s)) return null
  return s.split('.').map((n) => parseInt(n, 10))
}

/** Numeric segment compare: -1 / 0 / 1. Null (unparseable) sorts BELOW everything. */
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * Judge a PROPOSED minimum version against the latest version actually
 * released. Returns { level, reason } where level is:
 *   'blocked' - would lock out phones that cannot update (min > latest) or junk
 *   'clear'   - min <= latest released: every phone has something to update to
 *   'off'     - blank: the gate is disabled (mobile fails open on blank)
 * The page treats 'blocked' as a hard refusal, not a warning.
 */
export function gateRisk(proposedMin, latestReleased) {
  const min = String(proposedMin ?? '').trim()
  if (!min) return { level: 'off', reason: 'No minimum set: the update gate is off and no phone is ever blocked.' }
  if (!parseVersion(min)) {
    return { level: 'blocked', reason: `"${min}" is not a version number. The phones would ignore it (the gate fails open on junk), so saving it only creates confusion.` }
  }
  if (!parseVersion(latestReleased)) {
    return { level: 'blocked', reason: 'No released version is recorded, so there is no way to prove phones have something to update to. Record the released version first.' }
  }
  if (compareVersions(min, latestReleased) > 0) {
    return { level: 'blocked', reason: `The newest release is ${latestReleased}. Requiring ${min} would lock EVERY phone out with nothing to update to.` }
  }
  return { level: 'clear', reason: `Phones below ${min} will be required to update. ${latestReleased} is available to update to, so nobody is stranded.` }
}

/** Plain-English state of the gate as it stands right now. */
export function gateSummary(currentMin, latestReleased) {
  const min = String(currentMin ?? '').trim()
  if (!min) return 'The forced-update gate is OFF. Phones on any version can keep working.'
  if (compareVersions(min, latestReleased) === 0) {
    return `Everyone must be on the newest release (${latestReleased}). Older versions see the update screen.`
  }
  return `Phones below ${min} must update before they can continue. The newest release is ${latestReleased || 'not recorded'}.`
}

/* ------------------------------------------------------------------ */
/* Flutter app (owner rule 2026-10-04: mobile = the Flutter app only)  */
/* ------------------------------------------------------------------ */

/**
 * The one field app the console controls. Its forced-update gate is read by
 * tyre_pulse_flutter/lib/core/auth/app_version.dart (minVersionConfigKey) after
 * sign-in and FAILS OPEN on a blank or digit-free value, so the console must
 * refuse junk rather than save something the phones will ignore.
 */
export const FLUTTER_APP = Object.freeze({
  name: 'Tyre Pulse field app (Flutter)',
  packageId: 'com.shahzebrahman.tyrepulse',
  track: 'Closed testing (alpha)',
  workflow: 'flutter-release-play.yml',
  workflowName: 'Flutter Release - Play Closed Testing',
  workflowUrl: 'https://github.com/shahzebs-Library/Tyre_Pulse/actions/workflows/flutter-release-play.yml',
  playUrl: 'https://play.google.com/store/apps/details?id=com.shahzebrahman.tyrepulse',
  minKey: 'flutter_min_version',
  latestKey: 'flutter_latest_version',
  versionSource: 'tyre_pulse_flutter/pubspec.yaml (version name, before the +build number)',
})

/** The retired Expo app. Shown read-only; nothing in the console writes its keys from this page. */
export const RETIRED_EXPO_APP = Object.freeze({
  name: 'Retired Expo app',
  packageId: 'com.shahzebrahman.tyrepulseinspector',
  minKey: 'mobile_min_version',
  latestKey: 'mobile_latest_version',
})

/** Strip a pubspec build suffix: "0.1.0+5" -> "0.1.0". Junk returns ''. */
export function versionName(v) {
  const s = String(v ?? '').trim().split('+')[0].trim()
  return parseVersion(s) ? s : ''
}

/** Install-base view filters for the device table. */
export const VERSION_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'latest', label: 'On newest' },
  { key: 'behind', label: 'Behind newest' },
  { key: 'blocked', label: 'Must update' },
  { key: 'unknown', label: 'No version' },
]

/**
 * Filter install-base rows ({ app_version, platform, devices }) by a search
 * term and one VERSION_FILTERS key, judged against the saved min + latest.
 * A row with no readable version only ever matches 'all' and 'unknown'.
 */
export function filterVersionRows(rows = [], { search = '', filter = 'all', min = '', latest = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (rows || []).filter((r) => {
    const v = r?.app_version
    if (q && !`${v || 'unknown'} ${r?.platform || ''}`.toLowerCase().includes(q)) return false
    const known = !!parseVersion(v)
    switch (filter) {
      case 'latest': return known && !!parseVersion(latest) && compareVersions(v, latest) === 0
      case 'behind': return known && !!parseVersion(latest) && compareVersions(v, latest) < 0
      case 'blocked': return known && !!parseVersion(min) && compareVersions(v, min) < 0
      case 'unknown': return !known
      default: return true
    }
  })
}
