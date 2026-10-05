/**
 * dashboardBuilderView - pure shaping for the Dashboard Builder page
 * (src/pages/DashboardBuilder.jsx). No I/O, no clock reads: every time-based
 * helper takes an injectable `now`.
 *
 * The widget catalog, layout model and filters live in src/lib/dashboardBuilder.js;
 * this module only groups and labels them for the three-panel builder layout
 * (Widget Library | Canvas | Dashboard Settings).
 */

/** Library tabs, matching the owner's mockup. */
export const LIBRARY_TABS = Object.freeze([
  { key: 'all', label: 'All Widgets' },
  { key: 'visuals', label: 'Visuals' },
  { key: 'data', label: 'Data' },
  { key: 'kpis', label: 'KPIs' },
])

/** Widget kind to library section. */
const KIND_SECTION = Object.freeze({
  stat: 'kpi', gauge: 'kpi',
  line: 'visual', bar: 'visual', donut: 'visual',
  list: 'data',
})

export const LIBRARY_SECTIONS = Object.freeze([
  { key: 'kpi', label: 'KPI Widgets', tab: 'kpis' },
  { key: 'visual', label: 'Charts & Visuals', tab: 'visuals' },
  { key: 'data', label: 'Data Widgets', tab: 'data' },
])

export const KIND_LABEL = Object.freeze({
  stat: 'KPI card', gauge: 'Gauge', line: 'Line chart', bar: 'Bar chart', donut: 'Donut chart', list: 'Data list',
})

export function sectionOf(kind) {
  return KIND_SECTION[kind] || 'data'
}

/**
 * Group the catalog into library sections, filtered by tab and free-text search
 * (label, description, category). Empty sections are dropped.
 */
export function librarySections(catalog, { tab = 'all', search = '', placedIds = [] } = {}) {
  const q = String(search || '').trim().toLowerCase()
  const placed = {}
  for (const id of Array.isArray(placedIds) ? placedIds : []) placed[id] = (placed[id] || 0) + 1
  const list = (Array.isArray(catalog) ? catalog : []).filter((w) => {
    if (!w) return false
    if (!q) return true
    return [w.label, w.description, w.category].join(' ').toLowerCase().includes(q)
  })
  return LIBRARY_SECTIONS
    .filter((s) => tab === 'all' || s.tab === tab)
    .map((s) => ({
      ...s,
      items: list
        .filter((w) => sectionOf(w.kind) === s.key)
        .map((w) => ({ ...w, kindLabel: KIND_LABEL[w.kind] || 'Widget', placed: placed[w.id] || 0 })),
    }))
    .filter((s) => s.items.length > 0)
}

/** Canvas facts: widget count, distinct data sources and category mix. */
export function canvasSummary(layout, byId = {}) {
  const widgets = Array.isArray(layout?.widgets) ? layout.widgets : []
  const sources = new Set()
  const categories = {}
  for (const w of widgets) {
    const def = byId[w.widgetId]
    if (!def) continue
    if (def.data?.source) sources.add(def.data.source)
    categories[def.category] = (categories[def.category] || 0) + 1
  }
  return {
    widgets: widgets.length,
    sources: sources.size,
    categories: Object.entries(categories).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  }
}

const toTime = (v) => {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** "just now" / "5 minutes ago" / "3 hours ago" / "2 days ago"; null when unknown. */
export function relativeAgo(iso, now) {
  const t = toTime(iso)
  const n = toTime(now)
  if (t == null || n == null) return null
  const s = Math.max(0, Math.round((n - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/**
 * Save status line for the canvas header. There is no auto-save: changes are
 * kept in the draft until the user saves, so this never claims "auto-saved".
 */
export function saveStatus({ dirty, layout, isStarter, now }) {
  if (dirty) return { tone: 'warn', text: 'Unsaved changes' }
  if (isStarter) return { tone: 'muted', text: 'Starter layout, save a copy to keep changes' }
  const ago = relativeAgo(layout?.updated_at, now)
  return { tone: 'good', text: ago ? `Saved ${ago}` : 'Saved' }
}

/** Preview devices. `cols` null means follow the viewport. */
export const DEVICES = Object.freeze([
  { key: 'desktop', label: 'Desktop preview', cols: null, maxWidth: null },
  { key: 'tablet', label: 'Tablet preview', cols: 2, maxWidth: 820 },
  { key: 'mobile', label: 'Phone preview', cols: 1, maxWidth: 420 },
])

/** Grid columns for a device and the current canvas width. */
export function gridColumns(device, canvasWidth) {
  const d = DEVICES.find((x) => x.key === device) || DEVICES[0]
  if (d.cols) return d.cols
  const w = Number(canvasWidth)
  if (!Number.isFinite(w) || w <= 0) return 4
  if (w < 520) return 1
  if (w < 640) return 2
  return 4
}

/** Column span for a widget width on a grid of `cols` columns. */
export function spanFor(w, cols) {
  const n = Math.max(1, Math.round(Number(w) || 1))
  return Math.min(n, Math.max(1, cols || 1))
}

/** Plain-English description of the active global filters. */
export function filterSummary(filters, presets = []) {
  const f = filters || {}
  const range = (presets.find((p) => p.value === f.range) || {}).label || 'All time'
  const when = f.range === 'custom'
    ? `${f.from || 'start'} to ${f.to || 'today'}`
    : range
  const site = !f.site || f.site === 'All' ? 'all sites' : f.site
  const country = !f.country || f.country === 'All' ? 'all countries' : f.country
  return `${when}, ${site}, ${country}`
}

/**
 * Who can see and change the layout. The layout model has two audiences only:
 * the owner (private) or everyone in the organisation (shared by an Admin).
 */
export function accessSummary(layout, { userId = null, isAdmin = false, isStarter = false } = {}) {
  if (!layout) return null
  if (isStarter) {
    return {
      audience: 'Everyone (starter layout)',
      owner: 'Built in',
      canEdit: false,
      canShare: false,
      note: 'The starter layout cannot be changed. Use Save as Template to make your own copy.',
    }
  }
  const own = Boolean(userId && layout.created_by === userId)
  return {
    audience: layout.shared ? 'Everyone in the organisation' : 'Only the owner',
    owner: own ? 'You' : (layout.created_by ? 'Another user' : 'Not recorded'),
    canEdit: own || isAdmin,
    canShare: isAdmin,
    note: layout.shared
      ? 'Published: every user can open this layout. Only the owner or an Admin can change it.'
      : 'Private: only the owner sees this layout. An Admin can publish it to everyone.',
  }
}
