/**
 * Version comparison - pure, dependency-free, testable.
 *
 * Kept separate from appVersionGate.ts (which reaches for expo-constants and
 * Supabase) so the rules that decide whether a build is too old can be tested
 * without a device or a network, the same way workshopLive.ts is.
 */

/** system_config key an admin sets, e.g. "1.3.1". Absent = no minimum. */
export const MIN_VERSION_KEY = 'mobile_min_version'

/**
 * Compare dotted numeric versions. Returns <0 if a<b, 0 if equal, >0 if a>b.
 * Missing segments count as 0, so "1.3" and "1.3.0" are equal. Non-numeric
 * segments become 0 rather than throwing.
 *
 * Segments are compared as NUMBERS on purpose: a text compare puts "1.10.0"
 * below "1.9.0", which would silently fail to block an old build.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    String(v ?? '').trim().split('.').map((p) => {
      const n = parseInt(p, 10)
      return Number.isFinite(n) ? n : 0
    })
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * True when `current` is older than `min`.
 *
 * FAILS OPEN: a blank, missing or unparseable minimum returns false. A typo in
 * the admin console must never lock an entire field fleet out of the app.
 */
export function isUpdateRequired(current: string, min: string | null | undefined): boolean {
  const m = String(min ?? '').trim()
  if (!m) return false
  if (!/\d/.test(m)) return false
  return compareVersions(current, m) < 0
}
