/**
 * TyrePulse Mobile — Design System Tokens
 * ----------------------------------------
 * LIGHT-FIRST, built for readability in DIRECT SUNLIGHT (GCC field use).
 *
 * Design principles for outdoor legibility:
 *  - Bright, near-white backgrounds for maximum reflectance contrast.
 *  - Near-black primary text (very high contrast — glare washes out mid greys,
 *    so we avoid light-grey text for anything that matters).
 *  - Saturated, dark-enough status colours that stay distinguishable under sun.
 *  - We lean on BORDERS + contrast, not soft shadows, because shadows disappear
 *    outdoors. Elevation is expressed with a hairline border + a faint shadow.
 *  - Large type scale and generous touch targets (gloved / dusty hands).
 *
 * A dark palette is provided too (night shifts / indoor management), but the
 * app defaults to light and is tuned for the sun.
 *
 * Everything is a plain object so it is cheap to read inside StyleSheet builders
 * and re-render on theme change. Consume via `useTheme()` (contexts/ThemeContext).
 */

export type ThemeMode = 'light' | 'dark'

export interface StatusColor {
  /** Strong fill (badges, bars, icons on light bg). */
  base: string
  /** Tinted background for soft chips / banners. */
  soft: string
  /** Text/icon colour that sits legibly ON the soft background. */
  on: string
}

export interface ThemeColors {
  // Surfaces ------------------------------------------------------------------
  bg: string          // app canvas
  surface: string     // card / sheet
  surfaceAlt: string  // subtly raised block, list header, input fill
  surfaceSunken: string // wells, track backgrounds
  // Text ----------------------------------------------------------------------
  text: string          // primary — near black
  textSecondary: string // still dark enough to read in sun
  textMuted: string     // captions / meta (use sparingly outdoors)
  textInverse: string   // on primary / dark fills
  // Brand ---------------------------------------------------------------------
  primary: string       // TyrePulse green
  primaryDark: string   // pressed / text-on-light green
  primarySoft: string   // green tinted background
  onPrimary: string     // text/icon on primary fill
  // Lines ---------------------------------------------------------------------
  border: string        // hairline
  borderStrong: string  // emphasised divider / input border
  // Interaction ---------------------------------------------------------------
  focus: string
  overlay: string       // modal scrim
  shadow: string
  // Status --------------------------------------------------------------------
  success: StatusColor
  warning: StatusColor
  danger: StatusColor
  info: StatusColor
  critical: StatusColor
  neutral: StatusColor
}

export interface Theme {
  mode: ThemeMode
  color: ThemeColors
  /** Accent tints used by home quick actions / category chips. */
  tint: Record<
    'green' | 'blue' | 'amber' | 'red' | 'violet' | 'teal' | 'slate',
    { fg: string; bg: string }
  >
}

// ── Scale primitives (mode-independent) ──────────────────────────────────────

/** 4-pt spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 56,
} as const

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 26,
  pill: 999,
} as const

/**
 * Type scale — slightly larger than a typical app. Bigger text reads better
 * at arm's length in the sun. Weights skew bold for the same reason.
 */
export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '800' as const, letterSpacing: -0.5 },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '800' as const, letterSpacing: -0.3 },
  h2: { fontSize: 21, lineHeight: 27, fontWeight: '800' as const, letterSpacing: -0.2 },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '500' as const },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '700' as const },
  label: { fontSize: 13, lineHeight: 17, fontWeight: '700' as const, letterSpacing: 0.2 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 0.3 },
} as const

/** Minimum comfortable touch target (px). */
export const HIT = 48

// ── Light palette — the default, tuned for direct sun ────────────────────────

const light: ThemeColors = {
  bg: '#F4F7FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF2F7',
  surfaceSunken: '#E6EBF1',

  text: '#0B1220',
  textSecondary: '#33415A',
  textMuted: '#5B6B84',
  textInverse: '#FFFFFF',

  primary: '#15803D',       // deep green — high contrast on white in sun
  primaryDark: '#166534',
  primarySoft: '#DCFCE7',
  onPrimary: '#FFFFFF',

  border: '#D8E0EA',
  borderStrong: '#B9C5D6',

  focus: '#15803D',
  overlay: 'rgba(6,12,22,0.55)',
  shadow: '#0B1220',

  success:  { base: '#15803D', soft: '#DCFCE7', on: '#0F5C2E' },
  warning:  { base: '#B45309', soft: '#FEF3C7', on: '#8A3D07' },
  danger:   { base: '#DC2626', soft: '#FEE2E2', on: '#991B1B' },
  info:     { base: '#0369A1', soft: '#E0F2FE', on: '#075985' },
  critical: { base: '#B91C1C', soft: '#FEE2E2', on: '#7F1D1D' },
  neutral:  { base: '#475569', soft: '#EEF2F7', on: '#33415A' },
}

const lightTint: Theme['tint'] = {
  green:  { fg: '#15803D', bg: '#DCFCE7' },
  blue:   { fg: '#0369A1', bg: '#E0F2FE' },
  amber:  { fg: '#B45309', bg: '#FEF3C7' },
  red:    { fg: '#DC2626', bg: '#FEE2E2' },
  violet: { fg: '#6D28D9', bg: '#EDE9FE' },
  teal:   { fg: '#0F766E', bg: '#CCFBF1' },
  slate:  { fg: '#334155', bg: '#EEF2F7' },
}

// ── Dark palette — secondary (night / indoor). Not sun-optimised. ────────────

const dark: ThemeColors = {
  bg: '#0B1220',
  surface: '#121C2E',
  surfaceAlt: '#1B2740',
  surfaceSunken: '#0E1728',

  text: '#F1F5F9',
  textSecondary: '#C3CEDE',
  textMuted: '#8CA0B8',
  textInverse: '#0B1220',

  primary: '#22C55E',
  primaryDark: '#16A34A',
  primarySoft: 'rgba(34,197,94,0.15)',
  onPrimary: '#04140A',

  border: '#243248',
  borderStrong: '#33455F',

  focus: '#22C55E',
  overlay: 'rgba(2,6,14,0.7)',
  shadow: '#000000',

  success:  { base: '#22C55E', soft: 'rgba(34,197,94,0.16)',  on: '#86EFAC' },
  warning:  { base: '#F59E0B', soft: 'rgba(245,158,11,0.16)', on: '#FCD34D' },
  danger:   { base: '#EF4444', soft: 'rgba(239,68,68,0.16)',  on: '#FCA5A5' },
  info:     { base: '#38BDF8', soft: 'rgba(56,189,248,0.16)', on: '#7DD3FC' },
  critical: { base: '#F87171', soft: 'rgba(248,113,113,0.18)', on: '#FCA5A5' },
  neutral:  { base: '#94A3B8', soft: 'rgba(148,163,184,0.16)', on: '#CBD5E1' },
}

const darkTint: Theme['tint'] = {
  green:  { fg: '#4ADE80', bg: 'rgba(34,197,94,0.16)' },
  blue:   { fg: '#38BDF8', bg: 'rgba(56,189,248,0.16)' },
  amber:  { fg: '#FBBF24', bg: 'rgba(245,158,11,0.16)' },
  red:    { fg: '#F87171', bg: 'rgba(239,68,68,0.16)' },
  violet: { fg: '#A78BFA', bg: 'rgba(139,92,246,0.16)' },
  teal:   { fg: '#2DD4BF', bg: 'rgba(20,184,166,0.16)' },
  slate:  { fg: '#CBD5E1', bg: 'rgba(148,163,184,0.16)' },
}

export const lightTheme: Theme = { mode: 'light', color: light, tint: lightTint }
export const darkTheme: Theme = { mode: 'dark', color: dark, tint: darkTint }

export function themeForMode(mode: ThemeMode): Theme {
  return mode === 'dark' ? darkTheme : lightTheme
}

// ── Elevation helper ─────────────────────────────────────────────────────────
// Under the sun, shadow barely reads — so cards also get a hairline border.
// Callers typically spread `elevation(theme, n)` onto a card style and add a
// `borderWidth: 1, borderColor: theme.color.border`.

export function elevation(theme: Theme, level: 0 | 1 | 2 | 3 = 1) {
  if (level === 0) return {}
  const light = theme.mode === 'light'
  const map = {
    1: { h: 1, r: 3, o: light ? 0.06 : 0.4, e: 1 },
    2: { h: 3, r: 8, o: light ? 0.09 : 0.5, e: 3 },
    3: { h: 8, r: 18, o: light ? 0.12 : 0.6, e: 8 },
  } as const
  const s = map[level]
  return {
    shadowColor: theme.color.shadow,
    shadowOffset: { width: 0, height: s.h },
    shadowOpacity: s.o,
    shadowRadius: s.r,
    elevation: s.e,
  }
}

/** Resolve a semantic status kind to its colour triad for the active theme. */
export type StatusKind =
  | 'success' | 'warning' | 'danger' | 'info' | 'critical' | 'neutral'

export function statusColor(theme: Theme, kind: StatusKind): StatusColor {
  return theme.color[kind]
}
