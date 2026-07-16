/**
 * ThemeContext — provides the active design-system Theme to the whole app.
 *
 * Default = LIGHT (sunlight-readable). Users can opt into dark for night/indoor
 * use; the choice is persisted. 'system' follows the OS appearance.
 *
 * Usage:
 *   const { theme } = useTheme()
 *   ...backgroundColor: theme.color.bg
 */

import {
  createContext, useContext, useEffect, useMemo, useState, useCallback, ReactNode,
} from 'react'
import { Appearance, ColorSchemeName } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { Theme, ThemeMode, themeForMode } from '../lib/theme'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'tp_theme_pref'

interface ThemeContextValue {
  theme: Theme
  mode: ThemeMode
  /** Raw user preference ('system' resolves to OS). */
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
  /** Convenience: flips light <-> dark (drops 'system'). */
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function resolveMode(pref: ThemePreference, system: ColorSchemeName): ThemeMode {
  if (pref === 'system') return system === 'dark' ? 'dark' : 'light'
  return pref
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('light')
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(
    Appearance.getColorScheme(),
  )

  // Load persisted preference once.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(saved => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setPreferenceState(saved)
        }
      })
      .catch(() => {})
  }, [])

  // Track OS appearance for 'system' preference.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) =>
      setSystemScheme(colorScheme),
    )
    return () => sub.remove()
  }, [])

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p)
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {})
  }, [])

  const mode = resolveMode(preference, systemScheme)

  const toggle = useCallback(() => {
    setPreference(mode === 'dark' ? 'light' : 'dark')
  }, [mode, setPreference])

  const theme = useMemo(() => themeForMode(mode), [mode])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, mode, preference, setPreference, toggle }),
    [theme, mode, preference, setPreference, toggle],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}
