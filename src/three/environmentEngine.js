/**
 * Environment Engine
 * ──────────────────
 * Binds scene mood to the local time of day. Returns a fully-resolved lighting
 * profile (sun, ambient, fog, street-light state, brand glow) for a given hour.
 * Pure function → trivially testable and deterministic.
 *
 * Periods: morning · day · sunset · night (see CLAUDE.md → Environment engine).
 */

/** Brand palette. */
export const BRAND = {
  green: '#16a34a',
  greenLight: '#4ade80',
  greenDeep: '#052010',
}

const PERIODS = [
  {
    name: 'night',
    test: (h) => h < 6 || h >= 20,
    sky: '#03110a',
    fog: '#04140c',
    sunColor: '#1f7a45',
    sunIntensity: 0.18,
    ambientColor: '#0a2417',
    ambientIntensity: 0.32,
    sunAngle: -0.25, // below horizon → moonlit feel
    streetLights: true,
    glow: 1.0, // green glow / reflections intensify at night
    keyColor: BRAND.greenLight,
  },
  {
    name: 'morning',
    test: (h) => h >= 6 && h < 11,
    sky: '#0c2a1c',
    fog: '#103024',
    sunColor: '#bfe6c9',
    sunIntensity: 0.85,
    ambientColor: '#2a4a38',
    ambientIntensity: 0.55,
    sunAngle: 0.55,
    streetLights: false,
    glow: 0.45,
    keyColor: '#d9f7e3',
  },
  {
    name: 'day',
    test: (h) => h >= 11 && h < 16,
    sky: '#0e3324',
    fog: '#123a2a',
    sunColor: '#ffffff',
    sunIntensity: 1.15,
    ambientColor: '#34543f',
    ambientIntensity: 0.7,
    sunAngle: 1.15,
    streetLights: false,
    glow: 0.3,
    keyColor: '#ffffff',
  },
  {
    name: 'sunset',
    test: (h) => h >= 16 && h < 20,
    sky: '#0b1f17',
    fog: '#241a10',
    sunColor: '#ffcaa0',
    sunIntensity: 0.7,
    ambientColor: '#3a2e22',
    ambientIntensity: 0.5,
    sunAngle: 0.18, // low, raking light
    streetLights: false,
    glow: 0.6,
    keyColor: '#ffd9b0',
  },
]

/**
 * Resolve the lighting profile for an hour [0..24).
 * Sun position is derived on a half-dome arc from the period's `sunAngle`.
 */
export function resolveEnvironment(hour) {
  const h = ((hour % 24) + 24) % 24
  const p = PERIODS.find((x) => x.test(h)) || PERIODS[1]

  // Sun on an arc: x sweeps with the day, y from the period angle.
  const dayFrac = h / 24
  const azim = (dayFrac * 2 - 1) * Math.PI * 0.5 // -90°..+90° across the day
  const sunDir = [
    Math.sin(azim) * 6,
    Math.max(-2, p.sunAngle * 6),
    Math.cos(azim) * 4 + 3,
  ]

  return {
    period: p.name,
    sky: p.sky,
    fog: { color: p.fog, near: 9, far: 30 },
    sun: { color: p.sunColor, intensity: p.sunIntensity, position: sunDir },
    ambient: { color: p.ambientColor, intensity: p.ambientIntensity },
    streetLights: p.streetLights,
    glow: p.glow,
    keyColor: p.keyColor,
  }
}

/** Convenience: current-hour profile (caller passes the hour to stay pure). */
export function describePeriod(hour) {
  return resolveEnvironment(hour).period
}
