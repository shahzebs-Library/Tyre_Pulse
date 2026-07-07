/**
 * TrendChart — multi-series time trend (smooth line / area) with dataZoom
 * slider, legend, and axis-pointer tooltip. Thin config-builder over EChart.
 */

import EChart from './EChart'
import { useChartTheme } from './theme'

/**
 * Pure option builder — exported for tests.
 * @param {object} cfg
 * @param {{name: string, data: Array<[string|number|Date, number]>}[]} cfg.series
 *   One entry per series; data points are [date, value] pairs.
 * @param {string} [cfg.yLabel]  Y-axis name/unit label.
 * @param {boolean} [cfg.area]   Render as soft area fill under each line.
 * @param {object} theme  Token set from resolveChartTheme/useChartTheme.
 * @returns {object} ECharts option.
 */
export function buildTrendOption({ series = [], yLabel = '', area = false }, theme) {
  const multi = series.length > 1
  return {
    grid: { left: 48, right: 24, top: multi ? 44 : 24, bottom: 64, containLabel: true },
    ...(multi && {
      legend: {
        top: 0,
        icon: 'roundRect',
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { color: theme.textMuted, fontSize: 12 },
      },
    }),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: theme.tooltipBg, color: theme.text } },
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: theme.axisLine } },
      axisLabel: { color: theme.textMuted, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: yLabel,
      nameTextStyle: { color: theme.textMuted, fontSize: 11 },
      axisLabel: { color: theme.textMuted, fontSize: 11 },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    dataZoom: [
      {
        type: 'slider',
        height: 20,
        bottom: 12,
        borderColor: theme.axisLine,
        textStyle: { color: theme.textMuted, fontSize: 10 },
      },
      { type: 'inside' },
    ],
    series: series.map((s) => ({
      name: s.name,
      type: 'line',
      smooth: true,
      showSymbol: false,
      emphasis: { focus: 'series' },
      lineStyle: { width: 2 },
      ...(area && { areaStyle: { opacity: 0.15 } }),
      data: s.data,
    })),
  }
}

/**
 * @param {object} props
 * @param {{name: string, data: Array<[string|number|Date, number]>}[]} props.series
 * @param {string} [props.yLabel]
 * @param {boolean} [props.area]
 * @param {number|string} [props.height=320]
 * @param {string} [props.className]
 * @param {(chart: object) => void} [props.onReady]
 */
export default function TrendChart({ series = [], yLabel = '', area = false, height = 320, className, onReady }) {
  const theme = useChartTheme()

  if (series.length === 0 || series.every((s) => !s.data || s.data.length === 0)) {
    return (
      <div
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
        className={`flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 ${className || ''}`}
      >
        No trend data available
      </div>
    )
  }

  return (
    <EChart
      option={buildTrendOption({ series, yLabel, area }, theme)}
      height={height}
      className={className}
      onReady={onReady}
      ariaLabel={`Trend chart${yLabel ? `: ${yLabel}` : ''}`}
    />
  )
}
