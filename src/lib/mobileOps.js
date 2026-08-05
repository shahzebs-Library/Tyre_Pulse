/**
 * Mobile app operations - pure logic for the console Mobile App Control page.
 *
 * The forced-update gate (system_config.mobile_min_version) is the one setting
 * in this system that can LOCK EVERY FIELD PHONE OUT with a single keystroke:
 * set it above the version people actually have installed and the whole fleet
 * sees the update wall with nothing to update to. These helpers exist so the
 * page can refuse that mistake BEFORE it reaches the database.
 *
 * Version comparison mirrors mobile/lib/appVersion.ts EXACTLY: segments compare
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
