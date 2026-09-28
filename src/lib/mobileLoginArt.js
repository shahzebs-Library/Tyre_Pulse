/**
 * Mobile login artwork - which picture each login country shows on the phone.
 *
 * The phone draws the login screen before anyone signs in, so it can only
 * show artwork it already carries. The catalog below is therefore the exact
 * list of pictures BUNDLED in the Flutter app (tyre_pulse_flutter/assets/login);
 * adding a choice here without adding the picture to the app would give the
 * phone a key it cannot draw, and it would fall back to the country default.
 *
 * MIRROR: tyre_pulse_flutter/lib/features/auth/domain/login_artwork.dart holds
 * the same keys. Change both together.
 *
 * Stored in system_config under MOBILE_LOGIN_HERO_KEY as a JSON object:
 *   {"saudi_arabia":"fleet_machines","united_arab_emirates":"uae_landmark","egypt":"egypt_landmark"}
 */

export const MOBILE_LOGIN_HERO_KEY = 'mobile_login_hero'

export const LOGIN_ARTWORK = Object.freeze([
  { key: 'saudi_landmark', label: 'Riyadh skyline with wheel loader', preview: '/login-art/saudi_landmark.jpg' },
  { key: 'uae_landmark', label: 'Dubai skyline at night', preview: '/login-art/uae_landmark.jpg' },
  { key: 'egypt_landmark', label: 'Cairo landmarks at night', preview: '/login-art/egypt_landmark.jpg' },
  { key: 'fleet_machines', label: 'Fleet machines (pump truck, loader, bus)', preview: '/login-art/fleet_machines.jpg' },
])

export const LOGIN_COUNTRIES = Object.freeze([
  { key: 'saudi_arabia', label: 'Saudi Arabia', defaultArt: 'saudi_landmark' },
  { key: 'united_arab_emirates', label: 'United Arab Emirates', defaultArt: 'uae_landmark' },
  { key: 'egypt', label: 'Egypt', defaultArt: 'egypt_landmark' },
])

const ART_KEYS = new Set(LOGIN_ARTWORK.map((a) => a.key))

export const defaultLoginArt = () =>
  Object.fromEntries(LOGIN_COUNTRIES.map((c) => [c.key, c.defaultArt]))

/**
 * Reads a stored value into a full {country: artKey} map. Accepts the object
 * itself, a JSON string, or a JSON string that was itself JSON-quoted. Any
 * country that is missing or names an unknown picture gets its own default,
 * exactly as the phone does, so the page never shows a choice the phone
 * would not draw.
 */
export function parseLoginArt(raw) {
  let v = raw
  for (let i = 0; i < 2 && typeof v === 'string'; i += 1) {
    try { v = JSON.parse(v) } catch { v = null }
  }
  const out = defaultLoginArt()
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const c of LOGIN_COUNTRIES) {
      const pick = v[c.key]
      if (typeof pick === 'string' && ART_KEYS.has(pick)) out[c.key] = pick
    }
  }
  return out
}

/** Serialises only known countries and pictures, in a stable key order. */
export function serializeLoginArt(map) {
  const clean = parseLoginArt(map && typeof map === 'object' ? map : null)
  return JSON.stringify(clean)
}

/** Countries whose choice differs from their own landmark. */
export function changedFromDefault(map) {
  const m = parseLoginArt(map)
  return LOGIN_COUNTRIES.filter((c) => m[c.key] !== c.defaultArt).map((c) => c.key)
}

export const artworkByKey = (key) => LOGIN_ARTWORK.find((a) => a.key === key) || null
