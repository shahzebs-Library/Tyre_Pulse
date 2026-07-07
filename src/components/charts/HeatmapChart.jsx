/**
 * HeatmapChart — grid heatmap (e.g. wheel position x axle, branch x month)
 * with a continuous sequential color scale. Thin config-builder over EChart.
 */

import EChart from './EChart'
import { useChartTheme } from './theme'

/**
 * Pure option builder — exported for tests.
 * @param {object} cfg
 * @param {string[]} cfg.xLabels  Category labels for the x axis.
 * @param {string[]} cfg.yLabels  Category labels for the y axis.
 * @param {Array<[number, number, number]>} cfg.data  [xIndex, yIndex, value] triples.
 * @param {string[]} [cfg.colorRange]  Override sequential ramp (low → high).
 * @param {object} theme  Token set from resolveChartTheme/useChartTheme.
 * @returns {object} ECharts option.
 */
export function buildHeatmapOption({ xLabels = [], yLabels = [], data = [], colorRange }, theme) {
  const values = data.map((d) => d[2]).filter((v) => Number.isFinite(v))
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1

  return {
    grid: { left: 8, right: 16, top: 16, bottom: 56, containLabel: true },
    tooltip: {
      position: 'top',
      formatter: (p) => `${yLabels[p.value[1]] ?? ''} / ${xLabels[p.value[0]] ?? ''}: <b>${p.value[2]}</b>`,
    },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLine: { lineStyle: { color: theme.axisLine } },
      axisLabel: { color: theme.textMuted, fontSize: 11 },
      splitArea: { show: true },
    },
    yAxis: {
      type: 'category',
      data: yLabels,
      axisLine: { lineStyle: { color: theme.axisLine } },
      axisLabel: { color: theme.textMuted, fontSize: 11 },
      splitArea: { show: true },
    },
    visualMap: {
      min,
      max: max === min ? min + 1 : max,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemHeight: 90,
      textStyle: { color: theme.textMuted, fontSize: 10 },
      inRange: { color: colorRange && colorRange.length >= 2 ? colorRange : theme.sequential },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: { show: true, color: theme.text, fontSize: 10 },
        itemStyle: { borderColor: theme.surface, borderWidth: 2, borderRadius: 2 },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.35)' } },
      },
    ],
  }
}

/**
 * @param {object} props
 * @param {string[]} props.xLabels
 * @param {string[]} props.yLabels
 * @param {Array<[number, number, number]>} props.data  [xIndex, yIndex, value].
 * @param {string[]} [props.colorRange]  Low→high color ramp override.
 * @param {number|string} [props.height=320]
 * @param {string} [props.className]
 * @param {(chart: object) => void} [props.onReady]
 */
export default function HeatmapChart({ xLabels = [], yLabels = [], data = [], colorRange, height = 320, className, onReady }) {
  const theme = useChartTheme()

  if (data.length === 0 || xLabels.length === 0 || yLabels.length === 0) {
    return (
      <div
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
        className={`flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 ${className || ''}`}
      >
        No heatmap data available
      </div>
    )
  }

  return (
    <EChart
      option={buildHeatmapOption({ xLabels, yLabels, data, colorRange }, theme)}
      height={height}
      className={className}
      onReady={onReady}
      ariaLabel="Heatmap chart"
    />
  )
}
