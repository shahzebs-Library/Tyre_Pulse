/**
 * displayCharts.js - dark-themed Apache ECharts option builders for the TV
 * kiosk (DisplayDashboard, /display).
 *
 * PURE: every export returns a plain ECharts `option` object (or shapes data for
 * one). No I/O, no imports, no side effects - so they are unit-testable and safe
 * to call inside render memos. The palette is a FIXED high-contrast dark set
 * tuned for a wall display (large fonts, bright hues on near-black), independent
 * of the app's light/dark theme (the kiosk is always dark).
 *
 * Colour semantics: builders accept optional per-item `color` (e.g. the severity
 * ladder) and fall back to the categorical palette. Pass semantic colours for
 * risk/severity/status so the meaning is preserved; leave them off for neutral
 * categorical breakdowns (by site, by vendor).
 */

// High-contrast categorical palette for a dark wall display.
export const KIOSK_PALETTE = [
  '#38bdf8', '#22c55e', '#f97316', '#a78bfa', '#eab308',
  '#f472b6', '#2dd4bf', '#fb7185', '#60a5fa', '#34d399',
]

// Shared dark ink tokens (kept local so the module has zero deps).
const INK = '#f1f5f9'
const SUB = '#cbd5e1'
const MUTED = '#94a3b8'
const AXIS = 'rgba(148,163,184,0.28)'
const SPLIT = 'rgba(148,163,184,0.12)'
const TOOLTIP = {
  backgroundColor: '#0d1420',
  borderColor: 'rgba(148,163,184,0.3)',
  borderWidth: 1,
  textStyle: { color: INK, fontSize: 15 },
  padding: [8, 12],
}

/** n categorical colours, cycling the kiosk palette. */
export function categorical(n) {
  const out = []
  for (let i = 0; i < Math.max(0, n | 0); i += 1) out.push(KIOSK_PALETTE[i % KIOSK_PALETTE.length])
  return out
}

/** #rrggbb -> rgba(r,g,b,a). Non-hex input is returned unchanged. */
export function withAlpha(hex, a = 1) {
  if (typeof hex !== 'string') return hex
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const int = parseInt(m[1], 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r},${g},${b},${a})`
}

/** Round to a whole number (0 for non-finite). */
export function fmtInt(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : '0'
}

/** Compact currency-ish number: 1.2M / 34.5K / 812. */
export function fmtCompact(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${Math.round(n)}`
}

/** True when there is at least one positive value to plot. */
export function hasData(items) {
  return Array.isArray(items) && items.some((it) => Number(it?.value) > 0)
}

/**
 * Doughnut / pie. items: [{ label, value, color? }].
 * opts.center/radius override placement; opts.showLegend toggles the legend.
 */
export function donutOption(items, opts = {}) {
  const list = Array.isArray(items) ? items : []
  const colors = categorical(list.length)
  const {
    center = ['50%', '46%'],
    radius = ['46%', '72%'],
    showLegend = true,
    valueFmt = fmtInt,
  } = opts
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...TOOLTIP, trigger: 'item',
      formatter: (p) => `${p.name}: <b>${valueFmt(p.value)}</b> (${p.percent}%)`,
    },
    legend: showLegend
      ? { bottom: 0, textStyle: { color: SUB, fontSize: 15 }, itemGap: 18 }
      : { show: false },
    series: [{
      type: 'pie', radius, center, avoidLabelOverlap: true,
      itemStyle: { borderColor: '#0d1420', borderWidth: 3, borderRadius: 6 },
      label: { color: INK, fontSize: 16, fontWeight: 'bold', formatter: '{c}' },
      labelLine: { lineStyle: { color: AXIS } },
      data: list.map((it, i) => ({
        name: it.label, value: Number(it.value) || 0,
        itemStyle: { color: it.color || colors[i] },
      })),
    }],
  }
}

/** Horizontal bar. items: [{ label, value, color? }]. Highest at top. */
export function hBarOption(items, opts = {}) {
  const list = (Array.isArray(items) ? items : []).slice()
  const colors = categorical(list.length)
  const { valueFmt = fmtInt } = opts
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: valueFmt },
    grid: { left: 10, right: 44, top: 12, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: MUTED, fontSize: 13, formatter: (v) => fmtCompact(v) },
      splitLine: { lineStyle: { color: SPLIT } },
    },
    yAxis: {
      type: 'category', data: list.map((i) => i.label),
      inverse: true,
      axisLabel: { color: SUB, fontSize: 15 },
      axisLine: { lineStyle: { color: AXIS } },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar', barMaxWidth: 30,
      data: list.map((it, i) => ({
        value: Number(it.value) || 0,
        itemStyle: { color: it.color || colors[i], borderRadius: [0, 6, 6, 0] },
      })),
      label: { show: true, position: 'right', color: SUB, fontSize: 14, fontWeight: 'bold', formatter: (p) => valueFmt(p.value) },
    }],
  }
}

/** Vertical bar. items: [{ label, value, color? }]. */
export function vBarOption(items, opts = {}) {
  const list = Array.isArray(items) ? items : []
  const colors = categorical(list.length)
  const { valueFmt = fmtInt } = opts
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: valueFmt },
    grid: { left: 10, right: 14, top: 22, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: list.map((i) => i.label),
      axisLabel: { color: MUTED, fontSize: 13, interval: 0, rotate: list.length > 6 ? 28 : 0 },
      axisLine: { lineStyle: { color: AXIS } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value', minInterval: 1,
      axisLabel: { color: MUTED, fontSize: 13, formatter: (v) => fmtCompact(v) },
      splitLine: { lineStyle: { color: SPLIT } },
    },
    series: [{
      type: 'bar', barMaxWidth: 46,
      data: list.map((it, i) => ({
        value: Number(it.value) || 0,
        itemStyle: { color: it.color || colors[i], borderRadius: [6, 6, 0, 0] },
      })),
      label: { show: true, position: 'top', color: SUB, fontSize: 14, fontWeight: 'bold', formatter: (p) => valueFmt(p.value) },
    }],
  }
}

/**
 * Radial gauge (0..max). Colour bands drive the arc: green->amber->red by
 * default (higher is better); pass invert to flip (higher is worse).
 */
export function gaugeOption(value, opts = {}) {
  const { max = 100, label = '', unit = '%', invert = false, color } = opts
  const v = Number.isFinite(Number(value)) ? Number(value) : 0
  const bands = invert
    ? [[0.5, '#22c55e'], [0.8, '#eab308'], [1, '#ef4444']]
    : [[0.5, '#ef4444'], [0.8, '#eab308'], [1, '#22c55e']]
  const axisColor = color ? [[1, color]] : bands
  return {
    backgroundColor: 'transparent',
    series: [{
      type: 'gauge', min: 0, max, startAngle: 210, endAngle: -30,
      radius: '92%', center: ['50%', '58%'],
      progress: { show: false },
      axisLine: { lineStyle: { width: 20, color: axisColor } },
      pointer: { itemStyle: { color: INK }, width: 5, length: '62%' },
      anchor: { show: true, size: 14, itemStyle: { color: INK } },
      axisTick: { distance: -20, length: 6, lineStyle: { color: '#0d1420', width: 2 } },
      splitLine: { distance: -20, length: 20, lineStyle: { color: '#0d1420', width: 3 } },
      axisLabel: { distance: -8, color: MUTED, fontSize: 13 },
      detail: {
        valueAnimation: true, offsetCenter: [0, '32%'],
        formatter: (val) => `${Math.round(val)}${unit}`,
        color: INK, fontSize: 40, fontWeight: 'bold',
      },
      title: { offsetCenter: [0, '62%'], color: SUB, fontSize: 15 },
      data: [{ value: v, name: label }],
    }],
  }
}

/**
 * Line/area trend. labels: string[]; series: [{ name, data, color?, area? }].
 * Multiple series render on one axis (all counts/same unit).
 */
export function lineAreaOption(labels, series, opts = {}) {
  const list = Array.isArray(series) ? series : []
  const { valueFmt = fmtInt, showLegend = true } = opts
  const colors = categorical(list.length)
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', valueFormatter: valueFmt },
    legend: showLegend && list.length > 1
      ? { top: 0, textStyle: { color: SUB, fontSize: 15 }, itemGap: 22 }
      : { show: false },
    grid: { left: 10, right: 18, top: list.length > 1 ? 40 : 16, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: Array.isArray(labels) ? labels : [],
      boundaryGap: false,
      axisLabel: { color: MUTED, fontSize: 13 },
      axisLine: { lineStyle: { color: AXIS } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: MUTED, fontSize: 13, formatter: (v) => fmtCompact(v) },
      splitLine: { lineStyle: { color: SPLIT } },
    },
    series: list.map((s, i) => {
      const c = s.color || colors[i]
      return {
        name: s.name, type: 'line', data: s.data || [],
        smooth: true, symbol: 'circle', symbolSize: 7,
        lineStyle: { width: 3.5, color: c }, itemStyle: { color: c },
        areaStyle: s.area === false ? undefined : { color: withAlpha(c, 0.16) },
      }
    }),
  }
}

/**
 * Dual-axis combo: bars (left axis) + a line (right axis). Useful for
 * value-vs-count on one board (e.g. spend vs incidents).
 */
export function comboOption(labels, bar, line, opts = {}) {
  const { barName = 'Value', lineName = 'Count', barFmt = fmtCompact, lineFmt = fmtInt } = opts
  const cBar = KIOSK_PALETTE[0]
  const cLine = KIOSK_PALETTE[2]
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, textStyle: { color: SUB, fontSize: 15 }, itemGap: 22 },
    grid: { left: 10, right: 14, top: 40, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: Array.isArray(labels) ? labels : [],
      axisLabel: { color: MUTED, fontSize: 13 },
      axisLine: { lineStyle: { color: AXIS } },
      axisTick: { show: false },
    },
    yAxis: [
      { type: 'value', axisLabel: { color: MUTED, fontSize: 12, formatter: (v) => barFmt(v) }, splitLine: { lineStyle: { color: SPLIT } } },
      { type: 'value', axisLabel: { color: MUTED, fontSize: 12, formatter: (v) => lineFmt(v) }, splitLine: { show: false }, minInterval: 1 },
    ],
    series: [
      { name: barName, type: 'bar', data: bar || [], barMaxWidth: 34, itemStyle: { color: cBar, borderRadius: [5, 5, 0, 0] } },
      { name: lineName, type: 'line', yAxisIndex: 1, data: line || [], smooth: true, symbol: 'circle', symbolSize: 7, lineStyle: { width: 3.5, color: cLine }, itemStyle: { color: cLine }, areaStyle: { color: withAlpha(cLine, 0.1) } },
    ],
  }
}

// ── Data shapers (pure) ───────────────────────────────────────────────────────

/**
 * Tyre-risk composition from a computeTyreAttention() result:
 * Critical / High / OK (OK = total - critical - high, floored at 0).
 * Returns [] when there are no tyres in service.
 */
export function tyreRiskItems(attention) {
  const total = Number(attention?.total) || 0
  if (total <= 0) return []
  const critical = Number(attention?.critical) || 0
  const high = Number(attention?.high) || 0
  const ok = Math.max(0, total - critical - high)
  return [
    { label: 'Critical', value: critical, color: '#ef4444' },
    { label: 'High', value: high, color: '#f97316' },
    { label: 'OK', value: ok, color: '#22c55e' },
  ]
}

/** Inspection-status items (Done / Pending / Overdue) from countTodaysInspections. */
export function inspectionStatusItems(insp) {
  return [
    { label: 'Done', value: Number(insp?.done) || 0, color: '#22c55e' },
    { label: 'Pending', value: Number(insp?.pending) || 0, color: '#eab308' },
    { label: 'Overdue', value: Number(insp?.overdue) || 0, color: '#ef4444' },
  ]
}

/** Alert-severity items from summariseAlerts().bySeverity, in ladder order. */
export function alertSeverityItems(bySeverity) {
  const map = {
    Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#22c55e', Info: '#38bdf8',
  }
  return Object.keys(map).map((sev) => ({
    label: sev, value: Number(bySeverity?.[sev]) || 0, color: map[sev],
  }))
}

/**
 * Count rows by a keying function into [{ label, value }], sorted desc and
 * capped at `top`. Blank/nullish keys fold into `fallback`. Pure, generic.
 */
export function countBy(rows, keyFn, { top = 8, fallback = 'Unknown' } = {}) {
  const counts = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    let k = keyFn(r)
    k = k == null || k === '' ? fallback : String(k)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, top)
}
