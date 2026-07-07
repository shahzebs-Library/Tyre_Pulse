// ─────────────────────────────────────────────────────────────────────────────
// echartsTheme.js — resolved colour palette for ECharts canvases.
//
// ECharts renders to <canvas>, so it cannot read CSS variables the way DOM
// elements do. This helper resolves the app's theme tokens at runtime via
// getComputedStyle on <html> (where index.css defines them) and falls back to
// sane literals when a token is missing (tests, detached environments).
// Rebuild the palette whenever `isDark` flips — the page memoises on it.
// ─────────────────────────────────────────────────────────────────────────────

const DARK_FALLBACK = {
  '--text-primary':   '#f1f5f2',
  '--text-secondary': '#aab6ae',
  '--text-muted':     '#7e8c84',
  '--border-dim':     'rgba(255,255,255,0.08)',
  '--accent':         '#16a34a',
}

const LIGHT_FALLBACK = {
  '--text-primary':   '#101828',
  '--text-secondary': '#344054',
  '--text-muted':     '#667085',
  '--border-dim':     '#eaedf1',
  '--accent':         '#16a34a',
}

/** Read one CSS variable off <html>, falling back per theme. */
function cssVar(name, isDark) {
  const fallback = (isDark ? DARK_FALLBACK : LIGHT_FALLBACK)[name] || ''
  if (typeof document === 'undefined') return fallback
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  } catch {
    return fallback
  }
}

/**
 * Build the ECharts palette for the current theme.
 * @param {boolean} isDark
 * @returns {object} palette used by the option builders on ExecutiveAnalytics
 */
export function getEchartsTheme(isDark) {
  const text      = cssVar('--text-primary', isDark)
  const subText   = cssVar('--text-secondary', isDark)
  const muted     = cssVar('--text-muted', isDark)
  const border    = cssVar('--border-dim', isDark)
  const accent    = cssVar('--accent', isDark)

  return {
    isDark,
    text,
    subText,
    muted,
    accent,
    axisLine:  isDark ? 'rgba(255,255,255,0.14)' : 'rgba(16,24,40,0.16)',
    splitLine: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,24,40,0.07)',
    border,
    tooltipBg:     isDark ? 'rgba(10,18,13,0.96)' : 'rgba(255,255,255,0.98)',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,24,40,0.12)',
    tooltipText:   text,
    // Solid canvas background for PNG export (transparent while on-screen).
    exportBg: isDark ? '#0b1210' : '#ffffff',
    // Categorical series palette — chart data colours (theme-independent hues,
    // chosen to read on both light and dark canvases).
    series: [
      accent || '#16a34a',
      '#2563eb', '#d97706', '#7c3aed', '#0d9488',
      '#e11d48', '#4f46e5', '#ca8a04', '#0891b2', '#db2777',
    ],
    // Sequential ramp for the cost heatmap (low → high spend).
    heatRamp: isDark
      ? ['#0e2418', '#14532d', '#15803d', '#ca8a04', '#dc2626']
      : ['#ecfdf5', '#86efac', '#22c55e', '#f59e0b', '#dc2626'],
    // Gauge stop colours (bad → good handled per gauge builder).
    good: '#16a34a',
    warn: '#d97706',
    bad:  '#dc2626',
  }
}

export default getEchartsTheme
