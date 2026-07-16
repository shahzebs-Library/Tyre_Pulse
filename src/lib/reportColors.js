/**
 * reportColors.js - ONE themeable colour system for every report surface
 * (Board Overview, Executive, Accident report, Analytics, scheduled exports).
 *
 * A super-admin can choose the report theme (a named preset or a custom set of
 * hex colours); the choice is applied here via setReportPalette() and every
 * report chart follows it, so reports read as one system. Colours stay legible
 * on BOTH the dark app UI and the white printed / PDF paper. Import from here
 * instead of hard-coding hex in a chart config.
 */

// ── Named theme presets (each 12 vivid, well-separated, print-safe hues) ──────
export const PRESETS = {
  vivid:    ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#84cc16', '#06b6d4', '#a855f7'],
  ocean:    ['#0ea5e9', '#0891b2', '#14b8a6', '#3b82f6', '#6366f1', '#22d3ee', '#2dd4bf', '#0284c7', '#38bdf8', '#818cf8', '#06b6d4', '#0d9488'],
  sunset:   ['#f97316', '#ef4444', '#f59e0b', '#ec4899', '#e11d48', '#fb923c', '#f43f5e', '#d946ef', '#fbbf24', '#fca5a5', '#c026d3', '#ea580c'],
  forest:   ['#10b981', '#84cc16', '#14b8a6', '#65a30d', '#059669', '#22c55e', '#4d7c0f', '#0d9488', '#a3e635', '#16a34a', '#047857', '#3f6212'],
  berry:    ['#8b5cf6', '#ec4899', '#a855f7', '#d946ef', '#c026d3', '#6366f1', '#f472b6', '#7c3aed', '#e879f9', '#9333ea', '#db2777', '#4f46e5'],
  slate:    ['#475569', '#6366f1', '#0ea5e9', '#64748b', '#334155', '#818cf8', '#38bdf8', '#94a3b8', '#4f46e5', '#0284c7', '#1e293b', '#7dd3fc'],
  contrast: ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4338ca', '#0d9488', '#be123c'],
  warm:     ['#f59e0b', '#ef4444', '#f97316', '#eab308', '#dc2626', '#fb923c', '#facc15', '#b91c1c', '#fbbf24', '#c2410c', '#a16207', '#f43f5e'],
}
export const PRESET_KEYS = Object.keys(PRESETS)
export const PRESET_LABELS = {
  vivid: 'Vivid', ocean: 'Ocean', sunset: 'Sunset', forest: 'Forest',
  berry: 'Berry', slate: 'Corporate Slate', contrast: 'High Contrast', warm: 'Warm',
}

// The default vivid palette (kept as a stable reference export).
export const CATEGORICAL = PRESETS.vivid
export const DEFAULT_PRESET = 'vivid'
const LS_KEY = 'report.palette.v1'

// Semantic accents for KPI tiles / status (green good, amber watch, red risk).
export const ACCENTS = {
  primary: '#6366f1', good: '#10b981', watch: '#f59e0b', risk: '#ef4444', info: '#0ea5e9', neutral: '#64748b',
}
// Ordered trend-line colours (vivid default; the active palette is used at runtime).
export const TREND_LINES = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6']

// ── Active palette (runtime-configurable) ────────────────────────────────────
let _active = [...PRESETS[DEFAULT_PRESET]]
let _activeName = DEFAULT_PRESET

/** Resolve a preset name or a custom colour array to a clean hex list. */
function resolvePalette(nameOrColors) {
  if (Array.isArray(nameOrColors)) {
    const cleaned = nameOrColors.map((c) => String(c || '').trim()).filter((c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c))
    return cleaned.length ? cleaned : null
  }
  if (typeof nameOrColors === 'string' && PRESETS[nameOrColors]) return [...PRESETS[nameOrColors]]
  return null
}

/**
 * Set the active report palette from a preset name or a custom hex array.
 * Persists to localStorage so it survives reloads. No-op on invalid input.
 * @returns the resolved active palette.
 */
export function setReportPalette(nameOrColors, { persist = true } = {}) {
  const resolved = resolvePalette(nameOrColors)
  if (!resolved) return _active
  _active = resolved
  _activeName = typeof nameOrColors === 'string' && PRESETS[nameOrColors] ? nameOrColors : 'custom'
  if (persist) { try { localStorage.setItem(LS_KEY, JSON.stringify(nameOrColors)) } catch { /* ignore */ } }
  return _active
}

/** The active palette (copy). */
export function getReportPalette() { return _active.slice() }
/** The active preset name, or 'custom' for a bespoke palette. */
export function activePaletteName() { return _activeName }

// Apply any previously-saved choice at module load (browser only).
try {
  const saved = JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) || 'null')
  if (saved) setReportPalette(saved, { persist: false })
} catch { /* ignore */ }

// ── Helpers (derive from the ACTIVE palette) ─────────────────────────────────
/** Colour at an index, cycling through the active palette. */
export function colorAt(i) {
  const p = _active
  return p[((i % p.length) + p.length) % p.length]
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
 * Style a chart.js data object with the active palette (non-mutating).
 * kind: 'bar' | 'doughnut' | 'pie' -> per-point categorical fill.
 *       'line' | 'area'          -> per-dataset trend colour (+ soft fill for area).
 */
export function stylize(data, kind = 'bar') {
  if (!data || !Array.isArray(data.datasets)) return data
  const pal = _active
  const datasets = data.datasets.map((ds, di) => {
    if (kind === 'line' || kind === 'area') {
      const c = pal[di % pal.length]
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
    const cnt = Array.isArray(ds.data) ? ds.data.length : 0
    const colors = categorical(cnt)
    return { backgroundColor: colors, borderColor: colors, borderWidth: 1, ...ds }
  })
  return { ...data, datasets }
}
