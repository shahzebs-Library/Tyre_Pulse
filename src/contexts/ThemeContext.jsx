import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'

/**
 * Appearance context — the single source of truth for how the app looks for the
 * signed-in user on this device. Extends the old light/dark toggle into full
 * personal control: theme mode, accent colour, density and motion. Everything
 * persists to localStorage and applies live to <html> so any screen reflects it
 * instantly.
 *
 * Precedence for the accent colour: personal choice > organisation brand
 * (TenantContext) > product default. TenantContext checks the `userAccent`
 * marker this provider sets, so a user's own colour is never overwritten by the
 * org brand.
 *
 * `useTheme()` keeps its original shape (`theme`, `toggleTheme`, `isDark`) for
 * existing consumers; `useAppearance()` is the richer alias.
 */

const AppearanceContext = createContext(null)

const KEY = { mode: 'tp_mode', accent: 'tp_accent', density: 'tp_density', motion: 'tp_motion' }

/** Curated accent presets. `value` seeds the accent + the whole brand ramp. */
export const ACCENT_PRESETS = [
  { id: 'green',   label: 'Fleet Green', value: '#16a34a' },
  { id: 'emerald', label: 'Emerald',     value: '#059669' },
  { id: 'teal',    label: 'Teal',        value: '#0d9488' },
  { id: 'cyan',    label: 'Cyan',        value: '#0891b2' },
  { id: 'blue',    label: 'Ocean',       value: '#2563eb' },
  { id: 'indigo',  label: 'Indigo',      value: '#4f46e5' },
  { id: 'violet',  label: 'Violet',      value: '#7c3aed' },
  { id: 'rose',    label: 'Rose',        value: '#e11d48' },
  { id: 'amber',   label: 'Amber',       value: '#d97706' },
  { id: 'slate',   label: 'Graphite',    value: '#475569' },
]

export const THEME_MODES = [
  { id: 'light',  label: 'Light' },
  { id: 'dark',   label: 'Dark' },
  { id: 'system', label: 'System' },
]

export const DENSITIES = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact',     label: 'Compact' },
]

const HEX_RE = /^#([0-9a-f]{6})$/i

function normHex(v) {
  if (!v) return ''
  let s = String(v).trim()
  if (s && s[0] !== '#') s = `#${s}`
  if (/^#([0-9a-f]{3})$/i.test(s)) s = '#' + s.slice(1).split('').map((c) => c + c).join('')
  return HEX_RE.test(s) ? s.toLowerCase() : ''
}

function hexToRgb(hex) {
  const m = normHex(hex).slice(1)
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) }
}
function rgba(hex, a) { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})` }
/** Lighten toward white by t (0..1) — used to derive the brighter accent stop. */
function lighten(hex, t) {
  const { r, g, b } = hexToRgb(hex)
  const mix = (c) => Math.round(c + (255 - c) * t)
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function systemDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function readInitial(key, fallback, legacyKeys = []) {
  try {
    const v = localStorage.getItem(key)
    if (v != null) return v
    for (const lk of legacyKeys) { const lv = localStorage.getItem(lk); if (lv != null) return lv }
  } catch { /* ignore */ }
  return fallback
}

export function ThemeProvider({ children }) {
  // Light-first: a clean professional light theme is the default experience.
  // Users can still pick Dark or System in Settings → Appearance.
  const [mode, setMode] = useState(() => readInitial(KEY.mode, 'light', ['tyrepulse-theme', 'theme']))
  const [accent, setAccentRaw] = useState(() => normHex(readInitial(KEY.accent, '')))
  const [density, setDensity] = useState(() => readInitial(KEY.density, 'comfortable'))
  const [reducedMotion, setReducedMotion] = useState(() => readInitial(KEY.motion, '0') === '1')

  const [sysDark, setSysDark] = useState(systemDark)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = (e) => setSysDark(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  const isDark = mode === 'system' ? sysDark : mode === 'dark'

  // Theme class
  useEffect(() => {
    const r = document.documentElement
    r.classList.toggle('dark', isDark)
    r.classList.toggle('light', !isDark)
    try { localStorage.setItem(KEY.mode, mode); localStorage.removeItem('tyrepulse-theme'); localStorage.removeItem('theme') } catch { /* ignore */ }
  }, [isDark, mode])

  // Personal accent → seeds the accent + brand ramp so buttons, focus rings and
  // gradients all follow it. Clearing it hands control back to the org brand.
  useEffect(() => {
    const r = document.documentElement
    const props = ['--accent', '--accent-strong', '--accent-ring', '--brand', '--brand-bright', '--brand-electric', '--brand-glow']
    if (accent) {
      r.style.setProperty('--accent', accent)
      r.style.setProperty('--accent-strong', lighten(accent, 0.18))
      r.style.setProperty('--accent-ring', rgba(accent, 0.55))
      r.style.setProperty('--brand', accent)
      r.style.setProperty('--brand-bright', lighten(accent, 0.16))
      r.style.setProperty('--brand-electric', lighten(accent, 0.32))
      r.style.setProperty('--brand-glow', rgba(accent, 0.4))
      r.dataset.userAccent = '1'
    } else if (r.dataset.userAccent) {
      props.forEach((p) => r.style.removeProperty(p))
      delete r.dataset.userAccent
    }
    try { localStorage.setItem(KEY.accent, accent) } catch { /* ignore */ }
  }, [accent])

  // Density + motion
  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
    try { localStorage.setItem(KEY.density, density) } catch { /* ignore */ }
  }, [density])
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reducedMotion)
    try { localStorage.setItem(KEY.motion, reducedMotion ? '1' : '0') } catch { /* ignore */ }
  }, [reducedMotion])

  const setAccent = useCallback((v) => setAccentRaw(v ? normHex(v) : ''), [])
  const toggleTheme = useCallback(() => setMode(isDark ? 'light' : 'dark'), [isDark])
  const reset = useCallback(() => {
    setMode('system'); setAccentRaw(''); setDensity('comfortable'); setReducedMotion(false)
  }, [])

  const value = useMemo(() => ({
    // legacy shape
    theme: isDark ? 'dark' : 'light', isDark, toggleTheme,
    // appearance
    mode, setMode, accent, setAccent, density, setDensity, reducedMotion, setReducedMotion,
    reset, presets: ACCENT_PRESETS, modes: THEME_MODES, densities: DENSITIES,
    isCustomAccent: !!accent, isDefaultAppearance: mode === 'system' && !accent && density === 'comfortable' && !reducedMotion,
  }), [isDark, toggleTheme, mode, setMode, accent, setAccent, density, reducedMotion, reset])

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

const FALLBACK = {
  theme: 'dark', isDark: true, toggleTheme: () => {}, mode: 'system', setMode: () => {},
  accent: '', setAccent: () => {}, density: 'comfortable', setDensity: () => {},
  reducedMotion: false, setReducedMotion: () => {}, reset: () => {},
  presets: ACCENT_PRESETS, modes: THEME_MODES, densities: DENSITIES,
  isCustomAccent: false, isDefaultAppearance: true,
}

export function useTheme() { return useContext(AppearanceContext) || FALLBACK }
export const useAppearance = useTheme
