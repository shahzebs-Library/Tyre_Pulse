/**
 * App accent themes — the ONE place that knows what each accent colour means.
 *
 * The whole app reads accent colour through CSS custom properties on <html>
 * (see ACCENT_TOKEN_NAMES). The product default (Green) is defined in
 * src/index.css itself, so choosing Green writes NO inline properties and the
 * app renders byte-identically to before accent themes existed. Every other
 * preset writes the same token names with its own values, per light/dark mode.
 *
 * Accent vs status: these tokens are the BRAND accent (active nav, primary
 * buttons, focus rings, selected tabs/toggles). "Good / success / healthy"
 * status green is NOT an accent and must stay green whatever the user picks, so
 * status colours never read these tokens.
 *
 * Pure module: no React, no DOM side effects except applyAccentVars(), which
 * takes the root element as an argument so it can be tested.
 */

export const DEFAULT_ACCENT_ID = 'green'

/** Every custom property this module may write on <html>. */
export const ACCENT_TOKEN_NAMES = [
  '--accent', '--accent-strong', '--accent-deep', '--accent-light',
  '--accent-rgb', '--accent-bright-rgb', '--accent-ring', '--accent-soft',
  '--accent-ink', '--accent-icon', '--accent-on',
  '--brand', '--brand-bright', '--brand-electric', '--brand-glow',
  '--brand-subtle', '--brand-halo', '--brand-on-tint',
  '--border-brand', '--border-bright',
]

/** The surfaces accent text sits on, used by the contrast checks. */
export const SURFACES = {
  dark: ['#020704', '#060e08'], // sidebar, panel
  light: ['#ffffff'],
}

/**
 * Presets. `fill` / `strong` are the button gradient stops that carry white
 * text; `ink` is accent text on the page surface (active nav label); `icon` is
 * the active nav icon; `light` / `deep` are the indicator bar gradient ends;
 * `onTint` is accent text on a pale accent tint (light mode pills).
 *
 * Green reproduces today's hard-coded values exactly (see index.css :root and
 * html.light). Its white-on-fill contrast is 3.30:1 (AA for large text and UI
 * components only) and its light-mode nav text #22c55e is 2.28:1 on white;
 * both are kept unchanged on purpose because Green must stay byte-identical.
 * The other presets are chosen so every text pairing meets AA 4.5:1.
 */
export const ACCENT_THEMES = [
  {
    id: 'green', label: 'Fleet Green', swatch: '#16a34a', legacy: true,
    fill: '#16a34a', strong: '#22c55e', deep: '#15803d', light: '#86efac', bright: '#4ade80',
    dark: { ink: '#86efac', icon: '#4ade80', onTint: '#4ade80' },
    lightMode: { ink: '#22c55e', icon: '#16a34a', onTint: '#166534' },
  },
  {
    id: 'blue', label: 'Blue', swatch: '#2563eb',
    fill: '#1d4ed8', strong: '#2563eb', deep: '#1e3a8a', light: '#93c5fd', bright: '#60a5fa',
    dark: { ink: '#93c5fd', icon: '#60a5fa', onTint: '#93c5fd' },
    lightMode: { ink: '#1d4ed8', icon: '#1d4ed8', onTint: '#1e40af' },
  },
  {
    id: 'teal', label: 'Teal', swatch: '#0d9488',
    fill: '#115e59', strong: '#0f766e', deep: '#134e4a', light: '#5eead4', bright: '#2dd4bf',
    dark: { ink: '#5eead4', icon: '#2dd4bf', onTint: '#5eead4' },
    lightMode: { ink: '#0f766e', icon: '#0f766e', onTint: '#115e59' },
  },
  {
    id: 'indigo', label: 'Indigo', swatch: '#4f46e5',
    fill: '#4338ca', strong: '#4f46e5', deep: '#312e81', light: '#a5b4fc', bright: '#818cf8',
    dark: { ink: '#a5b4fc', icon: '#818cf8', onTint: '#a5b4fc' },
    lightMode: { ink: '#4338ca', icon: '#4338ca', onTint: '#3730a3' },
  },
  {
    id: 'orange', label: 'Orange', swatch: '#ea580c',
    fill: '#9a3412', strong: '#c2410c', deep: '#7c2d12', light: '#fdba74', bright: '#fb923c',
    dark: { ink: '#fdba74', icon: '#fb923c', onTint: '#fdba74' },
    lightMode: { ink: '#c2410c', icon: '#c2410c', onTint: '#9a3412' },
  },
  {
    id: 'slate', label: 'Slate', swatch: '#475569',
    fill: '#334155', strong: '#475569', deep: '#1e293b', light: '#cbd5e1', bright: '#94a3b8',
    dark: { ink: '#cbd5e1', icon: '#94a3b8', onTint: '#cbd5e1' },
    lightMode: { ink: '#334155', icon: '#334155', onTint: '#1e293b' },
  },
]

const BY_ID = Object.fromEntries(ACCENT_THEMES.map((t) => [t.id, t]))
export const getAccentTheme = (id) => BY_ID[id] || null

// ── colour maths ────────────────────────────────────────────────────────────
const HEX_RE = /^#[0-9a-f]{6}$/i

export function normHex(v) {
  if (!v) return ''
  let s = String(v).trim()
  if (s && s[0] !== '#') s = `#${s}`
  if (/^#[0-9a-f]{3}$/i.test(s)) s = '#' + s.slice(1).split('').map((c) => c + c).join('')
  return HEX_RE.test(s) ? s.toLowerCase() : ''
}

export function hexToRgb(hex) {
  const m = normHex(hex).slice(1)
  if (!m) return null
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) }
}
const rgbTriplet = (hex) => { const c = hexToRgb(hex); return `${c.r},${c.g},${c.b}` }
const rgba = (hex, a) => `rgba(${rgbTriplet(hex)},${a})`
function mix(hex, target, t) {
  const c = hexToRgb(hex)
  const m = (x) => Math.round(x + (target - x) * t)
  return `#${[m(c.r), m(c.g), m(c.b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}
export const lighten = (hex, t) => mix(hex, 255, t)
export const darken = (hex, t) => mix(hex, 0, t)

/** WCAG 2.x relative luminance. */
export function luminance(hex) {
  const c = hexToRgb(hex)
  const ch = [c.r, c.g, c.b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** WCAG contrast ratio between two hex colours, e.g. 4.5. */
export function contrastRatio(a, b) {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// ── selection values ────────────────────────────────────────────────────────
/**
 * The stored accent choice is '' (follow the organisation brand, which is
 * Green unless the org set its own colour), a preset id, or a custom hex.
 * Old builds stored only hex values; the three that match a new preset map to
 * it so nobody's colour silently changes.
 */
const LEGACY_HEX = { '#16a34a': 'green', '#2563eb': 'blue', '#0d9488': 'teal' }

export function normalizeAccentChoice(v) {
  if (v == null) return ''
  const s = String(v).trim()
  if (!s) return ''
  if (BY_ID[s]) return s
  const hex = normHex(s)
  if (!hex) return ''
  return LEGACY_HEX[hex] || hex
}

// ── token resolution ───────────────────────────────────────────────────────
function presetTokens(t, mode) {
  const m = mode === 'dark' ? t.dark : t.lightMode
  const out = {
    '--accent': t.fill,
    '--accent-strong': t.strong,
    '--accent-deep': t.deep,
    '--accent-light': t.light,
    '--accent-rgb': rgbTriplet(t.fill),
    '--accent-bright-rgb': rgbTriplet(t.bright),
    '--accent-ring': rgba(t.fill, 0.6),
    '--accent-soft': rgba(t.fill, 0.12),
    '--accent-ink': m.ink,
    '--accent-icon': m.icon,
    '--accent-on': '#ffffff',
    '--brand': t.fill,
    '--brand-bright': t.strong,
    '--brand-electric': t.bright,
    '--brand-glow': rgba(t.fill, 0.4),
    '--brand-subtle': rgba(t.fill, 0.06),
    '--brand-halo': rgba(t.bright, 0.12),
    '--brand-on-tint': m.onTint,
  }
  // Light mode deliberately keeps its neutral grey card borders.
  if (mode === 'dark') {
    out['--border-brand'] = rgba(t.fill, 0.16)
    out['--border-bright'] = rgba(t.fill, 0.32)
  }
  return out
}

/** A preset-like theme derived from any custom hex (the "Custom colour" picker). */
export function customAccentTheme(hex) {
  const fill = normHex(hex)
  if (!fill) return null
  const onDarkText = contrastRatio('#ffffff', fill) >= contrastRatio('#101828', fill)
  return {
    id: 'custom', label: 'Custom', swatch: fill,
    fill, strong: lighten(fill, 0.18), deep: darken(fill, 0.2), light: lighten(fill, 0.5), bright: lighten(fill, 0.32),
    on: onDarkText ? '#ffffff' : '#101828',
    dark: { ink: lighten(fill, 0.5), icon: lighten(fill, 0.32), onTint: lighten(fill, 0.5) },
    lightMode: { ink: darken(fill, 0.15), icon: fill, onTint: darken(fill, 0.35) },
  }
}

/**
 * Token map to write on <html> for a choice in a mode. An EMPTY map means "use
 * the stylesheet defaults" (Green, or the organisation brand when the choice
 * is ''). Returns a fresh object.
 */
export function accentTokens(choice, mode) {
  const c = normalizeAccentChoice(choice)
  if (!c || c === DEFAULT_ACCENT_ID) return {}
  const preset = BY_ID[c]
  if (preset) return presetTokens(preset, mode)
  const custom = customAccentTheme(c)
  if (!custom) return {}
  const out = presetTokens(custom, mode)
  out['--accent-on'] = custom.on
  return out
}

/** The literal token values Green resolves to (for the parity test and docs). */
export function greenDefaults(mode) {
  return presetTokens(BY_ID.green, mode)
}

/**
 * Write the tokens for a choice onto a root element. Removes every managed
 * property first so switching presets or modes never leaves a stale value.
 * `userAccent` marks an explicit personal choice so TenantContext does not
 * replace it with the organisation brand.
 */
export function applyAccentVars(root, choice, mode) {
  if (!root?.style) return
  ACCENT_TOKEN_NAMES.forEach((p) => root.style.removeProperty(p))
  const c = normalizeAccentChoice(choice)
  const tokens = accentTokens(c, mode)
  Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v))
  if (root.dataset) {
    if (c) { root.dataset.userAccent = '1'; root.dataset.accent = c.startsWith('#') ? 'custom' : c }
    else { delete root.dataset.userAccent; delete root.dataset.accent }
  }
}

/**
 * Cache shape read by public/theme-init.js BEFORE React loads, so the chosen
 * accent is painted on the first frame. Both modes are cached because "system"
 * is resolved there from the media query.
 */
export function accentCache(choice) {
  const c = normalizeAccentChoice(choice)
  return { choice: c, light: accentTokens(c, 'light'), dark: accentTokens(c, 'dark') }
}

/** Contrast report for one preset (used by tests and the picker tooltips). */
export function accentContrast(theme) {
  const t = typeof theme === 'string' ? (BY_ID[theme] || customAccentTheme(theme)) : theme
  const on = t.on || '#ffffff'
  return {
    onFill: contrastRatio(on, t.fill),
    onStrong: contrastRatio(on, t.strong),
    inkDark: Math.min(...SURFACES.dark.map((s) => contrastRatio(t.dark.ink, s))),
    inkLight: Math.min(...SURFACES.light.map((s) => contrastRatio(t.lightMode.ink, s))),
    iconLight: contrastRatio(t.lightMode.icon, '#ffffff'),
  }
}
