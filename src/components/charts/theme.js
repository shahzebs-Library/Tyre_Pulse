/**
 * Chart theme tokens for the executive ECharts components.
 *
 * The categorical palettes below were validated (light + dark, against the
 * app's actual surfaces #ffffff / #0f172a) with the dataviz palette validator:
 * lightness band, chroma floor, adjacent-pair CVD separation, and contrast all
 * pass. Slot ORDER is the colorblind-safety mechanism — assign series to slots
 * in fixed order, never cycle or shuffle.
 */

import { useEffect, useState } from 'react'

/** Fixed-order categorical palette (identity encoding). */
export const CATEGORICAL = {
  light: ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'],
  dark:  ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'],
}

/** One-hue sequential ramps (magnitude encoding): low recedes toward the surface. */
export const SEQUENTIAL = {
  light: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  dark:  ['#104281', '#1c5cab', '#2a78d6', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'],
}

/** Status colors (state encoding) — reserved, never used as "series N". */
export const STATUS = {
  good:     '#0ca30c',
  warning:  '#fab219',
  serious:  '#ec835a',
  critical: '#d03b3b',
}

/**
 * Resolve the full token set for a mode. Pure — safe to use in tests and
 * option builders without a DOM.
 * @param {boolean} isDark
 * @returns {{isDark: boolean, palette: string[], sequential: string[],
 *   status: typeof STATUS, text: string, textMuted: string, grid: string,
 *   axisLine: string, tooltipBg: string, tooltipBorder: string, surface: string}}
 */
export function resolveChartTheme(isDark) {
  return {
    isDark,
    palette: CATEGORICAL[isDark ? 'dark' : 'light'],
    sequential: SEQUENTIAL[isDark ? 'dark' : 'light'],
    status: STATUS,
    text:          isDark ? '#e5e7eb' : '#111827',
    textMuted:     isDark ? '#9ca3af' : '#6b7280',
    grid:          isDark ? '#1f2937' : '#e5e7eb',
    axisLine:      isDark ? '#374151' : '#d1d5db',
    tooltipBg:     isDark ? '#1f2937' : '#ffffff',
    tooltipBorder: isDark ? '#374151' : '#e5e7eb',
    surface:       isDark ? '#0f172a' : '#ffffff',
  }
}

/** Shared recessive-chrome fragments merged into every chart option. */
export function baseOption(theme) {
  return {
    backgroundColor: 'transparent',
    color: theme.palette,
    textStyle: { color: theme.text, fontFamily: 'inherit' },
    tooltip: {
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.text, fontSize: 12 },
    },
  }
}

/** Detect current app theme from the ThemeContext-managed root class. */
export function detectDark() {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return true
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('light')) return false
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return true
}

/**
 * React hook: live chart theme that tracks the `dark` class ThemeContext
 * stamps on <html>, so charts re-render tokens on theme toggle.
 */
export function useChartTheme() {
  const [isDark, setIsDark] = useState(detectDark)

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined
    const observer = new MutationObserver(() => setIsDark(detectDark()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return resolveChartTheme(isDark)
}
