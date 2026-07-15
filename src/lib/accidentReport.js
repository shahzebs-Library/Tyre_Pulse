/**
 * Accident Report catalog — the single source of truth for the block-based
 * Accident Report Builder (charts, KPIs, table columns, block types, starter
 * and pre-built library layouts).
 *
 * Pure data + functions only (no React) so the same catalog powers:
 *   1. the WYSIWYG builder tab in Accidents (live preview),
 *   2. the headless PDF renderer (accidentReportPdf.js) used by the builder's
 *      export AND by Scheduled Reports when a saved layout is generated, and
 *   3. tests.
 *
 * All chart/KPI/insight values are computed from the live accident record set —
 * nothing is fabricated; empty data degrades to honest empty states.
 */
import { analyzeClaims, hasClaim, isClosed } from './claimsAnalytics'
import { STATUSES, SEVERITIES, FAULT_STATUS_OPTS, canonStatus, canonSeverity, canonFault } from './accidentVocab'

// ── WYSIWYG paper theme (dark-on-white so on-screen preview == exported PDF) ──
export const PAPER = { ink: '#0f172a', muted: '#475569', grid: 'rgba(15,23,42,0.08)' }
export const PALETTE = ['#ea580c', '#2563eb', '#16a34a', '#9333ea', '#dc2626', '#ca8a04', '#0891b2', '#64748b', '#db2777', '#4f46e5']

// ── Per-chart colour palettes (all readable dark-on-white paper). Selected by a
// chart block's `palette` key; 'default' re-uses the canonical PALETTE so every
// existing chart is unchanged unless the user picks another combination. Every
// array is >= 8 colours so charts with many categories never run out of hues.
// PALETTE_KEYS is the ordered enumeration the builder UI reads (no hardcoding). ──
export const PALETTES = {
  default: PALETTE,
  cool: ['#2563eb', '#0891b2', '#0d9488', '#16a34a', '#4f46e5', '#7c3aed', '#0369a1', '#0f766e', '#1d4ed8', '#155e75'],
  warm: ['#ea580c', '#dc2626', '#d97706', '#ca8a04', '#e11d48', '#f97316', '#b45309', '#9f1239', '#c2410c', '#a16207'],
  mono: ['#0f172a', '#334155', '#475569', '#64748b', '#94a3b8', '#1e293b', '#0b1220', '#7c8ca3', '#52627a', '#293548'],
  contrast: ['#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#9333ea', '#0891b2', '#db2777', '#0f172a', '#ea580c', '#4f46e5'],
  pastel: ['#f97316', '#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#fbbf24', '#22d3ee', '#94a3b8', '#fb7185', '#818cf8'],
  // Green-forward (explicitly requested): forests, olives and teals.
  forest: ['#166534', '#15803d', '#16a34a', '#22c55e', '#4d7c0f', '#65a30d', '#059669', '#0d9488', '#347433', '#3f6212'],
  // Gray / neutral-forward (explicitly requested): slate + stone neutrals.
  slate: ['#0f172a', '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#57534e', '#78716c', '#44403c', '#525252'],
  ocean: ['#0c4a6e', '#0369a1', '#0284c7', '#0891b2', '#0e7490', '#155e75', '#1e40af', '#2563eb', '#0d9488', '#0f766e'],
  sunset: ['#7c2d12', '#9a3412', '#c2410c', '#ea580c', '#f97316', '#b91c1c', '#dc2626', '#e11d48', '#be123c', '#a16207'],
  earth: ['#78350f', '#92400e', '#b45309', '#a16207', '#ca8a04', '#854d0e', '#3f6212', '#4d7c0f', '#57534e', '#5c4033'],
  vibrant: ['#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#0d9488', '#9333ea'],
}
/** Ordered list of every palette key — the builder UI enumerates this instead of
 *  hardcoding palette names, so adding a palette above surfaces it automatically. */
export const PALETTE_KEYS = ['default', 'cool', 'warm', 'mono', 'contrast', 'pastel', 'forest', 'slate', 'ocean', 'sunset', 'earth', 'vibrant']

/** Convert a #rrggbb hex to an rgba() string (used for line-chart fills). */
function hexToRgba(hex, alpha = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return hex
  const int = parseInt(m[1], 16)
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`
}

/**
 * Pure re-styler: return a SHALLOW-CLONED chart.js data object with dataset
 * colours re-mapped from the block's chosen palette + border toggle. Never
 * mutates the input; malformed/empty data is returned unchanged.
 *   doughnut / polar → one colour per slice (backgroundColor is an array)
 *   bar              → one colour per dataset; borders = bar outline (0 or 1.5)
 *   line             → keeps a visible line; borders toggle the point outlines
 * Mixed charts (pareto/combo) resolve each dataset by its own `type`.
 */
export function styleChartData(data, block = {}) {
  if (!data || !Array.isArray(data.labels) || !Array.isArray(data.datasets) || !data.datasets.length) return data
  const palette = PALETTES[block.palette] || PALETTES.default
  const borderOn = !!block.showBorders
  // Chosen border WIDTH (default 1.5 when borders are on) and an OPTIONAL explicit
  // border COLOUR (block.borderColor); when unset the border derives from the
  // palette so the outline stays coordinated with the fill.
  const borderW = borderOn ? (block.borderWidth != null ? Number(block.borderWidth) : 1.5) : 0
  const kind = CHARTS[block.chart]?.kind
  const perSlice = kind === 'doughnut' || kind === 'polar'
  const datasets = data.datasets.map((ds, di) => {
    const next = { ...ds }
    if (perSlice) {
      next.backgroundColor = data.labels.map((_, i) => palette[i % palette.length])
      // Slice outline: user colour when borders are on, else the white separator.
      next.borderColor = borderOn ? (block.borderColor || '#ffffff') : '#ffffff'
      next.borderWidth = borderOn ? borderW : (kind === 'polar' ? 1 : 0)
      return next
    }
    const color = palette[di % palette.length]
    const border = borderOn ? (block.borderColor || color) : color
    const isLine = ds.type === 'line' || (!ds.type && kind === 'line')
    if (isLine) {
      // Lines always keep their stroke; the border toggle only outlines points.
      next.borderColor = color
      next.backgroundColor = ds.fill ? hexToRgba(color, 0.18) : color
      next.borderWidth = ds.borderWidth != null ? ds.borderWidth : 2
      next.pointBackgroundColor = color
      next.pointBorderColor = border
      next.pointBorderWidth = borderW
    } else {
      next.backgroundColor = color
      next.borderColor = border
      next.borderWidth = borderW
    }
    return next
  })
  return { ...data, datasets }
}

/** Width fraction of a chart block: full=1, half=1/2, third=1/3, quarter=1/4. */
export const chartWidthFraction = (width) => (width === 'quarter' ? 0.25 : width === 'third' ? 1 / 3 : width === 'half' ? 0.5 : 1)

/**
 * Greedy row-packer for shrinkable chart blocks: accumulate consecutive blocks
 * into rows whose width fractions sum to <= 1, opening a new row when the next
 * block would push the accumulated fraction past a full row. Pure + deterministic
 * so it is unit-tested and shared with the PDF renderer's inline layout.
 */
export function packChartRows(blocks) {
  const rows = []
  let row = []
  let acc = 0
  for (const b of blocks) {
    const f = chartWidthFraction(b.width)
    if (row.length && acc + f > 1.0001) { rows.push(row); row = []; acc = 0 }
    row.push(b); acc += f
  }
  if (row.length) rows.push(row)
  return rows
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function last12() {
  const out = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) }
  return out
}
const mKey = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const mLabel = (k) => { const [y, m] = k.split('-'); return `${MONTHS[(+m) - 1]} ${y.slice(2)}` }
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
/** @deprecated Severity is the ONE Minor/Moderate/Major ladder — prefer canonSeverity
 *  (accidentVocab). Kept as a thin alias so any older import keeps resolving; it now
 *  folds legacy 'Total Loss'/'severe'/'fatal' onto Major exactly like every other
 *  severity surface (was a stale Minor/Major/Total-Loss list that dropped Moderate). */
export const canonSev = (s) => canonSeverity(s) || 'Unspecified'
const titleCase = (t) => String(t || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim()
/** Human-readable label for a CHECK-constrained accident_type token (or a UI label). */
export const canonType = (t) => { const v = String(t || '').trim(); return v ? titleCase(v) : 'Unspecified' }

export function buildReportContext(records, currency = 'SAR') {
  return { records: records || [], claims: analyzeClaims(records || []), currency }
}

// ── Chart catalog: key → { label, description, kind, build(ctx) → chartjs data } ──
export const CHARTS = {
  severity: { label: 'Severity distribution', description: 'Minor / Moderate / Major mix', kind: 'doughnut', build: ({ records }) => byCount(records, (r) => canonSeverity(r.severity), { Minor: '#64748b', Moderate: '#ca8a04', Major: '#ea580c' }) },
  status: { label: 'Status distribution', description: 'Incident workflow status mix', kind: 'doughnut', build: ({ records }) => byCount(records, (r) => r.status || 'Reported') },
  fault: {
    label: 'Fault status (GCC)', description: 'Faulty vs non-faulty vs under review', kind: 'doughnut', build: ({ records }) => {
      // Classify via the ONE vocab fault resolver so this chart, the table
      // filter and the record screens bucket fault identically (accurate counts).
      const c = { Faulty: 0, 'Non-faulty': 0, 'Under review': 0, Unknown: 0 }
      records.forEach((r) => { const f = canonFault(r.fault_status); if (f) c[f]++; else c.Unknown++ })
      return doughnut(c, { Faulty: '#dc2626', 'Non-faulty': '#16a34a', 'Under review': '#ca8a04', Unknown: '#cbd5e1' })
    },
  },
  liability: {
    label: 'GCC liability split', description: '0% / 50% / 100% liability shares', kind: 'doughnut', build: ({ claims }) => {
      const l = claims.liability
      return { labels: ['0% not liable', '50% shared', '100% at fault', 'Unknown'], datasets: [{ data: [l[0].count, l[50].count, l[100].count, l.unknown.count], backgroundColor: ['#16a34a', '#ca8a04', '#dc2626', '#cbd5e1'], borderWidth: 0 }] }
    },
  },
  trend: {
    label: 'Incident trend (12 mo)', description: 'Monthly incident count, last 12 months', kind: 'line', build: ({ records }) => {
      const keys = last12(); const t = Object.fromEntries(keys.map((k) => [k, 0]))
      records.forEach((r) => { const k = mKey(r.incident_date); if (k && t[k] != null) t[k]++ })
      return { labels: keys.map(mLabel), datasets: [{ label: 'Incidents', data: keys.map((k) => t[k]), borderColor: '#ea580c', backgroundColor: 'rgba(234,88,12,0.18)', fill: true }] }
    },
  },
  topAssets: { label: 'Top assets by incidents', description: 'Most incident-prone vehicles', kind: 'bar-h', build: ({ records }) => rank(records, (r) => r.asset_no, 6, '#ea580c') },
  bySite: { label: 'Incidents by site', description: 'Site / branch comparison', kind: 'bar-h', build: ({ records }) => rank(records, (r) => r.site, 8, '#2563eb') },
  sevMonthly: {
    label: 'Monthly severity (12 mo)', description: 'Stacked severity mix by month', kind: 'bar-stack', build: ({ records }) => {
      const keys = last12(); const sev = ['Minor', 'Moderate', 'Major']; const map = {}
      sev.forEach((s) => { map[s] = Object.fromEntries(keys.map((k) => [k, 0])) })
      records.forEach((r) => { const k = mKey(r.incident_date); const s = canonSeverity(r.severity); if (k && map[s] && map[s][k] != null) map[s][k]++ })
      const col = { Minor: '#94a3b8', Moderate: '#ca8a04', Major: '#ea580c' }
      return { labels: keys.map(mLabel), datasets: sev.map((s) => ({ label: s, data: keys.map((k) => map[s][k]), backgroundColor: col[s] })) }
    },
  },
  claimStatus: {
    label: 'Claim status', description: 'Insurance claim status mix', kind: 'doughnut', build: ({ claims }) => {
      const e = claims.byStatus
      return { labels: e.map((x) => x.label), datasets: [{ data: e.map((x) => x.count), backgroundColor: e.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }] }
    },
  },
  insurerValue: {
    label: 'Claim value by insurer', description: 'Claimed value ranked by insurer', kind: 'bar-h', build: ({ claims, currency }) => {
      const e = claims.byInsurer
      return { labels: e.map((x) => x.label), datasets: [{ label: `Value (${currency})`, data: e.map((x) => Math.round(x.value)), backgroundColor: '#4f46e5', borderRadius: 3 }] }
    },
  },
  recovery: {
    label: 'Recovery funnel', description: 'Claimed → approved → recovered', kind: 'bar', build: ({ claims }) => ({ labels: ['Claimed', 'Approved', 'Recovered'], datasets: [{ data: [Math.round(claims.claimed), Math.round(claims.approved), Math.round(claims.recovered)], backgroundColor: ['#2563eb', '#9333ea', '#16a34a'], borderRadius: 3 }] }),
  },
  aging: {
    label: 'Open-claim ageing', description: 'Open claims by days outstanding', kind: 'bar', build: ({ claims }) => ({ labels: ['0 to 30d', '31 to 60d', '61 to 90d', '90+d'], datasets: [{ data: [claims.aging['0-30'].count, claims.aging['31-60'].count, claims.aging['61-90'].count, claims.aging['90+'].count], backgroundColor: ['#16a34a', '#ca8a04', '#fb923c', '#dc2626'], borderRadius: 3 }] }),
  },
  caseAge: {
    label: 'Open cases by days open', description: 'Open incidents bucketed by days since the accident (Days Open)', kind: 'bar', build: ({ records }) => {
      const buckets = { '0 to 15d': 0, '16 to 30d': 0, '31 to 60d': 0, '60+d': 0 }
      records.filter((r) => !isClosedRow(r)).forEach((r) => {
        const d = caseAgeDays(r)
        if (d == null) return
        if (d <= 15) buckets['0 to 15d']++
        else if (d <= 30) buckets['16 to 30d']++
        else if (d <= 60) buckets['31 to 60d']++
        else buckets['60+d']++
      })
      return { labels: Object.keys(buckets), datasets: [{ data: Object.values(buckets), backgroundColor: ['#16a34a', '#ca8a04', '#fb923c', '#dc2626'], borderRadius: 3 }] }
    },
  },
  // ── Advanced (mixed / radial / floating) chart types ───────────────────────
  paretoAssets: {
    label: 'Asset incident Pareto', description: 'Top assets by incidents with a cumulative % line', kind: 'pareto', build: ({ records }) => {
      const c = {}; records.forEach((r) => { const k = r.asset_no; if (k) c[k] = (c[k] || 0) + 1 })
      const sorted = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8)
      const total = sorted.reduce((s, [, v]) => s + v, 0)
      let run = 0
      const cum = sorted.map(([, v]) => { run += v; return total ? Math.round((run / total) * 100) : 0 })
      return {
        labels: sorted.map(([k]) => k),
        datasets: [
          { type: 'bar', label: 'Incidents', data: sorted.map(([, v]) => v), backgroundColor: '#ea580c', borderRadius: 3, order: 2 },
          { type: 'line', label: 'Cumulative %', data: cum, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.15)', yAxisID: 'y1', tension: 0.3, order: 1 },
        ],
      }
    },
  },
  costTrend: {
    label: 'Cost vs incidents (12 mo)', description: 'Monthly repair + parts cost with the incident count (dual axis)', kind: 'combo', build: ({ records, currency }) => {
      const keys = last12()
      const cost = Object.fromEntries(keys.map((k) => [k, 0]))
      const cnt = Object.fromEntries(keys.map((k) => [k, 0]))
      records.forEach((r) => { const k = mKey(r.incident_date); if (k && cost[k] != null) { cost[k] += N(r.repair_cost) + N(r.parts_cost); cnt[k]++ } })
      return {
        labels: keys.map(mLabel),
        datasets: [
          { type: 'bar', label: `Cost (${currency})`, data: keys.map((k) => Math.round(cost[k])), backgroundColor: '#2563eb', borderRadius: 3, order: 2 },
          { type: 'line', label: 'Incidents', data: keys.map((k) => cnt[k]), borderColor: '#ea580c', backgroundColor: 'rgba(234,88,12,0.15)', yAxisID: 'y1', tension: 0.3, order: 1 },
        ],
      }
    },
  },
  typeRadar: {
    label: 'Accident type profile', description: 'Incident count across accident types', kind: 'radar', build: ({ records }) => {
      const c = {}; records.forEach((r) => { const k = canonType(r.accident_type); c[k] = (c[k] || 0) + 1 })
      const entries = Object.entries(c).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
      return { labels: entries.map(([k]) => k), datasets: [{ label: 'Incidents', data: entries.map(([, v]) => v), backgroundColor: 'rgba(234,88,12,0.18)', borderColor: '#ea580c', pointBackgroundColor: '#ea580c', borderWidth: 2 }] }
    },
  },
  statusPolar: {
    label: 'Status distribution (polar)', description: 'Incident workflow status as a polar-area chart', kind: 'polar', build: ({ records }) => {
      const c = {}; records.forEach((r) => { const k = r.status || 'Reported'; c[k] = (c[k] || 0) + 1 })
      const entries = Object.entries(c).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      return { labels: entries.map(([k]) => k), datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 1, borderColor: '#ffffff' }] }
    },
  },
  recoveryWaterfall: {
    label: 'Recovery waterfall', description: 'Claimed less deductible and outstanding, to recovered (floating bars)', kind: 'waterfall', build: ({ claims }) => {
      const claimed = Math.round(claims.claimed)
      const deductible = Math.min(Math.max(0, Math.round(claims.deductible)), claimed)
      const recovered = Math.max(0, Math.round(claims.recovered))
      const afterDed = claimed - deductible
      const outstanding = Math.max(0, afterDed - recovered)
      const landed = afterDed - outstanding // = min(recovered, afterDed); chain end
      return {
        labels: ['Claimed', 'Deductible', 'Outstanding', 'Recovered'],
        datasets: [{
          label: `Amount`,
          data: [[0, claimed], [afterDed, claimed], [landed, afterDed], [0, landed]],
          backgroundColor: ['#2563eb', '#ca8a04', '#dc2626', '#16a34a'],
          borderRadius: 2,
        }],
      }
    },
  },
}

function byCount(records, keyFn, colorMap) {
  const c = {}; records.forEach((r) => { const k = keyFn(r) || 'Unspecified'; c[k] = (c[k] || 0) + 1 })
  return doughnut(c, colorMap)
}
function doughnut(counts, colorMap) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0)
  return { labels: entries.map(([k]) => k), datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map(([k], i) => (colorMap && colorMap[k]) || PALETTE[i % PALETTE.length]), borderWidth: 0 }] }
}
function rank(records, keyFn, n, color) {
  const c = {}; records.forEach((r) => { const k = keyFn(r); if (k) c[k] = (c[k] || 0) + 1 })
  const sorted = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n)
  return { labels: sorted.map(([k]) => k), datasets: [{ label: 'Incidents', data: sorted.map(([, v]) => v), backgroundColor: color, borderRadius: 3 }] }
}

// ── Value labels: an inline chart.js plugin (no npm dependency) that draws the
// actual data number on every mark so exported/rasterised charts carry real
// figures, not just shapes. Registered per-chart via `plugins: [...]` on BOTH
// the live react-chartjs-2 preview and the offscreen PDF renderer (WYSIWYG).
//   bar (vertical)   → value above each bar
//   bar-h            → value at the end of each bar
//   bar-stack        → the stack TOTAL above each stack (segments stay clean)
//   line             → value above each point (zeros skipped to avoid clutter)
//   doughnut         → slice counts appended in the legend (see CHART_OPTS)
const fmtLabelNum = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 10) / 10))
/** Factory: the same value-labels plugin with a custom label colour, so dark-UI
 *  screens (light ink) and the white-paper report renderer (dark ink) share ONE
 *  implementation. Default keeps the paper-theme ink. */
export const makeValueLabelsPlugin = (color = PAPER.ink) => ({
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    // Per-chart opt-out + styling: preview + PDF set options.plugins.valueLabels =
    // { enabled, color, size } from the chart block. enabled===false → skip (absent
    // flag draws, backwards compatible); color/size override the defaults below.
    const vl = chart.config?.options?.plugins?.valueLabels
    if (vl?.enabled === false) return
    const type = chart.config?.type
    if (type !== 'bar' && type !== 'line' && type !== 'radar') return
    const { ctx } = chart
    if (!ctx) return
    const drawColor = (vl && vl.color) || color
    const drawSize = Number(vl?.size) > 0 ? Number(vl.size) : 10
    const horizontal = chart.options?.indexAxis === 'y'
    const stacked = !!(chart.options?.scales?.x?.stacked && chart.options?.scales?.y?.stacked)
    ctx.save()
    ctx.fillStyle = drawColor
    ctx.font = `bold ${drawSize}px helvetica, arial, sans-serif`
    if (type === 'radar') {
      // Radar: draw each point's raw count just above the vertex.
      chart.data.datasets.forEach((ds, di) => {
        if (chart.isDatasetVisible && !chart.isDatasetVisible(di)) return
        const meta = chart.getDatasetMeta(di)
        ;(meta?.data || []).forEach((el, i) => {
          const v = Number(ds.data?.[i])
          if (!Number.isFinite(v) || v === 0 || !el) return
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillText(fmtLabelNum(v), el.x, el.y - 3)
        })
      })
      ctx.restore()
      return
    }
    if (type === 'bar' && stacked) {
      // Stacked bars: label only the total on top of each stack.
      const n = chart.data?.labels?.length || 0
      for (let i = 0; i < n; i++) {
        let total = 0
        let topEl = null
        chart.data.datasets.forEach((ds, di) => {
          if (chart.isDatasetVisible && !chart.isDatasetVisible(di)) return
          const v = Number(ds.data?.[i])
          if (!Number.isFinite(v) || v === 0) return
          total += v
          const el = chart.getDatasetMeta(di)?.data?.[i]
          if (el && (topEl == null || el.y < topEl.y)) topEl = el
        })
        if (!total || !topEl) continue
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(fmtLabelNum(total), topEl.x, topEl.y - 2)
      }
    } else {
      chart.data.datasets.forEach((ds, di) => {
        if (chart.isDatasetVisible && !chart.isDatasetVisible(di)) return
        const meta = chart.getDatasetMeta(di)
        ;(meta?.data || []).forEach((el, i) => {
          const raw = ds.data?.[i]
          // Floating bars carry a [start, end] pair — label the step magnitude.
          const v = Array.isArray(raw) ? (N(raw[1]) - N(raw[0])) : Number(raw)
          if (!Number.isFinite(v) || v === 0 || !el) return
          const text = fmtLabelNum(Math.abs(v))
          if (horizontal) {
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            ctx.fillText(text, el.x + 4, el.y)
          } else {
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText(text, el.x, el.y - 3)
          }
        })
      })
    }
    ctx.restore()
  },
})
export const VALUE_LABELS_PLUGIN = makeValueLabelsPlugin(PAPER.ink)

/** Doughnut legend labels with the slice count appended, e.g. "Major (4)" —
 *  makes slice values visible without cluttering the arcs. */
export function doughnutLegendCounts(chart) {
  const data = chart?.data
  if (!data?.labels?.length || !data.datasets?.length) return []
  const ds = data.datasets[0]
  return data.labels.map((label, i) => {
    const v = Number(ds.data?.[i]) || 0
    const bg = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor
    return {
      text: `${label} (${fmtLabelNum(v)})`,
      fillStyle: bg,
      strokeStyle: 'transparent',
      lineWidth: 0,
      hidden: chart.getDataVisibility ? !chart.getDataVisibility(i) : false,
      index: i,
    }
  })
}

// Chart.js option sets per chart kind (paper theme) — shared by the live
// preview (react-chartjs-2) and the headless offscreen renderer so the export
// always matches the screen. Layout padding leaves room for the value labels
// drawn by VALUE_LABELS_PLUGIN (top for vertical marks, right for bar-h).
const AXIS = { ticks: { color: PAPER.muted, font: { size: 11 } }, grid: { color: PAPER.grid } }
const OPT_BASE = { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } }, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: AXIS, y: { ...AXIS, beginAtZero: true } } }
// Secondary (right) axis for the dual-axis mixed charts. drawOnChartArea:false so
// the two axes' gridlines never fight for the same space.
const AXIS_RIGHT = { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { color: PAPER.muted, font: { size: 11 } } }
const MIXED_LEGEND = { plugins: { legend: { display: true, labels: { color: PAPER.muted, font: { size: 10 } } }, tooltip: { enabled: false } } }
const RADIAL_TICKS = { color: PAPER.muted, backdropColor: 'transparent', font: { size: 9 } }
export const CHART_OPTS = {
  bar: OPT_BASE,
  'bar-h': { ...OPT_BASE, indexAxis: 'y', layout: { padding: { top: 6, right: 30 } } },
  'bar-stack': { ...OPT_BASE, plugins: { legend: { display: true, labels: { color: PAPER.muted, font: { size: 10 } } }, tooltip: { enabled: false } }, scales: { x: { ...AXIS, stacked: true }, y: { ...AXIS, stacked: true } } },
  doughnut: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { color: PAPER.ink, boxWidth: 12, padding: 10, font: { size: 11 }, generateLabels: doughnutLegendCounts } }, tooltip: { enabled: false } } },
  line: { ...OPT_BASE, elements: { line: { tension: 0.35 }, point: { radius: 2 } } },
  // Pareto: incident bars (left axis) + cumulative % line (right axis, 0 to 100).
  pareto: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } }, ...MIXED_LEGEND, scales: { x: AXIS, y: { ...AXIS, beginAtZero: true }, y1: { ...AXIS_RIGHT, max: 100, ticks: { ...AXIS_RIGHT.ticks, callback: (v) => `${v}%` } } } },
  // Combo: cost bars (left axis) + incident-count line (right axis).
  combo: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } }, ...MIXED_LEGEND, elements: { line: { tension: 0.3 }, point: { radius: 2 } }, scales: { x: AXIS, y: { ...AXIS, beginAtZero: true }, y1: AXIS_RIGHT } },
  radar: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { r: { beginAtZero: true, angleLines: { color: PAPER.grid }, grid: { color: PAPER.grid }, pointLabels: { color: PAPER.ink, font: { size: 11 } }, ticks: RADIAL_TICKS } } },
  polar: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: PAPER.ink, boxWidth: 12, padding: 10, font: { size: 11 }, generateLabels: doughnutLegendCounts } }, tooltip: { enabled: false } }, scales: { r: { beginAtZero: true, grid: { color: PAPER.grid }, angleLines: { color: PAPER.grid }, ticks: RADIAL_TICKS } } },
  waterfall: { ...OPT_BASE, layout: { padding: { top: 16 } } },
}
export const CHART_JS_TYPE = { doughnut: 'doughnut', line: 'line', bar: 'bar', 'bar-h': 'bar', 'bar-stack': 'bar', pareto: 'bar', combo: 'bar', radar: 'radar', polar: 'polarArea', waterfall: 'bar' }

/**
 * Per-block chart.js options: return a NON-MUTATING merge of a chart kind's base
 * option set with the block's per-chart toggles, so the SAME resolver drives the
 * live preview and the headless PDF (borders/labels/legend/grid all honoured).
 *   - plugins.legend.display  ← block.showLegend !== false
 *   - every scale's grid.display ← block.showGrid !== false (radial 'r' + cartesian
 *     axes both carry a `grid`; doughnut has no scales so it is left untouched)
 *   - plugins.valueLabels = { enabled: block.showLabels !== false, color, size }
 *     read by VALUE_LABELS_PLUGIN for the data-label colour/size.
 * Unknown/empty base returns a valid standalone options object.
 */
export function chartOptionsFor(block = {}, baseOpts = {}) {
  const base = baseOpts || {}
  const showLegend = block.showLegend !== false
  const showGrid = block.showGrid !== false
  const basePlugins = base.plugins || {}
  const next = {
    ...base,
    plugins: {
      ...basePlugins,
      legend: { ...(basePlugins.legend || {}), display: showLegend },
      valueLabels: { enabled: block.showLabels !== false, color: block.labelColor, size: block.labelSize },
    },
  }
  if (base.scales && typeof base.scales === 'object') {
    next.scales = {}
    for (const [key, axis] of Object.entries(base.scales)) {
      next.scales[key] = axis && typeof axis === 'object'
        ? { ...axis, grid: { ...(axis.grid || {}), display: showGrid } }
        : axis
    }
  }
  return next
}

/** Resolve a chart data cell to a number: floating bars carry [start, end] pairs;
 *  their magnitude is |end - start| (the step size). Plain values pass through. */
const chartCellNum = (v) => (Array.isArray(v) ? Math.abs(N(v[1]) - N(v[0])) : (Number.isFinite(Number(v)) ? Number(v) : 0))

export function isChartEmpty(data) {
  return !data?.labels?.length || (data.datasets || []).every((ds) => (ds.data || []).every((v) => !chartCellNum(v)))
}

/** One-line numeric digest of a chart's data for the PDF (rendered under the
 *  chart image so the report carries real figures even in print/greyscale).
 *  Generic: sums every dataset per label, reports the total and the top label.
 *  Returns '' when the chart is empty — honest, never fabricated. */
export function summarizeChartData(data) {
  if (isChartEmpty(data)) return ''
  const labels = data.labels || []
  const perLabel = labels.map((_, i) => (data.datasets || []).reduce((s, ds) => s + chartCellNum(ds.data?.[i]), 0))
  const total = perLabel.reduce((s, v) => s + v, 0)
  if (!total) return ''
  let maxI = 0
  perLabel.forEach((v, i) => { if (v > perLabel[maxI]) maxI = i })
  return `Total: ${fmtLabelNum(total)} | Top: ${labels[maxI]} (${fmtLabelNum(perLabel[maxI])})`
}

// ── KPI catalog ───────────────────────────────────────────────────────────────
export const KPIS = {
  total: { label: 'Total incidents', get: ({ records }) => records.length },
  open: { label: 'Open', get: ({ records }) => records.filter((r) => !isClosedRow(r)).length },
  closed: { label: 'Closed', get: ({ records }) => records.filter(isClosedRow).length },
  repairCost: { label: 'Repair cost', money: true, get: ({ records }) => records.reduce((s, r) => s + N(r.repair_cost) + N(r.parts_cost), 0) },
  claimed: { label: 'Total claimed', money: true, get: ({ claims }) => claims.claimed },
  approved: { label: 'Approved', money: true, get: ({ claims }) => claims.approved },
  recovered: { label: 'Recovered', money: true, get: ({ claims }) => claims.recovered },
  netExposure: { label: 'Net exposure', money: true, get: ({ claims }) => claims.netExposure },
  recoveryRate: { label: 'Recovery rate', get: ({ claims }) => (claims.recoveryRate == null ? 'N/A' : `${claims.recoveryRate}%`) },
  delayed: { label: 'Delayed claims', get: ({ claims }) => claims.delayed },
  deductible: { label: 'Deductible', money: true, get: ({ claims }) => claims.deductible },
  claimsCount: { label: 'Claims', get: ({ claims }) => claims.total },
  avgDaysOpen: { label: 'Avg days open', get: ({ records }) => avgDays(records, (r) => !isClosedRow(r)) },
  avgCaseDuration: { label: 'Avg case duration', get: ({ records }) => avgDays(records, isClosedRow) },
  pendingActions: { label: 'Pending actions', get: ({ records }) => records.filter((r) => !isClosedRow(r) && (!r.expected_release_date || (hasClaim(r) && !r.insurer))).length },
}
export function isClosedRow(r) {
  if (r.release_date) return true
  const b = `${r.status || ''} ${r.closure_status || ''} ${r.claim_status || ''}`.toLowerCase()
  return /clos|settl|paid|recovered|complete|resolved/.test(b)
}

/** Whole days a case has been running: incident_date → release_date when closed,
 *  otherwise → now. null when incident_date is missing/invalid — never fabricated.
 *  Same semantics as the Accidents page "Days Open" column. */
export function caseAgeDays(r, now = Date.now()) {
  if (!r?.incident_date) return null
  const start = new Date(r.incident_date)
  if (isNaN(start)) return null
  let end = new Date(now)
  if (isClosedRow(r) && r.release_date) {
    const rel = new Date(r.release_date)
    if (!isNaN(rel)) end = rel
  }
  return Math.max(0, Math.floor((end - start) / 86400000))
}

function avgDays(records, filterFn) {
  const vals = records.filter(filterFn).map((r) => caseAgeDays(r)).filter((v) => v != null)
  return vals.length ? `${Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)}d` : 'N/A'
}

// ── Detail-table columns ──────────────────────────────────────────────────────
export const TABLE_COLS = {
  incident_date: 'Date', asset_no: 'Asset', site: 'Site', driver_name: 'Driver',
  severity: 'Severity', status: 'Status', fault_status: 'Fault', gcc_liability_ratio: 'GCC %',
  insurer: 'Insurer', claim_amount: 'Claimed', claim_approved_amount: 'Approved',
  recovered_amount: 'Recovered', repair_cost: 'Repair', expected_release_date: 'Expected release',
  days_open: 'Days Open',
}

/** Resolve a table cell — supports VIRTUAL computed columns (days_open) on top
 *  of plain record fields. Table renderers (preview + PDF) must use this
 *  instead of reading r[col] directly. */
export function cellValue(col, r, now = Date.now()) {
  if (col === 'days_open') return caseAgeDays(r, now)
  return r[col]
}

export function fmtCell(col, v, money) {
  if (v == null || v === '') return 'N/A'
  if (['claim_amount', 'claim_approved_amount', 'recovered_amount', 'repair_cost'].includes(col)) return money(v)
  if (col === 'gcc_liability_ratio') return `${Number(v)}%`
  if (col === 'days_open') return `${Number(v)}d`
  if (col === 'incident_date' || col === 'expected_release_date') return String(v).slice(0, 10)
  return String(v)
}

// ── Detail-table filtering / sorting (shared: builder UI + PDF + Excel export) ──
// Fault classification comes from the ONE vocab resolver (canonFault, imported
// above from accidentVocab and re-exported here for existing importers). The
// fault chart, the table filter and the record screens therefore bucket
// "faulty vs non-faulty" identically — no more competing fault classifiers.
export { canonFault }

/**
 * Option lists the builder UI renders for the detail-table filter controls.
 * `claims` carries [value, label] pairs (the value is stored on block.filter);
 * status / severity / fault are the canonical display labels sourced from the
 * single accident vocabulary, so a chosen value always matches the row's
 * canonicalised value in `tableRows`. ASCII only.
 */
export const TABLE_FILTER_OPTS = {
  claims: [['all', 'All'], ['open', 'Open claims only'], ['closed', 'Closed/settled'], ['none', 'No claim']],
  status: STATUSES,
  severity: SEVERITIES,
  fault: FAULT_STATUS_OPTS,
}

// Columns compared numerically when sorting (everything else compares as text;
// dates as YYYY-MM-DD strings sort chronologically).
const NUMERIC_SORT_COLS = new Set([
  'claim_amount', 'claim_approved_amount', 'recovered_amount', 'repair_cost',
  'gcc_liability_ratio', 'days_open',
])

/** Compare two records by one table column via cellValue (numeric-aware). */
function compareByCol(col, a, b, now) {
  const va = cellValue(col, a, now)
  const vb = cellValue(col, b, now)
  if (NUMERIC_SORT_COLS.has(col)) {
    const na = Number.isFinite(Number(va)) ? Number(va) : -Infinity
    const nb = Number.isFinite(Number(vb)) ? Number(vb) : -Infinity
    return na - nb
  }
  const sa = va == null ? '' : String(va)
  const sb = vb == null ? '' : String(vb)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

/**
 * FILTERED + SORTED + capped detail-table rows (record objects, not strings).
 * The single source the builder preview, the PDF renderer and the Excel export
 * all consume, so every surface shows exactly the same rows.
 *   - claims filter reuses the claims engine (hasClaim / isClosed):
 *       open   -> hasClaim && !isClosed
 *       closed -> hasClaim &&  isClosed
 *       none   -> !hasClaim
 *       all    -> no claim filter
 *   - status / severity / fault -> case-insensitive match on the canonical value.
 *   - dateFrom / dateTo -> incident_date within the inclusive range when set.
 *   - sort -> by cellValue(col) (numeric for numbers/days_open, else string/date),
 *     dir asc|desc, STABLE (original order breaks ties).
 * Non-mutating; empty / invalid inputs degrade safely.
 */
export function tableRows(records, block = {}, now = Date.now()) {
  const rows = Array.isArray(records) ? records : []
  const f = (block && block.filter) || {}
  const claimsF = f.claims || 'all'
  const statusF = String(f.status || '').trim().toLowerCase()
  const sevF = String(f.severity || '').trim().toLowerCase()
  const faultF = String(f.fault || '').trim().toLowerCase()
  const from = String(f.dateFrom || '').slice(0, 10)
  const to = String(f.dateTo || '').slice(0, 10)

  let out = rows.filter((r) => {
    if (!r) return false
    if (claimsF === 'open' && !(hasClaim(r) && !isClosed(r))) return false
    if (claimsF === 'closed' && !(hasClaim(r) && isClosed(r))) return false
    if (claimsF === 'none' && hasClaim(r)) return false
    if (statusF && String(canonStatus(r.status)).toLowerCase() !== statusF) return false
    if (sevF && String(canonSeverity(r.severity)).toLowerCase() !== sevF) return false
    if (faultF && canonFault(r.fault_status).toLowerCase() !== faultF) return false
    if (from || to) {
      const d = String(r.incident_date || '').slice(0, 10)
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
    }
    return true
  })

  const sort = (block && block.sort) || {}
  if (sort.col && TABLE_COLS[sort.col]) {
    const dir = sort.dir === 'asc' ? 1 : -1
    out = out
      .map((r, i) => [r, i])
      .sort((a, b) => {
        const cmp = compareByCol(sort.col, a[0], b[0], now)
        return cmp !== 0 ? cmp * dir : a[1] - b[1]
      })
      .map((x) => x[0])
  }

  const rawLim = Number(block.limit)
  return out.slice(0, Number.isFinite(rawLim) ? Math.max(1, rawLim) : 25)
}

/** Human-readable ASCII summary of a table block's ACTIVE filters (''=none). */
export function tableFilterLabel(block = {}) {
  const f = (block && block.filter) || {}
  const parts = []
  if (f.claims && f.claims !== 'all') {
    const opt = TABLE_FILTER_OPTS.claims.find(([v]) => v === f.claims)
    parts.push(opt ? opt[1].toLowerCase() : String(f.claims))
  }
  if (f.status) parts.push(`status: ${f.status}`)
  if (f.severity) parts.push(`severity: ${f.severity}`)
  if (f.fault) parts.push(`fault: ${f.fault}`)
  if (f.dateFrom || f.dateTo) parts.push(`date: ${f.dateFrom || 'start'} to ${f.dateTo || 'now'}`)
  return parts.join(', ')
}

/**
 * Build the exact filtered/sorted table as a tabular matrix for Excel export, so
 * the spreadsheet mirrors the on-screen / PDF table. TABLE_COLS supplies headers.
 * @returns {{ headers: string[], colKeys: string[], rows: string[][] }}
 */
export function tableExportMatrix(records, block = {}, money = (v) => String(v)) {
  const cols = ((block && block.columns) || []).filter((c) => TABLE_COLS[c])
  // rows are objects keyed by colKey (not positional arrays) so they feed
  // exportToExcel(rows, colKeys, headers, ...) directly, which reads row[colKey].
  const rows = tableRows(records, block).map((r) => {
    const o = {}
    for (const c of cols) o[c] = fmtCell(c, cellValue(c, r), money)
    return o
  })
  return { headers: cols.map((c) => TABLE_COLS[c]), colKeys: cols.slice(), rows }
}

// ── Auto insights (honest — derived only from the live record set; [] when empty) ──
export function buildInsights(ctx) {
  const { records, claims } = ctx
  if (!records.length) return []
  const out = []
  out.push(`${records.length} incident${records.length === 1 ? '' : 's'} in scope: ${claims.open} open, ${claims.closed} closed.`)

  const serious = records.filter((r) => canonSeverity(r.severity) === 'Major').length
  if (serious > 0) out.push(`${serious} serious incident${serious === 1 ? '' : 's'} (Major), ${Math.round((serious / records.length) * 100)}% of all incidents.`)

  const keys = last12(); const t = Object.fromEntries(keys.map((k) => [k, 0]))
  records.forEach((r) => { const k = mKey(r.incident_date); if (k && t[k] != null) t[k]++ })
  const worst = keys.reduce((a, k) => (t[k] > t[a] ? k : a), keys[0])
  if (t[worst] > 0) out.push(`Peak month in the last 12: ${mLabel(worst)} with ${t[worst]} incident${t[worst] === 1 ? '' : 's'}.`)

  if (claims.bySite?.length) {
    const top = claims.bySite[0]
    if (top?.label && top.label !== 'Unknown') out.push(`Highest-incident site: ${top.label} (${top.count} incident${top.count === 1 ? '' : 's'}).`)
  }
  if (claims.claimed > 0) {
    out.push(`Claims position: ${Math.round(claims.claimed).toLocaleString()} claimed, ${Math.round(claims.recovered).toLocaleString()} recovered${claims.recoveryRate != null ? ` (${claims.recoveryRate}% recovery rate)` : ''}.`)
  }
  if (claims.delayed > 0) out.push(`${claims.delayed} claim${claims.delayed === 1 ? '' : 's'} past the expected release date, follow up with the insurer.`)
  const stale = claims.aging?.['90+']?.count || 0
  if (stale > 0) out.push(`${stale} open claim${stale === 1 ? '' : 's'} older than 90 days.`)

  // Data completeness: what still NEEDS TO BE ADDED on open/claimed cases.
  const openRows = records.filter((r) => !isClosedRow(r))
  const noRelease = openRows.filter((r) => !r.expected_release_date).length
  if (noRelease > 0) out.push(`Needs attention: ${noRelease} open case${noRelease === 1 ? '' : 's'} without an expected release date.`)
  const noInsurer = records.filter((r) => hasClaim(r) && !r.insurer).length
  if (noInsurer > 0) out.push(`Needs attention: ${noInsurer} claim${noInsurer === 1 ? '' : 's'} with no insurer recorded.`)
  const noAmount = records.filter((r) => r.claim_status && r.claim_status !== 'none' && !(Number(r.claim_amount) > 0)).length
  if (noAmount > 0) out.push(`Needs attention: ${noAmount} claim${noAmount === 1 ? '' : 's'} with a claim status but no claim amount.`)
  const noDriver = records.filter((r) => !r.driver_name).length
  if (noDriver > 0) out.push(`Needs attention: ${noDriver} incident${noDriver === 1 ? '' : 's'} missing the driver name.`)
  return out
}

// ── Block registry ────────────────────────────────────────────────────────────
let _seq = 0
export const uid = () => `b${Date.now().toString(36)}${(_seq++).toString(36)}`

export const BLOCK_TYPES = {
  header: { label: 'Header / Logo', description: 'Report title, subtitle, company logo and generation date.' },
  kpis: { label: 'KPI row', description: `A row of headline metrics: pick from ${Object.keys(KPIS).length} accident and claims KPIs.` },
  chart: { label: 'Chart', description: `One of ${Object.keys(CHARTS).length} live charts (doughnut, line, bar, Pareto, dual-axis combo, radar, polar, waterfall) at full, half, third or quarter width, with ${PALETTE_KEYS.length} colour palettes (incl. green and gray), border colour + width, data-label colour + size, and legend/grid toggles.` },
  insights: { label: 'Key findings', description: 'Auto-generated bullet summary computed from the live data (peaks, exposure, delays).' },
  text: { label: 'Text section', description: 'Free-form commentary, findings or recommendations with an optional heading.' },
  table: { label: 'Detail table', description: 'Incident register: choose columns, filter (open/closed claims, status, severity, fault, date range), sort a column and set density + a row cap.' },
  divider: { label: 'Section divider', description: 'A labelled rule to separate report sections.' },
  pagebreak: { label: 'Page break', description: 'Forces the following blocks onto a new PDF page.' },
}

export const BLOCK_DEFAULTS = {
  header: () => ({ logo: '', title: 'Accident & Claims Report', subtitle: '', showDate: true }),
  kpis: () => ({ items: ['total', 'open', 'repairCost', 'claimed', 'recovered', 'netExposure'] }),
  chart: () => ({
    chart: 'severity', title: '', height: 240, width: 'full',
    // Per-chart formatting (all optional, backward-compatible defaults):
    showLabels: true, labelColor: '#0f172a', labelSize: 11,
    showBorders: false, borderColor: null, borderWidth: 1.5,
    showLegend: true, showGrid: true, palette: 'default',
  }),
  insights: () => ({ title: 'Key findings' }),
  text: () => ({ title: '', body: '' }),
  table: () => ({
    title: 'Incident detail',
    columns: ['incident_date', 'asset_no', 'site', 'severity', 'status', 'claim_amount'],
    limit: 25,
    // Filtering / sorting / density (backward-compatible defaults: old saved
    // layouts without these fields behave exactly as before — no filter, no sort,
    // normal density). Consumed by tableRows()/tableExportMatrix() + the PDF.
    filter: { claims: 'all', status: '', severity: '', fault: '', dateFrom: '', dateTo: '' },
    sort: { col: '', dir: 'desc' },
    density: 'normal',
  }),
  divider: () => ({ label: '' }),
  pagebreak: () => ({}),
}

export const makeBlock = (type, extra = {}) => ({ id: uid(), type, ...BLOCK_DEFAULTS[type](), ...extra })

export const STARTER = () => [
  makeBlock('header'),
  makeBlock('kpis'),
  makeBlock('chart', { chart: 'severity', title: 'Severity distribution' }),
  makeBlock('chart', { chart: 'trend', title: 'Incident trend' }),
  makeBlock('table'),
]

// ── Pre-built layout library (one-click professional report packs) ────────────
export const REPORT_LIBRARY = [
  {
    key: 'executive',
    name: 'Executive Summary Pack',
    description: 'One-page management view: headline KPIs, auto key findings, severity mix and the 12-month trend.',
    orientation: 'portrait',
    build: () => [
      makeBlock('header', { title: 'Executive Accident Summary' }),
      makeBlock('kpis', { items: ['total', 'open', 'avgDaysOpen', 'repairCost', 'netExposure', 'recoveryRate'] }),
      makeBlock('insights'),
      makeBlock('chart', { chart: 'severity', title: 'Severity distribution' }),
      makeBlock('chart', { chart: 'trend', title: 'Incident trend (12 months)' }),
    ],
  },
  {
    key: 'claimsDesk',
    name: 'Claims Desk Pack',
    description: 'Insurance-focused: claim KPIs, status & recovery funnel, insurer exposure, ageing and the claims register.',
    orientation: 'portrait',
    build: () => [
      makeBlock('header', { title: 'Insurance Claims Report' }),
      makeBlock('kpis', { items: ['claimsCount', 'claimed', 'approved', 'recovered', 'deductible', 'delayed'] }),
      makeBlock('chart', { chart: 'claimStatus', title: 'Claim status' }),
      makeBlock('chart', { chart: 'recovery', title: 'Recovery funnel' }),
      makeBlock('chart', { chart: 'insurerValue', title: 'Claim value by insurer' }),
      makeBlock('chart', { chart: 'aging', title: 'Open-claim ageing' }),
      makeBlock('pagebreak'),
      makeBlock('table', { title: 'Claims register', columns: ['incident_date', 'asset_no', 'insurer', 'claim_amount', 'claim_approved_amount', 'recovered_amount', 'expected_release_date'], limit: 50 }),
    ],
  },
  {
    key: 'insurer',
    name: 'Insurer Submission',
    description: 'For the insurer/broker: liability & fault splits, GCC case detail and the full incident register.',
    orientation: 'landscape',
    build: () => [
      makeBlock('header', { title: 'Insurer Claims Submission' }),
      makeBlock('kpis', { items: ['claimsCount', 'claimed', 'approved', 'recovered', 'deductible'] }),
      makeBlock('chart', { chart: 'liability', title: 'GCC liability split' }),
      makeBlock('chart', { chart: 'fault', title: 'Fault status' }),
      makeBlock('pagebreak'),
      makeBlock('table', { title: 'Case detail', columns: ['incident_date', 'asset_no', 'driver_name', 'fault_status', 'gcc_liability_ratio', 'insurer', 'claim_amount', 'claim_approved_amount', 'recovered_amount'], limit: 100 }),
    ],
  },
  {
    key: 'safety',
    name: 'Safety Review Pack',
    description: 'Operations & HSE: severity trend, hotspot sites and assets, plus auto findings for the safety meeting.',
    orientation: 'portrait',
    build: () => [
      makeBlock('header', { title: 'Fleet Safety Review' }),
      makeBlock('kpis', { items: ['total', 'open', 'avgDaysOpen', 'repairCost'] }),
      makeBlock('insights'),
      makeBlock('chart', { chart: 'typeRadar', title: 'Accident type profile', width: 'half' }),
      makeBlock('chart', { chart: 'statusPolar', title: 'Status distribution', width: 'half' }),
      makeBlock('chart', { chart: 'paretoAssets', title: 'Asset incident Pareto' }),
      makeBlock('chart', { chart: 'sevMonthly', title: 'Monthly severity mix' }),
      makeBlock('chart', { chart: 'caseAge', title: 'Open cases by days open', width: 'half' }),
      makeBlock('chart', { chart: 'bySite', title: 'Incidents by site', width: 'half' }),
    ],
  },
  {
    key: 'board',
    name: 'Monthly Board Report',
    description: 'Full narrative pack: cover, KPIs, findings, trend & claims charts, commentary section and detail annex.',
    orientation: 'portrait',
    build: () => [
      makeBlock('header', { title: 'Monthly Accident & Claims Board Report' }),
      makeBlock('kpis', { items: ['total', 'open', 'repairCost', 'claimed', 'recovered', 'netExposure'] }),
      makeBlock('insights'),
      makeBlock('divider', { label: 'Performance' }),
      makeBlock('chart', { chart: 'trend', title: 'Incident trend (12 months)' }),
      makeBlock('chart', { chart: 'costTrend', title: 'Cost vs incidents', width: 'half' }),
      makeBlock('chart', { chart: 'recoveryWaterfall', title: 'Recovery waterfall', width: 'half' }),
      makeBlock('text', { title: 'Management commentary', body: '' }),
      makeBlock('pagebreak'),
      makeBlock('divider', { label: 'Annex: incident register' }),
      makeBlock('table', { title: 'Incident detail', columns: ['incident_date', 'asset_no', 'site', 'driver_name', 'severity', 'status', 'days_open', 'claim_amount', 'recovered_amount'], limit: 60 }),
    ],
  },
  {
    // Mirrors the Accidents page "Analytics" tab so the on-screen dashboard can
    // be auto-emailed on a schedule (Accidents -> Analytics -> Auto-email). Chart
    // set + order match downloadAnalyticsPdf()'s chartList (payer-cost has no
    // catalog chart, so it is the one intentional omission).
    key: 'analytics',
    name: 'Accidents Analytics',
    description: 'The Accidents Analytics dashboard as a scheduled e-mail: headline KPIs, severity/status/fault mix, 12-month trend, hotspot assets and sites, monthly severity and claim status.',
    orientation: 'landscape',
    build: () => [
      makeBlock('header', { title: 'Accidents Analytics' }),
      makeBlock('kpis', { items: ['total', 'open', 'avgDaysOpen', 'repairCost', 'claimed', 'recovered'] }),
      makeBlock('chart', { chart: 'severity', title: 'Severity distribution', width: 'third' }),
      makeBlock('chart', { chart: 'status', title: 'Status distribution', width: 'third' }),
      makeBlock('chart', { chart: 'fault', title: 'Fault status (GCC)', width: 'third' }),
      makeBlock('chart', { chart: 'trend', title: 'Incident trend (12 months)' }),
      makeBlock('chart', { chart: 'paretoAssets', title: 'Top assets by incidents', width: 'half' }),
      makeBlock('chart', { chart: 'bySite', title: 'Incidents by site', width: 'half' }),
      makeBlock('chart', { chart: 'sevMonthly', title: 'Monthly severity breakdown', width: 'half' }),
      makeBlock('chart', { chart: 'claimStatus', title: 'Claim status breakdown', width: 'half' }),
    ],
  },
  {
    key: 'register',
    name: 'Full Detail Register',
    description: 'Everything on record: landscape register with the widest column set for audits and hand-overs.',
    orientation: 'landscape',
    build: () => [
      makeBlock('header', { title: 'Accident Register: Full Detail' }),
      makeBlock('kpis', { items: ['total', 'open', 'closed', 'claimsCount'] }),
      makeBlock('table', { title: 'Incident register', columns: Object.keys(TABLE_COLS), limit: 200 }),
    ],
  },
]

/** Validate/repair a persisted builder config so old or hand-edited layouts never crash the UI. */
export function normalizeConfig(cfg) {
  const blocks = Array.isArray(cfg?.blocks) ? cfg.blocks : []
  const safe = blocks
    .filter((b) => b && BLOCK_TYPES[b.type])
    .map((b) => ({ ...BLOCK_DEFAULTS[b.type](), ...b, id: b.id || uid() }))
  return {
    blocks: safe,
    orientation: cfg?.orientation === 'landscape' ? 'landscape' : 'portrait',
  }
}
