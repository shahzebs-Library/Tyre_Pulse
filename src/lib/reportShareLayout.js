/**
 * reportShareLayout - pure engine + catalog for CUSTOM TV / kiosk report boards.
 *
 * A report share can carry a `layout` (jsonb) that describes bespoke boards the
 * creator designs block-by-block (add / resize / restyle), instead of the fixed
 * REPORT_PAGES catalog. Every block renders from the SAME org-scoped aggregate
 * snapshot that get_report_snapshot already returns (kpis / trends / breakdowns /
 * heatmap / ops) - so a custom layout exposes NO new data surface.
 *
 * This module is the SINGLE source of truth for:
 *  - the layout / board / block schema and its defaults,
 *  - the catalog of data sources (what a block can show) + chart styles (how),
 *  - normalizeLayout() (coerce + clamp any stored / drafted layout to a safe shape),
 *  - resolveBlock(block, snapshot) (map a block to its render-ready data slice),
 *  - starter boards / presets for the builder.
 *
 * Pure + framework-free: no React, no I/O, no charting. The viewer
 * (src/pages/ReportShare.jsx) turns a resolved block into an ECharts option; the
 * builder (src/components/display/ReportShareBuilder.jsx) edits the layout. Both
 * import ONLY from here so they never disagree on the shape.
 *
 * No em / en dashes, arrows, middle dots or curly quotes in any label (the boards
 * render on a public wall board and in exports).
 */

// ── Grid geometry limits (a board fills exactly one screen, never scrolls) ──────
export const BOARD_COLS_MIN = 1
export const BOARD_COLS_MAX = 6
export const BOARD_ROWS_MIN = 1
export const BOARD_ROWS_MAX = 6
export const BLOCK_W_MIN = 1
export const BLOCK_H_MIN = 1
export const MAX_BOARDS = 12
export const MAX_BLOCKS_PER_BOARD = 24

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

// ── ID generation (browser + test safe; never collides within a session) ───────
let _seq = 0
export function newId(prefix = 'b') {
  _seq += 1
  const t = (typeof Date !== 'undefined' && Date.now) ? Date.now().toString(36) : 'x'
  return `${prefix}_${t}${_seq.toString(36)}`
}

// ── Data-source catalog ─────────────────────────────────────────────────────────
// Every source names a slice of the snapshot. `kind` decides which chart styles
// (VIZ) are valid and how resolveBlock reads it.
//   kpi       -> a single number (snapshot.kpis[path] or snapshot.ops[path])
//   series    -> a 12-month array (snapshot.trends[path]) plotted over labels
//   breakdown -> a [{label,value}] list (snapshot.breakdowns[path])
//   combo     -> tyre spend (bars) + accidents (line), dual axis
//   claims    -> claimed vs recovered, two smooth lines
//   heatmap   -> site x severity intensity (snapshot.heatmap)
//   ratio     -> a 0..100 percentage dial (numerator / denominator KPIs)
//   table     -> a small operational list (snapshot.ops[path])
export const SOURCES = [
  // KPI counts / money
  { key: 'kpi.fleet',            kind: 'kpi', label: 'Fleet Vehicles',    from: 'kpis', path: 'fleet',            money: false, group: 'Fleet' },
  { key: 'kpi.tyres',            kind: 'kpi', label: 'Tyres Tracked',     from: 'kpis', path: 'tyres',            money: false, group: 'Fleet' },
  { key: 'kpi.tyre_spend',       kind: 'kpi', label: 'Tyre Spend',        from: 'kpis', path: 'tyre_spend',       money: true,  group: 'Cost' },
  { key: 'kpi.accidents',        kind: 'kpi', label: 'Accidents',         from: 'kpis', path: 'accidents',        money: false, group: 'Risk' },
  { key: 'kpi.open_accidents',   kind: 'kpi', label: 'Open Accidents',    from: 'kpis', path: 'open_accidents',   money: false, group: 'Risk' },
  { key: 'kpi.claims_claimed',   kind: 'kpi', label: 'Claims Claimed',    from: 'kpis', path: 'claims_claimed',   money: true,  group: 'Claims' },
  { key: 'kpi.claims_recovered', kind: 'kpi', label: 'Claims Recovered',  from: 'kpis', path: 'claims_recovered', money: true,  group: 'Claims' },
  { key: 'kpi.inspections',      kind: 'kpi', label: 'Inspections',       from: 'kpis', path: 'inspections',      money: false, group: 'Fleet' },
  { key: 'kpi.work_orders_open', kind: 'kpi', label: 'Open Work Orders',  from: 'kpis', path: 'work_orders_open', money: false, group: 'Operations' },
  // Ops "today" counts
  { key: 'ops.job_cards_today',    kind: 'kpi', label: 'Job Cards Today',     from: 'ops', path: 'job_cards_today',    money: false, group: 'Operations' },
  { key: 'ops.tyre_changes_today', kind: 'kpi', label: 'Tyre Changes Today',  from: 'ops', path: 'tyre_changes_today', money: false, group: 'Operations' },
  { key: 'ops.inspections_today',  kind: 'kpi', label: 'Inspections Today',   from: 'ops', path: 'inspections_today',  money: false, group: 'Operations' },
  { key: 'ops.accidents_today',    kind: 'kpi', label: 'Accidents Today',     from: 'ops', path: 'accidents_today',    money: false, group: 'Operations' },
  { key: 'ops.alerts_critical',    kind: 'kpi', label: 'Critical Alerts',     from: 'ops', path: 'alerts_critical',    money: false, group: 'Operations' },
  { key: 'ops.pm_overdue',         kind: 'kpi', label: 'PM Overdue',          from: 'ops', path: 'pm_overdue',         money: false, group: 'Maintenance' },
  { key: 'ops.pm_due_soon',        kind: 'kpi', label: 'PM Due Soon',         from: 'ops', path: 'pm_due_soon',        money: false, group: 'Maintenance' },
  // 12-month trend series
  { key: 'trend.tyre_spend',       kind: 'series', label: 'Tyre Spend (12 mo)',        path: 'tyre_spend',       accent: 0, group: 'Trends' },
  { key: 'trend.accidents',        kind: 'series', label: 'Accidents (12 mo)',         path: 'accidents',        accent: 3, group: 'Trends' },
  { key: 'trend.claims_claimed',   kind: 'series', label: 'Claims Claimed (12 mo)',    path: 'claims_claimed',   accent: 4, group: 'Trends' },
  { key: 'trend.claims_recovered', kind: 'series', label: 'Claims Recovered (12 mo)',  path: 'claims_recovered', accent: 1, group: 'Trends' },
  { key: 'trend.inspections',      kind: 'series', label: 'Inspections (12 mo)',       path: 'inspections',      accent: 2, group: 'Trends' },
  // Breakdowns
  { key: 'bd.severity',           kind: 'breakdown', label: 'Accidents by Severity', path: 'severity',           group: 'Breakdowns' },
  { key: 'bd.accidents_by_site',  kind: 'breakdown', label: 'Accidents by Site',     path: 'accidents_by_site',  group: 'Breakdowns' },
  { key: 'bd.tyres_by_site',      kind: 'breakdown', label: 'Tyres by Site',         path: 'tyres_by_site',      group: 'Breakdowns' },
  { key: 'bd.claim_status',       kind: 'breakdown', label: 'Claims by Status',      path: 'claim_status',       group: 'Breakdowns' },
  // Dual-source composites
  { key: 'combo.spend_accidents', kind: 'combo',  label: 'Spend vs Accidents',        group: 'Trends' },
  { key: 'claims.claimed_recovered', kind: 'claims', label: 'Claimed vs Recovered',   group: 'Claims' },
  // Heatmap
  { key: 'heatmap.site_severity', kind: 'heatmap', label: 'Incident Heatmap',         group: 'Risk' },
  // Gauges (ratios)
  { key: 'ratio.recovery',   kind: 'ratio', label: 'Claim Recovery Rate', num: 'claims_recovered', den: 'claims_claimed', accent: 1, group: 'Claims' },
  { key: 'ratio.open_share', kind: 'ratio', label: 'Open Accident Share', num: 'open_accidents',   den: 'accidents',      accent: 3, group: 'Risk' },
  // Tables
  { key: 'table.open_job_cards', kind: 'table', label: 'Open Job Cards',   path: 'open_job_cards', group: 'Operations' },
  { key: 'table.pm_due',         kind: 'table', label: 'Maintenance Due',  path: 'pm_due_list',    group: 'Maintenance' },
]
export const SOURCE_BY_KEY = SOURCES.reduce((m, s) => { m[s.key] = s; return m }, {})
export const SOURCE_GROUPS = SOURCES.reduce((a, s) => (a.includes(s.group) ? a : a.concat(s.group)), [])

// ── Chart styles (VIZ) available per source kind ────────────────────────────────
// The label is what the "chart style" picker shows. The first entry of each list
// is the default when a block is created from that source.
export const VIZ_BY_KIND = {
  kpi:       [{ key: 'tile', label: 'Number tile' }],
  series:    [
    { key: 'area', label: 'Area line' },
    { key: 'line', label: 'Line' },
    { key: 'bar',  label: 'Bars' },
  ],
  breakdown: [
    { key: 'doughnut', label: 'Doughnut' },
    { key: 'vbar',     label: 'Column bars' },
    { key: 'hbar',     label: 'Horizontal bars' },
    { key: 'treemap',  label: 'Treemap' },
  ],
  combo:   [{ key: 'combo', label: 'Combo (bars + line)' }],
  claims:  [{ key: 'claims', label: 'Dual area lines' }],
  heatmap: [{ key: 'heatmap', label: 'Heatmap' }],
  ratio:   [{ key: 'gauge', label: 'Gauge dial' }],
  table:   [{ key: 'table', label: 'Table' }],
}
export const ALL_VIZ_KEYS = Object.values(VIZ_BY_KIND).flat().map((v) => v.key)

/** Chart styles valid for a given source key (empty for text blocks). */
export function vizOptionsFor(sourceKey) {
  const s = SOURCE_BY_KEY[sourceKey]
  return s ? (VIZ_BY_KIND[s.kind] || []) : []
}
/** Default chart style for a source key. */
export function defaultViz(sourceKey) {
  const opts = vizOptionsFor(sourceKey)
  return opts.length ? opts[0].key : 'tile'
}

// ── Block presets (the builder "Add block" catalog) ─────────────────────────────
// Each preset seeds a block; the user then tweaks source / style / size / colour.
export const BLOCK_PRESETS = [
  { id: 'kpi',      label: 'KPI tile',        icon: 'gauge',      type: 'kpi',     source: 'kpi.accidents',        w: 1, h: 1 },
  { id: 'trend',    label: 'Trend chart',     icon: 'trending',   type: 'chart',   source: 'trend.tyre_spend',     w: 2, h: 2 },
  { id: 'combo',    label: 'Spend vs risk',   icon: 'chart',      type: 'chart',   source: 'combo.spend_accidents',w: 3, h: 2 },
  { id: 'break',    label: 'Breakdown',       icon: 'pie',        type: 'chart',   source: 'bd.severity',          w: 2, h: 2 },
  { id: 'claims',   label: 'Claims lines',    icon: 'activity',   type: 'chart',   source: 'claims.claimed_recovered', w: 2, h: 2 },
  { id: 'heatmap',  label: 'Heatmap',         icon: 'grid',       type: 'chart',   source: 'heatmap.site_severity',w: 3, h: 2 },
  { id: 'gauge',    label: 'Gauge dial',      icon: 'percent',    type: 'chart',   source: 'ratio.recovery',       w: 1, h: 2 },
  { id: 'table',    label: 'Ops table',       icon: 'list',       type: 'chart',   source: 'table.open_job_cards', w: 3, h: 3 },
  { id: 'text',     label: 'Heading / note',  icon: 'text',       type: 'text',    source: null,                   w: 4, h: 1 },
]

// ── Defaults + normalization ────────────────────────────────────────────────────

/** A fresh block from a preset (or a bare kpi block). */
export function blockFromPreset(presetId) {
  const p = BLOCK_PRESETS.find((x) => x.id === presetId) || BLOCK_PRESETS[0]
  const source = p.source
  const s = source ? SOURCE_BY_KEY[source] : null
  return normalizeBlock({
    id: newId('blk'),
    type: p.type,
    source,
    viz: source ? defaultViz(source) : null,
    title: p.type === 'text' ? 'New heading' : (s ? s.label : ''),
    text: p.type === 'text' ? 'New heading' : '',
    accent: s && Number.isInteger(s.accent) ? s.accent : 0,
    showTitle: true,
    w: p.w, h: p.h,
  })
}

/** Coerce one block to a safe, complete shape. Unknown source -> a KPI fallback. */
export function normalizeBlock(raw = {}) {
  const type = ['kpi', 'chart', 'text'].includes(raw.type) ? raw.type : 'kpi'
  if (type === 'text') {
    return {
      id: raw.id || newId('blk'),
      type: 'text',
      source: null,
      viz: null,
      title: '',
      text: String(raw.text ?? raw.title ?? '').slice(0, 240),
      accent: clampInt(raw.accent, 0, 11, 0),
      showTitle: false,
      w: clampInt(raw.w, BLOCK_W_MIN, BOARD_COLS_MAX, 4),
      h: clampInt(raw.h, BLOCK_H_MIN, BOARD_ROWS_MAX, 1),
    }
  }
  let source = SOURCE_BY_KEY[raw.source] ? raw.source : null
  if (!source) source = 'kpi.accidents'
  const s = SOURCE_BY_KEY[source]
  const resolvedType = s.kind === 'kpi' ? 'kpi' : 'chart'
  const vizKeys = vizOptionsFor(source).map((v) => v.key)
  const viz = vizKeys.includes(raw.viz) ? raw.viz : defaultViz(source)
  return {
    id: raw.id || newId('blk'),
    type: resolvedType,
    source,
    viz,
    title: String(raw.title ?? s.label ?? '').slice(0, 80),
    text: '',
    accent: clampInt(raw.accent, 0, 11, Number.isInteger(s.accent) ? s.accent : 0),
    showTitle: raw.showTitle !== false,
    w: clampInt(raw.w, BLOCK_W_MIN, BOARD_COLS_MAX, resolvedType === 'kpi' ? 1 : 2),
    h: clampInt(raw.h, BLOCK_H_MIN, BOARD_ROWS_MAX, resolvedType === 'kpi' ? 1 : 2),
  }
}

/** Coerce one board to a safe shape (columns / rows clamped, blocks normalized). */
export function normalizeBoard(raw = {}) {
  const cols = clampInt(raw.cols, BOARD_COLS_MIN, BOARD_COLS_MAX, 4)
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : [])
    .slice(0, MAX_BLOCKS_PER_BOARD)
    .map(normalizeBlock)
    .map((b) => ({ ...b, w: Math.min(b.w, cols) }))
  return {
    id: raw.id || newId('brd'),
    title: String(raw.title ?? 'Board').slice(0, 60) || 'Board',
    cols,
    rows: clampInt(raw.rows, BOARD_ROWS_MIN, BOARD_ROWS_MAX, 3),
    blocks,
  }
}

/**
 * Coerce a whole layout. Returns null when there is nothing usable (so the viewer
 * falls back to the fixed page catalog). A layout with zero boards -> null.
 */
export function normalizeLayout(raw) {
  if (!raw || typeof raw !== 'object') return null
  const boards = (Array.isArray(raw.boards) ? raw.boards : [])
    .slice(0, MAX_BOARDS)
    .map(normalizeBoard)
  if (!boards.length) return null
  return { version: 1, boards }
}

/** True when a share should render as custom boards rather than fixed pages. */
export function hasCustomLayout(layout) {
  const n = normalizeLayout(layout)
  return Boolean(n && n.boards.some((b) => b.blocks.length > 0))
}

// ── Snapshot resolution ─────────────────────────────────────────────────────────
const arr = (v) => (Array.isArray(v) ? v : [])
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** A 0..100 percentage, or null when the denominator is not positive. */
export function ratioPct(numer, denom) {
  const d = num(denom)
  if (d <= 0) return null
  return (num(numer) / d) * 100
}

/**
 * Map a block to render-ready data pulled from the snapshot. Never throws; returns
 * an honest `empty` flag so the viewer can show "No data" instead of a broken
 * chart. The returned `kind` tells the viewer which ECharts option to build.
 */
export function resolveBlock(block, snapshot) {
  const b = normalizeBlock(block)
  if (b.type === 'text') {
    return { kind: 'text', text: b.text || b.title || '', empty: !((b.text || '').trim()) }
  }
  const s = SOURCE_BY_KEY[b.source]
  const snap = snapshot || {}
  if (!s) return { kind: 'empty', empty: true }

  switch (s.kind) {
    case 'kpi': {
      const bag = s.from === 'ops' ? (snap.ops || {}) : (snap.kpis || {})
      const value = num(bag[s.path])
      const spark = s.from === 'ops' ? [] : arr((snap.trends || {})[s.path])
      return { kind: 'kpi', value, money: !!s.money, label: b.title || s.label, spark, accent: b.accent, empty: false }
    }
    case 'series': {
      const labels = arr(snap.labels)
      const data = arr((snap.trends || {})[s.path]).map(num)
      const empty = !labels.length || !data.some((n) => n > 0)
      return { kind: 'series', viz: b.viz, labels, data, accent: b.accent, empty }
    }
    case 'breakdown': {
      const items = arr((snap.breakdowns || {})[s.path])
        .map((it) => ({ label: String(it?.label ?? 'N/A'), value: num(it?.value) }))
      return { kind: 'breakdown', viz: b.viz, items, accent: b.accent, empty: !items.length }
    }
    case 'combo': {
      const labels = arr(snap.labels)
      const spend = arr((snap.trends || {}).tyre_spend).map(num)
      const accidents = arr((snap.trends || {}).accidents).map(num)
      const empty = !labels.length || (!spend.some((n) => n > 0) && !accidents.some((n) => n > 0))
      return { kind: 'combo', labels, spend, accidents, empty }
    }
    case 'claims': {
      const labels = arr(snap.labels)
      const claimed = arr((snap.trends || {}).claims_claimed).map(num)
      const recovered = arr((snap.trends || {}).claims_recovered).map(num)
      const empty = !labels.length || (!claimed.some((n) => n > 0) && !recovered.some((n) => n > 0))
      return { kind: 'claims', labels, claimed, recovered, empty }
    }
    case 'heatmap': {
      const rows = arr(snap.heatmap)
      return { kind: 'heatmap', rows, empty: !rows.length }
    }
    case 'ratio': {
      const bag = snap.kpis || {}
      const value = ratioPct(bag[s.num], bag[s.den])
      return { kind: 'gauge', value, label: b.title || s.label, accent: b.accent, empty: false }
    }
    case 'table': {
      const rows = arr((snap.ops || {})[s.path])
      const which = s.path === 'pm_due_list' ? 'pm' : 'jobcards'
      return { kind: 'table', which, rows, empty: !rows.length }
    }
    default:
      return { kind: 'empty', empty: true }
  }
}

// ── Starter boards (offered in the builder as a one-click starting point) ────────
function mkBlock(source, over = {}) {
  const s = SOURCE_BY_KEY[source]
  return normalizeBlock({
    id: newId('blk'),
    type: s && s.kind === 'kpi' ? 'kpi' : 'chart',
    source,
    viz: over.viz || defaultViz(source),
    title: over.title != null ? over.title : (s ? s.label : ''),
    accent: over.accent != null ? over.accent : (s && Number.isInteger(s.accent) ? s.accent : 0),
    w: over.w, h: over.h,
  })
}

export const STARTER_LAYOUTS = [
  {
    id: 'exec',
    label: 'Executive board',
    build: () => normalizeLayout({
      boards: [
        {
          title: 'Executive Overview', cols: 4, rows: 3,
          blocks: [
            mkBlock('kpi.fleet', { w: 1, h: 1 }),
            mkBlock('kpi.tyre_spend', { w: 1, h: 1 }),
            mkBlock('kpi.accidents', { w: 1, h: 1 }),
            mkBlock('kpi.open_accidents', { w: 1, h: 1 }),
            mkBlock('combo.spend_accidents', { w: 3, h: 2 }),
            mkBlock('bd.severity', { w: 1, h: 2, viz: 'doughnut' }),
          ],
        },
      ],
    }),
  },
  {
    id: 'risk',
    label: 'Risk and claims',
    build: () => normalizeLayout({
      boards: [
        {
          title: 'Risk and Claims', cols: 4, rows: 3,
          blocks: [
            mkBlock('ratio.recovery', { w: 1, h: 2 }),
            mkBlock('ratio.open_share', { w: 1, h: 2 }),
            mkBlock('claims.claimed_recovered', { w: 2, h: 2 }),
            mkBlock('heatmap.site_severity', { w: 2, h: 1 }),
            mkBlock('bd.claim_status', { w: 2, h: 1, viz: 'hbar' }),
          ],
        },
      ],
    }),
  },
  {
    id: 'ops',
    label: 'Operations today',
    build: () => normalizeLayout({
      boards: [
        {
          title: 'Operations Today', cols: 4, rows: 3,
          blocks: [
            mkBlock('ops.job_cards_today', { w: 1, h: 1 }),
            mkBlock('ops.accidents_today', { w: 1, h: 1 }),
            mkBlock('ops.pm_overdue', { w: 1, h: 1 }),
            mkBlock('ops.alerts_critical', { w: 1, h: 1 }),
            mkBlock('table.open_job_cards', { w: 2, h: 2 }),
            mkBlock('table.pm_due', { w: 2, h: 2 }),
          ],
        },
      ],
    }),
  },
]

/** A brand-new single empty board (builder "start blank"). */
export function emptyLayout() {
  return { version: 1, boards: [normalizeBoard({ title: 'Board 1', cols: 4, rows: 3, blocks: [] })] }
}
