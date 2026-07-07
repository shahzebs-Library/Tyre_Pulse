/**
 * ParetoChart — descending bars + cumulative-% line (classic Pareto/80-20,
 * e.g. failure causes by cost). Thin config-builder over EChart.
 */

import EChart from './EChart'
import { useChartTheme } from './theme'

/**
 * Pure option builder — exported for tests. Items are sorted descending by
 * value; the cumulative % line uses the right-hand 0–100% axis (the standard
 * Pareto convention — both axes describe the same measure).
 * @param {object} cfg
 * @param {{label: string, value: number}[]} cfg.items
 * @param {string} [cfg.yLabel]  Left axis name (the bar measure).
 * @param {object} theme  Token set from resolveChartTheme/useChartTheme.
 * @returns {object} ECharts option.
 */
export function buildParetoOption({ items = [], yLabel = '' }, theme) {
  const sorted = [...items]
    .filter((i) => Number.isFinite(i.value))
    .sort((a, b) => b.value - a.value)
  const total = sorted.reduce((acc, i) => acc + i.value, 0) || 1
  let running = 0
  const cumulative = sorted.map((i) => {
    running += i.value
    return Math.round((running / total) * 1000) / 10
  })

  return {
    grid: { left: 48, right: 56, top: 32, bottom: 24, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v) => (typeof v === 'number' ? v.toLocaleString() : v),
    },
    legend: {
      top: 0,
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: theme.textMuted, fontSize: 12 },
    },
    xAxis: {
      type: 'category',
      data: sorted.map((i) => i.label),
      axisLine: { lineStyle: { color: theme.axisLine } },
      axisLabel: { color: theme.textMuted, fontSize: 11, interval: 0, rotate: sorted.length > 6 ? 30 : 0 },
    },
    yAxis: [
      {
        type: 'value',
        name: yLabel,
        nameTextStyle: { color: theme.textMuted, fontSize: 11 },
        axisLabel: { color: theme.textMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { formatter: '{value}%', color: theme.textMuted, fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: yLabel || 'Value',
        type: 'bar',
        barMaxWidth: 36,
        itemStyle: { color: theme.palette[0], borderRadius: [4, 4, 0, 0] },
        data: sorted.map((i) => i.value),
      },
      {
        name: 'Cumulative %',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: { width: 2, color: theme.palette[2] },
        itemStyle: { color: theme.palette[2], borderColor: theme.surface, borderWidth: 2 },
        data: cumulative,
      },
    ],
  }
}

/**
 * @param {object} props
 * @param {{label: string, value: number}[]} props.items
 * @param {string} [props.yLabel]
 * @param {number|string} [props.height=320]
 * @param {string} [props.className]
 * @param {(chart: object) => void} [props.onReady]
 */
export default function ParetoChart({ items = [], yLabel = '', height = 320, className, onReady }) {
  const theme = useChartTheme()

  if (items.length === 0) {
    return (
      <div
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
        className={`flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 ${className || ''}`}
      >
        No data available
      </div>
    )
  }

  return (
    <EChart
      option={buildParetoOption({ items, yLabel }, theme)}
      height={height}
      className={className}
      onReady={onReady}
      ariaLabel={`Pareto chart${yLabel ? `: ${yLabel}` : ''}`}
    />
  )
}
