/**
 * reportColors.js - ONE vivid, accessible color system for every report surface
 * (Board Overview, Executive, Accident report, Analytics, scheduled exports).
 *
 * Goal: reports read as one colourful system rather than muted grey charts.
 * Colours are chosen to stay distinct and legible on BOTH the dark app UI and
 * the white printed / PDF paper. Import from here instead of hard-coding hex in
 * a chart config, so a palette change is one edit everywhere.
 */

// Primary categorical palette: 12 vivid, well-separated hues (Tailwind 500/600
// family) that stay distinguishable in print and for common colour-blindness.
export const CATEGORICAL = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#ec4899', // pink
  '#84cc16', // lime
  '#06b6d4', // cyan
  '#a855f7', // purple
]

// Semantic accents for KPI tiles / status (green good, amber watch, red risk).
export const ACCENTS = {
  primary: '#6366f1',
  good: '#10b981',
  watch: '#f59e0b',
  risk: '#ef4444',
  info: '#0ea5e9',
  neutral: '#64748b',
}

// Trend lines: an ordered set so multiple series on one time axis stay distinct.
export const TREND_LINES = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6']

/** Colour at an index, cycling through the categorical palette. */
export function colorAt(i) {
  return CATEGORICAL[((i % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length]
}

/** n categorical colours (for an n-slice doughnut / n-bar chart). */
export function categorical(n) {
  return Array.from({ length: Math.max(0, n | 0) }, (_, i) => colorAt(i))
}

/** Add an alpha channel to a #rrggbb hex, returning #rrggbbaa. */
export function withAlpha(hex, alpha = 1) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return hex
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0')
  return `#${h}${a}`
}

/**
 * Style a chart.js data object with the shared palette (non-mutating).
 * kind: 'bar' | 'doughnut' | 'pie' -> per-point categorical fill.
 *       'line' | 'area'          -> per-dataset trend colour (+ soft fill for area).
 */
export function stylize(data, kind = 'bar') {
  if (!data || !Array.isArray(data.datasets)) return data
  const datasets = data.datasets.map((ds, di) => {
    if (kind === 'line' || kind === 'area') {
      const c = TREND_LINES[di % TREND_LINES.length]
      return {
        borderColor: c,
        backgroundColor: kind === 'area' ? withAlpha(c, 0.15) : c,
        pointBackgroundColor: c,
        pointBorderColor: c,
        borderWidth: 2,
        tension: 0.35,
        fill: kind === 'area',
        ...ds,
      }
    }
    // bar / doughnut / pie: colour each point
    const n = Array.isArray(ds.data) ? ds.data.length : 0
    const colors = categorical(n)
    return { backgroundColor: colors, borderColor: colors, borderWidth: 1, ...ds }
  })
  return { ...data, datasets }
}
