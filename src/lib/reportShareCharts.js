/**
 * reportShareCharts - the SINGLE set of light-theme ECharts option builders for
 * the public report / TV share surface. Both the public viewer
 * (src/pages/ReportShare.jsx) and the block renderer
 * (src/components/display/ShareBlockView.jsx) import from here so a chart looks
 * identical whether it is on a fixed page, a custom board, or the builder preview.
 *
 * Pure: every function returns a plain ECharts option object. Colours come from
 * the shared report palette (src/lib/reportColors) so the boards follow the
 * super-admin theme. All literals are pinned light so canvases read on white
 * paper. No em / en dashes, arrows, middle dots or curly quotes.
 */
import { categorical, colorAt, withAlpha } from './reportColors'

// ── Light palette (pinned so charts read on white paper) ────────────────────────
export const P = {
  text: '#0f172a',
  subText: '#334155',
  muted: '#64748b',
  axisLine: 'rgba(16,24,40,0.16)',
  splitLine: 'rgba(16,24,40,0.07)',
}
export const TOOLTIP = {
  backgroundColor: '#ffffff',
  borderColor: 'rgba(16,24,40,0.12)',
  borderWidth: 1,
  textStyle: { color: P.text, fontSize: 13 },
}

// ── Number formatting ───────────────────────────────────────────────────────────
const GROUP = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
export const fmtInt = (v) => GROUP.format(Math.round(Number(v) || 0))
export function fmtCompact(v) {
  const n = Number(v) || 0
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}
const arr = (v) => (Array.isArray(v) ? v : [])
export const someNonZero = (list) => arr(list).some((n) => Number(n) > 0)

// ── Sparkline (KPI tile footer) ─────────────────────────────────────────────────
export function sparkOption(series, idx = 0) {
  const color = colorAt(idx)
  return {
    backgroundColor: 'transparent',
    grid: { left: 0, right: 0, top: 4, bottom: 0 },
    xAxis: { type: 'category', show: false, data: series.map((_, i) => i) },
    yAxis: { type: 'value', show: false },
    tooltip: { show: false },
    series: [{
      type: 'line', data: series, smooth: true, symbol: 'none',
      lineStyle: { width: 2.5, color },
      areaStyle: { color: withAlpha(color, 0.16) },
    }],
  }
}

// ── Combo: tyre spend (bars) + accidents (line), dual axis ──────────────────────
export function comboOption(labels, spend, accidents) {
  const cSpend = colorAt(0)
  const cAcc = colorAt(3)
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, textStyle: { color: P.subText, fontSize: 14 }, itemGap: 20 },
    grid: { left: 10, right: 12, top: 44, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: labels,
      axisLabel: { color: P.muted, fontSize: 13 },
      axisLine: { lineStyle: { color: P.axisLine } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value', name: 'Spend', nameTextStyle: { color: P.muted, fontSize: 12 },
        axisLabel: { color: P.muted, fontSize: 12, formatter: (v) => fmtCompact(v) },
        splitLine: { lineStyle: { color: P.splitLine } },
      },
      {
        type: 'value', name: 'Accidents', nameTextStyle: { color: P.muted, fontSize: 12 },
        axisLabel: { color: P.muted, fontSize: 12 },
        splitLine: { show: false }, minInterval: 1,
      },
    ],
    series: [
      {
        name: 'Tyre Spend', type: 'bar', data: spend, barMaxWidth: 36,
        itemStyle: { color: cSpend, borderRadius: [5, 5, 0, 0] },
        markPoint: {
          symbol: 'pin', symbolSize: 46,
          data: [{ type: 'max', name: 'Max' }],
          itemStyle: { color: withAlpha(cSpend, 0.9) },
          label: { color: '#ffffff', fontSize: 11, formatter: (d) => fmtCompact(d.value) },
        },
      },
      {
        name: 'Accidents', type: 'line', yAxisIndex: 1, data: accidents,
        smooth: true, symbol: 'circle', symbolSize: 7,
        lineStyle: { width: 3, color: cAcc }, itemStyle: { color: cAcc },
        areaStyle: { color: withAlpha(cAcc, 0.1) },
      },
    ],
  }
}

// ── Claims: claimed vs recovered, two smooth area lines ─────────────────────────
export function claimsOption(labels, claimed, recovered) {
  const c1 = colorAt(4)
  const c2 = colorAt(1)
  const line = (name, data, color) => ({
    name, type: 'line', data, smooth: true, symbol: 'circle', symbolSize: 6,
    lineStyle: { width: 3, color }, itemStyle: { color },
    areaStyle: { color: withAlpha(color, 0.1) },
  })
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', valueFormatter: (v) => fmtInt(v) },
    legend: { top: 0, textStyle: { color: P.subText, fontSize: 14 }, itemGap: 20 },
    grid: { left: 10, right: 14, top: 44, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: labels,
      axisLabel: { color: P.muted, fontSize: 13 },
      axisLine: { lineStyle: { color: P.axisLine } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: P.muted, fontSize: 12, formatter: (v) => fmtCompact(v) },
      splitLine: { lineStyle: { color: P.splitLine } },
    },
    series: [line('Claimed', claimed, c1), line('Recovered', recovered, c2)],
  }
}

// ── Generic single-series over 12-month labels: area | line | bar ───────────────
export function seriesOption(labels, data, viz = 'area', accentIdx = 2) {
  const color = colorAt(accentIdx)
  const base = {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', valueFormatter: (v) => fmtInt(v) },
    grid: { left: 10, right: 14, top: 18, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: labels,
      axisLabel: { color: P.muted, fontSize: 13 },
      axisLine: { lineStyle: { color: P.axisLine } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value', minInterval: 1,
      axisLabel: { color: P.muted, fontSize: 12, formatter: (v) => fmtCompact(v) },
      splitLine: { lineStyle: { color: P.splitLine } },
    },
  }
  if (viz === 'bar') {
    return {
      ...base,
      series: [{
        type: 'bar', data, barMaxWidth: 34,
        itemStyle: { color, borderRadius: [6, 6, 0, 0] },
      }],
    }
  }
  return {
    ...base,
    series: [{
      type: 'line', data, smooth: true, symbol: 'circle', symbolSize: 7,
      lineStyle: { width: 3, color }, itemStyle: { color },
      areaStyle: viz === 'area' ? { color: withAlpha(color, 0.16) } : undefined,
    }],
  }
}

// ── Breakdown: doughnut ─────────────────────────────────────────────────────────
export function doughnutOption(items) {
  const colors = categorical(items.length)
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...TOOLTIP, trigger: 'item',
      formatter: (p) => `${p.name}: <b>${fmtInt(p.value)}</b> (${p.percent}%)`,
    },
    legend: { bottom: 0, textStyle: { color: P.subText, fontSize: 13 } },
    series: [{
      type: 'pie', radius: ['44%', '72%'], center: ['50%', '46%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 6 },
      label: { color: P.text, fontSize: 13, formatter: '{b}: {c}' },
      labelLine: { lineStyle: { color: P.axisLine } },
      data: items.map((it, i) => ({ name: it.label, value: it.value, itemStyle: { color: colors[i] } })),
    }],
  }
}

// ── Breakdown: horizontal bars ──────────────────────────────────────────────────
export function hbarOption(items) {
  const colors = categorical(items.length)
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => fmtInt(v) },
    grid: { left: 10, right: 28, top: 12, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: P.muted, fontSize: 12, formatter: (v) => fmtCompact(v) },
      splitLine: { lineStyle: { color: P.splitLine } },
    },
    yAxis: {
      type: 'category', data: items.map((i) => i.label),
      axisLabel: { color: P.subText, fontSize: 13 },
      axisLine: { lineStyle: { color: P.axisLine } },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar', barMaxWidth: 28,
      data: items.map((it, i) => ({ value: it.value, itemStyle: { color: colors[i], borderRadius: [0, 6, 6, 0] } })),
      label: { show: true, position: 'right', color: P.subText, fontSize: 12, formatter: (p) => fmtInt(p.value) },
    }],
  }
}

// ── Breakdown: vertical bars ────────────────────────────────────────────────────
export function vbarOption(items) {
  const colors = categorical(items.length)
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => fmtInt(v) },
    grid: { left: 10, right: 14, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: items.map((i) => i.label),
      axisLabel: { color: P.muted, fontSize: 12, interval: 0, rotate: items.length > 6 ? 30 : 0 },
      axisLine: { lineStyle: { color: P.axisLine } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value', minInterval: 1,
      axisLabel: { color: P.muted, fontSize: 12 },
      splitLine: { lineStyle: { color: P.splitLine } },
    },
    series: [{
      type: 'bar', barMaxWidth: 44,
      data: items.map((it, i) => ({ value: it.value, itemStyle: { color: colors[i], borderRadius: [6, 6, 0, 0] } })),
      label: { show: true, position: 'top', color: P.subText, fontSize: 12, formatter: (p) => fmtInt(p.value) },
    }],
  }
}

// ── Breakdown: treemap ──────────────────────────────────────────────────────────
export function treemapOption(items) {
  const colors = categorical(items.length)
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, formatter: (p) => `${p.name}: <b>${fmtInt(p.value)}</b>` },
    series: [{
      type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false },
      width: '100%', height: '100%', top: 4, left: 4, right: 4, bottom: 4,
      label: { show: true, color: '#ffffff', fontSize: 14, formatter: '{b}\n{c}' },
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, gapWidth: 2 },
      data: items.map((it, i) => ({ name: it.label, value: it.value, itemStyle: { color: colors[i] } })),
    }],
  }
}

/** Build a breakdown option by viz style. */
export function breakdownOption(items, viz = 'doughnut') {
  if (viz === 'hbar') return hbarOption(items)
  if (viz === 'vbar') return vbarOption(items)
  if (viz === 'treemap') return treemapOption(items)
  return doughnutOption(items)
}

// ── Gauge: single 0..100 dial (null value -> honest N/A) ────────────────────────
export function gaugeOption(value, label, idx = 0) {
  const has = Number.isFinite(value)
  const color = colorAt(idx)
  const v = has ? Math.max(0, Math.min(100, value)) : 0
  return {
    backgroundColor: 'transparent',
    series: [{
      type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: 100,
      radius: '92%', center: ['50%', '58%'],
      progress: { show: true, width: 16, itemStyle: { color } },
      axisLine: { lineStyle: { width: 16, color: [[1, withAlpha(color, 0.14)]] } },
      pointer: { show: has, length: '62%', width: 5, itemStyle: { color } },
      anchor: { show: has, size: 12, itemStyle: { color } },
      axisTick: { show: false },
      splitLine: { length: 10, lineStyle: { color: P.axisLine, width: 2 } },
      axisLabel: { color: P.muted, fontSize: 12, distance: -32 },
      title: { offsetCenter: [0, '30%'], color: P.subText, fontSize: 15, fontWeight: 600 },
      detail: {
        offsetCenter: [0, '-6%'], color: has ? P.text : P.muted,
        fontSize: 40, fontWeight: 800,
        formatter: () => (has ? `${Math.round(v)}%` : 'N/A'),
      },
      data: [{ value: v, name: label }],
    }],
  }
}

// ── Heatmap: site (y) x severity (x), coloured by incident count ────────────────
const safeStr = (v) => (v == null || v === '' ? 'N/A' : String(v))
export function heatmapOption(rows) {
  const xs = []
  const ys = []
  for (const r of rows) {
    const sx = safeStr(r.severity)
    const sy = safeStr(r.site)
    if (!xs.includes(sx)) xs.push(sx)
    if (!ys.includes(sy)) ys.push(sy)
  }
  const data = rows.map((r) => [
    xs.indexOf(safeStr(r.severity)),
    ys.indexOf(safeStr(r.site)),
    Number(r.value) || 0,
  ])
  const max = Math.max(1, ...data.map((d) => d[2]))
  const base = colorAt(3)
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...TOOLTIP, position: 'top',
      formatter: (p) => `${ys[p.value[1]]} | ${xs[p.value[0]]}: <b>${fmtInt(p.value[2])}</b>`,
    },
    grid: { left: 10, right: 18, top: 10, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: xs, splitArea: { show: true },
      axisLabel: { color: P.subText, fontSize: 13 },
      axisLine: { lineStyle: { color: P.axisLine } }, axisTick: { show: false },
    },
    yAxis: {
      type: 'category', data: ys, splitArea: { show: true },
      axisLabel: { color: P.subText, fontSize: 13 },
      axisLine: { lineStyle: { color: P.axisLine } }, axisTick: { show: false },
    },
    visualMap: {
      min: 0, max, calculable: true, orient: 'horizontal',
      left: 'center', bottom: 0, itemHeight: 90,
      inRange: { color: [withAlpha(base, 0.12), withAlpha(base, 0.55), base] },
      textStyle: { color: P.muted, fontSize: 12 },
    },
    series: [{
      type: 'heatmap', data,
      label: { show: true, color: P.text, fontSize: 13, formatter: (p) => (p.value[2] ? fmtInt(p.value[2]) : '') },
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 4 },
      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(15,23,42,0.2)' } },
    }],
  }
}
