import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { ACCENT_THEMES, applyAccentVars, accentCache, normalizeAccentChoice } from '../lib/appThemes'

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

const KEY = {
  mode: 'tp_mode', accent: 'tp_accent', density: 'tp_density', motion: 'tp_motion',
  // Pre-paint cache read by public/theme-init.js, and the time of the last
  // local appearance change (used to decide whether the device or the account
  // copy is newer when a user signs in on another device).
  accentVars: 'tp_accent_vars', changedAt: 'tp_appearance_at',
}

/**
 * Accent presets come from src/lib/appThemes.js (the single source). `value`
 * is the stored choice (a preset id); `swatch` is what the picker paints.
 */
export const ACCENT_PRESETS = ACCENT_THEMES.map((t) => ({ id: t.id, label: t.label, value: t.id, swatch: t.swatch }))

export const THEME_MODES = [
  { id: 'light',  label: 'Light' },
  { id: 'dark',   label: 'Dark' },
  { id: 'system', label: 'System' },
]

export const DENSITIES = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact',     label: 'Compact' },
]

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

// Account sync is skipped under the test runner: it would reach the network.
const SYNC_ENABLED = typeof window !== 'undefined' && import.meta.env?.MODE !== 'test'

export function ThemeProvider({ children }) {
  // Light-first: a clean professional light theme is the default experience.
  // Users can still pick Dark or System in Settings → Appearance.
  const [mode, setMode] = useState(() => readInitial(KEY.mode, 'light', ['tyrepulse-theme', 'theme']))
  const [accent, setAccentRaw] = useState(() => normalizeAccentChoice(readInitial(KEY.accent, '')))
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

  // Personal accent → writes the accent token set (src/lib/appThemes.js) for
  // the resolved mode onto <html>. '' hands control back to the org brand;
  // Green writes nothing, so the stylesheet defaults apply unchanged.
  useEffect(() => {
    applyAccentVars(document.documentElement, accent, isDark ? 'dark' : 'light')
    try {
      localStorage.setItem(KEY.accent, accent)
      localStorage.setItem(KEY.accentVars, JSON.stringify(accentCache(accent)))
    } catch { /* ignore */ }
  }, [accent, isDark])

  // Density + motion
  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
    try { localStorage.setItem(KEY.density, density) } catch { /* ignore */ }
  }, [density])
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reducedMotion)
    try { localStorage.setItem(KEY.motion, reducedMotion ? '1' : '0') } catch { /* ignore */ }
  }, [reducedMotion])

  // ── Account sync ─────────────────────────────────────────────────────────
  // Every user change stamps a local time and is saved to the signed-in
  // user's profile (debounced). On sign-in the newer of device vs account
  // wins, so the choice follows the user to any device.
  const remoteApplying = useRef(false)
  const saveTimer = useRef(null)
  const dirty = useRef(false)
  const stamp = useCallback(() => {
    if (remoteApplying.current) return
    dirty.current = true
    try { localStorage.setItem(KEY.changedAt, String(Date.now())) } catch { /* ignore */ }
  }, [])
  const setAccent = useCallback((v) => { stamp(); setAccentRaw(normalizeAccentChoice(v)) }, [stamp])
  const setModeTracked = useCallback((m) => { stamp(); setMode(m) }, [stamp])

  useEffect(() => {
    if (!SYNC_ENABLED) return undefined
    let cancelled = false
    let unsub = () => {}
    import('../lib/api/uiPreferences').then(async (api) => {
      if (cancelled) return
      const sync = async (uid) => {
        try {
          const res = await api.readUiPreferences(uid)
          if (!res.ok || cancelled) return
          const remote = api.parseAppearance(res.prefs)
          const localAt = Number(readInitial(KEY.changedAt, '0')) || 0
          if (remote && remote.updatedAt > localAt) {
            remoteApplying.current = true
            if (remote.mode) setMode(remote.mode)
            if (remote.accent != null) setAccentRaw(normalizeAccentChoice(remote.accent))
            remoteApplying.current = false
            try { localStorage.setItem(KEY.changedAt, String(remote.updatedAt)) } catch { /* ignore */ }
          } else if (localAt && (!remote || localAt > remote.updatedAt)) {
            await api.saveAppearancePreference(uid, {
              mode: readInitial(KEY.mode, 'light'),
              accent: readInitial(KEY.accent, ''),
              updatedAt: localAt,
            })
          }
        } catch { /* the device copy keeps working */ }
      }
      unsub = api.onSignedIn(sync)
    }).catch(() => {})
    return () => { cancelled = true; unsub() }
  }, [])

  // Push local changes to the account shortly after they happen.
  useEffect(() => {
    // Only a change the user just made is pushed; never the value loaded at
    // start-up, which could overwrite a newer copy saved from another device.
    if (!SYNC_ENABLED || !dirty.current) return undefined
    dirty.current = false
    const at = Number(readInitial(KEY.changedAt, '0')) || 0
    if (!at) return undefined
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      import('../lib/api/uiPreferences').then(async (api) => {
        const uid = await api.currentUserId()
        if (uid) await api.saveAppearancePreference(uid, { mode, accent, updatedAt: at })
      }).catch(() => {})
    }, 800)
    return () => clearTimeout(saveTimer.current)
  }, [mode, accent])
  const toggleTheme = useCallback(() => setModeTracked(isDark ? 'light' : 'dark'), [isDark, setModeTracked])
  // `setTheme` is the mode setter with a guard so only valid modes are accepted.
  const setTheme = useCallback((m) => {
    if (m === 'light' || m === 'dark' || m === 'system') setModeTracked(m)
  }, [setModeTracked])
  const reset = useCallback(() => {
    stamp(); setMode('system'); setAccentRaw(''); setDensity('comfortable'); setReducedMotion(false)
  }, [stamp])

  const resolvedTheme = isDark ? 'dark' : 'light'

  const value = useMemo(() => ({
    // legacy shape
    theme: resolvedTheme, isDark, toggleTheme,
    // canonical theme API: `theme` selection ('dark'|'light'|'system') via `mode`,
    // `resolvedTheme` = what is actually applied, `setTheme`/`toggleTheme` mutate it.
    resolvedTheme, setTheme,
    // appearance
    mode, setMode: setTheme, accent, setAccent, density, setDensity, reducedMotion, setReducedMotion,
    reset, presets: ACCENT_PRESETS, modes: THEME_MODES, densities: DENSITIES,
    isCustomAccent: !!accent, isDefaultAppearance: mode === 'system' && !accent && density === 'comfortable' && !reducedMotion,
  }), [resolvedTheme, isDark, toggleTheme, setTheme, mode, accent, setAccent, density, reducedMotion, reset])

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

const FALLBACK = {
  theme: 'dark', resolvedTheme: 'dark', isDark: true, toggleTheme: () => {}, setTheme: () => {},
  mode: 'system', setMode: () => {},
  accent: '', setAccent: () => {}, density: 'comfortable', setDensity: () => {},
  reducedMotion: false, setReducedMotion: () => {}, reset: () => {},
  presets: ACCENT_PRESETS, modes: THEME_MODES, densities: DENSITIES,
  isCustomAccent: false, isDefaultAppearance: true,
}

export function useTheme() { return useContext(AppearanceContext) || FALLBACK }
export const useAppearance = useTheme
